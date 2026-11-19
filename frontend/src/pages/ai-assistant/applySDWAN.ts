import {
  DeviceGetSDWAN, DeviceListSDWANHealthChecks, DeviceListSDWANRules,
  DeviceCreateSDWANZone, DeviceCreateSDWANMember,
  DeviceCreateSDWANHealthCheck, DeviceCreateSDWANRule,
} from "../../api/policyObject";
import {
  healthCheckWithMembers, ruleWithMembers,
  type ParsedSDWAN,
} from "./parseSDWANCLI";
import type { AppliedObject, PlanStep } from "./applyViaREST";
import { isDuplicateError } from "./fortiosError";

// The SD-WAN half of Apply, kept out of applyViaREST because of one thing the other object types
// do not have: **a reference that cannot be resolved until the objects are already on the device.**
//
// THE SEQUENCE-NUMBER HANDOVER
// An SD-WAN member's mkey is a number FortiOS assigns, and both of the objects that come after it
// point at that number — a health check names its participants (`set members 1 2`) and a rule names
// its outgoing interfaces (`set priority-members 1 2`). The AI writes the numbers from ITS proposal.
// On a firewall that already has members those numbers belong to somebody else's interfaces, and
// the device resolves them without complaint, so the mistake is invisible.
//
// So the steps share a live `seqByLocal` map:
//
//	plan time     an existing member matching the proposed INTERFACE resolves immediately
//	execute time  a created member's `resolve` writes the seq-num the firewall handed back
//	execute time  the health-check / rule `run` closures read the map when they finally fire
//
// The map is read inside `run`, not captured when the plan is built — that is what makes the
// handover work at all, and it is why these steps must run in the order they are planned in.
//
// WHAT THIS DELIBERATELY DOES NOT DO
// It never writes `system/sdwan`'s own `status`. Turning SD-WAN on re-homes every route that leaves
// through a member interface, which is a routing change and not a form field — the SD-WAN page has
// held that line since it was built, and an AI proposal is the last place to start crossing it.
// `ParsedSDWAN.requestedStatus` is surfaced in the wizard as a warning instead.

type Rec = Record<string, unknown>;

/**
 * The plan for one `config system sdwan` block.
 *
 * `seqByLocal` is created here and closed over by the steps. Callers do not need it; it is returned
 * only so tests can watch the handover happen.
 */
export async function planSDWANSteps(
  deviceId: number,
  parsed: ParsedSDWAN,
  opts?: { detailed?: boolean; seqByLocal?: Map<number, number> },
): Promise<PlanStep[]> {
  const detailed = opts?.detailed === true;
  const seqByLocal = opts?.seqByLocal ?? new Map<number, number>();
  const steps: PlanStep[] = [];

  // One read serves zones and members both — system/sdwan is a single complex object.
  const overview = await DeviceGetSDWAN(deviceId).catch(() => null);
  const zonesOnDevice = new Set((overview?.zones ?? []).map((z) => z.name));
  const membersOnDevice = overview?.members ?? [];

  // ── Zones ──
  const plannedZones = new Set<string>();
  for (const z of parsed.zones) {
    const name = z.form.name.trim();
    if (!name || plannedZones.has(name)) continue;
    plannedZones.add(name);
    const payload = { ...z.form } as unknown as Rec;
    if (zonesOnDevice.has(name)) {
      steps.push({ kind: "sdwan-zone", label: "SD-WAN Zone", name, action: "skip", payload });
      continue;
    }
    steps.push({
      kind: "sdwan-zone", label: "SD-WAN Zone", name, action: "create", payload,
      run: () => DeviceCreateSDWANZone(deviceId, z.form),
    });
  }

  // ── Members ──
  //
  // A member is identified by its INTERFACE, not by the number the CLI gave it: a firewall cannot
  // have two SD-WAN members on one interface, so "wan1 is already a member" is the real question —
  // and answering it is also what lets a re-Apply resolve the handover without creating anything.
  const plannedIfaces = new Set<string>();
  for (const m of parsed.members) {
    const iface = m.form.interface.trim();
    if (!iface || plannedIfaces.has(iface)) continue;
    plannedIfaces.add(iface);

    const payload = { ...m.form } as unknown as Rec;
    const existing = membersOnDevice.find((x) => x.interface === iface);
    if (existing) {
      // Known NOW, which is why a second Apply plans a fully-resolved health check and rule.
      seqByLocal.set(m.localSeq, existing.seq_num);
      steps.push({
        kind: "sdwan-member", label: "SD-WAN Member", name: iface, action: "skip",
        payload, existing: detailed ? (existing as unknown as Rec) : undefined,
      });
      continue;
    }

    steps.push({
      kind: "sdwan-member", label: "SD-WAN Member", name: iface, action: "create", payload,
      // seq_num is deliberately absent from the body: letting the device allocate the next free
      // number is what the GUI does, and a hard-coded one collides the moment two are added.
      run: () => DeviceCreateSDWANMember(deviceId, m.form),
      resolve: async () => {
        const after = await DeviceGetSDWAN(deviceId);
        const created = after.members.find((x) => x.interface === iface);
        if (created) seqByLocal.set(m.localSeq, created.seq_num);
        // `seq` is the numeric mkey the firewall chose — the key Fallback deletes by.
        return created ? { seq: created.seq_num } : {};
      },
    });
  }

  // ── Health checks ──
  const healthOnDevice = new Set(
    (await DeviceListSDWANHealthChecks(deviceId).catch(() => [])).map((h) => h.name),
  );
  const plannedChecks = new Set<string>();
  for (const h of parsed.healthChecks) {
    const name = h.form.name.trim();
    if (!name || plannedChecks.has(name)) continue;
    plannedChecks.add(name);

    // At plan time this resolves only the participants that already exist; the rest arrive when
    // the member steps above run. The preview therefore under-reports participants on a first
    // Apply, and is exact on every Apply after it.
    const payload = healthCheckWithMembers(h, seqByLocal) as unknown as Rec;
    if (healthOnDevice.has(name)) {
      steps.push({ kind: "sdwan-health-check", label: "Performance SLA", name, action: "skip", payload });
      continue;
    }
    steps.push({
      kind: "sdwan-health-check", label: "Performance SLA", name, action: "create", payload,
      // Read the map HERE, not above: the members it needs may not have existed when the plan was
      // built. This closure fires after their `resolve` has run.
      run: () => DeviceCreateSDWANHealthCheck(deviceId, healthCheckWithMembers(h, seqByLocal)),
    });
  }

  // ── Rules ──
  const rulesOnDevice = await DeviceListSDWANRules(deviceId).catch(() => ({ rules: [], implicit: { name: "", criteria: "", mode: "" } }));
  const ruleNames = new Set(rulesOnDevice.rules.map((r) => r.name));
  const plannedRules = new Set<string>();
  for (const r of parsed.rules) {
    const name = r.form.name.trim();
    if (!name || plannedRules.has(name)) continue;
    plannedRules.add(name);

    const payload = ruleWithMembers(r, seqByLocal) as unknown as Rec;
    if (ruleNames.has(name)) {
      steps.push({ kind: "sdwan-rule", label: "SD-WAN Rule", name, action: "skip", payload });
      continue;
    }
    steps.push({
      kind: "sdwan-rule", label: "SD-WAN Rule", name, action: "create", payload,
      run: () => DeviceCreateSDWANRule(deviceId, ruleWithMembers(r, seqByLocal)),
      resolve: async () => {
        const after = await DeviceListSDWANRules(deviceId);
        // Newest-last: a name is not the mkey on this table, so take the LAST match — the one this
        // create just appended — rather than an older rule that happens to share the name.
        const mine = after.rules.filter((x) => x.name === name).pop();
        return mine ? { seq: mine.id } : {};
      },
    });
  }

  return steps;
}

/**
 * Which interfaces a firewall policy still names, keyed by interface → the policies naming it.
 *
 * An interface in this map CANNOT become an SD-WAN member. FortiGate refuses it with
 * «entry not found in datasource … Return code -3» — a message that reads as "no such interface"
 * and sends people hunting for a typo. Measured on the lab firewall: wan1, lan, dmz and port1 (all
 * named by a policy) were refused; wan2 and ha, named by none, were accepted.
 */
export type PolicyInterfaceUse = Record<string, string[]>;

export const policyInterfaceUse = (
  policies: { name: string; src_intf_list?: string[]; dst_intf_list?: string[] }[],
): PolicyInterfaceUse => {
  const out: PolicyInterfaceUse = {};
  for (const p of policies) {
    for (const iface of [...(p.src_intf_list ?? []), ...(p.dst_intf_list ?? [])]) {
      // "any" is not an interface, and a policy on "any" holds nothing.
      if (!iface || iface.toLowerCase() === "any") continue;
      (out[iface] ??= []).push(p.name || "(unnamed policy)");
    }
  }
  return out;
};

/**
 * Why an SD-WAN proposal cannot be applied as written — one sentence per problem, empty when it can.
 *
 * These are the failures the DEVICE would either refuse with a return code or, worse, accept and
 * silently do nothing with. Both are far cheaper to say here — and the first one is worth more than
 * a message, because a member that fails mid-Apply leaves the zone created and everything after it
 * un-built.
 */
export function sdwanBlockers(
  parsed: ParsedSDWAN,
  zonesOnDevice: string[] = [],
  policyUse: PolicyInterfaceUse = {},
): string[] {
  const out: string[] = [];
  const known = new Set([...zonesOnDevice, ...parsed.zones.map((z) => z.form.name)]);

  for (const m of parsed.members) {
    const holders = policyUse[m.form.interface];
    if (holders?.length) {
      out.push(
        `"${m.form.interface}" cannot become an SD-WAN member while firewall ` +
        `polic${holders.length > 1 ? "ies" : "y"} ${holders.map((h) => `"${h}"`).join(", ")} ` +
        "still name it — repoint them at the SD-WAN zone first.",
      );
    }
    if (!m.form.zone) {
      out.push(`Member "${m.form.interface}" names no SD-WAN zone.`);
    } else if (!known.has(m.form.zone)) {
      // FortiGate answers -3 ("entry not found in datasource"), which says nothing about which
      // zone or where it was supposed to come from.
      out.push(`Member "${m.form.interface}" is in zone "${m.form.zone}", which this proposal does not create and the device does not have.`);
    }
  }

  // A rule steering nothing is the quiet one: the device stores it and it simply never matches.
  const localSeqs = new Set(parsed.members.map((m) => m.localSeq));
  for (const r of parsed.rules) {
    const resolvable = r.memberLocalSeqs.some((s) => localSeqs.has(s));
    if (!resolvable && r.form.zone_preference.length === 0) {
      out.push(`Rule "${r.form.name}" names no outgoing member or zone this proposal creates, so it would never steer anything.`);
    }
  }

  // The two SLA strategies select on a target, and the device will not let the last one be removed
  // once a rule has one — so a rule that arrives without any cannot be built at all.
  for (const r of parsed.rules) {
    if ((r.form.mode === "sla" || r.form.mode === "load-balance")
      && r.form.required_sla_targets.length === 0) {
      out.push(`Rule "${r.form.name}" uses the ${r.form.mode} strategy but names no required SLA target.`);
    }
    if (r.form.mode === "priority" && r.form.measured_sla.length === 0) {
      out.push(`Rule "${r.form.name}" uses the Best-quality strategy but names no measured SLA.`);
    }
  }

  return out;
}

/**
 * Applies one SD-WAN plan, in order, reporting each object as it lands.
 *
 * Split out from applyViaREST's generic executor only for the wizard, which applies an SD-WAN draft
 * on its own without a surrounding suggestion.
 */
export async function runSDWANSteps(
  steps: PlanStep[],
  onProgress?: (o: AppliedObject) => void,
): Promise<AppliedObject[]> {
  const created: AppliedObject[] = [];
  for (const step of steps) {
    if (!step.run) continue; // a skip — already on the device
    try {
      await step.run();
    } catch (err) {
      // A duplicate name is -5, and it means the end state we wanted is already true.
      //
      // Compared as a NUMBER (fortiosError.ts). The old test read the message for `-5\b`, which a
      // zone or health-check named `isp-5` satisfies on its own — so a member the device refused
      // was skipped silently and the rule that steers traffic onto it was built anyway. With no
      // code on the error this is false and the failure is rethrown, which is the safe direction.
      if (isDuplicateError(err)) continue;
      throw err;
    }
    const extra = step.resolve ? await step.resolve().catch(() => ({})) : {};
    const obj: AppliedObject = { kind: step.kind, label: step.label, name: step.name, ...extra };
    created.push(obj);
    onProgress?.(obj);
  }
  return created;
}
