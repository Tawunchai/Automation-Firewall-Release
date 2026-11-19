import { useCallback, useEffect, useRef } from "react";
import { confirm } from "../../components/ui/confirm";
import {
  clearAiSession, isEmptySession, loadAiSession, saveAiSession, type AiSessionState,
} from "./session";
import type { AppliedObject } from "./applyViaREST";
import type { ChatItem } from "./chat-model";

/**
 * Conversation persistence for the AI Assistant: restore on arrival, save as it changes, flush on
 * the way out, and empty it when the session ends.
 *
 * ── Why the page keeps a conversation at all ───────────────────────────────
 *
 * This page is a single component, so leaving it for Firewall Policy and coming back used to throw
 * the whole conversation away — proposals, the objects they had already put on the live firewall,
 * and the Fallback buttons that are the only way to take those back off. It now survives
 * navigation and reload, and is discarded only when the SESSION ends: logout, a 401, or the
 * maintenance force-logout, all of which run AuthContext's endSession → clearSessionScoped.
 *
 * See session.ts for what is and is not kept, and why.
 *
 * ── Why it takes `restore` and `reset` instead of the page's setters ───────
 *
 * The page holds eleven pieces of state this touches. Passing eleven setters would make the hook's
 * signature a second, partial description of the page's state that drifts the first time one is
 * added. Two callbacks say the same thing and stay true: here is a snapshot, put it back; and,
 * empty everything.
 */
export function useAiConversation(opts: {
  deviceId: number | null;
  /** The navbar is still resolving which firewall is selected. */
  loadingDevices: boolean;

  items: ChatItem[];
  input: string;
  /** An answer is still arriving, so there is something to clear even on an empty transcript. */
  asking: boolean;
  appliedWizards: Set<string>;
  appliedObjects: Map<number, AppliedObject[]>;
  groupAnchors: Map<string, number | null>;

  restore: (saved: AiSessionState) => void;
  reset: () => void;
}) {
  const {
    deviceId, loadingDevices, items, input, asking,
    appliedWizards, appliedObjects, groupAnchors, restore, reset,
  } = opts;

  /** Guards both effects: nothing may be SAVED before the restore has had its chance to run, or
   *  the first render's empty state would overwrite the snapshot it is about to load. */
  const hydratedRef = useRef(false);
  /** The most recent snapshot, so the unmount flush below has something to write. */
  const latestSnapshotRef = useRef<AiSessionState | null>(null);
  /** Set when the session ends. The flush must not resurrect a conversation logout just deleted. */
  const sessionEndedRef = useRef(false);

  // The two callbacks the page passes are inline arrows, so they have a new identity every
  // render. Holding them in refs keeps them out of the dependency arrays below — a hydrate effect
  // that re-ran on every render would restore the snapshot over whatever had just been typed.
  //
  // Assigned in an effect rather than during render: a ref written while rendering is the thing
  // react-hooks/refs is pointing at, and this effect is declared FIRST, so it has already run by
  // the time the effects under it fire.
  const restoreRef = useRef(restore);
  const resetRef = useRef(reset);
  useEffect(() => {
    restoreRef.current = restore;
    resetRef.current = reset;
  });

  useEffect(() => {
    // Wait for the device list. Restoring against `deviceId === null` while the navbar is still
    // resolving would skip session.ts's same-device check and hand the drafts to whichever
    // firewall happened to be selected a moment later.
    if (hydratedRef.current || loadingDevices) return;
    hydratedRef.current = true;

    const saved = loadAiSession(deviceId);
    if (!saved) return;
    restoreRef.current(saved);
  }, [loadingDevices, deviceId]);

  useEffect(() => {
    if (!hydratedRef.current) return;

    const state: AiSessionState = {
      deviceId,
      items,
      input,
      appliedWizards: [...appliedWizards],
      appliedObjects: [...appliedObjects],
      groupAnchors: [...groupAnchors],
    };

    // Nothing said and nothing typed: drop the snapshot instead of writing an empty one, so a
    // stale conversation cannot come back after the page has been emptied.
    if (isEmptySession(state) && appliedObjects.size === 0) {
      clearAiSession();
      return;
    }

    // Debounced: `input` changes on every keystroke and the snapshot can be a megabyte.
    latestSnapshotRef.current = state;
    const id = window.setTimeout(() => saveAiSession(state), 400);
    return () => window.clearTimeout(id);
  }, [deviceId, items, input, appliedWizards, appliedObjects, groupAnchors]);

  /**
   * Empty the conversation, in the one place both callers can agree on.
   *
   * Used by the Clear button and by the end of the session. Everything derived from the transcript
   * goes with it — an open wizard, a dry-run panel, a deployment view and a parked background job
   * all describe messages that are no longer on screen, and leaving any of them behind puts a
   * proposal back in front of someone who just cleared it.
   *
   * It does NOT touch `sessionEndedRef`: after a manual clear the page is still live and must go on
   * saving whatever is typed next. Logout sets that flag itself, for the opposite reason.
   */
  const resetConversation = useCallback(() => {
    latestSnapshotRef.current = null;
    clearAiSession();
    resetRef.current();
  }, []);

  /** Anything worth clearing: a transcript, a half-typed question, or an answer still arriving. */
  const hasConversation = items.length > 0 || input.trim() !== "" || asking || appliedObjects.size > 0;

  /**
   * The Clear button.
   *
   * Asks first only when there is something the transcript is the only copy of: the Fallback
   * buttons beside an applied proposal are the one place in the console that can take those exact
   * objects back off the firewall again. Clearing does not undo them — it throws away the offer to
   * — and that is worth a sentence before it happens. An ordinary conversation clears silently,
   * because a confirm on something harmless teaches people to click through confirms.
   */
  const onClearChat = useCallback(async () => {
    const appliedCount = [...appliedObjects.values()].reduce((n, objs) => n + objs.length, 0);
    if (appliedCount > 0) {
      const ok = await confirm({
        title: "Clear this conversation?",
        // Both sentences START with a word, deliberately: the i18n extractor reads a pattern that
        // begins with its hole as a URL path and skips it, which would leave the plural branch in
        // English on a Thai screen with nothing failing.
        content: appliedCount === 1
          ? "Clearing leaves the one object this conversation put on the firewall exactly where it is, and removes the Fallback button that would have taken it back off — you would have to delete it by hand."
          : `Clearing leaves the ${appliedCount} objects this conversation put on the firewall exactly where they are, and removes the Fallback buttons that would have taken them back off — you would have to delete them by hand.`,
        okText: "Clear anyway",
      });
      if (!ok) return;
    }
    resetConversation();
  }, [appliedObjects, resetConversation]);

  // Signing out while this page is open.
  //
  // THE BUG THIS FIXES
  // Logout wipes session-scoped storage (AuthContext → clearSessionScoped) and then re-renders
  // into the login screen, which unmounts this page — and the unmount flush below wrote the whole
  // conversation straight back to the key that had just been deleted. Signing back in restored the
  // previous administrator's chat, including proposals that were already on the live firewall.
  // Clearing storage cannot fix that on its own: at the moment of the wipe the conversation is in
  // React state, not on disk. So the state goes too, and the flush is disarmed.
  useEffect(() => {
    const onSessionEnded = () => {
      // The flag first: resetConversation writes nothing, but the unmount flush below must not
      // resurrect the conversation logout has just deleted.
      sessionEndedRef.current = true;
      resetConversation();
    };
    window.addEventListener("session:ended", onSessionEnded);
    return () => window.removeEventListener("session:ended", onSessionEnded);
  }, [resetConversation]);

  // Flush that snapshot on the way out.
  //
  // The debounce above is cancelled by its own cleanup, so navigating away within 400ms of sending
  // dropped the question from the saved transcript — and with a background job now answering it,
  // that meant coming back to a reply with nothing above it. This writes the last known state once,
  // on genuine unmount only — and never on the unmount that logout causes.
  useEffect(() => () => {
    if (!hydratedRef.current || sessionEndedRef.current) return;
    const last = latestSnapshotRef.current;
    if (last && !(isEmptySession(last) && last.appliedObjects.length === 0)) saveAiSession(last);
  }, []);

  // resetConversation is not returned: the page empties its own state through `reset`, and a
  // second way in would be a second place that has to remember to clear the saved snapshot too.
  return { hasConversation, onClearChat };
}
