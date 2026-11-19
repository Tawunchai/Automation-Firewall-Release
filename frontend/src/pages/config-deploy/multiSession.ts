import type { TermStatus } from "./terminalUrl";

// The bookkeeping behind Multi Config: one live shell per selected device, one keyboard.
//
// The rules that matter are here rather than in the component because they are the ones that can be
// wrong in a way nobody sees until it matters on a live firewall — which sessions a keystroke
// actually reaches, and what the aggregate status bar is allowed to claim when four devices
// disagree with each other.

/** One device's half of the broadcast: its socket, what it has printed, and how it is doing. */
export type DeviceSession = {
  deviceId: number;
  name: string;
  status: TermStatus;
  /** Human detail for the status bar — the device banner, or why the dial failed. */
  detail: string;
  /**
   * Everything the device has sent, as decoded text, INCLUDING its escape sequences.
   *
   * Kept verbatim because switching which device you are watching replays this into the emulator:
   * strip the escapes and the replay loses colour, the `--More--` pager's in-place rewrites and
   * every cursor move, which is exactly the output that needs a terminal to read.
   */
  buffer: string;
};

/**
 * How much output to keep per device before dropping the oldest.
 *
 * 256 KB is roughly a `show full-configuration` on the lab device. Beyond that it is scrollback
 * nobody scrolls to, held for every device at once.
 */
export const MAX_BUFFER = 256 * 1024;

/**
 * Appends device output, dropping the head once the cap is passed.
 *
 * The cut is advanced to the next line break. Escape sequences are what makes this necessary: a cut
 * landing inside `\x1b[31m` replays as the literal text `[31m` and, worse, can leave the emulator
 * in whatever state the truncated sequence half-set. Losing a few extra bytes at the top costs
 * nothing; a corrupted replay costs the reader their trust in the screen.
 */
export function appendCapped(buffer: string, chunk: string, max = MAX_BUFFER): string {
  const next = buffer + chunk;
  if (next.length <= max) return next;
  const cut = next.length - max;
  const nl = next.indexOf("\n", cut);
  return nl >= 0 ? next.slice(nl + 1) : next.slice(cut);
}

/**
 * The single status the page's status bar shows for a whole broadcast.
 *
 * Deliberately pessimistic about "connected": it is only claimed when EVERY session is up. With
 * four devices selected and one refusing the dial, a bar reading "connected" would be read as "all
 * four are listening", which is the misunderstanding that ends with a command reaching three
 * firewalls and the operator believing it reached four.
 */
export function overallStatus(sessions: DeviceSession[]): TermStatus {
  if (sessions.length === 0) return "idle";
  if (sessions.some((s) => s.status === "connecting")) return "connecting";
  if (sessions.every((s) => s.status === "connected")) return "connected";
  if (sessions.some((s) => s.status === "connected")) return "connecting"; // partial — not "connected"
  if (sessions.some((s) => s.status === "error")) return "error";
  return "closed";
}

/** The line under the status dot: "3/4 อุปกรณ์พร้อม · 1 ต่อไม่ได้". */
export function statusSummary(sessions: DeviceSession[]): string {
  if (sessions.length === 0) return "No device selected";
  const ready = sessions.filter((s) => s.status === "connected").length;
  const failed = sessions.filter((s) => s.status === "error").length;
  const closed = sessions.filter((s) => s.status === "closed").length;
  const parts = [`${ready}/${sessions.length} devices ready`];
  if (failed) parts.push(`${failed} failed`);
  if (closed) parts.push(`${closed} dropped`);
  return parts.join(" · ");
}

/**
 * Which devices a keystroke actually reaches.
 *
 * A session that is connecting, closed or failed is NOT a target: writing to it silently drops the
 * input, and a broadcast console whose count includes sessions that are not listening is lying
 * about the blast radius of every line typed into it.
 */
export function liveTargets(sessions: DeviceSession[]): number[] {
  return sessions.filter((s) => s.status === "connected").map((s) => s.deviceId);
}

/**
 * What a script pasted into the composer should be sent as.
 *
 * Normalises line endings to CR, which is what a terminal sends when Enter is pressed — a shell
 * treats LF as a literal character on some transports and would swallow the command. Blank lines
 * are dropped: FortiOS answers an empty line with a fresh prompt, so a script padded for
 * readability would otherwise print a screen of prompts between commands. A trailing CR is added so
 * the last command runs rather than sitting on the prompt half-typed.
 */
export function scriptToKeystrokes(script: string): string {
  const lines = script.replace(/\r\n?/g, "\n").split("\n").map((l) => l.trimEnd()).filter(Boolean);
  if (lines.length === 0) return "";
  return `${lines.join("\r")}\r`;
}

/** How many commands `scriptToKeystrokes` would actually run — for the confirm dialog. */
export function scriptCommandCount(script: string): number {
  return script.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim()).length;
}
