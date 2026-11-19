import { describe, expect, it } from "vitest";
import { unitIsSplit, defaultVDOM, effectiveVDOM, type DeviceVDOM } from "./vdom";
import { setRequestVDOM, withVDOM } from "./deviceRequest";

// What the VDOM picker is allowed to conclude from the unit's answer.
//
// Every case here has one consequence: sending ?vdom=<wrong> on a write. Reading the wrong tenant
// shows the wrong table; writing to it puts a rule on a firewall nobody was looking at.

const vd = (name: string, over: Partial<DeviceVDOM> = {}): DeviceVDOM => ({
  name,
  management: false,
  multi_vdom: true,
  ...over,
});

describe("unitIsSplit", () => {
  it("is false for a single-VDOM unit, which still answers with one row", () => {
    // The lab FGT80E's exact answer: one row named root, multi_vdom false. Not a choice.
    expect(unitIsSplit([vd("root", { management: true, multi_vdom: false })])).toBe(false);
  });

  it("is true for a split unit", () => {
    expect(unitIsSplit([vd("root", { management: true }), vd("sales")])).toBe(true);
  });

  it("follows multi_vdom, not the row count", () => {
    // A unit switched into multi-VDOM mode before its second tenant exists is still split: which
    // VDOM a write lands in is a real question there, and the flag is the thing that says so.
    expect(unitIsSplit([vd("root", { management: true })])).toBe(true);
  });

  it("is false for a device that answered with nothing", () => {
    // The lenient read returns [] for an unreachable firewall. No picker is the right response —
    // offering an empty one would invite a choice we could not honour.
    expect(unitIsSplit([])).toBe(false);
  });
});

describe("defaultVDOM", () => {
  it("prefers the management VDOM", () => {
    expect(defaultVDOM([vd("sales"), vd("core", { management: true })])).toBe("core");
  });

  it("falls back to the first when none is marked", () => {
    // vdomMode's read of system/global can fail without the VDOM list failing.
    expect(defaultVDOM([vd("sales"), vd("eng")])).toBe("sales");
  });

  it("is empty for no VDOMs, which means the backend default", () => {
    expect(defaultVDOM([])).toBe("");
  });
});

describe("effectiveVDOM", () => {
  it("reports root when nothing is picked", () => {
    // Not the management VDOM: the Go client's default is literally "root" (services.vdomParam),
    // so on a unit managed from elsewhere the tick must sit on root, where the reads are going.
    expect(effectiveVDOM("")).toBe("root");
  });

  it("reports the pick when there is one", () => {
    expect(effectiveVDOM("sales")).toBe("sales");
  });
});

describe("the VDOM list escapes the interceptor that scopes everything else", () => {
  // The trap this pins: /vdoms is a device-proxy URL, so withVDOM would scope it to the selected
  // tenant like any other. Then picking "sales" would make the next read of the VDOM list run
  // inside sales — where system/global, which multi_vdom comes from, is not readable. The picker
  // would empty itself one pick after being used. api/vdom.ts builds the URL with an explicitly
  // empty ?vdom= so this cannot happen.
  it("leaves a URL that already names a vdom alone, including an empty one", () => {
    setRequestVDOM("sales");
    try {
      expect(withVDOM("/policy/device/1/vdoms?vdom=")).toBe("/policy/device/1/vdoms?vdom=");
      // ...while an ordinary device call in the same state IS scoped.
      expect(withVDOM("/policy/device/1/addresses")).toBe("/policy/device/1/addresses?vdom=sales");
    } finally {
      setRequestVDOM("");
    }
  });

  it("scopes nothing while no VDOM is selected, so a single-VDOM unit is untouched", () => {
    expect(withVDOM("/policy/device/1/addresses")).toBe("/policy/device/1/addresses");
  });

  it("never scopes the console's own routes", () => {
    setRequestVDOM("sales");
    try {
      expect(withVDOM("/users")).toBe("/users");
      expect(withVDOM("/notify/rules")).toBe("/notify/rules");
    } finally {
      setRequestVDOM("");
    }
  });
});
