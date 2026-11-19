// Generic table/drawer vocabulary shared by every Security Profile editor.
//
// These five lived in pages/security-profiles/webfilter-staticurl.tsx, so eight sibling pages and
// components/device/DeviceListPage.tsx all imported a generic control out of one feature's page —
// a component reaching into a page. Nothing here knows what a Web Filter is.
import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FiPlus, FiEdit2, FiTrash2, FiSearch, FiX } from "react-icons/fi";
import { activateOnKey } from "./keyActivate";

// A radio group, not a row of buttons. Without the group role a screen reader reads three unrelated
// buttons with no idea that picking one unpicks the others, and without a name it cannot say what
// the choice is about. `label` is required for the same reason it is on Toggle: optional is how a
// control ends up with no name at all. sdwan/sla-form.tsx already did this correctly and is the
// shape copied here.
export function SegmentedPills<T extends string>({ opts, value, onChange, color, label }: {
  opts: { v: T; l: string }[]; value: T; onChange: (v: T) => void; color: string; label: string;
}) {
  return (
    <div className="inline-flex flex-wrap overflow-hidden rounded-[4px] border hairline"
      role="radiogroup" aria-label={label}>
      {opts.map((o, i) => {
        const active = value === o.v;
        return (
          <button key={o.v} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.v)}
            className={`px-3 py-1 text-[12px] font-semibold transition-colors ${active ? "text-white" : "ink-2 surface-hover"} ${i > 0 ? "border-l hairline" : ""}`}
            style={active ? { backgroundColor: color } : undefined}>
            {o.l}
          </button>
        );
      })}
    </div>
  );
}
// Right-side sliding drawer (portal) — mirrors the FortiGate "New … Filter" slide-in panel.
export const SideDrawer: React.FC<{
  open: boolean; title: string; color: string; canSave: boolean;
  onOK: () => void; onCancel: () => void; children: React.ReactNode;
}> = ({ open, title, color, canSave, onOK, onCancel, children }) => {
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-9999">
      <div role="presentation" className="absolute inset-0 bg-black/40 backdrop-blur-[1px]" onClick={onCancel} />
      <div className="absolute right-0 top-0 flex h-full w-full max-w-160 flex-col surface-card shadow-2xl"
        style={{ animation: "wfDrawerIn .18s ease-out" }}>
        <style>{`@keyframes wfDrawerIn{from{transform:translateX(24px);opacity:.6}to{transform:translateX(0);opacity:1}}`}</style>
        <div className="flex items-center justify-between border-b hairline px-5 py-3">
          <h3 className="text-[14px] font-semibold ink">{title}</h3>
          <button type="button" onClick={onCancel}
            className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 surface-hover">
            <FiX size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        <div className="flex items-center justify-center gap-3 border-t hairline px-5 py-3">
          <button type="button" onClick={onOK} disabled={!canSave}
            className="h-9 rounded-[4px] px-8 text-[13px] font-semibold text-white transition disabled:opacity-40"
            style={{ backgroundColor: color }}>OK</button>
          <button type="button" onClick={onCancel}
            className="h-9 rounded-[4px] border hairline px-6 text-[13px] font-semibold ink-2 surface-hover">Cancel</button>
        </div>
      </div>
    </div>,
    document.body
  );
};

// A row of the drawer form: fixed-width label + control.
export const DrawerRow: React.FC<{ label: string; children: React.ReactNode; top?: boolean }> = ({ label, children, top }) => (
  <div className={`flex ${top ? "items-start" : "items-center"} gap-4 py-2`}>
    <span className="w-27.5 shrink-0 text-[12px] font-medium ink-2">{label}</span>
    <div className="flex-1">{children}</div>
  </div>
);
// ─── Generic filter table (Create New / Edit / Delete / Search + rows) ───────────────
export type Column<T> = { key: string; header: string; render: (row: T) => React.ReactNode; width?: string };
export function FilterTable<T>({ rows, columns, gridCols, matches, onCreate, onEdit, onDelete, color }: {
  rows: T[]; columns: Column<T>[]; gridCols: string;
  matches: (row: T, q: string) => boolean;
  onCreate: () => void; onEdit: (i: number) => void; onDelete: (i: number) => void; color: string;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const view = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.map((r, i) => ({ r, i })).filter(({ r }) => !q || matches(r, q));
  }, [rows, search, matches]);

  const btn = "inline-flex items-center gap-1.5 rounded-[4px] border px-2.5 py-1 text-[12px] font-semibold transition disabled:opacity-40 disabled:cursor-not-allowed";
  return (
    <div className="ml-1 mt-2 overflow-hidden rounded-[4px] border hairline">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b hairline surface-sunken px-2.5 py-2">
        <button type="button" onClick={onCreate}
          className={`${btn} border-transparent text-white`} style={{ backgroundColor: color }}>
          <FiPlus size={13} /> Create New
        </button>
        <button type="button" disabled={selected === null} onClick={() => selected !== null && onEdit(selected)}
          className={`${btn} hairline ink-2 surface-hover`}>
          <FiEdit2 size={12} /> Edit
        </button>
        <button type="button" disabled={selected === null}
          onClick={() => { if (selected !== null) { onDelete(selected); setSelected(null); } }}
          className={`${btn} hairline ink-2 surface-hover`}>
          <FiTrash2 size={12} /> Delete
        </button>
        <div className="relative ml-auto">
          <FiSearch size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 ink-3" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search"
            className="h-7 w-44 rounded-[4px] border hairline surface-card pl-7 pr-2 text-[12px] outline-none" />
        </div>
      </div>

      {/* header */}
      <div className="grid border-b hairline surface-card px-3 py-1.5" style={{ gridTemplateColumns: gridCols }}>
        {columns.map((c) => (
          <span key={c.key} className="text-[11px] font-bold uppercase tracking-wider ink-3">{c.header}</span>
        ))}
      </div>

      {/* rows */}
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {view.length === 0 ? (
          <div className="py-8 text-center text-[12px] ink-3">No results</div>
        ) : view.map(({ r, i }) => (
          <div key={i} role="button" tabIndex={0} aria-pressed={selected === i}
            onClick={() => setSelected(i)} onDoubleClick={() => onEdit(i)}
            onKeyDown={activateOnKey(() => setSelected(i))}
            className={`grid cursor-pointer items-center border-b hairline-2 px-3 py-1.5 text-[12px]  ${selected === i ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}
            style={{ gridTemplateColumns: gridCols }}>
            {columns.map((c) => <div key={c.key} className="truncate pr-2 ink">{c.render(r)}</div>)}
          </div>
        ))}
      </div>

      {/* count footer */}
      <div className="flex justify-end border-t hairline px-3 py-1">
        <span className="rounded-[5px] surface-sunken px-2 text-[10px] font-bold ink-2">{rows.length}</span>
      </div>
    </div>
  );
}
