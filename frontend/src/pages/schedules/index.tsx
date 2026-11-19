import React, { useCallback, useMemo, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiClock, FiPlus, FiEdit2, FiTrash2, FiRepeat, FiCalendar, FiLayers } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import { FG_COLORS } from "../../lib/categoryColor";
import {
  DeviceListSchedules, DeviceDeleteSchedule,
  type Schedule, type ScheduleType,
} from "../../api/policyObject";
import ScheduleForm from "./schedule-form";
import { apiErrorDetail } from "../../api/errorText";

// Policy & Objects > Schedules — a device-proxy view of the three FortiOS schedule tables,
// laid out like the FortiGate GUI: a "Schedules" tab (recurring + onetime, grouped by type) and
// a "Schedule groups" tab, each with Create / Edit / Delete.

const DAY_ABBR: Record<string, string> = {
  sunday: "Sun", monday: "Mon", tuesday: "Tue", wednesday: "Wed",
  thursday: "Thu", friday: "Fri", saturday: "Sat",
};

// A recurring row with start == end == "00:00" (or blank) covers the whole day — the GUI shows
// no time span for it, exactly like the built-in "always".
const isAllDay = (s: Schedule) =>
  (s.start === "00:00" || s.start === "") && (s.end === "00:00" || s.end === "");

// A small colour dot for the schedule's assigned colour (index 0 = none → no dot).
const ColorDot: React.FC<{ color: number }> = ({ color }) =>
  color > 0 && FG_COLORS[color] && FG_COLORS[color] !== "transparent" ? (
    <span className="mr-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full align-middle"
      style={{ backgroundColor: FG_COLORS[color] }} />
  ) : null;

/** Stable empty list — a `[]` literal would be a new identity each render. */
const EMPTY: Schedule[] = [];

const SchedulesPage: React.FC = () => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();

  const [tab, setTab] = useState<"schedules" | "groups">("schedules");
  const [search, setSearch] = useState("");

  // form modal: null = closed; {editTarget:null} = create; else edit
  const [formOpen, setFormOpen] = useState<
    { kind: "schedule" | "group"; editTarget: { type: ScheduleType; name: string } | null } | null
  >(null);
  const [deleteTarget, setDeleteTarget] = useState<Schedule | null>(null);
  const [deleting, setDeleting] = useState(false);


  // strict: a schedule list we could not read must not render as "no schedules" — a policy
  // referencing a schedule that appears not to exist is a confusing place to start debugging.
  const load = useCallback(
    (deviceId: number) => DeviceListSchedules(deviceId, { strict: true }),
    [],
  );
  const {
    data: schedules, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<Schedule[]>(load, EMPTY);

  // Memoised, so the three lists below can depend on the predicate itself rather than on the
  // search box it closes over — the version that listed `search` worked only because the two
  // always changed together, which is a coincidence and not a dependency.
  const matchesSearch = useCallback(
    (s: Schedule) => s.name.toLowerCase().includes(search.toLowerCase()),
    [search],
  );

  const recurring = useMemo(() => schedules.filter((s) => s.type === "recurring" && matchesSearch(s)), [schedules, matchesSearch]);
  const onetime   = useMemo(() => schedules.filter((s) => s.type === "onetime" && matchesSearch(s)), [schedules, matchesSearch]);
  const groups    = useMemo(() => schedules.filter((s) => s.type === "group" && matchesSearch(s)), [schedules, matchesSearch]);

  // Member picker options for a group: every recurring/onetime schedule (a group can't nest groups).
  const memberOptions = useMemo(
    () => schedules.filter((s) => s.type !== "group").map((s) => s.name),
    [schedules]
  );

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      await DeviceDeleteSchedule(selectedDevice.id, deleteTarget.type, deleteTarget.name);
      message.success("Schedule deleted");
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to delete schedule"));
    } finally {
      setDeleting(false);
    }
  };

  const openCreate = () =>
    setFormOpen({ kind: tab === "groups" ? "group" : "schedule", editTarget: null });
  const openEdit = (s: Schedule) =>
    setFormOpen({ kind: s.type === "group" ? "group" : "schedule", editTarget: { type: s.type, name: s.name } });

  const SCHED_GRID = "1.4fr 1.6fr 0.9fr 0.9fr 70px 74px";
  const GROUP_GRID = "1.4fr 2.5fr 70px 74px";

  // One schedule row in the Schedules tab.
  const ScheduleRow: React.FC<{ s: Schedule; last: boolean }> = ({ s, last }) => (
    <div className={`grid items-center px-4 py-3 surface-hover transition-colors ${!last ? "border-b hairline-2" : ""}`}
      style={{ gridTemplateColumns: SCHED_GRID }}>
      <p className="truncate pr-2 text-[13px] font-semibold ink">
        <ColorDot color={s.color} />{s.name}
        {s.builtin && <span className="ml-2 rounded surface-sunken px-1.5 py-0.5 text-[9px] font-bold uppercase ink-3">built-in</span>}
      </p>

      {/* Days (recurring) or date span (onetime) */}
      <div className="truncate pr-2 text-[12px] ink-2">
        {s.type === "recurring"
          ? (s.day.length === 7 ? "Every day" : s.day.length === 0 ? "—" : s.day.map((d) => DAY_ABBR[d] ?? d).join(" "))
          : "One time"}
      </div>

      {/* Start / End */}
      <div className="truncate text-[12px] ink-2">
        {s.type === "recurring" ? (isAllDay(s) ? "All day" : s.start) : s.start || "—"}
      </div>
      <div className="truncate text-[12px] ink-2">
        {s.type === "recurring" ? (isAllDay(s) ? "" : s.end) : s.end || "—"}
      </div>

      <span className="text-[12px] font-medium ink-3">{s.ref}</span>

      <div className="flex items-center justify-end gap-1">
        {isAdmin && !s.builtin && (
          <>
            <button onClick={() => openEdit(s)}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10">
              <FiEdit2 size={13} />
            </button>
            <button onClick={() => setDeleteTarget(s)}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
              <FiTrash2 size={13} />
            </button>
          </>
        )}
      </div>
    </div>
  );

  // A "Recurring (n)" / "One Time (n)" section header, mirroring the GUI's grouped list.
  const SectionHeader: React.FC<{ icon: React.ReactNode; label: string; count: number }> = ({ icon, label, count }) => (
    <div className="flex items-center gap-2 border-b hairline-2 surface-sunken px-4 py-2">
      <span className="ink-3">{icon}</span>
      <span className="text-[11px] font-bold uppercase tracking-wide ink-2">{label}</span>
      <span className="rounded-full surface-sunken px-1.5 text-[10px] font-bold ink-2">{count}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: search
          and Create New. The total count it used to badge is not lost, just not repeated here —
          it's what the per-section counts below already break down. */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
            className="h-8 w-44 rounded-[4px] border hairline surface-card pl-8 pr-3 text-[12px] outline-none"
            onFocus={(e) => { e.currentTarget.style.borderColor = currentColor; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = ""; }} />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3"
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        {isAdmin && selectedDevice && (
          <button onClick={openCreate}
            className="btn btn-accent btn-sm">
            <FiPlus size={13} /> Create new
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {([["schedules", "Schedules", <FiClock size={12} />], ["groups", "Schedule Groups", <FiLayers size={12} />]] as const).map(
          ([key, label, icon]) => (
            <button key={key} onClick={() => setTab(key as "schedules" | "groups")}
              className="inline-flex items-center gap-1.5 rounded-t-[4px] px-4 py-2 text-[12px] font-semibold transition"
              style={tab === key
                ? { color: currentColor, borderBottom: `2px solid ${currentColor}` }
                : { color: "#94a3b8", borderBottom: "2px solid transparent" }}>
              {icon} {label}
            </button>
          )
        )}
      </div>

      {/* Table */}
      <div className="panel panel-flush">
        {/* One state block for both tabs. The COUNT it is given is the active tab's, so switching
            to an empty Groups tab still says "no groups" rather than inheriting the other tab. */}
        <DeviceStates
          state={viewState(tab === "schedules" ? recurring.length + onetime.length : groups.length)}
          from={selectedDevice?.name}
          noun={tab === "schedules" ? "schedule" : "schedule group"}
          icon={tab === "schedules" ? <FiClock size={18} /> : <FiLayers size={18} />}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
        >
          {tab === "schedules" ? (
            <>
              {/* Column header */}
              <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: SCHED_GRID }}>
                {["Name", "Days", "Start", "End", "Ref", ""].map((h, i) => (
                  <span key={i} className="t-label">{h}</span>
                ))}
              </div>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {recurring.length > 0 && <SectionHeader icon={<FiRepeat size={12} />} label="Recurring" count={recurring.length} />}
                {recurring.map((s, i) => <ScheduleRow key={`r-${s.name}`} s={s} last={i === recurring.length - 1} />)}
                {onetime.length > 0 && <SectionHeader icon={<FiCalendar size={12} />} label="One Time" count={onetime.length} />}
                {onetime.map((s, i) => <ScheduleRow key={`o-${s.name}`} s={s} last={i === onetime.length - 1} />)}
              </div>
            </>
          ) : (
            // Schedule Groups tab
            <>
              <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: GROUP_GRID }}>
                {["Name", "Members", "Ref", ""].map((h, i) => (
                  <span key={i} className="t-label">{h}</span>
                ))}
              </div>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {groups.map((s, i) => (
                  <div key={s.name} className={`grid items-center px-4 py-3 surface-hover ${i < groups.length - 1 ? "border-b hairline-2" : ""}`}
                    style={{ gridTemplateColumns: GROUP_GRID }}>
                    <p className="truncate pr-2 text-[13px] font-semibold ink"><ColorDot color={s.color} />{s.name}</p>
                    <p className="truncate pr-2 text-[12px] ink-2">{s.member.join(", ") || "—"}</p>
                    <span className="text-[12px] font-medium ink-3">{s.ref}</span>
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && (
                        <>
                          <button onClick={() => openEdit(s)} className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:bg-blue-50 hover:text-blue-500 dark:hover:bg-blue-500/10">
                            <FiEdit2 size={13} />
                          </button>
                          <button onClick={() => setDeleteTarget(s)} className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10">
                            <FiTrash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </DeviceStates>
      </div>

      {/* Form modal */}
      {formOpen && selectedDevice && (
        <ScheduleForm
          deviceId={selectedDevice.id}
          deviceName={selectedDevice.name}
          currentColor={currentColor}
          kind={formOpen.kind}
          editTarget={formOpen.editTarget}
          memberOptions={memberOptions}
          onClose={() => setFormOpen(null)}
          onSaved={() => { setFormOpen(null); void fetchAll(); }}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDeleteModal
          eyebrow="DELETE SCHEDULE"
          title="Delete from device?"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          Schedule <strong className="ink">"{deleteTarget.name}"</strong> will be permanently removed
          from {selectedDevice?.name}.
          {deleteTarget.ref > 0 && (
            <p className="mt-1.5 mb-0 text-amber-600 dark:text-amber-400">
              ⚠ Used by {deleteTarget.ref} object(s) — FortiGate will refuse if it's still referenced.
            </p>
          )}
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default SchedulesPage;
