// Tiering for edge "activity" — the thing that makes the map feel like a live network rather than
// a frozen diagram of one. Scene3D's own particle loop uses these to decide how busy a path looks.
//
// WHY THREE TIERS, NOT A CONTINUOUS SPEED. The live probe measures bits/second PER INTERFACE, not
// per PATH — a port can carry several permitted paths, and there is no FortiOS API that reports how
// much of an interface's traffic belongs to one policy. So an edge's "activity" here is already an
// inference (the lesser of its two endpoints' live throughput — see topologyActivity in index.tsx),
// and dressing an inference up with a precise speed would claim a precision the measurement does
// not have. Three bands (idle / some traffic / busy) say exactly as much as is actually known.
export type EdgeActivity = 0 | 1 | 2; // none | low | high

export const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined"
  && typeof window.matchMedia === "function"
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
