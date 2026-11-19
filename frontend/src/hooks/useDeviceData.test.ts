import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkDevice } from "../api/device";
import { deviceViewState, useDeviceData, type DeviceData } from "./useDeviceData";

// The selected device is the hook's only external input, so it is the one thing stubbed here.
// Standing up the real DeviceProvider would drag in a GET /devices and test the provider instead
// of the hook. `vi.hoisted` because vi.mock is lifted above the imports.
const selected = vi.hoisted(() => ({ device: null as NetworkDevice | null }));

vi.mock("../contexts/DeviceContext.logic", () => ({
  useSelectedDevice: () => ({
    device: selected.device,
    setDevice: () => {},
    devices: [],
    loading: false,
    reload: async () => {},
  }),
}));

// The rule that decides what a device page shows.
//
// This exists because the console got it wrong on seven of eight pages at once, and the wrong
// version looked completely normal on screen: a firewall that could not be read rendered the same
// "there is nothing here" panel as a firewall that genuinely had nothing. On a page whose job is
// to report what a firewall is enforcing, that is the screen stating the opposite of the truth —
// and nothing about it looks like a bug, which is exactly why it survived.
//
// Every list page now routes through `deviceViewState`, so these cases cover all of them.

const state = (o: Partial<Parameters<typeof deviceViewState>[0]>) =>
  deviceViewState({ hasDevice: true, loading: false, error: null, count: 0, ...o });

describe("deviceViewState", () => {
  it("shows the no-device block before anything has been attempted", () => {
    expect(state({ hasDevice: false })).toBe("no-device");
  });

  it("keeps the no-device block even if a stale error is still in state", () => {
    // Switching from a broken device to none must not leave the old failure on screen.
    expect(state({ hasDevice: false, error: "boom", count: 3 })).toBe("no-device");
  });

  it("shows loading while a read is in flight", () => {
    expect(state({ loading: true })).toBe("loading");
  });

  it("shows loading during a retry rather than flashing the previous failure", () => {
    expect(state({ loading: true, error: "previous failure" })).toBe("loading");
  });

  // ── The bug this file exists for ──────────────────────────────────────────
  it("shows the ERROR block when a read failed and returned nothing", () => {
    // The regression: this used to come out as "empty", i.e. "this firewall has no policies".
    expect(state({ error: new Error("502 Bad Gateway"), count: 0 })).toBe("error");
  });

  it("still shows the ERROR block when stale rows are left over from a previous device", () => {
    // Rows plus an error means the rows are not authoritative; the error wins.
    expect(state({ error: "unreachable", count: 12 })).toBe("error");
  });

  it("treats any truthy error the same, whatever its shape", () => {
    for (const err of [new Error("x"), "string failure", { message: "object" }, 500]) {
      expect(state({ error: err, count: 0 })).toBe("error");
    }
  });

  it("only says empty when the device actually answered with nothing", () => {
    expect(state({ error: null, count: 0 })).toBe("empty");
  });

  it("shows rows when there are rows", () => {
    expect(state({ count: 1 })).toBe("rows");
  });

  it("never reports empty while an error is present, for any row count", () => {
    for (let count = 0; count < 5; count++) {
      expect(state({ error: "failed", count })).not.toBe("empty");
    }
  });
});

// ── The stale-response race ───────────────────────────────────────────────────
//
// `deviceViewState` above stops a failed read from being reported as an empty firewall. This block
// covers the other way the same screen can lie: showing one firewall's objects under another
// firewall's name.
//
// Switching devices in the navbar starts a second read while the first is still in flight, and
// they resolve in whatever order the firewall answers — not the order they were sent. Reads on
// these pages take 0.3-1.1s against the lab FGT80E, so a slow first read landing after a fast
// second one is an ordinary interaction. Before the fix the late response simply called setData,
// and the table showed device A's rows with device B selected — with no error, no spinner and
// nothing on screen suggesting anything was wrong.
//
// The rest of the console already guards this way (`let cancelled = false` in the AI wizards and
// the dashboard poll). This hook, which eight device pages share, was the one place that did not.

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const deviceA = { id: 1, name: "fgt-a" } as NetworkDevice;
const deviceB = { id: 2, name: "fgt-b" } as NetworkDevice;

/** Minimal renderHook — the project has no @testing-library/react (see useFetch.test.tsx). */
function renderProbe<T>(load: (deviceId: number) => Promise<T>, fallback: T) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  const current: { value: DeviceData<T> | null } = { value: null };

  function Probe() {
    current.value = useDeviceData(load, fallback);
    return null;
  }

  act(() => {
    root = createRoot(container);
    root.render(React.createElement(Probe));
  });

  return {
    current,
    /** Re-render after changing `selected.device`, the way the navbar picker does. */
    rerender: () => act(() => root.render(React.createElement(Probe))),
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets queued microtasks (the awaited load promise) settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** A loader whose per-device promises are resolved by hand, so arrival order is the test's. */
function controllableLoader() {
  const resolvers = new Map<number, (rows: string[]) => void>();
  const rejecters = new Map<number, (err: unknown) => void>();
  const calls: number[] = [];

  const load = (deviceId: number) => {
    calls.push(deviceId);
    return new Promise<string[]>((resolve, reject) => {
      resolvers.set(deviceId, resolve);
      rejecters.set(deviceId, reject);
    });
  };

  return {
    load,
    calls,
    resolve: (deviceId: number, rows: string[]) => resolvers.get(deviceId)!(rows),
    reject: (deviceId: number, err: unknown) => rejecters.get(deviceId)!(err),
  };
}

describe("useDeviceData — stale responses", () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    selected.device = deviceA;
  });

  afterEach(() => {
    selected.device = null;
    document.body.innerHTML = "";
  });

  it("discards rows from the device that was deselected mid-read", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    // Switch A -> B while A's read is still in flight.
    selected.device = deviceB;
    probe.rerender();
    await flush();

    expect(io.calls, "each device should have been read exactly once").toEqual([1, 2]);

    io.resolve(2, ["B-row"]);
    await flush();
    io.resolve(1, ["A-row"]); // the deselected device answers late
    await flush();

    expect(
      probe.current.value!.data,
      "REGRESSION GUARD: device A's rows overwrote device B's, so the table showed one " +
        "firewall's objects while the navbar named another",
    ).toEqual(["B-row"]);

    probe.unmount();
  });

  it("discards a failure from the device that was deselected mid-read", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    selected.device = deviceB;
    probe.rerender();
    await flush();

    io.resolve(2, ["B-row"]);
    await flush();
    io.reject(1, new Error("502 Bad Gateway")); // A was unreachable — but A is not selected
    await flush();

    expect(
      probe.current.value!.error,
      "an error banner naming a firewall the user is no longer looking at is the same lie",
    ).toBeNull();
    expect(probe.current.value!.data).toEqual(["B-row"]);

    probe.unmount();
  });

  it("keeps the spinner up when a superseded read finishes before the current one", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    selected.device = deviceB;
    probe.rerender();
    await flush();

    io.resolve(1, ["A-row"]); // the OLD read lands first this time
    await flush();

    expect(
      probe.current.value!.loading,
      "the superseded read cleared the spinner, reporting B as loaded while it was still in flight",
    ).toBe(true);
    expect(probe.current.value!.data).toEqual([]);

    io.resolve(2, ["B-row"]);
    await flush();

    expect(probe.current.value!.loading).toBe(false);
    expect(probe.current.value!.data).toEqual(["B-row"]);

    probe.unmount();
  });

  it("still delivers rows on the ordinary path, with no switch involved", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    expect(probe.current.value!.loading).toBe(true);

    io.resolve(1, ["row-1", "row-2"]);
    await flush();

    expect(probe.current.value!.data).toEqual(["row-1", "row-2"]);
    expect(probe.current.value!.error).toBeNull();
    expect(probe.current.value!.loading).toBe(false);
    expect(probe.current.value!.viewState(2)).toBe("rows");

    probe.unmount();
  });

  it("still reports a failure on the ordinary path", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    io.reject(1, new Error("firewall unreachable"));
    await flush();

    expect(probe.current.value!.error).toBe("firewall unreachable");
    expect(probe.current.value!.data).toEqual([]);
    expect(probe.current.value!.loading).toBe(false);
    expect(
      probe.current.value!.viewState(0),
      "a failed read must never fall through to the empty state",
    ).toBe("error");

    probe.unmount();
  });

  it("ignores a read still in flight when the device is deselected entirely", async () => {
    const io = controllableLoader();
    const probe = renderProbe(io.load, [] as string[]);
    await flush();

    selected.device = null; // e.g. the selected firewall was deleted on the Devices page
    probe.rerender();
    await flush();

    expect(probe.current.value!.loading).toBe(false);

    io.resolve(1, ["A-row"]);
    await flush();

    expect(
      probe.current.value!.data,
      "rows arriving after the device was deselected have nothing to belong to",
    ).toEqual([]);

    probe.unmount();
  });
});
