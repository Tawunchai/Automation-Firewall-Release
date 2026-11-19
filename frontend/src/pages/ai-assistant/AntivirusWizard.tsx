import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiHardDrive, FiShield, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateSecurityProfile, DeviceUpdateSecurityProfile,
  DeviceGetSecurityProfile, DeviceGetAVCapabilities,
  type AVProfileForm, type AVCapabilities,
} from "../../api/policyObject";
import { AVFieldsBasic, AVFieldsProtocols, AVFieldsAPT, AVFieldsOutbreak, type AVFieldsProps } from "../security-profiles/antivirus-form";
import { DEFAULT_AV_CAPS, seedAntivirusScanOn } from "../security-profiles/antivirus-form.logic";
import { avDraftToForm } from "./parseAntivirusCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

type StepDef = { key: string; label: string; Component: React.FC<AVFieldsProps> };

const STEPS: StepDef[] = [
  { key: "basic",    label: "Basic Setup",              Component: AVFieldsBasic },
  { key: "protocols", label: "Inspected Protocols",     Component: AVFieldsProtocols },
  { key: "apt",      label: "APT Protection Options",    Component: AVFieldsAPT },
  { key: "outbreak", label: "Virus Outbreak Prevention", Component: AVFieldsOutbreak },
];

const AntivirusWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<AVProfileForm>;
  target?: string;   // current profile name on the device (edit); empty/undefined = create
  readOnly?: boolean; // true = already applied → review only
  currentColor: string;
  // wasEdit=true means an EXISTING profile was updated, not created. The chat records only
  // creations for Fallback — an update can't be undone by deleting the profile.
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (profileName: string, wasEdit: boolean, before?: AVProfileForm) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<AVProfileForm>(() => avDraftToForm(draft));
  const [antivirusScanOn, setAntivirusScanOn] = useState<boolean>(() => seedAntivirusScanOn(avDraftToForm(draft)));
  const [caps, setCaps] = useState<AVCapabilities>(DEFAULT_AV_CAPS);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<AVProfileForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Fetch real device capabilities so the wizard greys FortiSandbox / outbreak-DB toggles for
  // the same reasons the real FortiGate GUI does.
  useEffect(() => { DeviceGetAVCapabilities(device.id).then(setCaps); }, [device.id]);

  // If a profile with the AI-proposed name already exists, switch to edit mode: prefill from the
  // live profile, then overlay the AI's changes → Apply becomes an update instead of a create.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    // Match on the profile's current name (target); fall back to the draft name for a plain create.
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    DeviceGetSecurityProfile(device.id, "antivirus", lookup).then((existing) => {
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      // Overlay only the AI-specified keys so fields it didn't mention keep the device's values
      // (draft.name carries the NEW name on a rename).
      const merged: AVProfileForm = { ...existing, ...draft };
      setForm(merged);
      setAntivirusScanOn(seedAntivirusScanOn(merged));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof AVProfileForm>(k: K, v: AVProfileForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  const isLastStep = step === STEPS.length - 1;
  const StepComponent = STEPS[step].Component;

  const fieldsProps: AVFieldsProps = {
    form, set, antivirusScanOn, setAntivirusScanOn, caps, currentColor, errors, isEdit,
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const goNext = () => {
    if (step === 0 && !validate()) return;
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleApply = async () => {
    if (!validate()) { setStep(0); message.error("Please fix the highlighted fields in Basic Setup"); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    try {
      setSaving(true);
      // Update targets the profile by its ORIGINAL name (the mkey); a changed form.name renames it.
      if (isEdit) await DeviceUpdateSecurityProfile(device.id, "antivirus", originalName || form.name, form);
      else        await DeviceCreateSecurityProfile(device.id, "antivirus", form);
      message.success(`${isEdit ? "Update" : "Create"} AntiVirus "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} AntiVirus profile`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiShield size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI AntiVirus Wizard
            {!checking && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {isEdit ? "EDIT EXISTING" : "CREATE NEW"}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname || device.name}
          </p>
        </div>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b hairline-2 shrink-0 overflow-x-auto">
        {STEPS.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <div className="h-px w-3 shrink-0" style={{ background: i <= step ? currentColor : "#e2e8f0" }} />}
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default"
              style={{
                background: i === step ? currentColor : i < step ? `${currentColor}15` : "transparent",
                color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
              }}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: i === step ? "rgba(255,255,255,.25)" : i < step ? `${currentColor}22` : "#e2e8f0",
                  color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
                }}>
                {i + 1}
              </span>
              {i === step && <span className="pr-0.5">{s.label}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
            <FiCheck size={12} /> Already applied — review only (read-only)
          </div>
        )}
        {checking
          ? <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
              Checking device for an existing profile…
            </div>
          : <div style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}><StepComponent {...fieldsProps} /></div>}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 border-t hairline-2 px-4 py-3 shrink-0">
        <button type="button" onClick={() => step === 0 ? onCancel() : setStep((s) => s - 1)}
          className="flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
          <FiChevronLeft size={13} /> {step === 0 ? (readOnly ? "Close" : "Cancel") : "Back"}
        </button>

        <span className="text-[10px] ink-3">Step {step + 1} of {STEPS.length}</span>

        {isLastStep ? (
          readOnly ? (
            <button type="button" disabled
              className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white cursor-default"
              style={{ background: "#16a34a" }}>
              <FiCheck size={13} /> Applied
            </button>
          ) : (
            <WizardApplyButton
              isEdit={isEdit} saving={saving} disabled={!isAdmin || checking}
              title={!isAdmin ? "Only admins can apply config changes" : ""}
              deviceName={hostname || device.name}
              onApply={handleApply}
              buildImpact={() => objectApplyImpact({
                kind: "antivirus", label: "AntiVirus", name: form.name, isEdit,
                facts: [
                  `Protocols scanned: ${[
                    form.http_scan && "HTTP", form.smtp_scan && "SMTP", form.pop3_scan && "POP3",
                    form.imap_scan && "IMAP", form.ftp_scan && "FTP", form.cifs_scan && "CIFS",
                  ].filter(Boolean).join(", ") || "none"}`,
                ],
                warnings: antivirusScanOn ? [] : [
                  "AntiVirus scanning is off — this profile scans no malware for the policies that reference it",
                ],
              })}
            />
          )
        ) : (
          <button type="button" onClick={goNext} disabled={checking}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            Next <FiChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

export default AntivirusWizard;
