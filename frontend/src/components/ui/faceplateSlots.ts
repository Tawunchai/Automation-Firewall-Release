// Which interfaces are drawn as physical jacks on a FortiGate front panel, and in what order.
//
// Extracted from DeviceFaceplate so the 2D card on Network ▸ Interfaces and the 3D chassis on
// Network ▸ Topology cannot disagree about what counts as a port. They did, before this existed:
// an 80E reports ~22 interfaces but only fits 16 jacks — the rest are VLANs, the `lan` hard-switch,
// tunnels and npu vlinks — so any count taken over the whole interface list reported more live
// ports than the hardware has holes.

/** FGT80E front panel: two fixed connector columns, then the numbered block. */
const LEFT_COLUMNS: { top: FaceplateCell; bottom: FaceplateCell }[] = [
  { top: { name: "wan1", label: "WAN1" }, bottom: { name: "wan2", label: "WAN2" } },
  { top: { name: "dmz", label: "DMZ" },   bottom: { name: "ha", label: "HA" } },
];

export type FaceplateCell = { name: string; label: string };

export type FaceplateSlots = {
  /** The fixed columns, in panel order — both rows, including cells this device does not fit. */
  topCells: FaceplateCell[];
  bottomCells: FaceplateCell[];
  /** Only the fixed cells this device actually has. */
  fixed: FaceplateCell[];
  /** Numbered ports that exist, split the way the silk-screen orders them. */
  odds: number[];
  evens: number[];
  /** Caption for the fixed block, from what is fitted rather than what an 80E usually has. */
  fixedCaption: string;
  /** Every interface name that gets a jack — the only honest denominator for a port count. */
  drawnNames: Set<string>;
};

export function faceplateSlots(interfaces: { name: string }[]): FaceplateSlots {
  const present = new Set(interfaces.map((i) => i.name));

  const numbered = interfaces
    .map((i) => /^port(\d+)$/.exec(i.name))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b);

  const topCells = LEFT_COLUMNS.map((c) => c.top);
  const bottomCells = LEFT_COLUMNS.map((c) => c.bottom);
  const fixed = [...topCells, ...bottomCells].filter((c) => present.has(c.name));

  const fixedCaption = [
    fixed.some((c) => c.name.startsWith("wan")) && "WAN",
    present.has("dmz") && "DMZ",
    present.has("ha") && "HA",
  ].filter(Boolean).join(" · ");

  return {
    topCells,
    bottomCells,
    fixed,
    odds: numbered.filter((n) => n % 2 === 1),
    evens: numbered.filter((n) => n % 2 === 0),
    fixedCaption,
    drawnNames: new Set([...fixed.map((c) => c.name), ...numbered.map((n) => `port${n}`)]),
  };
}
