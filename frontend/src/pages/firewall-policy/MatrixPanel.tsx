import React, { useMemo, useState } from "react";
import { FiGrid, FiInfo } from "react-icons/fi";
import { buildMatrix, describeCell, type CellLevel, type MatrixCell } from "./matrix";
import type { FirewallPolicy } from "../../api/policyObject";

// The rule base drawn as a grid. Model and its severity rules: ./matrix.ts.
//
// ── Why each level gets a GLYPH and not just a colour ────────────────────────
//
// This panel exists to make one finding jump out — a pair that is permitted with nothing
// inspecting it — and a grid that carries that in hue alone fails for anyone who cannot separate
// the amber from the green, which is a lot of the people who read firewall configs. So the level
// is in the mark: a filled block, a hollow block, a slash, a warning wedge. Colour agrees with it
// and adds nothing new.
//
// ── Why it is a panel on this page, not a page of its own ────────────────────
//
// The grid is not an analysis, it is a second READING of the table directly below it. Clicking a
// cell filters that table to the pair, which only works if the two are on the same screen — and a
// separate page would mean two reads of the policy list that could disagree.

type Props = {
  policies: FirewallPolicy[];
  /** 24h hit totals, when the page has them. */
  hitsOf?: (policyId: number) => number | undefined;
  /** Clicking a cell narrows the table below to those rules. */
  onPick: (policyIds: number[], label: string) => void;
  /** The pair currently filtering the table, so the grid shows what is selected. */
  picked?: string | null;
};

const LEVEL_STYLE: Record<CellLevel, { bg: string; ink: string; glyph: string; label: string }> = {
  // The empty cell is the panel's most useful output, so it is a real value with a real mark.
  "none": { bg: "transparent", ink: "var(--shell-ink-3)", glyph: "·", label: "no rule" },
  "deny-only": { bg: "var(--flow-deny-bg)", ink: "var(--flow-deny)", glyph: "/", label: "deny only" },
  "permitted": { bg: "var(--flow-allow-bg)", ink: "var(--flow-allow)", glyph: "■", label: "permitted, inspected" },
  "uninspected": { bg: "var(--flow-warn-bg)", ink: "var(--flow-warn)", glyph: "▲", label: "permitted, not inspected" },
  "wide-open": { bg: "var(--flow-deny)", ink: "#ffffff", glyph: "▲", label: "any / any / any" },
};

const MatrixPanel: React.FC<Props> = ({ policies, hitsOf, onPick, picked }) => {
  const [hover, setHover] = useState<string | null>(null);

  const m = useMemo(() => buildMatrix(policies, { hitsOf }), [policies, hitsOf]);

  if (m.sources.length === 0) {
    return (
      <div className="panel p-4">
        <p className="t-meta m-0">No enabled rule names an interface pair, so there is nothing to grid.</p>
      </div>
    );
  }

  const hovered: MatrixCell | undefined = hover ? m.cells.get(hover) : undefined;
  const [hSrc, hDst] = hover ? hover.split("|") : ["", ""];

  return (
    <div className="panel panel-flush">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b hairline-2 px-4 py-2.5">
        <span className="flex items-center gap-2">
          <FiGrid size={13} className="ink-3" />
          <span className="t-label m-0">Source → destination</span>
        </span>
        <span className="t-meta">
          {m.totals["wide-open"] > 0 && (
            <span className="text-red-500">{`${m.totals["wide-open"]} any/any/any · `}</span>
          )}
          {m.totals.uninspected > 0 && (
            <span className="text-amber-600 dark:text-amber-400">{`${m.totals.uninspected} uninspected · `}</span>
          )}
          {`${m.totals.permitted} inspected · ${m.totals["deny-only"]} deny · ${m.totals.none} no rule`}
        </span>
      </div>

      <div className="overflow-x-auto p-4">
        <table style={{ borderCollapse: "separate", borderSpacing: 3 }}>
          <thead>
            <tr>
              <th />
              {m.destinations.map((d) => (
                <th key={d} className="t-label" style={{ minWidth: 62, paddingBottom: 4 }}>
                  {/* Rotated so a dozen interface names fit without the grid going off screen. */}
                  <span style={{
                    display: "inline-block", whiteSpace: "nowrap",
                    transform: "rotate(-40deg)", transformOrigin: "left bottom",
                  }}>{d}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {m.sources.map((s) => (
              <tr key={s}>
                <th className="t-label whitespace-nowrap pr-2" style={{ textAlign: "right" }}>{s}</th>
                {m.destinations.map((d) => {
                  const key = `${s}|${d}`;
                  const c = m.cells.get(key);
                  const level: CellLevel = c?.level ?? "none";
                  const st = LEVEL_STYLE[level];
                  const isPicked = picked === key;
                  return (
                    <td key={d} style={{ padding: 0 }}>
                      <button
                        type="button"
                        disabled={!c}
                        aria-label={describeCell(c, s, d)}
                        title={describeCell(c, s, d)}
                        onMouseEnter={() => setHover(key)}
                        onMouseLeave={() => setHover(null)}
                        onClick={() => c && onPick(c.policyIds, `${s} → ${d}`)}
                        style={{
                          width: 58, height: 34,
                          display: "flex", flexDirection: "column",
                          alignItems: "center", justifyContent: "center",
                          background: st.bg,
                          color: st.ink,
                          border: isPicked
                            ? "2px solid var(--shell-ink)"
                            : `1px solid ${level === "none" ? "var(--shell-border-2)" : "transparent"}`,
                          borderRadius: 4,
                          cursor: c ? "pointer" : "default",
                          fontSize: 11,
                          lineHeight: 1.1,
                        }}
                      >
                        <span style={{ fontSize: 12 }}>{st.glyph}</span>
                        {c && <span style={{ fontSize: 9.5 }}>{c.count}</span>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* One line of prose for whatever the pointer is on. A grid of glyphs still has to be
          readable out loud, and this is where the colour-blind reading lives. */}
      <div className="flex items-start gap-2 border-t hairline-2 px-4 py-2.5">
        <FiInfo size={13} className="mt-0.5 shrink-0 ink-3" />
        <span className="t-meta">
          {hover
            ? describeCell(hovered, hSrc, hDst)
            : "Hover a cell to read it. Click one to filter the table below to just those rules."}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t hairline-2 px-4 py-2">
        {(["wide-open", "uninspected", "permitted", "deny-only", "none"] as CellLevel[]).map((l) => (
          <span key={l} className="flex items-center gap-1.5 t-meta">
            <span style={{
              width: 16, height: 16, borderRadius: 3,
              background: LEVEL_STYLE[l].bg, color: LEVEL_STYLE[l].ink,
              border: l === "none" ? "1px solid var(--shell-border-2)" : "none",
              display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10,
            }}>{LEVEL_STYLE[l].glyph}</span>
            {LEVEL_STYLE[l].label}
          </span>
        ))}
      </div>
    </div>
  );
};

export default MatrixPanel;
