import { describe, it, expect } from "vitest";
import {
  EMPTY_VIP, validateVIP, vipValid, buildVIPPayload, initialFilterState,
  showsStaticNAT, showsFQDN, showsPortForwarding, showsPortFields, showsExternalServicePort,
  showsServicesFilter, vipMappedFrom, vipMappedTo,
} from "./vip-form-rules";
import type { VirtualIP } from "../../api/policyObject";

// The VIP form's field-visibility and payload rules, pinned to the FortiGate GUI screenshots and
// to the CMDB mapping verified live (see services/fortigate.go). The visibility logic is the
// subtle part: the GUI changes which fields EXIST as you toggle Type / Services / Port Forwarding.

const v = (over: Partial<VirtualIP> = {}): VirtualIP => ({
  ...EMPTY_VIP,
  name: "Web_VIP",
  ext_ip: "203.0.113.10",
  mapped_ip: "192.168.1.10",
  port_forward: true, ext_port: "8080", mapped_port: "80",
  source_filter: [],
  ...over,
});

// The bug this section guards: the Source/Services toggles were derived from array contents, so
// flipping one on (which left the array empty) reported it back as off — un-turn-on-able. The
// enable-state now lives apart from the data; initialFilterState opens edit mode to match what
// was saved.
describe("initialFilterState", () => {
  it("a blank VIP opens with every filter off", () => {
    expect(initialFilterState(EMPTY_VIP)).toEqual({ optional: false, source: false, services: false });
  });

  it("a saved source filter opens Source (and the section) on", () => {
    expect(initialFilterState({ ...EMPTY_VIP, source_filter: ["10.0.0.0/8"] }))
      .toEqual({ optional: true, source: true, services: false });
  });

  it("saved services open Services (and the section) on", () => {
    expect(initialFilterState({ ...EMPTY_VIP, services: ["HTTP"] }))
      .toEqual({ optional: true, source: false, services: true });
  });

  it("blank-only source rows do NOT count as enabled (they are just an empty editor)", () => {
    expect(initialFilterState({ ...EMPTY_VIP, source_filter: ["", "  "] }))
      .toEqual({ optional: false, source: false, services: false });
  });

  it("both saved → section open with both sub-toggles on", () => {
    expect(initialFilterState({ ...EMPTY_VIP, source_filter: ["10.0.0.0/8"], services: ["HTTP"] }))
      .toEqual({ optional: true, source: true, services: true });
  });
});

describe("field visibility", () => {
  it("Static NAT shows the IP rows + Port Forwarding; hides FQDN", () => {
    const s = v({ type: "static-nat" });
    expect(showsStaticNAT(s)).toBe(true);
    expect(showsFQDN(s)).toBe(false);
    expect(showsPortForwarding(s)).toBe(true);
    expect(showsServicesFilter(s)).toBe(true);
  });

  it("FQDN swaps to the address pickers and has NO port forwarding or services filter", () => {
    const s = v({ type: "fqdn" });
    expect(showsFQDN(s)).toBe(true);
    expect(showsStaticNAT(s)).toBe(false);
    expect(showsPortForwarding(s)).toBe(false);
    expect(showsServicesFilter(s)).toBe(false);
  });

  it("port fields appear only with Port Forwarding on and a non-icmp protocol", () => {
    expect(showsPortFields(v({ port_forward: false }))).toBe(false);
    expect(showsPortFields(v({ port_forward: true, protocol: "icmp" }))).toBe(false);
    expect(showsPortFields(v({ port_forward: true, protocol: "tcp" }))).toBe(true);
  });

  // The crux of image 3: enabling Services HIDES "External service port" (the service defines it),
  // while "Map to IPv4 port" stays.
  it("Services hides the External service port field but keeps the mapped port", () => {
    const noSvc = v({ services: [] });
    expect(showsExternalServicePort(noSvc)).toBe(true);
    expect(showsPortFields(noSvc)).toBe(true);

    const withSvc = v({ services: ["HTTP"] });
    expect(showsExternalServicePort(withSvc)).toBe(false); // hidden
    expect(showsPortFields(withSvc)).toBe(true);           // mapped port still shown
  });
});

describe("validateVIP", () => {
  it("passes a complete Static NAT VIP", () => {
    expect(vipValid(v())).toBe(true);
  });

  it("requires a name", () => {
    expect(validateVIP(v({ name: "" })).name).toBeTruthy();
  });

  it("Static NAT needs valid external + mapped IPs", () => {
    expect(validateVIP(v({ ext_ip: "" })).ext_ip).toBeTruthy();
    expect(validateVIP(v({ ext_ip: "nope" })).ext_ip).toBeTruthy();
    expect(validateVIP(v({ ext_ip: "203.0.113.10-203.0.113.20" })).ext_ip).toBeUndefined();
    expect(validateVIP(v({ mapped_ip: "" })).mapped_ip).toBeTruthy();
  });

  it("FQDN needs both address names and never an IP", () => {
    const fq = v({ type: "fqdn", ext_ip: "", mapped_ip: "" });
    expect(validateVIP(fq).ext_addr).toBeTruthy();
    expect(validateVIP({ ...fq, ext_addr: "wildcard.google.com" }).mapped_addr).toBeTruthy();
    expect(vipValid({ ...fq, ext_addr: "wildcard.google.com", mapped_addr: "gmail.com" })).toBe(true);
  });

  it("port forwarding needs the external port — unless a Service defines it", () => {
    expect(validateVIP(v({ ext_port: "" })).ext_port).toBeTruthy();
    expect(validateVIP(v({ ext_port: "", services: ["HTTP"] })).ext_port).toBeUndefined();
    // The mapped port is still required with a Service.
    expect(validateVIP(v({ mapped_port: "", services: ["HTTP"] })).mapped_port).toBeTruthy();
  });

  it("icmp forwarding needs no ports", () => {
    expect(vipValid(v({ protocol: "icmp", ext_port: "", mapped_port: "" }))).toBe(true);
  });
});

describe("buildVIPPayload", () => {
  it("sends the Static NAT shape", () => {
    const p = buildVIPPayload(v());
    expect(p).toMatchObject({
      type: "static-nat", ext_ip: "203.0.113.10", mapped_ip: "192.168.1.10",
      port_forward: true, ext_port: "8080", mapped_port: "80",
    });
    expect(p.ext_addr).toBe("");
    expect(p.mapped_addr).toBe("");
  });

  // Switching to FQDN must not carry a leftover ext_ip — that is the device's -8 trap.
  it("FQDN drops any leftover IP fields", () => {
    const p = buildVIPPayload(v({ type: "fqdn", ext_addr: "wildcard.google.com", mapped_addr: "gmail.com" }));
    expect(p.ext_ip).toBe("");
    expect(p.mapped_ip).toBe("");
    expect(p.ext_addr).toBe("wildcard.google.com");
    expect(p.mapped_addr).toBe("gmail.com");
    expect(p.port_forward).toBe(false);
  });

  it("drops the external port when a Service is set, keeps the mapped port", () => {
    const p = buildVIPPayload(v({ services: ["HTTP"] }));
    expect(p.ext_port).toBe("");
    expect(p.mapped_port).toBe("80");
    expect(p.services).toEqual(["HTTP"]);
  });

  it("cleans blank source-filter rows", () => {
    const p = buildVIPPayload(v({ source_filter: ["10.0.0.0/8", "  ", "192.168.0.0/16"] }));
    expect(p.source_filter).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
  });

  it("icmp forwarding sends no ports", () => {
    const p = buildVIPPayload(v({ protocol: "icmp" }));
    expect(p.ext_port).toBe("");
    expect(p.mapped_port).toBe("");
  });
});

describe("list-page summary", () => {
  it("shows the port mapping for a Static NAT VIP (matching the GUI's Mapped From/To columns)", () => {
    const s = v({ ext_ip: "203.150.100.10", mapped_ip: "192.168.1.100", ext_port: "8080", mapped_port: "80" });
    expect(vipMappedFrom(s)).toBe("203.150.100.10 (TCP: 8080)");
    expect(vipMappedTo(s)).toBe("192.168.1.100 (TCP: 80)");
  });

  it("shows the FQDN names for an FQDN VIP", () => {
    const fq = v({ type: "fqdn", ext_addr: "wildcard.google.com", mapped_addr: "gmail.com" });
    expect(vipMappedFrom(fq)).toBe("wildcard.google.com");
    expect(vipMappedTo(fq)).toBe("gmail.com");
  });

  it("omits the port when forwarding is off", () => {
    const s = v({ port_forward: false });
    expect(vipMappedFrom(s)).toBe("203.0.113.10");
  });
});
