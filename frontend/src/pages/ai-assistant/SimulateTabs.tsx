import React from "react";
import { FiActivity, FiAlertOctagon, FiLayers, FiList } from "react-icons/fi";
import PacketWalk from "./PacketWalk";
import PacketOverview from "./PacketOverview";
import ImpactReport from "./ImpactReport";
import { BreakList, RuleLedger } from "./RuleLedger";
import type { Scenario } from "./packetSim";
import type { SimObjectRow, SimRun } from "./simulateRun";

// The three tabs, drawn once for both places a run is watched.
//
// The panel and the full page differ in ONE way that matters — how much room the Walk tab has — and
// that is a prop, not a second copy of the component. Everything else (which flows, which rules,
// which breakage) is identical, because it is the same run.

export type SimTab = "walk" | "rules" | "impact";

export const SIM_TABS = (run: SimRun): { id: SimTab; label: string; icon: React.ReactNode; badge?: number }[] => [
  { id: "walk", label: "Walk", icon: <FiActivity size={11} /> },
  { id: "rules", label: "Rules", icon: <FiList size={11} />, badge: run.scenario?.ledger.length },
  { id: "impact", label: "Impact", icon: <FiAlertOctagon size={11} />, badge: run.stopCount || undefined },
];

/** A segmented switch — which policy, which run. */
export const SimSeg: React.FC<{
  items: { id: string; label: string; title?: string }[];
  value: string;
  onChange: (id: string) => void;
}> = ({ items, value, onChange }) => (
  <div className="flex items-center gap-1 rounded-[4px] surface-sunken p-1">
    {items.map((it) => (
      <button key={it.id} type="button" title={it.title} onClick={() => onChange(it.id)}
        className="rounded-[4px] px-2.5 py-1 text-[11px] font-bold transition"
        style={value === it.id
          ? { background: "var(--shell-card)", color: "var(--shell-ink)" }
          : { color: "var(--shell-ink-3)" }}>
        {it.label}
      </button>
    ))}
  </div>
);

export const SimTabsBar: React.FC<{
  run: SimRun;
  tab: SimTab;
  accent: string;
  onChange: (t: SimTab) => void;
}> = ({ run, tab, accent, onChange }) => (
  <div className="flex gap-1">
    {SIM_TABS(run).map((t) => (
      <button key={t.id} type="button" onClick={() => onChange(t.id)}
        className="flex items-center gap-1.5 rounded-t-[4px] border-b-2 px-3 py-1.5 text-[11.5px] font-bold transition"
        style={tab === t.id
          ? { borderColor: accent, color: "var(--shell-ink)" }
          : { borderColor: "transparent", color: "var(--shell-ink-3)" }}>
        {t.icon}{t.label}
        {t.badge ? (
          <span className="rounded-full px-1.5 text-[9px] font-extrabold"
            style={{ background: "var(--flow-chip-bg)", color: "var(--shell-ink-2)" }}>{t.badge}</span>
        ) : null}
      </button>
    ))}
  </div>
);

/**
 * The sample flows this run sends, and what became of each — one LINE each.
 *
 * They were cards in a wrapping row, which is the wrong shape for three items of identical
 * structure: two fit on the first line and one on the second, so the group read as ragged rather
 * than as a list, and every card repeated a border and a badge to say the same three things.
 *
 * `column` stacks them, which is what a 300px panel wants. `row` runs them along one line separated
 * by rules, which is what a full-width band above the drawing wants — same content, same order,
 * same three columns of meaning, laid out along whichever axis has the room.
 */
export const FlowLines: React.FC<{ scenario: Scenario; layout?: "column" | "row" }> = ({
  scenario, layout = "column",
}) => {
  const row = layout === "row";
  return (
    <ul className={`m-0 flex list-none p-0 ${row ? "flex-wrap items-center gap-y-1" : "flex-col"}`}>
      {scenario.flows.map((f) => {
        const tone = f.outcome === "dropped" ? "var(--flow-deny)"
          : f.outcome === "unknown" ? "var(--flow-warn)" : "var(--flow-allow)";
        return (
          <li key={f.flow.id} title={f.flow.origin}
            className={`flex min-w-0 items-center gap-2 hairline-2 ${row
              ? "border-l px-3 first:border-l-0 first:pl-0"
              : "border-t py-1.5 first:border-t-0 first:pt-0"}`}>
            <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-extrabold"
              style={{ background: `color-mix(in srgb, ${tone} 16%, transparent)`, color: tone }}>
              {f.flow.id}
            </span>
            <span className="truncate font-mono text-[10.5px] ink-2">
              {f.flow.srcIp} <span className="ink-3">→</span> {f.flow.port}/{f.flow.proto.toLowerCase()}
            </span>
            <span className={`flex shrink-0 items-center gap-1.5 ${row ? "" : "ml-auto"}`}>
              <span className="hidden text-[10px] font-semibold ink-3 sm:inline">{f.flow.service}</span>
              <span className="text-[9.5px] font-extrabold uppercase tracking-wide" style={{ color: tone }}>
                {f.outcome === "inspected" ? "inspected" : f.outcome}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
};

export const SimWalkTab: React.FC<{
  scenario: Scenario;
  accent: string;
  deviceName: string;
  /**
   * "overview" is the three-node journey that fits a 700px panel; "table" is the same run walked
   * down the device's own rule table, which is what the full page has the room for.
   */
  view: "overview" | "table";
  /**
   * Identifies WHICH run is on screen (policy + phase). The renderers hold their clock and their
   * element handles internally and take a new scenario as a remount, so switching run has to change
   * this key — otherwise the packets keep travelling the old geometry.
   */
  runKey: string;
  /**
   * Whether the sample flows are listed above the drawing. The page states them once, in the rail
   * beside it, where they belong to the whole run rather than to one tab.
   */
  showFlows?: boolean;
  /**
   * Draw the stage edge to edge, with no card of its own. The page already puts the tab inside a
   * panel, and a bordered box inside a bordered box is a frame around a frame.
   */
  bare?: boolean;
  /** Rendered under the drawing — the panel points at the page, the page needs no pointer. */
  footnote?: React.ReactNode;
}> = ({ scenario, accent, deviceName, view, runKey, showFlows = true, bare = false, footnote }) => (
  <div className={bare ? "" : "space-y-3"}>
    {showFlows && <FlowLines scenario={scenario} />}
    <div className={bare ? "empty:hidden space-y-2 px-4 pt-3" : "empty:hidden space-y-2"}>
      {scenario.utm.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] ink-3">
          <span className="font-semibold ink-2">Inspected by</span>
          {scenario.utm.map((u) => (
            <span key={u} className="rounded-[4px] px-1.5 py-0.5 font-mono text-[10px]"
              style={{ background: "var(--flow-info-bg)", color: "var(--flow-info)" }}>{u}</span>
          ))}
          <span>— on the rule that claims the traffic</span>
        </p>
      )}
      {!scenario.simulatesProposal && scenario.flows.length > 0 && (
        <p className="rounded-[4px] border border-dashed px-3 py-2 text-[11.5px] leading-relaxed ink-2"
          style={{ borderColor: "var(--flow-warn)", background: "var(--flow-warn-bg)" }}>
          The flows below belong to other rules on this interface pair. Nothing here shows what
          “{scenario.source.label}” itself would carry — that object is not an address range.
        </p>
      )}
    </div>
    {scenario.flows.length === 0 ? (
      <div className={`border-dashed hairline px-4 py-8 text-center ${bare ? "border-t" : "rounded-[4px] border"}`}>
        <p className="text-[12px] font-semibold ink-2">No packet could be built for this policy</p>
        <p className="mx-auto mt-1 max-w-md text-[11px] ink-3">
          Its source resolves to {scenario.unresolved.join(", ") || "nothing this console can read"},
          which has no address range to send from. The rule states in the other tabs are still
          computed wherever the comparison was decidable.
        </p>
      </div>
    ) : (
      <div className={`sim-stage min-w-0 overflow-hidden ${bare ? "" : "rounded-[4px] border hairline surface-card"}`}>
        {view === "table"
          ? <PacketWalk key={`t-${runKey}`} scenario={scenario} accent={accent} deviceName={deviceName} />
          : <PacketOverview key={`o-${runKey}`} scenario={scenario} accent={accent} deviceName={deviceName} />}
      </div>
    )}
    {footnote}
  </div>
);

export const SimRulesTab: React.FC<{ scenario: Scenario }> = ({ scenario }) => (
  <div className="space-y-2">
    <p className="text-[11px] ink-3">
      Every policy on {scenario.ingress} → {scenario.egress} whose behaviour the change alters.
      FortiOS stops at the first match, so a rule fully covered by one above it never runs again.
    </p>
    <RuleLedger entries={scenario.ledger} />
  </div>
);

export const SimImpactTab: React.FC<{
  scenario: Scenario;
  run: SimRun;
  accent: string;
  enriching: boolean;
  objects: SimObjectRow[];
}> = ({ scenario, run, accent, enriching, objects }) => (
  <div className="space-y-3">
    <BreakList items={scenario.breaks} />
    {run.impact.get(`policy-${run.policyIndex}`) && (
      <ImpactReport report={run.impact.get(`policy-${run.policyIndex}`)!} accent={accent}
        loading={enriching} showCollisions={false} />
    )}
    {objects.length > 0 && (
      <section className="rounded-[4px] border hairline surface-card p-3.5">
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <h3 className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider ink-2">
            <FiLayers size={11} /> Objects that would be created
          </h3>
          <span className="text-[10.5px] ink-3">no traffic changes until a policy references them</span>
        </div>
        <div className="flex flex-col">
          {objects.map((r) => (
            <div key={`${r.kind}-${r.name}`}
              className="flex items-center gap-2 border-t hairline-2 py-1.5 first:border-t-0 first:pt-0">
              <span className="shrink-0 rounded px-1.5 py-px text-[9px] font-extrabold uppercase tracking-wide"
                style={{ background: `${accent}18`, color: accent }}>{r.kind}</span>
              <span className="truncate text-[11.5px] font-semibold ink">{r.name}</span>
              <span className="ml-auto shrink-0 font-mono text-[10.5px] ink-3">{r.value}</span>
            </div>
          ))}
        </div>
      </section>
    )}
  </div>
);
