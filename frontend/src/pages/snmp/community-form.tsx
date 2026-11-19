import React, { useState } from "react";
import { FiActivity, FiX } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import {
  DeviceCreateSNMPCommunity, DeviceUpdateSNMPCommunity,
  SNMP_EVENTS, type SNMPCommunity,
} from "../../api/snmp";
import {
  communityToForm, communityToPayload, emptyCommunityForm,
  validateCommunityForm, type CommunityForm,
} from "./model";
import { EventsEditor, Field, FormSection, HostsEditor, Switch } from "./parts";

// "New SNMP Community" / "Edit SNMP Community" — FortiGate's own dialog, section for section:
// name and status, Hosts, Queries (v1 and v2c, each with a port), Traps (v1 and v2c, each with a
// local and a remote port), and the 42 SNMP Events.
//
// The one place this deliberately differs from FortiGate: a community with no hosts is refused
// here. FortiOS accepts one and then answers every manager that knows the string, from any
// address — a wide-open agent produced by leaving a form blank.

const ALL_EVENTS = SNMP_EVENTS.map((e) => e.name);

const PortField: React.FC<{
  id: string; label: string; value: string; onChange: (v: string) => void; disabled?: boolean;
}> = ({ id, label, value, onChange, disabled }) => (
  <Field label={label} htmlFor={id}>
    <input
      id={id}
      inputMode="numeric"
      className="shell-input shell-input--sm w-28"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ""))}
    />
  </Field>
);

const CommunityFormDialog: React.FC<{
  open: boolean;
  deviceId: number;
  /** null = create. */
  editing: SNMPCommunity | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, deviceId, editing, onClose, onSaved }) => {
  const { currentColor } = useStateContext();
  const [form, setForm] = useState<CommunityForm>(() =>
    editing ? communityToForm(editing) : emptyCommunityForm(ALL_EVENTS));
  const [saving, setSaving] = useState(false);

  // The dialog is mounted fresh per open (see the `key` at the call site), so the initialiser
  // above is the only place the form is seeded — no effect syncing props into state.
  const set = <K extends keyof CommunityForm>(k: K, v: CommunityForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    const problem = validateCommunityForm(form);
    if (problem) {
      message.error(problem);
      return;
    }
    try {
      setSaving(true);
      const payload = communityToPayload(form);
      if (editing) await DeviceUpdateSNMPCommunity(deviceId, editing.id, payload);
      else await DeviceCreateSNMPCommunity(deviceId, payload);
      message.success(editing ? "SNMP community updated" : "SNMP community created");
      onSaved();
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not save the SNMP community"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      // FortiGate opens every one of its own SNMP create/edit panels as a sheet from the right
      // edge; this page mirrors that page, so it opens the same way.
      side="right"
      width="w-full max-w-lg"
      bodyClassName="p-0 shell-scroll-thin"
      footer={
        <>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-accent btn-sm" onClick={() => void save()} disabled={saving}>
            {saving
              ? <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              : null}
            {saving ? "Saving…" : "OK"}
          </button>
        </>
      }
    >
      {/* White-header drawer chrome — the Devices drawer's treatment: a soft accent badge + corner
          glow, an eyebrow + title, sticky to the top of the scroll. */}
      <div className="sticky top-0 z-10 flex items-center gap-3 overflow-hidden border-b border-slate-100 px-5 py-4 dark:border-white/8"
        style={{ background: "var(--shell-card)" }}>
        <span className="pointer-events-none absolute -right-8 -top-12 h-28 w-28 rounded-full"
          style={{ background: `color-mix(in srgb, ${currentColor} 9%, transparent)` }} />
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[6px]"
          style={{ color: currentColor, background: `color-mix(in srgb, ${currentColor} 12%, transparent)` }}>
          <FiActivity className="text-[16px]" />
        </span>
        <div className="relative min-w-0 flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: currentColor }}>
            {editing ? "Edit SNMP community" : "New SNMP community"}
          </p>
          <h3 className="m-0 truncate text-[14px] font-bold ink">{editing ? editing.name : "SNMP v1/v2c Community"}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon relative shrink-0">
          <FiX className="text-[15px]" />
        </button>
      </div>

      <div className="p-5">
      <FormSection title="Community">
        <Field label="Community Name" htmlFor="snmp-c-name">
          <input
            id="snmp-c-name"
            className="shell-input shell-input--sm"
            value={form.name}
            // The name is the mkey. Renaming would be a delete and a create on the device, which
            // is not what an edit dialog should quietly do.
            disabled={!!editing}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Enabled" htmlFor="snmp-c-status">
          <Switch checked={form.status} onChange={(v) => set("status", v)} label="Community enabled" />
        </Field>
      </FormSection>

      <FormSection title="Hosts">
        <HostsEditor
          rows={form.hosts}
          onChange={(rows) => set("hosts", rows)}
          withType
          idPrefix="snmp-c"
        />
      </FormSection>

      <FormSection title="Queries">
        <Field label="v1 Enabled">
          <Switch checked={form.query_v1_status} onChange={(v) => set("query_v1_status", v)} label="SNMP v1 queries" />
        </Field>
        <PortField id="snmp-c-qv1" label="Port" value={form.query_v1_port}
          onChange={(v) => set("query_v1_port", v)} disabled={!form.query_v1_status} />
        <Field label="v2c Enabled">
          <Switch checked={form.query_v2c_status} onChange={(v) => set("query_v2c_status", v)} label="SNMP v2c queries" />
        </Field>
        <PortField id="snmp-c-qv2" label="Port" value={form.query_v2c_port}
          onChange={(v) => set("query_v2c_port", v)} disabled={!form.query_v2c_status} />
      </FormSection>

      <FormSection title="Traps">
        <Field label="v1 Enabled">
          <Switch checked={form.trap_v1_status} onChange={(v) => set("trap_v1_status", v)} label="SNMP v1 traps" />
        </Field>
        <PortField id="snmp-c-tv1l" label="Local Port" value={form.trap_v1_lport}
          onChange={(v) => set("trap_v1_lport", v)} disabled={!form.trap_v1_status} />
        <PortField id="snmp-c-tv1r" label="Remote Port" value={form.trap_v1_rport}
          onChange={(v) => set("trap_v1_rport", v)} disabled={!form.trap_v1_status} />
        <Field label="v2c Enabled">
          <Switch checked={form.trap_v2c_status} onChange={(v) => set("trap_v2c_status", v)} label="SNMP v2c traps" />
        </Field>
        <PortField id="snmp-c-tv2l" label="Local Port" value={form.trap_v2c_lport}
          onChange={(v) => set("trap_v2c_lport", v)} disabled={!form.trap_v2c_status} />
        <PortField id="snmp-c-tv2r" label="Remote Port" value={form.trap_v2c_rport}
          onChange={(v) => set("trap_v2c_rport", v)} disabled={!form.trap_v2c_status} />
      </FormSection>

      <FormSection title="SNMP Events">
        <EventsEditor selected={form.events} onChange={(ev) => set("events", ev)} idPrefix="snmp-c" />
      </FormSection>
      </div>
    </Modal>
  );
};

export default CommunityFormDialog;
