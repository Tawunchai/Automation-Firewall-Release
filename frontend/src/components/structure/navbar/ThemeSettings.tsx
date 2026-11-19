import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HiOutlineSun, HiOutlineMoon } from "react-icons/hi2";
import { IoClose } from "react-icons/io5";
import { HiOutlinePaintBrush } from "react-icons/hi2";
import { FiCheck, FiRotateCcw } from "react-icons/fi";
import { themeColors } from "../sidebar/data";
import { useStateContext, type ThemeMode } from "../../../contexts/ProviderContext.logic";

/* ── Mini UI Previews ─────────────────────────────────────────── */
const LightPreview: React.FC = () => (
  <div className="w-full h-15 rounded-[4px] overflow-hidden flex select-none" style={{ background: "#f1f5f9" }}>
    {/* Sidebar — fixed dark panel in both themes */}
    <div className="w-7 flex flex-col gap-1.25 p-1.5" style={{ background: "#14161b" }}>
      <div className="h-1.25 rounded-full" style={{ background: "rgba(255,255,255,0.94)" }} />
      <div className="h-1.25 rounded-full w-[70%]" style={{ background: "rgba(255,255,255,0.18)" }} />
      <div className="h-1.25 rounded-full" style={{ background: "rgba(255,255,255,0.18)" }} />
      <div className="h-1.25 rounded-full w-[80%]" style={{ background: "rgba(255,255,255,0.14)" }} />
    </div>
    {/* Content */}
    <div className="flex-1 p-1.75 flex flex-col gap-1.25">
      <div className="h-1.5 rounded-full w-[55%]" style={{ background: "#94a3b8" }} />
      <div className="flex gap-1 mt-0.5">
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "#ffffff", border: "1px solid #e2e8f0" }} />
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "#ffffff", border: "1px solid #e2e8f0" }} />
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "#ffffff", border: "1px solid #e2e8f0" }} />
      </div>
      <div className="h-1.25 rounded-full" style={{ background: "#e2e8f0" }} />
    </div>
  </div>
);

const DarkPreview: React.FC = () => (
  <div className="w-full h-15 rounded-[4px] overflow-hidden flex select-none" style={{ background: "#0f1123" }}>
    {/* Sidebar */}
    <div className="w-7 flex flex-col gap-1.25 p-1.5" style={{ background: "#13152a", borderRight: "1px solid rgba(255,255,255,0.06)" }}>
      <div className="h-1.25 rounded-full" style={{ background: "rgba(255,255,255,0.2)" }} />
      <div className="h-1.25 rounded-full w-[70%]" style={{ background: "rgba(255,255,255,0.1)" }} />
      <div className="h-1.25 rounded-full" style={{ background: "rgba(255,255,255,0.1)" }} />
      <div className="h-1.25 rounded-full w-[80%]" style={{ background: "rgba(255,255,255,0.08)" }} />
    </div>
    {/* Content */}
    <div className="flex-1 p-1.75 flex flex-col gap-1.25">
      <div className="h-1.5 rounded-full w-[55%]" style={{ background: "rgba(255,255,255,0.2)" }} />
      <div className="flex gap-1 mt-0.5">
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.06)" }} />
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.06)" }} />
        <div className="flex-1 h-3.5 rounded-[4px]" style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.06)" }} />
      </div>
      <div className="h-1.25 rounded-full" style={{ background: "rgba(255,255,255,0.08)" }} />
    </div>
  </div>
);

/* ── Hex → RGB helper ─────────────────────────────────────────── */
const hexToRgb = (hex: string) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
};

/* ── Component ────────────────────────────────────────────────── */
const MODES: { value: ThemeMode; label: string; icon: React.ReactNode; preview: React.ReactNode }[] = [
  { value: "Light", label: "Light", icon: <HiOutlineSun />, preview: <LightPreview /> },
  { value: "Dark",  label: "Dark",  icon: <HiOutlineMoon />, preview: <DarkPreview /> },
];

const DEFAULT_COLOR = "#1A97F5";
const DEFAULT_MODE: ThemeMode = "Light";

const ThemeSettings: React.FC = () => {
  const { setTheme, currentMode, currentColor, setColor, setThemeSettings } = useStateContext();

  const [draftColor, setDraftColor] = useState(currentColor);
  const [mounted, setMounted]       = useState(false);
  const [hoveredSwatch, setHoveredSwatch] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Animate in after mount */
  useEffect(() => {
    const id = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(id);
  }, []);

  /* Sync draft when context color changes (swatch click) */
  useEffect(() => { setDraftColor(currentColor); }, [currentColor]);

  /* Closing is animated: fade out first, unmount when the transition has finished. Declared here,
     above the ESC handler, because that effect closes over it — it used to be defined below, which
     read as a use-before-declare and would become a real temporal-dead-zone crash the first time
     anyone moved these lines around. */
  const handleClose = useCallback(() => {
    setMounted(false);
    setTimeout(() => setThemeSettings(false), 320);
  }, [setThemeSettings]);

  /* ESC closes */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose]);

  /* Cleanup debounce timer */
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const handleColorInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const c = e.target.value;
    setDraftColor(c);
    document.documentElement.style.setProperty("--accent", c);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setColor(c), 600);
  };

  const handleColorCommit = (e: React.FocusEvent<HTMLInputElement>) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    setColor(e.target.value);
  };

  const handleReset = () => {
    setColor(DEFAULT_COLOR);
    setTheme(DEFAULT_MODE);
  };

  const { r, g, b } = hexToRgb(draftColor.length === 7 ? draftColor : currentColor);

  return createPortal(
    /* The dialog role belongs on the PANEL, not on the backdrop.
       
       Both were on the same element, which made the click-to-dismiss handler a click handler on a
       role="dialog" — and meant the accessible dialog was the full-screen overlay rather than the
       drawer, so its boundaries told a screen reader nothing. Splitting them also removes the
       stopPropagation that only existed to stop the panel's own clicks closing it. */
    <div style={{ position: "fixed", inset: 0, zIndex: 9999 }}>
      {/* ── Backdrop ───────────────────────────────────────────── */}
      <button
        type="button"
        aria-label="Close appearance settings"
        onClick={handleClose}
        style={{
          position: "absolute",
          inset: 0,
          border: "none",
          padding: 0,
          cursor: "default",
          transition: "background 0.3s ease, backdrop-filter 0.3s ease",
          background: mounted ? "rgba(0,0,0,0.45)" : "transparent",
          backdropFilter: mounted ? "blur(4px)" : "blur(0px)",
        }}
      />
      {/* ── Panel ────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Appearance settings"
        style={{
          position: "absolute",
          right: 0,
          top: 0,
          height: "100%",
          width: "300px",
          display: "flex",
          flexDirection: "column",
          transition: "transform 0.32s cubic-bezier(0.32,0.72,0,1)",
          transform: mounted ? "translateX(0)" : "translateX(100%)",
          boxShadow: "-24px 0 64px rgba(0,0,0,0.18)",
        }}
        className="surface-card"
      >
        {/* ── Top accent bar ──────────────────────────────────── */}
        <div
          style={{
            height: "3px",
            flexShrink: 0,
            background: `linear-gradient(90deg, rgba(${r},${g},${b},0.3), rgba(${r},${g},${b},1) 60%, rgba(${r},${g},${b},0.6))`,
            transition: "background 0.4s ease",
          }}
        />

        {/* ── Header ─────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b hairline-2 shrink-0">
          <div className="flex items-center gap-3">
            {/* Icon */}
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[4px] shrink-0"
              style={{ background: `rgba(${r},${g},${b},0.12)` }}
            >
              <HiOutlinePaintBrush
                className="text-[17px]"
                style={{ color: currentColor }}
              />
            </div>
            <div>
              <p className="text-sm font-semibold ink leading-tight">
                Appearance
              </p>
              <p className="text-[11px] ink-3 mt-0.5 leading-none">
                Customize your interface
              </p>
            </div>
          </div>

          {/* Close */}
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-[4px] transition-colors ink-3 surface-hover hover-ink focus:outline-none"
          >
            <IoClose className="text-[18px]" />
          </button>
        </div>

        {/* ── Scrollable content ─────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-6">

          {/* ── Theme Mode ─────────────────────────────────── */}
          <section>
            <SectionLabel>Interface</SectionLabel>
            <div className="grid grid-cols-2 gap-2.5">
              {MODES.map((m) => {
                const active = currentMode === m.value;
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => setTheme(m.value)}
                    className={[
                      "relative flex flex-col items-center gap-2.5 rounded-[4px] p-3 border-2 transition-all duration-200 focus:outline-none overflow-hidden",
                      active
                        ? "surface-sunken"
                        : "hairline surface-hover",
                    ].join(" ")}
                    style={active ? { borderColor: currentColor } : undefined}
                  >
                    {/* Mini preview */}
                    {m.preview}

                    {/* Label row */}
                    <div className="flex items-center gap-1.5 w-full justify-center">
                      <span
                        className={`text-[13px] transition-colors ${active ? "" : "ink-3"}`}
                        style={active ? { color: currentColor } : undefined}
                      >
                        {m.icon}
                      </span>
                      <span
                        className={`text-xs font-semibold transition-colors ${active ? "ink" : "ink-3"}`}
                      >
                        {m.label}
                      </span>
                      {active && (
                        <FiCheck
                          className="text-[11px] ml-0.5"
                          style={{ color: currentColor }}
                        />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* ── Accent Color ───────────────────────────────── */}
          <section>
            <SectionLabel>Accent Color</SectionLabel>

            {/* Current color card */}
            <label
              className="flex items-center gap-3 p-3 rounded-[4px] border hairline-2 cursor-pointer dark:hover:border-white/13 transition-all mb-3 group"
              title="Click to open color picker"
            >
              {/* Swatch + hidden input */}
              <div className="relative h-10 w-10 shrink-0 rounded-[4px] overflow-hidden shadow-sm">
                <div
                  className="absolute inset-0 transition-colors duration-300"
                  style={{ backgroundColor: draftColor }}
                />
                <input
                  type="color"
                  value={draftColor}
                  onChange={handleColorInput}
                  onBlur={handleColorCommit}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                {/* Hover scrim */}
                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-150 flex items-center justify-center">
                  <span className="text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity font-medium">
                    Pick
                  </span>
                </div>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[11px] font-medium ink-2">
                    Selected
                  </span>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded-full font-bold tracking-wide"
                    style={{
                      background: `rgba(${r},${g},${b},0.12)`,
                      color: draftColor,
                    }}
                  >
                    CUSTOM
                  </span>
                </div>
                <p className="font-mono text-sm font-bold ink tracking-wider">
                  {draftColor.toUpperCase()}
                </p>
                <p className="text-[10px] ink-3 mt-0.5">
                  rgb({r}, {g}, {b})
                </p>
              </div>

              <div className="text-right shrink-0">
                <p className="text-[10px] ink-3 leading-relaxed">
                  Click swatch
                  <br />
                  to pick color
                </p>
              </div>
            </label>

            {/* Color swatches grid */}
            <div className="grid grid-cols-5 gap-2">
              {themeColors.map((item) => {
                const selected  = item.color === currentColor;
                const hovered   = hoveredSwatch === item.name;
                return (
                  <div key={item.name} className="relative flex flex-col items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setColor(item.color)}
                      onMouseEnter={() => setHoveredSwatch(item.name)}
                      onMouseLeave={() => setHoveredSwatch(null)}
                      aria-label={item.name.replace(/-/g, " ")}
                      title={item.name.replace(/-/g, " ")}
                      className="relative h-9 w-full rounded-[4px] transition-all duration-150 focus:outline-none"
                      style={{
                        backgroundColor: item.color,
                        transform: selected ? "scale(1.12)" : hovered ? "scale(1.06)" : "scale(1)",
                        boxShadow: selected
                          ? `0 0 0 2px white, 0 0 0 4px ${item.color}`
                          : hovered
                          ? `0 4px 12px ${item.color}55`
                          : "none",
                        transition: "transform 0.15s ease, box-shadow 0.15s ease",
                      }}
                    >
                      {selected && (
                        <FiCheck className="absolute inset-0 m-auto text-sm text-white drop-shadow" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Color name tooltip area */}
            <div
              className="h-5 mt-1.5 flex items-center justify-center transition-opacity duration-150"
              style={{ opacity: hoveredSwatch ? 1 : 0 }}
            >
              <span className="text-[10px] ink-2 capitalize font-medium">
                {hoveredSwatch?.replace(/-/g, " ")}
              </span>
            </div>
          </section>
        </div>

        {/* ── Footer ─────────────────────────────────────────── */}
        <div className="shrink-0 px-5 py-4 border-t hairline-2 space-y-2.5">
          <button
            type="button"
            onClick={handleReset}
            className="w-full flex items-center justify-center gap-1.5 py-2 rounded-[4px] text-xs font-medium border hairline ink-2 surface-hover hover-ink transition-colors focus:outline-none"
          >
            <FiRotateCcw className="text-[11px]" />
            Reset to defaults
          </button>
          <p className="text-center text-[10px] ink-3">
            Preferences saved automatically
          </p>
        </div>
      </div>
    </div>,
    document.body
  );
};

/* ── Helper sub-component ─────────────────────────────────────── */
const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex items-center gap-2 mb-3">
    <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3 shrink-0">
      {children}
    </p>
    <div className="flex-1 h-px surface-sunken" />
  </div>
);

export default ThemeSettings;
