import type { SDWANRule } from "../../api/policyObject";

// How an SD-WAN rule reads in the list. Pure, so the mapping between the CMDB's vocabulary and the
// dialog's can be pinned by tests instead of checked by eye against a firewall.
//
// The mapping is the whole point of this file: the device stores `mode`, and the dialog calls the
// same thing "Interface selection strategy" with four labels that do not resemble the stored
// values. Getting that wrong means a rule that says one thing on the list and another in the form.

/** GUI strategy labels, keyed by the CMDB `mode` they map to (verified against the device). */
export const MODE_LABELS: Record<string, string> = {
  manual: "Manual",
  priority: "Best quality",
  sla: "Lowest cost (SLA)",
  "load-balance": "Maximize bandwidth (SLA)",
  // `auto` exists in the schema but has no radio button in the dialog; it is shown as-is rather
  // than silently relabelled as one of the four.
  auto: "Auto",
};

export const modeLabel = (mode: string): string => MODE_LABELS[mode] ?? mode ?? "—";

/**
 * The list's "Criteria" column — what the rule selects on, not how it is configured.
 *
 * Manual has no criteria to speak of; the SLA strategies select on their targets; Best quality
 * selects on a measured quality. The device's implicit rule shows its load-balance-mode here
 * instead, which is why that string is passed in rather than derived.
 */
export const ruleCriteria = (r: SDWANRule): string => {
  switch (r.mode) {
    case "priority":
      return r.quality_criteria ? `Best quality · ${r.quality_criteria}` : "Best quality";
    case "sla":
    case "load-balance":
      return r.required_sla_targets.length > 0
        ? r.required_sla_targets.map((t) => `${t.health_check}#${t.id}`).join(", ")
        : modeLabel(r.mode);
    default:
      return modeLabel(r.mode);
  }
};

/** The Members column: outgoing zones, or member sequence numbers, or nothing configured. */
export const ruleMembers = (r: SDWANRule): string => {
  if (r.zone_preference.length > 0) return r.zone_preference.join(", ");
  if (r.interface_preference.length > 0) return r.interface_preference.map((s) => `#${s}`).join(", ");
  return "—";
};

/** The Destination column. Internet Service REPLACES the address list on the device. */
export const ruleDestination = (r: SDWANRule): string => {
  if (r.internet_service) {
    return r.internet_service_names.length > 0 ? r.internet_service_names.join(", ") : "Internet service";
  }
  return r.destination.length > 0 ? r.destination.join(", ") : "—";
};

/** The Source column — addresses and user groups are both sources on the device. */
export const ruleSource = (r: SDWANRule): string => {
  const parts = [...r.source, ...r.user_groups, ...r.users];
  return parts.length > 0 ? parts.join(", ") : "—";
};

/** The Performance SLA column: which health checks the rule watches, whichever way it selects. */
export const rulePerformanceSLA = (r: SDWANRule): string => {
  if (r.measured_sla.length > 0) return r.measured_sla.join(", ");
  if (r.required_sla_targets.length > 0) {
    return Array.from(new Set(r.required_sla_targets.map((t) => t.health_check))).join(", ");
  }
  return "—";
};

/** IANA numbers the dialog's Protocol field accepts, named. Anything else prints its number. */
export const PROTOCOL_NAMES: Record<number, string> = {
  0: "any", 1: "ICMP", 6: "TCP", 17: "UDP", 47: "GRE", 50: "ESP", 58: "ICMPv6",
};

export const ruleProtocol = (r: SDWANRule): string =>
  PROTOCOL_NAMES[r.protocol] ?? String(r.protocol);

/**
 * The Port column.
 *
 * Only TCP and UDP carry ports, and the device stores 1-65535 as "no restriction" — printing that
 * as a range would suggest a filter the rule does not apply.
 */
export const rulePort = (r: SDWANRule): string => {
  if (r.protocol !== 6 && r.protocol !== 17) return "any";
  if (r.start_port <= 1 && r.end_port >= 65535) return "any";
  return r.start_port === r.end_port ? String(r.start_port) : `${r.start_port}-${r.end_port}`;
};

/** A blank rule, matching what the dialog opens on (Manual, enabled, nothing chosen). */
export const emptyRule = (): SDWANRule => ({
  id: 0,
  name: "",
  status: true,
  source: [],
  user_groups: [],
  users: [],
  destination: [],
  route_tag: 0,
  internet_service: false,
  internet_service_names: [],
  mode: "manual",
  interface_preference: [],
  zone_preference: [],
  measured_sla: [],
  required_sla_targets: [],
  quality_criteria: "latency",
  hash_mode: "round-robin",
  forward_dscp: false,
  forward_dscp_tag: "",
  reverse_dscp: false,
  reverse_dscp_tag: "",
  protocol: 0,
  start_port: 1,
  end_port: 65535,
});

/**
 * The client-side half of the validator, mirroring the server's rules so the dialog can say what is
 * wrong before spending a round trip. Returns "" when the rule is submittable.
 *
 * It is a mirror, not the authority: the server re-checks all of it, because a browser is not where
 * a firewall's rules get decided.
 */
export const validateRule = (r: SDWANRule): string => {
  if (!r.name.trim()) return "Enter a name";
  if (r.name.trim().length > 35) return "The name is limited to 35 characters";
  if (r.interface_preference.length === 0 && r.zone_preference.length === 0) {
    return "Choose at least one outgoing interface or zone";
  }
  if (r.internet_service) {
    if (r.internet_service_names.length === 0) return "Choose at least one internet service";
  } else if (r.destination.length === 0) {
    return "Choose a destination address, or select an internet service";
  }
  if (r.mode === "priority" && r.measured_sla.length === 0) {
    return "Best quality needs a measured SLA";
  }
  if ((r.mode === "sla" || r.mode === "load-balance") && r.required_sla_targets.length === 0) {
    return "This strategy needs at least one required SLA target";
  }
  if ((r.protocol === 6 || r.protocol === 17) && r.start_port > r.end_port) {
    return "The start port cannot be above the end port";
  }
  if (r.forward_dscp && !r.forward_dscp_tag.trim()) return "Forward DSCP is on but has no tag";
  if (r.reverse_dscp && !r.reverse_dscp_tag.trim()) return "Reverse DSCP is on but has no tag";
  return "";
};
