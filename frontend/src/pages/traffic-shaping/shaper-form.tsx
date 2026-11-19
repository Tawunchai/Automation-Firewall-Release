import type { TrafficShaper } from "../../api/trafficShaper";
import { validateShaper } from "./model";

// Shared state and payload-building for the shaper create and edit pages — pulled out of the old
// modal in index.tsx. The validation itself stays in model.ts since describeShaper (used by the
// list rows) lives there too and both read the same rules.

export type ShaperDraft = TrafficShaper;

export const BLANK_SHAPER: ShaperDraft = {
  name: "", guaranteed_bandwidth: 0, maximum_bandwidth: 1000,
  bandwidth_unit: "kbps", priority: "high", per_policy: false, diffserv: false, used_by: 0,
};

export const validateShaperDraft = validateShaper;

export const buildShaperPayload = (d: ShaperDraft): TrafficShaper => ({ ...d, name: d.name.trim() });
