import type { AppliedObject } from "./applyViaREST";
import type { ChatItem } from "./index";
import {
  readSessionScoped,
  readTabScoped,
  removeSessionScoped,
  removeTabScoped,
  writeTabScoped,
} from "../../lib/sessionScope";

// Keeping the AI Assistant conversation across navigation.
//
// The page is one React component, so walking to Firewall Policy and back unmounted it and threw
// the whole conversation away — including proposals that had already been applied to a live
// firewall, and the bookkeeping that knows they were. That bookkeeping is the reason this persists
// more than a transcript: without `appliedWizards` / `appliedObjects` a restored chat re-offers
// "Apply" on objects that already exist on the device (FortiGate answers `error -5`) and loses the
// Fallback button that is the only way to take them back off again.
//
// WHERE IT LIVES
// sessionStorage under the session-scoped prefix (see lib/sessionScope), NOT localStorage, and that
// is a deliberate reversal — this file used to argue the opposite, on the grounds that "I closed the
// tab" is not a case the conversation needs to survive being broken.
//
// What changed the trade is WHAT the transcript can contain rather than how long it is wanted. The
// messages hold the CLI the model proposed, and for a VPN that includes `set psk <key>`: a live
// tunnel credential, in clear, in a file under the browser profile. Logout, a 401 and the
// maintenance force-logout all clear it, so the "whoever signs in next" disclosure was already
// closed; the window they cannot close is between a browser or machine crash and the next sign-in,
// where nothing runs to clear anything and the key just stays on disk.
//
// The cost is honest and was weighed: closing the tab now forgets the conversation. Navigation and
// reload — the two cases this feature is actually about — still restore it. The two alternatives
// were worse: redacting the key breaks Apply-after-restore, because Apply re-parses the CLI out of
// the stored message, and leaving it on disk leaves a tunnel credential on disk. Not the server
// either: this is a draft, worth nothing once the session ends.
//
// WHAT CLEARS IT
// Signing out, a 401, and the maintenance force-logout — all three go through AuthContext's
// endSession → clearSessionScoped, which sweeps BOTH storages. Nothing here has to know about any
// of them. Closing the tab now clears it too, for free.
//
// WHAT IS NOT PERSISTED
// Anything in flight or purely visual: the streaming answer, `asking`, the open wizard panel, the
// deploy poller, dry-run results. Restoring a half-streamed answer would show a sentence the model
// never finished; restoring an open wizard would put someone back inside a form whose Apply button
// is wired to a request that is no longer running.

/** The storage name under the session-scoped prefix. */
const KEY = "ai-chat";

/** Bump when the shape below changes. A snapshot from an older shape is dropped, not migrated —
 *  it is a draft conversation, and guessing at a migration risks feeding a malformed draft into a
 *  wizard that writes to a firewall. */
const VERSION = 3;

/**
 * The most recent messages worth keeping.
 *
 * A conversation grows without limit and each assistant turn can carry several parsed drafts, so
 * an afternoon's work would otherwise walk into the 5 MB localStorage ceiling — where the browser
 * throws on write and the LAST thing said is what gets lost. Trimming from the front keeps the
 * newest, which is the half anyone scrolling back actually wants.
 */
const MAX_ITEMS = 40;

/** Hard ceiling on the serialised snapshot, well under the ~5 MB origin quota. */
const MAX_BYTES = 1_500_000;

export type AiSessionState = {
  /** Which firewall the conversation was about. A restore onto a DIFFERENT device is refused. */
  deviceId: number | null;
  items: ChatItem[];
  /** The half-typed question in the composer — losing that on navigation is the small daily
   *  annoyance this feature is really about. */
  input: string;
  /** wizKey strings for wizards already applied. Serialised from the live Set. */
  appliedWizards: string[];
  /** Entries of the live Map<itemIndex, AppliedObject[]> — Maps are not JSON. */
  appliedObjects: [number, AppliedObject[]][];
  /** Entries of the live Map<policyKey, anchorPolicyId | null>. */
  groupAnchors: [string, number | null][];
};

type Stored = AiSessionState & { v: number; savedAt: number };

/** UTF-8 byte length of a string, which is what the quota is actually counted in. */
const byteLength = (s: string): number =>
  typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length * 2;

/**
 * Serialises the snapshot, dropping the oldest messages until it fits.
 *
 * Returns null when even a single message is too large — one pathological answer must not be
 * allowed to wedge the write path and silently stop every later save.
 */
export const serialiseSession = (state: AiSessionState): string | null => {
  // Drop attached-image data URLs before persisting: a few screenshots are easily a megabyte of
  // base64, which would either trip MAX_BYTES or evict the recent text messages that are the whole
  // point of the snapshot. The images are a live preview — they show in the transcript until reload,
  // not forever. Everything else about each message is kept.
  let items = state.items
    .slice(-MAX_ITEMS)
    .map((it) => (it.images ? { ...it, images: undefined } : it));

  for (;;) {
    const payload: Stored = { ...state, items, v: VERSION, savedAt: Date.now() };
    let json: string;
    try {
      json = JSON.stringify(payload);
    } catch {
      return null; // a value that cannot be represented (a cycle, a BigInt) — do not persist
    }
    if (byteLength(json) <= MAX_BYTES) return json;
    if (items.length <= 1) return null;
    items = items.slice(Math.ceil(items.length / 2)); // halve, rather than crawl one at a time
  }
};

/** Writes the snapshot. Silent on failure — a full quota must never break the chat. */
export const saveAiSession = (state: AiSessionState): void => {
  const json = serialiseSession(state);
  if (json === null) {
    // Nothing storable. Remove the stale snapshot rather than leaving an older conversation behind
    // that would be restored in place of this one.
    removeTabScoped(KEY);
    return;
  }
  writeTabScoped(KEY, json);
};

/**
 * Reads the snapshot back, or null.
 *
 * `deviceId` is the firewall currently selected in the navbar. A snapshot taken against a different
 * one is refused: the drafts inside it name interfaces, addresses and profiles that exist on THAT
 * device, and replaying them against another firewall is how you create a policy referencing
 * objects that are not there.
 */
export const loadAiSession = (deviceId: number | null): AiSessionState | null => {
  const raw = readTabScoped(KEY) ?? takeLegacyDiskSnapshot();
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null; // truncated or hand-edited — treat as absent
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const s = parsed as Partial<Stored>;
  if (s.v !== VERSION) return null;
  if (!Array.isArray(s.items)) return null;
  if (deviceId !== null && s.deviceId !== null && s.deviceId !== deviceId) return null;

  return {
    deviceId: typeof s.deviceId === "number" ? s.deviceId : null,
    items: s.items as ChatItem[],
    input: typeof s.input === "string" ? s.input : "",
    appliedWizards: Array.isArray(s.appliedWizards) ? s.appliedWizards.filter((k) => typeof k === "string") : [],
    appliedObjects: Array.isArray(s.appliedObjects) ? s.appliedObjects : [],
    groupAnchors: Array.isArray(s.groupAnchors) ? s.groupAnchors : [],
  };
};

/**
 * Takes the snapshot this console used to write to localStorage, and deletes it from disk.
 *
 * One-shot, for the single reload that follows the move to sessionStorage. Read-and-remove rather
 * than remove-only: the conversation open at that moment is somebody's work and there is no reason
 * to throw it away — but the on-disk copy is the thing being fixed, so it goes immediately, before
 * anything is parsed and whether or not the parse succeeds.
 *
 * It can be deleted once no browser that signed in before this change is still in use. Leaving it
 * costs one failed read per fresh conversation.
 */
const takeLegacyDiskSnapshot = (): string | null => {
  const raw = readSessionScoped(KEY);
  if (raw !== null) removeSessionScoped(KEY);
  return raw;
};

/** Forgets the conversation. Used by the page's own "clear chat" control. */
export const clearAiSession = (): void => {
  removeTabScoped(KEY);
  // The legacy disk copy too: "clear chat" has to mean the transcript is gone, and a user who has
  // not reloaded since the move would otherwise still have one on disk.
  removeSessionScoped(KEY);
};

/** True when the snapshot holds nothing worth restoring — used to skip a pointless write. */
export const isEmptySession = (state: AiSessionState): boolean =>
  state.items.length === 0 && state.input.trim() === "";
