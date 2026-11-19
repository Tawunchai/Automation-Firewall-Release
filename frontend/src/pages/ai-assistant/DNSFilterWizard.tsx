import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiWifi } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateDNSFilterProfile, DeviceUpdateDNSFilterProfile, DeviceGetDNSFilterProfile,
  DeviceGetDNSFilterMetadata,
  type DNSFilterProfileForm, type DNSFilterMetadata,
} from "../../api/policyObject";
import { DNSFieldsBasic, DNSFieldsOptions, DNSCategorySectionHeader, type DNSFieldsProps } from "../security-profiles/dnsfilter-form";
import { DEFAULT_DNSFILTER_META, validateDNSFilterForm } from "../security-profiles/dnsfilter-form.logic";
import { DNSFortiGuardFilter, DNSStaticDomainFilter } from "../security-profiles/dnsfilter-sections";
import { dnsPresetCategories } from "../security-profiles/dnsfilter-sections.logic";
import { avSectionHdr } from "../security-profiles/antivirus-form";
import { dnsFilterDraftToForm } from "./parseDNSFilterCLI";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

// Four steps covering every section of the real Security Profiles > DNS Filter page — nothing the
// page can do is missing here, so a profile built through the chat is identical to one built by
// hand. Same shape as the Web Filter and Application Control wizards.
const STEPS = [
  { key: "basic",      label: "Basic Setup" },
  { key: "categories", label: "FortiGuard Category Filter" },
  { key: "domains",    label: "Static Domain Filter" },
  { key: "options",    label: "Options" },
] as const;

const DNSFilterWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<DNSFilterProfileForm>;
  target?: string;
  readOnly?: boolean;
  currentColor: string;
  // wasEdit=true means an EXISTING profile was updated, not created — Fallback can't undo an
  // edit by deleting the profile, so it is never recorded as ours (see undoApply.ts).
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (profileName: string, wasEdit: boolean, before?: DNSFilterProfileForm) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<DNSFilterProfileForm>(() => dnsFilterDraftToForm(draft));
  const [meta, setMeta] = useState<DNSFilterMetadata>(DEFAULT_DNSFILTER_META);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<DNSFilterProfileForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // If a profile with the AI-proposed name already exists, switch to edit mode: prefill from the
  // live profile, then overlay the AI's changes → Apply becomes an update instead of a create
  // (a duplicate name is -5 on the device). Otherwise seed the category grid the way the device's
  // own "New DNS Filter Profile" page does — every category on Monitor — and let the AI's own
  // categories win over that when it proposed any.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setLoadingMeta(true);
    const lookup = target || draft.name;

    const metaPromise = DeviceGetDNSFilterMetadata(device.id)
      .then((m) => { if (!cancelled) setMeta(m); return m; })
      .finally(() => { if (!cancelled) setLoadingMeta(false); });

    (async () => {
      const m = await metaPromise;
      let existing: DNSFilterProfileForm | null = null;
      if (lookup) {
        try { existing = await DeviceGetDNSFilterProfile(device.id, lookup); } catch { /* create */ }
      }
      if (cancelled) return;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
      setBefore(existing);
        setForm({ ...existing, ...draft });
      } else {
        const seeded = dnsFilterDraftToForm(draft);
        if (seeded.categories.length === 0 && m.categories.length > 0) {
          seeded.categories = dnsPresetCategories(m.categories, "custom");
        }
        setForm(seeded);
      }
    })().finally(() => { if (!cancelled) setChecking(false); });

    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof DNSFilterProfileForm>(k: K, v: DNSFilterProfileForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const fieldsProps: DNSFieldsProps = { form, set, meta, currentColor, errors, isEdit };

  const validate = (): boolean => {
    const errs = validateDNSFilterForm(form);
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleApply = async () => {
    if (!validate()) {
      // Both fields the shared validator can reject live on a step the user may not be looking at:
      // name on step 1, the portal IP on step 4. Take them to the one that is actually wrong.
      setStep(errors.name || !form.name.trim() ? 0 : STEPS.length - 1);
      message.error(Object.values(validateDNSFilterForm(form))[0]);
      return;
    }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    try {
      setSaving(true);
      if (isEdit) await DeviceUpdateDNSFilterProfile(device.id, originalName || form.name, form);
      else        await DeviceCreateDNSFilterProfile(device.id, form);
      message.success(`${isEdit ? "Update" : "Create"} DNS Filter "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} DNS Filter profile`));
    } finally {
      setSaving(false);
    }
  };

  const onStep = (i: number) => {
    // Moving forward off the first step requires a name — the rest is optional.
    if (i > step && step === 0 && !validate()) return;
    setStep(Math.max(0, Math.min(i, STEPS.length - 1)));
  };

  const stepBody = () => {
    switch (STEPS[step].key) {
      case "basic":
        return <DNSFieldsBasic {...fieldsProps} />;

      case "categories":
        return (
          <>
            <DNSCategorySectionHeader {...fieldsProps} />
            {form.fortiguard_category_filter && (
              <DNSFortiGuardFilter form={form} set={set} meta={meta}
                currentColor={currentColor} loadingMeta={loadingMeta} />
            )}
          </>
        );

      case "domains":
        // The licence-free way to block named domains — the Static Domain Filter table. On this
        // device the FortiGuard category grid above rates nothing, so this is the step that
        // actually blocks anything.
        return (
          <>
            <div className={avSectionHdr}>Static Domain Filter</div>
            <DNSStaticDomainFilter form={form} set={set} meta={meta} currentColor={currentColor} />
          </>
        );

      case "options":
        return (
          <>
            <div className={avSectionHdr}>Options</div>
            <DNSFieldsOptions {...fieldsProps} />
          </>
        );
    }
  };

  return (
    <WizardShell
      title="AI DNS Filter Wizard"
      icon={<FiWifi size={12} />}
      device={device}
      hostname={hostname}
      currentColor={currentColor}
      stepLabels={STEPS.map((s) => s.label)}
      step={step}
      onStep={onStep}
      isEdit={isEdit}
      checking={checking}
      checkingLabel="Checking device for an existing DNS Filter profile…"
      readOnly={readOnly}
      saving={saving}
      canApply={isAdmin}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply}
      buildImpact={() => objectApplyImpact({
        kind: "dnsfilter", label: "DNS Filter", name: form.name, isEdit,
        facts: [
          `${form.categories.length} FortiGuard categories blocked · ` +
          `${form.domain_filter_entries.length} static domain filter entries`,
        ],
      })}
      onCancel={onCancel}
    >
      {stepBody()}
    </WizardShell>
  );
};

export default DNSFilterWizard;
