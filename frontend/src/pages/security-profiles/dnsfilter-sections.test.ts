import { describe, it, expect } from "vitest";
import { dnsPresetCategories, dnsActivePreset, DNS_ACTIONS, redirectPortalField } from "./dnsfilter-sections.logic";
import { EMPTY_DNSFILTER_FORM } from "./dnsfilter-form.logic";
import type { WebFilterCategoryMeta, DNSFilterAction, DNSFilterProfileForm } from "../../api/policyObject";

// The taxonomy shape the device really returns (verified live on FortiGate 7.2.10 —
// /api/v2/monitor/webfilter/fortiguard-categories: 93 categories, each carrying
// blocked_in_ratings). The nesting below mirrors the real counts: G blocks 39, PG-13 blocks
// 33 and R blocks 6, i.e. each rating blocks a SUBSET of the stricter one above it.
const cats: WebFilterCategoryMeta[] = [
  { id: 1, name: "Drug Abuse",   group: "Potentially Liable",   group_id: 1, blocked_in_ratings: ["G", "PG-13"] },
  { id: 2, name: "Pornography",  group: "Adult/Mature Content", group_id: 2, blocked_in_ratings: ["G", "PG-13"] },
  { id: 3, name: "Malicious",    group: "Security Risk",        group_id: 4, blocked_in_ratings: ["G", "PG-13", "R"] },
  { id: 4, name: "Advertising",  group: "General Interest - Personal", group_id: 5, blocked_in_ratings: ["G"] },
  { id: 5, name: "Search Engines", group: "General Interest - Personal", group_id: 5, blocked_in_ratings: [] },
  { id: 6, name: "Unrated",      group: "Unrated",              group_id: 7 }, // no blocked_in_ratings key at all
];

const actionOfFrom = (rows: { category: number; action: DNSFilterAction }[]) => {
  const m = new Map(rows.map((r) => [r.category, r.action] as const));
  return (id: number): DNSFilterAction => m.get(id) ?? "allow";
};

describe("dnsPresetCategories", () => {
  // FortiOS's own blank "New DNS Filter Profile" shows every category on Monitor (all 15
  // Adult/Mature Content rows read "Monitor") — unlike the Web Filter form, whose Custom
  // preset uses each category's FortiGuard default.
  it("Custom puts every category on Monitor", () => {
    const rows = dnsPresetCategories(cats, "custom");
    expect(rows).toHaveLength(cats.length);
    expect(rows.every((r) => r.action === "monitor")).toBe(true);
    expect(rows.map((r) => r.category).sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("G blocks exactly the categories rated G and allows the rest by omission", () => {
    const rows = dnsPresetCategories(cats, "G");
    expect(rows).toEqual([
      { category: 1, action: "block" },
      { category: 2, action: "block" },
      { category: 3, action: "block" },
      { category: 4, action: "block" },
    ]);
    // 5 (nothing blocks it) and 6 (no ratings key at all) are ALLOWED, i.e. simply absent.
    expect(rows.find((r) => r.category === 5)).toBeUndefined();
    expect(rows.find((r) => r.category === 6)).toBeUndefined();
  });

  it("PG-13 is a subset of G", () => {
    const g = dnsPresetCategories(cats, "G").map((r) => r.category);
    const pg = dnsPresetCategories(cats, "PG-13").map((r) => r.category);
    expect(pg).toEqual([1, 2, 3]);
    expect(g).toEqual(expect.arrayContaining(pg));
    expect(g.length).toBeGreaterThan(pg.length);
  });

  it("R blocks only what R blocks — matching the GUI, where Adult/Mature reads Allow under R", () => {
    const rows = dnsPresetCategories(cats, "R");
    expect(rows).toEqual([{ category: 3, action: "block" }]);
    expect(actionOfFrom(rows)(2)).toBe("allow"); // Pornography allowed under R, as in the GUI
  });

  // The whole point of the encoding: an allowed category must never be written as a row.
  // FortiOS answers 200 to action="allow" and silently stores "block" instead.
  it("never emits an allow row for any preset", () => {
    for (const p of ["custom", "G", "PG-13", "R"] as const) {
      expect(dnsPresetCategories(cats, p).some((r) => r.action === "allow")).toBe(false);
    }
  });

  it("survives an empty taxonomy (device unreachable / unlicensed)", () => {
    expect(dnsPresetCategories([], "custom")).toEqual([]);
    expect(dnsPresetCategories([], "G")).toEqual([]);
  });
});

describe("dnsActivePreset", () => {
  it("detects each rating preset from the current selection", () => {
    for (const p of ["G", "PG-13", "R"] as const) {
      expect(dnsActivePreset(cats, actionOfFrom(dnsPresetCategories(cats, p)))).toBe(p);
    }
  });

  it("reports custom for the all-Monitor default", () => {
    expect(dnsActivePreset(cats, actionOfFrom(dnsPresetCategories(cats, "custom")))).toBe("custom");
  });

  it("reports custom once a rating preset is hand-edited", () => {
    const rows = dnsPresetCategories(cats, "G");
    rows[0].action = "monitor"; // user downgrades one category
    expect(dnsActivePreset(cats, actionOfFrom(rows))).toBe("custom");
  });

  it("reports custom with no categories loaded rather than claiming a preset", () => {
    expect(dnsActivePreset([], () => "allow")).toBe("custom");
  });

  // Two ratings that block an identical set are indistinguishable from the selection alone, so
  // detection is order-dependent and the strictest (G) wins. That cannot happen on a real
  // device — the ratings nest (39 / 33 / 6) — but a taxonomy without blocked_in_ratings makes
  // every preset block nothing, and G must not be reported for what is really "allow all".
  it("does not claim a rating preset when the taxonomy carries no ratings", () => {
    const unrated: WebFilterCategoryMeta[] = [
      { id: 1, name: "A", group: "Unrated", group_id: 7 },
      { id: 2, name: "B", group: "Unrated", group_id: 7 },
    ];
    // Every category allowed. G/PG-13/R would each block nothing here, so all three "match" —
    // this pins which one wins so the button highlight can never silently change.
    expect(dnsActivePreset(unrated, () => "allow")).toBe("G");
  });
});

describe("redirectPortalField", () => {
  const form = (over: Partial<DNSFilterProfileForm>): DNSFilterProfileForm =>
    ({ ...EMPTY_DNSFILTER_FORM, ...over });

  // "Use FortiGuard Default": greyed out, not editable, 0.0.0.0 shown as a PLACEHOLDER — that is
  // the value FortiOS stores to mean "default", so it belongs here as a hint, not as a value.
  it("Use FortiGuard Default → disabled, empty value, 0.0.0.0 placeholder", () => {
    expect(redirectPortalField(form({ use_default_redirect_portal: true }))).toEqual({
      value: "", placeholder: "0.0.0.0", disabled: true,
    });
  });

  // "Specify": an EMPTY, editable box with NO placeholder. A lingering 0.0.0.0 hint reads as
  // "already filled in" when the field is in fact empty and required.
  it("Specify → enabled, empty box, NO placeholder", () => {
    expect(redirectPortalField(form({ use_default_redirect_portal: false, redirect_portal_ip: "" }))).toEqual({
      value: "", placeholder: "", disabled: false,
    });
  });

  it("Specify shows the IP the user typed, still with no placeholder", () => {
    expect(redirectPortalField(form({ use_default_redirect_portal: false, redirect_portal_ip: "10.0.0.9" }))).toEqual({
      value: "10.0.0.9", placeholder: "", disabled: false,
    });
  });

  // Switching back to Default must not show a stale IP as if it were still in force.
  it("Default hides a previously typed IP rather than showing it greyed out", () => {
    const f = redirectPortalField(form({ use_default_redirect_portal: true, redirect_portal_ip: "10.0.0.9" }));
    expect(f.value).toBe("");
    expect(f.disabled).toBe(true);
  });
});

describe("DNS_ACTIONS", () => {
  // The DNS filter has no plain "Block": the GUI calls it "Redirect to Block Portal", and the
  // CMDB value behind that label is "block".
  it("labels block as Redirect to Block Portal", () => {
    expect(DNS_ACTIONS.map((a) => a.value)).toEqual(["allow", "monitor", "block"]);
    expect(DNS_ACTIONS.find((a) => a.value === "block")?.label).toBe("Redirect to Block Portal");
  });
});
