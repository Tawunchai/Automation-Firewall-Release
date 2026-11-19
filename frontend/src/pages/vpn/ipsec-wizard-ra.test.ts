import { describe, it, expect } from "vitest";
import {
  BLANK_VPN_WIZARD, templateSupported, isRemoteAccess, remoteAccessDeviceSupported,
  validateVPNStep, vpnStepValid, diagramTitle, raObjectNames, raObjectSummary, buildRemoteAccessPayload,
  raHasClientOptions, raShowsGroupName, raShowsEndpointRegistration, raShowsModeCfgOptions,
  raIsNative, raIsL2TP, raClientId, l2tpRouteNetwork, RA_DEFAULT_NETMASK,
  type VPNWizardState,
} from "./ipsec-wizard-rules";

// The Remote Access (dialup FortiClient) rules, pinned to the FortiGate GUI's own 5-step wizard and
// to the CMDB mapping verified live on a FortiGate 7.2.10 (see services/fortigate.go).

const ra = (over: Partial<VPNWizardState> = {}): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  name: "VPN_Remote",
  templateType: "remote-access",
  raDeviceKind: "client-based",
  raClient: "forticlient",
  outInterface: "port1",
  psk: "P@ssw0rd",
  userGroup: "Guest-group",
  localInterface: "lan",
  localAddresses: ["LAN-192.168.50.0"],
  clientRangeStart: "10.10.70.1",
  clientRangeEnd: "10.10.70.254",
  clientNetmask: "255.255.255.0",
  ...over,
});

describe("template + device support", () => {
  it("Remote Access is a supported template", () => {
    expect(templateSupported("remote-access")).toBe(true);
    expect(isRemoteAccess(ra())).toBe(true);
  });

  it("every remote device type is wired up", () => {
    expect(remoteAccessDeviceSupported(ra())).toBe(true);
    expect(remoteAccessDeviceSupported(ra({ raClient: "cisco" }))).toBe(true);
    for (const n of ["ios", "android", "windows"] as const) {
      expect(remoteAccessDeviceSupported(ra({ raDeviceKind: "native", raNative: n }))).toBe(true);
      expect(vpnStepValid(ra({ raDeviceKind: "native", raNative: n }), 0)).toBe(true);
    }
  });

  it("raClientId is what the backend keys the tunnel shape off", () => {
    expect(raClientId(ra())).toBe("forticlient");
    expect(raClientId(ra({ raClient: "cisco" }))).toBe("cisco");
    expect(raClientId(ra({ raDeviceKind: "native", raNative: "android" }))).toBe("android");
  });

  // FortiClient = 5 steps (Client Options), Cisco = 4 — exactly as the GUI renders them.
  it("only FortiClient has Client Options / Endpoint Registration; only Cisco has Group Name", () => {
    expect(raHasClientOptions(ra())).toBe(true);
    expect(raShowsEndpointRegistration(ra())).toBe(true);
    expect(raShowsGroupName(ra())).toBe(false);

    const cisco = ra({ raClient: "cisco" });
    expect(raHasClientOptions(cisco)).toBe(false);
    expect(raShowsEndpointRegistration(cisco)).toBe(false);
    expect(raShowsGroupName(cisco)).toBe(true);
  });

  it("each template's default Subnet Mask matches the GUI", () => {
    expect(RA_DEFAULT_NETMASK.forticlient).toBe("255.255.255.0");
    // The Cisco template just shows the device default for ipv4-netmask.
    expect(RA_DEFAULT_NETMASK.cisco).toBe("255.255.255.255");
  });

  it("the diagram calls it Dialup, per device type", () => {
    expect(diagramTitle(ra())).toBe("Dialup - FortiClient (Windows, Mac OS, Android)");
    expect(diagramTitle(ra({ raDeviceKind: "native", raNative: "android" }))).toBe("Dialup - Android (Native L2TP/IPsec)");
  });
});

describe("validateRAStep", () => {
  it("a fully-filled FortiClient config passes every step", () => {
    for (let s = 0; s < 3; s++) expect(vpnStepValid(ra(), s)).toBe(true);
  });

  it("step 0 requires a name", () => {
    expect(validateVPNStep(ra({ name: "" }), 0)).toHaveProperty("name");
    expect(vpnStepValid(ra({ raClient: "cisco" }), 0)).toBe(true);
  });

  it("step 1 requires the incoming interface, user group and a secret", () => {
    expect(validateVPNStep(ra({ outInterface: "" }), 1)).toHaveProperty("outInterface");
    expect(validateVPNStep(ra({ userGroup: "" }), 1)).toHaveProperty("userGroup");
    expect(validateVPNStep(ra({ psk: "" }), 1)).toHaveProperty("psk");
    // Signature swaps the PSK requirement for a certificate one.
    expect(validateVPNStep(ra({ authMethod: "signature", psk: "", certificate: "" }), 1)).toHaveProperty("certificate");
    expect(vpnStepValid(ra({ authMethod: "signature", psk: "", certificate: "Fortinet_Factory" }), 1)).toBe(true);
  });

  it("step 2 validates the client pool and split-tunnel members", () => {
    expect(validateVPNStep(ra({ localInterface: "" }), 2)).toHaveProperty("localInterface");
    expect(validateVPNStep(ra({ clientRangeStart: "nope" }), 2)).toHaveProperty("clientRangeStart");
    expect(validateVPNStep(ra({ clientRangeEnd: "999.1.1.1" }), 2)).toHaveProperty("clientRangeEnd");
    expect(validateVPNStep(ra({ clientNetmask: "nope" }), 2)).toHaveProperty("clientNetmask");
    // Split tunnel on ⇒ at least one local address; full tunnel ⇒ none needed.
    expect(validateVPNStep(ra({ splitTunnel: true, localAddresses: [""] }), 2)).toHaveProperty("localAddresses");
    expect(vpnStepValid(ra({ splitTunnel: false, localAddresses: [""] }), 2)).toBe(true);
    // Manual DNS must be a valid IP.
    expect(validateVPNStep(ra({ dnsMode: "manual", dnsServer: "nope" }), 2)).toHaveProperty("dnsServer");
    expect(vpnStepValid(ra({ dnsMode: "manual", dnsServer: "8.8.8.8" }), 2)).toBe(true);
  });

  it("Client Options (step 3) has nothing to validate", () => {
    expect(vpnStepValid(ra(), 3)).toBe(true);
  });
});

// These names MUST match services.RemoteAccessObjectNamesFor in the backend — the Review screen is
// what the user approves before Create, so a drift on either side is a lie on screen.
describe("raObjectNames + raObjectSummary", () => {
  it("names mirror the FortiGate wizard's Object Summary", () => {
    expect(raObjectNames("VPN_Remote")).toEqual({
      splitGroup: "VPN_Remote_split",
      phase1: "VPN_Remote",
      phase2: "VPN_Remote",
      clientRange: "VPN_Remote_range",
      policyL2TP: "vpn_VPN_Remote_l2tp", // Native only
      policyRemoteToLocal: "vpn_VPN_Remote_remote",
    });
  });

  it("the summary lists the split group only when split tunnelling is on", () => {
    const withSplit = raObjectSummary(ra({ splitTunnel: true })).map((r) => r.label);
    expect(withSplit).toContain("Split Tunnel Group");
    const full = raObjectSummary(ra({ splitTunnel: false })).map((r) => r.label);
    expect(full).not.toContain("Split Tunnel Group");
  });

  it("the summary matches the GUI's rows, in order, for the default FortiClient config", () => {
    expect(raObjectSummary(ra()).map((r) => `${r.label}=${r.value}`)).toEqual([
      "Split Tunnel Group=VPN_Remote_split",
      "Phase 1 interface=VPN_Remote",
      "Phase 2 interface=VPN_Remote",
      "Address=VPN_Remote_range",
      "Remote to local policies=vpn_VPN_Remote_remote",
      "Endpoint Registration=VPN_Remote",
    ]);
  });
});

describe("buildRemoteAccessPayload", () => {
  it("maps the wizard state onto the backend's dialup tunnelInput", () => {
    const p = buildRemoteAccessPayload(ra({ savePassword: true, autoConnect: true, alwaysUp: false }));
    expect(p).toMatchObject({
      name: "VPN_Remote",
      interface: "port1",
      ike_version: "1", // FortiClient negotiates IKEv1 mode-config
      remote_type: "dynamic",
      remote_access: true,
      auth_method: "psk",
      psk: "P@ssw0rd",
      user_group: "Guest-group",
      client_range_start: "10.10.70.1",
      client_range_end: "10.10.70.254",
      client_netmask: "255.255.255.0",
      split_tunnel: true,
      local_addresses: ["LAN-192.168.50.0"],
      save_password: true,
      auto_connect: true,
      always_up: false,
      create_firewall_policy: true,
    });
  });

  it("a signature tunnel sends the certificate, not the PSK", () => {
    const p = buildRemoteAccessPayload(ra({ authMethod: "signature", psk: "leftover", certificate: "Fortinet_Factory", peerCA: "Fortinet_CA" }));
    expect(p.psk).toBe("");
    expect(p.certificate).toBe("Fortinet_Factory");
    expect(p.peer_ca).toBe("Fortinet_CA");
  });

  it("a full tunnel sends no split-group members", () => {
    const p = buildRemoteAccessPayload(ra({ splitTunnel: false, localAddresses: ["LAN-192.168.50.0"] }));
    expect(p.split_tunnel).toBe(false);
    expect(p.local_addresses).toEqual([]);
  });

  it("manual DNS carries the server; auto sends none", () => {
    expect(buildRemoteAccessPayload(ra({ dnsMode: "manual", dnsServer: "8.8.8.8" })).dns_server).toBe("8.8.8.8");
    expect(buildRemoteAccessPayload(ra({ dnsMode: "auto", dnsServer: "8.8.8.8" })).dns_server).toBe("");
  });
});

// ─── Cisco IPsec Client ────────────────────────────────────────────────────────
// Pinned to what the device accepted live (see fortigate_ipsec_ra_test.go): a group name is an IKE
// identifier, and IKEv1 main mode identifies a peer only by IP — so it forces aggressive mode.

const cisco = (over: Partial<VPNWizardState> = {}): VPNWizardState =>
  ra({ raClient: "cisco", clientNetmask: "255.255.255.255", ...over });

describe("Cisco — Group Name (peerid)", () => {
  it("the diagram names the Cisco client", () => {
    expect(diagramTitle(cisco())).toBe("Dialup - Cisco IPsec Client");
  });

  it("a group name is required only once the box is ticked", () => {
    expect(vpnStepValid(cisco(), 1)).toBe(true);                                   // not required
    expect(validateVPNStep(cisco({ requireGroupName: true, groupName: "" }), 1)).toHaveProperty("groupName");
    expect(vpnStepValid(cisco({ requireGroupName: true, groupName: "SalesGroup" }), 1)).toBe(true);
  });

  it("FortiClient never asks for a group name, even with the flag set", () => {
    expect(vpnStepValid(ra({ requireGroupName: true, groupName: "" }), 1)).toBe(true);
  });

  it("the payload carries the group name and drops the FortiClient-only options", () => {
    const p = buildRemoteAccessPayload(cisco({ requireGroupName: true, groupName: "SalesGroup" }));
    expect(p).toMatchObject({
      ra_client: "cisco",
      require_group_name: true,
      group_name: "SalesGroup",
      client_netmask: "255.255.255.255",
      // The Cisco template has no Client Options / Endpoint Registration step.
      save_password: false,
      auto_connect: false,
      always_up: false,
      endpoint_registration: false,
    });
    expect(p.comments).toContain("Cisco IPsec Client");
  });

  it("a group name typed then un-ticked never reaches the device", () => {
    const p = buildRemoteAccessPayload(cisco({ requireGroupName: false, groupName: "SalesGroup" }));
    expect(p.require_group_name).toBe(false);
    expect(p.group_name).toBe("");
  });

  it("a FortiClient tunnel never carries Cisco fields, even from a stale session", () => {
    const p = buildRemoteAccessPayload(ra({ requireGroupName: true, groupName: "SalesGroup" }));
    expect(p.ra_client).toBe("forticlient");
    expect(p.require_group_name).toBe(false);
    expect(p.group_name).toBe("");
  });

  it("the Cisco Object Summary has no Endpoint Registration row", () => {
    const rows = raObjectSummary(cisco({ endpointRegistration: true })).map((r) => `${r.label}=${r.value}`);
    expect(rows).toEqual([
      "Split Tunnel Group=VPN_Remote_split",
      "Phase 1 interface=VPN_Remote",
      "Phase 2 interface=VPN_Remote",
      "Address=VPN_Remote_range",
      "Remote to local policies=vpn_VPN_Remote_remote",
    ]);
  });
});

// ─── Native (iOS / Android / Windows) — L2TP over IPsec ────────────────────────
// Pinned to the config the FortiGate's own Native wizard produced (see fortigate_ipsec_ra_test.go).
// This is a different tunnel technology, not a different client: the L2TP server does addressing
// and user auth, so there is no mode-config — and therefore no split tunnel, DNS or client options.

const nat = (over: Partial<VPNWizardState> = {}): VPNWizardState =>
  ra({ raDeviceKind: "native", raNative: "android", splitTunnel: false, ...over });

// 🔴 The assumption that cost the most: "Native" in the GUI does NOT mean L2TP. Only Android and
// Windows are; iOS is an ordinary IKE mode-config dialup (verified against the GUI's own tunnel:
// mode-cfg=enable, l2tp=disable, tunnel-mode) — which is why its diagram says "Dialup - iOS
// (Native)" with no "L2TP/IPsec" suffix, and why its steps keep DNS + Split Tunnel + Group Name.
describe("iOS is Native in the GUI but NOT L2TP", () => {
  const ios = (over: Partial<VPNWizardState> = {}) =>
    ra({ raDeviceKind: "native", raNative: "ios", ...over });

  it("is native by the GUI toggle, but not an L2TP tunnel", () => {
    expect(raIsNative(ios())).toBe(true);
    expect(raIsL2TP(ios())).toBe(false);
    // …whereas Android/Windows are.
    expect(raIsL2TP(nat({ raNative: "android" }))).toBe(true);
    expect(raIsL2TP(nat({ raNative: "windows" }))).toBe(true);
  });

  it("keeps the mode-config options (DNS + split tunnel) and gains Group Name", () => {
    expect(raShowsModeCfgOptions(ios())).toBe(true);  // DNS + Split Tunnel rows
    expect(raShowsGroupName(ios())).toBe(true);       // same box the Cisco template has
    expect(raHasClientOptions(ios())).toBe(false);    // …but no Client Options step (4 steps)
    expect(raShowsEndpointRegistration(ios())).toBe(false);
  });

  it("validates its Group Name exactly like Cisco", () => {
    expect(vpnStepValid(ios(), 1)).toBe(true);
    expect(validateVPNStep(ios({ requireGroupName: true, groupName: "" }), 1)).toHaveProperty("groupName");
    expect(vpnStepValid(ios({ requireGroupName: true, groupName: "SalesGroup" }), 1)).toBe(true);
  });

  it("gets the mode-config Object Summary — a Split Tunnel Group, and NO L2TP rows", () => {
    const rows = raObjectSummary(ios({ splitTunnel: true })).map((r) => r.label);
    expect(rows).toContain("Split Tunnel Group");
    expect(rows).not.toContain("L2TP");
    expect(rows).not.toContain("L2TP Policy");
    expect(rows).not.toContain("L2TP Route");
    expect(rows).not.toContain("Endpoint Registration");
  });

  it("its payload is mode-config, carrying split tunnel + DNS + group name", () => {
    const p = buildRemoteAccessPayload(ios({
      splitTunnel: true, localAddresses: ["LAN-192.168.50.0"],
      dnsMode: "manual", dnsServer: "8.8.8.8",
      requireGroupName: true, groupName: "SalesGroup",
    }));
    expect(p).toMatchObject({
      ra_client: "ios",
      split_tunnel: true,
      local_addresses: ["LAN-192.168.50.0"],
      dns_mode: "manual",
      dns_server: "8.8.8.8",
      require_group_name: true,
      group_name: "SalesGroup",
      // No Client Options step ⇒ never sent.
      save_password: false, auto_connect: false, always_up: false, endpoint_registration: false,
    });
  });

  it("defaults its Subnet Mask to the device default, like Cisco", () => {
    expect(RA_DEFAULT_NETMASK.ios).toBe("255.255.255.255");
  });
});

describe("Native — L2TP/IPsec (Android + Windows)", () => {
  it("is 4 steps with no mode-config options anywhere", () => {
    expect(raIsNative(nat())).toBe(true);
    expect(raIsL2TP(nat())).toBe(true);
    expect(raHasClientOptions(nat())).toBe(false);       // no Client Options step
    expect(raShowsEndpointRegistration(nat())).toBe(false);
    expect(raShowsGroupName(nat())).toBe(false);          // that is Cisco's and iOS's
    expect(raShowsModeCfgOptions(nat())).toBe(false);     // no split tunnel / DNS rows
  });

  it("the diagram names each native OS", () => {
    expect(diagramTitle(nat({ raNative: "ios" }))).toBe("Dialup - iOS (Native)");
    expect(diagramTitle(nat({ raNative: "android" }))).toBe("Dialup - Android (Native L2TP/IPsec)");
    expect(diagramTitle(nat({ raNative: "windows" }))).toBe("Dialup - Windows (Native L2TP/IPsec)");
  });

  it("always needs a local address — it is the policy's destination, not a split group", () => {
    expect(vpnStepValid(nat(), 2)).toBe(true);
    expect(validateVPNStep(nat({ localAddresses: [""] }), 2)).toHaveProperty("localAddresses");
  });

  it("never validates DNS, because Native has no DNS push", () => {
    // A stale "manual + junk DNS" from a FortiClient session must not block a Native tunnel.
    expect(vpnStepValid(nat({ dnsMode: "manual", dnsServer: "nope" }), 2)).toBe(true);
    // …but it still blocks a FortiClient one.
    expect(validateVPNStep(ra({ dnsMode: "manual", dnsServer: "nope" }), 2)).toHaveProperty("dnsServer");
  });

  // ⚠️ The single most surprising rule, verified live: the route is the range START masked by the
  // Subnet Mask — NOT the client range. 10.10.70.1 + /16 → 10.10.0.0/16.
  it("computes the L2TP route the way the device did", () => {
    expect(l2tpRouteNetwork("10.10.70.1", "255.255.0.0")).toBe("10.10.0.0/16");
    expect(l2tpRouteNetwork("10.10.70.1", "255.255.255.0")).toBe("10.10.70.0/24");
    expect(l2tpRouteNetwork("192.168.5.100", "255.255.255.0")).toBe("192.168.5.0/24");
    expect(l2tpRouteNetwork("10.10.70.1", "255.255.255.255")).toBe("10.10.70.1/32");
    expect(l2tpRouteNetwork("nope", "255.255.255.0")).toBe("");
    expect(l2tpRouteNetwork("10.10.70.1", "nope")).toBe("");
  });

  it("the Object Summary matches the GUI's Native Review, in order", () => {
    expect(raObjectSummary(nat()).map((r) => `${r.label}=${r.value}`)).toEqual([
      "Phase 1 interface=VPN_Remote",
      "Phase 2 interface=VPN_Remote",
      "L2TP=l2tp", // the singleton — one per VDOM, so no per-tunnel name
      "Address=VPN_Remote_range",
      "L2TP Policy=vpn_VPN_Remote_l2tp",
      "Remote to local policies=vpn_VPN_Remote_remote",
      "L2TP Route=static",
    ]);
  });

  it("the summary never shows a split group, even with a stale splitTunnel flag", () => {
    const labels = raObjectSummary(nat({ splitTunnel: true })).map((r) => r.label);
    expect(labels).not.toContain("Split Tunnel Group");
    expect(labels).not.toContain("Endpoint Registration");
  });

  it("the payload carries the OS + local addresses and drops every mode-config field", () => {
    const p = buildRemoteAccessPayload(nat({ raNative: "windows", localAddresses: ["LAN-192.168.50.0"] }));
    expect(p).toMatchObject({
      ra_client: "windows",
      remote_access: true,
      remote_type: "dynamic",
      ike_version: "1",
      user_group: "Guest-group",        // goes to `vpn l2tp`, not phase1
      local_addresses: ["LAN-192.168.50.0"], // the policy's dstaddr
      split_tunnel: false,
      save_password: false,
      auto_connect: false,
      always_up: false,
      endpoint_registration: false,
      require_group_name: false,
      group_name: "",
    });
    expect(p.dns_mode).toBeUndefined(); // Native has no DNS push at all
    expect(p.comments).toContain("Native");
  });

  it("stale FortiClient/Cisco state never leaks onto a Native tunnel", () => {
    const p = buildRemoteAccessPayload(nat({
      splitTunnel: true, savePassword: true, autoConnect: true, alwaysUp: true,
      endpointRegistration: true, requireGroupName: true, groupName: "SalesGroup",
      dnsMode: "manual", dnsServer: "8.8.8.8",
    }));
    expect(p.split_tunnel).toBe(false);
    expect(p.save_password).toBe(false);
    expect(p.endpoint_registration).toBe(false);
    expect(p.require_group_name).toBe(false);
    expect(p.group_name).toBe("");
    expect(p.dns_mode).toBeUndefined();
    expect(p.dns_server).toBe("");
  });

  it("the L2TP templates default the Subnet Mask to a /24", () => {
    // (iOS is not L2TP and defaults to the device default — see its own suite above.)
    for (const n of ["android", "windows"] as const) {
      expect(RA_DEFAULT_NETMASK[n]).toBe("255.255.255.0");
    }
  });
});
