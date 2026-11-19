import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  FiActivity, FiAlertTriangle, FiFilter, FiRefreshCw, FiSlash, FiTrash2,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceGetPolicyUsage, type PolicyState, type PolicyUsage, type PolicyUsageReport,
} from "../../api/lifecycle";
import { DeviceDeletePolicy } from "../../api/policyObject";
import { ADVICE_LABEL, STATE_STYLE, bytesText, deleteRisk, idleText, sortByPriority, sparkline } from "./format";
import PolicyHitHistory from "./history";
import { apiErrorText } from "../../api/errorText";

// Policy Hit-Count & Rule Lifecycle.
//
// The Firewall Policy page answers "what rules exist". This one answers the question nobody could
// answer before: "which of these are dead?" — by joining the CMDB table to the device's own
// per-policy hit counters (monitor/firewall/policy).
//
// The report itself is READ-ONLY: it classifies, it never acts. The one write on this page is the
// delete button on each row, which finishes the job the page starts — it is the same
// DeviceDeletePolicy call the Firewall Policy page makes (DELETE by policy id, never at the
// collection URL) behind the same confirmation dialog, plus the one thing that page cannot say:
// what the counters know about the rule being removed. See deleteRisk in format.ts.

const THRESHOLDS = [30, 60, 90, 180];

const Sparkline: React.FC<{ values: number[]; color: string }> = ({ values, color }) => {
  if (values.length === 0) return <span className="text-[10px] ink-3">—</span>;
  return (
    <span className="inline-flex h-4 items-end gap-0.5" title="Daily hit count, the last 8 buckets reported by the device">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-0.75 rounded-sm"
          style={{ height: `${Math.max(2, v * 16)}px`, background: v > 0 ? color : "#cbd5e1" }}
        />
      ))}
    </span>
  );
};

const RuleLifecyclePage: React.FC = () => {
  const { currentColor } = useStateContext();

  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();

  const { device } = useSelectedDevice();
  const [report, setReport] = useState<PolicyUsageReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleDays, setStaleDays] = useState(90);
  const [filter, setFilter] = useState<PolicyState | "all" | "removable">("all");
  const [deleteTarget, setDeleteTarget] = useState<PolicyUsage | null>(null);
  const [deleting, setDeleting] = useState(false);

  const run = useCallback(async (d: NetworkDevice, days: number) => {
    setLoading(true);
    setError(null);
    try {
      setReport(await DeviceGetPolicyUsage(d.id, days));
    } catch (e) {
      setReport(null);
      setError(apiErrorText(e, "Could not read the counters from the device"));
    } finally {
      setLoading(false);
    }
  }, []);

  // Reading counters is free and read-only, so it runs as soon as a device is picked rather than
  // making the user press a button to learn anything at all.
  useEffect(() => {
    setReport(null);
    setError(null);
    setDeleteTarget(null); // a dialog left open across a device switch would delete on the wrong box
    if (device) void run(device, staleDays);
  }, [device, staleDays, run]);

  // The rule is removed BY ITS POLICY ID — never at the collection URL, which on this device empties
  // the whole policy table and cannot be undone (see the skill's first gotcha). The report is then
  // re-read from the device rather than patched locally: the counters, the summary chips and the
  // remaining rules' states all come from the firewall, and guessing them here would drift.
  const handleDelete = async () => {
    if (!deleteTarget || !device) return;
    setDeleting(true);
    try {
      await DeviceDeletePolicy(device.id, deleteTarget.policyid);
      message.success(`Deleted policy ${deleteTarget.policyid} ${deleteTarget.name || ""} from the device`);
      setDeleteTarget(null);
      await run(device, staleDays);
    } catch (e) {
      // FortiGate refuses to delete a policy something else still references (error -23); the rule
      // is still there, so the dialog stays open with the reason.
      message.error(apiErrorText(e, "Could not delete the policy"));
    } finally {
      setDeleting(false);
    }
  };

  // The busiest rules, by the counter as it stands — the chart below plots their history. Taken
  // from the unfiltered report rather than `rows`, so changing the table's filter does not silently
  // repaint the chart's lines onto different rules.
  const busiest = useMemo(
    () => [...(report?.policies ?? [])]
      .filter((p) => p.hit_count > 0)
      .sort((a, b) => b.hit_count - a.hit_count)
      .slice(0, 4)
      .map((p) => ({ policyid: p.policyid, name: p.name || `Policy ${p.policyid}` })),
    [report],
  );

  const rows = useMemo(() => {
    const all = sortByPriority(report?.policies ?? []);
    if (filter === "all") return all;
    if (filter === "removable") return all.filter((p) => p.advice === "remove");
    return all.filter((p) => p.state === filter);
  }, [report, filter]);

  const s = report?.summary;

  const chips: { key: PolicyState | "all" | "removable"; label: string; count: number; color?: string }[] = [
    { key: "all", label: "All", count: s?.total ?? 0 },
    { key: "removable", label: "Suggested for removal", count: s?.removable ?? 0, color: "#b91c1c" },
    { key: "never-used", label: STATE_STYLE["never-used"].label, count: s?.never_used ?? 0, color: STATE_STYLE["never-used"].color },
    { key: "stale", label: STATE_STYLE.stale.label, count: s?.stale ?? 0, color: STATE_STYLE.stale.color },
    { key: "idle", label: STATE_STYLE.idle.label, count: s?.idle ?? 0, color: STATE_STYLE.idle.color },
    { key: "disabled", label: STATE_STYLE.disabled.label, count: s?.disabled ?? 0, color: STATE_STYLE.disabled.color },
    { key: "active", label: STATE_STYLE.active.label, count: s?.active ?? 0, color: STATE_STYLE.active.color },
  ];

  return (
    <div className="p-1">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: the
          stale-threshold picker and the manual refresh. The total/removable counts it used to
          badge are not lost, just not repeated here — the state breakdown below already shows
          them. */}
      <div className="mb-4 flex items-center justify-end gap-2">
        <div className="flex items-center gap-1.5">
          <FiFilter size={11} className="ink-3" />
          <span className="text-[11px] ink-2">Threshold</span>
          <MinimalSelect
            size="sm"
            className="w-28"
            value={String(staleDays)}
            onChange={(v) => setStaleDays(Number(v))}
            ariaLabel="How many idle days before a rule counts as stale"
            options={THRESHOLDS.map((d) => ({ value: String(d), label: `${d} days` }))}
          />
        </div>
        <button
          onClick={() => device && run(device, staleDays)}
          disabled={!device || loading}
          className="btn btn-ghost btn-sm"
        >
          <FiRefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {!device ? (
        <div className="flex flex-col items-center rounded-sm border border-dashed hairline py-16 ink-3">
          <FiActivity size={28} className="mb-3 opacity-30" />
          <p className="text-[13px]">Pick a device to see which rules are still being used</p>
          <p className="mt-1 text-[11px] ink-3">Read-only — nothing is written to the device</p>
        </div>
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 rounded-sm border hairline-2 py-16 text-[12.5px] ink-3">
          <div className="h-4 w-4 animate-spin rounded-full border-2 hairline border-t-transparent" />
          Reading the policies and their hit counters from the device…
        </div>
      ) : error ? (
        <div className="rounded-sm border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
          {error}
        </div>
      ) : report ? (
        <div className="space-y-4">
          {/*
            Counters unavailable is its own state, not an empty result: without them every rule
            decodes as never-used, and telling an operator the whole rule base is dead would be
            worse than telling them nothing.
          */}
          {!report.counters_available && (
            <div className="flex items-start gap-2 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
              <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                The device did not return hit counters (monitor/firewall/policy), so this page <strong>reaches no verdict</strong>
                about which rules are dead, rather than reporting that all of them are
              </span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {chips.map((c) => {
              const on = filter === c.key;
              return (
                <button
                  key={c.key}
                  onClick={() => setFilter(c.key)}
                  className="rounded-[5px] px-2.5 py-1 text-[11px] font-bold transition"
                  style={{
                    background: on ? (c.color ?? currentColor) : "transparent",
                    color: on ? "#fff" : (c.color ?? "#64748b"),
                    border: `1px solid ${on ? "transparent" : `${c.color ?? "#cbd5e1"}55`}`,
                  }}
                >
                  {c.label} · {c.count}
                </button>
              );
            })}
          </div>

          <div className="shell-card overflow-hidden p-0!">
            <div className="overflow-x-auto">
              <table className="w-full min-w-225 text-left">
                <thead>
                  <tr className="border-b hairline-2 text-[10.5px] uppercase tracking-wide ink-3">
                    <th className="px-3 py-2 font-bold">ID</th>
                    <th className="px-3 py-2 font-bold">Name</th>
                    <th className="px-3 py-2 font-bold">State</th>
                    <th className="px-3 py-2 font-bold">Last used</th>
                    <th className="px-3 py-2 text-right font-bold">hits</th>
                    <th className="px-3 py-2 text-right font-bold">traffic</th>
                    <th className="px-3 py-2 text-right font-bold">sessions</th>
                    <th className="px-3 py-2 font-bold">7 days</th>
                    <th className="px-3 py-2 font-bold">Advice</th>
                    {isAdmin && <th className="px-3 py-2 font-bold" style={{ width: 44 }}></th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr>
                      <td colSpan={isAdmin ? 10 : 9} className="px-3 py-10 text-center text-[12px] ink-3">
                        No rule in this category
                      </td>
                    </tr>
                  ) : (
                    rows.map((p) => {
                      const st = STATE_STYLE[p.state];
                      return (
                        <tr key={p.policyid} className="border-b hairline-2 text-[12px] last:border-0">
                          <td className="px-3 py-2 font-mono ink-2">{p.policyid}</td>
                          <td className="px-3 py-2">
                            <span className="font-semibold ink">{p.name || "(unnamed)"}</span>
                            <span className="ml-1.5 text-[10.5px] uppercase ink-3">{p.action}</span>
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className="inline-block rounded-[5px] px-2 py-0.5 text-[10.5px] font-bold"
                              style={{ color: st.color, background: st.bg, border: `1px solid ${st.border}` }}
                            >
                              {st.label}
                            </span>
                          </td>
                          <td className="px-3 py-2 ink-2">{idleText(p.idle_days)}</td>
                          <td className="px-3 py-2 text-right font-mono ink-2">{p.hit_count}</td>
                          <td className="px-3 py-2 text-right font-mono ink-2">{bytesText(p.bytes)}</td>
                          <td className="px-3 py-2 text-right font-mono ink-2">{p.active_sessions}</td>
                          <td className="px-3 py-2"><Sparkline values={sparkline(p.week_hits)} color={st.color} /></td>
                          <td className="px-3 py-2">
                            {p.advice ? (
                              <span
                                className="inline-flex items-center gap-1 text-[11px] font-semibold"
                                style={{ color: p.advice === "remove" ? "#b91c1c" : "#b45309" }}
                              >
                                {p.advice === "remove" ? <FiSlash size={11} /> : <FiAlertTriangle size={11} />}
                                {ADVICE_LABEL[p.advice]}
                              </span>
                            ) : (
                              <span className="text-[11px] ink-3">—</span>
                            )}
                          </td>
                          {isAdmin && (
                            <td className="px-3 py-2">
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(p)}
                                className="btn-icon btn-icon--danger"
                                title={`Delete policy ${p.policyid} from the device`}
                                aria-label={`Delete policy ${p.policyid} ${p.name}`}
                              >
                                <FiTrash2 size={13} />
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {device && (
            <PolicyHitHistory deviceId={device.id} policies={busiest} currentColor={currentColor} />
          )}

          <div className="shell-card p-3.5 text-[11.5px] leading-relaxed ink-2">
            <p className="mb-1.5 font-bold ink-2">How to read this</p>
            <ul className="space-y-1">
              {(Object.keys(STATE_STYLE) as PolicyState[]).map((k) => (
                <li key={k}>
                  <span className="font-semibold" style={{ color: STATE_STYLE[k].color }}>{STATE_STYLE[k].label}</span>
                  {" — "}{STATE_STYLE[k].blurb}
                </li>
              ))}
            </ul>
            <p className="mt-2">
              Current thresholds: traffic within {report.active_days} days = active · silent for more than {report.stale_days} days = stale
            </p>
          </div>
        </div>
      ) : null}

      {/* Delete confirm — the same dialog the Firewall Policy page uses, plus the counters this page
          is the only one that has. A rule the report itself flagged as dead needs no scare line; one
          that still carries traffic gets the reason spelled out (deleteRisk). */}
      {deleteTarget && (
        <ConfirmDeleteModal
          title="Delete this policy from the firewall?"
          busy={deleting}
          confirmLabel="Delete policy"
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          <p className="m-0">
            Policy <strong className="ink">#{deleteTarget.policyid}</strong>{" "}
            <strong className="ink">"{deleteTarget.name || "(unnamed)"}"</strong>
            {device ? ` will be permanently removed from ${device.name}` : " will be permanently removed"}
          </p>

          <div className="mt-2 rounded-[5px] border hairline surface-sunken px-2.5 py-2 text-[11.5px] ink-2">
            <div className="flex justify-between gap-3">
              <span className="ink-3">State</span>
              <span className="font-semibold" style={{ color: STATE_STYLE[deleteTarget.state].color }}>
                {STATE_STYLE[deleteTarget.state].label}
              </span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3">
              <span className="ink-3">Last used</span>
              <span className="font-semibold">{idleText(deleteTarget.idle_days)}</span>
            </div>
            <div className="mt-0.5 flex justify-between gap-3">
              <span className="ink-3">hits / traffic / sessions</span>
              <span className="font-mono">
                {deleteTarget.hit_count} · {bytesText(deleteTarget.bytes)} · {deleteTarget.active_sessions}
              </span>
            </div>
          </div>

          {(() => {
            const risk = report ? deleteRisk(deleteTarget, report.counters_available) : null;
            return risk ? (
              <p className="mt-2 mb-0 flex items-start gap-1.5 rounded-sm border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11.5px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-400">
                <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>{risk}</span>
              </p>
            ) : null;
          })()}

          <p className="mt-2 mb-0 text-[11px] ink-3">
            This device runs cfg-save automatic — once deleted there is no revision to roll back to
          </p>
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default RuleLifecyclePage;
