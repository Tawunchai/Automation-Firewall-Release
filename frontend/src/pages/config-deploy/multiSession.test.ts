import { describe, expect, it } from "vitest";
import {
  MAX_BUFFER, appendCapped, liveTargets, overallStatus, scriptCommandCount, scriptToKeystrokes,
  statusSummary, type DeviceSession,
} from "./multiSession";
import type { TermStatus } from "./terminalUrl";

// Multi Config types one line and it lands on several production firewalls at once. The two things
// that must never be wrong are WHO receives it and WHAT the screen claims about that — a console
// that counts four devices while three are listening is how a change gets made on a firewall the
// operator believed was covered, and never notices.

const session = (deviceId: number, status: TermStatus, buffer = ""): DeviceSession => ({
  deviceId, name: `FW-${deviceId}`, status, detail: "", buffer,
});

describe("liveTargets", () => {
  it("is only the sessions that are actually connected", () => {
    const s = [
      session(1, "connected"),
      session(2, "connecting"),
      session(3, "error"),
      session(4, "closed"),
      session(5, "connected"),
    ];
    expect(liveTargets(s)).toEqual([1, 5]);
  });

  it("is empty when nothing is up, so a broadcast reaches nobody rather than throwing", () => {
    expect(liveTargets([])).toEqual([]);
    expect(liveTargets([session(1, "connecting"), session(2, "error")])).toEqual([]);
  });
});

describe("overallStatus", () => {
  it("only says connected when EVERY session is", () => {
    expect(overallStatus([session(1, "connected"), session(2, "connected")])).toBe("connected");
  });

  it("refuses to say connected while one device is still out", () => {
    // The whole point: "connected" on a four-device broadcast is read as "all four are listening".
    expect(overallStatus([session(1, "connected"), session(2, "error")])).toBe("connecting");
    expect(overallStatus([session(1, "connected"), session(2, "closed")])).toBe("connecting");
  });

  it("reports connecting while any dial is in flight", () => {
    expect(overallStatus([session(1, "connected"), session(2, "connecting")])).toBe("connecting");
  });

  it("reports error only when nothing came up at all", () => {
    expect(overallStatus([session(1, "error"), session(2, "error")])).toBe("error");
  });

  it("is idle with no devices selected", () => {
    expect(overallStatus([])).toBe("idle");
  });
});

describe("statusSummary", () => {
  it("counts what is ready out of what was asked for", () => {
    expect(statusSummary([session(1, "connected"), session(2, "connected")])).toBe("2/2 devices ready");
  });

  it("names the failures rather than hiding them behind the ready count", () => {
    const s = [session(1, "connected"), session(2, "error"), session(3, "closed")];
    expect(statusSummary(s)).toBe("1/3 devices ready · 1 failed · 1 dropped");
  });

  it("says so when nothing is selected", () => {
    expect(statusSummary([])).toBe("No device selected");
  });
});

describe("appendCapped", () => {
  it("keeps everything until the cap", () => {
    expect(appendCapped("abc", "def", 100)).toBe("abcdef");
  });

  it("drops from the head once the cap is passed", () => {
    const out = appendCapped("a".repeat(10), "b".repeat(10), 12);
    expect(out.length).toBeLessThanOrEqual(12);
    expect(out.endsWith("bbb")).toBe(true);
  });

  it("cuts at a line break so a replay never starts mid-escape-sequence", () => {
    // The head here ends inside "\x1b[31m"; a naive slice would replay the literal "[31m" and leave
    // the emulator holding half a colour change.
    const head = `${"x".repeat(20)}\x1b[31mRED`;
    const out = appendCapped(head, "\nline two\n", 12);
    expect(out).toBe("line two\n");
    expect(out.includes("\x1b")).toBe(false);
  });

  it("falls back to a hard cut when the tail has no line break at all", () => {
    const out = appendCapped("y".repeat(50), "z".repeat(5), 10);
    expect(out).toHaveLength(10);
    expect(out.endsWith("zzzzz")).toBe(true);
  });

  it("defaults to a cap big enough for a full config dump", () => {
    expect(MAX_BUFFER).toBeGreaterThanOrEqual(256 * 1024);
  });
});

describe("scriptToKeystrokes", () => {
  it("ends every line with CR, which is what Enter sends", () => {
    expect(scriptToKeystrokes("get system status")).toBe("get system status\r");
  });

  it("keeps a config block in order, one CR per line", () => {
    const block = 'config firewall address\n    edit "LAN"\n        set subnet 10.0.1.0 255.255.255.0\n    next\nend';
    expect(scriptToKeystrokes(block)).toBe(
      'config firewall address\r    edit "LAN"\r        set subnet 10.0.1.0 255.255.255.0\r    next\rend\r',
    );
  });

  it("drops blank lines — FortiOS answers an empty line with another prompt", () => {
    expect(scriptToKeystrokes("get system status\n\n\nget system performance status\n")).toBe(
      "get system status\rget system performance status\r",
    );
  });

  it("normalises CRLF from a pasted Windows file", () => {
    expect(scriptToKeystrokes("one\r\ntwo\r\n")).toBe("one\rtwo\r");
  });

  it("sends nothing at all for an empty or whitespace-only script", () => {
    expect(scriptToKeystrokes("")).toBe("");
    expect(scriptToKeystrokes("\n\n  \n")).toBe("");
  });

  it("keeps indentation, which FortiOS ignores but the reader does not", () => {
    expect(scriptToKeystrokes("    set nat enable")).toBe("    set nat enable\r");
  });
});

describe("scriptCommandCount", () => {
  it("counts what will actually run, not the lines in the box", () => {
    expect(scriptCommandCount("a\n\nb\n   \nc")).toBe(3);
    expect(scriptCommandCount("")).toBe(0);
    expect(scriptCommandCount("   ")).toBe(0);
  });

  it("agrees with scriptToKeystrokes about how many CRs get sent", () => {
    for (const script of ["a", "a\nb", "a\r\n\r\nb\r\n", "  x  \n\n y "]) {
      const keys = scriptToKeystrokes(script);
      const crs = (keys.match(/\r/g) ?? []).length;
      expect(crs).toBe(scriptCommandCount(script));
    }
  });
});
