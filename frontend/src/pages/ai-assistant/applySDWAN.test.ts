import { describe, it, expect, vi, beforeEach } from "vitest";

// The SD-WAN half of Apply, with the device layer mocked.
//
// One behaviour is worth the whole file: **the sequence-number handover.** A member's mkey is a
// number the firewall assigns, and the health checks and rules in the same proposal point at it.
// The AI writes the numbers from its own draft, and on a firewall that already has members those
// numbers belong to somebody else's interfaces — which the device resolves without complaint. The
// tests below run the plan end to end and assert on the bodies that actually reach the API, because
// that is the only place the mistake would show.

const getSDWAN = vi.fn();
const listHealth = vi.fn();
const listRules = vi.fn();
const createZone = vi.fn();
const createMember = vi.fn();
const createHealth = vi.fn();
const createRule = vi.fn();

// A PARTIAL mock: only the device calls are replaced, because the parser imported below reads real
// constants from the same module at import time.
vi.mock("../../api/policyObject", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  DeviceGetSDWAN: (...a: unknown[]) => getSDWAN(...a),
  DeviceListSDWANHealthChecks: (...a: unknown[]) => listHealth(...a),
  DeviceListSDWANRules: (...a: unknown[]) => listRules(...a),
  DeviceCreateSDWANZone: (...a: unknown[]) => createZone(...a),
  DeviceCreateSDWANMember: (...a: unknown[]) => createMember(...a),
  DeviceCreateSDWANHealthCheck: (...a: unknown[]) => createHealth(...a),
  DeviceCreateSDWANRule: (...a: unknown[]) => createRule(...a),
}));

const { planSDWANSteps, runSDWANSteps, sdwanBlockers, policyInterfaceUse } = await import("./applySDWAN");
const { parseSDWANFromCLI } = await import("./parseSDWANCLI");

const CLI = `
config system sdwan
    set status enable
    config zone
        edit "SDWAN_Internet"
        next
    end
    config members
        edit 1
            set interface "wan1"
            set zone "SDWAN_Internet"
            set gateway 203.0.113.254
        next
        edit 2
            set interface "wan2"
            set zone "SDWAN_Internet"
            set gateway 203.0.114.254
        next
    end
    config health-check
        edit "HC_Internet"
            set server "1.1.1.1"
            set members 1 2
            config sla
                edit 1
                    set latency-threshold 250
                next
            end
        next
    end
    config service
        edit 1
            set name "Steer_Web"
            set mode sla
            set dst "all"
            set priority-members 1 2
            config sla
                edit "HC_Internet"
                    set id 1
                next
            end
        next
    end
end`;

const parsed = () => parseSDWANFromCLI(CLI)!;

/** An empty firewall: no SD-WAN objects at all. */
const emptyDevice = () => {
  getSDWAN.mockResolvedValue({ enabled: false, load_balance_mode: "", zones: [], members: [] });
  listHealth.mockResolvedValue([]);
  listRules.mockResolvedValue({ rules: [], implicit: { name: "sd-wan", criteria: "", mode: "" } });
};

beforeEach(() => {
  vi.clearAllMocks();
  createZone.mockResolvedValue(undefined);
  createMember.mockResolvedValue(undefined);
  createHealth.mockResolvedValue(undefined);
  createRule.mockResolvedValue(undefined);
});

describe("the plan", () => {
  it("walks the four tables in dependency order", async () => {
    emptyDevice();
    const steps = await planSDWANSteps(1, parsed());
    expect(steps.map((s) => s.kind)).toEqual([
      "sdwan-zone", "sdwan-member", "sdwan-member", "sdwan-health-check", "sdwan-rule",
    ]);
    expect(steps.every((s) => s.action === "create")).toBe(true);
  });

  it("skips what the device already has instead of proposing a duplicate", async () => {
    // A duplicate name is -5, and an interface can only be an SD-WAN member once.
    getSDWAN.mockResolvedValue({
      enabled: true, load_balance_mode: "",
      zones: [{ name: "SDWAN_Internet", service_sla_tie_break: "", member_count: 1 }],
      members: [{ seq_num: 7, interface: "wan1", zone: "SDWAN_Internet" }],
    });
    listHealth.mockResolvedValue([{ name: "HC_Internet" }]);
    listRules.mockResolvedValue({ rules: [{ id: 3, name: "Steer_Web" }], implicit: {} });

    const steps = await planSDWANSteps(1, parsed());
    const byName = Object.fromEntries(steps.map((s) => [`${s.kind}:${s.name}`, s.action]));
    expect(byName["sdwan-zone:SDWAN_Internet"]).toBe("skip");
    expect(byName["sdwan-member:wan1"]).toBe("skip");
    expect(byName["sdwan-member:wan2"]).toBe("create");
    expect(byName["sdwan-health-check:HC_Internet"]).toBe("skip");
    expect(byName["sdwan-rule:Steer_Web"]).toBe("skip");
  });

  it("identifies a member by its interface, not by the number the AI gave it", async () => {
    // The proposal calls wan1 "member 1"; the firewall calls it member 7. Matching on the number
    // would plan a create for an interface that is already a member — which is a refusal.
    getSDWAN.mockResolvedValue({
      enabled: true, load_balance_mode: "",
      zones: [{ name: "SDWAN_Internet", service_sla_tie_break: "", member_count: 1 }],
      members: [{ seq_num: 7, interface: "wan1", zone: "SDWAN_Internet" }],
    });
    listHealth.mockResolvedValue([]);
    listRules.mockResolvedValue({ rules: [], implicit: {} });

    const seqByLocal = new Map<number, number>();
    await planSDWANSteps(1, parsed(), { seqByLocal });
    // Resolved at PLAN time, because the member was already there.
    expect(seqByLocal.get(1)).toBe(7);
  });

  it("never sends the AI's sequence number in a member body", async () => {
    emptyDevice();
    const steps = await planSDWANSteps(1, parsed());
    for (const s of steps.filter((x) => x.kind === "sdwan-member")) {
      // Letting the device allocate is what the GUI does; a hard-coded seq collides the moment a
      // second member is added.
      expect(s.payload).not.toHaveProperty("seq_num");
    }
  });
});

describe("the sequence-number handover", () => {
  it("points the health check and the rule at the numbers the FIREWALL assigned", async () => {
    // The firewall already had members 1-3, so ours come back as 4 and 5 — nothing like the 1 and 2
    // the AI wrote. Without the handover both objects would point at members 1 and 2, which exist
    // and belong to interfaces nobody in this conversation mentioned.
    getSDWAN
      .mockResolvedValueOnce({ enabled: true, load_balance_mode: "", zones: [], members: [] })
      // resolve() after each create re-reads the device
      .mockResolvedValueOnce({ enabled: true, load_balance_mode: "", zones: [], members: [{ seq_num: 4, interface: "wan1", zone: "SDWAN_Internet" }] })
      .mockResolvedValue({
        enabled: true, load_balance_mode: "", zones: [],
        members: [
          { seq_num: 4, interface: "wan1", zone: "SDWAN_Internet" },
          { seq_num: 5, interface: "wan2", zone: "SDWAN_Internet" },
        ],
      });
    listHealth.mockResolvedValue([]);
    listRules.mockResolvedValue({ rules: [], implicit: {} });

    const steps = await planSDWANSteps(1, parsed());
    await runSDWANSteps(steps);

    expect(createHealth).toHaveBeenCalledTimes(1);
    expect(createHealth.mock.calls[0][1].members).toEqual([4, 5]);

    expect(createRule).toHaveBeenCalledTimes(1);
    expect(createRule.mock.calls[0][1].interface_preference).toEqual([4, 5]);
  });

  it("captures each created object's numeric mkey for Fallback", async () => {
    getSDWAN
      .mockResolvedValueOnce({ enabled: true, load_balance_mode: "", zones: [], members: [] })
      .mockResolvedValue({
        enabled: true, load_balance_mode: "", zones: [],
        members: [
          { seq_num: 4, interface: "wan1", zone: "SDWAN_Internet" },
          { seq_num: 5, interface: "wan2", zone: "SDWAN_Internet" },
        ],
      });
    listHealth.mockResolvedValue([]);
    listRules
      .mockResolvedValueOnce({ rules: [], implicit: {} })   // plan
      .mockResolvedValue({ rules: [{ id: 11, name: "Steer_Web" }], implicit: {} }); // resolve

    const created = await runSDWANSteps(await planSDWANSteps(1, parsed()));
    const member = created.find((o) => o.kind === "sdwan-member" && o.name === "wan1");
    expect(member?.seq).toBe(4);
    // A rule's name is NOT its mkey, so the id captured here is the only safe delete key.
    expect(created.find((o) => o.kind === "sdwan-rule")?.seq).toBe(11);
  });

  it("drops a reference it could not resolve rather than pointing it somewhere else", async () => {
    // wan2's create fails to appear on the read-back. The rule must then steer over wan1 alone,
    // never over "member 2" — which on this firewall is somebody else's link.
    getSDWAN
      .mockResolvedValueOnce({ enabled: true, load_balance_mode: "", zones: [], members: [] })
      .mockResolvedValue({
        enabled: true, load_balance_mode: "", zones: [],
        members: [{ seq_num: 4, interface: "wan1", zone: "SDWAN_Internet" }],
      });
    listHealth.mockResolvedValue([]);
    listRules.mockResolvedValue({ rules: [], implicit: {} });

    await runSDWANSteps(await planSDWANSteps(1, parsed()));
    expect(createRule.mock.calls[0][1].interface_preference).toEqual([4]);
    expect(createHealth.mock.calls[0][1].members).toEqual([4]);
  });
});

describe("running the plan", () => {
  it("creates in order and reports every object", async () => {
    emptyDevice();
    const seen: string[] = [];
    const created = await runSDWANSteps(await planSDWANSteps(1, parsed()), (o) => seen.push(o.name));
    expect(seen).toEqual(["SDWAN_Internet", "wan1", "wan2", "HC_Internet", "Steer_Web"]);
    expect(created).toHaveLength(5);
  });

  it("treats a duplicate as success, so Apply is safe to press twice", async () => {
    emptyDevice();
    // "Already taken" is the NUMBER -5 on the error body (fortios_code), not a phrase in the
    // sentence — the device proxy reports the code and fortiosError.ts compares it numerically.
    createZone.mockRejectedValue({
      response: { data: { error: "duplicate entry, Return code -5", fortios_code: -5 } },
    });
    const created = await runSDWANSteps(await planSDWANSteps(1, parsed()));
    // The zone is not reported as created — it was already there — but the rest still went in.
    expect(created.some((o) => o.kind === "sdwan-zone")).toBe(false);
    expect(created).toHaveLength(4);
  });

  it("lets a real failure through instead of reporting a success", async () => {
    emptyDevice();
    // A real refusal WITH its code (-3, not -5): the code is present, so this is a deliberate
    // "not a duplicate" decision rather than the absence of any signal at all.
    createMember.mockRejectedValue({
      response: { data: { error: "entry not found in datasource, -3", fortios_code: -3 } },
    });
    await expect(runSDWANSteps(await planSDWANSteps(1, parsed()))).rejects.toBeTruthy();
  });

  it("does not mistake an object named …-5 for a duplicate", async () => {
    // The old test was /(-5\b|already exist|duplicat)/i, which this message satisfies with no
    // error code anywhere in it. A create that genuinely failed was then recorded as "already
    // there", and the rule that steers traffic onto the member that was never made went in anyway.
    emptyDevice();
    createZone.mockRejectedValue({ response: { data: { error: 'invalid value for "spoke-5"' } } });
    await expect(runSDWANSteps(await planSDWANSteps(1, parsed()))).rejects.toBeTruthy();
  });
});

describe("blockers — what the device would refuse, or silently ignore", () => {
  it("passes a well-formed proposal", () => {
    expect(sdwanBlockers(parsed(), [])).toEqual([]);
  });

  it("catches a member in a zone nobody creates", () => {
    // FortiGate answers -3 ("entry not found in datasource"), which names neither the zone nor
    // where it was supposed to come from.
    const p = parseSDWANFromCLI(`config system sdwan
  config members
    edit 1
      set interface "wan1"
      set zone "Missing_Zone"
    next
  end
end`)!;
    expect(sdwanBlockers(p, []).join(" ")).toContain("Missing_Zone");
    // …unless the firewall already has it.
    expect(sdwanBlockers(p, ["Missing_Zone"])).toEqual([]);
  });

  it("catches a rule that would never steer anything", () => {
    // The quiet one: the device stores such a rule happily and it simply never matches.
    const p = parseSDWANFromCLI(`config system sdwan
  config service
    edit 1
      set name "Orphan"
      set mode manual
      set dst "all"
    next
  end
end`)!;
    expect(sdwanBlockers(p, []).join(" ")).toContain("Orphan");
  });

  it("catches an SLA strategy with no SLA target", () => {
    // The device will not let the LAST target be removed once a rule has one, so a rule that
    // arrives without any cannot be built at all.
    const p = parseSDWANFromCLI(`config system sdwan
  config members
    edit 1
      set interface "wan1"
      set zone "Z"
    next
  end
  config zone
    edit "Z"
    next
  end
  config service
    edit 1
      set name "NoTarget"
      set mode sla
      set dst "all"
      set priority-members 1
    next
  end
end`)!;
    expect(sdwanBlockers(p, []).join(" ")).toContain("NoTarget");
  });

  it("catches an interface a firewall policy still holds", () => {
    // MEASURED ON THE LAB FIREWALL, and the reason this check exists at all: wan1, lan, dmz and
    // port1 are each named by a policy and were all refused with «entry not found in datasource …
    // Return code -3» — which reads as "there is no such interface". wan2 and ha, named by nothing,
    // were accepted. Left to Apply, the wan1 create fails halfway and leaves the zone created and
    // the SLA and rule un-built.
    const use = policyInterfaceUse([
      { name: "Testing-Policy-Object", src_intf_list: ["lan"], dst_intf_list: ["wan1"] },
      { name: "default", src_intf_list: ["lan"], dst_intf_list: ["port1"] },
    ]);
    expect(use.wan1).toEqual(["Testing-Policy-Object"]);
    expect(use.lan).toEqual(["Testing-Policy-Object", "default"]);
    expect(use.wan2).toBeUndefined();

    const msg = sdwanBlockers(parsed(), [], use).join(" ");
    expect(msg).toContain("wan1");
    expect(msg).toContain("Testing-Policy-Object");
    // wan2 is held by nothing, so it must NOT be blocked.
    expect(msg).not.toContain("wan2");
  });

  it("does not treat a policy on \"any\" as holding an interface", () => {
    // A policy whose interface is `any` names no interface at all, and blocking every member on it
    // would make the wizard refuse proposals the firewall would accept.
    const use = policyInterfaceUse([{ name: "catch-all", src_intf_list: ["any"], dst_intf_list: ["ANY"] }]);
    expect(Object.keys(use)).toEqual([]);
    expect(sdwanBlockers(parsed(), [], use)).toEqual([]);
  });

  it("catches Best quality with no measured SLA", () => {
    const p = parseSDWANFromCLI(`config system sdwan
  config zone
    edit "Z"
    next
  end
  config members
    edit 1
      set interface "wan1"
      set zone "Z"
    next
  end
  config service
    edit 1
      set name "NoMeasure"
      set mode priority
      set dst "all"
      set priority-members 1
    next
  end
end`)!;
    expect(sdwanBlockers(p, []).join(" ")).toContain("NoMeasure");
  });
});
