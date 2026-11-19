import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiServer } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateLDAPServer, DeviceUpdateLDAPServer, DeviceGetLDAPServer,
  type LDAPServerPayload,
} from "../../api/policyObject";
import { LDAPServerFields } from "../user-auth/ldap-server-form";
import { useLDAPServerOptions, buildLDAPServerPayload, validateLDAPServerForm, ldapServerToForm, type LDAPServerFormState } from "../user-auth/ldap-server-form.logic";
import { ExchangeConnectorDrawer } from "../user-auth/exchange-connector-drawer";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const STEPS = ["LDAP Server"];

// The AI LDAP Server wizard — the same fields as the LDAP Servers page, prefilled from the
// model's CLI. A server the device already has opens in EDIT mode, so "point the AD server at
// the new DC" changes that object instead of colliding with -5.
const LDAPServerWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: LDAPServerPayload;
  target?: string;    // current server name on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (name: string, wasEdit: boolean, before?: LDAPServerPayload) => void;
  // Fires when the "+ Create" button inside the Exchange server picker creates a connector. It is
  // a SEPARATE device object created mid-wizard, so the chat has to hear about it or Fallback
  // would leave it behind after removing the LDAP server that referenced it.
  onExchangeCreated?: (name: string) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onExchangeCreated, onCancel }) => {
  const [form, setForm] = useState<LDAPServerFormState>(() => ldapServerToForm(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<LDAPServerPayload | null>(null);
  const [checking, setChecking] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);

  const { options, loading: loadingOptions, reload } = useLDAPServerOptions(device.id);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    DeviceGetLDAPServer(device.id, lookup).then((existing) => {
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      // Merge the AI's changes over the live server. The device never returns the bind password,
      // so a draft without one keeps whatever is stored (blank = unchanged on update).
      setForm(ldapServerToForm({ ...existing, ...draft }));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof LDAPServerFormState>(k: K, v: LDAPServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleApply = async () => {
    const errs = validateLDAPServerForm(form, { isEdit });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildLDAPServerPayload(form);
      if (isEdit) await DeviceUpdateLDAPServer(device.id, originalName || form.name, payload);
      else        await DeviceCreateLDAPServer(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} LDAP server "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} LDAP server`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <WizardShell
        title="AI LDAP Server Wizard" icon={<FiServer size={12} />}
        device={device} hostname={hostname} currentColor={currentColor}
        stepLabels={STEPS} step={0} onStep={() => {}}
        isEdit={isEdit} checking={checking}
        checkingLabel="Checking device for an existing LDAP server…"
        readOnly={readOnly} saving={saving}
        canApply={isAdmin}
        applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
        onApply={handleApply} onCancel={onCancel}
        buildImpact={() => objectApplyImpact({
          kind: "ldap-server", label: "LDAP Server", name: form.name, isEdit,
          facts: [
            `Server ${form.server}:${form.port} · ${form.bindType} bind` +
            (form.secureEnabled ? ` · ${form.protocol}` : " · unencrypted"),
          ],
          warnings: form.secureEnabled ? [] : [
            "This connection is not encrypted — the bind password crosses the network in plaintext",
          ],
        })}>

        <LDAPServerFields form={form} set={set} errors={errors} options={options}
          loadingOptions={loadingOptions} currentColor={currentColor}
          onCreateExchange={() => setExchangeOpen(true)} isEdit={isEdit} />
      </WizardShell>

      {/* "+ Create" inside the Exchange server picker — same panel the LDAP Servers page uses. */}
      <ExchangeConnectorDrawer
        open={exchangeOpen} deviceId={device.id} currentColor={currentColor}
        onClose={() => setExchangeOpen(false)}
        onCreated={(name) => { set("exchangeServer", name); reload(); onExchangeCreated?.(name); }}
      />
    </>
  );
};

export default LDAPServerWizard;
