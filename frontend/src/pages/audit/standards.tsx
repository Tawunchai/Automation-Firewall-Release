import React, { useEffect, useMemo, useState } from "react";
import {
  FiAlertOctagon, FiBookOpen, FiCheckCircle, FiChevronDown, FiChevronRight, FiHelpCircle,
  FiMinusCircle, FiEye, FiSearch, FiTool, FiUserCheck,
} from "react-icons/fi";
import type {
  AuditReport, ControlCoverage, ControlStatus, Definition, FrameworkCoverage, Methodology,
} from "../../api/policyObject";
import { AuditReference, type ControlReference, type ReferenceCatalogue } from "../../api/auditRemediation";
import type { AuditFinding, AuditSeverity } from "../../api/policyObject";
import RemediatePanel from "./remediate";
import PanelBoundary from "../../components/ui/PanelBoundary";
import { formatDateTime } from "../../lib/datetime";

// Audit / Review ▸ ISO/IEC 27001
//
// The same scan, read from the standard's side: control by control, what this console can and
// cannot evidence. The findings tab answers "what is wrong"; this one answers "says who", which is
// the question that comes up once a customer is preparing for an audit rather than fixing a rule.
//
// ONE STANDARD. This tab used to carry four framework cards — PCI DSS, ISO/IEC 27001, NIST SP
// 800-53, NIST CSF — and, underneath them, a corroboration panel setting our checks against the
// firewall's own Security Rating. All of that was removed on request: this deployment is assessed
// against ISO/IEC 27001 and nothing else, and a page showing four numbering systems invites the one
// mistake it warned about, which is reading a requirement number from one against a control from
// another. The rendering below still walks a LIST of frameworks (report.standards) rather than a
// single object, so nothing here has to change if a second one is ever put back.
//
// Two rules govern everything on this page, and both exist because a compliance view that
// overstates itself is worse than no compliance view at all:
//
//   1. The word "compliant" never appears. A control is evidenced, has a gap, or could not be
//      determined. Only an assessor decides compliance.
//   2. "Could not determine" is shown as loudly as a gap. A check that failed to run must never
//      be quietly counted as a pass — see undecided_checks on the report.
//   3. Every control the backend can talk about is listed, INCLUDING the ones nothing here
//      assesses, each with the reason. This is the denominator: "9 evidenced" says nothing on its
//      own, and a control missing from the table is indistinguishable from a control that passed.
//      The scope line under each framework name is not decoration — it is the honest arithmetic.

const STATUS: Record<ControlStatus, { label: string; hint: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  gap: {
    label: "Gap found",
    hint: "This scan found something that contradicts the control",
    color: "var(--flow-deny)", bg: "var(--flow-deny-bg)",
    border: "color-mix(in srgb, var(--flow-deny) 28%, transparent)", icon: <FiAlertOctagon size={12} />,
  },
  indeterminate: {
    label: "Could not determine",
    hint: "A check behind this control could not be evaluated on this device",
    color: "var(--flow-warn)", bg: "var(--flow-warn-bg)",
    border: "color-mix(in srgb, var(--flow-warn) 28%, transparent)", icon: <FiHelpCircle size={12} />,
  },
  // Clutter, not exposure. Before this status existed, five orphaned address objects marked
  // PCI 1.2.5 as failed — a reading no assessor would accept, and one that made the whole
  // scorecard a function of housekeeping rather than of risk.
  observation: {
    label: "Observation",
    hint: "The only findings against this control are advisory — a disabled rule, a rule that has never matched, an object nothing references. Worth tidying; not a control failure",
    color: "var(--flow-info)", bg: "var(--flow-info-bg)",
    border: "color-mix(in srgb, var(--flow-info) 28%, transparent)", icon: <FiEye size={12} />,
  },
  // Kept apart from "evidenced" on purpose. One means the firewall is clean; the other means
  // somebody decided to live with the finding. A reader must never mistake the second for the first.
  // No shared --flow- token fits "accepted" — it is neither allow, warn, deny nor info — so this
  // stays its own literal, same as "not-assessed" below.
  accepted: {
    label: "Risk accepted",
    hint: "The only findings against this control carry a signed, unexpired acceptance — the risk was decided on, not removed",
    color: "#7c3aed", bg: "#8b5cf612", border: "#8b5cf645", icon: <FiUserCheck size={12} />,
  },
  evidenced: {
    label: "Evidenced",
    hint: "Every check behind this control ran and found nothing against it",
    color: "var(--flow-allow)", bg: "var(--flow-allow-bg)",
    border: "color-mix(in srgb, var(--flow-allow) 28%, transparent)", icon: <FiCheckCircle size={12} />,
  },
  // Deliberately grey and deliberately present. It is not a failure and not a pass — it is the
  // row that stops the other five from being read as coverage of the whole framework.
  "not-assessed": {
    label: "Not assessed here",
    hint: "Nothing in this console evaluates this control. The row says what would have to be read for it to be answerable",
    color: "#64748b", bg: "#94a3b814", border: "#94a3b840", icon: <FiMinusCircle size={12} />,
  },
};

// Worst first — a framework card opens on what needs work, not on a wall of green. Not-assessed
// sits last: it is the least actionable row and the longest, so leading with it would bury the
// findings, but it must still be on the same list rather than hidden behind a toggle.
const STATUS_ORDER: ControlStatus[] = [
  "gap", "indeterminate", "observation", "accepted", "evidenced", "not-assessed",
];

/**
 * What the control asks for — quoted, not summarised.
 *
 * ISO/IEC 27001's text is copyright ISO/IEC and is nowhere in this product. NIST SP 800-53 Rev. 5
 * is a United States Government publication, is not subject to copyright, and covers the same
 * subject matter, so this is the SP 800-53 control that states the same requirement, verbatim.
 *
 * The two halves are labelled separately and deliberately: WHICH SP 800-53 control corresponds is
 * this console's reading, and it says so; the words themselves are NIST's, and they say that too.
 * A reader can disagree with the correspondence — a thing they can check — without ever being
 * handed a sentence about a standard that nobody can trace back.
 */
const ReferencePanel: React.FC<{ reference: ControlReference; catalogue: ReferenceCatalogue }> = ({
  reference, catalogue,
}) => (
  <div className="mt-2 flex flex-col gap-2 rounded-[5px] border hairline-2 surface-sunken p-3">
    <p className="text-[11px] leading-relaxed ink-2">
      <span className="font-semibold ink">Why these controls: </span>{reference.why}
      <span className="ml-1 opacity-70">(our reading)</span>
      {reference.partial && (
        <span className="ml-1.5 whitespace-nowrap rounded border hairline surface-card px-1 py-px align-middle font-mono text-[9.5px] ink-3"
          title="The correspondence covers part of the Annex A control, not all of it">
          partial
        </span>
      )}
    </p>

    {reference.controls.map((c) => (
      <article key={c.id} className="rounded-[4px] border hairline surface-card p-2.5">
        <p className="flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-[11px] font-bold ink">{c.id}</span>
          <span className="text-[12px] font-semibold ink">{c.title}</span>
          <span className="ml-auto rounded border hairline px-1.5 py-px text-[9.5px] font-semibold ink-3">
            NIST SP 800-53 Rev. 5 · public domain
          </span>
        </p>
        <pre className="mt-1.5 whitespace-pre-wrap font-sans text-[11.5px] leading-relaxed ink-2">{c.statement}</pre>
        {c.guidance && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[10.5px] font-semibold ink-3">
              NIST's discussion of it
            </summary>
            <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed ink-3">{c.guidance}</p>
          </details>
        )}
      </article>
    ))}

    <p className="text-[10.5px] leading-relaxed ink-3">
      {catalogue.source.note}{" "}
      <a href={catalogue.source.doc.url} target="_blank" rel="noopener noreferrer"
        className="font-semibold text-sky-600 hover:opacity-75 dark:text-sky-400">
        {catalogue.source.doc.id} ({catalogue.source.version}) ↗
      </a>
      {" · "}
      <a href={catalogue.authoritative.url} target="_blank" rel="noopener noreferrer"
        className="font-semibold text-sky-600 hover:opacity-75 dark:text-sky-400">
        {catalogue.authoritative.id} — the authoritative wording ↗
      </a>
    </p>
  </div>
);

/**
 * Severity tint for the findings behind a control.
 *
 * A local copy of the three colours the Findings tab uses. Deliberately not imported from there:
 * index.tsx exports a component, and exporting a constant beside it costs the page fast refresh.
 * Now spelled as the console's own --flow custom properties rather than their hex values — a
 * var() reference is still just a string literal, so it costs nothing extra over the hex it
 * replaces, and the two copies can no longer drift apart.
 */
const SEV: Record<AuditSeverity, { label: string; colour: string; bg: string }> = {
  high: { label: "High", colour: "var(--flow-deny)", bg: "var(--flow-deny-bg)" },
  medium: { label: "Medium", colour: "var(--flow-warn)", bg: "var(--flow-warn-bg)" },
  low: { label: "Low", colour: "var(--flow-info)", bg: "var(--flow-info-bg)" },
};

const ControlRow: React.FC<{
  control: ControlCoverage;
  reference?: ControlReference;
  catalogue?: ReferenceCatalogue;
  /**
   * The findings this control's verdict was computed from.
   *
   * WHY THE ROW NEEDED THIS. It said `from mgmt-cleartext-access — 2 findings`, which names the
   * check that ran and how many times it fired, and answers "how do you know" — but not "what is
   * wrong". A reader who already knows cryptography is a problem on this firewall still had to
   * leave for the Findings tab and work out which of forty entries belonged to A.8.24. The rows
   * were always in the report; they were just never brought to the control.
   */
  findings: AuditFinding[];
  /** Absent when no device is selected or the reader may not ask — the button is then not offered. */
  onRemediate?: (control: ControlCoverage) => void;
}> = ({ control, reference, catalogue, findings, onRemediate }) => {
  const s = STATUS[control.status];
  const [open, setOpen] = useState(false);
  const [showWrong, setShowWrong] = useState(false);

  // A control nothing here assesses has nothing to fix: the row already says what would have to be
  // read for it to be answerable, and offering a plan for it would promise something this console
  // cannot deliver. Evidenced and accepted rows have nothing outstanding either.
  const fixable = control.status === "gap" || control.status === "indeterminate"
    || control.status === "observation";

  return (
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t hairline-2 px-3 py-2.5 first:border-t-0">
      <span className="w-23 shrink-0 font-mono text-[11.5px] font-semibold ink">{control.id}</span>

      <span className="min-w-55 flex-1 text-[12px] leading-snug ink-2">
        {control.title}
        {/* A summary we wrote must never sit next to a real control number looking like the
            publisher's own words. Official titles carry no marker precisely so this one stands
            out — see TitleSource in audit_standards.go. */}
        {control.title_source === "paraphrase" && (
          <span className="ml-1.5 whitespace-nowrap rounded border hairline surface-sunken px-1 py-px align-middle font-mono text-[9.5px] ink-3"
            title="Our summary of what this control is about — not the publisher's own wording, and not quotable as such">
            our summary
          </span>
        )}
      </span>

      <span className="flex shrink-0 items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[10px] font-semibold"
        style={{ color: s.color, background: s.bg, borderColor: s.border }} title={s.hint}>
        {s.icon} {s.label}
      </span>

      {/* Direct vs supporting is the difference between "this is the evidence" and "this helps".
          Stating it is what keeps the page usable by someone who will be challenged on it. A
          not-assessed control has no mapping at all, so it has no strength to show. */}
      {control.strength && (
        <span className="shrink-0 rounded-[4px] surface-sunken px-1.5 py-0.5 font-mono text-[10px] ink-3">
          {control.strength}
        </span>
      )}

      {/* The last line answers "how do you know" — or, for a control nothing assesses, "why not".
          Leaving that cell empty would read as "assessed, nothing to say", which is the single
          misreading this status exists to prevent. */}
      {control.status === "not-assessed" ? (
        <span className="w-full pl-26 text-[10.5px] leading-relaxed ink-3">
          {control.not_assessed}
        </span>
      ) : (
        <span className="w-full pl-26 font-mono text-[10px] ink-3">
          from {control.checks.join(" · ")}
          {control.findings > 0 && ` — ${control.findings} finding${control.findings === 1 ? "" : "s"}`}
        </span>
      )}

      {/* The two questions a reader has once they have read the row: what does this control
          actually require, and what do I do about it. Neither was answerable on this page before —
          the first meant leaving to find the standard, the second meant guessing. */}
      <div className="flex w-full flex-wrap items-center gap-2 pl-26 pt-1">
        {/* First, because it is the question the reader actually arrived with. "What does the
            standard ask for" and "how do I fix it" are both downstream of knowing what is wrong. */}
        {findings.length > 0 && (
          <button type="button" onClick={() => setShowWrong((w) => !w)}
            aria-expanded={showWrong}
            className="flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[10.5px] font-semibold transition hover:opacity-80"
            style={{ color: s.color, borderColor: s.border, background: s.bg }}>
            <FiSearch size={11} />
            {showWrong ? "Hide what is wrong" : `What is wrong right now (${findings.length})`}
          </button>
        )}
        {reference && catalogue && (
          <button type="button" onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-[4px] border hairline px-2 py-1 text-[10.5px] font-semibold ink-2 transition surface-hover hover-ink">
            <FiBookOpen size={11} />
            {open ? "Hide what this control asks for" : "What this control asks for"}
          </button>
        )}
        {fixable && onRemediate && (
          <button type="button" onClick={() => onRemediate(control)}
            className="flex items-center gap-1.5 rounded-[4px] border px-2 py-1 text-[10.5px] font-semibold transition hover:opacity-80"
            style={{ color: STATUS.observation.color, borderColor: STATUS.observation.border, background: STATUS.observation.bg }}>
            <FiTool size={11} /> How to close this
          </button>
        )}
      </div>

      {showWrong && (
        <div className="flex w-full flex-col gap-1.5 pl-26 pt-1">
          {findings.map((f, i) => (
            <div key={`${f.check}-${f.subject}-${i}`}
              className="rounded-[4px] border px-2.5 py-2"
              style={{ borderColor: `${SEV[f.severity].colour}33`, background: SEV[f.severity].bg }}>
              <p className="m-0 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold ink">
                <span className="rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide"
                  style={{ color: SEV[f.severity].colour, background: "var(--shell-card)" }}>
                  {SEV[f.severity].label}
                </span>
                {f.title}
                {f.accepted && (
                  <span className="rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide"
                    style={{ color: "#7c3aed", background: "#8b5cf618" }}>
                    risk accepted
                  </span>
                )}
              </p>
              {/* The OBJECT it is about — which interface, which administrator, which rule. Without
                  it the sentence is a category and the reader still has to go looking. */}
              <p className="m-0 mt-0.5 font-mono text-[10.5px] ink-2">{f.subject}</p>
              <p className="m-0 mt-1 text-[11.5px] leading-relaxed ink-2">{f.detail}</p>
              <p className="m-0 mt-1 font-mono text-[10px] ink-3">{f.check}</p>
            </div>
          ))}
        </div>
      )}

      {open && reference && catalogue && (
        <div className="w-full pl-26">
          <ReferencePanel reference={reference} catalogue={catalogue} />
        </div>
      )}
    </div>
  );
};

const FrameworkCard: React.FC<{
  framework: FrameworkCoverage;
  catalogue?: ReferenceCatalogue;
  /** Every finding in the report, keyed by the check that produced it. */
  byCheck: Map<string, AuditFinding[]>;
  onRemediate?: (control: ControlCoverage) => void;
}> = ({ framework, catalogue, byCheck, onRemediate }) => {
  // Open on anything that needs attention; a framework that is entirely clean starts collapsed so
  // the page does not make the reader scroll past good news to find bad.
  const needsAttention =
    framework.gaps + framework.indeterminate + framework.accepted + framework.observations > 0;
  const [open, setOpen] = useState(needsAttention);

  const sorted = [...framework.controls].sort(
    (a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status),
  );

  return (
    <div className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-3 px-4 py-3 text-left transition surface-hover">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold ink">
            {framework.name}
            <span className="rounded-[4px] surface-sunken px-1.5 py-0.5 font-mono text-[10px] font-semibold ink-2">
              {framework.version}
            </span>
            {framework.catalogue_status !== "reviewed" && (
              <span className="rounded-[4px] border border-amber-400/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400"
                title="This mapping was written by this console and has not yet been signed off by a qualified assessor">
                {framework.catalogue_status} mapping
              </span>
            )}
          </p>
          <p className="mt-0.5 text-[11px] ink-3">{framework.publisher}</p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {framework.gaps > 0 && (
            <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold" style={{ color: STATUS.gap.color, background: STATUS.gap.bg }}>
              {framework.gaps} gap{framework.gaps === 1 ? "" : "s"}
            </span>
          )}
          {framework.indeterminate > 0 && (
            <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold" style={{ color: STATUS.indeterminate.color, background: STATUS.indeterminate.bg }}>
              {framework.indeterminate} unknown
            </span>
          )}
          {framework.observations > 0 && (
            <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold" style={{ color: STATUS.observation.color, background: STATUS.observation.bg }}>
              {framework.observations} observation{framework.observations === 1 ? "" : "s"}
            </span>
          )}
          {framework.accepted > 0 && (
            <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold" style={{ color: STATUS.accepted.color, background: STATUS.accepted.bg }}>
              {framework.accepted} accepted
            </span>
          )}
          <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold" style={{ color: STATUS.evidenced.color, background: STATUS.evidenced.bg }}>
            {framework.evidenced} evidenced
          </span>
          {/* The denominator, never optional. "12 evidenced" on its own is the claim this whole
              page exists to avoid making. */}
          <span className="rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold"
            style={{ color: STATUS["not-assessed"].color, background: STATUS["not-assessed"].bg }}
            title={STATUS["not-assessed"].hint}>
            {framework.not_assessed} not assessed
          </span>
          <span className="ink-3">{open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}</span>
        </div>
      </button>

      {/* The scope note is not collapsible. A framework name shown without the limits of what was
          actually checked reads as full coverage, which is the claim this page must never make. */}
      <div className="border-t hairline-2 surface-sunken px-4 py-2">
        <p className="text-[11.5px] font-semibold ink-2">
          {framework.assessed} of the {framework.controls.length} controls listed here are assessed
          by this scan
          {framework.not_assessed > 0 && `; the remaining ${framework.not_assessed} say why they are not`}.
        </p>
        <p className="mt-1 text-[11px] leading-relaxed ink-3">{framework.note}</p>
      </div>

      {open && (
        <div>
          {sorted.map((c) => (
            <ControlRow key={c.id} control={c}
              reference={catalogue?.references[c.id]} catalogue={catalogue}
              findings={c.checks.flatMap((check) => byCheck.get(check) ?? [])}
              onRemediate={onRemediate} />
          ))}
        </div>
      )}
    </div>
  );
};

// Every judgement on this page — the severity on a finding, whether a mapping is direct, whether a
// control counts as evidenced — is this console's, not a framework's. Until this card existed the
// only answer to "why is that High?" was "because it is written that way in the code", which is not
// an answer anyone can take into an audit. The text comes from the backend so that the sentence
// here and the sentence in the evidence PDF are literally the same string.
const MethodologyCard: React.FC<{ methodology: Methodology }> = ({ methodology }) => {
  const [open, setOpen] = useState(false);

  const version = methodology.catalogue_version;

  const group = (title: string, defs: Definition[]) => (
    <div className="flex flex-col gap-1.5">
      <p className="text-[10px] font-bold uppercase tracking-wide ink-3">{title}</p>
      {defs.map((d) => (
        <p key={d.term} className="text-[11.5px] leading-relaxed ink-2">
          <span className="font-mono text-[11px] font-semibold ink">{d.term}</span>
          {" — "}{d.meaning}
        </p>
      ))}
    </div>
  );

  return (
    <div className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition surface-hover">
        <span className="flex-1 text-[12.5px] font-bold ink">How to read this page</span>
        <span className="text-[11px] ink-3">
          what our severities and statuses mean
          {version && ` · catalogue ${version} (${methodology.catalogue_status})`}
        </span>
        <span className="ink-3">{open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4 border-t hairline-2 px-4 py-3.5">
          {group("Severity — assigned by this console", methodology.severity_basis)}
          {group("Mapping strength", methodology.strength_basis)}
          {group("Control status", methodology.status_basis)}
          <p className="border-t hairline-2 pt-3 text-[11.5px] leading-relaxed ink-3">{methodology.note}</p>
        </div>
      )}
    </div>
  );
};

const StandardsView: React.FC<{
  report: AuditReport;
  /** Absent until a device is selected. Without it there is nothing to build a plan against. */
  deviceId?: number;
  /** The plan names administrator accounts and management protocols, so it is admin-only — the
   *  same gate the scan itself is behind. */
  isAdmin?: boolean;
  /** Re-run the scan. Called once the firewall has actually been written to. */
  onDeviceChanged?: () => void;
}> = ({ report, deviceId, isAdmin = false, onDeviceChanged }) => {
  const frameworks = report.standards ?? [];
  const catalogueVersion = report.methodology?.catalogue_version;

  // The reading material is static — public-domain standards text and this console's own
  // correspondence — so it is fetched once for the life of the page and never per scan. A failure
  // is silent on purpose: the page worked without it before and still does, minus one button.
  const [catalogue, setCatalogue] = useState<ReferenceCatalogue | undefined>();
  useEffect(() => {
    let alive = true;
    AuditReference()
      .then((c) => { if (alive) setCatalogue(c); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const [remediating, setRemediating] = useState<ControlCoverage | null>(null);

  /**
   * The report's findings, grouped by the check that produced them.
   *
   * Built once here rather than filtered inside every row: a framework has two dozen controls and
   * a busy firewall has as many findings, and this page already re-renders whenever the drawer
   * opens.
   */
  const byCheck = useMemo(() => {
    const map = new Map<string, AuditFinding[]>();
    for (const f of report.findings ?? []) {
      const at = map.get(f.check);
      if (at) at.push(f);
      else map.set(f.check, [f]);
    }
    return map;
  }, [report.findings]);

  if (frameworks.length === 0) {
    return (
      <div className="rounded-sm border border-dashed hairline py-12 text-center text-[12.5px] ink-3">
        This scan carries no standards mapping
      </div>
    );
  }

  const totals = frameworks.reduce(
    (acc, f) => ({
      gap: acc.gap + f.gaps,
      indeterminate: acc.indeterminate + f.indeterminate,
      observation: acc.observation + (f.observations ?? 0),
      accepted: acc.accepted + (f.accepted ?? 0),
      evidenced: acc.evidenced + f.evidenced,
      "not-assessed": acc["not-assessed"] + (f.not_assessed ?? 0),
    }),
    { gap: 0, indeterminate: 0, observation: 0, accepted: 0, evidenced: 0, "not-assessed": 0 },
  );
  const inScope = frameworks.reduce((n, f) => n + f.controls.length, 0);

  return (
    <div className="space-y-3">
      {/* Provenance, stated before any control is read.
          The heading line came off at the reader's request. The PARAGRAPH stays: it is the
          sentence that keeps this page evidence for a review rather than a compliance verdict,
          and every claim the standards layer makes rests on it being said once, up front. */}
      <div className="rounded-[5px] border border-sky-200 bg-sky-50 px-3.5 py-3 dark:border-sky-500/20 dark:bg-sky-500/10">
        <p className="text-[11.5px] leading-relaxed text-sky-800/80 dark:text-sky-300/80">
          These mappings are our interpretation of which controls a finding speaks to. They are evidence for a
          review, not a compliance verdict — only a qualified assessor can decide whether a control is met.
          The list below is the set of controls a firewall configuration could speak to, not a whole framework;
          the rows marked <em>not assessed here</em> are part of that list on purpose, so that what was checked
          can be read against what was not. This console assesses ISO/IEC 27001 and no other standard, so
          nothing on this page speaks to PCI DSS, NIST or the firewall's own vendor rating.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-[5px] border hairline-2 surface-card px-3.5 py-2.5 shadow-sm">
        {STATUS_ORDER.map((s) => {
          const n = totals[s];
          return (
            <span key={s} className="flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11px] font-bold"
              style={{ color: STATUS[s].color, background: STATUS[s].bg }} title={STATUS[s].hint}>
              {STATUS[s].icon} {STATUS[s].label} {n}
            </span>
          );
        })}
        <span className="ml-auto text-[11px] ink-3">
          {inScope} controls
          {frameworks.length === 1 ? ` · ${frameworks[0].name}` : ` across ${frameworks.length} frameworks`}
          {/* Which revision of OUR mapping produced these numbers. Two reports that disagree are
              only comparable once a reader can see whether the mapping moved between them. */}
          {catalogueVersion && ` · catalogue ${catalogueVersion}`}
          {" · "}scanned {formatDateTime(report.scanned_at)}
        </span>
      </div>

      {frameworks.map((f) => (
        <FrameworkCard key={f.id} framework={f} catalogue={catalogue} byCheck={byCheck}
          onRemediate={deviceId ? setRemediating : undefined} />
      ))}

      {report.methodology && <MethodologyCard methodology={report.methodology} />}

      {/* Wrapped, because this panel once white-screened the whole console over a `null` where an
          empty array was expected. The data bug is fixed at the source; this is the floor. */}
      {remediating && deviceId && (
        <PanelBoundary what="The remediation panel">
          <RemediatePanel key={remediating.id} deviceId={deviceId} controlId={remediating.id}
            controlTitle={remediating.title} canAsk={isAdmin}
            onDeviceChanged={onDeviceChanged}
            onClose={() => setRemediating(null)} />
        </PanelBoundary>
      )}
    </div>
  );
};

export default StandardsView;
