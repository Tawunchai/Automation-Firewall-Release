// Formatting helpers for the Diagnostics pages.
//
// They lived in shared.tsx beside the components, which breaks React fast refresh: a module that
// exports anything but components cannot be hot-swapped, so every edit to that file reloaded the
// whole page (react-refresh/only-export-components). Plain functions belong in a plain module.

/** Human-readable byte count. */
export const fmtBytes = (n: number): string => {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
};

/**
 * Latency → a tone.
 *
 * The thresholds are deliberately generous: this console drives firewalls whose upstream is a WAN
 * link, and colouring a 90 ms hop amber would paint most of a normal traceroute as a problem.
 */
export const latencyTone = (ms: number): "ok" | "warn" | "danger" => {
  if (ms < 100) return "ok";
  if (ms < 500) return "warn";
  return "danger";
};

/** The chip class for a latency tone. */
export const toneChip = (tone: "ok" | "warn" | "danger" | "plain"): string =>
  tone === "ok" ? "chip chip-ok"
    : tone === "warn" ? "chip chip-warn"
    : tone === "danger" ? "chip chip-danger"
    : "chip";
