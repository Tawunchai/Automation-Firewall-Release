import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { FiChevronDown, FiChevronUp, FiPlay, FiTerminal } from "react-icons/fi";
import { confirm } from "../../components/ui/confirm";
import type { NetworkDevice } from "../../api/device";
import { attachTerminal, createTerminal } from "./xtermSetup";
import { terminalSocketURL, type TermProto, type TermStatus } from "./terminalUrl";
import {
  appendCapped, liveTargets, overallStatus, scriptCommandCount, scriptToKeystrokes, statusSummary,
  type DeviceSession,
} from "./multiSession";

// Multi Config — one keyboard, N live shells.
//
// The single-device pane is a screen for one session. This is the same idea widened: a real shell is
// opened on every selected device, everything typed goes to ALL of them, and the screen shows one
// device's output at a time — you pick which by clicking its chip.
//
// WHY ONE EMULATOR AND N BUFFERS, rather than N terminals side by side
// A terminal is not a log. The device's output contains cursor moves, in-place rewrites (the
// `--More--` pager, Tab completion redrawing the line) and colour, so reading it needs an emulator,
// and four emulators is four GPU contexts and four measured containers for output nobody is reading
// three quarters of. Instead each device's bytes are kept verbatim, and switching focus replays that
// device's stream into the one emulator — so the screen you get is the real terminal for whichever
// device you are watching, with full scrollback, while the other three keep filling in behind it.
//
// WHY THE SESSIONS ARE REAL SHELLS, not the batch pipeline
// Because state between commands is the whole point of a config push: `config firewall address` /
// `edit x` / `next` / `end` is one session or it is nothing. The batch pipeline (POST
// /config-deploys) runs a whole script in one netmiko session and is still the right tool for a
// recorded, retryable job across the fleet — but it cannot be typed at, and this can.
//
// WHAT IT REFUSES TO DO
// Send to a session that is not connected. `liveTargets` is the only list that ever receives input,
// and the header counts the same list, so the number on screen is the number of firewalls a
// keystroke reaches — never the number of devices that were ticked.

export type MultiTerminalPaneProps = {
  /** The selected devices, in list order. */
  devices: NetworkDevice[];
  proto: TermProto;
  /** Bumped by the page to force every session to re-dial. */
  epoch: number;
  onStatus?: (s: TermStatus, detail?: string) => void;
  disabledReason?: string;
  accent: string;
};

type Live = { ws: WebSocket; decoder: TextDecoder };

const DOT: Record<TermStatus, string> = {
  idle: "#484f58",
  connecting: "#d29922",
  connected: "#3fb950",
  closed: "#484f58",
  error: "#ff7b72",
};

export const MultiTerminalPane: React.FC<MultiTerminalPaneProps> = ({
  devices, proto, epoch, onStatus, disabledReason, accent,
}) => {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  /** Live sockets, keyed by device id. Not state: they are not rendered, and they must not re-run
   *  the connect effect when they change. */
  const wsRef = useRef<Map<number, Live>>(new Map());
  /** The rendered half — status and scrollback per device. */
  const [sessions, setSessions] = useState<DeviceSession[]>([]);
  const sessionsRef = useRef<DeviceSession[]>([]);
  sessionsRef.current = sessions;

  const [focusedId, setFocusedId] = useState<number | null>(null);
  const focusedRef = useRef<number | null>(null);
  focusedRef.current = focusedId;

  const [script, setScript] = useState("");
  const [composerOpen, setComposerOpen] = useState(true);
  const [sending, setSending] = useState(false);

  const deviceKey = devices.map((d) => d.id).join(",");

  // ── The emulator. One, created once. ──
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = createTerminal();
    const detach = attachTerminal(term, hostRef.current);
    termRef.current = term;
    return () => { detach(); termRef.current = null; };
  }, []);

  const patch = useCallback((deviceId: number, up: Partial<DeviceSession>) => {
    setSessions((prev) => prev.map((s) => (s.deviceId === deviceId ? { ...s, ...up } : s)));
  }, []);

  // ── The sessions. One socket per selected device; re-dialled when the selection, the protocol
  //    or the epoch changes. ──
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    // Close whatever was open before rebuilding — a selection change must not leave an orphan shell
    // holding an admin session on a device the user has just deselected.
    for (const { ws } of wsRef.current.values()) ws.close();
    wsRef.current = new Map();

    if (devices.length === 0) {
      setSessions([]);
      setFocusedId(null);
      onStatus?.("idle");
      return;
    }

    setSessions(devices.map((d) => ({
      deviceId: d.id, name: d.name, status: "connecting", detail: "", buffer: "",
    })));
    setFocusedId(devices[0].id);
    // The ref is assigned during render, which is one render too late here: the first device's
    // "ready" banner can arrive before React re-renders, and `emit` would then decide nobody is
    // watching and skip the screen (the text still lands in the buffer, so it would appear only
    // after switching chips — a first paint that looks like a dead session).
    focusedRef.current = devices[0].id;
    term.reset();
    term.write(`\x1b[90mOpening ${devices.length} shell(s) over ${proto}…\x1b[0m\r\n`);
    onStatus?.("connecting", `${devices.length} devices`);

    for (const device of devices) {
      const ws = new WebSocket(terminalSocketURL(window.location, device.id, proto));
      ws.binaryType = "arraybuffer";
      // A multi-byte character can straddle two chunks, so each device decodes with its own
      // streaming decoder — sharing one would interleave four devices' partial characters.
      const decoder = new TextDecoder("utf-8");
      wsRef.current.set(device.id, { ws, decoder });

      /** Appends to this device's buffer, and to the screen when it is the one being watched. */
      const emit = (text: string) => {
        setSessions((prev) => prev.map((s) =>
          s.deviceId === device.id ? { ...s, buffer: appendCapped(s.buffer, text) } : s));
        if (focusedRef.current === device.id) termRef.current?.write(text);
      };

      ws.onmessage = (e) => {
        if (typeof e.data === "string") {
          const msg = JSON.parse(e.data) as { type: string; data?: string };
          if (msg.type === "ready") {
            patch(device.id, { status: "connected", detail: msg.data ?? "" });
            emit(`\x1b[32m● ${device.name} (${device.mgmt_ip}) ready\x1b[0m\r\n`);
          } else if (msg.type === "error") {
            patch(device.id, { status: "error", detail: msg.data ?? "connection failed" });
            emit(`\r\n\x1b[31m✕ ${device.name}: ${msg.data ?? "connection failed"}\x1b[0m\r\n`);
          }
          return;
        }
        emit(decoder.decode(new Uint8Array(e.data), { stream: true }));
      };

      ws.onerror = () => {
        patch(device.id, { status: "error", detail: "connection failed" });
        emit(`\r\n\x1b[31m✕ ${device.name}: could not connect — check the device is online and ${proto} is enabled\x1b[0m\r\n`);
      };

      ws.onclose = () => {
        if (wsRef.current.get(device.id)?.ws !== ws) return; // superseded by a re-dial
        setSessions((prev) => prev.map((s) =>
          s.deviceId === device.id && s.status !== "error" ? { ...s, status: "closed" } : s));
      };
    }

    return () => {
      for (const { ws } of wsRef.current.values()) ws.close();
      wsRef.current = new Map();
    };
    // `devices` is rebuilt on every render by the page's filter, so the effect keys on the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceKey, proto, epoch, patch, onStatus]);

  /** Sends raw keystrokes to every CONNECTED session. Returns how many got them. */
  const broadcast = useCallback((data: string): number => {
    const targets = liveTargets(sessionsRef.current);
    let sent = 0;
    for (const id of targets) {
      const live = wsRef.current.get(id);
      if (live && live.ws.readyState === WebSocket.OPEN) {
        live.ws.send(JSON.stringify({ type: "data", data }));
        sent++;
      }
    }
    return sent;
  }, []);

  // ── Typing. Every keystroke goes to every live device, untouched — Tab, "?" and Ctrl+C
  //    included, because those are the ones worth having. ──
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;
    const sub = term.onData((data) => { broadcast(data); });
    return () => sub.dispose();
  }, [broadcast]);

  // ── Switching which device is on screen: replay its stream into the emulator. ──
  const focusDevice = useCallback((deviceId: number) => {
    setFocusedId(deviceId);
    // Eagerly, for the same reason as the connect effect: output arriving in the same tick must go
    // to the device that was just clicked, not to the one that was on screen a moment ago.
    focusedRef.current = deviceId;
    const term = termRef.current;
    const session = sessionsRef.current.find((s) => s.deviceId === deviceId);
    if (!term || !session) return;
    term.reset();
    term.write(session.buffer);
    term.focus();
  }, []);

  const status = overallStatus(sessions);
  const summary = statusSummary(sessions);
  const targets = useMemo(() => liveTargets(sessions), [sessions]);

  // Report the aggregate upward for the page's status bar.
  useEffect(() => { onStatus?.(status, summary); }, [status, summary, onStatus]);

  const runScript = useCallback(async () => {
    const keys = scriptToKeystrokes(script);
    if (!keys) return;
    const count = scriptCommandCount(script);
    const names = sessions.filter((s) => s.status === "connected").map((s) => s.name);
    if (names.length === 0) return;

    // A script reaches several production firewalls at once and cannot be taken back, so it names
    // both halves of what is about to happen — how many commands, and to which devices.
    const ok = await confirm({
      title: `Send ${count} command(s) to ${names.length} device(s)`,
      content: (
        <>
          <p className="ink-2 mb-1 text-[11px]">This script is typed into every device below at the same time:</p>
          <div className="shell-scroll max-h-32 overflow-y-auto">
            {names.map((n) => (
              <p key={n} className="ink m-0 text-[11px] font-semibold">• {n}</p>
            ))}
          </div>
          <p className="ink-3 mt-1.5 text-[10.5px]">
            Devices that are not connected receive nothing — the terminal header shows the count
          </p>
        </>
      ),
      okText: `Send ${count} command(s)`,
      cancelText: "Cancel",
    });
    if (!ok) return;

    setSending(true);
    try {
      broadcast(keys);
      setScript("");
    } finally {
      setSending(false);
    }
  }, [script, sessions, broadcast]);

  const focused = sessions.find((s) => s.deviceId === focusedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* ── Device chips: who is listening, and whose output is on screen ── */}
      <div
        className="flex shrink-0 flex-wrap items-center gap-1.5 px-3 py-2"
        style={{ background: "#161b22", borderBottom: "1px solid rgba(255,255,255,0.06)" }}
      >
        {sessions.length === 0 ? (
          <span className="font-mono text-[11px] text-white/25">← Pick the devices you want to configure together</span>
        ) : (
          sessions.map((s) => {
            const on = s.deviceId === focusedId;
            return (
              <button
                key={s.deviceId}
                type="button"
                onClick={() => focusDevice(s.deviceId)}
                title={s.detail || s.name}
                className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10.5px] transition"
                style={{
                  borderColor: on ? accent : "rgba(255,255,255,0.12)",
                  background: on ? `${accent}22` : "transparent",
                  color: on ? "#fff" : "rgba(255,255,255,0.55)",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: DOT[s.status] }} />
                {s.name}
              </button>
            );
          })
        )}
        {sessions.length > 0 && (
          <span className="ml-auto flex items-center gap-1 font-mono text-[10.5px] text-white/40">
            <FiTerminal size={10} />
            Typing → {targets.length} device(s)
          </span>
        )}
      </div>

      {/* ── The one emulator ── */}
      <div role="presentation" className="relative min-h-0 flex-1 overflow-hidden" onClick={() => termRef.current?.focus()}>
        {/* Padding on the wrapper, never on the host xterm measures — see TerminalPane. */}
        <div className="absolute inset-0 px-3 pb-1 pt-2">
          <div ref={hostRef} className="h-full w-full" />
        </div>

        {sessions.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <p className="font-mono text-[13px] text-white/25">Multi Config</p>
            <p className="font-mono text-[11px] text-white/15">
              {disabledReason ?? "← Tick one or more devices to open their shells together"}
            </p>
          </div>
        )}
      </div>

      {/* ── Script composer ── */}
      <div className="shrink-0" style={{ background: "#161b22", borderTop: "1px solid rgba(255,255,255,0.06)" }}>
        <button
          type="button"
          onClick={() => setComposerOpen((v) => !v)}
          className="flex w-full items-center gap-1.5 px-3 py-1.5 font-mono text-[10.5px] text-white/40 transition hover:text-white/70"
        >
          {composerOpen ? <FiChevronDown size={11} /> : <FiChevronUp size={11} />}
          Script (paste a whole block and send it in one go)
          <span className="ml-auto text-white/25">
            {focused ? `Viewing: ${focused.name}` : ""}
          </span>
        </button>

        {composerOpen && (
          <div className="px-3 pb-2">
            <textarea
              value={script}
              onChange={(e) => setScript(e.target.value)}
              onKeyDown={(e) => {
                // Ctrl/Cmd+Enter runs. Plain Enter stays a newline — a config block is written over
                // several lines and sending on the first one would be a trap.
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void runScript(); }
              }}
              rows={4}
              spellCheck={false}
              placeholder={"config firewall address\n    edit \"LAN-Net\"\n        set subnet 10.0.1.0 255.255.255.0\n    next\nend"}
              className="w-full resize-y rounded-[4px] border px-2.5 py-2 font-mono text-[12px] leading-relaxed outline-none"
              style={{
                background: "#0d1117",
                borderColor: "rgba(255,255,255,0.10)",
                color: "#c9d1d9",
              }}
            />
            <div className="mt-1.5 flex items-center gap-2">
              <span className="font-mono text-[10px] text-white/25">
                {scriptCommandCount(script)} command(s) · Ctrl+Enter to send
              </span>
              <button
                type="button"
                onClick={() => void runScript()}
                disabled={sending || targets.length === 0 || scriptCommandCount(script) === 0}
                className="ml-auto flex items-center gap-1.5 rounded-[4px] px-3 py-1 text-[11px] font-semibold text-white transition disabled:opacity-40"
                style={{ background: accent }}
              >
                {sending
                  ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  : <FiPlay size={10} />}
                Send to {targets.length} device(s)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default MultiTerminalPane;
