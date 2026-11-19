import React, { useState } from "react";
import { FiAlertTriangle, FiCheck, FiChevronDown, FiChevronRight, FiHelpCircle, FiShield, FiX } from "react-icons/fi";
import type { PolicyTrace, PolicyVerdict, TraceCheck } from "../../api/troubleshoot";
import { checkFix } from "./trace-model";

// Every rule the walk looked at, with a ✓ or ✗ for each thing a rule matches on.
//
// A list of "skipped because srcintf…" sentences says why each rule failed FIRST; this says
// everything at once, so the rule that fails on one criterion stands out from the ones that fail on
// four — and the rules below the match that would also match (never reached) are on the same grid,
// under a line that says why they never ran.

const COLS: { field: TraceCheck["field"]; label: string }[] = [
  { field: "status", label: "On" },
  { field: "srcintf", label: "In" },
  { field: "dstintf", label: "Out" },
  { field: "srcaddr", label: "Source" },
  { field: "dstaddr", label: "Destination" },
  { field: "service", label: "Service" },
  { field: "schedule", label: "Schedule" },
];

const FIELD_LABEL: Record<TraceCheck["field"], string> = {
  status: "Enabled", srcintf: "Incoming interface", dstintf: "Outgoing interface",
  srcaddr: "Source address", dstaddr: "Destination address", service: "Service", schedule: "Schedule",
};

const fmtBytes = (n: number): string => {
  if (!n) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let v = n;
  let u = 0;
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u += 1; }
  return u === 0 ? `${v} B` : `${v.toFixed(1)} ${units[u]}`;
};

const Cell: React.FC<{ c?: TraceCheck }> = ({ c }) => {
  if (!c) return <td className="text-center ink-3">—</td>;
  return (
    <td className="text-center" title={c.detail}>
      <span className={`inline-flex h-5 w-5 items-center justify-center rounded-[4px] ${
        c.ok ? "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400" : "bg-rose-500/14 text-rose-600 dark:text-rose-400"}`}>
        {c.ok ? <FiCheck size={12} /> : <FiX size={12} />}
      </span>
      {c.unsure && <FiHelpCircle size={10} className="ml-0.5 inline text-amber-500" title={c.unsure} />}
    </td>
  );
};

type RowKind = "above" | "match" | "shadowed";

const Row: React.FC<{ v: PolicyVerdict; kind: RowKind; closest: boolean; order: number }> = ({ v, kind, closest, order }) => {
  const [open, setOpen] = useState(false);
  const byField = new Map(v.checks.map((c) => [c.field, c]));
  const tone = kind === "match"
    ? (v.action === "accept" ? "bg-emerald-500/8" : "bg-rose-500/8")
    : kind === "shadowed" ? "bg-amber-500/6" : "";

  return (
    <>
      <tr className={`cursor-pointer ${tone}`} onClick={() => setOpen(!open)}>
        <td className="w-8 text-center">
          {open ? <FiChevronDown size={12} className="ink-3" /> : <FiChevronRight size={12} className="ink-3" />}
        </td>
        <td className="td-num ink-3">{order > 0 ? order : "—"}</td>
        <td className="whitespace-nowrap">
          <span className="font-mono text-[11px] font-bold ink">{`#${v.policy_id}`}</span>{" "}
          <span className="ink-2">{v.name || "(unnamed)"}</span>
          {kind === "match" && <span className="chip chip-info ml-1.5 text-[10px]">match</span>}
          {closest && <span className="chip chip-warn ml-1.5 text-[10px]">closest</span>}
          {kind === "shadowed" && <span className="chip chip-warn ml-1.5 text-[10px]">never reached</span>}
        </td>
        <td>
          <span className={`chip text-[10px] ${v.action === "accept" ? "chip-ok" : "chip-danger"}`}>{v.action}</span>
        </td>
        {COLS.map((col) => <Cell key={col.field} c={byField.get(col.field)} />)}
        <td className="td-num text-right ink-3">{fmtBytes(v.bytes)}</td>
      </tr>
      {open && (
        <tr className={tone}>
          <td />
          <td colSpan={COLS.length + 4} className="py-2">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {v.checks.map((c) => (
                <div key={c.field} className="flex items-start gap-2 text-[11.5px]">
                  <span className={c.ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}>
                    {c.ok ? <FiCheck size={12} /> : <FiX size={12} />}
                  </span>
                  <span className="min-w-0">
                    <span className="font-semibold ink">{FIELD_LABEL[c.field]}</span>
                    <span className="ink-3">{" · "}</span>
                    <span className="font-mono text-[11px] ink-2">{c.want.length ? c.want.join(", ") : "—"}</span>
                    {c.got && <span className="ink-3">{` ← ${c.got}`}</span>}
                    {!c.ok && <span className="block text-[11px] text-rose-600 dark:text-rose-400">{`To match: ${checkFix(c)}`}</span>}
                    {c.unsure && <span className="block text-[11px] text-amber-600 dark:text-amber-400">{c.unsure}</span>}
                  </span>
                </div>
              ))}
            </div>
            <p className="t-meta m-0 mt-2 flex flex-wrap items-center gap-x-3">
              <span>{`${fmtBytes(v.bytes)} carried · ${v.active_sessions} active sessions`}</span>
              {v.nat && <span>NAT on</span>}
              {v.profiles?.length ? (
                <span className="inline-flex items-center gap-1"><FiShield size={11} /> {v.profiles.join(", ")}</span>
              ) : v.action === "accept" ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                  <FiAlertTriangle size={11} /> no security profile
                </span>
              ) : null}
            </p>
          </td>
        </tr>
      )}
    </>
  );
};

const PolicyMatrix: React.FC<{ trace: PolicyTrace }> = ({ trace }) => {
  const closestIds = new Set((trace.closest ?? []).map((p) => p.policy_id));
  const rows = trace.evaluated;
  const shadowed = trace.shadowed ?? [];

  return (
    <div className="overflow-x-auto">
      <table className="shell-table">
        <thead>
          <tr>
            <th />
            <th className="text-right">Order</th>
            <th>Policy</th>
            <th>Action</th>
            {COLS.map((c) => <th key={c.field} className="text-center">{c.label}</th>)}
            <th className="text-right">Traffic</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v, i) => (
            <Row key={`e-${v.policy_id}`} v={v} kind={v.matched ? "match" : "above"} closest={closestIds.has(v.policy_id)} order={i + 1} />
          ))}
          {shadowed.length > 0 && (
            <tr>
              <td colSpan={COLS.length + 5} className="t-meta py-1.5 text-amber-700 dark:text-amber-400">
                {`Below the match — these would also match, but are never reached because #${trace.matched?.policy_id} comes first:`}
              </td>
            </tr>
          )}
          {shadowed.map((v) => (
            <Row key={`s-${v.policy_id}`} v={v} kind="shadowed" closest={false} order={0} />
          ))}
        </tbody>
      </table>
      {trace.below > 0 && shadowed.length === 0 && (
        <p className="t-meta m-0 mt-2">
          {`The ${trace.below} policies below the match were checked too, and none of them would have matched.`}
        </p>
      )}
    </div>
  );
};

export default PolicyMatrix;
