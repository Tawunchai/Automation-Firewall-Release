import { describe, it, expect } from "vitest";
import {
  BLANK_VPN_WIZARD, remoteTypeOf, natTraversalOf, showsRemoteAddress, diagramTitle, natBadgeSide,
  remoteSubnetsLocked, effectiveRemoteSubnets, validateVPNStep, vpnStepValid, buildTunnelPayload,
  vpnObjectNames, vpnObjectSummary, templateSupported,
  type VPNWizardState,
} from "./ipsec-wizard-rules";

// The rules behind the VPN Creation Wizard, pinned to the FortiGate GUI's own behaviour and to
// the CMDB mapping verified live on a FortiGate 7.2.10 (see services/fortigate.go).

const st = (over: Partial<VPNWizardState> = {}): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  name: "VPN_TEST",
  remoteGw: "10.10.10.254",
  outInterface: "port1",
  psk: "P@ssw0rd",
  localSubnets: ["192.168.1.0/24"],
  remoteSubnets: ["192.168.9.0/24"],
  ...over,
});

// ─── The NAT configuration → tunnel type mapping ─────────────────────────────

describe("remoteTypeOf", () => {
  it("No NAT between sites → a static site-to-site tunnel", () => {
    expect(remoteTypeOf(st({ natConfig: "none" }))).toBe("static");
  });

  it("This site is behind NAT → still static (only NAT-T changes)", () => {
    expect(remoteTypeOf(st({ natConfig: "this-site" }))).toBe("static");
  });

  // The least obvious rule in the whole wizard, and the reason the GUI's diagram re-titles itself:
  // a remote behind NAT has no address to dial, so the tunnel becomes a dialup listener.
  it("The remote site is behind NAT → DIALUP (type=dynamic)", () => {
    expect(remoteTypeOf(st({ natConfig: "remote-site" }))).toBe("dynamic");
  });

  it("Dynamic DNS → ddns", () => {
    expect(remoteTypeOf(st({ remoteDeviceKind: "ddns" }))).toBe("ddns");
  });

  // Dialup wins: there is no remote address at all to resolve.
  it("remote-behind-NAT beats Dynamic DNS", () => {
    expect(remoteTypeOf(st({ natConfig: "remote-site", remoteDeviceKind: "ddns" }))).toBe("dynamic");
  });
});

describe("natTraversalOf", () => {
  it("forces NAT-T only when THIS site is behind NAT", () => {
    expect(natTraversalOf(st({ natConfig: "this-site" }))).toBe("forced");
    expect(natTraversalOf(st({ natConfig: "none" }))).toBe("enable");
    expect(natTraversalOf(st({ natConfig: "remote-site" }))).toBe("enable");
  });
});

describe("showsRemoteAddress", () => {
  it("hides the remote address row for a dialup tunnel", () => {
    expect(showsRemoteAddress(st({ natConfig: "remote-site" }))).toBe(false);
    expect(showsRemoteAddress(st({ natConfig: "none" }))).toBe(true);
    expect(showsRemoteAddress(st({ natConfig: "this-site" }))).toBe(true);
  });
});

// ─── The diagram (right-hand panel) ──────────────────────────────────────────

describe("diagramTitle", () => {
  it("matches the GUI for every combination", () => {
    expect(diagramTitle(st({ natConfig: "none" }))).toBe("Site to Site - FortiGate");
    expect(diagramTitle(st({ natConfig: "this-site" }))).toBe("Site to Site - FortiGate");
    // Screenshot 3: choosing "The remote site is behind NAT" re-titles it Dialup.
    expect(diagramTitle(st({ natConfig: "remote-site" }))).toBe("Dialup - FortiGate");
    // Screenshot 4: Cisco.
    expect(diagramTitle(st({ remoteDeviceType: "cisco" }))).toBe("Site to Site - Cisco");
    expect(diagramTitle(st({ remoteDeviceType: "cisco", natConfig: "remote-site" }))).toBe("Dialup - Cisco");
  });
});

describe("natBadgeSide", () => {
  it("puts the NAT badge on the side that is behind NAT", () => {
    expect(natBadgeSide(st({ natConfig: "none" }))).toBeNull();
    expect(natBadgeSide(st({ natConfig: "this-site" }))).toBe("local");
    expect(natBadgeSide(st({ natConfig: "remote-site" }))).toBe("remote");
  });
});

// ─── Policy & Routing ────────────────────────────────────────────────────────

describe("remote subnets", () => {
  it("locks the remote selector to the default route for Use Remote", () => {
    const s = st({ internetAccess: "use-remote", remoteSubnets: ["192.168.9.0/24"] });
    expect(remoteSubnetsLocked(s)).toBe(true);
    // Whatever the user typed earlier is overridden — the tunnel IS the default route now.
    expect(effectiveRemoteSubnets(s)).toEqual(["0.0.0.0/0"]);
  });

  it("keeps what the user entered otherwise", () => {
    const s = st({ internetAccess: "share-local", remoteSubnets: ["192.168.9.0/24", " ", "10.0.0.0/8"] });
    expect(remoteSubnetsLocked(s)).toBe(false);
    expect(effectiveRemoteSubnets(s)).toEqual(["192.168.9.0/24", "10.0.0.0/8"]);
  });
});

// ─── Validation ──────────────────────────────────────────────────────────────

describe("validateVPNStep", () => {
  it("passes a complete Site-to-Site config on every step", () => {
    const s = st();
    for (const step of [0, 1, 2]) expect(vpnStepValid(s, step)).toBe(true);
  });

  it("step 1 needs a name", () => {
    expect(validateVPNStep(st({ name: "  " }), 0).name).toBe("This field is required.");
  });

  it("every VPN template this wizard offers is now wired up", () => {
    // All four templates build a real tunnel: Site to Site, Remote Access, Custom and Hub-and-Spoke.
    expect(templateSupported("site-to-site")).toBe(true);
    expect(templateSupported("remote-access")).toBe(true);
    expect(templateSupported("custom")).toBe(true);
    expect(templateSupported("hub-and-spoke")).toBe(true);
    // A supported template no longer raises a templateType "dead end" error on step 0.
    expect(validateVPNStep(st({ templateType: "hub-and-spoke", name: "HS" }), 0).templateType).toBeUndefined();
  });

  it("step 2 needs a remote IP — unless the tunnel is dialup", () => {
    expect(validateVPNStep(st({ remoteGw: "" }), 1).remoteGw).toBeTruthy();
    expect(validateVPNStep(st({ remoteGw: "", natConfig: "remote-site" }), 1).remoteGw).toBeUndefined();
  });

  it("step 2 needs an FQDN for Dynamic DNS", () => {
    expect(validateVPNStep(st({ remoteDeviceKind: "ddns", remoteFqdn: "" }), 1).remoteFqdn).toBeTruthy();
    expect(validateVPNStep(st({ remoteDeviceKind: "ddns", remoteFqdn: "b.example.com" }), 1).remoteFqdn).toBeUndefined();
  });

  it("step 2 needs the outgoing interface and the chosen credential", () => {
    expect(validateVPNStep(st({ outInterface: "" }), 1).outInterface).toBeTruthy();
    expect(validateVPNStep(st({ psk: "" }), 1).psk).toBeTruthy();
    // Signature needs a certificate instead of a PSK.
    expect(validateVPNStep(st({ authMethod: "signature", psk: "" }), 1).psk).toBeUndefined();
    expect(validateVPNStep(st({ authMethod: "signature", psk: "" }), 1).certificate).toBeTruthy();
    expect(validateVPNStep(st({ authMethod: "signature", psk: "", certificate: "Fortinet_Factory" }), 1).certificate).toBeUndefined();
  });

  it("step 3 needs both selectors — but Use Remote fills the remote one in", () => {
    expect(validateVPNStep(st({ localSubnets: [""] }), 2).localSubnets).toBeTruthy();
    expect(validateVPNStep(st({ remoteSubnets: [""] }), 2).remoteSubnets).toBeTruthy();
    expect(validateVPNStep(st({ remoteSubnets: [""], internetAccess: "use-remote", localGateway: "10.0.99.1" }), 2).remoteSubnets)
      .toBeUndefined();
  });

  it("step 3 needs the Shared WAN / Local Gateway their modes depend on", () => {
    expect(validateVPNStep(st({ internetAccess: "share-local" }), 2).sharedWAN).toBeTruthy();
    expect(validateVPNStep(st({ internetAccess: "share-local", sharedWAN: "wan1" }), 2).sharedWAN).toBeUndefined();
    expect(validateVPNStep(st({ internetAccess: "use-remote", localGateway: "" }), 2).localGateway).toBeTruthy();
    expect(validateVPNStep(st({ internetAccess: "use-remote", localGateway: "10.0.99.1" }), 2).localGateway).toBeUndefined();
  });
});

// ─── Payload ─────────────────────────────────────────────────────────────────

describe("buildTunnelPayload", () => {
  it("builds a plain Site-to-Site PSK tunnel", () => {
    const p = buildTunnelPayload(st());
    expect(p).toMatchObject({
      name: "VPN_TEST", interface: "port1",
      remote_type: "static", remote_gw: "10.10.10.254", remote_ddns: "",
      nattraversal: "enable", auth_method: "psk", psk: "P@ssw0rd",
      certificate: "", peer_ca: "",
      local_subnets: ["192.168.1.0/24"], remote_subnets: ["192.168.9.0/24"],
      internet_access: "none", shared_wan: "", local_gateway: "",
      create_static_route: true, create_firewall_policy: true,
    });
  });

  it("this site behind NAT forces NAT-T", () => {
    expect(buildTunnelPayload(st({ natConfig: "this-site" })).nattraversal).toBe("forced");
  });

  // A stale remote_gw on a dialup tunnel would configure something the user never chose.
  it("dialup sends no remote gateway even when one was typed earlier", () => {
    const p = buildTunnelPayload(st({ natConfig: "remote-site", remoteGw: "10.10.10.254" }));
    expect(p.remote_type).toBe("dynamic");
    expect(p.remote_gw).toBe("");
  });

  it("Dynamic DNS sends the FQDN and no IP", () => {
    const p = buildTunnelPayload(st({ remoteDeviceKind: "ddns", remoteFqdn: "branch.example.com" }));
    expect(p.remote_type).toBe("ddns");
    expect(p.remote_ddns).toBe("branch.example.com");
    expect(p.remote_gw).toBe("");
  });

  // Same trap in the other direction: a leftover PSK must not ride along with a signature tunnel.
  it("signature sends the certificate and drops the PSK", () => {
    const p = buildTunnelPayload(st({ authMethod: "signature", certificate: "Fortinet_Factory", peerCA: "Fortinet_CA", psk: "left-over" }));
    expect(p).toMatchObject({ auth_method: "signature", psk: "", certificate: "Fortinet_Factory", peer_ca: "Fortinet_CA" });
  });

  it("PSK drops a leftover certificate", () => {
    const p = buildTunnelPayload(st({ authMethod: "psk", certificate: "Fortinet_Factory", peerCA: "Fortinet_CA" }));
    expect(p).toMatchObject({ auth_method: "psk", certificate: "", peer_ca: "" });
  });

  it("Use Remote pins the remote selector and sends the local gateway", () => {
    const p = buildTunnelPayload(st({ internetAccess: "use-remote", localGateway: "10.0.99.1", remoteSubnets: ["192.168.9.0/24"] }));
    expect(p.remote_subnets).toEqual(["0.0.0.0/0"]);
    expect(p.local_gateway).toBe("10.0.99.1");
    expect(p.shared_wan).toBe("");
  });

  it("Share Local sends the shared WAN and no local gateway", () => {
    const p = buildTunnelPayload(st({ internetAccess: "share-local", sharedWAN: "wan1", localGateway: "10.0.99.1" }));
    expect(p.shared_wan).toBe("wan1");
    expect(p.local_gateway).toBe("");
  });
});

// ─── Object Summary (step 4) ─────────────────────────────────────────────────

describe("vpnObjectNames", () => {
  // Taken verbatim from the FortiGate wizard's own Review Settings screen for a tunnel named
  // VPN_TEST. These MUST match services.VPNObjectNamesFor in the backend — the summary is what
  // the user approves before pressing Create.
  it("matches FortiGate's naming for VPN_TEST", () => {
    expect(vpnObjectNames("VPN_TEST")).toEqual({
      phase1: "VPN_TEST",
      phase2: "VPN_TEST",
      localAddress: "VPN_TEST_local",
      remoteAddress: "VPN_TEST_remote",
      remoteGatewayAddress: "VPN_TEST_remote_gateway",
      policyLocalToRemote: "vpn_VPN_TEST_local",
      policyRemoteToLocal: "vpn_VPN_TEST_remote",
    });
  });
});

describe("vpnObjectSummary", () => {
  it("lists the GUI's rows, in the GUI's order", () => {
    expect(vpnObjectSummary(st()).map((r) => [r.label, r.value])).toEqual([
      ["Phase 1 interface", "VPN_TEST"],
      ["Local address group", "VPN_TEST_local"],
      ["Remote address group", "VPN_TEST_remote"],
      ["Phase 2 interface", "VPN_TEST"],
      ["Static route", "static"],
      ["Blackhole route", "static"],
      ["Local to remote policies", "vpn_VPN_TEST_local"],
      ["Remote to local policies", "vpn_VPN_TEST_remote"],
    ]);
  });

  // The Remote Gateway objects exist to keep the tunnel reachable once the default route points
  // into it — so they belong to "Use Remote" and nowhere else.
  it("adds the Remote Gateway rows only for Use Remote", () => {
    const labels = (s: VPNWizardState) => vpnObjectSummary(s).map((r) => r.label);
    expect(labels(st())).not.toContain("Remote Gateway Address");
    expect(labels(st({ internetAccess: "share-local", sharedWAN: "wan1" }))).not.toContain("Remote Gateway Address");

    const useRemote = labels(st({ internetAccess: "use-remote", localGateway: "10.0.99.1" }));
    expect(useRemote).toContain("Remote Gateway Address");
    expect(useRemote).toContain("Remote Gateway Route");
    expect(useRemote).toContain("Internet access policy");
  });

  // A dialup tunnel has no remote gateway at all, so there is nothing to route around.
  it("omits the Remote Gateway rows for a dialup tunnel even on Use Remote", () => {
    const labels = vpnObjectSummary(st({ natConfig: "remote-site", internetAccess: "use-remote", localGateway: "10.0.99.1" }))
      .map((r) => r.label);
    expect(labels).not.toContain("Remote Gateway Address");
    expect(labels).not.toContain("Remote Gateway Route");
  });

  it("names the Share Local internet policy", () => {
    const rows = vpnObjectSummary(st({ internetAccess: "share-local", sharedWAN: "wan1" }));
    expect(rows.find((r) => r.label === "Internet access policy")?.value).toBe("vpn_VPN_TEST_share");
  });

  it("never shows a blank name before one is typed", () => {
    expect(vpnObjectSummary(st({ name: "" })).every((r) => r.value.trim().length > 0)).toBe(true);
  });
});
