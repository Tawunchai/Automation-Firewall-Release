import React from "react";
import { FiActivity, FiHardDrive, FiMaximize2, FiX } from "react-icons/fi";
import { SimVerdict } from "./RuleLedger";
import { SimImpactTab, SimRulesTab, SimSeg, SimTabsBar, SimWalkTab, type SimTab } from "./SimulateTabs";
import { useSimRun } from "./simulateRun";
import type { SimPhase } from "./packetSim";
import type { FlowContext } from "./deviceFacts";
import type { ChatItem } from "./index";

// The right-hand panel: what this proposal does to the firewall, before it does it.
//
// It shares the slot with the wizards and the Dry-run preview and answers a different question from
// either. Dry-run says what WILL BE WRITTEN; a wizard says whether a field is right. This says what
// the rule base will DO once the write lands — which rule claims the traffic, which rules stop
// being reachable, and what stops working as a result.
//
// THREE TABS, NOT ONE COLUMN. The first version stacked verdict, walk, ledger, consequences, impact
// numbers and object list into one scrolling column, which in a 700px slot meant the reader scrolled
// past the picture to reach the reason and never had both in view. The verdict stays pinned above
// the tabs — it is the answer, and it is one sentence — and each tab is then sized to be read
// without scrolling.
//
// TWO PICTURES, ONE RUN. Here the Walk tab draws the OVERVIEW: the packets leave a network, cross
// the device, and either reach the internet or stop inside it. That is the question somebody has
// while still reading the proposal — "does my traffic still get out?" — and it fits a 700px slot
// without shrinking a rule table past reading.
//
// The other question — "which of my forty rules just died?" — needs the table, which needs the
// room, and it now has a PAGE of its own at /admin/ai-assistant/simulate rather than a full-screen
// overlay bolted onto this panel. `onExpand` is how it gets there; the state it takes with it is
// simulateHandoff.ts. What used to live here — a portal onto document.body, an Escape handler that
// meant two different things, a body-scroll lock and a second copy of the whole panel — is gone.

export type SimulatePanelProps = {
  hostname: string;
  item: ChatItem;
  ctx: FlowContext;
  accent: string;
  /** True while the device lists that resolve object names are still loading. */
  enriching: boolean;
  /**
   * Where the wizard would place policy `k` — the id of the live policy it sits BEFORE, or null for
   * the bottom of its interface pair. Same vocabulary as PolicyPlacementBoard, so the simulation
   * and the thing that does the writing cannot disagree about position.
   */
  anchorFor: (policyIndex: number) => number | null;
  /**
   * Open this run on its own page. Given the run's current policy and phase, so the page opens on
   * the moment the reader was looking at rather than back at the default.
   *
   * Optional: without it the panel simply offers no way out, which is what the render tests and any
   * future caller outside a router get.
   */
  onExpand?: (at: { policyIndex: number; phase: SimPhase }) => void;
  onClose: () => void;
};

export const SimulatePanel: React.FC<SimulatePanelProps> = ({
  hostname, item, ctx, accent, enriching, anchorFor, onExpand, onClose,
}) => {
  const run = useSimRun(item, ctx, anchorFor);
  const [tab, setTab] = React.useState<SimTab>("walk");
  const { scenario } = run;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* ── Header ── */}
      <div className="flex shrink-0 items-center gap-2 border-b hairline-2 px-4 py-2.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px]"
          style={{ background: `${accent}18`, color: accent }}>
          <FiActivity size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-semibold ink">Simulate — what this does to the rule base</p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname} · walked against the device's own policy table
          </p>
        </div>
        {scenario && onExpand && (
          <button type="button"
            onClick={() => onExpand({ policyIndex: run.policyIndex, phase: run.phase })}
            title="Open this run on its own page, walked down the whole rule table"
            className="flex h-6 shrink-0 items-center gap-1.5 rounded-[4px] border hairline px-2 text-[10.5px] font-semibold transition surface-hover"
            style={{ color: accent, borderColor: `${accent}55` }}>
            <FiMaximize2 size={11} />
            Open full view
          </button>
        )}
        <button type="button" onClick={onClose} aria-label="Close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 transition surface-hover hover-ink">
          <FiX size={13} />
        </button>
      </div>

      {!scenario ? (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center ink-3">
          <FiActivity size={26} className="mb-3 opacity-30" />
          <p className="text-[12.5px]">This answer proposes no firewall policy, so there is no traffic to walk</p>
          <p className="mt-1 max-w-sm text-[11px]">
            Objects, profiles and routes change nothing on their own — they take effect when a policy
            references them.
          </p>
        </div>
      ) : (
        <>
          {/* ── Which policy ──
              The run is always "After Apply": the only question this panel is open to answer is what
              the proposed rule does once it lands. The Now / After Apply / Above-it toggle that used
              to sit here was comparison machinery nobody was reading — the verdict and the walk below
              already say whether the rule even runs where Apply would put it. Only the policy switcher
              remains, and only when an answer proposes more than one. */}
          {((run.drafts && run.drafts.length > 1) || enriching) && (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-b hairline-2 px-4 py-2">
              {run.drafts && run.drafts.length > 1 && (
                <SimSeg items={run.drafts.map((d, i) => ({ id: String(i), label: d.form.name ?? d.target }))}
                  value={String(run.policyIndex)} onChange={(v) => run.setPolicyIndex(Number(v))} />
              )}
              {enriching && (
                <span className="ml-auto flex items-center gap-1.5 text-[10px] ink-3">
                  <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
                  Resolving object names…
                </span>
              )}
            </div>
          )}

          {/* ── The answer, always in view ── */}
          <div className="shrink-0 px-4 pt-3">
            <SimVerdict headline={scenario.headline} />
          </div>

          {/* ── Tabs ── */}
          <div className="shrink-0 px-4 pt-3">
            <SimTabsBar run={run} tab={tab} accent={accent} onChange={setTab} />
          </div>

          <div className="shell-scroll min-h-0 flex-1 overflow-y-auto border-t hairline-2 p-4">
            {tab === "walk" && (
              <SimWalkTab scenario={scenario} accent={accent} deviceName={hostname}
                view="overview" runKey={`${run.policyIndex}-${run.phase}`}
                footnote={onExpand ? (
                  <p className="text-[11px] ink-3">
                    This is the journey. <b className="ink-2">Open full view</b> walks the same run
                    down the device's rule table, one policy at a time — that is where you see which
                    rules the change takes out.
                  </p>
                ) : undefined} />
            )}
            {tab === "rules" && <SimRulesTab scenario={scenario} />}
            {tab === "impact" && (
              <SimImpactTab scenario={scenario} run={run} accent={accent}
                enriching={enriching} objects={run.objects} />
            )}
          </div>
        </>
      )}

      <div className="flex shrink-0 items-center justify-between gap-2 border-t hairline-2 px-4 py-2.5">
        <span className="truncate text-[10.5px] ink-3">
          {scenario
            ? `${scenario.flows.length} sample flow(s) · ${run.deadCount} rule(s) stop working`
            : "nothing to simulate"}
        </span>
        <button type="button" onClick={onClose}
          className="shrink-0 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 transition surface-hover">
          Close
        </button>
      </div>
    </div>
  );
};

export default SimulatePanel;
