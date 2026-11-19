import { describe, expect, it } from "vitest";
import type { PolicyUsage } from "../../api/lifecycle";
import { ADVICE_LABEL, STATE_STYLE, bytesText, deleteRisk, idleText, sortByPriority, sparkline } from "./format";

// Rule Lifecycle presentation tests.
//
// This page exists so someone can decide which firewall rules to delete. Every function below is
// therefore held to one standard: it must never make a rule look deader than it is, and it must
// never print an internal sentinel as if it were a real measurement.

const policy = (over: Partial<PolicyUsage>): PolicyUsage => ({
  policyid: 1,
  name: "rule",
  action: "accept",
  status: "enable",
  bytes: 0,
  packets: 0,
  hit_count: 0,
  active_sessions: 0,
  first_used: 0,
  last_used: 0,
  idle_days: -1,
  state: "never-used",
  advice: "remove",
  ...over,
});

describe("idleText", () => {
  // -1 is the "never used" sentinel. Rendering it as "-1 วัน" on a page whose job is deciding what
  // to delete would undermine every other number on the screen.
  it("renders the never-used sentinel as words, never as a negative duration", () => {
    const out = idleText(-1);
    expect(out).toBe("Never used");
    expect(out).not.toContain("-1");
  });

  it("reads today as today rather than 0 days", () => {
    expect(idleText(0)).toBe("Today");
  });

  it("renders real ages", () => {
    expect(idleText(1)).toBe("1 day ago");
    expect(idleText(93)).toBe("93 days ago");
  });
});

describe("bytesText", () => {
  it("scales through the units", () => {
    expect(bytesText(0)).toBe("0 B");
    expect(bytesText(512)).toBe("512 B");
    expect(bytesText(2048)).toBe("2.0 KB");
    expect(bytesText(5 * 1024 * 1024)).toBe("5.0 MB");
    expect(bytesText(3 * 1024 ** 4)).toBe("3.0 TB");
  });
});

describe("sortByPriority", () => {
  it("puts the cleanup backlog on top and the healthy rules at the bottom", () => {
    const rows = [
      policy({ policyid: 1, state: "active", idle_days: 0, advice: "" }),
      policy({ policyid: 2, state: "stale", idle_days: 120 }),
      policy({ policyid: 3, state: "never-used", idle_days: -1 }),
      policy({ policyid: 4, state: "idle", idle_days: 30, advice: "review" }),
      policy({ policyid: 5, state: "disabled", idle_days: -1, advice: "review" }),
    ];

    expect(sortByPriority(rows).map((p) => p.state)).toEqual([
      "never-used",
      "stale",
      "disabled",
      "idle",
      "active",
    ]);
  });

  it("breaks ties by longest idle, then by policy id, so refreshes do not reshuffle rows", () => {
    const rows = [
      policy({ policyid: 9, state: "stale", idle_days: 100 }),
      policy({ policyid: 2, state: "stale", idle_days: 200 }),
      policy({ policyid: 1, state: "stale", idle_days: 100 }),
    ];

    expect(sortByPriority(rows).map((p) => p.policyid)).toEqual([2, 1, 9]);
  });

  it("does not mutate the input array", () => {
    const rows = [policy({ policyid: 1, state: "active" }), policy({ policyid: 2, state: "stale" })];
    const before = rows.map((p) => p.policyid);

    sortByPriority(rows);

    expect(rows.map((p) => p.policyid)).toEqual(before);
  });
});

describe("sparkline", () => {
  it("normalises against the busiest bucket", () => {
    expect(sparkline([0, 5, 10])).toEqual([0, 0.5, 1]);
  });

  // Dividing by a zero maximum yields NaN, which CSS renders as a full-height bar — turning a
  // completely idle week into the busiest-looking row on the page.
  it("renders an all-zero week as flat, not as NaN", () => {
    const out = sparkline([0, 0, 0]);
    expect(out).toEqual([0, 0, 0]);
    expect(out.some(Number.isNaN)).toBe(false);
  });

  it("returns nothing when the device sent no history", () => {
    expect(sparkline(undefined)).toEqual([]);
    expect(sparkline([])).toEqual([]);
  });
});

describe("deleteRisk", () => {
  // The page's whole purpose is clearing these two states. A warning here would be noise, and noise
  // is what teaches people to click through the warnings that matter.
  it("stays quiet for the dead rules this page exists to clean up", () => {
    expect(deleteRisk(policy({ state: "never-used", idle_days: -1 }), true)).toBeNull();
    expect(deleteRisk(policy({ state: "stale", idle_days: 120, last_used: 1 }), true)).toBeNull();
  });

  it("warns when the rule still carries traffic", () => {
    expect(deleteRisk(policy({ state: "active", idle_days: 0 }), true)).toContain("past week");
    expect(deleteRisk(policy({ state: "idle", idle_days: 30 }), true)).toContain("30 days ago");
  });

  // Zero hits on a disabled rule says "switched off", not "unwanted" — someone parked it on purpose.
  it("explains that a disabled rule's zero counters prove nothing", () => {
    expect(deleteRisk(policy({ state: "disabled", idle_days: -1 }), true)).toContain("disabled");
  });

  // Live sessions outrank the state badge: the device says traffic is matching this rule RIGHT NOW,
  // whatever the aggregate counters classified it as.
  it("warns about live sessions even on a rule classified as dead", () => {
    const risk = deleteRisk(policy({ state: "never-used", active_sessions: 4 }), true);
    expect(risk).toContain("4 live session");
  });

  // Without counters every rule decodes as never-used. Deleting on that basis is deleting at random,
  // so this outranks even a row that looks perfectly safe.
  it("overrides every other verdict when the device would not answer the counters", () => {
    const risk = deleteRisk(policy({ state: "never-used", idle_days: -1 }), false);
    expect(risk).toBeTruthy();
    expect(risk).toContain("hit count");
  });
});

describe("state and advice vocabulary", () => {
  // A row rendering "undefined" because a state has no style would look like a bug in the firewall
  // rather than a bug on the page.
  it("has a style for every state the server can send", () => {
    for (const state of ["active", "idle", "stale", "never-used", "disabled"] as const) {
      expect(STATE_STYLE[state]?.label).toBeTruthy();
      expect(STATE_STYLE[state]?.blurb).toBeTruthy();
    }
  });

  it("labels both advice values and leaves the empty one blank", () => {
    expect(ADVICE_LABEL.remove).toBeTruthy();
    expect(ADVICE_LABEL.review).toBeTruthy();
    expect(ADVICE_LABEL[""]).toBe("");
  });

  // A disabled rule reads zero hits BECAUSE it is disabled. Its wording must not suggest deletion.
  it("explains that a disabled rule's zero counters mean nothing", () => {
    expect(STATE_STYLE.disabled.blurb).toContain("Switched off");
  });
});
