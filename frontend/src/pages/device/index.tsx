import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiPlus, FiEdit2, FiTrash2, FiDownloadCloud, FiRefreshCw, FiClock,
  FiEye, FiDownload, FiExternalLink, FiRotateCcw, FiCpu, FiWifi,
  FiHardDrive, FiChevronLeft, FiChevronRight, FiAlertTriangle,
  FiCheckCircle, FiXCircle, FiX,
} from "react-icons/fi";
import DeviceMascot from "../../components/ui/DeviceMascot";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { message } from "../../components/ui/toast";
import Modal from "../../components/ui/Modal";
import {
  DeleteDevice, PingDevice,
  type NetworkDevice, type ConfigBackup, type ReachabilityResult,
} from "../../api/device";
import { DiagnoseJob, type DiagnosisResult } from "../../api/ai";
import DiffViewImport from "../../components/ui/DiffView";
import RestoreConfirmModal from "./RestoreConfirmModal";
import DeviceFormDrawer from "./DeviceFormDrawer";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { formatDate, formatDateTime } from "../../lib/datetime";
import SearchInput from "../../components/ui/SearchInput";
import fortinetDevicePicture from "../../assets/fortinet-device-picture.jpg";
import { useDeviceJobs } from "./useDeviceJobs";
import { useBackupHistory, VIEWER_MAX_LINES } from "./useBackupHistory";
import { apiErrorDetail } from "../../api/errorText";

// STATUS_COLOR kept for potential antd Tag usage in modals
// const STATUS_COLOR: Record<string, string> = {
//   active: "green", inactive: "default", maintenance: "orange",
// };
/** Job status → the chip class that says the same thing. Replaces antd Tag's colour names. */
const JOB_CHIP: Record<string, string> = {
  QUEUED: "", RUNNING: "chip-info", SUCCESS: "chip-ok", FAILED: "chip-danger",
};
/** Diagnosis severity → chip class. Replaces antd Tag's colour names. */
const SEVERITY_CHIP: Record<string, string> = {
  low: "chip-ok", medium: "chip-warn", high: "chip-danger",
};

const Index: React.FC = () => {
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const { currentColor } = useStateContext();

  // The inventory and its backup jobs, and the history drawer, each live in their own hook.
  const {
    devices, loading, fetchDevices,
    jobByDevice, backup,
    workerHealth, checkWorkerHealth,
    batchLoading, batchBackup,
    resetting, resetAndRetry,
  } = useDeviceJobs();
  const {
    drawerDevice, setDrawerDevice, drawerJobs, drawerBackups, openHistory,
    viewer, setViewer, viewerLoading, viewerPreview, viewBackup, downloadBackup, deleteBackup,
    compareA, compareB, compareOpen, setCompareOpen, compareLoadingA, compareLoadingB,
    compareContentA, compareContentB, compareDiff, openCompare,
  } = useBackupHistory();

  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const [diagnoseLoading, setDiagnoseLoading] = useState<number | null>(null);
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnosisResult | null>(null);

  const [pingResult, setPingResult] = useState<Record<number, ReachabilityResult | "loading">>({});
  const [pingModalDevice, setPingModalDevice] = useState<NetworkDevice | null>(null);
  // The device whose deletion is being confirmed, and whether the delete is in flight.
  const [deleteTarget, setDeleteTarget] = useState<NetworkDevice | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formDevice, setFormDevice] = useState<NetworkDevice | null>(null);
  const openAdd = () => { setFormDevice(null); setFormOpen(true); };
  const openEdit = (d: NetworkDevice) => { setFormDevice(d); setFormOpen(true); };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      setDeleteError("");
      await DeleteDevice(deleteTarget.id);
      message.success("Device deleted");
      setDeleteTarget(null);
      fetchDevices();
    } catch {
      setDeleteError("Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const diagnoseJob = async (jobId: number) => {
    setDiagnoseLoading(jobId);
    try {
      const res = await DiagnoseJob(jobId);
      setDiagnoseResult(res);
      setDiagnoseOpen(true);
    } catch (e) {
      message.error(apiErrorDetail(e, "AI assistant call failed"));
    } finally {
      setDiagnoseLoading(null);
    }
  };

  const pingDevice = async (d: NetworkDevice) => {
    setPingResult((m) => ({ ...m, [d.id]: "loading" }));
    try {
      const res = await PingDevice(d.id);
      setPingResult((m) => ({ ...m, [d.id]: res }));
      if (!res.reachable) message.warning(`${d.name} unreachable (${d.mgmt_ip}:${d.port})`);
    } catch {
      setPingResult((m) => { const n = { ...m }; delete n[d.id]; return n; });
      message.error("Reachability check failed");
    }
  };

  const showPingModal = (d: NetworkDevice) => { setPingModalDevice(d); pingDevice(d); };

  // Restoring a configuration reboots the firewall and replaces everything on it. The preview,
  // the confirm and the POST all live in RestoreConfirmModal — this page only names the target.
  const [restoreTarget, setRestoreTarget] = useState<ConfigBackup | null>(null);

  const accentGradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 65%, #a855f7))`;

  // ── Toolbar filters ───────────────────────────────────────────────────────────
  const [statusFilter, setStatusFilter] = useState("All Statuses");
  const [siteFilter, setSiteFilter] = useState("All Sites");
  const [search, setSearch] = useState("");
  const sites = useMemo(
    () => Array.from(new Set(devices.map((d) => d.site).filter((s): s is string => !!s))).sort(),
    [devices],
  );
  const filteredDevices = useMemo(() => {
    const q = search.trim().toLowerCase();
    return devices.filter((d) =>
      (statusFilter === "All Statuses" || d.status === statusFilter.toLowerCase()) &&
      (siteFilter === "All Sites" || d.site === siteFilter) &&
      (!q || d.name.toLowerCase().includes(q) || d.mgmt_ip.toLowerCase().includes(q)));
  }, [devices, statusFilter, siteFilter, search]);

  // ── Pagination ──────────────────────────────────────────────────────────────
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [statusFilter, siteFilter, search, pageSize]);
  const totalPages = Math.ceil(filteredDevices.length / pageSize);
  const pagedDevices = filteredDevices.slice((page - 1) * pageSize, page * pageSize);

  // ── Status colors ──────────────────────────────────────────────────────────
  // QUEUED has no shared semantic token — it is not an allow/warn/deny/info state, just "nothing
  // happening yet" — so it stays its own literal. The other three duplicate meanings the design
  // tokens already carry app-wide, so they now read from the same source as everywhere else.
  const jobColors: Record<string, string> = {
    QUEUED: "#94a3b8", RUNNING: "var(--flow-info)", SUCCESS: "var(--flow-allow)", FAILED: "var(--flow-deny)",
  };

  return (
    <div className="space-y-4">
      {/* ── Worker Health Banner — the offline warning only; a healthy worker needs no banner
          of its own, the same way the reference never announces "all systems normal". ── */}
      {workerHealth !== null && !workerHealth.online && (
        <div className="flex items-start gap-3 rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 dark:border-red-500/20 dark:bg-red-500/8">
          <FiAlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-red-700 dark:text-red-400">
              Automation Worker is offline — backup cannot run
            </p>
            <p className="text-[11px] text-red-500/80 dark:text-red-400/70 mt-0.5">
              Start the Python worker: <span className="font-mono bg-red-100 dark:bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">cd worker && python worker.py</span>
              {" · "}
              Ensure <span className="font-mono bg-red-100 dark:bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">REDIS_URL</span> and <span className="font-mono bg-red-100 dark:bg-red-500/10 px-1.5 py-0.5 rounded text-[10px]">BACKEND_URL</span> env vars are set correctly.
            </p>
          </div>
          <button onClick={checkWorkerHealth}
            className="shrink-0 rounded-[4px] border border-red-200 surface-card px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 transition dark:border-red-500/30 dark:text-red-400">
            Recheck
          </button>
        </div>
      )}

      {/* ── Devices card — a direct port of Dastone's own list-page shape (see e.g. its
          Ecommerce ▸ Products table): title + actions, then entries-per-page + search, then
          the table itself, all one continuous bordered surface rather than three stacked
          cards. `.shell-table` is this console's own hand-written table material — several
          lists here do things AntD's Table cannot, so the styling lives in index.css instead
          of a component theme. ── */}
      <div className="shell-card p-0! overflow-hidden">
        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <h2 className="m-0 text-[16px] font-semibold ink">Devices</h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={fetchDevices}
              disabled={loading}
              className="btn btn-ghost btn-sm"
            >
              <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
            <button
              type="button"
              onClick={batchBackup}
              disabled={batchLoading}
              className="btn btn-ghost btn-sm"
            >
              <FiDownloadCloud size={13} className={batchLoading ? "animate-spin" : ""} /> Backup All
            </button>
            {isAdmin && (
              <button type="button" onClick={openAdd} className="btn btn-accent btn-sm">
                <FiPlus size={13} /> Add Device
              </button>
            )}
          </div>
        </div>

        <div
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
          style={{ borderBottom: "1px solid var(--shell-border)" }}
        >
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex items-center gap-1.5 text-[12px] ink-2">
              <MinimalSelect
                ariaLabel="Entries per page"
                className="w-[66px]"
                size="sm"
                value={String(pageSize)}
                onChange={(v) => setPageSize(Number(v))}
                options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))}
              />
              entries per page
            </span>
            <MinimalSelect
              ariaLabel="Status"
              className="w-40"
              size="sm"
              value={statusFilter}
              onChange={setStatusFilter}
              options={["All Statuses", "Active", "Inactive", "Maintenance"].map((s) => ({ value: s, label: s }))}
            />
            {sites.length > 0 && (
              <MinimalSelect
                ariaLabel="Site"
                className="w-36"
                size="sm"
                value={siteFilter}
                onChange={setSiteFilter}
                options={[{ value: "All Sites", label: "All Sites" }, ...sites.map((s) => ({ value: s, label: s }))]}
              />
            )}
          </div>
          <SearchInput value={search} onChange={setSearch} placeholder="Search devices…" width="w-60" />
        </div>

        {loading ? (
          <div className="py-14 text-center text-[13px] ink-3">Loading devices…</div>
        ) : devices.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-14 ink-3">
            <FiHardDrive size={28} className="opacity-30" />
            <p className="text-[13px]">No FortiGate devices configured</p>
            {isAdmin && (
              <button onClick={openAdd}
                className="text-[12px] font-semibold px-4 py-2 rounded-[4px] text-white"
                style={{ background: accentGradient }}>
                + Add First Device
              </button>
            )}
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-14 ink-3">
            <FiHardDrive size={28} className="opacity-30" />
            <p className="text-[13px]">No device matches these filters</p>
          </div>
        ) : (
          <div className="overflow-x-auto shell-scroll-thin">
            <table className="shell-table w-full min-w-230">
              <thead>
                <tr>
                  <th scope="col">Device</th>
                  <th scope="col">Status</th>
                  <th scope="col">Reachability</th>
                  <th scope="col">Auto Backup</th>
                  <th scope="col">Last Backup</th>
                  <th className="text-right" scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {pagedDevices.map((d) => {
                  const job        = jobByDevice[d.id];
                  const running    = job?.status === "QUEUED" || job?.status === "RUNNING";
                  const ping       = pingResult[d.id];
                  const pingLoading = ping === "loading";

                  return (
                    <tr key={d.id}>
                      {/* Device name + IP */}
                      <td className="td-key">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-[4px]">
                            <img
                              src={fortinetDevicePicture}
                              alt=""
                              draggable={false}
                              className="h-full w-full object-cover"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="text-[13px] font-semibold ink truncate">{d.name}</p>
                            {/* Show the admin HTTPS/REST port (api_port), not the SSH port — this is
                                the port the web UI and this console reach the device on. 443 is the
                                default and is left implicit, so only a custom port (e.g. 13361) shows. */}
                            <p className="text-[11px] font-mono ink-3">{d.mgmt_ip}{(d.api_port || 443) !== 443 ? `:${d.api_port}` : ""}
                              {d.site && <span className="ml-1.5 not-italic">{d.site}</span>}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Status — icon + text, the same shape as Dastone's own Published/Inactive
                          pill (an icon on a soft badge skips the plain leading dot; see
                          .badge-soft in index.css). */}
                      <td>
                        <span
                          className={`badge-soft ${
                            d.status === "active" ? "badge-success"
                              : d.status === "maintenance" ? "badge-warning" : "badge-neutral"
                          }`}
                        >
                          {d.status === "active" ? <FiCheckCircle size={10} />
                            : d.status === "maintenance" ? <FiClock size={10} />
                            : <FiXCircle size={10} />}
                          {d.status}
                        </span>
                      </td>

                      {/* Reachability */}
                      <td>
                        {ping === "loading" ? (
                          <span className="text-[11px] ink-3">checking…</span>
                        ) : ping && typeof ping !== "string" ? (
                          ping.reachable ? (
                            <span className="badge-soft badge-success"><FiCheckCircle size={10} /> {ping.latency_ms}ms</span>
                          ) : (
                            <span className="badge-soft badge-danger"><FiXCircle size={10} /> unreachable</span>
                          )
                        ) : (
                          <span className="text-[11px] ink-3">—</span>
                        )}
                      </td>

                      {/* Auto Backup */}
                      <td>
                        {d.backup_enabled ? (
                          <span className="badge-soft badge-info cursor-default"><FiClock size={10} /> Scheduled</span>
                        ) : (
                          <span className="text-[11px] ink-3">Off</span>
                        )}
                      </td>

                      {/* Last Backup / Job Status */}
                      <td>
                        {job ? (
                          <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold"
                            style={{
                              // color-mix, not a hex-alpha suffix: two of the four values above are
                              // now CSS custom properties, and `var(--flow-info)40` is not a colour.
                              borderColor: `color-mix(in srgb, ${jobColors[job.status]} 40%, transparent)`,
                              color: jobColors[job.status],
                              backgroundColor: `color-mix(in srgb, ${jobColors[job.status]} 10%, transparent)`,
                            }}>
                            {running && <span className="h-1.5 w-1.5 rounded-full animate-ping inline-block" style={{ backgroundColor: jobColors[job.status] }} />}
                            {job.status}
                          </span>
                        ) : d.last_backup_at ? (
                          <span className="text-[11px] ink-2">
                            {formatDate(d.last_backup_at)}
                          </span>
                        ) : (
                          <span className="text-[11px] ink-3">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          {/* Ping */}
                          <button onClick={() => showPingModal(d)} disabled={pingLoading}
                            aria-label="Check reachability"
                            className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors disabled:opacity-50">
                            {pingLoading ? <FiRefreshCw size={12} className="animate-spin" /> : <FiWifi size={13} />}
                          </button>

                          {/* Backup / Force Retry */}
                          {running && isAdmin ? (
                            <button onClick={() => job && resetAndRetry(d, job)}
                              disabled={resetting === d.id}
                              aria-label={`Job #${job?.id} is stuck — force retry`}
                              className="flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] font-semibold text-white transition disabled:opacity-50"
                              style={{ background: "linear-gradient(135deg,#f59e0b,#ef4444)" }}>
                              {resetting === d.id
                                ? <FiRefreshCw size={11} className="animate-spin" />
                                : <FiRotateCcw size={11} />}
                              {resetting === d.id ? "…" : "Retry"}
                            </button>
                          ) : (
                            <button onClick={() => backup(d)} disabled={running}
                              aria-label={running ? "Backing up…" : "Backup config now"}
                              className="flex h-7 items-center gap-1 rounded-[4px] px-2 text-[11px] font-semibold text-white transition disabled:opacity-50"
                              style={{ background: running ? jobColors.QUEUED : accentGradient }}>
                              {running ? <FiRefreshCw size={11} className="animate-spin" /> : <FiDownloadCloud size={11} />}
                              {running ? "…" : "Backup"}
                            </button>
                          )}

                          {/* External link — open the device's admin GUI on its HTTPS/REST port
                              (api_port), not 443 blindly: a unit on a custom port like 13361 would
                              otherwise open a dead https://ip. 443 stays implicit. */}
                          <button onClick={() => window.open(`https://${d.mgmt_ip}${(d.api_port || 443) !== 443 ? `:${d.api_port}` : ""}`, "_blank", "noopener,noreferrer")}
                            aria-label="Open device web UI"
                            className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:text-cyan-500 hover:bg-cyan-50 dark:hover:bg-cyan-500/10 transition-colors">
                            <FiExternalLink size={13} />
                          </button>

                          {/* History */}
                          <button onClick={() => openHistory(d)}
                            aria-label="Job / backup history"
                            className="flex h-7 w-7 items-center justify-center rounded-[4px] ink-3 hover:text-violet-500 hover:bg-violet-50 dark:hover:bg-violet-500/10 transition-colors">
                            <FiClock size={13} />
                          </button>

                          {/* Edit */}
                          {isAdmin && (
                            <button onClick={() => openEdit(d)}
                              className="btn-icon">
                              <FiEdit2 size={13} />
                            </button>
                          )}

                          {/* Delete */}
                          {isAdmin && (
                            <button
                              className="btn-icon btn-icon--danger"
                              aria-label={`Delete ${d.name}`}
                              onClick={() => { setDeleteError(""); setDeleteTarget(d); }}
                            >
                              <FiTrash2 size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] ink-3">
            Showing {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredDevices.length)} of {filteredDevices.length} devices
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
              <FiChevronLeft size={13} />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => setPage(p)}
                className={`flex h-7 w-7 items-center justify-center rounded-[4px] border text-[12px] font-semibold transition ${
                  p === page ? "" : "surface-card ink-2 hairline"
                }`}
                style={p === page
                  ? { background: currentColor, color: "white", borderColor: currentColor }
                  : undefined}>
                {p}
              </button>
            ))}
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="flex h-7 w-7 items-center justify-center rounded-[4px] border hairline surface-card ink-2 surface-hover disabled:opacity-40 transition">
              <FiChevronRight size={13} />
            </button>
          </div>
        </div>
      )}

      {/* History drawer — a right-hand sheet, on the console's own Modal surface. antd's Drawer
          and its two Tables were the last widgets keeping the library on this page; the tables were
          plain lists with a render function per column, which is what `.shell-table` is for. */}
      {drawerDevice && (
        <Modal
          open
          side="right"
          onClose={() => setDrawerDevice(null)}
          width="w-full max-w-2xl"
          bodyClassName="p-0 shell-scroll-thin"
        >
          {/* Clean sticky header with a soft accent badge + glow, matching the account dialogs. */}
          <div className="sticky top-0 z-10 flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8"
            style={{ background: "var(--shell-card)" }}>
            <span className="pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full"
              style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
            <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
              style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
              <FiClock className="text-[16px]" />
            </span>
            <div className="relative min-w-0 flex-1">
              <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: currentColor }}>History</p>
              <h3 className="m-0 truncate text-[14px] font-bold ink">{drawerDevice.name}</h3>
            </div>
            <button type="button" onClick={() => setDrawerDevice(null)} aria-label="Close" className="btn-icon relative shrink-0">
              <FiX className="text-[15px]" />
            </button>
          </div>
          <div className="p-5">
          <h4 className="t-card m-0 mb-2">Recent Jobs</h4>
          <div className="panel panel-flush">
            {drawerJobs.length === 0 ? (
              <p className="ink-3 m-0 px-4 py-6 text-center text-[12px]">No jobs yet</p>
            ) : (
              <table className="shell-table">
                <thead>
                  <tr>
                    <th style={{ width: 56 }}>#</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th style={{ width: 90 }}>AI</th>
                  </tr>
                </thead>
                <tbody>
                  {drawerJobs.map((j) => (
                    <tr key={j.id}>
                      <td className="td-num ink-3">{j.id}</td>
                      <td>{j.type}</td>
                      <td>
                        <span className={`chip ${JOB_CHIP[j.status] ?? ""}`}>{j.status}</span>
                      </td>
                      <td className="max-w-70 truncate">{j.result}</td>
                      <td>
                        {j.status === "FAILED" && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={diagnoseLoading === j.id}
                            onClick={() => diagnoseJob(j.id)}
                          >
                            {diagnoseLoading === j.id
                              ? <span className="hairline h-3 w-3 animate-spin rounded-full border-2 border-t-transparent" />
                              : <FiCpu size={12} />}
                            Analyze
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <h4 className="t-card m-0 mb-2 mt-6">Config Backups</h4>
          {drawerBackups.length >= 2 && (
            <p className="ink-3 m-0 mb-2 text-[12px]">
              Select 2 backups and click compare to see the diff
            </p>
          )}
          <div className="panel panel-flush">
            {drawerBackups.length === 0 ? (
              <p className="ink-3 m-0 px-4 py-6 text-center text-[12px]">No backups yet</p>
            ) : (
              <table className="shell-table">
                <thead>
                  <tr>
                    <th style={{ width: 48 }}>#</th>
                    <th style={{ width: 64 }}>Lines</th>
                    <th style={{ width: 100 }}>Diff</th>
                    <th>Time</th>
                    <th style={{ width: 170 }}>File</th>
                  </tr>
                </thead>
                <tbody>
                  {drawerBackups.map((b, idx) => (
                    <tr key={b.id}>
                      <td className="td-num ink-3">{b.id}</td>
                      <td className="td-num">{b.lines}</td>
                      <td>
                        {b.diff_summary ? (
                          <span
                            className="text-[11px]"
                            style={{ color: b.diff_summary.startsWith("+0") ? "var(--shell-ink-3)" : "var(--flow-info)" }}
                          >
                            {b.diff_summary.split("\n")[0]}
                          </span>
                        ) : (
                          <span className="ink-3 text-[11px]">initial</span>
                        )}
                      </td>
                      <td className="t-meta">{formatDateTime(b.created_at)}</td>
                      <td>
                        <div className="flex items-center gap-1">
                          <button type="button" className="btn-icon" aria-label="View config" onClick={() => viewBackup(b)}>
                            <FiEye size={12} />
                          </button>
                          <button type="button" className="btn-icon" aria-label="Download .conf" onClick={() => downloadBackup(b)}>
                            <FiDownload size={12} />
                          </button>
                          {idx < drawerBackups.length - 1 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm px-2 text-[11px]"
                              onClick={() => openCompare(b, drawerBackups[idx + 1])}
                            >
                              vs #{drawerBackups[idx + 1]?.id}
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn-icon btn-icon--danger"
                              aria-label="Restore — replace the device configuration with this backup (reboots)"
                              onClick={() => setRestoreTarget(b)}
                            >
                              <FiRotateCcw size={12} />
                            </button>
                          )}
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn-icon btn-icon--danger"
                              aria-label={`Delete backup #${b.id}`}
                              onClick={() => void deleteBackup(b)}
                            >
                              <FiTrash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          </div>
        </Modal>
      )}

      <DeviceFormDrawer
        open={formOpen}
        device={formDevice}
        onClose={() => setFormOpen(false)}
        onSaved={() => void fetchDevices()}
      />

      {/* Delete device — the same device-mascot card as the credential removal. */}
      {deleteTarget && createPortal(
        <div className="fixed inset-0 z-9999 flex items-center justify-center p-3 sm:p-4">
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
          <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={() => !deleting && setDeleteTarget(null)} />
          <div className="relative z-10 w-full max-w-[380px] overflow-hidden rounded-[6px] surface-card ring-1 ring-black/5 dark:ring-white/10">
            <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting} aria-label="Cancel"
              className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-[4px] ink-3 surface-hover transition-colors focus:outline-none disabled:opacity-60">
              <FiX className="text-[16px]" />
            </button>
            <div className="px-6 pb-6 pt-7 text-center">
              <DeviceMascot className="mx-auto mb-3 h-24 w-24" title={`Delete ${deleteTarget.name}`} />
              <h3 className="truncate text-[17px] font-bold leading-tight ink">{deleteTarget.name}</h3>
              <p className="mx-auto mt-1.5 max-w-[17rem] text-[12px] leading-5 ink-3">
                The device and its stored credentials are removed from the inventory. Its config backups are kept.
              </p>

              {deleteError && <div className="mt-4 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 text-left text-[10.5px] text-red-600 dark:border-red-400/20 dark:bg-red-500/10 dark:text-red-300">{deleteError}</div>}

              <button type="button" onClick={() => void confirmDelete()} disabled={deleting}
                className={["mt-5 flex w-full items-center justify-center gap-2 rounded-[4px] py-2.5 text-[12.5px] font-semibold text-white transition",
                  deleting ? "cursor-not-allowed bg-red-300 dark:bg-red-900/50" : "bg-linear-to-r from-red-500 to-rose-500 hover:from-red-400 hover:to-rose-400",
                ].join(" ")}>
                {deleting
                  ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                  : <FiTrash2 className="text-[13px]" />}
                {deleting ? "Deleting…" : "Delete"}
              </button>
              <button type="button" onClick={() => !deleting && setDeleteTarget(null)} disabled={deleting}
                className="mt-2 w-full rounded-[4px] py-2 text-[12px] font-medium ink-3 transition surface-hover disabled:opacity-60">
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      <RestoreConfirmModal
        backup={restoreTarget}
        deviceName={
          devices.find((d) => d.id === restoreTarget?.network_device_id)?.name
          ?? drawerDevice?.name
          ?? "this device"
        }
        onClose={() => setRestoreTarget(null)}
      />

      {/* Config viewer modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white"
              style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
              <FiEye size={14} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0" style={{ color: currentColor }}>CONFIG FILE</p>
              <h3 className="text-[14px] font-bold leading-tight ink mb-0">
                {viewer ? `${viewer.device || ""} #${viewer.id}` : ""}
              </h3>
            </div>
          </div>
        }
        open={!!viewer}
        onClose={() => setViewer(null)}
        width="max-w-4xl"
        footer={
          <>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!viewer?.content}
            onClick={() => {
              if (!viewer) return;
              const blob = new Blob([viewer.content || ""], { type: "text/plain" });
              const url = window.URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `${viewer.device || "device"}_backup-${viewer.id}.conf`;
              a.click();
              window.URL.revokeObjectURL(url);
            }}
          >
            <FiDownload size={12} /> Download
          </button>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => setViewer(null)}>Close</button>
          </>
        }
      >
        {viewerLoading ? (
          <div style={{ textAlign: "center", padding: 40 }}>Loading…</div>
        ) : (
          <>
            {viewer && (
              <div style={{ marginBottom: 8, color: "var(--shell-ink-3)", fontSize: 12 }}>
                {viewer.lines} lines · {viewer.size_bytes} bytes · commit {viewer.git_commit}
                {viewerPreview.truncated && (
                  <span style={{ color: "var(--flow-warn)" }}>
                    {"  "}— showing first {VIEWER_MAX_LINES.toLocaleString()} lines (download for full config)
                  </span>
                )}
              </div>
            )}
            <pre
              style={{
                maxHeight: "60vh", overflow: "auto", background: "#1e1e1e", color: "#d4d4d4",
                padding: 16, borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                whiteSpace: "pre-wrap", wordBreak: "break-all",
              }}
            >
              {viewerPreview.text}
            </pre>
          </>
        )}
      </Modal>

      {/* Ping / Reachability modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white"
              style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
              <FiWifi size={14} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0" style={{ color: currentColor }}>REACHABILITY</p>
              <h3 className="text-[14px] font-bold leading-tight ink mb-0">
                {pingModalDevice?.name}
              </h3>
            </div>
          </div>
        }
        open={!!pingModalDevice}
        onClose={() => setPingModalDevice(null)}
        footer={
          <>
            <button type="button" className="btn btn-ghost btn-sm"
              onClick={() => pingModalDevice && pingDevice(pingModalDevice)}>Retest</button>
            <button type="button" className="btn btn-accent btn-sm"
              onClick={() => setPingModalDevice(null)}>Close</button>
          </>
        }
      >
        {pingModalDevice && (() => {
          const ping = pingResult[pingModalDevice.id];
          if (ping === "loading") return <div style={{ textAlign: "center", padding: 24 }}>Checking…</div>;
          if (!ping) return <div>Click "Retest" to check reachability</div>;
          return (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="ink text-[12.5px] font-semibold">Status:</span>
                <span className={`chip chip-solid ${ping.reachable ? "chip-ok" : "chip-danger"}`}>
                  {ping.reachable ? "Reachable ✓" : "Unreachable ✗"}
                </span>
              </div>
              <div className="t-body">
                <span className="ink font-semibold">Host:</span>{" "}
                <span className="t-mono ink-2">{ping.host}:{ping.port}</span>
              </div>
              <div className="t-body">
                <span className="ink font-semibold">Latency:</span> {ping.latency_ms} ms
              </div>
              {ping.error && (
                <div className="banner banner-danger">
                  <span className="text-red-600 dark:text-red-400">{ping.error}</span>
                </div>
              )}
              {!ping.reachable && (
                <div className="banner-warn" style={{ borderWidth: 1, borderStyle: "solid", borderRadius: 6, padding: 12, fontSize: 13 }}>
                  <strong>Troubleshooting:</strong>
                  <ul style={{ margin: "6px 0 0 0", paddingLeft: 20 }}>
                    <li>Verify the device is powered on and SSH is enabled</li>
                    <li>Check firewall rules between server and {ping.host}</li>
                    <li>Verify port {ping.port} is correct</li>
                  </ul>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* Compare 2 backups modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white"
              style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
              <FiDownload size={14} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0" style={{ color: currentColor }}>COMPARE</p>
              <h3 className="text-[14px] font-bold leading-tight ink mb-0">
                {compareA && compareB ? `Backup #${compareA.id} vs #${compareB.id}` : "Compare Config"}
              </h3>
            </div>
          </div>
        }
        open={compareOpen}
        onClose={() => setCompareOpen(false)}
        width="max-w-[85vw]"
        footer={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCompareOpen(false)}>
            Close
          </button>
        }
      >
        {(compareLoadingA || compareLoadingB) ? (
          <div style={{ textAlign: "center", padding: 40 }}>Loading configs…</div>
        ) : compareDiff ? (
          <DiffViewImport text={compareDiff} maxHeight="70vh" title="Config Diff" />
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
                Backup #{compareA?.id} — {compareA ? formatDateTime(compareA.created_at) : ""}
              </div>
              <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 11, maxHeight: "60vh", overflow: "auto", margin: 0 }}>
                {compareContentA}
              </pre>
            </div>
            <div>
              <div style={{ marginBottom: 4, fontWeight: 600, fontSize: 13 }}>
                Backup #{compareB?.id} — {compareB ? formatDateTime(compareB.created_at) : ""}
              </div>
              <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 12, borderRadius: 8, fontSize: 11, maxHeight: "60vh", overflow: "auto", margin: 0 }}>
                {compareContentB}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* AI diagnose modal */}
      <Modal
        title={
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] text-white"
              style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
              <FiCpu size={14} />
            </span>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest mb-0" style={{ color: currentColor }}>AI ANALYSIS</p>
              <h3 className="text-[14px] font-bold leading-tight ink mb-0">Failure Diagnosis</h3>
            </div>
          </div>
        }
        open={diagnoseOpen}
        onClose={() => setDiagnoseOpen(false)}
        footer={
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDiagnoseOpen(false)}>
            Close
          </button>
        }
      >
        {diagnoseResult && (
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2">
              <span className="ink text-[12.5px] font-semibold">Severity:</span>
              <span className={`chip chip-solid ${SEVERITY_CHIP[diagnoseResult.severity] ?? "chip-info"}`}>
                {diagnoseResult.severity.toUpperCase()}
              </span>
            </div>
            <div>
              <p className="ink m-0 text-[12.5px] font-semibold">Summary</p>
              <p className="t-body ink-2 m-0">{diagnoseResult.summary}</p>
            </div>
            <div>
              <p className="ink m-0 text-[12.5px] font-semibold">Likely Cause</p>
              <p className="t-body ink-2 m-0">{diagnoseResult.likely_cause}</p>
            </div>
            <div>
              <p className="ink m-0 text-[12.5px] font-semibold">Suggested Fix</p>
              <p className="t-body ink-2 m-0 whitespace-pre-wrap">{diagnoseResult.suggested_fix}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Index;
