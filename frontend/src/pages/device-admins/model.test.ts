import { describe, expect, it } from "vitest";
import {
  BLANK_ADMIN, buildPayload, describeProfile, describeReach, describeTwoFactor, draftFrom,
  exposedAdmins, isLastSuperAdmin, locksOutAdmin, looksLikeTrustHost, splitHosts, validateDraft,
  type AdminDraft,
} from "./model";
import type { AccProfile, AdminUser } from "../../api/systemSettings";

// Two of these rules decide whether anybody can still administer the firewall afterwards. They
// mirror the server's; if the two disagreed the form would offer a button that always fails, or
// refuse a change the device is willing to take.

const admin = (over: Partial<AdminUser> = {}): AdminUser => ({
  name: "admin", accprofile: "super_admin", comments: "",
  trust_hosts: [], restricted_to_hosts: false, two_factor: "disable",
  remote_auth: false, remote_group: "", vdoms: [], ssh_public_key_set: false,
  is_super_admin: true,
  ...over,
});

const draft = (over: Partial<AdminDraft> = {}): AdminDraft => ({
  ...BLANK_ADMIN, name: "ops", accprofile: "prof_admin", password: "s3cret", ...over,
});

describe("buildPayload", () => {
  it("omits the password when it is being left alone", () => {
    // The field whose empty string would wipe the account's password. The device never returns one,
    // so an edit that did not touch it must not send one.
    const p = buildPayload(draft({ keepPassword: true, password: "" }));
    expect("password" in p).toBe(false);
  });

  it("sends the password when it is being set", () => {
    expect(buildPayload(draft({ keepPassword: false, password: "new" })).password).toBe("new");
  });

  it("only sends the lockout confirmation when it has been given", () => {
    expect(buildPayload(draft()).confirm_lockout).toBeUndefined();
    expect(buildPayload(draft(), true).confirm_lockout).toBe(true);
  });

  it("splits trusted hosts on newlines and commas", () => {
    const p = buildPayload(draft({ trustHosts: "10.0.0.0/24\n192.168.1.0/24, 172.16.0.0/16" }));
    expect(p.trust_hosts).toEqual(["10.0.0.0/24", "192.168.1.0/24", "172.16.0.0/16"]);
  });
});

describe("draftFrom", () => {
  it("opens an edit with the password left alone", () => {
    expect(draftFrom(admin()).keepPassword).toBe(true);
  });

  it("opens an edit with a null trust_hosts instead of throwing", () => {
    // Confirmed on the live device: an unrestricted account's trust_hosts comes back `null`.
    expect(draftFrom(admin({ trust_hosts: null })).trustHosts).toBe("");
  });
});

describe("locksOutAdmin", () => {
  it("fires when an account reachable from anywhere is restricted", () => {
    // Verified live: with a trusted host set to a subnet the caller was not in, the same login that
    // had worked a moment earlier was refused.
    expect(locksOutAdmin(admin({ trust_hosts: [] }), draft({ trustHosts: "10.0.0.0/24" }))).toBe(true);
  });

  it("fires when an existing list is narrowed", () => {
    const current = admin({ trust_hosts: ["10.0.0.0/24", "192.168.1.0/24"], restricted_to_hosts: true });
    expect(locksOutAdmin(current, draft({ trustHosts: "10.0.0.0/24" }))).toBe(true);
  });

  it("stays quiet when access is widened or unchanged", () => {
    const current = admin({ trust_hosts: ["10.0.0.0/24"], restricted_to_hosts: true });
    expect(locksOutAdmin(current, draft({ trustHosts: "10.0.0.0/24\n192.168.1.0/24" }))).toBe(false);
    expect(locksOutAdmin(current, draft({ trustHosts: "10.0.0.0/24" }))).toBe(false);
    expect(locksOutAdmin(current, draft({ trustHosts: "" }))).toBe(false);
  });

  it("stays quiet on a create — a new account grants access, it cannot remove any", () => {
    expect(locksOutAdmin(null, draft({ trustHosts: "10.0.0.0/24" }))).toBe(false);
  });
});

describe("isLastSuperAdmin", () => {
  it("recognises the only account that can fully administer the firewall", () => {
    const list = [admin({ name: "admin" }), admin({ name: "ops", accprofile: "prof_admin", is_super_admin: false })];
    expect(isLastSuperAdmin(list, "admin")).toBe(true);
    expect(isLastSuperAdmin(list, "ops")).toBe(false);
  });

  it("says no once there are two", () => {
    const list = [admin({ name: "admin" }), admin({ name: "admin2" })];
    expect(isLastSuperAdmin(list, "admin")).toBe(false);
  });
});

describe("validateDraft", () => {
  it("accepts a workable account", () => {
    expect(validateDraft(draft(), true)).toBeNull();
  });

  it("insists a new local account has a password", () => {
    expect(validateDraft(draft({ password: "" }), true)).toMatch(/needs a password/i);
  });

  it("lets an edit keep the password it cannot read", () => {
    expect(validateDraft(draft({ password: "", keepPassword: true }), false)).toBeNull();
  });

  it("catches an edit that cleared the box without ticking keep", () => {
    expect(validateDraft(draft({ password: "", keepPassword: false }), false)).toMatch(/new password/i);
  });

  it("asks a remote account for its group instead of a password", () => {
    expect(validateDraft(draft({ password: "", remoteAuth: true, remoteGroup: "ldap" }), true)).toBeNull();
    expect(validateDraft(draft({ password: "", remoteAuth: true, remoteGroup: "" }), true)).toMatch(/remote group/i);
  });

  it("refuses a trusted host that is not a subnet", () => {
    // A bare word lands in the field and matches nothing, which locks the account out while the
    // screen shows a restriction that looks deliberate.
    expect(validateDraft(draft({ trustHosts: "office" }), false)).toMatch(/not a subnet/i);
  });
});

describe("looksLikeTrustHost", () => {
  it("accepts both spellings FortiOS takes", () => {
    expect(looksLikeTrustHost("10.0.0.0/24")).toBe(true);
    expect(looksLikeTrustHost("10.0.0.0 255.255.255.0")).toBe(true);
  });

  it("rejects the rest", () => {
    for (const s of ["office", "10.0.0.0", "10.0.0.0/33", "10.0.0.256/24", ""]) {
      expect(looksLikeTrustHost(s), s).toBe(false);
    }
  });
});

describe("describeReach", () => {
  it("never lets an empty list read as 'not configured'", () => {
    // `0.0.0.0 0.0.0.0` in every slot means ANY HOST — the most permissive setting there is.
    expect(describeReach(admin({ trust_hosts: [], restricted_to_hosts: false }))).toBe("From any address");
    expect(describeReach(admin({ trust_hosts: ["10.0.0.0/24"], restricted_to_hosts: true })))
      .toBe("Only from 10.0.0.0/24");
  });
});

describe("describeTwoFactor", () => {
  it("reads the METHOD name as a state", () => {
    expect(describeTwoFactor(admin({ two_factor: "disable" }))).toBe("No second factor");
    expect(describeTwoFactor(admin({ two_factor: "" }))).toBe("No second factor");
    expect(describeTwoFactor(admin({ two_factor: "fortitoken" }))).toMatch(/fortitoken/);
  });
});

describe("exposedAdmins", () => {
  it("flags the combination that turns one leaked password into a lost firewall", () => {
    const list = [
      admin({ name: "wide-open" }),
      admin({ name: "restricted", trust_hosts: ["10.0.0.0/24"], restricted_to_hosts: true }),
      admin({ name: "2fa", two_factor: "fortitoken" }),
    ];
    expect(exposedAdmins(list).map((a) => a.name)).toEqual(["wide-open"]);
  });
});

describe("describeProfile", () => {
  const profile = (over: Partial<AccProfile> = {}): AccProfile => ({
    name: "prof_admin", scope: "vdom", comments: "", permissions: {},
    write_groups: [], is_super_admin: false, ...over,
  });

  it("never describes super_admin as powerless", () => {
    // Every permission group reads as `none` on the wire for super_admin while the profile can do
    // everything.
    expect(describeProfile(profile({ name: "super_admin", is_super_admin: true })))
      .toBe("Full control of the device");
  });

  it("says read-only when nothing can be changed", () => {
    expect(describeProfile(profile())).toBe("Read-only");
  });

  it("lists what a profile can change", () => {
    expect(describeProfile(profile({ write_groups: ["Network", "VPN"] }))).toBe("Can change: Network, VPN");
  });

  it("says so when the profile is not in the list at all", () => {
    expect(describeProfile(undefined)).toBe("Unknown profile");
  });

  it("reads a null write_groups as read-only instead of throwing", () => {
    // FortiOS/Go sends `null`, not `[]`, for a profile with nothing in write_groups — a nil Go
    // slice marshals that way. This crashed the whole page (white screen) before the null check.
    expect(describeProfile(profile({ write_groups: null }))).toBe("Read-only");
  });
});

describe("splitHosts", () => {
  it("survives the spacing people type", () => {
    expect(splitHosts(" 10.0.0.0/24 ,\n\n 192.168.1.0/24 \n")).toEqual(["10.0.0.0/24", "192.168.1.0/24"]);
    expect(splitHosts("")).toEqual([]);
  });
});
