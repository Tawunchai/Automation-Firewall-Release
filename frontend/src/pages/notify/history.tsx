import React, { useCallback, useEffect, useState } from "react";
import { FiBell, FiCheckCircle, FiRefreshCw, FiTrash2 } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import confirm from "../../components/ui/confirm";
import {
  ClearNotifyEvents, ListNotifyEvents, type NotifyEvent, type NotifyKindInfo,
} from "../../api/notify";
import { agoText, deliveryChip, deliveryText, severityChip } from "./format";
import { formatDateTime } from "../../lib/datetime";
import { apiErrorDetail } from "../../api/errorText";

// What was actually sent, and what became of it.
//
// Failed and no-recipient sends are listed alongside the successful ones and coloured as problems.
// A notification history that showed only what got through would read as quiet for exactly the same
// reason a disconnected smoke alarm does.

const PAGE = 50;

const History: React.FC<{ kinds: NotifyKindInfo[] }> = ({ kinds }) => {
  const [events, setEvents] = useState<NotifyEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState("");
  const [kind, setKind] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async (nextOffset: number) => {
    setLoading(true);
    try {
      const page = await ListNotifyEvents({
        state: state || undefined,
        kind: kind || undefined,
        limit: PAGE,
        offset: nextOffset,
      });
      setEvents(page.data ?? []);
      setTotal(page.total ?? 0);
      setOffset(nextOffset);
    } catch {
      setEvents([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [state, kind]);

  useEffect(() => { void load(0); }, [load]);

  const clear = async () => {
    const ok = await confirm({
      title: "Clear alerts older than 7 days?",
      content: "Anything from the last week is kept. This cannot be undone.",
      okText: "Clear old alerts",
    });
    if (!ok) return;
    try {
      const res = await ClearNotifyEvents(7);
      message.success(`${res.removed} alert(s) removed`);
      void load(0);
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not clear the history"));
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <MinimalSelect ariaLabel="Delivery state" size="sm" className="w-48" value={state} onChange={setState}
          options={[
            { value: "", label: "Firing and resolved" },
            { value: "firing", label: "Firing only" },
            { value: "resolved", label: "Resolved only" },
          ]} />
        <MinimalSelect ariaLabel="Check kind" size="sm" className="w-48" value={kind} onChange={setKind}
          options={[
            { value: "", label: "Every check" },
            ...kinds.map((k) => ({ value: k.kind, label: k.title })),
          ]} />
        <button type="button" className="btn btn-soft btn-sm" onClick={() => void load(offset)}>
          <FiRefreshCw size={12} /> Refresh
        </button>
        <span className="t-meta ml-auto">{total} alert{total === 1 ? "" : "s"}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clear()}>
          <FiTrash2 size={12} /> Clear old
        </button>
      </div>

      {loading ? (
        <div className="state-block py-14"><p className="state-title m-0">Loading the alert history…</p></div>
      ) : events.length === 0 ? (
        <div className="state-block py-14">
          <span className="state-icon"><FiBell size={18} /></span>
          <p className="state-title m-0">Nothing has been sent</p>
          <p className="state-text m-0">
            Either nothing has gone wrong, or no rule is watching for it yet. The Rules tab says
            which.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm">
          {events.map((ev) => (
            <div key={ev.id} className="border-b hairline-2 last:border-0">
              <button
                type="button"
                onClick={() => setExpanded(expanded === ev.id ? null : ev.id)}
                className="flex w-full flex-wrap items-center gap-2 px-3.5 py-2.5 text-left transition surface-hover"
              >
                <span
                  className="medallion h-6 w-6 shrink-0 text-[12px]"
                  style={
                    ev.state === "resolved"
                      ? { background: "rgba(16,185,129,0.12)", color: "#10b981" }
                      : ev.severity === "critical"
                        ? { background: "rgba(239,68,68,0.12)", color: "#ef4444" }
                        : { background: "rgba(245,158,11,0.13)", color: "#f59e0b" }
                  }
                >
                  {ev.state === "resolved" ? <FiCheckCircle /> : <FiBell />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-semibold ink">{ev.title}</span>
                  <span className="block truncate text-[11px] ink-3">
                    {ev.rule_name}
                    {ev.subject ? ` · ${ev.subject}` : ""}
                    {` · ${agoText(ev.created_at)}`}
                  </span>
                </span>

                <span className={ev.state === "resolved" ? "chip chip-ok" : severityChip(ev.severity)}>
                  {ev.state === "resolved" ? "resolved" : ev.severity}
                </span>
                <span className={deliveryChip(ev.delivery_status)}>
                  {deliveryText(ev.delivery_status, ev.delivered, ev.failed)}
                </span>
              </button>

              {expanded === ev.id && (
                <div className="border-t hairline-2 surface-sunken px-3.5 py-3">
                  <pre className="m-0 whitespace-pre-wrap font-sans text-[12px] leading-relaxed ink">
                    {ev.message}
                  </pre>
                  {ev.delivery_detail && (
                    <>
                      <p className="mb-1 mt-3 text-[10px] font-bold uppercase tracking-[0.09em] ink-3">
                        Delivery
                      </p>
                      <pre className="m-0 whitespace-pre-wrap font-mono text-[11px] leading-relaxed ink-2">
                        {ev.delivery_detail}
                      </pre>
                    </>
                  )}
                  <p className="mb-0 mt-2 text-[11px] ink-3">
                    {formatDateTime(ev.created_at)} · {ev.device_name}
                  </p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {total > PAGE && (
        <div className="flex items-center justify-between">
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={offset === 0}
            onClick={() => void load(Math.max(0, offset - PAGE))}
          >
            Newer
          </button>
          <span className="t-meta">{offset + 1}–{Math.min(offset + PAGE, total)} of {total}</span>
          <button
            type="button"
            className="btn btn-soft btn-sm"
            disabled={offset + PAGE >= total}
            onClick={() => void load(offset + PAGE)}
          >
            Older
          </button>
        </div>
      )}
    </div>
  );
};

export default History;
