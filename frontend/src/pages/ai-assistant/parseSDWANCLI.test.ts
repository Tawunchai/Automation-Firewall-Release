import { describe, expect, it } from "vitest";
import {
  parseSDWANFromCLI, sdwanObjectCount, remapMemberRefs,
  healthCheckWithMembers, ruleWithMembers, sdwanRuleIsSteerable,
} from "./parseSDWANCLI";

// The proposal an SD-WAN prompt actually produces: a zone, two members, a health check with an SLA
// target, and a rule that steers traffic over both members. Written the way the system prompt
// teaches the model to write it.
const FULL = `
config system sdwan
    set status enable
    set load-balance-mode source-ip-based
    config zone
        edit "SDWAN_Internet"
            set service-sla-tie-break cfg-order
        next
    end
    config members
        edit 1
            set interface "wan1"
            set zone "SDWAN_Internet"
            set gateway 203.0.113.254
            set cost 0
            set priority 1
            set status enable
            set comment "Primary fibre"
        next
        edit 2
            set interface "wan2"
            set zone "SDWAN_Internet"
            set gateway 203.0.114.254
            set cost 10
            set priority 10
            set status enable
        next
    end
    config health-check
        edit "HC_Internet"
            set detect-mode active
            set protocol ping
            set server "1.1.1.1" "8.8.8.8"
            set interval 500
            set failtime 5
            set recoverytime 5
            set update-static-route enable
            set members 1 2
            config sla
                edit 1
                    set link-cost-factor latency jitter packet-loss
                    set latency-threshold 250
                    set jitter-threshold 50
                    set packetloss-threshold 5
                next
            end
        next
    end
    config service
        edit 1
            set name "Steer_Web"
            set mode sla
            set dst "all"
            set src "LAN_Subnet"
            set priority-members 1 2
            config sla
                edit "HC_Internet"
                    set id 1
                next
            end
        next
    end
end
`;

describe("the whole SD-WAN block", () => {
  const p = parseSDWANFromCLI(FULL)!;

  it("finds all four child tables", () => {
    expect(p).not.toBeNull();
    expect(p.zones).toHaveLength(1);
    expect(p.members).toHaveLength(2);
    expect(p.healthChecks).toHaveLength(1);
    expect(p.rules).toHaveLength(1);
    expect(sdwanObjectCount(p)).toBe(5);
  });

  it("reads the parent's own settings without treating them as objects", () => {
    // `status` is READ so the wizard can warn that the proposal assumes SD-WAN is on. It is never
    // written: turning SD-WAN on re-homes every route that leaves through a member.
    expect(p.requestedStatus).toBe(true);
    expect(p.loadBalanceMode).toBe("source-ip-based");
  });

  it("does not mistake a nested child table for the end of the parent block", () => {
    // `config sla … end` sits inside `config health-check`, which sits inside `config system sdwan`.
    // An unbalanced reader stops at the first `end` and finds one table instead of four.
    expect(p.healthChecks[0].form.sla).toHaveLength(1);
    expect(p.rules[0].form.required_sla_targets).toHaveLength(1);
  });
});

describe("zones", () => {
  it("carries the name and the tie-break", () => {
    const p = parseSDWANFromCLI(FULL)!;
    expect(p.zones[0].form).toEqual({
      name: "SDWAN_Internet", service_sla_tie_break: "cfg-order",
    });
  });

  it("omits a tie-break the CLI did not set, rather than inventing one", () => {
    const p = parseSDWANFromCLI(`config system sdwan
  config zone
    edit "Z1"
    next
  end
end`)!;
    expect(p.zones[0].form.service_sla_tie_break).toBeUndefined();
  });
});

describe("members", () => {
  const p = parseSDWANFromCLI(FULL)!;

  it("maps every field of the member dialog", () => {
    expect(p.members[0].form).toEqual({
      interface: "wan1", zone: "SDWAN_Internet", gateway: "203.0.113.254",
      cost: 0, priority: 1, status: true, comment: "Primary fibre",
    });
    expect(p.members[1].form.cost).toBe(10);
  });

  it("keeps the CLI's sequence number as a LOCAL handle only", () => {
    // The device assigns the real one. Sending the model's number is how a proposal ends up
    // pointing at somebody else's interfaces.
    expect(p.members.map((m) => m.localSeq)).toEqual([1, 2]);
    expect(p.members[0].form).not.toHaveProperty("seq_num");
  });

  it("drops a member with no interface, which is not a member", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config members
    edit 1
      set zone "Z1"
    next
  end
end`);
    expect(p2).toBeNull();
  });

  it("accepts an interface name where the sequence number belongs", () => {
    // The model occasionally writes `edit "wan1"`. Refusing the whole proposal over a mkey that is
    // going to be reassigned anyway helps nobody.
    const p2 = parseSDWANFromCLI(`config system sdwan
  config members
    edit "wan1"
      set zone "Z1"
    next
  end
end`)!;
    expect(p2.members[0].form.interface).toBe("wan1");
  });
});

describe("health checks", () => {
  const p = parseSDWANFromCLI(FULL)!;
  const hc = p.healthChecks[0];

  it("splits the two-value server field", () => {
    // The CMDB packs the list into one quoted string; each element is quoted separately.
    expect(hc.form.servers).toEqual(["1.1.1.1", "8.8.8.8"]);
  });

  it("carries the probe settings and the SLA thresholds", () => {
    expect(hc.form.name).toBe("HC_Internet");
    expect(hc.form.detect_mode).toBe("active");
    expect(hc.form.protocol).toBe("ping");
    expect(hc.form.interval).toBe(500);
    expect(hc.form.failtime).toBe(5);
    expect(hc.form.recoverytime).toBe(5);
    expect(hc.form.update_static_route).toBe(true);
    expect(hc.form.sla[0]).toMatchObject({
      id: 1,
      link_cost_factor: ["latency", "jitter", "packet-loss"],
      latency_threshold: 250, jitter_threshold: 50, packetloss_threshold: 5,
    });
  });

  it("keeps its participants as local handles, out of the form", () => {
    expect(hc.memberLocalSeqs).toEqual([1, 2]);
    expect(hc.form.members).toEqual([]);
  });

  it("falls back to the device's defaults for a check the CLI only sketches", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config health-check
    edit "HC_Min"
      set server "8.8.8.8"
    next
  end
end`)!;
    const f = p2.healthChecks[0].form;
    expect(f).toMatchObject({
      detect_mode: "active", protocol: "ping",
      interval: 500, failtime: 5, recoverytime: 5, update_static_route: true,
    });
  });

  it("reads a DNS probe that uses the system resolvers", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config health-check
    edit "HC_DNS"
      set protocol dns
      set system-dns enable
    next
  end
end`)!;
    expect(p2.healthChecks[0].form.protocol).toBe("dns");
    expect(p2.healthChecks[0].form.system_dns).toBe(true);
  });

  it("never leaves an SLA row measuring nothing", () => {
    // A row with an empty criteria set is one every member passes — it looks like a working SLA
    // and is not one, and the server refuses it outright.
    const p2 = parseSDWANFromCLI(`config system sdwan
  config health-check
    edit "HC"
      set server "8.8.8.8"
      config sla
        edit 1
          set link-cost-factor nonsense
          set latency-threshold 100
        next
      end
    next
  end
end`)!;
    expect(p2.healthChecks[0].form.sla[0].link_cost_factor)
      .toEqual(["latency", "jitter", "packet-loss"]);
  });
});

describe("rules", () => {
  const p = parseSDWANFromCLI(FULL)!;
  const rule = p.rules[0];

  it("maps the Priority Rule dialog", () => {
    expect(rule.form.name).toBe("Steer_Web");
    expect(rule.form.mode).toBe("sla");
    expect(rule.form.destination).toEqual(["all"]);
    expect(rule.form.source).toEqual(["LAN_Subnet"]);
    expect(rule.form.status).toBe(true);
  });

  it("reads the rule's SLA sub-table as <health check>#<number>", () => {
    // Its edit key is the health check NAME and `set id` is the SLA number — the opposite shape to
    // the health check's own sla table, whose key IS the number.
    expect(rule.form.required_sla_targets).toEqual([{ health_check: "HC_Internet", id: 1 }]);
  });

  it("keeps priority-members as local handles, out of the form", () => {
    expect(rule.memberLocalSeqs).toEqual([1, 2]);
    expect(rule.form.interface_preference).toEqual([]);
  });

  it("reads the Best-quality strategy's measured SLA and criteria", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config service
    edit 1
      set name "Best"
      set mode priority
      set dst "all"
      set health-check "HC_Internet"
      set link-cost-factor latency
      set priority-zone "SDWAN_Internet"
    next
  end
end`)!;
    expect(p2.rules[0].form.measured_sla).toEqual(["HC_Internet"]);
    expect(p2.rules[0].form.quality_criteria).toBe("latency");
    expect(p2.rules[0].form.zone_preference).toEqual(["SDWAN_Internet"]);
  });

  it("reads an internet-service rule, and the ports of a TCP one", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config service
    edit 1
      set name "O365"
      set mode manual
      set internet-service enable
      set internet-service-name "Microsoft-Office365"
      set protocol 6
      set start-port 443
      set end-port 443
      set priority-members 1
    next
  end
end`)!;
    const f = p2.rules[0].form;
    expect(f.internet_service).toBe(true);
    expect(f.internet_service_names).toEqual(["Microsoft-Office365"]);
    expect(f.protocol).toBe(6);
    expect(f.start_port).toBe(443);
    expect(f.end_port).toBe(443);
  });

  it("takes a name written where the rule id belongs", () => {
    const p2 = parseSDWANFromCLI(`config system sdwan
  config service
    edit "Steer_Voice"
      set mode manual
      set priority-members 1
    next
  end
end`)!;
    expect(p2.rules[0].form.name).toBe("Steer_Voice");
  });
});

describe("resolving the sequence numbers the device assigned", () => {
  const p = parseSDWANFromCLI(FULL)!;

  it("rewrites local handles to the real ones", () => {
    // The firewall already had members 1-3, so ours came back as 4 and 5.
    const seqByLocal = new Map([[1, 4], [2, 5]]);
    expect(remapMemberRefs([1, 2], seqByLocal)).toEqual([4, 5]);
    expect(healthCheckWithMembers(p.healthChecks[0], seqByLocal).members).toEqual([4, 5]);
    expect(ruleWithMembers(p.rules[0], seqByLocal).interface_preference).toEqual([4, 5]);
  });

  it("DROPS a handle it cannot resolve rather than passing the number through", () => {
    // This is the bug the whole local-id scheme exists to prevent: seq-num 1 almost certainly
    // exists on the firewall and belongs to an interface nobody in the conversation mentioned.
    expect(remapMemberRefs([1, 2], new Map([[1, 4]]))).toEqual([4]);
    expect(remapMemberRefs([9], new Map())).toEqual([]);
  });

  it("does not repeat a member two handles resolved to", () => {
    expect(remapMemberRefs([1, 2], new Map([[1, 4], [2, 4]]))).toEqual([4]);
  });

  it("leaves an unresolvable health check watching every member", () => {
    // Empty means "All SD-WAN Members" on that table, which is the safe reading — better than
    // watching a stranger's interface.
    expect(healthCheckWithMembers(p.healthChecks[0], new Map()).members).toEqual([]);
  });

  it("knows a rule that resolved to nothing steers nothing", () => {
    // The device accepts such a rule and it silently never matches, so the wizard has to catch it.
    const orphan = ruleWithMembers(p.rules[0], new Map());
    expect(sdwanRuleIsSteerable(orphan)).toBe(false);
    expect(sdwanRuleIsSteerable(ruleWithMembers(p.rules[0], new Map([[1, 4]])))).toBe(true);
    // A zone alone is enough — the dialog offers either.
    expect(sdwanRuleIsSteerable({ ...orphan, zone_preference: ["SDWAN_Internet"] })).toBe(true);
  });
});

describe("what is NOT an SD-WAN proposal", () => {
  it("returns null when the CLI has no sdwan block", () => {
    expect(parseSDWANFromCLI("config firewall address\n edit \"A\"\n next\nend")).toBeNull();
    expect(parseSDWANFromCLI("")).toBeNull();
  });

  it("returns null for a block that defines no objects at all", () => {
    // `set status enable` alone has nothing this console builds, and an SD-WAN Wizard button on it
    // would open an empty form.
    expect(parseSDWANFromCLI("config system sdwan\n set status enable\nend")).toBeNull();
  });

  it("survives Windows line endings", () => {
    // A stray \r stops `set (.*)$` matching, and the whole draft comes back empty — silently.
    const p = parseSDWANFromCLI(FULL.replace(/\n/g, "\r\n"));
    expect(p?.members).toHaveLength(2);
    expect(p?.members[0].form.interface).toBe("wan1");
  });
});
