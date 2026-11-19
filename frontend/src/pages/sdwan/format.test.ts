import { describe, expect, it } from "vitest";
import {
  formatBytes, formatBps, memberLabel, chartsFor, buildRows,
  downloadSeries, bytesReceivedSeries, sessionsSeries,
} from "./format";
import type { SDWANMember } from "../../api/policyObject";

const member = (over: Partial<SDWANMember> = {}): SDWANMember => ({
  seq_num: 1, interface: "wan1", zone: "virtual-wan-link",
  gateway: "0.0.0.0", source: "0.0.0.0",
  cost: 0, weight: 1, priority: 1, volume_ratio: 1,
  status: true, comment: "",
  ...over,
});

describe("units", () => {
  it("formats bytes the way the FortiGate charts do (decimal, not binary)", () => {
    // Two consoles disagreeing about the size of the same transfer is worse than either convention.
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.00 kB");
    expect(formatBytes(1_500_000)).toBe("1.50 MB");
    expect(formatBytes(1_586_674_399)).toBe("1.59 GB");
  });

  it("formats a rate in bits per second", () => {
    expect(formatBps(0)).toBe("0 bps");
    expect(formatBps(8000)).toBe("8.00 kbps");
    expect(formatBps(125_000_000)).toBe("125 Mbps");
  });

  it("returns a dash rather than a number for values that are not measurements", () => {
    // NaN painted as "0 B" would read as "nothing flowed", which is a different claim.
    expect(formatBytes(NaN)).toBe("—");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBps(NaN)).toBe("—");
  });

  it("labels a member by its interface, falling back to the sequence number", () => {
    expect(memberLabel(member({ interface: "wan2" }))).toBe("wan2");
    expect(memberLabel(member({ interface: "", seq_num: 5 }))).toBe("#5");
  });
});

describe("chart series — absent is never zero", () => {
  // This is the whole rule of the file. The device reports a counter only when it knows it, and a
  // bar drawn at 0 for "the firewall did not say" claims a measurement nobody made.
  it("drops members with no value instead of flooring them", () => {
    const data = downloadSeries([
      member({ seq_num: 1, interface: "wan1", download_bps: 8000 }),
      member({ seq_num: 2, interface: "wan2" }), // device said nothing
    ]);
    expect(data).toHaveLength(1);
    expect(data[0].label).toBe("wan1");
  });

  it("keeps a real zero, which IS a measurement", () => {
    const data = bytesReceivedSeries([member({ interface: "wan1", rx_bytes: 0 })]);
    expect(data).toHaveLength(1);
    expect(data[0].value).toBe(0);
    expect(data[0].display).toBe("0 B");
  });

  it("ranks biggest first, the way the device's own charts do", () => {
    const data = bytesReceivedSeries([
      member({ seq_num: 1, interface: "wan1", rx_bytes: 100 }),
      member({ seq_num: 2, interface: "wan2", rx_bytes: 9000 }),
      member({ seq_num: 3, interface: "wan3", rx_bytes: 500 }),
    ]);
    expect(data.map((d) => d.label)).toEqual(["wan2", "wan3", "wan1"]);
  });

  it("yields nothing at all when there are no members — the lab device's real state", () => {
    // Matches the FortiGate screen exactly: zone virtual-wan-link, zero members, "No results".
    for (const tab of ["bandwidth", "volume", "sessions"] as const) {
      for (const chart of chartsFor(tab, [])) expect(chart.data).toEqual([]);
    }
  });

  it("gives each tab the charts the FortiGate tab strip shows", () => {
    expect(chartsFor("bandwidth", []).map((c) => c.title)).toEqual(["Download", "Upload"]);
    expect(chartsFor("volume", []).map((c) => c.title)).toEqual(["Bytes Received", "Bytes Sent"]);
    expect(chartsFor("sessions", []).map((c) => c.title)).toEqual(["Active Sessions"]);
  });
});

describe("sessions", () => {
  // The populated shape of monitor/virtual-wan/members was not observable on the lab device, so
  // the runtime object is passed through and only a genuine number is used.
  it("reads a numeric session count out of the passthrough runtime", () => {
    const data = sessionsSeries([member({ interface: "wan1", runtime: { session: 42 } })]);
    expect(data).toEqual([{ label: "wan1", value: 42, display: "42" }]);
  });

  it("ignores a non-numeric value rather than coercing it", () => {
    // {"status":"error"} is exactly what the lab device returns. Coercing that to 0 would put a
    // confident "0 sessions" on screen for a member whose state is unknown.
    expect(sessionsSeries([member({ runtime: { status: "error" } })])).toEqual([]);
    expect(sessionsSeries([member({ runtime: { session: "12" } })])).toEqual([]);
    expect(sessionsSeries([member({})])).toEqual([]);
  });
});

describe("table rows", () => {
  it("nests each member under its zone", () => {
    const rows = buildRows(
      [{ name: "virtual-wan-link", member_count: 2 }, { name: "sales", member_count: 0 }],
      [
        member({ seq_num: 2, interface: "wan2", zone: "virtual-wan-link" }),
        member({ seq_num: 1, interface: "wan1", zone: "virtual-wan-link" }),
      ],
    );
    expect(rows.map((r) => (r.kind === "zone" ? `Z:${r.zone}` : `M:${r.member.interface}`)))
      .toEqual(["Z:virtual-wan-link", "M:wan1", "M:wan2", "Z:sales"]);
  });

  it("shows a zone with no members, because an empty zone is a real configuration", () => {
    const rows = buildRows([{ name: "virtual-wan-link", member_count: 0 }], []);
    expect(rows).toEqual([{ kind: "zone", zone: "virtual-wan-link", memberCount: 0 }]);
  });

  it("surfaces a member whose zone is missing instead of hiding it", () => {
    // A member pointing at a deleted zone is still configured on the firewall. Dropping it would
    // make the page disagree with the device about what exists.
    const rows = buildRows(
      [{ name: "virtual-wan-link", member_count: 0 }],
      [member({ seq_num: 9, interface: "wan9", zone: "gone" })],
    );
    const orphanHeader = rows.find((r) => r.kind === "zone" && r.orphan);
    expect(orphanHeader).toBeTruthy();
    expect(rows.some((r) => r.kind === "member" && r.member.interface === "wan9")).toBe(true);
  });

  it("counts members from the members list, not from the server's count field", () => {
    // The two can disagree if a member was added between the two reads; what is drawn must match
    // what is listed underneath it.
    const rows = buildRows(
      [{ name: "virtual-wan-link", member_count: 99 }],
      [member({ seq_num: 1, zone: "virtual-wan-link" })],
    );
    expect(rows[0]).toMatchObject({ kind: "zone", memberCount: 1 });
  });
});
