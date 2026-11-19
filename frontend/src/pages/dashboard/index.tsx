import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiAlertTriangle, FiCheckCircle, FiClock, FiCpu, FiDatabase, FiGitBranch,
  FiHardDrive, FiLayers, FiList, FiRefreshCw, FiShield, FiActivity,
} from "react-icons/fi";
import { MdSpaceDashboard } from "react-icons/md";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import {
  GetDeviceDashboard, GetDeviceUsage,
  type DashboardSnapshot, type UsageInterval,
} from "../../api/deviceMonitor";
import { DeviceListServices, type ServiceObject } from "../../api/policyObject";
import {
  FortiGateCloudWidget, LicensesWidget, SystemInformationWidget,
} from "./widgets";
import ThroughputPanel from "../interfaces/ThroughputPanel";
import { ICON_CHIP, StatTile, TILE_ICONS } from "./kpi";
import { utilisationHealth } from "./kpi.logic";
import { formatBytes, formatDeviceTime, formatUptime } from "./format";

// System > Dashboard > Status for the selected FortiGate — the same widgets the device's own
// dashboard shows, read live over its REST monitor API.
//
// The page reads top-to-bottom the way the question is actually asked, narrowest question first:
//
//   · Which box is this, and is it healthy right now?  → the hero: identity + a live snapshot strip
//   1. The same four numbers, with more room           → four stat tiles with sparklines
//   2. What is it, and is it licensed?                  → the three state panels
//
// The hero carries device identity (hostname, model, firmware, mode, uptime) rather than a second
// card repeating it a few hundred pixels down the page — the navy `.hero-surface` is the same
// material as the sidebar and the Profile page's identity card, so it is the one place on the page
// that says "this is the shell talking about ITSELF", not a widget reporting on the device.
//
// Two things used to sit between these — the port faceplate (the same component Network >
// Interfaces draws) and full CPU/memory/sessions history charts below the tiles. Both removed as
// duplication: the faceplate repeated the up/down count the FortiGate panel already states, and
// the charts repeated the sparkline every tile already carries.
//
// Which device you are looking at is set from the navbar; everything on screen re-reads itself:
//   · the charts poll /dashboard/usage every 5s   (~0.15s per call)
//   · the rest re-reads /dashboard every 60s      (~1s: ~8 device calls fanned out)
// Polling stops entirely while the tab is hidden, so a forgotten tab does not sit there
// interrogating a production firewall all day.

const USAGE_POLL_MS = 5_000;
const SNAPSHOT_POLL_MS = 60_000;

/**
 * The history window every chart and sparkline draws.
 *
 * Fixed rather than user-chosen: at a 5s poll the one-minute series is the only window that shows
 * what the firewall is doing *now*, which is this page's whole job. The wider windows FortiOS
 * keeps are out of scope for this page.
 */
const INTERVAL: UsageInterval = "1-min";

/** Stable empty list — a `[]` literal would be a new identity on every render. */
const NO_SERVICES: ServiceObject[] = [];

const DashboardIndex: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();

  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The Services KPI card's own data — a CMDB object count, not a monitor reading, so it rides the
  // same slow 60s cadence as the port list rather than the 5s usage poll.
  const [services, setServices] = useState<ServiceObject[]>(NO_SERVICES);
  const [servicesError, setServicesError] = useState<string | null>(null);
  const [servicesLoading, setServicesLoading] = useState(true);

  // Seconds since the snapshot was taken — keeps the device clock and uptime ticking between
  // refreshes instead of freezing on a stale second.
  const [tick, setTick] = useState(0);

  // The in-flight request, so switching device cancels the previous one rather than letting a
  // slow answer overwrite the new selection.
  const inflight = useRef<AbortController | null>(null);

  const loadSnapshot = useCallback(async (deviceId: number, showSpinner: boolean) => {
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;

    if (showSpinner) setLoading(true);
    try {
      const data = await GetDeviceDashboard(deviceId, INTERVAL, controller.signal);
      if (controller.signal.aborted) return;
      setSnapshot(data);
      setTick(0);
      setError(null);
    } catch (err) {
      if (controller.signal.aborted) return;
      setError(err instanceof Error ? err.message : "Failed to read the device dashboard");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);

  /** Reads the service object list behind the Services KPI card — same strict-read contract. */
  const loadServices = useCallback(async (deviceId: number, showSpinner: boolean) => {
    if (showSpinner) setServicesLoading(true);
    try {
      const list = await DeviceListServices(deviceId, { strict: true });
      setServices(list);
      setServicesError(null);
    } catch (err) {
      setServices(NO_SERVICES);
      setServicesError(err instanceof Error ? err.message : "Could not read the services");
    } finally {
      setServicesLoading(false);
    }
  }, []);

  // Device changed → full reload.
  useEffect(() => {
    if (!device) return;
    void loadSnapshot(device.id, true);
    void loadServices(device.id, true);
    return () => inflight.current?.abort();
  }, [device, loadSnapshot, loadServices]);

  // Chart polling — the cheap endpoint, merged into the existing snapshot.
  useEffect(() => {
    if (!device) return;
    let cancelled = false;

    const poll = async () => {
      if (document.hidden || cancelled) return;
      try {
        const usage = await GetDeviceUsage(device.id, INTERVAL);
        if (cancelled) return;
        setSnapshot((prev) =>
          prev
            ? {
                ...prev,
                usage: usage.usage,
                performance: usage.performance ?? prev.performance,
                sessions: usage.sessions ?? prev.sessions,
              }
            : prev,
        );
        setError(null);
      } catch {
        // A single missed poll is not worth an error banner — the next one (or the 60s
        // snapshot) will report a device that is genuinely unreachable.
      }
    };

    const id = window.setInterval(poll, USAGE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [device]);

  // Full snapshot refresh — licences and the services list both change slowly, so they ride the
  // same 60s cadence rather than paying for a poll of their own.
  useEffect(() => {
    if (!device) return;
    const id = window.setInterval(() => {
      if (document.hidden) return;
      void loadSnapshot(device.id, false);
      void loadServices(device.id, false);
    }, SNAPSHOT_POLL_MS);
    return () => window.clearInterval(id);
  }, [device, loadSnapshot, loadServices]);

  // Local clock tick for System Time / Uptime.
  useEffect(() => {
    const id = window.setInterval(() => {
      if (!document.hidden) setTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  const sectionErrors = snapshot?.errors ?? {};

  // ── Services KPI card ────────────────────────────────────────────────────────
  // The four-segment bar is the reference's own idea (Outstanding Invoices ages 0-30/31-60/61-90/90+
  // into four buckets) restated with this object's actual four-way split. FortiOS's declared
  // protocol enum is TCP/UDP/SCTP · IP · ICMP · ICMPv6, but the live CMDB also hands back a bare
  // "ALL" for the one built-in any-protocol service — folded into IP (the closest of the four, both
  // being "not a port, not an ICMP type") so the four segments still sum to the real total instead
  // of silently dropping that one service.
  const serviceBuckets = useMemo(() => {
    const counts = { "TCP/UDP/SCTP": 0, IP: 0, ICMP: 0, ICMPv6: 0 };
    for (const svc of services) {
      const key = svc.protocol in counts ? (svc.protocol as keyof typeof counts) : "IP";
      counts[key] += 1;
    }
    return counts;
  }, [services]);
  // `builtin` is a known gap in the backend's service mapping (always false, never computed from
  // the device) — not something to paper over with a fake count, so the caption reads from
  // `category` instead, which IS read straight off the CMDB object, same as the device's own
  // Services page groups by.
  const serviceCategoryCount = useMemo(
    () => new Set(services.map((svc) => svc.category)).size,
    [services],
  );

  const usage = snapshot?.usage ?? null;
  const perf = snapshot?.performance ?? null;
  const sessions = snapshot?.sessions ?? null;
  const system = snapshot?.system ?? null;

  const cpuPct = Math.round(usage?.cpu.current ?? 0);
  const memPct = Math.round(usage?.memory.current ?? 0);
  const sessionCount = sessions?.session_count ?? Math.round(usage?.sessions.current ?? 0);

  const reachable = !error && snapshot !== null;

  if (!device) {
    return (
      <section className="shell-card px-5 py-16 text-center">
        <span
          className="medallion mx-auto mb-3 h-14 w-14 text-[24px]"
          style={{ color: currentColor, background: `${currentColor}1f` }}
        >
          <MdSpaceDashboard />
        </span>
        <p className="t-title m-0">Select a FortiGate device</p>
        <p className="t-meta m-0 mt-1">
          Pick one from the device menu in the top bar. Its live status — system information,
          licences, CPU, memory and sessions — appears here.
        </p>
      </section>
    );
  }

  const freshness = loading ? "reading…" : tick < 5 ? "just now" : tick < 60 ? `${tick}s ago` : `${Math.floor(tick / 60)}m ago`;
  const todayLabel = new Date().toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  return (
    <div className="space-y-4">
      {/* ── Hero ──────────────────────────────────────────────────────────────
          A direct port of the accounting-dashboard reference's executive header — same radial-navy
          background, same two glow blobs, same dot-grid texture, same badge/chip/stat-strip sizes
          and colours, pixel for pixel. Only the words and the numbers are this console's own:
          "Total Assets" became CPU, "Net Income" became Memory, and so on down the strip. */}
      <section
        className="animate-rise-in relative overflow-hidden rounded-[5px] p-6 text-white lg:p-8"
        style={{
          // Tinted off the user's own accent (ProviderContext's `currentColor`), not a fixed hue —
          // the console is accent-themed everywhere else, and a hero that stayed one fixed colour
          // regardless of the Appearance picker would be the one surface that lied about it.
          background: `radial-gradient(120% 140% at 100% 0%, color-mix(in srgb, ${currentColor} 38%, #140f22) 0%, color-mix(in srgb, ${currentColor} 16%, #120d20) 55%, #07050d 100%)`,
        }}
      >
        <div
          className="pointer-events-none absolute -top-24 -right-24 h-80 w-80 rounded-full"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, ${currentColor} 42%, transparent), transparent 70%)` }}
        />
        <div
          className="pointer-events-none absolute -bottom-28 -left-20 h-80 w-80 rounded-full"
          style={{ background: `radial-gradient(circle, color-mix(in srgb, color-mix(in srgb, ${currentColor} 60%, black) 45%, transparent), transparent 70%)` }}
        />
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            opacity: 0.05,
            backgroundImage: "radial-gradient(rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "22px 22px",
          }}
        />

        {/* Decorative "firewall under attack" watermark — a hand-drawn brick wall (the firewall) with
            a flame on top, a spiky virus to its left and a burst of DDoS packets flung at it. Same
            idea as the sign-in illustration, but a different, simpler scene and drawn in a single
            faint grey (currentColor on white at a low opacity) rather than in colour, so it reads as
            texture behind the numbers, never competing with them. pointer-events-none; hidden on
            phones where there is no room for it. */}
        <svg
          className="pointer-events-none absolute right-2 top-1/2 hidden h-64 -translate-y-1/2 opacity-[0.08] md:block"
          viewBox="0 0 300 200" fill="none" aria-hidden style={{ color: "#ffffff" }}
        >
          {/* Flame above the wall */}
          <path d="M234 40 C 250 62, 248 76, 234 86 C 220 76, 218 62, 234 40 Z" fill="currentColor" opacity="0.28" />
          <path d="M234 56 C 242 68, 241 76, 234 82 C 227 76, 226 68, 234 56 Z" fill="currentColor" opacity="0.5" />
          {/* Firewall — brick wall */}
          <g stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <rect x="186" y="88" width="96" height="98" rx="6" />
            <line x1="186" y1="112" x2="282" y2="112" />
            <line x1="186" y1="137" x2="282" y2="137" />
            <line x1="186" y1="161" x2="282" y2="161" />
            <line x1="218" y1="88" x2="218" y2="112" />
            <line x1="250" y1="88" x2="250" y2="112" />
            <line x1="202" y1="112" x2="202" y2="137" />
            <line x1="234" y1="112" x2="234" y2="137" />
            <line x1="266" y1="112" x2="266" y2="137" />
            <line x1="218" y1="137" x2="218" y2="161" />
            <line x1="250" y1="137" x2="250" y2="161" />
            <line x1="202" y1="161" x2="202" y2="186" />
            <line x1="234" y1="161" x2="234" y2="186" />
            <line x1="266" y1="161" x2="266" y2="186" />
          </g>
          {/* Virus — a spiky capsid, to the wall's left */}
          <g stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
              <line key={d} x1="60" y1="84" x2="60" y2="72" transform={`rotate(${d} 60 112)`} />
            ))}
          </g>
          {[0, 45, 90, 135, 180, 225, 270, 315].map((d) => (
            <circle key={`k${d}`} cx="60" cy="70" r="3" fill="currentColor" opacity="0.55" transform={`rotate(${d} 60 112)`} />
          ))}
          <circle cx="60" cy="112" r="24" stroke="currentColor" strokeWidth="3" />
          <circle cx="53" cy="105" r="4.5" fill="currentColor" opacity="0.4" />
          <circle cx="68" cy="118" r="3" fill="currentColor" opacity="0.4" />
          {/* DDoS — a flung burst of packets converging on the wall's left face */}
          <g stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="7 7">
            <path d="M98 96 L 180 112" />
            <path d="M98 130 L 180 132" />
            <path d="M98 164 L 180 154" />
          </g>
          <g fill="currentColor" opacity="0.75">
            <path d="M180 112 l-11 -3 l 3 8 z" />
            <path d="M180 132 l-10 -4 l 0 8 z" />
            <path d="M180 154 l-11 -1 l 2 8 z" />
          </g>
        </svg>

        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="grid h-12 w-12 shrink-0 place-items-center rounded-[4px]"
              style={{
                background: `linear-gradient(135deg, color-mix(in srgb, ${currentColor} 32%, transparent), color-mix(in srgb, ${currentColor} 10%, transparent))`,
              }}
              aria-hidden
            >
              <FiShield style={{ fontSize: 20, color: `color-mix(in srgb, ${currentColor} 78%, white)` }} />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="m-0 truncate text-[21px] font-bold text-white">
                  {loading && !system ? "Reading device…" : system?.hostname || device.name}
                </h1>
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-solid px-2.5 py-1 text-[11px] font-semibold"
                  style={
                    reachable
                      ? { background: "rgba(110,231,183,0.16)", color: "#6EE7B7", borderColor: "rgba(110,231,183,0.3)" }
                      : { background: "rgba(248,113,113,0.16)", color: "#F87171", borderColor: "rgba(248,113,113,0.3)" }
                  }
                >
                  <span className="relative flex h-1.5 w-1.5">
                    {reachable && (
                      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ background: "currentColor" }} />
                    )}
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ background: "currentColor" }} />
                  </span>
                  {reachable ? "Online" : "Unreachable"}
                </span>
              </div>
              <p className="mt-1.5 max-w-xl text-[12.5px] leading-relaxed" style={{ color: "rgba(255,255,255,0.6)" }}>
                <span className="block">
                  Live health, licensing, and interface state for this FortiGate — one operations workspace.
                </span>
                <span className="block">
                  Every number below is read straight from the device's own monitor API and refreshes automatically.
                </span>
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)" }}
                >
                  <FiHardDrive style={{ fontSize: 10.5 }} />
                  {system?.model || device.name}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)" }}
                >
                  <FiGitBranch style={{ fontSize: 10.5 }} />
                  {system?.version ? `${system.version}${system.build ? ` b${system.build}` : ""}` : "—"}
                </span>
                <span
                  className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: "rgba(255,255,255,0.07)", color: "rgba(255,255,255,0.8)" }}
                >
                  <FiLayers style={{ fontSize: 10.5 }} />
                  {system?.operation_mode || "—"}
                </span>
                {Object.keys(sectionErrors).length > 0 && (
                  <span
                    className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold"
                    style={{ background: "rgba(245,158,11,0.16)", color: "#e9be4e" }}
                  >
                    <FiAlertTriangle style={{ fontSize: 10.5 }} />
                    {Object.keys(sectionErrors).length} panel{Object.keys(sectionErrors).length > 1 ? "s" : ""} need attention
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <p className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.45)" }}>
              Refreshed {freshness} · {todayLabel}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[4px] bg-white px-3.5 text-[12.5px] font-semibold text-neutral-900 transition-colors hover:bg-white/90"
                onClick={() => { void loadSnapshot(device.id, true); void loadServices(device.id, true); }}
              >
                <FiRefreshCw size={13} /> Refresh Data
              </button>
            </div>
          </div>
        </div>

        {/* Live snapshot strip — the exact slot the reference gives Total Assets / Net Income /
            Accounts Payable / Close Progress, carrying CPU / Memory / Sessions / Uptime instead. */}
        <div
          className="relative grid grid-cols-2 gap-4 pt-6 sm:grid-cols-4"
          style={{ marginTop: 24, borderTop: "1px solid rgba(255,255,255,0.1)" }}
        >
          <div>
            <p className="m-0 flex items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-55">
              <FiCpu style={{ fontSize: 10 }} /> CPU
            </p>
            <p className="m-0 mt-1 text-[19px] font-bold text-white">{cpuPct}%</p>
            <p
              className="m-0 mt-0.5 flex items-center gap-1 text-[10px]"
              style={{ color: utilisationHealth(cpuPct) === "normal" ? "#6EE7B7" : "#e9be4e" }}
            >
              {utilisationHealth(cpuPct) === "normal"
                ? <FiCheckCircle style={{ fontSize: 9 }} />
                : <FiAlertTriangle style={{ fontSize: 9 }} />}
              {perf?.cpu_cores ? `${perf.cpu_cores} cores · avg ${Math.round(usage?.cpu.average ?? 0)}%` : "aggregate utilisation"}
            </p>
          </div>
          <div>
            <p className="m-0 flex items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-55">
              <FiDatabase style={{ fontSize: 10 }} /> Memory
            </p>
            <p className="m-0 mt-1 text-[19px] font-bold text-white">{memPct}%</p>
            <p
              className="m-0 mt-0.5 flex items-center gap-1 text-[10px]"
              style={{ color: utilisationHealth(memPct) === "normal" ? "#6EE7B7" : "#e9be4e" }}
            >
              {utilisationHealth(memPct) === "normal"
                ? <FiCheckCircle style={{ fontSize: 9 }} />
                : <FiAlertTriangle style={{ fontSize: 9 }} />}
              {perf?.mem_total ? `${formatBytes(perf.mem_used)} of ${formatBytes(perf.mem_total)}` : "aggregate utilisation"}
            </p>
          </div>
          <div>
            <p className="m-0 flex items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-55">
              <FiActivity style={{ fontSize: 10 }} /> Sessions
            </p>
            <p className="m-0 mt-1 text-[19px] font-bold text-white">{sessionCount.toLocaleString()}</p>
            <p className="m-0 mt-0.5 text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              {usage ? `peak ${Math.round(usage.sessions.max).toLocaleString()} in this window` : "concurrent sessions"}
            </p>
          </div>
          <div>
            <p className="m-0 flex items-center gap-1 text-[9.5px] uppercase tracking-wide opacity-55">
              <FiClock style={{ fontSize: 10 }} /> Uptime
            </p>
            <p className="m-0 mt-1 truncate text-[19px] font-bold text-white">
              {system?.uptime_seconds ? formatUptime(system.uptime_seconds + tick) : "—"}
            </p>
            <p className="m-0 mt-0.5 truncate text-[10px]" style={{ color: "rgba(255,255,255,0.5)" }}>
              {system ? formatDeviceTime(system.system_time + tick, system.timezone_offset) : "—"}
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div
          className="flex items-start gap-2 rounded-[4px] px-4 py-3"
          style={{ background: "rgba(239,68,68,0.09)", border: "1px solid rgba(239,68,68,0.25)" }}
        >
          <FiAlertTriangle className="mt-0.5 shrink-0 text-rose-500" size={14} />
          <div className="min-w-0">
            <p className="t-body m-0 font-bold text-rose-600 dark:text-rose-300">
              {device.name} could not be read
            </p>
            <p className="t-meta m-0 mt-0.5 text-rose-600/85 dark:text-rose-300/70">{error}</p>
          </div>
        </div>
      )}

      {/* ── 1. Health, on one line ────────────────────────────────────────── */}
      {/* One row from xl up, two-up on a tablet, stacked on a phone. The four are compared against
          each other far more often than any one is read alone, which is the argument for a single
          scan line and against the 2×2 block this used to be. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="CPU"
          icon={TILE_ICONS.cpu}
          variant="primary"
          value={String(cpuPct)}
          unit="%"
          caption={
            perf?.cpu_cores
              ? `${perf.cpu_cores} cores · avg ${Math.round(usage?.cpu.average ?? 0)}%`
              : "aggregate utilisation"
          }
          color="#24997c"
          points={usage?.cpu.points ?? []}
          domainMax={100}
          health={utilisationHealth(cpuPct)}
          loading={loading && !usage}
        />
        <StatTile
          label="Memory"
          icon={TILE_ICONS.memory}
          variant="info"
          value={String(memPct)}
          unit="%"
          caption={
            perf?.mem_total
              ? `${formatBytes(perf.mem_used)} of ${formatBytes(perf.mem_total)}`
              : "aggregate utilisation"
          }
          color="#3e7ead"
          points={usage?.memory.points ?? []}
          domainMax={100}
          health={utilisationHealth(memPct)}
          loading={loading && !usage}
        />
        <StatTile
          label="Sessions"
          icon={TILE_ICONS.sessions}
          variant="accent"
          value={sessionCount.toLocaleString()}
          caption={
            usage
              ? `peak ${Math.round(usage.sessions.max).toLocaleString()} in this window`
              : "concurrent sessions"
          }
          color="#e8830f"
          points={usage?.sessions.points ?? []}
          loading={loading && !usage}
        />

        {/* Services — the same Dastone `.report-card` shape as the three StatTiles (label, big
            number, delta line left; icon medallion vertically centered right), with the
            four-segment bar standing in for the coloured delta: FortiOS services only ever carry
            one of these four protocol groups, so the segments are a real proportion, not a
            decorative guess. */}
        <article className="shell-card flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <p className="m-0 truncate text-[14px] font-semibold text-(--shell-ink)">Services</p>
            {servicesLoading ? (
              <span className="shell-skeleton my-1 block h-6 w-16" />
            ) : (
              <p className="m-0 my-1 text-[20px] font-bold leading-none text-(--shell-ink)">
                {services.length}
              </p>
            )}
            <p className="m-0 truncate text-[13px] text-(--shell-ink-3)">
              {servicesError ?? `across ${serviceCategoryCount} categories`}
            </p>

            <div className="mt-2 flex items-center gap-1">
              {([
                ["TCP/UDP/SCTP", "#1e9e6b"],
                ["IP", "#3e7ead"],
                ["ICMP", "#dc9a2c"],
                ["ICMPv6", "#d0504c"],
              ] as const).map(([key, barColor]) => (
                <span
                  key={key}
                  className="h-1.5 rounded-full"
                  style={{
                    background: barColor,
                    flexGrow: services.length ? serviceBuckets[key] : 1,
                    flexBasis: 0,
                    opacity: serviceBuckets[key] ? 1 : 0.25,
                  }}
                />
              ))}
            </div>
          </div>

          <span
            className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-full text-[18px]"
            style={ICON_CHIP.warning}
            aria-hidden
          >
            <FiList />
          </span>
        </article>
      </div>

      {/* ── 2. Configuration & entitlement ──────────────────────────────────
          The port chassis and the Security Fabric panel used to sit here — both dropped as
          duplication: the chassis repeated what Network > Interfaces already draws port-by-port,
          and the fabric panel repeated the same up/down link count the chassis stated. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <SystemInformationWidget
          system={system}
          tick={tick}
          accent={currentColor}
          loading={loading}
        />
        <LicensesWidget
          licenses={snapshot?.licenses ?? null}
          error={sectionErrors.licenses}
          accent={currentColor}
          loading={loading}
        />
        <FortiGateCloudWidget
          licenses={snapshot?.licenses ?? null}
          error={sectionErrors.licenses}
          accent={currentColor}
          loading={loading}
        />
      </div>

      {/* What each port is actually carrying, right now. The panel is the one Network ▸ Interfaces
          draws — the same component, not a copy — because "which link is busy" is a question people
          ask of the dashboard and then have to go somewhere else to answer. */}
      {device && <ThroughputPanel deviceId={device.id} accent={currentColor} />}

      {/* Cadence only. Which device this is comes from the navbar picker — naming it again here
          put the same two facts on screen twice. */}
      <p className="t-meta m-0 pt-0.5 text-right">
        {snapshot
          ? `charts refresh every ${USAGE_POLL_MS / 1000}s · full snapshot every ${SNAPSHOT_POLL_MS / 1000}s`
          : "Reading the device…"}
      </p>
    </div>
  );
};

export default DashboardIndex;
