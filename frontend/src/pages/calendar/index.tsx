import React, { useState, useEffect, useRef, useCallback } from "react";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { createPortal } from "react-dom";
import FullCalendar from "@fullcalendar/react";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import type { DateClickArg } from "@fullcalendar/interaction";
import type { EventClickArg, CalendarApi } from "@fullcalendar/core";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import { FiPlus, FiTrash2, FiX, FiChevronDown } from "react-icons/fi";
import { BsCalendar3 } from "react-icons/bs";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import CalendarMascot from "../../components/ui/CalendarMascot";
import {
  ListCalendarEvents, CreateCalendarEvent, UpdateCalendarEvent, DeleteCalendarEvent,
  type CalendarEvent as CalEvent,
} from "../../api/calendar";

/** What the dialog edits. Dates are the `datetime-local` string form. */
type Draft = {
  title: string; description: string;
  start_date: string; end_date: string;
  all_day: boolean; category: string; color: string;
};

/** dayjs → the value a <input type="datetime-local"> expects. */
const toLocalInput = (d: dayjs.Dayjs) => d.format("YYYY-MM-DDTHH:mm");

const BLANK_DRAFT = (): Draft => ({
  title: "", description: "",
  start_date: toLocalInput(dayjs()), end_date: toLocalInput(dayjs().add(1, "hour")),
  all_day: false, category: "calendar", color: "",
});

const fmtDate = (iso: string) => { const d = dayjs(iso); return d.isValid() ? d.format("ddd, MMM D, YYYY") : ""; };
const fmtTime = (iso: string) => { const d = dayjs(iso); return d.isValid() ? d.format("h:mmA") : ""; };

const getCategoryColor = (cat: string, map: Record<string, string>, fallback: string) =>
  map[cat] ?? fallback;

const CalendarPage: React.FC = () => {
  const { t } = useTranslation();
  const { currentColor } = useStateContext();
  const calRef = useRef<InstanceType<typeof FullCalendar>>(null);
  // Plain state instead of antd's Form. The dialog is six fields; a form library for that was
  // most of what kept Ant Design in this page's bundle.
  //
  // Dates are held as `datetime-local` strings (YYYY-MM-DDTHH:mm) rather than dayjs objects,
  // because that is what the native input speaks. dayjs still does the parsing and formatting —
  // it is already here for FullCalendar.
  const [draft, setDraft] = useState<Draft>(BLANK_DRAFT());
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setErrors((e) => (e[k as string] ? { ...e, [k as string]: false } : e));
  };

  const CATEGORIES = [
    { key: "calendar",  label: t("calendar.catCalendar"),  color: currentColor },
    { key: "birthday",  label: t("calendar.catBirthday"),  color: "#06B6D4" },
    { key: "holiday",   label: t("calendar.catHoliday"),   color: "#22C55E" },
    { key: "office",    label: t("calendar.catOffice"),    color: "#38BDF8" },
    { key: "other",     label: t("calendar.catOther"),     color: "#F59E0B" },
    { key: "festival",  label: t("calendar.catFestival"),  color: "#EF4444" },
    { key: "timeline",  label: t("calendar.catTimeline"),  color: "#14B8A6" },
  ];
  const CATEGORY_COLOR_MAP = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.color]));

  const STATUS: Record<string, { bg: string; text: string; label: string }> = {
    completed: { bg: "#D1FAE5", text: "#065F46", label: t("calendar.statusCompleted") },
    upcoming:  { bg: "#EDE9FE", text: "#5B21B6", label: t("calendar.statusUpcoming")  },
    reminder:  { bg: "#FEF3C7", text: "#92400E", label: t("calendar.statusReminder")  },
  };

  const getStatus = (ev: CalEvent): keyof typeof STATUS => {
    const now = dayjs();
    if (dayjs(ev.end_date).isBefore(now))   return "completed";
    if (dayjs(ev.start_date).isBefore(now)) return "upcoming";
    return "reminder";
  };

  const [events,       setEvents]       = useState<CalEvent[]>([]);
  const [loading,      setLoading]      = useState(false);
  const [modalOpen,    setModalOpen]    = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalEvent | null>(null);
  const [saving,       setSaving]       = useState(false);
  const [deleting,     setDeleting]     = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [currentView,  setCurrentView]  = useState("dayGridMonth");
  const [showActivity, setShowActivity] = useState(false);

  const fetchEvents = useCallback(async () => {
    setLoading(true);
    try { setEvents(await ListCalendarEvents()); }
    catch { message.error(t("calendar.loadFailed")); }
    finally { setLoading(false); }
  }, [t]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const fcEvents = events.map((e) => ({
    id: String(e.id), title: e.title,
    start: e.start_date, end: e.end_date, allDay: e.all_day,
    backgroundColor: e.color || getCategoryColor(e.category, CATEGORY_COLOR_MAP, currentColor),
    borderColor:     e.color || getCategoryColor(e.category, CATEGORY_COLOR_MAP, currentColor),
    textColor: "#ffffff", extendedProps: { ...e },
  }));

  const activityEvents = [...events].sort(
    (a, b) => dayjs(a.start_date).valueOf() - dayjs(b.start_date).valueOf()
  );

  const openCreate = (defaultDate?: string) => {
    setEditingEvent(null); setErrors({});
    const start = defaultDate ? dayjs(defaultDate) : dayjs();
    setDraft({
      ...BLANK_DRAFT(),
      start_date: toLocalInput(start), end_date: toLocalInput(start.add(1, "hour")),
      color: currentColor,
    });
    setModalOpen(true);
  };
  const openEdit = (ev: CalEvent) => {
    setEditingEvent(ev); setErrors({});
    setDraft({
      title: ev.title, description: ev.description ?? "",
      start_date: toLocalInput(dayjs(ev.start_date)), end_date: toLocalInput(dayjs(ev.end_date)),
      all_day: ev.all_day, category: ev.category, color: ev.color ?? currentColor,
    });
    setModalOpen(true);
  };
  const closeModal = () => { if (saving || deleting) return; setModalOpen(false); setEditingEvent(null); };

  const handleSave = async () => {
    // Required fields, checked inline. An invalid or reversed date range is caught here too —
    // antd's rules never covered that, so an end before its start used to reach the API.
    const bad: Record<string, boolean> = {};
    if (!draft.title.trim()) bad.title = true;
    if (!draft.category) bad.category = true;
    const start = dayjs(draft.start_date), end = dayjs(draft.end_date);
    if (!start.isValid()) bad.start_date = true;
    if (!end.isValid() || (start.isValid() && end.isBefore(start))) bad.end_date = true;
    if (Object.keys(bad).length) { setErrors(bad); return; }

    setSaving(true);
    try {
      const payload = { title: draft.title.trim(), description: draft.description ?? "", start_date: start.toISOString(), end_date: end.toISOString(), all_day: draft.all_day, category: draft.category, color: draft.color || getCategoryColor(draft.category, CATEGORY_COLOR_MAP, currentColor) };
      if (editingEvent) { await UpdateCalendarEvent(editingEvent.id, payload); message.success(t("calendar.eventUpdated")); }
      else              { await CreateCalendarEvent(payload); message.success(t("calendar.eventCreated")); }
      closeModal(); fetchEvents();
    } catch { message.error(t("calendar.saveFailed")); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!editingEvent) return;
    setDeleting(true);
    try {
      await DeleteCalendarEvent(editingEvent.id);
      message.success(t("calendar.eventDeleted")); setDeleteConfirm(false); setModalOpen(false); setEditingEvent(null); fetchEvents();
    } catch { message.error(t("calendar.deleteFailed")); }
    finally { setDeleting(false); }
  };

  const handleDateClick  = (info: DateClickArg)  => openCreate(info.dateStr);
  const handleEventClick = (info: EventClickArg) => {
    const ev = info.event.extendedProps as CalEvent;
    openEdit({ ...ev, id: Number(info.event.id), title: info.event.title });
  };

  const getApi     = (): CalendarApi | null => calRef.current?.getApi() ?? null;
  const goToday    = () => getApi()?.today();
  const goPrev     = () => getApi()?.prev();
  const goNext     = () => getApi()?.next();
  const changeView = (v: string) => {
    setCurrentView(v); const api = getApi(); if (!api) return;
    if (v === "listYear") { const first = events[0]?.start_date; const year = first ? dayjs(first).year() : dayjs().year(); api.changeView(v, `${year}-01-01`); }
    else api.changeView(v);
  };

  // Picking a category sets the colour to that category's, which the user may then override.
  // Applied in the change handler rather than in an effect: an effect also fired while EDITING an
  // existing event, overwriting a colour the user had deliberately chosen.
  const pickCategory = (key: string) => {
    setDraft((d) => ({ ...d, category: key, color: getCategoryColor(key, CATEGORY_COLOR_MAP, currentColor) }));
    setErrors((e) => (e.category ? { ...e, category: false } : e));
  };

  const VIEW_TABS = [
    { key: "dayGridMonth", label: t("calendar.month") },
    { key: "timeGridWeek", label: t("calendar.week") },
    { key: "timeGridDay",  label: t("calendar.day") },
    { key: "listYear",     label: t("calendar.list") },
  ];

  const accentGradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))`;

  const ActivityPanel = (
    <div className="flex flex-col overflow-hidden rounded-sm border hairline surface-card shadow-sm h-full">
      <div className="flex shrink-0 items-center justify-between border-b hairline-2 px-4 py-3">
        <span className="text-[13.5px] font-bold ink">{t("calendar.activityLabel")} :</span>
        <button type="button" onClick={goToday}
          className="accent-outline rounded-[4px] border px-2.5 py-1 text-[10.5px] font-semibold transition-colors focus:outline-none">
          {t("calendar.viewAll")}
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-0.5">
        {loading && (
          <div className="flex h-20 items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-t-transparent" style={{ borderColor: `${currentColor} transparent transparent transparent` }} />
          </div>
        )}
        {!loading && activityEvents.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 ink-3">
            <BsCalendar3 className="text-[24px] mb-2" /><p className="text-[11.5px]">{t("calendar.noEvents")}</p>
          </div>
        )}
        {!loading && activityEvents.map((ev) => {
          const { bg, text, label } = STATUS[getStatus(ev)];
          const dot = ev.color || getCategoryColor(ev.category, CATEGORY_COLOR_MAP, currentColor);
          return (
            <button key={ev.id} type="button" onClick={() => openEdit(ev)} className="group w-full flex flex-col gap-1 rounded-[4px] px-3 py-2.5 text-left transition-all surface-hover focus:outline-none">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dot }} />
                <span className="truncate text-[11.5px] font-semibold ink">{fmtDate(ev.start_date)}</span>
              </div>
              <div className="pl-4 flex items-center justify-between gap-1">
                <p className="truncate text-[11.5px] ink-2 flex-1">{ev.title}</p>
                {!ev.all_day && <span className="shrink-0 text-[10px] ink-3">{fmtTime(ev.start_date)}</span>}
              </div>
              <div className="pl-4">
                <span className="inline-block rounded-full px-2 py-0.5 text-[9.5px] font-semibold" style={{ backgroundColor: bg, color: text }}>{label}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. The hero's own "Create Event" action is not repeated here — the mobile
          and desktop layouts below each already carry their own, dedicated create button. */}
      <style>{`
        .fc { font-family: inherit; }
        .fc .fc-toolbar { display:none !important; }
        .fc .fc-daygrid-day-number { font-size:12px; color:#64748b; padding:4px 6px; }
        .fc .fc-col-header-cell-cushion { font-size:11px; font-weight:600; color:#94a3b8; text-transform:uppercase; letter-spacing:.06em; padding:6px 0; text-decoration:none; }
        .fc .fc-daygrid-event { border-radius:5px; font-size:11px; font-weight:500; padding:1px 5px; margin:1px 2px; border:none !important; }
        .fc .fc-event-title { white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        .fc .fc-daygrid-day.fc-day-today .fc-daygrid-day-number { background:${currentColor}; color:#fff; border-radius:50%; width:26px; height:26px; display:flex; align-items:center; justify-content:center; margin:3px; padding:0; }
        .fc .fc-daygrid-day.fc-day-today { background:${currentColor}0a; }
        .fc .fc-scrollgrid { border:none !important; }
        .fc .fc-scrollgrid td,.fc .fc-scrollgrid th { border-color:#f1f5f9 !important; }
        .fc thead .fc-scrollgrid-sync-inner { border-bottom:1px solid #f1f5f9; }
        .dark .fc .fc-daygrid-day-number { color:rgba(255,255,255,.45); }
        .dark .fc .fc-col-header-cell-cushion { color:rgba(255,255,255,.3); }
        .dark .fc .fc-scrollgrid td,.dark .fc .fc-scrollgrid th { border-color:rgba(255,255,255,.08) !important; }
        .dark .fc thead .fc-scrollgrid-sync-inner { border-color:rgba(255,255,255,.08); }
        .dark .fc .fc-daygrid-day.fc-day-today { background:${currentColor}14; }
        .fc .fc-list-event:hover td { background:${currentColor}0f; }
        .fc .fc-list-day-cushion { background:#f8fafc; }
        .dark .fc .fc-list-day-cushion { background:rgba(255,255,255,.04); }
        .fc .fc-timegrid-slot { height:2.25rem; }
        .ant-form-item { margin-bottom:10px; }
        .ant-form-item-label { padding-bottom:3px !important; }
      `}</style>

      {/* ══ MOBILE ══ */}
      <div className="flex flex-col gap-3 lg:hidden">
        <div className="flex gap-2">
          <button type="button" onClick={() => openCreate()}
            className="flex flex-1 items-center justify-center gap-2 rounded-[4px] py-3 text-[13px] font-semibold text-white shadow-lg active:scale-[0.98] focus:outline-none transition-all"
            style={{ background: accentGradient, boxShadow: `0 8px 24px -6px ${currentColor}40` }}>
            <FiPlus className="text-[16px]" />{t("calendar.createEvent")}
          </button>
          <button type="button" onClick={() => setShowActivity((v) => !v)}
            className="flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3.5 text-[12px] font-semibold ink-2 shadow-sm transition-all surface-hover focus:outline-none">
            <BsCalendar3 className="text-[13px]" />{t("calendar.activityLabel")}
            <FiChevronDown className={`text-[12px] transition-transform ${showActivity ? "rotate-180" : ""}`} />
          </button>
        </div>

        {showActivity && <div style={{ maxHeight: "40vh" }}>{ActivityPanel}</div>}

        <div className="flex flex-col overflow-hidden rounded-sm border hairline surface-card shadow-sm">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b hairline-2 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="w-0.75 self-stretch rounded-full" style={{ background: `linear-gradient(to bottom, ${currentColor}, color-mix(in srgb, ${currentColor} 60%, purple))` }} />
              <h2 className="text-[15px] font-bold ink">{t("calendar.fullCalendar")}</h2>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="flex items-center gap-0.5 rounded-[4px] border hairline surface-sunken p-0.5">
                <button type="button" onClick={goPrev} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[16px] ink-2 surface-hover transition-all focus:outline-none">‹</button>
                <button type="button" onClick={goNext} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[16px] ink-2 surface-hover transition-all focus:outline-none">›</button>
              </div>
              <button type="button" onClick={goToday}
                className="accent-outline rounded-[4px] border px-3 py-1.5 text-[11px] font-semibold transition-colors focus:outline-none">
                {t("calendar.todayBtn")}
              </button>
            </div>
            <div className="flex w-full gap-0.5 overflow-x-auto rounded-[4px] border hairline surface-sunken p-0.5">
              {VIEW_TABS.map((v) => (
                <button key={v.key} type="button" onClick={() => changeView(v.key)}
                  className="flex-1 whitespace-nowrap rounded-[4px] px-2 py-1.5 text-[11px] font-semibold transition-all focus:outline-none ink-2"
                  style={currentView === v.key ? { background: accentGradient, color: "white" } : undefined}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-auto p-2" style={{ height: "calc(100dvh - 280px)", minHeight: "380px" }}>
            <FullCalendar ref={calRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView="dayGridMonth" headerToolbar={false} events={fcEvents} editable={false} selectable dateClick={handleDateClick} eventClick={handleEventClick} height="100%" dayMaxEvents={2} eventDisplay="block" nowIndicator />
          </div>
        </div>
      </div>

      {/* ══ DESKTOP ══ */}
      <div className="hidden lg:flex gap-4 overflow-hidden" style={{ height: "calc(100dvh - 120px)" }}>
        <div className="flex w-64 shrink-0 flex-col gap-3">
          <button type="button" onClick={() => openCreate()}
            className="flex w-full items-center justify-center gap-2 rounded-[4px] py-3 text-[13.5px] font-semibold text-white shadow-lg transition-all hover:scale-[1.01] active:scale-[0.98] focus:outline-none"
            style={{ background: accentGradient, boxShadow: `0 8px 24px -6px ${currentColor}40` }}>
            <FiPlus className="text-[17px]" />{t("calendar.createEvent")}
          </button>
          <div className="flex-1 overflow-hidden">{ActivityPanel}</div>
        </div>

        <div className="flex flex-1 min-w-0 flex-col overflow-hidden rounded-sm border hairline surface-card shadow-sm">
          <div className="flex shrink-0 items-center justify-between border-b hairline-2 px-5 py-3.5">
            <div className="flex items-center gap-2.5">
              <span className="w-0.75 self-stretch rounded-full" style={{ background: `linear-gradient(to bottom, ${currentColor}, color-mix(in srgb, ${currentColor} 60%, purple))` }} />
              <h2 className="text-[17px] font-bold ink">{t("calendar.fullCalendar")}</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 rounded-[4px] border hairline surface-sunken p-0.5">
                <button type="button" onClick={goPrev} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[16px] ink-2 surface-hover transition-all focus:outline-none">‹</button>
                <button type="button" onClick={goNext} className="flex h-7 w-7 items-center justify-center rounded-[4px] text-[16px] ink-2 surface-hover transition-all focus:outline-none">›</button>
              </div>
              <button type="button" onClick={goToday}
                className="accent-outline rounded-[4px] border px-3.5 py-1.5 text-[12px] font-semibold transition-colors focus:outline-none">
                {t("calendar.todayBtn")}
              </button>
              <div className="flex items-center gap-0.5 rounded-[4px] border hairline surface-sunken p-0.5">
                {VIEW_TABS.map((v) => (
                  <button key={v.key} type="button" onClick={() => changeView(v.key)}
                    className="rounded-[4px] px-3 py-1.5 text-[11.5px] font-semibold transition-all focus:outline-none ink-2"
                    style={currentView === v.key ? { background: accentGradient, color: "white" } : undefined}>
                    {v.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4">
            <FullCalendar ref={calRef} plugins={[dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin]} initialView="dayGridMonth" headerToolbar={false} events={fcEvents} editable={false} selectable dateClick={handleDateClick} eventClick={handleEventClick} height="100%" dayMaxEvents={3} eventDisplay="block" nowIndicator />
          </div>
        </div>
      </div>

      {/* ══ MODAL ══ */}
      {modalOpen && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          <div role="presentation" className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={closeModal} />
          <div className="relative z-10 w-full max-w-105 overflow-hidden rounded-sm surface-card ring-1 ring-black/5 dark:ring-white/10">
            <div className="flex items-center justify-between border-b hairline-2 px-4 py-3.5 sm:px-5 sm:py-4">
              <div className="flex items-center gap-2.5">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: accentGradient }}>
                  <BsCalendar3 className="text-[14px]" />
                </span>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: currentColor }}>
                    {editingEvent ? t("calendar.editEventBadge") : t("calendar.newEventBadge")}
                  </p>
                  <h3 className="text-[14px] sm:text-[15px] font-bold leading-tight ink">
                    {editingEvent ? editingEvent.title : t("calendar.createEventTitle")}
                  </h3>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {editingEvent && (
                  <button type="button" onClick={() => setDeleteConfirm(true)} disabled={deleting} className="flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400 transition-colors focus:outline-none disabled:opacity-50" title={t("common.delete")}>
                    <FiTrash2 className="text-[14px]" />
                  </button>
                )}
                <button type="button" onClick={closeModal} disabled={saving || deleting} className="flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none">
                  <FiX className="text-[15px]" />
                </button>
              </div>
            </div>
            <div className="px-4 py-4 sm:px-5">
              <div className="space-y-3">
                <label className="block">
                  <span className="field-label">{t("calendar.titleLabel")}</span>
                  <input
                    className="shell-input"
                    style={errors.title ? { borderColor: "#ef4444" } : undefined}
                    placeholder={t("calendar.titlePlaceholder")}
                    value={draft.title}
                    onChange={(e) => set("title", e.target.value)}
                  />
                </label>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <label className="block">
                    <span className="field-label">{t("calendar.startLabel")}</span>
                    {/* Native datetime-local: it brings the platform's own picker, keyboard entry
                        and locale for free, which is most of what antd's DatePicker was doing. */}
                    <input
                      type="datetime-local"
                      className="shell-input"
                      style={errors.start_date ? { borderColor: "#ef4444" } : undefined}
                      value={draft.start_date}
                      onChange={(e) => set("start_date", e.target.value)}
                    />
                  </label>
                  <label className="block">
                    <span className="field-label">{t("calendar.endLabel")}</span>
                    <input
                      type="datetime-local"
                      className="shell-input"
                      style={errors.end_date ? { borderColor: "#ef4444" } : undefined}
                      value={draft.end_date}
                      onChange={(e) => set("end_date", e.target.value)}
                    />
                  </label>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div className="block">
                    <span className="field-label">{t("calendar.categoryLabel")}</span>
                    <MinimalSelect
                      ariaLabel={t("calendar.categoryLabel")}
                      className="w-full"
                      value={draft.category}
                      onChange={pickCategory}
                      options={CATEGORIES.map((c) => ({ value: c.key, label: c.label }))}
                    />
                  </div>
                  <label className="block">
                    <span className="field-label">{t("calendar.colorLabel")}</span>
                    <input
                      type="color"
                      className="shell-input cursor-pointer p-1"
                      style={{ height: 38 }}
                      value={draft.color || currentColor}
                      onChange={(e) => set("color", e.target.value)}
                    />
                  </label>
                </div>

                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5"
                    style={{ accentColor: currentColor }}
                    checked={draft.all_day}
                    onChange={(e) => set("all_day", e.target.checked)}
                  />
                  <span className="ink-2 text-[12.5px]">{t("calendar.allDay")}</span>
                </label>

                <label className="block">
                  <span className="field-label">{t("calendar.noteLabel")}</span>
                  <textarea
                    rows={2}
                    className="shell-textarea"
                    placeholder={t("calendar.notePlaceholder")}
                    value={draft.description}
                    onChange={(e) => set("description", e.target.value)}
                  />
                </label>

                {errors.end_date && dayjs(draft.end_date).isBefore(dayjs(draft.start_date)) && (
                  <p className="m-0 text-[11.5px] text-red-500">The end time must be after the start time</p>
                )}

                <div className="flex gap-2 pt-1">
                  <button type="button" onClick={closeModal} disabled={saving || deleting}
                    className="btn btn-ghost btn-sm flex-1">{t("common.cancel")}</button>
                  <button type="button" onClick={handleSave} disabled={saving || deleting}
                    className="btn btn-accent btn-sm flex-1">
                    {saving && <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                    {saving ? t("calendar.saving") : editingEvent ? t("calendar.update") : t("calendar.create")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ══ DELETE CONFIRM ══ — the calendar-mascot card, matching the app's other delete dialogs. */}
      {deleteConfirm && editingEvent && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !deleting && setDeleteConfirm(false)} />
          <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
            <button type="button" onClick={() => !deleting && setDeleteConfirm(false)} disabled={deleting} aria-label={t("common.cancel")}
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
              <FiX className="text-[16px]" />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <CalendarMascot className="mx-auto mb-3 h-24 w-24" title={editingEvent.title} />
              <h3 className="truncate text-[17px] font-bold leading-tight ink">{editingEvent.title || t("calendar.createEventTitle")}</h3>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">
                This event will be permanently removed from your calendar.
              </p>

              <button type="button" onClick={handleDelete} disabled={deleting}
                className={["mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
                  deleting ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50" : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
                ].join(" ")}>
                {deleting
                  ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <FiTrash2 className="text-[13px]" />}
                {deleting ? t("calendar.saving") : t("common.delete")}
              </button>
              <button type="button" onClick={() => !deleting && setDeleteConfirm(false)} disabled={deleting}
                className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

export default CalendarPage;
