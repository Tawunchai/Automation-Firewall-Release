import React, { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiZap, FiPlus, FiEdit2, FiTrash2 } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import ConfirmDeleteModal from "../../components/ui/ConfirmDeleteModal";
import { DeviceStates } from "../../components/ui/StateBlock";
import { useDeviceData } from "../../hooks/useDeviceData";
import {
  DeviceListServices, DeviceDeleteService,
  type ServiceObject,
} from "../../api/policyObject";
import { FG_COLORS } from "../../lib/categoryColor";
import { apiErrorDetail } from "../../api/errorText";

// ─── FortiGate color palette (index → hex) ────────────────────────────────────
/** Stable empty list — a `[]` literal would be a new identity each render. */
const EMPTY: ServiceObject[] = [];


// ─── Category color map ───────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  "General":                              "#94a3b8",
  "Network Services":                     "#0ea5e9",
  "Remote Access":                        "#8b5cf6",
  "VoIP/Messaging":                       "#f59e0b",
  "VoIP, Messaging & Other Applications": "#f59e0b",
  "File Access":                          "#3b82f6",
  "Tunneling":                            "#22c55e",
  "Authentication":                       "#ef4444",
  "Email":                                "#ec4899",
  "Web Access":                           "#14b8a6",
  "Database":                             "#6366f1",
  "Uncategorized":                        "#cbd5e1",
};

// ─── Protocol badge ───────────────────────────────────────────────────────────
const PROTO_BADGE: Record<string, { text: string; bg: string }> = {
  "TCP/UDP/SCTP": { text: "TC", bg: "#3b82f6" },
  "IP":           { text: "IP", bg: "#f59e0b" },
  "ICMP":         { text: "IC", bg: "#10b981" },
  "ICMPv6":       { text: "V6", bg: "#8b5cf6" },
  "ALL":          { text: "AL", bg: "#94a3b8" },
};

// Protocol chart colors — exclude ALL & ICMPv6 to match FortiGate GUI
const PROTO_CHART_COLORS: Record<string, string> = {
  "TCP/UDP/SCTP": "#0ea5e9",
  "IP":           "#f59e0b",
  "ICMP":         "#10b981",
};

// ─── Table layout ─────────────────────────────────────────────────────────────
// Columns: color-bar | NAME | DETAILS | IP/FQDN | CATEGORY | PROTOCOL | REF. | actions
const GRID = "12px 1fr 175px 100px 160px 130px 52px 66px";
const HEADER_COLS = ["", "NAME", "DETAILS", "IP/FQDN", "CATEGORY", "PROTOCOL", "REF.", ""];

// ─── Donut Chart ──────────────────────────────────────────────────────────────
const MAX_LEGEND = 5;

const DonutChart: React.FC<{
  data: { label: string; count: number; color: string }[];
  total: number;
  title: string;
}> = ({ data, total, title }) => {
  const [popupPos, setPopupPos] = useState<{ x: number; y: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const btnRef   = useRef<HTMLButtonElement>(null);

  const r = 40; const cx = 52; const cy = 52;
  const circumference = 2 * Math.PI * r;
  // Two passes rather than one with a running total. The accumulator version reassigned a
  // variable of the component body from inside a map callback, which makes the render's result
  // depend on how many times it happens to run. Sizes first, then each slice's start angle is the
  // sum of the ones before it — the same numbers, computed as a function of the input.
  const sized = data
    .filter((d) => d.count > 0)
    .map((d) => ({ ...d, dash: total > 0 ? (d.count / total) * circumference : 0 }));
  const segments = sized.map((d, i) => ({
    ...d,
    gap: circumference - d.dash,
    offset: sized.slice(0, i).reduce((sum, prev) => sum + prev.dash, 0),
  }));

  const visible = segments.slice(0, MAX_LEGEND);
  const hasMore = segments.length > MAX_LEGEND;

  const openPopup = () => {
    clearTimeout(timerRef.current);
    if (btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPopupPos({ x: rect.left, y: rect.bottom + 4 }); // popup appears BELOW the button
    }
  };
  const startClose = () => {
    timerRef.current = setTimeout(() => setPopupPos(null), 150);
  };

  return (
    <>
      <div className="flex items-start gap-4 p-4 h-full">
        {/* Donut SVG */}
        <div className="shrink-0">
          <svg width={104} height={104} viewBox="0 0 104 104">
            <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--shell-sunken)" strokeWidth="14" />
            {segments.map((s, i) => (
              <circle key={i} cx={cx} cy={cy} r={r} fill="none"
                stroke={s.color} strokeWidth="14"
                strokeDasharray={`${s.dash} ${s.gap}`}
                strokeDashoffset={-s.offset + circumference * 0.25}
                strokeLinecap="butt" />
            ))}
            <text x={cx} y={cy - 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--shell-ink)">{total}</text>
            <text x={cx} y={cy + 12} textAnchor="middle" fontSize="8" fill="var(--shell-ink-3)">Total</text>
          </svg>
        </div>

        {/* Legend */}
        <div className="flex-1 min-w-0 flex flex-col">
          <p className="text-[11px] font-semibold ink-2 mb-2">{title}</p>
          <div className="space-y-1 flex-1">
            {visible.map((s) => (
              <div key={s.label} className="flex items-center gap-2">
                <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[10px] ink-2 truncate flex-1">{s.label}</span>
                <span className="ml-auto shrink-0 flex h-4 min-w-5 items-center justify-center rounded-full surface-sunken px-1.5 text-[9px] font-bold ink-2">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
          {hasMore && (
            <button
              ref={btnRef}
              type="button"
              onMouseEnter={openPopup}
              onMouseLeave={startClose}
              className="mt-1.5 text-left text-[10px] font-medium text-blue-500 hover:text-blue-700 transition-colors">
              More…
            </button>
          )}
        </div>
      </div>

      {/* Popup portal — appears BELOW More… button */}
      {popupPos && createPortal(
        <div
          className="fixed z-9999 overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ left: popupPos.x, top: popupPos.y, minWidth: 220 }}
          onMouseEnter={() => clearTimeout(timerRef.current)}
          onMouseLeave={startClose}>
          <div className="border-b hairline-2 px-4 py-2">
            <p className="t-label">{title}</p>
          </div>
          <div className="px-3 py-2.5 space-y-1.5">
            {segments.map((s) => (
              <div key={s.label} className="flex items-center gap-2.5">
                <div className="h-3.5 w-3.5 rounded-sm shrink-0" style={{ backgroundColor: s.color }} />
                <span className="text-[11.5px] ink flex-1 whitespace-nowrap">
                  {s.label}
                </span>
                <span className="text-[11.5px] font-semibold ink-3 min-w-7 text-right">
                  {s.count}
                </span>
              </div>
            ))}
          </div>
        </div>,
        document.body
      )}
    </>
  );
};

// ─── Main page ────────────────────────────────────────────────────────────────
const ServicesTab: React.FC<{ toggle?: React.ReactNode }> = ({ toggle }) => {
  const { currentColor } = useStateContext();
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const [deleteTarget, setDeleteTarget] = useState<ServiceObject | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [search, setSearch]           = useState("");
  const navigate = useNavigate();

  // strict: a firewall we could not read must NOT render as "no service objects" — see hooks/useDeviceData.
  const load = useCallback(
    (deviceId: number) => DeviceListServices(deviceId, { strict: true }),
    [],
  );
  const {
    data: services, error, reload: fetchAll, device: selectedDevice, viewState,
  } = useDeviceData<ServiceObject[]>(load, EMPTY);

  const handleDelete = async () => {
    if (!deleteTarget || !selectedDevice) return;
    try {
      setDeleting(true);
      await DeviceDeleteService(selectedDevice.id, deleteTarget.name);
      message.success("Service deleted");
      setDeleteTarget(null);
      void fetchAll();
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to delete service"));
    } finally {
      setDeleting(false);
    }
  };

  const filtered = services.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    (s.category || "").toLowerCase().includes(search.toLowerCase()) ||
    (s.details || "").toLowerCase().includes(search.toLowerCase())
  );

  // ── Chart data ──────────────────────────────────────────────────────────────
  const total = filtered.length;

  const catCounts: Record<string, number> = {};
  filtered.forEach((s) => {
    const cat = s.category || "Uncategorized";
    catCounts[cat] = (catCounts[cat] || 0) + 1;
  });
  const catData = Object.entries(catCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, color: CAT_COLORS[label] || "#94a3b8" }));

  // Exclude ALL & ICMPv6 from Protocol chart (matches FortiGate GUI)
  const protoCounts: Record<string, number> = {};
  filtered.forEach((s) => {
    const proto: string = s.protocol;
    if (proto === "ALL" || proto === "ICMPv6") return;
    protoCounts[proto] = (protoCounts[proto] || 0) + 1;
  });
  const protoData = Object.entries(protoCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count, color: PROTO_CHART_COLORS[label] || "#94a3b8" }));
  const protoTotal = protoData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: search,
          Create New and the Services/Groups toggle. The total count it used to badge is not lost,
          just not repeated here — it's what the row count below already shows. */}
      <div className="flex items-center gap-2 flex-wrap justify-end">
        <div className="relative">
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search services…"
            className="h-8 rounded-[4px] border hairline surface-card pl-8 pr-3 text-[12px] outline-none w-44"
            onFocus={(e) => { e.currentTarget.style.borderColor = currentColor; }}
            onBlur={(e)  => { e.currentTarget.style.borderColor = ""; }} />
          <svg className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3"
            width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
          </svg>
        </div>
        {isAdmin && selectedDevice && (
          <button
            onClick={() => navigate(`/admin/fw-services/create?deviceId=${selectedDevice.id}`)}
            className="btn btn-accent btn-sm">
            <FiPlus size={13} /> Create new
          </button>
        )}
        {toggle}
      </div>

      {/* ── Donut Charts ── */}
      {viewState(filtered.length) === "rows" && total > 0 && (
        <div className="grid grid-cols-2 gap-4 items-stretch">
          <div className="rounded-[4px] surface-card shadow-sm flex flex-col"
            style={{ border: `1px solid ${currentColor}18`, minHeight: 148 }}>
            <DonutChart data={catData} total={total} title="Category" />
          </div>
          <div className="rounded-[4px] surface-card shadow-sm flex flex-col"
            style={{ border: `1px solid ${currentColor}18`, minHeight: 148 }}>
            <DonutChart data={protoData} total={protoTotal} title="Protocol" />
          </div>
        </div>
      )}

      {/* ── Services Table ── */}
      <div className="panel panel-flush">

        {/* Fixed header */}
        {viewState(filtered.length) !== "empty" && viewState(filtered.length) !== "error" && (
          <div className="grid border-b hairline-2 px-4 py-2.5"
            style={{ gridTemplateColumns: GRID }}>
            {HEADER_COLS.map((h, i) => (
              <span key={i} className="t-label">{h}</span>
            ))}
          </div>
        )}

        {/* Scrollable body — max ~10 rows (520px) */}
        <DeviceStates
          state={viewState(filtered.length)}
          from={selectedDevice?.name}
          noun="service object"
          icon={<FiZap size={18} />}
          error={error}
          onRetry={() => void fetchAll()}
          filtered={!!search}
        >
          <div style={{ maxHeight: "520px", overflowY: "auto" }}>
            {filtered.map((s, idx) => {
              const badge    = PROTO_BADGE[s.protocol] ?? { text: "?", bg: "#94a3b8" };
              const catColor = CAT_COLORS[s.category]  ?? "#94a3b8";
              const svcColor = s.color > 0 && s.color < FG_COLORS.length
                ? FG_COLORS[s.color]
                : null;

              return (
                <div
                  key={s.name}
                  className={`grid items-center px-4 py-3 surface-hover transition-colors ${idx < filtered.length - 1 ? "border-b hairline-2" : ""}`}
                  style={{ gridTemplateColumns: GRID }}>

                  {/* Color bar */}
                  <div className="flex items-center justify-center">
                    {svcColor
                      ? <div className="w-0.75 h-6 rounded-full" style={{ backgroundColor: svcColor }} />
                      : <div className="w-0.75 h-6" />}
                  </div>

                  {/* Name + comment */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="flex h-6 w-7 shrink-0 items-center justify-center rounded text-[9px] font-bold text-white"
                      style={{ backgroundColor: badge.bg }}>
                      {badge.text}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold ink truncate">{s.name}</p>
                      {s.comment && <p className="text-[10px] ink-3 truncate">{s.comment}</p>}
                    </div>
                  </div>

                  {/* Details — "TCP/80", "IP/50", "ICMP/ANY", "ANY" */}
                  <span className="font-mono text-[12px] ink-2 truncate pr-2">
                    {s.details || "ANY"}
                  </span>

                  {/* IP/FQDN — "0.0.0.0" for TCP/UDP/SCTP, blank for IP/ICMP */}
                  <span className="font-mono text-[12px] ink-2 truncate pr-2">
                    {s.ip_fqdn}
                  </span>

                  {/* Category */}
                  <div className="flex items-center gap-1.5 min-w-0 pr-2">
                    <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: catColor }} />
                    <span className="text-[12px] ink-2 truncate">{s.category || "—"}</span>
                  </div>

                  {/* Protocol pill */}
                  <div>
                    <span className="inline-block rounded-full border hairline px-2 py-0.5 text-[10px] font-medium ink-2">
                      {s.protocol}
                    </span>
                  </div>

                  {/* Ref count — blue if > 0 */}
                  <span className={`text-[12px] font-semibold ${s.ref_count > 0 ? "text-blue-600 dark:text-blue-400" : "ink-3"}`}>
                    {s.ref_count}
                  </span>

                  {/* Edit / Delete */}
                  <div className="flex items-center justify-end gap-1">
                    {isAdmin && !s.builtin && (
                      <>
                        <button
                          onClick={() => navigate(
                            `/admin/fw-services/edit?deviceId=${selectedDevice!.id}&name=${encodeURIComponent(s.name)}`
                          )}
                          className="btn-icon">
                          <FiEdit2 size={13} />
                        </button>
                        <button onClick={() => setDeleteTarget(s)}
                          className="btn-icon btn-icon--danger">
                          <FiTrash2 size={13} />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </DeviceStates>
      </div>

      {/* Count footer */}
      {viewState(filtered.length) === "rows" && (
        <p className="text-right text-[11px] ink-3">
          {search ? `${filtered.length} of ${services.length}` : services.length}{" "}
          service{services.length !== 1 ? "s" : ""}
        </p>
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDeleteModal
          eyebrow="DELETE SERVICE"
          title="Delete from device?"
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={handleDelete}
        >
          Service <strong className="ink">"{deleteTarget.name}"</strong> will be permanently removed
          from {selectedDevice?.name}.
        </ConfirmDeleteModal>
      )}
    </div>
  );
};

export default ServicesTab;
