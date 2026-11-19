import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ListDevices, type NetworkDevice } from "../api/device";
import { setRequestVDOM } from "../api/deviceRequest";
import { DeviceListVDOMs, unitIsSplit, type DeviceVDOM } from "../api/vdom";
import { DeviceContext, isFortiGate, reconcileSelection } from "./DeviceContext.logic";

// Which FortiGate the console is pointed at.
//
// This is app-wide state, and it is the only copy. It used to be per-page: each of the ~18 device
// pages held its own `useState<NetworkDevice|null>` and rendered its own picker, which meant
// walking Firewall Policy → Addresses → Web Filter asked you to choose the same firewall three
// times, and nothing stopped the three answers from differing. On a console that writes to live
// firewalls, "which device am I about to change?" is exactly the thing that must not be ambiguous,
// so the selection was lifted here and the picker moved to the navbar, where it is visible from
// every page at once.
//
// The provider owns three things the pages no longer have to:
//
//   · THE LIST — fetched once for the session instead of once per page mount. Every page that
//     showed a picker used to issue its own GET /devices.
//   · THE CHOICE — restored from localStorage, so a reload lands you on the firewall you were
//     working on rather than resetting to the first one in the list.
//   · THE FALLBACK — if nothing is stored, or the stored device has since been deleted, the first
//     active FortiGate is selected, so a page is never stuck behind an empty picker.

/** localStorage key for the selected device id. Namespaced so it cannot collide with app prefs. */
const STORAGE_KEY = "console.selectedDeviceId";

const readStoredId = (): number | null => {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const id = Number(raw);
    return Number.isFinite(id) && id > 0 ? id : null;
  } catch {
    // Private mode / storage disabled. A missing preference is not an error.
    return null;
  }
};

const writeStoredId = (id: number | null) => {
  try {
    if (id == null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, String(id));
  } catch { /* see readStoredId */ }
};

// ── The virtual domain, stored per device ────────────────────────────────────
//
// Keyed by device id rather than kept as one value, because a VDOM name only means something on
// the firewall it came from: "sales" on one unit and "sales" on another are unrelated tenants, and
// a shared key would carry a choice made on one firewall onto the next one you select.

const VDOM_KEY = (deviceId: number) => `console.selectedVDOM.${deviceId}`;

const readStoredVDOM = (deviceId: number | null): string => {
  if (deviceId == null) return "";
  try {
    return window.localStorage.getItem(VDOM_KEY(deviceId)) ?? "";
  } catch {
    return "";
  }
};

const writeStoredVDOM = (deviceId: number | null, vdom: string) => {
  if (deviceId == null) return;
  try {
    if (!vdom) window.localStorage.removeItem(VDOM_KEY(deviceId));
    else window.localStorage.setItem(VDOM_KEY(deviceId), vdom);
  } catch { /* see readStoredId */ }
};

export const DeviceProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [device, setDeviceState] = useState<NetworkDevice | null>(null);
  const [loading, setLoading] = useState(true);

  // The selection survives a reload, so the restore has to run against a list that arrives later.
  // Holding the wanted id in a ref rather than state keeps `load` out of a render loop.
  const wantedIdRef = useRef<number | null>(readStoredId());

  const [vdoms, setVDOMs] = useState<DeviceVDOM[]>([]);

  // The selected VDOM is applied to the api layer DURING THE FIRST RENDER, before any child has
  // mounted and therefore before any page has issued a request. That is deliberate and it is the
  // reason this is a useState initialiser rather than an effect.
  //
  // An effect runs after the first paint, so on a reload every page's opening read would go to the
  // management VDOM while the navbar already named a different one — the console showing one
  // tenant's policy table under another tenant's name, which is precisely the failure the whole
  // VDOM thread exists to prevent. Restoring a stale name for a unit that has since left
  // multi-VDOM mode is the lesser risk, and the effect below corrects it as soon as the unit
  // answers.
  const [vdom, setVDOMState] = useState<string>(() => {
    const restored = readStoredVDOM(wantedIdRef.current);
    setRequestVDOM(restored);
    return restored;
  });

  // `vdom` as a ref, so the loader below can check the current choice without listing it as a
  // dependency — which would re-read the unit's VDOM list every time somebody picked one.
  const vdomRef = useRef(vdom);

  const setVDOM = useCallback((next: string) => {
    setRequestVDOM(next);   // first: every call made after this line is scoped to `next`
    vdomRef.current = next;
    setVDOMState(next);
    writeStoredVDOM(wantedIdRef.current, next);
  }, []);

  // Point the VDOM at a device's own stored choice. Called whenever the selected device changes,
  // including the reconcile inside `load` — a VDOM from the previous firewall must never survive
  // into calls aimed at the next one, and it must not be written to the new device's storage key
  // either, which is why this reads rather than calling setVDOM.
  const applyVDOMFor = useCallback((deviceId: number | null) => {
    const restored = readStoredVDOM(deviceId);
    setRequestVDOM(restored);
    vdomRef.current = restored;
    setVDOMState(restored);
    setVDOMs([]);           // the old unit's VDOMs are not this one's
  }, []);

  const setDevice = useCallback((next: NetworkDevice | null) => {
    const changed = (next?.id ?? null) !== wantedIdRef.current;
    setDeviceState(next);
    wantedIdRef.current = next?.id ?? null;
    writeStoredId(next?.id ?? null);
    if (changed) applyVDOMFor(next?.id ?? null);
  }, [applyVDOMFor]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = (await ListDevices()).filter(isFortiGate);
      setDevices(list);

      // Reconcile the selection against the list that just arrived. This runs on every reload, not
      // only the first: a device that was renamed, or that moved from active to maintenance, has
      // to be replaced by its fresh row or the navbar keeps showing stale facts about it.
      const next = reconcileSelection(list, wantedIdRef.current);
      if (next?.id !== wantedIdRef.current) {
        wantedIdRef.current = next?.id ?? null;
        writeStoredId(next?.id ?? null);
        // The VDOM restored at startup belonged to the device that was stored, and reconcile has
        // just landed on a different one.
        applyVDOMFor(next?.id ?? null);
      }
      setDeviceState(next);
    } catch {
      // A transient failure to list devices is not a reason to yank the current selection out from
      // under the page that is using it — leave `device` alone and only empty the picker's list.
      setDevices([]);
    } finally {
      setLoading(false);
    }
  }, [applyVDOMFor]);

  // Which VDOMs the selected unit has, and whether it is split at all.
  //
  // Keyed on the device id alone: re-reading this when the *selection within* the unit changes
  // would be a request per pick, answering a question whose answer cannot have changed.
  useEffect(() => {
    if (!device) {
      setVDOMs([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const list = await DeviceListVDOMs(device.id);
      if (cancelled) return;
      setVDOMs(list);

      // Correct a restored choice the unit does not back up. Both cases are real: a unit taken
      // back out of multi-VDOM mode, and a VDOM deleted on the device since it was last picked.
      // Leaving either in place would send ?vdom=<gone> on every call from here on.
      const stale =
        vdomRef.current !== "" &&
        (!unitIsSplit(list) || !list.some((v) => v.name === vdomRef.current));
      if (stale) setVDOM("");
    })();
    return () => { cancelled = true; };
  }, [device?.id, device, setVDOM]);

  useEffect(() => { void load(); }, [load]);

  const value = useMemo(
    () => ({
      device, setDevice, devices, loading, reload: load,
      vdom, setVDOM, vdoms, vdomSplit: unitIsSplit(vdoms),
    }),
    [device, setDevice, devices, loading, load, vdom, setVDOM, vdoms],
  );

  return <DeviceContext.Provider value={value}>{children}</DeviceContext.Provider>;
};
