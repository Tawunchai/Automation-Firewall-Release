import type { TrafficShaper } from "../../api/trafficShaper";

// The shaper's rules, out of the component so they can be tested without a DOM. The server
// enforces the same ones (controller/policyobject/device_shaper.go); this copy turns them into a
// sentence while the operator is typing, which is when the information is useful.

/** Form validation. Returns the problem, or null. */
export const validateShaper = (s: TrafficShaper): string | null => {
  if (!s.name.trim()) return "Name is required";
  if (s.name.trim().length > 35) return "Shaper names are limited to 35 characters";
  if (s.maximum_bandwidth < 0 || s.guaranteed_bandwidth < 0) return "Bandwidth cannot be negative";
  // 0 is UNLIMITED on FortiOS, which is almost never what somebody filling in a limit meant.
  if (s.maximum_bandwidth === 0) {
    return "A maximum of 0 means UNLIMITED on FortiOS — set a real ceiling, or delete the shaper "
      + "if no limit is what you want";
  }
  // The guarantee is a floor and the maximum a ceiling; a floor above the ceiling is not a tighter
  // limit, it is a contradiction the device stores without comment.
  if (s.guaranteed_bandwidth > s.maximum_bandwidth) {
    return "The guaranteed bandwidth is higher than the maximum — the floor cannot be above the ceiling";
  }
  return null;
};

/**
 * One line describing what a shaper does, including the part that decides how much bandwidth
 * anything actually gets.
 *
 * per-policy is stated in WORDS rather than shown as a flag: it is one enable/disable string whose
 * meaning is a factor of however many policies share the shaper, and "worked in testing, starves in
 * production" is nearly always this.
 */
export const describeShaper = (s: TrafficShaper): string => {
  const unit = s.bandwidth_unit || "kbps";
  const ceiling = `${s.maximum_bandwidth.toLocaleString()} ${unit}`;
  const floor = s.guaranteed_bandwidth > 0
    ? `, never below ${s.guaranteed_bandwidth.toLocaleString()} ${unit}`
    : "";
  const shared = s.per_policy
    ? "each policy gets its own allowance"
    : "the allowance is SHARED by every policy using it";
  return `up to ${ceiling}${floor} · ${s.priority} priority · ${shared}`;
};
