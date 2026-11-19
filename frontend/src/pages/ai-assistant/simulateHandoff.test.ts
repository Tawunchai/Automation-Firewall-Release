import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearSimHandoff, markSimReturn, putSimHandoff, readSimHandoff, takeSimReturn,
  type SimHandoff,
} from "./simulateHandoff";
import { EMPTY_FLOW_CONTEXT } from "./deviceFacts";

// The full walk moved out of a full-screen overlay and into a route, and this is the only piece of
// state that crosses between them. What it has to get right is small and easy to get wrong: it must
// hand over exactly the run the user pressed the button on, and the "reopen the panel" flag must
// fire once and then stop — otherwise every later visit to the chat springs a panel open on a
// message the reader has moved past.

const handoff = (over: Partial<SimHandoff> = {}): SimHandoff => ({
  hostname: "FortiGate-80E",
  item: { role: "assistant", text: "" },
  ctx: EMPTY_FLOW_CONTEXT,
  accent: "#845ADF",
  enriching: false,
  anchors: [null],
  itemIndex: 3,
  policyIndex: 0,
  phase: "after",
  ...over,
});

describe("simulateHandoff", () => {
  beforeEach(() => clearSimHandoff());

  it("hands the page the run the button was pressed on", () => {
    putSimHandoff(handoff({ policyIndex: 1, phase: "fixed" }));
    expect(readSimHandoff()?.policyIndex).toBe(1);
    expect(readSimHandoff()?.phase).toBe("fixed");
  });

  it("keeps only the latest run — it is a hand-off, not a cache", () => {
    putSimHandoff(handoff({ hostname: "A" }));
    putSimHandoff(handoff({ hostname: "B" }));
    expect(readSimHandoff()?.hostname).toBe("B");
  });

  it("reopens the chat panel once on the way back, and never again", () => {
    putSimHandoff(handoff({ itemIndex: 7 }));
    markSimReturn();
    expect(takeSimReturn()).toBe(7);
    expect(takeSimReturn()).toBeNull();
  });

  it("opens nothing when the chat was reached any other way", () => {
    putSimHandoff(handoff());
    expect(takeSimReturn()).toBeNull();
  });

  it("has nothing to hand over after a reload", () => {
    // The page's empty state exists for exactly this: a FlowContext of Maps does not survive a URL,
    // so a reloaded page says so and offers the way back rather than inventing a run.
    putSimHandoff(handoff());
    clearSimHandoff();
    expect(readSimHandoff()).toBeNull();
  });
});

describe("the route", () => {
  it("is registered for both admins and users", () => {
    // Relative to the frontend root, which is where vitest runs. The page is read-only — it walks a
    // table already in memory — so hiding it from non-admins would only break their Back button.
    const routes = readFileSync("src/routes/mainroutes.tsx", "utf8");
    expect(routes.match(/path: "ai-assistant\/simulate"/g) ?? []).toHaveLength(2);
  });
});
