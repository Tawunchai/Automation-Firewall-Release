import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown, FiCheck } from "react-icons/fi";

// A minimal single-select, built as a custom popover rather than a native <select> — a native
// control's option list is drawn by the OS and cannot be styled, which is exactly the boxy look
// this replaces. The trigger is a soft, borderless field; the list is a rounded, shadowed sheet
// with hover and selected states.
//
// The list PORTALS to <body> and is positioned from the trigger's rect, so it is never clipped by a
// dialog that sets `overflow: hidden` on itself (which the modal panel does, to clip its own header
// corners). It mirrors the `.shell-select` API (value / options / onChange) so swapping a native
// select for it is mechanical — this is being piloted on the SNMP drawer before any wider rollout.

export type MinimalOption = { value: string; label: string };

const MinimalSelect: React.FC<{
  value: string;
  options: MinimalOption[];
  onChange: (v: string) => void;
  ariaLabel?: string;
  id?: string;
  className?: string;
  /** "md" (default) matches a `.shell-input`/`.shell-select`; "sm" matches a `.shell-*--sm`. */
  size?: "sm" | "md";
  disabled?: boolean;
}> = ({ value, options, onChange, ariaLabel, id, className = "", size = "md", disabled = false }) => {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ top: number; left: number; width: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // Flip up when the estimated list height would run past the viewport bottom.
    const estH = Math.min(options.length, 6) * 34 + 12;
    const up = r.bottom + estH + 8 > window.innerHeight && r.top > estH;
    setRect({ top: up ? r.top : r.bottom, left: r.left, width: r.width, up });
  }, [options.length]);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reposition = () => place();
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("resize", reposition);
    // capture so a scroll on any ancestor (the dialog body) repositions the list too.
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, place]);

  // Opening seeds the active row to the current selection — done here rather than in an effect so
  // no synchronous setState fires on render.
  const openMenu = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };

  const choose = (v: string) => { onChange(v); setOpen(false); };

  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Escape") { setOpen(false); return; }
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); openMenu(); return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(options.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (options[active]) choose(options[active].value); }
  };

  return (
    <div className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        id={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        data-open={open || undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        className={`ms-trigger${size === "sm" ? " ms-trigger--sm" : ""}`}
      >
        <span className="truncate">{current?.label ?? value}</span>
        <FiChevronDown size={14} className={`ms-chevron ${open ? "rotate-180" : ""}`} />
      </button>

      {open && rect &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            className="ms-pop"
            style={{
              top: rect.top,
              left: rect.left,
              width: rect.width,
              transform: rect.up ? "translateY(-100%)" : undefined,
              marginTop: rect.up ? -6 : 6,
            }}
          >
            {options.map((o, idx) => {
              const sel = o.value === value;
              return (
                <button
                  key={o.value}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => choose(o.value)}
                  onMouseEnter={() => setActive(idx)}
                  className="ms-opt"
                  data-active={idx === active || undefined}
                  data-selected={sel || undefined}
                >
                  <span className="truncate">{o.label}</span>
                  {sel && <FiCheck size={14} className="shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
};

export default MinimalSelect;
