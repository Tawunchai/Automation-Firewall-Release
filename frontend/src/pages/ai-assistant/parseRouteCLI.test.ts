import { describe, it, expect } from "vitest";
import { parseRouteFromCLI, routeDraftToForm } from "./parseRouteCLI";

// The static-route parser: the one CLI block with no NAME in it.
//
// Everything else the AI proposes is keyed by a name it writes; a route is keyed by a sequence
// number FortiOS assigns, and `edit 0` means "you pick it". That difference is why the parser has
// its own notion of target, and why these tests are mostly about values that LOOK like a route and
// are not one — a block the parser half-reads becomes a route object in the Apply dialog that the
// device then refuses.

const NL = String.fromCharCode(10);
const cli = (...lines: string[]) => lines.join(NL);

describe("parseRouteFromCLI", () => {
  it("reads a default route and converts the mask to a prefix", () => {
    // FortiOS writes `set dst <ip> <mask>`; the form holds CIDR. A route shown as
    // "0.0.0.0 0.0.0.0" in a confirmation dialog is unreadable to the person checking it.
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 0.0.0.0 0.0.0.0",
      "        set gateway 203.0.113.1",
      '        set device "wan1"',
      "    next",
      "end",
    ));
    expect(p).not.toBeNull();
    expect(p!.form.dst).toBe("0.0.0.0/0");
    expect(p!.form.gateway).toBe("203.0.113.1");
    expect(p!.form.device).toBe("wan1");
    expect(p!.form.dstType).toBe("subnet");
    // edit 0 = a NEW route: there is no existing seq-num to update.
    expect(p!.target).toBe("");
  });

  it("keeps the sequence number when the block edits an existing route", () => {
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 7",
      "        set dst 10.20.0.0 255.255.0.0",
      "        set gateway 10.0.0.254",
      "    next",
      "end",
    ));
    expect(p!.target).toBe("7");
    expect(p!.form.dst).toBe("10.20.0.0/16");
  });

  it("passes a non-contiguous mask through instead of inventing a prefix", () => {
    // A mask like this is almost certainly a mistake, but silently rewriting it as /24 would
    // deploy a route the user never described.
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 10.0.0.0 255.0.255.0",
      "        set gateway 10.0.0.1",
      "    next",
      "end",
    ));
    expect(p!.form.dst).toBe("10.0.0.0/255.0.255.0");
  });

  it("treats gateway 0.0.0.0 as no gateway", () => {
    // That is how FortiOS stores an interface route with no next hop; carried through literally
    // it looks like a route to the wrong place.
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 192.168.5.0 255.255.255.0",
      "        set gateway 0.0.0.0",
      '        set device "dmz"',
      "    next",
      "end",
    ));
    expect(p!.form.gateway).toBe("");
    expect(p!.form.device).toBe("dmz");
  });

  it("reads a blackhole route, which has no interface at all", () => {
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 198.51.100.0 255.255.255.0",
      "        set blackhole enable",
      "    next",
      "end",
    ));
    expect(p!.form.device).toBe("blackhole");
  });

  it("reads an internet-service route, which has no dst", () => {
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set internet-service 65643",
      '        set device "wan1"',
      "    next",
      "end",
    ));
    expect(p!.form.dstType).toBe("internet-service");
    expect(p!.form.internetService).toBe(65643);
  });

  it("carries distance, priority, comment and a disabled status", () => {
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 10.1.0.0 255.255.255.0",
      "        set gateway 10.0.0.1",
      "        set distance 15",
      "        set priority 5",
      "        set status disable",
      '        set comment "backup path"',
      "    next",
      "end",
    ));
    expect(p!.form.distance).toBe("15");
    expect(p!.form.priority).toBe("5");
    expect(p!.form.enabled).toBe(false);
    expect(p!.form.comment).toBe("backup path");
  });

  it("defaults to enabled when no status line is present", () => {
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 10.1.0.0 255.255.255.0",
      "        set gateway 10.0.0.1",
      "    next",
      "end",
    ));
    // Not `false`: an absent `set status` means enabled on FortiOS, and a route the user is told
    // was created but which is disabled is the worst of both answers.
    expect(p!.form.enabled).toBeUndefined();
    expect(routeDraftToForm(p!.form).enabled).toBe(true);
  });

  it("returns null when the block describes nothing routable", () => {
    // The guard that keeps a half-written block out of the Apply dialog: no dst, no
    // internet-service, no blackhole.
    expect(parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set gateway 10.0.0.1",
      "    next",
      "end",
    ))).toBeNull();
  });

  it("returns null for CLI that is not a static route at all", () => {
    expect(parseRouteFromCLI("")).toBeNull();
    expect(parseRouteFromCLI("get router info routing-table all")).toBeNull();
    expect(parseRouteFromCLI(cli(
      "config firewall address",
      '    edit "LAN"',
      "        set subnet 10.0.0.0 255.255.255.0",
      "    next",
      "end",
    ))).toBeNull();
  });

  it("reads a block that was truncated before its `end`", () => {
    // A streamed answer can stop anywhere. The route still parses — what must NOT happen is the
    // parser returning null for a complete `edit … next` just because the outer `end` is missing.
    const p = parseRouteFromCLI(cli(
      "config router static",
      "    edit 0",
      "        set dst 172.16.0.0 255.255.0.0",
      "        set gateway 172.16.0.1",
      "    next",
    ));
    expect(p!.form.dst).toBe("172.16.0.0/16");
  });
});

describe("routeDraftToForm", () => {
  it("fills every field the draft did not mention", () => {
    const form = routeDraftToForm({ dst: "10.0.0.0/8" });
    expect(form.dst).toBe("10.0.0.0/8");
    expect(form.dstType).toBe("subnet");
    expect(typeof form.distance).toBe("string");
  });

  it("merges over an existing route for an edit", () => {
    const base = routeDraftToForm({ dst: "10.0.0.0/8", gateway: "10.0.0.1", comment: "old" });
    const merged = routeDraftToForm({ gateway: "10.0.0.2" }, base);
    expect(merged.gateway).toBe("10.0.0.2");
    expect(merged.comment).toBe("old"); // untouched fields survive the edit
  });
});
