import { describe, it, expect } from "vitest";
import { buildLocalUserPayload, localUserToForm, validateStep, validateLocalUserForm, WIZARD_STEPS, USER_TYPE_OPTIONS, COUNTRY_DIAL_CODES, BLANK_LOCAL_USER_FORM, type LocalUserFormState } from "./user-definition-form.logic";
import type { LocalUserPayload } from "../../api/policyObject";

// The FortiGate "Users/Groups Creation Wizard", Local User branch. Rules marked "device" were
// verified against the lab FortiGate (80E / FortiOS 7.2.10) — see services/fortigate.go.

const form = (over: Partial<LocalUserFormState> = {}): LocalUserFormState => ({
  ...BLANK_LOCAL_USER_FORM, name: "alice", password: "S3cret!", ...over,
});

const with2fa = (over: Partial<LocalUserFormState> = {}) =>
  form({ twoFactorEnabled: true, ...over });

describe("wizard shape", () => {
  it("has the four steps the FortiGate dialog shows, in order", () => {
    expect(WIZARD_STEPS).toEqual(["User Type", "Login Credentials", "Contact Info", "Extra Info"]);
  });

  it("offers every user type but enables only Local User", () => {
    expect(USER_TYPE_OPTIONS.map((o) => o.l)).toEqual([
      "Local User", "Remote RADIUS User", "Remote TACACS+ User",
      "Remote LDAP User", "FSSO", "FortiNAC User",
    ]);
    expect(USER_TYPE_OPTIONS.filter((o) => o.enabled).map((o) => o.v)).toEqual(["password"]);
  });

  it("defaults to Local User, enabled, 2FA off — the dialog's initial state", () => {
    expect(BLANK_LOCAL_USER_FORM.userType).toBe("password");
    expect(BLANK_LOCAL_USER_FORM.status).toBe(true);
    expect(BLANK_LOCAL_USER_FORM.twoFactorEnabled).toBe(false);
    expect(BLANK_LOCAL_USER_FORM.authType).toBe("fortitoken-cloud");
  });

  it("ships dial codes with no duplicates", () => {
    const codes = COUNTRY_DIAL_CODES.map((c) => c.code);
    expect(codes.length).toBeGreaterThan(20);
    expect(new Set(codes).size).toBe(codes.length);
    expect(codes.every((c) => /^\+\d+$/.test(c))).toBe(true);
  });
});

describe("validateStep — 1 User Type", () => {
  it("accepts Local User", () => {
    expect(validateStep(0, form())).toEqual({});
  });
  it("rejects any other type", () => {
    expect(validateStep(0, form({ userType: "radius" as never })).userType).toBeTruthy();
  });
});

describe("validateStep — 2 Login Credentials", () => {
  it("accepts a username and password", () => {
    expect(validateStep(1, form())).toEqual({});
  });
  it("requires a username of at most 64 chars", () => {
    expect(validateStep(1, form({ name: "  " })).name).toBeTruthy();
    expect(validateStep(1, form({ name: "a".repeat(64) })).name).toBeUndefined();
    expect(validateStep(1, form({ name: "a".repeat(65) })).name).toBeTruthy();
  });
  it("requires a password", () => {
    expect(validateStep(1, form({ password: "" })).password).toBeTruthy();
  });
});

describe("validateStep — 3 Contact Info", () => {
  it("checks nothing while 2FA is off", () => {
    expect(validateStep(2, form({ twoFactorEnabled: false, emailTo: "nonsense" }))).toEqual({});
  });

  // device: two-factor=fortitoken with no serial ⇒ -7522 "Invalid fortitoken id"
  it("requires a Token for FortiToken", () => {
    expect(validateStep(2, with2fa({ authType: "fortitoken", fortitoken: "" })).fortitoken).toBe("This field is required.");
    expect(validateStep(2, with2fa({ authType: "fortitoken", fortitoken: "FTK1" })).fortitoken).toBeUndefined();
  });

  // ⚠️ device: ANY 2FA with no email AND no SMS ⇒ "-7524 You must specify a phone number or email
  // address" — even with a valid FortiToken serial. Either channel satisfies it.
  it("requires a delivery channel for FortiToken Cloud", () => {
    expect(validateStep(2, with2fa({ authType: "fortitoken-cloud", emailTo: "" })).emailTo).toBeTruthy();
    expect(validateStep(2, with2fa({ authType: "fortitoken-cloud", emailTo: "a@b.com" })).emailTo).toBeUndefined();
  });

  it("requires a delivery channel for FortiToken too, even with a valid serial", () => {
    expect(validateStep(2, with2fa({ authType: "fortitoken", fortitoken: "FTK1", emailTo: "" })).emailTo).toBeTruthy();
    expect(validateStep(2, with2fa({ authType: "fortitoken", fortitoken: "FTK1", emailTo: "a@b.com" })).emailTo).toBeUndefined();
  });

  it("accepts SMS alone as the delivery channel — no email needed", () => {
    const f = with2fa({
      authType: "fortitoken", fortitoken: "FTK1", emailTo: "",
      smsEnabled: true, smsCountryCode: "+66", smsPhone: "812345678",
    });
    expect(validateStep(2, f)).toEqual({});
  });

  it("still validates an email that is typed", () => {
    expect(validateStep(2, with2fa({ authType: "fortitoken", fortitoken: "FTK1", emailTo: "nope" })).emailTo).toBeTruthy();
  });

  it("requires a dial code and number when SMS is on", () => {
    const base = { authType: "fortitoken" as const, fortitoken: "FTK1", smsEnabled: true };
    expect(validateStep(2, with2fa({ ...base })).smsCountryCode).toBeTruthy();
    expect(validateStep(2, with2fa({ ...base, smsCountryCode: "+66" })).smsPhone).toBeTruthy();
    expect(validateStep(2, with2fa({ ...base, smsCountryCode: "+66", smsPhone: "812345678" }))).toEqual({});
  });

  it("rejects a non-numeric phone number", () => {
    const f = with2fa({ authType: "fortitoken", fortitoken: "FTK1", smsEnabled: true, smsCountryCode: "+66", smsPhone: "abc" });
    expect(validateStep(2, f).smsPhone).toBeTruthy();
  });

  it("ignores SMS fields while the SMS toggle is off, as long as there is an email", () => {
    const f = with2fa({ authType: "fortitoken", fortitoken: "FTK1", emailTo: "a@b.com", smsEnabled: false, smsPhone: "" });
    expect(validateStep(2, f)).toEqual({});
  });
});

describe("validateStep — 4 Extra Info", () => {
  it("accepts the default (no groups)", () => {
    expect(validateStep(3, form())).toEqual({});
  });
  it("requires a group once the User Group toggle is on", () => {
    expect(validateStep(3, form({ groupEnabled: true, groups: [] })).groups).toBeTruthy();
    expect(validateStep(3, form({ groupEnabled: true, groups: ["Guest-group"] })).groups).toBeUndefined();
  });
});

describe("validateLocalUserForm", () => {
  it("runs every step", () => {
    const bad = form({ name: "", password: "", twoFactorEnabled: true, authType: "fortitoken", fortitoken: "" });
    const errs = validateLocalUserForm(bad);
    expect(errs.name).toBeTruthy();
    expect(errs.password).toBeTruthy();
    expect(errs.fortitoken).toBeTruthy();
  });

  it("drops the password rule on edit (blank = keep the stored one)", () => {
    const f = form({ password: "" });
    expect(validateLocalUserForm(f, true).password).toBeTruthy();
    expect(validateLocalUserForm(f, false).password).toBeUndefined();
  });
});

describe("buildLocalUserPayload", () => {
  it("sends two_factor disable when the toggle is off, and no contact fields", () => {
    const p = buildLocalUserPayload(form({ twoFactorEnabled: false, emailTo: "a@b.com", fortitoken: "FTK1" }));
    expect(p).toEqual({
      name: "alice", type: "password", two_factor: "disable",
      status: true, groups: [], password: "S3cret!",
    });
  });

  it("trims the username", () => {
    expect(buildLocalUserPayload(form({ name: "  alice  " })).name).toBe("alice");
  });

  it("omits a blank password so the backend keeps the stored one", () => {
    expect(buildLocalUserPayload(form({ password: "" })).password).toBeUndefined();
  });

  it("sends the token for FortiToken", () => {
    const p = buildLocalUserPayload(with2fa({ authType: "fortitoken", fortitoken: "FTK1", emailTo: "a@b.com" }));
    expect(p.two_factor).toBe("fortitoken");
    expect(p.fortitoken).toBe("FTK1");
    expect(p.email_to).toBe("a@b.com");
  });

  it("never sends a token for FortiToken Cloud", () => {
    const p = buildLocalUserPayload(with2fa({ authType: "fortitoken-cloud", fortitoken: "FTK1", emailTo: "a@b.com" }));
    expect(p.two_factor).toBe("fortitoken-cloud");
    expect(p.fortitoken).toBeUndefined();
  });

  it("sends the dial code and number only when SMS is on", () => {
    const off = buildLocalUserPayload(with2fa({ authType: "fortitoken", fortitoken: "FTK1", smsEnabled: false, smsCountryCode: "+66", smsPhone: "812345678" }));
    expect(off.sms_enabled).toBe(false);
    expect(off.sms_country_code).toBeUndefined();
    expect(off.sms_phone).toBeUndefined();

    const on = buildLocalUserPayload(with2fa({ authType: "fortitoken", fortitoken: "FTK1", smsEnabled: true, smsCountryCode: "+66", smsPhone: " 812345678 " }));
    expect(on).toMatchObject({ sms_enabled: true, sms_country_code: "+66", sms_phone: "812345678" });
  });

  it("sends no groups while the User Group toggle is off, ignoring a stale selection", () => {
    expect(buildLocalUserPayload(form({ groupEnabled: false, groups: ["Guest-group"] })).groups).toEqual([]);
    expect(buildLocalUserPayload(form({ groupEnabled: true, groups: ["Guest-group"] })).groups).toEqual(["Guest-group"]);
  });

  it("maps the account status segment", () => {
    expect(buildLocalUserPayload(form({ status: false })).status).toBe(false);
  });
});

describe("localUserToForm", () => {
  it("never prefills a password — the device does not return it", () => {
    expect(localUserToForm({ name: "alice", type: "password", two_factor: "disable", status: true }).password).toBe("");
  });

  it("derives the 2FA toggle and auth type", () => {
    expect(localUserToForm({ name: "a", type: "password", two_factor: "disable", status: true }).twoFactorEnabled).toBe(false);

    const ftk = localUserToForm({ name: "a", type: "password", two_factor: "fortitoken", fortitoken: "FTK1", status: true });
    expect(ftk.twoFactorEnabled).toBe(true);
    expect(ftk.authType).toBe("fortitoken");
    expect(ftk.fortitoken).toBe("FTK1");

    const ftc = localUserToForm({ name: "a", type: "password", two_factor: "fortitoken-cloud", email_to: "a@b.com", status: true });
    expect(ftc.authType).toBe("fortitoken-cloud");
  });

  it("derives the User Group toggle from the group list", () => {
    expect(localUserToForm({ name: "a", type: "password", two_factor: "disable", status: true, groups: [] }).groupEnabled).toBe(false);
    expect(localUserToForm({ name: "a", type: "password", two_factor: "disable", status: true, groups: ["G"] }).groupEnabled).toBe(true);
  });

  it("derives the SMS toggle from the stored phone", () => {
    const f = localUserToForm({
      name: "a", type: "password", two_factor: "fortitoken", status: true,
      sms_enabled: true, sms_country_code: "+66", sms_phone: "812345678",
    });
    expect(f.smsEnabled).toBe(true);
    expect(f.smsCountryCode).toBe("+66");
  });
});

describe("round trip: device → form → payload", () => {
  it("preserves a plain enabled user", () => {
    const fromDevice: LocalUserPayload = {
      name: "alice", type: "password", two_factor: "disable", status: true, groups: [],
    };
    expect(buildLocalUserPayload(localUserToForm(fromDevice))).toEqual(fromDevice);
  });

  it("preserves a FortiToken user with SMS and groups", () => {
    const fromDevice: LocalUserPayload = {
      name: "bob", type: "password", two_factor: "fortitoken", fortitoken: "FTKMOB0B0269CB84",
      email_to: "bob@corp.com", sms_enabled: true, sms_country_code: "+66", sms_phone: "812345678",
      status: true, groups: ["Guest-group"],
    };
    expect(buildLocalUserPayload(localUserToForm(fromDevice))).toEqual(fromDevice);
  });

  it("preserves a disabled FortiToken Cloud user", () => {
    const fromDevice: LocalUserPayload = {
      name: "carol", type: "password", two_factor: "fortitoken-cloud", email_to: "c@corp.com",
      sms_enabled: false, status: false, groups: [],
    };
    expect(buildLocalUserPayload(localUserToForm(fromDevice))).toEqual(fromDevice);
  });
});
