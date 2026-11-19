import { describe, it, expect } from "vitest";
import { parseVPNFromCLI } from "./parseVPNCLI";

const S2S = `
config vpn ipsec phase1-interface
    edit "S2S-Branch"
        set interface "wan1"
        set ike-version 2
        set authmethod psk
        set peertype any
        set proposal aes256-sha256
        set remote-gw 203.0.113.50
        set psksecret "StrongPSK@2024"
    next
end
config vpn ipsec phase2-interface
    edit "S2S-Branch"
        set phase1name "S2S-Branch"
        set src-subnet 192.168.1.0 255.255.255.0
        set dst-subnet 10.0.0.0 255.255.255.0
    next
end
config firewall policy
    edit 0
        set name "vpn_S2S-Branch_local"
        set srcintf "lan"
        set dstintf "S2S-Branch"
    next
end`;

const RA_FC = `
config vpn ipsec phase1-interface
    edit "RA-FC"
        set type dynamic
        set interface "wan1"
        set ike-version 1
        set peertype any
        set mode-cfg enable
        set proposal aes128-sha256 aes256-sha256
        set wizard-type dialup-forticlient
        set xauthtype auto
        set authusrgrp "Guest-group"
        set ipv4-start-ip 10.10.80.1
        set ipv4-end-ip 10.10.80.254
        set ipv4-netmask 255.255.255.0
        set dns-mode auto
        set ipv4-split-include "RA-FC_split"
        set save-password enable
        set psksecret "Pw123"
    next
end
config firewall addrgrp
    edit "RA-FC_split"
        set member "LAN-192.168.1.0" "LAN-10.0.0.0"
    next
end
config firewall policy
    edit 0
        set name "vpn_RA-FC_remote"
        set srcintf "RA-FC"
        set dstintf "lan"
    next
end`;

const RA_CISCO = `
config vpn ipsec phase1-interface
    edit "RA-Cis"
        set type dynamic
        set interface "wan1"
        set mode aggressive
        set peertype one
        set mode-cfg enable
        set wizard-type dialup-cisco
        set authusrgrp "Guest-group"
        set peerid "SalesGroup"
        set ipv4-start-ip 10.10.81.1
        set ipv4-end-ip 10.10.81.254
        set psksecret "Pw"
    next
end`;

describe("parseVPNFromCLI dispatch", () => {
  it("classifies Site-to-Site", () => {
    const r = parseVPNFromCLI(S2S)!;
    expect(r.kind).toBe("site-to-site");
    expect(r.name).toBe("S2S-Branch");
    const p = r.payload;
    expect(p.interface).toBe("wan1");
    expect(p.remote_type).toBe("static");
    expect(p.remote_gw).toBe("203.0.113.50");
    expect(p.psk).toBe("StrongPSK@2024");
    expect(p.local_subnets).toEqual(["192.168.1.0/24"]);
    expect(p.remote_subnets).toEqual(["10.0.0.0/24"]);
    expect(p.local_interface).toBe("lan"); // from the LAN→VPN policy
    expect(p.create_static_route).toBe(true);
    expect(p.create_firewall_policy).toBe(true);
    expect(p.hub_spoke).toBeUndefined();
    expect(p.remote_access).toBeUndefined();
  });

  it("classifies Remote Access (FortiClient) with split group members", () => {
    const r = parseVPNFromCLI(RA_FC)!;
    expect(r.kind).toBe("remote-access");
    const p = r.payload;
    expect(p.remote_access).toBe(true);
    expect(p.ra_client).toBe("forticlient");
    expect(p.user_group).toBe("Guest-group");
    expect(p.client_range_start).toBe("10.10.80.1");
    expect(p.client_range_end).toBe("10.10.80.254");
    expect(p.client_netmask).toBe("255.255.255.0");
    expect(p.split_tunnel).toBe(true);
    expect(p.local_addresses).toEqual(["LAN-192.168.1.0", "LAN-10.0.0.0"]);
    expect(p.save_password).toBe(true);
    expect(p.local_interface).toBe("lan");
  });

  it("classifies Remote Access (Cisco) with group name → aggressive", () => {
    const r = parseVPNFromCLI(RA_CISCO)!;
    expect(r.kind).toBe("remote-access");
    expect(r.payload.ra_client).toBe("cisco");
    expect(r.payload.require_group_name).toBe(true);
    expect(r.payload.group_name).toBe("SalesGroup");
  });

  it("returns null when there is no phase1", () => {
    expect(parseVPNFromCLI("config firewall address\n edit \"X\"\n next\nend")).toBeNull();
    expect(parseVPNFromCLI("")).toBeNull();
  });

  it("still dispatches Hub-and-Spoke", () => {
    const hub = `config vpn ipsec phase1-interface
      edit "H"
        set type dynamic
        set auto-discovery-sender enable
        set interface "wan1"
        set psksecret "x"
      next
    end
    config router bgp
      set as 65000
      config network
        edit 1
          set prefix 10.0.0.0 255.255.0.0
        next
      end
    end`;
    expect(parseVPNFromCLI(hub)!.kind).toBe("hub-spoke");
  });
});
