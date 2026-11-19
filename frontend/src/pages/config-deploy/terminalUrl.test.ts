import { describe, expect, it } from "vitest";
import { terminalSocketURL } from "./terminalUrl";

// The terminal's WebSocket URL.
//
// Worth its own test because every way of getting it wrong fails the same, unhelpful way: the
// browser reports a socket that opened and immediately closed, with no status and no body. A
// dropped `/api` prefix, a `ws://` on an HTTPS page (blocked as mixed content, silently in some
// browsers), a stray `port=0` — all of them look exactly like "the firewall refused us", which is
// the one thing they are not.

const http = { protocol: "http:", host: "127.0.0.1:5173" };
const https = { protocol: "https:", host: "console.lan" };

describe("terminalSocketURL", () => {
  it("uses ws:// on an http page", () => {
    expect(terminalSocketURL(http, 1, "telnet")).toMatch(/^ws:\/\/127\.0\.0\.1:5173\//);
  });

  it("uses wss:// on an https page", () => {
    // A ws:// socket on an https page is mixed content and gets blocked — in some browsers without
    // any console message at all.
    expect(terminalSocketURL(https, 1, "ssh")).toMatch(/^wss:\/\/console\.lan\//);
  });

  it("keeps the /api prefix that nginx and the dev proxy both key off", () => {
    // nginx routes the upgrade with `location ^~ /api/terminal/`; Vite's proxy matches "/api" with
    // ws:true. Dropping the prefix works in neither.
    expect(terminalSocketURL(http, 7, "telnet")).toContain("/api/terminal/7/shell");
  });

  it("carries the protocol the user picked", () => {
    expect(terminalSocketURL(http, 1, "telnet")).toContain("proto=telnet");
    expect(terminalSocketURL(http, 1, "ssh")).toContain("proto=ssh");
  });

  it("omits the port when none is given, so the backend picks 22 or 23 itself", () => {
    expect(terminalSocketURL(http, 1, "ssh")).not.toContain("port=");
  });

  it("sends an explicit port override", () => {
    expect(terminalSocketURL(http, 1, "ssh", 2222)).toContain("port=2222");
  });

  it("ignores a port that is not a usable number", () => {
    // An empty numeric input arrives as 0 or NaN. Forwarding either would override the backend's
    // sensible default with something that cannot connect.
    for (const bad of [0, NaN, -1, undefined]) {
      expect(terminalSocketURL(http, 1, "ssh", bad as number | undefined)).not.toContain("port=");
    }
  });

  it("puts the device id in the path, not the query", () => {
    // The route is /terminal/:deviceId/shell — an id in the query would 404 the upgrade.
    const url = terminalSocketURL(http, 42, "telnet");
    expect(url).toContain("/terminal/42/shell");
    expect(url).not.toMatch(/[?&]deviceId=/);
  });

  it("produces a URL the browser can actually parse", () => {
    // A malformed URL throws inside `new WebSocket`, which surfaces as an unrelated render error.
    const url = terminalSocketURL(https, 3, "ssh", 2200);
    const parsed = new URL(url);
    expect(parsed.protocol).toBe("wss:");
    expect(parsed.pathname).toBe("/api/terminal/3/shell");
    expect(parsed.searchParams.get("proto")).toBe("ssh");
    expect(parsed.searchParams.get("port")).toBe("2200");
  });
});
