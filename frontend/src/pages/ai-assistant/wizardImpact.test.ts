import { describe, expect, it } from "vitest";
import { BLANK_POLICY_FORM, type PolicyFormState } from "../firewall-policy/create.logic";
import { objectApplyImpact, policyApplyImpact } from "./wizardImpact";

// The wizards' Apply confirmation.
//
// The chat's dialog and this one answer the same question from different evidence, and the thing
// this one must never get wrong is CREATE vs OVERWRITE. A wizard opens in edit mode whenever the
// name already exists on the device, and at that point Apply is writing over live configuration
// that other rules may be using right now. Every test below defends some part of saying that out
// loud.

const policyForm = (over: Partial<PolicyFormState> = {}): PolicyFormState => ({
  ...BLANK_POLICY_FORM,
  name: "LAN-to-WAN",
  srcIntf: "lan",
  dstIntf: "port1",
  srcAddr: ["LAN-Network"],
  dstAddr: ["all"],
  service: ["HTTPS"],
  ...over,
});

describe("objectApplyImpact — create", () => {
  it("lists the object, its identifying value, and what it does not do yet", () => {
    const impact = objectApplyImpact({
      kind: "address", label: "Address", name: "LAN-Network", isEdit: false,
      facts: ["ipmask: 192.168.1.0/24"],
    });

    expect(impact.mode).toBe("create");
    expect(impact.objects).toEqual([{ kind: "address", label: "Address", name: "LAN-Network" }]);
    expect(impact.effects[0]).toContain("Creates");
    expect(impact.effects).toContain("ipmask: 192.168.1.0/24");
    // An address nothing references changes no traffic — the dialog says so rather than letting
    // "Address created" read as "the rule is in place".
    expect(impact.effects.join(" ")).toContain("policy");
  });

  it("states that the wizard already checked the name is free", () => {
    const impact = objectApplyImpact({ kind: "service", label: "Service", name: "App-9000", isEdit: false });
    expect(impact.note).toContain("creates a new one");
    expect(impact.warnings).toEqual([]);
  });

  it("carries the wizard's own warnings through", () => {
    const impact = objectApplyImpact({
      kind: "webfilter", label: "Web Filter", name: "WF-Guest", isEdit: false,
      warnings: ["This device has no FortiGuard Web Filter licence"],
    });
    expect(impact.warnings).toContain("This device has no FortiGuard Web Filter licence");
  });
});

describe("objectApplyImpact — edit", () => {
  // The dangerous case. Nothing else on the wizard screen says the object is already in production.
  it("says it is overwriting, and that live policies pick the change up immediately", () => {
    const impact = objectApplyImpact({
      kind: "antivirus", label: "AntiVirus", name: "AV-Office", isEdit: true,
    });

    expect(impact.mode).toBe("edit");
    expect(impact.effects[0]).toContain("Overwrites");
    expect(impact.warnings.some((w) => w.includes("policy") && w.includes("AV-Office"))).toBe(true);
    expect(impact.note).toContain("overwrites");
  });

  // "This does nothing until a policy references it" is true of a NEW object. On an edit the object
  // may be referenced by a live rule this second, which is the opposite claim.
  it("drops the not-referenced-yet line on an edit", () => {
    const impact = objectApplyImpact({
      kind: "antivirus", label: "AntiVirus", name: "AV-Office", isEdit: true,
    });
    expect(impact.effects.join(" ")).not.toContain("until a policy references");
  });
});

describe("policyApplyImpact", () => {
  it("lists the prerequisites before the policy, in creation order", () => {
    const impact = policyApplyImpact({
      form: policyForm(),
      isEdit: false,
      prerequisites: [
        { kind: "address", label: "Address", name: "LAN-Network" },
        { kind: "service", label: "Service", name: "App-9000" },
      ],
      placement: { beforeName: null },
    });

    // The policy is LAST: Apply builds everything it references first, and the dialog reads in the
    // order the device is written to.
    expect(impact.objects.map((o) => o.name)).toEqual(["LAN-Network", "App-9000", "LAN-to-WAN"]);
    expect(impact.objects[2].kind).toBe("policy");
  });

  it("warns that prerequisites survive a failed policy create", () => {
    const impact = policyApplyImpact({
      form: policyForm(),
      isEdit: false,
      prerequisites: [{ kind: "address", label: "Address", name: "LAN-Network" }],
      placement: { beforeName: null },
    });
    expect(impact.warnings.some((w) => w.includes("Fallback"))).toBe(true);
  });

  it("says nothing about prerequisites when there are none", () => {
    const impact = policyApplyImpact({
      form: policyForm(), isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.objects).toHaveLength(1);
    expect(impact.warnings.some((w) => w.includes("Fallback"))).toBe(false);
  });

  // First match wins, so position is not a detail — it decides whether the rule ever runs.
  it("names the policy this rule will sit above", () => {
    const impact = policyApplyImpact({
      form: policyForm(), isEdit: false, prerequisites: [],
      placement: { beforeName: "Block-FB-YT" },
    });
    expect(impact.warnings.some((w) => w.includes("Block-FB-YT") && w.includes("above"))).toBe(true);
  });

  it("warns about shadowing when the rule goes to the bottom", () => {
    const impact = policyApplyImpact({
      form: policyForm(), isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.warnings.some((w) => w.includes("bottom"))).toBe(true);
  });

  it("reuses the shared policy vocabulary for the traffic line", () => {
    const impact = policyApplyImpact({
      form: policyForm({ nat: true }), isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    const line = impact.effects.join(" | ");
    expect(line).toContain("Allows");
    expect(line).toContain("LAN-Network");
    expect(line).toContain("HTTPS");
    expect(line).toContain("NAT");
  });

  // The wizard keeps the profile NAME in the form after its toggle is switched off, and
  // buildPolicyPayload sends "" in that case. Listing the name anyway would show an inspected
  // policy for traffic that is about to leave uninspected.
  it("ignores a profile whose toggle is off, exactly as the write does", () => {
    const impact = policyApplyImpact({
      form: policyForm({ avEnabled: false, avProfile: "default" }),
      isEdit: false, prerequisites: [], placement: { beforeName: null },
    });

    expect(impact.policies[0].profiles).toEqual([]);
    expect(impact.policies[0].uninspected).toBe(true);
    expect(impact.warnings.some((w) => w.includes("no security profile"))).toBe(true);
  });

  it("lists a profile whose toggle is on", () => {
    const impact = policyApplyImpact({
      form: policyForm({ avEnabled: true, avProfile: "default" }),
      isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.policies[0].profiles).toEqual(["AntiVirus: default"]);
    expect(impact.policies[0].uninspected).toBe(false);
  });

  // A deny runs no UTM at all — FortiOS drops the traffic, so an attached profile inspects nothing.
  it("attaches no profile to a deny policy", () => {
    const impact = policyApplyImpact({
      form: policyForm({ action: "deny", avEnabled: true, avProfile: "default" }),
      isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.policies[0].profiles).toEqual([]);
    // …and a deny is not "uninspected" either — there is nothing to inspect.
    expect(impact.policies[0].uninspected).toBe(false);
  });

  it("inherits the wide-open and uninspected warnings from the shared policy check", () => {
    const impact = policyApplyImpact({
      form: policyForm({ srcAddr: ["all"], dstAddr: ["all"], service: ["ALL"] }),
      isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.policies[0].wideOpen).toBe(true);
    expect(impact.warnings.some((w) => w.includes("wide open"))).toBe(true);
    expect(impact.warnings.some((w) => w.includes("no security profile"))).toBe(true);
  });

  // A rule created disabled enforces nothing. Letting the dialog imply otherwise would send someone
  // hunting for why "the policy I just made" is not blocking anything.
  it("says a disabled policy will not affect traffic", () => {
    const impact = policyApplyImpact({
      form: policyForm({ enabled: false }), isEdit: false, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.effects.join(" ")).toContain("disable");
  });

  it("switches to edit wording when the policy already exists", () => {
    const impact = policyApplyImpact({
      form: policyForm(), isEdit: true, prerequisites: [], placement: { beforeName: null },
    });
    expect(impact.mode).toBe("edit");
    expect(impact.effects[0]).toContain("Edits");
    expect(impact.note).toContain("edits it");
  });

  it("explains a locked placement instead of leaving the greyed board unexplained", () => {
    const impact = policyApplyImpact({
      form: policyForm(), isEdit: false, prerequisites: [],
      placement: { beforeName: null, locked: true },
    });
    expect(impact.warnings.some((w) => w.includes("locked"))).toBe(true);
  });
});
