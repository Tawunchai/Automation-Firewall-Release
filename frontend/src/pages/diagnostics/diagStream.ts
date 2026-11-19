import { useCallback, useEffect, useRef, useState } from "react";
import type { PingReply, PingResult, TraceHop, TracerouteResult } from "../../api/diagnostics";

// The live half of Ping and Trace Route.
//
// Both commands HAPPEN over time and FortiOS prints them that way — measured on the lab FGT80E,
// ping replies arrive exactly 1.000s apart and each traceroute hop appears as it resolves, over a
// run that reached 31 seconds. Waiting for the whole answer throws that away: the page sits frozen
// and then everything lands at once, which reads as "it hung" right up until it doesn't.
//
// So the browser opens a WebSocket and renders what the firewall says as it says it. The socket is
// the same shape as the Config Deploy terminal's, over the same nginx upgrade path.

export type DiagTool = "ping" | "traceroute";

/** One message from the backend. See controller/diagstream/diagstream.go. */
export type DiagStreamEvent = {
  type: "ready" | "line" | "reply" | "hop" | "ping_done" | "trace_done" | "error" | "done";
  /** Always present on line/reply/hop — including as "" for the blank lines the device prints. */
  line?: string;
  reply?: PingReply;
  hop?: TraceHop;
  ping?: PingResult;
  trace?: TracerouteResult;
  resolved_ip?: string;
  message?: string;
};

export type DiagStreamParams = {
  target: string;
  count?: number;
  size?: number;
  source?: string;
};

/**
 * The WebSocket URL for one diagnostic.
 *
 * Pulled out of the hook and kept pure for the same reason terminalUrl.ts is: getting it wrong
 * fails unreadably. The browser reports a socket that opened and closed with no status, so a
 * `ws://` on an HTTPS page (blocked as mixed content, silently in some browsers) or a missing
 * `/api` prefix looks exactly like "the firewall refused us".
 */
export const diagSocketURL = (
  location: { protocol: string; host: string },
  deviceId: number,
  tool: DiagTool,
  params: DiagStreamParams,
): string => {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({ target: params.target });
  // Only sent when set. An explicit 0 or NaN would override the backend's own default with
  // nonsense, and these are ping-only options that traceroute must not carry.
  if (params.count && Number.isFinite(params.count)) q.set("count", String(params.count));
  if (params.size && Number.isFinite(params.size)) q.set("size", String(params.size));
  if (params.source?.trim()) q.set("source", params.source.trim());
  return `${scheme}//${location.host}/api/diag-stream/${deviceId}/${tool}?${q}`;
};

export type DiagStatus = "idle" | "connecting" | "running" | "done" | "error";

export type DiagStreamState = {
  status: DiagStatus;
  /** Every line the device printed, in order — the live console view. */
  lines: string[];
  /** Parsed ICMP replies, appended as they land. */
  replies: PingReply[];
  /** Parsed traceroute hops, appended as they resolve. */
  hops: TraceHop[];
  /** Filled the moment the device prints it, which for a ping by name is the DNS answer. */
  resolvedIP: string;
  pingResult: PingResult | null;
  traceResult: TracerouteResult | null;
  error: string | null;
  running: boolean;
};

const EMPTY: DiagStreamState = {
  status: "idle", lines: [], replies: [], hops: [],
  resolvedIP: "", pingResult: null, traceResult: null, error: null, running: false,
};

/**
 * Runs one diagnostic at a time and exposes its progress.
 *
 * `start` closes any socket already open, so a second click replaces the run rather than racing it
 * — the backend serialises per device anyway, and two overlapping runs would interleave into one
 * unreadable console.
 */
export function useDiagStream(deviceId: number | null, tool: DiagTool) {
  const [state, setState] = useState<DiagStreamState>(EMPTY);
  const wsRef = useRef<WebSocket | null>(null);

  const closeSocket = useCallback(() => {
    const ws = wsRef.current;
    wsRef.current = null;
    if (!ws) return;
    // Ask the backend to abort the command, not just to drop the socket: a traceroute holds the
    // device's diagnostic lock for up to 100s, and the next run would queue behind it.
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send("stop"); } catch { /* already closing */ }
    }
    // Detach before closing so the close handler cannot flip state for a run we abandoned.
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    try { ws.close(); } catch { /* already closed */ }
  }, []);

  // A socket must not outlive the page that opened it.
  useEffect(() => closeSocket, [closeSocket]);

  const stop = useCallback(() => {
    closeSocket();
    setState((s) => (s.running ? { ...s, status: "done", running: false } : s));
  }, [closeSocket]);

  const start = useCallback((params: DiagStreamParams) => {
    if (deviceId == null || !params.target.trim()) return;
    closeSocket();
    setState({ ...EMPTY, status: "connecting", running: true });

    let ws: WebSocket;
    try {
      ws = new WebSocket(diagSocketURL(window.location, deviceId, tool, params));
    } catch (err: unknown) {
      setState({ ...EMPTY, status: "error", error: (err instanceof Error && err.message) || "Could not open the connection" });
      return;
    }
    wsRef.current = ws;

    ws.onmessage = (msg) => {
      let ev: DiagStreamEvent;
      try {
        ev = JSON.parse(msg.data as string);
      } catch {
        return;
      }
      setState((s) => {
        switch (ev.type) {
          case "ready":
            return { ...s, status: "running" };
          case "line":
            return {
              ...s,
              status: "running",
              lines: ev.line !== undefined ? [...s.lines, ev.line] : s.lines,
              resolvedIP: ev.resolved_ip || s.resolvedIP,
            };
          case "reply":
            return {
              ...s,
              status: "running",
              lines: ev.line !== undefined ? [...s.lines, ev.line] : s.lines,
              replies: ev.reply ? [...s.replies, ev.reply] : s.replies,
            };
          case "hop":
            return {
              ...s,
              status: "running",
              lines: ev.line !== undefined ? [...s.lines, ev.line] : s.lines,
              hops: ev.hop ? [...s.hops, ev.hop] : s.hops,
              resolvedIP: ev.resolved_ip || s.resolvedIP,
            };
          case "ping_done":
            // The summary is authoritative — the backend built it with the same parser the
            // non-streaming path uses. The incrementally collected replies were the preview.
            return {
              ...s,
              pingResult: ev.ping ?? null,
              replies: ev.ping?.replies ?? s.replies,
              resolvedIP: ev.ping?.resolved_ip || s.resolvedIP,
            };
          case "trace_done":
            return {
              ...s,
              traceResult: ev.trace ?? null,
              hops: ev.trace?.hops ?? s.hops,
              resolvedIP: ev.trace?.resolved_ip || s.resolvedIP,
            };
          case "error":
            return { ...s, status: "error", error: ev.message || "The command failed", running: false };
          case "done":
            return { ...s, status: s.status === "error" ? "error" : "done", running: false };
          default:
            return s;
        }
      });
    };

    ws.onerror = () => {
      setState((s) =>
        // A socket error AFTER the run finished is just the close handshake — reporting it would
        // turn a successful traceroute into a red banner.
        s.running
          ? { ...s, status: "error", error: "The connection to the server failed", running: false }
          : s);
    };

    ws.onclose = () => {
      wsRef.current = null;
      setState((s) =>
        s.running
          ? { ...s, status: s.error ? "error" : "done", running: false }
          : s);
    };
  }, [deviceId, tool, closeSocket]);

  const reset = useCallback(() => {
    closeSocket();
    setState(EMPTY);
  }, [closeSocket]);

  return { ...state, start, stop, reset };
}
