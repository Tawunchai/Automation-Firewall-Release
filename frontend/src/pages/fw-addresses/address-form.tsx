import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiSearch, FiX, FiPlus } from "react-icons/fi";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { type DeviceInterface, type SDNConnector } from "../../api/policyObject";

// ─── Address types ─────────────────────────────────────────────────────────────
// Match FortiGate's 6 address types shown in the GUI.
export const FG_TYPES = [
  { value: "ipmask",    label: "Subnet" },
  { value: "iprange",   label: "IP Range" },
  { value: "fqdn",      label: "FQDN" },
  { value: "geography", label: "Geography" },
  { value: "dynamic",   label: "Dynamic" },
  { value: "mac",       label: "Device (MAC Address)" },
] as const;
 // extra types only surfaced when editing an existing object

// Labels for ALL possible types (section headers).
// Dynamic address "Sub Type" — mirrors FortiOS's firewall.address sub-type option.
// "Fabric Connector Address" (sdn) is the default and the only one fully wired to a
// datasource (system.sdn-connector); the others require their matching Fabric Connector.
export const DYNAMIC_SUBTYPES = [
  { value: "sdn",             label: "Fabric Connector Address" },
  { value: "clearpass-spt",   label: "ClearPass SPT" },
  { value: "fsso",            label: "FSSO" },
  { value: "ems-tag",         label: "FortiClient EMS Tag" },
  { value: "fortivoice-tag",  label: "FortiVoice Tag" },
  { value: "fortinac-tag",    label: "FortiNAC Tag" },
  { value: "fortipolicy-tag", label: "FortiPolicy Tag" },
  { value: "swc-tag",         label: "Switch Controller NAC Policy Tag" },
] as const;

// "Static route configuration" (allow-routing) is only offered by the GUI for these types.
// ─── Standard FortiGate color palette (index 0-32) ───────────────────────────

// ─── ISO 3166-1 country list ─────────────────────────────────────────────────
// The table itself lives in lib/countries.ts now: the Local Traffic log needs the same data to
// put a flag beside an address, and one copy of a 250-row country list is enough. Re-exported so
// that everything importing it from here keeps working.
// A re-export alone would not bring the names into THIS module's scope, and the geography picker
// below uses both, so they are imported as well.
import { COUNTRIES, flagEmoji } from "../../lib/countries";
import { FG_COLORS } from "../../lib/categoryColor";
import { ALLOW_ROUTING_TYPES, TYPE_LABELS, ifaceLabel } from "./address-form.logic";
import type { AddressFormState, FGAddrType } from "./address-form.logic";

// ─── Shared styles ─────────────────────────────────────────────────────────────
export const labelCls = "block text-[12px] font-medium ink-2 min-w-[155px] shrink-0 pt-1";
export const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";
export const rowCls   = "flex items-start gap-3";
export const sectionHdr = "px-5 py-2.5 text-[11px] font-semibold ink-2 surface-sunken border-b border-t hairline";

// ─── Toggle ────────────────────────────────────────────────────────────────────
// A switch, not a clickable box. `label` is required rather than optional: a toggle with no
// accessible name is announced as "switch, checked" and nothing else, and the only reliable way to
// stop that happening again is to make the compiler ask for the name.
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color: string; label: string }> = ({ checked, onChange, color, label }) => (
  <button type="button" role="switch" aria-checked={checked} aria-label={label}
    onClick={() => onChange(!checked)}
    className="relative h-5 w-10 shrink-0 cursor-pointer rounded-full border-0 p-0 transition-colors"
    style={{ backgroundColor: checked ? color : "#cbd5e1" }}>
    <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
  </button>
);

// ─── Color Picker ──────────────────────────────────────────────────────────────
export const ColorPicker: React.FC<{ value: string; onChange: (c: string) => void }> = ({ value, onChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const display = value === "transparent" ? "#e5e7eb" : value;
  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <div role="presentation" className="h-6 w-8 rounded border hairline cursor-pointer shadow-sm"
        style={{ backgroundColor: display }} onClick={() => setOpen(!open)} />
      <button type="button" onClick={() => setOpen(!open)}
        className="rounded border hairline surface-card px-2.5 py-0.5 text-[12px] font-medium ink surface-hover transition shadow-sm">
        Change
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 rounded-[4px] border hairline surface-card p-2.5 shadow-xl" style={{ width: 224 }}>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wide ink-3">Color</p>
          <div className="grid grid-cols-8 gap-1">
            {FG_COLORS.map((c, i) => (
              <button key={i} type="button" onClick={() => { onChange(c); setOpen(false); }}
                className="h-5 w-5 rounded border transition hover:scale-110"
                style={{ backgroundColor: c === "transparent" ? "var(--shell-sunken)" : c, borderColor: c === value ? "#1d4ed8" : "transparent", outline: c === value ? "2px solid #3b82f6" : "none" }} />
            ))}
          </div>
          <button type="button" onClick={() => { onChange("transparent"); setOpen(false); }}
            className="mt-2 w-full rounded border hairline py-1 text-[11px] ink-2 surface-hover transition">
            No Color
          </button>
        </div>
      )}
    </div>
  );
};

// ─── Interface Dropdown (portal) ──────────────────────────────────────────────
export const InterfaceDropdown: React.FC<{
  value: string; onChange: (v: string) => void;
  interfaces: DeviceInterface[]; loading: boolean; currentColor: string;
}> = ({ value, onChange, interfaces, loading, currentColor }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const selected = interfaces.find((i) => i.name === value);

  const openMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 2, w: r.width });
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setSearch(""); setPos(null); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (btnRef.current?.contains(e.target as Node)) return; closeMenu(); };
    const onScroll = (e: Event) => { if (popRef.current?.contains(e.target as Node)) return; closeMenu(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const filtered = interfaces.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.alias.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex-1">
      <button ref={btnRef} type="button" onClick={open ? closeMenu : openMenu}
        className="flex h-8 w-full items-center justify-between rounded border hairline surface-card px-2.5 text-[13px] ink outline-none surface-hover transition">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-4 w-4 shrink-0 rounded border hairline surface-card" />
          <span className="truncate">{selected ? ifaceLabel(selected) : value}</span>
        </div>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: pos.w, maxHeight: 280, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 border-b hairline-2 px-2.5 py-2">
            <FiSearch size={12} className="shrink-0 ink-3" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="flex-1 bg-transparent text-[12px] ink outline-none placeholder-ink" />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 228 }}>
            {loading ? <div className="px-3 py-3 text-[12px] ink-3">Loading…</div>
              : filtered.length === 0 ? <div className="px-3 py-3 text-[12px] ink-3">No interface found</div>
              : filtered.map((iface) => {
                const isSel = iface.name === value;
                return (
                  <button key={iface.name} type="button" onClick={() => { onChange(iface.name); closeMenu(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: isSel ? `${currentColor}12` : undefined }}
                    onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--shell-hover)"; }}
                    onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                    <div className="h-4 w-4 shrink-0 rounded border flex items-center justify-center"
                      style={{ borderColor: isSel ? currentColor : "var(--shell-border)", backgroundColor: isSel ? `${currentColor}15` : "var(--shell-card)" }}>
                      {isSel && <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 6l3 3 5-5" stroke={currentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                    </div>
                    <span className="flex-1 truncate text-[12.5px] font-medium ink">{ifaceLabel(iface)}</span>
                    {iface.ip && iface.ip !== "0.0.0.0 0.0.0.0" && (
                      <span className="ml-2 shrink-0 font-mono text-[10px] ink-3">{iface.ip}</span>
                    )}
                  </button>
                );
              })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Country Dropdown (portal, searchable) ────────────────────────────────────
export const CountryDropdown: React.FC<{
  value: string; onChange: (code: string) => void; currentColor: string;
}> = ({ value, onChange, currentColor }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const selected = COUNTRIES.find((c) => c.code === value);

  const openMenu = () => {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ x: r.left, y: r.bottom + 2, w: r.width });
    setOpen(true);
  };
  const closeMenu = () => { setOpen(false); setSearch(""); setPos(null); };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (btnRef.current?.contains(e.target as Node)) return; closeMenu(); };
    const onScroll = (e: Event) => { if (popRef.current?.contains(e.target as Node)) return; closeMenu(); };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", onScroll, true);
    return () => { document.removeEventListener("mousedown", onDown); window.removeEventListener("scroll", onScroll, true); };
  }, [open]);

  const lc = search.toLowerCase();
  const filtered = COUNTRIES.filter((c) =>
    c.name.toLowerCase().includes(lc) || c.code.toLowerCase().includes(lc)
  );

  return (
    <div className="flex-1">
      <button ref={btnRef} type="button" onClick={open ? closeMenu : openMenu}
        className="flex h-8 w-full items-center justify-between rounded border hairline surface-card px-2.5 text-[13px] ink outline-none surface-hover transition">
        <span className="flex items-center gap-2 min-w-0 truncate">
          {selected
            ? <>{flagEmoji(selected.code)} {selected.name} <span className="ink-3 text-[11px]">({selected.code})</span></>
            : <span className="ink-3">Select country / region…</span>}
        </span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
          className={`ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: Math.max(pos.w, 300), maxHeight: 320, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 border-b hairline-2 px-2.5 py-2">
            <FiSearch size={12} className="shrink-0 ink-3" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search country…" autoFocus
              className="flex-1 bg-transparent text-[12px] ink outline-none placeholder-ink" />
            {search && (
              <button type="button" onClick={() => setSearch("")} className="ink-3 hover-ink">
                <FiX size={12} />
              </button>
            )}
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 270 }}>
            {filtered.length === 0
              ? <div className="px-3 py-3 text-[12px] ink-3">No country found</div>
              : filtered.map((c) => {
                const isSel = c.code === value;
                return (
                  <button key={c.code} type="button" onClick={() => { onChange(c.code); closeMenu(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: isSel ? `${currentColor}12` : undefined }}
                    onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "var(--shell-hover)"; }}
                    onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                    <span className="text-[16px] w-6 text-center shrink-0">{flagEmoji(c.code)}</span>
                    <span className="flex-1 text-[12.5px] ink">{c.name}</span>
                    <span className="shrink-0 font-mono text-[10px] ink-3">{c.code}</span>
                  </button>
                );
              })}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Form state + helpers ─────────────────────────────────────────────────────
// Splits the single "start-end" IP Range field into its two ends.
// Maps a device AddressObject back into editable form state (edit prefill).
// Loads the datasources the address form needs from the device (interfaces + SDN connectors).
// ─── CLI preview formatter ────────────────────────────────────────────────────
// ─── Field group props ─────────────────────────────────────────────────────────
export type AddressFieldsProps = {
  form: AddressFormState;
  set: <K extends keyof AddressFormState>(k: K, v: AddressFormState[K]) => void;
  errors: Record<string, string>;
  interfaces: DeviceInterface[];
  loadingIf: boolean;
  sdnConnectors: SDNConnector[];
  currentColor: string;
  isEdit?: boolean;      // lock Name + Type when editing an existing object
  hideTypeExtras?: boolean;
};

const focusRing = (currentColor: string) => ({
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  },
});

// ─── Section 1: Name / Color / Type + type-specific value ─────────────────────
export const AddressFieldsMain: React.FC<AddressFieldsProps> = ({ form: f, set, errors, sdnConnectors, currentColor, isEdit }) => {
  const ring = focusRing(currentColor);
  const macSet = (idx: number, v: string) => set("macAddrs", f.macAddrs.map((m, i) => i === idx ? v : m));
  const macAdd = () => set("macAddrs", [...f.macAddrs, ""]);
  const macDel = (idx: number) => set("macAddrs", f.macAddrs.filter((_, i) => i !== idx));

  return (
    <>
      <div className="space-y-4 px-6 py-5">
        <div className={rowCls}>
          <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
          <div className="flex-1">
            <input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} disabled={isEdit}
              className={`${inputCls} w-full ${isEdit ? "surface-sunken cursor-not-allowed" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
              {...ring} />
            {isEdit && <p className="mt-1 text-[10px] ink-3">Name can't be changed when editing an existing address.</p>}
            {errors.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
          </div>
        </div>
        <div role="group" aria-labelledby="color-label" className={rowCls}>
          <span id="color-label" className={labelCls}>Color</span>
          <ColorPicker value={f.color} onChange={(c) => set("color", c)} />
        </div>
        <div className={rowCls}>
          <label htmlFor="type" className={labelCls}>Type</label>
          <MinimalSelect id="type" value={f.type} disabled={isEdit} className="flex-1" ariaLabel="Type"
            onChange={(v) => set("type", v as FGAddrType)}
            options={[
              ...FG_TYPES.map((t) => ({ value: t.value, label: t.label })),
              // Surface extra types only if the existing object already uses them
              ...(f.type === "interface-subnet" ? [{ value: "interface-subnet", label: "Interface Subnet" }] : []),
              ...(f.type === "wildcard-fqdn" ? [{ value: "wildcard-fqdn", label: "FQDN" }] : []),
            ]} />
        </div>
      </div>

      <div className={sectionHdr}>{TYPE_LABELS[f.type] ?? "Configuration"}</div>
      <div className="space-y-4 px-6 py-5">

        {(f.type === "ipmask" || f.type === "interface-subnet") && (
          <div className={rowCls}>
            <label htmlFor="field" className={labelCls}>{f.type === "ipmask" ? "IP/Netmask" : "Subnet"}</label>
            <div className="flex-1">
              <input id="field" value={f.subnet} onChange={(e) => set("subnet", e.target.value)}
                placeholder="192.168.1.0/24" className={`${inputCls} w-full font-mono`} {...ring} />
              <p className="mt-1 text-[10px] ink-3">CIDR (192.168.1.0/24) or mask (192.168.1.0 255.255.255.0)</p>
              {errors.subnet && <p className="text-[11px] text-red-500">{errors.subnet}</p>}
            </div>
          </div>
        )}

        {f.type === "iprange" && (
          <div className={rowCls}>
            <label htmlFor="ip-range" className={labelCls}>IP Range <span className="text-red-500">*</span></label>
            <div className="flex-1">
              <input id="ip-range" value={f.ipRange} onChange={(e) => set("ipRange", e.target.value)}
                placeholder="192.168.1.1-192.168.1.100" className={`${inputCls} w-full font-mono`} {...ring} />
              <p className="mt-1 text-[10px] ink-3">Start and end IP separated by a hyphen</p>
              {errors.iprange && <p className="text-[11px] text-red-500">{errors.iprange}</p>}
            </div>
          </div>
        )}

        {(f.type === "fqdn" || f.type === "wildcard-fqdn") && (
          <div className={rowCls}>
            <label htmlFor="fqdn" className={labelCls}>FQDN <span className="text-red-500">*</span></label>
            <div className="flex-1">
              <input id="fqdn" value={f.fqdn} onChange={(e) => set("fqdn", e.target.value)}
                placeholder="example.com" className={`${inputCls} w-full`} {...ring} />
              <p className="mt-1 text-[10px] ink-3">e.g. example.com or *.example.com (wildcard)</p>
              {errors.fqdn && <p className="mt-1 text-[11px] text-red-500">{errors.fqdn}</p>}
            </div>
          </div>
        )}

        {f.type === "geography" && (
          <div role="group" aria-labelledby="country-region-label" className={rowCls}>
            <span id="country-region-label" className={labelCls}>Country/Region <span className="text-red-500">*</span></span>
            <div className="flex-1">
              <CountryDropdown value={f.country} onChange={(c) => set("country", c)} currentColor={currentColor} />
              {errors.country && <p className="mt-1 text-[11px] text-red-500">{errors.country}</p>}
            </div>
          </div>
        )}

        {f.type === "dynamic" && (<>
          <div className={rowCls}>
            <label htmlFor="sub-type" className={labelCls}>Sub Type</label>
            <MinimalSelect id="sub-type" value={f.subType} onChange={(v) => set("subType", v)}
              ariaLabel="Sub Type" className="flex-1"
              options={DYNAMIC_SUBTYPES.map((s) => ({ value: s.value, label: s.label }))} />
          </div>
          {f.subType === "sdn" ? (
            <div className={rowCls}>
              <label htmlFor="sdn-connector" className={labelCls}>SDN Connector <span className="text-red-500">*</span></label>
              <div className="flex-1">
                <MinimalSelect id="sdn-connector" value={f.sdn} onChange={(v) => set("sdn", v)}
                  ariaLabel="SDN Connector"
                  options={[
                    { value: "", label: sdnConnectors.length ? "Select SDN connector…" : "No SDN connectors configured" },
                    ...sdnConnectors.map((s) => ({ value: s.name, label: `${s.name}${s.type ? ` (${s.type})` : ""}` })),
                  ]} />
                {errors.sdn && <p className="mt-1 text-[11px] text-red-500">{errors.sdn}</p>}
                {sdnConnectors.length === 0 && (
                  <p className="mt-1 text-[10px] ink-3">Configure a Fabric Connector under Security Fabric → External Connectors first.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-[12px] ink-3">This sub-type is managed by its matching Fabric Connector on the device.</p>
          )}
        </>)}

        {f.type === "mac" && (
          <div className={rowCls}>
            <label htmlFor="mac-address" className={labelCls}>MAC Address</label>
            <div className="flex-1 space-y-2">
              {f.macAddrs.map((m, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input id="mac-address" value={m} onChange={(e) => macSet(idx, e.target.value)}
                    placeholder="MAC address or range (e.g. 00:11:22:33:44:55)"
                    className="h-8 flex-1 rounded border hairline bg-yellow-50 px-2.5 font-mono text-[12px] ink outline-none transition dark:bg-yellow-900/10"
                    {...ring} />
                  {f.macAddrs.length > 1 && (
                    <button type="button" onClick={() => macDel(idx)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded border hairline ink-3 hover:border-red-300 hover:bg-red-50 hover:text-red-500 transition">
                      <FiX size={12} />
                    </button>
                  )}
                </div>
              ))}
              <button type="button" onClick={macAdd}
                className="flex w-full items-center justify-center gap-1.5 rounded border border-dashed hairline surface-card py-1.5 text-[12px] ink-3 surface-hover transition">
                <FiPlus size={12} /> Add MAC Address
              </button>
              <p className="text-[10px] ink-3">Single: 00:11:22:33:44:55 · Range: 00:11:22:33:44:55-00:11:22:33:44:FF</p>
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ─── Section 2: Additional Options (interface / static route / comments) ──────
export const AddressFieldsOptions: React.FC<AddressFieldsProps> = ({ form: f, set, interfaces, loadingIf, currentColor }) => {
  const ring = focusRing(currentColor);
  return (
    <>
      <div className={sectionHdr}>Additional Options</div>
      <div className="space-y-4 px-6 py-5">
        <div role="group" aria-labelledby="interface-label" className={rowCls}>
          <span id="interface-label" className={labelCls}>Interface</span>
          <InterfaceDropdown value={f.iface} onChange={(v) => set("iface", v)} interfaces={interfaces} loading={loadingIf} currentColor={currentColor} />
        </div>
        {ALLOW_ROUTING_TYPES.includes(f.type) && (
          <div role="group" aria-labelledby="static-route-configuration-label" className={rowCls}>
            <span id="static-route-configuration-label" className={labelCls}>Static route configuration</span>
            <Toggle label="Static route configuration" checked={f.allowRouting} onChange={(v) => set("allowRouting", v)} color={currentColor} />
          </div>
        )}
        <div className={rowCls}>
          <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
          <div className="relative flex-1">
            <textarea id="comments" value={f.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
              placeholder="Write a comment…" rows={2}
              className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
              {...ring} />
            <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{f.comment.length}/255</span>
          </div>
        </div>
      </div>
    </>
  );
};
