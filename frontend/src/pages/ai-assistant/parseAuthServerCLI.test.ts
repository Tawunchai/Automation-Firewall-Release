import { describe, it, expect } from "vitest";
import {
  parseLDAPServerFromCLI, parseAllLDAPServersFromCLI, ldapServerDraftToForm,
  isPlaceholderSecret, LDAP_PORT_PLAIN, LDAP_PORT_LDAPS,
} from "./parseLDAPServerCLI";
import {
  parseRADIUSServerFromCLI, parseAllRADIUSServersFromCLI, radiusServerDraftToForm,
} from "./parseRADIUSServerCLI";
import { canApplyViaREST } from "./applyViaREST";

// These pin the contract between the prompt (services/ai.go section 14) and the wizards: whatever
// section 14 tells the model to emit has to come back out as a usable draft.

// ─── LDAP ──────────────────────────────────────────────────────────────────────

const LDAP_SIMPLE = `
config user ldap
    edit "AD-Corp"
        set server "192.168.1.10"
        set port 389
        set cnid "sAMAccountName"
        set dn "DC=company,DC=com"
        set type simple
    next
end
`;

const LDAP_FULL = `
config user ldap
    edit "AD-Secure"
        set server "192.168.1.10"
        set port 636
        set cnid "sAMAccountName"
        set dn "DC=company,DC=com"
        set type regular
        set username "CN=svc-forti,OU=Service,DC=company,DC=com"
        set password "LdapPass@2024!"
        set secure ldaps
        set ca-cert "Fortinet_CA"
        set server-identity-check enable
        set obtain-user-info enable
        set user-info-exchange-server "EXCH-Corp"
    next
end
`;

describe("parseLDAPServerFromCLI", () => {
  it("parses a plain simple-bind server", () => {
    const p = parseLDAPServerFromCLI(LDAP_SIMPLE)!;
    expect(p.target).toBe("AD-Corp");
    expect(p.form).toEqual({
      name: "AD-Corp",
      server: "192.168.1.10",
      port: 389,
      cnid: "sAMAccountName",
      dn: "DC=company,DC=com",
      bind_type: "simple",
      exchange_enabled: false,
      secure_enabled: false,
      cert_enabled: false,
      server_identity_check: false,
    });
  });

  it("derives every GUI toggle from the flat CMDB fields", () => {
    const f = parseLDAPServerFromCLI(LDAP_FULL)!.form;
    expect(f).toMatchObject({
      name: "AD-Secure",
      bind_type: "regular",
      username: "CN=svc-forti,OU=Service,DC=company,DC=com",
      password: "LdapPass@2024!",
      secure_enabled: true,
      protocol: "ldaps",
      cert_enabled: true,
      ca_cert: "Fortinet_CA",
      server_identity_check: true,
      exchange_enabled: true,
      exchange_server: "EXCH-Corp",
    });
  });

  it("treats an explicit secure disable as the toggle being off", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "Plain"
        set server "10.0.1.10"
        set secure disable
        set ca-cert "Fortinet_CA"
    next
end`)!.form;
    expect(f.secure_enabled).toBe(false);
    // A stale ca-cert must not switch Certificate on — it is unreachable with Secure off.
    expect(f.cert_enabled).toBe(false);
    expect(f.ca_cert).toBeUndefined();
  });

  // The GUI moves the port to 636 for LDAPS; a model that forgets shouldn't leave LDAPS on 389.
  it("defaults the port to 636 for ldaps when none is given", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set secure ldaps
    next
end`)!.form;
    expect(f.port).toBe(LDAP_PORT_LDAPS);
  });

  it("keeps an explicit port even with ldaps", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set port 3269
        set secure ldaps
    next
end`)!.form;
    expect(f.port).toBe(3269);
  });

  it("defaults port and cnid the way the dialog does", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "Bare"
        set server "10.0.1.10"
    next
end`)!.form;
    expect(f.port).toBe(LDAP_PORT_PLAIN);
    expect(f.cnid).toBe("cn");
    expect(f.dn).toBe("");
  });

  // Credentials belong to a Regular bind — carrying them elsewhere would show fields the form
  // doesn't render and send keys FortiOS ignores.
  it("drops credentials on a non-regular bind", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set type anonymous
        set username "leftover"
        set password "leftover"
    next
end`)!.form;
    expect(f.username).toBeUndefined();
    expect(f.password).toBeUndefined();
  });

  // Naming a connector implies the feature, which is what the GUI does when you pick one.
  it("switches Exchange on when only the connector is named", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set user-info-exchange-server "EXCH"
    next
end`)!.form;
    expect(f.exchange_enabled).toBe(true);
    expect(f.exchange_server).toBe("EXCH");
  });

  // ⚠️ obtain-user-info defaults to ENABLE on the device, so an explicit disable has to win.
  it("honours an explicit obtain-user-info disable", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set obtain-user-info disable
        set user-info-exchange-server "EXCH"
    next
end`)!.form;
    expect(f.exchange_enabled).toBe(false);
    expect(f.exchange_server).toBeUndefined();
  });

  it("takes a rename from a set name line", () => {
    const p = parseLDAPServerFromCLI(`
config user ldap
    edit "OldName"
        set name "NewName"
        set server "10.0.1.10"
    next
end`)!;
    expect(p.target).toBe("OldName"); // what the wizard looks up
    expect(p.form.name).toBe("NewName");
  });

  it("keeps a DN containing commas and spaces intact", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "S"
        set server "10.0.1.10"
        set dn "OU=Head Office,DC=corp,DC=local"
    next
end`)!.form;
    expect(f.dn).toBe("OU=Head Office,DC=corp,DC=local");
  });

  it("parses every server when a request defines several", () => {
    const all = parseAllLDAPServersFromCLI(`
config user ldap
    edit "DC1"
        set server "10.0.1.10"
    next
    edit "DC2"
        set server "10.0.1.11"
    next
end`);
    expect(all.map((p) => p.form.name)).toEqual(["DC1", "DC2"]);
    expect(all.map((p) => p.form.server)).toEqual(["10.0.1.10", "10.0.1.11"]);
  });

  it("survives CRLF line endings", () => {
    expect(parseLDAPServerFromCLI(LDAP_SIMPLE.replace(/\n/g, "\r\n"))?.form.server).toBe("192.168.1.10");
  });

  it("returns null when there is no LDAP block", () => {
    expect(parseLDAPServerFromCLI("config firewall address\n edit \"A\"\n next\nend")).toBeNull();
    expect(parseLDAPServerFromCLI("")).toBeNull();
  });
});

describe("ldapServerDraftToForm", () => {
  it("fills the create payload from a bare draft", () => {
    const out = ldapServerDraftToForm(parseLDAPServerFromCLI(`
config user ldap
    edit "Bare"
        set server "10.0.1.10"
    next
end`)!.form);
    expect(out).toEqual({
      name: "Bare", server: "10.0.1.10", port: 389, cnid: "cn", dn: "",
      exchange_enabled: false, bind_type: "simple",
      secure_enabled: false, cert_enabled: false, server_identity_check: false,
    });
  });

  it("carries the full secure + exchange + regular-bind set through", () => {
    const out = ldapServerDraftToForm(parseLDAPServerFromCLI(LDAP_FULL)!.form);
    expect(out).toMatchObject({
      port: 636, secure_enabled: true, protocol: "ldaps",
      cert_enabled: true, ca_cert: "Fortinet_CA", server_identity_check: true,
      exchange_enabled: true, exchange_server: "EXCH-Corp",
      bind_type: "regular", username: "CN=svc-forti,OU=Service,DC=company,DC=com",
      password: "LdapPass@2024!",
    });
  });

  // exchange_enabled without a connector name would fail on the device with -3, so it is dropped.
  it("refuses to enable Exchange with no connector named", () => {
    const out = ldapServerDraftToForm({
      name: "S", server: "10.0.1.10", port: 389, cnid: "cn", dn: "",
      exchange_enabled: true, bind_type: "simple",
      secure_enabled: false, cert_enabled: false, server_identity_check: false,
    });
    expect(out.exchange_enabled).toBe(false);
    expect(out.exchange_server).toBeUndefined();
  });
});

// ─── RADIUS ────────────────────────────────────────────────────────────────────

const RADIUS_FULL = `
config user radius
    edit "NPS-Corp"
        set server "192.168.1.11"
        set secret "RadiusSecret@2024"
        set secondary-server "192.168.1.12"
        set secondary-secret "RadiusSecret@2024"
        set auth-type ms_chap_v2
        set nas-ip 192.168.1.1
        set all-usergroup enable
    next
end
`;

describe("parseRADIUSServerFromCLI", () => {
  it("parses the full dialog", () => {
    const p = parseRADIUSServerFromCLI(RADIUS_FULL)!;
    expect(p.target).toBe("NPS-Corp");
    expect(p.form).toEqual({
      name: "NPS-Corp",
      server: "192.168.1.11",
      secret: "RadiusSecret@2024",
      secondary_server: "192.168.1.12",
      secondary_secret: "RadiusSecret@2024",
      auth_method_specify: true,
      auth_type: "ms_chap_v2",
      nas_ip: "192.168.1.1",
      all_usergroup: true,
    });
  });

  // No auth-type ⇒ the GUI's "Default" position.
  it("defaults the Authentication method switch to Default", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set secret "s"
    next
end`)!.form;
    expect(f.auth_method_specify).toBe(false);
    expect(f.auth_type).toBe("auto");
    expect(f.all_usergroup).toBe(false);
  });

  it.each(["pap", "chap", "ms_chap", "ms_chap_v2"])("flips to Specify for auth-type %s", (method) => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set auth-type ${method}
    next
end`)!.form;
    expect(f).toMatchObject({ auth_method_specify: true, auth_type: method });
  });

  it("keeps Default for an explicit auth-type auto", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set auth-type auto
    next
end`)!.form;
    expect(f.auth_method_specify).toBe(false);
  });

  // The GUI dialog has neither field, so the parser ignores them rather than smuggling them in.
  it("ignores timeout and tertiary-server", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set secret "s"
        set timeout 30
        set tertiary-server "10.0.2.12"
        set tertiary-secret "s3"
    next
end`)!.form as Record<string, unknown>;
    for (const k of ["timeout", "tertiary_server", "tertiary_secret"]) {
      expect(k in f).toBe(false);
    }
  });

  // A secret with no host can't be applied.
  it("drops a secondary secret with no secondary host", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set secondary-secret "orphan"
    next
end`)!.form;
    expect(f.secondary_server).toBeUndefined();
    expect(f.secondary_secret).toBeUndefined();
  });

  // 0.0.0.0 is the device's "unset" address; the form shows those blank.
  it("reads the device's 0.0.0.0 sentinel as empty", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set secondary-server "0.0.0.0"
        set nas-ip 0.0.0.0
    next
end`)!.form;
    expect(f.secondary_server).toBe("");
    expect(f.nas_ip).toBeUndefined();
  });

  it("takes a rename from a set name line", () => {
    const p = parseRADIUSServerFromCLI(`
config user radius
    edit "OldName"
        set name "NewName"
        set server "10.0.2.10"
    next
end`)!;
    expect(p.target).toBe("OldName");
    expect(p.form.name).toBe("NewName");
  });

  it("parses every server when a request defines several", () => {
    const all = parseAllRADIUSServersFromCLI(`
config user radius
    edit "NPS-HQ"
        set server "10.0.2.10"
        set secret "a"
    next
    edit "NPS-Branch"
        set server "10.1.2.10"
        set secret "b"
    next
end`);
    expect(all.map((p) => p.form.name)).toEqual(["NPS-HQ", "NPS-Branch"]);
  });

  it("survives CRLF line endings", () => {
    expect(parseRADIUSServerFromCLI(RADIUS_FULL.replace(/\n/g, "\r\n"))?.form.server).toBe("192.168.1.11");
  });

  it("returns null when there is no RADIUS block", () => {
    expect(parseRADIUSServerFromCLI("config user ldap\n edit \"A\"\n next\nend")).toBeNull();
  });
});

describe("radiusServerDraftToForm", () => {
  it("fills the create payload from a bare draft", () => {
    const out = radiusServerDraftToForm(parseRADIUSServerFromCLI(`
config user radius
    edit "R"
        set server "10.0.2.10"
        set secret "s"
    next
end`)!.form);
    expect(out).toEqual({
      name: "R", auth_method_specify: false, auth_type: "auto",
      nas_ip: "", all_usergroup: false, server: "10.0.2.10", secret: "s",
    });
  });

  it("carries both servers through", () => {
    const out = radiusServerDraftToForm(parseRADIUSServerFromCLI(RADIUS_FULL)!.form);
    expect(out).toMatchObject({
      auth_method_specify: true, auth_type: "ms_chap_v2",
      server: "192.168.1.11", secret: "RadiusSecret@2024",
      secondary_server: "192.168.1.12", secondary_secret: "RadiusSecret@2024",
      nas_ip: "192.168.1.1", all_usergroup: true,
    });
  });

  it("never emits a secondary secret without its host", () => {
    const out = radiusServerDraftToForm({
      name: "R", auth_method_specify: false, auth_type: "auto",
      all_usergroup: false, server: "10.0.2.10", secondary_secret: "orphan",
    });
    expect("secondary_secret" in out).toBe(false);
    expect("secondary_server" in out).toBe(false);
  });
});

// ─── Apply routing ─────────────────────────────────────────────────────────────

describe("canApplyViaREST covers the auth-server sections", () => {
  it.each([
    ["LDAP alone", LDAP_FULL],
    ["RADIUS alone", RADIUS_FULL],
    ["both together", LDAP_SIMPLE + RADIUS_FULL],
  ])("takes the REST fast path for %s", (_label, cli) => {
    expect(canApplyViaREST(cli)).toBe(true);
  });

  // An auth server + the group that uses it is one REST-applicable suggestion, and the order the
  // model writes them in (server first) is the order Apply creates them in.
  it("takes the REST path for an auth server plus its user group", () => {
    expect(canApplyViaREST(`${LDAP_SIMPLE}
config user group
    edit "AD-VPN-Group"
        set member "AD-Corp"
    next
end`)).toBe(true);
  });

  // A section we still have no REST endpoint for must drag the whole suggestion to SSH.
  it("falls back to SSH when the suggestion also touches an unsupported section", () => {
    expect(canApplyViaREST(`${RADIUS_FULL}
config system ha
    set mode a-p
end`)).toBe(false);
  });
});

// ─── Invented credentials ──────────────────────────────────────────────────────
// An LDAP bind password and a RADIUS shared secret belong to an EXISTING AD/NPS server, so the
// model is told to omit the line rather than guess. These are the backstop for when it guesses
// anyway: the placeholder must never reach the device, because Apply sends the CLI verbatim and
// the auth server would then silently never authenticate.

describe("isPlaceholderSecret", () => {
  it.each([
    "<UNKNOWN>", "<password>", "<your-secret>", "{{password}}", "changeme", "PASSWORD",
    "passwd", "secret", "your-password", "your_secret", "TODO", "tbd", "N/A", "placeholder",
    "xxxxx", "*****", ".....", "___", "---", "   ", "",
  ])("rejects %s", (v) => expect(isPlaceholderSecret(v)).toBe(true));

  it.each(["LdapPass@2024!", "RadiusSecret@2024", "Xk9$mQ2p", "correct-horse-battery"])(
    "accepts the real secret %s", (v) => expect(isPlaceholderSecret(v)).toBe(false));
});

describe("placeholder credentials never reach the draft", () => {
  it("drops an invented LDAP bind password", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "AD-Test"
        set server "10.0.5.10"
        set type regular
        set username "CN=svc-fgt,DC=corp,DC=local"
        set password "<UNKNOWN>"
    next
end`)!.form;
    // The username survives — only the made-up secret is dropped, so the wizard opens with the
    // Password field empty and required.
    expect(f.username).toBe("CN=svc-fgt,DC=corp,DC=local");
    expect(f.password).toBeUndefined();
    expect(ldapServerDraftToForm(f).password).toBeUndefined();
  });

  it("keeps a real LDAP bind password", () => {
    const f = parseLDAPServerFromCLI(`
config user ldap
    edit "AD-Test"
        set server "10.0.5.10"
        set type regular
        set username "svc"
        set password "LdapPass@2024!"
    next
end`)!.form;
    expect(f.password).toBe("LdapPass@2024!");
  });

  it("drops invented RADIUS secrets on both servers", () => {
    const f = parseRADIUSServerFromCLI(`
config user radius
    edit "NPS"
        set server "10.0.2.10"
        set secret "<UNKNOWN>"
        set secondary-server "10.0.2.11"
        set secondary-secret "changeme"
    next
end`)!.form;
    expect(f.secret).toBeUndefined();
    expect(f.secondary_secret).toBeUndefined();
    // The hosts are still real config the user asked for — they stay.
    expect(f.server).toBe("10.0.2.10");
    expect(f.secondary_server).toBe("10.0.2.11");
  });
});
