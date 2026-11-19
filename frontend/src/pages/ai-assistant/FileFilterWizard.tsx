import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiFile } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateSecurityProfile, DeviceUpdateSecurityProfile, DeviceGetSecurityProfile,
  DeviceGetFileFilterMetadata, EMPTY_FILE_FILTER_METADATA,
  type FileFilterProfileForm, type FileFilterMetadata,
} from "../../api/policyObject";
import { ToggleRow, avSectionHdr } from "../security-profiles/antivirus-form";
import { FFRules } from "../security-profiles/file-filter-sections";
import { fileFilterDraftToForm } from "./parseFileFilterCLI";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const labelCls = "block text-[12px] font-medium ink-2 min-w-[160px] shrink-0";
const rowCls = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";

const STEPS = ["Profile", "Rules"];

// The AI File Filter wizard — review/edit the profile the model proposed, then push it to the
// device. Reuses the Security Profiles page's rule table + drawer (FFRules), so the rule
// constraints the device enforces (Monitor=log-only, direction only on http/ftp/ssh/cifs,
// password-protected limited to archive formats) behave identically here.
const FileFilterWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<FileFilterProfileForm>;
  target?: string;    // current profile name on the device (edit); empty = create
  readOnly?: boolean;
  currentColor: string;
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (profileName: string, wasEdit: boolean, before?: FileFilterProfileForm) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<FileFilterProfileForm>(() => fileFilterDraftToForm(draft));
  const [meta, setMeta] = useState<FileFilterMetadata>(EMPTY_FILE_FILTER_METADATA);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<FileFilterProfileForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => { DeviceGetFileFilterMetadata(device.id).then(setMeta); }, [device.id]);

  // If a profile with the proposed name already exists, switch to edit mode: prefill from the live
  // profile and overlay the AI's changes, so Apply updates instead of colliding with -5.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    if (!lookup) { setChecking(false); return; }
    // DeviceGetSecurityProfile is typed for the AntiVirus shape (the first category that got a
    // form); for file-filter it returns FileFilterProfileForm, hence the cast.
    DeviceGetSecurityProfile(device.id, "file-filter", lookup).then((raw) => {
      const existing = raw as unknown as FileFilterProfileForm | null;
      if (cancelled || !existing) return;
      setIsEdit(true);
      setOriginalName(existing.name);
      setBefore(existing);
      setForm(fileFilterDraftToForm({ ...existing, ...draft }));
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof FileFilterProfileForm>(k: K, v: FileFilterProfileForm[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const handleApply = async () => {
    if (!form.name.trim()) { setStep(0); message.error("Name is required"); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    try {
      setSaving(true);
      if (isEdit) await DeviceUpdateSecurityProfile(device.id, "file-filter", originalName || form.name, form);
      else        await DeviceCreateSecurityProfile(device.id, "file-filter", form);
      message.success(`${isEdit ? "Update" : "Create"} File Filter "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} File Filter profile`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <WizardShell
      title="AI File Filter Wizard" icon={<FiFile size={12} />}
      device={device} hostname={hostname} currentColor={currentColor}
      stepLabels={STEPS} step={step} onStep={setStep}
      isEdit={isEdit} checking={checking}
      checkingLabel="Checking device for an existing profile…"
      readOnly={readOnly} saving={saving}
      canApply={isAdmin && form.name.trim().length > 0}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply} onCancel={onCancel}
      buildImpact={() => objectApplyImpact({
        kind: "file-filter", label: "File Filter", name: form.name, isEdit,
        facts: [
          `${form.rules.length} rule(s) · ${form.rules.filter((r) => r.action === "block").length} of them block files`,
        ],
      })}>

      {step === 0 ? (
        <div className="space-y-3 px-5 py-4">
          <div className={rowCls}>
            <label htmlFor="name" className={labelCls}>Name</label>
            <input id="name" value={form.name} onChange={(e) => set("name", e.target.value)}
              className={inputCls} style={{ backgroundColor: form.name ? undefined : "#fffbe6" }} />
          </div>
          <div className="flex items-start gap-3">
            <label htmlFor="comments" className={`${labelCls} pt-1`}>Comments</label>
            <div className="relative flex-1">
              <textarea id="comments" value={form.comment} rows={2} placeholder="Write a comment…"
                onChange={(e) => set("comment", e.target.value.slice(0, 255))}
                className="w-full resize-none rounded border hairline surface-card px-2.5 py-1.5 pr-12 text-[13px] ink outline-none" />
              <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">
                {form.comment.length}/255
              </span>
            </div>
          </div>
          <ToggleRow label="Scan archive contents" checked={form.scan_archive_contents}
            onChange={(v) => set("scan_archive_contents", v)} color={currentColor} />
        </div>
      ) : (
        <div>
          <div className={avSectionHdr}>Rules</div>
          <div className="pt-3">
            <FFRules form={form} set={set} meta={meta} currentColor={currentColor} />
          </div>
          {form.rules.length === 0 && (
            <p className="px-6 pb-4 text-[11px] text-amber-500">
              No rules — a File Filter profile with no rules matches nothing. Add at least one rule.
            </p>
          )}
        </div>
      )}
    </WizardShell>
  );
};

export default FileFilterWizard;
