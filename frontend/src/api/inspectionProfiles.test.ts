import { describe, it, expect } from "vitest";
import { emptySSLProtocol, EMPTY_SSLSSH_FORM, SSL_PROTOCOL_NAMES } from "./inspectionProfiles";

// A live full-system check found that creating an SSL/SSH Inspection profile with the form's own
// default values (every protocol block "disable") is refused by the real device with
// `-651 Must set at least one port or enable ssl inspect-all` — the `ssl` catch-all row has no
// ports by design, so a form where nothing else is enabled either leaves it with nothing to fall
// back on. Enabling `https` alone does NOT satisfy this (verified live); only the `ssl` row's own
// `inspect_all` field does, and "deep-inspection" is its only non-"disable" value. This test pins
// the fix: a brand-new, untouched default form must not be the one shape the device always rejects.

describe("emptySSLProtocol", () => {
  it("enables inspect_all only for the ssl catch-all row, not for a named protocol", () => {
    expect(emptySSLProtocol("ssl").inspect_all).toBe("deep-inspection");
    for (const name of SSL_PROTOCOL_NAMES.filter((n) => n !== "ssl")) {
      expect(emptySSLProtocol(name).inspect_all).toBe("disable");
    }
  });

  it("leaves every other field — status, ports, cert handling — exactly as before", () => {
    const ssl = emptySSLProtocol("ssl");
    expect(ssl.status).toBe("disable");
    expect(ssl.ports).toEqual([]);
    expect(ssl.client_certificate).toBe("bypass");
  });
});

describe("EMPTY_SSLSSH_FORM", () => {
  it("is not the all-disabled shape the device refuses to create", () => {
    const hasSomethingEnabled = EMPTY_SSLSSH_FORM.protocols.some(
      (p) => p.status !== "disable" || p.inspect_all !== "disable",
    );
    expect(hasSomethingEnabled).toBe(true);
  });
});
