import { describe, it, expect } from "vitest";
import { parseAllPoliciesFromCLI, parsePolicyFromCLI, referencedByPolicy, policyOrderLocks } from "./parsePolicyCLI";
import { parseAllSchedulesFromCLI } from "./parseScheduleCLI";

// The exact scenario from the feature request: ONE prompt that must yield TWO policies —
//   1) "Got-ITS-Block-Games-Lunch" — block Steam/Roblox/Spotify only Thu+Fri 12:00-13:00
//      (accept + App Control + a recurring schedule), placed ABOVE the broad allow.
//   2) "Got-ITS-Company" — allow LAN 192.168.90.0/24 out on HTTPS + custom TCP 9000, with
//      AntiVirus + Web Filter.
// Shared object (LAN address) is defined once and referenced by both. The AI writes the more
// specific policy FIRST so it lands above the broad one (first match wins).
const TWO_POLICIES_ONE_BLOCK = `
config firewall address
    edit "LAN-192.168.90.0"
        set type ipmask
        set subnet 192.168.90.0 255.255.255.0
    next
end
config firewall service custom
    edit "App-9000"
        set tcp-portrange 9000
    next
end
config firewall schedule recurring
    edit "Games-Lunch-ThuFri"
        set day thursday friday
        set start 12:00
        set end 13:00
    next
end
config antivirus profile
    edit "AV-Got-ITS"
        set comment "flow AV"
    next
end
config webfilter profile
    edit "WebFilter-Block-Net-Twitch"
        set comment "block netflix twitch"
    next
end
config application list
    edit "AppCtrl-Block-Games"
        set comment "block steam roblox spotify"
    next
end
config firewall policy
    edit 0
        set name "Got-ITS-Block-Games-Lunch"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-192.168.90.0"
        set dstaddr "all"
        set action accept
        set schedule "Games-Lunch-ThuFri"
        set service "ALL"
        set application-list "AppCtrl-Block-Games"
        set utm-status enable
        set ssl-ssh-profile "certificate-inspection"
        set nat enable
    next
    edit 0
        set name "Got-ITS-Company"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-192.168.90.0"
        set dstaddr "all"
        set action accept
        set schedule "always"
        set service "HTTPS" "App-9000"
        set av-profile "AV-Got-ITS"
        set webfilter-profile "WebFilter-Block-Net-Twitch"
        set utm-status enable
        set ssl-ssh-profile "certificate-inspection"
        set nat enable
    next
end
`;

// Same two policies, but emitted as two SEPARATE `config firewall policy ... end` blocks — the other
// shape the model legitimately produces. The parser must treat it identically.
const TWO_POLICIES_TWO_BLOCKS = `
config firewall policy
    edit 0
        set name "Block-First"
        set srcintf "lan"
        set dstintf "port1"
        set action accept
        set application-list "AppCtrl-Block-Games"
    next
end
config firewall policy
    edit 0
        set name "Allow-Second"
        set srcintf "lan"
        set dstintf "port1"
        set action accept
    next
end
`;

describe("parseAllPoliciesFromCLI", () => {
  it("extracts BOTH policies from one config block, in written (top-to-bottom) order", () => {
    const pols = parseAllPoliciesFromCLI(TWO_POLICIES_ONE_BLOCK);
    expect(pols).toHaveLength(2);
    expect(pols.map((p) => p.form.name)).toEqual([
      "Got-ITS-Block-Games-Lunch", // specific / block — written first → sits above
      "Got-ITS-Company",           // broad allow — second
    ]);
  });

  it("extracts policies emitted as two separate config blocks too", () => {
    const pols = parseAllPoliciesFromCLI(TWO_POLICIES_TWO_BLOCKS);
    expect(pols.map((p) => p.form.name)).toEqual(["Block-First", "Allow-Second"]);
  });

  it("maps each policy's fields (schedule, action, service, profiles) independently", () => {
    const [block, company] = parseAllPoliciesFromCLI(TWO_POLICIES_ONE_BLOCK);

    // Policy 1 — the scheduled App Control block
    expect(block.form.action).toBe("accept");
    expect(block.form.schedule).toBe("Games-Lunch-ThuFri");
    expect(block.form.appEnabled).toBe(true);
    expect(block.form.appProfile).toBe("AppCtrl-Block-Games");
    expect(block.form.avEnabled).toBeFalsy();

    // Policy 2 — the company allow with AV + Web Filter + custom service
    expect(company.form.schedule).toBe("always");
    expect(company.form.service).toEqual(["HTTPS", "App-9000"]);
    expect(company.form.avEnabled).toBe(true);
    expect(company.form.avProfile).toBe("AV-Got-ITS");
    expect(company.form.webEnabled).toBe(true);
    expect(company.form.webProfile).toBe("WebFilter-Block-Net-Twitch");
    expect(company.form.appEnabled).toBeFalsy();
  });

  it("returns [] when the CLI has no firewall policy block", () => {
    const onlyAddr = `config firewall address\n edit "X"\n set subnet 10.0.0.0 255.0.0.0\n next\nend`;
    expect(parseAllPoliciesFromCLI(onlyAddr)).toEqual([]);
  });

  it("parsePolicyFromCLI stays back-compatible and returns the FIRST policy", () => {
    expect(parsePolicyFromCLI(TWO_POLICIES_ONE_BLOCK)?.form.name).toBe("Got-ITS-Block-Games-Lunch");
    expect(parsePolicyFromCLI("get system status")).toBeNull();
  });
});

// A policy that references a NEW service group the AI defined — the group must be inlined to its
// members, because the wizard/REST paths can create custom services but not group objects. This is
// the regression that produced a silent "Failed to create policy": the policy referenced
// "HTTPS-and-App9000" (a group) which nothing could create.
const POLICY_WITH_SERVICE_GROUP = `
config firewall service custom
    edit "App-9000"
        set tcp-portrange 9000
    next
end
config firewall service group
    edit "HTTPS-and-App9000"
        set member "HTTPS" "App-9000"
    next
end
config firewall addrgrp
    edit "LAN-Group"
        set member "LAN-A" "LAN-B"
    next
end
config firewall policy
    edit 0
        set name "Grouped"
        set srcintf "lan"
        set dstintf "port1"
        set srcaddr "LAN-Group"
        set dstaddr "all"
        set action accept
        set service "HTTPS-and-App9000"
    next
end
`;

describe("group inlining (service group / addrgrp)", () => {
  it("expands a referenced NEW service group into its members on the policy", () => {
    const [p] = parseAllPoliciesFromCLI(POLICY_WITH_SERVICE_GROUP);
    expect(p.form.service).toEqual(["HTTPS", "App-9000"]); // NOT ["HTTPS-and-App9000"]
    expect(referencedByPolicy(p.form).services).toEqual(["HTTPS", "App-9000"]);
  });

  it("expands a referenced NEW address group into its members", () => {
    const [p] = parseAllPoliciesFromCLI(POLICY_WITH_SERVICE_GROUP);
    expect(p.form.srcAddr).toEqual(["LAN-A", "LAN-B"]);
  });
});

// Regression for the "Schedule … has no definition to create it" failure: a prerequisite (here the
// recurring schedule) is referenced by only ONE policy but defined once at the top of the CLI. Whichever
// policy is applied first, the FULL definition set must still contain that schedule, so the policy that
// needs it can always build it. (The wizard is handed the full set; referencedByPolicy tells it which
// policy actually needs each object.)
describe("multi-policy prerequisite availability (apply-order robustness)", () => {
  it("a schedule referenced by only one policy is still present in the full definition set", () => {
    const scheds = parseAllSchedulesFromCLI(TWO_POLICIES_ONE_BLOCK).map((s) => s.form.name ?? s.target);
    expect(scheds).toContain("Games-Lunch-ThuFri"); // available to EITHER policy's wizard
    const [block, company] = parseAllPoliciesFromCLI(TWO_POLICIES_ONE_BLOCK);
    expect(referencedByPolicy(block.form).schedule).toBe("Games-Lunch-ThuFri"); // block needs it
    expect(referencedByPolicy(company.form).schedule).toBe("always");           // company does not
  });
});

describe("policyOrderLocks (enforced creation order)", () => {
  const names = ["Block-First", "Company-Second"];

  it("nothing applied → only the FIRST policy is open; the rest are locked on their predecessor", () => {
    const locks = policyOrderLocks(names, new Set());
    expect(locks[0]).toEqual({ applied: false, locked: false, lockReason: undefined }); // first is open
    expect(locks[1]).toEqual({ applied: false, locked: true, lockReason: "Block-First" }); // must create #1 first
  });

  it("first applied → second unlocks", () => {
    const locks = policyOrderLocks(names, new Set(["Block-First"]));
    expect(locks[0].applied).toBe(true);
    expect(locks[0].locked).toBe(false);
    expect(locks[1]).toEqual({ applied: false, locked: false, lockReason: undefined });
  });

  it("an applied policy is never locked, even out of order", () => {
    // Second somehow applied but first not — the (applied) second is not locked; the first is open.
    const locks = policyOrderLocks(names, new Set(["Company-Second"]));
    expect(locks[1].applied).toBe(true);
    expect(locks[1].locked).toBe(false);
    expect(locks[0].locked).toBe(false);
  });
});

describe("referencedByPolicy (per-policy prerequisite scoping)", () => {
  it("returns only the objects each policy points at, so a sibling's objects don't leak in", () => {
    const [block, company] = parseAllPoliciesFromCLI(TWO_POLICIES_ONE_BLOCK);

    const b = referencedByPolicy(block.form);
    expect(new Set(b.addresses)).toEqual(new Set(["LAN-192.168.90.0", "all"]));
    expect(b.services).toEqual(["ALL"]);
    expect(b.schedule).toBe("Games-Lunch-ThuFri");
    expect(b.profiles).toEqual(["AppCtrl-Block-Games"]); // NOT the company's AV / Web Filter

    const c = referencedByPolicy(company.form);
    expect(new Set(c.services)).toEqual(new Set(["HTTPS", "App-9000"]));
    expect(c.schedule).toBe("always");
    expect(new Set(c.profiles)).toEqual(new Set(["AV-Got-ITS", "WebFilter-Block-Net-Twitch"]));
    expect(c.profiles).not.toContain("AppCtrl-Block-Games"); // NOT the block policy's app sensor
  });
});

// ── Failing closed ───────────────────────────────────────────────────────────
//
// Both cases below used to produce a policy that differed from the one the user was shown, in the
// permissive direction. That is the worst possible direction for a firewall rule, and neither
// failure said anything.
describe("a policy this console cannot represent is refused, not widened", () => {
  const withAction = (action: string) => `
config firewall policy
    edit 0
        set name "P1"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN"
        set dstaddr "all"
        set action ${action}
        set schedule "always"
        set service "ALL"
    next
end`;

  it("keeps accept and deny", () => {
    expect(parsePolicyFromCLI(withAction("accept"))?.form.action).toBe("accept");
    expect(parsePolicyFromCLI(withAction("deny"))?.form.action).toBe("deny");
  });

  it("refuses `set action ipsec` instead of turning it into accept", () => {
    // FortiOS's third action. The old ternary read anything that was not "deny" as "accept", so a
    // tunnel policy became an ALLOW rule on apply while the chat showed what the model wrote.
    expect(parsePolicyFromCLI(withAction("ipsec"))).toBeNull();
  });

  it("refuses an action it has never heard of", () => {
    expect(parsePolicyFromCLI(withAction("quarantine"))).toBeNull();
  });
});

describe("values that mix quoted and bare tokens", () => {
  // `set srcaddr "LAN" all` is valid FortiOS and the parser used to keep only the quoted ones, so
  // a member vanished — narrowing a source list, or widening a destination list, in silence.
  const cli = `
config firewall policy
    edit 0
        set name "P2"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN-A" all
        set dstaddr all "DMZ-Web"
        set action accept
        set schedule "always"
        set service "HTTPS" ALL
    next
end`;

  it("keeps every member, in order", () => {
    const form = parsePolicyFromCLI(cli)?.form;
    expect(form?.srcAddr).toEqual(["LAN-A", "all"]);
    expect(form?.dstAddr).toEqual(["all", "DMZ-Web"]);
    expect(form?.service).toEqual(["HTTPS", "ALL"]);
  });

  it("still handles the ordinary all-quoted and all-bare forms", () => {
    const quoted = parsePolicyFromCLI(cli.replace('set srcaddr "LAN-A" all', 'set srcaddr "LAN-A" "LAN-B"'));
    expect(quoted?.form.srcAddr).toEqual(["LAN-A", "LAN-B"]);
    const bare = parsePolicyFromCLI(cli.replace('set srcaddr "LAN-A" all', "set srcaddr all"));
    expect(bare?.form.srcAddr).toEqual(["all"]);
  });
});
