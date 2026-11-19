import { describe, expect, it } from "vitest";
import type { LogGates, LogSource, TrafficLogRow } from "../../api/logs";
import {
  actionChipClass, actionTone, applicationIsService, describeRecording, destinationEndpoint,
  displayCountry, explainEmpty, formatApplication, formatBytes, formatDevice, formatDeviceDetail,
  clampPage, formatEndpoint, formatLogTime, formatRelative, formatSentReceived, pageCount,
  pageRange, pageSlice, policyVerdict, ROWS_PER_PAGE, selectableSources, sourceEndpoint,
  verdictChipClass,
} from "./format";

// The rules that decide what a log row MEANS on screen.
//
// The two rows below are copied out of a live capture from the lab FortiGate (80E, FortiOS
// 7.2.10) rather than invented, because the bugs these tests exist to catch come from the shapes
// the device really produces — chiefly a field being ABSENT where a reader would expect a zero.

/** A TCP row: ports present, application identified only as a service. */
const tcpRow: TrafficLogRow = {
  row: 1,
  timestamp: 1787813590000,
  date: "2026-08-26",
  time: "23:53:10",
  tz: "-0700",
  logid: "0001000014",
  level: "notice",
  vd: "root",
  type: "traffic",
  subtype: "local",
  archive: false,
  srcip: "10.10.20.227",
  srcport: 57815,
  srcintf: "port1",
  srcintfrole: "lan",
  srccountry: "Reserved",
  srcname: "",
  srcmac: "00:09:0f:09:00:00",
  mastersrcmac: "00:09:0f:09:00:00",
  srchwvendor: "Fortinet",
  devtype: "Router",
  osname: "",
  user: "",
  group: "",
  dstip: "10.0.99.201",
  dstport: 443,
  dstintf: "root",
  dstintfrole: "undefined",
  dstcountry: "Reserved",
  dstname: "",
  dstmac: "",
  dsthwvendor: "",
  dstdevtype: "",
  sessionid: 3595,
  proto: 6,
  proto_name: "TCP",
  action: "close",
  policyid: 0,
  policytype: "local-in-policy",
  service: "HTTPS",
  app: "Web Management(HTTPS)",
  appcat: "unscanned",
  trandisp: "noop",
  duration: 1,
  sentbyte: 2332,
  rcvdbyte: 462,
  sentpkt: 7,
  rcvdpkt: 5,
  crscore: null,
  crlevel: "",
  msg: "",
  policy: null,
  raw: {},
};

/**
 * The ICMP row, which is the important one.
 *
 * The device sent NO `srcport` and NO `dstport` at all — not zero, absent. Everything below that
 * asserts on `null` is guarding against the port coming back as 0 and being rendered.
 */
const icmpRow: TrafficLogRow = {
  ...tcpRow,
  row: 2,
  srcport: null,
  dstport: null,
  proto: 1,
  proto_name: "ICMP",
  action: "accept",
  service: "PING",
  app: "PING",
  sentbyte: 240,
  rcvdbyte: 240,
};

describe("formatBytes", () => {
  // Every expectation here was read off the FortiGate's own log view beside the raw byte count it
  // served over the API for the same row. They pin the CONVENTION, not a preference.
  it("uses base 1000, as the device does — not 1024", () => {
    expect(formatBytes(2332)).toBe("2.33 kB");   // the device showed 2.33 kB; 1024 gives 2.28
    expect(formatBytes(1603)).toBe("1.60 kB");   // 1.60; 1024 gives 1.57
    expect(formatBytes(37409)).toBe("37.41 kB"); // 37.41; 1024 gives 36.5
    expect(formatBytes(4115)).toBe("4.12 kB");
    expect(formatBytes(9557)).toBe("9.56 kB");
  });

  it("keeps two decimals however large the number, as the device does", () => {
    // 37.41 rather than 37.4 — the device does not drop precision as the value grows.
    expect(formatBytes(37409)).toBe("37.41 kB");
    expect(formatBytes(500_000)).toBe("500.00 kB");
  });

  it("prints whole bytes below 1 kB", () => {
    expect(formatBytes(462)).toBe("462 B");
    expect(formatBytes(240)).toBe("240 B");
    expect(formatBytes(999)).toBe("999 B");
    expect(formatBytes(1000)).toBe("1.00 kB");
  });

  it("steps up through MB, GB and TB on the same base", () => {
    expect(formatBytes(1_000_000)).toBe("1.00 MB");
    expect(formatBytes(1_000_000_000)).toBe("1.00 GB");
    expect(formatBytes(1e12)).toBe("1.00 TB");
  });

  it("shows zero bytes as a real observation, not a dash", () => {
    // A denied SYN transfers nothing. "0 B" is the measurement; "—" would mean "not recorded".
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(NaN)).toBe("—");
  });

  it("formats the Sent / Received column in the device's order", () => {
    // The device's own screen for this row: "2.33 kB / 462 B".
    expect(formatSentReceived(tcpRow)).toBe("2.33 kB / 462 B");
  });

  it("leaves Sent / Received BLANK when nothing moved either way", () => {
    // A denied SYN transfers nothing, and half the lab buffer is those. FortiOS's own log view
    // leaves the cell empty rather than printing "0 B / 0 B" down fifteen rows.
    expect(formatSentReceived({ ...tcpRow, sentbyte: 0, rcvdbyte: 0 })).toBe("");
    // One side at zero is still a real measurement: the far end never answered.
    expect(formatSentReceived({ ...tcpRow, rcvdbyte: 0 })).toBe("2.33 kB / 0 B");
  });
});

describe("formatEndpoint", () => {
  it("appends the port when there is one", () => {
    expect(sourceEndpoint(tcpRow).address).toBe("10.10.20.227:57815");
    expect(destinationEndpoint(tcpRow).address).toBe("10.0.99.201:443");
  });

  it("NEVER renders :0 for a protocol that has no ports", () => {
    // The whole reason srcport/dstport are `number | null`. An ICMP row carries no port, and
    // ":0" would be a port number that was never on the wire.
    expect(sourceEndpoint(icmpRow).address).toBe("10.10.20.227");
    expect(destinationEndpoint(icmpRow).address).toBe("10.0.99.201");
    expect(sourceEndpoint(icmpRow).address).not.toContain(":");
  });

  it("keeps a real port 0 distinguishable from an absent one", () => {
    expect(formatEndpoint("10.0.0.1", 0, "", "").address).toBe("10.0.0.1:0");
    expect(formatEndpoint("10.0.0.1", null, "", "").address).toBe("10.0.0.1");
  });

  it("drops FortiOS's 'Reserved' pseudo-country", () => {
    // Every row of a lab Local Traffic log says "Reserved" — it is what FortiOS calls an RFC1918
    // address it will not geolocate. Rendering it would put noise on every line.
    expect(displayCountry("Reserved")).toBe("");
    expect(displayCountry("Thailand")).toBe("Thailand");
    expect(sourceEndpoint(tcpRow).country).toBe("");
  });

  it("carries a resolved name when the device supplied one", () => {
    expect(formatEndpoint("10.0.0.5", 80, "web01", "Thailand")).toEqual({
      ip: "10.0.0.5",
      address: "10.0.0.5:80",
      name: "web01",
      country: "Thailand",
      flag: "🇹🇭",
    });
  });

  it("puts a flag on a real country and none on a private address", () => {
    // FortiOS logs a country by its ENGLISH NAME, so the flag comes from a name lookup, not a code.
    expect(formatEndpoint("173.243.140.16", 443, "", "United States").flag).toBe("🇺🇸");
    expect(formatEndpoint("173.243.129.16", 443, "", "Canada").flag).toBe("🇨🇦");
    // "Reserved" is not a place; a flag on every RFC1918 row would be noise.
    expect(formatEndpoint("10.0.0.1", 443, "", "Reserved").flag).toBe("");
    // A name the table does not know must not produce a bogus two-letter glyph.
    expect(formatEndpoint("1.2.3.4", 443, "", "Nowhere").flag).toBe("");
  });

  it("shows the reverse-DNS host when the firewall recorded no name", () => {
    // `dsthost` comes from the device's per-query `_extra` lookup and is what puts
    // "(globalgip.fortinet.net)" beside the address, exactly as FortiOS does.
    const external = {
      ...tcpRow,
      dstip: "173.243.140.16",
      dstcountry: "United States",
      dstname: "",
      dsthost: "globalgip.fortinet.net",
    };
    expect(destinationEndpoint(external).name).toBe("globalgip.fortinet.net");
    expect(destinationEndpoint(external).flag).toBe("🇺🇸");
  });

  it("prefers the name the firewall RECORDED over one resolved now", () => {
    // The recorded name was true when the packet passed; a lookup answered now can disagree, and
    // on a log the historical answer is the honest one.
    const both = { ...tcpRow, dstname: "as-logged", dsthost: "as-resolved-now" };
    expect(destinationEndpoint(both).name).toBe("as-logged");
  });
});

describe("formatDevice", () => {
  it("shows the MAC, which is what the device's own log view shows", () => {
    // This row carries BOTH devtype "Router" and a source MAC, and FortiOS renders the MAC. The
    // column answers "which box"; "Router" is a classification every router on the segment shares,
    // and the MAC is the thing an operator takes to the switch to find the port.
    expect(formatDevice(tcpRow)).toBe("00:09:0f:09:00:00");
  });

  it("prefers a name over the MAC, because a name is a better identity still", () => {
    expect(formatDevice({ ...tcpRow, srcname: "laptop-01" })).toBe("laptop-01");
  });

  it("falls back through master MAC, then the classification", () => {
    expect(formatDevice({ ...tcpRow, srcmac: "" })).toBe("00:09:0f:09:00:00"); // mastersrcmac
    expect(formatDevice({ ...tcpRow, srcmac: "", mastersrcmac: "" })).toBe("Router");
    expect(formatDevice({ ...tcpRow, srcmac: "", mastersrcmac: "", devtype: "" })).toBe("Fortinet");
  });

  it("stays EMPTY for traffic the firewall originated itself", () => {
    // A local-out row has no source MAC and no source device fields at all — the lab buffer holds
    // two of them, to fortinet.net. Falling back to the IP would repeat the Source column and imply
    // an identification that never happened; FortiOS leaves the cell blank.
    expect(formatDevice({
      ...tcpRow, srcname: "", srcmac: "", mastersrcmac: "", devtype: "", srchwvendor: "",
    })).toBe("");
  });

  it("puts the classification underneath, without repeating the line above", () => {
    // The MAC is on the first line, so "Router" is new information and belongs on the second.
    expect(formatDeviceDetail(tcpRow)).toBe("Router · Fortinet");
    expect(formatDeviceDetail({ ...tcpRow, osname: "Windows 11" })).toBe("Router · Windows 11");
    // When the line above IS the classification there is nothing left to add.
    expect(formatDeviceDetail({
      ...tcpRow, srcmac: "", mastersrcmac: "", srchwvendor: "",
    })).toBe("");
  });
});

describe("formatApplication", () => {
  it("uses the Application Control name when there is one", () => {
    expect(formatApplication(tcpRow)).toBe("Web Management(HTTPS)");
    expect(applicationIsService(tcpRow)).toBe(false);
  });

  it("falls through to the service, as the device does without an app sensor", () => {
    const noApp = { ...tcpRow, app: "" };
    expect(formatApplication(noApp)).toBe("HTTPS");
    // Flagged, because "we identified this application" and "this is the port it usually uses"
    // are different claims and the page marks which one it is making.
    expect(applicationIsService(noApp)).toBe(true);
  });

  it("falls all the way to the protocol so a raw ESP row still says something", () => {
    expect(formatApplication({ ...tcpRow, app: "", service: "", proto_name: "ESP" })).toBe("ESP");
  });
});

describe("actionTone", () => {
  it("separates a firewall block from a client hanging up", () => {
    // client-rst is the most common action in a Local Traffic log and means the CLIENT reset the
    // connection. Painting it as blocked would send someone hunting for a rule that blocked
    // nothing.
    expect(actionTone("deny")).toBe("blocked");
    expect(actionTone("client-rst")).toBe("closed");
    expect(actionTone("server-rst")).toBe("closed");
    expect(actionTone("close")).toBe("closed");
    expect(actionTone("accept")).toBe("allowed");
    expect(actionTone("timeout")).toBe("closed");
  });

  it("is case-insensitive and leaves anything unknown neutral", () => {
    expect(actionTone("DENY")).toBe("blocked");
    expect(actionTone("something-new")).toBe("neutral");
  });

  it("maps tones onto the design system's role chips", () => {
    expect(actionChipClass("accept")).toBe("chip chip-ok");
    expect(actionChipClass("deny")).toBe("chip chip-danger");
    expect(actionChipClass("client-rst")).toBe("chip");
  });
});

describe("time", () => {
  it("shows the device's own formatting, not the browser's timezone", () => {
    // The device is on -0700; a viewer may be on +0700. Re-deriving from the epoch would relabel
    // every row and disagree with the same entry read over SSH.
    //
    // Slashes, because that is how FortiOS prints a log date — matching its rendering is what lets
    // someone compare this table against the firewall's own screen line for line.
    expect(formatLogTime(tcpRow)).toBe("2026/08/26 23:53:10");
  });

  it("measures age against the FIREWALL's clock", () => {
    const now = 1787813590000;
    expect(formatRelative(now - 30_000, now)).toBe("just now");
    expect(formatRelative(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatRelative(now - 3 * 3600_000, now)).toBe("3h ago");
    expect(formatRelative(now - 2 * 86_400_000, now)).toBe("2d ago");
  });

  it("does not print a negative age for a row written just after the clock was read", () => {
    const now = 1787813590000;
    expect(formatRelative(now + 2000, now)).toBe("just now");
  });

  it("says nothing when either instant is missing", () => {
    expect(formatRelative(0, 1787813590000)).toBe("");
    expect(formatRelative(1787813590000, 0)).toBe("");
  });
});

describe("selectableSources", () => {
  const sources: LogSource[] = [
    { key: "memory", label: "Memory", available: true, enabled: true, is_default: true },
    { key: "disk", label: "Disk", available: false, enabled: false, is_default: false },
    { key: "fortianalyzer", label: "FortiAnalyzer", available: true, enabled: false, is_default: false },
    { key: "forticloud", label: "FortiGate Cloud", available: true, enabled: true, is_default: false },
  ];

  it("offers exactly what the device's own picker offers", () => {
    // These four readings are the lab FGT80E's real answer. FortiOS's picker shows two entries:
    // Memory and FortiGate Cloud. Disk is absent hardware; FortiAnalyzer is present but not
    // enabled, and querying it would ask a collector this unit does not send to.
    expect(selectableSources(sources).map((s) => s.label)).toEqual(["Memory", "FortiGate Cloud"]);
  });
});

describe("explainEmpty", () => {
  const gatesOff: LogGates = {
    local_in_allow: false,
    local_in_deny_unicast: false,
    local_in_deny_broadcast: false,
    local_out: false,
    source_accepts_local: true,
  };

  it("says nothing when there are no gate readings to speak from", () => {
    expect(explainEmpty(undefined, "Memory")).toBeNull();
  });

  it("names the recording gate when the firewall writes nothing down", () => {
    const reason = explainEmpty(gatesOff, "Memory");
    expect(reason?.title).toBe("This firewall is not recording local traffic");
    expect(reason?.cli.join("\n")).toContain("set local-in-allow enable");
  });

  it("names the per-backend filter when recording is on but the store discards it", () => {
    // The lab device's real state: recording is off AND memory filters the category out. This is
    // the second half, isolated — traffic IS being recorded, memory just refuses to keep it.
    const reason = explainEmpty(
      { ...gatesOff, local_out: true, source_accepts_local: false, source_filter_path: "log.memory" },
      "Memory",
    );
    expect(reason?.title).toBe("Memory is set to discard local traffic");
    expect(reason?.cli[0]).toBe("config log memory filter");
    expect(reason?.cli.join("\n")).toContain("set local-traffic enable");
  });

  it("stays silent when both gates are open — then empty really means empty", () => {
    expect(explainEmpty({ ...gatesOff, local_in_allow: true, source_accepts_local: true }, "Memory")).toBeNull();
  });

  it("never blames the device on the strength of a table it could not read", () => {
    // source_accepts_local is null when the filter table was unreadable. Claiming a
    // misconfiguration from that would be inventing a fault.
    expect(explainEmpty({ ...gatesOff, local_out: true, source_accepts_local: null }, "Memory")).toBeNull();
  });

  it("lists which halves of local logging are switched on", () => {
    expect(describeRecording({ ...gatesOff, local_in_allow: true, local_out: true }))
      .toBe("Recording: accepted inbound, firewall-originated");
    expect(describeRecording(gatesOff)).toBe("");
    expect(describeRecording(undefined)).toBe("");
  });
});

describe("policyVerdict", () => {
  const withPolicy = (
    over: Partial<TrafficLogRow>,
    policy: TrafficLogRow["policy"],
  ): TrafficLogRow => ({ ...tcpRow, ...over, policy });

  it("names the rule instead of showing a bare number", () => {
    // The whole reason the column exists: "8" answers nothing, the name ends the investigation.
    const v = policyVerdict(withPolicy(
      { policyid: 8, policytype: "policy", action: "accept" },
      { name: "Block-FB-YT-172.16.100.123", action: "accept", exists: true },
    ));
    expect(v.label).toBe("#8 Block-FB-YT-172.16.100.123");
    expect(v.by).toBe("allowed");
    expect(v.blocked).toBe(false);
  });

  it("calls forward policyid 0 the implicit deny — the usual 'I can't get online'", () => {
    const v = policyVerdict(withPolicy(
      { policyid: 0, policytype: "policy", action: "deny" },
      { implicit: true, action: "deny", exists: true },
    ));
    expect(v.label).toBe("Implicit deny");
    expect(v.by).toBe("implicit-deny");
    expect(v.blocked).toBe(true);
  });

  it("calls LOCAL policyid 0 the implicit local-in policy, and does not paint it as a block", () => {
    // Same id 0, completely different rule. Getting this wrong would mark every ordinary admin
    // session as blocked — `policytype` is the only thing separating them.
    const v = policyVerdict(withPolicy(
      { policyid: 0, policytype: "local-in-policy", action: "close" },
      { implicit: true, action: "accept", exists: true },
    ));
    expect(v.label).toBe("Implicit local-in");
    expect(v.by).toBe("local-in");
    expect(v.blocked).toBe(false);
  });

  it("trusts the server about which implicit rule it is, not a field the device omits", () => {
    // MEASURED ON THE LAB FGT80E: every row of its Local Traffic log arrives with policyid 0 and
    // NO policytype at all. This used to fall through to "Implicit deny", which painted 200 out of
    // 200 rows red as blocked — NTP exchanges the firewall completed included. The server resolves
    // it now, because the server knows which log was read.
    const v = policyVerdict(withPolicy(
      { policyid: 0, policytype: "", action: "close", srcintf: "port1", dstintf: "root" },
      { implicit: true, local_in: true, action: "accept", exists: true },
    ));
    expect(v.label).toBe("Implicit local-in");
    expect(v.by).toBe("local-in");
    expect(v.blocked).toBe(false);
  });

  it("says nothing decided the firewall's OWN outbound traffic, because nothing did", () => {
    // Local-out is most of what a Local Traffic log holds — FortiGuard, NTP, the unit's own DNS —
    // and it never meets the rule base. Any policy verdict on it, permitted or denied, is a claim
    // about a decision that was never made. srcintf naming the VDOM is the marker: the packet
    // arrived on no interface, so it did not arrive.
    const v = policyVerdict(withPolicy(
      { policyid: 0, policytype: "", action: "server-rst", vd: "root", srcintf: "root", dstintf: "port1" },
      { implicit: true, local_in: true, action: "accept", exists: true },
    ));
    expect(v.label).toBe("Local out");
    expect(v.by).toBe("local-out");
    expect(v.blocked).toBe(false);

    // And traffic that really did arrive on an interface is NOT called local-out, however similar
    // the rest of the row looks.
    const inbound = policyVerdict(withPolicy(
      { policyid: 0, policytype: "", action: "server-rst", vd: "root", srcintf: "port1", dstintf: "root" },
      { implicit: true, local_in: true, action: "accept", exists: true },
    ));
    expect(inbound.by).toBe("local-in");
  });

  it("separates a rule that denied from a PROFILE that blocked — the YouTube case", () => {
    // The row was blocked but the RULE says accept, so a Web Filter / App Control sensor made the
    // decision. This is the one people waste hours on: the policy looks right because it IS right,
    // and editing it changes nothing.
    const utm = policyVerdict(withPolicy(
      { policyid: 8, policytype: "policy", action: "deny" },
      { name: "Allow-Internet", action: "accept", exists: true },
    ));
    expect(utm.by).toBe("security-profile");
    expect(utm.blocked).toBe(true);

    // Whereas a rule whose own action is deny really is the thing to edit.
    const byRule = policyVerdict(withPolicy(
      { policyid: 9, policytype: "policy", action: "deny" },
      { name: "Block-Social", action: "deny", exists: true },
    ));
    expect(byRule.by).toBe("policy");
  });

  it("reports a rule that no longer exists rather than hiding it", () => {
    // A log entry outlives the rule that produced it, and "the rule was deleted since" is itself
    // the answer to "it worked yesterday".
    const v = policyVerdict(withPolicy(
      { policyid: 42, policytype: "policy", action: "accept" },
      { exists: false },
    ));
    expect(v.missing).toBe(true);
    expect(v.label).toBe("#42");
  });

  it("says nothing when the device named no rule", () => {
    // Absent is not the same as policy 0 — inventing an implicit deny would be a fabricated
    // explanation.
    const v = policyVerdict(withPolicy({ policyid: null, policytype: "" }, null));
    expect(v.label).toBe("—");
    expect(v.by).toBe("unknown");
  });

  it("does not treat a reset connection as a block", () => {
    // client-rst is the most common action in a local traffic log and means the CLIENT hung up.
    const v = policyVerdict(withPolicy(
      { policyid: 0, policytype: "local-in-policy", action: "client-rst" },
      { implicit: true, action: "accept", exists: true },
    ));
    expect(v.blocked).toBe(false);
  });

  it("colours by role, and only marks what deserves attention", () => {
    const denied = policyVerdict(withPolicy(
      { policyid: 0, policytype: "policy", action: "deny" },
      { implicit: true, action: "deny", exists: true },
    ));
    const profile = policyVerdict(withPolicy(
      { policyid: 8, policytype: "policy", action: "deny" },
      { name: "Allow-Internet", action: "accept", exists: true },
    ));
    const fine = policyVerdict(withPolicy(
      { policyid: 8, policytype: "policy", action: "accept" },
      { name: "Allow-Internet", action: "accept", exists: true },
    ));
    expect(verdictChipClass(denied)).toBe("chip chip-danger");
    expect(verdictChipClass(profile)).toBe("chip chip-warn");
    expect(verdictChipClass(fine)).toBe("chip");
  });
});

describe("paging", () => {
  const rows = Array.from({ length: 34 }, (_, i) => i); // the lab buffer's real size

  it("shows 20 to a page", () => {
    expect(ROWS_PER_PAGE).toBe(20);
    expect(pageSlice(rows, 0)).toHaveLength(20);
    expect(pageSlice(rows, 0)[0]).toBe(0);
    // The last page is short, and that is correct — not padded, not wrapped.
    expect(pageSlice(rows, 1)).toHaveLength(14);
    expect(pageSlice(rows, 1)[0]).toBe(20);
  });

  it("counts pages, and gives an empty log a page 1 rather than page 0", () => {
    expect(pageCount(34)).toBe(2);
    expect(pageCount(40)).toBe(2);
    expect(pageCount(41)).toBe(3);
    expect(pageCount(20)).toBe(1);
    // "0 of 0 pages" would render as a broken control; an empty table is page 1 of 1.
    expect(pageCount(0)).toBe(1);
  });

  it("clamps a page index that has outrun the rows", () => {
    // Load-bearing, not defensive: the row count shrinks under the reader all the time — a search
    // is applied, the window narrows, a refresh finds fewer entries in the ring buffer. Landing on
    // "page 5 of 2" renders an empty table that reads exactly like "the firewall saw nothing".
    expect(clampPage(5, 34)).toBe(1);
    expect(clampPage(1, 34)).toBe(1);
    expect(clampPage(-3, 34)).toBe(0);
    expect(clampPage(0, 0)).toBe(0);
    expect(clampPage(NaN, 34)).toBe(0);
  });

  it("never returns rows from past the end, however wrong the index", () => {
    expect(pageSlice(rows, 99)).toHaveLength(14); // clamped to the last page
    expect(pageSlice([], 3)).toEqual([]);
  });

  it("describes the span the way a person reads it — 1-based and inclusive", () => {
    expect(pageRange(34, 0)).toEqual({ from: 1, to: 20, total: 34 });
    expect(pageRange(34, 1)).toEqual({ from: 21, to: 34, total: 34 });
    // Not "1–0", which looks like a rendering fault.
    expect(pageRange(0, 0)).toEqual({ from: 0, to: 0, total: 0 });
    // An exact multiple must not report a phantom extra row.
    expect(pageRange(20, 0)).toEqual({ from: 1, to: 20, total: 20 });
  });

  it("agrees with itself: every row appears on exactly one page", () => {
    const seen = new Set<number>();
    for (let i = 0; i < pageCount(rows.length); i += 1) {
      for (const r of pageSlice(rows, i)) {
        expect(seen.has(r)).toBe(false); // no row on two pages
        seen.add(r);
      }
    }
    expect(seen.size).toBe(rows.length); // and none missed
  });
});
