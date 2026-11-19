import { describe, expect, it } from "vitest";
import { diagSocketURL } from "./diagStream";

// The diagnostic WebSocket URL.
//
// Same reasoning as terminalUrl.test.ts: every way of getting this wrong fails identically and
// unreadably — the browser reports a socket that opened and closed with no status, so a `ws://` on
// an HTTPS page (blocked as mixed content, silently in some browsers) and a dropped `/api` prefix
// both look exactly like "the firewall refused us".

describe("diagSocketURL", () => {
  it("uses ws:// on an http page", () => {
    const url = diagSocketURL({ protocol: "http:", host: "localhost:5173" }, 1, "ping", { target: "8.8.8.8" });
    expect(url.startsWith("ws://localhost:5173/api/diag-stream/1/ping?")).toBe(true);
  });

  it("uses wss:// on an https page", () => {
    // A ws:// socket on an https page is mixed content and gets blocked, in some browsers with no
    // console error at all.
    const url = diagSocketURL({ protocol: "https:", host: "fw.example.com" }, 7, "traceroute", { target: "1.1.1.1" });
    expect(url.startsWith("wss://fw.example.com/api/diag-stream/7/traceroute?")).toBe(true);
  });

  it("keeps the /api prefix nginx and the vite proxy both key on", () => {
    const url = diagSocketURL({ protocol: "http:", host: "h" }, 2, "ping", { target: "x" });
    expect(url).toContain("/api/diag-stream/");
  });

  it("encodes the target rather than pasting it into the query", () => {
    const url = diagSocketURL({ protocol: "http:", host: "h" }, 1, "ping", { target: "a b&c=d" });
    expect(url).toContain("target=a+b%26c%3Dd");
    // One "?" only — a raw "&" in the target would otherwise invent a query parameter.
    expect(url.split("?").length).toBe(2);
  });

  it("sends ping options only when they are set", () => {
    const bare = diagSocketURL({ protocol: "http:", host: "h" }, 1, "ping", { target: "8.8.8.8" });
    expect(bare).not.toContain("count=");
    expect(bare).not.toContain("size=");
    expect(bare).not.toContain("source=");

    const full = diagSocketURL({ protocol: "http:", host: "h" }, 1, "ping", {
      target: "8.8.8.8", count: 3, size: 64, source: "10.0.0.1",
    });
    expect(full).toContain("count=3");
    expect(full).toContain("size=64");
    expect(full).toContain("source=10.0.0.1");
  });

  it("drops a zero or NaN option instead of overriding the device default with it", () => {
    const url = diagSocketURL({ protocol: "http:", host: "h" }, 1, "ping", {
      target: "8.8.8.8", count: 0, size: Number.NaN,
    });
    expect(url).not.toContain("count=");
    expect(url).not.toContain("size=");
  });

  it("ignores a blank source address", () => {
    const url = diagSocketURL({ protocol: "http:", host: "h" }, 1, "ping", { target: "8.8.8.8", source: "   " });
    expect(url).not.toContain("source=");
  });
});
