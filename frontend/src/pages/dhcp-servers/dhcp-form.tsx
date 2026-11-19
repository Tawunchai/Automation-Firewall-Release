import React from "react";
import { FiPlus, FiX } from "react-icons/fi";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { Segmented } from "../../components/ui/form-controls";
import { describeLease, type DHCPDraft, type RangeDraft, type ReservationDraft } from "./model";
import { LEASE_PRESETS } from "./dhcp-form.logic";

// The DHCP Server form fields, shared by the standalone Create and Edit pages — moved out of the
// old single-page modal so both pages render identical inputs rather than drifting apart.

export const RangeRows: React.FC<{
  label: string;
  hint: string;
  rows: RangeDraft[];
  onChange: (rows: RangeDraft[]) => void;
  addLabel: string;
}> = ({ label, hint, rows, onChange, addLabel }) => (
  <div>
    <label className="field-label">{label}</label>
    <p className="t-meta m-0 mb-1.5">{hint}</p>
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="shell-input font-mono"
            placeholder="Start address"
            value={r.start_ip}
            aria-label={`${label} ${i + 1} start address`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, start_ip: e.target.value } : x)))}
          />
          <span className="ink-3">–</span>
          <input
            className="shell-input font-mono"
            placeholder="End address"
            value={r.end_ip}
            aria-label={`${label} ${i + 1} end address`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, end_ip: e.target.value } : x)))}
          />
          <button
            type="button"
            className="btn-icon btn-icon--danger shrink-0"
            aria-label={`Remove ${label} ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <FiX size={13} />
          </button>
        </div>
      ))}
    </div>
    <button
      type="button"
      className="btn btn-ghost btn-sm mt-2"
      onClick={() => onChange([...rows, { start_ip: "", end_ip: "" }])}
    >
      <FiPlus size={12} /> {addLabel}
    </button>
  </div>
);

export const AddressList: React.FC<{
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
}> = ({ label, values, onChange, max }) => (
  <div>
    <label className="field-label">{label}</label>
    <div className="space-y-2">
      {values.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            className="shell-input font-mono"
            value={v}
            aria-label={`${label} ${i + 1}`}
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          <button
            type="button"
            className="btn-icon btn-icon--danger shrink-0"
            aria-label={`Remove ${label} ${i + 1}`}
            onClick={() => onChange(values.filter((_, j) => j !== i))}
          >
            <FiX size={13} />
          </button>
        </div>
      ))}
    </div>
    {values.length < max && (
      <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => onChange([...values, ""])}>
        <FiPlus size={12} /> Add server
      </button>
    )}
  </div>
);

export const ReservationRows: React.FC<{
  rows: ReservationDraft[];
  onChange: (rows: ReservationDraft[]) => void;
}> = ({ rows, onChange }) => (
  <div>
    <p className="field-label">MAC reservations</p>
    <p className="t-meta m-0 mb-1.5">
      Reserve gives that MAC the address every time. Block refuses it a lease at all — so this is
      also the deny list.
    </p>
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid items-center gap-2" style={{ gridTemplateColumns: "1.3fr 1fr 110px 1fr 32px" }}>
          <input
            className="shell-input font-mono"
            placeholder="aa:bb:cc:dd:ee:ff"
            value={r.mac}
            aria-label={`Reservation ${i + 1} MAC address`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, mac: e.target.value } : x)))}
          />
          <input
            className="shell-input font-mono"
            placeholder={r.action === "block" ? "—" : "IP address"}
            value={r.action === "block" ? "" : r.ip}
            disabled={r.action === "block"}
            aria-label={`Reservation ${i + 1} IP address`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, ip: e.target.value } : x)))}
          />
          <MinimalSelect
            value={r.action}
            ariaLabel={`Reservation ${i + 1} action`}
            onChange={(v) => onChange(rows.map((x, j) => (j === i ? { ...x, action: v } : x)))}
            options={[
              { value: "reserved", label: "Reserve" },
              { value: "assign", label: "From pool" },
              { value: "block", label: "Block" },
            ]}
          />
          <input
            className="shell-input"
            placeholder="Description"
            value={r.description}
            aria-label={`Reservation ${i + 1} description`}
            onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
          />
          <button
            type="button"
            className="btn-icon btn-icon--danger"
            aria-label={`Remove reservation ${i + 1}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          >
            <FiX size={13} />
          </button>
        </div>
      ))}
    </div>
    <button
      type="button"
      className="btn btn-ghost btn-sm mt-2"
      onClick={() => onChange([...rows, { mac: "", ip: "", action: "reserved", description: "" }])}
    >
      <FiPlus size={12} /> Add reservation
    </button>
  </div>
);

export type DHCPFieldsProps = {
  draft: DHCPDraft;
  set: <K extends keyof DHCPDraft>(k: K, v: DHCPDraft[K]) => void;
  interfaces: string[];
  /** The interface a server serves cannot be moved once created — locks the field and changes its hint. */
  isEditing: boolean;
  currentColor: string;
};

/** The full single-card layout used by the standalone Create/Edit pages. */
export const DHCPFields: React.FC<DHCPFieldsProps> = ({ draft, set, interfaces, isEditing, currentColor }) => (
  <div className="space-y-4 px-6 py-5">
    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor="dh-intf" className="field-label">Interface</label>
        <input
          id="dh-intf"
          className="shell-input"
          list="dh-intf-list"
          value={draft.interface}
          disabled={isEditing}
          onChange={(e) => set("interface", e.target.value)}
        />
        <datalist id="dh-intf-list">
          {interfaces.map((n) => <option key={n} value={n} />)}
        </datalist>
        <p className="t-meta m-0 mt-1">
          {isEditing
            ? "The interface a server serves cannot be moved — delete it and make another."
            : "One server per interface."}
        </p>
      </div>

      <div>
        <label htmlFor="dh-lease" className="field-label">Lease time</label>
        <MinimalSelect
          id="dh-lease"
          ariaLabel="Lease time"
          value={String(draft.lease_time)}
          onChange={(v) => set("lease_time", Number(v))}
          options={[
            ...LEASE_PRESETS.map(([label, secs]) => ({ value: String(secs), label })),
            ...(!LEASE_PRESETS.some(([, s]) => s === draft.lease_time)
              ? [{ value: String(draft.lease_time), label: describeLease(draft.lease_time) }]
              : []),
          ]}
        />
      </div>

      <div>
        <label htmlFor="dh-mask" className="field-label">Netmask</label>
        <input
          id="dh-mask"
          className="shell-input font-mono"
          value={draft.netmask}
          onChange={(e) => set("netmask", e.target.value)}
        />
      </div>

      <div>
        <label htmlFor="dh-gw" className="field-label">Default gateway</label>
        <input
          id="dh-gw"
          className="shell-input font-mono"
          placeholder="Leave empty for none"
          value={draft.default_gateway}
          onChange={(e) => set("default_gateway", e.target.value)}
        />
      </div>
    </div>

    <RangeRows
      label="Address ranges"
      hint="What the clients get. Inside the interface's own subnet."
      rows={draft.ip_ranges}
      onChange={(rows) => set("ip_ranges", rows)}
      addLabel="Add range"
    />

    <RangeRows
      label="Excluded ranges"
      hint="Carved out of the ranges above — for the addresses given out by hand."
      rows={draft.exclude_ranges}
      onChange={(rows) => set("exclude_ranges", rows)}
      addLabel="Add excluded range"
    />

    <div className="grid gap-3 md:grid-cols-2">
      <div>
        <label htmlFor="dh-dns" className="field-label">DNS</label>
        <MinimalSelect
          id="dh-dns"
          ariaLabel="DNS"
          value={draft.dns_service}
          onChange={(v) => set("dns_service", v)}
          options={[
            { value: "default", label: "Same as the system DNS" },
            { value: "local", label: "The FortiGate itself" },
            { value: "specify", label: "Specify" },
          ]}
        />
        {draft.dns_service !== "specify" && (
          <p className="t-meta m-0 mt-1">Any addresses below are stored but not used in this mode.</p>
        )}
      </div>
      <div>
        {draft.dns_service === "specify" && (
          <AddressList
            label="DNS servers"
            values={draft.dns_servers}
            onChange={(v) => set("dns_servers", v)}
            max={4}
          />
        )}
      </div>
    </div>

    <div>
      <label htmlFor="dh-domain" className="field-label">Domain</label>
      <input
        id="dh-domain"
        className="shell-input"
        placeholder="Optional"
        value={draft.domain}
        onChange={(e) => set("domain", e.target.value)}
      />
    </div>

    <ReservationRows
      rows={draft.reservations}
      onChange={(rows) => set("reservations", rows)}
    />

    <div role="group" aria-labelledby="dh-status-label">
      <span id="dh-status-label" className="field-label">Status</span>
      <Segmented
        label="DHCP server status"
        value={draft.enabled ? "up" : "down"}
        onChange={(v) => set("enabled", v === "up")}
        currentColor={currentColor}
        options={[{ v: "up", l: "Enabled" }, { v: "down", l: "Disabled", danger: true }]}
      />
    </div>
  </div>
);
