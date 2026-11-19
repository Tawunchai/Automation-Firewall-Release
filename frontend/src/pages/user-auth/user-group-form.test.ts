import { describe, it, expect } from "vitest";
import {
  buildUserGroupPayload, validateUserGroupForm, userGroupToForm, expireToSeconds,
  takesMembers, takesMatches, remoteServerOptions, BLANK_USER_GROUP_FORM, type UserGroupFormState,
} from "./user-group-form.logic";
import type { UserGroupPayload } from "../../api/policyObject";

// The form is the FortiGate "New User Group" dialog. Everything below is pinned to behaviour
// verified against the lab FortiGate (80E / FortiOS 7.2.10) — see user-group-form.tsx.

const form = (over: Partial<UserGroupFormState> = {}): UserGroupFormState => ({
  ...BLANK_USER_GROUP_FORM, name: "Test-Group", ...over,
});

const guest = (over: Partial<UserGroupFormState> = {}) =>
  form({ groupType: "guest", ...over });

describe("takesMembers", () => {
  it("is true only for the two types the device actually stores members on", () => {
    expect(takesMembers("firewall")).toBe(true);
    expect(takesMembers("fsso-service")).toBe(true);
    // The device silently drops a member list on these (200 + member: []).
    expect(takesMembers("rsso")).toBe(false);
    expect(takesMembers("guest")).toBe(false);
  });
});

describe("expireToSeconds", () => {
  it("defaults to 4 hours — the value the FortiGate dialog pre-fills", () => {
    expect(expireToSeconds(BLANK_USER_GROUP_FORM)).toBe(14400);
  });

  it("sums every unit", () => {
    expect(expireToSeconds(guest({
      expireDays: "1", expireHours: "2", expireMinutes: "3", expireSeconds: "4",
    }))).toBe(86400 + 7200 + 180 + 4);
  });

  it("treats blank/garbage units as zero rather than NaN", () => {
    expect(expireToSeconds(guest({
      expireDays: "", expireHours: "abc", expireMinutes: "5", expireSeconds: "",
    }))).toBe(300);
  });
});

describe("buildUserGroupPayload — firewall / fsso", () => {
  it("sends members and nothing else", () => {
    const p = buildUserGroupPayload(form({ groupType: "firewall", members: ["guest", "alice"] }));
    expect(p).toEqual({ name: "Test-Group", group_type: "firewall", members: ["guest", "alice"] });
  });

  it("trims the name", () => {
    expect(buildUserGroupPayload(form({ name: "  Padded  " })).name).toBe("Padded");
  });

  it("sends members for an FSSO group too", () => {
    const p = buildUserGroupPayload(form({ groupType: "fsso-service", members: ["CN=Sales"] }));
    expect(p.members).toEqual(["CN=Sales"]);
  });

  it("never leaks guest or rsso fields", () => {
    const p = buildUserGroupPayload(form({ groupType: "firewall" }));
    expect(p.expire).toBeUndefined();
    expect(p.user_id).toBeUndefined();
    expect(p.sso_attribute_value).toBeUndefined();
  });
});

describe("buildUserGroupPayload — rsso", () => {
  it("sends only the RADIUS attribute value", () => {
    const p = buildUserGroupPayload(form({
      groupType: "rsso", ssoAttributeValue: " RSSO-Sales ", members: ["guest"],
    }));
    expect(p).toEqual({ name: "Test-Group", group_type: "rsso", sso_attribute_value: "RSSO-Sales" });
    expect(p.members).toBeUndefined();
  });
});

describe("buildUserGroupPayload — guest", () => {
  it("maps the toggle+segment pairs to their FortiOS option values", () => {
    const p = buildUserGroupPayload(guest({
      userId: "specify",
      passwordEnabled: true, password: "specify",
      sponsorEnabled: true, sponsor: "mandatory",
      companyEnabled: true, company: "optional",
      userName: true, email: false, mobilePhone: false,
      expireType: "first-successful-login",
      expireDays: "0", expireHours: "2", expireMinutes: "0", expireSeconds: "0",
    }));
    expect(p).toMatchObject({
      group_type: "guest",
      multiple_guest_add: false,
      user_id: "specify",
      password: "specify",
      user_name: true,
      email: false,
      mobile_phone: false,
      sponsor: "mandatory",
      company: "optional",
      expire_type: "first-successful-login",
      expire: 7200,
      max_accounts: 0,
    });
  });

  it("maps a toggled-off Password/Sponsor/Company to the device's 'off' option", () => {
    const p = buildUserGroupPayload(guest({
      passwordEnabled: false, sponsorEnabled: false, companyEnabled: false,
    }));
    expect(p.password).toBe("disable");
    expect(p.sponsor).toBe("disabled");
    expect(p.company).toBe("disabled");
  });

  it("sends max_accounts 0 (unlimited) when the toggle is off, ignoring a stale number", () => {
    const p = buildUserGroupPayload(guest({ maxAccountsEnabled: false, maxAccounts: "25" }));
    expect(p.max_accounts).toBe(0);
  });

  it("sends the number when the Maximum Accounts toggle is on", () => {
    const p = buildUserGroupPayload(guest({ maxAccountsEnabled: true, maxAccounts: "25" }));
    expect(p.max_accounts).toBe(25);
  });

  it("only sends the SMS keys when Enable SMS is on", () => {
    const off = buildUserGroupPayload(guest({ mobilePhone: false, smsServer: "custom", smsCustomServer: "s1" }));
    expect(off.sms_server).toBeUndefined();
    expect(off.sms_custom_server).toBeUndefined();

    const on = buildUserGroupPayload(guest({ mobilePhone: true, smsServer: "fortiguard" }));
    expect(on.sms_server).toBe("fortiguard");
    // sms_custom_server is a datasource (system.sms-server) — sending it for FortiGuard would
    // come back as "-3 entry not found in datasource".
    expect(on.sms_custom_server).toBeUndefined();

    const custom = buildUserGroupPayload(guest({ mobilePhone: true, smsServer: "custom", smsCustomServer: " s1 " }));
    expect(custom.sms_custom_server).toBe("s1");
  });

  it("never sends members — the device drops them for a guest group", () => {
    expect(buildUserGroupPayload(guest({ members: ["guest"] })).members).toBeUndefined();
  });

  // ⚠️ THE BATCH GOTCHA: with multiple-guest-add=enable the FortiGate forces user-id/password to
  // auto-generate and resets the rest of the Guest Details — while answering 200 "success".
  // Sending them would be a silent no-op, so the payload omits them entirely.
  it("omits the whole Guest Details block under batch mode", () => {
    const p = buildUserGroupPayload(guest({
      multipleGuestAdd: true,
      userId: "specify", passwordEnabled: true, password: "specify",
      userName: true, email: false, mobilePhone: true,
      smsServer: "custom", smsCustomServer: "s1",
      sponsorEnabled: true, sponsor: "mandatory",
      companyEnabled: false,
    }));
    expect(p.multiple_guest_add).toBe(true);
    for (const k of ["user_id", "password", "user_name", "email", "mobile_phone",
                     "sms_server", "sms_custom_server", "sponsor", "company"] as const) {
      expect(p[k]).toBeUndefined();
    }
  });

  it("still sends expiration and max_accounts under batch mode — the device honours those", () => {
    const p = buildUserGroupPayload(guest({
      multipleGuestAdd: true, maxAccountsEnabled: true, maxAccounts: "10",
      expireType: "first-successful-login",
      expireDays: "0", expireHours: "1", expireMinutes: "0", expireSeconds: "0",
    }));
    expect(p).toMatchObject({
      multiple_guest_add: true, max_accounts: 10,
      expire_type: "first-successful-login", expire: 3600,
    });
  });
});

describe("validateUserGroupForm", () => {
  it("accepts each type's happy path", () => {
    expect(validateUserGroupForm(form({ groupType: "firewall" }))).toEqual({});
    expect(validateUserGroupForm(form({ groupType: "fsso-service" }))).toEqual({});
    expect(validateUserGroupForm(form({ groupType: "rsso", ssoAttributeValue: "RSSO-Sales" }))).toEqual({});
    expect(validateUserGroupForm(guest())).toEqual({});
  });

  it("requires a name of at most 35 characters (the FortiOS field size)", () => {
    expect(validateUserGroupForm(form({ name: "   " })).name).toBeTruthy();
    expect(validateUserGroupForm(form({ name: "a".repeat(35) })).name).toBeUndefined();
    expect(validateUserGroupForm(form({ name: "a".repeat(36) })).name).toBeTruthy();
  });

  it("requires the RADIUS attribute value for an RSSO group", () => {
    expect(validateUserGroupForm(form({ groupType: "rsso" })).ssoAttributeValue).toBeTruthy();
    expect(validateUserGroupForm(form({ groupType: "rsso", ssoAttributeValue: " " })).ssoAttributeValue).toBeTruthy();
  });

  it("holds the guest expiration inside the device's 1s-365d range", () => {
    const zero = guest({ expireDays: "0", expireHours: "0", expireMinutes: "0", expireSeconds: "0" });
    expect(validateUserGroupForm(zero).expire).toBeTruthy();

    const oneSec = guest({ expireDays: "0", expireHours: "0", expireMinutes: "0", expireSeconds: "1" });
    expect(validateUserGroupForm(oneSec).expire).toBeUndefined();

    const tooLong = guest({ expireDays: "366", expireHours: "0", expireMinutes: "0", expireSeconds: "0" });
    expect(validateUserGroupForm(tooLong).expire).toBeTruthy();
  });

  it("checks Maximum Accounts only while its toggle is on", () => {
    expect(validateUserGroupForm(guest({ maxAccountsEnabled: false, maxAccounts: "0" })).maxAccounts).toBeUndefined();
    expect(validateUserGroupForm(guest({ maxAccountsEnabled: true, maxAccounts: "0" })).maxAccounts).toBeTruthy();
    expect(validateUserGroupForm(guest({ maxAccountsEnabled: true, maxAccounts: "501" })).maxAccounts).toBeTruthy();
    expect(validateUserGroupForm(guest({ maxAccountsEnabled: true, maxAccounts: "500" })).maxAccounts).toBeUndefined();
  });

  it("requires a custom SMS server to be picked, not typed", () => {
    const missing = guest({ mobilePhone: true, smsServer: "custom", smsCustomServer: "" });
    expect(validateUserGroupForm(missing).smsCustomServer).toBeTruthy();

    const picked = guest({ mobilePhone: true, smsServer: "custom", smsCustomServer: "sms1" });
    expect(validateUserGroupForm(picked).smsCustomServer).toBeUndefined();
  });

  it("does not demand an SMS server under batch mode — the device ignores Enable SMS there", () => {
    const batch = guest({ multipleGuestAdd: true, mobilePhone: true, smsServer: "custom", smsCustomServer: "" });
    expect(validateUserGroupForm(batch)).toEqual({});
  });
});

describe("userGroupToForm", () => {
  it("splits expire seconds back into days/hours/minutes/seconds", () => {
    const f = userGroupToForm({ name: "G", group_type: "guest", expire: 90061 }); // 1d 1h 1m 1s
    expect([f.expireDays, f.expireHours, f.expireMinutes, f.expireSeconds]).toEqual(["1", "1", "1", "1"]);
  });

  it("maps the device's 'off' options back to toggles", () => {
    const f = userGroupToForm({
      name: "G", group_type: "guest", password: "disable", sponsor: "disabled", company: "disabled",
    });
    expect(f.passwordEnabled).toBe(false);
    expect(f.sponsorEnabled).toBe(false);
    expect(f.companyEnabled).toBe(false);
    // The segment keeps a sane value to fall back on when the toggle is switched on again.
    expect(f.password).toBe("auto-generate");
    expect(f.sponsor).toBe("optional");
  });

  it("derives the Maximum Accounts toggle from the number (0 = unlimited = off)", () => {
    expect(userGroupToForm({ name: "G", group_type: "guest", max_accounts: 0 }).maxAccountsEnabled).toBe(false);
    expect(userGroupToForm({ name: "G", group_type: "guest", max_accounts: 25 }).maxAccountsEnabled).toBe(true);
  });

  it("falls back to the dialog's defaults for a sparse device response", () => {
    const f = userGroupToForm({ name: "G", group_type: "guest" });
    expect(f.expireHours).toBe("4");       // 14400s default
    expect(f.userId).toBe("email");
    expect(f.passwordEnabled).toBe(true);
    expect(f.expireType).toBe("immediately");
  });
});

describe("round trip: device → form → payload", () => {
  it("preserves a full guest group unchanged", () => {
    const fromDevice: UserGroupPayload = {
      name: "Guests", group_type: "guest",
      multiple_guest_add: false,
      user_id: "specify", password: "specify",
      user_name: true, email: false, mobile_phone: true, sms_server: "fortiguard",
      sponsor: "mandatory", company: "disabled",
      expire_type: "first-successful-login", expire: 7200, max_accounts: 25,
    };
    expect(buildUserGroupPayload(userGroupToForm(fromDevice))).toEqual(fromDevice);
  });

  it("preserves a firewall group with members", () => {
    const fromDevice: UserGroupPayload = { name: "Office", group_type: "firewall", members: ["guest"] };
    expect(buildUserGroupPayload(userGroupToForm(fromDevice))).toEqual(fromDevice);
  });

  it("preserves an rsso group", () => {
    const fromDevice: UserGroupPayload = { name: "RSSO", group_type: "rsso", sso_attribute_value: "RSSO-Sales" };
    expect(buildUserGroupPayload(userGroupToForm(fromDevice))).toEqual(fromDevice);
  });

  it("preserves a batch guest group (the fields the device actually keeps)", () => {
    const fromDevice: UserGroupPayload = {
      name: "Batch", group_type: "guest", multiple_guest_add: true,
      expire_type: "immediately", expire: 14400, max_accounts: 10,
    };
    expect(buildUserGroupPayload(userGroupToForm(fromDevice))).toEqual(fromDevice);
  });
});

// ─── Remote Groups (user/group `match`) ────────────────────────────────────────
// Verified live on FortiOS 7.2.10:
//   · a match whose server is not also a MEMBER → -518, the whole group is discarded
//   · an unknown server-name → -3 (it is a datasource over user.ldap/radius/tacacs+/saml)
//   · match on a guest/rsso group → 200 with match=[] stored (silent drop)
//   · fsso-service cannot hold the auth server as a member at all → -3

describe("takesMatches", () => {
  it("is Firewall-only", () => {
    expect(takesMatches("firewall")).toBe(true);
    for (const t of ["fsso-service", "rsso", "guest"] as const) {
      expect(takesMatches(t)).toBe(false);
    }
  });
});

describe("remoteServerOptions", () => {
  it("keeps only the sources a match row can name", () => {
    const opts = {
      firewall: [
        { name: "alice", source: "Local" },
        { name: "AD-Corp", source: "LDAP" },
        { name: "NPS", source: "RADIUS" },
        { name: "TAC1", source: "TACACS+" },
        { name: "SAML1", source: "SAML" },
        { name: "peer1", source: "PKI" },
        { name: "cert1", source: "Certificate" },
      ],
      fsso: [], sms_servers: [],
    };
    expect(remoteServerOptions(opts).map((m) => m.name))
      .toEqual(["AD-Corp", "NPS", "TAC1", "SAML1"]);
  });
});

describe("user group matches — validation", () => {
  const withMatches = (matches: { server_name: string; group_name: string }[]) => ({
    ...BLANK_USER_GROUP_FORM, name: "AD-VPN", groupType: "firewall" as const,
    members: ["AD-Corp"], matches,
  });

  it("accepts a complete row", () => {
    expect(validateUserGroupForm(withMatches([
      { server_name: "AD-Corp", group_name: "CN=VPN-Users,OU=Groups,DC=corp,DC=local" },
    ]))).toEqual({});
  });

  it("accepts several rows on the same server", () => {
    expect(validateUserGroupForm(withMatches([
      { server_name: "AD-Corp", group_name: "CN=A,DC=corp" },
      { server_name: "AD-Corp", group_name: "CN=B,DC=corp" },
    ]))).toEqual({});
  });

  it("flags a row with no server", () => {
    expect(validateUserGroupForm(withMatches([{ server_name: "", group_name: "CN=A" }])))
      .toHaveProperty("match.0.server");
  });

  it("flags a row with no group name", () => {
    expect(validateUserGroupForm(withMatches([{ server_name: "AD-Corp", group_name: "  " }])))
      .toHaveProperty("match.0.group");
  });

  it("flags a group name over 511 characters", () => {
    expect(validateUserGroupForm(withMatches([{ server_name: "AD-Corp", group_name: "C".repeat(512) }])))
      .toHaveProperty("match.0.group");
  });

  // FortiOS keys the table by id, so a repeated pair silently collapses into one row.
  it("flags a duplicated server+group pair", () => {
    const errs = validateUserGroupForm(withMatches([
      { server_name: "AD-Corp", group_name: "CN=A,DC=corp" },
      { server_name: "AD-Corp", group_name: "CN=A,DC=corp" },
    ]));
    expect(errs).toHaveProperty("match.1.group");
    expect(errs).not.toHaveProperty("match.0.group");
  });

  it("ignores matches on a type that cannot carry them", () => {
    expect(validateUserGroupForm({
      ...BLANK_USER_GROUP_FORM, name: "G", groupType: "guest",
      matches: [{ server_name: "", group_name: "" }],
    })).toEqual({});
  });
});

describe("user group matches — payload", () => {
  it("sends trimmed rows for a firewall group", () => {
    const p = buildUserGroupPayload({
      ...BLANK_USER_GROUP_FORM, name: "AD-VPN", groupType: "firewall", members: ["AD-Corp"],
      matches: [{ server_name: " AD-Corp ", group_name: " CN=VPN-Users,DC=corp " }],
    });
    expect(p.matches).toEqual([{ server_name: "AD-Corp", group_name: "CN=VPN-Users,DC=corp" }]);
  });

  it("omits the key entirely when there are no rows", () => {
    const p = buildUserGroupPayload({
      ...BLANK_USER_GROUP_FORM, name: "G", groupType: "firewall", members: ["alice"], matches: [],
    });
    expect("matches" in p).toBe(false);
  });

  it("never sends matches on a non-firewall group", () => {
    const p = buildUserGroupPayload({
      ...BLANK_USER_GROUP_FORM, name: "G", groupType: "fsso-service", members: ["CN=Sales"],
      matches: [{ server_name: "AD-Corp", group_name: "CN=A" }],
    });
    expect("matches" in p).toBe(false);
  });

  it("round-trips through userGroupToForm", () => {
    const matches = [{ server_name: "AD-Corp", group_name: "CN=VPN-Users,DC=corp" }];
    const back = userGroupToForm(buildUserGroupPayload({
      ...BLANK_USER_GROUP_FORM, name: "AD-VPN", groupType: "firewall",
      members: ["AD-Corp"], matches,
    }));
    expect(back.matches).toEqual(matches);
  });

  it("defaults to an empty list when the device returns none", () => {
    expect(userGroupToForm({ name: "G", group_type: "firewall", members: [] }).matches).toEqual([]);
  });
});
