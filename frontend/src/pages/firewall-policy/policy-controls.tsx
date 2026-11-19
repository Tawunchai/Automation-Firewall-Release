import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiSearch, FiX, FiChevronDown, FiChevronRight, FiPlus } from "react-icons/fi";

// The form controls the policy pages are built out of: the styles every row shares, the switch,
// the small segmented group, and the two pickers (a multi-select over grouped options, and a
// single-name dropdown that can also offer "create this one").
//
// They were the first 240 lines of create.tsx, above the policy form itself. Nothing in here knows
// what a policy is — they are generic over `options: string[]` — so they were the part of that file
// that did not belong to it.

// ─── Shared styles (matches fw-addresses/create.tsx) ──────────────────────────
export const labelCls = "block text-[12px] font-medium ink-2 min-w-[170px] shrink-0 pt-1";
export const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";
export const rowCls   = "flex items-start gap-3";

// ─── Toggle ────────────────────────────────────────────────────────────────────
// A switch, not a clickable box. `label` is required rather than optional: a toggle with no
// accessible name is announced as "switch, checked" and nothing else, and the only reliable way to
// stop that happening again is to make the compiler ask for the name.
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color: string; label: string }> = ({ checked, onChange, color, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label}
    onClick={() => onChange(!checked)}
    className="relative h-5 w-10 shrink-0 cursor-pointer rounded-full border-0 p-0 transition-colors"
    // The off track is a token, not #cbd5e1: this page is the most-used write screen in the
    // console and that literal is a light-mode slate that disappears on a dark card.
    style={{ backgroundColor: checked ? color : "color-mix(in srgb, var(--shell-ink-3) 55%, transparent)" }}>
    <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

// ─── Two-button group (Accept/Deny, Flow/Proxy, IP pool mode, ...) ────────────
// A radio group. `label` is required: picking one of these unpicks the others, and without a name
// on the group a screen reader announces two buttons with no idea what the choice is about.
export const ButtonGroup: React.FC<{
  value: string; onChange: (v: string) => void; label: string;
  options: { value: string; label: string; color?: string }[]; currentColor: string;
}> = ({ value, onChange, options, currentColor, label }) => (
  <div className="inline-flex rounded-[4px] border hairline overflow-hidden" role="radiogroup" aria-label={label}>
    {options.map((o) => (
      <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
        className="px-3 h-8 text-[12px] font-semibold transition"
        style={value === o.value
          ? { background: o.color ?? currentColor, color: "#fff" }
          : { background: "var(--shell-card)", color: "var(--shell-ink-2)" }}>
        {o.label}
      </button>
    ))}
  </div>
);

// ─── Multi-select dropdown (interfaces / addresses / services / IP pools) ────
// Supports FortiGate's "Select Entries" style: either a flat option list, or
// named, collapsible, counted groups (e.g. "ADDRESS (16)" / "ADDRESS GROUP (2)",
// or per-category service groups) built from real device data — never fabricated.
export type MultiSelectGroup = { label: string; options: string[] };

export const MultiSelect: React.FC<{
  options?: string[]; groups?: MultiSelectGroup[]; value: string[]; onChange: (v: string[]) => void;
  currentColor: string; labels?: Record<string, string>; placeholder?: string;
}> = ({ options, groups, value, onChange, currentColor, labels, placeholder }) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);
  const displayOf = (o: string) => labels?.[o] ?? o;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggle = (opt: string) => {
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);
  };

  const effectiveGroups: MultiSelectGroup[] = groups ?? [{ label: "", options: options ?? [] }];
  const q = search.toLowerCase();
  const filteredGroups = effectiveGroups
    .map((g) => ({ label: g.label, options: g.options.filter((o) => displayOf(o).toLowerCase().includes(q)) }))
    .filter((g) => g.options.length > 0);
  const totalCount = effectiveGroups.reduce((n, g) => n + g.options.length, 0);

  const renderOption = (opt: string) => {
    const sel = value.includes(opt);
    return (
      <button key={opt} type="button" onClick={() => toggle(opt)}
        className="flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-[11px] transition surface-hover">
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition"
          style={sel ? { borderColor: currentColor, background: currentColor, color: "#fff" } : { borderColor: "var(--shell-ink-3)" }}>
          {sel && <span className="text-[7px] font-bold">✓</span>}
        </span>
        <span className="flex-1 truncate text-left ink">{displayOf(opt)}</span>
      </button>
    );
  };

  return (
    <div className="relative flex-1" ref={ref}>
      <button type="button" onClick={() => setOpen(!open)}
        className="flex min-h-8 w-full items-center justify-between rounded border hairline surface-card px-2.5 py-1 text-left text-[13px] outline-none transition surface-hover">
        <span className="flex flex-1 flex-wrap gap-1">
          {value.length === 0 && (
            <span className="flex w-full items-center justify-center ink-3" title={placeholder ?? "Select…"}>
              <FiPlus size={14} />
            </span>
          )}
          {value.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold text-white"
              style={{ background: currentColor }}>
              {displayOf(v)}
              <button type="button" onClick={(e) => { e.stopPropagation(); toggle(v); }} className="opacity-70 hover:opacity-100">
                <FiX size={8} />
              </button>
            </span>
          ))}
        </span>
        <FiChevronDown size={12} className={`shrink-0 ml-1 transition-transform ink-3 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-[4px] border hairline surface-card shadow-lg">
          <div className="p-2 border-b hairline-2">
            <div className="flex items-center gap-1.5 rounded-[4px] border hairline surface-sunken px-2">
              <FiSearch size={10} className="ink-3" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…"
                className="h-6 w-full bg-transparent text-[11px] outline-none ink" />
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-1.5 space-y-0.5">
            {totalCount === 0 ? (
              <div className="py-2 text-center text-[11px] ink-3">No options — nothing returned by the device</div>
            ) : filteredGroups.length === 0 ? (
              <div className="py-2 text-center text-[11px] ink-3">No matches</div>
            ) : filteredGroups.map((g) => (
              <div key={g.label || "_flat"}>
                {g.label && (
                  <button type="button"
                    onClick={() => setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(g.label)) next.delete(g.label); else next.add(g.label);
                      return next;
                    })}
                    className="flex w-full items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wide ink-3 hover-ink">
                    {collapsedGroups.has(g.label) ? <FiChevronRight size={10} /> : <FiChevronDown size={10} />}
                    {g.label} ({g.options.length})
                  </button>
                )}
                {!collapsedGroups.has(g.label) && g.options.map(renderOption)}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Single-select searchable dropdown (portal) — schedule / profiles / protocol options ──
// `label` names the trigger button. It is required because the only other thing on it is the
// current VALUE, so an unnamed one announces e.g. "default, button" with no hint of what is default.
export const NameDropdown: React.FC<{
  value: string; onChange: (v: string) => void; label: string;
  options: string[]; loading?: boolean; currentColor: string; placeholder?: string;
  badge?: { text: string; color: string }; labels?: Record<string, string>;
}> = ({ value, onChange, options, loading, currentColor, placeholder, badge, labels, label }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const displayOf = (o: string) => labels?.[o] ?? o;

  const openMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 2, w: r.width });
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setSearch(""); setPos(null); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (btnRef.current?.contains(e.target as Node)) return; closeMenu(); };
    const onScroll = (e: Event) => { if (popRef.current?.contains(e.target as Node)) return; closeMenu(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const filtered = options.filter((o) => displayOf(o).toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="flex-1">
      <button ref={btnRef} type="button" aria-label={label} aria-haspopup="listbox" aria-expanded={open}
        onClick={open ? closeMenu : openMenu}
        className="flex h-8 w-full items-center justify-between rounded border hairline surface-card px-2.5 text-[13px] ink outline-none surface-hover transition">
        <span className="flex items-center gap-2 truncate">
          {badge && (
            <span className="rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shrink-0" style={{ background: badge.color }}>
              {badge.text}
            </span>
          )}
          <span className="truncate">{value ? displayOf(value) : <span className="ink-3">{placeholder ?? "Select…"}</span>}</span>
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: pos.w, maxHeight: 280, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 border-b hairline-2 px-2.5 py-2">
            <FiSearch size={12} className="shrink-0 ink-3" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="flex-1 bg-transparent text-[12px] ink outline-none placeholder-ink" />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 228 }}>
            {loading ? <div className="px-3 py-3 text-[12px] ink-3">Loading…</div>
              : filtered.length === 0 ? <div className="px-3 py-3 text-[12px] ink-3">No options found</div>
              : filtered.map((opt) => {
                const isSel = opt === value;
                return (
                  <button key={opt} type="button" onClick={() => { onChange(opt); closeMenu(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: isSel ? `${currentColor}12` : undefined }}
                    onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--shell-hover)"; }}
                    onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                    <div className="h-4 w-4 shrink-0 rounded border flex items-center justify-center"
                      style={{ borderColor: isSel ? currentColor : "var(--shell-ink-3)", backgroundColor: isSel ? `${currentColor}15` : "var(--shell-card)" }}>
                      {isSel && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke={currentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <span className="flex-1 truncate text-[12.5px] font-medium ink">{displayOf(opt)}</span>
                  </button>
                );
              })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

