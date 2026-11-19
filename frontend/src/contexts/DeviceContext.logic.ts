// The device context object, the `useSelectedDevice` hook, and the two pure functions that
// decide what a selection means: isFortiGate and reconcileSelection.
//
// The provider component stays in DeviceContext.tsx. These are here because the app-wide device
// selection is the one piece of state no save should drop.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import { createContext, useContext } from "react";
import { type NetworkDevice } from "../api/device";
import { type DeviceVDOM } from "../api/vdom";

export type DeviceContextValue = {
  /** The firewall every device page reads from. Null until the list has loaded. */
  device: NetworkDevice | null;
  /** Picking a device from anywhere — the navbar picker is the only caller today. */
  setDevice: (device: NetworkDevice | null) => void;
  /** Every FortiGate in the inventory, for the picker. */
  devices: NetworkDevice[];
  /** True while the first fetch is in flight. Pages use it to hold off "no device" messaging. */
  loading: boolean;
  /** Re-reads the inventory — after adding or deleting a device on the Devices page. */
  reload: () => Promise<void>;
  /** The selected virtual domain. Empty means the unit's management domain, as it always did. */
  vdom: string;
  /** Picking a VDOM. Applies to every subsequent device call, not only to the next page. */
  setVDOM: (vdom: string) => void;
  /** Every VDOM on the selected device. Empty until the device's list has loaded. */
  vdoms: DeviceVDOM[];
  /** Whether this unit is in multi-VDOM mode — the one thing the picker's visibility hangs on. */
  vdomSplit: boolean;
};

export const DeviceContext = createContext<DeviceContextValue | null>(null);

export const useSelectedDevice = () => {
  const ctx = useContext(DeviceContext);
  if (!ctx) throw new Error("useSelectedDevice must be used within DeviceProvider");
  return ctx;
};

/**
 * A device this console can drive.
 *
 * The backend's inventory can hold other vendors' rows, but only FortiGates have device-proxy
 * endpoints behind them — so anything else would be a picker entry whose every page fails.
 */
export const isFortiGate = (d: NetworkDevice) =>
  (d.vendor ?? "").toLowerCase().includes("fortinet") ||
  (d.platform ?? "").toLowerCase().includes("fortinet");

/**
 * Which device the console should be pointed at, given the inventory that just arrived and the id
 * it was previously pointed at.
 *
 * Pure, and exported, so the rule can be pinned by a test rather than only exercised through a
 * provider. It runs on EVERY load, not just the first, because the important case is the second
 * one: someone deletes the selected firewall on the Devices page, and if this returned the stale
 * device the navbar would keep offering it while every device page queried a dead id — which,
 * before the strict-read fix, then rendered as "this firewall has nothing on it".
 */
export const reconcileSelection = (
  list: NetworkDevice[],
  wantedId: number | null,
): NetworkDevice | null => {
  const restored = wantedId != null ? list.find((d) => d.id === wantedId) : undefined;
  if (restored) return restored;
  // Nothing stored, or the stored device is gone. Prefer one that is actually up.
  return list.find((d) => d.status === "active") ?? list[0] ?? null;
};
