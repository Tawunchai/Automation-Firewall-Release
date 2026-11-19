import React from "react";
import { GLOBE_D, charsFor } from "./packetSimLayout";

// Where the traffic ends up — one card, drawn the same way in both pictures.
//
// It used to be a cloud SCALED TO ITS COLUMN, which on the full-screen walk meant a 170px balloon
// carrying two words. It was the biggest object in a drawing whose subject is a rule table, and it
// pushed the labels that belong to it out into open space where nothing owned them.
//
// So the destination is now a CARD of the same family as the source card — same corner radius, same
// border, same two lines of type — with a fixed 22px glyph in front of it. Three nodes, one row,
// one visual weight each: the packet's journey reads left to right without one end shouting.
//
// It lives in its own file because both renderers draw it and they must not drift: the panel's
// overview and the full walk are two pictures of ONE run, and a viewer who expands from one to the
// other should not find the internet has changed shape on the way.
//
// The ripple is the only moving part, and it is driven from the callers' paint(): the ring under
// `data-dest-ring` expands once, when the first packet actually lands. That is a fact — something
// arrived — rather than an idle pulse.

/** The card's height. Fixed, so callers can place it against a wire without measuring text. */
export const DEST_H = 54;

/** The glyph box, in the middle of the card's left edge. */
const GLYPH = 22;

export type DestinationNodeProps = {
  /** Left edge of the card. */
  x: number;
  /** Its width — whatever the layout allocated to the destination column. */
  w: number;
  /** The height the outbound wires land at. The card is centred on it. */
  y: number;
  /** True when the traffic is bound for the internet rather than a named network. */
  toInternet: boolean;
  arrived: number;
  total: number;
  /** The address the flows are aimed at, for a named destination. */
  dstIp?: string;
  nameSize: number;
  metaSize: number;
};

export const DestinationNode: React.FC<DestinationNodeProps> = ({
  x, w, y, toInternet, arrived, total, dstIp, nameSize, metaSize,
}) => {
  const gx = x + 12 + GLYPH / 2;
  const textX = x + 12 + GLYPH + 10;
  const chars = charsFor(x + w - textX - 8, metaSize);
  const tint = toInternet ? "var(--flow-info)" : "var(--shell-ink-2)";

  return (
    <>
      <rect x={x} y={y - DEST_H / 2} width={w} height={DEST_H} rx={12}
        style={{ fill: "var(--flow-node-bg)", stroke: "var(--flow-node-line)" }} strokeWidth={1.4} />

      {/* The arrival ripple. Parked at zero opacity; the clock expands it once, on landing. */}
      <circle data-dest-ring="1" cx={gx} cy={y} r={GLYPH / 2 + 2} opacity={0}
        style={{ fill: "none", stroke: tint }} strokeWidth={1.4} />

      {toInternet ? (
        <g transform={`translate(${gx - GLYPH / 2}, ${y - GLYPH / 2}) scale(${GLYPH / 24})`}>
          <path d={GLOBE_D.disc}
            style={{ fill: "var(--flow-info-bg)", stroke: "var(--flow-info)" }} strokeWidth={1.5} />
          <path d={GLOBE_D.meridian}
            style={{ fill: "none", stroke: "var(--flow-info)" }} strokeWidth={1.1} opacity={0.75} />
          {GLOBE_D.lats.map((d) => (
            <path key={d} d={d} style={{ fill: "none", stroke: "var(--flow-info)" }}
              strokeWidth={1.1} opacity={0.55} />
          ))}
        </g>
      ) : (
        // A named network: two stacked shelves, which is what the rest of the console draws for a
        // host rather than for the open internet.
        <g transform={`translate(${gx - GLYPH / 2}, ${y - GLYPH / 2}) scale(${GLYPH / 24})`}
          style={{ fill: "var(--flow-node-bg)", stroke: "var(--shell-ink-3)" }} strokeWidth={1.6}>
          <rect x={2.5} y={3.5} width={19} height={7} rx={2} />
          <rect x={2.5} y={13.5} width={19} height={7} rx={2} />
          <circle cx={6.5} cy={7} r={1.1} style={{ fill: "var(--shell-ink-3)", stroke: "none" }} />
          <circle cx={6.5} cy={17} r={1.1} style={{ fill: "var(--shell-ink-3)", stroke: "none" }} />
        </g>
      )}

      <text x={textX} y={y - 3} fontSize={nameSize} fontWeight={800}
        style={{ fill: "var(--shell-ink)" }}>
        {toInternet ? "Internet" : clip(dstIp ?? "Destination", chars)}
      </text>
      <text x={textX} y={y + 12} fontSize={metaSize}
        style={{ fill: arrived > 0 ? tint : "var(--shell-ink-3)" }}>
        {clip(`${arrived}/${total} arrive`, chars)}
      </text>
    </>
  );
};

function clip(s: string, max: number): string {
  const t = s ?? "";
  return t.length <= max ? t : `${t.slice(0, Math.max(1, max - 1))}…`;
}

export default DestinationNode;
