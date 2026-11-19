import { describe, it, expect } from "vitest";
import { parseVIPFromCLI, parseAllVIPsFromCLI, vipDraftToForm } from "./parseVirtualIPCLI";
import { computeRelItems } from "./relObjects";
import { parseAllPoliciesFromCLI, policyDraftToFormState } from "./parsePolicyCLI";
import { canApplyViaREST } from "./applyViaREST";

// The CLI shape the prompt teaches the model to emit for "publish a server" (see ai.go), which
// round-trips against the lab FortiGate (80E / 7.2.10).
const CLI = `config firewall vip
    edit "Web-Server-VIP"
        set extintf "port1"
        set extip 203.0.113.10
        set mappedip "192.168.1.100"
        set portforward enable
        set protocol tcp
        set extport 8080
        set mappedport 80
    next
end
config firewall policy
    edit 0
        set name "Inbound-Web"
        set srcintf "port1"
        set dstintf "lan"
        set srcaddr "all"
        set dstaddr "Web-Server-VIP"
        set action accept
        set schedule "always"
        set service "HTTP"
        set nat disable
    next
end`;

describe("parseVIPFromCLI", () => {
  it("returns null when there is no firewall vip block", () => {
    expect(parseVIPFromCLI(`config firewall address\n    edit "a"\n    next\nend`)).toBeNull();
  });

  it("parses a static-NAT port-forward VIP", () => {
    const p = parseVIPFromCLI(CLI)!;
    expect(p.target).toBe("Web-Server-VIP");
    expect(p.form).toMatchObject({
      name: "Web-Server-VIP", type: "static-nat", interface: "port1",
      ext_ip: "203.0.113.10", mapped_ip: "192.168.1.100",
      port_forward: true, protocol: "tcp", ext_port: "8080", mapped_port: "80",
    });
  });

  it("treats extport 0 as unset (the device derives it from a service)", () => {
    const p = parseVIPFromCLI(`config firewall vip
    edit "V"
        set extip 203.0.113.10
        set mappedip "192.168.1.100"
        set portforward enable
        set protocol tcp
        set extport 0
        set mappedport 80
    next
end`)!;
    expect(p.form.ext_port).toBeUndefined();
    expect(p.form.mapped_port).toBe("80");
  });

  it("parses an m-to-n port range", () => {
    const p = parseVIPFromCLI(`config firewall vip
    edit "V"
        set extip 203.0.113.10
        set mappedip "192.168.1.100"
        set portforward enable
        set protocol tcp
        set portmapping-type m-to-n
        set extport 8000-8010
        set mappedport 9000-9010
    next
end`)!;
    expect(p.form.port_mapping_type).toBe("m-to-n");
    expect(p.form.ext_port).toBe("8000-8010");
    expect(p.form.mapped_port).toBe("9000-9010");
  });

  it("parses an FQDN VIP via extaddr/mapped-addr and never an IP", () => {
    const p = parseVIPFromCLI(`config firewall vip
    edit "F"
        set type fqdn
        set extintf "any"
        set extaddr "wildcard.google.com"
        set mapped-addr "gmail.com"
    next
end`)!;
    expect(p.form.type).toBe("fqdn");
    expect(p.form.ext_addr).toBe("wildcard.google.com");
    expect(p.form.mapped_addr).toBe("gmail.com");
    expect(p.form.ext_ip).toBeUndefined();
  });

  it("parses the Optional Filters (source + services)", () => {
    const p = parseVIPFromCLI(`config firewall vip
    edit "V"
        set extip 203.0.113.10
        set mappedip "192.168.1.100"
        set src-filter "10.0.0.0/8" "192.168.0.0/16"
        set service "HTTP" "HTTPS"
    next
end`)!;
    expect(p.form.source_filter).toEqual(["10.0.0.0/8", "192.168.0.0/16"]);
    expect(p.form.services).toEqual(["HTTP", "HTTPS"]);
  });

  it("fills every field via vipDraftToForm so the wizard never binds undefined", () => {
    const f = vipDraftToForm(parseVIPFromCLI(CLI)!.form);
    expect(Array.isArray(f.source_filter)).toBe(true);
    expect(Array.isArray(f.services)).toBe(true);
    expect(f.port_mapping_type).toBe("1-to-1");
  });
});

describe("parseAllVIPsFromCLI", () => {
  it("parses every VIP in a multi-server suggestion", () => {
    const cli = `config firewall vip
    edit "Web-VIP"
        set extip 203.0.113.10
        set mappedip "192.168.1.100"
    next
    edit "Mail-VIP"
        set extip 203.0.113.11
        set mappedip "192.168.1.110"
    next
end`;
    const all = parseAllVIPsFromCLI(cli);
    expect(all.map((v) => v.target)).toEqual(["Web-VIP", "Mail-VIP"]);
  });

  it("returns [] with no vip block", () => {
    expect(parseAllVIPsFromCLI("config firewall policy\n    edit 0\n    next\nend")).toEqual([]);
  });
});

// A VIP is referenced in the policy's dstaddr — the whole point of "VIP as a sub of policy". The
// Objects dropdown must offer it as a Virtual IP, NOT as a plain address it has no definition for.
describe("VIP as a policy prerequisite (computeRelItems)", () => {
  const form = policyDraftToFormState(parseAllPoliciesFromCLI(CLI)[0].form);
  const pendingVIPs = parseAllVIPsFromCLI(CLI);

  it("the policy really references the VIP in dstaddr", () => {
    expect(form.dstAddr).toContain("Web-Server-VIP");
  });

  it("offers the VIP as a virtualip related-object", () => {
    const items = computeRelItems(form, { pendingVIPs });
    expect(items).toContainEqual({ kind: "virtualip", name: "Web-Server-VIP" });
  });

  it("does NOT mistake the VIP for a plain address", () => {
    // Even if an address of the same name were somehow proposed, the VIP match wins and the
    // address branch is skipped (a VIP lives in a different CMDB table).
    const items = computeRelItems(form, { pendingVIPs });
    expect(items.some((i) => i.kind === "address" && i.name === "Web-Server-VIP")).toBe(false);
  });

  it("drops the VIP from the dropdown when pendingVIPs is not forwarded (the invisible-optional trap)", () => {
    expect(computeRelItems(form, {}).some((i) => i.kind === "virtualip")).toBe(false);
  });
});

describe("VIP goes through Apply's REST fast path", () => {
  it("accepts a firewall vip + the policy that references it", () => {
    expect(canApplyViaREST(CLI)).toBe(true);
  });
});
