import { aiApi, baseApi } from "./http";
import type { AuditSeverity, ControlStatus, ReferenceDoc } from "./policyObject";

// Audit / Review: the two things the page could not do before — say what a control asks for, and
// say how to close it.
//
// SEPARATE MODULE, ON PURPOSE. policyObject.ts is the console's device-proxy API surface and is
// over its size budget (backend/test/layout-budget.json); the guard's instruction when that file
// grows is to put the new code somewhere it can be found. This is a self-contained feature with
// its own three endpoints, so it gets its own file rather than another 140 lines in a file nobody
// reads end to end.

/** Same shape as policyObject's, which does not export it. One line is cheaper than widening that
 *  module's public surface for a path prefix. */
const deviceBase = (deviceId: number) => `/policy/device/${deviceId}`;

// ─── Reference: what a control asks for, in words we are allowed to print ────
//
// ISO/IEC 27001's text is copyright ISO/IEC and appears nowhere in this product. NIST SP 800-53
// Rev. 5 is a United States Government publication, is not subject to copyright, and covers the
// same subject matter — so the page shows the SP 800-53 control that states the same requirement,
// quoted exactly, beside a link to ISO for the authoritative wording.
//
// The split matters and the UI renders it: the CORRESPONDENCE is this console's interpretation,
// the TEXT is NIST's. See services/audit_reference.go.

/** One SP 800-53 control, verbatim. Both text fields are NIST's words. */
export type NISTControl = {
  id: string;
  title: string;
  /** The control itself. */
  statement: string;
  /** NIST's discussion of it — usually the part that answers "what does that mean for a firewall". */
  guidance: string;
};

export type ControlReference = {
  framework_id: string;
  control_id: string;
  controls: NISTControl[];
  /** OURS: why these controls correspond. Not what the ISO control says. */
  why: string;
  /** The correspondence covers part of the Annex A control, not all of it. Stated, not smoothed. */
  partial?: boolean;
};

export type ReferenceCatalogue = {
  source: { doc: ReferenceDoc; version: string; note: string };
  /** Where the reader goes for the words this console may not print. */
  authoritative: ReferenceDoc;
  /** Annex A control id → its reading material. Controls with no honest correspondence are absent. */
  references: Record<string, ControlReference>;
};

/** Static: no device, no scan. Cached by the caller for the life of the page. */
export const AuditReference = async (): Promise<ReferenceCatalogue> => {
  const res = await baseApi.get("/policy/audit/reference");
  return res.data;
};

// ─── Remediation: how to close a control, and what closing it changes ────────
//
// The steps are computed by the audit engine — no model decides what is wrong or what fixes it.
// The projection is this scan's own findings with the resolved ones removed, re-read through the
// same control logic, so it answers "what would the next scan say" rather than making a promise
// about the firewall. Nothing is executed: every command is for the operator to review and run.

export type RemediationStep = {
  check: string;
  title: string;
  severity: AuditSeverity;
  category: string;
  /** This console's own one-line summary of the class. Labelled as ours wherever it renders. */
  why: string;
  findings: number;
  subjects: string[];
  /** Deduplicated fix CLI. Absent when the engine has no automatic fix. */
  cli?: string[];
  /** Set exactly when there is no CLI: what a person has to do instead. */
  manual?: string;
  /** How many of `findings` already carry a signed acceptance. Listed, never hidden. */
  accepted: number;
  /** Tidying rather than protecting. Fixing it moves an observation, never a gap. */
  advisory: boolean;

  // ── Why you should believe the command ──
  //
  // A standard says WHAT is required and will never publish vendor commands; the authority for a
  // FortiOS command is Fortinet. So the CLI carries two answers to "says who", and they answer
  // different halves: the DEVICE confirms the attribute exists on its own firmware and accepts the
  // value, and the MANUFACTURER's page documents the same command. Neither says the change is a
  // good idea — that is what the control mapping and the projection are for.
  verification?: FixVerification[];
  /** The worst of `verification`, so a badge cannot read "verified" because 3 of 4 attributes were. */
  verdict?: FixVerifyStatus;
  docs?: VendorDoc[];
};

/**
 * What the device said about one attribute of a fix.
 *
 *   verified          the firmware confirms the attribute AND accepts the value
 *   attribute-only    the attribute exists; its value is a string/number/name the schema does not
 *                     enumerate, so only the attribute could be checked
 *   path-only         a delete or a move — no attribute to check, the table exists
 *   attribute-unknown this firmware publishes no such attribute. The command would not work
 *   value-unlisted    the attribute is an option type and this value is not one of its options
 *   unreadable        the schema could not be read. Not a pass and not a failure
 */
export type FixVerifyStatus =
  | "verified" | "attribute-only" | "path-only"
  | "attribute-unknown" | "value-unlisted" | "unreadable";

export type FixVerification = {
  path: string;
  attr?: string;
  value?: string;
  status: FixVerifyStatus;
  detail: string;
  /** What the device DOES accept, when the value was not among them. */
  options?: string[];
};

/** The manufacturer's page for one CMDB table. Linked, never quoted — Fortinet's copyright. */
export type VendorDoc = {
  path: string;
  command: string;
  title: string;
  publisher: string;
  /** The FortiOS release the page describes. A CLI reference is per firmware. */
  release: string;
  url: string;
};

/** Which device and firmware answered the command checks. */
export type SchemaSource = {
  device: string;
  serial?: string;
  firmware?: string;
  method: string;
};

export type ControlProjection = {
  id: string;
  title: string;
  before: ControlStatus;
  after: ControlStatus;
  findings: number;
  resolved: number;
  changed: boolean;
  /** The control the plan was asked about, as opposed to the ones that move with it. */
  target?: boolean;
};

export type FrameworkTally = {
  gaps: number;
  indeterminate: number;
  observations: number;
  evidenced: number;
  not_assessed: number;
};

export type RemediationPlan = {
  framework_id: string;
  framework: string;
  control_id: string;
  control_title: string;
  status: ControlStatus;
  steps: RemediationStep[];
  /** Every control in the framework — the ones that move with this fix, not just the target. */
  projection: ControlProjection[];
  before: FrameworkTally;
  after: FrameworkTally;
  resolves: number;
  /** Whether the target control ends up evidenced. */
  closes: boolean;
  /** Why it does not, when it does not. Always set when closes is false. */
  blocked?: string;
  note: string;
  /** Provenance for the command checks. A verdict with no source is an unsourced claim. */
  schema_source?: SchemaSource;
  /** What "verified" does and does not mean. Travels with the badge. */
  evidence_note?: string;
};

/** The model's execution advice. Prose for a human; none of it is CLI and none of it is run. */
export type RemediationAdvice = {
  order: { check: string; reason: string }[];
  risk: string;
  rollback: string;
  verify: string;
  window: string;
  /**
   * What the model was told as fact — filled in by the server, not by the model. The prompt carries
   * the evidence layer with it, so the advice is reasoning over what this firewall's own schema
   * said rather than over a recollection of FortiOS. Shown on the page so "the AI said so" can be
   * read as "the AI said so, having been given these verified facts".
   */
  grounding?: string[];
  /** Steps whose command the device did NOT confirm. The model is told to flag them; so is the page. */
  unverified?: string[];
  /** What is concretely better once this is done — the only field that is not a warning. */
  benefit?: string;
  /**
   * Suggested values for the questions the apply cannot answer for itself, drawn from this
   * device's own interfaces and address objects. They are OPTIONS on a form: picking one is what
   * writes it, never the suggestion itself.
   */
  answers?: {
    question_id: string;
    prompt: string;
    options?: { value: string; label: string; note?: string }[];
  }[];
};

/**
 * POST, not GET: it re-reads the firewall server-side rather than trusting findings from the
 * browser. A projection computed from a body the caller supplied is a projection the caller can
 * dictate, and this page exists to be shown to an assessor.
 */
export const DeviceAuditRemediation = async (
  deviceId: number, controlId: string,
): Promise<RemediationPlan> => {
  const res = await baseApi.post(`${deviceBase(deviceId)}/audit/remediation`, { control_id: controlId });
  return res.data;
};

/**
 * The same plan plus the model's sequencing and risk advice. Separate call, so the page can render
 * what it computed without waiting on a model — and so a deployment with no API key still works.
 *
 * aiApi, NOT baseApi. This measures 15-20s against the lab firewall — a device scan, the schema
 * reads behind the verified badges, and then a model call — and baseApi times out at exactly 15s.
 * On the first cut this endpoint sat on baseApi and failed in the browser with "The AI could not be
 * reached" while the same request answered 200 in 15s to curl. A long call on the short client is
 * indistinguishable from an outage, which is the worst way for it to fail.
 */
export const DeviceAuditRemediationAdvice = async (
  deviceId: number, controlId: string,
): Promise<{
  plan: RemediationPlan;
  advice: RemediationAdvice;
  /**
   * True when the answer was reused rather than generated. The server keys it on the device, the
   * control and the CONFIGURATION FINGERPRINT — so a hit means the firewall has not changed since
   * the advice was formed, and a change invalidates it rather than a timer. Declared, never hidden.
   */
  cached?: boolean;
  cached_at?: string;
}> => {
  const res = await aiApi.post(`${deviceBase(deviceId)}/audit/remediation/ai`, { control_id: controlId });
  return res.data;
};


// ─── Applying it, and taking it back ─────────────────────────────────────────
//
// The only part of this feature that WRITES to a firewall. Three calls, and the split is the
// safety property: preview says what would be sent, apply sends it after snapshotting every object
// into the change ledger, undo replays those snapshots newest first.
//
// The server recomputes the plan from a fresh scan on every one of them. A caller cannot post a
// list of attributes and have them written — what was confirmed and what reaches the device are
// the same computation.

/** One value this console will not invent. Nothing is written until it is answered. */
export type ApplyQuestion = {
  id: string;
  check: string;
  path: string;
  mkey?: string;
  attr: string;
  /** The token in the CLI this answer replaces, e.g. "<management-subnet> <mask>". */
  placeholder: string;
  prompt: string;
  options?: { value: string; label: string; note?: string }[];
  from_device?: boolean;
};

/** One CMDB object and the attributes that would be written to it. */
export type ApplyWrite = {
  check: string;
  path: string;
  mkey?: string;
  attrs: Record<string, string>;
  unanswered?: string[];
  verified?: FixVerifyStatus;
};

export type ApplyPlan = {
  control_id: string;
  writes: ApplyWrite[];
  questions: ApplyQuestion[];
  /** Steps that cannot be applied from here, with the reason. Stated, never silently dropped. */
  skipped?: { check: string; reason: string }[];
  ready: boolean;
};

export type ApplyResult = {
  check: string;
  path: string;
  mkey?: string;
  attrs: Record<string, string>;
  ok: boolean;
  error?: string;
  /** The change ledger row — the handle undo uses. */
  change_id?: number;
};

export const DeviceAuditRemediationPreview = async (
  deviceId: number, controlId: string, answers: Record<string, string>,
): Promise<{ preview: ApplyPlan; plan: RemediationPlan }> => {
  const res = await aiApi.post(`${deviceBase(deviceId)}/audit/remediation/preview`,
    { control_id: controlId, answers });
  return res.data;
};

/** Writes to the firewall. Every object is snapshotted first, so every write can be undone. */
export const DeviceAuditRemediationApply = async (
  deviceId: number, controlId: string,
  answers: Record<string, string>, acknowledgeUnverified: boolean,
): Promise<{ results: ApplyResult[]; applied: number; error?: string }> => {
  const res = await aiApi.post(`${deviceBase(deviceId)}/audit/remediation/apply`,
    { control_id: controlId, answers, acknowledge_unverified: acknowledgeUnverified });
  return res.data;
};

/** Puts back what an apply wrote, newest first. */
export const DeviceAuditRemediationUndo = async (
  deviceId: number, changeIds: number[],
): Promise<{ results: { change_id: number; ok: boolean; error?: string }[] }> => {
  const res = await aiApi.post(`${deviceBase(deviceId)}/audit/remediation/undo`,
    { change_ids: changeIds });
  return res.data;
};
