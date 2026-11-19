import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { FiActivity, FiCheck, FiPlus, FiSearch, FiTrash2 } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetSDWAN, DeviceGetSDWANHealthCheck,
  DeviceCreateSDWANHealthCheck, DeviceUpdateSDWANHealthCheck,
  type SDWANMember, type SDWANHealthCheckForm, type SDWANSLARow,
} from "../../api/policyObject";
import {
  PROBE_MODES, PROBE_PROTOCOLS, SLA_CRITERIA, MAX_SERVERS,
  hasLinkStatus, hasProbeTarget,
  emptyHealthCheckForm, emptySLARow, toHealthCheckForm, toHealthCheckPayload,
  validateHealthCheck, toggleCriterion,
  type SLAMetric,
} from "./slaFormat";
import { SDWANFormShell, fRow, fLabel, fInput, fSection } from "./form-shell";
import { apiErrorDetail } from "../../api/errorText";

// The FortiGate "New Performance SLA" dialog, as a page.
//
// Its shape is dictated by one field, the way the Priority Rule form's is dictated by `mode`.
// **Probe mode** decides what the device will keep:
//
//   Active          probe a server, and judge the link on the replies → every section shows
//   Passive         judge the link on traffic already flowing        → no server, no Link Status
//   Prefer Passive  passive where there is traffic, active where not → every section shows
//
// Passive is not a cosmetic difference. Measured on 10.0.99.201: with detect-mode passive, a PUT
// carrying failtime / recoverytime / update-static-route returns 200 and reads back unchanged, and
// the device turns update-static-route off by itself. So the form hides those sections there rather
// than showing three inputs that will be thrown away.
//
// The other rule worth knowing while reading this file: **Latency / Jitter / Packet Loss are not
// three independent numbers.** They are one `link-cost-factor` set plus its thresholds, and the
// device resets a threshold to its default the moment its criterion leaves the set. That is why the
// toggles switch criteria rather than "enable" a number.

// ── Small controls, shaped like the FortiGate's ──────────────────────────────

/** The dialog's segmented control: a row of buttons where exactly one is on. */
const Segmented: React.FC<{
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
  ariaLabel: string;
}> = ({ value, options, onChange, ariaLabel }) => (
  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={ariaLabel}>
    {options.map((o) => (
      <button key={o.value} type="button" role="radio" aria-checked={value === o.value}
        onClick={() => onChange(o.value)}
        className={`btn btn-sm ${value === o.value ? "btn-accent" : "btn-soft"}`}>
        {o.label}
      </button>
    ))}
  </div>
);

/** The dialog's on/off pill. */
const Toggle: React.FC<{
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}> = ({ on, onChange, label }) => (
  <button type="button" role="switch" aria-checked={on} aria-label={label}
    onClick={() => onChange(!on)}
    className="relative h-4.5 w-8.5 shrink-0 rounded-full border transition"
    style={{
      background: on ? "var(--accent)" : "var(--shell-sunken)",
      borderColor: on ? "var(--accent)" : "var(--shell-border)",
    }}>
    <span className="absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all"
      style={{ left: on ? 18 : 3 }} />
  </button>
);

/**
 * The Server rows: a list with a `+` under it.
 *
 * Capped at two because the device caps it at two — a third is refused outright with
 * "too many argument to set 3, 2", so offering a third row would only produce a failed save.
 */
const ServerRows: React.FC<{
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
}> = ({ values, onChange, placeholder }) => {
  const rows = values.length > 0 ? values : [""];
  return (
    <div className="flex-1 space-y-1.5">
      {rows.map((v, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className={`${fInput} bg-yellow-50 dark:bg-yellow-900/10`} value={v}
            placeholder={placeholder} maxLength={79}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? e.target.value : r)))} />
          {rows.length > 1 && (
            <button type="button" className="btn-icon btn-icon--danger" title="Remove this server"
              onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <FiTrash2 size={13} />
            </button>
          )}
        </div>
      ))}
      {rows.length < MAX_SERVERS && (
        <button type="button" onClick={() => onChange([...rows, ""])}
          className="flex h-8 w-full items-center justify-center rounded border hairline surface-card text-[12px] ink-2 surface-hover transition">
          <FiPlus size={13} />
        </button>
      )}
    </div>
  );
};

// ── The page ─────────────────────────────────────────────────────────────────

const SLAFormPage: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const deviceIdParam = params.get("deviceId");
  const nameParam = params.get("name");
  const isEdit = !!nameParam;
  const backTo = `/admin/sdwan?tab=slas${deviceIdParam ? `&deviceId=${deviceIdParam}` : ""}`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<SDWANHealthCheckForm>(emptyHealthCheckForm());

  const [members, setMembers] = useState<SDWANMember[]>([]);
  const [systemDNS, setSystemDNS] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    if (!deviceIdParam) { setLoading(false); return; }
    let live = true;
    void (async () => {
      const list = await ListDevices().catch(() => []);
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      if (!live) return;
      setDevice(found);
      if (!found) { setLoading(false); return; }

      // The member list is lenient — a picker that comes back empty is worth far less than a form
      // that refuses to open. The check being edited is NOT: a blank form saved over a real SLA
      // would overwrite it.
      const [overview, existing] = await Promise.all([
        DeviceGetSDWAN(found.id).catch(() => null),
        isEdit ? DeviceGetSDWANHealthCheck(found.id, nameParam!).catch(() => null) : Promise.resolve(null),
      ]);
      if (!live) return;

      if (overview) setMembers(overview.members);
      if (isEdit) {
        if (existing) {
          setForm(toHealthCheckForm(existing));
          setSystemDNS(existing.system_dns_servers ?? []);
        } else {
          setError(`No performance SLA named "${nameParam}" on this device`);
        }
      }
      setLoading(false);
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam, nameParam]);

  const set = <K extends keyof SDWANHealthCheckForm>(k: K, v: SDWANHealthCheckForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const showTarget = hasProbeTarget(form.detect_mode);
  const showLinkStatus = hasLinkStatus(form.detect_mode);
  const specifyDNS = form.protocol === "dns" && !form.system_dns;

  // "SLA Target" is one toggle over the whole `sla` table: on means at least one row, off means
  // none. Turning it off really does clear the table on this child object (unlike the rule's).
  const slaOn = form.sla.length > 0;
  const setSLAOn = (on: boolean) => set("sla", on ? [emptySLARow(nextSLAId(form.sla))] : []);

  const shownMembers = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    if (!q) return members;
    return members.filter((m) => `${m.interface} ${m.zone} ${m.seq_num}`.toLowerCase().includes(q));
  }, [members, pickerQuery]);

  const toggleMember = (seq: number) =>
    set("members", form.members.includes(seq)
      ? form.members.filter((s) => s !== seq)
      : [...form.members, seq]);

  const patchRow = (idx: number, next: SDWANSLARow) =>
    set("sla", form.sla.map((r, i) => (i === idx ? next : r)));

  const submit = async () => {
    if (!device) return;
    const problem = validateHealthCheck(form, isEdit);
    if (problem) { setError(problem); return; }
    setError("");
    setSaving(true);
    try {
      const payload = toHealthCheckPayload(form);
      if (isEdit) {
        await DeviceUpdateSDWANHealthCheck(device.id, nameParam!, payload);
        message.success(`Performance SLA "${nameParam}" updated on ${device.name}`);
      } else {
        await DeviceCreateSDWANHealthCheck(device.id, payload);
        message.success(`Performance SLA "${payload.name}" created on ${device.name}`);
      }
      navigate(backTo);
    } catch (err) {
      setError(apiErrorDetail(err, "The device rejected the performance SLA"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <SDWANFormShell
      icon={<FiActivity />}
      title={isEdit ? `Performance SLA — ${nameParam}` : "New Performance SLA"}
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
          {/* The name is the mkey. The FortiGate greys it out on an edit for the same reason this
              does: renaming is not what the OK button on this dialog means. */}
          <div className="flex-1">
            <input id="name" className={`${fInput} ${isEdit ? "opacity-60" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
              value={isEdit ? (nameParam ?? "") : form.name} maxLength={35} readOnly={isEdit}
              onChange={(e) => set("name", e.target.value)} />
            {!isEdit && (
              // The firewall reserves the hyphen in this table specifically — which is why its own
              // six checks are called Default_AWS and not Default-AWS.
              <p className="mt-1 text-[11px] ink-3">
                No hyphens: the firewall reserves <code>-</code> here. Use <code>_</code>, as its own
                Default_AWS does.
              </p>
            )}
          </div>
        </div>

        <div role="group" aria-labelledby="probe-mode-label" className={fRow}>
          <span id="probe-mode-label" className={fLabel}>Probe mode</span>
          <div className="flex-1 space-y-1.5">
            <Segmented ariaLabel="Probe mode" value={form.detect_mode}
              options={PROBE_MODES} onChange={(v) => set("detect_mode", v)} />
            <p className="text-[11px] ink-3">
              {PROBE_MODES.find((m) => m.value === form.detect_mode)?.hint}
            </p>
          </div>
        </div>

        {/* Passive sends nothing, so it has no protocol and no server. */}
        {showTarget && (
          <>
            <div role="group" aria-labelledby="protocol-label" className={fRow}>
              <span id="protocol-label" className={fLabel}>Protocol</span>
              <Segmented ariaLabel="Protocol" value={form.protocol}
                options={PROBE_PROTOCOLS} onChange={(v) => set("protocol", v)} />
            </div>

            {form.protocol === "dns" ? (
              <>
                <div role="group" aria-labelledby="dns-server-label" className={fRow}>
                  <span id="dns-server-label" className={fLabel}>DNS Server</span>
                  <Segmented ariaLabel="DNS server" value={form.system_dns ? "system" : "specify"}
                    options={[
                      { value: "system", label: "Same as System DNS" },
                      { value: "specify", label: "Specify" },
                    ]}
                    onChange={(v) => set("system_dns", v === "system")} />
                </div>
                {form.system_dns ? (
                  // Read-only, as in the dialog: these come from Network ▸ DNS, not from here.
                  <>
                    <div role="group" aria-labelledby="primary-dns-server-label" className={fRow}>
                      <span id="primary-dns-server-label" className={fLabel}>Primary DNS Server</span>
                      <span className="pt-1.5 text-[12.5px] ink-2">{systemDNS[0] ?? "—"}</span>
                    </div>
                    <div role="group" aria-labelledby="secondary-dns-server-label" className={fRow}>
                      <span id="secondary-dns-server-label" className={fLabel}>Secondary DNS Server</span>
                      <span className="pt-1.5 text-[12.5px] ink-2">{systemDNS[1] ?? "—"}</span>
                    </div>
                  </>
                ) : (
                  <div role="group" aria-labelledby="primary-dns-server-label-2" className={fRow}>
                    <span id="primary-dns-server-label-2" className={fLabel}>Primary DNS Server</span>
                    <ServerRows values={form.servers} placeholder="e.g. 8.8.8.8"
                      onChange={(v) => set("servers", v)} />
                  </div>
                )}
              </>
            ) : (
              <div role="group" aria-labelledby="server-label" className={fRow}>
                <span id="server-label" className={fLabel}>Server</span>
                <ServerRows values={form.servers}
                  placeholder={form.protocol === "http" ? "e.g. www.office.com" : "e.g. 1.1.1.1"}
                  onChange={(v) => set("servers", v)} />
              </div>
            )}
            {specifyDNS && (
              <p className="pl-43 text-[11px] ink-3">
                At most {MAX_SERVERS} — the field itself holds two values and the device refuses a third.
              </p>
            )}
          </>
        )}

        <div className={fRow}>
          <label htmlFor="participants" className={fLabel}>Participants</label>
          <div className="flex-1 space-y-1.5">
            <Segmented ariaLabel="Participants"
              value={form.members.length === 0 ? "all" : "specify"}
              options={[
                { value: "all", label: "All SD-WAN Members" },
                { value: "specify", label: "Specify" },
              ]}
              onChange={(v) => {
                if (v === "all") { set("members", []); setPickerOpen(false); }
                else setPickerOpen(true);
              }} />

            {(form.members.length > 0 || pickerOpen) && (
              <div className="rounded border hairline surface-card">
                <div className="flex flex-wrap gap-1.5 border-b hairline p-1.5">
                  {form.members.length === 0 ? (
                    <span className="px-1 py-0.5 text-[11px] ink-3">No member chosen yet</span>
                  ) : form.members.map((seq) => (
                    <span key={seq} className="chip chip-accent">
                      {members.find((m) => m.seq_num === seq)?.interface ?? `#${seq}`}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 border-b hairline px-2.5">
                  <FiSearch size={11} className="ink-3" />
                  <input id="participants" value={pickerQuery} onChange={(e) => setPickerQuery(e.target.value)}
                    placeholder="Search members"
                    className="h-7 w-full bg-transparent text-[11.5px] ink outline-none" />
                </div>
                <div className="max-h-44 overflow-y-auto p-1">
                  {shownMembers.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[11px] ink-3">
                      {members.length === 0
                        // The state this lab device is in: SD-WAN is off and has no members.
                        ? "There are no SD-WAN members on this device yet"
                        : "No member matches that filter"}
                    </p>
                  ) : shownMembers.map((m) => {
                    const on = form.members.includes(m.seq_num);
                    return (
                      <button key={m.seq_num} type="button" onClick={() => toggleMember(m.seq_num)}
                        className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left transition surface-hover">
                        <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border"
                          style={on
                            ? { background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" }
                            : { borderColor: "var(--shell-border)" }}>
                          {on && <FiCheck size={9} />}
                        </span>
                        <span className="truncate text-[12px] ink">{m.interface}</span>
                        <span className="ml-auto text-[11px] ink-3">#{m.seq_num} · {m.zone}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── SLA Target ─────────────────────────────────────────────────────── */}
      <div className={`${fSection} flex items-center gap-3`}>
        <span>SLA Target</span>
        <Toggle on={slaOn} onChange={setSLAOn} label="SLA Target" />
      </div>

      {slaOn && (
        <div className="space-y-4 px-5 py-5">
          {form.sla.map((row, idx) => (
            <div key={idx} className="space-y-3">
              {form.sla.length > 1 && (
                <div className="flex items-center gap-2">
                  <span className="chip">SLA #{row.id}</span>
                  <button type="button" className="btn-icon btn-icon--danger ml-auto"
                    title="Remove this SLA target"
                    onClick={() => set("sla", form.sla.filter((_, i) => i !== idx))}>
                    <FiTrash2 size={13} />
                  </button>
                </div>
              )}

              {SLA_CRITERIA.map((metric) => (
                <ThresholdRow key={metric} row={row} metric={metric}
                  onChange={(next) => patchRow(idx, next)} />
              ))}

              {/* A criterion the dialog has no switch for. Rows built over the CLI can use it, and
                  editing one here must not silently throw it away — so it is shown, read-only. */}
              {row.link_cost_factor.includes("mos") && (
                <p className="text-[11px] ink-3">
                  This SLA target also selects on MOS{row.mos_threshold ? ` (≥ ${row.mos_threshold})` : ""},
                  which the FortiGate dialog does not expose. It is kept as it is.
                </p>
              )}
            </div>
          ))}

          <button type="button" className="btn btn-soft btn-sm"
            onClick={() => set("sla", [...form.sla, emptySLARow(nextSLAId(form.sla))])}>
            <FiPlus size={13} /> Add another SLA target
          </button>
          <p className="text-[11px] ink-3">
            An SD-WAN rule selects on one of these by number — the pair it stores is
            &lt;this SLA&gt;#&lt;number&gt;.
          </p>
        </div>
      )}

      {/* ── Link Status ────────────────────────────────────────────────────── */}
      {showLinkStatus && (
        <>
          <div className={fSection}>Link Status</div>
          <div className="space-y-3 px-5 py-5">
            <NumberRow label="Check interval" unit="ms" value={form.interval}
              min={20} max={3600000} onChange={(v) => set("interval", v)} />
            <NumberRow label="Failures before inactive" value={form.failtime}
              min={1} max={3600} onChange={(v) => set("failtime", v)}
              hint="Consecutive missed probes before the member is taken out of service." />
            <NumberRow label="Restore link after" unit="check(s)" value={form.recoverytime}
              min={1} max={3600} onChange={(v) => set("recoverytime", v)}
              hint="Consecutive good probes before the member is used again." />
          </div>

          <div className={fSection}>Actions when Inactive</div>
          <div className="space-y-3 px-5 py-5">
            <div role="group" aria-labelledby="update-static-route-label" className={fRow}>
              <span id="update-static-route-label" className={fLabel}>Update static route</span>
              <div className="flex flex-1 items-start gap-2">
                <Toggle on={form.update_static_route} label="Update static route"
                  onChange={(v) => set("update_static_route", v)} />
                <p className="text-[11px] ink-3">
                  Withdraw the static routes that leave by a member the moment this check declares
                  it dead, so traffic reroutes instead of being blackholed.
                </p>
              </div>
            </div>
          </div>
        </>
      )}

      {!showLinkStatus && (
        <div className="px-5 py-4">
          <p className="text-[11.5px] ink-3">
            Passive mode judges the link from traffic that is already flowing, so it has no probe
            server and no Link Status thresholds — the firewall discards those settings rather than
            storing them.
          </p>
        </div>
      )}
    </SDWANFormShell>
  );
};

/** One "<criterion> threshold" line: the toggle, then the number it guards. */
const ThresholdRow: React.FC<{
  row: SDWANSLARow;
  metric: SLAMetric;
  onChange: (next: SDWANSLARow) => void;
}> = ({ row, metric, onChange }) => {
  const on = row.link_cost_factor.includes(metric);
  const label = metric === "packet-loss" ? "Packet Loss" : metric === "latency" ? "Latency" : "Jitter";
  const unit = metric === "packet-loss" ? "%" : "ms";
  const value = metric === "latency" ? row.latency_threshold
    : metric === "jitter" ? row.jitter_threshold : row.packetloss_threshold;
  const key = metric === "latency" ? "latency_threshold"
    : metric === "jitter" ? "jitter_threshold" : "packetloss_threshold";

  return (
    <div className={fRow}>
      <label htmlFor="threshold" className={fLabel}>{label} threshold</label>
      <div className="flex flex-1 items-center gap-2">
        <Toggle on={on} label={`${label} threshold`} onChange={() => onChange(toggleCriterion(row, metric))} />
        <input id="threshold" className={`${fInput} max-w-40 ${on ? "" : "opacity-50"}`} type="number"
          min={0} max={metric === "packet-loss" ? 100 : 10000000}
          value={value} disabled={!on}
          onChange={(e) => onChange({ ...row, [key]: Number(e.target.value) || 0 })} />
        <span className="text-[12px] ink-3">{unit}</span>
      </div>
    </div>
  );
};

const NumberRow: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  hint?: string;
  onChange: (v: number) => void;
}> = ({ label, value, min, max, unit, hint, onChange }) => (
  <div className={fRow}>
    <label htmlFor="field" className={fLabel}>{label}</label>
    <div className="flex-1">
      <div className="flex items-center gap-2">
        <input id="field" className={`${fInput} max-w-45`} type="number" min={min} max={max} value={value}
          onChange={(e) => onChange(Number(e.target.value) || 0)} />
        {unit && <span className="text-[12px] ink-3">{unit}</span>}
      </div>
      {hint && <p className="mt-1 text-[11px] ink-3">{hint}</p>}
    </div>
  </div>
);

/** The next free SLA number. The field is 1-32 and two rows cannot share one. */
const nextSLAId = (rows: SDWANSLARow[]): number => {
  const used = new Set(rows.map((r) => r.id));
  for (let i = 1; i <= 32; i += 1) if (!used.has(i)) return i;
  return 32;
};

export default SLAFormPage;
