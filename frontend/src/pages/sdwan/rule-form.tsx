import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { FiZap, FiCheck, FiPlus, FiSearch, FiX } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetSDWAN, DeviceGetSDWANRule, DeviceCreateSDWANRule, DeviceUpdateSDWANRule,
  DeviceListSDWANHealthChecks, DeviceListAddresses, DeviceListUserGroups,
  DeviceListUsers, DeviceListInternetServices,
  type SDWANRule, type SDWANZone, type SDWANMember, type SDWANHealthCheck,
} from "../../api/policyObject";
import { emptyRule, validateRule, MODE_LABELS } from "./ruleFormat";
import { SDWANFormShell, fRow, fLabel, fInput, fSection } from "./form-shell";
import { apiErrorDetail } from "../../api/errorText";

// The FortiGate "Priority Rule" form, as a page.
//
// Its shape is dictated by one field. `mode` — "Interface selection strategy" on screen — decides
// which of the settings below the device will actually keep; anything belonging to another strategy
// is accepted with a 200 and thrown away (see services/fortigate_sdwan_rule.go). So the form hides
// what does not apply rather than showing four inputs of which three are lies.

const STRATEGIES: { mode: string; hint: string }[] = [
  { mode: "manual", hint: "Manually assign outgoing members." },
  { mode: "priority", hint: "The member with the best measured performance is selected." },
  { mode: "sla", hint: "The member that meets SLA targets is selected. On a tie, the lowest cost wins." },
  { mode: "load-balance", hint: "Traffic is load balanced among members that meet SLA targets." },
];

const QUALITY_CRITERIA = ["latency", "jitter", "packet-loss", "inbandwidth", "outbandwidth", "bibandwidth"];
const HASH_MODES = ["round-robin", "source-ip-based", "source-dest-ip-based", "inbandwidth", "outbandwidth", "bibandwidth"];
const PROTOCOLS = [
  { value: 0, label: "any" }, { value: 1, label: "ICMP" }, { value: 6, label: "TCP" },
  { value: 17, label: "UDP" }, { value: 47, label: "GRE" }, { value: 50, label: "ESP" },
];

/** The dialog's `+` fields: a multi-select over a searchable list. */
const EntryPicker: React.FC<{
  title: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyHint?: string;
}> = ({ title, options, selected, onChange, emptyHint }) => {
  // `title` is already the human name of what is being picked ("internet services"), so the control
  // needs no extra prop — it just has to put it somewhere a screen reader will read.
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? options.filter((o) => o.toLowerCase().includes(needle)) : options;
  }, [options, q]);

  const toggle = (name: string) =>
    onChange(selected.includes(name) ? selected.filter((s) => s !== name) : [...selected, name]);

  return (
    <div className="flex-1">
      <div className="flex min-h-8 flex-wrap items-center gap-1.5 rounded border hairline surface-card p-1.5">
        {selected.map((s) => (
          <span key={s} className="chip chip-accent">
            {s}
            <button type="button" className="ml-1 opacity-70 hover:opacity-100"
              onClick={() => toggle(s)} aria-label={`Remove ${s}`}>
              <FiX size={9} />
            </button>
          </span>
        ))}
        <button type="button" aria-label={`Choose ${title}`} aria-haspopup="listbox" aria-expanded={open}
          onClick={() => { setOpen((v) => !v); setQ(""); }}
          className="ml-auto inline-flex h-5 items-center gap-1 rounded px-2 text-[11px] font-semibold ink-2 surface-hover">
          <FiPlus size={10} /> {open ? "Close" : "Add"}
        </button>
      </div>

      {open && (
        <div className="mt-1.5 rounded border hairline surface-card">
          <div className="flex items-center gap-1.5 border-b hairline px-2.5">
            <FiSearch size={11} className="ink-3" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${title}`}
              className="h-7 w-full bg-transparent text-[11.5px] ink outline-none" />
          </div>
          <div className="max-h-52 overflow-y-auto p-1">
            {shown.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] ink-3">
                {options.length === 0 ? (emptyHint ?? "No entries") : "No entry matches that filter"}
              </p>
            ) : shown.map((o) => {
              const on = selected.includes(o);
              return (
                <button key={o} type="button" onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition surface-hover">
                  <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border"
                    style={on
                      ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                      : { borderColor: "var(--shell-border)" }}>
                    {on && <FiCheck size={9} />}
                  </span>
                  <span className="truncate text-[12px] ink">{o}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

const RuleFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deviceIdParam = params.get("deviceId");
  const idParam = params.get("id");
  const isEdit = !!idParam;
  const backTo = `/admin/sdwan?tab=rules${deviceIdParam ? `&deviceId=${deviceIdParam}` : ""}`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<SDWANRule>(emptyRule());

  const [zones, setZones] = useState<SDWANZone[]>([]);
  const [members, setMembers] = useState<SDWANMember[]>([]);
  const [healthChecks, setHealthChecks] = useState<SDWANHealthCheck[]>([]);
  const [addresses, setAddresses] = useState<string[]>([]);
  const [userGroups, setUserGroups] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [internetServices, setInternetServices] = useState<string[]>([]);

  useEffect(() => {
    if (!deviceIdParam) { setLoading(false); return; }
    let live = true;
    void (async () => {
      const list = await ListDevices().catch(() => []);
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      if (!live) return;
      setDevice(found);
      if (!found) { setLoading(false); return; }

      // Every picker is lenient: one that comes back empty is worth far less than a form that
      // refuses to open. The rule itself is not — an edit form that silently showed a blank rule
      // would overwrite the real one on save.
      const [overview, health, addrs, groups, us, services, existing] = await Promise.all([
        DeviceGetSDWAN(found.id).catch(() => null),
        DeviceListSDWANHealthChecks(found.id).catch(() => [] as SDWANHealthCheck[]),
        DeviceListAddresses(found.id).catch(() => []),
        DeviceListUserGroups(found.id).catch(() => []),
        DeviceListUsers(found.id).catch(() => []),
        DeviceListInternetServices(found.id).catch(() => []),
        isEdit ? DeviceGetSDWANRule(found.id, Number(idParam)).catch(() => null) : Promise.resolve(null),
      ]);
      if (!live) return;

      if (overview) { setZones(overview.zones); setMembers(overview.members); }
      setHealthChecks(health);
      setAddresses(addrs.map((a: { name: string }) => a.name));
      setUserGroups(groups.map((g: { name: string }) => g.name));
      setUsers(us.map((u: { name: string }) => u.name));
      setInternetServices(services.map((s: { name: string }) => s.name));

      if (isEdit) {
        if (existing) setForm({ ...emptyRule(), ...existing });
        else setError(`No SD-WAN rule with id ${idParam} on this device`);
      }
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam, idParam]);

  const set = <K extends keyof SDWANRule>(k: K, v: SDWANRule[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Every SLA number defined on the device, as "<check>#<id>" — the pair the CMDB stores.
  const slaTargetOptions = useMemo(
    () => healthChecks.flatMap((h) => h.sla.map((s) => `${h.name}#${s.id}`)),
    [healthChecks],
  );
  const selectedTargets = form.required_sla_targets.map((t) => `${t.health_check}#${t.id}`);
  const setTargets = (keys: string[]) =>
    set("required_sla_targets", keys.map((k) => {
      const at = k.lastIndexOf("#");
      return { health_check: k.slice(0, at), id: Number(k.slice(at + 1)) };
    }));

  const memberOptions = useMemo(() => members.map((m) => `${m.seq_num}: ${m.interface}`), [members]);
  const selectedMembers = form.interface_preference
    .map((seq) => memberOptions.find((o) => o.startsWith(`${seq}: `)))
    .filter((v): v is string => !!v);
  const setMembers2 = (keys: string[]) =>
    set("interface_preference", keys.map((k) => Number(k.split(":")[0])));

  const hasPorts = form.protocol === 6 || form.protocol === 17;

  const submit = async () => {
    if (!device) return;
    const problem = validateRule(form);
    if (problem) { setError(problem); return; }
    setError("");
    setSaving(true);
    try {
      const { id, ...body } = form;
      void id;
      if (isEdit) {
        await DeviceUpdateSDWANRule(device.id, Number(idParam), body);
        message.success(`SD-WAN rule "${form.name}" updated on ${device.name}`);
      } else {
        await DeviceCreateSDWANRule(device.id, body);
        message.success(`SD-WAN rule "${form.name}" created on ${device.name}`);
      }
      navigate(backTo);
    } catch (err) {
      setError(apiErrorDetail(err, "The device rejected the rule"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SDWANFormShell
      icon={<FiZap />}
      title={isEdit ? `Priority Rule — ${form.name || idParam}` : "New Priority Rule"}
      device={device}
      backTo={backTo}
      loading={loading}
      saving={saving}
      error={error}
      onSubmit={() => void submit()}
    >
      <div className="space-y-3 px-5 py-5">
        <div className={fRow}>
          <label htmlFor="name" className={fLabel}>Name</label>
          <input id="name" className={`${fInput} bg-yellow-50 dark:bg-yellow-900/10`} value={form.name}
            maxLength={35} onChange={(e) => set("name", e.target.value)} />
        </div>
        <div role="group" aria-labelledby="status-label" className={fRow}>
          <span id="status-label" className={fLabel}>Status</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => set("status", true)}
              className={`btn btn-sm ${form.status ? "btn-accent" : "btn-soft"}`}>Enabled</button>
            <button type="button" onClick={() => set("status", false)}
              className={`btn btn-sm ${!form.status ? "btn-accent" : "btn-soft"}`}>Disabled</button>
          </div>
        </div>
      </div>

      <div className={fSection}>Source</div>
      <div className="space-y-3 px-5 py-5">
        <div role="group" aria-labelledby="address-label" className={fRow}>
          <span id="address-label" className={fLabel}>Address</span>
          <EntryPicker title="addresses" options={addresses}
            selected={form.source} onChange={(v) => set("source", v)} />
        </div>
        <div role="group" aria-labelledby="user-group-label" className={fRow}>
          <span id="user-group-label" className={fLabel}>User group</span>
          <EntryPicker title="user groups" options={[...userGroups, ...users]}
            selected={[...form.user_groups, ...form.users]}
            onChange={(v) => {
              // The device keeps groups and users in separate fields; the form offers one list.
              set("user_groups", v.filter((x) => userGroups.includes(x)));
              set("users", v.filter((x) => users.includes(x)));
            }} />
        </div>
      </div>

      <div className={fSection}>Destination</div>
      <div className="space-y-3 px-5 py-5">
        <div role="group" aria-labelledby="address-label-2" className={fRow}>
          <span id="address-label-2" className={fLabel}>Address</span>
          <div className="flex-1">
            <EntryPicker title="addresses" options={addresses}
              selected={form.destination} onChange={(v) => set("destination", v)} />
            {form.internet_service && (
              <p className="mt-1 text-[11px] ink-3">
                Ignored while an internet service is selected — the device stores one or the other.
              </p>
            )}
          </div>
        </div>
        <div className={fRow}>
          <label htmlFor="route-tag" className={fLabel}>Route tag</label>
          <input id="route-tag" className={`${fInput} max-w-[140px]`} type="number" min={0} value={form.route_tag}
            onChange={(e) => set("route_tag", Number(e.target.value) || 0)} />
        </div>
        <div className={fRow}>
          <label htmlFor="internet-service" className={fLabel}>Internet service</label>
          <div className="flex-1 space-y-1.5">
            <label className="flex items-center gap-2 text-[12px] ink-2">
              <input id="internet-service" type="checkbox" checked={form.internet_service}
                onChange={(e) => set("internet_service", e.target.checked)} />
              Match on internet service instead of a destination address
            </label>
            {form.internet_service && (
              <EntryPicker title="internet services" options={internetServices}
                selected={form.internet_service_names}
                onChange={(v) => set("internet_service_names", v)} />
            )}
          </div>
        </div>
      </div>

      <div className={fSection}>Outgoing Interfaces</div>
      <div className="space-y-3 px-5 py-5">
        <div className={fRow}>
          <label htmlFor="interface-selection-strategy" className={fLabel}>Interface selection strategy</label>
          <div className="flex-1 space-y-2">
            {STRATEGIES.map(({ mode, hint }) => (
              <label key={mode} className="flex cursor-pointer items-start gap-2">
                <input id="interface-selection-strategy" type="radio" name="sdwan-strategy" className="mt-0.5"
                  checked={form.mode === mode} onChange={() => set("mode", mode)} />
                <span>
                  <span className="block text-[12.5px] font-semibold ink">{MODE_LABELS[mode]}</span>
                  <span className="block text-[11px] ink-3">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        </div>

        <div role="group" aria-labelledby="interface-preference-label" className={fRow}>
          <span id="interface-preference-label" className={fLabel}>Interface preference</span>
          <EntryPicker title="members" options={memberOptions}
            selected={selectedMembers} onChange={setMembers2}
            emptyHint="There are no SD-WAN members on this device yet" />
        </div>

        <div role="group" aria-labelledby="zone-preference-label" className={fRow}>
          <span id="zone-preference-label" className={fLabel}>Zone preference</span>
          <EntryPicker title="zones" options={zones.map((z) => z.name)}
            selected={form.zone_preference} onChange={(v) => set("zone_preference", v)} />
        </div>

        {/* Only the chosen strategy's settings are shown — the device discards the rest. */}
        {form.mode === "priority" && (
          <>
            <div role="group" aria-labelledby="measured-sla-label" className={fRow}>
              <span id="measured-sla-label" className={fLabel}>Measured SLA</span>
              <EntryPicker title="performance SLAs" options={healthChecks.map((h) => h.name)}
                selected={form.measured_sla} onChange={(v) => set("measured_sla", v)} />
            </div>
            <div className={fRow}>
              <label htmlFor="quality-criteria" className={fLabel}>Quality criteria</label>
              <MinimalSelect id="quality-criteria" className="w-full max-w-[220px]" value={form.quality_criteria}
                ariaLabel="Quality criteria" onChange={(v) => set("quality_criteria", v)}
                options={QUALITY_CRITERIA.map((q) => ({ value: q, label: q }))} />
            </div>
          </>
        )}

        {(form.mode === "sla" || form.mode === "load-balance") && (
          <div role="group" aria-labelledby="required-sla-target-label" className={fRow}>
            <span id="required-sla-target-label" className={fLabel}>Required SLA target</span>
            <div className="flex-1">
              <EntryPicker title="SLA targets" options={slaTargetOptions}
                selected={selectedTargets} onChange={setTargets}
                emptyHint="No performance SLA on this device defines an SLA number yet" />
              {/* The device will not drop the last target once a rule has one. */}
              <p className="mt-1 text-[11px] ink-3">
                At least one is required, and the firewall will not let the last one be removed.
              </p>
            </div>
          </div>
        )}

        {form.mode === "load-balance" && (
          <div className={fRow}>
            <label htmlFor="load-balancing" className={fLabel}>Load balancing</label>
            <MinimalSelect id="load-balancing" className="w-full max-w-[220px]" value={form.hash_mode}
              ariaLabel="Load balancing" onChange={(v) => set("hash_mode", v)}
              options={HASH_MODES.map((h) => ({ value: h, label: h }))} />
          </div>
        )}

        <div role="group" aria-labelledby="protocol-label" className={fRow}>
          <span id="protocol-label" className={fLabel}>Protocol</span>
          <div className="flex flex-1 flex-wrap items-center gap-2">
            <MinimalSelect className="w-full max-w-[140px]" value={String(form.protocol)}
              ariaLabel="Protocol" onChange={(v) => set("protocol", Number(v))}
              options={PROTOCOLS.map((p) => ({ value: String(p.value), label: p.label }))} />
            {hasPorts && (
              <>
                <span className="text-[12px] ink-3">port</span>
                <input className={`${fInput} max-w-[90px]`} type="number" min={1} max={65535}
                  value={form.start_port}
                  onChange={(e) => set("start_port", Number(e.target.value) || 1)} />
                <span className="text-[12px] ink-3">to</span>
                <input className={`${fInput} max-w-[90px]`} type="number" min={1} max={65535}
                  value={form.end_port}
                  onChange={(e) => set("end_port", Number(e.target.value) || 65535)} />
              </>
            )}
          </div>
        </div>

        <div role="group" aria-labelledby="forward-dscp-label" className={fRow}>
          <span id="forward-dscp-label" className={fLabel}>Forward DSCP</span>
          <div className="flex flex-1 items-center gap-2">
            <input type="checkbox" checked={form.forward_dscp}
              onChange={(e) => set("forward_dscp", e.target.checked)} />
            {form.forward_dscp && (
              <input className={`${fInput} max-w-[160px]`} value={form.forward_dscp_tag}
                placeholder="e.g. 000010"
                onChange={(e) => set("forward_dscp_tag", e.target.value)} />
            )}
          </div>
        </div>
        <div role="group" aria-labelledby="reverse-dscp-label" className={fRow}>
          <span id="reverse-dscp-label" className={fLabel}>Reverse DSCP</span>
          <div className="flex flex-1 items-center gap-2">
            <input type="checkbox" checked={form.reverse_dscp}
              onChange={(e) => set("reverse_dscp", e.target.checked)} />
            {form.reverse_dscp && (
              <input className={`${fInput} max-w-[160px]`} value={form.reverse_dscp_tag}
                placeholder="e.g. 000010"
                onChange={(e) => set("reverse_dscp_tag", e.target.value)} />
            )}
          </div>
        </div>
      </div>
    </SDWANFormShell>
  );
};

export default RuleFormPage;
