import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiSearch, FiChevronDown, FiSlash, FiPlus } from "react-icons/fi";
import { type RouteInterface, type InternetService } from "../../api/policyObject";
import { labelCls, inputCls, rowCls, sectionHdr } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { focusRing } from "../../components/ui/form-controls.logic";
import type { RouteFormState } from "./route-form.logic";

// ─── Form state ────────────────────────────────────────────────────────────────
// ─── Datasource hook ───────────────────────────────────────────────────────────
// ─── Interface picker (interfaces + optional Blackhole), portal, searchable ───
const ifaceLabel = (i: RouteInterface) => (i.alias ? `${i.alias} (${i.name})` : i.name);

export const RouteInterfaceSelect: React.FC<{
  value: string; onChange: (v: string) => void;
  interfaces: RouteInterface[]; showBlackhole: boolean; currentColor: string;
}> = ({ value, onChange, interfaces, showBlackhole: allowBlackhole, currentColor }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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

  const selected = interfaces.find((i) => i.name === value);
  const displayLabel = value === "blackhole" ? "Blackhole" : selected ? ifaceLabel(selected) : value;
  const filtered = interfaces.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) || (i.alias || "").toLowerCase().includes(search.toLowerCase())
  );
  const showBlackhole = allowBlackhole && "blackhole".includes(search.toLowerCase());

  return (
    <div className="w-full">
      <button ref={btnRef} type="button" onClick={open ? closeMenu : openMenu}
        className="flex h-8 w-full items-center justify-between rounded border hairline surface-card px-2.5 text-[13px] ink outline-none surface-hover transition">
        <span className="flex items-center gap-1.5 truncate">
          {value === "blackhole" && <FiSlash size={12} className="ink-3" />}
          {value ? displayLabel : <span className="ink-3">Select interface…</span>}
        </span>
        <FiChevronDown size={13} className={`ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: pos.w, maxHeight: 300, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 border-b hairline-2 px-2.5 py-2">
            <FiSearch size={12} className="shrink-0 ink-3" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search" autoFocus
              className="flex-1 bg-transparent text-[12px] ink outline-none placeholder-ink" />
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 250 }}>
            {filtered.map((i) => {
              const isSel = i.name === value;
              return (
                <button key={i.name} type="button" onClick={() => { onChange(i.name); closeMenu(); }}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                  style={{ backgroundColor: isSel ? `${currentColor}12` : undefined }}
                  onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f8fafc"; }}
                  onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                  <span className="flex-1 truncate text-[12.5px] font-medium ink">{ifaceLabel(i)}</span>
                  {i.ip && <span className="ml-2 shrink-0 font-mono text-[10px] ink-3">{i.ip}</span>}
                </button>
              );
            })}
            {showBlackhole && (
              <button type="button" onClick={() => { onChange("blackhole"); closeMenu(); }}
                className="flex w-full items-center gap-2.5 border-t hairline-2 px-3 py-2 text-left transition-colors"
                style={{ backgroundColor: value === "blackhole" ? `${currentColor}12` : undefined }}
                onMouseEnter={(e) => { if (value !== "blackhole") (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f8fafc"; }}
                onMouseLeave={(e) => { if (value !== "blackhole") (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                <FiSlash size={12} className="ink-3" />
                <span className="flex-1 text-[12.5px] font-medium ink">Blackhole</span>
              </button>
            )}
            {filtered.length === 0 && !showBlackhole && <div className="px-3 py-3 text-[12px] ink-3">No match</div>}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Internet Service picker (searchable, ~1600 entries), portal ──────────────
export const InternetServiceSelect: React.FC<{
  value: number | null; label: string; onChange: (id: number, name: string) => void;
  services: InternetService[]; loading: boolean; currentColor: string;
}> = ({ value, label, onChange, services, loading, currentColor }) => {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const [pos, setPos]       = useState<{ x: number; y: number; w: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

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
  const filtered = search ? services.filter((s) => s.name.toLowerCase().includes(lc)).slice(0, 200) : services.slice(0, 200);
  const selectedName = value ? (services.find((s) => s.id === value)?.name || label) : "";

  return (
    <div className="w-full">
      <button ref={btnRef} type="button" onClick={open ? closeMenu : openMenu}
        className="flex h-8 w-full items-center justify-between rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none hover:bg-yellow-100/60 transition dark:bg-white/5">
        <span className="truncate">{selectedName || <span className="ink-3">Select Internet Service…</span>}</span>
        <FiChevronDown size={13} className={`ml-1 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && pos && createPortal(
        <div role="presentation" ref={popRef}
          className="overflow-hidden rounded-[4px] border hairline surface-card shadow-2xl"
          style={{ position: "fixed", left: pos.x, top: pos.y, width: Math.max(pos.w, 320), maxHeight: 340, zIndex: 9999 }}
          onMouseDown={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 border-b hairline-2 px-2.5 py-2">
            <FiSearch size={12} className="shrink-0 ink-3" />
            {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the popover has just opened on a click and its only job is to be filtered, so focus belongs in the search box -- the same place a native combobox puts it */}
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search internet service…" autoFocus
              className="flex-1 bg-transparent text-[12px] ink outline-none placeholder-ink" />
          </div>
          <div className="border-b hairline-2 surface-sunken px-3 py-1 text-[10px] font-bold uppercase tracking-wide ink-3">
            Internet Service ({services.length})
          </div>
          <div className="overflow-y-auto" style={{ maxHeight: 270 }}>
            {loading ? <div className="px-3 py-3 text-[12px] ink-3">Loading…</div>
              : filtered.length === 0 ? <div className="px-3 py-3 text-[12px] ink-3">No service found</div>
              : filtered.map((s) => {
                const isSel = s.id === value;
                return (
                  <button key={s.id} type="button" onClick={() => { onChange(s.id, s.name); closeMenu(); }}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors"
                    style={{ backgroundColor: isSel ? `${currentColor}12` : undefined }}
                    onMouseEnter={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = "#f8fafc"; }}
                    onMouseLeave={(e) => { if (!isSel) (e.currentTarget as HTMLButtonElement).style.backgroundColor = ""; }}>
                    <span className="flex-1 truncate text-[12.5px] ink">{s.name}</span>
                    <span className="ml-2 shrink-0 font-mono text-[10px] ink-3">{s.id}</span>
                  </button>
                );
              })}
            {!loading && !search && services.length > 200 && (
              <div className="px-3 py-2 text-[10px] ink-3">Showing first 200 — type to search all {services.length}.</div>
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// ─── Fields ─────────────────────────────────────────────────────────────────────
export type RouteFieldsProps = {
  form: RouteFormState;
  set: <K extends keyof RouteFormState>(k: K, v: RouteFormState[K]) => void;
  errors: Record<string, string>;
  interfaces: RouteInterface[];
  services: InternetService[];
  loadingSvc: boolean;
  currentColor: string;
};

// Field controls are capped to this width to match the FortiGate GUI (fields don't
// stretch across the whole form card).
const FIELD = "w-full max-w-md";

// ── Individual field rows — shared by the standalone page (RouteFields) and the
//    AI Static Route Wizard steps, so both render identical inputs. ──────────────
const DestinationRow: React.FC<RouteFieldsProps> = ({ form: f, set, errors, services, loadingSvc, currentColor }) => {
  const ring = focusRing(currentColor);
  return (
    <div className={rowCls}>
      <label htmlFor="destination" className={labelCls}>Destination</label>
      <div className={`${FIELD} space-y-2`}>
        <Segmented label="Destination" value={f.dstType} onChange={(v) => set("dstType", v as RouteFormState["dstType"])} currentColor={currentColor}
          options={[{ v: "subnet", l: "Subnet" }, { v: "internet-service", l: "Internet Service" }]} />
        {f.dstType === "subnet" ? (
          <div>
            <input id="destination" value={f.dst} onChange={(e) => set("dst", e.target.value)}
              placeholder="0.0.0.0/0.0.0.0" className={`${inputCls} w-full font-mono`} {...ring} />
            <p className="mt-1 text-[10px] ink-3">CIDR (10.0.0.0/24) or IP/mask (10.0.0.0/255.255.255.0)</p>
            {errors.dst && <p className="text-[11px] text-red-500">{errors.dst}</p>}
          </div>
        ) : (
          <div>
            <InternetServiceSelect value={f.internetService} label={f.internetServiceName}
              onChange={(id, name) => { set("internetService", id); set("internetServiceName", name); }}
              services={services} loading={loadingSvc} currentColor={currentColor} />
            {errors.internetService && <p className="mt-1 text-[11px] text-red-500">{errors.internetService}</p>}
          </div>
        )}
      </div>
    </div>
  );
};

// Gateway is hidden for a Blackhole subnet route (no next-hop).
const GatewayRow: React.FC<RouteFieldsProps> = ({ form: f, set, errors, currentColor }) => {
  const ring = focusRing(currentColor);
  if (f.dstType === "subnet" && f.device === "blackhole") return null;
  return (
    <div className={rowCls}>
      <label htmlFor="gateway-address" className={labelCls}>Gateway Address</label>
      <div className={FIELD}>
        <input id="gateway-address" value={f.gateway} onChange={(e) => set("gateway", e.target.value)}
          placeholder="10.0.0.1" className={`${inputCls} w-full font-mono`} {...ring} />
        {errors.gateway && <p className="mt-1 text-[11px] text-red-500">{errors.gateway}</p>}
      </div>
    </div>
  );
};

const InterfaceRow: React.FC<RouteFieldsProps> = ({ form: f, set, interfaces, currentColor }) => {
  // The GUI narrows the Interface picker by destination type: a Subnet route may egress
  // an SD-WAN zone or be a Blackhole; an Internet Service route may not (real interface
  // + gateway only), so drop sdwan-zone entries and hide Blackhole there.
  const isSubnet = f.dstType === "subnet";
  const ifaceOptions = isSubnet ? interfaces : interfaces.filter((i) => i.type !== "sdwan-zone");
  return (
    <div role="group" aria-labelledby="interface-label" className={rowCls}>
      <span id="interface-label" className={labelCls}>Interface</span>
      <div className={FIELD}>
        <RouteInterfaceSelect value={f.device} onChange={(v) => set("device", v)}
          interfaces={ifaceOptions} showBlackhole={isSubnet} currentColor={currentColor} />
      </div>
    </div>
  );
};

const DistanceRow: React.FC<RouteFieldsProps> = ({ form: f, set, currentColor }) => {
  const ring = focusRing(currentColor);
  return (
    <div className={rowCls}>
      <label htmlFor="administrative-distance" className={labelCls}>Administrative Distance</label>
      <input id="administrative-distance" value={f.distance} onChange={(e) => set("distance", e.target.value.replace(/[^0-9]/g, ""))}
        className={`${inputCls} w-32 font-mono`} {...ring} />
    </div>
  );
};

const CommentsRow: React.FC<RouteFieldsProps> = ({ form: f, set, currentColor }) => {
  const ring = focusRing(currentColor);
  return (
    <div className={rowCls}>
      <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
      <div className={`relative ${FIELD}`}>
        <textarea id="comments" value={f.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
          placeholder="Write a comment…" rows={2}
          className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none" {...ring} />
        <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{f.comment.length}/255</span>
      </div>
    </div>
  );
};

const StatusRow: React.FC<RouteFieldsProps> = ({ form: f, set, currentColor }) => (
  <div role="group" aria-labelledby="status-label" className={rowCls}>
    <span id="status-label" className={labelCls}>Status</span>
    <Segmented label="Route status" value={f.enabled ? "up" : "down"} onChange={(v) => set("enabled", v === "up")} currentColor={currentColor}
      options={[{ v: "up", l: "Enabled" }, { v: "down", l: "Disabled", danger: true }]} />
  </div>
);

const PriorityRow: React.FC<RouteFieldsProps> = ({ form: f, set, currentColor }) => {
  const ring = focusRing(currentColor);
  return (
    <div className={rowCls}>
      <label htmlFor="priority" className={labelCls}>Priority</label>
      <input id="priority" value={f.priority} onChange={(e) => set("priority", e.target.value.replace(/[^0-9]/g, ""))}
        className={`${inputCls} w-32 font-mono`} {...ring} />
    </div>
  );
};

// RouteFields — the full single-card layout used by the standalone create/edit pages,
// mirroring the FortiGate "New Static Route" screen order exactly.
export const RouteFields: React.FC<RouteFieldsProps> = (props) => {
  const { form: f } = props;
  const [showAdvanced, setShowAdvanced] = useState(true);
  return (
    <div className="space-y-4 px-6 py-5">
      <DestinationRow {...props} />
      <GatewayRow {...props} />
      <InterfaceRow {...props} />
      <DistanceRow {...props} />
      <CommentsRow {...props} />
      <StatusRow {...props} />

      {/* Advanced Options — only for a Subnet destination (matches the FortiGate GUI,
          which hides this section entirely for an Internet Service route). */}
      {f.dstType === "subnet" && (
        <div className="-mx-6">
          <button type="button" onClick={() => setShowAdvanced((s) => !s)}
            className={`${sectionHdr} flex w-full items-center gap-2 text-left`}>
            <FiPlus size={12} className={`transition-transform ${showAdvanced ? "rotate-45" : ""}`} />
            Advanced Options
          </button>
          {showAdvanced && (
            <div className="space-y-4 px-6 py-5">
              <PriorityRow {...props} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── AI Static Route Wizard steps (compose the same rows into two panels) ─────────
// Step 1 — Destination & egress: where the route points and how it leaves the device.
export const RouteFieldsDestination: React.FC<RouteFieldsProps> = (props) => (
  <div className="space-y-4 px-6 py-5">
    <DestinationRow {...props} />
    <GatewayRow {...props} />
    <InterfaceRow {...props} />
    <StatusRow {...props} />
  </div>
);

// Step 2 — Route settings: administrative distance, priority (Advanced), and comments.
export const RouteFieldsSettings: React.FC<RouteFieldsProps> = (props) => (
  <div className="space-y-4 px-6 py-5">
    <DistanceRow {...props} />
    {props.form.dstType === "subnet" && <PriorityRow {...props} />}
    <CommentsRow {...props} />
  </div>
);
