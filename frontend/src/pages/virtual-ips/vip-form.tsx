import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import {
  FiGlobe, FiChevronLeft, FiSave, FiHardDrive, FiPlus, FiX,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetInfo, DeviceGetVirtualIP, DeviceCreateVirtualIP, DeviceUpdateVirtualIP,
  DeviceListInterfaces, DeviceListServices, DeviceListAddresses,
  type VirtualIP, type VIPProtocol,
} from "../../api/policyObject";
import { labelCls, inputCls } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import {
  EMPTY_VIP, validateVIP, buildVIPPayload, initialFilterState,
  showsStaticNAT, showsFQDN, showsPortForwarding, showsPortFields, showsExternalServicePort,
  showsServicesFilter, type FilterState,
} from "./vip-form-rules";
import { apiErrorDetail } from "../../api/errorText";

const sectionHdr = "px-6 py-2.5 text-[11px] font-semibold ink-2 surface-sunken border-b border-t hairline";
const rowCls = "flex items-start gap-3";

const Err: React.FC<{ msg?: string }> = ({ msg }) =>
  msg ? <p className="mt-1 text-[11px] text-red-500">{msg}</p> : null;

// A small toggle matching the GUI's Optional Filters / Port Forwarding switches.
//
// A <button role="switch">, not a clickable <div>. The div version could only be operated with a
// mouse: no tab stop, no space/enter, and nothing announced its state — and it is used five times
// on this one form, including for the switch that decides whether the firewall applies the VIP at
// all. The label travels with the control through `label`, so each instance says what it switches.
const Toggle: React.FC<{
  checked: boolean; onChange: (v: boolean) => void; color: string; label: string;
}> = ({ checked, onChange, color, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label}
    onClick={() => onChange(!checked)}
    className="relative h-5 w-10 shrink-0 cursor-pointer rounded-full border-0 p-0 transition-colors"
    style={{ backgroundColor: checked ? color : "#cbd5e1" }}>
    <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

// A list-of-strings editor (Source address rows, each with a ⊕ / ✕) matching the GUI.
const ListEditor: React.FC<{
  value: string[]; onChange: (v: string[]) => void; placeholder: string; currentColor: string;
}> = ({ value, onChange, placeholder, currentColor }) => {
  const ring = focusRing(currentColor);
  const rows = value.length ? value : [""];
  const setAt = (i: number, s: string) => onChange(rows.map((x, idx) => (idx === i ? s : x)));
  return (
    <div className="w-full max-w-md space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <input value={s} onChange={(e) => setAt(i, e.target.value)} placeholder={placeholder}
            className={`${inputCls} w-full font-mono`} {...ring} />
          {rows.length > 1 && (
            <button type="button" onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded border hairline ink-3 transition hover:border-red-300 hover:bg-red-50 hover:text-red-500">
              <FiX size={12} />
            </button>
          )}
        </div>
      ))}
      <button type="button" onClick={() => onChange([...rows, ""])}
        className="flex w-full max-w-md items-center justify-center rounded border hairline py-1 ink-3 transition surface-hover">
        <FiPlus size={13} />
      </button>
    </div>
  );
};

// A chip multi-select for the Services filter (service names live on the device).
const ChipSelect: React.FC<{
  values: string[]; options: string[]; currentColor: string; onChange: (v: string[]) => void;
}> = ({ values, options, currentColor, onChange }) => {
  const [open, setOpen] = useState(false);
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div className="relative w-full max-w-md">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded border hairline bg-yellow-50 px-1.5 py-1 dark:bg-yellow-900/10">
        {values.length === 0 && <span className="px-1 text-[12px] ink-3">Select services</span>}
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: currentColor, backgroundColor: `${currentColor}14` }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}><FiX size={11} /></button>
          </span>
        ))}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="ml-auto flex h-5 items-center justify-center rounded px-1 ink-3 surface-hover">
          <FiPlus size={13} />
        </button>
      </div>
      {open && (
        <>
          <div role="presentation" className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-[4px] border hairline surface-card py-1 shadow-lg">
            {remaining.length === 0 ? (
              <div className="px-3 py-2 text-[12px] ink-3">No more services</div>
            ) : remaining.map((o) => (
              <button key={o} type="button" onClick={() => { onChange([...values, o]); setOpen(false); }}
                className="block w-full px-3 py-1.5 text-left text-[12px] ink surface-hover">
                {o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

const InfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string }> =
  ({ device, hostname, currentColor }) => (
    <div className="space-y-3">
      <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
            style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
            <FiHardDrive size={12} />
          </div>
          <div>
            <p className="text-[13px] font-semibold ink">{hostname || (device?.name ?? "—")}</p>
            {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
          </div>
        </div>
      </div>
      <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
        </div>
        <div className="px-4 py-2 space-y-0.5">
          {[
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/197991/virtual-ips" },
            { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
          ].map(({ icon, label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
              {icon} {label} <FiExternalLink size={10} className="ml-auto opacity-60" />
            </a>
          ))}
        </div>
      </div>
      <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Fortinet Community</p>
        </div>
        <div className="px-4 py-2">
          <a href="https://community.fortinet.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
            <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
          </a>
        </div>
      </div>
    </div>
  );

const PROTOCOLS: { v: VIPProtocol; l: string }[] = [
  { v: "tcp", l: "TCP" }, { v: "udp", l: "UDP" }, { v: "sctp", l: "SCTP" }, { v: "icmp", l: "ICMP" },
];

// ── The form body (everything below the page header) ─────────────────────────
// Extracted so the standalone page AND the AI Virtual IP wizard render exactly the same fields
// with the same visibility rules — a VIP built in the chat is identical to one built by hand.
export type VIPFieldsProps = {
  form: VirtualIP;
  set: <K extends keyof VirtualIP>(k: K, v: VirtualIP[K]) => void;
  filters: FilterState;
  onToggleOptional: (on: boolean) => void;
  onToggleSource: (on: boolean) => void;
  onToggleServices: (on: boolean) => void;
  interfaces: string[];
  services: string[];
  fqdnAddrs: string[];
  errors: Record<string, string>;
  currentColor: string;
  isEdit?: boolean;
};

export const VIPFormFields: React.FC<VIPFieldsProps> = ({
  form, set, filters, onToggleOptional, onToggleSource, onToggleServices,
  interfaces, services, fqdnAddrs, errors, currentColor, isEdit,
}) => {
  const ring = focusRing(currentColor);
  return (
    <div className="overflow-hidden rounded-[4px] border hairline surface-card shadow-sm">
      {/* Identity */}
      <div className="space-y-4 px-6 py-5">
        <div role="group" aria-labelledby="vip-type-label" className={rowCls}>
          <span id="vip-type-label" className={labelCls}>VIP type</span>
          <span className="pt-1 text-[13px] font-semibold ink">IPv4</span>
        </div>
        <div className={rowCls}>
          <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
          <div className="flex-1 max-w-md">
            <input id="name" value={form.name} disabled={isEdit} onChange={(e) => set("name", e.target.value)}
              placeholder="e.g. Web_Server_VIP"
              className={`${inputCls} w-full ${isEdit ? "cursor-not-allowed surface-sunken" : "bg-yellow-50 dark:bg-yellow-900/10"}`} {...ring} />
            <Err msg={errors.name} />
          </div>
        </div>
        <div className={rowCls}>
          <label htmlFor="comments" className={labelCls}>Comments</label>
          <div className="relative flex-1 max-w-md">
            <textarea id="comments" value={form.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
              placeholder="Write a comment…" rows={2}
              className="w-full resize-none rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none" {...ring} />
            <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{form.comment.length}/255</span>
          </div>
        </div>
      </div>

      {/* Network */}
      <div className={sectionHdr}>Network</div>
      <div className="space-y-4 px-6 py-5">
        <div className={rowCls}>
          <label htmlFor="interface" className={labelCls}>Interface</label>
          <MinimalSelect id="interface" value={form.interface} onChange={(v) => set("interface", v)}
            ariaLabel="Interface" className="max-w-md flex-1"
            options={interfaces.map((i) => ({ value: i, label: i }))} />
        </div>
        <div role="group" aria-labelledby="type-label" className={rowCls}>
          <span id="type-label" className={labelCls}>Type</span>
          <Segmented label="Virtual IP type" value={form.type} currentColor={currentColor}
            onChange={(v) => set("type", v as VirtualIP["type"])}
            options={[{ v: "static-nat", l: "Static NAT" }, { v: "fqdn", l: "FQDN" }]} />
        </div>

        {showsStaticNAT(form) && (<>
          <div className={rowCls}>
            <label htmlFor="external-ip-address-range" className={labelCls}>External IP address/range</label>
            <div className="flex-1 max-w-md">
              <input id="external-ip-address-range" value={form.ext_ip} onChange={(e) => set("ext_ip", e.target.value)} placeholder="0.0.0.0"
                className={`${inputCls} w-full bg-yellow-50 font-mono dark:bg-yellow-900/10`} {...ring} />
              <Err msg={errors.ext_ip} />
            </div>
          </div>
          <div className={rowCls}>
            <label htmlFor="map-toipv4-address-range" className={labelCls}>Map to<br />IPv4 address/range</label>
            <div className="flex-1 max-w-md">
              <input id="map-toipv4-address-range" value={form.mapped_ip} onChange={(e) => set("mapped_ip", e.target.value)} placeholder="Starting IPv4 address"
                className={`${inputCls} w-full font-mono`} {...ring} />
              <Err msg={errors.mapped_ip} />
            </div>
          </div>
        </>)}

        {showsFQDN(form) && (<>
          <div className={rowCls}>
            <label htmlFor="external-fqdn-address" className={labelCls}>External FQDN address</label>
            <div className="flex-1 max-w-md">
              <MinimalSelect id="external-fqdn-address" value={form.ext_addr} onChange={(v) => set("ext_addr", v)}
                ariaLabel="External FQDN address" className="w-full"
                options={[{ value: "", label: "Select an FQDN address…" }, ...fqdnAddrs.map((a) => ({ value: a, label: a }))]} />
              <Err msg={errors.ext_addr} />
            </div>
          </div>
          <div className={rowCls}>
            <label htmlFor="mapped-address" className={labelCls}>Mapped address</label>
            <div className="flex-1 max-w-md">
              <MinimalSelect id="mapped-address" value={form.mapped_addr} onChange={(v) => set("mapped_addr", v)}
                ariaLabel="Mapped FQDN address" className="w-full"
                options={[{ value: "", label: "Select an FQDN address…" }, ...fqdnAddrs.map((a) => ({ value: a, label: a }))]} />
              <Err msg={errors.mapped_addr} />
            </div>
          </div>
        </>)}
      </div>

      {/* Optional Filters — a section master toggle (like Port Forwarding), with the Source
          address and Services sub-toggles revealed underneath it. */}
      <div className={`${sectionHdr} flex items-center gap-3`}>
        <Toggle checked={filters.optional} color={currentColor} label="Use optional filters" onChange={onToggleOptional} />
        Optional Filters
      </div>
      {filters.optional && (
        <div className="space-y-4 px-6 py-5">
          <div role="group" aria-labelledby="source-address-label" className={rowCls}>
            <span id="source-address-label" className={labelCls}>Source address</span>
            <div className="flex-1">
              <div className="mb-2"><Toggle checked={filters.source} color={currentColor} label="Filter by source address" onChange={onToggleSource} /></div>
              {filters.source && (
                <ListEditor value={form.source_filter.length ? form.source_filter : [""]}
                  onChange={(v) => set("source_filter", v)}
                  placeholder="Source IP / range / subnet" currentColor={currentColor} />
              )}
            </div>
          </div>
          {showsServicesFilter(form) && (
            <div role="group" aria-labelledby="services-label" className={rowCls}>
              <span id="services-label" className={labelCls}>Services</span>
              <div className="flex-1">
                <div className="mb-2"><Toggle checked={filters.services} color={currentColor} label="Filter by service" onChange={onToggleServices} /></div>
                {filters.services && (
                  <ChipSelect values={form.services} options={services} currentColor={currentColor}
                    onChange={(v) => set("services", v)} />
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Port Forwarding — Static NAT only */}
      {showsPortForwarding(form) && (<>
        <div className={`${sectionHdr} flex items-center gap-3`}>
          <Toggle checked={form.port_forward} color={currentColor} label="Enable port forwarding" onChange={(v) => set("port_forward", v)} />
          Port Forwarding
        </div>
        {form.port_forward && (
          <div className="space-y-4 px-6 py-5">
            <div role="group" aria-labelledby="protocol-label" className={rowCls}>
              <span id="protocol-label" className={labelCls}>Protocol</span>
              <Segmented label="Protocol" value={form.protocol} currentColor={currentColor}
                onChange={(v) => set("protocol", v as VIPProtocol)} options={PROTOCOLS} />
            </div>
            {form.protocol !== "icmp" && (<>
              <div role="group" aria-labelledby="port-mapping-type-label" className={rowCls}>
                <span id="port-mapping-type-label" className={labelCls}>Port Mapping Type</span>
                <Segmented label="Port Mapping Type" value={form.port_mapping_type} currentColor={currentColor}
                  onChange={(v) => set("port_mapping_type", v as VirtualIP["port_mapping_type"])}
                  options={[{ v: "1-to-1", l: "One to one" }, { v: "m-to-n", l: "Many to many" }]} />
              </div>
              {/* Hidden once Services is on — the service defines the external port. */}
              {showsExternalServicePort(form) && (
                <div className={rowCls}>
                  <label htmlFor="external-service-port" className={labelCls}>External service port</label>
                  <div className="flex-1 max-w-md">
                    <input id="external-service-port" value={form.ext_port} onChange={(e) => set("ext_port", e.target.value)} placeholder="1 to 65535"
                      className={`${inputCls} w-full bg-yellow-50 font-mono dark:bg-yellow-900/10`} {...ring} />
                    <Err msg={errors.ext_port} />
                  </div>
                </div>
              )}
              {showsPortFields(form) && (
                <div className={rowCls}>
                  <label htmlFor="map-to-ipv4-port" className={labelCls}>Map to IPv4 port</label>
                  <div className="flex-1 max-w-md">
                    <input id="map-to-ipv4-port" value={form.mapped_port} onChange={(e) => set("mapped_port", e.target.value)} placeholder="1 to 65535"
                      className={`${inputCls} w-full bg-yellow-50 font-mono dark:bg-yellow-900/10`} {...ring} />
                    <Err msg={errors.mapped_port} />
                  </div>
                </div>
              )}
            </>)}
          </div>
        )}
      </>)}
    </div>
  );
};

const VirtualIPFormPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceIdParam = searchParams.get("deviceId");
  const editName = searchParams.get("name");
  const isEdit = !!editName;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [fqdnAddrs, setFqdnAddrs] = useState<string[]>([]);
  const [loadingProfile, setLoadingProfile] = useState(isEdit);

  const [form, setForm] = useState<VirtualIP>(EMPTY_VIP);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = <K extends keyof VirtualIP>(k: K, v: VirtualIP[K]) => setForm((f) => ({ ...f, [k]: v }));

  // Optional Filters enable-switches — tracked apart from the data so an "enabled but empty"
  // editor is representable (see FilterState in vip-form-rules). Deriving these from the arrays is
  // what made the toggles impossible to turn on.
  const [filters, setFilters] = useState<FilterState>({ optional: false, source: false, services: false });
  const patchFilters = (p: Partial<FilterState>) => setFilters((s) => ({ ...s, ...p }));

  // Turning a sub-filter off clears its data so nothing stale is submitted; turning Source on
  // seeds one blank row so the editor has something to show.
  const toggleSource = (on: boolean) => {
    patchFilters({ source: on });
    if (!on) set("source_filter", []);
    else if (form.source_filter.length === 0) set("source_filter", [""]);
  };
  const toggleServices = (on: boolean) => {
    patchFilters({ services: on });
    if (!on) set("services", []);
  };
  // The section master, mirroring Port Forwarding: off ⇒ collapse and clear everything under it.
  const toggleOptional = (on: boolean) => {
    if (on) { patchFilters({ optional: true }); return; }
    setFilters({ optional: false, source: false, services: false });
    setForm((f) => ({ ...f, source_filter: [], services: [] }));
  };

  useEffect(() => {
    if (!deviceIdParam) { setLoadingProfile(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      setDevice(found);
      if (!found) { setLoadingProfile(false); return; }
      const info = await DeviceGetInfo(found.id);
      setHostname(info.hostname || found.name);
      DeviceListInterfaces(found.id).then((ifs) => setInterfaces(["any", ...ifs.map((i) => i.name)]));
      DeviceListServices(found.id).then((svcs) => setServices(svcs.map((s) => s.name)));
      // FQDN VIPs map between FQDN address objects.
      DeviceListAddresses(found.id).then((addrs) =>
        setFqdnAddrs(addrs.filter((a) => a.type === "fqdn" || a.type === "wildcard-fqdn").map((a) => a.name)));
      if (isEdit && editName) {
        const existing = await DeviceGetVirtualIP(found.id, editName);
        if (existing) {
          setForm({ ...EMPTY_VIP, ...existing });
          // Open the switches to reflect what was saved.
          setFilters(initialFilterState(existing));
        }
        setLoadingProfile(false);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateVIP(form);
    if (!device) errs.device = "No device";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildVIPPayload(form);
      if (isEdit && editName) {
        await DeviceUpdateVirtualIP(device!.id, editName, payload);
        message.success(`Virtual IP "${form.name}" updated on ${hostname || device!.name}`);
      } else {
        await DeviceCreateVirtualIP(device!.id, payload);
        message.success(`Virtual IP "${form.name}" created on ${hostname || device!.name}`);
      }
      navigate(`/admin/virtual-ips?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} virtual IP`), 8);
    } finally { setSaving(false); }
  };

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading virtual IP…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiGlobe />} accent={currentColor}
        title={isEdit ? `Edit Virtual IP — ${editName}` : "New Virtual IP"}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 transition surface-hover">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <VIPFormFields
            form={form} set={set} filters={filters}
            onToggleOptional={toggleOptional} onToggleSource={toggleSource} onToggleServices={toggleServices}
            interfaces={interfaces} services={services} fqdnAddrs={fqdnAddrs}
            errors={errors} currentColor={currentColor} isEdit={isEdit}
          />

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 rounded-[4px] border hairline px-5 text-[13px] font-semibold ink-2 transition surface-hover">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device}
            className="flex h-10 items-center gap-2 rounded-[4px] px-6 text-[13px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default VirtualIPFormPage;
