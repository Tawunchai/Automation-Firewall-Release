import { describe, expect, it } from "vitest";
import {
  BLANK_DRAFT, buildPayload, clearingDomain, describeDNS, describeLease, describeServer,
  draftFrom, isBeyondThisForm, parseIP, validateDraft, type DHCPDraft,
} from "./model";
import type { DHCPServer } from "../../api/dhcp";

// Every rule here stops a form from producing a server the firewall accepts and nobody gets an
// address from. FortiOS validates almost none of this: a server with no range, or one whose range
// runs backwards, answers 200 and then leases nothing.

const draft = (over: Partial<DHCPDraft> = {}): DHCPDraft => ({
  ...BLANK_DRAFT,
  interface: "dmz",
  ip_ranges: [{ start_ip: "10.10.10.100", end_ip: "10.10.10.150" }],
  ...over,
});

const server = (over: Partial<DHCPServer> = {}): DHCPServer => ({
  id: 1, status: true, interface: "dmz",
  ip_ranges: [{ id: 1, start_ip: "10.10.10.100", end_ip: "10.10.10.150" }],
  exclude_ranges: [], netmask: "255.255.255.0", default_gateway: "10.10.10.1",
  dns_service: "default", dns_servers: [], ntp_service: "default", ntp_servers: [],
  lease_time: 604800, domain: "", reservations: [], server_type: "regular", ip_mode: "range",
  ...over,
});

describe("isBeyondThisForm", () => {
  it("flags a server that takes addresses from a user group", () => {
    expect(isBeyondThisForm(server({ ip_mode: "usrgrp" }))).toBe(true);
  });

  it("flags a dial-up VPN server", () => {
    expect(isBeyondThisForm(server({ server_type: "ipsec" }))).toBe(true);
  });

  it("is quiet about a plain range server", () => {
    expect(isBeyondThisForm(server())).toBe(false);
  });
});

describe("validateDraft", () => {
  it("accepts a server that will actually hand out leases", () => {
    expect(validateDraft(draft())).toBeNull();
  });

  it("refuses a server with no address range", () => {
    expect(validateDraft(draft({ ip_ranges: [{ start_ip: "", end_ip: "" }] }))).toMatch(/at least one address range/i);
  });

  it("refuses a half-filled range", () => {
    expect(validateDraft(draft({ ip_ranges: [{ start_ip: "10.0.0.1", end_ip: "" }] }))).toMatch(/start and an end/i);
  });

  it("compares range order numerically, not as text", () => {
    // The case that a string comparison gets wrong: "192.168.1.9" sorts AFTER "192.168.1.10".
    expect(validateDraft(draft({ ip_ranges: [{ start_ip: "192.168.1.9", end_ip: "192.168.1.10" }] }))).toBeNull();
    expect(validateDraft(draft({ ip_ranges: [{ start_ip: "10.0.0.50", end_ip: "10.0.0.20" }] })))
      .toMatch(/ends before it starts/i);
  });

  it("refuses something that is not an address", () => {
    expect(validateDraft(draft({ ip_ranges: [{ start_ip: "10.0.0.999", end_ip: "10.0.0.20" }] })))
      .toMatch(/not an IPv4 address/i);
    expect(validateDraft(draft({ netmask: "not-a-mask" }))).toMatch(/not a netmask/i);
    expect(validateDraft(draft({ default_gateway: "10.10.10" }))).toMatch(/not an IPv4 address/i);
  });

  it("refuses Specify with no DNS server, because that mode uses nothing else", () => {
    expect(validateDraft(draft({ dns_service: "specify", dns_servers: [] }))).toMatch(/at least one DNS server/i);
    expect(validateDraft(draft({ dns_service: "specify", dns_servers: ["8.8.8.8"] }))).toBeNull();
  });

  it("checks MAC shape, because the device stores a bad one and never matches it", () => {
    expect(validateDraft(draft({
      reservations: [{ mac: "0011.2233.4455", ip: "10.10.10.140", action: "reserved", description: "" }],
    }))).toMatch(/not a MAC address/i);
    expect(validateDraft(draft({
      reservations: [{ mac: "00:11:22:33:44:55", ip: "10.10.10.140", action: "reserved", description: "" }],
    }))).toBeNull();
  });

  it("lets a blocked MAC have no address — blocking is not reserving", () => {
    expect(validateDraft(draft({
      reservations: [{ mac: "00:11:22:33:44:55", ip: "", action: "block", description: "" }],
    }))).toBeNull();
  });

  it("refuses a reservation with no address", () => {
    expect(validateDraft(draft({
      reservations: [{ mac: "00:11:22:33:44:55", ip: "", action: "reserved", description: "" }],
    }))).toMatch(/needs an IPv4 address/i);
  });
});

describe("buildPayload", () => {
  it("drops the blank rows the form leaves behind", () => {
    const p = buildPayload(draft({
      ip_ranges: [{ start_ip: "10.0.0.1", end_ip: "10.0.0.9" }, { start_ip: "", end_ip: "" }],
      reservations: [{ mac: "", ip: "", action: "reserved", description: "" }],
    }));
    expect(p.ip_ranges).toHaveLength(1);
    expect(p.reservations).toHaveLength(0);
  });

  it("keeps the device's row ids so an edit does not renumber the table", () => {
    const p = buildPayload(draft({ ip_ranges: [{ id: 7, start_ip: "10.0.0.1", end_ip: "10.0.0.9" }] }));
    expect(p.ip_ranges[0].id).toBe(7);
  });
});

describe("draftFrom", () => {
  it("gives an empty server a row to type in", () => {
    // Without this the operator could not add the range the server is missing.
    expect(draftFrom(server({ ip_ranges: [] })).ip_ranges).toHaveLength(1);
  });

  it("round-trips a server through the form unchanged", () => {
    const s = server({
      dns_service: "specify", dns_servers: ["8.8.8.8", "1.1.1.1"], lease_time: 3600,
      exclude_ranges: [{ id: 1, start_ip: "10.10.10.120", end_ip: "10.10.10.125" }],
      reservations: [{ id: 1, mac: "00:11:22:33:44:55", ip: "10.10.10.140", action: "reserved", description: "n" }],
    });
    const p = buildPayload(draftFrom(s));
    expect(p.dns_servers).toEqual(["8.8.8.8", "1.1.1.1"]);
    expect(p.exclude_ranges).toEqual([{ id: 1, start_ip: "10.10.10.120", end_ip: "10.10.10.125" }]);
    expect(p.reservations[0].mac).toBe("00:11:22:33:44:55");
    expect(p.lease_time).toBe(3600);
  });
});

describe("clearingDomain", () => {
  // FortiOS 7.2.10 keeps the old domain and answers 200 — probed on the lab FGT80E with "",
  // " " and null. The form has to say so before the operator believes it worked.
  it("fires when a set domain is emptied", () => {
    expect(clearingDomain(server({ domain: "corp.local" }), draft({ domain: "" }))).toBe(true);
  });

  it("does not fire when the domain is being changed", () => {
    expect(clearingDomain(server({ domain: "corp.local" }), draft({ domain: "other.local" }))).toBe(false);
  });

  it("does not fire on a server that never had one", () => {
    expect(clearingDomain(server({ domain: "" }), draft({ domain: "" }))).toBe(false);
  });

  it("does not fire on a create — there is nothing to fail to clear", () => {
    expect(clearingDomain(null, draft({ domain: "" }))).toBe(false);
  });
});

describe("describeLease", () => {
  it("names the round numbers", () => {
    expect(describeLease(604800)).toBe("7 days");
    expect(describeLease(86400)).toBe("1 day");
    expect(describeLease(3600)).toBe("1 hour");
    expect(describeLease(1800)).toBe("30 minutes");
  });

  it("falls back to seconds for anything else", () => {
    expect(describeLease(5000)).toBe("5000 seconds");
  });
});

describe("describeDNS", () => {
  it("says which mode is in force, not just the addresses", () => {
    // A server on `default` with addresses set is NOT using them, and that is the whole point.
    expect(describeDNS({ dns_service: "default", dns_servers: ["8.8.8.8"] })).toBe("Same as the system DNS");
    expect(describeDNS({ dns_service: "local", dns_servers: [] })).toBe("The FortiGate itself");
    expect(describeDNS({ dns_service: "specify", dns_servers: ["8.8.8.8"] })).toBe("8.8.8.8");
  });

  it("calls out Specify with nothing specified — the live state of the lab fortilink server", () => {
    expect(describeDNS({ dns_service: "specify", dns_servers: [] })).toMatch(/no server is set/i);
  });
});

describe("describeServer", () => {
  it("says a server has no range rather than showing an empty line", () => {
    expect(describeServer(server({ ip_ranges: [] }))).toMatch(/no address range/i);
  });
});

describe("parseIP", () => {
  it("rejects what is not an address", () => {
    for (const s of ["", "10.0.0", "10.0.0.256", "10.0.0.1.5", "ten.0.0.1", "10.0.0.-1"]) {
      expect(parseIP(s), s).toBeNull();
    }
    expect(parseIP("255.255.255.255")).toBe(4294967295);
  });
});
