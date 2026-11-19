import type { TopoEdge } from "../model";
import type { StagePalette } from "./palette";
import type { EdgeActivity } from "../flowAnimation";

// Which permitted paths get drawn, in what order, and in what colour.
//
// Lives apart from StageScene.tsx because both the scene and the page's legend need it, and a file
// that exports a component AND shared constants breaks Fast Refresh for that component.

/**
 * How many paths are drawn before the rest become a "+N" in the legend.
 *
 * There is a cap at all because the ring this replaced drew every pair and a device with a real
 * rule base turned into a ball of string. The cap is only honest if what survives it is the part
 * worth seeing, which is what rankEdges decides — and the legend always says how many were left out.
 */
export const ARC_CAP = 24;

/** Issue first, then busiest: the paths that get drawn are the ones worth looking at. */
export const rankEdges = (edges: TopoEdge[], activity: Map<string, EdgeActivity>): TopoEdge[] =>
  [...edges].sort((a, b) =>
    Number(b.uninspected) - Number(a.uninspected)
    || Number(b.denyOnly) - Number(a.denyOnly)
    || (activity.get(b.id) ?? 0) - (activity.get(a.id) ?? 0)
    || b.policies - a.policies);

/** Shared with model.ts's edgeTone, so a path never reads differently between scene and legend. */
export const edgeColor = (e: TopoEdge, p: StagePalette): string =>
  e.denyOnly ? p.deny : e.uninspected ? p.warn : p.allow;
