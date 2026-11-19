import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import SimulatePanel from "./SimulatePanel";
import { putSimHandoff } from "./simulateHandoff";
import type { FlowContext } from "./deviceFacts";
import type { SimPhase } from "./packetSim";
import type { ChatItem } from "./index";

// The Simulate panel, wired to the router.
//
// SimulatePanel itself knows nothing about routes: it is rendered in tests with no Router around it
// and it must keep working there, so "open this run on its own page" reaches it as a callback. This
// is where that callback is built, and it is the only piece of the feature that navigates.
//
// The ANCHORS are resolved here rather than on the page. Where a proposed policy sits in the rule
// table is the Policy Wizard's state, it lives in the chat, and the page has no way to ask for it —
// so the run is handed over with its placement already decided. A page that guessed would draw a
// convincing picture of a rule base nobody is going to create.

export type SimulateSlotProps = {
  /** Which message in the conversation this run belongs to, so Back can reopen its panel. */
  itemIndex: number;
  item: ChatItem;
  hostname: string;
  ctx: FlowContext;
  enriching: boolean;
  accent: string;
  anchorFor: (policyIndex: number) => number | null;
  onClose: () => void;
};

export const SimulateSlot: React.FC<SimulateSlotProps> = ({
  itemIndex, item, hostname, ctx, enriching, accent, anchorFor, onClose,
}) => {
  const navigate = useNavigate();

  const openPage = useCallback(
    (at: { policyIndex: number; phase: SimPhase }) => {
      putSimHandoff({
        hostname, item, ctx, accent, enriching, itemIndex,
        anchors: (item.policyDrafts ?? []).map((_, k) => anchorFor(k)),
        policyIndex: at.policyIndex,
        phase: at.phase,
      });
      navigate("/admin/ai-assistant/simulate");
    },
    [navigate, hostname, item, ctx, accent, enriching, itemIndex, anchorFor],
  );

  return (
    <SimulatePanel hostname={hostname} item={item} ctx={ctx} accent={accent}
      enriching={enriching} anchorFor={anchorFor} onExpand={openPage} onClose={onClose} />
  );
};

export default SimulateSlot;
