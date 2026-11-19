import React from "react";
import { FiActivity, FiAlertTriangle, FiDatabase, FiInfo, FiShieldOff } from "react-icons/fi";
import Tooltip from "../../components/ui/Tooltip";
import type { TrafficLogRow } from "../../api/logs";
import { formatBytes, rowDirection } from "./format";
import { rowResult, type ResultGroup, type ResultKind } from "./story";

// Four numbers over the entries read, each one also a way into them: pressing a tile sets the
// "Show" switch to exactly the entries it counts. Each carries an ⓘ with what it counts, because a
// number with a two-word label is a guess about what the two words mean.

const MEANING = {
  total: "Every entry read from the log for this search — one entry is one connection. The line underneath says who started them.",
  blocked: "Connections the FortiGate stopped: no policy matched, a policy said deny, or a security profile blocked it. The line underneath names the most common reason.",
  problem: "Connections the FortiGate let through that did not finish normally: the destination reset them, or they timed out. Usually the far end or the network, not the firewall.",
  bytes: "Total data moved by these connections, both directions. Counted in 1000s, exactly as the FortiGate's own log view shows it.",
} as const;

const REASON: Partial<Record<ResultKind, string>> = {
  "blocked-implicit": "most: no policy matched",
  "blocked-rule": "most: denied by a policy",
  "blocked-profile": "most: a security profile",
  blocked: "most: refused by the FortiGate",
};

const Tile: React.FC<{
  label: string;
  value: string;
  caption: string;
  meaning: string;
  icon: React.ReactNode;
  tint: string;
  active?: boolean;
  onClick?: () => void;
}> = ({ label, value, caption, meaning, icon, tint, active, onClick }) => (
  <div className="relative">
    <button type="button" onClick={onClick} disabled={!onClick} aria-pressed={onClick ? !!active : undefined}
      className="shell-card flex h-full w-full items-center gap-3 px-4 py-3 pr-9 text-left transition enabled:surface-hover disabled:cursor-default"
      style={active ? { boxShadow: `0 0 0 2px ${tint}` } : undefined}>
      <span className="medallion h-10 w-10 shrink-0 text-[16px]" style={{ color: tint, background: `${tint}1f` }} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-label block truncate">{label}</span>
        <span className="t-metric block">{value}</span>
        <span className="t-meta block line-clamp-2">{caption}</span>
      </span>
    </button>
    <Tooltip title={meaning} placement="bottom">
      <button type="button" aria-label={meaning} className="btn-icon absolute right-2 top-2 h-6 w-6 text-[13px] ink-3">
        <FiInfo />
      </button>
    </Tooltip>
  </div>
);

const SummaryTiles: React.FC<{
  rows: TrafficLogRow[];
  hues: Record<ResultGroup, string>;
  show: ResultGroup | "all";
  onShow: (g: ResultGroup | "all") => void;
  accent: string;
}> = ({ rows, hues, show, onShow, accent }) => {
  let blocked = 0, problem = 0, sent = 0, rcvd = 0, fromUnit = 0;
  const reasons = new Map<ResultKind, number>();
  for (const r of rows) {
    const res = rowResult(r);
    if (res.group === "blocked") {
      blocked += 1;
      reasons.set(res.kind, (reasons.get(res.kind) ?? 0) + 1);
    } else if (res.group === "problem") problem += 1;
    sent += r.sentbyte || 0;
    rcvd += r.rcvdbyte || 0;
    if (rowDirection(r) !== "inbound") fromUnit += 1;
  }
  const topReason = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const toggle = (g: ResultGroup | "all") => onShow(show === g ? "all" : g);

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile label="Connections" value={String(rows.length)} meaning={MEANING.total} icon={<FiActivity />} tint={accent}
        caption={fromUnit === rows.length ? "All started by the FortiGate itself"
          : fromUnit > 0 ? `${fromUnit} started by the FortiGate · ${rows.length - fromUnit} from other devices`
            : "All from other devices"}
        active={show === "all"} onClick={() => onShow("all")} />
      <Tile label="Blocked" value={String(blocked)} meaning={MEANING.blocked} icon={<FiShieldOff />} tint={hues.blocked}
        caption={blocked === 0 ? "Nothing was blocked" : (topReason && REASON[topReason]) || "stopped by the FortiGate"}
        active={show === "blocked"} onClick={blocked ? () => toggle("blocked") : undefined} />
      <Tile label="Reset or timed out" value={String(problem)} meaning={MEANING.problem} icon={<FiAlertTriangle />} tint={hues.problem}
        caption={problem === 0 ? "Every allowed connection finished normally" : "Let through, but did not finish normally"}
        active={show === "problem"} onClick={problem ? () => toggle("problem") : undefined} />
      <Tile label="Data" value={formatBytes(sent + rcvd)} meaning={MEANING.bytes} icon={<FiDatabase />} tint="#0EA5E9"
        caption={`sent ${formatBytes(sent)} · received ${formatBytes(rcvd)}`} />
    </div>
  );
};

export default SummaryTiles;
