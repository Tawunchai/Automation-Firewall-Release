import React, { useState } from "react";
import { FiUser, FiX } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import {
  DeviceCreateSNMPUser, DeviceUpdateSNMPUser,
  SNMP_AUTH_PROTOS, SNMP_EVENTS, SNMP_PRIV_PROTOS,
  type SNMPSecurityLevel, type SNMPUser,
} from "../../api/snmp";
import {
  emptyUserForm, userToForm, userToPayload, validateUserForm, type UserForm,
} from "./model";
import { EventsEditor, Field, FormSection, HostsEditor, Switch } from "./parts";

// "New SNMP User" / "Edit SNMP User" — FortiGate's v3 dialog: name and status, the two-row
// Security Level segmented control, Hosts, Queries, Traps, and the 42 SNMP Events.
//
// The security level is drawn exactly as FortiGate draws it, as two rows where the second is
// greyed until the first allows it, because the three levels are not three independent choices:
// there is no "private without authentication". What this adds is the password contract. The
// device never returns a password, only the fact that one exists, so on an edit both boxes start
// blank and blank MEANS "keep the stored one" — stated on the field rather than left to be
// discovered by clearing someone's credential.

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

/** FortiGate's two-row level picker, as a pair of segmented controls. */
const LevelPicker: React.FC<{
  level: SNMPSecurityLevel;
  onChange: (l: SNMPSecurityLevel) => void;
}> = ({ level, onChange }) => {
  const authed = level === "auth-no-priv" || level === "auth-priv";
  return (
    <div className="flex flex-col items-start gap-2">
      <div className="seg" role="group" aria-label="Authentication">
        <button type="button"
          className={`seg-item${!authed ? " seg-item--on" : ""}`}
          onClick={() => onChange("no-auth-no-priv")}>
          No Authentication
        </button>
        <button type="button"
          className={`seg-item${authed ? " seg-item--on" : ""}`}
          onClick={() => onChange("auth-no-priv")}>
          Authentication
        </button>
      </div>
      <div className="seg" role="group" aria-label="Privacy">
        <button type="button"
          className={`seg-item${level !== "auth-priv" ? " seg-item--on" : ""}`}
          disabled={!authed}
          onClick={() => onChange("auth-no-priv")}>
          No Private
        </button>
        <button type="button"
          className={`seg-item${level === "auth-priv" ? " seg-item--on" : ""}`}
          // Privacy without authentication is not a level SNMPv3 has, so this stays unreachable
          // until the row above allows it — the same thing FortiGate's own dialog does.
          disabled={!authed}
          onClick={() => onChange("auth-priv")}>
          Private
        </button>
      </div>
    </div>
  );
};

const UserFormDialog: React.FC<{
  open: boolean;
  deviceId: number;
  /** null = create. */
  editing: SNMPUser | null;
  onClose: () => void;
  onSaved: () => void;
}> = ({ open, deviceId, editing, onClose, onSaved }) => {
  const { currentColor } = useStateContext();
  const [form, setForm] = useState<UserForm>(() =>
    editing ? userToForm(editing) : emptyUserForm(ALL_EVENTS));
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof UserForm>(k: K, v: UserForm[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const needsAuth = form.security_level === "auth-no-priv" || form.security_level === "auth-priv";
  const needsPriv = form.security_level === "auth-priv";

  const save = async () => {
    const problem = validateUserForm(form, !!editing);
    if (problem) {
      message.error(problem);
      return;
    }
    try {
      setSaving(true);
      const payload = userToPayload(form);
      if (editing) await DeviceUpdateSNMPUser(deviceId, editing.name, payload);
      else await DeviceCreateSNMPUser(deviceId, payload);
      message.success(editing ? "SNMP user updated" : "SNMP user created");
      onSaved();
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not save the SNMP user"));
    } finally {
      setSaving(false);
    }
  };

  // What a blank password box means, said on the field rather than left to be found out.
  const keepHint = (has: boolean) =>
    editing
      ? (has ? "Leave blank to keep the stored password" : "No password is stored yet")
      : undefined;

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
          <FiUser className="text-[16px]" />
        </span>
        <div className="relative min-w-0 flex-1">
          <p className="m-0 text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: currentColor }}>
            {editing ? "Edit SNMP user" : "New SNMP user"}
          </p>
          <h3 className="m-0 truncate text-[14px] font-bold ink">{editing ? editing.name : "SNMP v3 User"}</h3>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon relative shrink-0">
          <FiX className="text-[15px]" />
        </button>
      </div>

      <div className="p-5">
      <FormSection title="User">
        <Field label="User Name" htmlFor="snmp-u-name">
          <input
            id="snmp-u-name"
            className="shell-input shell-input--sm"
            value={form.name}
            // The name is the mkey — renaming is a delete and a create on the device.
            disabled={!!editing}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Enabled">
          <Switch checked={form.status} onChange={(v) => set("status", v)} label="User enabled" />
        </Field>
      </FormSection>

      <FormSection title="Security Level">
        <LevelPicker level={form.security_level} onChange={(l) => set("security_level", l)} />

        {needsAuth && (
          <div className="mt-3">
            <Field label="Authentication Algorithm" htmlFor="snmp-u-authproto">
              <MinimalSelect id="snmp-u-authproto" size="sm" ariaLabel="Authentication Algorithm"
                value={form.auth_proto} onChange={(v) => set("auth_proto", v)}
                options={SNMP_AUTH_PROTOS.map((p) => ({ value: p, label: p.toUpperCase() }))} />
            </Field>
            <Field label="Password" htmlFor="snmp-u-authpwd" hint={keepHint(!!editing?.has_auth_pwd)}>
              <input id="snmp-u-authpwd" type="password" autoComplete="new-password"
                className="shell-input shell-input--sm"
                value={form.auth_pwd} onChange={(e) => set("auth_pwd", e.target.value)} />
            </Field>
          </div>
        )}

        {needsPriv && (
          <div className="mt-3">
            <Field label="Private Algorithm" htmlFor="snmp-u-privproto">
              <MinimalSelect id="snmp-u-privproto" size="sm" ariaLabel="Private Algorithm"
                value={form.priv_proto} onChange={(v) => set("priv_proto", v)}
                options={SNMP_PRIV_PROTOS.map((p) => ({ value: p, label: p.toUpperCase() }))} />
            </Field>
            <Field label="Password" htmlFor="snmp-u-privpwd" hint={keepHint(!!editing?.has_priv_pwd)}>
              <input id="snmp-u-privpwd" type="password" autoComplete="new-password"
                className="shell-input shell-input--sm"
                value={form.priv_pwd} onChange={(e) => set("priv_pwd", e.target.value)} />
            </Field>
          </div>
        )}
      </FormSection>

      <FormSection title="Hosts">
        <HostsEditor
          rows={form.notify_hosts}
          onChange={(rows) => set("notify_hosts", rows)}
          idPrefix="snmp-u"
        />
      </FormSection>

      <FormSection title="Queries">
        <Field label="Enabled">
          <Switch checked={form.queries} onChange={(v) => set("queries", v)} label="SNMP queries" />
        </Field>
        <PortField id="snmp-u-qport" label="Port" value={form.query_port}
          onChange={(v) => set("query_port", v)} disabled={!form.queries} />
      </FormSection>

      <FormSection title="Traps">
        <Field label="Enabled">
          <Switch checked={form.trap_status} onChange={(v) => set("trap_status", v)} label="SNMP traps" />
        </Field>
        <PortField id="snmp-u-tlport" label="Local Port" value={form.trap_lport}
          onChange={(v) => set("trap_lport", v)} disabled={!form.trap_status} />
        <PortField id="snmp-u-trport" label="Remote Port" value={form.trap_rport}
          onChange={(v) => set("trap_rport", v)} disabled={!form.trap_status} />
      </FormSection>

      <FormSection title="SNMP Events">
        <EventsEditor selected={form.events} onChange={(ev) => set("events", ev)} idPrefix="snmp-u" />
      </FormSection>
      </div>
    </Modal>
  );
};

export default UserFormDialog;
