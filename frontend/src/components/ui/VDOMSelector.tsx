import React, { useEffect, useRef, useState } from "react";
import { FiChevronDown, FiCheck, FiLayers } from "react-icons/fi";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { effectiveVDOM } from "../../api/vdom";

// The VDOM picker.
//
// It sits beside the device picker because it answers the second half of the same question: the
// device picker says which firewall you are about to change, and on a split unit that is only half
// an address — "policy #3" means a different rule in each tenant. The two belong together, so the
// selection is read from the same context and neither takes props.
//
// It renders NOTHING on a unit that is not in multi-VDOM mode, which is most of them. A picker
// offering one option implies a choice nobody has, and the console's whole reason for showing a
// VDOM is that there is more than one to confuse.
//
// Chrome styling, like DeviceSelector: no accent tint, no status colour. There is nothing on this
// control that carries a health signal.

const VDOMSelector: React.FC = () => {
  const { vdom, setVDOM, vdoms, vdomSplit } = useSelectedDevice();
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

  // Hooks first, then the guard: a component may not return before its own hooks have run.
  if (!vdomSplit || vdoms.length === 0) return null;

  const current = effectiveVDOM(vdom);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Virtual domain"
        title={`Virtual domain: ${current}`}
        className="t-body inline-flex items-center gap-2 rounded-[10px] px-2.5 py-1.5 font-semibold transition"
        style={{
          background: open ? "var(--shell-hover)" : "var(--shell-sunken)",
          border: "1px solid var(--shell-border)",
          color: "var(--shell-ink)",
          cursor: "pointer",
        }}
      >
        <FiLayers size={13} className="ink-3 shrink-0" />
        <span className="max-w-28 truncate">{current}</span>
        <FiChevronDown
          size={12}
          className={`ink-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 z-50 mt-2 w-64 overflow-hidden rounded-[4px]"
          style={{
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
        >
          <div className="hairline-b2 px-4 py-2.5">
            <p className="t-label m-0">Virtual Domains</p>
          </div>

          <div className="shell-scroll max-h-72 overflow-y-auto py-1.5">
            {vdoms.map((v) => {
              const isSelected = v.name === current;
              return (
                <button
                  key={v.name}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => { setVDOM(v.name); setOpen(false); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition"
                  style={{
                    background: isSelected ? "var(--shell-sunken)" : "transparent",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--shell-hover)"; }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = isSelected ? "var(--shell-sunken)" : "transparent";
                  }}
                >
                  <span
                    className="medallion h-7 w-7"
                    style={{ background: "var(--shell-sunken)", color: "var(--shell-ink-3)" }}
                  >
                    <FiLayers size={12} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="t-body block truncate font-semibold">{v.name}</span>
                    {/* Worth naming: an administrator of the management VDOM can change settings
                        that affect every other tenant on the unit. */}
                    <span className="t-meta block truncate">
                      {v.management ? "Management VDOM" : v.short_name || "Virtual domain"}
                    </span>
                  </span>
                  {isSelected && <FiCheck size={13} className="ink-2 shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default VDOMSelector;
