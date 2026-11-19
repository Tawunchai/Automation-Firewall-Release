import React, { useCallback, useEffect, useState } from "react";
import {
  FiAlertTriangle, FiChevronDown, FiChevronLeft, FiChevronRight, FiClock, FiCornerUpLeft, FiEdit3,
  FiEyeOff, FiInfo, FiList, FiMinus, FiPlus, FiRotateCcw, FiShield, FiUser,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { confirm } from "../../components/ui/confirm";
import RestoreConfirmModal from "../device/RestoreConfirmModal";
import { GetChange, RevertChange } from "../../api/ledger";
import {
  GetDriftAttribution, GetDriftFinding, GetTimeline, UndoDriftFinding,
  type DriftAttribution, type TimelineCounts, type TimelineFilter, type TimelineItem,
} from "../../api/drift";
import { formatDateTime } from "../../lib/datetime";
import { errorText } from "./analytics";
import { ACTION_VERB, fallbackExplanation, statusOf, type RowStatus } from "./timeline-model";

// The page's one list: every change to the selected firewall, newest first.
//
// Two kinds of row, told apart by a coloured origin tag that matches the charts:
//   · Through this console — from the Change Ledger: who, when, the object before and after.
//   · Outside the console  — found by comparing two backups; nobody here recorded it.
//
// An outside row also carries a name when the firewall can still supply one. The console never saw
// the change, but the device logged it, so the names are fetched separately from the device
// (GetDriftAttribution) once the history is on screen — never as part of it, because the history
// has to render while the firewall is unreachable and the names cannot.
//
// Every row answers "can I take this back?" in its own words (timeline-model.ts), and the button
// next to it does exactly that and nothing else: Undo for one change, Restore for the backup before
// it. What a row carries in full — snapshots, diff lines — is fetched when it is opened, so the list
// itself stays small whatever the history's size.

const PAGE_SIZE = 5;

const CHIPS: { key: TimelineFilter; label: string }[] = [
  { key: "all", label: "Everything" },
  { key: "console", label: "Centralize MGMT" },
  { key: "outside", label: "Local MGMT" },
  { key: "failed", label: "Rejected by the device" },
];

const ACTION_ICON = {
  create: <FiPlus size={12} />,
  update: <FiEdit3 size={12} />,
  delete: <FiMinus size={12} />,
} as const;

const STATUS_CHIP: Record<RowStatus, { label: string; chip: string; icon?: React.ReactNode }> = {
  applied:  { label: "Applied", chip: "chip-ok" },
  failed:   { label: "Rejected by the device", chip: "chip-danger", icon: <FiAlertTriangle size={10} /> },
  reverted: { label: "Undone", chip: "" , icon: <FiRotateCcw size={10} /> },
  // An outside change that nothing has taken back. Stated, not alarmed: unrecorded is not wrong.
  standing: { label: "Still in place", chip: "chip-info", icon: <FiEyeOff size={10} /> },
  undone:   { label: "Undone", chip: "", icon: <FiRotateCcw size={10} /> },
};

/** What an opened row loaded: console snapshots, or an outside change's ±lines. */
type Loaded = { before?: unknown; after?: unknown; diff?: string; error?: string };

const rowKey = (it: TimelineItem) => `${it.kind}:${it.id}`;

const JSONBlock: React.FC<{ title: string; value: unknown; present: boolean }> = ({ title, value, present }) => (
  <div className="min-w-0 flex-1">
    <p className="mb-1 text-[10px] font-bold uppercase tracking-wide ink-3">{title}</p>
    <pre className="max-h-56 overflow-auto code-surface rounded-[4px] p-2">
      {!present || value === undefined || value === null ? "—" : JSON.stringify(value, null, 2)}
    </pre>
  </div>
);

export const DiffBlock: React.FC<{ text: string }> = ({ text }) => (
  <pre className="max-h-64 overflow-auto code-surface rounded-[4px] p-2">
    {text.split("\n").map((l, i) => (
      <div key={i} className={l.startsWith("+") ? "text-emerald-400" : l.startsWith("-") ? "text-red-400" : ""}>{l}</div>
    ))}
  </pre>
);

// ── Who made an outside change ──────────────────────────────────────────────
//
// Three answers, and the difference between the last two is the point. "The log no longer reaches
// this" is a statement about the firewall's memory; "the log covers this and names nobody" is a
// statement about the change. Collapsing them into "unknown" would turn a storage limit into an
// accusation, and an accusation into a shrug.

/** The one-line answer, under the row's own meta line. */
const AttributionLine: React.FC<{ att: DriftAttribution }> = ({ att }) => {
  const e = att.events?.[0];
  const more = (att.events?.length ?? 0) - 1;
  return (
    <p className="t-meta m-0 mt-0.5 flex flex-wrap items-center gap-x-1.5">
      <FiUser size={10} className="shrink-0" />
      {att.status === "matched" && e ? (
        <>
          <span className="font-semibold ink-2">
            {e.source_ip
              ? `By ${e.user} over ${e.via} from ${e.source_ip}`
              : `By ${e.user} over ${e.via}`}
          </span>
          {more === 1 && <span>and one more change to it</span>}
          {more > 1 && <span>{`and ${more} more changes to it`}</span>}
        </>
      ) : att.status === "out-of-reach" ? (
        <span>The firewall's log no longer goes back this far</span>
      ) : (
        <span>The firewall's log covers this time and names nobody</span>
      )}
    </p>
  );
};

/** Every event behind the line above, shown when the row is opened. */
const AttributionDetail: React.FC<{ att: DriftAttribution }> = ({ att }) => {
  if (att.status !== "matched" || !att.events?.length) return null;
  return (
    <div>
      <p className="mb-1 text-[10px] font-bold uppercase tracking-wide ink-3">
        What the firewall logged
      </p>
      <div className="overflow-x-auto rounded-[4px] border hairline-2">
        <table className="shell-table">
          <thead>
            <tr><th>When</th><th>Action</th><th>Account</th><th>Connected from</th><th>Values changed</th></tr>
          </thead>
          <tbody>
            {att.events.map((e, i) => (
              <tr key={`${e.at}-${i}`}>
                <td className="whitespace-nowrap align-top">{formatDateTime(e.at)}</td>
                <td className="whitespace-nowrap align-top font-semibold ink">{e.action}</td>
                <td className="whitespace-nowrap align-top">{e.user || "—"}</td>
                <td className="whitespace-nowrap align-top font-mono text-[11px]">
                  {e.source_ip ? `${e.via} ${e.source_ip}` : e.via || "—"}
                </td>
                <td className="align-top font-mono text-[11px] ink-2">{e.attrs || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Said here rather than nowhere: "GUI" is the device's word for its web interface AND for
          every REST call, so it cannot be read as "somebody used the web interface". */}
      <p className="t-meta m-0 mt-1.5">
        The firewall records every API call as “GUI” as well, so that word means the web interface
        or a tool — the address is what tells them apart.
      </p>
    </div>
  );
};

const Row: React.FC<{
  it: TimelineItem;
  isAdmin: boolean;
  consoleHue: string;
  outsideHue: string;
  busy: boolean;
  loaded: Loaded | undefined;
  /** What the firewall's log says about this row. Undefined until it has been asked for. */
  att: DriftAttribution | undefined;
  onOpen: (it: TimelineItem) => void;
  onUndo: (it: TimelineItem) => void;
  onRestore: (it: TimelineItem) => void;
}> = ({ it, isAdmin, consoleHue, outsideHue, busy, loaded, att, onOpen, onUndo, onRestore }) => {
  const [open, setOpen] = useState(false);
  const outside = it.kind === "outside";
  const status = statusOf(it);
  const chip = STATUS_CHIP[status];
  const hue = outside ? outsideHue : consoleHue;

  const toggle = () => {
    if (!open) onOpen(it);
    setOpen(!open);
  };

  return (
    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2 px-3.5 py-2.5">
        <button type="button" onClick={toggle} aria-expanded={open} aria-label="Show details"
          className="btn-icon mt-0.5 shrink-0">
          {open ? <FiChevronDown size={13} /> : <FiChevronRight size={13} />}
        </button>

        <div role="presentation" className="min-w-0 flex-1 cursor-pointer" onClick={toggle}>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {/* Origin tag — the same two colours as the charts, with a word, never colour alone. */}
            <span className="inline-flex items-center gap-1 rounded-[4px] px-1.5 py-0.5 text-[10px] font-bold"
              style={{ color: hue, background: `${hue}1a` }}>
              {outside ? <FiEyeOff size={10} /> : <FiShield size={10} />}
              {outside ? "Local MGMT" : "Centralize MGMT"}
            </span>
            <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold ink">
              <span className="ink-3">{ACTION_ICON[it.action]}</span>
              {ACTION_VERB[it.action]}
            </span>
            <span className="font-mono text-[11.5px] ink-2">{it.table || "—"}</span>
            {it.key && <span className="font-mono text-[11.5px] font-semibold ink">{it.key}</span>}
            <span className={`chip ${chip.chip} text-[10px]`}>{chip.icon} {chip.label}</span>
            {it.revert_of_id && <span className="chip text-[10px]">{`Undo of #${it.revert_of_id}`}</span>}
          </div>
          <p className="t-meta m-0 mt-0.5 truncate">
            {outside
              ? it.window_from && it.window_to
                ? `Happened between ${formatDateTime(it.window_from)} and ${formatDateTime(it.window_to)} — found by backup comparison`
                : `Found by backup comparison ${formatDateTime(it.at)}`
              : `${it.user || "(system)"} · ${formatDateTime(it.at)}`}
            {it.device_name ? ` · ${it.device_name}` : ""}
          </p>
          {outside && att && <AttributionLine att={att} />}
        </div>

        {isAdmin && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {it.fallback === "undo" && (
              <button type="button" disabled={busy} onClick={() => onUndo(it)}
                className="inline-flex items-center gap-1 rounded-[4px] border border-amber-300 px-2.5 py-1 text-[11px] font-semibold text-amber-700 transition hover:bg-amber-50 disabled:opacity-40 dark:border-amber-500/30 dark:text-amber-400 dark:hover:bg-amber-500/10">
                <FiCornerUpLeft size={11} /> Undo
              </button>
            )}
            {it.fallback === "restore" && status !== "undone" && (
              <button type="button" disabled={busy} onClick={() => onRestore(it)}
                className="inline-flex items-center gap-1 rounded-[4px] border hairline px-2.5 py-1 text-[11px] font-semibold ink-2 transition surface-hover disabled:opacity-40">
                <FiRotateCcw size={11} /> Restore backup…
              </button>
            )}
          </div>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t hairline-2 surface-sunken px-4 py-3">
          {/* Can this be taken back — the question people open a row to answer. */}
          <div className="flex items-start gap-2 rounded-[4px] border hairline-2 surface-card px-3 py-2">
            <FiInfo size={13} className="mt-0.5 shrink-0" style={{ color: hue }} />
            <div className="min-w-0">
              <p className="t-label m-0">Can this be taken back?</p>
              <p className="t-body m-0 ink-2">{fallbackExplanation(it)}</p>
            </div>
          </div>

          {!outside && it.reverted_at && (
            <p className="t-meta m-0">{`Undone ${formatDateTime(it.reverted_at)} by ${it.reverted_by || "—"}`}</p>
          )}
          {it.error_text && (
            <p className="m-0 rounded-[4px] border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11.5px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
              {it.error_text}
            </p>
          )}

          {loaded?.error ? (
            <p className="t-meta m-0 flex flex-wrap items-center gap-2 text-red-600 dark:text-red-400">
              {loaded.error}
              <button type="button" onClick={() => onOpen(it)}
                className="rounded-[4px] border hairline px-2 py-0.5 text-[10.5px] font-semibold ink-2 surface-hover">
                Retry
              </button>
            </p>
          ) : !loaded ? (
            <p className="t-meta m-0 flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 hairline border-t-transparent" />
              Loading the details…
            </p>
          ) : outside ? (
            <>
              <div>
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wide ink-3">What changed in the backup</p>
                {loaded.diff ? <DiffBlock text={loaded.diff} /> : <p className="t-meta m-0">No line detail was stored for this object.</p>}
              </div>
              {att && <AttributionDetail att={att} />}
            </>
          ) : (
            <>
              {it.via && <p className="t-meta m-0">{`Made by the console's ${it.via} feature`}</p>}
              <div className="flex flex-col gap-2 sm:flex-row">
                <JSONBlock title="Before" value={loaded.before} present={!!it.has_before} />
                <JSONBlock title="After" value={loaded.after} present={!!it.has_after} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const ChangeTimeline: React.FC<{
  isAdmin: boolean;
  deviceId: number | undefined;
  deviceName: string;
  filter: TimelineFilter;
  onFilter: (f: TimelineFilter) => void;
  consoleHue: string;
  outsideHue: string;
  reloadKey: number;
  onChanged: () => void;
}> = ({ isAdmin, deviceId, deviceName, filter, onFilter, consoleHue, outsideHue, reloadKey, onChanged }) => {
  const [rows, setRows] = useState<TimelineItem[]>([]);
  const [counts, setCounts] = useState<TimelineCounts | null>(null);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<Record<string, Loaded>>({});
  const [restoreId, setRestoreId] = useState<number | null>(null);

  // The names, from the device. Asked for after the list is on screen and never blocking it: this
  // is the one read on the page that needs the firewall to answer.
  const [attribution, setAttribution] = useState<Record<string, DriftAttribution>>({});
  const [attributionError, setAttributionError] = useState<string | null>(null);

  // A new filter or device starts at page one — reset during render so the stale offset is never
  // fetched at all.
  const scopeKey = `${deviceId ?? ""}|${filter}`;
  const [seenScope, setSeenScope] = useState(scopeKey);
  if (seenScope !== scopeKey) {
    setSeenScope(scopeKey);
    setOffset(0);
  }

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await GetTimeline({ device_id: deviceId, filter, limit: PAGE_SIZE, offset });
      setRows(page.data);
      setTotal(page.total);
      setCounts(page.counts);
    } catch (e: unknown) {
      setRows([]);
      setError(errorText(e, "Could not read the change history"));
    } finally {
      setLoading(false);
    }
  }, [deviceId, filter, offset]);

  useEffect(() => { void load(); }, [load, reloadKey]);

  // One read per device, once there is an outside row to annotate. Not per row and not per page:
  // the device returns its whole config-change log in one call, and the join is done server-side.
  const hasOutside = rows.some((r) => r.kind === "outside");
  useEffect(() => {
    if (!deviceId || !hasOutside) return;
    let live = true;
    void (async () => {
      try {
        const page = await GetDriftAttribution(deviceId);
        if (live) { setAttribution(page.data); setAttributionError(null); }
      } catch (e: unknown) {
        // The history is already rendered and stays correct; only the names are missing, so this
        // is reported where somebody would look for them rather than over the list.
        if (live) { setAttribution({}); setAttributionError(errorText(e, "Could not read the firewall's log")); }
      }
    })();
    return () => { live = false; };
  }, [deviceId, hasOutside, reloadKey]);

  const openRow = useCallback(async (it: TimelineItem) => {
    const k = rowKey(it);
    const have = loaded[k];
    if (have && !have.error) return;
    if (have) setLoaded((m) => { const next = { ...m }; delete next[k]; return next; });
    try {
      if (it.kind === "console") {
        if (!it.has_before && !it.has_after) {
          setLoaded((m) => ({ ...m, [k]: {} }));
          return;
        }
        const full = await GetChange(it.id);
        setLoaded((m) => ({ ...m, [k]: { before: full.before, after: full.after } }));
      } else {
        const f = await GetDriftFinding(it.id);
        setLoaded((m) => ({ ...m, [k]: { diff: f.detail } }));
      }
    } catch (e: unknown) {
      setLoaded((m) => ({ ...m, [k]: { error: errorText(e, "Could not load the details") } }));
    }
  }, [loaded]);

  const afterWrite = async () => {
    await load();
    onChanged();
  };

  const undo = async (it: TimelineItem) => {
    const what = `${it.table} "${it.key}"`;
    const ok = await confirm({
      title: it.kind === "outside" ? `Delete ${what} from the firewall?` : `Undo this change to ${what}?`,
      content: fallbackExplanation(it),
      okText: "Undo",
      cancelText: "Cancel",
    });
    if (!ok) return;
    setBusyKey(rowKey(it));
    try {
      if (it.kind === "console") {
        await RevertChange(it.id);
        message.success("Undone on the firewall");
      } else {
        const r = await UndoDriftFinding(it.id);
        message.success(r.already_gone ? "It was already gone from the firewall" : "Deleted from the firewall");
      }
      await afterWrite();
    } catch (e: unknown) {
      message.error(errorText(e, "The undo failed"));
    } finally {
      setBusyKey(null);
    }
  };

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + rows.length, total);

  return (
    <section className="shell-card overflow-hidden">
      <header className="card-head flex-wrap gap-2">
        <h2 className="card-title t-card">
          <span className="medallion h-6 w-6 text-[12px]" style={{ color: consoleHue, background: `${consoleHue}1f` }}>
            <FiList />
          </span>
          Change history
        </h2>
        <div className="flex items-center gap-2">
          <span className="t-meta">{total === 0 ? "No entries" : `${from}–${to} of ${total}`}</span>
          {total > PAGE_SIZE && (
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                disabled={offset === 0 || loading}
                aria-label="Previous page" className="btn-icon disabled:opacity-40">
                <FiChevronLeft size={13} />
              </button>
              <button type="button" onClick={() => setOffset((o) => o + PAGE_SIZE)}
                disabled={offset + rows.length >= total || loading}
                aria-label="Next page" className="btn-icon disabled:opacity-40">
                <FiChevronRight size={13} />
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5 border-b hairline-2 px-4 py-2.5" role="tablist" aria-label="Show">
        {CHIPS.map((c) => {
          const on = filter === c.key;
          const n = counts?.[c.key];
          return (
            <button key={c.key} type="button" role="tab" aria-selected={on} onClick={() => onFilter(c.key)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold transition ${
                on ? "border-transparent text-white" : "hairline ink-2 surface-hover"}`}
              style={on ? { background: c.key === "outside" ? outsideHue : consoleHue } : undefined}>
              {c.label}
              {n !== undefined && (
                <span className={`rounded-full px-1.5 text-[10px] ${on ? "bg-white/25" : "surface-sunken"}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      {attributionError && (
        <p className="t-meta m-0 flex items-center gap-1.5 border-b hairline-2 px-4 py-2 text-amber-600 dark:text-amber-400">
          <FiAlertTriangle size={11} className="shrink-0" />
          {`${attributionError} — the outside changes below are listed, but without who made them.`}
        </p>
      )}

      <div className="space-y-2 px-4 py-3">
        {error ? (
          <p className="m-0 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2.5 text-[12px] text-red-600 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-400">
            {error}
          </p>
        ) : loading && rows.length === 0 ? (
          <p className="t-meta m-0 flex items-center justify-center gap-2 py-12">
            <span className="h-4 w-4 animate-spin rounded-full border-2 hairline border-t-transparent" />
            Reading the change history…
          </p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center py-12 text-center">
            <FiClock size={26} className="mb-2 ink-3 opacity-40" />
            <p className="t-body m-0 ink-2">
              {filter === "failed" ? "The device has not rejected any change"
                : filter === "outside" ? "No change made outside the console has been found"
                  : "No change has been recorded yet"}
            </p>
            <p className="t-meta m-0 mt-1 max-w-md">
              Changes made in Policy &amp; Objects, Security Profiles, VPN and the other pages appear here as
              they happen; changes made elsewhere appear after the next backup comparison.
            </p>
          </div>
        ) : (
          <div className={`space-y-2 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {rows.map((it) => (
              <Row key={rowKey(it)} it={it} isAdmin={isAdmin} consoleHue={consoleHue} outsideHue={outsideHue}
                busy={busyKey === rowKey(it)} loaded={loaded[rowKey(it)]}
                att={it.kind === "outside" ? attribution[String(it.id)] : undefined}
                onOpen={openRow} onUndo={undo} onRestore={(r) => setRestoreId(r.restore_backup_id ?? null)} />
            ))}
          </div>
        )}
      </div>

      {/* Restoring a backup reboots the firewall. The modal shows what would happen first and will
          not proceed until it has; this page only names which backup. */}
      <RestoreConfirmModal
        backup={restoreId ? { id: restoreId } : null}
        deviceName={deviceName}
        onClose={() => { setRestoreId(null); onChanged(); }}
      />
    </section>
  );
};

export default ChangeTimeline;
