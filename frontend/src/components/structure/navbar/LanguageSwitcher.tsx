import React, { useEffect, useRef, useState } from "react";
import { FiCheck } from "react-icons/fi";
import { useLanguage } from "../../../i18n/LanguageProvider.logic";
import { LANGUAGE_OPTIONS } from "./LanguageSwitcher.logic";
import type { LanguageCode, LanguageOption } from "./LanguageSwitcher.logic";

// Navbar language picker.
//
// It was written as a controlled/uncontrolled pair while there was only an English bundle to show,
// and that shape is what it still is — which is why turning it on took no change to the markup. Left
// alone it falls back to the app's language store (src/i18n/lang.ts) through `useLanguage()`; hand
// it `value` + `onChange` and it is a plain controlled input, which is what the Profile page's
// preference form uses it as.
//
// The list itself is the one place the three languages are named for a person to read, and each is
// named IN ITSELF — a Thai speaker looking for Thai is looking for "ภาษาไทย", not for "Thai". Those
// native names are also the way out of a language you cannot read, and they need no protecting:
// each is written in its own script, so src/i18n/translate.ts sees non-Latin text and hands it
// straight back. The second line follows the interface language like everything else.

const optionFor = (code: LanguageCode): LanguageOption =>
  LANGUAGE_OPTIONS.find((o) => o.value === code) ?? LANGUAGE_OPTIONS[0];

type Props = {
  /** Controlled selection. Omit to track the app's own language. */
  value?: LanguageCode;
  /** Fired on pick. Presence of this alone does NOT make the component controlled — `value` does. */
  onChange?: (code: LanguageCode) => void;
  disabled?: boolean;
};

const LanguageSwitcher: React.FC<Props> = ({ value, onChange, disabled }) => {
  const [open, setOpen] = useState(false);
  const { lang, setLang } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);

  const selected = value ?? lang;
  const current = optionFor(selected);

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

  const pick = (code: LanguageCode) => {
    // Only the uncontrolled path writes the app's language. A controlled parent owns `value`, and
    // writing both would let the two drift apart the first time a parent rejects a change.
    if (value === undefined) setLang(code);
    onChange?.(code);
    setOpen(false);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Language"
        title={`Language — ${current.englishName}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className={`shell-btn${open ? " shell-btn--on" : ""}`}
        style={{ width: 38, height: 38, borderRadius: 10 }}
      >
        <span
          className="block h-5 w-5 overflow-hidden rounded-full"
          style={{ boxShadow: "0 0 0 1px var(--shell-border)" }}
        >
          <img src={current.flag} alt="" draggable={false} className="h-full w-full object-cover" />
        </span>
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Language"
          className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-[4px]"
          style={{
            background: "var(--shell-card)",
            border: "1px solid var(--shell-border)",
            boxShadow: "var(--shell-elev-lg)",
          }}
        >
          <div className="hairline-b2 px-4 py-2.5">
            <p className="t-label m-0">Language</p>
          </div>

          <div className="py-1.5">
            {LANGUAGE_OPTIONS.map((opt) => {
              const active = opt.value === selected;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => pick(opt.value)}
                  className="flex w-full items-center gap-2.5 px-4 py-2 text-left transition-colors"
                  style={{ background: active ? "var(--shell-sunken)" : "transparent" }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = "var(--shell-hover)"; }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = active ? "var(--shell-sunken)" : "transparent";
                  }}
                >
                  <span
                    className="block h-4 w-6 shrink-0 overflow-hidden rounded-[3px]"
                    style={{ boxShadow: "0 0 0 1px var(--shell-border)" }}
                  >
                    <img src={opt.flag} alt="" draggable={false} className="h-full w-full object-cover" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span
                      className="block truncate text-[12.5px] font-semibold"
                      style={{ color: active ? "var(--accent)" : "var(--shell-ink)" }}
                    >
                      {opt.nativeName}
                    </span>
                    <span className="block truncate text-[10.5px]" style={{ color: "var(--shell-ink-3)" }}>
                      {opt.englishName}
                    </span>
                  </span>

                  {active && <FiCheck size={13} className="shrink-0" style={{ color: "var(--accent)" }} />}
                </button>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
};

export default LanguageSwitcher;
