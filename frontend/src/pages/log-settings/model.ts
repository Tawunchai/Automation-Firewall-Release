import type {
  LogEvents, LogFortiAnalyzer, LogSettings, LogSettingsPatch, LogSyslog,
} from "../../api/systemSettings";

// The rules and the wording the Log Settings page needs.
//
// Almost all of it is about one question: is this firewall actually recording anything useful, and
// is it reaching anywhere that survives a reboot? A FortiGate answers "yes" to both in ways that
// are not true.

export type LogDraft = {
  events: LogEvents;
  memory: boolean;
  disk: LogSettings["disk"];
  syslog: Omit<LogSyslog, "configured">;
  fortianalyzer: Omit<LogFortiAnalyzer, "configured">;
};

export const draftFrom = (s: LogSettings): LogDraft => ({
  events: { ...s.events },
  memory: s.memory.enabled,
  disk: { ...s.disk },
  syslog: {
    enabled: s.syslog.enabled, server: s.syslog.server, port: s.syslog.port,
    mode: s.syslog.mode, facility: s.syslog.facility, format: s.syslog.format,
    source_ip: s.syslog.source_ip, enc_algorithm: s.syslog.enc_algorithm,
    certificate: s.syslog.certificate, priority: s.syslog.priority,
    max_log_rate: s.syslog.max_log_rate,
  },
  fortianalyzer: {
    enabled: s.fortianalyzer.enabled, server: s.fortianalyzer.server,
    alt_server: s.fortianalyzer.alt_server, upload_option: s.fortianalyzer.upload_option,
    reliable: s.fortianalyzer.reliable,
    certificate_verification: s.fortianalyzer.certificate_verification,
    source_ip: s.fortianalyzer.source_ip, enc_algorithm: s.fortianalyzer.enc_algorithm,
    ssl_min_proto_version: s.fortianalyzer.ssl_min_proto_version,
    max_log_rate: s.fortianalyzer.max_log_rate,
  },
});

/** The four sections the page can submit independently. */
export type LogSection = "events" | "memory" | "disk" | "syslog" | "fortianalyzer";

/**
 * Builds a patch carrying ONE section.
 *
 * Each section is saved on its own, and that is a decision rather than a convenience: on the device
 * each becomes a separate PUT, and a unit with no log disk refuses the disk write. Submitting
 * everything together would make every save depend on the one section that cannot succeed.
 */
export const patchFor = (d: LogDraft, section: LogSection): LogSettingsPatch => {
  switch (section) {
    case "events": return { events: d.events };
    case "memory": return { memory_enabled: d.memory };
    case "disk": return { disk: d.disk };
    case "syslog": return { syslog: d.syslog };
    default: return { fortianalyzer: d.fortianalyzer };
  }
};

export const validateSection = (d: LogDraft, section: LogSection): string | null => {
  if (section === "syslog") {
    if (d.syslog.enabled && !d.syslog.server.trim()) {
      return "A syslog destination needs a server address — switched on without one it sends nothing.";
    }
    if (d.syslog.port < 0 || d.syslog.port > 65535) return "The port must be between 0 and 65535.";
  }
  if (section === "fortianalyzer") {
    if (d.fortianalyzer.enabled && !d.fortianalyzer.server.trim()) {
      return "A FortiAnalyzer destination needs a server address.";
    }
  }
  if (section === "disk") {
    if (d.disk.max_log_file_size_mb < 0) return "The maximum log file size cannot be negative.";
    if (d.disk.maximum_log_age_days < 0) return "The maximum log age cannot be negative.";
  }
  return null;
};

/** Where the logs are going, in one sentence, and honestly when the answer is "nowhere durable". */
export const describeDestinations = (s: LogSettings): string => {
  const live: string[] = [];
  if (s.memory.enabled) live.push("memory");
  if (s.disk.enabled && s.disk_available) live.push("local disk");
  if (s.syslog.enabled && s.syslog.configured) live.push(`syslog (${s.syslog.server})`);
  if (s.fortianalyzer.enabled && s.fortianalyzer.configured) live.push(`FortiAnalyzer (${s.fortianalyzer.server})`);
  if (live.length === 0) return "Nowhere — no log destination is both switched on and configured.";
  return live.join(", ");
};

/** A destination switched on with nothing to send to — 200 from the device, nothing on the wire. */
export const enabledButUnconfigured = (s: LogSettings): string[] => {
  const out: string[] = [];
  if (s.syslog.enabled && !s.syslog.configured) out.push("Syslog");
  if (s.fortianalyzer.enabled && !s.fortianalyzer.configured) out.push("FortiAnalyzer");
  return out;
};

/**
 * Whether the disk section is describing something that cannot work.
 *
 * The lab FGT80E reports `log_disk_status: not_available` and still accepts `status: enable` on
 * log.disk/setting, storing it — verified live. So "on" here can be perfectly true and completely
 * inert, and the only way to know is the separate disk_available answer.
 */
export const diskOnWithoutADisk = (s: LogSettings): boolean => s.disk.enabled && !s.disk_available;

export const SYSLOG_FACILITIES = [
  "kernel", "user", "mail", "daemon", "auth", "syslog", "lpr", "news", "uucp", "cron",
  "authpriv", "ftp", "ntp", "audit", "alert", "clock",
  "local0", "local1", "local2", "local3", "local4", "local5", "local6", "local7",
];

export const SYSLOG_FORMATS = [
  { value: "default", label: "Default" },
  { value: "csv", label: "CSV" },
  { value: "cef", label: "CEF" },
  { value: "rfc5424", label: "RFC 5424" },
];

export const SYSLOG_MODES = [
  { value: "udp", label: "UDP" },
  { value: "reliable", label: "Reliable (TCP)" },
  { value: "legacy-reliable", label: "Legacy reliable" },
];

export const FAZ_UPLOAD_OPTIONS = [
  { value: "realtime", label: "Real time" },
  { value: "1-minute", label: "Every minute" },
  { value: "5-minute", label: "Every 5 minutes" },
  { value: "store-and-upload", label: "Store and upload" },
];

/** Each logging option, with a sentence saying what it actually changes. */
export const EVENT_HELP: Array<{ key: keyof LogEvents; label: string; help: string }> = [
  {
    key: "implicit_deny_log",
    label: "Log traffic denied by the implicit rule",
    help: "The single most important one. Without it, everything the last rule refuses is invisible.",
  },
  {
    key: "local_in_allow",
    label: "Log accepted traffic to the firewall itself",
    help: "Administrative logins, VPN connections, routing protocols.",
  },
  {
    key: "local_in_deny_unicast",
    label: "Log denied traffic to the firewall",
    help: "What a local-in policy refused. Empty without this even when rules are blocking.",
  },
  {
    key: "local_in_deny_broadcast",
    label: "Log denied broadcasts to the firewall",
    help: "Noisy on a busy segment — usually left off.",
  },
  {
    key: "local_out",
    label: "Log traffic the firewall itself sends",
    help: "Its own DNS, NTP, FortiGuard and update traffic.",
  },
  {
    key: "log_invalid_packet",
    label: "Log invalid packets",
    help: "Malformed or out-of-state packets the kernel drops before any policy sees them.",
  },
  {
    key: "resolve_ip",
    label: "Resolve addresses to host names",
    help: "Readable, and it makes the firewall do a lookup for every line it writes.",
  },
  {
    key: "resolve_port",
    label: "Show service names instead of port numbers",
    help: "443 becomes HTTPS.",
  },
  {
    key: "log_policy_comment",
    label: "Include the policy comment in each entry",
    help: "Puts the rule's own description next to what it matched.",
  },
  {
    key: "brief_traffic_format",
    label: "Brief traffic format",
    help: "Fewer fields per line. Smaller logs, less to investigate with.",
  },
  {
    key: "user_anonymize",
    label: "Anonymise user names",
    help: "Replaces the user in each entry with a hash.",
  },
];
