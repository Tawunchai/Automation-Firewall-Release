import React, { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FiCopy, FiDelete, FiDownload, FiMaximize2, FiMinimize2, FiMinus, FiRefreshCw, FiTerminal, FiX,
} from "react-icons/fi";
import { useSelectedDevice } from "../../../contexts/DeviceContext.logic";
import { message } from "../../ui/toast";
import type { TermStatus, TerminalHandle } from "../../../pages/config-deploy/TerminalPane";

// The CLI Console — a live shell on the selected FortiGate, from anywhere in the app.
//
// The device's own GUI has one, in the same place and for the same reason: the answer to "what does
// the firewall actually say?" is needed WHILE looking at a policy list or a VPN tunnel, not on a
// separate page you have to navigate to and lose your place from. Config Deploy still owns the
// full-page terminal and its batch pipeline; this is the same shell in a window you can put over
// whatever you were reading.
//
// It reuses TerminalPane wholesale — the same xterm instance, the same WebSocket, the same
// device-side session. There is deliberately no second implementation of the terminal: the socket
// protocol, the UTF-8 streaming and the VT100 handling were hard enough once.
//
// Layout follows the device's console (title bar, a toolbar of clear/copy/download, minimise and
// close) because that is what the shape of this window means to anyone who has used FortiOS. The
// PAINT is entirely ours: the shell surface, the accent, the hairlines. The terminal body stays
// dark in both themes, as terminals do — a light-mode terminal would fight every device that draws
// its output with ANSI colour chosen for a dark background.

// Lazily loaded, exactly as the Config Deploy route is: xterm and its addons are ~440 kB, and the
// console is opened by intent rather than on every page load.
const TerminalPane = lazy(() => import("../../../pages/config-deploy/TerminalPane"));

type ConsoleMode = "normal" | "maximized" | "minimized";

const STATUS_LABEL: Record<TermStatus, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  closed: "Session closed",
  error: "Connection failed",
};

const STATUS_DOT: Record<TermStatus, string> = {
  idle: "#64748b",
  connecting: "#f59e0b",
  connected: "#10b981",
  closed: "#64748b",
  error: "#ef4444",
};

/** One toolbar button. Icon-only, so the tooltip is the label. */
const ToolBtn: React.FC<{
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}> = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onClick={onClick}
    disabled={disabled}
    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] border-none bg-transparent text-white/60 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
  >
    {children}
  </button>
);

const CliConsole: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
  const { device } = useSelectedDevice();

  const [mode, setMode] = useState<ConsoleMode>("normal");
  const [status, setStatus] = useState<TermStatus>("idle");
  const [detail, setDetail] = useState("");
  // Bumped to force a fresh socket without changing the device — the "reconnect" button.
  const [epoch, setEpoch] = useState(0);

  const termRef = useRef<TerminalHandle | null>(null);

  const onStatus = useCallback((s: TermStatus, d?: string) => {
    setStatus(s);
    setDetail(d ?? "");
  }, []);

  // Escape closes, matching every other dialog in the console — but only when the window is not
  // maximised, where Escape first returns it to its normal size. Two Escapes to leave a maximised
  // console is the behaviour of every window manager, and it stops one stray keypress from
  // dropping a shell session someone was working in.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMode((m) => {
        if (m === "maximized") return "normal";
        onClose();
        return m;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reopening always starts from the normal size rather than from however it was left maximised
  // three pages ago.
  useEffect(() => { if (open) setMode("normal"); }, [open]);

  if (!open) return null;

  const copyAll = async () => {
    const text = termRef.current?.text() ?? "";
    if (!text.trim()) {
      message.info("There is nothing to copy yet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      message.success("Everything copied");
    } catch {
      message.error("The browser denied access to the clipboard");
    }
  };

  const download = () => {
    const text = termRef.current?.text() ?? "";
    if (!text.trim()) {
      message.info("There is nothing to save yet");
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "");
    const name = `${(device?.name ?? "fortigate").replace(/[^\w-]+/g, "-")}-cli-${stamp}.txt`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  };

  const minimized = mode === "minimized";
  const maximized = mode === "maximized";

  return createPortal(
    <>
      {/* No backdrop when maximised or minimised: a console is a window you work ALONGSIDE the app,
          not a modal that blocks it. At normal size a faint scrim still separates it from the page
          behind, and clicking it does nothing — closing a live shell by a stray click is the one
          thing this window must not do. */}
      {mode === "normal" && (
        <div className="fixed inset-0 z-9998" style={{ background: "rgba(15,23,42,0.28)" }} />
      )}

      <div
        className={[
          "fixed z-9999 flex flex-col overflow-hidden rounded-[4px]",
          minimized
            ? "bottom-4 right-4 w-72"
            : maximized
              ? "inset-3"
              : "left-1/2 top-1/2 w-[min(1100px,94vw)] -translate-x-1/2 -translate-y-1/2",
        ].join(" ")}
        style={{
          height: minimized ? undefined : maximized ? undefined : "min(660px, 82vh)",
          background: "#0d1117",
          border: "1px solid var(--shell-border)",
          boxShadow: "0 24px 60px -18px rgba(0,0,0,0.55)",
        }}
        role="dialog"
        aria-label="CLI Console"
      >
        {/* ── Title bar ─────────────────────────────────────────────────── */}
        <header
          className="flex shrink-0 items-center gap-2 px-3 py-2"
          style={{ background: "#161b22", borderBottom: "1px solid rgba(255,255,255,0.07)" }}
        >
          <FiTerminal size={14} className="shrink-0" style={{ color: "var(--accent)" }} />
          <span className="shrink-0 text-[12.5px] font-semibold text-white/90">CLI Console</span>

          {device && (
            <span className="min-w-0 truncate font-mono text-[11px] text-white/45">
              {device.name} · {device.mgmt_ip}
            </span>
          )}

          {/* The status dot lives in the title bar so it is still readable when minimised — the one
              thing you want to know about a window you cannot see is whether it is still alive. */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5 pr-1">
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: STATUS_DOT[status] }}
            />
            <span className="hidden text-[10.5px] text-white/45 sm:inline">
              {STATUS_LABEL[status]}
            </span>
          </span>

          {!minimized && (
            <>
              <ToolBtn label="Reconnect" onClick={() => setEpoch((n) => n + 1)} disabled={!device}>
                <FiRefreshCw size={13} />
              </ToolBtn>
              <ToolBtn label="Clear the screen" onClick={() => termRef.current?.clear()}>
                {/* The crossed-out block is the device console's own mark for "clear", so it reads
                    as the same control to anyone who has used the FortiGate GUI. */}
                <FiDelete size={13} />
              </ToolBtn>
              <ToolBtn label="Copy everything" onClick={() => void copyAll()}>
                <FiCopy size={13} />
              </ToolBtn>
              <ToolBtn label="Download as a file" onClick={download}>
                <FiDownload size={13} />
              </ToolBtn>
            </>
          )}

          <span className="mx-0.5 h-4 w-px shrink-0" style={{ background: "rgba(255,255,255,0.12)" }} />

          {minimized ? (
            <ToolBtn label="Restore" onClick={() => setMode("normal")}>
              <FiMaximize2 size={13} />
            </ToolBtn>
          ) : (
            <>
              <ToolBtn label="Minimise — the session stays open" onClick={() => setMode("minimized")}>
                <FiMinus size={13} />
              </ToolBtn>
              <ToolBtn
                label={maximized ? "Restore the window" : "Fill the screen"}
                onClick={() => setMode(maximized ? "normal" : "maximized")}
              >
                {maximized ? <FiMinimize2 size={13} /> : <FiMaximize2 size={13} />}
              </ToolBtn>
            </>
          )}
          <ToolBtn label="Close and end the session" onClick={onClose}>
            <FiX size={14} />
          </ToolBtn>
        </header>

        {/* ── Body ──────────────────────────────────────────────────────────
            Kept MOUNTED while minimised, only hidden. Unmounting would tear the WebSocket down and
            with it the device-side session — which is the opposite of what minimising a console
            means. `hidden` also gives the host a zero size, which TerminalPane's fit guard already
            skips rather than computing NaN rows from. */}
        <div className={minimized ? "hidden" : "flex min-h-0 flex-1 flex-col"}>
          {!device ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 text-center">
              <p className="m-0 font-mono text-[13px] text-white/30">No device selected</p>
              <p className="m-0 font-mono text-[11px] text-white/20">
                Pick a FortiGate from the selector in the top bar
              </p>
            </div>
          ) : (
            <Suspense
              fallback={
                <div className="flex flex-1 items-center justify-center">
                  <p className="m-0 font-mono text-[12px] text-white/30">Opening the terminal…</p>
                </div>
              }
            >
              <TerminalPane
                // The key forces a brand-new pane (and socket) when the device changes or the
                // reconnect button is pressed, rather than trying to re-dial an existing one.
                key={`${device.id}-${epoch}`}
                ref={termRef}
                deviceId={device.id}
                proto="ssh"
                port={device.port}
                onStatus={onStatus}
              />
            </Suspense>
          )}

          {/* Status strip — the failure detail from the socket, where there is room for it. */}
          <footer
            className="flex shrink-0 items-center gap-2 px-3 py-1.5"
            style={{ background: "#161b22", borderTop: "1px solid rgba(255,255,255,0.07)" }}
          >
            <span className="font-mono text-[10.5px] text-white/40">
              {status === "connected" ? "ssh · type away" : STATUS_LABEL[status]}
            </span>
            {detail && status === "error" && (
              <span className="min-w-0 truncate font-mono text-[10.5px] text-red-400/80">{detail}</span>
            )}
            <span className="ml-auto shrink-0 font-mono text-[10.5px] text-white/25">
              Select to copy · right-click to paste
            </span>
          </footer>
        </div>
      </div>
    </>,
    document.body,
  );
};

export default CliConsole;
