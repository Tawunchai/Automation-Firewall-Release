import { describe, it, expect } from "vitest";
import { parsedApplyObjects } from "./applyObjects";
import { countRESTApplicable } from "./applyViaREST";
import { topLevelConfigBlocks, topLevelEdits, extractPrereqBlocks, normalizeCLI } from "./parsePrereqCLI";

// What the CLI DEFINES, as opposed to what it looks like it defines.
//
// ⚠️ THE REGRESSION THIS FILE EXISTS FOR, and it is the second time this exact sentence shipped.
// countRESTApplicable used to count `edit` lines in the text. Apply would then create nothing,
// see zero created objects, ask "but was there anything to create?", be told "yes, one", and print
// "Everything in this config already exists on the device" — about a device that had none of it.
// The first version of that bug was a `delete` statement taking the fast path; this one was any
// block the parsers cannot read. Both printed the one message a user has no way to doubt.
//
// So: an object counts when a PARSER produced it. These tests are mostly about blocks that look
// parseable and are not.

const NL = String.fromCharCode(10);

const ADDRESS_CLI = `
config firewall address
    edit "LAN-Net"
        set subnet 10.0.1.0 255.255.255.0
    next
end`;

const NAMED_POLICY = `
config firewall policy
    edit 0
        set name "Allow-LAN-Internet"
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "LAN-Net"
        set dstaddr "all"
        set service "HTTPS"
        set action accept
        set schedule "always"
    next
end`;

// The same policy with no `set name`. FortiOS would accept it; planApply SKIPS it, because the
// name is what Apply keys the create by and inventing one is not Apply's decision to make.
const NAMELESS_POLICY = `
config firewall policy
    edit 0
        set srcintf "lan"
        set dstintf "wan1"
        set srcaddr "all"
        set dstaddr "all"
        set action accept
    next
end`;

describe("parsedApplyObjects", () => {
  it("lists an object per parsed block, labelled", () => {
    const objs = parsedApplyObjects(ADDRESS_CLI + NAMED_POLICY);
    expect(objs.map((o) => [o.kind, o.name])).toEqual([
      ["address", "LAN-Net"],
      ["policy", "Allow-LAN-Internet"],
    ]);
    expect(objs[0].label).toBe("Address");
  });

  it("walks in the order Apply writes to the device — addresses before the policy that names them", () => {
    // Written the other way round in the CLI on purpose: the ORDER is the applier's, not the
    // model's, because a policy referencing an address that does not exist yet is a -3.
    const objs = parsedApplyObjects(NAMED_POLICY + ADDRESS_CLI);
    expect(objs.map((o) => o.kind)).toEqual(["address", "policy"]);
  });

  it("counts an object once however many times it is named", () => {
    expect(parsedApplyObjects(ADDRESS_CLI + ADDRESS_CLI)).toHaveLength(1);
  });

  it("skips a policy block with no name — Apply would skip it too", () => {
    expect(parsedApplyObjects(NAMELESS_POLICY)).toEqual([]);
  });

  it("keeps a policy identified by its mkey, because planApply does", () => {
    // `edit 7` with no `set name` is how an EDIT of an existing policy arrives, and
    // parsePolicyCLI deliberately falls back to the edit target so the wizard can open on it.
    // This walk follows planApply rather than second-guessing it: the two disagreeing is the
    // whole class of bug this file is about.
    const byId = `config firewall policy${NL}    edit 7${NL}        set action accept${NL}    next${NL}end`;
    expect(parsedApplyObjects(byId)).toEqual([{ kind: "policy", label: "Policy", name: "7" }]);
  });

  it("ignores sections with no REST endpoint", () => {
    expect(parsedApplyObjects(`config system ha${NL}    set mode a-p${NL}end`)).toEqual([]);
    expect(parsedApplyObjects(`config system global${NL}    set hostname "fg"${NL}end`)).toEqual([]);
  });

  it("finds a security profile through its own parser", () => {
    const av = `
config antivirus profile
    edit "AV-Flow"
        set comment "scan http"
        set feature-set flow
    next
end`;
    expect(parsedApplyObjects(av)).toEqual([
      { kind: "antivirus", label: "AntiVirus", name: "AV-Flow" },
    ]);
  });

  it("lists SD-WAN's four child tables, not its one header", () => {
    const sdwan = `
config system sdwan
    config zone
        edit "SDWAN_Internet"
        next
    end
    config members
        edit 1
            set interface "wan2"
            set zone "SDWAN_Internet"
        next
    end
end`;
    const kinds = parsedApplyObjects(sdwan).map((o) => o.kind);
    expect(kinds).toContain("sdwan-zone");
    expect(kinds).toContain("sdwan-member");
  });

  it("returns nothing for an empty or read-only answer", () => {
    expect(parsedApplyObjects("")).toEqual([]);
    expect(parsedApplyObjects("get system status")).toEqual([]);
  });
});

describe("countRESTApplicable counts objects, not edit lines", () => {
  // The regression, stated as the assertion that would have caught it: one `edit` line in a
  // REST-applicable section, zero objects the applier can build.
  it("is 0 for a nameless policy — the block has an edit line and produces no object", () => {
    // The two numbers that used to be conflated, side by side: one `edit` statement in the text,
    // zero objects the applier can build out of it.
    const [block] = topLevelConfigBlocks(normalizeCLI(NAMELESS_POLICY).split(NL));
    expect(topLevelEdits(block.inner)).toHaveLength(1);
    expect(countRESTApplicable(NAMELESS_POLICY)).toBe(0);
  });

  it("still counts what the parsers do produce", () => {
    expect(countRESTApplicable(ADDRESS_CLI)).toBe(1);
    expect(countRESTApplicable(ADDRESS_CLI + NAMED_POLICY)).toBe(2);
  });

  it("counts the parseable part of a mixed answer", () => {
    expect(countRESTApplicable(ADDRESS_CLI + NAMELESS_POLICY)).toBe(1);
  });
});

// The two block-walkers everything above is built on had no direct test of their own, which is
// how a miscount in them could look like a parser bug three files away.
describe("topLevelConfigBlocks / topLevelEdits", () => {
  const nested = `
config webfilter urlfilter
    edit 3
        set name "T"
        config entries
            edit 1
                set url "*.example.com"
            next
            edit 2
                set url "example.com"
            next
        end
    next
end
config firewall policy
    edit 0
        set name "P"
    next
end`;

  it("returns one entry per TOP-LEVEL config block", () => {
    const blocks = topLevelConfigBlocks(normalizeCLI(nested).split(NL));
    expect(blocks.map((b) => b.header)).toEqual(["webfilter urlfilter", "firewall policy"]);
  });

  it("does not let a nested `config entries … end` close its parent", () => {
    const blocks = topLevelConfigBlocks(normalizeCLI(nested).split(NL));
    expect(blocks[0].inner.join(NL)).toContain("*.example.com");
    expect(blocks[0].inner.join(NL)).not.toContain('set name "P"');
  });

  it("counts only the OUTER edits — the ids inside `config entries` are not keys", () => {
    const blocks = topLevelConfigBlocks(normalizeCLI(nested).split(NL));
    expect(topLevelEdits(blocks[0].inner).map((e) => e.name)).toEqual(["3"]);
  });

  it("handles an unterminated block without losing it", () => {
    const truncated = `config firewall address${NL}    edit "LAN"${NL}        set subnet 10.0.0.0 255.255.255.0`;
    const blocks = topLevelConfigBlocks(normalizeCLI(truncated).split(NL));
    expect(blocks.map((b) => b.header)).toEqual(["firewall address"]);
  });

  it("splits a security-profile answer into one prereq block per profile", () => {
    const two = `
config antivirus profile
    edit "AV-1"
        set feature-set flow
    next
end
config webfilter profile
    edit "WF-1"
        set comment "x"
    next
end`;
    expect(extractPrereqBlocks(two).map((b) => [b.kind, b.name])).toEqual([
      ["antivirus", "AV-1"],
      ["webfilter", "WF-1"],
    ]);
  });
});
