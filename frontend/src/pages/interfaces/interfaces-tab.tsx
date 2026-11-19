import React, { useCallback, useEffect, useState } from "react";
import { FiShare2, FiCheckCircle, FiXCircle, FiTag, FiChevronDown, FiChevronRight } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import {
  DeviceListSystemInterfaces, DeviceGetInfo,
  type SystemInterface,
} from "../../api/policyObject";
import { TYPE_LABELS } from "../../components/ui/form-controls.logic";
import DeviceFaceplate from "../../components/ui/DeviceFaceplate";
import { portState } from "../../components/ui/interfaceStatus";

/** Stable empty list — a `[]` literal would be a new identity each render. */
const EMPTY: SystemInterface[] = [];

// Group display order — mirrors FortiGate's "Group By Type" ordering.
const GROUP_ORDER = [
  "physical", "aggregate", "redundant", "hard-switch", "switch",
  "vlan", "loopback", "tunnel", "emac-vlan", "vxlan",
];

// System-internal interfaces the FortiGate GUI hides from the interface list.
// Confirmed live: the GUI hides the built-in USB "modem" plus the L2TP ("l2t.root")
// and SSL-VPN ("ssl.root") tunnels, but DOES show the NAT46/64 tunnel "naf.root"
// (as "NAT interface") — so it must NOT be hidden here.
const HIDDEN_NAMES = new Set(["modem", "l2t.root", "ssl.root"]);

// Friendly display names for system interfaces the device leaves alias-blank but the
// GUI still labels (e.g. the NAT tunnel shows as "NAT interface").
const SYSTEM_LABELS: Record<string, string> = {
  "naf.root": "NAT interface",
  "ssl.root": "SSL VPN interface",
  "l2t.root": "L2TP interface",
};

const ROLE_BADGE: Record<string, { bg: string }> = {
  wan: { bg: "#0ea5e9" }, lan: { bg: "#10b981" }, dmz: { bg: "#f59e0b" }, undefined: { bg: "#94a3b8" },
};

/** One number, with a tinted medallion, in the strip above the faceplate. */
const StatTile: React.FC<{ icon: React.ReactNode; label: string; value: React.ReactNode; tintColor: string }> = ({
  icon, label, value, tintColor,
}) => (
  <div className="panel panel-body flex items-center gap-3">
    <span className="medallion h-9 w-9 shrink-0 text-[16px]"
      style={{ color: tintColor, background: `color-mix(in srgb, ${tintColor} 14%, transparent)` }}>
      {icon}
    </span>
    <div className="min-w-0">
      <p className="t-label m-0">{label}</p>
      <p className="t-metric tnum m-0 mt-0.5">{value}</p>
    </div>
  </div>
);

// Read-only monitor view — interfaces are displayed live from the device but never
// created, edited, or deleted here.
const InterfacesTab: React.FC<{ toggle?: React.ReactNode }> = ({ toggle }) => {
  const { currentColor } = useStateContext();

  const [model, setModel] = useState("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // strict: an unreadable firewall must not render as "no interfaces" — on a page whose job is to
  // show which ports are up, an empty list reads as "the box has none".
  const load = useCallback(
    (deviceId: number) => DeviceListSystemInterfaces(deviceId, { strict: true }),
    [],
  );
  const {
    data: interfaces, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<SystemInterface[]>(load, EMPTY);

  // The faceplate's model name is decoration; a failure to read it must not fail the page.
  useEffect(() => {
    if (!selectedDevice) { setModel(""); return; }
    DeviceGetInfo(selectedDevice.id)
      .then((info) => setModel(info.model || info.platform || ""))
      .catch(() => setModel(""));
  }, [selectedDevice]);

  // Interfaces that belong to a switch/aggregate — the GUI nests these under their parent
  // rather than listing them again as their own row. Not restricted to physical members: a
  // software switch's members can be a VLAN or a VXLAN interface (confirmed live — FortiOS's own
  // "SS TEST" software switch carries a VLAN and a VXLAN member), and limiting this to
  // `type === "physical"` left exactly that case double-counted — nested as a chip under its
  // parent AND still listed a second time as its own standalone top-level row.
  const memberNames = new Set<string>();
  interfaces.forEach((i) => i.members?.forEach((m) => memberNames.add(m)));

  const visible = interfaces.filter((i) => {
    if (HIDDEN_NAMES.has(i.name)) return false;
    if (memberNames.has(i.name)) return false; // nested under its parent switch/aggregate
    return true;
  });

  const upCount = visible.filter((i) => portState(i) === "up").length;
  const downCount = visible.length - upCount;
  const roleCounts: Record<string, number> = {};
  visible.forEach((i) => { const r = i.role || ""; if (r) roleCounts[r] = (roleCounts[r] ?? 0) + 1; });

  const q = search.toLowerCase();
  const filtered = visible.filter((i) =>
    i.name.toLowerCase().includes(q) ||
    (i.alias || "").toLowerCase().includes(q) ||
    (i.ip || "").toLowerCase().includes(q) ||
    (i.type || "").toLowerCase().includes(q)
  );

  // Group by type in GUI order.
  const grouped: Record<string, SystemInterface[]> = {};
  filtered.forEach((i) => { (grouped[i.type] ??= []).push(i); });
  const groupKeys = Object.keys(grouped).sort((a, b) => {
    const ia = GROUP_ORDER.indexOf(a), ib = GROUP_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });

  // grid: name | type | members | ip | admin access | dhcp ranges | ref | status
  const GRID = "1.3fr 130px 1fr 150px 1.2fr 1.1fr 60px 90px";
  const HEADERS = ["NAME", "TYPE", "MEMBERS", "IP/NETMASK", "ADMINISTRATIVE ACCESS", "DHCP RANGES", "REF", "STATUS"];

  const total = filtered.length;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: search
          and the Interfaces/Zones toggle. The interface/up/down counts it used to badge are not
          lost, just not repeated here — the stat tiles right below already show them. */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search interfaces…"
            className="h-8 rounded-[5px] border hairline surface-card pl-8 pr-3 text-[12px] outline-none w-44"
            onFocus={(e) => { e.currentTarget.style.borderColor = currentColor; }}
            onBlur={(e) => { e.currentTarget.style.borderColor = ""; }} />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3"
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        {toggle}
      </div>

      {viewState(total) === "rows" && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile icon={<FiShare2 size={16} />} label="Interfaces" value={visible.length} tintColor={currentColor} />
          <StatTile icon={<FiCheckCircle size={16} />} label="Up" value={upCount} tintColor="#1e9e6b" />
          <StatTile icon={<FiXCircle size={16} />} label="Down / disabled" value={downCount} tintColor="#757f79" />
          <div className="panel panel-body flex items-center gap-3">
            <span className="medallion h-9 w-9 shrink-0 text-[16px]"
              style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 14%, transparent)` }}>
              <FiTag size={16} />
            </span>
            <div className="min-w-0">
              <p className="t-label m-0">By role</p>
              {Object.keys(roleCounts).length === 0 ? (
                <p className="t-metric tnum m-0 mt-0.5">—</p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-1">
                  {Object.entries(roleCounts).map(([r, n]) => {
                    const bg = (ROLE_BADGE[r] ?? ROLE_BADGE.undefined).bg;
                    return (
                      <span key={r} className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase"
                        style={{ backgroundColor: `${bg}20`, color: bg }}>
                        {r} {n}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Device faceplate — port up/down at a glance (green = link up, grey = down) */}
      {viewState(total) === "rows" && (
        <DeviceFaceplate
          model={model}
          interfaces={interfaces}
          currentColor={currentColor}
        />
      )}

      {/* Table */}
      <div className="panel panel-flush">
        <div className="overflow-x-auto">
          <div style={{ minWidth: 1180 }}>
            {viewState(total) !== "empty" && viewState(total) !== "error" && (
              <div className="grid border-b hairline-2 px-4 py-2.5"
                style={{ gridTemplateColumns: GRID }}>
                {HEADERS.map((h, i) => (
                  <span key={i} className="t-label">{h}</span>
                ))}
              </div>
            )}

            <DeviceStates
              state={viewState(total)}
              from={selectedDevice?.name}
              noun="interface"
              icon={<FiShare2 size={18} />}
              error={error}
              onRetry={() => void fetchAll()}
              filtered={!!search}
            >
              <div style={{ maxHeight: 620, overflowY: "auto" }}>
                {groupKeys.map((gk) => {
                  const isCollapsed = collapsed.has(gk);
                  return (
                  <React.Fragment key={gk}>
                    <button type="button"
                      onClick={() => setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(gk)) next.delete(gk); else next.add(gk);
                        return next;
                      })}
                      className="group-band w-full border-none bg-transparent px-0 py-0 text-left">
                      {isCollapsed ? <FiChevronRight size={12} /> : <FiChevronDown size={12} />}
                      <span>{TYPE_LABELS[gk] || gk}</span>
                      <span className="group-count">{grouped[gk].length}</span>
                    </button>

                    {!isCollapsed && grouped[gk].map((i, idx) => {
                      const roleBadge = ROLE_BADGE[i.role] ?? ROLE_BADGE.undefined;
                      const state = portState(i);
                      return (
                        <div key={i.name}
                          className={`grid items-center px-4 py-3 surface-hover transition-colors ${idx < grouped[gk].length - 1 ? "border-b hairline-2" : ""}`}
                          style={{ gridTemplateColumns: GRID }}>

                          {/* Name + alias + role */}
                          <div className="flex items-center gap-2.5 min-w-0 pr-2">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded"
                              style={{ backgroundColor: `${roleBadge.bg}20`, color: roleBadge.bg }}>
                              <FiShare2 size={12} />
                            </span>
                            <div className="min-w-0">
                              {(() => {
                                const display = i.alias || SYSTEM_LABELS[i.name] || "";
                                return (
                                  <p className="text-[13px] font-semibold ink truncate">
                                    {display || i.name}
                                    {display && <span className="ml-1 text-[10px] font-normal ink-3">({i.name})</span>}
                                  </p>
                                );
                              })()}
                              {i.description && <p className="text-[10px] ink-3 truncate">{i.description}</p>}
                            </div>
                          </div>

                          {/* Type */}
                          <span className="text-[12px] ink-2 truncate pr-2">
                            {TYPE_LABELS[i.type] || i.type}
                          </span>

                          {/* Members */}
                          <div className="min-w-0 pr-2">
                            {i.members?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {i.members.slice(0, 4).map((m) => (
                                  <span key={m} className="rounded surface-sunken px-1.5 py-0.5 text-[10px] font-medium ink-2">{m}</span>
                                ))}
                                {i.members.length > 4 && (
                                  <span className="rounded surface-sunken px-1.5 py-0.5 text-[10px] font-bold ink-3">+{i.members.length - 4}</span>
                                )}
                              </div>
                            ) : <span className="text-[12px] ink-3">—</span>}
                          </div>

                          {/* IP/Netmask */}
                          <span className="font-mono text-[12px] ink-2 truncate pr-2">
                            {i.mode === "dhcp" ? (i.ip || "DHCP") : (i.ip || "—")}
                          </span>

                          {/* Admin access */}
                          <div className="min-w-0 pr-2">
                            {i.allowaccess?.length ? (
                              <div className="flex flex-wrap gap-1">
                                {i.allowaccess.map((a) => (
                                  <span key={a} className="rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase"
                                    style={{ borderColor: `${currentColor}30`, color: currentColor, backgroundColor: `${currentColor}08` }}>{a}</span>
                                ))}
                              </div>
                            ) : <span className="text-[12px] ink-3">—</span>}
                          </div>

                          {/* DHCP ranges */}
                          <div className="min-w-0 pr-2">
                            {i.dhcp_ranges?.length ? (
                              <div className="flex flex-col gap-0.5">
                                {i.dhcp_ranges.map((r) => (
                                  <span key={r} className="font-mono text-[11px] ink-2 truncate">{r}</span>
                                ))}
                              </div>
                            ) : <span className="text-[12px] ink-3">—</span>}
                          </div>

                          {/* Ref — how many other CMDB objects point at this interface */}
                          <span className="text-[12px] ink-2 tnum">
                            {i.ref_count || 0}
                          </span>

                          {/* Status */}
                          <div className="flex items-center gap-1.5">
                            <span className="h-2 w-2 rounded-full shrink-0"
                              style={{ backgroundColor: state === "disabled" ? "#94a3b8" : state === "down" ? "#f59e0b" : "#10b981" }} />
                            <span className="text-[11px] font-medium ink-2">
                              {state === "disabled" ? "Disabled" : state === "down" ? "Down" : "Up"}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                  );
                })}
              </div>
            </DeviceStates>
          </div>
        </div>
      </div>

      {viewState(total) === "rows" && (
        <p className="text-right text-[11px] ink-3">
          {search ? `${total} of ${visible.length}` : visible.length} interface{visible.length !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
};

export default InterfacesTab;
