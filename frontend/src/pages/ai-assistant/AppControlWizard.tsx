import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiCpu, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateSecurityProfile, DeviceUpdateSecurityProfile, DeviceGetSecurityProfile,
  DeviceGetAppControlMetadata, EMPTY_APPCONTROL_METADATA,
  type AppControlProfileForm, type AppControlMetadata,
} from "../../api/policyObject";
import { EMPTY_APPCONTROL_FORM } from "../security-profiles/appcontrol-form.logic";
import { ACCategoriesGrid, ACNetworkServices, ACOverrides } from "../security-profiles/appcontrol-sections";
import { ToggleRow, avSectionHdr } from "../security-profiles/antivirus-form";
import { appControlDraftToForm, applyParsedAppControl, type ParsedAppControl } from "./parseAppControlCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const inputCls = "h-8 w-full rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none  dark:bg-yellow-900/10 ";

// Same four-step shape as the Policy Wizard, mirroring the sections of the real Application Sensor
// page. Network Protocol Enforcement rides along in Options (it is a toggle + its table), so no
// capability from the full page is lost.
const STEPS = [
  { key: "basic",      label: "Basic Setup" },
  { key: "categories", label: "Categories" },
  { key: "overrides",  label: "Application and Filter Overrides" },
  { key: "options",    label: "Options" },
] as const;

const AppControlWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  parsed: ParsedAppControl | null;
  target?: string;
  readOnly?: boolean;
  currentColor: string;
  // wasEdit=true means an EXISTING profile was updated, not created (see AntivirusWizard).
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (profileName: string, wasEdit: boolean, before?: AppControlProfileForm) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, parsed, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [meta, setMeta] = useState<AppControlMetadata>(EMPTY_APPCONTROL_METADATA);
  const [form, setForm] = useState<AppControlProfileForm>(EMPTY_APPCONTROL_FORM);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<AppControlProfileForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof AppControlProfileForm>(k: K, v: AppControlProfileForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Load the category taxonomy + signature database, then seed the form: if the profile already
  // exists, prefill from the device and overlay the AI's proposal; otherwise seed the default grid.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    DeviceGetAppControlMetadata(device.id).then(async (m) => {
      if (cancelled) return;
      setMeta(m);
      const lookup = target || parsed?.name;
      let existing: AppControlProfileForm | null = null;
      if (lookup) {
        try { existing = await DeviceGetSecurityProfile(device.id, "application-control", lookup); } catch { /* create */ }
      }
      if (cancelled) return;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
      setBefore(existing);
        setForm(applyParsedAppControl({ ...existing }, parsed, m.applications));
      } else {
        setForm(appControlDraftToForm(parsed, EMPTY_APPCONTROL_FORM, m.categories, m.applications));
      }
    }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, parsed, target]);

  const isLastStep = step === STEPS.length - 1;

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
    if (!validate()) { setStep(0); message.error("Name is required"); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    try {
      setSaving(true);
      if (isEdit) await DeviceUpdateSecurityProfile(device.id, "application-control", originalName || form.name, form);
      else        await DeviceCreateSecurityProfile(device.id, "application-control", form);
      message.success(`${isEdit ? "Update" : "Create"} Application Control "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} Application Control list`));
    } finally {
      setSaving(false);
    }
  };

  const stepBody = () => {
    switch (STEPS[step].key) {
      case "basic":
        return (
          <div className="space-y-3 px-6 py-4">
            <div>
              <label htmlFor="name" className="mb-1 block text-[12px] font-medium ink-2">Name <span className="text-red-500">*</span></label>
              <input id="name" value={form.name} disabled={isEdit} onChange={(e) => set("name", e.target.value)}
                placeholder="e.g. AppCtrl-Standard"
                className={`${inputCls} ${isEdit ? "cursor-not-allowed surface-sunken" : ""}`} />
              {errors.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="comments" className="mb-1 block text-[12px] font-medium ink-2">Comments</label>
              <textarea id="comments" value={form.comment} rows={2} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
                placeholder="Write a comment…"
                className="w-full rounded border hairline surface-card px-2.5 py-1.5 text-[13px] ink outline-none resize-none" />
            </div>
          </div>
        );

      case "categories":
        return <ACCategoriesGrid form={form} set={set} meta={meta} />;

      case "overrides":
        return (
          <>
            <div className={avSectionHdr}>Application and Filter Overrides</div>
            <ACOverrides form={form} set={set} meta={meta} currentColor={currentColor} />
          </>
        );

      case "options":
        return (
          <>
            <div className={avSectionHdr}>Network Protocol Enforcement</div>
            <div className="border-b hairline-2 px-6 py-3">
              <div className="grid items-center gap-x-3 gap-y-3" style={toggleGridStyle}>
                <ToggleRow label="Enable Network Protocol Enforcement"
                  checked={form.network_protocol_enforcement}
                  onChange={(v) => set("network_protocol_enforcement", v)} color={currentColor} />
              </div>
            </div>
            {form.network_protocol_enforcement && (
              <ACNetworkServices form={form} set={set} currentColor={currentColor} />
            )}

            <div className={avSectionHdr}>Options</div>
            <div className="grid items-center gap-x-3 gap-y-3 px-6 py-4" style={toggleGridStyle}>
              <ToggleRow label="Block applications detected on non-default ports"
                checked={form.block_non_default_ports} onChange={(v) => set("block_non_default_ports", v)} color={currentColor} />
              <ToggleRow label="Allow and Log DNS Traffic"
                checked={form.allow_and_log_dns} onChange={(v) => set("allow_and_log_dns", v)} color={currentColor} />
              <ToggleRow label="Replacement Messages for HTTP-based Applications"
                checked={form.replacement_messages} onChange={(v) => set("replacement_messages", v)} color={currentColor} />
            </div>
          </>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiCpu size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Application Control Wizard
            {!checking && (
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={{ background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {isEdit ? "EDIT EXISTING" : "CREATE NEW"}
              </span>
            )}
          </p>
          <p className="truncate text-[10px] ink-3">{hostname || device.name}</p>
        </div>
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 overflow-x-auto border-b hairline-2 px-4 py-2.5 shrink-0">
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
        {checking ? (
          <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
            <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
            Loading application categories…
          </div>
        ) : (
          <div style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}>{stepBody()}</div>
        )}
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
                kind: "application-control", label: "Application Control", name: form.name, isEdit,
                facts: [
                  `${form.categories.filter((c) => c.action === "block").length} categories blocked · ` +
                  `${form.overrides.length} per-application override(s)`,
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

export default AppControlWizard;
