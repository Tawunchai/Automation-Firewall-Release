import React from "react";
import {
  FiActivity, FiAlertTriangle, FiCheckCircle, FiCpu, FiDatabase,
  FiTrendingDown, FiTrendingUp,
} from "react-icons/fi";
import type { UsagePoint } from "../../api/deviceMonitor";
import type { Health } from "./kpi.logic";

// The top of the dashboard: the device identity banner and the four stat tiles.
//
// Why tiles and not more charts — a dashboard's first job is to answer "is this firewall healthy
// right now?" in one glance. That is a magnitude-plus-headline question, and the form for it is a
// hero number with a coloured delta line for trend (Dastone's own KPI-card shape), not a fourth
// full chart competing with the three below.
//
// ── Colour ───────────────────────────────────────────────────────────────────
// The four metric hues are a validated categorical set (OKLCH lightness band, chroma floor, CVD
// separation and surface contrast all checked with the palette validator), with a separately
// validated set for dark mode — dark is a designed palette, not a flipped copy of the light one.
// The two modes share hue *families* (violet / cyan / pink / amber) so a metric keeps its identity
// when you flip the theme; only the step changes.
//
// CPU rides the user's accent because the whole console is accent-themed; that means its hue is
// not fixed, so **every tile states its own name and value in text** and status is always
// icon + word. Colour is never the only thing carrying meaning here — which is also the relief the
// validator requires for the light steps that fall under 3:1 against a white card.

// ── Status ────────────────────────────────────────────────────────────────────

const HEALTH_LABEL: Record<Health, string> = {
  normal: "Normal",
  warning: "High",
  critical: "Critical",
};

/** First-sample-vs-last-sample movement over the visible window, as a signed percentage. */
const trendFromPoints = (points: UsagePoint[]): number | null => {
  if (points.length < 2) return null;
  const first = points[0].v;
  const last = points[points.length - 1].v;
  if (first === 0) return last === 0 ? 0 : null;
  return ((last - first) / Math.abs(first)) * 100;
};

/** Dastone's own KPI-card delta, verbatim markup (`<span class="text-success"><i class="la-trending-up">
    </i>8.5%</span> New Sessions Today`): a small trend glyph immediately before a bold coloured
    percentage, inline with the plain-text caption — read as one sentence, not a pill. */
const TrendText: React.FC<{ pct: number }> = ({ pct }) => {
  const up = pct >= 0;
  const Icon = up ? FiTrendingUp : FiTrendingDown;
  return (
    <span className="inline-flex items-center gap-0.5 font-bold" style={{ color: up ? "var(--flow-allow)" : "var(--flow-deny)" }}>
      <Icon size={11} />
      {Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : Math.round(Math.abs(pct))}%
    </span>
  );
};

const HEALTH_COLOR: Record<Health, string> = {
  normal: "var(--flow-allow)",
  warning: "var(--flow-warn)",
  critical: "var(--flow-deny)",
};

const HealthText: React.FC<{ health: Health }> = ({ health }) => (
  <span
    className="inline-flex items-center gap-0.5 font-bold"
    style={{ color: HEALTH_COLOR[health] }}
  >
    {health === "normal" ? <FiCheckCircle size={11} /> : <FiAlertTriangle size={11} />}
    {HEALTH_LABEL[health]}
  </span>
);

// ── Stat tile ─────────────────────────────────────────────────────────────────
// The sparkline that used to live here was dropped along with the port to Dastone's KPI card,
// which carries trend as the coloured delta line (TrendText) instead of a chart inside the tile.

/**
 * Dastone's own icon-chip recipe (mannatthemes.com/dastone-bs5): a light tint of the role's colour
 * behind a solid-coloured icon, circular, sitting on its own row under the number — not the dark
 * two-stop gradient chip this console used before porting to that reference. The first four are
 * the KPI cards in order (CPU / Memory / Sessions / Services); the other three (success/danger/
 * neutral) round the set out for the dashboard's other widgets (System Information, Licenses,
 * FortiGate Cloud), which read the same chip so an icon means the same thing everywhere on the page.
 */
/** Flat `--bs-{role}` hex over the matching `--chip-{role}-bg` token — the exact pair Dastone's own
    `bg-{role}-subtle text-{role}` utility combination resolves to, not a darkened-for-contrast
    stand-in. The background reads from a CSS custom property (index.css) rather than a literal
    rgba() here because Dastone's own subtle tint is a *different* alpha per theme (0.1 light,
    0.2 dark) — the icon circle needs that same lift against a dark card the way every other shell
    surface already gets it through a token, not a fixed opacity baked into JS. */
export const ICON_CHIP = {
  primary: { background: "var(--chip-primary-bg)", color: "#6F6AF8" },   // CPU — accent family
  info:    { background: "var(--chip-info-bg)",    color: "#16CDC7" },   // Memory — teal
  accent:  { background: "var(--chip-pink-bg)",    color: "#FD3C97" },   // Sessions — pink
  warning: { background: "var(--chip-warning-bg)", color: "#FFB822" },   // Services — amber
  success: { background: "var(--chip-success-bg)", color: "#22B783" },
  danger:  { background: "var(--chip-danger-bg)",  color: "#F5325C" },
  neutral: { background: "var(--chip-neutral-bg)", color: "#65709A" },
} as const;
export type IconChipVariant = keyof typeof ICON_CHIP;

/**
 * Dastone's own `.report-card` markup, verbatim: a text column (label, the one big number, a
 * coloured delta line) on the left, and the role's icon medallion vertically centered on the
 * right — a horizontal split, not the icon-on-its-own-row-at-the-foot shape this tile used before
 * the port. Card markup for reference (index.html, the "Sessions" tile):
 *   <div class="col"><p class="text-dark fw-semibold">Sessions</p><h3 class="fs-20">24k</h3>
 *   <p class="text-muted"><span class="text-success"><i class="la-trending-up"/>8.5%</span> New
 *   Sessions Today</p></div>
 *   <div class="col-auto align-self-center"><div class="bg-primary-subtle text-primary thumb-md
 *   rounded-circle"><i class="iconoir-user"/></div></div>
 */
export const StatTile: React.FC<{
  label: string;
  icon: React.ReactNode;
  variant: IconChipVariant;
  /** Pre-formatted — the tile never decides how a number reads. */
  value: string;
  unit?: string;
  caption?: string;
  /** Accepted but unread — the tile takes its colour from `variant`'s chip. Optional so a caller
      with no sparkline and no hue of its own (the user page's four tiles) can leave it out. */
  color?: string;
  points?: UsagePoint[];
  domainMax?: number;
  health?: Health;
  loading?: boolean;
}> = ({ label, icon, variant, value, unit, caption, points = [], health, loading }) => {
  const trend = !loading ? trendFromPoints(points) : null;
  const showTrend = trend !== null && Math.abs(trend) >= 0.1;
  // Only a tile whose own health needs attention glows — the rest of the row stays flat, so the
  // glow itself is the signal (see .stat-tile-alert).
  const alert = !loading && health && health !== "normal";
  return (
  <section
    className={`shell-card flex items-center gap-3 p-4${alert ? " stat-tile-alert" : ""}`}
    style={alert ? ({ "--tile-glow": health === "critical" ? "var(--flow-deny)" : "var(--flow-warn)" } as React.CSSProperties) : undefined}
  >
    <div className="min-w-0 flex-1">
      <p className="m-0 truncate text-[14px] font-semibold text-(--shell-ink)">{label}</p>

      {loading ? (
        <span className="shell-skeleton my-1 block h-6 w-16" />
      ) : (
        <p className="m-0 my-1 flex items-baseline gap-1">
          <span className="text-[20px] font-bold leading-none text-(--shell-ink)">{value}</span>
          {unit && <span className="text-xs font-semibold text-(--shell-ink-3)">{unit}</span>}
        </p>
      )}

      <p className="m-0 truncate text-[13px] text-(--shell-ink-3)">
        {loading ? "…" : (
          <>
            {showTrend && <TrendText pct={trend} />}
            {!showTrend && health && health !== "normal" && <HealthText health={health} />}
            {(showTrend || (health && health !== "normal")) && caption && " "}
            {caption ?? (!showTrend ? "steady" : "")}
          </>
        )}
      </p>
    </div>

    <span
      className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-full text-[18px]"
      style={ICON_CHIP[variant]}
      aria-hidden
    >
      {icon}
    </span>
  </section>
  );
};

/** The icons the three sparkline tiles use, so index.tsx does not re-import them. */
export const TILE_ICONS = {
  cpu: <FiCpu />,
  memory: <FiDatabase />,
  sessions: <FiActivity />,
} as const;

// Device identity now lives in the dashboard's own hero banner (index.tsx) — the navy
// `.hero-surface`, the same material as the sidebar and the Profile page's identity card — rather
// than a second light card repeating hostname/model/uptime a few hundred pixels below it.
