import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  LicenseOverview, SystemInformation,
} from "../../api/deviceMonitor";
import {
  FortiGateCloudWidget, LicensesWidget, SystemInformationWidget,
} from "./widgets";

// Rendering checks for the dashboard widgets, driven by what the lab FortiGate 80E
// (FortiOS 7.2.10) actually returns. They exist because the widgets' job is to reproduce the
// device's own status page: a field silently dropped, or a "0" shown where the device said
// "unknown", is exactly the kind of bug a formatter test cannot catch.

const ACCENT = "#7c3aed";

/** Strips tags and un-escapes entities so assertions match visible text, not markup. */
const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#x27;": "'", "&#39;": "'",
};
const text = (el: React.ReactElement): string =>
  renderToStaticMarkup(el)
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;|&lt;|&gt;|&quot;|&#x27;|&#39;/g, (m) => ENTITIES[m])
    .replace(/\s+/g, " ");

const SYSTEM: SystemInformation = {
  hostname: "NGFW-Testing",
  serial: "FGT80ETK19026638",
  model: "FortiGate 80E",
  model_code: "FGT80E",
  version: "v7.2.10",
  build: 1706,
  maturity: "Mature",
  release_type: "GA",
  firmware_latest: "",
  operation_mode: "NAT",
  system_time: 1785396163,
  timezone_offset: -7 * 3600,
  timezone_name: "(GMT-8:00) Pacific Time (US & Canada)",
  uptime_seconds: 44 * 86400 + 21 * 3600 + 34 * 60 + 19,
  wan_ip: "171.97.97.81",
  log_disk_status: "not_available",
  vdom_used: 1,
  vdom_max: 10,
};

const LICENSES: LicenseOverview = {
  primary: [
    { key: "forticare_support", label: "FortiCare Support", status: "registered" },
    { key: "firmware_updates", label: "Firmware & General Updates", status: "expired" },
    { key: "antivirus", label: "AntiVirus", status: "expired", expires: 1681257600 },
    { key: "web_filtering", label: "Web Filtering", status: "expired", expires: 1681257600 },
    { key: "security_rating", label: "Security Rating", status: "no_license" },
  ],
  secondary: [
    { key: "ips", label: "Intrusion Prevention", status: "expired" },
    { key: "botnet_ip", label: "Botnet IP", status: "licensed" },
  ],
  forticare: { status: "registered", account: "its@got.co.th", company: "Get On Technology" },
  fortiguard: {
    connected: true,
    connection_issue: false,
    server_address: "173.243.140.6:443",
    last_connection: 1785394151,
    next_update: 1785397740,
    wan_ip: "171.97.97.81",
  },
  forticloud: {
    status: "cloud_logged_in",
    activated: true,
    account: "its@got.co.th",
    domain: "GLOBAL",
    logging_status: "free_license",
    log_retention_days: 7,
    used_bytes: 0,
    max_bytes: 524288000000000,
  },
  fortitoken: { used: 0, total: 2 },
  vdom_used: 1,
  vdom_max: 10,
};

describe("SystemInformationWidget", () => {
  it("shows the device's identity as the firewall reports it", () => {
    const out = text(
      <SystemInformationWidget system={SYSTEM} tick={0} accent={ACCENT} loading={false} />,
    );
    expect(out).toContain("NGFW-Testing");
    expect(out).toContain("FGT80ETK19026638");
    expect(out).toContain("v7.2.10 build1706 (Mature)");
    expect(out).toContain("NAT");
    expect(out).toContain("171.97.97.81");
    expect(out).toContain("1 / 10");
  });

  it("renders System Time in the device's timezone, not the browser's", () => {
    const out = text(
      <SystemInformationWidget system={SYSTEM} tick={0} accent={ACCENT} loading={false} />,
    );
    // 1785396163 UTC shifted by the device's -7h offset.
    expect(out).toContain("2026/07/30 00:22:43");
  });

  it("advances the clock and uptime with the local tick", () => {
    const out = text(
      <SystemInformationWidget system={SYSTEM} tick={60} accent={ACCENT} loading={false} />,
    );
    expect(out).toContain("2026/07/30 00:23:43");
    expect(out).toContain("44:21:35:19");
  });

  it("shows a dash — not zero — when uptime could not be measured over SSH", () => {
    const out = text(
      <SystemInformationWidget
        system={{ ...SYSTEM, uptime_seconds: 0 }}
        tick={0}
        accent={ACCENT}
        loading={false}
      />,
    );
    expect(out).not.toContain("0:00:00:00");
    expect(out).toContain("Uptime — ");
  });

  it("flags a newer firmware when the device offers one", () => {
    const out = text(
      <SystemInformationWidget
        system={{ ...SYSTEM, firmware_latest: "v7.2.11" }}
        tick={0}
        accent={ACCENT}
        loading={false}
      />,
    );
    expect(out).toContain("v7.2.11 available");
  });
});

describe("LicensesWidget", () => {
  it("lists every primary entitlement with the device's own verdict", () => {
    const out = text(
      <LicensesWidget licenses={LICENSES} accent={ACCENT} loading={false} />,
    );
    expect(out).toContain("FortiCare Support");
    expect(out).toContain("Registered");
    expect(out).toContain("Firmware & General Updates");
    expect(out).toContain("AntiVirus");
    expect(out).toContain("Expired");
    expect(out).toContain("Security Rating");
    expect(out).toContain("Not Licensed");
  });

  it("shows FortiToken usage the way the device counts it", () => {
    const out = text(<LicensesWidget licenses={LICENSES} accent={ACCENT} loading={false} />);
    expect(out).toContain("FortiToken");
    expect(out).toContain("0 / 2");
  });

  it("lists every secondary entitlement too, with no show-more toggle", () => {
    const out = text(<LicensesWidget licenses={LICENSES} accent={ACCENT} loading={false} />);
    expect(out).not.toContain("more entitlements");
    expect(out).toContain("Intrusion Prevention");
    expect(out).toContain("Botnet IP");
  });

  it("reports why the section is missing instead of rendering an empty panel", () => {
    const out = text(
      <LicensesWidget
        licenses={null}
        error="FortiGate API error: HTTP 403"
        accent={ACCENT}
        loading={false}
      />,
    );
    expect(out).toContain("HTTP 403");
  });
});

describe("FortiGateCloudWidget", () => {
  it("matches the device's cloud panel", () => {
    const out = text(<FortiGateCloudWidget licenses={LICENSES} accent={ACCENT} loading={false} />);
    expect(out).toContain("Activated");
    expect(out).toContain("Global");
    expect(out).toContain("Free License");
    expect(out).toContain("0 B");
  });

  it("does not claim activation when the device is not logged in", () => {
    const offline: LicenseOverview = {
      ...LICENSES,
      forticloud: { ...LICENSES.forticloud, activated: false, status: "cloud_not_logged_in" },
    };
    const out = text(<FortiGateCloudWidget licenses={offline} accent={ACCENT} loading={false} />);
    expect(out).toContain("Not Activated");
  });
});

