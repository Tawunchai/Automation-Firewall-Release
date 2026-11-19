import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiUser } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateUser, DeviceUpdateUser, DeviceGetUser,
  type LocalUserPayload,
} from "../../api/policyObject";
import { LoginCredentialsStep, ContactInfoStep, ExtraInfoStep } from "../user-auth/user-definition-form";
import { useLocalUserOptions, buildLocalUserPayload, validateLocalUserForm, localUserToForm, type LocalUserFormState } from "../user-auth/user-definition-form.logic";
import { sectionHdr } from "../fw-addresses/address-form";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const STEPS = ["Login Credentials", "Contact Info", "Extra Info"];

// The AI User Definition wizard — the creation wizard's steps 2-4, prefilled from the model's
// CLI. (Step 1 "User Type" is fixed: the AI is told to emit `set type password` / Local User only.)
const UserDefinitionWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: LocalUserPayload;
  target?: string;    // current username on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (name: string, wasEdit: boolean, before?: LocalUserPayload) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<LocalUserFormState>(() => localUserToForm(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<LocalUserPayload | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const { options, loading: loadingOptions } = useLocalUserOptions(device.id);

  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    DeviceGetUser(device.id, lookup).then((existing) => {
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      // Overlay the AI's keys on the live user. The password is never returned by the device, so
      // an edit keeps the stored one unless the model proposed a new one.
      setForm(localUserToForm({ ...existing, ...draft }));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof LocalUserFormState>(k: K, v: LocalUserFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleApply = async () => {
    // On edit a blank password means "keep the current one".
    const errs = validateLocalUserForm(form, !isEdit);
    if (Object.keys(errs).length) {
      setErrors(errs);
      // Jump to the step that owns the first problem.
      if (errs.name || errs.password) setStep(0);
      else if (errs.fortitoken || errs.emailTo || errs.smsCountryCode || errs.smsPhone) setStep(1);
      else setStep(2);
      return;
    }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildLocalUserPayload(form);
      if (isEdit) await DeviceUpdateUser(device.id, originalName || form.name, payload);
      else        await DeviceCreateUser(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} user "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} user`));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps = { form, set, errors, options, loadingOptions, currentColor, isEdit };

  return (
    <WizardShell
      title="AI User Wizard" icon={<FiUser size={12} />}
      device={device} hostname={hostname} currentColor={currentColor}
      stepLabels={STEPS} step={step} onStep={setStep}
      isEdit={isEdit} checking={checking}
      checkingLabel="Checking device for an existing user…"
      readOnly={readOnly} saving={saving}
      canApply={isAdmin}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply} onCancel={onCancel}
      buildImpact={() => objectApplyImpact({
        kind: "user", label: "User", name: form.name, isEdit,
        facts: [
          `Signs in with a password` +
          (form.twoFactorEnabled ? ` · two-factor: ${form.authType}` : "") +
          (form.emailTo ? ` · email ${form.emailTo}` : ""),
        ],
        // A password is write-only on FortiOS: nothing can read the old one back, so an edit that
        // sets a new one is not reversible by Fallback.
        warnings: isEdit && form.password ? [
          "This sets a new password on the account — FortiGate never hands the old one back, so it cannot be undone",
        ] : [],
      })}>

      {step === 0 && <LoginCredentialsStep {...fieldsProps} />}
      {step === 1 && <ContactInfoStep {...fieldsProps} />}
      {step === 2 && (
        <>
          <div className={sectionHdr}>Extra Info</div>
          <ExtraInfoStep {...fieldsProps} />
        </>
      )}
    </WizardShell>
  );
};

export default UserDefinitionWizard;
