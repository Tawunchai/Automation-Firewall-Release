import { describe, expect, it } from "vitest";
import { EXAMPLE_PROMPTS, promptOf, type ExampleKind } from "./examplePrompts";
import { WIZARD_BTN_KINDS, type WizardBtnKind } from "./undoKinds";

// The starter chips are a claim about what this assistant can do, and the claim used to be wrong
// twice over: SSL VPN / DHCP / SD-WAN were offered although none of them can be applied
// object-by-object, and half the rest were phrased so loosely that the model answered with a list
// of questions instead of any config at all.
//
// These tests are what stops both happening again — the first by pinning every example to the REAL
// wizard vocabulary (undoKinds.WIZARD_BTN_KINDS, the list every wizard button must appear in), in
// BOTH directions; the second by requiring each config prompt to carry something concrete.
//
// SD-WAN moved from the forbidden list to the covered one when it gained a parser, a wizard and a
// REST apply path. That move is the whole point of driving both halves off one vocabulary: the day
// the capability landed, the test told us the starter chip was missing.

const ALL_WIZARDS = [...WIZARD_BTN_KINDS] as WizardBtnKind[];
const SUPPORTED: ExampleKind[] = [...ALL_WIZARDS, "vpn", "query"];

describe("example prompts", () => {
  it("only offers things this app can actually build", () => {
    for (const p of EXAMPLE_PROMPTS) {
      expect(SUPPORTED, `example "${p.label}" claims kind "${p.kind}"`).toContain(p.kind);
    }
  });

  it("offers an example for every wizard, so nothing capable stays hidden", () => {
    const covered = new Set(EXAMPLE_PROMPTS.map((p) => p.kind));
    for (const kind of ALL_WIZARDS) {
      expect(covered.has(kind), `no starter prompt exercises the "${kind}" wizard`).toBe(true);
    }
  });

  it("names no feature the app has no path for", () => {
    // A belt-and-braces check on the TEXT, because the kind tag is written by hand: these are the
    // FortiOS features the model answers happily and this console cannot apply object-by-object.
    // If one of them ever gains a wizard, delete it from here in the same commit.
    const UNSUPPORTED = [
      /ssl\s*vpn/i,
      /dhcp/i,
      /\bips\b/i,          // no IPS sensor wizard — REL_TO_UNDO maps "ips" to null
      /\bha\b|high.avail/i,
      /fortitoken|fortiguard\s+licen/i,
    ];
    for (const p of EXAMPLE_PROMPTS) {
      for (const re of UNSUPPORTED) {
        const text = `${p.label} ${promptOf(p)}`;
        expect(re.test(text), `example "${p.label}" mentions an unsupported feature`).toBe(false);
      }
    }
  });

  it("never suggests deleting anything", () => {
    // A delete cannot go through the REST appliers at all (hasDestructiveStatement forces the SSH
    // path), and Fallback cannot undo it — not something to put in front of a new user.
    for (const p of EXAMPLE_PROMPTS) {
      expect(/\bลบ\b|\bdelete\b|\bremove\b|\bunset\b/i.test(promptOf(p)), p.label).toBe(false);
    }
  });

  it("keeps every chip short, whatever the prompt behind it says", () => {
    // The whole reason label and prompt are separate fields: the chip stays readable in a wrapped
    // row while the prompt stays specific enough to build from.
    for (const p of EXAMPLE_PROMPTS) {
      expect(p.label.length, `"${p.label}" is too long for a chip`).toBeLessThanOrEqual(30);
      expect(p.label.trim()).toBe(p.label);
      expect(promptOf(p).trim()).toBe(promptOf(p));
    }
  });

  it("gives every config example something concrete to work with", () => {
    // The failure this catches is the one that shipped: a prompt with no value in it ("เพิ่ม
    // address object subnet") comes back as a list of questions. A config prompt must name at
    // least an address, a port, a time or a subject the model can build from.
    //
    // One honest exception: an object whose defaults ARE the answer. An AntiVirus profile scans
    // every protocol and blocks what it finds, so there is nothing to ask about — verified live.
    const SELF_CONTAINED = new Set(["Create an AntiVirus profile"]);
    const CONCRETE = [
      /\d{1,3}(\.\d{1,3}){3}/,                     // an IP or subnet
      /\b\d{2,5}\b/,                               // a port or a time
      /→/,                                         // "A → B", a direction with both ends named
      /facebook|youtube|tiktok|instagram|\.exe/i,  // a named thing to block
      /somchai|staff|FortiClient/i,
    ];
    for (const p of EXAMPLE_PROMPTS) {
      if (p.kind === "query") continue; // a query needs no parameters — the device has the answer
      if (SELF_CONTAINED.has(promptOf(p))) continue;
      expect(
        CONCRETE.some((re) => re.test(promptOf(p))),
        `example "${p.label}" is too vague — the model will ask for details instead of building`,
      ).toBe(true);
    }
  });

  it("has no duplicate labels or prompts", () => {
    const labels = EXAMPLE_PROMPTS.map((p) => p.label);
    expect(new Set(labels).size).toBe(labels.length);
    const prompts = EXAMPLE_PROMPTS.map(promptOf);
    expect(new Set(prompts).size).toBe(prompts.length);
  });

  it("keeps the read-only examples last, after everything that writes", () => {
    // The config chips are styled as writes; a query mixed in among them would misrepresent what
    // pressing it does.
    const firstQuery = EXAMPLE_PROMPTS.findIndex((p) => p.kind === "query");
    expect(firstQuery).toBeGreaterThan(0);
    expect(EXAMPLE_PROMPTS.slice(firstQuery).every((p) => p.kind === "query")).toBe(true);
  });

  it("stays a sample, not a catalogue", () => {
    // The screen it fills is ~400px tall. The list grew to 23 once and read as a wall.
    //
    // The ceiling moves only when a genuinely new CAPABILITY lands — the SD-WAN chip took it from
    // 21 to 22 — and never to squeeze in a second phrasing of something already covered. If it ever
    // needs to go past ~24, the answer is a scrolling drawer, not a taller wall.
    expect(EXAMPLE_PROMPTS.length).toBeLessThanOrEqual(22);
  });
});
