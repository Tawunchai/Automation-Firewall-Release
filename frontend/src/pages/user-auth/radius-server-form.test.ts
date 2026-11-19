import { describe, it, expect } from "vitest";
import { BLANK_RADIUS_SERVER_FORM, RADIUS_AUTH_OPTIONS, buildRADIUSServerPayload, validateRADIUSServerForm, radiusServerToForm, type RADIUSServerFormState } from "./radius-server-form.logic";

// The form mirrors the FortiGate "New RADIUS Server" dialog exactly: Name, Authentication
// method, NAS IP, Include in every user group, Primary Server, Secondary Server. Nothing else —
// user/radius also has tertiary-* and timeout, but the GUI never shows them.
const base = (over: Partial<RADIUSServerFormState> = {}): RADIUSServerFormState => ({
  ...BLANK_RADIUS_SERVER_FORM,
  name: "NPS-Corp",
  server: "10.0.2.10",
  secret: "radsecret",
  ...over,
});

describe("the form carries only what the FortiGate dialog shows", () => {
  it("has no timeout or tertiary field", () => {
    expect(Object.keys(BLANK_RADIUS_SERVER_FORM).sort()).toEqual([
      "allUserGroup", "authMethodSpecify", "authType", "name",
      "nasIP", "secondarySecret", "secondaryServer", "secret", "server",
    ]);
  });

  it("never sends timeout or tertiary keys to the device", () => {
    const p = buildRADIUSServerPayload(base({ secondaryServer: "10.0.2.11", secondarySecret: "s2" }));
    for (const k of ["timeout", "tertiary_server", "tertiary_secret"]) {
      expect(k in p).toBe(false);
    }
  });

  // "auto" is the Default position of the switch, not an entry in the Specify dropdown.
  it("offers exactly the four methods the Specify dropdown has", () => {
    expect(RADIUS_AUTH_OPTIONS.map((o) => o.v)).toEqual(["pap", "chap", "ms_chap", "ms_chap_v2"]);
  });
});

describe("validateRADIUSServerForm — accepts what the FortiGate dialog accepts", () => {
  it.each([
    ["primary only", base()],
    ["specify PAP", base({ authMethodSpecify: true, authType: "pap" })],
    ["specify MS-CHAP-v2", base({ authMethodSpecify: true, authType: "ms_chap_v2" })],
    ["with a NAS IP", base({ nasIP: "10.0.99.201" })],
    ["include in every user group", base({ allUserGroup: true })],
    ["primary + secondary", base({ secondaryServer: "10.0.2.11", secondarySecret: "s2" })],
    ["a hostname instead of an IP", base({ server: "radius.corp.local" })],
    ["a 35-character name", base({ name: "n".repeat(35) })],
  ])("%s", (_label, form) => {
    expect(validateRADIUSServerForm(form)).toEqual({});
  });
});

describe("validateRADIUSServerForm — rejects with a field-specific message", () => {
  it.each([
    ["name", base({ name: "" })],
    ["name", base({ name: "n".repeat(36) })],
    ["server", base({ server: "  " })],
    ["server", base({ server: "s".repeat(64) })],
    ["secret", base({ secret: "" })],
    ["nasIP", base({ nasIP: "not-an-ip" })],
    ["nasIP", base({ nasIP: "999.1.1.1" })],
    ["nasIP", base({ nasIP: "2001:db8::1" })],
    ["secondarySecret", base({ secondaryServer: "10.0.2.11" })],
    ["secondaryServer", base({ secondaryServer: "s".repeat(64), secondarySecret: "s2" })],
    // FortiOS -61: the two addresses must be distinct.
    ["secondaryServer", base({ secondaryServer: "10.0.2.10", secondarySecret: "s2" })],
  ])("flags %s", (field, form) => {
    expect(Object.keys(validateRADIUSServerForm(form))).toContain(field);
  });

  // The device answers "ENC XXXX" for both secrets, so the edit form can never prefill them.
  it("allows blank secrets on edit but not on create", () => {
    const f = base({ secret: "", secondaryServer: "10.0.2.11", secondarySecret: "" });
    expect(validateRADIUSServerForm(f, { isEdit: true })).toEqual({});

    const errs = validateRADIUSServerForm(f);
    expect(Object.keys(errs)).toEqual(expect.arrayContaining(["secret", "secondarySecret"]));
  });

  it("does not require a secret for an empty secondary server", () => {
    expect(validateRADIUSServerForm(base({ secondaryServer: "  ", secondarySecret: "" }))).toEqual({});
  });

  it("treats a blank NAS IP as unset", () => {
    expect(validateRADIUSServerForm(base({ nasIP: "" }))).toEqual({});
  });

  it("uses the dialog's own wording for the required fields", () => {
    const errs = validateRADIUSServerForm(base({ server: "", secret: "" }));
    expect(errs.server).toBe("This field is required.");
    expect(errs.secret).toBe("This field is required.");
  });
});

describe("buildRADIUSServerPayload", () => {
  it("maps a minimal primary-only server", () => {
    expect(buildRADIUSServerPayload(base())).toEqual({
      name: "NPS-Corp",
      auth_method_specify: false,
      auth_type: "auto",
      all_usergroup: false,
      nas_ip: "",
      server: "10.0.2.10",
      secret: "radsecret",
    });
  });

  // "Default" is auth-type auto whatever stale method the Specify dropdown still holds.
  it("forces auth_type auto while the method is Default", () => {
    expect(buildRADIUSServerPayload(base({ authMethodSpecify: false, authType: "pap" })).auth_type).toBe("auto");
  });

  it.each(["pap", "chap", "ms_chap", "ms_chap_v2"] as const)("passes %s through when specified", (method) => {
    const p = buildRADIUSServerPayload(base({ authMethodSpecify: true, authType: method }));
    expect(p).toMatchObject({ auth_method_specify: true, auth_type: method });
  });

  // Blank secrets keep the stored ones; a blank secondary HOST has to be dropped entirely
  // because FortiOS rejects "" on that field with -257 and aborts the whole save.
  it("omits every blank optional key", () => {
    const p = buildRADIUSServerPayload(base({ secret: "", secondarySecret: "", secondaryServer: "", nasIP: "" }));
    for (const k of ["secret", "secondary_secret", "secondary_server"]) {
      expect(k in p).toBe(false);
    }
    // NAS IP is different: it IS always sent, because the backend turns a blank one into the
    // device's 0.0.0.0 "unset" value — the only address field that can really be cleared.
    expect(p.nas_ip).toBe("");
  });

  it("treats a whitespace-only secondary host as blank", () => {
    expect("secondary_server" in buildRADIUSServerPayload(base({ secondaryServer: "   " }))).toBe(false);
  });

  it("carries both servers", () => {
    const p = buildRADIUSServerPayload(base({
      secondaryServer: " 10.0.2.11 ", secondarySecret: "s2",
      allUserGroup: true, nasIP: " 10.0.99.201 ",
    }));
    expect(p).toMatchObject({
      server: "10.0.2.10", secret: "radsecret",
      secondary_server: "10.0.2.11", secondary_secret: "s2",
      all_usergroup: true, nas_ip: "10.0.99.201",
    });
  });

  it("trims the name and hosts", () => {
    const p = buildRADIUSServerPayload(base({ name: "  NPS  ", server: " 10.0.2.10 " }));
    expect(p).toMatchObject({ name: "NPS", server: "10.0.2.10" });
  });
});

describe("radiusServerToForm — round-trips an object off the device", () => {
  it("restores a two-server object", () => {
    const f = radiusServerToForm({
      name: "NPS-Corp", auth_method_specify: true, auth_type: "ms_chap_v2",
      nas_ip: "10.0.99.201", all_usergroup: true,
      server: "10.0.2.10", secondary_server: "10.0.2.11",
    });
    expect(f).toMatchObject({
      name: "NPS-Corp", authMethodSpecify: true, authType: "ms_chap_v2",
      nasIP: "10.0.99.201", allUserGroup: true,
      server: "10.0.2.10", secondaryServer: "10.0.2.11",
    });
    // Secrets are never returned by the device.
    expect([f.secret, f.secondarySecret]).toEqual(["", ""]);
  });

  // "auto" has no position in the Specify dropdown, so park it on PAP — otherwise flipping the
  // switch to Specify would show an empty select.
  it("parks the Specify dropdown on PAP for auth-type auto", () => {
    const f = radiusServerToForm({
      name: "NPS", auth_method_specify: false, auth_type: "auto",
      all_usergroup: false, server: "10.0.2.10",
    });
    expect(f.authMethodSpecify).toBe(false);
    expect(f.authType).toBe("pap");
  });

  it("survives a round trip through the payload builder", () => {
    const original = base({
      authMethodSpecify: true, authType: "chap", nasIP: "10.0.99.201", allUserGroup: true,
      secondaryServer: "10.0.2.11", secondarySecret: "s2",
    });
    const back = radiusServerToForm(buildRADIUSServerPayload(original));
    expect(back).toEqual({ ...original, secret: "", secondarySecret: "" });
  });
});
