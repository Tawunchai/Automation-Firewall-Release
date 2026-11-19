import { useMemo, useState } from "react";
import { buildScenario, type Scenario, type SimPhase } from "./packetSim";
import { analyzeProposal } from "./flowImpact";
import { pendingObjectMaps, type FlowContext } from "./deviceFacts";
import type { ChatItem } from "./index";

// One simulation run, and everything derived from it.
//
// WHY IT IS NOT IN THE PANEL ANY MORE. There are now two places a run is watched — the right-hand
// panel in the chat, and the full page at /admin/ai-assistant/simulate — and they must be watching
// the SAME run. Not "the same numbers computed twice": the same policy, the same phase, the same
// placement anchor, the same object list. Copying twenty lines of useMemo into the page is how the
// two would end up disagreeing about which rule dies, which is the one thing this feature exists
// to say.
//
// It holds no chrome and renders nothing, so both callers are free to draw the run however their
// space allows — the panel as three nodes in 700px, the page as the whole rule table.

export const RUN_LABEL: Record<SimPhase, string> = {
  // "Now", not "Today": the run is the rule base as it stands THIS SECOND, and "Today" invited the
  // reading that the other two runs are scheduled for some later day.
  before: "Now",
  after: "After Apply",
  fixed: "Placed above it",
};

/** A row in the "objects that would be created" list — the things that change no traffic yet. */
export type SimObjectRow = { name: string; value: string; kind: string };

export type SimRun = {
  /** The policies this answer proposes. More than one means the run has a policy switcher. */
  drafts: ChatItem["policyDrafts"];
  /** Which of them is being simulated. */
  policyIndex: number;
  setPolicyIndex: (k: number) => void;
  phase: SimPhase;
  setPhase: (p: SimPhase) => void;
  /** Null when the answer proposes no policy at all — there is then no traffic to walk. */
  scenario: Scenario | null;
  /** The runs on offer. "fixed" only appears when a rule above actually blocks the proposal. */
  runs: SimPhase[];
  objects: SimObjectRow[];
  /** Rules this change stops from ever running. */
  deadCount: number;
  /** Things that stop working as a result — the Impact tab's headline. */
  stopCount: number;
  /** The per-policy impact report, keyed the way flowImpact.ts keys it. */
  impact: ReturnType<typeof analyzeProposal>;
};

export function useSimRun(
  item: ChatItem,
  ctx: FlowContext,
  anchorFor: (policyIndex: number) => number | null,
  initial?: { policyIndex?: number; phase?: SimPhase },
): SimRun {
  const drafts = item.policyDrafts ?? [];
  const [k, setPolicyIndex] = useState(initial?.policyIndex ?? 0);
  const [phase, setPhase] = useState<SimPhase>(initial?.phase ?? "after");

  const pending = useMemo(() => pendingObjectMaps(item), [item]);
  const impact = useMemo(() => analyzeProposal(item, ctx), [item, ctx]);

  const policyIndex = Math.min(k, Math.max(0, drafts.length - 1));
  const draft = drafts[policyIndex];

  const scenario = useMemo(() => {
    if (!draft) return null;
    return buildScenario({
      draft, ctx,
      pendingAddresses: pending.addresses,
      pendingServices: pending.services,
      beforeId: anchorFor(policyIndex),
      phase,
    });
  }, [draft, ctx, pending, anchorFor, policyIndex, phase]);

  // The objects this answer would create. They used to get a diagram each, which buried the one
  // thing worth looking at; they change no traffic until a policy references them, so they are a
  // list.
  const objects = useMemo<SimObjectRow[]>(() => {
    const rows: SimObjectRow[] = [];
    pending.addresses.forEach((v, name) => rows.push({ name, value: v || "—", kind: "Address" }));
    pending.services.forEach((v, name) => rows.push({ name, value: v || "—", kind: "Service" }));
    for (const s of item.schedDrafts ?? []) {
      rows.push({ name: s.form.name ?? s.target, value: s.form.type, kind: "Schedule" });
    }
    const profile = (name: string | undefined, kind: string) => {
      if (name) rows.push({ name, value: "profile", kind });
    };
    profile(item.avDraft?.form.name ?? item.avDraft?.target, "AntiVirus");
    profile(item.webDraft?.form.name ?? item.webDraft?.target, "Web Filter");
    profile(item.dnsDraft?.form.name ?? item.dnsDraft?.target, "DNS Filter");
    profile(item.appDraft?.name ?? item.appDraft?.target, "App Control");
    profile(item.ffDraft?.form.name ?? item.ffDraft?.target, "File Filter");
    return rows;
  }, [pending, item]);

  const runs: SimPhase[] = scenario?.blockedById != null
    ? ["before", "after", "fixed"]
    : ["before", "after"];

  return {
    drafts, policyIndex, setPolicyIndex, phase, setPhase, scenario, runs, objects, impact,
    deadCount: scenario?.ledger.filter((e) => e.state === "dead" || e.state === "unreachable").length ?? 0,
    stopCount: scenario?.breaks.filter((b) => b.kind === "stop").length ?? 0,
  };
}

/** The label on a run's button — "Above “Catch-All”" says more than "Placed above it". */
export function runLabel(run: SimPhase, scenario: Scenario | null, max = 16): string {
  if (run === "fixed" && scenario?.blockedByName) {
    const n = scenario.blockedByName;
    return `Above “${n.length <= max ? n : `${n.slice(0, max - 1)}…`}”`;
  }
  return RUN_LABEL[run];
}
