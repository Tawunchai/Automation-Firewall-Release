import { describe, it, expect } from "vitest";
import {
  WIZ_BTN_TO_UNDO, REL_TO_UNDO, REL_TO_BTN, wizKey,
  WIZARD_BTN_KINDS, COMPOSITE_WIZARDS,
  type WizardBtnKind, type SingleObjectWizardKind,
} from "./undoKinds";

// Fallback (undo) can only remove an object it has a row for. A kind missing from these tables is
// silently un-undoable at runtime — the object stays on the firewall and nothing says why. The
// TypeScript Record types catch a MISSING key at build time; these tests catch the things the type
// system cannot see: a wrong value, a stale entry, or a table that quietly lost a row.

// The full set of wizard buttons, restated here on purpose. If a new wizard is added, this list has
// to be updated too — which is the moment to ask whether Fallback can actually undo it.
const ALL_WIZARD_BUTTONS: WizardBtnKind[] = [
  "policy", "antivirus", "webfilter", "dnsfilter", "virtualip", "appcontrol",
  "address", "service", "route", "schedule", "filefilter",
  "usergroup", "userdef", "ldapserver", "radiusserver",
  "sdwan", "vpn",
];

/** The buttons that build exactly one kind, which is every one that is not a declared composite. */
const SINGLE_OBJECT_BUTTONS = ALL_WIZARD_BUTTONS
  .filter((b) => !COMPOSITE_WIZARDS.has(b)) as SingleObjectWizardKind[];

describe("WIZARD_BTN_KINDS", () => {
  it("is the same set this test enumerates", () => {
    // The array exists so the starter chips and these tests can BOTH iterate the real vocabulary.
    // If they drift, a wizard can exist with no example prompt and nothing says so.
    expect([...WIZARD_BTN_KINDS].sort()).toEqual([...ALL_WIZARD_BUTTONS].sort());
  });

  it("accounts for every button, as either single-object or composite", () => {
    for (const btn of WIZARD_BTN_KINDS) {
      const single = btn in WIZ_BTN_TO_UNDO;
      const composite = COMPOSITE_WIZARDS.has(btn);
      // Neither ⇒ Fallback has no path for it and nothing would say so at build time. Both ⇒ two
      // answers to "which kind is this", and the wrong one wins silently.
      expect(single !== composite, `"${btn}" must be exactly one of single-object / composite`).toBe(true);
    }
  });

  it("declares SD-WAN a composite, because it builds four different tables", () => {
    expect(COMPOSITE_WIZARDS.has("sdwan")).toBe(true);
    expect(WIZ_BTN_TO_UNDO).not.toHaveProperty("sdwan");
  });
});

describe("WIZ_BTN_TO_UNDO", () => {
  it("has a row for every single-object wizard button", () => {
    for (const btn of SINGLE_OBJECT_BUTTONS) {
      expect(WIZ_BTN_TO_UNDO[btn], `wizard button "${btn}" has no undo kind`).toBeTruthy();
    }
    expect(Object.keys(WIZ_BTN_TO_UNDO).sort()).toEqual([...SINGLE_OBJECT_BUTTONS].sort());
  });

  it("maps button ids to the device/API category, not back to themselves", () => {
    // These are the ones where the two vocabularies genuinely differ — the whole reason two
    // separate tables exist. Getting one wrong means Fallback calls the wrong delete endpoint.
    expect(WIZ_BTN_TO_UNDO.virtualip).toBe("virtual-ip");
    expect(WIZ_BTN_TO_UNDO.appcontrol).toBe("application-control");
    expect(WIZ_BTN_TO_UNDO.filefilter).toBe("file-filter");
    expect(WIZ_BTN_TO_UNDO.route).toBe("static-route");
    expect(WIZ_BTN_TO_UNDO.userdef).toBe("user");
    expect(WIZ_BTN_TO_UNDO.usergroup).toBe("user-group");
    expect(WIZ_BTN_TO_UNDO.ldapserver).toBe("ldap-server");
    expect(WIZ_BTN_TO_UNDO.radiusserver).toBe("radius-server");
  });

  it("leaves the kinds whose names already match untouched", () => {
    for (const same of ["policy", "antivirus", "webfilter", "dnsfilter", "address", "service", "schedule"] as const) {
      expect(WIZ_BTN_TO_UNDO[same]).toBe(same);
    }
  });

  it("never maps a button to null — every wizard button creates something undoable", () => {
    for (const value of Object.values(WIZ_BTN_TO_UNDO)) {
      expect(value).not.toBeNull();
      expect(typeof value).toBe("string");
    }
  });
});

describe("REL_TO_UNDO", () => {
  it("accepts both spellings the Policy Wizard uses for a file filter", () => {
    // The wizard emits "file-filter"; the button id is "filefilter". Both must resolve, or a
    // prerequisite profile the wizard created is left behind on Fallback.
    expect(REL_TO_UNDO["file-filter"]).toBe("file-filter");
    expect(REL_TO_UNDO.filefilter).toBe("file-filter");
  });

  it("marks IPS as explicitly not undoable rather than leaving it undefined", () => {
    // null is a decision — there is no IPS delete endpoint in this app, so recording one would
    // promise a rollback Fallback cannot deliver. `undefined` would be an oversight.
    expect(REL_TO_UNDO.ips).toBeNull();
    expect("ips" in REL_TO_UNDO).toBe(true);
  });

  it("maps every other created-object kind to a real undo kind", () => {
    for (const [kind, undo] of Object.entries(REL_TO_UNDO)) {
      if (kind === "ips") continue;
      expect(undo, `created-object kind "${kind}" resolves to ${undo}`).toBeTruthy();
    }
  });

  it("agrees with WIZ_BTN_TO_UNDO wherever the two tables overlap", () => {
    // The same object reached through a wizard button and through the Policy Wizard's
    // prerequisite list must be deleted the same way.
    const overlap: [keyof typeof REL_TO_UNDO, SingleObjectWizardKind][] = [
      ["address", "address"], ["service", "service"], ["schedule", "schedule"],
      ["virtualip", "virtualip"], ["antivirus", "antivirus"], ["webfilter", "webfilter"],
      ["dnsfilter", "dnsfilter"], ["appcontrol", "appcontrol"], ["filefilter", "filefilter"],
    ];
    for (const [relKind, btnKind] of overlap) {
      expect(REL_TO_UNDO[relKind], `mismatch for ${relKind}/${btnKind}`)
        .toBe(WIZ_BTN_TO_UNDO[btnKind]);
    }
  });
});

describe("REL_TO_BTN", () => {
  it("normalises the one kind whose wizard name differs from its button id", () => {
    expect(REL_TO_BTN["file-filter"]).toBe("filefilter");
  });

  it("leaves every other kind alone, so callers fall back to the kind itself", () => {
    // A Partial map on purpose: only the mismatches belong here. Adding identity entries would
    // invite them to drift out of sync with REL_TO_UNDO.
    expect(Object.keys(REL_TO_BTN)).toEqual(["file-filter"]);
    expect(REL_TO_BTN.address).toBeUndefined();
  });

  it("points at a real wizard button", () => {
    for (const btn of Object.values(REL_TO_BTN)) {
      expect(ALL_WIZARD_BUTTONS).toContain(btn);
    }
  });
});

describe("wizKey", () => {
  it("is stable for the same message and kind", () => {
    expect(wizKey(3, "policy")).toBe(wizKey(3, "policy"));
  });

  it("distinguishes messages and kinds", () => {
    expect(wizKey(0, "policy")).not.toBe(wizKey(1, "policy"));
    expect(wizKey(0, "policy")).not.toBe(wizKey(0, "address"));
  });

  it("does not collide across the index/kind boundary", () => {
    // "1:2policy" vs "12:policy" would be the classic failure of naive concatenation.
    expect(wizKey(1, "2policy")).not.toBe(wizKey(12, "policy"));
  });
});

// The reason this module exists at all: these tables used to be rebuilt inside the AI Assistant
// component on every render, and that component re-renders every 80ms for the ~30s an answer
// streams in. At module scope they are built once and keep a stable identity.
describe("module-scope identity", () => {
  it("keeps the same object identity across imports", async () => {
    const again = await import("./undoKinds");
    expect(again.WIZ_BTN_TO_UNDO).toBe(WIZ_BTN_TO_UNDO);
    expect(again.REL_TO_UNDO).toBe(REL_TO_UNDO);
    expect(again.REL_TO_BTN).toBe(REL_TO_BTN);
    expect(again.wizKey).toBe(wizKey);
  });
});
