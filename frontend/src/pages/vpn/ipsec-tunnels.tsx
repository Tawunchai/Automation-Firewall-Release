import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiLock, FiPlus, FiTrash2, FiChevronRight, FiGlobe, FiEdit2, FiActivity } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import SearchInput from "../../components/ui/SearchInput";
import MascotDeleteModal from "../../components/ui/MascotDeleteModal";
import { VpnMascot } from "../../components/ui/vpnMascots";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import {
  DeviceListIPsecTunnels, DeviceDeleteIPsecTunnel, DeviceGetBGPSummary, DeviceGetTunnelDeletionPreview,
  type IPsecTunnel, type BGPSummary, type TunnelDeletionPreview,
} from "../../api/policyObject";
import { apiErrorDetail } from "../../api/errorText";

// A tunnel's template badge — inferred by the backend from phase1 (its Kind field).
const KIND_BADGE: Record<string, { label: string; cls: string }> = {
  "hub-and-spoke": { label: "Hub-and-Spoke", cls: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  "remote-access": { label: "Remote Access", cls: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300" },
  "custom":        { label: "Site-to-Site / Custom", cls: "surface-sunken ink-2" },
};

/** What one read of this page yields. See `load` below for why the two reads travel together. */
type TunnelView = { tunnels: IPsecTunnel[]; bgp: BGPSummary | null };

/** Stable fallback — an object literal would be a new identity on every render. */
const EMPTY: TunnelView = { tunnels: [], bgp: null };

const IPsecTunnelsPage: React.FC = () => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const navigate = useNavigate();

  const [expanded, setExpanded] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<IPsecTunnel | null>(null);
  const [deletePreview, setDeletePreview] = useState<TunnelDeletionPreview | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");

  // strict + useDeviceData, like every other device list page.
  //
  // This page was the last one reading leniently, and it was the worst place for it: the tunnel
  // list read with no options, so a 401, a 404 or an unreachable firewall all came back as `[]`
  // and the page drew "This device has no IPsec tunnel yet" — a confident statement that no
  // site-to-site VPN is up, made about a device we never managed to ask. It imported
  // NoDeviceState/LoadingState/EmptyState and no ErrorState at all, so there was no shape for the
  // truth to take even if the failure had been noticed.
  //
  // The hand-rolled loader this replaces also had no read ticket, so switching device A→B could
  // land A's tunnels under B's name — reads take 0.3–1.1s on the lab device and the picker is in
  // the navbar on every page. useDeviceData's readSeq is exactly that ticket.
  //
  // The BGP summary rides along in the same read so it shares that ticket. It is lenient by
  // design (DeviceGetBGPSummary answers `configured: false` rather than throwing — the banner is
  // an extra, and most tunnels have no BGP behind them), so folding it in cannot weaken the
  // tunnel read: only the strict half can reject, and a rejection is what reaches the error state.
  const load = useCallback(async (deviceId: number): Promise<TunnelView> => {
    const [tunnels, bgp] = await Promise.all([
      DeviceListIPsecTunnels(deviceId, { strict: true }),
      DeviceGetBGPSummary(deviceId),
    ]);
    return { tunnels, bgp };
  }, []);

  const {
    data: { tunnels, bgp }, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<TunnelView>(load, EMPTY);

  // Opening the delete dialog fetches the exact object set the delete will remove, so the
  // confirmation lists it rather than describing it generically (item 5).
  const openDelete = (t: IPsecTunnel) => {
    setDeleteTarget(t);
    setDeletePreview(null);
    if (selectedDevice) DeviceGetTunnelDeletionPreview(selectedDevice.id, t.name).then(setDeletePreview);
  };

  // Edit routing (item 1): a Hub-and-Spoke tunnel opens the wizard in its own Edit flow; everything
  // else uses the Custom editor. The wizard reads ?kind to pick the flow.
  const openEdit = (t: IPsecTunnel) => {
    if (!selectedDevice) return;
    navigate(`/admin/ipsec-wizard?deviceId=${selectedDevice.id}&edit=${encodeURIComponent(t.name)}&kind=${t.kind}`);
  };

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      const res = await DeviceDeleteIPsecTunnel(selectedDevice.id, deleteTarget.name);
      // The tunnel is gone either way; a warning means some follow-up object survived (usually
      // because something else references it) — and a leftover is what breaks the next create.
      if (res.warnings?.length) {
        message.warning(`Tunnel "${deleteTarget.name}" deleted, but: ${res.warnings.join("; ")}`, 8);
      } else {
        message.success(`Tunnel "${deleteTarget.name}" deleted`);
      }
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to delete tunnel"));
    } finally { setDeleting(false); }
  };

  const q = search.toLowerCase();
  const filtered = tunnels.filter((t) =>
    t.name.toLowerCase().includes(q) || (t.interface || "").toLowerCase().includes(q) || (t.remote_gw || "").toLowerCase().includes(q)
  );

  const GRID = "1.4fr 1fr 130px 90px 70px";
  const HEADERS = ["TUNNEL", "INTERFACE BINDING", "STATUS", "REF.", ""];
  const total = filtered.length;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: search
          and "Create New". The tunnel count it used to badge isn't lost, just not repeated here —
          the table and the footer row below it already show it. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search tunnels…" width="w-52" />
        {isAdmin && selectedDevice && (
          <button onClick={() => navigate(`/admin/ipsec-wizard?deviceId=${selectedDevice.id}`)}
            className="btn btn-accent btn-sm">
            <FiPlus size={13} /> Create New
          </button>
        )}
      </div>

      {/* BGP health (item 2) — shown when a Hub-and-Spoke VPN has stood up a BGP process. Each
          spoke is a BGP neighbor; "Established" means the overlay is actually routing, not just built. */}
      {selectedDevice && bgp?.configured && (
        <div className="rounded-sm border border-violet-200 bg-violet-50/60 px-4 py-3 dark:border-violet-500/25 dark:bg-violet-500/8">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-violet-600 dark:text-violet-300">
              <FiActivity size={12} /> BGP
            </span>
            <span className="text-[12px] ink-2">Local AS <b>{bgp.local_as}</b></span>
            {bgp.router_id && <span className="text-[11px] ink-3">router-id {bgp.router_id}</span>}
            <span className="text-[11px] ink-3">
              {(bgp.neighbors?.filter((n) => n.up).length ?? 0)}/{bgp.neighbors?.length ?? 0} peers established
            </span>
          </div>
          {!!bgp.neighbors?.length && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {bgp.neighbors.map((n) => (
                <span key={n.ip} title={`AS ${n.remote_as || "?"} · ${n.state}`}
                  className={`chip font-mono ${n.up ? "chip-ok" : ""}`}>
                  <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: n.up ? "#10b981" : "#f59e0b" }} />
                  {n.ip} <span className="opacity-70">{n.state}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel panel-flush">
        {viewState(total) !== "empty" && viewState(total) !== "error" && (
          <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: GRID }}>
            {HEADERS.map((h, i) => <span key={i} className="t-label">{h}</span>)}
          </div>
        )}

        <DeviceStates
          state={viewState(total)}
          from={selectedDevice?.name}
          noun="IPsec tunnel"
          icon={<FiLock size={18} />}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
          emptyAction={isAdmin && selectedDevice ? (
            <button type="button" className="btn btn-accent btn-sm mt-1"
              onClick={() => navigate(`/admin/ipsec-wizard?deviceId=${selectedDevice.id}`)}>
              <FiPlus size={13} /> Create the first tunnel
            </button>
          ) : undefined}
        >
          <div style={{ maxHeight: 620, overflowY: "auto" }}>
            {filtered.map((t, idx) => {
              const open = expanded === t.name;
              return (
                <React.Fragment key={t.name}>
                  <div className={`grid items-center px-4 py-3 surface-hover transition-colors ${idx < filtered.length - 1 && !open ? "border-b hairline-2" : ""}`}
                    style={{ gridTemplateColumns: GRID }}>
                    <button type="button" onClick={() => setExpanded(open ? null : t.name)} className="flex items-center gap-2.5 min-w-0 pr-2 text-left">
                      <FiChevronRight size={13} className={`shrink-0 ink-3 transition-transform ${open ? "rotate-90" : ""}`} />
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded" style={{ backgroundColor: `${currentColor}15`, color: currentColor }}>
                        <FiLock size={12} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="truncate text-[13px] font-semibold ink">{t.name}</p>
                          {KIND_BADGE[t.kind] && (
                            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${KIND_BADGE[t.kind].cls}`}>
                              {KIND_BADGE[t.kind].label}
                            </span>
                          )}
                        </div>
                        <p className="truncate text-[10px] ink-3">IKEv{t.ike_version} · {t.remote_gw || "dial-up"} · {t.phase2.length} selector{t.phase2.length !== 1 ? "s" : ""}</p>
                      </div>
                    </button>
                    <span className="truncate text-[12px] ink-2 pr-2">{t.interface || "—"}</span>
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: t.up ? "#10b981" : "#94a3b8" }} />
                      <span className="text-[11px] font-medium ink-2">{t.up ? "Up" : "Down"}</span>
                    </div>
                    <span className={`text-[12px] font-semibold ${t.ref_count > 0 ? "text-blue-600 dark:text-blue-400" : "ink-3"}`}>{t.ref_count}</span>
                    <div className="flex items-center justify-end gap-1">
                      {isAdmin && selectedDevice && (
                        <button title="Edit tunnel" onClick={() => openEdit(t)}
                          className="btn-icon">
                          <FiEdit2 size={13} />
                        </button>
                      )}
                      {isAdmin && (
                        <button title="Delete tunnel" onClick={() => openDelete(t)} className="btn-icon btn-icon--danger">
                          <FiTrash2 size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                  {open && (
                    <div className={`surface-sunken px-4 py-3 ${idx < filtered.length - 1 ? "border-b hairline-2" : ""}`}>
                      <p className="mb-2 pl-7 text-[10px] font-bold uppercase tracking-widest ink-3">Phase 2 Selectors</p>
                      {t.phase2.length === 0 ? (
                        <p className="pl-7 text-[12px] ink-3">No selectors configured.</p>
                      ) : (
                        <div className="space-y-1 pl-7">
                          {t.phase2.map((p) => (
                            <div key={p.name} className="flex items-center gap-2 text-[12px]">
                              <span className="font-semibold ink-2">{p.name}</span>
                              <span className="flex items-center gap-1 font-mono ink-2"><FiGlobe size={11} /> {p.src_subnet || "any"}</span>
                              <FiChevronRight size={11} className="ink-3" />
                              <span className="font-mono ink-2">{p.dst_subnet || "any"}</span>
                            </div>
                          ))}
                        </div>
                      )}
                      {t.comments && <p className="mt-2 pl-7 text-[11px] ink-3">{t.comments}</p>}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </DeviceStates>
      </div>

      {viewState(total) === "rows" && (
        <p className="text-right text-[11px] ink-3">{search ? `${total} of ${tunnels.length}` : tunnels.length} tunnel{tunnels.length !== 1 ? "s" : ""}</p>
      )}

      {deleteTarget && (
        <MascotDeleteModal
          mascot={<VpnMascot className="h-24 w-24" title="Delete IPsec tunnel" />}
          name={deleteTarget.name}
          description={<>Everything created with this tunnel will be permanently removed from {selectedDevice?.name}.</>}
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          {/* The exact object set the delete will remove — fetched live so the user sees the real
              policies/routes/addresses/BGP rows, not a generic sentence. The backend removes the
              WHOLE set: a leftover is what breaks the next create with -5/-34. */}
          {deletePreview === null ? (
            <p className="m-0 text-[11px] ink-3">Computing impact…</p>
          ) : (
                <div className="mt-2 space-y-1.5 rounded-[4px] border hairline-2 surface-sunken px-3 py-2.5 text-[11px]">
                  {([
                    ["Phase 2 selectors", deletePreview.phase2],
                    ["Firewall policies", deletePreview.policies],
                    ["Routes", deletePreview.routes],
                    ["Address objects", deletePreview.addresses],
                    ["BGP", deletePreview.bgp],
                  ] as [string, string[] | null][]).filter(([, v]) => v && v.length).map(([label, v]) => (
                    <div key={label} className="flex gap-2">
                      <span className="w-28 shrink-0 font-semibold ink-2">{label}</span>
                      <span className="min-w-0 flex-1 font-mono ink-2 wrap-break-word">{v!.join(", ")}</span>
                    </div>
                  ))}
                  {deletePreview.l2tp_server && (
                    <div className="flex gap-2">
                      <span className="w-28 shrink-0 font-semibold ink-2">L2TP server</span>
                      <span className="ink-2">disabled (last Native VPN)</span>
                    </div>
                  )}
                  {![deletePreview.phase2, deletePreview.policies, deletePreview.routes, deletePreview.addresses, deletePreview.bgp].some((v) => v && v.length) && !deletePreview.l2tp_server && (
                    <p className="ink-3">Just the tunnel (phase1/phase2) — no dependent objects found.</p>
                  )}
                </div>
              )}
          {deleteTarget.ref_count > 0 && (
            <p className="mt-1.5 mb-0 text-[11px] text-amber-600 dark:text-amber-400">
              ⚠ Referenced by {deleteTarget.ref_count} object(s). Policies on this tunnel are removed
              automatically; anything else still pointing at it will be reported and left in place.
            </p>
          )}
        </MascotDeleteModal>
      )}
    </div>
  );
};

export default IPsecTunnelsPage;
