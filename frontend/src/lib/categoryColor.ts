import type { CSSProperties } from "react";

/**
 * Per-page identity colour — NOT the app's own status palette (success/warning/danger/…), which
 * already means something elsewhere in this console (danger = "something is wrong") and would
 * read as a false alert if borrowed for "this row belongs to page X". A light/dark pair from a
 * validated categorical set instead: adjacent-pair CVD Delta E >= 8 and normal-vision Delta E >= 15
 * in both modes (dataviz skill, references/palette.md), so no two pages sharing a section can be
 * mistaken for one another at a glance.
 */
export type CategoryHue = { light: string; dark: string };

/** The dashboard's own `ICON_CHIP` shape (a 155° gradient plus a tinted glow shadow) built from an
    arbitrary hex instead of one of its seven fixed semantic roles. */
export const categoryChipStyle = (hex: string): CSSProperties => ({
  background: `linear-gradient(155deg, ${hex}, color-mix(in srgb, ${hex} 60%, black 25%))`,
  boxShadow: `0 8px 24px -6px color-mix(in srgb, ${hex} 50%, transparent)`,
});

/** Picks the mode-correct hex off a `CategoryHue` pair. */
export const categoryHue = (hue: CategoryHue, mode: "Light" | "Dark"): string =>
  mode === "Dark" ? hue.dark : hue.light;

/**
 * FortiOS's own 32 object colours, index 0 = none.
 *
 * This is NOT the per-page identity palette above — it is the device's, and the index is what
 * FortiOS stores on an address, a service or a schedule (`set color 7`). The console only maps
 * between the number the firewall holds and the swatch a person picked, so the list has to match
 * the device's order exactly.
 *
 * It lived in four files, copied character for character: both tabs and both forms in Policy &
 * Objects. A palette is a shared contract with the device, and four copies of one are four places
 * for the mapping to drift — if one list ever gained a colour, every index past it would address
 * a different swatch on that page than on the other three.
 */
export const FG_COLORS: string[] = [
  "transparent",
  "#e53935", "#d81b60", "#8e24aa", "#5e35b1",
  "#1e88e5", "#039be5", "#00acc1", "#00897b",
  "#43a047", "#7cb342", "#c0ca33", "#fdd835",
  "#ffb300", "#fb8c00", "#f4511e", "#6d4c41",
  "#757575", "#546e7a", "#e91e63", "#9c27b0",
  "#3f51b5", "#2196f3", "#03a9f4", "#00bcd4",
  "#009688", "#4caf50", "#8bc34a", "#cddc39",
  "#ffeb3b", "#ffc107", "#ff9800", "#ff5722",
];
