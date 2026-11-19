import { baseApi } from "./http";

// Audit / Review, its history, and the fleet rollup.
//
// "What is wrong with this firewall?" — shadowed rules, any/any/any, uninspected internet egress,
// dead policies, orphan objects — plus the standards layer over it, the sign-offs, the trend, and
// the cross-device rollup the Fleet Compliance page reads.
//
// Split out of policyObject.ts, the console's API monolith, which is tracked in
// backend/test/layout-budget.json as needing to come apart. This is the second piece (after
// deviceInfo.ts) and a natural one: none of it is a policy OBJECT, nothing else in that file reads
// it, and it is a third of a page's worth of types in one place. policyObject.ts re-exports every
// name, so no call site moved.

const deviceBase = (deviceId: number) => `/policy/device/${deviceId}`;

// ─── Audit / Review ───────────────────────────────────────────────────────────
// "What is wrong with this firewall?" — shadowed rules, any/any/any, uninspected internet egress,
// dead policies, orphan objects. Every check is computed on the backend; the scan uses no AI and
// writes nothing. Each finding carries the CLI that would fix it, as text.

export type AuditSeverity = "high" | "medium" | "low";

/** How much weight a finding carries for a control. */
export type ControlStrength = "direct" | "supporting";

/** One standards control a finding speaks to. Written by this console, never by the device. */
/**
 * Who wrote the words next to the control id. "official" is the publisher's own control name and
 * may be quoted; "paraphrase" is our summary and must be shown as ours — rendering the two alike
 * is what makes a reader think our sentence came from PCI DSS.
 */
export type TitleSource = "official" | "paraphrase";

export type ControlRef = {
  framework_id: string; // pci-dss · iso-27001 · nist-800-53 · nist-csf
  framework: string;
  version: string;
  id: string;
  title: string;
  title_source: TitleSource;
  strength: ControlStrength;
};

/**
 * Six statuses, not two. Every pair of them that got merged along the way turned out to be the
 * place where the view started overstating what it knew:
 *
 *   evidenced vs indeterminate - "we looked and found nothing" is not "we could not look"
 *   evidenced vs not-assessed  - "we looked and found nothing" is not "we never looked"
 *   evidenced vs accepted      - "it is clean" is not "somebody signed for it"
 *   gap       vs observation   - "traffic can pass that should not" is not "the table is untidy"
 */
export type ControlStatus =
  | "gap"
  | "observation"
  | "indeterminate"
  | "accepted"
  | "evidenced"
  | "not-assessed";

export type ControlCoverage = {
  id: string;
  title: string;
  title_source: TitleSource;
  status: ControlStatus;
  /** Absent on a not-assessed control: nothing maps to it, so no mapping has a strength. */
  strength?: ControlStrength;
  /** The audit checks behind this verdict — the "how do you know" answer. */
  checks: string[];
  findings: number;
  /**
   * Why nothing here assesses the control. Set exactly when status is "not-assessed", and phrased
   * as something the reader can act on — a row that says only "not assessed" looks like a verdict
   * and tells nobody anything.
   */
  not_assessed?: string;
};

export type FrameworkCoverage = {
  id: string;
  name: string;
  version: string;
  publisher: string;
  /** What this tool can and cannot say about the framework. Always shown. */
  note: string;
  /** "draft" until a qualified assessor signs the mapping off. */
  catalogue_status: string;
  controls: ControlCoverage[];
  gaps: number;
  evidenced: number;
  indeterminate: number;
  accepted: number;
  observations: number;
  /**
   * How many of `controls` this console does not evaluate at all. This is the denominator that was
   * missing: "6 evidenced" means nothing until a reader can see it sits beside eighteen rows
   * nobody looked at.
   */
  not_assessed: number;
  /** controls.length - not_assessed, carried so the UI and the PDF cannot compute it two ways. */
  assessed: number;
};

export type AuditFinding = {
  // The rule base:  policy-any-any · policy-no-inspection · policy-no-antivirus ·
  //                 policy-insecure-service · policy-shadowed
  // The management plane: mgmt-cleartext-access · admin-unrestricted · admin-timeout-long ·
  //                 admin-lockout-weak · intf-no-antispoof · firmware-outdated
  // The record:     policy-no-logging · policy-deny-no-logging · log-implicit-deny-off ·
  //                 log-no-remote · time-not-synced
  // This console's own records: review-overdue · config-no-baseline · config-baseline-stale ·
  //                 change-unrecorded
  // Hygiene:        policy-no-traffic · policy-disabled · object-unused
  check: string;
  severity: AuditSeverity;
  category: string; // Policy · Inspection · Logging · Management · Governance · Objects
  title: string;
  detail: string;
  subject: string;
  policy_id?: number;
  /** address · service · schedule · interface · administrator · <profile category> */
  object_kind?: string;
  object_name?: string;
  /** Fix CLI — shown to the user, never run automatically. */
  fix?: string[];
  controls?: ControlRef[];
  /** Set when this finding has a signed, unexpired acceptance. It is still reported. */
  accepted?: {
    reason: string;
    approved_by: string;
    approved_at: string;
    expires_at: string;
  };
};

export type AuditReport = {
  scanned_at: string;
  stats: {
    policies: number; policies_disabled: number;
    addresses: number; services: number; schedules: number; profiles: number;
  };
  counts: Partial<Record<AuditSeverity, number>>;
  findings: AuditFinding[];
  notes?: string[];
  /** Checks the scan could not fully evaluate on this device. */
  undecided_checks?: string[];
  accepted_count?: number;
  standards?: FrameworkCoverage[];
  methodology?: Methodology;
  check_rationales?: CheckRationale[];
  /**
   * Identifies the CONFIGURATION this report describes. Stored with the run so the next scan can
   * tell "nothing was written" from "something was written and this console did not do it".
   * Not a content hash — see fgAPIResponse.Revision on the backend.
   */
  config_fingerprint?: string;
};

// The corroboration types used to live here — our checks set against the firewall's own Security
// Rating, check by check. They went with the Device Rating tab when the Audit page was narrowed to
// ISO/IEC 27001: every one of them carried Fortinet's own FSBP and PCI control ids, and there is no
// longer a screen those ids belong on. The /audit response no longer sends them, so nothing here
// can render a stale copy.

/** One term and what this console means by it. */
export type Definition = { term: string; meaning: string };

/**
 * What high/medium/low, direct/supporting and gap/evidenced/indeterminate actually mean here.
 * Comes from the backend rather than being written in the UI, so the definition on screen and the
 * one in the evidence PDF can never drift apart.
 */
/** A publication a reader can open. ISO/IEC's text is licensed, so it is cited and never quoted. */
export type ReferenceDoc = {
  id: string;
  title: string;
  publisher: string;
  url: string;
  public_domain: boolean;
};

/**
 * Why a class of finding matters. The summary is ours and is labelled as ours; the sources are
 * publications, cited and never quoted. This replaced a hard-coded blurb in the UI that read as
 * authoritative and rested on nothing.
 */
export type CheckRationale = {
  check: string;
  summary: string;
  basis: ControlRef[];
  sources: ReferenceDoc[];
};

export type Methodology = {
  catalogue_status: string;
  /**
   * Which revision of the mapping produced the report. "reviewed" on its own says nothing about
   * WHICH mapping was reviewed — a catalogue revision inheriting the previous one's sign-off is
   * exactly the overstatement this page exists to prevent.
   */
  catalogue_version?: string;
  severity_basis: Definition[];
  strength_basis: Definition[];
  status_basis: Definition[];
  note: string;
};

export const DeviceAudit = async (deviceId: number): Promise<AuditReport> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/audit`);
  return res.data;
};

// The FortiGate Security Rating types and DeviceSecurityRating() used to sit here — the device's
// own posture report, relayed unchanged with the FSBP and PCI ids Fortinet attaches to each of its
// own checks. The Audit page's Device Rating tab was their only reader, and it was removed when the
// page was narrowed to ISO/IEC 27001. The backend route went with them.

// ─── Audit governance: the trend, and what somebody signed off on ─────────────

export type AuditTrendPoint = {
  scanned_at: string;
  high: number; medium: number; low: number; total: number;
  gaps: number; indeterminate: number; evidenced: number;
  observations: number; not_assessed: number; in_scope: number;
  /**
   * Which revision of OUR mapping produced this point. A chart that crosses a catalogue revision
   * without saying so shows our own edits as the firewall regressing.
   */
  catalogue_version?: string;
  frameworks?: {
    id: string; name: string; version: string;
    gaps: number; indeterminate: number; evidenced: number;
    observations: number; not_assessed: number; in_scope: number;
  }[];
  user_email?: string;
  device_serial?: string;
};

export const DeviceAuditHistory = async (deviceId: number, limit = 120): Promise<AuditTrendPoint[]> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/audit/history`, { params: { limit } });
  return res.data?.points ?? [];
};

// ─── Security Posture Score ────────────────────────────────────────────────────
// One headline grade distilled from the same stored scans AuditTrendHistory already reads — no new
// scan, no new opinion about what counts as a gap. See services.ComputePostureScore (backend).

export type PostureScore = {
  score: number; // 0-100
  grade: string; // "A+".."F"
  coverage_score: number;
  severity_score: number;
  assessed: number;
  total_controls: number;
};

export type PostureScorePoint = { scanned_at: string; score: number; grade: string };

export type PostureScoreReport = {
  assessed_at: string | null;
  current: PostureScore | null;
  trend: PostureScorePoint[];
  note?: string;
};

/**
 * A finding somebody decided to live with. It is never hidden — the report still shows it, carrying
 * who accepted it and when the acceptance runs out.
 */
export type AuditException = {
  id: number;
  network_device_id: number;
  check: string;
  subject: string;
  reason: string;
  approved_by: string;
  approved_at: string;
  expires_at: string;
  revoked_at?: string | null;
  revoked_by?: string;
  created_by: string;
  created_at: string;
};

export const DeviceListAuditExceptions = async (
  deviceId: number,
): Promise<{ exceptions: AuditException[]; max_days: number }> => {
  const res = await baseApi.get(`${deviceBase(deviceId)}/audit/exceptions`);
  return { exceptions: res.data?.exceptions ?? [], max_days: res.data?.max_days ?? 180 };
};

export const DeviceAcceptFinding = async (
  deviceId: number,
  body: { check: string; subject: string; reason: string; days: number },
): Promise<AuditException> => {
  const res = await baseApi.post(`${deviceBase(deviceId)}/audit/exceptions`, body);
  return res.data;
};

export const DeviceRevokeAuditException = async (deviceId: number, id: number): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/audit/exceptions/${id}`);
};



// Bundled schedule + security-profile options for the firewall policy form
