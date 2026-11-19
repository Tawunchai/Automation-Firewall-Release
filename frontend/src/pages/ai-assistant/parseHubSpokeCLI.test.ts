import { describe, it, expect } from "vitest";
import { parseHubSpokeFromCLI } from "./parseHubSpokeCLI";

// The CLI the AI emits for a Hub (Individual) — prompt section 9b.
const HUB_INDIVIDUAL = `
config vpn ipsec phase1-interface
    edit "AIHub"
        set type dynamic
        set interface "port1"
        set ike-version 2
        set peertype any
        set net-device disable
        set proposal aes256-sha256
        set add-route disable
        set dpd on-idle
        set auto-discovery-sender enable
        set psksecret "Test1234"
    next
end
config vpn ipsec phase2-interface
    edit "AIHub"
        set phase1name "AIHub"
        set proposal aes256-sha256
    next
end
config system interface
    edit "AIHub"
        set ip 10.90.1.1 255.255.255.255
        set remote-ip 10.90.1.2 255.255.255.0
        set allowaccess ping
    next
end
config firewall address
    edit "AIHub_local"
        set subnet 10.0.96.0 255.255.252.0
    next
end
config router bgp
    set as 65400
    set router-id 10.90.1.1
    config neighbor
        edit "10.90.1.3"
            set remote-as 65400
        next
    end
    config network
        edit 1
            set prefix 10.0.96.0 255.255.252.0
        next
    end
end
config firewall policy
    edit 0
        set name "vpn_AIHub_spoke2hub"
        set srcintf "AIHub"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "AIHub_local"
        set action accept
        set schedule "always"
        set service "ALL"
    next
end`;

const HUB_RANGE = `
config vpn ipsec phase1-interface
    edit "RngHub"
        set type dynamic
        set interface "wan1"
        set auto-discovery-sender enable
        set psksecret "Pw"
    next
end
config system interface
    edit "RngHub"
        set ip 10.91.1.1 255.255.255.255
        set remote-ip 10.91.1.2 255.255.255.0
    next
end
config firewall address
    edit "RngHub_local"
        set subnet 10.20.0.0 255.255.0.0
    next
end
config router bgp
    set as 65500
    config neighbor-group
        edit "RngHub"
            set interface "RngHub"
            set remote-as 65500
        next
    end
    config neighbor-range
        edit 1
            set prefix 10.91.1.0 255.255.255.0
            set neighbor-group "RngHub"
        next
    end
    config network
        edit 1
            set prefix 10.20.0.0 255.255.0.0
        next
    end
end`;

const SPOKE = `
config vpn ipsec phase1-interface
    edit "AISpoke"
        set interface "port1"
        set auto-discovery-receiver enable
        set net-device enable
        set remote-gw 203.0.113.10
        set psksecret "Sp"
    next
end
config system interface
    edit "AISpoke"
        set ip 10.90.1.3 255.255.255.255
        set remote-ip 10.90.1.1 255.255.255.0
    next
end
config firewall address
    edit "AISpoke_local"
        set subnet 192.168.50.0 255.255.255.0
    next
end
config router bgp
    set as 65400
    config neighbor
        edit "10.90.1.1"
            set remote-as 65400
        next
    end
end`;

describe("parseHubSpokeFromCLI", () => {
  it("returns null for non-hub-spoke CLI", () => {
    expect(parseHubSpokeFromCLI("config firewall address\n edit \"X\"\n set subnet 10.0.0.0 255.255.255.0\n next\nend")).toBeNull();
    expect(parseHubSpokeFromCLI("")).toBeNull();
    // A plain site-to-site tunnel (no auto-discovery) is NOT hub-spoke.
    expect(parseHubSpokeFromCLI(`config vpn ipsec phase1-interface\n edit "S2S"\n set remote-gw 1.2.3.4\n next\nend`)).toBeNull();
  });

  it("parses a Hub (Individual)", () => {
    const r = parseHubSpokeFromCLI(HUB_INDIVIDUAL);
    expect(r).not.toBeNull();
    expect(r!.name).toBe("AIHub");
    const p = r!.payload;
    expect(p.interface).toBe("port1");
    expect(p.auth_method).toBe("psk");
    expect(p.psk).toBe("Test1234");
    expect(p.hub_spoke!.role).toBe("hub");
    expect(p.hub_spoke!.tunnel_ip).toBe("10.90.1.1");
    expect(p.hub_spoke!.remote_ip).toBe("10.90.1.2/24");
    expect(p.hub_spoke!.local_as).toBe("65400");
    expect(p.hub_spoke!.local_subnets).toEqual(["10.0.96.0/22"]);
    expect(p.hub_spoke!.spoke_type).toBe("individual");
    expect(p.hub_spoke!.spoke_tunnel_ips).toEqual(["10.90.1.3"]);
    expect(p.hub_spoke!.spoke_range_prefix).toBeUndefined();
  });

  it("parses a Hub (Range) with neighbor-group + neighbor-range", () => {
    const r = parseHubSpokeFromCLI(HUB_RANGE)!;
    expect(r.payload.hub_spoke!.role).toBe("hub");
    expect(r.payload.hub_spoke!.spoke_type).toBe("range");
    expect(r.payload.hub_spoke!.spoke_range_prefix).toBe("10.91.1.0/24");
    expect(r.payload.hub_spoke!.local_subnets).toEqual(["10.20.0.0/16"]);
    expect(r.payload.interface).toBe("wan1");
  });

  it("parses a Spoke (static, remote-gw = hub public IP)", () => {
    const r = parseHubSpokeFromCLI(SPOKE)!;
    const hs = r.payload.hub_spoke!;
    expect(hs.role).toBe("spoke");
    expect(hs.remote_gw).toBe("203.0.113.10");
    expect(r.payload.remote_gw).toBe("203.0.113.10");
    expect(hs.tunnel_ip).toBe("10.90.1.3");
    expect(hs.remote_ip).toBe("10.90.1.1/24");
    expect(hs.local_subnets).toEqual(["192.168.50.0/24"]);
    expect(hs.spoke_type).toBeUndefined(); // spoke has no spoke enumeration
  });

  it("falls back to BGP networks when no _local address block is present", () => {
    const noAddr = HUB_INDIVIDUAL.replace(/config firewall address[\s\S]*?end\n/, "");
    const r = parseHubSpokeFromCLI(noAddr)!;
    expect(r.payload.hub_spoke!.local_subnets).toEqual(["10.0.96.0/22"]);
  });
});
