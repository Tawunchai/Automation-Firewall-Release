import React, { useCallback, useEffect, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { FiTrendingDown, FiUserCheck } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { confirm } from "../../components/ui/confirm";
import {
  DeviceAuditHistory, DeviceListAuditExceptions, DeviceRevokeAuditException,
  type AuditException, type AuditTrendPoint,
} from "../../api/policyObject";
import { formatDate, formatDateTime } from "../../lib/datetime";

// Audit / Review ▸ Trend
//
// One scan says what is wrong today. This says whether anyone is fixing it — which is the question
// asked at the second meeting, and the one a point-in-time report can never answer.
//
// Not every scan is a point on this chart. The page rescans whenever a device is selected, so the
// backend stores a run only when the findings actually CHANGED, or when enough time has passed that
// "still the same" is itself worth recording (services/audit_history.go). Without that rule the
// chart would be a wall of identical points and would show nothing at all.
//
// The accepted-risk register lives here rather than on the Findings tab because it is a governance
// record, read as a list, not something you act on while looking at one rule.

const SERIES = [
  { key: "high", label: "High", color: "#b91c1c" },
  { key: "medium", label: "Medium", color: "#b45309" },
  { key: "low", label: "Low", color: "#0369a1" },
] as const;

const TrendView: React.FC<{ deviceId: number; isAdmin: boolean }> = ({ deviceId, isAdmin }) => {
  const [points, setPoints] = useState<AuditTrendPoint[]>([]);
  const [exceptions, setExceptions] = useState<AuditException[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, e] = await Promise.all([DeviceAuditHistory(deviceId), DeviceListAuditExceptions(deviceId)]);
      setPoints(p);
      setExceptions(e.exceptions);
    } catch {
      setPoints([]);
      setExceptions([]);
    } finally {
      setLoading(false);
    }
  }, [deviceId]);

  useEffect(() => { void load(); }, [load]);

  const revoke = async (row: AuditException) => {
    const ok = await confirm({
      title: "Withdraw this acceptance?",
      content: `${row.subject} goes back to being an open finding. The record of the acceptance is kept — it is not deleted.`,
      okText: "Withdraw",
    });
    if (!ok) return;
    try {
      await DeviceRevokeAuditException(deviceId, row.id);
      message.success("Acceptance withdrawn");
      void load();
    } catch {
      message.error("Could not withdraw the acceptance");
    }
  };

  const chartData = points.map((p) => ({ ...p, at: formatDate(p.scanned_at) }));

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-sm border hairline-2 py-16 text-[12.5px] ink-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 hairline border-t-transparent" />
        Reading the scan history…
      </div>
    );
  }

  const now = Date.now();

  return (
    <div className="space-y-3">
      {points.length < 2 ? (
        <div className="flex flex-col items-center rounded-sm border border-dashed hairline py-12 text-center ink-3">
          <FiTrendingDown size={26} className="mb-3 opacity-30" />
          <p className="text-[13px]">Not enough history to draw a trend yet</p>
          <p className="mt-1 max-w-md text-[11px]">
            A scan is stored when its findings differ from the previous one, or once every 12 hours if nothing
            has changed. Come back after the next change to this firewall.
          </p>
        </div>
      ) : (
        <div className="rounded-sm border hairline-2 surface-card p-4 shadow-sm">
          <p className="mb-1 text-[12.5px] font-bold ink">Open findings over time</p>
          <p className="mb-3 text-[11px] ink-3">
            {points.length} stored scans · accepted risks are excluded, so a line falling because somebody signed
            a waiver looks the same as one falling because somebody fixed the rule — check the register below.
          </p>
          <div className="min-w-0" style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer minWidth={0} debounce={80}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--shell-border)" />
                <XAxis dataKey="at" tick={{ fontSize: 10, fill: "var(--shell-ink-3)" }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: "var(--shell-ink-3)" }} />
                <Tooltip
                  contentStyle={{
                    background: "var(--shell-card)", border: "1px solid var(--shell-border)",
                    borderRadius: 10, fontSize: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {SERIES.map((s) => (
                  <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="1"
                    stroke={s.color} fill={s.color} fillOpacity={0.22} />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-2 border-t hairline-2 pt-2 text-[11px] ink-3">
            Latest scan {formatDateTime(points[points.length - 1].scanned_at)}
            {points[points.length - 1].user_email && ` · run by ${points[points.length - 1].user_email}`}
          </p>
        </div>
      )}

      {/* The register. Expired and withdrawn rows stay: "this was accepted between March and July"
          is part of the trail, and a trail that can be tidied away is not one. */}
      <div className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm">
        <p className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 text-[12.5px] font-bold ink">
          <FiUserCheck size={13} /> Accepted risk register
          <span className="rounded-[5px] surface-sunken px-1.5 py-0.5 text-[10px] font-bold ink-2">{exceptions.length}</span>
        </p>

        {exceptions.length === 0 ? (
          <p className="px-4 py-8 text-center text-[12px] ink-3">
            Nothing on this firewall is running on a waiver.
          </p>
        ) : (
          exceptions.map((row) => {
            const revoked = !!row.revoked_at;
            const expired = !revoked && new Date(row.expires_at).getTime() < now;
            const live = !revoked && !expired;
            return (
              <div key={row.id} className="flex flex-wrap items-start gap-x-3 gap-y-1.5 border-t hairline-2 px-4 py-2.5">
                <span className="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold"
                  style={live
                    ? { color: "#7c3aed", background: "#8b5cf612" }
                    : { color: "#64748b", background: "#94a3b81a" }}>
                  {revoked ? "WITHDRAWN" : expired ? "EXPIRED" : "IN FORCE"}
                </span>
                <div className="min-w-[220px] flex-1">
                  <p className="font-mono text-[11.5px] ink">{row.subject}</p>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed ink-2">{row.reason}</p>
                  <p className="mt-0.5 text-[10.5px] ink-3">
                    {row.check} · accepted by {row.approved_by} on {formatDate(row.approved_at)} ·
                    {revoked ? ` withdrawn by ${row.revoked_by || "—"} on ${formatDate(row.revoked_at)}` : ` expires ${formatDate(row.expires_at)}`}
                  </p>
                </div>
                {isAdmin && live && (
                  <button type="button" onClick={() => void revoke(row)}
                    className="shrink-0 rounded-[4px] border hairline px-2 py-1 text-[11px] font-semibold ink-2 surface-hover">
                    Withdraw
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default TrendView;
