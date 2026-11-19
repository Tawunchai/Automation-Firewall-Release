import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import Tooltip from "./Tooltip";
import type { SystemInterface } from "../../api/policyObject";
import { portState } from "./interfaceStatus";
import type { PortState } from "./interfaceStatus";
import { faceplateSlots } from "./faceplateSlots";

// ─── Device faceplate (mirrors FortiGate's GUI device widget) ─────────────────
// Renders the chassis port layout with each port coloured by runtime link state
// (green = link up / connected, grey = down), like the Network > Interfaces widget.
//
// It lives in components/ui rather than under Network > Interfaces because TWO pages draw it now:
// the Interfaces list it was written for, and the Dashboard, where it answers "which ports are
// actually carrying traffic" beside the device's identity card. One component, one place — a second
// copy would have drifted the moment either page gained a port type the other did not.
//
// ── Why it is drawn at two sizes ─────────────────────────────────────────────
// On the Interfaces page the board is a strip above a dense table: it is a legend for the rows
// underneath, so it stays small and hugs its content (`sm`, the default).
//
// On the Dashboard it is one of the two cards on its own row, sitting next to a 240px identity
// hero — at the strip size it read as a stamp floating in an empty card, which is exactly the
// wrong emphasis for the one widget on the page that answers "what is plugged in". `lg` doubles
// the jack, cell and label metrics and lets the card fill its grid cell, so the row reads as two
// panels of equal weight instead of a banner beside a postage stamp.
//
// Everything that differs between the two lives in SCALE — there is one drawing, at two scales,
// not two drawings that must be kept in step.
//
// ── Fitting ──────────────────────────────────────────────────────────────────
// A 16-port board at the dashboard scale is ~950px wide, and the column holding it is not. A
// filled faceplate therefore measures itself and scales down to whatever width it was given, the
// way the device's own GUI does — the alternative was a chassis sliced off mid-port with a
// horizontal scrollbar under it, which is how it looked before and reads as broken rather than
// scrollable. Below MIN_FIT the jacks would stop being legible, so past that point it does scroll.

type Size = "sm" | "lg";

type Props = {
  model: string;                    // "FortiGate 80E"
  interfaces: SystemInterface[];    // full list (incl. switch members) for link lookup
  currentColor: string;
  onPortClick?: (name: string) => void;
  /** Visual scale. `sm` = the compact strip (default), `lg` = the dashboard panel. */
  size?: Size;
  /** Stretch the card to its grid cell instead of hugging the board. */
  fill?: boolean;
};

/** Every metric that changes between the two sizes, in one table. All values are px. */
const SCALE = {
  sm: {
    jack: 30, cell: 44, colGap: 4, rowGap: 10,
    sectionPad: 12, boardPadX: 14, boardPadY: 14,
    label: 9, caption: 9, title: 13, mark: 6, bar: 34, gapCaption: 8,
  },
  // The jack and the vertical rhythm are deliberately smaller than `cell`: the card is as wide as
  // its column and should stay that way, so the horizontal cell pitch carries the width while the
  // jack, the row gap and the paddings carry the height. Growing them together made the panel
  // half a screen tall for sixteen ports.
  lg: {
    jack: 38, cell: 68, colGap: 6, rowGap: 12,
    sectionPad: 22, boardPadX: 24, boardPadY: 14,
    label: 11, caption: 10, title: 15, mark: 7, bar: 42, gapCaption: 8,
  },
} as const;

type Metrics = (typeof SCALE)[Size];

/**
 * The three states a drawn port can be in.
 *
 * `down` and `disabled` are kept apart on purpose: a cable that fell out and a port an
 * administrator shut are the same darkness on the hardware but completely different findings,
 * and the legend at the foot of the card names both.
 */
const PORT_TONE: Record<PortState, { body: string; edge: string; recess: string; pin: string }> = {
  up:       { body: "#16a34a", edge: "#15803d", recess: "rgba(3,42,23,0.45)",  pin: "rgba(255,255,255,0.75)" },
  down:     { body: "#94a3b8", edge: "#64748b", recess: "rgba(15,23,42,0.38)", pin: "rgba(255,255,255,0.62)" },
  disabled: { body: "#cbd5e1", edge: "#94a3b8", recess: "rgba(15,23,42,0.22)", pin: "rgba(255,255,255,0.8)" },
};

const STATE_LABEL: Record<PortState, string> = {
  up: "Connected",
  down: "Not connected",
  disabled: "Disabled (admin down)",
};

// ── One RJ45 jack ────────────────────────────────────────────────────────────
// Drawn in a fixed 28×22 viewBox and scaled by width, so the same path data is crisp at both
// sizes. The shape is a real jack rather than a coloured square: latch tab, moulded body, a
// recessed throat with contact pins, and the two indicator LEDs that sit under the opening —
// enough detail that a 50px jack looks like hardware instead of a large rounded rectangle.

const Jack: React.FC<{
  /** The interface name (`port3`), which is what the accessible name must say — the silk-screened
   *  label under a LAN jack is the bare number, and "3, not connected" tells a screen-reader user
   *  nothing about which interface that is. */
  name: string;
  state: PortState;
  label: string;
  title: React.ReactNode;
  accent: string;
  s: Metrics;
  onClick?: () => void;
}> = ({ name, state, label, title, accent, s, onClick }) => {
  const tone = PORT_TONE[state];
  const w = s.jack;
  const h = Math.round((w * 22) / 28);
  const up = state === "up";
  const dot = Math.max(6, Math.round(w * 0.16));

  return (
    <div className="flex flex-col items-center" style={{ width: s.cell, gap: Math.round(s.label * 0.6) }}>
      <Tooltip title={title}>
        <button
          type="button"
          onClick={onClick}
          aria-label={`${name} — ${STATE_LABEL[state]}`}
          className="relative rounded-[4px] transition-transform duration-150 hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{
            cursor: onClick ? "pointer" : "default",
            lineHeight: 0,
            outlineColor: accent,
            opacity: state === "disabled" ? 0.62 : 1,
          }}
        >
          <svg
            width={w}
            height={h}
            viewBox="0 0 28 22"
            fill="none"
            style={{
              display: "block",
              filter: up ? "drop-shadow(0 2px 6px rgba(22,163,74,0.38))" : undefined,
            }}
            aria-hidden
          >
            {/* latch tab */}
            <path
              d="M10 1.4h8a1 1 0 0 1 1 1V6H9V2.4a1 1 0 0 1 1-1Z"
              fill={tone.body}
              stroke={tone.edge}
              strokeWidth="0.9"
              strokeLinejoin="round"
            />
            {/* body */}
            <rect x="1" y="5" width="26" height="16" rx="2.2" fill={tone.body} stroke={tone.edge} strokeWidth="0.9" />
            {/* moulding highlight, so the body reads as plastic and not as a flat swatch */}
            <rect x="2.2" y="6.1" width="23.6" height="5" rx="1.6" fill="#ffffff" opacity="0.16" />
            {/* recessed throat */}
            <rect x="4.4" y="8.4" width="19.2" height="9.4" rx="1.3" fill={tone.recess} />
            {/* contact pins */}
            <g stroke={tone.pin} strokeWidth="0.9" strokeLinecap="round">
              {[6.6, 9.2, 11.8, 14.4, 17, 19.6, 22.2].map((x) => (
                <line key={x} x1={x} y1="9.6" x2={x} y2="13.4" />
              ))}
            </g>
            {/* link / activity LEDs under the opening */}
            <circle cx="5.6" cy="19.3" r="1.1" fill={up ? "#bbf7d0" : "rgba(255,255,255,0.32)"} />
            <circle cx="22.4" cy="19.3" r="1.1" fill={up ? "#fde68a" : "rgba(255,255,255,0.32)"} />
          </svg>

          {/* The one mark that carries "this link is live" beyond colour alone. */}
          {up && (
            <span
              className="absolute rounded-full"
              style={{
                width: dot,
                height: dot,
                top: -dot / 3,
                right: -dot / 3,
                background: "#22c55e",
                boxShadow: `0 0 ${dot}px rgba(34,197,94,0.9)`,
                border: "1.5px solid var(--shell-card)",
              }}
              aria-hidden
            />
          )}
        </button>
      </Tooltip>

      <span
        className="tnum truncate font-bold leading-none"
        style={{ fontSize: s.label, color: up ? accent : "var(--shell-ink-3)", maxWidth: s.cell }}
      >
        {label}
      </span>
    </div>
  );
};

// ── Board furniture ──────────────────────────────────────────────────────────

/** A captioned block on the chassis. The caption row is always rendered so every block's jacks
 *  sit on the same baseline, whether or not that block has a name worth printing. */
const Section: React.FC<{ caption: string; s: Metrics; children: React.ReactNode }> = ({
  caption, s, children,
}) => (
  <div
    className="flex shrink-0 flex-col items-center"
    style={{ gap: s.gapCaption, padding: `0 ${s.sectionPad}px` }}
  >
    <span
      className="font-bold uppercase leading-none ink-3 select-none"
      style={{ fontSize: s.caption, letterSpacing: "0.14em" }}
    >
      {caption}
    </span>
    {children}
  </div>
);

const Divider: React.FC = () => (
  <span className="w-px shrink-0 self-stretch" style={{ background: "var(--shell-border)" }} aria-hidden />
);

const CountChip: React.FC<{ color: string; children: React.ReactNode }> = ({ color, children }) => (
  <span className="pill" style={{ color, background: `${color}1f` }}>
    <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
    {children}
  </span>
);

const LEGEND: { state: PortState; label: string }[] = [
  { state: "up", label: "Link up" },
  { state: "down", label: "No link" },
  { state: "disabled", label: "Disabled" },
];

/** The board never shrinks past this — below it the port numbers stop being readable. */
const MIN_FIT = 0.55;

/** Layout effect in the browser, plain effect on the server — the faceplate is rendered to static
 *  markup in its own tests, and useLayoutEffect warns there. */
const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type Fit = { scale: number; w: number; h: number };

/**
 * Measures the board against the space it was given and returns the scale that makes it fit.
 *
 * Only ever used when the card is filling a grid cell. A card that hugs its content has no width
 * to fit into — measuring it would shrink the board, which would shrink the card, which would
 * shrink the board again.
 */
const useFitToWidth = (
  wrapRef: React.RefObject<HTMLDivElement | null>,
  boardRef: React.RefObject<HTMLDivElement | null>,
  enabled: boolean,
): Fit | null => {
  const [fit, setFit] = useState<Fit | null>(null);

  useIsoLayoutEffect(() => {
    if (!enabled) { setFit(null); return; }
    const wrap = wrapRef.current;
    const board = boardRef.current;
    if (!wrap || !board) return;

    // offsetWidth/Height are the UNSCALED box — a transform never changes them — so the natural
    // size can be read at any current scale without first resetting it.
    const measure = () => {
      const w = board.offsetWidth;
      const h = board.offsetHeight;
      if (!w || !h) return;
      const cs = getComputedStyle(wrap);
      const avail = wrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const scale = Math.min(1, Math.max(MIN_FIT, avail / w));
      setFit((prev) =>
        prev && prev.w === w && prev.h === h && Math.abs(prev.scale - scale) < 0.005
          ? prev
          : { scale, w, h },
      );
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    ro.observe(board);
    return () => ro.disconnect();
  }, [enabled, wrapRef, boardRef]);

  return fit;
};

// ── The faceplate ────────────────────────────────────────────────────────────

const DeviceFaceplate: React.FC<Props> = ({
  model, interfaces, currentColor, onPortClick, size = "sm", fill = false,
}) => {
  const s = SCALE[size];
  const byName = new Map(interfaces.map((i) => [i.name, i]));

  const wrapRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const fit = useFitToWidth(wrapRef, boardRef, fill);
  /** True while the board was actually made to fit — false once it bottomed out at MIN_FIT. */
  const fitted = fit !== null && fit.scale > MIN_FIT + 0.001;

  const jackFor = (name: string, label: string) => {
    const i = byName.get(name)!;
    const state = portState(i);
    const title = (
      <div className="text-[11px] leading-relaxed">
        <div className="font-semibold">{i.alias ? `${i.alias} (${name})` : name}</div>
        <div>Status: {STATE_LABEL[state]}</div>
        {i.ip && <div>IP: {i.ip}</div>}
        {i.speed_mbps > 0 && (
          <div>Speed: {i.speed_mbps >= 1000 ? `${i.speed_mbps / 1000} Gbps` : `${i.speed_mbps} Mbps`}</div>
        )}
        {onPortClick && <div className="opacity-70">Click to open the interface list</div>}
      </div>
    );
    return (
      <Jack
        key={name}
        name={name}
        state={state}
        label={label}
        title={title}
        accent={currentColor}
        s={s}
        onClick={onPortClick ? () => onPortClick(name) : undefined}
      />
    );
  };

  const { topCells, bottomCells, fixed: fixedNames, odds, evens, fixedCaption, drawnNames } =
    faceplateSlots(interfaces);
  const lanNums = [...odds, ...evens];

  // Counted over the ports drawn on this board only. Counting every interface swept VLANs,
  // tunnels and the switch itself into "links up" and reported more live ports than the chassis
  // has jacks.
  const drawn = [...drawnNames]
    .map((n) => byName.get(n))
    .filter((i): i is SystemInterface => Boolean(i))
    .map(portState);

  const upCount       = drawn.filter((st) => st === "up").length;
  const downCount     = drawn.filter((st) => st === "down").length;
  const disabledCount = drawn.filter((st) => st === "disabled").length;

  return (
    <section
      className={`flex flex-col overflow-hidden shell-card ${fill ? "h-full w-full" : "w-fit max-w-full"}`}
    >
      {/* Title bar */}
      <div
        className="flex items-center gap-2.5 border-b hairline-2"
        style={{ padding: `${size === "lg" ? 11 : 10}px ${s.boardPadX}px` }}
      >
        <span className="grid shrink-0 grid-cols-2 gap-0.5" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <span key={i} className="rounded-[1px] bg-red-500" style={{ width: s.mark, height: s.mark }} />
          ))}
        </span>
        <span className="truncate font-bold ink" style={{ fontSize: s.title }}>
          {model || "FortiGate"}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <CountChip color="#16a34a">
            {upCount} up
          </CountChip>
          {downCount > 0 && <CountChip color="#64748b">{downCount} down</CountChip>}
          {disabledCount > 0 && <CountChip color="#f59e0b">{disabledCount} off</CountChip>}
        </span>
      </div>

      {/* Chassis. flex-1 + centred so that on the dashboard, where the card is stretched to the
          height of the identity hero beside it, the board sits in the middle of the card rather
          than clinging to the top edge. */}
      <div
        ref={wrapRef}
        className="flex flex-1 items-center shell-scroll"
        style={{
          padding: `${s.boardPadY}px ${s.boardPadX}px`,
          // `safe center` so an overflowing board starts at its left edge instead of being clipped
          // equally at both ends, which is what plain centring does and leaves unreachable.
          justifyContent: "safe center",
          // A board that was scaled to fit has nothing to scroll to, and a scrollbar appearing
          // under it on hover — which a sub-pixel rounding of the scaled width is enough to
          // trigger — is pure noise. Only the board that bottomed out at MIN_FIT can scroll.
          overflowX: fitted ? "hidden" : "auto",
        }}
      >
        {/* Holds the scaled board's footprint: a transform does not change layout size, so without
            this box the card would keep reserving the unscaled width and height. Floored, so the
            rounded-up fraction of a scaled width cannot spill a pixel past the container. */}
        <div
          className="relative shrink-0"
          style={fit ? { width: Math.floor(fit.w * fit.scale), height: Math.ceil(fit.h * fit.scale) } : undefined}
        >
          <div
            ref={boardRef}
            className={`flex items-stretch ${fit ? "absolute top-0 left-0" : ""}`}
            style={{
              padding: `${s.boardPadY}px 0`,
              borderRadius: size === "lg" ? 16 : 12,
              background: "var(--shell-sunken)",
              boxShadow: "inset 0 0 0 1px var(--shell-border-2)",
              transform: fit ? `scale(${fit.scale})` : undefined,
              transformOrigin: "top left",
            }}
          >
            {/* Status LEDs — the cluster every FortiGate carries left of its ports. Decorative:
                the device does not expose them over the API, and nothing here pretends it does. */}
            <Section caption="STATUS" s={s}>
              <div className="flex items-end" style={{ gap: Math.round(s.colGap + 2), height: s.bar }}>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="rounded-full bg-green-500/80"
                    style={{ width: size === "lg" ? 6 : 5, height: s.bar }}
                  />
                ))}
              </div>
            </Section>

            {fixedNames.length > 0 && (
              <>
                <Divider />
                {/* Fixed connector block — uniform 2×2 grid (top: WAN1/DMZ, bottom: WAN2/HA) */}
                <Section caption={fixedCaption || "FIXED"} s={s}>
                  <div className="flex flex-col" style={{ gap: s.rowGap }}>
                    <div className="flex" style={{ gap: s.colGap }}>
                      {topCells.map((cell) => (
                        <React.Fragment key={cell.name}>
                          {byName.has(cell.name) ? jackFor(cell.name, cell.label) : <div style={{ width: s.cell }} />}
                        </React.Fragment>
                      ))}
                    </div>
                    <div className="flex" style={{ gap: s.colGap }}>
                      {bottomCells.map((cell) => (
                        <React.Fragment key={cell.name}>
                          {byName.has(cell.name) ? jackFor(cell.name, cell.label) : <div style={{ width: s.cell }} />}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </Section>
              </>
            )}

            {lanNums.length > 0 && (
              <>
                <Divider />
                {/* LAN numbered block — same jack cell size and row structure as the connectors */}
                <Section caption="LAN" s={s}>
                  <div className="flex flex-col" style={{ gap: s.rowGap }}>
                    <div className="flex" style={{ gap: s.colGap }}>
                      {odds.map((n) => jackFor(`port${n}`, String(n)))}
                    </div>
                    <div className="flex" style={{ gap: s.colGap }}>
                      {evens.map((n) => jackFor(`port${n}`, String(n)))}
                    </div>
                  </div>
                </Section>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Legend — colour is never the only thing carrying state on this card. */}
      <div
        className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
        style={{
          padding: `8px ${s.boardPadX}px`,
          borderTop: "1px solid var(--shell-border-2)",
          background: "var(--shell-sunken)",
        }}
      >
        {LEGEND.map(({ state, label }) => (
          <span key={state} className="flex items-center gap-1.5 t-meta">
            <span
              className="rounded-[3px]"
              style={{
                width: 10,
                height: 8,
                background: PORT_TONE[state].body,
                boxShadow: `inset 0 0 0 1px ${PORT_TONE[state].edge}`,
                opacity: state === "disabled" ? 0.62 : 1,
              }}
            />
            {label}
          </span>
        ))}
        {onPortClick && (
          <span className="t-meta ml-auto hidden sm:inline">Click a port to open its interface</span>
        )}
      </div>
    </section>
  );
};

export default DeviceFaceplate;
