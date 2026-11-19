import { describe, expect, it } from "vitest";
import type { TrafficLogRow } from "../../api/logs";
import {
  conversations, deviceClock, filterByGroup, interfacePath, rowResult, serviceLabel, storyOf, timeBuckets,
  topDestinations,
} from "./story";

// What these pin: every sentence the page shows about an entry must be true of that entry, and the
// four kinds of "it didn't work" must never be confused — a server reset is not a block, a block by
// a profile is not a block by the rule, and the FortiGate's own traffic was decided by no rule.

const base: TrafficLogRow = {
  row: 1, timestamp: 1788890109000, date: "2026-09-08", time: "10:55:09", tz: "-0700",
  logid: "0001000014", level: "notice", vd: "root", type: "traffic", subtype: "local", archive: false,
  srcip: "10.0.99.201", srcport: 1883, srcintf: "root", srcintfrole: "undefined", srccountry: "Reserved",
  srcname: "", srcmac: "", mastersrcmac: "", srchwvendor: "", devtype: "", osname: "", user: "", group: "",
  dstip: "173.243.140.16", dstport: 443, dstintf: "port1", dstintfrole: "lan", dstcountry: "United States",
  dstname: "", dstmac: "", dsthwvendor: "", dstdevtype: "",
  sessionid: 19990, proto: 6, proto_name: "TCP", action: "accept", policyid: 0, policytype: "",
  service: "HTTPS", app: "", appcat: "unscanned", trandisp: "noop", duration: 12,
  sentbyte: 4000, rcvdbyte: 9000, sentpkt: 10, rcvdpkt: 10, crscore: null, crlevel: "", msg: "",
  policy: { implicit: true, local_in: true, action: "accept", exists: true },
  dsthost: "globaldevquery.fortinet.net",
};
const row = (over: Partial<TrafficLogRow> = {}): TrafficLogRow => ({ ...base, ...over });

/** A forward-traffic row: a LAN client going out through a real policy. */
const forward = (over: Partial<TrafficLogRow> = {}): TrafficLogRow => row({
  subtype: "forward", srcip: "192.168.1.50", srcintf: "port5", dstintf: "wan1",
  dstip: "142.250.66.78", dsthost: "youtube.com", policyid: 8,
  policy: { name: "LAN-to-Internet", action: "accept", exists: true }, ...over,
});

describe("rowResult", () => {
  it("does not call a server reset a block — the far end refused, the firewall let it through", () => {
    const r = rowResult(row({ action: "server-rst" }));
    expect(r.kind).toBe("server-reset");
    expect(r.group).toBe("problem");
    expect(r.why).toMatch(/nothing on this firewall blocked it/);
  });

  it("treats a client reset as ordinary", () => {
    expect(rowResult(row({ action: "client-rst" })).group).toBe("ok");
  });

  it("separates the three ways the firewall blocks", () => {
    expect(rowResult(forward({ action: "deny", policyid: 0, policy: { implicit: true, exists: true } })).kind)
      .toBe("blocked-implicit");
    expect(rowResult(forward({ action: "deny", policy: { name: "Block-YT", action: "deny", exists: true } })).kind)
      .toBe("blocked-rule");
    // The rule says accept and the row says deny: a security profile decided, not the rule.
    const profile = rowResult(forward({ action: "deny" }));
    expect(profile.kind).toBe("blocked-profile");
    expect(profile.why).toMatch(/The policy itself is fine/);
  });
});

describe("serviceLabel", () => {
  it("names the service and the port once each", () => {
    expect(serviceLabel(row())).toBe("HTTPS (TCP/443)");
    expect(serviceLabel(row({ service: "tcp/853", app: "", dstport: 853 }))).toBe("tcp/853");
    expect(serviceLabel(row({ service: "", app: "", proto_name: "ICMP", dstport: null }))).toBe("ICMP");
  });
});

describe("storyOf", () => {
  it("says the FortiGate sent its own traffic, and that no policy decided it", () => {
    const s = storyOf(row());
    expect(s[0]).toBe("The FortiGate itself connected to globaldevquery.fortinet.net (173.243.140.16, United States) using HTTPS (TCP/443), leaving through port1.");
    expect(s[1]).toMatch(/never checked against the policy table/);
    expect(s.at(-1)).toBe("It sent 4.00 kB and received 9.00 kB over 12 s.");
  });

  it("tells a forward connection end to end, naming the policy", () => {
    const s = storyOf(forward());
    expect(s[0]).toBe("192.168.1.50 connected to youtube.com (142.250.66.78, United States) using HTTPS (TCP/443), arriving on port5 and leaving through wan1.");
    expect(s[1]).toBe("Policy #8 LAN-to-Internet handled it.");
  });

  it("says when the policy it names no longer exists", () => {
    expect(storyOf(forward({ policy: { name: "Old", action: "accept", exists: false } }))[1]).toMatch(/since been deleted or renumbered/);
  });

  it("says nothing moved rather than printing zeros", () => {
    expect(storyOf(row({ sentbyte: 0, rcvdbyte: 0 })).at(-1)).toBe("No data was exchanged.");
  });
});

describe("conversations", () => {
  it("folds repeats of one exchange into a line, headlined by its worst result", () => {
    const rows = [
      row({ row: 1, action: "close" }), row({ row: 2, action: "close" }),
      row({ row: 3, action: "server-rst" }),
      row({ row: 4, dstip: "127.0.0.1", dstintf: "root", dsthost: "", action: "close" }),
    ];
    const list = conversations(rows);
    expect(list).toHaveLength(2);
    expect(list[0].count).toBe(3);
    expect(list[0].byGroup).toEqual({ ok: 2, problem: 1, blocked: 0 });
    expect(list[0].result.kind).toBe("server-reset"); // one reset among completions is what to see
    expect(list[0].pivot).toBe("srcip==10.0.99.201 dstip==173.243.140.16 dstport==443");
    expect(list[0].policy).toBe("No policy (sent by the FortiGate)");
  });
});

describe("timeBuckets / topDestinations / filterByGroup", () => {
  const rows = Array.from({ length: 10 }, (_, i) => row({
    row: i, timestamp: base.timestamp + i * 60_000, action: i < 3 ? "server-rst" : "close",
    dstip: i % 2 ? "173.243.140.16" : "173.243.132.25", dsthost: i % 2 ? "a.fortinet.net" : "a.fortinet.net",
  }));

  it("puts every entry in exactly one bucket and one group", () => {
    const b = timeBuckets(rows, 5);
    expect(b.reduce((n, x) => n + x.ok + x.problem + x.blocked, 0)).toBe(10);
    expect(b.reduce((n, x) => n + x.problem, 0)).toBe(3);
  });

  it("disambiguates two addresses behind one name, and filters on the address", () => {
    const top = topDestinations(rows);
    expect(top).toHaveLength(2);
    expect(top[0].label).toMatch(/a\.fortinet\.net · 173\.243\./);
    expect(top[0].pivot).toMatch(/^dstip==173\.243\./);
  });

  it("filters by group, and returns the same array for all", () => {
    expect(filterByGroup(rows, "problem")).toHaveLength(3);
    expect(filterByGroup(rows, "all")).toBe(rows);
  });
});

describe("deviceClock", () => {
  it("reads the instant on the firewall's clock, not the viewer's", () => {
    // 2026-09-08 17:55:09 UTC is 10:55:09 on a -0700 firewall.
    const ms = Date.UTC(2026, 8, 8, 17, 55, 9);
    expect(deviceClock(ms, "-0700", false)).toBe("10:55");
    expect(deviceClock(ms, "+07:00", true)).toBe("Sep 9 00:55");
  });
});

describe("interfacePath", () => {
  it("drops the VDOM name the FortiGate's own traffic carries as its source interface", () => {
    expect(interfacePath(row())).toBe("→ port1");
    expect(interfacePath(forward())).toBe("port5 → wan1");
    expect(interfacePath(row({ srcintf: "root", dstintf: "root" }))).toBe("");
  });
});
