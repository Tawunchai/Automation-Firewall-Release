import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiShield, FiPlus, FiEdit2, FiTrash2, FiCopy, FiToggleLeft, FiToggleRight, FiChevronDown, FiChevronRight,
  FiCheckCircle, FiXCircle,
} from "react-icons/fi";
import { MdDragIndicator } from "react-icons/md";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { EmptyState, ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import {
  DeviceListPolicies, DeviceTogglePolicy, DeviceDeletePolicy, DeviceMovePolicy,
  type FirewallPolicy,
} from "../../api/policyObject";
import { DeviceGetMetricHistory, windowRange } from "../../api/metrics";
import Sparkline from "../../components/ui/Sparkline";
import { activityLabel, compactHits, summarisePolicyActivity, type PolicyActivity } from "./activity";
import { BulkBar, SelectAllBox } from "./bulk";
import MatrixPanel from "./MatrixPanel";
import { useSelection } from "./selection";
import CloneDialog from "./clone";
import { ICON_CHIP, type IconChipVariant } from "../dashboard/kpi";
import { apiErrorDetail, errorText } from "../../api/errorText";

/** A switch, not a checkbox — matches the convention already used on the security-profile forms. */
const Toggle: React.FC<{ checked: boolean; onChange: () => void; color: string; label: string; disabled?: boolean }> =
  ({ checked, onChange, color, label, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={onChange}
      className={`relative h-5 w-9 shrink-0 rounded-full border-0 p-0 transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{ backgroundColor: checked ? (disabled ? "#94a3b8" : color) : "var(--shell-sunken-2, #cbd5e1)", opacity: disabled ? 0.6 : 1 }}>
      <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
    </button>
  );

/** One count, in the dashboard's own report-card shape (dashboard/kpi.tsx's StatTile): label and
    number in a left text column, a tinted icon medallion vertically centered on the right. */
const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: number; variant: IconChipVariant }> = ({
  icon, label, value, variant,
}) => (
  <section className="shell-card flex items-center gap-3 p-4">
    <div className="min-w-0 flex-1">
      <p className="m-0 truncate text-[14px] font-semibold text-(--shell-ink)">{label}</p>
      <p className="tnum m-0 mt-1 text-[20px] font-bold leading-none text-(--shell-ink)">{value}</p>
    </div>
    <span className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-full text-[18px]"
      style={ICON_CHIP[variant]} aria-hidden>
      {icon}
    </span>
  </section>
);

/** The interface half of a Source/Destination cell — a small tag, set apart from the address chips under it. */
const InterfaceTag: React.FC<{ name: string }> = ({ name }) => (
  <span className="inline-block rounded surface-sunken px-1.5 py-0.5 text-[10.5px] font-semibold ink-2">{name}</span>
);

/** disable / all / utm — the device's own three log levels, read as a tone rather than plain text. */
const LogChip: React.FC<{ value: string }> = ({ value }) => (
  <span className={`chip ${value === "utm" ? "chip-ok" : value === "all" ? "chip-info" : ""}`}>{value}</span>
);

// ─── Main page ────────────────────────────────────────────────────────────────
const FirewallPolicyPage: React.FC = () => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const { device: selectedDevice } = useSelectedDevice();
  const [policies, setPolicies]     = useState<FirewallPolicy[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<FirewallPolicy | null>(null);
  const [deleting, setDeleting]     = useState(false);
  const [viewMode, setViewMode]     = useState<"pair" | "sequence" | "matrix">("pair");
  // The interface pair the grid is filtering by, as `${src}|${dst}` plus the ids it resolved to.
  // Kept here rather than inside MatrixPanel because the TABLE is what it filters.
  const [pairFilter, setPairFilter] = useState<{ key: string; label: string; ids: number[] } | null>(null);
  // Stored hit counters, by policy id. Its own state and its own request: the list must render the
  // moment the device answers, and a rule's traffic history is an extra, never a precondition.
  const [activity, setActivity]     = useState<Map<number, PolicyActivity>>(new Map());
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set());
  // Acting on several rules at once, and copying one. Both live in their own modules — see
  // ./bulk.tsx and ./clone.tsx for why a partial bulk result is reported rather than rolled back,
  // and why a clone lands disabled.
  const { selected, toggle: toggleSelected, setMany, clear: clearSelection } = useSelection();
  const [cloneTarget, setCloneTarget] = useState<FirewallPolicy | null>(null);

  // ── Drag-to-reorder (Interface Pair view only; constrained to the same pair block) ──
  const [dragId, setDragId]   = useState<number | null>(null); // for dimming the dragged row
  const [overId, setOverId]   = useState<number | null>(null); // row currently hovered as target
  const [overPos, setOverPos] = useState<"before" | "after">("before");
  const [moving, setMoving]   = useState(false);
  // Refs are the source of truth during a drag (no stale closures on drop).
  const dragIdRef    = useRef<number | null>(null);
  const dragGroupRef = useRef<string>("");

  // A policy's interface-pair block key — reordering is only allowed within the same key.
  const groupKey = (p: FirewallPolicy) => `${p.src_intf} → ${p.dst_intf}`;

  // Reorder the global list so `dragId` sits before/after `targetId`, then renumber seq for display.
  const reorderLocal = (arr: FirewallPolicy[], dId: number, targetId: number, pos: "before" | "after") => {
    const item = arr.find((p) => p.id === dId);
    if (!item) return arr;
    const without = arr.filter((p) => p.id !== dId);
    const ti = without.findIndex((p) => p.id === targetId);
    if (ti < 0) return arr;
    without.splice(pos === "after" ? ti + 1 : ti, 0, item);
    return without.map((p, i) => ({ ...p, seq_num: i + 1 }));
  };

  // Perform the move: optimistic reorder → device move → silent resync. No success toast.
  const performMove = async (dId: number, targetId: number, pos: "before" | "after") => {
    if (!selectedDevice || dId === targetId) return;
    const prev = policies;
    setPolicies(reorderLocal(policies, dId, targetId, pos)); // instant feedback
    setMoving(true);
    try {
      await DeviceMovePolicy(selectedDevice.id, dId, pos, targetId);
      const fresh = await DeviceListPolicies(selectedDevice.id); // authoritative seq_nums, silently
      setPolicies(fresh);
    } catch (err) {
      setPolicies(prev); // revert on failure (errors DO surface; success stays silent)
      message.error(apiErrorDetail(err, "Failed to move policy"));
    } finally {
      setMoving(false);
    }
  };

  const clearDrag = () => { dragIdRef.current = null; dragGroupRef.current = ""; setDragId(null); setOverId(null); };

  const onRowDragStart = (e: React.DragEvent, p: FirewallPolicy) => {
    if (!isAdmin || moving) { e.preventDefault(); return; }
    // Don't start a drag from the toggle/edit/delete buttons.
    if ((e.target as HTMLElement).closest("button")) { e.preventDefault(); return; }
    dragIdRef.current = p.id; dragGroupRef.current = groupKey(p);
    setDragId(p.id);
    e.dataTransfer.effectAllowed = "move";
  };
  const onRowDragOver = (e: React.DragEvent, p: FirewallPolicy) => {
    const dId = dragIdRef.current;
    if (dId == null || p.id === dId) return;
    if (groupKey(p) !== dragGroupRef.current) return; // ← only within the same interface-pair block
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
    if (overId !== p.id) setOverId(p.id);
    if (overPos !== pos) setOverPos(pos);
  };
  const onRowDrop = (e: React.DragEvent, p: FirewallPolicy) => {
    const dId = dragIdRef.current;
    if (dId == null || p.id === dId || groupKey(p) !== dragGroupRef.current) { clearDrag(); return; }
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const pos: "before" | "after" = e.clientY < r.top + r.height / 2 ? "before" : "after";
    void performMove(dId, p.id, pos);
    clearDrag();
  };

  const fetchAll = useCallback(async () => {
    if (!selectedDevice) return;
    setLoading(true);
    setLoadError(null);
    try {
      // strict: an unreachable firewall must NOT render as "no policies" — on this page that
      // reads as "nothing is being enforced", which is the opposite of the truth.
      const p = await DeviceListPolicies(selectedDevice.id, { strict: true });
      setPolicies(p);
    } catch (err) {
      setPolicies([]);
      setLoadError(errorText(err, "Could not load firewall policies from the device"));
    } finally {
      setLoading(false);
    }
  }, [selectedDevice]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  // The traffic column, in one request for every rule at once.
  //
  // Lenient on purpose, and silent when it fails: this is the console's own stored history, not the
  // firewall's configuration, and a page that can show the rules must not refuse to show them
  // because a chart column has nothing to draw.
  useEffect(() => {
    if (!selectedDevice) { setActivity(new Map()); return; }
    let live = true;
    const deviceId = selectedDevice.id;
    void (async () => {
      const { from, to } = windowRange("24h");
      const res = await DeviceGetMetricHistory(deviceId, { kinds: ["policy_hits"], from, to });
      if (live) setActivity(summarisePolicyActivity(res.series));
    })();
    return () => { live = false; };
  }, [selectedDevice]);

  // Group by interface pair
  const groups = policies.reduce<Record<string, FirewallPolicy[]>>((acc, p) => {
    const key = `${p.src_intf} → ${p.dst_intf}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(p);
    return acc;
  }, {});

  const handleToggleEnabled = async (p: FirewallPolicy) => {
    if (!selectedDevice) return;
    try {
      await DeviceTogglePolicy(selectedDevice.id, p.id, !p.enabled);
      setPolicies((prev) => prev.map((item) => item.id === p.id ? { ...item, enabled: !p.enabled } : item));
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to toggle policy"));
    }
  };

  const goCreate = () => {
    if (!selectedDevice) return;
    navigate(`/admin/firewall-policy/create?deviceId=${selectedDevice.id}`);
  };
  const goEdit = (p: FirewallPolicy) => {
    if (!selectedDevice) return;
    navigate(`/admin/firewall-policy/edit?deviceId=${selectedDevice.id}&policyId=${p.id}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      await DeviceDeletePolicy(selectedDevice.id, deleteTarget.id);
      message.success("Policy deleted");
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to delete policy"));
    } finally {
      setDeleting(false);
    }
  };

  const renderPolicies = (list: FirewallPolicy[], dnd = false) => list.map((p) => {
    const canDrag = dnd && isAdmin;
    const isOver = overId === p.id;
    return (
    <tr key={p.id}
      draggable={canDrag}
      onDragStart={canDrag ? (e) => onRowDragStart(e, p) : undefined}
      onDragOver={canDrag ? (e) => onRowDragOver(e, p) : undefined}
      onDrop={canDrag ? (e) => onRowDrop(e, p) : undefined}
      onDragEnd={canDrag ? clearDrag : undefined}
      style={{
        opacity: dragId === p.id ? 0.4 : undefined,
        boxShadow: isOver ? (overPos === "before" ? `inset 0 3px 0 ${currentColor}` : `inset 0 -3px 0 ${currentColor}`) : undefined,
      }}>
      {isAdmin && (
        <td>
          <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggleSelected(p.id)}
            aria-label={`Select policy ${p.name}`} />
        </td>
      )}
      <td>
        <div className="flex items-center gap-1.5">
          {canDrag && <MdDragIndicator size={16} className="shrink-0 cursor-grab ink-3 hover-ink active:cursor-grabbing" title="Drag to reorder within this interface pair" />}
          <Toggle checked={p.enabled} onChange={() => isAdmin && handleToggleEnabled(p)} color={currentColor}
            label={`${p.enabled ? "Disable" : "Enable"} policy ${p.name}`} disabled={!isAdmin} />
        </div>
      </td>
      <td className="td-num ink-3">{p.seq_num}</td>
      <td className="td-key">
        {p.name}
        {p.comments && <p className="t-meta m-0 mt-0.5 font-normal">{p.comments}</p>}
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-1.5">
          <InterfaceTag name={p.src_intf} />
          {(p.src_addr_list || []).map((a) => <span key={a} className="chip">{a}</span>)}
        </div>
      </td>
      <td>
        <div className="flex flex-wrap items-center gap-1.5">
          <InterfaceTag name={p.dst_intf} />
          {(p.dst_addr_list || []).map((a) => <span key={a} className="chip">{a}</span>)}
        </div>
      </td>
      <td className="t-meta">{p.schedule}</td>
      <td>
        <div className="flex flex-wrap gap-1">
          {(p.service_list || []).map((s) => <span key={s} className="chip chip-info">{s}</span>)}
        </div>
      </td>
      <td>
        <span className={`chip chip-solid ${p.action === "accept" ? "chip-ok" : "chip-danger"}`}>
          {p.action.toUpperCase()}
        </span>
      </td>
      <td>
        {/* NAT is a yes/no, and it is read down the column — a filled vs hollow dot scans faster
            than the word, and the colour only appears on the "yes". */}
        <span className={`text-[10px] font-semibold ${p.nat ? "text-emerald-600 dark:text-emerald-400" : "ink-3"}`}>
          {p.nat ? "●" : "○"}
        </span>
      </td>
      <td><LogChip value={p.log_traffic} /></td>
      <td>
        {/* Shape and number together: the sparkline cannot be read out loud and the total can. */}
        <div className="flex items-center gap-1.5" title={activityLabel(activity.get(p.id))}>
          <Sparkline values={activity.get(p.id)?.rate ?? []} color={currentColor} />
          <span className="text-[11px] tabular-nums ink-3">
            {(() => {
              const a = activity.get(p.id);
              if (!a || a.samples === 0) return "—";
              return a.total === 0 ? "quiet" : compactHits(a.total);
            })()}
          </span>
        </div>
      </td>
      <td>
        {isAdmin && (
          <div className="flex items-center gap-1">
            <button onClick={() => goEdit(p)} className="btn-icon" title="Edit policy">
              <FiEdit2 size={13} />
            </button>
            <button onClick={() => setCloneTarget(p)} className="btn-icon" title="Clone policy">
              <FiCopy size={13} />
            </button>
            <button onClick={() => setDeleteTarget(p)} className="btn-icon btn-icon--danger" title="Delete policy">
              <FiTrash2 size={13} />
            </button>
          </div>
        )}
      </td>
    </tr>
    );
  });

  const enabledCount = policies.filter((p) => p.enabled).length;
  const acceptCount = policies.filter((p) => p.action === "accept").length;
  const showStats = !!selectedDevice && !loading && !loadError && policies.length > 0;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: the view
          mode toggle and Create New. The total/enabled counts it used to badge are not lost, just
          not repeated here — they're what the stat strip below already shows. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="seg">
          {(["pair", "sequence", "matrix"] as const).map((mode) => (
            <button key={mode} type="button" onClick={() => setViewMode(mode)}
              className={`seg-item${viewMode === mode ? " seg-item--on" : ""}`}>
              {mode === "pair" ? "Interface Pair" : mode === "sequence" ? "By Sequence" : "Matrix"}
            </button>
          ))}
        </div>

        {isAdmin && (
          <button type="button" onClick={goCreate} className="btn btn-accent btn-sm">
            <FiPlus size={13} /> Create New
          </button>
        )}
      </div>

      {showStats && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <StatTile icon={<FiShield size={16} />} label="Policies" value={policies.length} variant="primary" />
          <StatTile icon={<FiToggleRight size={16} />} label="Enabled" value={enabledCount} variant="success" />
          <StatTile icon={<FiToggleLeft size={16} />} label="Disabled" value={policies.length - enabledCount} variant="neutral" />
          <StatTile icon={<FiCheckCircle size={16} />} label="Accept" value={acceptCount} variant="success" />
          <StatTile icon={<FiXCircle size={16} />} label="Deny" value={policies.length - acceptCount} variant="danger" />
        </div>
      )}

      {/* The rule base as a grid of interface pairs. It sits ABOVE the table it filters — the
          grid is a second reading of the same rows, not an analysis of its own, so the two have to
          be on one screen (see ./matrix.ts). */}
      {viewMode === "matrix" && selectedDevice && !loading && !loadError && policies.length > 0 && (
        <MatrixPanel
          policies={policies}
          hitsOf={(id) => activity.get(id)?.total}
          picked={pairFilter?.key ?? null}
          onPick={(ids, label) => {
            const key = label.replace(" → ", "|");
            // Clicking the selected cell again clears the filter, which is what a toggle should do.
            setPairFilter((prev) => (prev?.key === key ? null : { key, label, ids }));
          }}
        />
      )}

      {pairFilter && (
        <div className="flex items-center justify-between gap-2 rounded-[4px] border hairline surface-card px-3 py-2">
          <span className="t-meta">
            {`Showing ${pairFilter.ids.length} ${pairFilter.ids.length === 1 ? "rule" : "rules"} on ${pairFilter.label}`}
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPairFilter(null)}>
            Show all
          </button>
        </div>
      )}

      {/* Table */}
      <div className="panel panel-flush">
        {!selectedDevice ? (
          <NoDeviceState />
        ) : loading ? (
          <LoadingState what="policy" from={selectedDevice.name} />
        ) : loadError ? (
          /* Never fall through to the "No firewall policies" empty state here: the rules may well
             be in force, we just cannot read them. Saying otherwise is worse than saying nothing. */
          <ErrorState
            title={`Could not read the policies from ${selectedDevice.name}`}
            detail={loadError}
            note="The device may well still be enforcing policies — this list is 'unreadable', not 'empty'"
            onRetry={() => void fetchAll()}
          />
        ) : policies.length === 0 ? (
          <EmptyState
            icon={<FiShield size={18} />}
            title="This device has no firewall policy yet"
            action={isAdmin ? (
              <button type="button" onClick={goCreate} className="btn btn-accent btn-sm mt-1">
                <FiPlus size={13} /> Create the first policy
              </button>
            ) : undefined}
          />
        ) : (
          <div className="shell-scroll overflow-x-auto">
            <table className="shell-table fp-table">
              <thead>
                <tr>
                  {isAdmin && (
                    <th style={{ width: 34 }}>
                      <SelectAllBox ids={policies.map((p) => p.id)} selected={selected}
                        onChange={setMany} label="Select every policy" />
                    </th>
                  )}
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: 50 }}>#</th>
                  <th>Name</th>
                  <th>Source</th>
                  <th>Destination</th>
                  <th>Schedule</th>
                  <th>Service</th>
                  <th>Action</th>
                  <th>NAT</th>
                  <th>Log</th>
                  <th style={{ width: 96 }}>Traffic 24h</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {viewMode === "matrix"
                  ? renderPolicies(
                      [...policies]
                        .filter((p) => !pairFilter || pairFilter.ids.includes(p.id))
                        .sort((a, b) => a.seq_num - b.seq_num))
                  : viewMode === "pair"
                  ? Object.entries(groups).map(([key, list]) => {
                    const isCollapsed = collapsed.has(key);
                    return (
                      <React.Fragment key={key}>
                        <tr className="tr-group">
                          <td colSpan={isAdmin ? 13 : 12}>
                            {/* One flex row: the per-group select-all checkbox sits on the band's
                                own line, left of the chevron. (It used to follow an inline span with
                                a `w-full` flex button after it, so the full-width button wrapped onto
                                the next line and the checkbox floated up above the group header.)
                                Selecting a whole interface-pair block is the common case: the rules
                                people turn off together are the ones that share a pair. */}
                            <div className="flex items-center gap-2">
                              {isAdmin && (
                                <span className="inline-flex shrink-0 align-middle">
                                  <SelectAllBox ids={list.map((p) => p.id)} selected={selected}
                                    onChange={setMany} label={`Select every policy in ${key}`} />
                                </span>
                              )}
                              <button type="button" onClick={() => setCollapsed((prev) => {
                                const next = new Set(prev);
                                if (next.has(key)) next.delete(key); else next.add(key);
                                return next;
                              })}
                                className="group-band min-w-0 flex-1 border-none bg-transparent px-0 py-0 text-left">
                                {isCollapsed ? <FiChevronRight size={12} /> : <FiChevronDown size={12} />}
                                <span>{key}</span>
                                <span className="group-count">{list.length}</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                        {!isCollapsed && renderPolicies(list, true)}
                      </React.Fragment>
                    );
                  })
                  : renderPolicies([...policies].sort((a, b) => a.seq_num - b.seq_num))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Acting on the selection. Renders nothing while the selection is empty. */}
      {isAdmin && selectedDevice && (
        <BulkBar
          deviceId={selectedDevice.id}
          deviceName={selectedDevice.name}
          selected={selected}
          nameOf={(id) => policies.find((p) => p.id === id)?.name ?? `policy ${id}`}
          onClear={clearSelection}
          onDone={fetchAll}
        />
      )}

      {cloneTarget && selectedDevice && (
        <CloneDialog
          deviceId={selectedDevice.id}
          deviceName={selectedDevice.name}
          policyId={cloneTarget.id}
          sourceName={cloneTarget.name}
          takenNames={policies.map((p) => p.name)}
          onCancel={() => setCloneTarget(null)}
          onDone={async () => { setCloneTarget(null); await fetchAll(); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDeleteModal
          title="Delete Policy?"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          Policy <strong className="ink">"{deleteTarget.name}"</strong> will be permanently removed
          {selectedDevice ? ` from ${selectedDevice.name}` : ""}.
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default FirewallPolicyPage;
