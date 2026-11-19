import { describe, it, expect } from "vitest";
import { computeRelItems } from "./relObjects";
import { parseAllPoliciesFromCLI, policyDraftToFormState } from "./parsePolicyCLI";
import { parseDNSFilterFromCLI } from "./parseDNSFilterCLI";
import { parseAllAddressesFromCLI } from "./parseAddressCLI";
import { parseWebFilterFromCLI } from "./parseWebFilterCLI";

// computeRelItems decides what the Policy Wizard's "Objects" dropdown lists and what Apply
// auto-creates. Every pending* input is OPTIONAL, so a dropped one is invisible to TypeScript and
// simply makes an object disappear from the UI — which is exactly what happened to the DNS Filter
// (scopeForPolicy built pendingDNS, the JSX forgot to forward it, Objects showed 0/1). These tests
// exercise the rule against the CLI a live Claude actually returned.

// Verbatim output from the real model for:
// "สร้าง policy ZZ-Pol-DNS ให้ LAN 192.168.88.0/24 ออกเน็ตได้ พร้อมสร้าง DNS Filter ZZ-DNS-Gamble
//  บล็อกเว็บพนัน m88.com กับ ufabet.com แล้วผูกเข้ากับ policy นี้"
const REAL_POLICY_PLUS_DNS_CLI = `config firewall address
    edit "LAN-192.168.88.0"
        set type ipmask
        set subnet 192.168.88.0 255.255.255.0
    next
end
config dnsfilter domain-filter
    edit 0
        set name "DNS-Block-Gamble"
        config entries
            edit 1
                set domain "m88.com"
                set type simple
                set action block
                set status enable
            next
            edit 2
                set domain "*.m88.com"
                set type wildcard
                set action block
                set status enable
            next
            edit 3
                set domain "ufabet.com"
                set type simple
                set action block
                set status enable
            next
            edit 4
                set domain "*.ufabet.com"
                set type wildcard
                set action block
                set status enable
            next
        end
    next
end
config dnsfilter profile
    edit "ZZ-DNS-Gamble"
        set comment "Block gambling sites m88.com and ufabet.com"
        config domain-filter
            set domain-filter-table 0
        end
        set log-all-domain enable
    next
end
config firewall policy
    edit 0
        set name "ZZ-Pol-DNS"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-192.168.88.0"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "ALL"
        set nat enable
        set logtraffic all
        set utm-status enable
        set dnsfilter-profile "ZZ-DNS-Gamble"
        set ssl-ssh-profile "certificate-inspection"
    next
end`;

const parseAll = (cli: string) => ({
  form: policyDraftToFormState(parseAllPoliciesFromCLI(cli)[0].form),
  defs: {
    pendingAddresses: parseAllAddressesFromCLI(cli),
    pendingDNS: parseDNSFilterFromCLI(cli) ?? undefined,
  },
});

describe("computeRelItems — the real AI suggestion", () => {
  it("lists BOTH the address and the DNS filter the policy references", () => {
    const { form, defs } = parseAll(REAL_POLICY_PLUS_DNS_CLI);
    const items = computeRelItems(form, defs);

    // This is the regression: it used to be [address] only.
    expect(items).toEqual([
      { kind: "address", name: "LAN-192.168.88.0" },
      { kind: "dnsfilter", name: "ZZ-DNS-Gamble" },
    ]);
  });

  it("the policy really does enable the DNS filter (guards the parse this rule depends on)", () => {
    const { form } = parseAll(REAL_POLICY_PLUS_DNS_CLI);
    expect(form.dnsEnabled).toBe(true);
    expect(form.dnsProfile).toBe("ZZ-DNS-Gamble");
  });

  // The bug's exact shape: everything parsed fine, the wizard just never received pendingDNS.
  it("drops the DNS filter when pendingDNS is not forwarded — the bug this test exists for", () => {
    const { form, defs } = parseAll(REAL_POLICY_PLUS_DNS_CLI);
    const items = computeRelItems(form, { ...defs, pendingDNS: undefined });
    expect(items.some((i) => i.kind === "dnsfilter")).toBe(false);
  });
});

describe("computeRelItems — narrowing rules", () => {
  const dns = parseDNSFilterFromCLI(REAL_POLICY_PLUS_DNS_CLI) ?? undefined;
  const baseForm = policyDraftToFormState(parseAllPoliciesFromCLI(REAL_POLICY_PLUS_DNS_CLI)[0].form);

  it("hides the DNS filter when the policy has it toggled off", () => {
    const items = computeRelItems({ ...baseForm, dnsEnabled: false }, { pendingDNS: dns });
    expect(items).toEqual([]);
  });

  it("hides a DNS filter whose name the policy does not reference (a sibling's profile)", () => {
    const items = computeRelItems({ ...baseForm, dnsProfile: "Some-Other-Profile" }, { pendingDNS: dns });
    expect(items.some((i) => i.kind === "dnsfilter")).toBe(false);
  });

  it("hides a DNS filter the policy points at but the suggestion never defined", () => {
    // Nothing to open a sub-wizard for — the profile must already exist on the device.
    const items = computeRelItems(baseForm, { pendingDNS: undefined });
    expect(items.some((i) => i.kind === "dnsfilter")).toBe(false);
  });

  it("dedupes and keeps every enabled profile kind side by side", () => {
    const wfCLI = `config webfilter profile
    edit "WF-1"
        set comment "x"
    next
end`;
    const web = parseWebFilterFromCLI(wfCLI) ?? undefined;
    const form = { ...baseForm, webEnabled: true, webProfile: "WF-1" };
    const items = computeRelItems(form, { pendingDNS: dns, pendingWeb: web });
    expect(items).toEqual([
      { kind: "webfilter", name: "WF-1" },
      { kind: "dnsfilter", name: "ZZ-DNS-Gamble" },
    ]);
  });

  it("survives a policy that references nothing the suggestion defined", () => {
    expect(computeRelItems(baseForm, {})).toEqual([]);
  });
});
