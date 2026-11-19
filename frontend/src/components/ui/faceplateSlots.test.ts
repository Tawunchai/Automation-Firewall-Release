import { describe, it, expect } from "vitest";
import { faceplateSlots } from "./faceplateSlots";

// The interface list the lab FortiGate 80E actually returns (names only — that is all the slot
// rule reads). It is the case this module exists for: 22 interfaces, 16 jacks.
const FGT80E = [
  "fortilink", "lan", "dmz", "ha", "modem", "wan1", "wan2",
  "port1", "port2", "port3", "port4", "port5", "port6",
  "port7", "port8", "port9", "port10", "port11", "port12",
  "l2t.root", "naf.root", "ssl.root",
].map((name) => ({ name }));

describe("faceplateSlots", () => {
  it("draws only the jacks the hardware fits, not every interface", () => {
    const s = faceplateSlots(FGT80E);
    expect(s.drawnNames.size).toBe(16);
    expect(FGT80E.length).toBe(22);
  });

  it("leaves the switch, the aggregate and the tunnels off the panel", () => {
    const { drawnNames } = faceplateSlots(FGT80E);
    for (const name of ["lan", "fortilink", "ssl.root", "l2t.root", "naf.root"]) {
      expect(drawnNames.has(name)).toBe(false);
    }
  });

  // `modem` is typed physical by FortiOS but has no jack on the 80E front panel. Membership of
  // the panel is decided by the panel, not by the interface's type.
  it("omits a physical interface that has no jack", () => {
    expect(faceplateSlots(FGT80E).drawnNames.has("modem")).toBe(false);
  });

  it("orders numbered ports the way the silk-screen does", () => {
    const { odds, evens } = faceplateSlots(FGT80E);
    expect(odds).toEqual([1, 3, 5, 7, 9, 11]);
    expect(evens).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("sorts numbered ports numerically, not as strings", () => {
    const { odds, evens } = faceplateSlots([{ name: "port10" }, { name: "port9" }, { name: "port2" }]);
    expect(evens).toEqual([2, 10]);
    expect(odds).toEqual([9]);
  });

  it("captions the fixed block from what is fitted", () => {
    expect(faceplateSlots(FGT80E).fixedCaption).toBe("WAN · DMZ · HA");
    expect(faceplateSlots([{ name: "wan1" }, { name: "port1" }]).fixedCaption).toBe("WAN");
    expect(faceplateSlots([{ name: "port1" }]).fixedCaption).toBe("");
  });

  it("keeps a missing fixed cell out of `fixed` but still in the row, so the column stays aligned", () => {
    const s = faceplateSlots([{ name: "wan1" }, { name: "dmz" }]);
    expect(s.fixed.map((c) => c.name)).toEqual(["wan1", "dmz"]);
    expect(s.topCells.map((c) => c.name)).toEqual(["wan1", "dmz"]);
    expect(s.bottomCells.map((c) => c.name)).toEqual(["wan2", "ha"]);
  });
});
