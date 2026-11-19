import React, { useEffect, useRef, useState } from "react";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { SERVICE_CATEGORIES, type ServiceProtocol, type ServiceCategory } from "../../api/policyObject";
import { FG_COLORS } from "../../lib/categoryColor";
import { emptyPortEntry } from "./service-form.logic";
import type { PortEntry, ServiceFormState } from "./service-form.logic";

// Re-exported because the CLI parsers and the wizards import it from this form.
export { FG_COLORS };

// ─── Types ─────────────────────────────────────────────────────────────────────
// A service write payload = the base ServicePayload plus the TCP/UDP/SCTP address restriction
// fields the backend accepts (fqdn / iprange) which aren't on the read-only ServicePayload type.
// ─── FortiGate color palette (index 0-32) ────────────────────────────────────

// ─── Shared styles ─────────────────────────────────────────────────────────────
export const labelCls = "block text-[12px] font-medium ink-2 min-w-[130px] shrink-0";
export const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";
export const rowCls   = "flex items-start gap-3";
export const sectionHdr = "px-5 py-2.5 text-[11px] font-semibold ink-2 surface-sunken border-b border-t hairline";
const portInput = "h-8 w-20 rounded border hairline surface-card px-2 text-[12px] ink outline-none";

// ─── Unique row id ─────────────────────────────────────────────────────────────
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
  return (
    <div className="relative flex items-center gap-2" ref={ref}>
      <div role="presentation" className="h-6 w-8 rounded border hairline cursor-pointer"
        style={{ backgroundColor: value === "transparent" ? "#e5e7eb" : value }}
        onClick={() => setOpen(!open)} />
      <button type="button" onClick={() => setOpen(!open)}
        className="rounded border hairline surface-card px-2.5 py-0.5 text-[12px] font-medium ink surface-hover transition">
        Change
      </button>
      {open && (
        <div className="absolute top-9 left-0 z-50 rounded-[4px] border hairline surface-card p-2.5 shadow-xl" style={{ width: 196 }}>
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

// ─── Port entry row ───────────────────────────────────────────────────────────
// Matches real FortiGate GUI: [Proto] [Low] - [High]  Source Port [Low] - [High]  [×]
const PortEntryRow: React.FC<{
  entry: PortEntry;
  showRemove: boolean;
  srcEnabled: boolean;
  onChange: (id: number, f: keyof PortEntry, v: string) => void;
  onRemove: (id: number) => void;
}> = ({ entry, showRemove, srcEnabled, onChange, onRemove }) => (
  <div className="flex items-center gap-1.5 flex-wrap">
    <MinimalSelect value={entry.protocol} onChange={(v) => onChange(entry.id, "protocol", v)}
      ariaLabel="Protocol" size="sm" className="w-20 shrink-0"
      options={[{ value: "TCP", label: "TCP" }, { value: "UDP", label: "UDP" }, { value: "SCTP", label: "SCTP" }]} />
    <input type="number" min={1} max={65535} placeholder="Low" value={entry.low}
      onChange={(e) => onChange(entry.id, "low", e.target.value)} className={portInput} />
    <span className="text-[11px] ink-3">-</span>
    <input type="number" min={1} max={65535} placeholder="High" value={entry.high}
      onChange={(e) => onChange(entry.id, "high", e.target.value)} className={portInput} />
    {srcEnabled && (
      <>
        <span className="mx-1 text-[11px] font-medium ink-2 shrink-0">Source Port</span>
        <input type="number" min={1} max={65535} placeholder="Low" value={entry.srcLow}
          onChange={(e) => onChange(entry.id, "srcLow", e.target.value)} className={portInput} />
        <span className="text-[11px] ink-3">-</span>
        <input type="number" min={1} max={65535} placeholder="High" value={entry.srcHigh}
          onChange={(e) => onChange(entry.id, "srcHigh", e.target.value)} className={portInput} />
      </>
    )}
    {showRemove && (
      <button type="button" onClick={() => onRemove(entry.id)}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded ink-3 hover:bg-red-50 hover:text-red-500 transition-colors">
        <FiTrash2 size={12} />
      </button>
    )}
  </div>
);

// ─── Form state + helpers ─────────────────────────────────────────────────────
// Build a FortiOS port-range string: "80 443 8080-8090", with ":src" appended when source ports set.
// Reverse of buildPortStr — parse "80 443 8080-8090" (optionally with ":src") into port rows.
// Maps a device ServiceObject back into editable form state (edit prefill).
// ─── CLI preview formatter ────────────────────────────────────────────────────
// ─── Field group props ─────────────────────────────────────────────────────────
export type ServiceFieldsProps = {
  form: ServiceFormState;
  set: <K extends keyof ServiceFormState>(k: K, v: ServiceFormState[K]) => void;
  errors: Record<string, string>;
  currentColor: string;
  isEdit?: boolean;   // lock Name when editing an existing object
};

const focusRing = (currentColor: string) => ({
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  },
});

// ─── Section 1: Basic (name / comments / color / category) ────────────────────
export const ServiceFieldsBasic: React.FC<ServiceFieldsProps> = ({ form: f, set, errors, currentColor, isEdit }) => {
  const ring = focusRing(currentColor);
  return (
    <div className="space-y-4 px-6 py-5">
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
        <div className="flex-1">
          <input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} disabled={isEdit}
            placeholder="e.g. CUSTOM-HTTP"
            className={`${inputCls} w-full ${isEdit ? "surface-sunken cursor-not-allowed" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
            {...ring} />
          {isEdit && <p className="mt-1 text-[10px] ink-3">Name can't be changed when editing an existing service.</p>}
          {errors.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
        </div>
      </div>
      <div className={rowCls}>
        <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
        <div className="relative flex-1">
          <textarea id="comments" value={f.comments} onChange={(e) => set("comments", e.target.value.slice(0, 255))}
            placeholder="Write a comment…" rows={2}
            className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
            {...ring} />
          <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{f.comments.length}/255</span>
        </div>
      </div>
      <div role="group" aria-labelledby="color-label" className={rowCls}>
        <span id="color-label" className={labelCls}>Color</span>
        <ColorPicker value={f.color} onChange={(c) => set("color", c)} />
      </div>
      <div className={rowCls}>
        <label htmlFor="category" className={labelCls}>Category</label>
        <MinimalSelect id="category" value={f.category} onChange={(v) => set("category", v as ServiceCategory)}
          ariaLabel="Category" className="flex-1"
          options={SERVICE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
      </div>
    </div>
  );
};

// ─── Section 2: Protocol Options ───────────────────────────────────────────────
export const ServiceFieldsProtocol: React.FC<ServiceFieldsProps> = ({ form: f, set, errors, currentColor }) => {
  const ring = focusRing(currentColor);
  const updDest = (id: number, field: keyof PortEntry, v: string) =>
    set("destPorts", f.destPorts.map((r) => r.id === id ? { ...r, [field]: v } : r));
  const remDest = (id: number) => set("destPorts", f.destPorts.filter((r) => r.id !== id));
  const addDest = () => set("destPorts", [...f.destPorts, emptyPortEntry()]);

  return (
    <>
      <div className={sectionHdr}>Protocol Options</div>
      <div className="space-y-4 px-6 py-5">
        <div className={rowCls}>
          <label htmlFor="protocol-type" className={labelCls}>Protocol Type</label>
          <MinimalSelect id="protocol-type" value={f.protocol} onChange={(v) => set("protocol", v as ServiceProtocol)}
            ariaLabel="Protocol Type" className="flex-1"
            options={[
              { value: "TCP/UDP/SCTP", label: "TCP/UDP/SCTP" },
              { value: "IP", label: "IP" },
              { value: "ICMP", label: "ICMP" },
              ...(f.protocol === "ICMPv6" ? [{ value: "ICMPv6", label: "ICMPv6" }] : []),
            ]} />
        </div>

        {f.protocol === "TCP/UDP/SCTP" && (<>
          <div className={rowCls}>
            <label htmlFor="address" className={labelCls}>Address</label>
            <div className="flex items-center gap-2 flex-1">
              <button type="button" onClick={() => set("addrMode", "iprange")}
                className={`rounded border px-3 py-1 text-[12px] font-semibold transition ${f.addrMode === "iprange" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hairline ink-2 surface-hover"}`}>
                IP Range
              </button>
              <button type="button" onClick={() => set("addrMode", "fqdn")}
                className={`rounded border px-3 py-1 text-[12px] font-semibold transition ${f.addrMode === "fqdn" ? "bg-emerald-600 text-white border-emerald-600" : "bg-white hairline ink-2 surface-hover"}`}>
                FQDN
              </button>
              <input id="address" value={f.addrVal} onChange={(e) => set("addrVal", e.target.value)}
                placeholder={f.addrMode === "iprange" ? "0.0.0.0" : "example.com"}
                className={`${inputCls} flex-1`} {...ring} />
            </div>
          </div>

          <div role="group" aria-labelledby="destination-port-label" className={rowCls}>
            <span id="destination-port-label" className={labelCls}>Destination Port</span>
            <div className="flex-1 space-y-2">
              {f.destPorts.map((entry) => (
                <PortEntryRow key={entry.id} entry={entry}
                  showRemove={f.destPorts.length > 1} srcEnabled={f.srcEnabled}
                  onChange={updDest} onRemove={remDest} />
              ))}
              <button type="button" onClick={addDest}
                className="flex w-full items-center justify-center gap-1 rounded border border-dashed hairline surface-card py-1 text-[12px] ink-3 surface-hover transition">
                <FiPlus size={13} />
              </button>
              {errors.dest && <p className="text-[11px] text-red-500">{errors.dest}</p>}
              <p className="text-[10px] ink-3">e.g. 80 (single) · 8080-8090 (range) · multiple rows for multiple ports</p>
            </div>
          </div>

          <div role="group" aria-labelledby="specify-source-ports-label" className={rowCls}>
            <span id="specify-source-ports-label" className={labelCls}>Specify Source Ports</span>
            <Toggle label="Specify source ports" checked={f.srcEnabled} onChange={(v) => set("srcEnabled", v)} color={currentColor} />
          </div>
        </>)}

        {f.protocol === "IP" && (
          <div className={rowCls}>
            <label htmlFor="protocol-number" className={labelCls}>Protocol Number <span className="text-red-500">*</span></label>
            <div className="flex-1">
              <input id="protocol-number" type="number" min={0} max={255} value={f.ipProto}
                onChange={(e) => set("ipProto", parseInt(e.target.value) || 0)}
                className={inputCls} {...ring} />
              <p className="mt-1 text-[10px] ink-3">e.g. 50=ESP, 51=AH, 89=OSPF</p>
              {errors.ipProto && <p className="text-[11px] text-red-500">{errors.ipProto}</p>}
            </div>
          </div>
        )}

        {(f.protocol === "ICMP" || f.protocol === "ICMPv6") && (<>
          <div className={rowCls}>
            <label htmlFor="icmp-type" className={labelCls}>ICMP Type</label>
            <div className="flex items-center gap-2 flex-1">
              <input id="icmp-type" type="number" min={-1} max={255} value={f.icmpType}
                onChange={(e) => set("icmpType", parseInt(e.target.value))}
                className={inputCls} {...ring} />
              <span className="shrink-0 text-[11px] ink-3">(-1 = any)</span>
            </div>
          </div>
          <div className={rowCls}>
            <label htmlFor="icmp-code" className={labelCls}>ICMP Code</label>
            <div className="flex items-center gap-2 flex-1">
              <input id="icmp-code" type="number" min={-1} max={255} value={f.icmpCode}
                onChange={(e) => set("icmpCode", parseInt(e.target.value))}
                className={inputCls} {...ring} />
              <span className="shrink-0 text-[11px] ink-3">(-1 = any)</span>
            </div>
          </div>
        </>)}
      </div>
    </>
  );
};
