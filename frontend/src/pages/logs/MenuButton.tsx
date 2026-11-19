import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";

// The toolbar dropdown FortiOS puts above its log table: a button showing the current value, and a
// menu under it with the selected row highlighted.
//
// Written here rather than reaching for ui/form-controls' ParentDropdown, which is a network
// interface picker — it carries a search box, an alias-aware label and a type column, none of
// which a two-entry menu wants. What IS worth copying from it is the portal: a menu rendered
// inside the toolbar is clipped by the panel's `overflow: hidden`, so it goes to document.body and
// is positioned against the button's rect.

export type MenuOption<T extends string> = {
  value: T;
  label: string;
  icon?: React.ReactNode;
  /** Second line — used for "not enabled on this device". */
  hint?: string;
  disabled?: boolean;
};

type Props<T extends string> = {
  value: T;
  options: MenuOption<T>[];
  onChange: (value: T) => void;
  /** Accent for the selected row, so the control follows the user's Appearance choice. */
  accent: string;
  icon?: React.ReactNode;
  /** Shown instead of the value's label when nothing matches — a device with no such backend. */
  placeholder?: string;
  /** Screen-reader name; the visible label is the value itself. */
  ariaLabel: string;
  title?: string;
  /** Menu width. Defaults to matching the button, as FortiOS's own menus do. */
  minWidth?: number;
  /**
   * Which edge the menu lines up with.
   *
   * "end" for a control near the right edge of the window: a menu wider than its button and
   * anchored on the left runs off the screen, which is what pushed the log-source menu against the
   * edge and over the table beneath it. Aligning its RIGHT edge with the button's keeps it inside
   * the viewport and pointing at the thing it belongs to.
   */
  align?: "start" | "end";
};

function MenuButton<T extends string>({
  value, options, onChange, accent, icon, placeholder, ariaLabel, title, minWidth, align = "start",
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; width: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  /**
   * Places the menu under the button and keeps it on screen.
   *
   * The rect is taken once, at open, and the menu is fixed-positioned against it — so this also
   * has to do the clamping a browser would do for a native <select>: a menu wider than its button
   * would otherwise hang off whichever edge it was anchored to. MARGIN keeps it from sitting flush
   * against the window, which is what made it look wedged into the corner.
   */
  const openMenu = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;

    const MARGIN = 12;
    const width = Math.max(r.width, minWidth ?? r.width);
    const viewport = document.documentElement.clientWidth;

    let left = align === "end" ? r.right - width : r.left;
    left = Math.min(left, viewport - width - MARGIN);
    left = Math.max(MARGIN, left);

    setPos({ left, top: r.bottom + 6, width });
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setPos(null); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (btnRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    // Capture-phase scroll, because the menu is fixed-positioned against a rect taken once: any
    // ancestor scrolling would leave it floating beside nothing.
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      closeMenu();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeMenu(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", closeMenu);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeMenu);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={title}
        onClick={open ? closeMenu : openMenu}
        className="btn btn-ghost btn-sm hairline gap-1.5 border"
      >
        {icon}
        <span className="truncate">{selected?.label ?? placeholder ?? value}</span>
        <FiChevronDown size={12} className={`ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Deliberately NOT role="listbox".
          
          It said listbox, and the items said option, but nothing implemented the listbox pattern:
          the container was not focusable and there was no arrow-key handling, so a screen-reader
          user was promised a widget that did not behave like one. What this actually is — and has
          always been — is a popup of buttons, which Tab reaches and Enter activates. Saying so, and
          marking the chosen one with aria-current, describes the thing that exists. */}
      {open && pos && createPortal(
        <div role="presentation"
          ref={popRef}
          className="shell-scroll rounded-[4px] py-1"
          style={{
            position: "fixed",
            left: pos.left,
            top: pos.top,
            width: pos.width,
            maxHeight: "min(60vh, 420px)",
            overflowY: "auto",
            zIndex: 9999,
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {options.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                aria-current={isSel ? "true" : undefined}
                disabled={o.disabled}
                onClick={() => { if (!o.disabled) { onChange(o.value); closeMenu(); } }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: isSel ? `color-mix(in srgb, ${accent} 14%, transparent)` : undefined }}
                onMouseEnter={(e) => { if (!isSel && !o.disabled) e.currentTarget.style.backgroundColor = "var(--shell-hover)"; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = ""; }}
              >
                {o.icon && <span className="ink-3 shrink-0">{o.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span
                    className="block truncate text-[12.5px] font-medium"
                    style={{ color: isSel ? accent : "var(--shell-ink)" }}
                  >
                    {o.label}
                  </span>
                  {o.hint && <span className="ink-3 mt-0.5 block text-[10.5px] leading-snug">{o.hint}</span>}
                </span>
              </button>
            );
          })}
        </div>,
        document.body,
      )}
    </>
  );
}

export default MenuButton;
