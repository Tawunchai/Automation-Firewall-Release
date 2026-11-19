import { describe, it, expect } from "vitest";
import {
  BLANK_VPN_WIZARD, templateSupported, isCustom, isRemoteAccess,
  validateVPNStep, vpnStepValid, diagramTitle, customObjectSummary, buildCustomPayload,
  customRemoteTypeOf, serializeP1Proposal, serializeP2Proposal, serializeDH, isAEADCipher,
  p1ProposalDefaultFor, P1_PROPOSAL_DEFAULT_V1, P1_PROPOSAL_DEFAULT_V2,
  parseProposal, parseDH, customStateFromEdit, isIPv6, subnetValidFor,
  type VPNWizardState, type CustomState,
} from "./ipsec-wizard-rules";
import type { IPsecTunnelEdit } from "../../api/policyObject";

// The Custom template's pure rules, pinned to the FortiGate GUI's manual "New VPN Tunnel" form and
// to the CMDB mapping verified live on a FortiGate 7.2.10 (see fortigate_ipsec_custom_test.go).

const cx = (over: Partial<CustomState> = {}): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  name: "CX_Test",
  templateType: "custom",
  outInterface: "port1",
  authMethod: "psk",
  psk: "Custom12345678",
  custom: { ...BLANK_VPN_WIZARD.custom, remoteGwIP: "10.10.10.250", ...over },
});

describe("template support", () => {
  it("Custom is a supported template", () => {
    expect(templateSupported("custom")).toBe(true);
    expect(isCustom(cx())).toBe(true);
    expect(isRemoteAccess(cx())).toBe(false);
  });

  it("the diagram names it Custom by remote gateway type", () => {
    expect(diagramTitle(cx())).toBe("Custom - Static");
    expect(diagramTitle(cx({ remoteGateway: "dialup" }))).toBe("Custom - Dialup");
    expect(diagramTitle(cx({ remoteGateway: "ddns" }))).toBe("Custom - Dynamic DNS");
  });

  it("the Object Summary is just the tunnel (Custom creates nothing else)", () => {
    expect(customObjectSummary(cx()).map((r) => `${r.label}=${r.value}`)).toEqual([
      "Phase 1 interface=CX_Test",
      "Phase 2 interface=CX_Test",
    ]);
  });
});

describe("customRemoteTypeOf", () => {
  it("maps the Remote Gateway choice to the phase1 type", () => {
    expect(customRemoteTypeOf(cx().custom)).toBe("static");
    expect(customRemoteTypeOf(cx({ remoteGateway: "dialup" }).custom)).toBe("dynamic");
    expect(customRemoteTypeOf(cx({ remoteGateway: "ddns" }).custom)).toBe("ddns");
  });
});

describe("proposal + DH serialization", () => {
  it("phase1 pairs every cipher with an algorithm (AEAD ⇒ PRF)", () => {
    expect(serializeP1Proposal([
      { enc: "aes128", auth: "sha256" }, { enc: "aes256gcm", auth: "prfsha384" },
    ])).toBe("aes128-sha256 aes256gcm-prfsha384");
  });

  it("phase2 leaves an AEAD cipher standing alone", () => {
    expect(serializeP2Proposal([
      { enc: "aes256", auth: "sha256" }, { enc: "aes128gcm", auth: "" }, { enc: "chacha20poly1305", auth: "" },
    ])).toBe("aes256-sha256 aes128gcm chacha20poly1305");
  });

  it("incomplete rows are dropped from the serialized string", () => {
    expect(serializeP1Proposal([{ enc: "aes256", auth: "" }, { enc: "", auth: "sha1" }])).toBe("");
    // A CBC cipher in phase2 still needs its auth; an AEAD one does not.
    expect(serializeP2Proposal([{ enc: "aes256", auth: "" }, { enc: "aes256gcm", auth: "" }])).toBe("aes256gcm");
  });

  it("isAEADCipher recognises the self-authenticating ciphers", () => {
    for (const e of ["aes128gcm", "aes256gcm", "chacha20poly1305"]) expect(isAEADCipher(e)).toBe(true);
    for (const e of ["aes128", "aes256", "3des"]) expect(isAEADCipher(e)).toBe(false);
  });

  it("DH groups serialize high-to-low, ignoring order of selection", () => {
    expect(serializeDH([5, 14])).toBe("14 5");
    expect(serializeDH([2, 20, 14])).toBe("20 14 2");
    expect(serializeDH([])).toBe("");
  });

  it("the phase1 proposal defaults differ per IKE version", () => {
    expect(p1ProposalDefaultFor("1")).toEqual(P1_PROPOSAL_DEFAULT_V1);
    expect(p1ProposalDefaultFor("2")).toEqual(P1_PROPOSAL_DEFAULT_V2);
    // …and it returns copies, not the shared arrays (so edits can't mutate the defaults).
    expect(p1ProposalDefaultFor("2")).not.toBe(P1_PROPOSAL_DEFAULT_V2);
  });
});

describe("validateCustomStep", () => {
  it("a fully-filled config passes every step", () => {
    for (let s = 0; s < 4; s++) expect(vpnStepValid(cx(), s)).toBe(true);
  });

  it("step 0 requires a name (IPv6 is allowed)", () => {
    expect(validateVPNStep(cx({}), 0)).toEqual({});
    expect(validateVPNStep({ ...cx(), name: "" }, 0)).toHaveProperty("name");
    // IPv6 is no longer gated at step 0 — it's a valid choice.
    expect(validateVPNStep(cx({ ipVersion: "6" }), 0)).toEqual({});
  });

  it("step 1 validates the remote gateway per type + the interface", () => {
    expect(validateVPNStep(cx({ remoteGwIP: "" }), 1)).toHaveProperty("remoteGwIP");
    expect(validateVPNStep(cx({ remoteGwIP: "nope" }), 1)).toHaveProperty("remoteGwIP");
    // Dialup needs no address.
    expect(vpnStepValid(cx({ remoteGateway: "dialup", remoteGwIP: "" }), 1)).toBe(true);
    // DDNS needs an FQDN.
    expect(validateVPNStep(cx({ remoteGateway: "ddns", remoteDdns: "" }), 1)).toHaveProperty("remoteDdns");
    // Missing interface.
    expect(validateVPNStep({ ...cx(), outInterface: "" }, 1)).toHaveProperty("outInterface");
    // Specify local gateway needs a valid IP.
    expect(validateVPNStep(cx({ localGwEnabled: true, localGwMode: "specify", localGwIP: "" }), 1)).toHaveProperty("localGwIP");
    expect(vpnStepValid(cx({ localGwEnabled: true, localGwMode: "primary" }), 1)).toBe(true);
  });

  it("step 2 validates auth, proposals and DH groups", () => {
    expect(validateVPNStep({ ...cx(), psk: "" }, 2)).toHaveProperty("psk");
    expect(validateVPNStep({ ...cx(), authMethod: "signature", certificate: "" }, 2)).toHaveProperty("certificate");
    // "Specify a peer ID" (signature) needs the ID.
    expect(validateVPNStep({ ...cx({ peerType: "one", peerId: "" }), authMethod: "signature", certificate: "F" }, 2)).toHaveProperty("peerId");
    // At least one complete proposal + one DH group.
    expect(validateVPNStep(cx({ p1Proposals: [{ enc: "aes256", auth: "" }] }), 2)).toHaveProperty("p1Proposals");
    expect(validateVPNStep(cx({ p1DHGroups: [] }), 2)).toHaveProperty("p1DHGroups");
  });

  it("step 3 validates phase2 subnets, proposals, PFS and ports", () => {
    expect(validateVPNStep(cx({ p2LocalSubnet: "nope" }), 3)).toHaveProperty("p2LocalSubnet");
    // Empty subnets are allowed (they mean 0.0.0.0/0).
    expect(vpnStepValid(cx({ p2LocalSubnet: "", p2RemoteSubnet: "" }), 3)).toBe(true);
    expect(validateVPNStep(cx({ p2Proposals: [{ enc: "", auth: "" }] }), 3)).toHaveProperty("p2Proposals");
    // PFS on ⇒ at least one DH group.
    expect(validateVPNStep(cx({ p2Pfs: true, p2DHGroups: [] }), 3)).toHaveProperty("p2DHGroups");
    expect(vpnStepValid(cx({ p2Pfs: false, p2DHGroups: [] }), 3)).toBe(true);
    // A specific (non-All) port must be numeric and in range.
    expect(validateVPNStep(cx({ p2LocalPortAll: false, p2LocalPort: "nope" }), 3)).toHaveProperty("p2LocalPort");
    expect(vpnStepValid(cx({ p2LocalPortAll: false, p2LocalPort: "443" }), 3)).toBe(true);
  });
});

describe("buildCustomPayload", () => {
  it("serializes the whole Custom state onto the backend's tunnelInput", () => {
    const p = buildCustomPayload(cx({
      ikeVersion: "1", ikeMode: "aggressive", peerType: "any",
      keepalive: "15", dpd: "on-idle", dpdRetryCount: "4", dpdRetryInterval: "25", keylife: "28800",
      localId: "HQ-ID",
      p1Proposals: [{ enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" }],
      p1DHGroups: [14, 5],
      p2LocalSubnet: "192.168.10.0/24", p2RemoteSubnet: "192.168.20.0/24",
      p2Proposals: [{ enc: "aes256", auth: "sha256" }], p2DHGroups: [14, 5],
    }));
    expect(p).toMatchObject({
      name: "CX_Test", interface: "port1", ike_version: "1",
      remote_type: "static", remote_gw: "10.10.10.250",
      auth_method: "psk", psk: "Custom12345678",
      proposal: "aes128-sha256 aes256-sha256", dhgroup: "14 5",
    });
    expect(p.custom).toMatchObject({
      ip_version: "4", ike_mode: "aggressive", keepalive: "15",
      dpd: "on-idle", dpd_retry_count: "4", dpd_retry_interval: "25", keylife: "28800",
      local_id: "HQ-ID",
      p2_local_subnet: "192.168.10.0/24", p2_remote_subnet: "192.168.20.0/24",
      p2_proposal: "aes256-sha256", p2_dhgroup: "14 5",
    });
  });

  it("drops mode on IKEv2, peer ID unless signature+one, and empty subnets stay empty (default 0/0)", () => {
    const p = buildCustomPayload(cx({ ikeVersion: "2", ikeMode: "aggressive", peerType: "one", peerId: "X" }));
    expect(p.custom?.ike_mode).toBeUndefined();     // IKEv2 has no Mode
    expect(p.custom?.peer_id).toBe("");             // PSK ⇒ no Peer Options
    expect(p.custom?.peer_type).toBe("any");
  });

  it("a signature tunnel sends the certificate and peer ID, not the PSK", () => {
    const p = buildCustomPayload({ ...cx({ peerType: "one", peerId: "BranchID" }), authMethod: "signature", certificate: "Fortinet_Factory", peerCA: "Fortinet_CA" });
    expect(p.psk).toBe("");
    expect(p.certificate).toBe("Fortinet_Factory");
    expect(p.peer_ca).toBe("Fortinet_CA");
    expect(p.custom?.peer_type).toBe("one");
    expect(p.custom?.peer_id).toBe("BranchID");
  });

  it("PFS off clears the phase2 DH group; ports default to All (0)", () => {
    const p = buildCustomPayload(cx({ p2Pfs: false, p2DHGroups: [14, 5] }));
    expect(p.custom?.p2_dhgroup).toBe("");
    expect(p.custom?.p2_local_port).toBe("0");
    expect(p.custom?.p2_remote_port).toBe("0");
    expect(p.custom?.p2_protocol).toBe("0");
  });

  it("Dialup / DDNS gateways send the right remote field and clear the other", () => {
    const dialup = buildCustomPayload(cx({ remoteGateway: "dialup" }));
    expect(dialup.remote_type).toBe("dynamic");
    expect(dialup.remote_gw).toBe("");
    const ddns = buildCustomPayload(cx({ remoteGateway: "ddns", remoteDdns: "branch.example.com" }));
    expect(ddns.remote_type).toBe("ddns");
    expect(ddns.remote_ddns).toBe("branch.example.com");
    expect(ddns.remote_gw).toBe("");
  });
});

// ─── IPv6 ──────────────────────────────────────────────────────────────────────
describe("IPv6 custom tunnels", () => {
  const v6 = (over: Partial<CustomState> = {}): VPNWizardState =>
    cx({ ipVersion: "6", remoteGwIP: "2001:db8:0:1::1", p2LocalSubnet: "2001:db8:0:10::/64", p2RemoteSubnet: "2001:db8:0:20::/64", ...over });

  it("isIPv6 accepts addresses and rejects IPv4", () => {
    expect(isIPv6("2001:db8::1")).toBe(true);
    expect(isIPv6("::")).toBe(true);
    expect(isIPv6("10.0.0.1")).toBe(false);
    expect(isIPv6("nope")).toBe(false);
  });

  it("subnetValidFor is family-aware", () => {
    expect(subnetValidFor("2001:db8::/64", "6")).toBe(true);
    expect(subnetValidFor("192.168.1.0/24", "6")).toBe(false);
    expect(subnetValidFor("192.168.1.0/24", "4")).toBe(true);
    expect(subnetValidFor("2001:db8::/64", "4")).toBe(false);
  });

  it("step 1 validates the remote gateway against the IPv6 family", () => {
    expect(vpnStepValid(v6(), 1)).toBe(true);
    // An IPv4 address on an IPv6 tunnel is a mismatch.
    expect(validateVPNStep(v6({ remoteGwIP: "10.0.0.1" }), 1)).toHaveProperty("remoteGwIP");
  });

  it("step 3 validates IPv6 phase2 subnets", () => {
    expect(vpnStepValid(v6(), 3)).toBe(true);
    expect(validateVPNStep(v6({ p2LocalSubnet: "192.168.1.0/24" }), 3)).toHaveProperty("p2LocalSubnet");
  });

  it("the payload carries ip_version 6 and the v6 gateway/subnets", () => {
    const p = buildCustomPayload(v6());
    expect(p.remote_gw).toBe("2001:db8:0:1::1");
    expect(p.custom?.ip_version).toBe("6");
    expect(p.custom?.p2_local_subnet).toBe("2001:db8:0:10::/64");
  });
});

// ─── Edit (parse + round-trip) ───────────────────────────────────────────────────
describe("proposal / DH parsing (inverse of serialize)", () => {
  it("parseProposal splits enc-auth, leaving AEAD standalone ciphers blank", () => {
    expect(parseProposal("aes128-sha256 aes256gcm-prfsha384")).toEqual([
      { enc: "aes128", auth: "sha256" }, { enc: "aes256gcm", auth: "prfsha384" },
    ]);
    expect(parseProposal("aes256-sha256 aes128gcm chacha20poly1305")).toEqual([
      { enc: "aes256", auth: "sha256" }, { enc: "aes128gcm", auth: "" }, { enc: "chacha20poly1305", auth: "" },
    ]);
  });

  it("serialize ∘ parse is the identity for phase1 and phase2", () => {
    const p1 = "aes128-sha256 aes256gcm-prfsha384 chacha20poly1305-prfsha256";
    expect(serializeP1Proposal(parseProposal(p1))).toBe(p1);
    const p2 = "aes256-sha256 aes128gcm chacha20poly1305";
    expect(serializeP2Proposal(parseProposal(p2))).toBe(p2);
  });

  it("parseDH is the inverse of serializeDH", () => {
    expect(parseDH("14 5")).toEqual([14, 5]);
    expect(serializeDH(parseDH("20 14 2"))).toBe("20 14 2");
    expect(parseDH("")).toEqual([]);
  });
});

describe("customStateFromEdit (load a tunnel back into the form)", () => {
  const edit: IPsecTunnelEdit = {
    name: "Edit_Me", interface: "port1", ike_version: "2",
    remote_type: "static", remote_gw: "10.10.10.5", remote_ddns: "",
    nattraversal: "forced", auth_method: "psk", has_psk: true, certificate: "",
    comments: "loaded", proposal: "aes128-sha256 aes256-sha256", dhgroup: "14 5",
    custom: {
      ip_version: "4", local_gateway: "10.0.99.9", mode_config: false,
      keepalive: "20", dpd: "on-idle", dpd_retry_count: "4", dpd_retry_interval: "25",
      fec_egress: false, fec_ingress: false,
      add_route: true, auto_discovery_sender: false, auto_discovery_receiver: false,
      exchange_interface_ip: false, net_device: false, aggregate_member: false,
      ike_mode: "main", peer_type: "any", peer_id: "", local_id: "HQ", keylife: "28800",
      p2_local_subnet: "192.168.1.0/24", p2_remote_subnet: "192.168.2.0/24",
      p2_proposal: "aes256-sha256 aes256gcm", p2_replay: true, p2_pfs: true, p2_dhgroup: "14 5",
      p2_local_port: "0", p2_remote_port: "443", p2_protocol: "6",
      p2_auto_negotiate: true, p2_keepalive: false, p2_keylife_seconds: "43200",
    },
  };

  it("maps a tunnel into a Custom wizard state, PSK left blank", () => {
    const s = customStateFromEdit(edit);
    expect(s.templateType).toBe("custom");
    expect(s.name).toBe("Edit_Me");
    expect(s.outInterface).toBe("port1");
    expect(s.psk).toBe(""); // never read back — blank keeps the stored secret
    expect(s.custom.remoteGateway).toBe("static");
    expect(s.custom.remoteGwIP).toBe("10.10.10.5");
    expect(s.custom.localGwEnabled).toBe(true);
    expect(s.custom.localGwMode).toBe("specify");
    expect(s.custom.dpd).toBe("on-idle");
    expect(s.custom.p1Proposals).toEqual([{ enc: "aes128", auth: "sha256" }, { enc: "aes256", auth: "sha256" }]);
    expect(s.custom.p1DHGroups).toEqual([14, 5]);
    // Ports: 0 ⇒ All, a specific value ⇒ not All.
    expect(s.custom.p2LocalPortAll).toBe(true);
    expect(s.custom.p2RemotePortAll).toBe(false);
    expect(s.custom.p2RemotePort).toBe("443");
    expect(s.custom.p2ProtocolAll).toBe(false);
  });

  it("round-trips: buildCustomPayload(customStateFromEdit(x)) preserves the crypto/network", () => {
    const p = buildCustomPayload(customStateFromEdit(edit));
    expect(p.proposal).toBe("aes128-sha256 aes256-sha256");
    expect(p.dhgroup).toBe("14 5");
    expect(p.nattraversal).toBe("forced");
    expect(p.custom?.p2_proposal).toBe("aes256-sha256 aes256gcm");
    expect(p.custom?.p2_remote_port).toBe("443");
    expect(p.custom?.p2_protocol).toBe("6");
    expect(p.custom?.local_gateway).toBe("10.0.99.9");
    expect(p.custom?.keylife).toBe("28800");
    // A blank PSK on save keeps the stored secret.
    expect(p.psk).toBe("");
  });

  it("a dialup tunnel round-trips as dialup", () => {
    const s = customStateFromEdit({ ...edit, remote_type: "dynamic", remote_gw: "0.0.0.0" });
    expect(s.custom.remoteGateway).toBe("dialup");
  });
});
