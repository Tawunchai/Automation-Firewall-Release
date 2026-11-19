import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FiCheck, FiHardDrive, FiLayers, FiRefreshCw, FiTerminal, FiZap } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { message } from "../../components/ui/toast";
import { ListDevices, type NetworkDevice } from "../../api/device";
import TerminalPane, { type TermProto, type TermStatus } from "./TerminalPane";
import MultiTerminalPane from "./MultiTerminalPane";

// Config Deploy — an interactive shell on a device.
//
// This page used to fake a terminal on top of the batch pipeline: each command became a
// config-deploy row, went through Redis to the Python worker, which opened a NEW SSH connection,
// ran the one command, disconnected, and POSTed the output back for the browser to find on its
// next 800 ms poll. That measured 4.58 s per command against the lab FortiGate, and no amount of
// tuning could have made it behave like a shell, because a shell is a *session*:
//
//   · `config firewall address` then `edit 1` arrived as two unrelated logins, the second one back
//     at the root prompt
//   · FortiOS's own mid-command questions ("1 admin session(s) are currently connected on this
//     interface. Are you sure you want to continue? (y/n)") could not be answered at all
//   · Tab completion and `?` help were approximated by ~430 lines of hard-coded FortiOS command
//     tables in this file, which could only ever match one firmware build
//
// So the terminal now holds one real connection over a WebSocket (see TerminalPane and
// services/terminal.go) and those tables are gone — the device completes against its own firmware.
// Measured after: ~240 ms to connect, ~0.1 s to first output.
//
// The batch endpoints (/config-deploys) are untouched and still right for what they were built
// for: pushing a script to many devices at once, recorded, audited and retryable. That is a job.
// Typing at a prompt is not.

const PROTOCOLS: { value: TermProto; label: string; hint: string }[] = [
  // SSH first and default. Both are supported because the fleet is reached both ways, but SSH is
  // the one that works on an unmodified FortiGate: it is in the default `allowaccess`, telnet is
  // not. Defaulting to the protocol that usually connects beats defaulting to one that usually
  // times out — and the terminal names the other one when a dial fails, so switching is one click.
  { value: "ssh", label: "SSH", hint: "port 22" },
  { value: "telnet", label: "Telnet", hint: "port 23" },
];

const STATUS_LABEL: Record<TermStatus, string> = {
  idle: "disconnected",
  connecting: "connecting…",
  connected: "connected",
  closed: "session closed",
  error: "connection failed",
};

const STATUS_DOT: Record<TermStatus, string> = {
  idle: "#484f58",
  connecting: "#d29922",
  connected: "#3fb950",
  closed: "#484f58",
  error: "#ff7b72",
};

const ConfigDeployPage: React.FC = () => {
  const { currentColor } = useStateContext();
  // The shell is admin-only, and the backend enforces that BEFORE the WebSocket upgrade — after
  // which it can no longer send an HTTP status, so a non-admin would otherwise just see a socket
  // that opens and closes with nothing on screen. Saying so here is the difference between a
  // permission and a mystery.
  // isAdmin comes from the context, which trims and lower-cases the role first. The
  // hand-rolled `role === "admin"` this replaced missed a role stored as "Admin" — and the
  // router did not, so it served the admin page while every button on it stayed hidden.
  const { isAdmin } = useAuth();
  const accentGrad = `linear-gradient(135deg,${currentColor},color-mix(in srgb,${currentColor} 65%,#a855f7))`;

  const [devices, setDevices] = useState<NetworkDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [proto, setProto] = useState<TermProto>("ssh");
  const [status, setStatus] = useState<TermStatus>("idle");
  const [detail, setDetail] = useState("");
  // Bumped to force a reconnect without changing the device or the protocol.
  const [epoch, setEpoch] = useState(0);

  // ── Multi Config ──
  //
  // The same shell, opened on several devices at once, with one keyboard driving all of them (see
  // MultiTerminalPane). It is a MODE rather than a separate page because everything around the
  // terminal — the inventory, the protocol, the admin gate — is identical; only the number of
  // sessions changes. One device selected in multi mode behaves exactly like single mode, which is
  // what makes "start with one, add the rest" work without switching screens.
  const [multi, setMulti] = useState(false);
  const [multiIds, setMultiIds] = useState<number[]>([]);

  const selectedDev = devices.find((d) => d.id === selectedId) ?? null;
  // Kept in the inventory's order, not click order, so the chips read the same way as the list.
  const multiDevices = useMemo(
    () => devices.filter((d) => multiIds.includes(d.id)),
    [devices, multiIds],
  );

  const toggleMultiDevice = useCallback((id: number) => {
    setMultiIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }, []);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      setDevices(await ListDevices());
    } catch {
      message.error("Failed to load devices");
    } finally {
      setLoadingDevices(false);
    }
  }, []);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const onStatus = useCallback((s: TermStatus, d?: string) => {
    setStatus(s);
    setDetail(d ?? "");
  }, []);

  return (
    // The page title and breadcrumb now come from the navbar (same as every other page since the
    // Dastone pass), not a hero banner here — so this column's height only has the navbar itself
    // to subtract, not a second, variable-height hero above it.
    <div className="flex flex-col gap-4" style={{ height: "calc(100dvh - 92px)" }}>
      {/* A bounded height, not an auto one. The terminal is the only thing on this page that would
          otherwise grow without limit: xterm measures its container to decide how many rows to
          draw, so a container that sizes to ITS content feeds a loop (see TerminalPane). Pinning
          the row to the viewport also means the shell fills the screen the way a terminal window
          does, instead of pushing the protocol picker and the status bar below the fold.

          flex-1 + min-h-0 take the rest of the column's height — see the comment above. min-h-105
          keeps it usable on a short window, where the page scrolls instead. */}
      <div
        className="grid min-h-105 flex-1 gap-4 lg:grid-cols-[280px_1fr]"
      >
        {/* ── Device list + protocol ── */}
        <div className="panel flex min-h-0 flex-col overflow-hidden">
          <div className="hairline-b2 flex shrink-0 items-center justify-between gap-2 px-5 py-3">
            <p className="t-label m-0">{multi ? "Select Devices" : "Select Device"}</p>
            <button
              type="button"
              aria-label="Refresh devices"
              onClick={() => void loadDevices()}
              disabled={loadingDevices}
              className="btn-icon"
            >
              <FiRefreshCw size={12} className={loadingDevices ? "animate-spin" : ""} />
            </button>
          </div>

          {/* Mode. Switching does NOT carry the selection across: a device that was fine to open a
              shell on alone is not automatically one you meant to broadcast to, and the count in
              the terminal header is the only thing standing between a typed line and several
              production firewalls. Start each mode from an explicit choice. */}
          <div className="hairline-b2 shrink-0 px-4 py-2.5">
            <div className="seg w-full">
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => { setMulti(false); setMultiIds([]); }}
                className={`seg-item flex-1${!multi ? " seg-item--on" : ""}`}
                aria-label="Open one shell at a time"
              >
                <FiTerminal size={11} className="mr-1 inline" /> Single
              </button>
              <button
                type="button"
                disabled={!isAdmin}
                onClick={() => { setMulti(true); setSelectedId(null); }}
                className={`seg-item flex-1${multi ? " seg-item--on" : ""}`}
                aria-label="Open several shells at once and type into all of them together"
              >
                <FiLayers size={11} className="mr-1 inline" /> Multi Config
              </button>
            </div>
            {multi && (
              <div className="mt-2 flex items-center gap-2">
                <span className="field-hint m-0 flex-1">
                  Pick one device or more — what you type goes to every device that is connected
                </span>
                <button
                  type="button"
                  onClick={() => setMultiIds(multiIds.length === devices.length ? [] : devices.map((d) => d.id))}
                  disabled={devices.length === 0}
                  className="btn btn-ghost btn-sm shrink-0"
                >
                  {multiIds.length === devices.length && devices.length > 0 ? "Clear" : "Select all"}
                </button>
              </div>
            )}
          </div>

          {loadingDevices ? (
            <div className="ink-3 flex items-center gap-2 px-5 py-8 text-[13px]">
              <div className="hairline h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" /> Loading…
            </div>
          ) : devices.length === 0 ? (
            <div className="ink-3 px-5 py-8 text-center text-[13px]">No FortiGate devices found</div>
          ) : (
            <div className="shell-scroll min-h-0 flex-1 overflow-y-auto">
              {devices.map((d) => {
                // In multi mode a row is a checkbox, in single mode a radio — the same list, two
                // meanings, so the row says which one it is rather than leaving the user to guess
                // whether clicking a second device adds it or replaces it.
                const active = multi ? multiIds.includes(d.id) : d.id === selectedId;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      if (!isAdmin) return;
                      if (multi) toggleMultiDevice(d.id);
                      else setSelectedId(d.id);
                    }}
                    disabled={!isAdmin}
                    className="hairline-b2 flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition last:border-0"
                    style={{
                      borderLeft: `3px solid ${active ? currentColor : "transparent"}`,
                      backgroundColor: active ? `${currentColor}10` : undefined,
                    }}
                  >
                    {multi ? (
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[4px] border-2 transition"
                        style={{
                          borderColor: active ? currentColor : "var(--shell-border)",
                          background: active ? currentColor : "transparent",
                          color: "#fff",
                        }}
                      >
                        {active ? <FiCheck size={14} strokeWidth={3} /> : <FiHardDrive size={13} className="ink-3" />}
                      </span>
                    ) : (
                      <span
                        className="medallion h-8 w-8 shrink-0 text-white"
                        style={{ background: active ? accentGrad : "var(--shell-ink-3)" }}
                      >
                        <FiHardDrive size={13} />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="ink block truncate text-[12px] font-semibold">{d.name}</span>
                      <span className="t-mono ink-3 block">{d.mgmt_ip}</span>
                    </span>
                    <span className="flex flex-col items-end gap-1">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: d.status === "active" ? "#10b981" : "#94a3b8" }}
                      />
                      {active && !multi && (
                        <span className="text-[9px] font-bold" style={{ color: currentColor }}>
                          {STATUS_LABEL[status].toUpperCase()}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Protocol. `shrink-0` and outside the scrolling list on purpose: it is a connection
              setting, not a row, and it must stay reachable no matter how many devices there are.
              Changing it re-dials. */}
          <div className="hairline-t shrink-0 px-4 py-3">
            <p className="t-label m-0 mb-2">Connect via</p>
            <div className="seg w-full">
              {PROTOCOLS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => setProto(p.value)}
                  className={`seg-item flex-1${proto === p.value ? " seg-item--on" : ""}`}
                >
                  {p.label}
                  <span className="ink-3 ml-1 text-[10px] font-normal">{p.hint}</span>
                </button>
              ))}
            </div>
            <p className="field-hint m-0 mt-2">
              {isAdmin
                ? `The device must have ${proto} in the allowaccess list of the interface you connect through`
                : "Only an admin can open a shell"}
            </p>
          </div>
        </div>

        {/* ── Terminal ── */}
        <div
          className="terminal-shell flex min-h-0 flex-col overflow-hidden rounded-[4px] border border-white/8 shadow-lg transition-shadow"
          style={{ background: "#0d1117" }}
        >
          {/* Title bar */}
          <div
            className="flex shrink-0 items-center justify-between px-4 py-2"
            style={{ background: "#161b22", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex items-center gap-1.5">
                <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
                <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
                <span className="h-3 w-3 rounded-full bg-[#28c840]" />
              </span>
              {multi
                ? <FiLayers size={11} className="ml-2 shrink-0 text-amber-400" />
                : <FiTerminal size={11} className="ml-2 shrink-0 text-green-400" />}
              <span className="truncate font-mono text-[12px] text-white/50">
                {multi
                  ? multiDevices.length === 0
                    ? "Multi Config — select devices"
                    : `Multi Config · ${multiDevices.length} devices · ${proto}`
                  : selectedDev
                    ? `${selectedDev.name} (${selectedDev.mgmt_ip}) · ${proto}`
                    : "FortiOS CLI Terminal — select a device"}
              </span>
            </div>
            <div className="hidden shrink-0 items-center gap-3 sm:flex">
              {/* The device provides completion and history now, so this line states what reaches
                  it — it is no longer a list of things this page implements. */}
              <span className="font-mono text-[10px] text-white/20">
                Tab=complete ?=help ↑↓=history Ctrl+C=abort
              </span>
              {(multi ? multiDevices.length > 0 : !!selectedDev) && (
                <button
                  type="button"
                  onClick={() => setEpoch((n) => n + 1)}
                  className="flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] text-white/40 transition hover:text-white/80"
                >
                  <FiZap size={10} /> reconnect{multi ? " all" : ""}
                </button>
              )}
            </div>
          </div>

          {/* The key remounts the pane on reconnect, which is the simplest correct way to drop a
              half-open socket and start clean. */}
          {multi ? (
            <MultiTerminalPane
              devices={isAdmin ? multiDevices : []}
              proto={proto}
              epoch={epoch}
              accent={currentColor}
              onStatus={onStatus}
              disabledReason={isAdmin ? undefined : "Only an admin can open a shell"}
            />
          ) : (
            <TerminalPane
              key={`${selectedId}-${proto}-${epoch}`}
              deviceId={isAdmin ? selectedId : null}
              proto={proto}
              onStatus={onStatus}
              disabledReason={isAdmin ? undefined : "Only an admin can open a shell"}
            />
          )}

          {/* Status bar */}
          <div
            className="flex shrink-0 items-center justify-between px-4 py-1.5"
            style={{ background: "#161b22", borderTop: "1px solid rgba(255,255,255,0.06)" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: STATUS_DOT[status] }}
              />
              <span className="truncate font-mono text-[10px] text-white/30">
                {STATUS_LABEL[status]}
                {detail && status !== "connected" ? ` — ${detail}` : ""}
              </span>
            </div>
            <span className="shrink-0 font-mono text-[10px] text-white/20">
              {multi
                ? multiDevices.map((d) => d.mgmt_ip).join(", ")
                : status === "connected" && detail ? detail : selectedDev?.mgmt_ip ?? ""}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigDeployPage;
