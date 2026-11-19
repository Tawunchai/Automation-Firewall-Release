import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown, FiSearch } from "react-icons/fi";
import type { SystemInterface } from "../../api/policyObject";
import { TYPE_LABELS } from "./form-controls.logic";

// Shared form controls.
//
// These used to live in pages/interfaces/interface-form.tsx, which meant eight unrelated forms —
// LDAP, RADIUS, User Definition, User Group, Virtual IP, Static Route, the Exchange connector
// drawer and the IPsec wizard — all imported their basic controls from an interface EDITOR. That
// editor has been removed (Network > Interfaces is read-only by design), so the controls now live
// somewhere their name matches and nothing pulls a whole page in to get a button group.

// TYPE_LABELS maps the FortiOS system.interface `type` enum to the label the GUI shows.
// focusRing paints the accent colour on a focused input without a Tailwind ring class,
// because the accent is a runtime theme value rather than a compile-time class.
//
// Kept for the handful of controls that cannot use `.shell-input` (an inline cell editor, a
// control whose border colour also encodes validity). A plain form field should use the class —
// it gets the same treatment from CSS with nothing to wire up.
// Segmented is the small inline button group used for enum choices (protocol, mode, status).
//
// It is the `.seg` control from index.css — a sunken track with the selected item raised out of
// it — with one addition the CSS class has no way to express: a `danger` option (the "deny" half
// of an allow/deny pair) is red when selected, because that choice is worth seeing from across
// the form.
// A radio group, not a row of buttons. Without the group role a screen reader reads three unrelated
// buttons with no idea that picking one unpicks the others, and without a name it cannot say what
// the choice is about. `label` is required for the same reason it is on Toggle: optional is how a
// control ends up with no name at all. sdwan/sla-form.tsx already did this correctly and is the
// shape copied here.
export const Segmented: React.FC<{
  value: string; onChange: (v: string) => void; currentColor: string; label: string;
  options: { v: string; l: string; icon?: React.ReactNode; danger?: boolean }[];
}> = ({ value, onChange, currentColor, label, options }) => (
  <div className="seg w-fit max-w-full flex-wrap" role="radiogroup" aria-label={label}>
    {options.map((o) => {
      const active = value === o.v;
      return (
        <button
          key={o.v}
          type="button"
          role="radio"
          aria-checked={active}
          onClick={() => onChange(o.v)}
          className={`seg-item flex items-center gap-1.5${active ? " seg-item--on" : ""}`}
          style={
            active && o.danger
              ? { background: "#ef4444", color: "#fff" }
              : active
              ? { color: currentColor }
              : undefined
          }
        >
          {o.icon}{o.l}
        </button>
      );
    })}
  </div>
);

// ParentDropdown is a searchable, portal-rendered interface picker. It renders through a
// portal so it is never clipped by a drawer's overflow, and it is used wherever a form has to
// choose an interface — the IPsec wizard's outgoing interface, most visibly.
export const ParentDropdown: React.FC<{
  value: string; onChange: (v: string) => void;
  options: SystemInterface[]; currentColor: string; placeholder?: string;
}> = ({ value, onChange, options, currentColor, placeholder }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.name === value);

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

  const filtered = options.filter((o) =>
    o.name.toLowerCase().includes(search.toLowerCase()) ||
    (o.alias || "").toLowerCase().includes(search.toLowerCase())
  );
  const label = (o: SystemInterface) => (o.alias ? `${o.alias} (${o.name})` : o.name);

  return (
    <div className="flex-1">
      <button ref={btnRef} type="button" onClick={open ? closeMenu : openMenu}
        className="shell-input surface-hover flex items-center justify-between text-left">
        <span className="truncate">
          {selected ? label(selected) : <span className="ink-3">{placeholder || "Select interface…"}</span>}
        </span>
        <FiChevronDown size={13} className={`ink-3 ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px]"
          style={{
            position: "fixed", left: pos.x, top: pos.y, width: pos.w, maxHeight: 280, zIndex: 9999,
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="hairline-b2 flex items-center gap-1.5 px-2.5 py-2">
            <FiSearch size={12} className="ink-3 shrink-0" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="ink flex-1 bg-transparent text-[12px] outline-none placeholder:text-(--shell-ink-3)" />
          </div>
          <div className="shell-scroll overflow-y-auto" style={{ maxHeight: 228 }}>
            {filtered.length === 0
              ? <div className="ink-3 px-3 py-3 text-[12px]">No interface found</div>
              : filtered.map((o) => {
                const isSel = o.name === value;
                return (
                  <button key={o.name} type="button" onClick={() => { onChange(o.name); closeMenu(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: isSel ? `color-mix(in srgb, ${currentColor} 12%, transparent)` : undefined }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = "var(--shell-hover)"; }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = ""; }}>
                    <span className="ink flex-1 truncate text-[12.5px] font-medium">{label(o)}</span>
                    <span className="ink-3 ml-2 shrink-0 text-[10px]">{TYPE_LABELS[o.type] || o.type}</span>
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
