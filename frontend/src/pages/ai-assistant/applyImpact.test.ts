import { describe, expect, it } from "vitest";
import { extractImpactBullets, impactBullets, nameList, summarizeApplyImpact } from "./applyImpact";

// The Apply confirmation's summary.
//
// This is the last thing a user reads before config reaches a live firewall, so the standard every
// test below holds it to is: it must never make a change look SMALLER or SAFER than it is. Missing
// an object from the list, dropping the "this rule allows everything" warning, or promising an undo
// that the SSH path cannot deliver are all failures of the same kind.

const POLICY_WITH_ADDRESS = `
config firewall address
    edit "LAN-Network"
        set type ipmask
        set subnet 192.168.1.0 255.255.255.0
    next
end
config firewall policy
    edit 0
        set name "LAN-to-WAN"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set utm-status enable
        set av-profile "default"
    next
end
`;

describe("summarizeApplyImpact — objects", () => {
  it("lists every object the CLI defines, in the order Apply writes them", () => {
    const impact = summarizeApplyImpact(POLICY_WITH_ADDRESS);

    // Address before policy: that is the dependency order planApply walks, and the dialog reads in
    // the order the firewall is actually written to.
    expect(impact.objects.map((o) => `${o.label}:${o.name}`)).toEqual([
      "Address:LAN-Network",
      "Policy:LAN-to-WAN",
    ]);
    expect(impact.transport).toBe("rest");
    expect(impact.destructive).toBe(false);
  });

  it("counts an object named twice in one suggestion only once", () => {
    const cli = `
config firewall address
    edit "Server-A"
        set subnet 10.0.0.5 255.255.255.255
    next
    edit "Server-A"
        set subnet 10.0.0.5 255.255.255.255
    next
end
`;
    expect(summarizeApplyImpact(cli).objects).toHaveLength(1);
  });

  it("covers profiles, users and groups — not just addresses and policies", () => {
    const cli = `
config antivirus profile
    edit "AV-Office"
        set comment "flow AV"
    next
end
config user local
    edit "alice"
        set type password
        set passwd "S3cret!"
    next
end
config user group
    edit "Office-Users"
        set member "alice"
    next
end
`;
    const kinds = summarizeApplyImpact(cli).objects.map((o) => o.kind);
    expect(kinds).toEqual(["antivirus", "user", "user-group"]);
  });
});

describe("summarizeApplyImpact — effects", () => {
  it("states, in one line, which traffic the policy lets through", () => {
    const [line] = summarizeApplyImpact(POLICY_WITH_ADDRESS).effects;

    expect(line).toContain("Allows");
    expect(line).toContain("LAN-Network");
    expect(line).toContain("lan");
    expect(line).toContain("port1");
    // NAT is the part a reader would otherwise have to infer from a bare `set nat enable`.
    expect(line).toContain("NAT");
  });

  it("says blocked for a deny policy", () => {
    const cli = `
config firewall policy
    edit 0
        set name "Block-Social"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "Social-Media"
        set action deny
        set service "ALL"
    next
end
`;
    const [line] = summarizeApplyImpact(cli).effects;
    expect(line).toContain("Blocks");
    expect(line).not.toContain("Allows");
    // A deny carries no NAT and no inspection, so neither may be claimed for it.
    expect(line).not.toContain("NAT");
  });

  it("names the schedule when the policy is not always-on", () => {
    const cli = `
config firewall policy
    edit 0
        set name "Games-Lunch"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set schedule "Lunch-Break"
        set service "ALL"
    next
end
`;
    expect(summarizeApplyImpact(cli).effects[0]).toContain("Lunch-Break");
  });

  // A profile nobody references inspects nothing. Saying "AntiVirus created" without that is how a
  // user ends up believing traffic is being scanned when it is not.
  it("says a standalone profile does nothing until a policy references it", () => {
    const cli = `
config antivirus profile
    edit "AV-Office"
        set comment "flow AV"
    next
end
`;
    expect(summarizeApplyImpact(cli).effects.join(" ")).toContain("policy");
  });

  it("describes a static route by where the traffic goes instead", () => {
    const cli = `
config router static
    edit 0
        set dst 10.10.0.0 255.255.0.0
        set gateway 192.168.1.254
        set device "lan"
    next
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.objects.map((o) => o.kind)).toEqual(["static-route"]);
    expect(impact.effects[0]).toContain("192.168.1.254");
    expect(impact.effects[0]).toContain("lan");
  });
});

describe("summarizeApplyImpact — warnings", () => {
  it("flags an any/any/ALL accept as wide open", () => {
    const cli = `
config firewall policy
    edit 0
        set name "Allow-Everything"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set service "ALL"
    next
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.policies[0].wideOpen).toBe(true);
    expect(impact.warnings.some((w) => w.includes("Allow-Everything") && w.includes("wide open"))).toBe(true);
  });

  it("flags an accept with no security profile attached", () => {
    const cli = `
config firewall policy
    edit 0
        set name "Plain-Out"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Network"
        set dstaddr "all"
        set action accept
        set service "HTTPS"
    next
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.policies[0].uninspected).toBe(true);
    expect(impact.warnings.some((w) => w.includes("Plain-Out"))).toBe(true);
  });

  it("does not call a policy uninspected when it carries a profile", () => {
    const impact = summarizeApplyImpact(POLICY_WITH_ADDRESS);
    expect(impact.policies[0].uninspected).toBe(false);
    expect(impact.policies[0].profiles).toContain("AntiVirus: default");
  });

  // FortiGate matches top-down and applyViaREST appends with `edit 0`, so a new rule lands at the
  // bottom where a broader rule above can shadow it. That is not visible anywhere in the CLI.
  it("always warns that a new policy lands at the bottom of the rule base", () => {
    expect(summarizeApplyImpact(POLICY_WITH_ADDRESS).warnings.join(" ")).toContain("bottom of the table");
  });

  it("does not raise the placement warning when the suggestion has no policy", () => {
    const cli = `
config firewall address
    edit "LAN-Network"
        set subnet 192.168.1.0 255.255.255.0
    next
end
`;
    expect(summarizeApplyImpact(cli).warnings.join(" ")).not.toContain("bottom of the table");
  });

  // A delete goes down the SSH pipeline, which records nothing for Fallback to take back. Promising
  // an undo that does not exist is worse than saying nothing.
  it("says a destructive CLI cannot be rolled back with Fallback", () => {
    const cli = `
config firewall policy
    delete 5
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.destructive).toBe(true);
    expect(impact.transport).toBe("ssh");
    expect(impact.warnings.some((w) => w.includes("Fallback"))).toBe(true);
  });

  it("says a section with no REST endpoint is shipped whole over SSH", () => {
    const cli = `
config system dhcp server
    edit 0
        set interface "lan"
    next
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.transport).toBe("ssh");
    expect(impact.destructive).toBe(false);
    expect(impact.warnings.some((w) => w.includes("SSH"))).toBe(true);
  });
});

describe("summarizeApplyImpact — VPN", () => {
  // A VPN is built as ONE object set by the device proxy; its policies and addresses travel inside
  // it. Listing them as separate creates would tell the user six objects are coming when the applier
  // only ever makes one call — and would imply they can be created independently, which fails.
  it("reports a VPN suggestion as a single tunnel, not as its parts", () => {
    const cli = `
config vpn ipsec phase1-interface
    edit "VPN-Branch"
        set interface "port1"
        set remote-gw 203.0.113.5
        set psksecret "s3cret"
    next
end
config vpn ipsec phase2-interface
    edit "VPN-Branch-p2"
        set phase1name "VPN-Branch"
        set src-subnet 192.168.1.0 255.255.255.0
        set dst-subnet 10.10.0.0 255.255.255.0
    next
end
config firewall policy
    edit 0
        set name "VPN-Branch-out"
        set srcintf "lan"
        set dstintf "VPN-Branch"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
        set service "ALL"
    next
end
`;
    const impact = summarizeApplyImpact(cli);
    expect(impact.objects).toHaveLength(1);
    expect(impact.objects[0].kind).toBe("ipsec-tunnel");
    expect(impact.objects[0].name).toBe("VPN-Branch");
    expect(impact.policies).toHaveLength(0);
    expect(impact.effects.join(" ")).toContain("VPN-Branch");
  });
});

describe("extractImpactBullets", () => {
  // The exact shape ai.go's prompt asks the model for.
  it("pulls the model's three Impact bullets out of its explanation", () => {
    const explanation = [
      "สร้าง policy LAN-to-WAN + address LAN-Network",
      "",
      "**ผลกระทบ (Impact):**",
      "· subnet 192.168.1.0/24 (LAN-Network) ออก Internet ได้ทุก port/service",
      "· กระทบ host ทุกเครื่องในวง lan (192.168.1.x)",
      "· PLACEMENT: policy นี้ควรอยู่ต่ำกว่า policy ที่ block",
    ].join("\n");

    const bullets = extractImpactBullets(explanation);
    expect(bullets).toHaveLength(3);
    expect(bullets[0]).toContain("192.168.1.0/24");
    expect(bullets[2]).toContain("PLACEMENT");
    // The markdown decoration belongs to the chat bubble, not to a dialog line.
    expect(bullets.join(" ")).not.toContain("**");
  });

  it("accepts the English heading and dash bullets too", () => {
    const explanation = "Creates one policy.\n\nImpact\n- subnet 10.0.0.0/24 reaches the internet\n- affects every host on lan";
    expect(extractImpactBullets(explanation)).toEqual([
      "subnet 10.0.0.0/24 reaches the internet",
      "affects every host on lan",
    ]);
  });

  // "impact" mid-sentence is prose. Treating it as a heading would print the following prose lines
  // as if the model had written them as an impact analysis.
  it("ignores the word impact inside a sentence", () => {
    expect(extractImpactBullets("This has no impact on existing rules.\n\nSomething else.")).toEqual([]);
  });

  it("returns nothing when the model wrote no impact section", () => {
    expect(extractImpactBullets("สร้าง address object หนึ่งรายการ")).toEqual([]);
    expect(extractImpactBullets(undefined)).toEqual([]);
    expect(extractImpactBullets("")).toEqual([]);
  });
});

describe("impactBullets — the typed impact field", () => {
  // The field replaced the prose section because the regex above could only find what it had been
  // taught to expect. These tests are about the three fields becoming the same three lines.
  const full = {
    subnets: ["192.168.10.0/24", "10.0.0.0/8"],
    affected: ["every host on the office LAN", "the DMZ web server"],
    placement: "above Allow-LAN-Internet, or it never matches",
  };

  it("renders one line per field, subnets first", () => {
    expect(impactBullets(full)).toEqual([
      "192.168.10.0/24, 10.0.0.0/8",
      "every host on the office LAN · the DMZ web server",
      "above Allow-LAN-Internet, or it never matches",
    ]);
  });

  it("drops a field the model had nothing to say about", () => {
    expect(impactBullets({ subnets: [], affected: ["the guest VLAN"], placement: "" })).toEqual(["the guest VLAN"]);
  });

  it('treats placement "-" as an answer, not a line', () => {
    // "-" is what the prompt asks for when the answer creates no policy. Showing it would read
    // as a missing value.
    expect(impactBullets({ subnets: ["10.1.0.0/24"], affected: [], placement: "-" })).toEqual(["10.1.0.0/24"]);
  });

  it("survives an absent or half-filled object", () => {
    expect(impactBullets(undefined)).toEqual([]);
    expect(impactBullets(null)).toEqual([]);
    // Older persisted transcripts, and anything hand-built: the arrays may simply not be there.
    expect(impactBullets({} as never)).toEqual([]);
  });

  it("trims blank entries rather than printing empty bullets", () => {
    expect(impactBullets({ subnets: ["  ", "10.2.0.0/24"], affected: [""], placement: "   " }))
      .toEqual(["10.2.0.0/24"]);
  });
});

describe("summarizeApplyImpact — which impact wins", () => {
  const cli = `
config firewall address
    edit "LAN-Net"
        set subnet 10.0.1.0 255.255.255.0
    next
end`;
  const NL2 = String.fromCharCode(10);
  const prose = ["Creates one address.", "", "Impact", "- the prose one", "- second prose line"].join(NL2);

  it("prefers the typed field over the prose section", () => {
    const got = summarizeApplyImpact(cli, prose, {
      subnets: ["10.0.1.0/24"], affected: ["the office LAN"], placement: "-",
    });
    expect(got.aiImpact).toEqual(["10.0.1.0/24", "the office LAN"]);
  });

  it("falls back to the prose section when there is no typed field", () => {
    // A conversation restored from a snapshot written before the field existed must not lose its
    // impact summary on upgrade.
    expect(summarizeApplyImpact(cli, prose).aiImpact).toEqual(["the prose one", "second prose line"]);
    expect(summarizeApplyImpact(cli, prose, null).aiImpact).toEqual(["the prose one", "second prose line"]);
  });

  it("falls back when the typed field is present but empty", () => {
    const got = summarizeApplyImpact(cli, prose, { subnets: [], affected: [], placement: "-" });
    expect(got.aiImpact).toEqual(["the prose one", "second prose line"]);
  });
});

describe("nameList", () => {
  it("keeps a long list to one line", () => {
    expect(nameList(["a", "b", "c", "d", "e"])).toBe("a, b, c +2");
  });

  it("renders an empty list as a dash rather than an empty string", () => {
    expect(nameList([])).toBe("—");
    expect(nameList(undefined)).toBe("—");
  });
});
