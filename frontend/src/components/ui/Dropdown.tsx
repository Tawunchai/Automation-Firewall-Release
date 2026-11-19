import React, { useEffect, useRef, useState } from "react";
import { FiChevronDown } from "react-icons/fi";

// A small single-select popover, styled after Dastone's own panel-header dropdowns (the "This
// Year ▾" control above its Audience Overview chart): a bordered pill button with a chevron, and a
// plain-text option list beneath it — not a native <select>, which cannot carry this chrome.
//
// Generic over the option's value type so a caller's own union (a history-window key, an
// interface name) stays typed end to end instead of widening to `string`.

export type DropdownOption<T extends string> = { value: T; label: string };

type Props<T extends string> = {
  value: T;
  options: DropdownOption<T>[];
  onChange: (v: T) => void;
  ariaLabel: string;
  icon?: React.ReactNode;
  /** Menu grows from this edge. Right-aligned controls (a toolbar's last item) want "right" so the
      menu never overhangs the card. */
  align?: "left" | "right";
};

function Dropdown<T extends string>({ value, options, onChange, ariaLabel, icon, align = "right" }: Props<T>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        className="t-meta inline-flex items-center gap-1.5 whitespace-nowrap rounded-[5px] px-2.5 py-1.5 font-semibold transition"
        style={{
          background: "var(--shell-card)",
          border: "1px solid var(--shell-border)",
          color: "var(--shell-ink)",
          cursor: "pointer",
        }}
      >
        {icon}
        <span className="max-w-36 truncate">{current?.label ?? value}</span>
        <FiChevronDown size={12} className={`ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1.5 min-w-[11rem] overflow-hidden rounded-[6px] py-1 ${align === "right" ? "right-0" : "left-0"}`}
          style={{
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
        >
          {options.map((o) => {
            const isSelected = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => { onChange(o.value); setOpen(false); }}
                className="t-body block w-full truncate px-3.5 py-2 text-left transition"
                style={{ color: "var(--shell-ink)", background: isSelected ? "var(--shell-sunken)" : "transparent" }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--shell-hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = isSelected ? "var(--shell-sunken)" : "transparent"; }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default Dropdown;
