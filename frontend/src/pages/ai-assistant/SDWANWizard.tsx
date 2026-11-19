import React, { useEffect, useMemo, useState } from "react";
import { FiShare2, FiAlertTriangle, FiCheck, FiTrash2 } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceGetSDWAN, DeviceListSDWANHealthChecks, DeviceListSDWANRules,
  DeviceListRouteInterfaces, DeviceListPolicies,
  type RouteInterface, type SDWANZoneForm, type SDWANMemberForm,
  type SDWANHealthCheckForm, type SDWANRuleForm,
} from "../../api/policyObject";
import WizardShell from "./WizardShell";
import type { AppliedObject } from "./applyViaREST";
import {
  planSDWANSteps, runSDWANSteps, sdwanBlockers, policyInterfaceUse,
  type PolicyInterfaceUse,
} from "./applySDWAN";
import { sdwanObjectCount, type ParsedSDWAN } from "./parseSDWANCLI";
import type { ApplyImpact } from "./applyImpact";
import { apiErrorDetail } from "../../api/errorText";

// The AI SD-WAN Wizard — review, then build, the four object sets a `config system sdwan` block
// describes.
//
// WHY IT IS ONE WIZARD AND NOT FOUR BUTTONS
// `system/sdwan` is a complex object: a zone holds members, a member is what a health check probes
// over, and a rule steers traffic out of members that meet a health check's SLA. Split into four
// independent buttons, a user could create the rule first and get a -3 ("entry not found in
// datasource") with nothing to say which of the three missing pieces it meant. So this reviews the
// whole set and applies it in dependency order: zones → members → performance SLAs → rules.
//
// THE TWO THINGS IT REFUSES TO DO
//
//  1. **It never enables SD-WAN.** `set status enable` on the parent re-homes every route that
//     leaves through a member interface. That is a routing change, not a form field — the SD-WAN
//     page has never written it either — and an AI proposal is the last place to start. If the
//     proposal assumed SD-WAN was on and it is off, the banner says so and the objects are still
//     built, because they are exactly what has to exist BEFORE anyone flips that switch.
//
//  2. **It never sends the sequence numbers the model wrote.** A member's mkey is a number the
//     firewall assigns; the model's `edit 1` is a number in its own proposal. See applySDWAN.ts —
//     the handover is the single subtlest thing in this feature.

type Step = "zones" | "members" | "slas" | "rules" | "review";

const STEP_LABEL: Record<Step, string> = {
  zones: "SD-WAN Zones",
  members: "Interface Members",
  slas: "Performance SLAs",
  rules: "SD-WAN Rules",
  review: "Review & Apply",
};

// ── Small field controls, matching the other AI wizards ──────────────────────

const L: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="block w-[104px] shrink-0 pt-1.5 text-[11px] font-medium ink-2">{children}</span>
);

const Row: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex items-start gap-2">
    <L>{label}</L>
    <div className="min-w-0 flex-1">{children}</div>
  </div>
);

const inputCls =
  "h-7 w-full rounded border hairline surface-card px-2 text-[12px] ink outline-none transition";

const Card: React.FC<{
  title: string;
  badge?: React.ReactNode;
  onRemove?: () => void;
  children: React.ReactNode;
}> = ({ title, badge, onRemove, children }) => (
  <div className="rounded-[4px] border hairline-2 surface-card">
    <div className="flex items-center gap-2 border-b hairline-2 px-3 py-1.5">
      <span className="truncate text-[11.5px] font-semibold ink">{title}</span>
      {badge}
      {onRemove && (
        <button type="button" onClick={onRemove} title="Leave this object out"
          className="ml-auto flex h-5 w-5 items-center justify-center rounded ink-3 surface-hover transition">
          <FiTrash2 size={11} />
        </button>
      )}
    </div>
    <div className="space-y-2 px-3 py-2.5">{children}</div>
  </div>
);

/** The green "already on the device" pill — the object will be skipped, not overwritten. */
const OnDevice: React.FC = () => (
  <span className="rounded-full px-1.5 py-0.5 text-[9px] font-bold"
    style={{ background: "#16a34a18", color: "#16a34a" }}>
    ON DEVICE
  </span>
);

// ── The wizard ───────────────────────────────────────────────────────────────

const SDWANWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  parsed: ParsedSDWAN;
  readOnly?: boolean;
  currentColor: string;
  /** Every object that actually landed, in create order — the chat records these for Fallback. */
  onApplied: (created: AppliedObject[]) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, parsed, readOnly = false, currentColor, onApplied, onCancel }) => {
  // The draft is COPIED into state on mount: the user edits their copy, and re-opening the wizard
  // from the chat gets the model's proposal back rather than yesterday's half-edit.
  const [zones, setZones] = useState<SDWANZoneForm[]>(() => parsed.zones.map((z) => ({ ...z.form })));
  const [members, setMembers] = useState<{ localSeq: number; form: SDWANMemberForm }[]>(
    () => parsed.members.map((m) => ({ localSeq: m.localSeq, form: { ...m.form } })),
  );
  const [checks, setChecks] = useState<{ memberLocalSeqs: number[]; form: SDWANHealthCheckForm }[]>(
    () => parsed.healthChecks.map((h) => ({ memberLocalSeqs: [...h.memberLocalSeqs], form: { ...h.form } })),
  );
  const [rules, setRules] = useState<{ localId: number; memberLocalSeqs: number[]; form: SDWANRuleForm }[]>(
    () => parsed.rules.map((r) => ({ localId: r.localId, memberLocalSeqs: [...r.memberLocalSeqs], form: { ...r.form } })),
  );

  const [checking, setChecking] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);

  // What the firewall already has, so the wizard can say "ON DEVICE" instead of proposing a create
  // that will come back as -5.
  const [sdwanEnabled, setSdwanEnabled] = useState<boolean | null>(null);
  const [deviceZones, setDeviceZones] = useState<string[]>([]);
  const [deviceIfaces, setDeviceIfaces] = useState<string[]>([]);
  const [deviceChecks, setDeviceChecks] = useState<string[]>([]);
  const [deviceRules, setDeviceRules] = useState<string[]>([]);
  const [interfaces, setInterfaces] = useState<RouteInterface[]>([]);
  // Which interfaces a firewall policy still holds. FortiGate will not let one of those join
  // SD-WAN, and it says so with a bare -3 — see policyInterfaceUse. Knowing it BEFORE Apply matters
  // more than knowing it after: a member that fails halfway leaves the zone created and everything
  // after it un-built.
  const [policyUse, setPolicyUse] = useState<PolicyInterfaceUse>({});

  useEffect(() => {
    let live = true;
    setChecking(true);
    void (async () => {
      // Every read is best-effort. A picker that comes back empty is a nuisance; a wizard that
      // refuses to open because one list failed is worse — the draft is still reviewable.
      const [overview, hc, rl, ifaces, pols] = await Promise.all([
        DeviceGetSDWAN(device.id).catch(() => null),
        DeviceListSDWANHealthChecks(device.id).catch(() => []),
        DeviceListSDWANRules(device.id).catch(() => null),
        DeviceListRouteInterfaces(device.id).catch(() => [] as RouteInterface[]),
        DeviceListPolicies(device.id).catch(() => []),
      ]);
      if (!live) return;
      if (overview) {
        setSdwanEnabled(overview.enabled);
        setDeviceZones(overview.zones.map((z) => z.name));
        setDeviceIfaces(overview.members.map((m) => m.interface));
      }
      setDeviceChecks(hc.map((h) => h.name));
      setDeviceRules((rl?.rules ?? []).map((r) => r.name));
      setInterfaces(ifaces);
      setPolicyUse(policyInterfaceUse(pols));
      setChecking(false);
    })();
    return () => { live = false; };
  }, [device.id]);

  // Only the sections this proposal actually has, plus Review. A wizard that opens on an empty
  // "Performance SLAs" step invites the reader to look for something that is not there.
  const steps = useMemo<Step[]>(() => {
    const s: Step[] = [];
    if (zones.length) s.push("zones");
    if (members.length) s.push("members");
    if (checks.length) s.push("slas");
    if (rules.length) s.push("rules");
    s.push("review");
    return s;
  }, [zones.length, members.length, checks.length, rules.length]);

  const current = steps[Math.min(step, steps.length - 1)];

  /** The draft as it stands after the user's edits — what Apply will actually plan. */
  const edited = useMemo<ParsedSDWAN>(() => ({
    requestedStatus: parsed.requestedStatus,
    loadBalanceMode: parsed.loadBalanceMode,
    zones: zones.map((form) => ({ form })),
    members: members.map((m) => ({ localSeq: m.localSeq, form: m.form })),
    healthChecks: checks.map((c) => ({ form: c.form, memberLocalSeqs: c.memberLocalSeqs })),
    rules: rules.map((r) => ({ localId: r.localId, form: r.form, memberLocalSeqs: r.memberLocalSeqs })),
  }), [parsed.requestedStatus, parsed.loadBalanceMode, zones, members, checks, rules]);

  const blockers = useMemo(
    () => sdwanBlockers(edited, deviceZones, policyUse),
    [edited, deviceZones, policyUse],
  );

  const zoneOptions = useMemo(
    () => Array.from(new Set([...zones.map((z) => z.name), ...deviceZones])).filter(Boolean),
    [zones, deviceZones],
  );

  const total = sdwanObjectCount(edited);

  const buildImpact = (): ApplyImpact => {
    const objects = [
      ...zones.map((z) => ({ kind: "sdwan-zone" as const, label: "SD-WAN Zone", name: z.name })),
      ...members.map((m) => ({ kind: "sdwan-member" as const, label: "SD-WAN Member", name: m.form.interface })),
      ...checks.map((c) => ({ kind: "sdwan-health-check" as const, label: "Performance SLA", name: c.form.name })),
      ...rules.map((r) => ({ kind: "sdwan-rule" as const, label: "SD-WAN Rule", name: r.form.name })),
    ];
    const effects = [
      `Builds ${total} SD-WAN object(s) on ${hostname || device.name}, in the order they depend on each other: zones → members → performance SLAs → rules`,
    ];
    if (members.length) {
      effects.push(
        `Adds ${members.map((m) => m.form.interface).join(", ")} to SD-WAN — the firewall assigns each a sequence number, and the SLAs and rules below are pointed at those numbers, not at the ones in the proposal`,
      );
    }
    if (rules.length) {
      effects.push("A rule only takes effect for traffic that matches it before any rule above it — SD-WAN rules are first-match, like firewall policies");
    }

    const warnings = [...blockers];
    if (sdwanEnabled === false) {
      warnings.push(
        "SD-WAN is switched OFF on this firewall. These objects will be created and will do nothing until SD-WAN is enabled — which this wizard deliberately does not do, because enabling it re-homes every route that leaves through a member interface.",
      );
    }
    if (members.length && deviceIfaces.length === 0 && sdwanEnabled === false) {
      warnings.push("Adding an interface to SD-WAN takes its routes out of the ordinary routing table once SD-WAN is on — check the static routes that use these interfaces first.");
    }

    return {
      mode: "create",
      transport: "rest",
      destructive: false,
      objects,
      policies: [],
      effects,
      warnings,
      note: "Objects already on the device are skipped, not overwritten — the ones marked ON DEVICE above.",
      aiImpact: [],
    };
  };

  const handleApply = async () => {
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setSaving(true);
    try {
      // Plan and run in one go: the plan's closures share the sequence-number map, so they cannot
      // be built now and executed later against a different device state.
      const steps2 = await planSDWANSteps(device.id, edited);
      const created = await runSDWANSteps(steps2);
      if (created.length === 0) {
        message.info("Every SD-WAN object in this proposal is already on the device");
      } else {
        message.success(`Created ${created.length} SD-WAN object(s) on ${device.name}`);
      }
      onApplied(created);
    } catch (err) {
      message.error(apiErrorDetail(err, "The device rejected the SD-WAN configuration"));
    } finally {
      setSaving(false);
    }
  };

  // ── Step bodies ────────────────────────────────────────────────────────────

  const setZone = (i: number, patch: Partial<SDWANZoneForm>) =>
    setZones((z) => z.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setMember = (i: number, patch: Partial<SDWANMemberForm>) =>
    setMembers((m) => m.map((x, j) => (j === i ? { ...x, form: { ...x.form, ...patch } } : x)));
  const setCheck = (i: number, patch: Partial<SDWANHealthCheckForm>) =>
    setChecks((c) => c.map((x, j) => (j === i ? { ...x, form: { ...x.form, ...patch } } : x)));
  const setRule = (i: number, patch: Partial<SDWANRuleForm>) =>
    setRules((r) => r.map((x, j) => (j === i ? { ...x, form: { ...x.form, ...patch } } : x)));

  const body = () => {
    switch (current) {
      case "zones":
        return (
          <div className="space-y-2.5 px-4 py-3.5">
            <p className="text-[11px] ink-3">
              A zone groups the WAN links traffic may leave by. A rule steers to a zone or to
              specific members inside one.
            </p>
            {zones.map((z, i) => (
              <Card key={i} title={z.name || "(unnamed zone)"}
                badge={deviceZones.includes(z.name) ? <OnDevice /> : undefined}
                onRemove={() => setZones((all) => all.filter((_, j) => j !== i))}>
                <Row label="Name">
                  <input className={inputCls} value={z.name} maxLength={35}
                    onChange={(e) => setZone(i, { name: e.target.value })} />
                </Row>
                <Row label="Tie break">
                  <MinimalSelect ariaLabel="Tie break" size="sm" className="w-full" value={z.service_sla_tie_break ?? ""}
                    onChange={(v) => setZone(i, { service_sla_tie_break: v || undefined })}
                    options={[
                      { value: "", label: "Device default (cfg-order)" },
                      { value: "cfg-order", label: "cfg-order" },
                      { value: "fib-best-match", label: "fib-best-match" },
                      { value: "input-device", label: "input-device" },
                    ]} />
                </Row>
              </Card>
            ))}
          </div>
        );

      case "members":
        return (
          <div className="space-y-2.5 px-4 py-3.5">
            <p className="text-[11px] ink-3">
              Each member is one interface inside a zone. Cost and priority decide which one wins
              when several are healthy.
            </p>
            {members.map((m, i) => (
              <Card key={i} title={m.form.interface || "(no interface)"}
                badge={deviceIfaces.includes(m.form.interface) ? <OnDevice /> : undefined}
                onRemove={() => setMembers((all) => all.filter((_, j) => j !== i))}>
                {policyUse[m.form.interface]?.length > 0 && (
                  // Shown HERE rather than only on the review step, because this is the field the
                  // user has to change and the interface picker is right underneath it.
                  <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10.5px] text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300">
                    Firewall polic{policyUse[m.form.interface].length > 1 ? "ies" : "y"}{" "}
                    {policyUse[m.form.interface].map((n) => `"${n}"`).join(", ")} still name{" "}
                    {m.form.interface}. FortiGate refuses to make it an SD-WAN member until those are
                    repointed at the SD-WAN zone — pick another interface, or fix the policies first.
                  </p>
                )}
                <Row label="Interface">
                  {/* A free-text box would let a typo through to a -3 from the device. The list is
                      the firewall's own interfaces; the current value stays selectable even if the
                      read failed, so a proposal is never silently emptied. */}
                  <MinimalSelect ariaLabel="Interface" size="sm" className="w-full" value={m.form.interface}
                    onChange={(v) => setMember(i, { interface: v })}
                    options={[
                      ...(!interfaces.some((x) => x.name === m.form.interface)
                        ? [{ value: m.form.interface, label: m.form.interface || "— choose —" }]
                        : []),
                      ...interfaces.map((x) => ({ value: x.name, label: x.alias ? `${x.alias} (${x.name})` : x.name })),
                    ]} />
                </Row>
                <Row label="Zone">
                  <MinimalSelect ariaLabel="Zone" size="sm" className="w-full" value={m.form.zone}
                    onChange={(v) => setMember(i, { zone: v })}
                    options={[
                      ...(!zoneOptions.includes(m.form.zone)
                        ? [{ value: m.form.zone, label: m.form.zone || "— choose —" }]
                        : []),
                      ...zoneOptions.map((z) => ({ value: z, label: z })),
                    ]} />
                </Row>
                <Row label="Gateway">
                  <input className={inputCls} value={m.form.gateway ?? ""} placeholder="0.0.0.0 (learn it)"
                    onChange={(e) => setMember(i, { gateway: e.target.value })} />
                </Row>
                <div className="flex gap-2">
                  <Row label="Cost">
                    <input className={inputCls} type="number" min={0} max={65535} value={m.form.cost ?? 0}
                      onChange={(e) => setMember(i, { cost: Number(e.target.value) || 0 })} />
                  </Row>
                  <Row label="Priority">
                    {/* FortiOS's floor here is 1, not 0 — a member created with priority 0 is
                        refused by the device. The manual "New SD-WAN Member" dialog (member-form.tsx)
                        already defaults to 1; this wizard used to default to 0. */}
                    <input className={inputCls} type="number" min={1} max={65535} value={m.form.priority ?? 1}
                      onChange={(e) => setMember(i, { priority: Number(e.target.value) || 1 })} />
                  </Row>
                </div>
              </Card>
            ))}
          </div>
        );

      case "slas":
        return (
          <div className="space-y-2.5 px-4 py-3.5">
            <p className="text-[11px] ink-3">
              A performance SLA probes a server over each member and measures the replies. Its
              thresholds are what an SD-WAN rule selects on.
            </p>
            {checks.map((c, i) => (
              <Card key={i} title={c.form.name || "(unnamed SLA)"}
                badge={deviceChecks.includes(c.form.name) ? <OnDevice /> : undefined}
                onRemove={() => setChecks((all) => all.filter((_, j) => j !== i))}>
                <Row label="Name">
                  {/* The firewall reserves the hyphen in this table specifically — which is why its
                      own checks are called Default_AWS. Saying so beats a -651 after Apply. */}
                  <input className={inputCls} value={c.form.name} maxLength={35}
                    onChange={(e) => setCheck(i, { name: e.target.value })} />
                  {c.form.name.includes("-") && (
                    <p className="mt-1 text-[10px] text-amber-600">
                      No hyphens here — the firewall reserves “-” in a performance SLA name. Use “_”.
                    </p>
                  )}
                </Row>
                <Row label="Probe mode">
                  <MinimalSelect ariaLabel="Probe mode" size="sm" className="w-full" value={c.form.detect_mode}
                    onChange={(v) => setCheck(i, { detect_mode: v })}
                    options={[
                      { value: "active", label: "Active" },
                      { value: "passive", label: "Passive" },
                      { value: "prefer-passive", label: "Prefer Passive" },
                    ]} />
                </Row>
                {c.form.detect_mode !== "passive" && (
                  <>
                    <Row label="Protocol">
                      <MinimalSelect ariaLabel="Protocol" size="sm" className="w-full" value={c.form.protocol}
                        onChange={(v) => setCheck(i, { protocol: v })}
                        options={[
                          { value: "ping", label: "Ping" },
                          { value: "http", label: "HTTP" },
                          { value: "dns", label: "DNS" },
                        ]} />
                    </Row>
                    <Row label="Server">
                      {/* At most two: the field itself holds two values and the device refuses a
                          third with "too many argument to set 3, 2". */}
                      <input className={inputCls} value={c.form.servers.join(" ")}
                        placeholder="1.1.1.1 8.8.8.8"
                        onChange={(e) => setCheck(i, {
                          servers: e.target.value.split(/\s+/).filter(Boolean).slice(0, 2),
                        })} />
                    </Row>
                    <div className="flex gap-2">
                      <Row label="Fail after">
                        <input className={inputCls} type="number" min={1} max={3600} value={c.form.failtime}
                          onChange={(e) => setCheck(i, { failtime: Number(e.target.value) || 1 })} />
                      </Row>
                      <Row label="Recover">
                        <input className={inputCls} type="number" min={1} max={3600} value={c.form.recoverytime}
                          onChange={(e) => setCheck(i, { recoverytime: Number(e.target.value) || 1 })} />
                      </Row>
                    </div>
                  </>
                )}
                {c.form.sla.length > 0 && (
                  <p className="text-[10.5px] ink-3">
                    SLA target{c.form.sla.length > 1 ? "s" : ""}:{" "}
                    {c.form.sla.map((s) => `#${s.id} ${s.link_cost_factor.join("/")}`).join(", ")}
                  </p>
                )}
                <p className="text-[10.5px] ink-3">
                  Participants:{" "}
                  {c.memberLocalSeqs.length === 0
                    ? "all SD-WAN members"
                    : c.memberLocalSeqs
                      .map((s) => members.find((m) => m.localSeq === s)?.form.interface ?? `#${s}`)
                      .join(", ")}
                </p>
              </Card>
            ))}
          </div>
        );

      case "rules":
        return (
          <div className="space-y-2.5 px-4 py-3.5">
            <p className="text-[11px] ink-3">
              A rule says which traffic leaves by which members, and how one is chosen. Rules are
              first-match, top to bottom.
            </p>
            {rules.map((r, i) => (
              <Card key={i} title={r.form.name || "(unnamed rule)"}
                badge={deviceRules.includes(r.form.name) ? <OnDevice /> : undefined}
                onRemove={() => setRules((all) => all.filter((_, j) => j !== i))}>
                <Row label="Name">
                  <input className={inputCls} value={r.form.name} maxLength={35}
                    onChange={(e) => setRule(i, { name: e.target.value })} />
                </Row>
                <Row label="Strategy">
                  <MinimalSelect ariaLabel="Strategy" size="sm" className="w-full" value={r.form.mode}
                    onChange={(v) => setRule(i, { mode: v })}
                    options={[
                      { value: "manual", label: "Manual" },
                      { value: "priority", label: "Best quality" },
                      { value: "sla", label: "Lowest cost (SLA)" },
                      { value: "load-balance", label: "Maximize bandwidth (SLA)" },
                    ]} />
                </Row>
                <Row label="Source">
                  <input className={inputCls} value={r.form.source.join(", ")}
                    placeholder="all"
                    onChange={(e) => setRule(i, {
                      source: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })} />
                </Row>
                <Row label="Destination">
                  <input className={inputCls} value={r.form.destination.join(", ")}
                    placeholder="all"
                    onChange={(e) => setRule(i, {
                      destination: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })} />
                </Row>
                <p className="text-[10.5px] ink-3">
                  Outgoing:{" "}
                  {[
                    ...r.memberLocalSeqs.map((s) =>
                      members.find((m) => m.localSeq === s)?.form.interface ?? `#${s}`),
                    ...r.form.zone_preference,
                  ].join(", ") || "— nothing chosen —"}
                </p>
                {r.form.required_sla_targets.length > 0 && (
                  <p className="text-[10.5px] ink-3">
                    Required SLA:{" "}
                    {r.form.required_sla_targets.map((t) => `${t.health_check}#${t.id}`).join(", ")}
                  </p>
                )}
              </Card>
            ))}
          </div>
        );

      case "review":
      default:
        return (
          <div className="space-y-3 px-4 py-3.5">
            {sdwanEnabled === false && (
              <div className="flex items-start gap-2 rounded-[4px] border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300">
                <FiAlertTriangle className="mt-0.5 shrink-0" size={12} />
                <span>
                  SD-WAN is currently <b>disabled</b> on {hostname || device.name}. These objects will
                  be created and will not steer any traffic until SD-WAN is turned on — which this
                  wizard does not do, because enabling it re-homes every route leaving through a
                  member interface. Turn it on from Network ▸ SD-WAN when you are ready.
                  {parsed.requestedStatus === true && " (The proposal assumed it was already on.)"}
                </span>
              </div>
            )}

            {blockers.length > 0 && (
              <div className="space-y-1 rounded-[4px] border border-red-200 bg-red-50 px-3 py-2 dark:border-red-400/25 dark:bg-red-500/10">
                <p className="m-0 flex items-center gap-1.5 text-[11px] font-semibold text-red-600 dark:text-red-300">
                  <FiAlertTriangle size={12} /> This proposal cannot be built as written
                </p>
                {blockers.map((b) => (
                  <p key={b} className="m-0 text-[11px] text-red-600 dark:text-red-300">• {b}</p>
                ))}
              </div>
            )}

            <div className="rounded-[4px] border hairline-2">
              {([
                ["SD-WAN Zones", zones.map((z) => z.name), deviceZones],
                ["Interface Members", members.map((m) => m.form.interface), deviceIfaces],
                ["Performance SLAs", checks.map((c) => c.form.name), deviceChecks],
                ["SD-WAN Rules", rules.map((r) => r.form.name), deviceRules],
              ] as [string, string[], string[]][]).filter(([, names]) => names.length > 0)
                .map(([label, names, onDev]) => (
                  <div key={label} className="border-b hairline-2 px-3 py-2 last:border-b-0">
                    <p className="m-0 text-[10px] font-bold uppercase tracking-wide ink-3">{label}</p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {names.map((n, i) => (
                        <span key={`${n}-${i}`} className="chip">
                          {onDev.includes(n) && <FiCheck size={9} className="mr-1" />}
                          {n || "(unnamed)"}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
            </div>

            <p className="text-[11px] ink-3">
              Applied in dependency order — zones, then members, then performance SLAs, then rules.
              Anything already on the device is skipped rather than overwritten, and the sequence
              numbers the SLAs and rules point at are the ones this firewall assigns, not the ones in
              the proposal.
            </p>
          </div>
        );
    }
  };

  return (
    <WizardShell
      title="AI SD-WAN Wizard"
      icon={<FiShare2 size={12} />}
      device={device}
      hostname={hostname}
      currentColor={currentColor}
      stepLabels={steps.map((s) => STEP_LABEL[s])}
      step={Math.min(step, steps.length - 1)}
      onStep={setStep}
      // Every step is a create — SD-WAN objects the device already has are skipped, never
      // overwritten, so "EDIT EXISTING" would be a promise this wizard does not make.
      isEdit={false}
      checking={checking}
      checkingLabel="Reading the firewall's SD-WAN configuration…"
      readOnly={readOnly}
      saving={saving}
      canApply={total > 0 && blockers.length === 0}
      applyDisabledReason={
        total === 0 ? "Nothing left to build — every object was removed from the draft"
          : blockers.length > 0 ? blockers[0]
            : undefined
      }
      onApply={() => void handleApply()}
      buildImpact={buildImpact}
      onCancel={onCancel}
    >
      {body()}
    </WizardShell>
  );
};

export default SDWANWizard;
