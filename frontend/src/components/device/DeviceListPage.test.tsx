import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NetworkDevice } from "../../api/device";
import { DeviceRequestError } from "../../api/policyObject";
import { DeviceListPage } from "./DeviceListPage";

// What this file is for.
//
// The four User & Authentication list pages called their fetcher with no options — the LENIENT
// mode, where every failure becomes `[]`. A firewall that could not be reached therefore rendered
// as "This device has no user groups yet": a confident, calm statement that nobody can authenticate
// through a device whose user database we simply failed to read.
//
// The rest of the console had already been moved onto useDeviceData for exactly this reason. These
// pages were the ones it never reached, and nothing about the wrong version looked like a bug —
// which is why it survived a refactor that fixed it everywhere else.
//
// So the two things worth pinning are the two halves of the fix: the read is strict, and a strict
// read that fails reaches the screen as an error rather than as an empty device.

const selected = vi.hoisted(() => ({ device: null as NetworkDevice | null }));
const role = vi.hoisted(() => ({ value: "admin" }));

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
  useAuth: () => ({ user: { role: role.value } }),
}));

vi.mock("../../contexts/ProviderContext.logic", () => ({
  useStateContext: () => ({ currentColor: "#2563eb", currentMode: "Light" }),
}));

vi.mock("../../components/ui/toast", () => ({
  message: { success: () => {}, error: () => {}, info: () => {} },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

type Row = { name: string };

const device = { id: 1, name: "fgt-lab" } as NetworkDevice;

const crud = {
  onCreate: () => {},
  onEdit: () => {},
  onDelete: async () => {},
  describe: (r: Row) => r.name,
  deleteLabel: "DELETE THING",
};

function renderList(fetcher: (deviceId: number, opts?: { strict?: boolean }) => Promise<Row[]>) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let root!: Root;

  act(() => {
    root = createRoot(container);
    root.render(
      React.createElement(DeviceListPage<Row>, {
        title: "Things",
        icon: null,
        noun: "thing",
        hue: { light: "#2a78d6", dark: "#3987e5" },
        fetcher,
        gridCols: "1fr",
        matches: (r: Row, q: string) => r.name.toLowerCase().includes(q),
        columns: [{ key: "name", header: "NAME", render: (r: Row) => r.name }],
        crud,
      }),
    );
  });

  return {
    text: () => container.textContent ?? "",
    unmount: () => act(() => root.unmount()),
  };
}

/** Lets the awaited fetcher promise settle inside act(). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  selected.device = device;
  role.value = "admin";
});

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("DeviceListPage — a read that failed is not an empty device", () => {
  it("reads strictly, so the api layer can reject instead of returning []", async () => {
    const fetcher = vi.fn(async () => [{ name: "guests" }]);
    const view = renderList(fetcher);
    await flush();

    expect(fetcher).toHaveBeenCalledWith(device.id, { strict: true });
    view.unmount();
  });

  it("renders the error block — not the empty block — when the device cannot be read", async () => {
    // Modelled on the real api layer (deviceList in api/policyObject.ts): the SAME failure is a
    // rejection under `{ strict: true }` and an empty array without it. A stub that threw either
    // way would pass against the lenient version too, and guard nothing.
    const fetcher = vi.fn(async (_deviceId: number, opts?: { strict?: boolean }) => {
      if (!opts?.strict) return [] as Row[];
      throw new DeviceRequestError("Could not load things", {
        response: { status: 502, data: { error: "device unreachable" } },
      });
    });
    const view = renderList(fetcher);
    await flush();

    const text = view.text();
    // The whole point: the screen must not claim the firewall has nothing configured.
    expect(text).not.toContain("has no thing yet");
    expect(text).toContain("Could not read the thing list from fgt-lab");
    // And it must say plainly that the list is unreadable rather than short.
    expect(text).toContain("unreadable");
    // The failure detail from the device-proxy reaches the screen, so a 502 is not indistinguishable
    // from a 403.
    expect(text).toContain("device unreachable");
    view.unmount();
  });

  it("still says empty when the device genuinely answered with nothing", async () => {
    const fetcher = vi.fn(async () => []);
    const view = renderList(fetcher);
    await flush();

    const text = view.text();
    expect(text).toContain("has no thing yet");
    expect(text).not.toContain("Could not read");
    view.unmount();
  });

  it("shows rows when there are rows", async () => {
    const fetcher = vi.fn(async () => [{ name: "guests" }, { name: "vpn-users" }]);
    const view = renderList(fetcher);
    await flush();

    const text = view.text();
    expect(text).toContain("guests");
    expect(text).toContain("vpn-users");
    expect(text).not.toContain("Could not read");
    expect(text).not.toContain("has no thing yet");
    view.unmount();
  });

  it("offers no write buttons to a non-admin, rather than offering one that 403s", async () => {
    role.value = "user";
    const fetcher = vi.fn(async () => [{ name: "guests" }]);
    const view = renderList(fetcher);
    await flush();

    const text = view.text();
    expect(text).toContain("guests");
    expect(text).not.toContain("Create new");
    // The button used to be rendered for any signed-in user and answer "Create thing — coming
    // soon", which described neither the permission nor the feature.
    expect(text).not.toContain("coming soon");
    view.unmount();
  });

  it("shows the no-device block before a firewall has been picked", async () => {
    selected.device = null;
    const fetcher = vi.fn(async () => []);
    const view = renderList(fetcher);
    await flush();

    expect(fetcher).not.toHaveBeenCalled();
    expect(view.text()).toContain("No device selected");
    view.unmount();
  });
});
