import React, { useMemo, useState } from "react";
import VirtualList from "../../components/ui/VirtualList";
import { createPortal } from "react-dom";
import { FiChevronDown, FiSearch, FiPlusSquare, FiInfo } from "react-icons/fi";
import { avSectionHdr } from "./antivirus-form";
import { SideDrawer, DrawerRow, SegmentedPills, FilterTable } from "../../components/ui/filter-table";
import type {
  AppControlProfileForm, AppControlMetadata, AppAction,
  AppCategoryAction, AppNetworkService, AppOverride, AppSignatureRef,
} from "../../api/policyObject";
import { activateOnKey } from "../../components/ui/keyActivate";
import { APP_ACTIONS } from "./appcontrol-sections.logic";

type SetFn = <K extends keyof AppControlProfileForm>(k: K, v: AppControlProfileForm[K]) => void;

// ─── Action vocabulary (matches the FortiGate per-category dropdown) ──────────────────
const actionMeta = (v: AppAction) => APP_ACTIONS.find((a) => a.v === v) ?? APP_ACTIONS[0];

// Network Protocol Enforcement — GUI protocol labels ↔ CMDB "services" flags.
const NPE_PROTOCOLS: { v: string; l: string }[] = [
  { v: "dns", l: "DNS" }, { v: "ftp", l: "FTP" }, { v: "http", l: "HTTP" }, { v: "https", l: "HTTPS" },
  { v: "imap", l: "IMAP" }, { v: "nntp", l: "NNTP" }, { v: "pop3", l: "POP3" }, { v: "smtp", l: "SMTP" },
  { v: "snmp", l: "SNMP" }, { v: "ssh", l: "SSH" }, { v: "telnet", l: "TELNET" },
];
const npeLabel = (v: string) => NPE_PROTOCOLS.find((p) => p.v === v)?.l ?? v.toUpperCase();

// FortiGate-style popularity (0-5 stars) and risk (5 severity bars) renderers.
const Stars: React.FC<{ n: number }> = ({ n }) => (
  <span className="whitespace-nowrap text-[11px] tracking-tight">
    <span className="text-amber-400">{"★".repeat(Math.max(0, Math.min(5, n)))}</span>
    <span className="ink-3">{"★".repeat(Math.max(0, 5 - n))}</span>
  </span>
);
const RiskBars: React.FC<{ n: number }> = ({ n }) => {
  const color = n >= 4 ? "#ef4444" : n >= 3 ? "#f59e0b" : "#3b82f6";
  return (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className="h-2.5 w-1.5 rounded-[1px] surface-sunken"
          style={i <= n ? { backgroundColor: color } : undefined} />
      ))}
    </span>
  );
};

// ─── Portal-positioned dropdown menu (never clipped by the scrolling grid) ────────────
const ActionMenu: React.FC<{
  value: AppAction; onChange: (v: AppAction) => void; allowQuarantine?: boolean;
}> = ({ value, onChange, allowQuarantine = true }) => {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const cur = actionMeta(value);
  const opts = allowQuarantine ? APP_ACTIONS : APP_ACTIONS.filter((a) => a.v !== "quarantine");

  return (
    <>
      <button type="button"
        onClick={(e) => { setRect(e.currentTarget.getBoundingClientRect()); setOpen(true); }}
        className="inline-flex items-center gap-1 rounded-[4px] border hairline surface-card px-1.5 py-1 surface-hover"
        title={cur.label}>
        <span style={{ color: cur.color }}>{cur.icon}</span>
        <FiChevronDown size={11} className="ink-3" />
      </button>
      {open && rect && createPortal(
        <div role="presentation" className="fixed inset-0 z-9998" onClick={() => setOpen(false)}>
          <div role="presentation" className="absolute min-w-37.5 overflow-hidden rounded-[4px] border hairline surface-card py-1 shadow-xl"
            style={{ top: rect.bottom + 4, left: rect.left }}
            onClick={(e) => e.stopPropagation()}>
            {opts.map((o) => (
              <button key={o.v} type="button"
                onClick={() => { onChange(o.v); setOpen(false); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] surface-hover ${o.v === value ? "font-semibold" : ""}`}>
                <span style={{ color: o.color }}>{o.icon}</span>
                <span className="ink">{o.label}</span>
              </button>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ─── Categories grid ─────────────────────────────────────────────────────────────────
// One category tile. At module scope, NOT inside ACCategoriesGrid.
//
// Declared inside a render it became a new component type on every render of the grid, so React
// unmounted and remounted all ~90 tiles instead of updating them — taking each ActionMenu's
// open/closed state with them. Opening a tile's menu and then touching anything that re-rendered
// the parent (the "Set all categories" dropdown does exactly that) closed the menu again.
const Tile: React.FC<{
  name: string; value: AppAction; onChange: (v: AppAction) => void; allowQuarantine?: boolean;
}> = ({ name, value, onChange, allowQuarantine }) => (
  <div className="flex items-center gap-2 rounded-[4px] border hairline surface-card px-2.5 py-2">
    <ActionMenu value={value} onChange={onChange} allowQuarantine={allowQuarantine} />
    <span className="truncate text-[12px] font-medium ink" title={name}>{name}</span>
  </div>
);

// No `currentColor` here, unlike the two sections below it: this grid colours itself from the
// action of each category rather than from the profile's accent, so the prop was passed, taken and
// never read.
export const ACCategoriesGrid: React.FC<{
  form: AppControlProfileForm; set: SetFn; meta: AppControlMetadata;
}> = ({ form, set, meta }) => {
  // Fast lookup of the current action for a category id (default: monitor).
  const actionOf = (id: number): AppAction =>
    form.categories.find((c) => c.category === id)?.action ?? "monitor";

  const setCategory = (id: number, action: AppAction) => {
    const others = form.categories.filter((c) => c.category !== id);
    set("categories", [...others, { category: id, action }] as AppCategoryAction[]);
  };
  const setAll = (action: AppAction) =>
    set("categories", meta.categories.map((c) => ({ category: c.id, action })) as AppCategoryAction[]);

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRect, setBulkRect] = useState<DOMRect | null>(null);

  return (
    <>
      <div className={avSectionHdr}>Categories</div>
      <div className="px-6 py-5">
        {/* Bulk setter — the FortiGate "Mixed ▾" dropdown that sets every category at once. */}
        <div className="mb-4 flex items-center gap-3">
          <button type="button"
            onClick={(e) => { setBulkRect(e.currentTarget.getBoundingClientRect()); setBulkOpen(true); }}
            className="inline-flex items-center gap-2 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink surface-hover">
            Set all categories <FiChevronDown size={12} className="ink-3" />
          </button>
          <span className="text-[11px] ink-3">Choose an action to apply to every category</span>
        </div>
        {bulkOpen && bulkRect && createPortal(
          <div role="presentation" className="fixed inset-0 z-9998" onClick={() => setBulkOpen(false)}>
            <div role="presentation" className="absolute min-w-37.5 overflow-hidden rounded-[4px] border hairline surface-card py-1 shadow-xl"
              style={{ top: bulkRect.bottom + 4, left: bulkRect.left }} onClick={(e) => e.stopPropagation()}>
              {APP_ACTIONS.map((o) => (
                <button key={o.v} type="button" onClick={() => { setAll(o.v); setBulkOpen(false); }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] surface-hover">
                  <span style={{ color: o.color }}>{o.icon}</span>
                  <span className="ink">{o.label}</span>
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}

        {/* Category tiles */}
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {meta.categories.map((c) => (
            <Tile key={c.id} name={c.name} value={actionOf(c.id)} onChange={(v) => setCategory(c.id, v)} />
          ))}
          {/* Unknown Applications — maps to unknown-application-action (no Quarantine option). */}
          <Tile name="Unknown Applications" value={form.unknown_application_action} allowQuarantine={false}
            onChange={(v) => set("unknown_application_action", v)} />
        </div>

        {/* Legend */}
        <div className="mt-4 flex flex-wrap gap-4">
          {APP_ACTIONS.map((a) => (
            <span key={a.v} className="inline-flex items-center gap-1.5 text-[11px] ink-2">
              <span style={{ color: a.color }}>{a.icon}</span> {a.label}
            </span>
          ))}
        </div>
      </div>
    </>
  );
};

// ─── Network Protocol Enforcement (toggle handled by parent) ──────────────────────────
const NEW_NPE: AppNetworkService = { id: 0, port: 0, services: [], violation_action: "block" };

export const ACNetworkServices: React.FC<{
  form: AppControlProfileForm; set: SetFn; currentColor: string;
}> = ({ form, set, currentColor }) => {
  const rows = form.network_services;
  const [draft, setDraft] = useState<{ entry: AppNetworkService; index: number | null } | null>(null);

  const save = () => {
    if (!draft) return;
    const next = [...rows];
    if (draft.index === null) next.push(draft.entry);
    else next[draft.index] = draft.entry;
    set("network_services", next);
    setDraft(null);
  };

  const toggleProto = (p: string) => {
    if (!draft) return;
    const has = draft.entry.services.includes(p);
    const services = has ? draft.entry.services.filter((s) => s !== p) : [...draft.entry.services, p];
    setDraft({ ...draft, entry: { ...draft.entry, services } });
  };

  return (
    <div className="px-6 pb-5">
      <FilterTable<AppNetworkService>
        rows={rows} color={currentColor} gridCols="1fr 2fr 1.2fr"
        matches={(r, q) => String(r.port).includes(q) || r.services.some((s) => s.includes(q))}
        columns={[
          { key: "port", header: "Port", render: (r) => r.port || "—" },
          { key: "services", header: "Enforce Protocols", render: (r) => r.services.map(npeLabel).join(", ") || "—" },
          { key: "violation", header: "Violation Action", render: (r) => (
            <span className="capitalize" style={{ color: r.violation_action === "block" ? "#ef4444" : "#3b82f6" }}>
              {r.violation_action}
            </span>
          ) },
        ]}
        onCreate={() => setDraft({ entry: { ...NEW_NPE, services: [] }, index: null })}
        onEdit={(i) => setDraft({ entry: { ...rows[i], services: [...rows[i].services] }, index: i })}
        onDelete={(i) => set("network_services", rows.filter((_, x) => x !== i))}
      />

      <SideDrawer open={!!draft} color={currentColor}
        title={draft?.index === null ? "New Default Network Service" : "Edit Default Network Service"}
        canSave={!!draft && draft.entry.port > 0 && draft.entry.services.length > 0}
        onOK={save} onCancel={() => setDraft(null)}>
        {draft && (
          <>
            <DrawerRow label="Port">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus type="number" min={1} max={65535} value={draft.entry.port || ""}
                placeholder="e.g. 53"
                onChange={(e) => setDraft({ ...draft, entry: { ...draft.entry, port: Number(e.target.value) || 0 } })}
                className="h-8 w-40 rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none dark:bg-yellow-900/10" />
            </DrawerRow>
            <DrawerRow label="Enforce protocols" top>
              <div className="flex flex-wrap gap-1.5">
                {NPE_PROTOCOLS.map((p) => {
                  const on = draft.entry.services.includes(p.v);
                  return (
                    <button key={p.v} type="button" onClick={() => toggleProto(p.v)}
                      className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "text-white" : "ink-2 hairline surface-hover"}`}
                      style={on ? { backgroundColor: currentColor, borderColor: currentColor } : undefined}>
                      {p.l}
                    </button>
                  );
                })}
              </div>
            </DrawerRow>
            <DrawerRow label="Violation action">
              <SegmentedPills label="Violation action" opts={[{ v: "monitor", l: "Monitor" }, { v: "block", l: "Block" }]}
                value={draft.entry.violation_action} color={currentColor}
                onChange={(v) => setDraft({ ...draft, entry: { ...draft.entry, violation_action: v as "monitor" | "block" } })} />
            </DrawerRow>
          </>
        )}
      </SideDrawer>
    </div>
  );
};

// ─── Application and Filter Overrides ─────────────────────────────────────────────────
const NEW_OVERRIDE: AppOverride = {
  type: "application", action: "block",
  applications: [], categories: [], risk: [], popularity: [],
  technologies: [], behaviors: [], protocols: [], vendors: [],
};

// Column template for the application-signature picker table.
const APP_GRID = "24px 1.6fr 1fr 1fr 90px 74px";
/** Every signature row is exactly this tall — VirtualList divides by it. */
const APP_ROW_H = 30;

// Merge signature refs, keeping the first occurrence of each id (used by "Add All Results").
const dedupeApps = (list: AppSignatureRef[]): AppSignatureRef[] => {
  const seen = new Set<number>();
  const out: AppSignatureRef[] = [];
  for (const a of list) {
    if (!seen.has(a.id)) { seen.add(a.id); out.push(a); }
  }
  return out;
};

// A block of selectable chips for a filter attribute.
function ChipGroup<T extends string | number>({ title, options, selected, onToggle, color, labelOf }: {
  title: string; options: T[]; selected: T[]; onToggle: (v: T) => void; color: string; labelOf?: (v: T) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mb-3">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider ink-3">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const on = selected.includes(o);
          return (
            <button key={String(o)} type="button" onClick={() => onToggle(o)}
              className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "text-white" : "ink-2 hairline surface-hover"}`}
              style={on ? { backgroundColor: color, borderColor: color } : undefined}>
              {labelOf ? labelOf(o) : String(o)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const overrideDetails = (o: AppOverride, catName: (id: number) => string, appName: (id: number) => string): string => {
  if (o.type === "application") {
    return o.applications.length ? o.applications.map((a) => a.name || appName(a.id)).join(", ") : "No applications";
  }
  const parts: string[] = [];
  if (o.categories.length) parts.push(o.categories.map(catName).join(", "));
  if (o.risk.length) parts.push(`Risk ${o.risk.join("/")}`);
  if (o.technologies.length) parts.push(o.technologies.join("/"));
  if (o.behaviors.length) parts.push(o.behaviors.join("/"));
  if (o.popularity.length) parts.push(`Pop ${o.popularity.join("/")}`);
  if (o.protocols.length) parts.push(o.protocols.join("/"));
  if (o.vendors.length) parts.push(o.vendors.join("/"));
  return parts.join(" · ") || "All applications";
};

export const ACOverrides: React.FC<{
  form: AppControlProfileForm; set: SetFn; meta: AppControlMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const rows = form.overrides;
  const [draft, setDraft] = useState<{ entry: AppOverride; index: number | null } | null>(null);
  const [appSearch, setAppSearch] = useState("");
  const [appTab, setAppTab] = useState<"all" | "selected" | "cloud">("all");

  const catName = (id: number) => meta.categories.find((c) => c.id === id)?.name ?? `#${id}`;
  const appName = (id: number) => meta.applications.find((a) => a.id === id)?.name ?? `#${id}`;
  // Cloud tab ≈ applications in cloud-storage / cloud-IT categories (Storage.Backup 22, Cloud.IT 30).
  const CLOUD_CATEGORIES = [22, 30];

  const save = () => {
    if (!draft) return;
    const next = [...rows];
    if (draft.index === null) next.push(draft.entry);
    else next[draft.index] = draft.entry;
    set("overrides", next);
    setDraft(null);
  };

  const patch = (p: Partial<AppOverride>) => draft && setDraft({ ...draft, entry: { ...draft.entry, ...p } });
  const toggleIn = <T,>(arr: T[], v: T): T[] => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const selectedIds = new Set((draft?.entry.applications ?? []).map((a) => a.id));
  const filteredApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    let list = meta.applications;
    if (appTab === "cloud") list = list.filter((a) => CLOUD_CATEGORIES.includes(a.category));
    if (appTab === "selected") list = list.filter((a) => selectedIds.has(a.id));
    if (q) list = list.filter((a) => a.name.toLowerCase().includes(q) || catName(a.category).toLowerCase().includes(q));
    // Show the full result set (the FortiGate GUI renders all ~2,414 in a scroll list); the
    // 3,000 ceiling is just a safety guard against a pathological signature DB.
    return list.slice(0, 3000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSearch, appTab, meta.applications, draft?.entry.applications]);

  const canSave = !!draft && (draft.entry.type === "application"
    ? draft.entry.applications.length > 0
    : (draft.entry.categories.length + draft.entry.risk.length + draft.entry.popularity.length +
       draft.entry.technologies.length + draft.entry.behaviors.length +
       draft.entry.protocols.length + draft.entry.vendors.length) > 0);

  const toggleApp = (ref: AppSignatureRef) => {
    if (!draft) return;
    const has = draft.entry.applications.some((a) => a.id === ref.id);
    patch({ applications: has ? draft.entry.applications.filter((a) => a.id !== ref.id) : [...draft.entry.applications, ref] });
  };

  return (
    <div className="px-6 pb-5">
      <FilterTable<AppOverride>
        rows={rows} color={currentColor} gridCols="70px 1fr 110px 110px"
        matches={(r, q) => overrideDetails(r, catName, appName).toLowerCase().includes(q) || r.type.includes(q)}
        columns={[
          { key: "priority", header: "Priority", render: (_r) => <span className="ink-3">{rows.indexOf(_r) + 1}</span> },
          { key: "details", header: "Details", render: (r) => overrideDetails(r, catName, appName) },
          { key: "type", header: "Type", render: (r) => <span className="capitalize">{r.type}</span> },
          { key: "action", header: "Action", render: (r) => {
            const m = actionMeta(r.action);
            return <span className="inline-flex items-center gap-1 capitalize" style={{ color: m.color }}>{m.icon} {m.label}</span>;
          } },
        ]}
        onCreate={() => { setAppSearch(""); setDraft({ entry: { ...NEW_OVERRIDE }, index: null }); }}
        onEdit={(i) => { setAppSearch(""); setDraft({ entry: JSON.parse(JSON.stringify(rows[i])), index: i }); }}
        onDelete={(i) => set("overrides", rows.filter((_, x) => x !== i))}
      />

      <SideDrawer open={!!draft} color={currentColor}
        title={draft?.index === null ? "Add New Override" : "Edit Override"}
        canSave={canSave} onOK={save} onCancel={() => setDraft(null)}>
        {draft && (
          <>
            <DrawerRow label="Type">
              <SegmentedPills label="Override type" opts={[{ v: "application", l: "Application" }, { v: "filter", l: "Filter" }]}
                value={draft.entry.type} color={currentColor}
                onChange={(v) => patch({ type: v as "application" | "filter" })} />
            </DrawerRow>
            <DrawerRow label="Action">
              <SegmentedPills label="Override action" opts={APP_ACTIONS.map((a) => ({ v: a.v, l: a.label }))}
                value={draft.entry.action} color={currentColor}
                onChange={(v) => patch({ action: v as AppAction })} />
            </DrawerRow>

            <div className="mt-3 border-t hairline-2 pt-3">
              {draft.entry.type === "application" ? (
                meta.app_db_source !== "live" ? (
                  // Live-only: no fabricated signatures. Steer the user to a Filter override,
                  // which matches applications by attribute and needs no signature database.
                  <div className="rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-3.5 text-[12px] text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/8 dark:text-amber-300">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold">
                      <FiInfo size={14} /> Application signature database not available on this device
                    </div>
                    <p className="mb-2 leading-relaxed">
                      This form reads the same source the FortiGate GUI uses for its 2,414-app table
                      (<code>monitor/fortiguard/app-information</code>), but this device's FortiGuard
                      Application Control service returns no signatures (unlicensed / cloud unreachable),
                      so there are none to pick — and this form never saves a made-up ID. Use a{" "}
                      <strong>Filter</strong> override to match applications by category, risk, technology,
                      behavior or popularity (no signature database required), or connect a device whose
                      FortiGuard Application Control service is active to browse the full list.
                    </p>
                    <button type="button" onClick={() => patch({ type: "filter" })}
                      className="inline-flex items-center gap-1.5 rounded-[4px] px-3 py-1.5 text-[12px] font-semibold text-white"
                      style={{ backgroundColor: currentColor }}>
                      Switch to Filter override
                    </button>
                  </div>
                ) : (
                <>
                  {/* Toolbar — Add All Results · Search · Selected/All/Cloud tabs (mirrors FortiGate) */}
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <button type="button"
                      onClick={() => patch({ applications: dedupeApps([...draft.entry.applications, ...filteredApps.map((a) => ({ id: a.id, name: a.name }))]) })}
                      className="inline-flex items-center gap-1.5 rounded-[4px] border hairline px-2.5 py-1 text-[12px] font-semibold ink-2 surface-hover">
                      <FiPlusSquare size={13} /> Add All Results
                    </button>
                    <div className="relative min-w-45 flex-1">
                      <FiSearch size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
                      <input value={appSearch} onChange={(e) => setAppSearch(e.target.value)} placeholder="Search"
                        className="h-8 w-full rounded border hairline surface-card pl-8 pr-2 text-[13px] outline-none" />
                    </div>
                    <div className="inline-flex overflow-hidden rounded-[4px] border hairline">
                      {([["selected", `Selected ${draft.entry.applications.length}`], ["all", "All"], ["cloud", "Cloud"]] as const).map(([v, l]) => (
                        <button key={v} type="button" onClick={() => setAppTab(v)}
                          className={`px-2.5 py-1 text-[12px] font-semibold transition-colors ${appTab === v ? "text-white" : "ink-2 surface-hover"}`}
                          style={appTab === v ? { backgroundColor: currentColor } : undefined}>{l}</button>
                      ))}
                    </div>
                  </div>

                  {/* Signature table: checkbox · Name · Category · Technology · Popularity · Risk */}
                  <div className="overflow-hidden rounded-[4px] border hairline">
                    <div className="grid items-center gap-2 border-b hairline surface-sunken px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider ink-2"
                      style={{ gridTemplateColumns: APP_GRID }}>
                      <span />
                      <span>Name</span><span>Category</span><span>Technology</span><span>Popularity</span><span>Risk</span>
                    </div>
                    {/* Windowed: this list is the FortiGuard signature database, ~2,414 rows of six
                        columns. Rendering all of them put roughly 15,000 elements in the DOM before
                        the drawer could paint, and rebuilt them on every keystroke in the search
                        box above. VirtualList renders what the 288px box can show plus a margin —
                        see components/ui/VirtualList for why the row height has to be fixed. */}
                    <VirtualList
                      rows={filteredApps}
                      rowHeight={APP_ROW_H}
                      height={288}
                      keyOf={(a) => a.id}
                      empty={<div className="py-10 text-center text-[12px] ink-3">No results</div>}
                      render={(a) => {
                        const on = selectedIds.has(a.id);
                        return (
                          <div role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            onClick={() => toggleApp({ id: a.id, name: a.name })}
                            onKeyDown={activateOnKey(() => toggleApp({ id: a.id, name: a.name }))}
                            className={`grid h-full cursor-pointer items-center gap-2 border-b hairline-2 px-3 text-[12px] ${on ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}
                            style={{ gridTemplateColumns: APP_GRID }}>
                            <input type="checkbox" checked={on} readOnly className="pointer-events-none" />
                            <span className="truncate font-medium ink" title={a.name}>{a.name}</span>
                            <span className="truncate ink-2">{catName(a.category)}</span>
                            <span className="truncate ink-2">{a.technology || "—"}</span>
                            <Stars n={a.popularity} />
                            <RiskBars n={a.risk} />
                          </div>
                        );
                      }}
                    />
                    <div className="flex items-center justify-between border-t hairline px-3 py-1 text-[11px] ink-3">
                      <span>{draft.entry.applications.length} selected</span>
                      <span className="rounded-[5px] surface-sunken px-2 font-bold ink-2">{filteredApps.length}</span>
                    </div>
                  </div>
                </>
                )
              ) : (
                <>
                  <ChipGroup title="Application Category" options={meta.categories.map((c) => c.id)}
                    selected={draft.entry.categories} color={currentColor} labelOf={catName}
                    onToggle={(v) => patch({ categories: toggleIn(draft.entry.categories, v) })} />
                  <ChipGroup title="Risk" options={meta.risk_levels.map((r) => r.level)}
                    selected={draft.entry.risk} color={currentColor}
                    labelOf={(l) => meta.risk_levels.find((r) => r.level === l)?.name ?? String(l)}
                    onToggle={(v) => patch({ risk: toggleIn(draft.entry.risk, v) })} />
                  <ChipGroup title="Popularity" options={[1, 2, 3, 4, 5]}
                    selected={draft.entry.popularity} color={currentColor} labelOf={(n) => "★".repeat(n as number)}
                    onToggle={(v) => patch({ popularity: toggleIn(draft.entry.popularity, v) })} />
                  <ChipGroup title="Technology" options={meta.technologies}
                    selected={draft.entry.technologies} color={currentColor}
                    onToggle={(v) => patch({ technologies: toggleIn(draft.entry.technologies, v) })} />
                  <ChipGroup title="Behavior" options={meta.behaviors}
                    selected={draft.entry.behaviors} color={currentColor}
                    onToggle={(v) => patch({ behaviors: toggleIn(draft.entry.behaviors, v) })} />
                  <ChipGroup title="Protocol" options={meta.protocols}
                    selected={draft.entry.protocols} color={currentColor}
                    onToggle={(v) => patch({ protocols: toggleIn(draft.entry.protocols, v) })} />
                  <ChipGroup title="Vendor" options={meta.vendors}
                    selected={draft.entry.vendors} color={currentColor}
                    onToggle={(v) => patch({ vendors: toggleIn(draft.entry.vendors, v) })} />
                  {(meta.technologies.length + meta.behaviors.length) > 0 &&
                    meta.protocols.length === 0 && meta.vendors.length === 0 && (
                    <p className="mt-1 text-[11px] ink-3">
                      Protocol and Vendor lists come from the live signature database (not available on this device).
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </SideDrawer>
    </div>
  );
};
