import { describe, it, expect } from "vitest";
import {
  BLANK_VPN_WIZARD,
  isHubSpoke, hubIsHub, hubIsSpoke, hubIsRange,
  validateHubSpokeStep, buildHubSpokePayload, hubSpokeObjectNames, hubSpokeObjectSummary,
  isCIDR, isHostOrCIDR, isBGPAS, deriveOverlaySubnet, deriveInterfaceSubnet, diagramTitle,
  hubSpokeStateFromEdit,
  type VPNWizardState,
} from "./ipsec-wizard-rules";
import type { IPsecHubSpokeReadback } from "../../api/policyObject";

// A fully-filled Hub (Individual) state — the base other tests mutate.
const hubIndividual = (): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  templateType: "hub-and-spoke",
  name: "HubTest",
  hsRole: "hub",
  outInterface: "port1",
  authMethod: "psk",
  psk: "P@ssw0rd",
  hsTunnelIP: "10.10.1.1",
  hsRemoteIP: "10.10.1.2/24",
  hsLocalAS: "65400",
  localInterface: "lan",
  localSubnets: ["10.0.96.0/22"],
  hsSpokeType: "individual",
  hsSpokeTunnelIPs: ["10.10.1.3"],
});

const hubRange = (): VPNWizardState => ({
  ...hubIndividual(),
  hsSpokeType: "range",
  hsSpokeTunnelIPs: [""],
  hsSpokeRangePrefix: "10.10.1.0/24",
});

const spoke = (): VPNWizardState => ({
  ...BLANK_VPN_WIZARD,
  templateType: "hub-and-spoke",
  name: "SpokeTest",
  hsRole: "spoke",
  outInterface: "port1",
  authMethod: "psk",
  psk: "P@ssw0rd",
  hsTunnelIP: "10.10.1.3",
  hsRemoteIP: "10.10.1.1/24",
  hsLocalAS: "65400",
  localInterface: "lan",
  localSubnets: ["192.168.50.0/24"],
  hsRemoteGW: "203.0.113.10",
});

describe("hub-spoke branch predicates", () => {
  it("classifies the template + role", () => {
    expect(isHubSpoke(hubIndividual())).toBe(true);
    expect(hubIsHub(hubIndividual())).toBe(true);
    expect(hubIsSpoke(hubIndividual())).toBe(false);
    expect(hubIsRange(hubIndividual())).toBe(false);
    expect(hubIsRange(hubRange())).toBe(true);
    expect(hubIsSpoke(spoke())).toBe(true);
    expect(hubIsHub(spoke())).toBe(false);
    expect(isHubSpoke({ ...BLANK_VPN_WIZARD, templateType: "site-to-site" })).toBe(false);
  });

  it("titles the diagram by role", () => {
    expect(diagramTitle(hubIndividual())).toBe("Hub-and-Spoke - FortiGate (Hub)");
    expect(diagramTitle(spoke())).toBe("Hub-and-Spoke - FortiGate (Spoke)");
  });
});

describe("small validators", () => {
  it("isCIDR", () => {
    expect(isCIDR("10.0.96.0/22")).toBe(true);
    expect(isCIDR("10.0.96.0")).toBe(false);
    expect(isCIDR("10.0.96.0/33")).toBe(false);
    expect(isCIDR("nope")).toBe(false);
  });
  it("isHostOrCIDR", () => {
    expect(isHostOrCIDR("10.10.1.2")).toBe(true);
    expect(isHostOrCIDR("10.10.1.2/24")).toBe(true);
    expect(isHostOrCIDR("10.10.1.2/40")).toBe(false);
  });
  it("isBGPAS", () => {
    expect(isBGPAS("65400")).toBe(true);
    expect(isBGPAS("1")).toBe(true);
    expect(isBGPAS("4294967295")).toBe(true);
    expect(isBGPAS("0")).toBe(false);
    expect(isBGPAS("4294967296")).toBe(false);
    expect(isBGPAS("x")).toBe(false);
  });
});

describe("deriveOverlaySubnet", () => {
  it("masks the remote IP down to its network", () => {
    expect(deriveOverlaySubnet("10.10.1.2/24")).toBe("10.10.1.0/24");
    expect(deriveOverlaySubnet("10.10.1.130/25")).toBe("10.10.1.128/25");
    expect(deriveOverlaySubnet("10.10.1.2")).toBe(""); // no mask
  });
});

describe("deriveInterfaceSubnet (Local subnets auto-fill)", () => {
  it("derives the network from an interface ip in FG or CIDR form", () => {
    expect(deriveInterfaceSubnet("192.168.50.1 255.255.255.0")).toBe("192.168.50.0/24");
    expect(deriveInterfaceSubnet("10.0.96.10/22")).toBe("10.0.96.0/22");
    expect(deriveInterfaceSubnet("")).toBe("");
    expect(deriveInterfaceSubnet("0.0.0.0 0.0.0.0")).toBe("0.0.0.0/0");
  });
});

describe("validateHubSpokeStep", () => {
  it("passes every step for a valid Hub (Individual)", () => {
    const s = hubIndividual();
    for (let step = 0; step < 4; step++) {
      expect(validateHubSpokeStep(s, step)).toEqual({});
    }
  });
  it("passes for a valid Hub (Range) and Spoke", () => {
    for (let step = 0; step < 4; step++) {
      expect(validateHubSpokeStep(hubRange(), step)).toEqual({});
      expect(validateHubSpokeStep(spoke(), step)).toEqual({});
    }
  });
  it("step 0 requires a name", () => {
    expect(validateHubSpokeStep({ ...hubIndividual(), name: "" }, 0)).toHaveProperty("name");
  });
  it("step 1 requires interface + PSK", () => {
    expect(validateHubSpokeStep({ ...hubIndividual(), outInterface: "" }, 1)).toHaveProperty("outInterface");
    expect(validateHubSpokeStep({ ...hubIndividual(), psk: "" }, 1)).toHaveProperty("psk");
    expect(validateHubSpokeStep({ ...hubIndividual(), authMethod: "signature", certificate: "" }, 1)).toHaveProperty("certificate");
  });
  it("step 2 validates the tunnel + remote IP", () => {
    expect(validateHubSpokeStep({ ...hubIndividual(), hsTunnelIP: "nope" }, 2)).toHaveProperty("hsTunnelIP");
    expect(validateHubSpokeStep({ ...hubIndividual(), hsRemoteIP: "10.10.1.2/40" }, 2)).toHaveProperty("hsRemoteIP");
  });
  it("step 3 validates AS, interface, subnets and role-specific fields", () => {
    expect(validateHubSpokeStep({ ...hubIndividual(), hsLocalAS: "0" }, 3)).toHaveProperty("hsLocalAS");
    expect(validateHubSpokeStep({ ...hubIndividual(), localInterface: "" }, 3)).toHaveProperty("localInterface");
    expect(validateHubSpokeStep({ ...hubIndividual(), localSubnets: [""] }, 3)).toHaveProperty("localSubnets");
    expect(validateHubSpokeStep({ ...hubIndividual(), localSubnets: ["10.0.0.0"] }, 3)).toHaveProperty("localSubnets");
    // Individual: needs spoke tunnel IPs
    expect(validateHubSpokeStep({ ...hubIndividual(), hsSpokeTunnelIPs: [""] }, 3)).toHaveProperty("hsSpokeTunnelIPs");
    expect(validateHubSpokeStep({ ...hubIndividual(), hsSpokeTunnelIPs: ["999.1.1.1"] }, 3)).toHaveProperty("hsSpokeTunnelIPs");
    // Range: needs a valid prefix
    expect(validateHubSpokeStep({ ...hubRange(), hsSpokeRangePrefix: "10.10.1.0" }, 3)).toHaveProperty("hsSpokeRangePrefix");
    // Spoke: needs a hub gateway
    expect(validateHubSpokeStep({ ...spoke(), hsRemoteGW: "" }, 3)).toHaveProperty("hsRemoteGW");
  });
});

describe("hubSpokeObjectNames", () => {
  it("matches the backend HubSpokeObjectNamesFor naming", () => {
    const n = hubSpokeObjectNames("HubTest");
    expect(n).toEqual({
      phase1: "HubTest",
      phase2: "HubTest",
      tunnelInterface: "HubTest",
      localAddress: "HubTest_local",
      policySpoke2Hub: "vpn_HubTest_spoke2hub",
      policySpoke2Spoke: "vpn_HubTest_spoke2spoke",
      neighborGroup: "HubTest",
    });
  });
  it("summary lists the expected rows", () => {
    const labels = hubSpokeObjectSummary(hubIndividual()).map((r) => r.label);
    expect(labels).toContain("Phase 1 interface");
    expect(labels).toContain("Local address group");
    expect(labels).toContain("Remote to local policies");
    expect(labels).toContain("Local to remote policies");
    expect(labels).toContain("BGP route");
  });
});

describe("buildHubSpokePayload", () => {
  it("builds a Hub (Individual) request", () => {
    const p = buildHubSpokePayload(hubIndividual());
    expect(p.name).toBe("HubTest");
    expect(p.interface).toBe("port1");
    expect(p.psk).toBe("P@ssw0rd");
    expect(p.hub_spoke).toBeDefined();
    expect(p.hub_spoke!.role).toBe("hub");
    expect(p.hub_spoke!.tunnel_ip).toBe("10.10.1.1");
    expect(p.hub_spoke!.remote_ip).toBe("10.10.1.2/24");
    expect(p.hub_spoke!.local_as).toBe("65400");
    expect(p.hub_spoke!.local_subnets).toEqual(["10.0.96.0/22"]);
    expect(p.hub_spoke!.spoke_type).toBe("individual");
    expect(p.hub_spoke!.spoke_tunnel_ips).toEqual(["10.10.1.3"]);
    expect(p.hub_spoke!.spoke_range_prefix).toBeUndefined();
    expect(p.hub_spoke!.remote_gw).toBeUndefined();
  });
  it("builds a Hub (Range) request", () => {
    const p = buildHubSpokePayload(hubRange());
    expect(p.hub_spoke!.spoke_type).toBe("range");
    expect(p.hub_spoke!.spoke_range_prefix).toBe("10.10.1.0/24");
    expect(p.hub_spoke!.spoke_tunnel_ips).toBeUndefined();
  });
  it("builds a Spoke request", () => {
    const p = buildHubSpokePayload(spoke());
    expect(p.hub_spoke!.role).toBe("spoke");
    expect(p.hub_spoke!.remote_gw).toBe("203.0.113.10");
    expect(p.remote_gw).toBe("203.0.113.10");
    expect(p.hub_spoke!.spoke_type).toBeUndefined();
  });
  it("drops the PSK for signature auth", () => {
    const p = buildHubSpokePayload({ ...hubIndividual(), authMethod: "signature", certificate: "Fortinet_SSL", peerCA: "Fortinet_CA" });
    expect(p.psk).toBe("");
    expect(p.certificate).toBe("Fortinet_SSL");
    expect(p.peer_ca).toBe("Fortinet_CA");
  });
});

describe("hubSpokeStateFromEdit (Edit round-trip, item 1)", () => {
  const readback: IPsecHubSpokeReadback = {
    name: "HubEdit", role: "hub", interface: "port1", auth_method: "psk",
    certificate: "", peer_ca: "", proposal: "aes256-sha256",
    tunnel_ip: "10.50.1.1", remote_ip: "10.50.1.2/24", local_as: "65600",
    local_subnets: ["10.60.0.0/16"], spoke_type: "individual",
    spoke_tunnel_ips: ["10.50.1.3", "10.50.1.4"], spoke_range_prefix: "", remote_gw: "",
  };

  it("prefills the wizard from a device readback with a blank PSK", () => {
    const s = hubSpokeStateFromEdit(readback);
    expect(isHubSpoke(s)).toBe(true);
    expect(s.name).toBe("HubEdit");
    expect(s.hsRole).toBe("hub");
    expect(s.outInterface).toBe("port1");
    expect(s.psk).toBe(""); // never read back — a blank on save keeps the stored secret
    expect(s.hsTunnelIP).toBe("10.50.1.1");
    expect(s.hsRemoteIP).toBe("10.50.1.2/24");
    expect(s.hsLocalAS).toBe("65600");
    expect(s.localSubnets).toEqual(["10.60.0.0/16"]);
    expect(s.hsSpokeType).toBe("individual");
    expect(s.hsSpokeTunnelIPs).toEqual(["10.50.1.3", "10.50.1.4"]);
    // Every step validates in EDIT mode (blank PSK allowed; localInterface is re-picked on step 3).
    for (const step of [0, 1, 2]) expect(validateHubSpokeStep(s, step, true)).toEqual({});
  });

  it("prefills a Range hub and a Spoke", () => {
    const range = hubSpokeStateFromEdit({ ...readback, spoke_type: "range", spoke_tunnel_ips: null, spoke_range_prefix: "10.50.1.0/24" });
    expect(range.hsSpokeType).toBe("range");
    expect(range.hsSpokeRangePrefix).toBe("10.50.1.0/24");
    const sp = hubSpokeStateFromEdit({ ...readback, role: "spoke", remote_gw: "203.0.113.9", spoke_tunnel_ips: null });
    expect(hubIsSpoke(sp)).toBe(true);
    expect(sp.hsRemoteGW).toBe("203.0.113.9");
  });
});
