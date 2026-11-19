import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import IPSForm from "./ips-form";

// The edit form that overwrote what it could not read.
//
// `DeviceGetIPSSensor` — like all seven profile getters — answers `null` for every failure: an
// unreachable firewall, an expired session, a sensor deleted from the CLI a moment ago. The form
// did `if (existing) setForm(existing)` with no else, cleared its spinner, and rendered. What you
// got was a complete IPS Sensor form, headed with the sensor's name, holding blank defaults, with
// Save enabled — and Save issues the update. The sensor on the firewall is then replaced by the
// defaults the form was holding.
//
// That is the list-page bug (see user-auth/UserAuthList.test.tsx) with teeth: it does not just
// misreport the device, it destroys the object it failed to read, and nothing about the screen
// suggests anything went wrong.
//
// ips-form is the stand-in for all eight; they were patched from one script and share the shape.

const routerState = vi.hoisted(() => ({ params: "" , navigated: [] as unknown[] }));

vi.mock("react-router-dom", () => ({
  useNavigate: () => (to: unknown) => { routerState.navigated.push(to); },
  useSearchParams: () => [new URLSearchParams(routerState.params), () => {}],
}));

vi.mock("../../contexts/ProviderContext.logic", () => ({
  useStateContext: () => ({ currentColor: "#2563eb" }),
}));

vi.mock("../../components/ui/toast", () => ({
  message: { success: () => {}, error: () => {}, info: () => {} },
}));

const device = { id: 1, name: "fgt-lab" };

vi.mock("../../api/device", () => ({
  ListDevices: async () => [device],
}));

const sensor = vi.hoisted(() => ({
  get: async (_deviceId: number, _name: string): Promise<unknown> => null,
}));

vi.mock("../../api/inspectionProfiles", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    DeviceGetIPSSensor: (deviceId: number, name: string) => sensor.get(deviceId, name),
    DeviceCreateIPSSensor: async () => {},
    DeviceUpdateIPSSensor: async () => {},
  };
});

vi.mock("../../api/policyObject", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, DeviceGetInfo: async () => ({ hostname: "fgt-lab" }) };
});

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(IPSForm));
  });
  return {
    text: () => container.textContent ?? "",
    html: () => container.innerHTML,
    unmount: () => act(() => root.unmount()),
  };
}

async function flush() {
  await act(async () => {
    for (let i = 0; i < 6; i++) await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  routerState.params = "deviceId=1&name=block-critical";
  routerState.navigated = [];
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("editing an IPS sensor the device would not hand over", () => {
  it("refuses to open the form when the read comes back empty", async () => {
    sensor.get = async () => null;
    const view = render();
    await flush();

    expect(view.text()).toContain("Could not read the IPS sensor");
    expect(view.text()).toContain("fgt-lab");
    // The assertion that matters: no editable form, so there is nothing to press Save on.
    expect(view.html()).not.toContain("<form");
    view.unmount();
  });

  it("refuses to open the form when the read rejects outright", async () => {
    sensor.get = async () => { throw new Error("device unreachable"); };
    const view = render();
    await flush();

    expect(view.text()).toContain("Could not read the IPS sensor");
    expect(view.html()).not.toContain("<form");
    view.unmount();
  });

  it("says why it did not open, in terms of what was at stake", async () => {
    sensor.get = async () => null;
    const view = render();
    await flush();

    expect(view.text()).toContain("would have replaced");
    view.unmount();
  });

  it("opens normally when the device does hand the sensor over", async () => {
    sensor.get = async () => ({ name: "block-critical", comment: "", entries: [] });
    const view = render();
    await flush();

    expect(view.text()).not.toContain("Could not read");
    expect(view.html()).toContain("<form");
    view.unmount();
  });

  it("leaves CREATE alone — there is nothing to read, so nothing to fail", async () => {
    routerState.params = "deviceId=1";
    sensor.get = async () => { throw new Error("should not be called"); };
    const view = render();
    await flush();

    expect(view.text()).not.toContain("Could not read");
    expect(view.html()).toContain("<form");
    view.unmount();
  });
});
