import { afterEach, describe, expect, it, vi } from "vitest";

import type { DeviceReadOpts } from "./deviceRequest";

// The strict/lenient contract of the device read helper.
//
// `deviceList` is where the "unreadable firewall looks empty" bug lived: in lenient mode it turns
// EVERY failure — a 404 for a deleted device, a 502 for an unreachable one, a 401 — into `[]`, and
// the caller cannot tell that apart from a device that genuinely has no objects. Seven list pages
// used the lenient mode and rendered the result as "there is nothing here".
//
// Lenient mode is still right in places (a picker's option list, a best-effort count), so it stays.
// What these tests pin is that the two modes really are different, and that strict mode surfaces
// enough to say WHAT failed.

// baseApi is the axios instance the helper calls; stub it before importing the module under test.
const get = vi.fn();
vi.mock("./http", () => ({ baseApi: { get: (...a: unknown[]) => get(...a) } }));

/**
 * A device list function, as this test can describe one.
 *
 * It calls each of the twelve by NAME off the module object, so the exact signature is not known
 * at the call site — but "callable, takes a device id, takes read options, returns a promise" is,
 * and that is the part the assertion depends on. It was `any`, which also switched off checking
 * of the `await expect(...)` around it.
 */
type DeviceListFn = (...args: [number, DeviceReadOpts] | [number, string, DeviceReadOpts]) => Promise<unknown>;

const load = async () => await import("./policyObject");

afterEach(() => { get.mockReset(); });

describe("device list reads", () => {
  it("returns the rows on success in both modes", async () => {
    const { DeviceListAddresses } = await load();
    get.mockResolvedValue({ data: [{ name: "LAN" }] });

    expect(await DeviceListAddresses(1)).toHaveLength(1);
    expect(await DeviceListAddresses(1, { strict: true })).toHaveLength(1);
  });

  it("lenient mode swallows a failure and reports an empty list", async () => {
    // Documenting the behaviour, not endorsing it — this is precisely why list PAGES must not
    // use it.
    const { DeviceListAddresses } = await load();
    get.mockRejectedValue(Object.assign(new Error("Request failed"), { response: { status: 502 } }));

    await expect(DeviceListAddresses(1)).resolves.toEqual([]);
  });

  it("strict mode rejects instead, so the caller can tell 'unreadable' from 'empty'", async () => {
    const { DeviceListAddresses, DeviceRequestError } = await load();
    get.mockRejectedValue(Object.assign(new Error("Request failed"), { response: { status: 502 } }));

    await expect(DeviceListAddresses(1, { strict: true })).rejects.toBeInstanceOf(DeviceRequestError);
  });

  it("strict mode carries a message naming what could not be read", async () => {
    // The message goes straight onto the page's error panel, so it has to say something useful.
    const { DeviceListAddresses } = await load();
    get.mockRejectedValue(new Error("boom"));

    await expect(DeviceListAddresses(1, { strict: true })).rejects.toThrow(/address/i);
  });

  it("strict mode preserves the HTTP status — a deleted device (404) is not an unreachable one (502)", async () => {
    const { DeviceListAddresses } = await load();
    get.mockRejectedValue(Object.assign(new Error("nope"), { response: { status: 404 } }));

    await DeviceListAddresses(1, { strict: true }).catch((e) => {
      expect(e.status).toBe(404);
    });
    expect.assertions(1);
  });

  it("a 200 carrying a non-array is a real 'nothing here' in both modes", async () => {
    // FortiOS answers some empty collections with an object rather than an array. That IS the
    // device answering, so it must NOT be reported as a failure.
    const { DeviceListAddresses } = await load();
    get.mockResolvedValue({ data: {} });

    await expect(DeviceListAddresses(1)).resolves.toEqual([]);
    await expect(DeviceListAddresses(1, { strict: true })).resolves.toEqual([]);
  });

  it("every list a page renders supports strict mode", async () => {
    // A list without `strict` cannot be shown safely, because its page has no way to tell a
    // failure from an empty device. New list endpoints must keep this true.
    const api = await load();
    const pageLists = [
      "DeviceListAddresses", "DeviceListServices", "DeviceListSchedules", "DeviceListVirtualIPs",
      "DeviceListSystemInterfaces", "DeviceListStaticRoutes", "DeviceListSecurityProfiles",
      "DeviceListIPsecTunnels", "DeviceListUsers", "DeviceListUserGroups",
      "DeviceListLDAPServers", "DeviceListRADIUSServers",
    ] as const;

    for (const name of pageLists) {
      const fn = (api as Record<string, unknown>)[name];
      expect(fn, `${name} is missing`).toBeTypeOf("function");
      get.mockRejectedValue(new Error("device unreachable"));
      // Security profiles take a category between the id and the options.
      const call = name === "DeviceListSecurityProfiles"
        ? (fn as DeviceListFn)(1, "antivirus", { strict: true })
        : (fn as DeviceListFn)(1, { strict: true });
      await expect(call, `${name} ignores { strict: true }`).rejects.toThrow();
    }
  });
});
