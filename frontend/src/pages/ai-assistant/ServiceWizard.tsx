import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiHardDrive, FiZap, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import { DeviceListServices, DeviceCreateService, DeviceUpdateService } from "../../api/policyObject";
import { ServiceFieldsBasic, ServiceFieldsProtocol, type ServiceFieldsProps } from "../fw-services/service-form";
import { buildServicePayload, validateServiceForm, serviceObjectToForm, type ServiceFormState } from "../fw-services/service-form.logic";
import { serviceDraftToForm } from "./parseServiceCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

type StepDef = { key: string; label: string; Component: React.FC<ServiceFieldsProps> };

const STEPS: StepDef[] = [
  { key: "basic",    label: "Basic Setup",      Component: ServiceFieldsBasic },
  { key: "protocol", label: "Protocol Options", Component: ServiceFieldsProtocol },
];

const ServiceWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<ServiceFormState>;
  target?: string;   // current service name on the device (edit); empty/undefined = create
  readOnly?: boolean; // true = already applied → review only
  currentColor: string;
  onApplied: (name: string, wasEdit: boolean) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm]       = useState<ServiceFormState>(() => serviceDraftToForm(draft));
  const [isEdit, setIsEdit]   = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [checking, setChecking] = useState(true);
  const [step, setStep]       = useState(0);
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);

  const set = <K extends keyof ServiceFormState>(k: K, v: ServiceFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Detect whether a service with the AI-proposed name already exists. If so, switch to edit mode:
  // prefill from the live object, overlay the AI's changes (draft.name carries the NEW name on a
  // rename), and Apply becomes an update.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    DeviceListServices(device.id).then((svcs) => {
      if (cancelled) return;
      const existing = lookup ? svcs.find((s) => s.name === lookup) : undefined;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
        setForm(serviceDraftToForm(draft, serviceObjectToForm(existing)));
      }
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const isLastStep = step === STEPS.length - 1;
  const StepComponent = STEPS[step].Component;
  const fieldsProps: ServiceFieldsProps = { form, set, errors, currentColor, isEdit };

  const goNext = () => {
    if (step === 0) {
      if (!form.name.trim()) { setErrors({ name: "Name is required" }); return; }
      setErrors({});
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleApply = async () => {
    const errs = validateServiceForm(form);
    if (Object.keys(errs).length) { setErrors(errs); setStep(errs.name ? 0 : 1); message.error("Please fix the highlighted fields"); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildServicePayload(form);
      // Update targets the service by its ORIGINAL name (mkey); a changed form.name renames it.
      if (isEdit) await DeviceUpdateService(device.id, originalName || form.name, payload);
      else        await DeviceCreateService(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} Service "${form.name}" Success`);
      onApplied(form.name, isEdit);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} service`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiZap size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Service Wizard
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
              Checking device for an existing service…
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
                kind: "service", label: "Service", name: form.name, isEdit,
                facts: [
                  form.protocol === "TCP/UDP/SCTP"
                    ? `Ports: ${form.destPorts.map((p) => `${p.protocol}/${p.low}${p.high ? `-${p.high}` : ""}`).join(", ") || "—"}`
                    : form.protocol === "IP" ? `IP protocol ${form.ipProto}`
                    : `${form.protocol} type ${form.icmpType < 0 ? "any" : form.icmpType}`,
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

export default ServiceWizard;
