import { describe, expect, it } from "vitest";
import { SNMP_EVENTS, type SNMPCommunity, type SNMPUser } from "../../api/snmp";
import {
  COMMUNITY_DEFAULT_OFF_EVENTS,
  communityToForm, communityToPayload, emptyCommunityForm,
  emptyUserForm, userToForm, userToPayload,
  validateCommunityForm, validateUserForm,
} from "./model";

const ALL = SNMP_EVENTS.map((e) => e.name);

const baseUser: SNMPUser = {
  name: "zabbix_snmp", status: true, security_level: "auth-priv",
  auth_proto: "sha256", priv_proto: "aes256",
  has_auth_pwd: true, has_priv_pwd: true,
  notify_hosts: ["192.168.156.160"],
  queries: true, query_port: 161,
  trap_status: true, trap_lport: 162, trap_rport: 162,
  events: ["cpu-high", "mem-low"],
};

const baseCommunity: SNMPCommunity = {
  id: 1, name: "public", status: true,
  hosts: [{ id: 1, ip: "10.0.0.5", host_type: "any" }],
  query_v1_status: true, query_v1_port: 161,
  query_v2c_status: true, query_v2c_port: 161,
  trap_v1_status: true, trap_v1_lport: 162, trap_v1_rport: 162,
  trap_v2c_status: true, trap_v2c_lport: 162, trap_v2c_rport: 162,
  events: ["cpu-high"],
};

describe("SNMP event catalogue", () => {
  it("matches the 42 the device offers, with no duplicate names or labels", () => {
    expect(SNMP_EVENTS).toHaveLength(42);
    expect(new Set(ALL).size).toBe(42);
    expect(new Set(SNMP_EVENTS.map((e) => e.label)).size).toBe(42);
  });

  it("carries the two events FortiOS leaves out of its own default", () => {
    // These are the two toggles FortiGate's dialog shows OFF. A catalogue built from the device's
    // default value instead of its schema would be missing exactly these.
    for (const name of COMMUNITY_DEFAULT_OFF_EVENTS) {
      expect(ALL).toContain(name);
    }
  });
});

describe("new-community defaults", () => {
  it("subscribes to everything except the two FortiOS itself leaves off", () => {
    const f = emptyCommunityForm(ALL);
    expect(f.events).toHaveLength(40);
    for (const off of COMMUNITY_DEFAULT_OFF_EVENTS) {
      expect(f.events).not.toContain(off);
    }
    expect(f.events).toContain("cpu-high");
  });

  it("opens with the standard ports and one empty host row", () => {
    const f = emptyCommunityForm(ALL);
    expect(f.query_v1_port).toBe("161");
    expect(f.trap_v2c_rport).toBe("162");
    expect(f.hosts).toHaveLength(1);
    expect(f.hosts[0].ip).toBe("");
  });
});

describe("communityToPayload", () => {
  it("drops blank host rows and coerces ports back to numbers", () => {
    const f = emptyCommunityForm(ALL);
    f.name = "  public  ";
    f.hosts = [
      { id: 0, ip: "10.0.0.5", host_type: "any" },
      { id: 0, ip: "   ", host_type: "any" },
      { id: 7, ip: "10.0.0.6", host_type: "trap" },
    ];
    const p = communityToPayload(f);
    expect(p.name).toBe("public");
    expect(p.hosts).toHaveLength(2);
    expect(p.hosts[1]).toMatchObject({ id: 7, ip: "10.0.0.6", host_type: "trap" });
    expect(p.query_v1_port).toBe(161);
  });

  it("falls back to the protocol port when the box was cleared", () => {
    // A half-typed port is held as a string; an empty one must not reach the device as 0, which
    // FortiOS accepts and then answers nothing on.
    const f = emptyCommunityForm(ALL);
    f.query_v2c_port = "";
    f.trap_v1_lport = "abc";
    const p = communityToPayload(f);
    expect(p.query_v2c_port).toBe(161);
    expect(p.trap_v1_lport).toBe(162);
  });

  it("round-trips a community off the device without changing it", () => {
    const p = communityToPayload(communityToForm(baseCommunity));
    expect(p).toMatchObject({
      name: "public", status: true,
      query_v1_port: 161, trap_v2c_rport: 162,
      events: ["cpu-high"],
    });
    expect(p.hosts).toEqual([{ id: 1, ip: "10.0.0.5", host_type: "any" }]);
  });

  it("gives a community with no hosts an empty row to fill rather than none", () => {
    const f = communityToForm({ ...baseCommunity, hosts: [] });
    expect(f.hosts).toHaveLength(1);
    expect(f.hosts[0].ip).toBe("");
  });
});

describe("userToForm", () => {
  it("never prefills a password, however sure the device is that one exists", () => {
    // The device returns `ENC XXXX`, the API turns that into has_*_pwd. Putting anything in the
    // box would turn "I did not touch it" into a password change on the next save.
    const f = userToForm(baseUser);
    expect(f.auth_pwd).toBe("");
    expect(f.priv_pwd).toBe("");
    expect(f.auth_proto).toBe("sha256");
    expect(f.security_level).toBe("auth-priv");
  });
});

describe("userToPayload", () => {
  it("omits a blank password so the stored one survives the edit", () => {
    const f = userToForm(baseUser);
    const p = userToPayload(f);
    expect("auth_pwd" in p).toBe(false);
    expect("priv_pwd" in p).toBe(false);
  });

  it("sends a password the operator actually typed", () => {
    const f = userToForm(baseUser);
    f.auth_pwd = "new-auth";
    f.priv_pwd = "new-priv";
    const p = userToPayload(f);
    expect(p.auth_pwd).toBe("new-auth");
    expect(p.priv_pwd).toBe("new-priv");
  });

  it("drops the fields the chosen security level does not have", () => {
    // FortiOS rejects priv-proto outright on an auth-no-priv user, so a level change must not
    // carry a field the new level has no room for.
    const f = emptyUserForm(ALL);
    f.name = "ro";
    f.security_level = "auth-no-priv";
    f.auth_pwd = "x";
    f.priv_pwd = "should-not-be-sent";
    const p = userToPayload(f);
    expect(p.auth_proto).toBe("sha");
    expect(p.priv_proto).toBe("");
    expect("priv_pwd" in p).toBe(false);

    f.security_level = "no-auth-no-priv";
    const none = userToPayload(f);
    expect(none.auth_proto).toBe("");
    expect("auth_pwd" in none).toBe(false);
  });

  it("drops blank notify-host rows", () => {
    const f = emptyUserForm(ALL);
    f.notify_hosts = [{ id: 0, ip: "10.0.0.1", host_type: "any" }, { id: 0, ip: " ", host_type: "any" }];
    expect(userToPayload(f).notify_hosts).toEqual(["10.0.0.1"]);
  });
});

describe("validation", () => {
  it("refuses a community with no hosts, which the device would accept and open to everyone", () => {
    const f = emptyCommunityForm(ALL);
    f.name = "public";
    expect(validateCommunityForm(f)).toMatch(/at least one host/i);
    f.hosts = [{ id: 0, ip: "10.0.0.5", host_type: "any" }];
    expect(validateCommunityForm(f)).toBe("");
  });

  it("requires a password on CREATE at an auth level but not on EDIT", () => {
    const f = emptyUserForm(ALL);
    f.name = "u";
    f.security_level = "auth-priv";
    f.notify_hosts = [{ id: 0, ip: "10.0.0.1", host_type: "any" }];
    expect(validateUserForm(f, false)).toMatch(/authentication password/i);
    // On an edit a blank box is the normal case and means "keep the stored one".
    expect(validateUserForm(f, true)).toBe("");
  });

  it("refuses traps with nowhere to send them", () => {
    const f = emptyUserForm(ALL);
    f.name = "u";
    expect(validateUserForm(f, true)).toMatch(/no notify host/i);
    f.trap_status = false;
    expect(validateUserForm(f, true)).toBe("");
  });
});
