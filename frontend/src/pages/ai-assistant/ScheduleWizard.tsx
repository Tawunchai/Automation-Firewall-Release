import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiHardDrive, FiClock, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceListSchedules, DeviceCreateSchedule, DeviceUpdateSchedule,
  type ScheduleForm, type ScheduleType,
} from "../../api/policyObject";
import { Toggle, ColorPicker, labelCls, inputCls, rowCls } from "../fw-addresses/address-form";
import { FG_COLORS } from "../../lib/categoryColor";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

// AI Schedule Wizard — the right-hand panel a user gets when the AI proposes a firewall schedule.
// Same contract as the other AI wizards (ServiceWizard etc.): prefill from the parsed CLI draft,
// detect an existing object of that name → switch to edit, and Apply via the REST device-proxy
// (never raw CLI). A schedule lives in one of three FortiOS tables; `draft.type` says which.

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const WEEKDAY_LABEL: Record<string, string> = {
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
};

const colorToHex = (i?: number) => FG_COLORS[i ?? 0] ?? "transparent";
const hexToColor = (hex: string) => Math.max(0, FG_COLORS.indexOf(hex));

// "hh:mm yyyy/mm/dd" ⇄ date <input> ("yyyy-mm-dd") + time <input> ("hh:mm")
const splitStamp = (s?: string) => {
  const [time, date] = (s ?? "").split(" ");
  return { date: date ? date.replace(/\//g, "-") : "", time: time || "00:00" };
};
const joinStamp = (date: string, time: string) => (date && time ? `${time} ${date.replace(/-/g, "/")}` : "");

const ScheduleWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: ScheduleForm;
  target?: string;    // current schedule name on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  onApplied: (name: string, wasEdit: boolean) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  // The AI's CLI decides which table the schedule STARTS in, but inside the wizard the user owns the
  // form — so Type is editable, exactly as in FortiGate's own create dialog. A schedule GROUP is a
  // different dialog on the device (the "Schedule Group" tab, no Type toggle), so a group draft stays
  // a group; the toggle is only ever Recurring ⇄ One Time, like the real GUI.
  const [type, setType] = useState<ScheduleType>(draft.type);
  const isGroup = draft.type === "group";

  const [name, setName] = useState(draft.name);
  const [colorHex, setColorHex] = useState(colorToHex(draft.color));

  // recurring
  const [days, setDays] = useState<string[]>(draft.day ?? []);
  const [allDay, setAllDay] = useState(!draft.start || draft.start === "00:00");
  const [startTime, setStartTime] = useState(draft.start && draft.start !== "00:00" ? draft.start : "08:00");
  const [stopTime, setStopTime] = useState(draft.end && draft.end !== "00:00" ? draft.end : "17:00");

  // onetime
  const s0 = splitStamp(draft.start);
  const e0 = splitStamp(draft.end);
  const [startDate, setStartDate] = useState(s0.date);
  const [startClock, setStartClock] = useState(s0.time);
  const [endDate, setEndDate] = useState(e0.date);
  const [endClock, setEndClock] = useState(e0.time);
  const [preExpiration, setPreExpiration] = useState((draft.expiration_days ?? 0) > 0);
  const [expirationDays, setExpirationDays] = useState(draft.expiration_days && draft.expiration_days > 0 ? draft.expiration_days : 3);

  // group
  const [members, setMembers] = useState<string[]>(draft.member ?? []);
  const [memberOptions, setMemberOptions] = useState<string[]>([]);

  const [schedules, setSchedules] = useState<{ name: string; type: ScheduleType }[]>([]);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Detect an existing schedule of the proposed name → edit mode. Also load member options for groups.
  //
  // This re-runs when the user flips Type, and it must RESET first: "Office-Hours" can exist as a
  // recurring schedule and not exist as a one-time one. Without the reset the wizard would stay in
  // edit mode and PUT to a table that has no such entry.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setIsEdit(false);
    setOriginalName("");
    const lookup = target || draft.name;
    DeviceListSchedules(device.id).then((list) => {
      if (cancelled) return;
      setSchedules(list.map((s) => ({ name: s.name, type: s.type })));
      setMemberOptions(list.filter((s) => s.type !== "group").map((s) => s.name));
      const existing = lookup ? list.find((s) => s.name === lookup && s.type === type) : undefined;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
      }
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft.name, target, type]);

  // FortiGate keeps ONE name space across recurring / one-time / group (verified on 7.2.10: creating
  // a one-time "X" while a recurring "X" exists is refused with node_check_object fail). So a create
  // whose name is taken by a schedule of ANOTHER type cannot succeed — say so here instead of letting
  // the user press Apply and read a raw device error.
  const nameClash = !isEdit ? schedules.find((s) => s.name === name.trim()) : undefined;

  // Switching Type swaps which fields the form validates and which CMDB table Apply writes to.
  // A one-time schedule cannot be saved without dates, and the AI's recurring draft carries none, so
  // seed today's date — the same thing FortiGate's dialog does when you open it.
  const switchType = (t: ScheduleType) => {
    if (t === type) return;
    setErrors({});
    if (t === "onetime") {
      const today = new Date().toISOString().slice(0, 10);
      if (!startDate) setStartDate(today);
      if (!endDate) setEndDate(today);
    }
    setType(t);
  };

  const toggleDay = (d: string) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]));
  const toggleMember = (m: string) => setMembers((p) => (p.includes(m) ? p.filter((x) => x !== m) : [...p, m]));

  const buildForm = (): ScheduleForm | string => {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";
    const base = { name: trimmed, type, color: hexToColor(colorHex) };
    if (type === "recurring") {
      if (days.length === 0) return "Select at least one day";
      return { ...base, day: days, start: allDay ? "00:00" : startTime, end: allDay ? "00:00" : stopTime };
    }
    if (type === "onetime") {
      if (!startDate || !endDate) return "Start and end date are required";
      return { ...base, start: joinStamp(startDate, startClock), end: joinStamp(endDate, endClock), expiration_days: preExpiration ? expirationDays : 0 };
    }
    if (members.length === 0) return "Add at least one member";
    return { ...base, member: members };
  };

  const handleApply = async () => {
    if (nameClash) {
      const msg = `The name "${nameClash.name}" is already taken on the device (type ${nameClash.type}) — FortiGate shares one name space across all schedule types`;
      setErrors({ name: msg }); message.warning(msg); return;
    }
    const form = buildForm();
    if (typeof form === "string") { setErrors({ name: form }); message.warning(form); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      if (isEdit) await DeviceUpdateSchedule(device.id, type, originalName || form.name, form);
      else        await DeviceCreateSchedule(device.id, form);
      message.success(`${isEdit ? "Update" : "Create"} Schedule "${form.name}" Success`);
      onApplied(form.name, isEdit);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} schedule`));
    } finally {
      setSaving(false);
    }
  };

  const typeLabel = type === "recurring" ? "Recurring" : type === "onetime" ? "One Time" : "Group";

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiClock size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Schedule Wizard
            {!checking && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {isEdit ? "EDIT EXISTING" : "CREATE NEW"} · {typeLabel.toUpperCase()}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname || device.name}
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
            <FiCheck size={12} /> Already applied — review only (read-only)
          </div>
        )}
        {checking ? (
          <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
            Checking device for an existing schedule…
          </div>
        ) : (
          <div className="space-y-4 px-5 py-4" style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}>
            {/* Type — first field, as in FortiGate's own schedule dialog. A group is created from a
                different dialog on the device, so a group draft has no toggle. */}
            {!isGroup && (
              <div role="group" aria-labelledby="type-label" className={rowCls}>
                <span id="type-label" className={labelCls}>Type</span>
                <div className="flex-1">
                  <div className="inline-flex rounded-[4px] border hairline p-0.5"
                    style={isEdit ? { opacity: 0.55 } : undefined}>
                    {([["Recurring", "recurring"], ["One Time", "onetime"]] as const).map(([lbl, v]) => (
                      <button key={v} type="button" onClick={() => switchType(v)} disabled={isEdit}
                        className="rounded-[4px] px-4 py-1 text-[12px] font-semibold transition disabled:cursor-not-allowed"
                        style={type === v ? { background: currentColor, color: "#fff" } : { color: "#64748b" }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                  {isEdit && (
                    // FortiGate stores each type in its own CMDB table, so an existing schedule's
                    // type is fixed — its own GUI won't retype one either.
                    <p className="mt-1 text-[10px] ink-3">
                      The type of an existing schedule cannot be changed — create a new one under a different name
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Name */}
            <div className={rowCls}>
              <label htmlFor="name" className={labelCls}>Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit}
                placeholder="e.g. Work-Hours" className={inputCls}
                style={isEdit ? { background: "#f1f5f9", cursor: "not-allowed" } : undefined} />
            </div>
            {errors.name && <p className="pl-38.75 text-[11px] text-red-500">{errors.name}</p>}
            {!errors.name && nameClash && (
              <p className="pl-38.75 text-[11px] text-amber-600">
                This name already exists on the device as type <b>{nameClash.type}</b> — FortiGate shares one name space across all types, so pick another name
              </p>
            )}

            {/* Color */}
            <div role="group" aria-labelledby="color-label" className={rowCls}>
              <span id="color-label" className={labelCls}>Color</span>
              <ColorPicker value={colorHex} onChange={setColorHex} />
            </div>

            {/* RECURRING */}
            {type === "recurring" && (
              <>
                <div className={rowCls}>
                  <label htmlFor="days" className={labelCls}>Days</label>
                  <div className="grid flex-1 grid-cols-4 gap-x-3 gap-y-2">
                    {WEEKDAYS.map((d) => (
                      <label key={d} className="flex cursor-pointer items-center gap-1.5 text-[12px] ink">
                        <input id="days" type="checkbox" checked={days.includes(d)} onChange={() => toggleDay(d)}
                          className="h-3.5 w-3.5 rounded" style={{ accentColor: currentColor }} />
                        {WEEKDAY_LABEL[d]}
                      </label>
                    ))}
                  </div>
                </div>
                <div role="group" aria-labelledby="time-label" className={rowCls}>
                  <span id="time-label" className={labelCls}>Time</span>
                  <div className="inline-flex rounded-[4px] border hairline p-0.5">
                    {[["All day", true], ["Specify", false]].map(([lbl, v]) => (
                      <button key={lbl as string} type="button" onClick={() => setAllDay(v as boolean)}
                        className="rounded-[4px] px-4 py-1 text-[12px] font-semibold transition"
                        style={allDay === v ? { background: currentColor, color: "#fff" } : { color: "#64748b" }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>
                {!allDay && (
                  <>
                    <div className={rowCls}>
                      <label htmlFor="start" className={labelCls}>Start</label>
                      <input id="start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className={inputCls} style={{ maxWidth: 150 }} />
                    </div>
                    <div className={rowCls}>
                      <label htmlFor="stop" className={labelCls}>Stop</label>
                      <input id="stop" type="time" value={stopTime} onChange={(e) => setStopTime(e.target.value)} className={inputCls} style={{ maxWidth: 150 }} />
                    </div>
                  </>
                )}
              </>
            )}

            {/* ONE TIME */}
            {type === "onetime" && (
              <>
                <div role="group" aria-labelledby="start-date-label" className={rowCls}>
                  <span id="start-date-label" className={labelCls}>Start date</span>
                  <div className="flex flex-1 gap-2">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={inputCls} />
                    <input type="time" value={startClock} onChange={(e) => setStartClock(e.target.value)} className={inputCls} style={{ maxWidth: 130 }} />
                  </div>
                </div>
                <div role="group" aria-labelledby="end-date-label" className={rowCls}>
                  <span id="end-date-label" className={labelCls}>End date</span>
                  <div className="flex flex-1 gap-2">
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputCls} />
                    <input type="time" value={endClock} onChange={(e) => setEndClock(e.target.value)} className={inputCls} style={{ maxWidth: 130 }} />
                  </div>
                </div>
                <div role="group" aria-labelledby="pre-expiration-event-log-label" className={rowCls}>
                  <span id="pre-expiration-event-log-label" className={labelCls}>Pre-expiration event log</span>
                  <Toggle label="Pre-expiration event log" checked={preExpiration} onChange={setPreExpiration} color={currentColor} />
                </div>
                {preExpiration && (
                  <div className={rowCls}>
                    <label htmlFor="days-before" className={labelCls}>Days before</label>
                    <input id="days-before" type="number" min={0} max={100} value={expirationDays}
                      onChange={(e) => setExpirationDays(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      className={inputCls} style={{ maxWidth: 110 }} />
                  </div>
                )}
              </>
            )}

            {/* GROUP */}
            {type === "group" && (
              <div className={rowCls}>
                <label htmlFor="members" className={labelCls}>Members</label>
                <div className="flex-1">
                  {memberOptions.filter((m) => m !== name).length === 0 ? (
                    <p className="text-[12px] ink-3">No other schedules to add.</p>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-[4px] border hairline p-2.5">
                      {memberOptions.filter((m) => m !== name).map((m) => (
                        <label key={m} className="flex cursor-pointer items-center gap-2 text-[12px] ink">
                          <input id="members" type="checkbox" checked={members.includes(m)} onChange={() => toggleMember(m)}
                            className="h-3.5 w-3.5 rounded" style={{ accentColor: currentColor }} />
                          {m}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t hairline-2 px-4 py-3 shrink-0">
        <button type="button" onClick={onCancel}
          className="flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
          <FiChevronLeft size={13} /> {readOnly ? "Close" : "Cancel"}
        </button>
        {readOnly ? (
          <button type="button" disabled
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white cursor-default" style={{ background: "#16a34a" }}>
            <FiCheck size={13} /> Applied
          </button>
        ) : (
          <WizardApplyButton
            isEdit={isEdit} saving={saving} disabled={!isAdmin || checking}
            title={!isAdmin ? "Only admins can apply config changes" : ""}
            deviceName={hostname || device.name}
            onApply={handleApply}
            buildImpact={() => objectApplyImpact({
              kind: "schedule", label: "Schedule", name: name.trim(), isEdit,
              facts: [
                type === "recurring"
                  ? `Every ${days.join(", ") || "—"}, ${allDay ? "all day" : `${startTime}–${stopTime}`}`
                  : type === "onetime"
                  ? `Once, ${startDate} ${startClock} → ${endDate} ${endClock}`
                  : `A group of ${members.length} schedules (${members.slice(0, 3).join(", ")})`,
              ],
            })}
          />
        )}
      </div>
    </div>
  );
};

export default ScheduleWizard;
