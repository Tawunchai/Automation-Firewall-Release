// dryRun — "what would Apply actually do?", answered without touching the device.
//
// WHY THIS EXISTS
// Apply writes straight to a live firewall. Until now the only preview was the CLI block itself,
// which says what the AI *proposed* — not what this app would *do* with it. Those differ in ways
// that matter:
//
//   · An object whose name is already on the device is SKIPPED. The chat says "already exists on the
//     device", which reads like agreement — but the device's copy can say something completely
//     different from the CLI on screen, and Apply will not reconcile it. That silent gap is the
//     single most misleading thing about the current button.
//   · A user group that already exists is UPDATED, not created. Its member list is written. That is
//     a write to an object the user never asked us to create.
//   · Some suggestions do not take the REST path at all (a delete/unset, or a section with no
//     endpoint) and go down the SSH pipeline instead, where the object-by-object view does not apply.
//
// Dry-run runs the SAME planner Apply runs (planApply) and stops before executing it, so what it
// shows cannot drift from what Apply does — there is no second implementation to keep in step.

import { canApplyViaREST, hasDestructiveStatement, planApply, type PlanAction, type PlanStep } from "./applyViaREST";
import { normalizeCLI, topLevelConfigBlocks } from "./parsePrereqCLI";

// ─── Value rendering ─────────────────────────────────────────────────────────

export const EMPTY_MARK = "—";
export const SECRET_MARK = "••••••";

// Write-only fields. The device answers with "" or "ENC …" rather than the stored value, so
// comparing one against a payload would report a change on every single run. They are shown when an
// object is being CREATED (masked, just to say "a password is being set") and left out of every
// comparison.
const SECRET_FIELD = /(passwd|password|secret|psksecret|shared_key|auth_pwd)/i;

export const isSecretField = (field: string): boolean => SECRET_FIELD.test(field);

// Fields that describe the device's own bookkeeping rather than the object's configuration. They
// only ever appear on the device side, but a payload builder that happens to echo one back should
// not produce a "change" row either.
const NOISE_FIELD = /^(id|seq_num|ref|ref_count|q_ref|builtin|details|created_at|updated_at)$/;

const isEmptyValue = (v: unknown): boolean =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

// "Nothing was asked for here": the value a payload builder emits when a field is left alone.
const isDefaultValue = (v: unknown): boolean => isEmptyValue(v) || v === 0 || v === false;

const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// ⚠️ FortiOS writes a network TWO ways and this app uses both.
// The create payload carries FortiOS's own "10.0.1.0 255.255.255.0"; the device's list endpoint
// hands back "10.0.1.0/24". They are the same network. Comparing them as strings marked every
// unchanged address as "differs from the device" — a warning on every single run, which is exactly
// how a diff becomes noise nobody reads. Both forms are normalised to CIDR before anything looks
// at them, for the comparison AND for what the table shows.
export function canonicalNetwork(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const parts = v.trim().split(/\s+/);
  if (parts.length !== 2) return v;
  const [addr, mask] = parts;
  if (!DOTTED_QUAD.test(addr) || !DOTTED_QUAD.test(mask)) return v;

  const octets = mask.split(".").map(Number);
  if (octets.some((o) => o > 255)) return v;
  const bits = (octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3];
  // A non-contiguous mask is not expressible as a prefix length; leave such a value alone rather
  // than inventing one.
  const inverted = ~bits >>> 0;
  if (((inverted + 1) & inverted) !== 0) return v;

  let len = 0;
  for (let i = 31; i >= 0 && (bits >>> i) & 1; i--) len++;
  return `${addr}/${len}`;
}

/** Renders a payload value the way the diff table shows it. */
export function renderValue(v: unknown): string {
  if (isEmptyValue(v)) return EMPTY_MARK;
  if (typeof v === "boolean") return v ? "enable" : "disable";
  if (Array.isArray(v)) return v.map((x) => String(canonicalNetwork(x))).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(canonicalNetwork(v));
}

// Two values are "the same" when the device would store them the same way.
//   · A list is a SET on FortiOS — `set member alice bob` and `set member bob alice` are one config,
//     so ordering must not read as a change.
//   · A missing field and an empty one are the same absence.
//   · 8 and "8" come back differently depending on which endpoint answered; compare them loosely.
//   · A network written as "10.0.1.0 255.255.255.0" and as "10.0.1.0/24" is one network.
function sameValue(a: unknown, b: unknown): boolean {
  if (isEmptyValue(a) && isEmptyValue(b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    const norm = (v: unknown) => (Array.isArray(v) ? v : [v]).map((x) => String(canonicalNetwork(x))).sort();
    const la = norm(a), lb = norm(b);
    return la.length === lb.length && la.every((x, i) => x === lb[i]);
  }
  if (typeof a === "boolean" || typeof b === "boolean") return Boolean(a) === Boolean(b);
  return String(canonicalNetwork(a)) === String(canonicalNetwork(b));
}

// ─── The diff ────────────────────────────────────────────────────────────────

export type FieldChange = {
  field: string;
  before: string;
  after: string;
  /**
   * Set on a list field. `removed` is what the write takes AWAY — the whole reason this feature
   * exists, because FortiOS `set member …` replaces the list rather than appending to it, and a
   * name missing from the new line is a name silently dropped from the group.
   */
  added?: string[];
  removed?: string[];
  /** A write-only field: shown as "being set", never compared. */
  secret?: boolean;
};

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(String) : isEmptyValue(v) ? [] : [String(v)];

/**
 * diffFields compares what Apply would SEND against what the device holds NOW.
 *
 * It walks the payload's keys only: a device object carries extra bookkeeping the payload never
 * sets, and reporting those as "removed" would be false — Apply is not clearing them.
 *
 * `existing` of null means the object does not exist yet, so every meaningful field is an addition.
 */
export function diffFields(
  payload: Record<string, unknown> | undefined,
  existing: Record<string, unknown> | null | undefined,
): FieldChange[] {
  if (!payload) return [];
  const creating = existing == null;
  const out: FieldChange[] = [];

  for (const [field, after] of Object.entries(payload)) {
    if (NOISE_FIELD.test(field)) continue;

    if (isSecretField(field)) {
      // Only worth a row when something is actually being written.
      if (!isEmptyValue(after)) {
        out.push({ field, before: creating ? EMPTY_MARK : SECRET_MARK, after: SECRET_MARK, secret: true });
      }
      continue;
    }

    if (creating) {
      // A create shows what it sets. Booleans are always listed — "nat: disable" on a new outbound
      // policy is exactly the sort of thing a reviewer needs to catch before it is on the device.
      if (isEmptyValue(after) || after === 0) continue;
      out.push({ field, before: EMPTY_MARK, after: renderValue(after) });
      continue;
    }

    // The device did not report this field at all, and the payload only sets it to its default
    // (0 / false / empty). There is no evidence of a change here — claiming one would light up
    // "color: — → 0" on every untouched address, which is how a diff trains people to ignore it.
    if (!(field in existing) && isDefaultValue(after)) continue;

    const before = existing[field];
    if (sameValue(before, after)) continue;

    const change: FieldChange = { field, before: renderValue(before), after: renderValue(after) };
    if (Array.isArray(before) || Array.isArray(after)) {
      const b = asList(before), a = asList(after);
      change.removed = b.filter((x) => !a.includes(x));
      change.added = a.filter((x) => !b.includes(x));
    }
    out.push(change);
  }
  return out;
}

// ─── The report ──────────────────────────────────────────────────────────────

export type DryRunEntry = {
  kind: PlanStep["kind"];
  label: string;
  name: string;
  action: PlanAction;
  changes: FieldChange[];
  /**
   * A skipped object whose copy on the device does NOT match what was just proposed. Apply will
   * leave the device exactly as it is; the CLI on screen is not what is enforced.
   */
  diverges: boolean;
};

export type DryRunReport =
  | {
      transport: "rest";
      entries: DryRunEntry[];
      counts: { create: number; update: number; skip: number; diverging: number };
    }
  | {
      // Nothing here is previewable object by object: the config-deploy pipeline sends the CLI to
      // the device over SSH and reports its own before/after diff once it has run.
      transport: "ssh";
      reason: string;
    };

export function stepToEntry(step: PlanStep): DryRunEntry {
  const changes = step.action === "create"
    ? diffFields(step.payload, null)
    : diffFields(step.payload, step.existing);
  return {
    kind: step.kind, label: step.label, name: step.name, action: step.action,
    changes,
    diverges: step.action === "skip" && changes.length > 0,
  };
}

/** Why a suggestion cannot be previewed object by object — shown verbatim to the user. */
export function sshFallbackReason(cli: string): string {
  if (hasDestructiveStatement(cli)) {
    return "This config contains delete / unset / purge, so Apply sends it over the SSH pipeline " +
      "(which shows a whole-device diff when it finishes). A dry run cannot preview it object by object.";
  }
  const headers = topLevelConfigBlocks(normalizeCLI(cli).split("\n")).map((b) => b.header);
  if (headers.length === 0) return "No config block was found in this output";
  return `This config contains a section with no REST endpoint (${headers.join(", ")}), ` +
    "so Apply sends it over the SSH pipeline instead and a dry run cannot preview it object by object.";
}

/**
 * dryRun answers "press Apply — then what?" for one chat suggestion.
 *
 * It reads the device (the same reads Apply performs, plus the current copy of anything Apply would
 * skip) and writes nothing.
 */
export async function dryRun(deviceId: number, cli: string): Promise<DryRunReport> {
  if (!canApplyViaREST(cli)) {
    return { transport: "ssh", reason: sshFallbackReason(cli) };
  }
  const entries = (await planApply(deviceId, cli, { detailed: true })).map(stepToEntry);
  return {
    transport: "rest",
    entries,
    counts: {
      create: entries.filter((e) => e.action === "create").length,
      update: entries.filter((e) => e.action === "update").length,
      skip: entries.filter((e) => e.action === "skip").length,
      diverging: entries.filter((e) => e.diverges).length,
    },
  };
}
