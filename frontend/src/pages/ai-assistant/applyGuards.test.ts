import { describe, it, expect } from "vitest";
import { canApplyViaREST, countRESTApplicable, hasDestructiveStatement } from "./applyViaREST";

// The two guards that decide what the Apply button does. Both exist because of a shipped bug:
// a "delete this policy" suggestion took the REST fast path, parsed zero objects out of it, created
// nothing — and the chat reported "Everything in this config already exists on the device". The
// user read that as "deleted".

const ADDRESS_CLI = `
config firewall address
    edit "LAN-Net"
        set subnet 10.0.1.0 255.255.255.0
    next
end`;

const POLICY_CLI = `
config firewall policy
    edit 0
        set name "Allow-LAN-Internet"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN-Net"
        set dstaddr "all"
        set service "HTTPS"
        set action accept
        set schedule "always"
    next
end`;

// A `config system sdwan` block: one header, and its objects one level down inside four child
// tables. Nothing else in this file has that shape.
/** Newline, as a constant: a literal one inside a string in this file trips the transform. */
const NL = String.fromCharCode(10);

const SDWAN_CLI = `
config system sdwan
    config zone
        edit "SDWAN_Internet"
        next
    end
    config members
        edit 1
            set interface "wan2"
            set zone "SDWAN_Internet"
        next
    end
    config health-check
        edit "HC_Internet"
            set server "1.1.1.1"
            set members 1
        next
    end
    config service
        edit 1
            set name "Steer_Web"
            set mode manual
            set dst "all"
            set priority-members 1
        next
    end
end`;

describe("hasDestructiveStatement", () => {
  it.each([
    ["delete a policy by id", 'config firewall policy\n    delete 5\nend'],
    ["delete a named object", 'config firewall address\n    delete "LAN-Net"\nend'],
    ["unset a field", 'config user radius\n    edit "NPS"\n        unset secondary-server\n    next\nend'],
    ["purge a table", "config firewall address\n    purge\nend"],
    ["indented delete", 'config firewall policy\n        delete 12\nend'],
    ["uppercase DELETE", 'config firewall policy\n    DELETE 5\nend'],
    ["destructive line among creates", `${ADDRESS_CLI}\nconfig firewall policy\n    delete 5\nend`],
    ["CRLF input", 'config firewall policy\r\n    delete 5\r\nend'],
  ])("flags %s", (_label, cli) => {
    expect(hasDestructiveStatement(cli)).toBe(true);
  });

  it.each([
    ["a plain create", ADDRESS_CLI],
    ["a policy", POLICY_CLI],
    ["empty input", ""],
    // Only a STATEMENT counts — the word inside a value or a comment must not trip the guard,
    // or ordinary objects would be pushed onto the slow SSH path for no reason.
    ["the word inside an object name", 'config firewall address\n    edit "delete-me-later"\n        set subnet 10.0.1.0 255.255.255.0\n    next\nend'],
    ["the word inside a comment value", 'config firewall address\n    edit "A"\n        set comment "we will delete this in Q3"\n    next\nend'],
  ])("does not flag %s", (_label, cli) => {
    expect(hasDestructiveStatement(cli)).toBe(false);
  });
});

describe("canApplyViaREST", () => {
  it("takes the fast path for sections it can build", () => {
    expect(canApplyViaREST(ADDRESS_CLI)).toBe(true);
    expect(canApplyViaREST(POLICY_CLI)).toBe(true);
    expect(canApplyViaREST(ADDRESS_CLI + POLICY_CLI)).toBe(true);
  });

  it("falls back to SSH for a section with no REST endpoint", () => {
    expect(canApplyViaREST("config system ha\n    set mode a-p\nend")).toBe(false);
    // One unknown section drags the WHOLE suggestion to SSH — never half here, half there.
    expect(canApplyViaREST(`${ADDRESS_CLI}\nconfig system ha\n    set mode a-p\nend`)).toBe(false);
  });

  // ⚠️ THE REGRESSION THIS FILE EXISTS FOR. The section IS in REST_SECTIONS, so without the guard
  // this returns true, applyViaREST finds nothing to create, and the delete never happens.
  it("refuses the fast path for a delete, even in a section it can otherwise build", () => {
    expect(canApplyViaREST('config firewall policy\n    delete 5\nend')).toBe(false);
    expect(canApplyViaREST(`${ADDRESS_CLI}\nconfig firewall address\n    delete "Old-Net"\nend`)).toBe(false);
  });

  it("refuses the fast path for an unset", () => {
    expect(canApplyViaREST('config user radius\n    edit "NPS"\n        unset secondary-server\n    next\nend')).toBe(false);
  });

  it("returns false for a CLI with no config blocks at all", () => {
    expect(canApplyViaREST("")).toBe(false);
    expect(canApplyViaREST("get system status")).toBe(false);
  });
});

describe("countRESTApplicable", () => {
  it("counts the objects the applier would look at", () => {
    expect(countRESTApplicable(ADDRESS_CLI)).toBe(1);
    expect(countRESTApplicable(ADDRESS_CLI + POLICY_CLI)).toBe(2);
  });

  it("counts every entry in a multi-edit section", () => {
    expect(countRESTApplicable(`
config firewall address
    edit "A1"
        set subnet 10.0.1.0 255.255.255.0
    next
    edit "A2"
        set subnet 10.0.2.0 255.255.255.0
    next
end`)).toBe(2);
  });

  // This is what separates "already on the device" from "we cannot build this" in the chat's
  // message — the whole point of the second guard.
  it("returns 0 when nothing in the CLI is buildable", () => {
    expect(countRESTApplicable('config firewall policy\n    delete 5\nend')).toBe(0);
    expect(countRESTApplicable("config system ha\n    set mode a-p\nend")).toBe(0);
    expect(countRESTApplicable("")).toBe(0);
  });

  it("ignores sections it has no endpoint for while counting the rest", () => {
    expect(countRESTApplicable(`${ADDRESS_CLI}\nconfig system ha\n    set mode a-p\nend`)).toBe(1);
  });

  // A VPN suggestion is created as ONE object set by the device proxy, so it counts as one.
  it("counts a whole VPN tunnel as a single object", () => {
    const vpn = `
config vpn ipsec phase1-interface
    edit "VPN-HQ"
        set interface "wan1"
        set peertype any
        set proposal aes256-sha256
        set remote-gw 203.0.113.10
        set psksecret "Sh4red!Key"
    next
end
config vpn ipsec phase2-interface
    edit "VPN-HQ-p2"
        set phase1name "VPN-HQ"
        set proposal aes256-sha256
        set src-subnet 10.0.1.0 255.255.255.0
        set dst-subnet 10.0.2.0 255.255.255.0
    next
end`;
    if (canApplyViaREST(vpn)) expect(countRESTApplicable(vpn)).toBe(1);
  });
});

describe("SD-WAN, whose objects are one level deeper than every other section", () => {
  it("takes the REST path", () => {
    // Before it had a parser and a wizard, "system sdwan" was not in REST_SECTIONS and the whole
    // suggestion fell back to shipping the block over SSH — no per-object review, no Fallback.
    expect(canApplyViaREST(SDWAN_CLI)).toBe(true);
  });

  it("counts the objects inside its child tables, not the zero at the top level", () => {
    // `config system sdwan` has no top-level `edit` of its own. Counting it the generic way gives 0,
    // and 0 is what the chat reads as "nothing here is something we build" — so a perfectly good
    // SD-WAN proposal would have warned that applying it may send nothing to the device.
    expect(countRESTApplicable(SDWAN_CLI)).toBe(4);
  });

  it("still refuses a destructive SD-WAN block", () => {
    // Everything here is built out of `edit … next` bodies, so a delete is invisible to it.
    expect(canApplyViaREST([
      "config system sdwan", "  config members", "    delete 1", "  end", "end",
    ].join(NL))).toBe(false);
  });
});
