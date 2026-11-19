import { describe, it, expect } from "vitest";
import { buildTopology } from "../model";
import { buildStage } from "./stageModel";
import { FGT80E_INTERFACES, FGT80E_ROUTES, FGT80E_POLICIES } from "./fixture80e";

const stage = () => buildStage({
  topo: buildTopology({
    interfaces: FGT80E_INTERFACES,
    zones: [],
    routes: FGT80E_ROUTES,
    tunnels: [],
    policies: FGT80E_POLICIES,
    deviceName: "FortiGate-80E",
    unreadable: [],
  }),
  interfaces: FGT80E_INTERFACES,
  routes: FGT80E_ROUTES,
});

describe("buildStage, against the real lab 80E", () => {
  it("draws a jack for every port the chassis fits and no more", () => {
    const s = stage();
    expect(s.sockets).toHaveLength(16);
    expect(FGT80E_INTERFACES).toHaveLength(22);
  });

  it("reads the live link state rather than folding unknown into down", () => {
    const { ports } = stage();
    expect(ports.up).toBe(1);        // only port1 has a cable in it
    expect(ports.down).toBe(15);
    expect(ports.unknown).toBe(0);   // every jack reports its own link — ladder step 1
  });

  // The whole reason linkState() exists: the backend turns a failed monitor read into an empty
  // map, so "every jack is null" is a failed read, not a firewall with no cables.
  it("calls an all-null read unreadable instead of drawing 16 dead ports", () => {
    const blind = FGT80E_INTERFACES.map((i) => ({ ...i, link_up: null }));
    const s = buildStage({
      topo: buildTopology({
        interfaces: blind, zones: [], routes: FGT80E_ROUTES, tunnels: [],
        policies: FGT80E_POLICIES, deviceName: "FortiGate-80E", unreadable: [],
      }),
      interfaces: blind,
      routes: FGT80E_ROUTES,
    });
    expect(s.linkUnreadable).toBe(true);
    expect(s.ports.down).toBe(0);
  });

  it("does not call the real device unreadable", () => {
    expect(stage().linkUnreadable).toBe(false);
  });

  it("gives a tile only to configured interfaces, and a bare socket to the rest", () => {
    const s = stage();
    const tiles = s.nodes.filter((n) => n.kind === "interface").map((n) => n.label).sort();
    expect(tiles).toEqual(["dmz", "fortilink", "lan", "port1", "wan1"]);
    // Addressless, ruleless, not in a switch — a dark jack, counted, never a tile.
    expect(s.fold.unused.sort()).toEqual(["ha", "wan2"]);
  });

  it("puts the port that carries the default route Outside, despite its role saying lan", () => {
    const s = stage();
    const port1 = s.nodes.find((n) => n.label === "port1");
    expect(FGT80E_INTERFACES.find((i) => i.name === "port1")?.role).toBe("lan");
    expect(port1?.lane).toBe("outside");
    expect(s.wan.via).toEqual(["port1"]);
    expect(s.wan.gateway).toBe("10.0.99.1");
  });

  it("counts only the WANs that are actually set up", () => {
    // wan1 has an address, port1 carries the default route — wan2 is a bare socket with a WAN role.
    const { wan } = stage();
    expect(wan.total).toBe(2);
    expect(wan.up).toBe(1);
  });

  it("hands the switch its members' jacks, so eleven ports light one tile", () => {
    const lan = stage().nodes.find((n) => n.label === "lan");
    expect(lan?.logical).toBe(true);
    expect(lan?.sockets).toHaveLength(11);
    expect(lan?.lane).toBe("inside");
  });

  it("keeps a jackless pseudo-interface off the stage entirely, and says so", () => {
    // `modem` is typed physical but has no jack; the three *.root tunnels are FortiOS's own.
    expect(stage().fold.system).toContain("modem");
  });

  it("leaves the internet in the Outside lane when a default route points at it", () => {
    expect(stage().nodes.find((n) => n.kind === "internet")?.lane).toBe("outside");
  });
});
