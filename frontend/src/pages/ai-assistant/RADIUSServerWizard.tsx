import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiKey } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateRADIUSServer, DeviceUpdateRADIUSServer, DeviceGetRADIUSServer,
  type RADIUSServerPayload,
} from "../../api/policyObject";
import { RADIUSServerFields } from "../user-auth/radius-server-form";
import { buildRADIUSServerPayload, validateRADIUSServerForm, radiusServerToForm, type RADIUSServerFormState } from "../user-auth/radius-server-form.logic";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const STEPS = ["RADIUS Server"];

// The AI RADIUS Server wizard — the same fields as the RADIUS Servers page, prefilled from the
// model's CLI. A server the device already has opens in EDIT mode, so "add a secondary RADIUS
// server to NPS-Corp" changes that object instead of colliding with -5.
const RADIUSServerWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: RADIUSServerPayload;
  target?: string;    // current server name on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (name: string, wasEdit: boolean, before?: RADIUSServerPayload) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<RADIUSServerFormState>(() => radiusServerToForm(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<RADIUSServerPayload | null>(null);
  const [checking, setChecking] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    DeviceGetRADIUSServer(device.id, lookup).then((existing) => {
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      // Merge the AI's changes over the live server. The device never returns the shared secrets,
      // so a draft without one keeps whatever is stored (blank = unchanged on update).
      setForm(radiusServerToForm({ ...existing, ...draft }));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof RADIUSServerFormState>(k: K, v: RADIUSServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleApply = async () => {
    const errs = validateRADIUSServerForm(form, { isEdit });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildRADIUSServerPayload(form);
      if (isEdit) await DeviceUpdateRADIUSServer(device.id, originalName || form.name, payload);
      else        await DeviceCreateRADIUSServer(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} RADIUS server "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} RADIUS server`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardShell
      title="AI RADIUS Server Wizard" icon={<FiKey size={12} />}
      device={device} hostname={hostname} currentColor={currentColor}
      stepLabels={STEPS} step={0} onStep={() => {}}
      isEdit={isEdit} checking={checking}
      checkingLabel="Checking device for an existing RADIUS server…"
      readOnly={readOnly} saving={saving}
      canApply={isAdmin}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply} onCancel={onCancel}
      buildImpact={() => objectApplyImpact({
        kind: "radius-server", label: "RADIUS Server", name: form.name, isEdit,
        facts: [
          `Primary server ${form.server}` +
          (form.secondaryServer ? ` · secondary ${form.secondaryServer}` : "") +
          ` · auth ${form.authMethodSpecify ? form.authType : "auto"}`,
        ],
        // Verified live: FortiOS keeps a backup host once it is set — clearing it over REST does
        // nothing — so the dialog says it before the write, not after.
        warnings: isEdit && !form.secondaryServer ? [
          "If a secondary server was set before, clearing the field does nothing — FortiOS will not remove a backup host over REST",
        ] : [],
      })}>

      {/* On EDIT the server exists, so the device's own Test Connectivity / Test User Credentials
          checks are live (they test what is SAVED, not the unsaved draft). On CREATE they stay
          disabled — the monitor API can only test a stored server by name. */}
      <RADIUSServerFields form={form} set={set} errors={errors} currentColor={currentColor}
        deviceId={device.id} savedName={isEdit ? (originalName || form.name) : ""} isEdit={isEdit} />
    </WizardShell>
  );
};

export default RADIUSServerWizard;
