import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { baseApi } from "./http";
import {
  DeviceRequestError,
  DeviceListPolicies,
  DeviceListAddresses,
  DeviceListSchedules,
} from "./policyObject";

// Every DeviceList* helper used to end in `catch { return [] }`, which collapses two very
// different answers into one:
//
//   "this firewall has no policies"        → an empty list is correct
//   "this firewall could not be reached"   → an empty list is a lie
//
// On the Firewall Policy page the second one renders as "No firewall policies", which reads as
// "nothing is being enforced" — the opposite of the truth, on the page where being wrong matters
// most. Strict mode surfaces the failure instead; lenient stays the default so the dozen
// dropdown/picker call sites keep degrading quietly.

// Re-created per test: vi.restoreAllMocks() detaches the spy, so a module-level one would only
// hold for the first case and every later test would hit the network.
let get: MockInstance;

beforeEach(() => {
  get = vi.spyOn(baseApi, "get") as unknown as MockInstance;
});
afterEach(() => vi.restoreAllMocks());

// An axios-shaped rejection.
const httpError = (status?: number, body?: unknown) =>
  Object.assign(new Error("Request failed"), {
    response: status === undefined ? undefined : { status, data: body },
  });

describe("lenient mode (the default — pickers and dropdowns)", () => {
  it("returns an empty list when the device is unreachable", async () => {
    get.mockRejectedValue(httpError());
    await expect(DeviceListPolicies(1)).resolves.toEqual([]);
  });

  it("returns an empty list on a backend error", async () => {
    get.mockRejectedValue(httpError(502, { error: "FortiGate login failed" }));
    await expect(DeviceListAddresses(1)).resolves.toEqual([]);
  });

  it("still returns real data when the call succeeds", async () => {
    get.mockResolvedValue({ data: [{ name: "policy-1" }] });
    await expect(DeviceListPolicies(1)).resolves.toEqual([{ name: "policy-1" }]);
  });
});

describe("strict mode (pages that present the device's configuration)", () => {
  it("throws instead of inventing an empty policy list", async () => {
    get.mockRejectedValue(httpError());
    await expect(DeviceListPolicies(1, { strict: true })).rejects.toBeInstanceOf(DeviceRequestError);
  });

  it("names what failed so the page can say it", async () => {
    get.mockRejectedValue(httpError());
    await expect(DeviceListPolicies(1, { strict: true })).rejects.toThrow(
      /Could not load firewall policies/
    );
  });

  it("surfaces the backend's own message when there is one", async () => {
    get.mockRejectedValue(httpError(502, { error: "FortiGate login failed: timeout" }));
    await expect(DeviceListPolicies(1, { strict: true })).rejects.toThrow(
      /FortiGate login failed: timeout/
    );
  });

  it("falls back to the status code when the body carries no message", async () => {
    get.mockRejectedValue(httpError(500, {}));
    await expect(DeviceListAddresses(1, { strict: true })).rejects.toThrow(/HTTP 500/);
  });

  it("keeps the status for callers that want to branch on it", async () => {
    get.mockRejectedValue(httpError(403, { error: "admin access required" }));
    await DeviceListPolicies(1, { strict: true }).catch((err: DeviceRequestError) => {
      expect(err.status).toBe(403);
    });
    expect.assertions(1);
  });

  // The distinction the whole change rests on: a genuine empty answer is NOT an error.
  it("returns an empty list for a real empty 200", async () => {
    get.mockResolvedValue({ data: [] });
    await expect(DeviceListPolicies(1, { strict: true })).resolves.toEqual([]);
  });

  it("treats a non-array 200 as empty rather than failing", async () => {
    get.mockResolvedValue({ data: null });
    await expect(DeviceListPolicies(1, { strict: true })).resolves.toEqual([]);
  });
});

describe("helpers that map rows keep working in both modes", () => {
  it("maps schedule rows on success", async () => {
    get.mockResolvedValue({
      data: [{ name: "work-hours", type: "recurring", start: "08:00", end: "17:00", day: ["monday"] }],
    });
    const rows = await DeviceListSchedules(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ name: "work-hours", type: "recurring", start: "08:00" });
    expect(rows[0].member).toEqual([]); // defaults filled in
  });

  it("throws in strict mode instead of returning zero schedules", async () => {
    get.mockRejectedValue(httpError());
    await expect(DeviceListSchedules(1, { strict: true })).rejects.toThrow(/Could not load schedules/);
  });

  it("still yields an empty list in lenient mode", async () => {
    get.mockRejectedValue(httpError());
    await expect(DeviceListSchedules(1)).resolves.toEqual([]);
  });
});
