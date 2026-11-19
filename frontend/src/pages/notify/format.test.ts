import { describe, expect, it } from "vitest";
import {
  agoText, cooldownText, deliveryText, groupKinds, muteReason, scopeText, sustainText, thresholdText,
} from "./format";
import type { NotifyChannel, NotifyKindInfo, NotifyRule } from "../../api/notify";

const rule = (over: Partial<NotifyRule> = {}): NotifyRule => ({
  id: 1, name: "CPU", kind: "cpu-peak", enabled: true,
  network_device_id: 0, device_name: "All devices",
  subjects: "", threshold: 85, sustained_polls: 2, cooldown_minutes: 30,
  notify_on_resolve: true, severity: "warning",
  recipient_ids: [], recipients: [], firing: 0, created_at: "",
  ...over,
});

const channel = (over: Partial<NotifyChannel> = {}): NotifyChannel => ({
  id: 1, name: "Ops LINE", type: "line", enabled: true, description: "", has_token: true,
  last_tested_at: null, last_test_status: "", last_test_error: "",
  recipient_count: 0, recipients: [], created_at: "",
  ...over,
});

const recipient = (over: Partial<NotifyRule["recipients"][number]> = {}) => ({
  id: 1, notify_channel_id: 1, channel_name: "Ops LINE", channel_type: "line" as const,
  name: "NOC", target: "U0123456789abcdef0123456789abcdef", is_group: false, enabled: true,
  ...over,
});

// ── how long before it fires ─────────────────────────────────────────────────

describe("sustainText", () => {
  // The whole reason the sustain setting exists is to separate a spike from a problem, so the form
  // has to say how long it actually delays the alert. "2 polls" alone tells nobody anything.
  it("spells the delay out in real time, not in polls", () => {
    expect(sustainText(2, 60)).toContain("2 min");
    expect(sustainText(5, 60)).toContain("5 min");
  });

  it("says 'first check' rather than '1 check (60s)' for an immediate rule", () => {
    expect(sustainText(1, 60)).toBe("fires on the first check");
    expect(sustainText(0, 60)).toBe("fires on the first check");
  });

  it("keeps seconds for anything under two minutes", () => {
    expect(sustainText(1.5 as unknown as number, 60)).toBeTruthy();
    expect(sustainText(2, 30)).toContain("60s");
  });
});

describe("cooldownText", () => {
  it("names zero as 'every check' rather than 'every 0 min'", () => {
    expect(cooldownText(0)).toBe("repeats every check");
  });

  it("switches to hours once minutes stop reading well", () => {
    expect(cooldownText(30)).toContain("30 min");
    expect(cooldownText(120)).toContain("2 h");
    expect(cooldownText(90)).toContain("1.5 h");
  });
});

// ── the rule row ─────────────────────────────────────────────────────────────

describe("thresholdText", () => {
  const cpu: NotifyKindInfo = {
    kind: "cpu-peak", title: "CPU Peak", family: "resource", description: "",
    has_threshold: true, threshold_unit: "%", has_subjects: false, default_severity: "warning",
  };
  const link: NotifyKindInfo = {
    kind: "interface-link", title: "Port Up / Down", family: "link", description: "",
    has_threshold: false, has_subjects: true, default_severity: "critical",
  };

  it("carries the unit the kind measures in", () => {
    expect(thresholdText(rule({ threshold: 85 }), cpu)).toBe("≥ 85%");
    expect(thresholdText(rule({ threshold: 20000 }), {
      ...cpu, threshold_unit: "sessions",
    })).toBe("≥ 20000 sessions");
  });

  // A state kind has no threshold. Rendering "≥ 0%" would read as "always firing".
  it("shows a dash for a kind with no threshold", () => {
    expect(thresholdText(rule({ threshold: 0 }), link)).toBe("—");
    expect(thresholdText(rule(), undefined)).toBe("—");
  });
});

describe("scopeText", () => {
  it("says 'every device' for a fleet-wide rule", () => {
    expect(scopeText(rule({ network_device_id: 0 }))).toBe("every device");
  });

  it("names the device and the ports when both are narrowed", () => {
    const got = scopeText(rule({ network_device_id: 1, device_name: "FGT-LAB (10.0.99.201)", subjects: "port1,port2" }));
    expect(got).toContain("FGT-LAB");
    expect(got).toContain("port1,port2");
  });
});

// ── the one that matters most ────────────────────────────────────────────────

describe("muteReason", () => {
  // A rule can be enabled, correct and completely mute. There is no other moment when anyone would
  // find that out, so the list says it rather than showing a green tick.
  it("flags a rule with no recipient at all", () => {
    expect(muteReason(rule(), [channel()])).toContain("reach nobody");
  });

  it("flags a rule whose recipients are all switched off", () => {
    const r = rule({ recipients: [recipient({ enabled: false })] });
    expect(muteReason(r, [channel()])).toContain("reach nobody");
  });

  it("flags a rule whose only channel is switched off", () => {
    const r = rule({ recipients: [recipient()] });
    expect(muteReason(r, [channel({ enabled: false })])).toContain("reach nobody");
  });

  it("flags a LINE channel that has never been given a token", () => {
    const r = rule({ recipients: [recipient()] });
    expect(muteReason(r, [channel({ has_token: false })])).toContain("access token");
  });

  it("says nothing when the rule would actually deliver", () => {
    const r = rule({ recipients: [recipient()] });
    expect(muteReason(r, [channel()])).toBe("");
  });

  // A disabled rule is silent on purpose. Warning about it would train people to ignore the warning.
  it("says nothing about a rule that is deliberately turned off", () => {
    expect(muteReason(rule({ enabled: false }), [channel()])).toBe("");
  });

  it("stays quiet when at least one recipient can still be reached", () => {
    const r = rule({
      recipients: [recipient({ id: 1, notify_channel_id: 1 }), recipient({ id: 2, notify_channel_id: 2, channel_type: "email" })],
    });
    const channels = [channel({ id: 1, has_token: false }), channel({ id: 2, type: "email" })];
    expect(muteReason(r, channels)).toBe("");
  });
});

// ── history ──────────────────────────────────────────────────────────────────

describe("deliveryText", () => {
  it("distinguishes a partial send from a clean one", () => {
    expect(deliveryText("sent", 3, 0)).toBe("sent to 3");
    expect(deliveryText("partial", 2, 1)).toBe("2 sent, 1 failed");
    expect(deliveryText("failed", 0, 3)).toBe("failed (3)");
    expect(deliveryText("no-recipients", 0, 0)).toBe("no recipients");
  });
});

describe("agoText", () => {
  const now = new Date("2026-08-17T12:00:00Z");

  it("counts up through the units", () => {
    expect(agoText("2026-08-17T11:59:30Z", now)).toBe("just now");
    expect(agoText("2026-08-17T11:45:00Z", now)).toBe("15m ago");
    expect(agoText("2026-08-17T09:00:00Z", now)).toBe("3h ago");
    expect(agoText("2026-08-15T12:00:00Z", now)).toBe("2d ago");
  });

  it("does not produce a negative age from a clock skew", () => {
    expect(agoText("2026-08-17T12:05:00Z", now)).toBe("just now");
  });

  it("degrades to a dash on an unparseable timestamp", () => {
    expect(agoText("not a date", now)).toBe("—");
  });
});

describe("groupKinds", () => {
  it("splits the catalogue into the two families, in a fixed order", () => {
    const kinds: NotifyKindInfo[] = [
      { kind: "cpu-peak", title: "CPU Peak", family: "resource", description: "", has_threshold: true, has_subjects: false, default_severity: "warning" },
      { kind: "interface-link", title: "Port", family: "link", description: "", has_threshold: false, has_subjects: true, default_severity: "critical" },
    ];

    const groups = groupKinds(kinds);

    expect(groups[0].title).toBe("Link & reachability");
    expect(groups[0].kinds.map((k) => k.kind)).toEqual(["interface-link"]);
    expect(groups[1].kinds.map((k) => k.kind)).toEqual(["cpu-peak"]);
  });
});
