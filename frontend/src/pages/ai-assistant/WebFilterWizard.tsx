import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiHardDrive, FiGlobe, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateSecurityProfile, DeviceUpdateSecurityProfile, DeviceGetSecurityProfile,
  DeviceGetWebFilterMetadata,
  type WebFilterProfileForm, type WebFilterMetadata, type WebFilterCategoryAction,
} from "../../api/policyObject";
import { WFFieldsBasic, WFFieldsRating, WFFieldsProxy } from "../security-profiles/webfilter-form";
import { EMPTY_WEBFILTER_METADATA } from "../security-profiles/webfilter-form.logic";
import { WFFortiGuardFilter, WFOverridePanel } from "../security-profiles/webfilter-fortiguard";
import { WFStaticURLFilter } from "../security-profiles/webfilter-staticurl";
import { ToggleRow } from "../security-profiles/antivirus-form";
import { webFilterDraftToForm } from "./parseWebFilterCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const FORTIGUARD_GATE_REASON = "Requires FortiGuard Category Based Filter to be enabled.";

// Four steps, same shape as the Policy and Application Control wizards, covering every section of
// the real Security Profiles > Web Filter page — nothing the page can do is missing here.
const STEPS = [
  { key: "basic",      label: "Basic Setup" },
  { key: "categories", label: "FortiGuard Category Filter" },
  { key: "staticurl",  label: "Static URL Filter" },
  { key: "options",    label: "Rating & Proxy Options" },
] as const;

// A brand-new profile starts with each FortiGuard category set to ITS OWN default action — this is
// what the device's own "New Web Filter Profile" page shows (the "Custom" preset), so a profile
// created through the wizard is identical to one created through the GUI.
const seedDefaultCategories = (m: WebFilterMetadata): WebFilterCategoryAction[] =>
  [...m.local_categories, ...m.categories]
    .filter((c) => (c.default_action ?? "allow") !== "allow")
    .map((c) => ({ category: c.id, action: c.default_action as WebFilterCategoryAction["action"] }));

const WebFilterWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<WebFilterProfileForm>;
  target?: string;
  readOnly?: boolean;
  currentColor: string;
  // wasEdit=true means an EXISTING profile was updated, not created (see AntivirusWizard).
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (profileName: string, wasEdit: boolean, before?: WebFilterProfileForm) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<WebFilterProfileForm>(() => webFilterDraftToForm(draft));
  const [meta, setMeta] = useState<WebFilterMetadata>(EMPTY_WEBFILTER_METADATA);
  const [loadingMeta, setLoadingMeta] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<WebFilterProfileForm | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // If a profile with the AI-proposed name already exists, switch to edit mode: prefill from the
  // live profile, then overlay the AI's changes → Apply becomes an update instead of a create.
  // Otherwise seed the category tree from the device's defaults, exactly as the GUI does, and let
  // the AI's own categories (when it proposed any) win over them.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    setLoadingMeta(true);
    const lookup = target || draft.name;

    const metaPromise = DeviceGetWebFilterMetadata(device.id, lookup || undefined)
      .then((m) => { if (!cancelled) setMeta(m); return m; })
      .finally(() => { if (!cancelled) setLoadingMeta(false); });

    (async () => {
      const m = await metaPromise;
      let existing: WebFilterProfileForm | null = null;
      if (lookup) {
        try { existing = await DeviceGetSecurityProfile(device.id, "webfilter", lookup); } catch { /* create */ }
      }
      if (cancelled) return;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
      setBefore(existing);
        setForm({ ...existing, ...draft } as WebFilterProfileForm);
      } else {
        const seeded = webFilterDraftToForm(draft);
        if (seeded.categories.length === 0) seeded.categories = seedDefaultCategories(m);
        setForm(seeded);
      }
    })().finally(() => { if (!cancelled) setChecking(false); });

    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const set = <K extends keyof WebFilterProfileForm>(k: K, v: WebFilterProfileForm[K]) => setForm((p) => ({ ...p, [k]: v }));

  const fieldsProps = { form, set, currentColor, errors, isEdit };
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
      if (isEdit) await DeviceUpdateSecurityProfile(device.id, "webfilter", originalName || form.name, form);
      else        await DeviceCreateSecurityProfile(device.id, "webfilter", form);
      message.success(`${isEdit ? "Update" : "Create"} Web Filter "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} Web Filter profile`));
    } finally {
      setSaving(false);
    }
  };

  const stepBody = () => {
    switch (STEPS[step].key) {
      case "basic":
        return <WFFieldsBasic {...fieldsProps} />;

      case "categories":
        return (
          <>
            <div className="border-b hairline-2 surface-sunken px-6 py-3">
              <div className="grid items-center gap-x-3 gap-y-3" style={toggleGridStyle}>
                <ToggleRow label="FortiGuard Category Based Filter"
                  checked={form.fortiguard_category_filter}
                  onChange={(v) => set("fortiguard_category_filter", v)} color={currentColor} />
              </div>
            </div>
            {form.fortiguard_category_filter && (
              <WFFortiGuardFilter form={form} set={set} meta={meta} currentColor={currentColor} loadingMeta={loadingMeta} />
            )}

            <div className="border-y hairline-2 surface-sunken px-6 py-3">
              <div className="grid items-center gap-x-3 gap-y-3" style={toggleGridStyle}>
                <ToggleRow label="Allow users to override blocked categories"
                  checked={form.allow_override} onChange={(v) => set("allow_override", v)} color={currentColor}
                  disabled={!form.fortiguard_category_filter} info={FORTIGUARD_GATE_REASON} />
              </div>
            </div>
            {form.allow_override && form.fortiguard_category_filter && (
              <WFOverridePanel form={form} set={set} meta={meta} currentColor={currentColor} />
            )}
          </>
        );

      case "staticurl":
        // The license-free way to block named sites (YouTube/Facebook) — the URL Filter and Content
        // Filter tables, plus the two blocking toggles that sit with them on the real page.
        return <WFStaticURLFilter form={form} set={set} currentColor={currentColor} />;

      case "options":
        return (
          <>
            <WFFieldsRating {...fieldsProps} />
            <WFFieldsProxy {...fieldsProps} />
          </>
        );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiGlobe size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Web Filter Wizard
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
            Checking device for an existing profile…
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
                kind: "webfilter", label: "Web Filter", name: form.name, isEdit,
                facts: [
                  `${form.categories.length} FortiGuard categories · ${form.url_filter_entries.length} static URL filter entries`,
                ],
                // The lab device has no FortiGuard licence: category rows are accepted by the CMDB
                // and then simply never match, so a profile that blocks by category alone blocks
                // nothing at all. Static URL Filter is the part that actually works.
                warnings: !meta.web_filter_licensed && form.categories.length ? [
                  "This device has no FortiGuard Web Filter licence, so category blocking does nothing in practice. " +
                  "To block a specific site, add it to the static URL filter instead.",
                ] : [],
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

export default WebFilterWizard;
