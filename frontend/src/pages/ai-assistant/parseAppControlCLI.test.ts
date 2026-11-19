import { describe, it, expect } from "vitest";
import { parseAppControlFromCLI } from "./parseAppControlCLI";

// The Application Control parser — the one the AI gets most wrong, and the one where being wrong
// is least visible.
//
// An application sensor's `config entries` table holds three DIFFERENT kinds of row that look
// almost identical in CLI, and which one it is decides what the wizard shows:
//   · `set application <ids>`  → an application override: these named apps, by signature id
//   · `set category N` plus any narrowing attribute → a filter override
//   · `set category N` alone   → a tile action in the category grid
// Read a filter override as a plain category action and the wizard quietly widens the rule from
// "peer-to-peer apps that are high risk" to "every peer-to-peer app".
//
// On top of that, FortiOS stores `technology` and `behavior` as NUMERIC CODES, not the words the
// GUI shows. A parser that passed the number through would send "4" where the form expects
// "Peer-to-Peer", and the wizard would render an empty select.

const NL = String.fromCharCode(10);
const cli = (...lines: string[]) => lines.join(NL);

describe("parseAppControlFromCLI", () => {
  it("reads the sensor name, comment and target", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl-FB"',
      '        set comment "block facebook"',
      "    next",
      "end",
    ));
    expect(p).not.toBeNull();
    expect(p!.name).toBe("AppCtrl-FB");
    expect(p!.target).toBe("AppCtrl-FB");
    expect(p!.comment).toBe("block facebook");
  });

  it("reads an application override as signature ids, not as a category", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl-FB"',
      "        config entries",
      "            edit 1",
      "                set application 15832 15833 15834",
      "                set action block",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    expect(p.overrides).toHaveLength(1);
    expect(p.overrides[0].type).toBe("application");
    expect(p.overrides[0].action).toBe("block");
    expect(p.overrides[0].applications.map((a) => a.id)).toEqual([15832, 15833, 15834]);
    // …and NOT as grid tiles, which is the mistake that widens the rule.
    expect(p.categoryActions).toEqual([]);
  });

  it("reads a bare category entry as a grid tile", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config entries",
      "            edit 1",
      "                set category 2 23",
      "                set action block",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    expect(p.categoryActions).toEqual([
      { category: 2, action: "block" },
      { category: 23, action: "block" },
    ]);
    expect(p.overrides).toEqual([]);
  });

  it("promotes a category entry to a FILTER override as soon as anything narrows it", () => {
    // THE DISTINCTION THAT MATTERS. Same category line, plus a risk — this is "high-risk P2P",
    // not "all P2P", and the two are a very different firewall.
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config entries",
      "            edit 1",
      "                set category 2",
      "                set risk 4 5",
      "                set action block",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    expect(p.categoryActions).toEqual([]);
    expect(p.overrides).toHaveLength(1);
    expect(p.overrides[0].type).toBe("filter");
    expect(p.overrides[0].categories).toEqual([2]);
    expect(p.overrides[0].risk).toEqual([4, 5]);
  });

  it("decodes technology and behavior from their numeric codes", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config entries",
      "            edit 1",
      "                set category 2",
      "                set technology 4",
      "                set action block",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    // "4" is Peer-to-Peer. The form's select holds the display string, so a raw code renders blank.
    expect(p.overrides[0].technologies).toEqual(["Peer-to-Peer"]);
  });

  it("maps each entry action the way the device reads it", () => {
    const sensor = (lines: string[]) => parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config entries",
      "            edit 1",
      "                set category 2",
      ...lines,
      "            next",
      "        end",
      "    next",
      "end",
    ))!.categoryActions[0].action;

    // An entry with no action line is BLOCK on FortiOS (unlike a DNS filter entry, which is
    // monitor) — so the parser must not soften it to monitor to be safe. The wizard would then
    // show a sensor that logs where the device blocks.
    expect(sensor([])).toBe("block");
    expect(sensor(["                set action block"])).toBe("block");
    expect(sensor(["                set action reset"])).toBe("block");
    // `pass` is monitor unless logging is off, which is the only "allow" the GUI offers.
    expect(sensor(["                set action pass"])).toBe("monitor");
    expect(sensor(["                set action pass", "                set log disable"])).toBe("allow");
    // Quarantine outranks the action: the entry blocks AND banishes the source.
    expect(sensor(["                set action block", "                set quarantine attacker"])).toBe("quarantine");
  });

  it("reads the profile-level toggles", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        set unknown-application-action block",
      "        set enforce-default-app-port enable",
      "        set app-replacemsg enable",
      "        set options allow-dns",
      "    next",
      "end",
    ))!;
    expect(p.unknownApplicationAction).toBe("block");
    expect(p.blockNonDefaultPorts).toBe(true);
    expect(p.replacementMessages).toBe(true);
    expect(p.allowAndLogDNS).toBe(true);
  });

  it("reads Network Protocol Enforcement and turns the master switch on with it", () => {
    // A default-network-services table does nothing unless the master toggle is on, so a table
    // with no explicit toggle implies it — otherwise the wizard shows rows that enforce nothing.
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config default-network-services",
      "            edit 1",
      "                set port 80",
      "                set services http",
      "                set violation-action monitor",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    expect(p.networkProtocolEnforcement).toBe(true);
    expect(p.networkServices).toEqual([
      { id: 0, port: 80, services: ["http"], violation_action: "monitor" },
    ]);
  });

  it("drops a network-service row with no usable port", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl"',
      "        config default-network-services",
      "            edit 1",
      "                set services http",
      "            next",
      "        end",
      "    next",
      "end",
    ))!;
    expect(p.networkServices).toEqual([]);
  });

  it("reads a rename: the edit key is the target, `set name` the new name", () => {
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl-Old"',
      '        set name "AppCtrl-New"',
      "    next",
      "end",
    ))!;
    expect(p.target).toBe("AppCtrl-Old");
    expect(p.name).toBe("AppCtrl-New");
  });

  it("returns null for anything that is not an application list", () => {
    expect(parseAppControlFromCLI("")).toBeNull();
    expect(parseAppControlFromCLI("get system status")).toBeNull();
    expect(parseAppControlFromCLI(cli(
      "config firewall policy",
      "    edit 0",
      '        set application-list "AppCtrl"',
      "    next",
      "end",
    ))).toBeNull();
    // A header with no edit in it is not a sensor either.
    expect(parseAppControlFromCLI(cli("config application list", "end"))).toBeNull();
  });

  it("does not read a nested `config entries` as a second sensor", () => {
    // topLevelConfigBlocks/topLevelEdits do the balancing; this is the assertion that the sensor
    // parser relies on it rather than scanning for `edit` lines.
    const p = parseAppControlFromCLI(cli(
      "config application list",
      '    edit "AppCtrl-A"',
      "        config entries",
      "            edit 1",
      "                set category 2",
      "            next",
      "            edit 2",
      "                set category 23",
      "            next",
      "        end",
      "    next",
      '    edit "AppCtrl-B"',
      "    next",
      "end",
    ))!;
    expect(p.target).toBe("AppCtrl-A");            // the FIRST sensor, not the last edit seen
    expect(p.categoryActions.map((c) => c.category)).toEqual([2, 23]);
  });
});
