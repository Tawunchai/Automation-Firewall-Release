import { normalizeCLI, topLevelConfigBlocks, topLevelEdits } from "./parsePrereqCLI";
import type {
  SDWANZoneForm, SDWANMemberForm, SDWANHealthCheckForm, SDWANRuleForm, SDWANSLARow,
} from "../../api/policyObject";

// parseSDWANCLI — turns the AI's `config system sdwan … end` into the four object sets the SD-WAN
// pages already know how to create.
//
// SD-WAN IS SHAPED UNLIKE EVERY OTHER PARSER HERE. The others read one flat table per section. This
// one reads a COMPLEX object: a single `config system sdwan` block whose children are four separate
// CMDB tables, each on its own URL and each with its own create endpoint:
//
//	config zone          → cmdb/system/sdwan/zone          (mkey: name)
//	config members       → cmdb/system/sdwan/members       (mkey: seq-num)
//	config health-check  → cmdb/system/sdwan/health-check  (mkey: name)
//	config service       → cmdb/system/sdwan/service       (mkey: id)      ← the GUI's "rules"
//
// ⚠️ THE SEQUENCE-NUMBER PROBLEM, which is the whole reason this file has a "local id" concept.
//
// A member's mkey is a NUMBER the device assigns. The AI writes `edit 1`, `edit 2` — but those are
// the numbers in ITS proposal, not the ones the firewall will hand out. A device that already has
// members 1-3 will allocate 4 and 5, and every `set members 1 2` (health check) and
// `set priority-members 1 2` (rule) in the same proposal would then point at somebody else's
// interfaces. Silently: the device resolves them happily, because those seq-nums exist.
//
// So the parser keeps the CLI's numbers as `localSeq` / `localIds`, and NOTHING sends them to the
// device. Apply creates the members first, reads back the seq-nums the firewall actually assigned,
// and `remapMemberRefs` rewrites the references before the health checks and rules are written.
//
// ⚠️ THE PARENT'S `set status` IS READ AND NEVER WRITTEN. Turning SD-WAN on is a routing change —
// it re-homes every route that leaves through a member interface — and this console has held that
// line since the SD-WAN page was built (services/fortigate_sdwan.go says the same). The flag is
// parsed so the wizard can TELL the user their proposal assumes SD-WAN is on; enabling it stays a
// deliberate act on the SD-WAN page.

export type ParsedSDWANZone = { form: SDWANZoneForm };

export type ParsedSDWANMember = {
  /** The `edit <n>` number from the CLI. A local handle, never sent to the device. */
  localSeq: number;
  form: SDWANMemberForm;
};

export type ParsedSDWANHealthCheck = {
  form: SDWANHealthCheckForm;
  /** `set members 1 2` — local handles, resolved to real seq-nums at apply time. */
  memberLocalSeqs: number[];
};

export type ParsedSDWANRule = {
  /** The `edit <n>` number from the CLI. FortiOS assigns the real id on create. */
  localId: number;
  form: SDWANRuleForm;
  /** `set priority-members 1 2` — local handles. */
  memberLocalSeqs: number[];
};

export type ParsedSDWAN = {
  /** `set status enable|disable` on the parent, or null when the CLI did not mention it. */
  requestedStatus: boolean | null;
  /** `set load-balance-mode …`, reported for the same reason: shown, not written. */
  loadBalanceMode: string;
  zones: ParsedSDWANZone[];
  members: ParsedSDWANMember[];
  healthChecks: ParsedSDWANHealthCheck[];
  rules: ParsedSDWANRule[];
};

// ── Line reading ─────────────────────────────────────────────────────────────

/**
 * One `set <key> <value…>` line.
 *
 * Quoted tokens win when there are any, because FortiOS quotes each element of a multi-value field
 * separately (`set server "1.1.1.1" "8.8.8.8"`) and a value can legally contain a space
 * (`set dst "Guest Wi-Fi"`). Splitting on whitespace first would cut that name in half.
 */
function parseSetLine(line: string): { key: string; tokens: string[]; raw: string } | null {
  const m = line.match(/^\s*set\s+([a-z0-9._-]+)\s*(.*)$/i);
  if (!m) return null;
  const rest = m[2].trim();
  const quoted = [...rest.matchAll(/"([^"]*)"/g)].map((mm) => mm[1]);
  const tokens = quoted.length > 0 ? quoted : rest.split(/\s+/).filter(Boolean);
  return { key: m[1].toLowerCase(), tokens, raw: rest };
}

const isEnabled = (t?: string) => (t ?? "").toLowerCase() === "enable";

const toInt = (t?: string): number | undefined => {
  const n = parseInt((t ?? "").trim(), 10);
  return Number.isNaN(n) ? undefined : n;
};

/** Every integer in a token list, dropping anything that is not one. */
const toInts = (tokens: string[]): number[] =>
  tokens.map((t) => parseInt(t, 10)).filter((n) => !Number.isNaN(n));

/** Nested `config <name> … end` blocks inside an edit body, keyed by their header. */
const childBlocks = (body: string[], header: string): string[][] =>
  topLevelConfigBlocks(body)
    .filter((b) => b.header === header)
    .map((b) => b.inner);

// ── Child tables ─────────────────────────────────────────────────────────────

function parseZone(name: string, body: string[]): ParsedSDWANZone | null {
  if (!name) return null;
  const form: SDWANZoneForm = { name };
  for (const line of body) {
    const stmt = parseSetLine(line);
    if (stmt?.key === "service-sla-tie-break" && stmt.tokens[0]) {
      form.service_sla_tie_break = stmt.tokens[0];
    }
  }
  return { form };
}

function parseMember(editKey: string, body: string[]): ParsedSDWANMember | null {
  const localSeq = toInt(editKey);
  // A member is keyed by number. An `edit "wan1"` is the model writing the interface where the
  // sequence number goes — accepted, with the interface taken from it, because refusing the whole
  // proposal over a mkey the wizard is going to reassign anyway helps nobody.
  const form: SDWANMemberForm = { interface: "", zone: "" };
  if (localSeq === undefined && editKey) form.interface = editKey;

  for (const line of body) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "interface": if (tokens[0]) form.interface = tokens[0]; break;
      case "zone": if (tokens[0]) form.zone = tokens[0]; break;
      case "gateway": if (tokens[0]) form.gateway = tokens[0]; break;
      case "source": if (tokens[0]) form.source = tokens[0]; break;
      case "cost": form.cost = toInt(tokens[0]) ?? form.cost; break;
      case "weight": form.weight = toInt(tokens[0]) ?? form.weight; break;
      case "priority": form.priority = toInt(tokens[0]) ?? form.priority; break;
      case "volume-ratio": form.volume_ratio = toInt(tokens[0]) ?? form.volume_ratio; break;
      case "status": form.status = isEnabled(tokens[0]); break;
      case "comment": case "comments": form.comment = tokens.join(" "); break;
      default: break;
    }
  }
  if (!form.interface) return null; // a member without an interface is not a member
  return { localSeq: localSeq ?? 0, form };
}

/** The `config sla` sub-table of a health check: `edit <id>` + thresholds. */
function parseHealthSLARows(inner: string[]): SDWANSLARow[] {
  const rows: SDWANSLARow[] = [];
  for (const e of topLevelEdits(inner)) {
    const id = toInt(e.name);
    if (id === undefined || id < 1) continue;
    const row: SDWANSLARow = {
      id,
      // The device's own default set. A row that names no criteria measures nothing and every
      // member passes it, so the CLI's silence is read as "all three" rather than "none".
      link_cost_factor: ["latency", "jitter", "packet-loss"],
      latency_threshold: 0,
      jitter_threshold: 0,
      packetloss_threshold: 0,
      mos_threshold: "",
    };
    let sawFactor = false;
    for (const line of e.body) {
      const stmt = parseSetLine(line);
      if (!stmt) continue;
      switch (stmt.key) {
        case "link-cost-factor":
          // A SET, space-separated: "latency jitter packet-loss".
          row.link_cost_factor = stmt.tokens
            .flatMap((t) => t.split(/\s+/))
            .filter((t) => ["latency", "jitter", "packet-loss", "mos"].includes(t));
          sawFactor = true;
          break;
        case "latency-threshold": row.latency_threshold = toInt(stmt.tokens[0]) ?? 0; break;
        case "jitter-threshold": row.jitter_threshold = toInt(stmt.tokens[0]) ?? 0; break;
        case "packetloss-threshold": row.packetloss_threshold = toInt(stmt.tokens[0]) ?? 0; break;
        case "mos-threshold": row.mos_threshold = stmt.tokens[0] ?? ""; break;
        default: break;
      }
    }
    // A criteria set the model emptied (or filled with junk) would be refused by the validator, and
    // "you asked for nothing" is not what it meant.
    if (sawFactor && row.link_cost_factor.length === 0) {
      row.link_cost_factor = ["latency", "jitter", "packet-loss"];
    }
    rows.push(row);
  }
  return rows;
}

function parseHealthCheck(name: string, body: string[]): ParsedSDWANHealthCheck | null {
  if (!name) return null;
  const form: SDWANHealthCheckForm = {
    name,
    detect_mode: "active",
    protocol: "ping",
    servers: [],
    system_dns: false,
    members: [],
    sla: [],
    // The CMDB's own defaults, so a check the CLI describes only partly still lands as the device
    // would have created it.
    interval: 500,
    failtime: 5,
    recoverytime: 5,
    update_static_route: true,
  };
  const memberLocalSeqs: number[] = [];

  for (const line of body) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "detect-mode": if (tokens[0]) form.detect_mode = tokens[0].toLowerCase(); break;
      case "protocol": if (tokens[0]) form.protocol = tokens[0].toLowerCase(); break;
      // `set server "1.1.1.1" "8.8.8.8"` — one field holding up to two values.
      case "server": form.servers = tokens.flatMap((t) => t.split(/\s+/)).filter(Boolean); break;
      case "system-dns": form.system_dns = isEnabled(tokens[0]); break;
      case "interval": form.interval = toInt(tokens[0]) ?? form.interval; break;
      case "failtime": form.failtime = toInt(tokens[0]) ?? form.failtime; break;
      case "recoverytime": form.recoverytime = toInt(tokens[0]) ?? form.recoverytime; break;
      case "update-static-route": form.update_static_route = isEnabled(tokens[0]); break;
      case "members": memberLocalSeqs.push(...toInts(tokens.flatMap((t) => t.split(/\s+/)))); break;
      default: break;
    }
  }

  for (const inner of childBlocks(body, "sla")) {
    form.sla.push(...parseHealthSLARows(inner));
  }
  return { form, memberLocalSeqs };
}

/** The `config sla` sub-table of a RULE: `edit "<health-check>"` + `set id <n>`. */
function parseRuleSLATargets(inner: string[]): { health_check: string; id: number }[] {
  const out: { health_check: string; id: number }[] = [];
  for (const e of topLevelEdits(inner)) {
    const healthCheck = e.name.trim();
    if (!healthCheck) continue;
    let id = 1; // the device's own first SLA number, and what a bare target means
    for (const line of e.body) {
      const stmt = parseSetLine(line);
      if (stmt?.key === "id") id = toInt(stmt.tokens[0]) ?? id;
    }
    out.push({ health_check: healthCheck, id });
  }
  return out;
}

function parseRule(editKey: string, body: string[]): ParsedSDWANRule | null {
  const localId = toInt(editKey) ?? 0;
  const form: SDWANRuleForm = {
    name: "",
    status: true,
    source: [], user_groups: [], users: [],
    destination: [], route_tag: 0,
    internet_service: false, internet_service_names: [],
    mode: "manual",
    interface_preference: [], zone_preference: [],
    measured_sla: [], required_sla_targets: [],
    quality_criteria: "", hash_mode: "",
    forward_dscp: false, forward_dscp_tag: "",
    reverse_dscp: false, reverse_dscp_tag: "",
    protocol: 0, start_port: 1, end_port: 65535,
  };
  const memberLocalSeqs: number[] = [];

  for (const line of body) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    const { key, tokens } = stmt;
    switch (key) {
      case "name": if (tokens[0]) form.name = tokens[0]; break;
      case "status": form.status = isEnabled(tokens[0]); break;
      case "mode": if (tokens[0]) form.mode = tokens[0].toLowerCase(); break;
      case "src": form.source = tokens; break;
      case "dst": form.destination = tokens; break;
      case "groups": form.user_groups = tokens; break;
      case "users": form.users = tokens; break;
      case "route-tag": form.route_tag = toInt(tokens[0]) ?? 0; break;
      case "internet-service": form.internet_service = isEnabled(tokens[0]); break;
      case "internet-service-name": form.internet_service_names = tokens; break;
      case "priority-members":
        memberLocalSeqs.push(...toInts(tokens.flatMap((t) => t.split(/\s+/))));
        break;
      case "priority-zone": form.zone_preference = tokens; break;
      // "Measured SLA" on the Best-quality strategy — a health-check NAME, not an SLA number.
      case "health-check": form.measured_sla = tokens; break;
      case "link-cost-factor": if (tokens[0]) form.quality_criteria = tokens[0]; break;
      case "hash-mode": if (tokens[0]) form.hash_mode = tokens[0]; break;
      case "dscp-forward": form.forward_dscp = isEnabled(tokens[0]); break;
      case "dscp-forward-tag": form.forward_dscp_tag = tokens[0] ?? ""; break;
      case "dscp-reverse": form.reverse_dscp = isEnabled(tokens[0]); break;
      case "dscp-reverse-tag": form.reverse_dscp_tag = tokens[0] ?? ""; break;
      case "protocol": form.protocol = toInt(tokens[0]) ?? 0; break;
      case "start-port": form.start_port = toInt(tokens[0]) ?? 1; break;
      case "end-port": form.end_port = toInt(tokens[0]) ?? 65535; break;
      default: break;
    }
  }

  for (const inner of childBlocks(body, "sla")) {
    form.required_sla_targets.push(...parseRuleSLATargets(inner));
  }

  // A rule's mkey is a number, so `edit "To-Cloud"` is the model putting the NAME where the id
  // goes. Taking it as the name is what it plainly meant.
  if (!form.name && localId === 0 && editKey) form.name = editKey;
  if (!form.name) return null;
  return { localId, form, memberLocalSeqs };
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Parses the FIRST `config system sdwan` block, or null when the CLI has none.
 *
 * Returns null rather than an empty ParsedSDWAN when the block defines no objects at all: a
 * proposal that only says `set status enable` has nothing this console will build, and offering an
 * SD-WAN Wizard for it would open an empty form.
 */
export function parseSDWANFromCLI(cliText: string): ParsedSDWAN | null {
  if (!cliText) return null;
  const lines = normalizeCLI(cliText).split("\n");
  const block = topLevelConfigBlocks(lines).find((b) => b.header === "system sdwan");
  if (!block) return null;

  const out: ParsedSDWAN = {
    requestedStatus: null,
    loadBalanceMode: "",
    zones: [], members: [], healthChecks: [], rules: [],
  };

  // The parent's own settings sit at the top level of the block, outside every child table.
  for (const line of block.inner) {
    const stmt = parseSetLine(line);
    if (!stmt) continue;
    if (stmt.key === "status") out.requestedStatus = isEnabled(stmt.tokens[0]);
    if (stmt.key === "load-balance-mode") out.loadBalanceMode = stmt.tokens[0] ?? "";
  }

  for (const child of topLevelConfigBlocks(block.inner)) {
    for (const e of topLevelEdits(child.inner)) {
      switch (child.header) {
        case "zone": {
          const z = parseZone(e.name.trim(), e.body);
          if (z) out.zones.push(z);
          break;
        }
        case "members": case "member": {
          const m = parseMember(e.name.trim(), e.body);
          if (m) out.members.push(m);
          break;
        }
        case "health-check": {
          const h = parseHealthCheck(e.name.trim(), e.body);
          if (h) out.healthChecks.push(h);
          break;
        }
        case "service": {
          const r = parseRule(e.name.trim(), e.body);
          if (r) out.rules.push(r);
          break;
        }
        default: break;
      }
    }
  }

  const total = out.zones.length + out.members.length + out.healthChecks.length + out.rules.length;
  return total > 0 ? out : null;
}

/** How many device objects this draft would create. Drives the wizard button's badge. */
export const sdwanObjectCount = (p: ParsedSDWAN): number =>
  p.zones.length + p.members.length + p.healthChecks.length + p.rules.length;

/**
 * Rewrites every local member reference to the sequence number the FIRWALL actually assigned.
 *
 * `seqByLocal` maps the CLI's `edit <n>` to the real seq-num, and is only known after the members
 * have been created. A local number with no entry is DROPPED rather than passed through: passing it
 * through is precisely the bug this exists to prevent — seq-num 1 almost certainly exists on the
 * device and belongs to an interface nobody in this conversation mentioned.
 */
export function remapMemberRefs(
  localSeqs: number[],
  seqByLocal: Map<number, number>,
): number[] {
  const out: number[] = [];
  for (const local of localSeqs) {
    const real = seqByLocal.get(local);
    if (real !== undefined && !out.includes(real)) out.push(real);
  }
  return out;
}

/**
 * The health-check form with its Participants resolved.
 *
 * An empty result is meaningful and correct: on this table an empty member list means "All SD-WAN
 * Members", so a check whose references could not be resolved watches everything rather than
 * watching a stranger's interface.
 */
export const healthCheckWithMembers = (
  h: ParsedSDWANHealthCheck,
  seqByLocal: Map<number, number>,
): SDWANHealthCheckForm => ({
  ...h.form,
  members: remapMemberRefs(h.memberLocalSeqs, seqByLocal),
});

/**
 * The rule form with its outgoing interfaces resolved.
 *
 * Unlike a health check, a rule with NO outgoing member and NO zone steers nothing — the device
 * takes it and it silently never matches. `sdwanRuleIsSteerable` is what the wizard checks before
 * offering to create one.
 */
export const ruleWithMembers = (
  r: ParsedSDWANRule,
  seqByLocal: Map<number, number>,
): SDWANRuleForm => ({
  ...r.form,
  interface_preference: remapMemberRefs(r.memberLocalSeqs, seqByLocal),
});

export const sdwanRuleIsSteerable = (form: SDWANRuleForm): boolean =>
  form.interface_preference.length > 0 || form.zone_preference.length > 0;
