import React from "react";
import {
  FiAlertOctagon, FiAlertTriangle, FiInfo, FiLayers, FiShield, FiTarget, FiUsers,
} from "react-icons/fi";
import type {
  AffectedNetwork, ExistingPolicyImpact, ImpactSeverity, PolicyImpactReport,
} from "./flowImpact";

// The impact panel that sits under a policy's flow chart.
//
// The chart answers "what does this rule do". This answers the question the person APPROVING the
// change has: who is in scope, and what does it break. Three blocks, in the order they get read:
//
//   1. the headline numbers — how many segments, how many hosts, how many existing rules involved
//   2. the segments themselves, each with the interface it lives behind
//   3. the existing policies it collides with, worst first
//
// Everything shown is computed in flowImpact.ts; this file only decides how it looks.

const SEVERITY: Record<ImpactSeverity, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  critical: { color: "var(--flow-deny)", bg: "var(--flow-deny-bg)", icon: <FiAlertOctagon size={12} />, label: "Fix first" },
  warning:  { color: "var(--flow-warn)", bg: "var(--flow-warn-bg)", icon: <FiAlertTriangle size={12} />, label: "Worth checking" },
  info:     { color: "var(--flow-info)", bg: "var(--flow-info-bg)", icon: <FiInfo size={12} />, label: "For information" },
};

const RELATION_LABEL: Record<ExistingPolicyImpact["relation"], string> = {
  "covers-new": "shadows the new policy",
  "covered-by-new": "shadowed by the new policy",
  overlap: "partly overlaps",
};

const Stat: React.FC<{ icon: React.ReactNode; value: string; label: string; tone?: string }> = ({
  icon, value, label, tone,
}) => (
  <div className="flex min-w-0 flex-1 items-center gap-2 rounded-[4px] border hairline-2 px-2.5 py-1.5">
    <span className="shrink-0" style={{ color: tone ?? "var(--shell-ink-3)" }}>{icon}</span>
    <div className="min-w-0">
      <p className="truncate text-[12.5px] font-bold ink">{value}</p>
      <p className="truncate text-[9.5px] ink-3">{label}</p>
    </div>
  </div>
);

const NetworkRow: React.FC<{ n: AffectedNetwork; accent: string }> = ({ n, accent }) => (
  <div className="flex items-center gap-2 rounded-[4px] px-2 py-1" style={{ background: "var(--flow-chip-bg)" }}>
    <span
      className="shrink-0 rounded px-1 py-0.5 text-[8.5px] font-bold"
      style={{
        background: n.side === "source" ? `${accent}20` : "var(--flow-info-bg)",
        color: n.side === "source" ? accent : "var(--flow-info)",
      }}
    >
      {n.side === "source" ? "Source" : "Destination"}
    </span>
    <span className="truncate font-mono text-[11px] font-bold ink">{n.cidr}</span>
    <span className="truncate text-[10.5px] ink-2">{n.label}</span>
    {n.iface && (
      <span className="ml-auto shrink-0 text-[10px] ink-3">
        {/* "behind" is right for a LAN subnet and wrong for the internet, which is reached THROUGH
            the interface rather than sitting on it. */}
        {n.unbounded ? "out of" : "behind"} {n.iface}
        {n.ifaceRole ? ` · ${n.ifaceRole.toUpperCase()}` : ""}
      </span>
    )}
    <span className="shrink-0 text-[10.5px] font-semibold ink-2">
      {n.unbounded ? "uncountable" : `~${n.hosts.toLocaleString()} hosts`}
    </span>
  </div>
);

const PolicyRow: React.FC<{ c: ExistingPolicyImpact }> = ({ c }) => {
  const s = SEVERITY[c.severity];
  return (
    <div className="rounded-[4px] border px-2.5 py-1.5" style={{ borderColor: s.color, background: s.bg }}>
      <div className="flex flex-wrap items-center gap-1.5">
        <span style={{ color: s.color }}>{s.icon}</span>
        <span className="text-[11.5px] font-bold ink">#{c.seq} {c.name}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{
            background: c.action === "deny" ? "var(--flow-deny-bg)" : "var(--flow-allow-bg)",
            color: c.action === "deny" ? "var(--flow-deny)" : "var(--flow-allow)",
          }}
        >
          {c.action.toUpperCase()}
        </span>
        <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
          style={{ background: "var(--flow-chip-bg)", color: "var(--shell-ink-2)" }}>
          {RELATION_LABEL[c.relation]}
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-snug ink-2">{c.detail}</p>
    </div>
  );
};

export type ImpactReportProps = {
  report: PolicyImpactReport;
  accent: string;
  /** True while the device lists are still loading — the numbers are provisional until they land. */
  loading?: boolean;
  /**
   * Draw section 4, the existing policies this traffic collides with. On by default.
   *
   * The Simulate panel turns it off: it renders the same collisions itself as a ledger with a state
   * per rule (dead / narrowed / survives), which says strictly more, and two lists of the same
   * policies one above the other reads as two different findings.
   */
  showCollisions?: boolean;
};

export const ImpactReport: React.FC<ImpactReportProps> = ({
  report, accent, loading, showCollisions = true,
}) => {
  const sources = report.networks.filter((n) => n.side === "source");
  const destinations = report.networks.filter((n) => n.side === "destination");
  const worst = report.findings[0]?.severity ?? "info";

  return (
    <div className="rounded-[4px] border hairline surface-card">
      <div className="flex items-center gap-2 border-b hairline-2 px-3 py-2">
        <span style={{ color: SEVERITY[worst].color }}><FiTarget size={13} /></span>
        <span className="text-[12px] font-bold ink">What this policy affects</span>
        <span className="truncate text-[10.5px] ink-3">
          {report.srcIntf || "any"} → {report.dstIntf || "any"}
        </span>
        {loading && (
          <span className="ml-auto flex items-center gap-1 text-[10px] ink-3">
            <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
            Reading from the device…
          </span>
        )}
      </div>

      <div className="space-y-2.5 p-3">
        {/* 1 — the headline numbers */}
        <div className="flex flex-wrap gap-2">
          <Stat icon={<FiLayers size={14} />} tone={accent}
            value={`${sources.length}`} label="source networks affected" />
          <Stat icon={<FiUsers size={14} />} tone={accent}
            value={`~${report.sourceHosts.toLocaleString()}`} label="hosts in scope" />
          <Stat icon={<FiShield size={14} />}
            tone={report.existing.length ? SEVERITY[worst].color : undefined}
            value={`${report.existing.length}`} label="existing policies involved" />
        </div>

        {/* 2 — the findings, worst first */}
        <div className="space-y-1.5">
          {report.findings.map((f, i) => {
            const s = SEVERITY[f.severity];
            return (
              <div key={i} className="flex items-start gap-2 rounded-[4px] px-2.5 py-1.5"
                style={{ background: s.bg }}>
                <span className="mt-px shrink-0" style={{ color: s.color }}>{s.icon}</span>
                <div className="min-w-0">
                  <p className="text-[11.5px] font-bold" style={{ color: s.color }}>{f.title}</p>
                  <p className="text-[11px] leading-snug ink-2">{f.detail}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* 3 — which networks, and behind which interface */}
        {(sources.length > 0 || destinations.length > 0) && (
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-wide ink-3">Subnets in scope</p>
            {[...sources, ...destinations].map((n) => (
              <NetworkRow key={n.key} n={n} accent={accent} />
            ))}
          </div>
        )}

        {/* 4 — the existing rules it runs into */}
        {showCollisions && report.existing.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[10px] font-bold uppercase tracking-wide ink-3">
              Existing policies on the device that this traffic collides with
            </p>
            {report.existing.map((c) => <PolicyRow key={`${c.policyId}-${c.name}`} c={c} />)}
          </div>
        )}
      </div>
    </div>
  );
};

export default ImpactReport;
