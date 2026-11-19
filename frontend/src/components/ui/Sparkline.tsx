import React from "react";

/**
 * A rule's traffic, the size of a word.
 *
 * Hand-drawn SVG rather than a chart library: this appears once per table row, and a hundred
 * recharts instances on one page is a hundred ResizeObservers for sixty pixels of shape each.
 *
 * ── What it does and does not claim ──────────────────────────────────────────
 *
 * The x axis is the SAMPLE INDEX, not a clock. Samples are evenly spaced (every five minutes) so
 * the shape is honest about ordering and about relative size, but a gap in sampling shows as a
 * shorter line rather than a hole. That is the trade a sixty-pixel drawing makes, and it is why the
 * number beside it — a total anyone can check — is the thing that carries the fact, with the
 * sparkline only carrying the shape.
 *
 * It is `aria-hidden` and the row states its numbers in text, because a shape that cannot be read
 * out loud must never be the only place a fact appears.
 */

export type SparklineProps = {
  /** Oldest first. An empty list renders nothing — the caller says what "nothing" means. */
  values: number[];
  color: string;
  width?: number;
  height?: number;
};

const Sparkline: React.FC<SparklineProps> = ({ values, color, width = 64, height = 18 }) => {
  if (values.length === 0) return null;

  const max = Math.max(...values);
  const pad = 1.5;
  const usable = height - pad * 2;
  // Half the stroke would otherwise hang outside the box at the first and last point, which in a
  // table cell reads as a line touching the column beside it.
  const inset = 1;

  // A single sample has no line to draw; it becomes a dot at its own height so the row still shows
  // that something was measured.
  const span = width - inset * 2;
  const step = values.length > 1 ? span / (values.length - 1) : 0;
  const y = (v: number) => (max <= 0 ? height - pad : height - pad - (v / max) * usable);
  const points = values
    .map((v, i) => `${(inset + i * step).toFixed(2)},${y(v).toFixed(2)}`)
    .join(" ");

  // A rule with hits but a flat maximum of zero cannot happen — max is zero only when every sample
  // was zero, and a flat line along the floor is exactly the right picture of "no traffic".
  const quiet = max <= 0;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true"
      style={{ display: "block" }}>
      {values.length === 1 ? (
        <circle cx={inset} cy={y(values[0])} r={2} fill={quiet ? "currentColor" : color}
          opacity={quiet ? 0.35 : 1} />
      ) : (
        <polyline points={points} fill="none" stroke={quiet ? "currentColor" : color}
          strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"
          opacity={quiet ? 0.35 : 1} />
      )}
    </svg>
  );
};

export default Sparkline;
