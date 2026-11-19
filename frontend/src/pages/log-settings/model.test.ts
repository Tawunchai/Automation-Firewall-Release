import { describe, expect, it } from "vitest";
import {
  describeDestinations, diskOnWithoutADisk, draftFrom, enabledButUnconfigured,
  patchFor, validateSection,
} from "./model";
import type { LogSettings } from "../../api/systemSettings";

// Everything here is about a firewall that answers "yes, logging is on" in ways that are not true.

const settings = (over: Partial<LogSettings> = {}): LogSettings => ({
  events: {
    implicit_deny_log: true, local_in_allow: false, local_in_deny_unicast: false,
    local_in_deny_broadcast: false, local_out: true, log_invalid_packet: false,
    resolve_ip: false, resolve_port: true, brief_traffic_format: false,
    user_anonymize: false, log_policy_comment: false,
  },
  memory: { enabled: true },
  disk: {
    enabled: false, max_log_file_size_mb: 20, roll_schedule: "daily", roll_day: "sunday",
    roll_time: "00:00", disk_full: "overwrite", maximum_log_age_days: 7, upload: false,
  },
  syslog: {
    enabled: false, server: "", port: 514, mode: "udp", facility: "local7", format: "default",
    source_ip: "", enc_algorithm: "disable", certificate: "", priority: "default",
    max_log_rate: 0, configured: false,
  },
  fortianalyzer: {
    enabled: false, server: "", alt_server: "", upload_option: "5-minute", reliable: false,
    certificate_verification: true, source_ip: "", enc_algorithm: "high",
    ssl_min_proto_version: "default", max_log_rate: 0, configured: false,
  },
  disk_available: false,
  disk_status: "not_available",
  ...over,
});

describe("describeDestinations", () => {
  it("says plainly when nothing is both on and configured", () => {
    const s = settings({ memory: { enabled: false } });
    expect(describeDestinations(s)).toMatch(/nowhere/i);
  });

  it("does not count a destination that is switched on with no server", () => {
    // enabled + no server is a destination sending nothing. Listing it would be the console
    // repeating the device's own optimistic answer.
    const s = settings();
    s.syslog.enabled = true;
    expect(describeDestinations(s)).not.toMatch(/syslog/i);

    s.syslog.server = "10.0.0.5";
    s.syslog.configured = true;
    expect(describeDestinations(s)).toMatch(/syslog \(10\.0\.0\.5\)/);
  });

  it("does not count disk logging on a unit with no disk", () => {
    const s = settings();
    s.disk.enabled = true;
    expect(describeDestinations(s)).not.toMatch(/disk/i);

    const withDisk = settings({ disk_available: true, disk_status: "available" });
    withDisk.disk.enabled = true;
    expect(describeDestinations(withDisk)).toMatch(/disk/i);
  });
});

describe("enabledButUnconfigured", () => {
  it("names each destination that is on with nowhere to send", () => {
    const s = settings();
    s.syslog.enabled = true;
    s.fortianalyzer.enabled = true;
    expect(enabledButUnconfigured(s)).toEqual(["Syslog", "FortiAnalyzer"]);
  });

  it("says nothing about destinations that are off", () => {
    expect(enabledButUnconfigured(settings())).toEqual([]);
  });
});

describe("diskOnWithoutADisk", () => {
  // Verified live: the lab FGT80E reports log_disk_status not_available and still accepts and
  // STORES status=enable on log.disk/setting.
  it("catches a stored setting that cannot do anything", () => {
    const s = settings();
    s.disk.enabled = true;
    expect(diskOnWithoutADisk(s)).toBe(true);
  });

  it("is quiet on a unit that has a disk", () => {
    const s = settings({ disk_available: true });
    s.disk.enabled = true;
    expect(diskOnWithoutADisk(s)).toBe(false);
  });
});

describe("patchFor", () => {
  it("sends one section and nothing else", () => {
    // Each section is a separate PUT on the device. Submitting them together makes every save
    // depend on the one a diskless unit refuses.
    const d = draftFrom(settings());
    const events = patchFor(d, "events");
    expect(events.events).toBeDefined();
    expect(events.syslog).toBeUndefined();
    expect(events.disk).toBeUndefined();

    const syslog = patchFor(d, "syslog");
    expect(syslog.syslog).toBeDefined();
    expect(syslog.events).toBeUndefined();

    expect(patchFor(d, "memory").memory_enabled).toBe(true);
  });
});

describe("validateSection", () => {
  it("refuses a destination switched on with no server", () => {
    const d = draftFrom(settings());
    d.syslog.enabled = true;
    expect(validateSection(d, "syslog")).toMatch(/sends nothing/i);

    d.fortianalyzer.enabled = true;
    expect(validateSection(d, "fortianalyzer")).toMatch(/server address/i);
  });

  it("allows a destination that is simply off", () => {
    const d = draftFrom(settings());
    expect(validateSection(d, "syslog")).toBeNull();
  });

  it("checks only the section being saved", () => {
    // A broken syslog draft must not block a logging-option change.
    const d = draftFrom(settings());
    d.syslog.enabled = true;
    expect(validateSection(d, "events")).toBeNull();
  });

  it("rejects impossible numbers", () => {
    const d = draftFrom(settings());
    d.syslog.enabled = true;
    d.syslog.server = "10.0.0.5";
    d.syslog.port = 70000;
    expect(validateSection(d, "syslog")).toMatch(/between 0 and 65535/i);

    d.disk.maximum_log_age_days = -1;
    expect(validateSection(d, "disk")).toMatch(/negative/i);
  });
});
