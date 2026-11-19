import { describe, expect, it } from "vitest";
import {
  buildChartRows,
  cloudRegionLabel,
  formatBytes,
  formatDeviceTime,
  formatUptime,
  formatUptimeLong,
  licenseStatusLabel,
  licenseTone,
  percentOf,
} from "./format";

describe("formatUptime", () => {
  it("uses the device's dd:hh:mm:ss form", () => {
    // The uptime shown on the lab FortiGate's own dashboard.
    expect(formatUptime(44 * 86400 + 21 * 3600 + 34 * 60 + 19)).toBe("44:21:34:19");
  });

  it("zero-pads every field but the day count", () => {
    expect(formatUptime(3600 + 2 * 60 + 3)).toBe("0:01:02:03");
    expect(formatUptime(0)).toBe("0:00:00:00");
  });

  it("renders unknown uptime as a dash rather than a fake zero", () => {
    // The SSH probe failing must not read as "the firewall just rebooted".
    expect(formatUptime(null)).toBe("—");
    expect(formatUptime(undefined)).toBe("—");
    expect(formatUptime(-1)).toBe("—");
  });

  it("spells uptime out for the tooltip", () => {
    expect(formatUptimeLong(44 * 86400 + 21 * 3600 + 34 * 60)).toBe("44 days, 21 hours, 34 minutes");
    expect(formatUptimeLong(60)).toBe("1 minute");
    expect(formatUptimeLong(0)).toBe("Unknown");
  });
});

describe("formatDeviceTime", () => {
  // The device clock arrives as a UTC epoch and the offset separately; rendering must not fall
  // back on the browser's timezone, or every user would see a different "device" time.
  const epochUTC = 1785396163; // 2026-07-30 07:22:43 UTC

  it("applies the device's offset, not the browser's", () => {
    // -7h is the lab device's own (DST-adjusted Pacific) offset.
    expect(formatDeviceTime(epochUTC, -7 * 3600)).toBe("2026/07/30 00:22:43");
    expect(formatDeviceTime(epochUTC, 7 * 3600)).toBe("2026/07/30 14:22:43");
    expect(formatDeviceTime(epochUTC, 0)).toBe("2026/07/30 07:22:43");
  });

  it("handles half-hour offsets and day rollover", () => {
    expect(formatDeviceTime(epochUTC, 5.5 * 3600)).toBe("2026/07/30 12:52:43");
    expect(formatDeviceTime(epochUTC, -8 * 3600)).toBe("2026/07/29 23:22:43");
  });

  it("shows a dash when the device did not report a clock", () => {
    expect(formatDeviceTime(0, 7 * 3600)).toBe("—");
  });
});

describe("formatBytes", () => {
  it("matches the FortiGate Cloud widget's 'Storage Used'", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(null)).toBe("0 B");
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 ** 3)).toBe("5.0 GB");
  });

  it("caps at petabytes instead of running off the unit table", () => {
    expect(formatBytes(524288000000000)).toBe("476.8 TB");
    expect(formatBytes(5 * 1024 ** 6)).toBe("5120.0 PB");
  });
});

describe("licence presentation", () => {
  it("separates a lapsed subscription from one that was never bought", () => {
    // Red means something stopped working; amber means it was never turned on. Collapsing the
    // two would make an unlicensed feature look like an outage.
    expect(licenseTone("expired")).toBe("error");
    expect(licenseTone("no_license")).toBe("warn");
    expect(licenseTone("licensed")).toBe("ok");
    expect(licenseTone("registered")).toBe("ok");
    expect(licenseTone("free_license")).toBe("ok");
    expect(licenseTone("unknown")).toBe("muted");
    expect(licenseTone("something-new")).toBe("muted");
  });

  it("labels each status in the device's vocabulary", () => {
    expect(licenseStatusLabel("no_license")).toBe("Not Licensed");
    expect(licenseStatusLabel("free_license")).toBe("Free License");
    expect(licenseStatusLabel("expired")).toBe("Expired");
    // An unrecognised value is passed through rather than swallowed.
    expect(licenseStatusLabel("pending")).toBe("pending");
  });

  it("expands the FortiGate Cloud region code", () => {
    expect(cloudRegionLabel("GLOBAL")).toBe("Global");
    expect(cloudRegionLabel("US")).toBe("United States");
    expect(cloudRegionLabel("")).toBe("—");
    expect(cloudRegionLabel("APAC")).toBe("APAC");
  });
});

describe("buildChartRows", () => {
  const main = [
    { t: 3000, v: 5 },
    { t: 1000, v: 1 },
    { t: 2000, v: 3 },
  ];

  it("sorts by time so the chart runs forwards", () => {
    const rows = buildChartRows(main, "1-min");
    expect(rows.map((r) => r.t)).toEqual([1000, 2000, 3000]);
    expect(rows.map((r) => r.value)).toEqual([1, 3, 5]);
  });

  it("merges per-core series onto the aggregate's timestamps", () => {
    const rows = buildChartRows(main, "1-min", [
      { key: "core0", points: [{ t: 1000, v: 9 }, { t: 2000, v: 8 }] },
    ]);
    expect(rows[0].core0).toBe(9);
    expect(rows[1].core0).toBe(8);
    // A core with no sample at that timestamp leaves a gap instead of dropping the row.
    expect(rows[2].core0).toBeUndefined();
    expect(rows[2].value).toBe(5);
  });

  it("ignores extra samples that have no matching aggregate timestamp", () => {
    const rows = buildChartRows(main, "1-min", [{ key: "core0", points: [{ t: 9999, v: 1 }] }]);
    expect(rows).toHaveLength(3);
    expect(rows.some((r) => r.t === 9999)).toBe(false);
  });

  it("returns nothing for an empty series", () => {
    expect(buildChartRows([], "1-min")).toEqual([]);
  });
});

describe("percentOf", () => {
  it("matches the Sessions widget's one-decimal SPU / nTurbo figures", () => {
    expect(percentOf(0, 13)).toBe("0.0%");
    expect(percentOf(5, 20)).toBe("25.0%");
    expect(percentOf(1, 3)).toBe("33.3%");
  });

  it("does not divide by zero when the device reports no sessions", () => {
    expect(percentOf(0, 0)).toBe("0.0%");
    expect(percentOf(5, 0)).toBe("0.0%");
  });
});
