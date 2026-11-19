// The dashboard's non-visual half: the metric hues and the utilisation-health thresholds.
//
// The tiles that use them are components and stay in kpi.tsx.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

/**
 * Validated metric hues. Index order is fixed: CPU / Memory / Sessions / Setup rate.
 *
 * Slot 0 matches the default accent, so CPU — which paints itself with whatever accent the user
 * has chosen — is part of the same validated set out of the box. It changed with the accent: an
 * earlier violet in slot 1 sat right on top of the new default and made CPU and Memory look like
 * the same series.
 */
export const METRIC_HUES = {
  light: ["#845ADF", "#0EA5E9", "#EC4899", "#F59E0B"],
  dark:  ["#8B5CF6", "#0891B2", "#DB2777", "#D97706"],
} as const;

export const metricHues = (mode: "Light" | "Dark") =>
  mode === "Dark" ? METRIC_HUES.dark : METRIC_HUES.light;

export type Health = "normal" | "warning" | "critical";

/** FortiGate's own conserve-mode thresholds are in this neighbourhood; 70/90 is the usual read. */
export const utilisationHealth = (pct: number | null | undefined): Health => {
  if (pct === null || pct === undefined) return "normal";
  if (pct >= 90) return "critical";
  if (pct >= 70) return "warning";
  return "normal";
};
