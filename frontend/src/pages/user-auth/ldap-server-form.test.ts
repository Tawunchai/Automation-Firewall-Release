import { describe, it, expect } from "vitest";
import { BLANK_LDAP_SERVER_FORM, LDAP_PORT_PLAIN, LDAP_PORT_LDAPS, buildLDAPServerPayload, validateLDAPServerForm, ldapServerToForm, bindTakesCredentials, portForProtocol, type LDAPServerFormState } from "./ldap-server-form.logic";
import { splitExchangeAccount, validateExchangeForm, buildExchangeConnectorPayload, BLANK_EXCHANGE_FORM, type ExchangeConnectorFormState } from "./exchange-connector-drawer.logic";

// A valid Simple-bind server; each case mutates one field so a failure names the broken rule.
const base = (over: Partial<LDAPServerFormState> = {}): LDAPServerFormState => ({
  ...BLANK_LDAP_SERVER_FORM,
  name: "AD-Corp",
  server: "10.0.1.10",
  dn: "dc=corp,dc=local",
  ...over,
});

describe("validateLDAPServerForm — accepts what the FortiGate dialog accepts", () => {
  it.each([
    ["simple bind", base()],
    ["anonymous bind", base({ bindType: "anonymous" })],
    ["regular bind with credentials", base({ bindType: "regular", username: "cn=svc,dc=corp", password: "S3cret" })],
    ["blank distinguished name", base({ dn: "" })],
    ["starttls without a certificate", base({ secureEnabled: true, protocol: "starttls" })],
    ["ldaps with a certificate", base({
      secureEnabled: true, protocol: "ldaps", port: "636",
      certEnabled: true, caCert: "ACCVRAIZ1", serverIdentityCheck: true,
    })],
    ["exchange connector selected", base({ exchangeEnabled: true, exchangeServer: "EXCH-Corp" })],
    ["port at the upper bound", base({ port: "65535" })],
    ["port at the lower bound", base({ port: "1" })],
    ["a 35-character name", base({ name: "a".repeat(35) })],
  ])("%s", (_label, form) => {
    expect(validateLDAPServerForm(form)).toEqual({});
  });
});

describe("validateLDAPServerForm — rejects with a field-specific message", () => {
  it.each([
    ["name", base({ name: "   " })],
    ["name", base({ name: "a".repeat(36) })],
    ["server", base({ server: "" })],
    ["server", base({ server: "s".repeat(64) })],
    ["port", base({ port: "0" })],
    ["port", base({ port: "65536" })],
    ["port", base({ port: "" })],
    ["port", base({ port: "abc" })],
    ["cnid", base({ cnid: "" })],
    ["cnid", base({ cnid: "c".repeat(21) })],
    ["dn", base({ dn: "d".repeat(512) })],
    ["username", base({ bindType: "regular", username: "", password: "x" })],
    ["password", base({ bindType: "regular", username: "svc", password: "" })],
    ["exchangeServer", base({ exchangeEnabled: true, exchangeServer: "  " })],
    ["caCert", base({ secureEnabled: true, protocol: "ldaps", certEnabled: true, caCert: "" })],
  ])("flags %s", (field, form) => {
    const errs = validateLDAPServerForm(form);
    expect(Object.keys(errs)).toContain(field);
  });

  // The device answers "ENC XXXX" for the bind password, so the edit form can never prefill it
  // — blank has to mean "keep the stored one".
  it("allows a blank password on edit but not on create", () => {
    const f = base({ bindType: "regular", username: "svc", password: "" });
    expect(validateLDAPServerForm(f, { isEdit: true })).toEqual({});
    expect(validateLDAPServerForm(f).password).toBeTruthy();
  });

  // Credentials belong to a Regular bind only — a stale username left over from switching bind
  // type must not block the save.
  it("ignores stale credentials for simple/anonymous binds", () => {
    expect(validateLDAPServerForm(base({ bindType: "simple", username: "", password: "" }))).toEqual({});
    expect(validateLDAPServerForm(base({ bindType: "anonymous", username: "", password: "" }))).toEqual({});
  });

  // Certificate is unreachable with Secure Connection off, so a stale CA cert can't fail it.
  it("does not require a CA certificate when Secure Connection is off", () => {
    expect(validateLDAPServerForm(base({ secureEnabled: false, certEnabled: true, caCert: "" }))).toEqual({});
  });
});

describe("buildLDAPServerPayload", () => {
  it("maps a minimal simple-bind server", () => {
    expect(buildLDAPServerPayload(base())).toEqual({
      name: "AD-Corp",
      server: "10.0.1.10",
      port: 389,
      cnid: "cn",
      dn: "dc=corp,dc=local",
      exchange_enabled: false,
      bind_type: "simple",
      secure_enabled: false,
      cert_enabled: false,
      server_identity_check: false,
    });
  });

  it("trims every text field", () => {
    const p = buildLDAPServerPayload(base({
      name: "  AD-Corp ", server: " 10.0.1.10  ", cnid: " cn ", dn: "  dc=corp  ",
    }));
    expect(p).toMatchObject({ name: "AD-Corp", server: "10.0.1.10", cnid: "cn", dn: "dc=corp" });
  });

  it("sends credentials only for a regular bind", () => {
    const regular = buildLDAPServerPayload(base({
      bindType: "regular", username: " cn=svc ", password: "S3cret",
    }));
    expect(regular).toMatchObject({ bind_type: "regular", username: "cn=svc", password: "S3cret" });

    // A simple bind that still holds stale state must not leak it into the payload.
    const simple = buildLDAPServerPayload(base({
      bindType: "simple", username: "cn=svc", password: "S3cret",
    }));
    expect(simple.username).toBeUndefined();
    expect(simple.password).toBeUndefined();
  });

  it("omits a blank password so the stored one survives an edit", () => {
    const p = buildLDAPServerPayload(base({ bindType: "regular", username: "svc", password: "" }));
    expect(p.username).toBe("svc");
    expect("password" in p).toBe(false);
  });

  it("carries the Exchange connector only while the toggle is on", () => {
    expect(buildLDAPServerPayload(base({ exchangeEnabled: true, exchangeServer: " EXCH " }))).toMatchObject({
      exchange_enabled: true, exchange_server: "EXCH",
    });
    const off = buildLDAPServerPayload(base({ exchangeEnabled: false, exchangeServer: "EXCH" }));
    expect(off.exchange_enabled).toBe(false);
    expect(off.exchange_server).toBeUndefined();
  });

  it.each([
    // secure, cert, identity → protocol / ca_cert / cert_enabled / server_identity_check
    [false, false, false, undefined, undefined, false, false],
    [true, false, false, "starttls", undefined, false, false],
    [true, true, true, "starttls", "ACCVRAIZ1", true, true],
    [true, true, false, "starttls", "ACCVRAIZ1", true, false],
  ])("maps the secure/cert toggles (%s,%s,%s)", (secure, cert, identity, protocol, caCert, certEnabled, identityCheck) => {
    const p = buildLDAPServerPayload(base({
      secureEnabled: secure as boolean, certEnabled: cert as boolean,
      serverIdentityCheck: identity as boolean, protocol: "starttls", caCert: "ACCVRAIZ1",
    }));
    expect(p.protocol).toBe(protocol);
    expect(p.ca_cert).toBe(caCert);
    expect(p.cert_enabled).toBe(certEnabled);
    expect(p.server_identity_check).toBe(identityCheck);
  });

  // Turning Secure Connection off has to CLEAR the certificate settings, not merely hide them —
  // otherwise an edit would leave the device still verifying against a stale CA.
  it("drops the certificate when Secure Connection is off", () => {
    const p = buildLDAPServerPayload(base({
      secureEnabled: false, certEnabled: true, caCert: "ACCVRAIZ1", serverIdentityCheck: true,
    }));
    expect(p).toMatchObject({ secure_enabled: false, cert_enabled: false, server_identity_check: false });
    expect(p.ca_cert).toBeUndefined();
    expect(p.protocol).toBeUndefined();
  });

  it("sends the port as a number", () => {
    expect(buildLDAPServerPayload(base({ port: "636" })).port).toBe(636);
  });
});

describe("ldapServerToForm — round-trips an object off the device", () => {
  it("restores a secure regular-bind server", () => {
    const f = ldapServerToForm({
      name: "AD-Corp", server: "10.0.1.11", port: 636, cnid: "sAMAccountName", dn: "dc=corp,dc=local",
      exchange_enabled: true, exchange_server: "EXCH-Corp",
      bind_type: "regular", username: "cn=svc,dc=corp",
      secure_enabled: true, protocol: "ldaps",
      cert_enabled: true, ca_cert: "ACCVRAIZ1", server_identity_check: true,
    });
    expect(f).toMatchObject({
      name: "AD-Corp", port: "636", cnid: "sAMAccountName",
      exchangeEnabled: true, exchangeServer: "EXCH-Corp",
      bindType: "regular", username: "cn=svc,dc=corp",
      secureEnabled: true, protocol: "ldaps", certEnabled: true, caCert: "ACCVRAIZ1",
      serverIdentityCheck: true,
    });
    // The device never returns the password.
    expect(f.password).toBe("");
  });

  it("survives a round trip through the payload builder", () => {
    const original = base({
      bindType: "regular", username: "cn=svc", password: "S3cret",
      secureEnabled: true, protocol: "ldaps", port: "636",
      certEnabled: true, caCert: "ACCVRAIZ1", serverIdentityCheck: true,
      exchangeEnabled: true, exchangeServer: "EXCH",
    });
    const back = ldapServerToForm(buildLDAPServerPayload(original));
    expect(back).toEqual({ ...original, password: "" });
  });

  it("parks the Protocol switch on STARTTLS for a plain server", () => {
    const f = ldapServerToForm({
      name: "Plain", server: "10.0.1.10", port: 389, cnid: "cn", dn: "",
      exchange_enabled: false, bind_type: "simple",
      secure_enabled: false, cert_enabled: false, server_identity_check: false,
    });
    expect(f.secureEnabled).toBe(false);
    expect(f.protocol).toBe("starttls");
    expect(f.certEnabled).toBe(false);
    // With Certificate off the GUI still pre-selects the identity check for when it goes back on.
    expect(f.serverIdentityCheck).toBe(true);
  });
});

describe("bind type + port helpers", () => {
  it("knows which bind types carry credentials", () => {
    expect(bindTakesCredentials("regular")).toBe(true);
    expect(bindTakesCredentials("simple")).toBe(false);
    expect(bindTakesCredentials("anonymous")).toBe(false);
  });

  // The GUI moves the port between 389 and 636 when Protocol changes — but never overwrites a
  // port the user typed themselves.
  it("flips between the protocol defaults", () => {
    expect(portForProtocol(String(LDAP_PORT_PLAIN), "ldaps")).toBe(String(LDAP_PORT_LDAPS));
    expect(portForProtocol(String(LDAP_PORT_LDAPS), "starttls")).toBe(String(LDAP_PORT_PLAIN));
  });

  it("keeps a custom port", () => {
    expect(portForProtocol("3268", "ldaps")).toBe("3268");
    expect(portForProtocol("1389", "starttls")).toBe("1389");
  });

  it("is idempotent when the port already matches", () => {
    expect(portForProtocol("636", "ldaps")).toBe("636");
    expect(portForProtocol("389", "starttls")).toBe("389");
  });
});

// ─── Exchange external connector ───────────────────────────────────────────────

describe("splitExchangeAccount", () => {
  it.each([
    ["svc-fgt@mail.corp.local", "svc-fgt", "mail.corp.local", "corp.local"],
    ["username@server.domain.com", "username", "server.domain.com", "domain.com"],
    // Two labels have no separate parent domain — reuse the host rather than storing a bare TLD.
    ["admin@corp.local", "admin", "corp.local", "corp.local"],
    ["admin@localhost", "admin", "localhost", "localhost"],
    // A UPN can contain an "@"; the LAST one separates account from host.
    ["first@last@ex01.corp.local", "first@last", "ex01.corp.local", "corp.local"],
    ["  svc@mail.corp.local  ", "svc", "mail.corp.local", "corp.local"],
    ["deep@a.b.c.d.com", "deep", "a.b.c.d.com", "b.c.d.com"],
  ])("splits %s", (input, username, serverName, domainName) => {
    expect(splitExchangeAccount(input)).toEqual({ username, serverName, domainName });
  });

  it.each(["", "   ", "no-at-sign", "@nouser", "nohost@"])("returns empty parts for %s", (bad) => {
    expect(splitExchangeAccount(bad)).toEqual({ username: "", serverName: "", domainName: "" });
  });
});

const exch = (over: Partial<ExchangeConnectorFormState> = {}): ExchangeConnectorFormState => ({
  ...BLANK_EXCHANGE_FORM,
  name: "EXCH-Corp",
  account: "svc-fgt@mail.corp.local",
  password: "P@ss",
  ...over,
});

describe("validateExchangeForm", () => {
  it("accepts a complete connector", () => {
    expect(validateExchangeForm(exch())).toEqual({});
    expect(validateExchangeForm(exch({ overrideIP: true, ip: "192.168.10.5" }))).toEqual({});
  });

  it.each([
    ["name", exch({ name: "" })],
    ["name", exch({ name: "e".repeat(36) })],
    ["account", exch({ account: "" })],
    ["account", exch({ account: "not-an-account" })],
    ["password", exch({ password: "" })],
    ["ip", exch({ overrideIP: true, ip: "" })],
    ["ip", exch({ overrideIP: true, ip: "300.1.1.1" })],
    ["ip", exch({ overrideIP: true, ip: "192.168.1" })],
  ])("flags %s", (field, form) => {
    expect(Object.keys(validateExchangeForm(form))).toContain(field);
  });

  it("ignores a bad IP while the override is off", () => {
    expect(validateExchangeForm(exch({ overrideIP: false, ip: "nonsense" }))).toEqual({});
  });
});

describe("buildExchangeConnectorPayload", () => {
  it("splits the account into the three CMDB fields", () => {
    expect(buildExchangeConnectorPayload(exch())).toEqual({
      name: "EXCH-Corp",
      username: "svc-fgt",
      server_name: "mail.corp.local",
      domain_name: "corp.local",
      password: "P@ss",
      override_ip: false,
      ip: "0.0.0.0", // the device's "not overridden" sentinel
      auto_discover_kdc: true,
    });
  });

  it("sends the override IP only while the toggle is on", () => {
    expect(buildExchangeConnectorPayload(exch({ overrideIP: true, ip: " 192.168.10.5 " })).ip).toBe("192.168.10.5");
    expect(buildExchangeConnectorPayload(exch({ overrideIP: false, ip: "192.168.10.5" })).ip).toBe("0.0.0.0");
  });

  it("carries the Auto-discover KDC toggle", () => {
    expect(buildExchangeConnectorPayload(exch({ autoDiscoverKDC: false })).auto_discover_kdc).toBe(false);
  });
});
