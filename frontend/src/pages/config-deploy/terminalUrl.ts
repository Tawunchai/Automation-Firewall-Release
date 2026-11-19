export type TermProto = "telnet" | "ssh";

/**
 * A shell's connection state, as the UI shows it.
 *
 * It lives here, in the module with no xterm import, so the multi-device bookkeeping
 * (multiSession.ts) can reason about it without pulling a terminal emulator into a unit test.
 */
export type TermStatus = "idle" | "connecting" | "connected" | "closed" | "error";

/**
 * The WebSocket URL for one device's shell.
 *
 * Pulled out of the component because getting it wrong fails in a way that is hard to read: the
 * browser reports a socket that opened and closed with no status, so a wrong scheme (ws over an
 * https page) or a dropped `/api` prefix looks identical to "the device refused us".
 *
 * `/api` is the same prefix the REST layer uses. In production nginx proxies it to the backend and
 * upgrades the connection (see nginx/common.conf); in dev the Vite proxy does, with `ws: true`. One
 * shape for both means there is no environment-only path to get wrong.
 */
export const terminalSocketURL = (
  location: { protocol: string; host: string },
  deviceId: number,
  proto: TermProto,
  port?: number,
): string => {
  // A ws:// socket on an https:// page is blocked as mixed content, silently in some browsers.
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const q = new URLSearchParams({ proto });
  // Only sent when overriding — the backend picks 22 or 23 from the protocol otherwise, and an
  // explicit 0 or NaN here would override that with nonsense.
  if (port && Number.isFinite(port) && port > 0) q.set("port", String(port));
  return `${scheme}//${location.host}/api/terminal/${deviceId}/shell?${q}`;
};
