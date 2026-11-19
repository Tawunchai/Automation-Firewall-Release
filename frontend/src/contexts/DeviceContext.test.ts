import { describe, expect, it } from "vitest";
import { isFortiGate, reconcileSelection } from "./DeviceContext.logic";
import type { NetworkDevice } from "../api/device";

// The console has exactly one device selection, so the rule for keeping it valid has to hold in
// every case — including the one that produced a real bug: deleting the device you are currently
// pointed at. The navbar kept offering it, and every device page then queried an id the backend
// answers with 404, which (before the strict-read fix) each page rendered as "this firewall has
// nothing on it". Two wrong behaviours, one root cause.

const dev = (id: number, over: Partial<NetworkDevice> = {}): NetworkDevice => ({
  id,
  name: `FGT-${id}`,
  mgmt_ip: `10.0.0.${id}`,
  port: 22,
  api_port: 443,
  vendor: "fortinet",
  platform: "fortinet",
  status: "active",
  site: "",
  role: "firewall",
  automation_account: "",
  automation_owner: "",
  backup_enabled: false,
  backup_cron: "",
  next_backup_at: null,
  last_backup_at: null,
  ...(over as object),
});

describe("reconcileSelection", () => {
  it("keeps the stored device when it is still in the inventory", () => {
    const list = [dev(1), dev(2), dev(3)];
    expect(reconcileSelection(list, 2)?.id).toBe(2);
  });

  it("returns the FRESH row, not the remembered one", () => {
    // A renamed device, or one that moved active → maintenance, must not keep showing stale facts.
    const list = [dev(1, { name: "renamed-in-inventory", status: "maintenance" })];
    const got = reconcileSelection(list, 1);
    expect(got?.name).toBe("renamed-in-inventory");
    expect(got?.status).toBe("maintenance");
  });

  // ── The bug this file exists for ──────────────────────────────────────────
  it("moves off a device that has been deleted", () => {
    const list = [dev(1), dev(3)];              // device 2 was just deleted
    const got = reconcileSelection(list, 2);
    expect(got).not.toBeNull();
    expect(got!.id).not.toBe(2);                // never keep pointing at a dead id
    expect(list).toContain(got!);
  });

  it("prefers an ACTIVE device when falling back", () => {
    const list = [dev(1, { status: "inactive" }), dev(2, { status: "active" })];
    expect(reconcileSelection(list, 99)?.id).toBe(2);
  });

  it("falls back to the first device when none are active", () => {
    const list = [dev(7, { status: "inactive" }), dev(8, { status: "maintenance" })];
    expect(reconcileSelection(list, 99)?.id).toBe(7);
  });

  it("picks a device on a first run with nothing stored", () => {
    expect(reconcileSelection([dev(4)], null)?.id).toBe(4);
  });

  it("returns null when the inventory is empty", () => {
    // Nothing to point at — the pages must show "no device", not a phantom one.
    expect(reconcileSelection([], 1)).toBeNull();
    expect(reconcileSelection([], null)).toBeNull();
  });

  it("never returns a device outside the list it was given", () => {
    const list = [dev(1), dev(2)];
    for (const wanted of [null, 1, 2, 99]) {
      const got = reconcileSelection(list, wanted);
      expect(got === null || list.includes(got)).toBe(true);
    }
  });
});

describe("isFortiGate", () => {
  it("accepts a device tagged on either vendor or platform", () => {
    expect(isFortiGate(dev(1, { vendor: "Fortinet", platform: "" }))).toBe(true);
    expect(isFortiGate(dev(1, { vendor: "", platform: "fortinet" }))).toBe(true);
  });

  it("rejects other vendors — they have no device-proxy endpoints behind them", () => {
    // Listing one would produce a picker entry whose every page fails.
    expect(isFortiGate(dev(1, { vendor: "cisco", platform: "ios" }))).toBe(false);
  });

  it("tolerates a row with neither field set", () => {
    expect(isFortiGate(dev(1, { vendor: undefined, platform: undefined } as never))).toBe(false);
  });
});
