import React, { useId, useState } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  title: React.ReactNode;
  /** Where it sits relative to the trigger. `top` is the default, as it was in antd. */
  placement?: "top" | "bottom";
  children: React.ReactElement;
}

/**
 * A hover/focus tooltip.
 *
 * Replaces Ant Design's Tooltip. It renders through a portal so it is never clipped by a table's
 * `overflow: hidden` or a drawer's scroll container — the reason the pages using it reached for a
 * component rather than the native `title` attribute in the first place.
 *
 * It also opens on focus, not only hover, so the interface-faceplate ports and the icon buttons
 * that carry one are reachable from the keyboard.
 */
const Tooltip: React.FC<TooltipProps> = ({ title, placement = "top", children }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const id = useId();

  // The trigger measures ITSELF, from the event — no ref.
  //
  // It used to clone the child with a ref attached, which the React compiler's rules report as
  // accessing a ref during render, and which only ever worked for children that forward one: a
  // <Tooltip> around a component that does not would position itself at 0,0 or not at all. The
  // event's currentTarget is the element the pointer or focus actually reached, which is the
  // thing the tooltip should point at.
  const open = (e: React.MouseEvent<HTMLElement> | React.FocusEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPos({
      x: r.left + r.width / 2,
      y: placement === "top" ? r.top - 8 : r.bottom + 8,
    });
  };
  const close = () => setPos(null);

  // Cloning keeps the trigger's own markup and props; only the handlers are added.
  const trigger = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, {
    "aria-describedby": pos ? id : undefined,
    onMouseEnter: open,
    onMouseLeave: close,
    onFocus: open,
    onBlur: close,
  });

  return (
    <>
      {trigger}
      {pos && title != null && createPortal(
        <div
          id={id}
          role="tooltip"
          className="pointer-events-none fixed z-9999 rounded-[4px] px-2.5 py-1.5 text-[11.5px] leading-snug"
          style={{
            left: pos.x,
            top: pos.y,
            transform: `translate(-50%, ${placement === "top" ? "-100%" : "0"})`,
            maxWidth: 280,
            background: "var(--shell-ink)",
            color: "var(--shell-card)",
            boxShadow: "var(--shell-elev-lg)",
          }}
        >
          {title}
        </div>,
        document.body,
      )}
    </>
  );
};

export default Tooltip;
