import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiActivity, FiArrowLeft, FiHardDrive } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { EMPTY_FLOW_CONTEXT } from "./deviceFacts";
import { SimVerdict } from "./RuleLedger";
import {
  FlowLines, SimImpactTab, SimRulesTab, SimSeg, SimTabsBar, SimWalkTab, type SimTab,
} from "./SimulateTabs";
import { markSimReturn, readSimHandoff } from "./simulateHandoff";
import { useSimRun } from "./simulateRun";
import type { ChatItem } from "./index";

// /admin/ai-assistant/simulate — the run, at page size.
//
// IT WAS A FULL-SCREEN OVERLAY. That was the wrong shape for it twice over. Structurally: no URL,
// no browser Back, a portal onto document.body to escape the chat column's transform, and an
// Escape key that meant "leave full screen" here and "close the panel" one layer down. Visually it
// was the panel's 700px chrome stretched to 1700px — a banner, a tab strip, a picture, a status bar
// repeating the banner's counts, and THREE controls that all closed something.
//
// A FINDING, THEN A STAGE. The first version of this page was the panel's layout with more room:
// header, verdict, tabs, flow chips, drawing, transport, steps — seven bands stacked down a 1500px
// screen, most of them one line tall and floating loose on the page canvas with nothing but grey
// between them. Nothing owned anything.
//
// So there are two blocks. The FINDING — the verdict with its numbers, and the sample flows — runs
// across the top, horizontally, because both are lists of three and both are true of the run rather
// than of any one tab. The STAGE below is one surface holding the current view and nothing else,
// with the full width of the page for the rule table that is the reason to be here.
//
// Everything sits ON a card. The old layout put half its type straight onto the page's grey, which
// is where text goes to disappear.
//
// The run is HANDED to it (simulateHandoff.ts) rather than rebuilt. A reload loses the hand-off —
// a FlowContext of Maps does not survive a URL — and the page says so and offers the way back
// rather than re-reading the firewall to redraw a picture the user can reopen in one click.

/** Stands in while there is no hand-off, so the hooks below run unconditionally. */
const NO_ITEM: ChatItem = { role: "assistant", text: "" };

const SimulatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();

  // Read once. The store is replaced on every hand-off, and a re-read mid-run could only ever
  // return the same object or a run the user did not ask to see.
  const [handoff] = useState(readSimHandoff);
  const [tab, setTab] = useState<SimTab>("walk");

  const accent = handoff?.accent || currentColor;

  const anchorFor = useCallback((k: number) => handoff?.anchors[k] ?? null, [handoff]);

  const run = useSimRun(
    handoff?.item ?? NO_ITEM,
    handoff?.ctx ?? EMPTY_FLOW_CONTEXT,
    anchorFor,
    { policyIndex: handoff?.policyIndex, phase: handoff?.phase },
  );

  const back = useCallback(() => {
    markSimReturn();
    navigate("/admin/ai-assistant");
  }, [navigate]);

  const { scenario } = run;
  const runKey = useMemo(() => `${run.policyIndex}-${run.phase}`, [run.policyIndex, run.phase]);

  return (
    <div className="flex flex-col gap-3">
      {/* ── One line: where you came from, what you are looking at, which run ── */}
      <header className="sim-rise sim-rise-1 panel flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
        <button type="button" onClick={back}
          className="sim-back flex shrink-0 items-center gap-1.5 rounded-[4px] border hairline px-2.5 py-1.5 text-[11.5px] font-semibold ink-2 transition surface-hover hover-ink">
          <FiArrowLeft size={13} className="sim-back-arrow" />
          Back to AI Assistant
        </button>

        <span className="medallion h-8 w-8 shrink-0 text-[14px]"
          style={{ background: `color-mix(in srgb, ${accent} 13%, transparent)`, color: accent }}>
          <FiActivity />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="t-display m-0 truncate">Simulate</h1>
          <p className="t-meta m-0 mt-0.5 flex items-center gap-1 truncate">
            <FiHardDrive size={10} />
            {handoff ? handoff.hostname : "no run loaded"} · walked against the device's own policy table
          </p>
        </div>

        {scenario && ((run.drafts && run.drafts.length > 1) || handoff?.enriching) && (
          <div className="flex flex-wrap items-center gap-2">
            {run.drafts && run.drafts.length > 1 && (
              <SimSeg
                items={run.drafts.map((d, i) => ({ id: String(i), label: d.form.name ?? d.target }))}
                value={String(run.policyIndex)}
                onChange={(v) => run.setPolicyIndex(Number(v))} />
            )}
            {handoff?.enriching && (
              <span className="flex items-center gap-1.5 text-[10px] ink-3">
                <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
                Resolving object names…
              </span>
            )}
          </div>
        )}
      </header>

      {!handoff ? (
        <NoRun onBack={back} />
      ) : !scenario ? (
        <section className="sim-rise sim-rise-2 panel panel-body text-center">
          <p className="text-[12.5px] font-semibold ink-2">
            This answer proposes no firewall policy, so there is no traffic to walk
          </p>
          <p className="mx-auto mt-1 max-w-md text-[11.5px] ink-3">
            Objects, profiles and routes change nothing on their own — they take effect when a
            policy references them.
          </p>
        </section>
      ) : (
        <>
          {/* ── What the run found, straight across the top ──
              The verdict and its numbers are one horizontal bar and the sample flows are one
              horizontal strip, because both are LISTS OF THREE and a 300px rail turned each of them
              into a tall stack beside a drawing that wanted the width. Neither belongs to a tab:
              they are true of the run, so they sit above all three. */}
          <div className="sim-rise sim-rise-2 flex flex-col gap-3">
            <SimVerdict headline={scenario.headline} />

            <section className="panel flex flex-wrap items-center gap-x-5 gap-y-2 px-3.5 py-2.5">
              <div className="min-w-0 shrink-0">
                <Eyebrow>Sample flows</Eyebrow>
                <p className="text-[10.5px] leading-relaxed ink-3">
                  One packet per address the source stands for, sent at {scenario.ingress}.
                </p>
              </div>
              <FlowLines scenario={scenario} layout="row" />
            </section>
          </div>

          {/* ── The stage: one surface, one view ── */}
          <section className="sim-rise sim-rise-3 panel panel-flush min-w-0">
            <div className="flex flex-wrap items-center gap-2 border-b hairline-2 px-3 pt-2">
              <SimTabsBar run={run} tab={tab} accent={accent} onChange={setTab} />
              {/* What the view is OF, said once. */}
              <span className="ml-auto truncate pb-2 pl-2 text-[10.5px] ink-3">
                {tab === "walk"
                  ? run.drafts?.[run.policyIndex]?.form.name ?? "the proposed policy"
                  : tab === "rules" ? `${run.deadCount} rule(s) stop working`
                  : `${run.stopCount} thing(s) stop working`}
              </span>
            </div>

            <div className={tab === "walk" ? "" : "p-4"}>
              {tab === "walk" && (
                <SimWalkTab scenario={scenario} accent={accent} deviceName={handoff.hostname}
                  view="table" runKey={runKey} showFlows={false} bare />
              )}
              {tab === "rules" && <SimRulesTab scenario={scenario} />}
              {tab === "impact" && (
                <SimImpactTab scenario={scenario} run={run} accent={accent}
                  enriching={handoff.enriching} objects={run.objects} />
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

const Eyebrow: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h2 className="mb-1.5 flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider ink-3">
    {children}
  </h2>
);

/**
 * The reload case. The run lived in memory, and saying "nothing to show" without saying why — or
 * without a way back — is how a page like this becomes a dead end.
 */
const NoRun: React.FC<{ onBack: () => void }> = ({ onBack }) => (
  <section className="sim-rise sim-rise-2 panel flex flex-col items-center px-6 py-16 text-center">
    <FiActivity size={26} className="mb-3 opacity-30 ink-3" />
    <p className="text-[13px] font-semibold ink-2">There is no simulation loaded</p>
    <p className="mt-1 max-w-md text-[11.5px] leading-relaxed ink-3">
      A run is handed to this page from the conversation it belongs to, and a reload does not carry
      it — the proposal, the device's rule table and the placement it would use all live in the
      chat. Open the answer again and press <b className="ink-2">Simulate</b>.
    </p>
    <button type="button" onClick={onBack}
      className="sim-back mt-4 flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 transition surface-hover hover-ink">
      <FiArrowLeft size={13} className="sim-back-arrow" /> Back to AI Assistant
    </button>
  </section>
);

export default SimulatePage;
