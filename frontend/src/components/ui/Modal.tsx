import React, { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FiX } from "react-icons/fi";

interface ModalProps {
  open: boolean;
  title?: React.ReactNode;
  /**
   * An optional glyph shown in a soft accent badge to the left of the title — the "calm setup sheet"
   * header this console standardised on (see the Profile ▸ TOTP dialog it was lifted from). Pass a
   * react-icons node sized to ~16px. With no icon the header still renders clean and white, just
   * without the badge. A dialog that wants an entirely custom header keeps passing NO `title` and a
   * `bodyClassName="p-0"` body, exactly as before.
   */
  icon?: React.ReactNode;
  onClose: () => void;
  /** Tailwind max-width class; dialogs here range from a confirm to a full config diff. */
  width?: string;
  /** Rendered in the footer, right-aligned. Omit for a dialog that is only read. */
  footer?: React.ReactNode;
  /** Set for a body that scrolls itself (a diff, a long log) rather than growing the page. */
  bodyClassName?: string;
  /**
   * "right" turns the dialog into a DRAWER that slides in from the right edge and spans the full
   * height — the shape FortiGate uses for every one of its own create/edit panels, so a page that
   * mirrors a FortiGate page should open the same way.
   *
   * It is a variant of this component rather than a second one, because everything that makes a
   * dialog safe is the same either way: the focus trap, the focus return, Escape, the scroll lock
   * and the backdrop. Only the surface moves, and it moves in CSS.
   */
  side?: "center" | "right";
  children: React.ReactNode;
}

/** Everything focusable inside the dialog, in document order. */
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The console's dialog.
 *
 * Replaces Ant Design's Modal, which was one of the few components keeping a 935 KB library in the
 * bundle. It is the `.modal-*` CSS in index.css given the behaviour a dialog needs: Escape closes,
 * a backdrop click closes, and the page behind it stops scrolling while it is open.
 *
 * ── Focus, and why this used to be a TODO ────────────────────────────────────
 *
 * Focus was not trapped, and the comment that stood here said so: "a half-working trap is worse
 * than none — it steals focus without returning it". That was the right call at the time and the
 * wrong thing to leave, because without a trap a keyboard user pressing Tab inside a confirm dialog
 * walks straight out of it and onto the page behind — which on this console is a page of buttons
 * that write to a live firewall, while a dialog asking "delete this policy?" is still on screen.
 *
 * So it is done properly here, which means all four parts, not just the loop:
 *
 *   1. It is announced as a dialog (`role="dialog"`, `aria-modal`) and labelled by its own heading,
 *      so a screen reader says what opened instead of reading the page underneath.
 *   2. Focus MOVES IN when it opens — to the first control, or the panel itself for a read-only
 *      dialog, which is what makes Escape and Tab reach it at all.
 *   3. Tab and Shift+Tab cycle within the panel.
 *   4. Focus RETURNS to whatever opened the dialog when it closes. This is the half that gets
 *      forgotten and the half that makes a trap worse than nothing: without it the user is dropped
 *      at the top of the document with no idea where they were.
 */
const Modal: React.FC<ModalProps> = ({
  open, title, icon, onClose, width = "max-w-lg", footer, bodyClassName = "", side = "center", children,
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  // What had focus before the dialog opened, so it can be handed back.
  const openerRef = useRef<Element | null>(null);
  const titleId = useId();

  // A ref, not a dependency: `onClose` is an inline arrow function at almost every call site
  // (`onClose={() => setForm(null)}` and friends), so it is a NEW function on every render of the
  // parent — including the render a keystroke inside the dialog causes. Depending on it directly
  // used to put `onClose` in this effect's deps, which tore the whole effect down and rebuilt it on
  // every keystroke in any text field in the dialog; the rebuild's cleanup runs BEFORE the new
  // setup, so each keystroke handed focus back to whatever opened the dialog, then only immediately
  // afterwards back to the first field — a round trip fast enough to look fine for a click, but a
  // keystroke mid-trip landed on the opener instead of the field, so React never saw the second
  // character. Observed live: typing in the device-credential dialog's username/password inputs
  // accepted exactly one character. Routing calls through a ref keeps the effect itself stable
  // across renders (deps: [open] only) while `onKey` below still always calls the LATEST onClose.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; });

  useEffect(() => {
    if (!open) return;

    openerRef.current = document.activeElement;

    const panel = panelRef.current;
    // Move focus in. The first control if there is one; otherwise the panel, which is why it
    // carries tabIndex={-1} — a dialog with nothing to press still has to receive key events.
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onCloseRef.current(); return; }
      if (e.key !== "Tab" || !panel) return;

      // `hidden` and aria-hidden, not offsetParent: a layout-based visibility check reports
      // everything as hidden under jsdom, so the trap silently degraded to "keep focus where it
      // is" in every test — and a test that cannot see the loop cannot protect it.
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
        .filter((el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true");
      if (items.length === 0) {
        // Nothing to move to — keep focus on the panel rather than letting it escape.
        e.preventDefault();
        panel.focus();
        return;
      }

      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      const active = document.activeElement;

      // Wrap at both ends. The `!panel.contains(active)` case matters after a control inside the
      // dialog is removed while focused — the browser drops focus to <body>, and without this the
      // next Tab would continue from the page behind.
      if (e.shiftKey && (active === firstItem || !panel.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !panel.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    // Without this the page scrolls under the dialog on a trackpad, which reads as the dialog
    // moving.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      // Hand focus back to the opener. Guarded because the opener may have been unmounted by the
      // very action the dialog confirmed — a row's delete button is gone once the row is.
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  }, [open]);

  if (!open) return null;

  const drawer = side === "right";

  return createPortal(
    <div
      className={drawer
        ? "fixed inset-0 z-9999 flex justify-end"
        : "fixed inset-0 z-9999 flex items-center justify-center p-4"}
    >
      {/* Presentational: clicking outside is a mouse shortcut for Escape, which the effect above
          already handles, so there is no keyboard affordance missing here to add. role="presentation"
          says exactly that, and is why jsx-a11y stops asking for onKeyDown. */}
      <div className="modal-backdrop" role="presentation" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        // Labelled by its own heading when it has one. A dialog with no title has nothing to point
        // at, and an aria-labelledby aimed at a missing element is worse than none.
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={drawer
          // Full height, flush to the right edge, no max-height of its own — the body scrolls.
          ? `modal-panel modal-panel--drawer ${width} flex h-dvh max-h-dvh flex-col`
          : `modal-panel ${width} flex max-h-[88vh] flex-col`}
      >
        {title && (
          // A calm white header — a soft accent badge (when an icon is given), the title in ink, and
          // the close — in place of the old app-wide dark slate bar. Sticky + opaque so it stays put
          // and readable while a drawer's body scrolls under it.
          <div className="modal-head-sheet sticky top-0 z-10 flex items-center gap-3 overflow-hidden px-5 py-4">
            <span
              aria-hidden
              className="pointer-events-none absolute -right-6 -top-10 h-24 w-24 rounded-full"
              style={{ background: "color-mix(in srgb, var(--accent, #6F6AF8) 9%, transparent)" }}
            />
            {icon && (
              <span
                aria-hidden
                className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px] text-[16px]"
                style={{ color: "var(--accent, #6F6AF8)", background: "color-mix(in srgb, var(--accent, #6F6AF8) 12%, transparent)" }}
              >
                {icon}
              </span>
            )}
            <h3 id={titleId} className="relative m-0 min-w-0 flex-1 truncate text-[14px] font-bold ink">{title}</h3>
            <button type="button" aria-label="Close" className="btn-icon relative shrink-0" onClick={onClose}>
              <FiX size={15} />
            </button>
          </div>
        )}
        <div className={`modal-body shell-scroll min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>
          {children}
        </div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
