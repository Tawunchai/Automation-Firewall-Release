import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { message } from "../../components/ui/toast";
import { FiClock, FiLayers } from "react-icons/fi";
import {
  Toggle, ColorPicker, labelCls, inputCls, rowCls,
} from "../fw-addresses/address-form";
import { FG_COLORS } from "../../lib/categoryColor";
import {
  DeviceGetSchedule, DeviceCreateSchedule, DeviceUpdateSchedule,
  type Schedule, type ScheduleForm as SchedulePayload, type ScheduleType,
} from "../../api/policyObject";
import { apiErrorDetail } from "../../api/errorText";

// New Schedule / Edit Schedule — a field-for-field mirror of the FortiGate GUI's schedule dialog
// (Policy & Objects > Schedules). The "Schedules" tab creates recurring/onetime rows (a Type
// toggle switches between them); the "Schedule groups" tab creates a group of other schedules.
//
// FortiOS storage formats this form reads/writes (verified live against 7.2.10):
//   recurring : start/end = "hh:mm" (24h) — "All day" is start == end == "00:00"
//   onetime   : start/end = "hh:mm yyyy/mm/dd"; expiration-days 0 = Pre-expiration log off
//   group     : member = names of other schedules

const WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"] as const;
const WEEKDAY_LABEL: Record<string, string> = {
  monday: "Monday", tuesday: "Tuesday", wednesday: "Wednesday", thursday: "Thursday",
  friday: "Friday", saturday: "Saturday", sunday: "Sunday",
};

// color index (0-32) ↔ hex used by the shared ColorPicker (FG_COLORS[0] = "transparent" = index 0)
const colorToHex = (i: number) => FG_COLORS[i] ?? "transparent";
const hexToColor = (hex: string) => Math.max(0, FG_COLORS.indexOf(hex));

// onetime stamp "hh:mm yyyy/mm/dd" ⇄ the two <input> values (date "yyyy-mm-dd" + time "hh:mm")
function splitStamp(stamp: string): { date: string; time: string } {
  const [time, date] = stamp.split(" ");
  if (!time || !date) return { date: "", time: "" };
  return { date: date.replace(/\//g, "-"), time };
}
function joinStamp(date: string, time: string): string {
  if (!date || !time) return "";
  return `${time} ${date.replace(/-/g, "/")}`;
}

type Props = {
  deviceId: number;
  deviceName: string;
  currentColor: string;
  // "schedule" → the Schedules tab (recurring/onetime toggle); "group" → the Schedule groups tab
  kind: "schedule" | "group";
  // editing an existing row → its type + name; null → creating a new one
  editTarget: { type: ScheduleType; name: string } | null;
  // existing schedule names for the group member picker (recurring + onetime, never groups)
  memberOptions: string[];
  onClose: () => void;
  onSaved: () => void;
};

const ScheduleForm: React.FC<Props> = ({
  deviceId, deviceName, currentColor, kind, editTarget, memberOptions, onClose, onSaved,
}) => {
  const isEdit = editTarget !== null;

  // ── shared ──
  const [type, setType] = useState<ScheduleType>(kind === "group" ? "group" : "recurring");
  const [name, setName] = useState("");
  const [colorHex, setColorHex] = useState<string>("transparent");

  // ── recurring ──
  const [days, setDays] = useState<string[]>([]);
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState("00:00");
  const [stopTime, setStopTime] = useState("00:00");

  // ── onetime ──
  const [startDate, setStartDate] = useState("");
  const [startClock, setStartClock] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endClock, setEndClock] = useState("00:00");
  const [preExpiration, setPreExpiration] = useState(true);
  const [expirationDays, setExpirationDays] = useState(3);

  // ── group ──
  const [members, setMembers] = useState<string[]>([]);

  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);

  // Load the existing object when editing.
  useEffect(() => {
    if (!editTarget) return;
    let cancelled = false;
    (async () => {
      try {
        const s: Schedule = await DeviceGetSchedule(deviceId, editTarget.type, editTarget.name);
        if (cancelled) return;
        setType(s.type);
        setName(s.name);
        setColorHex(colorToHex(s.color));
        if (s.type === "recurring") {
          setDays(s.day);
          const isAllDay = (s.start === "00:00" || s.start === "") && (s.end === "00:00" || s.end === "");
          setAllDay(isAllDay);
          setStartTime(s.start || "00:00");
          setStopTime(s.end || "00:00");
        } else if (s.type === "onetime") {
          const a = splitStamp(s.start), b = splitStamp(s.end);
          setStartDate(a.date); setStartClock(a.time || "00:00");
          setEndDate(b.date); setEndClock(b.time || "00:00");
          setPreExpiration(s.expiration_days > 0);
          setExpirationDays(s.expiration_days > 0 ? s.expiration_days : 3);
        } else {
          setMembers(s.member);
        }
      } catch (err) {
        message.error(apiErrorDetail(err, "Failed to load schedule"));
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, editTarget]);

  const toggleDay = (d: string) =>
    setDays((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  const toggleMember = (m: string) =>
    setMembers((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  const memberChoices = useMemo(
    () => memberOptions.filter((m) => m !== name), // a group can't contain itself
    [memberOptions, name]
  );

  const buildPayload = (): SchedulePayload | string => {
    const trimmed = name.trim();
    if (!trimmed) return "Name is required";
    const base = { name: trimmed, color: hexToColor(colorHex) };

    if (type === "recurring") {
      if (days.length === 0) return "Select at least one day";
      return {
        ...base, type,
        day: days,
        start: allDay ? "00:00" : startTime,
        end: allDay ? "00:00" : stopTime,
      };
    }
    if (type === "onetime") {
      if (!startDate || !endDate) return "Start and end date are required";
      return {
        ...base, type,
        start: joinStamp(startDate, startClock),
        end: joinStamp(endDate, endClock),
        expiration_days: preExpiration ? expirationDays : 0,
      };
    }
    // group
    if (members.length === 0) return "Add at least one member";
    return { ...base, type, member: members };
  };

  const handleSave = async () => {
    const payload = buildPayload();
    if (typeof payload === "string") { message.warning(payload); return; }
    try {
      setSaving(true);
      if (isEdit && editTarget) {
        await DeviceUpdateSchedule(deviceId, editTarget.type, editTarget.name, payload);
        message.success("Schedule updated");
      } else {
        await DeviceCreateSchedule(deviceId, payload);
        message.success("Schedule created");
      }
      onSaved();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to save schedule"));
    } finally {
      setSaving(false);
    }
  };

  const titleNoun = kind === "group" ? "Schedule Group" : "Schedule";

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <div role="presentation" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
        onClick={!saving ? onClose : undefined} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-[4px] surface-card"
        style={{ boxShadow: "0 24px 64px -12px rgba(0,0,0,.35)" }}>

        {/* Header */}
        <div className="flex items-center gap-2.5 border-b hairline-2 px-5 py-4">
          <span className="flex h-8 w-8 items-center justify-center rounded-[4px] text-white"
            style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))` }}>
            {kind === "group" ? <FiLayers size={14} /> : <FiClock size={14} />}
          </span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: currentColor }}>
              {isEdit ? "EDIT" : "NEW"} {titleNoun.toUpperCase()}
            </p>
            <h3 className="text-[14px] font-bold ink">
              {deviceName}
            </h3>
          </div>
        </div>

        {loading ? (
          <div className="py-20 text-center text-[13px] ink-3">Loading…</div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
            {/* Type toggle — only on the Schedules tab (a group can't become a recurring/onetime) */}
            {kind === "schedule" && (
              <div role="group" aria-labelledby="type-label" className={rowCls}>
                <span id="type-label" className={labelCls}>Type</span>
                <div className="inline-flex rounded-[4px] border hairline p-0.5">
                  {(["recurring", "onetime"] as ScheduleType[]).map((t) => (
                    <button key={t} type="button" onClick={() => !isEdit && setType(t)}
                      disabled={isEdit}
                      className="rounded-[4px] px-4 py-1 text-[12px] font-semibold transition disabled:cursor-not-allowed"
                      style={type === t
                        ? { background: currentColor, color: "#fff" }
                        : { color: "#64748b" }}>
                      {t === "recurring" ? "Recurring" : "One Time"}
                    </button>
                  ))}
                </div>
                {isEdit && (
                  <span className="pt-1.5 text-[11px] ink-3">Type can't be changed after creation</span>
                )}
              </div>
            )}

            {/* Name */}
            <div className={rowCls}>
              <label htmlFor="name" className={labelCls}>Name</label>
              <input id="name" value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit}
                placeholder="e.g. Work-Hours" className={inputCls}
                style={isEdit ? { background: "#f1f5f9", cursor: "not-allowed" } : undefined} />
            </div>

            {/* Color */}
            <div role="group" aria-labelledby="color-label" className={rowCls}>
              <span id="color-label" className={labelCls}>Color</span>
              <ColorPicker value={colorHex} onChange={setColorHex} />
            </div>

            {/* ── RECURRING ── */}
            {type === "recurring" && (
              <>
                <div className={rowCls}>
                  <label htmlFor="days" className={labelCls}>Days</label>
                  <div className="grid flex-1 grid-cols-3 gap-x-4 gap-y-2">
                    {WEEKDAYS.map((d) => (
                      <label key={d} className="flex cursor-pointer items-center gap-2 text-[12px] ink">
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
                        style={allDay === v
                          ? { background: currentColor, color: "#fff" }
                          : { color: "#64748b" }}>
                        {lbl}
                      </button>
                    ))}
                  </div>
                </div>

                {!allDay && (
                  <>
                    <div className={rowCls}>
                      <label htmlFor="start" className={labelCls}>Start</label>
                      <input id="start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)}
                        className={inputCls} style={{ maxWidth: 160 }} />
                    </div>
                    <div className={rowCls}>
                      <label htmlFor="stop" className={labelCls}>Stop</label>
                      <input id="stop" type="time" value={stopTime} onChange={(e) => setStopTime(e.target.value)}
                        className={inputCls} style={{ maxWidth: 160 }} />
                    </div>
                  </>
                )}
              </>
            )}

            {/* ── ONE TIME ── */}
            {type === "onetime" && (
              <>
                <div role="group" aria-labelledby="start-date-label" className={rowCls}>
                  <span id="start-date-label" className={labelCls}>Start date</span>
                  <div className="flex flex-1 gap-2">
                    <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                      className={inputCls} />
                    <input type="time" value={startClock} onChange={(e) => setStartClock(e.target.value)}
                      className={inputCls} style={{ maxWidth: 140 }} />
                  </div>
                </div>
                <div role="group" aria-labelledby="end-date-label" className={rowCls}>
                  <span id="end-date-label" className={labelCls}>End date</span>
                  <div className="flex flex-1 gap-2">
                    <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                      className={inputCls} />
                    <input type="time" value={endClock} onChange={(e) => setEndClock(e.target.value)}
                      className={inputCls} style={{ maxWidth: 140 }} />
                  </div>
                </div>
                <div role="group" aria-labelledby="pre-expiration-event-log-label" className={rowCls}>
                  <span id="pre-expiration-event-log-label" className={labelCls}>Pre-expiration event log</span>
                  <Toggle label="Pre-expiration event log" checked={preExpiration} onChange={setPreExpiration} color={currentColor} />
                </div>
                {preExpiration && (
                  <div className={rowCls}>
                    <label htmlFor="number-of-days-before" className={labelCls}>Number of days before</label>
                    <input id="number-of-days-before" type="number" min={0} max={100} value={expirationDays}
                      onChange={(e) => setExpirationDays(Math.max(0, Math.min(100, Number(e.target.value) || 0)))}
                      className={inputCls} style={{ maxWidth: 120 }} />
                  </div>
                )}
              </>
            )}

            {/* ── GROUP ── */}
            {type === "group" && (
              <div className={rowCls}>
                <label htmlFor="members" className={labelCls}>Members</label>
                <div className="flex-1">
                  {memberChoices.length === 0 ? (
                    <p className="text-[12px] ink-3">No other schedules available to add.</p>
                  ) : (
                    <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-[4px] border hairline p-2.5">
                      {memberChoices.map((m) => (
                        <label key={m} className="flex cursor-pointer items-center gap-2 text-[12px] ink">
                          <input id="members" type="checkbox" checked={members.includes(m)} onChange={() => toggleMember(m)}
                            className="h-3.5 w-3.5 rounded" style={{ accentColor: currentColor }} />
                          {m}
                        </label>
                      ))}
                    </div>
                  )}
                  {members.length > 0 && (
                    <p className="mt-1.5 text-[11px] ink-3">{members.length} selected</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t hairline-2 px-6 py-3.5">
          <button onClick={onClose} disabled={saving}
            className="rounded-[4px] border hairline px-5 py-2 text-[12px] font-semibold ink-2 surface-hover transition disabled:opacity-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving || loading}
            className="flex items-center gap-2 rounded-[4px] px-6 py-2 text-[12px] font-semibold text-white transition disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))` }}>
            {saving && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
            {isEdit ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default ScheduleForm;
