import type { FlowContext } from "./deviceFacts";
import type { SimPhase } from "./packetSim";
import type { ChatItem } from "./index";

// How a run gets from the chat to /admin/ai-assistant/simulate.
//
// The full-screen view used to be a `fixed` overlay portalled onto document.body, which is a page
// wearing a modal's clothes: no URL, no Back button, no browser history, and an Escape key doing
// two different things depending on how deep you were. It is a page now, and a page needs its
// subject handed to it.
//
// IN MEMORY, DELIBERATELY. A run is a ChatItem, a FlowContext of Maps and Sets, and the placement
// anchors the Policy Wizard is holding — none of which survives JSON, and none of which should be
// re-fetched from the firewall just to redraw a picture. A client-side navigation keeps this module
// alive, which is every way the user actually gets there. A hard reload does not, and the page says
// so plainly and offers the way back rather than inventing a run from nothing.
//
// It is NOT a cache: `put` replaces whatever was there, so the page can only ever draw the run the
// user just pressed the button on.

export type SimHandoff = {
  hostname: string;
  item: ChatItem;
  ctx: FlowContext;
  accent: string;
  /** True while the device lists that resolve object names are still loading. */
  enriching: boolean;
  /**
   * Where the wizard would place policy `k` — resolved at hand-off time, because the page has no
   * access to the chat's placement state and must not guess a position Apply would not use.
   */
  anchors: (number | null)[];
  /** Which message in the conversation this run belongs to, so Back can reopen its panel. */
  itemIndex: number;
  policyIndex: number;
  phase: SimPhase;
};

let held: SimHandoff | null = null;
let returning = false;

export function putSimHandoff(h: SimHandoff) {
  held = h;
  returning = false;
}

export function readSimHandoff(): SimHandoff | null {
  return held;
}

/** Called by the page's Back button: the chat should reopen the panel it was left on. */
export function markSimReturn() {
  returning = Boolean(held);
}

/**
 * Read once, on the chat's mount: which message's Simulate panel to reopen, if the user has just
 * come back from the full page. Clears itself, so a later visit to the chat opens nothing.
 */
export function takeSimReturn(): number | null {
  if (!returning || !held) return null;
  returning = false;
  return held.itemIndex;
}

export function clearSimHandoff() {
  held = null;
  returning = false;
}
