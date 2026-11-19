import React, { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiAlertOctagon, FiAlertTriangle, FiBookOpen, FiCheckCircle, FiCopy, FiEye,
  FiHelpCircle, FiLoader, FiMinusCircle, FiShield, FiUserCheck, FiX,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import {
  DeviceAuditRemediation, DeviceAuditRemediationAdvice,
  type FixVerification, type FixVerifyStatus, type RemediationAdvice, type RemediationPlan,
  type RemediationStep,
} from "../../api/auditRemediation";
import type { ControlStatus } from "../../api/policyObject";
import ApplyFlow from "./apply";

// Audit / Review ▸ "so how do I close this control?"
//
// The page could say what was wrong and which control it spoke to. It could not say what to change,
// and it could not say whether changing it would actually close the control — which is the only
// thing anybody does with a compliance report once they have read it.
//
// THREE THINGS ON SCREEN, AND KEEPING THEM APART IS THE DESIGN:
//
//   the steps        computed by the audit engine. Grouped by check, with the engine's own fix CLI.
//   the projection   computed too — this scan's findings minus the ones the plan resolves, re-read
//                    through the same control logic. It answers "what would the next scan say".
//   the advice       written by the model, on request, and labelled as such on the block itself.
//                    Sequencing, blast radius, rollback, verification — judgement over facts that
//                    are already established, which is the only part worth a model call.
//   the evidence     who says the COMMAND is right. A standard never publishes vendor commands, so
//                    the authority is the vendor: the device's own ?action=schema confirms the
//                    attribute and value on the firmware it is running, and Fortinet's CLI
//                    Reference documents the same command. Neither says the change is a good idea.
//
// A reader who cannot tell the third apart from the first two has been misled by us. Hence the
// separate request, the separate panel, the icon and the standing line above it.
//
// NOTHING HERE RUNS ANYTHING. Every command is copied out and run by the operator through Config
// Deploy or the terminal, exactly as the Findings tab's fix CLI always was. A page that decides
// what is wrong with a firewall AND rewrites it unattended can take a production network down
// because a heuristic fired.

// gap/indeterminate/observation/evidenced read the console's own --flow custom properties — the
// same four map onto allow/warn/deny/info in Policy & Objects/Topology. "accepted" and
// "not-assessed" stay their own literals: neither is an allow/warn/deny/info state.
const STATUS_LOOK: Record<ControlStatus, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  gap: { label: "Gap found", color: "var(--flow-deny)", bg: "var(--flow-deny-bg)", icon: <FiAlertOctagon size={11} /> },
  indeterminate: { label: "Could not determine", color: "var(--flow-warn)", bg: "var(--flow-warn-bg)", icon: <FiHelpCircle size={11} /> },
  observation: { label: "Observation", color: "var(--flow-info)", bg: "var(--flow-info-bg)", icon: <FiEye size={11} /> },
  accepted: { label: "Risk accepted", color: "#7c3aed", bg: "#8b5cf612", icon: <FiUserCheck size={11} /> },
  evidenced: { label: "Evidenced", color: "var(--flow-allow)", bg: "var(--flow-allow-bg)", icon: <FiCheckCircle size={11} /> },
  "not-assessed": { label: "Not assessed here", color: "#64748b", bg: "#94a3b814", icon: <FiMinusCircle size={11} /> },
};

const StatusChip: React.FC<{ status: ControlStatus }> = ({ status }) => {
  const s = STATUS_LOOK[status];
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold"
      style={{ color: s.color, background: s.bg }}>
      {s.icon} {s.label}
    </span>
  );
};

/**
 * The server's own message, or a fallback.
 *
 * Typed rather than reached for through `any`: the shape being read is exactly the one the Go
 * handlers return ({"error": "..."}), and writing that down is what stops a rename on the backend
 * from silently degrading into "something went wrong" everywhere.
 */
const errText = (e: unknown, fallback: string): string => {
  const err = e as { code?: string; response?: { data?: { error?: unknown } } };
  const detail = err?.response?.data?.error;
  if (typeof detail === "string" && detail.trim() !== "") return detail;
  // A client-side timeout is not an outage, and saying "could not be reached" about a request the
  // server is still working on sends somebody to check the wrong thing. This endpoint re-scans the
  // firewall, reads its schema and then calls a model; it is legitimately slow.
  if (err?.code === "ECONNABORTED") {
    return "This took longer than the request was allowed. The scan, the schema reads and the model "
      + "call together can run to half a minute on a busy firewall — try again.";
  }
  return fallback;
};

/**
 * What the device said about the command, as a badge.
 *
 * Six states rather than a tick and a cross, for the same reason the control statuses are six:
 * every pair that got merged is a place the tool would start overstating. "The attribute exists but
 * its value is a hostname we cannot check" is not "verified", and "the device would not answer" is
 * neither a pass nor a failure.
 */
const VERIFY: Record<FixVerifyStatus, { label: string; hint: string; color: string; bg: string }> = {
  verified: {
    label: "device-verified",
    hint: "This firewall's own schema confirms the attribute and accepts this value",
    color: "var(--flow-allow)", bg: "var(--flow-allow-bg)",
  },
  "attribute-only": {
    label: "attribute verified",
    hint: "The attribute exists on this firmware. Its value is not one the schema enumerates — a name, a number, an address — so the value is yours to choose",
    color: "var(--flow-info)", bg: "var(--flow-info-bg)",
  },
  "path-only": {
    label: "table verified",
    hint: "The table exists on this device. A delete or a move writes no attribute, so there is nothing further to check",
    color: "var(--flow-info)", bg: "var(--flow-info-bg)",
  },
  "attribute-unknown": {
    label: "not in this firmware",
    hint: "This device publishes no such attribute — the command would not do what it says. Check it before running it",
    color: "var(--flow-deny)", bg: "var(--flow-deny-bg)",
  },
  "value-unlisted": {
    label: "value not accepted",
    hint: "The attribute exists but this device does not list this value among the ones it accepts",
    color: "var(--flow-deny)", bg: "var(--flow-deny-bg)",
  },
  unreadable: {
    label: "could not check",
    hint: "This device did not answer the schema request, so the command was not checked against its firmware",
    color: "var(--flow-warn)", bg: "var(--flow-warn-bg)",
  },
};

const SEV_COLOR: Record<string, string> = {
  high: "var(--flow-deny)", medium: "var(--flow-warn)", low: "var(--flow-info)",
};

const CopyButton: React.FC<{ text: string; label?: string }> = ({ text, label = "Copy" }) => (
  <button type="button"
    onClick={() => {
      void navigator.clipboard.writeText(text);
      message.success("Copied — review it before you run it");
    }}
    className="flex shrink-0 items-center gap-1 rounded-[4px] border hairline px-2 py-1 text-[10.5px] font-semibold ink-2 transition surface-hover hover-ink">
    <FiCopy size={11} /> {label}
  </button>
);

/** The per-attribute verdicts, and the manufacturer's page. Shown under the command it is about. */
const Evidence: React.FC<{ step: RemediationStep }> = ({ step }) => {
  const [open, setOpen] = useState(false);
  const verdict = step.verdict;
  const bad = (v: FixVerification) =>
    v.status === "attribute-unknown" || v.status === "value-unlisted";
  // A problem is never hidden behind a disclosure triangle. Everything else is, because on a clean
  // step the detail is four lines saying the same thing.
  const shown = open ? (step.verification ?? []) : (step.verification ?? []).filter(bad);

  if (!verdict && !step.docs?.length) return null;

  return (
    <div className="mt-2 rounded-[4px] border hairline-2 surface-sunken px-2.5 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="flex items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider ink-3">
          <FiShield size={10} /> Says who
        </span>
        {verdict && (
          <span className="flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold"
            style={{ color: VERIFY[verdict].color, background: VERIFY[verdict].bg }}
            title={VERIFY[verdict].hint}>
            {VERIFY[verdict].label}
          </span>
        )}
        {step.docs?.map((d) => (
          <a key={d.path} href={d.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 rounded-[4px] border border-sky-400/40 px-1.5 py-0.5 text-[10px] font-semibold text-sky-600 transition hover:opacity-75 dark:text-sky-400"
            title={`${d.title} — ${d.publisher}, FortiOS ${d.release}. Cited, not reproduced.`}>
            <FiBookOpen size={10} /> {d.command} ↗
          </a>
        ))}
        {(step.verification?.length ?? 0) > 0 && (
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="ml-auto text-[10px] font-semibold ink-3 underline-offset-2 hover:underline">
            {open ? "hide" : `per-attribute (${step.verification!.length})`}
          </button>
        )}
      </div>

      {shown.length > 0 && (
        <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
          {shown.map((v) => (
            <li key={`${v.path}-${v.attr}-${v.value}`} className="flex flex-wrap items-baseline gap-x-1.5">
              <span className="rounded px-1 py-px text-[9px] font-bold uppercase"
                style={{ color: VERIFY[v.status].color, background: VERIFY[v.status].bg }}>
                {VERIFY[v.status].label}
              </span>
              {v.attr && <span className="font-mono text-[10px] ink-2">{v.attr}</span>}
              <span className="text-[10.5px] leading-relaxed ink-3">{v.detail}</span>
              {v.options && v.options.length > 0 && v.status === "value-unlisted" && (
                <span className="w-full font-mono text-[9.5px] ink-3">
                  accepts: {v.options.join(" · ")}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const StepCard: React.FC<{ step: RemediationStep; index: number }> = ({ step, index }) => (
  <div className="rounded-[5px] border hairline-2 surface-card p-3">
    <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] surface-sunken font-mono text-[10px] font-bold ink-2">
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-bold ink">{step.title}</p>
        <p className="mt-0.5 font-mono text-[10px] ink-3">{step.check}</p>
      </div>
      <span className="shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-extrabold uppercase tracking-wide"
        style={{
          color: SEV_COLOR[step.severity] ?? "#64748b",
          // color-mix, not a hex-alpha suffix: SEV_COLOR's values are now CSS custom properties.
          background: `color-mix(in srgb, ${SEV_COLOR[step.severity] ?? "#64748b"} 16%, transparent)`,
        }}>
        {step.severity} · {step.findings}
      </span>
      {/* An acceptance is a decision to live with a finding, not a reason to hide it from a fix
          plan — but somebody planning tonight's work needs to know it was already signed for. */}
      {step.accepted > 0 && (
        <span className="shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-bold"
          style={{ color: STATUS_LOOK.accepted.color, background: STATUS_LOOK.accepted.bg }}>
          {step.accepted} already accepted
        </span>
      )}
      {/* Tidying is not closing a control, and a plan must never let the two read alike. */}
      {step.advisory && (
        <span className="shrink-0 rounded-[5px] px-2 py-0.5 text-[10px] font-bold"
          style={{ color: STATUS_LOOK.observation.color, background: STATUS_LOOK.observation.bg }}
          title="Clutter rather than exposure. Fixing it moves an observation, never a gap.">
          advisory
        </span>
      )}
    </div>

    {step.subjects.length > 0 && (
      <p className="mt-1.5 flex flex-wrap items-center gap-1">
        {step.subjects.map((s) => (
          <span key={s} className="rounded border hairline surface-sunken px-1.5 py-px font-mono text-[9.5px] ink-3">
            {s}
          </span>
        ))}
        {step.findings > step.subjects.length && (
          <span className="text-[9.5px] ink-3">+{step.findings - step.subjects.length} more</span>
        )}
      </p>
    )}

    {step.cli && step.cli.length > 0 ? (
      <div className="mt-2 overflow-hidden rounded-[4px] border border-slate-700 bg-slate-900">
        <div className="flex items-center gap-2 border-b border-slate-700 px-2.5 py-1.5">
          <span className="text-[9.5px] font-semibold text-green-400">FORTIOS CLI</span>
          <span className="ml-auto"><CopyButton text={step.cli.join("\n")} /></span>
        </div>
        <pre className="max-h-56 overflow-auto p-2.5 font-mono text-[10.5px] leading-relaxed text-green-300">
          {step.cli.join("\n")}
        </pre>
      </div>
    ) : null}

    <Evidence step={step} />

    {!(step.cli && step.cli.length > 0) && (
      <p className="mt-2 rounded-[4px] border border-dashed hairline px-2.5 py-2 text-[11px] leading-relaxed ink-2">
        {step.manual}
      </p>
    )}
  </div>
);

export type RemediatePanelProps = {
  deviceId: number;
  controlId: string;
  controlTitle: string;
  /** Only an admin may ask: the plan names administrators and management protocols. */
  canAsk: boolean;
  /**
   * Called after the firewall has actually been written to. The panel re-reads its own plan; this
   * is how the PAGE behind it re-reads too — otherwise the reader closes the drawer onto a scan
   * that describes the firewall as it was before they changed it.
   */
  onDeviceChanged?: () => void;
  onClose: () => void;
};

const RemediatePanel: React.FC<RemediatePanelProps> = ({
  deviceId, controlId, controlTitle, canAsk, onDeviceChanged, onClose,
}) => {
  // Loading is the INITIAL state rather than something the effect switches on. The caller keys this
  // component on the control, so asking about a different one remounts it — which means the effect
  // below runs once per panel and never has to reset anything it did not set.
  const [plan, setPlan] = useState<RemediationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [advice, setAdvice] = useState<RemediationAdvice | null>(null);
  const [asking, setAsking] = useState(false);
  /** Bumped after a write, so the plan is re-read rather than left describing the old firewall. */
  const [reloadAt, setReloadAt] = useState(0);

  useEffect(() => {
    let alive = true;
    DeviceAuditRemediation(deviceId, controlId)
      .then((p) => { if (alive) setPlan(p); })
      .catch((e: unknown) => {
        if (alive) setError(errText(e, "Could not build a plan for this control"));
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [deviceId, controlId, reloadAt]);

  const askAI = useCallback(() => {
    setAsking(true);
    DeviceAuditRemediationAdvice(deviceId, controlId)
      .then((r) => { setAdvice(r.advice); setPlan(r.plan); })
      .catch((e: unknown) => message.error(errText(e, "The AI could not be reached")))
      .finally(() => setAsking(false));
  }, [deviceId, controlId]);

  // Escape closes it. A panel that covers the page and can only be dismissed by aiming at a small
  // ✕ is a panel people leave open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const panel = (
    <div className="fixed inset-0 z-9999 flex justify-end" role="dialog" aria-modal="true"
      // A REAL translucent backdrop. It was color-mix(… var(--shell-canvas) 55%, black), and
      // color-mix returns an OPAQUE colour — so instead of dimming the page behind it, it painted
      // flat grey over it and the audit table appeared to vanish the moment the panel opened.
      style={{ background: "rgb(15 18 25 / 0.45)" }}>
      <button type="button" aria-label="Close" onClick={onClose} className="flex-1 cursor-default" />

      {/* ~30% of the viewport. It was max-w-[860px], which on a laptop is most of the screen for a
          panel whose job is to sit BESIDE the control it is about — the reader lost the row they
          clicked. min-w keeps the CLI block readable on a narrow window; the pre inside scrolls. */}
      <div className="flex h-full w-full flex-col border-l hairline surface-card shadow-2xl
        sm:w-[30vw] sm:min-w-105 sm:max-w-190">
        <header className="flex shrink-0 items-start gap-3 border-b hairline-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-2 text-[13px] font-bold ink">
              How to close <span className="font-mono">{controlId}</span>
              {plan && <StatusChip status={plan.status} />}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] ink-3">{controlTitle}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] ink-3 transition surface-hover hover-ink">
            <FiX size={15} />
          </button>
        </header>

        <div className="shell-scroll min-h-0 flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-16 text-[12px] ink-3">
              <FiLoader size={14} className="animate-spin" /> Re-reading the firewall and working out the plan…
            </p>
          ) : error ? (
            <p className="rounded-[5px] border border-red-300 bg-red-50 px-3 py-2.5 text-[12px] text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
              {error}
            </p>
          ) : !plan ? null : (
            <div className="flex flex-col gap-3">
              {/* The headline: does doing all of this close the control, and if not, why not. This
                  is the sentence the whole panel exists to be able to say honestly. */}
              <div className="rounded-[5px] border px-3.5 py-3"
                style={plan.closes
                  ? { borderColor: "color-mix(in srgb, var(--flow-allow) 25%, transparent)", background: "var(--flow-allow-bg)" }
                  : { borderColor: "color-mix(in srgb, var(--flow-warn) 27%, transparent)", background: "var(--flow-warn-bg)" }}>
                <p className="flex items-center gap-1.5 text-[12.5px] font-bold"
                  style={{ color: plan.closes ? STATUS_LOOK.evidenced.color : STATUS_LOOK.indeterminate.color }}>
                  {plan.closes ? <FiCheckCircle size={13} /> : <FiAlertTriangle size={13} />}
                  {plan.steps.length === 0
                    ? "There is nothing to fix on this control"
                    : plan.closes
                      ? "Running every step below would close this control"
                      : "Running every step below would not close this control on its own"}
                </p>
                {plan.blocked && (
                  <p className="mt-1 text-[11.5px] leading-relaxed ink-2">{plan.blocked}</p>
                )}
                <p className="mt-1.5 text-[10.5px] leading-relaxed ink-3">{plan.note}</p>
              </div>

              {plan.steps.length > 0 && (
                <section className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider ink-3">
                      Steps
                    </p>
                    {/* Where the command checks came from. A "device-verified" badge with no
                        statement of which device and which firmware verified it is the same kind of
                        unsourced claim this page exists to remove. */}
                    {plan.schema_source && (
                      <span className="rounded-[4px] surface-sunken px-1.5 py-0.5 font-mono text-[9.5px] ink-3"
                        title={`Commands checked with ${plan.schema_source.method} on this device`}>
                        checked against {plan.schema_source.device}
                        {plan.schema_source.firmware ? ` · ${plan.schema_source.firmware}` : ""}
                      </span>
                    )}
                  </div>
                  {plan.steps.map((s, i) => <StepCard key={s.check} step={s} index={i} />)}
                  {/* The bound on the word "verified". It has to sit with the badges, not in a
                      tooltip somebody may never open. */}
                  {plan.evidence_note && (
                    <p className="text-[10.5px] leading-relaxed ink-3">{plan.evidence_note}</p>
                  )}
                </section>
              )}

              {/* ONE button, not two.
                  There used to be a separate "ask the AI how to run this" that returned four
                  paragraphs and then sat there — an essay next to a plan the reader had already
                  understood. The model earns its place by filling this form in: it supplies the
                  values the console will not invent, what could break, and what gets better. So
                  asking it and opening the change are the same action. */}
              {plan.steps.length > 0 && canAsk && (
                <ApplyFlow deviceId={deviceId} plan={plan} advice={advice} asking={asking}
                  onOpen={askAI}
                  onChanged={() => { setReloadAt(Date.now()); onDeviceChanged?.(); }} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Portalled to the body. MainLayout's content column carries `transform-gpu` for its sidebar
  // animation, and a transform makes an ancestor the containing block for `fixed` descendants — so
  // rendered in place this "full-screen" overlay covered only the content area, leaving the sidebar
  // untouched and the page underneath blanked out. The same trap is documented in the AI
  // Assistant's Simulate panel.
  return createPortal(panel, document.body);
};

export default RemediatePanel;
