import React, { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "../../components/ui/toast";
import {
  FiAlertOctagon, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiChevronRight,
  FiClipboard, FiCopy, FiHelpCircle, FiInfo, FiRefreshCw,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceAudit, type AuditFinding, type AuditReport, type AuditSeverity, type CheckRationale,
} from "../../api/policyObject";
import StandardsView from "./standards";
import TrendView from "./trend";
import { AcceptDialog, AcceptedBanner } from "./accept";
import { useAuth } from "../../contexts/AuthContext.logic";
import { formatDateTime } from "../../lib/datetime";
import { apiErrorText } from "../../api/errorText";

// Audit / Review — "what is wrong with this firewall?"
//
// The scan itself is pure computation on the backend (set containment over the policy table,
// reference counts, live hit counters), so running it costs nothing and it can be re-run as often
// as the user likes. Nothing here writes to the device: each finding shows the CLI that would fix
// it and leaves running it to the user.
//
// Three tabs, three different answers to "says who", kept apart on purpose:
//
//   Findings   what this console computed, and stands behind
//   Standards  control by control: what those findings evidence against ISO/IEC 27001 Annex A, and
//              — listed just as plainly — the controls nothing here assesses, with the reason. Our
//              interpretation, marked as ours.
//   Trend      whether it is getting better, and the register of what has been signed off
//
// Merging them would be tidier and would destroy the only thing that makes the output usable in
// front of an auditor: being able to say which half came from where.
//
// A fourth tab, Device Rating, used to sit at the end: the firewall's own Security Rating, relayed
// with Fortinet's FSBP and PCI ids attached. It was removed, together with the corroboration panel
// on the Standards tab, when this page was narrowed to ISO/IEC 27001 — both existed to show a
// SECOND standard's numbering beside ours, which is the one thing this page no longer does. What
// they protected against still holds for what is left: every control id on screen is ISO/IEC's,
// every judgement beside it is ours, and the page says which is which on every row.

const SEVERITY: Record<AuditSeverity, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  high:   { label: "High",   color: "#b91c1c", bg: "#ef444412", border: "#ef444440", icon: <FiAlertOctagon size={13} /> },
  medium: { label: "Medium", color: "#b45309", bg: "#f59e0b14", border: "#f59e0b45", icon: <FiAlertTriangle size={13} /> },
  low:    { label: "Low",    color: "#0369a1", bg: "#0ea5e912", border: "#0ea5e940", icon: <FiInfo size={13} /> },
};

const ORDER: AuditSeverity[] = ["high", "medium", "low"];

type Tab = "findings" | "standards" | "trend";

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: "findings",  label: "Findings",       hint: "What this console computed from the policy table" },
  { id: "standards", label: "ISO/IEC 27001",  hint: "Annex A control by control: what this scan evidences, and what it does not assess at all" },
  { id: "trend",     label: "Trend",          hint: "Whether this firewall is getting better, and what has been signed off" },
];

// Why this class of finding matters — our one line, marked as ours, with the publications a reader
// can go and check. It replaced a hard-coded blurb in this file that read as authoritative and had
// nothing behind it; the sentence is still ours, but now it says so and cites its sources.
const CheckWhy: React.FC<{ rationale?: CheckRationale }> = ({ rationale }) => {
  if (!rationale) return null;
  return (
    <div className="mt-1">
      <p className="text-[11px] leading-relaxed ink-3">
        {rationale.summary}
        <span className="ml-1 opacity-70">(our summary)</span>
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {rationale.basis.map((c) => (
          <span key={`${c.framework_id}-${c.id}`}
            className="rounded border hairline surface-sunken px-1.5 py-px font-mono text-[9.5px] ink-3"
            title={`${c.framework} ${c.version} — ${c.title} (${c.strength})`}>
            {c.framework} {c.id}
          </span>
        ))}
        {rationale.sources.map((d) => (
          <a key={d.id} href={d.url} target="_blank" rel="noopener noreferrer"
            className="rounded border border-sky-400/40 px-1.5 py-px text-[9.5px] font-semibold text-sky-600 transition hover:opacity-75 dark:text-sky-400"
            title={`${d.title} — ${d.publisher}${d.public_domain ? "" : " (cited, not reproduced)"}`}>
            {d.id} ↗
          </a>
        ))}
      </div>
    </div>
  );
};

const FindingCard: React.FC<{
  finding: AuditFinding;
  canAccept: boolean;
  onAccept: (f: AuditFinding) => void;
}> = ({ finding, canAccept, onAccept }) => {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[finding.severity];
  const fix = finding.fix?.join("\n") ?? "";

  const copyFix = async () => {
    try {
      await navigator.clipboard.writeText(fix);
      message.success("CLI copied");
    } catch {
      message.warning("Could not copy — select the text and press Ctrl+C");
    }
  };

  return (
    <div className="overflow-hidden rounded-[5px] border surface-card"
      style={{ borderColor: sev.border }}>
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition surface-hover">
        <span className="mt-0.5 shrink-0" style={{ color: sev.color }}>{sev.icon}</span>
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] font-semibold ink">
            {finding.title}
            {finding.accepted && (
              <span className="rounded px-1.5 py-px text-[9.5px] font-bold uppercase tracking-wide"
                style={{ color: "#7c3aed", background: "#8b5cf618" }}>
                risk accepted
              </span>
            )}
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] ink-2">{finding.subject}</p>
        </div>
        <span className="shrink-0 ink-3">{open ? <FiChevronDown size={14} /> : <FiChevronRight size={14} />}</span>
      </button>

      {open && (
        <div className="border-t px-3 py-2.5" style={{ borderColor: sev.border, background: sev.bg }}>
          <p className="text-[12px] leading-relaxed ink">{finding.detail}</p>

          {finding.accepted
            ? <AcceptedBanner accepted={finding.accepted} />
            : canAccept && (
              <button type="button" onClick={() => onAccept(finding)}
                className="mt-2.5 rounded-[4px] border border-violet-400/50 px-2.5 py-1 text-[11px] font-semibold text-violet-600 transition surface-hover dark:text-violet-300">
                Accept this risk…
              </button>
            )}

          {/* Control references, under the finding they belong to. Kept visually quiet — they are
              a citation, not a verdict, and the Standards tab is where they are read properly. */}
          {!!finding.controls?.length && (
            <div className="mt-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wide ink-2">
                Speaks to — ISO/IEC 27001 Annex A, our mapping
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {finding.controls.map((c) => (
                  <span key={`${c.framework_id}-${c.id}`}
                    className="rounded border hairline surface-card px-1.5 py-0.5 font-mono text-[10px] ink-2"
                    title={`${c.framework} ${c.version} — ${c.title} (${c.strength})`}>
                    {c.framework} {c.id}
                  </span>
                ))}
              </div>
            </div>
          )}

          {fix && (
            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wide ink-2">
                  The CLI that fixes this — copy it and run it yourself; the console will not
                </span>
                <button type="button" onClick={copyFix}
                  className="flex items-center gap-1 rounded-[4px] border hairline px-2 py-0.5 text-[10px] font-semibold ink-2 surface-hover">
                  <FiCopy size={10} /> Copy
                </button>
              </div>
              <pre className="overflow-x-auto rounded-[4px] bg-[#1a1a1a] p-2.5 font-mono text-[10.5px] leading-relaxed text-green-300">
                {fix}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const AuditPage: React.FC = () => {
  const { currentColor } = useStateContext();

  const { device: selectedDevice } = useSelectedDevice();
  const [report, setReport] = useState<AuditReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<AuditSeverity | "all">("all");
  const [tab, setTab] = useState<Tab>("findings");
  const { isAdmin } = useAuth();
  // Accepting a risk is a sign-off, so it is admin-only here and on the server.
  const [accepting, setAccepting] = useState<AuditFinding | null>(null);

  const run = useCallback(async (device: NetworkDevice) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await DeviceAudit(device.id));
    } catch (e) {
      setReport(null);
      setError(apiErrorText(e, "The scan failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Scanning is free (no AI, no writes), so it runs as soon as a device is picked rather than
  // making the user press a button to find out anything at all.
  useEffect(() => {
    setReport(null);
    setError(null);
    if (selectedDevice) void run(selectedDevice);
  }, [selectedDevice, run]);

  const shown = useMemo(
    () => (report?.findings ?? []).filter((f) => filter === "all" || f.severity === filter),
    [report, filter],
  );

  // Grouped by check so the page reads as "here are the 6 kinds of problem", not a flat feed.
  const grouped = useMemo(() => {
    const map = new Map<string, AuditFinding[]>();
    for (const f of shown) {
      const list = map.get(f.check) ?? [];
      list.push(f);
      map.set(f.check, list);
    }
    return [...map.entries()];
  }, [shown]);

  const total = report?.findings.length ?? 0;

  const rationales = useMemo(
    () => new Map((report?.check_rationales ?? []).map((r) => [r.check, r])),
    [report],
  );

  // How many distinct checks the backend ran. The report carries one rationale per check, so this
  // follows the engine automatically instead of being a number typed into the empty state.
  const checkCount = report?.check_rationales?.length ?? 0;

  const findingsView = report && (
    <div className="space-y-4">
      {/* ── Summary ── */}
      <div className="rounded-sm border hairline-2 surface-card p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setFilter("all")}
            className="rounded-[5px] px-2.5 py-1 text-[11px] font-bold transition"
            style={filter === "all"
              ? { background: currentColor, color: "white" }
              : { background: "#94a3b81a", color: "#64748b" }}>
            {total} in total
          </button>
          {!!report.accepted_count && (
            <span className="rounded-[5px] px-2.5 py-1 text-[11px] font-bold"
              style={{ color: "#7c3aed", background: "#8b5cf612" }}
              title="Findings somebody signed off on. They are excluded from the severity counts but never removed from the report.">
              {report.accepted_count} accepted
            </span>
          )}
          {ORDER.map((s) => {
            const n = report.counts[s] ?? 0;
            return (
              <button key={s} onClick={() => setFilter(filter === s ? "all" : s)} disabled={n === 0}
                className="flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11px] font-bold transition disabled:opacity-40"
                style={filter === s
                  ? { background: SEVERITY[s].color, color: "white" }
                  : { background: SEVERITY[s].bg, color: SEVERITY[s].color }}>
                {SEVERITY[s].icon} {SEVERITY[s].label} {n}
              </button>
            );
          })}
        </div>

        {/* What the scan looked at — without this, "0 findings" reads as "the scan is broken". */}
        <p className="mt-3 border-t hairline-2 pt-2.5 text-[11px] ink-3">
          Scanned {report.stats.policies} policies
          {report.stats.policies_disabled > 0 && ` (${report.stats.policies_disabled} disabled)`}
          {" · "}{report.stats.addresses} address · {report.stats.services} service
          {" · "}scanned {formatDateTime(report.scanned_at)}
        </p>
      </div>

      {/* ── Anything the scan could not decide, stated rather than hidden ── */}
      {!!report.notes?.length && (
        <div className="rounded-[5px] border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-500/20 dark:bg-amber-500/10">
          <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-bold text-amber-700 dark:text-amber-400">
            <FiAlertTriangle size={12} /> Partly incomplete
          </p>
          <ul className="ml-5 list-disc space-y-0.5 text-[11.5px] text-amber-700 dark:text-amber-300">
            {report.notes.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
          {!!report.undecided_checks?.length && (
            <p className="mt-1.5 flex items-start gap-1.5 border-t border-amber-300/40 pt-1.5 font-mono text-[10.5px] text-amber-700 dark:text-amber-300">
              <FiHelpCircle size={11} className="mt-0.5 shrink-0" />
              <span>
                {report.undecided_checks.join(" · ")} — reported as "could not determine" on the Standards
                tab rather than counted as passing
              </span>
            </p>
          )}
        </div>
      )}

      {/* ── Findings ── */}
      {total === 0 ? (
        <div className="flex flex-col items-center rounded-sm border border-emerald-200 bg-emerald-50/50 py-14 text-center text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/8 dark:text-emerald-400">
          <FiCheckCircle size={28} className="mb-3" />
          {/* The count comes from the report. It used to say "the six checks" in this file, which
              became a lie the moment a seventh was added — and a page that miscounts its own
              checks is not a page anyone should take into an audit. */}
          <p className="text-[13px] font-semibold">
            {checkCount > 0
              ? `None of the ${checkCount} checks found a problem`
              : "This scan found no problem"}
          </p>
          {/* And it must not promise more than the checks cover. The old line said "every route to
              the internet is inspected", which no check verifies; what the scan actually knows is
              that nothing it looks for is present. The Standards tab is where the limits live. */}
          <p className="mt-1 max-w-md text-[11px] opacity-70">
            Nothing this scan looks for is present on this device. That is not the same as full
            coverage — the Standards tab lists what is checked and what is not.
          </p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-sm border border-dashed hairline py-12 text-center text-[12.5px] ink-3">
          No finding at this severity
        </div>
      ) : (
        grouped.map(([check, findings]) => (
          <div key={check} className="rounded-sm border hairline-2 surface-card p-4 shadow-sm">
            <div className="mb-2.5">
              <p className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-wide ink-2">
                {check}
                <span className="rounded-[5px] surface-sunken px-1.5 py-0.5 text-[10px] font-bold ink-2">
                  {findings.length}
                </span>
              </p>
              <CheckWhy rationale={rationales.get(check)} />
            </div>
            <div className="space-y-2">
              {findings.map((f, i) => (
                <FindingCard key={`${f.check}-${f.subject}-${i}`} finding={f}
                  canAccept={isAdmin} onAccept={setAccepting} />
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );

  return (
    <div className="p-1">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. The hero's finding/high counts are not lost, just not repeated here — the
          findings list and the standards view both already show them. */}
      {!selectedDevice ? (
        <div className="flex flex-col items-center rounded-sm border border-dashed hairline py-16 ink-3">
          <FiClipboard size={28} className="mb-3 opacity-30" />
          <p className="text-[13px]">Pick a device to start the scan</p>
          <p className="mt-1 text-[11px] ink-3">
            Entirely computed — no AI involved, and nothing is written to the device
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1 rounded-[5px] border hairline-2 surface-card p-1 shadow-sm">
              {TABS.map((t) => (
                <button key={t.id} type="button" onClick={() => setTab(t.id)} title={t.hint}
                  className="rounded-[4px] px-3 py-1.5 text-[12px] font-semibold transition"
                  style={tab === t.id
                    ? { background: currentColor, color: "white" }
                    : { color: "var(--shell-ink-2)" }}>
                  {t.label}
                </button>
              ))}
            </div>
            <button onClick={() => selectedDevice && run(selectedDevice)} disabled={!selectedDevice || loading}
              className="flex h-8 items-center gap-1.5 rounded-[5px] border hairline px-3 text-[12px] font-semibold ink-2 transition surface-hover disabled:opacity-50">
              <FiRefreshCw size={12} className={loading ? "animate-spin" : ""} /> Rescan
            </button>
          </div>

          {/* Trend reads a different endpoint and owns its own loading state, so it is not gated
              on the audit scan having succeeded — a device whose policy table will not load can
              still show the history of the scans that did run, and vice versa. */}
          {tab === "trend" ? (
            <TrendView deviceId={selectedDevice.id} isAdmin={isAdmin} />
          ) : loading ? (
            <div className="flex items-center justify-center gap-2 rounded-sm border hairline-2 py-16 text-[12.5px] ink-3">
              <div className="h-4 w-4 animate-spin rounded-full border-2 hairline border-t-transparent" />
              Reading policies, objects and counters from the device…
            </div>
          ) : error ? (
            <div className="rounded-[5px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              {error}
            </div>
          ) : report ? (
            tab === "standards"
              ? <StandardsView report={report} deviceId={selectedDevice.id} isAdmin={isAdmin}
                  onDeviceChanged={() => void run(selectedDevice)} />
              : findingsView
          ) : null}
        </div>
      )}

      {accepting && selectedDevice && (
        <AcceptDialog
          deviceId={selectedDevice.id}
          finding={accepting}
          maxDays={180}
          onClose={() => setAccepting(null)}
          onDone={() => { setAccepting(null); void run(selectedDevice); }}
        />
      )}
    </div>
  );
};

export default AuditPage;
