import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import { attachTerminal, createTerminal, terminalText } from "./xtermSetup";
import { terminalSocketURL, type TermProto, type TermStatus } from "./terminalUrl";

export type { TermProto, TermStatus };

// A real terminal, bound to a live shell on the device.
//
// WHAT THIS REPLACES
// The old terminal was a text box that posted each command through the batch pipeline — a
// config-deploy row, a Redis job, a Python worker that opened a NEW SSH connection per command,
// then a result the browser polled for every 800 ms. Measured: 4.58 s for `get system status`.
// Worse than slow, it could not be a terminal: every command ran in a fresh login, so
// `config firewall address` followed by `get` arrived as two unrelated sessions, and anything the
// device asked mid-command — FortiOS's "1 admin session(s) are currently connected on this
// interface. Are you sure you want to continue? (y/n)" — could not be answered at all.
//
// Now the socket carries one persistent shell and this component is a screen for it: keystrokes go
// out verbatim, bytes come back and are drawn. Same measurement: ~240 ms to connect, ~0.1 s to
// first output.
//
// WHY xterm.js RATHER THAN RENDERING THE TEXT
// The device speaks VT100. Its output contains cursor moves, in-place rewrites (the `--More--`
// pager, tab-completion redrawing the line), colour, and backspace. Printing that as text puts
// escape sequences on screen; interpreting it correctly is a terminal emulator, and writing a
// second-rate one was not worth it. It is imported only by this page, which is a lazy route.
//
// The device echoes what is typed (the PTY is requested with ECHO on), so there is no local input
// line and no local command history — the device provides both, exactly as PuTTY sees it. That is
// also why the old page's ~430 lines of hard-coded FortiOS completion tables are gone: Tab now
// reaches the device, which completes against its own firmware instead of a table that could only
// ever approximate one build.

interface TerminalPaneProps {
  deviceId: number | null;
  proto: TermProto;
  /** Optional port override; the backend defaults to 22/23 by protocol. */
  port?: number;
  /** Reported upward so the page can show it in the status bar. */
  onStatus?: (s: TermStatus, detail?: string) => void;
  /** Shown instead of "select a device" when opening a shell is not allowed at all. */
  disabledReason?: string;
}

/**
 * What a container can do to the terminal from outside it.
 *
 * Exposed for the CLI Console's toolbar (clear / copy / download), which needs the scrollback that
 * only xterm has. Deliberately three plain functions rather than the Terminal instance itself: the
 * console has no business driving the emulator, and handing it out would make every future change
 * in here a change to that component's contract.
 */
export type TerminalHandle = {
  /** Clears the screen AND the scrollback, like the console's own "clear" button. */
  clear: () => void;
  /** The whole scrollback as plain text, trailing blank lines trimmed. */
  text: () => string;
  focus: () => void;
};

const TerminalPane = forwardRef<TerminalHandle, TerminalPaneProps>(function TerminalPane(
  { deviceId, proto, port, onStatus, disabledReason }, ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<TermStatus>("idle");

  const report = useCallback((s: TermStatus, detail?: string) => {
    setStatus(s);
    onStatus?.(s, detail);
  }, [onStatus]);

  // ── The terminal itself. Created once and reused across connections, so scrollback survives a
  //    reconnect and the user does not lose what they were reading.
  useEffect(() => {
    if (!hostRef.current || termRef.current) return;
    const term = createTerminal();
    const detach = attachTerminal(term, hostRef.current);
    termRef.current = term;
    return () => {
      detach();
      termRef.current = null;
    };
  }, []);

  // ── The connection. Re-dials whenever the device or protocol changes.
  useEffect(() => {
    const term = termRef.current;
    if (!term) return;

    wsRef.current?.close();
    wsRef.current = null;

    if (!deviceId) {
      report("idle");
      return;
    }

    term.reset();
    // Written WITHOUT a newline so it can be erased in place once the session opens. With
    // writeln() the cursor had already moved on, so the erase below cleared the next (empty) line
    // and "connecting over ssh…" stayed above the prompt for the rest of the session — where it
    // read as part of the device's own output.
    term.write(`\x1b[90mconnecting over ${proto}…\x1b[0m`);
    report("connecting");

    const ws = new WebSocket(terminalSocketURL(window.location, deviceId, proto, port));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;

    // A multi-byte character can straddle two chunks, so decoding is streamed rather than
    // per-message — otherwise Thai text in a comment field arrives as replacement characters.
    const decoder = new TextDecoder("utf-8");

    ws.onmessage = (e) => {
      if (typeof e.data === "string") {
        const msg = JSON.parse(e.data) as { type: string; data?: string };
        if (msg.type === "ready") {
          term.write("\r\x1b[2K");   // return to column 0, then erase that line
          report("connected", msg.data);
        } else if (msg.type === "error") {
          term.writeln(`\r\n\x1b[31m${msg.data ?? "connection failed"}\x1b[0m`);
          // A dial that times out or is refused almost always means the protocol is simply not in
          // the interface's `allowaccess` — a dropped port gives no fast failure, so the user has
          // just waited out the whole timeout for a raw dial error. Naming the other protocol
          // turns that into something to act on. (The lab device, for one, allows only SSH.)
          if (/dial|timeout|refused/i.test(msg.data ?? "")) {
            const other = proto === "telnet" ? "SSH" : "Telnet";
            term.writeln(
              `\x1b[33mThe device may not have ${proto} enabled — try ${other} instead, ` +
              `or add ${proto} to the interface's allowaccess\x1b[0m`,
            );
          }
          report("error", msg.data);
        }
        return;
      }
      term.write(decoder.decode(new Uint8Array(e.data), { stream: true }));
    };

    ws.onerror = () => {
      // The browser gives no detail on a socket error by design, so this says what is actionable
      // rather than repeating "an error occurred".
      term.writeln(
        `\r\n\x1b[31mCould not connect — check the device is online and that ${proto} is ` +
        `in the interface's allowaccess\x1b[0m`,
      );
      report("error", "connection failed");
    };

    ws.onclose = () => {
      if (wsRef.current === ws) {
        term.writeln("\r\n\x1b[90msession closed\x1b[0m");
        report("closed");
      }
    };

    // Every keystroke goes to the device untouched — including Tab (completion), "?" (context
    // help) and Ctrl+C (abort). Interpreting any of them here is what would break them.
    const sub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "data", data }));
      }
    });

    return () => {
      sub.dispose();
      wsRef.current = null;
      ws.close();
    };
  }, [deviceId, proto, port, report]);

  // Clicking anywhere in the pane should put the caret in the terminal, as a terminal window does.
  const focus = () => termRef.current?.focus();

  useImperativeHandle(ref, () => ({
    clear: () => {
      const term = termRef.current;
      if (!term) return;
      // clear() keeps the current line and drops the scrollback — which is what a console's
      // "clear" button means. reset() would also drop the shell's own state (the prompt it just
      // drew), leaving an empty screen with no prompt until the next keystroke.
      term.clear();
      term.focus();
    },
    text: () => (termRef.current ? terminalText(termRef.current) : ""),
    focus,
  }), []);

  return (
    // The host is ABSOLUTE inside this box, and the box gets its height from the page (see
    // index.tsx). That direction matters: xterm sizes itself to its container, and FitAddon then
    // sets the terminal's rows/cols from the measured height. If the container were sized by its
    // content instead, each fit() would make the element taller, the ResizeObserver would fire,
    // fit() would run again — and the terminal grew down the page without end. Taking the host out
    // of the layout flow breaks that loop at the source rather than damping it.
    <div role="presentation" className="relative min-h-0 flex-1 overflow-hidden" onClick={focus}>
      {/* Padding lives on this wrapper, NOT on the host xterm measures.
          FitAddon derives the row count from the host's clientHeight, and clientHeight INCLUDES
          padding — so padding on the host made it propose one row more than actually fits. The
          extra row rendered past the bottom edge, where `overflow-hidden` cut it off: the prompt
          you were typing at sat half-hidden behind the status bar. Two elements, one job each. */}
      <div className="absolute inset-0 px-3 pb-1 pt-2">
        <div ref={hostRef} className="h-full w-full" />
      </div>

      {status === "idle" && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <p className="font-mono text-[13px] text-white/25">No device connected</p>
          <p className="font-mono text-[11px] text-white/15">
            {disabledReason ?? "← Select a device to open a shell"}
          </p>
        </div>
      )}
    </div>
  );
});

export default TerminalPane;
