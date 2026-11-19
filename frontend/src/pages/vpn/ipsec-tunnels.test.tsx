import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkDevice } from "../../api/device";
// From deviceRequest, not policyObject: policyObject is mocked below, and the test needs the REAL
// error class — the one the api layer actually throws — not a stub of it.
import { DeviceRequestError } from "../../api/deviceRequest";

// What this file is for.
//
// VPN ▸ IPsec Tunnels read its list leniently (`DeviceListIPsecTunnels(id)` with no options), so
// api/vpn.ts routed it through `deviceList`'s lenient branch and a 401, a 404 and a 502 all came
// back as `[]`. The page then drew the empty state: "This device has no IPsec tunnel yet" — about
// a firewall nobody managed to read. It imported NoDeviceState, LoadingState and EmptyState and no
// ErrorState, which is why nothing on screen could ever have said otherwise.
//
// On this console that is the dangerous direction of the two: a site-to-site VPN that IS up,
// reported as absent, is what sends someone to build a second one.
//
// So the three things worth pinning are the three halves of the fix: the read is strict, a strict
// read that fails reaches the screen as an ERROR rather than as an empty device, and a device that
// genuinely has nothing still says so.

const selected = vi.hoisted(() => ({ device: null as NetworkDevice | null }));

vi.mock("../../contexts/DeviceContext.logic", () => ({
  useSelectedDevice: () => ({
    device: selected.device,
    setDevice: () => {},
    devices: [],
    loading: false,
    reload: async () => {},
  }),
}));

vi.mock("../../contexts/AuthContext.logic", () => ({
  useAuth: () => ({ user: { role: "admin" } }),
}));

vi.mock("../../contexts/ProviderContext.logic", () => ({
  useStateContext: () => ({ currentColor: "#2563eb", currentMode: "Light" }),
}));

vi.mock("../../components/ui/toast", () => ({
  message: { success: () => {}, error: () => {}, warning: () => {}, info: () => {} },
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => () => {} }));

const api = vi.hoisted(() => ({
  listTunnels: vi.fn(),
  bgp: vi.fn(),
}));

vi.mock("../../api/policyObject", () => ({
  DeviceListIPsecTunnels: (deviceId: number, opts?: { strict?: boolean }) =>
    api.listTunnels(deviceId, opts),
  DeviceGetBGPSummary: (deviceId: number) => api.bgp(deviceId),
  DeviceDeleteIPsecTunnel: async () => ({}),
  DeviceGetTunnelDeletionPreview: async () => null,
}));

import IPsecTunnelsPage from "./ipsec-tunnels";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

const device = { id: 1, name: "fgt-lab" } as NetworkDevice;

const tunnel = (name: string) => ({
  name,
  interface: "wan1",
  ike_version: "2",
  remote_gw: "203.0.113.9",
  up: true,
  ref_count: 0,
  kind: "custom",
  phase2: [],
  comments: "",
});

const noBGP = { configured: false, local_as: "", router_id: "", neighbors: null };

function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;
  act(() => {
    root = createRoot(container);
    root.render(React.createElement(IPsecTunnelsPage));
  });
  return {
    text: () => container.textContent ?? "",
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets the awaited loader promises settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  selected.device = device;
  api.listTunnels.mockReset();
  api.bgp.mockReset();
  api.bgp.mockResolvedValue(noBGP);
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("IPsec Tunnels — an unreadable firewall is not a firewall without tunnels", () => {
  it("reads strictly, so the api layer can reject instead of returning []", async () => {
    api.listTunnels.mockResolvedValue([tunnel("branch-a")]);
    const view = render();
    await flush();

    expect(api.listTunnels).toHaveBeenCalledWith(device.id, { strict: true });
    view.unmount();
  });

  it("renders the error block — not the empty block — when the device cannot be read", async () => {
    // Modelled on the real api layer (deviceList in api/deviceRequest.ts): the SAME failure is a
    // rejection under `{ strict: true }` and an empty array without it. A stub that threw either
    // way would pass against the lenient version too, and so would guard nothing.
    api.listTunnels.mockImplementation(async (_id: number, opts?: { strict?: boolean }) => {
      if (!opts?.strict) return [];
      throw new DeviceRequestError("Could not load IPsec tunnels", {
        response: { status: 502, data: { error: "device unreachable" } },
      });
    });

    const view = render();
    await flush();

    const text = view.text();
    // The whole point: the screen must not claim the firewall has no VPN.
    expect(text).not.toContain("has no IPsec tunnel yet");
    expect(text).toContain("Could not read the IPsec tunnel list from fgt-lab");
    // …and it must say plainly that the list is unreadable rather than short.
    expect(text).toContain("unreadable");
    // The device-proxy's own wording reaches the screen, so a 502 is not indistinguishable from a 403.
    expect(text).toContain("device unreachable");
    view.unmount();
  });

  it("still says empty when the device genuinely answered with nothing", async () => {
    api.listTunnels.mockResolvedValue([]);
    const view = render();
    await flush();

    const text = view.text();
    expect(text).toContain("has no IPsec tunnel yet");
    expect(text).not.toContain("Could not read");
    view.unmount();
  });

  it("shows the tunnels when there are tunnels", async () => {
    api.listTunnels.mockResolvedValue([tunnel("branch-a"), tunnel("branch-b")]);
    const view = render();
    await flush();

    const text = view.text();
    expect(text).toContain("branch-a");
    expect(text).toContain("branch-b");
    expect(text).not.toContain("Could not read");
    expect(text).not.toContain("has no IPsec tunnel yet");
    view.unmount();
  });

  it("shows the no-device block before a firewall has been picked", async () => {
    selected.device = null;
    api.listTunnels.mockResolvedValue([]);
    const view = render();
    await flush();

    expect(api.listTunnels).not.toHaveBeenCalled();
    expect(view.text()).toContain("No device selected");
    view.unmount();
  });

  it("does not let a lenient BGP banner swallow a failed tunnel read", async () => {
    // DeviceGetBGPSummary is lenient on purpose — it answers `configured: false` rather than
    // throwing. It shares the tunnel read so it shares the read ticket, and this pins that riding
    // along cannot mask the strict half: the tunnel failure still wins the view state.
    api.listTunnels.mockRejectedValue(
      new DeviceRequestError("Could not load IPsec tunnels", { response: { status: 401 } }),
    );
    api.bgp.mockResolvedValue({ configured: true, local_as: "65001", router_id: "", neighbors: [] });

    const view = render();
    await flush();

    expect(view.text()).toContain("Could not read the IPsec tunnel list from fgt-lab");
    expect(view.text()).not.toContain("has no IPsec tunnel yet");
    view.unmount();
  });
});
