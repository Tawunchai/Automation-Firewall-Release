import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiCheck, FiChevronLeft, FiChevronRight, FiHardDrive, FiMapPin, FiX } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceListAddresses, DeviceCreateAddress, DeviceUpdateAddress,
} from "../../api/policyObject";
import { AddressFieldsMain, AddressFieldsOptions, type AddressFieldsProps } from "../fw-addresses/address-form";
import { useAddressFormOptions, buildAddressPayload, validateAddressForm, addressObjectToForm, type AddressFormState } from "../fw-addresses/address-form.logic";
import { addressDraftToForm } from "./parseAddressCLI";
import WizardApplyButton from "./WizardApplyButton";
import { objectApplyImpact } from "./wizardImpact";
import { canonicalNetwork } from "./dryRun";
import { apiErrorDetail } from "../../api/errorText";

// The one value that identifies an address, whichever type it is — what the confirmation shows so
// the user is agreeing to a network, not just to a name.
//
// The subnet is normalised to CIDR: the form carries FortiOS's own "10.77.77.0 255.255.255.0", and
// showing that in a one-line summary reads as two addresses. canonicalNetwork is the same converter
// the Dry-run diff uses, so both dialogs spell a network the same way.
const addressValue = (f: AddressFormState): string => {
  switch (f.type) {
    case "iprange":   return f.ipRange;
    case "fqdn":      return f.fqdn;
    case "geography": return f.country;
    case "mac":       return f.macAddrs.filter(Boolean).join(", ");
    default:          return String(canonicalNetwork(f.subnet));
  }
};

type StepDef = { key: string; label: string; Component: React.FC<AddressFieldsProps> };

const STEPS: StepDef[] = [
  { key: "details", label: "Address Details",   Component: AddressFieldsMain },
  { key: "options", label: "Additional Options", Component: AddressFieldsOptions },
];

const AddressWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<AddressFormState>;
  target?: string;   // current address name on the device (edit); empty/undefined = create
  readOnly?: boolean; // true = already applied → review only (no edits, no Apply)
  currentColor: string;
  onApplied: (name: string, wasEdit: boolean) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const { interfaces, loadingIf, sdnConnectors } = useAddressFormOptions(device.id);

  const [form, setForm]       = useState<AddressFormState>(() => addressDraftToForm(draft));
  const [isEdit, setIsEdit]   = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [checking, setChecking] = useState(true);
  const [step, setStep]       = useState(0);
  const [errors, setErrors]   = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);

  const set = <K extends keyof AddressFormState>(k: K, v: AddressFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // Detect whether an address with the AI-proposed name already exists on the device. If it
  // does, switch to edit mode: prefill from the live object, then overlay the AI's changes so
  // fields the AI didn't mention keep their current device values → Apply becomes an update.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    // Match on the address's current name (target); fall back to the draft name for a plain create.
    const lookup = target || draft.name;
    DeviceListAddresses(device.id).then((addrs) => {
      if (cancelled) return;
      const existing = lookup ? addrs.find((a) => a.name === lookup) : undefined;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
        // Base = live object mapped to form; overlay only the AI-specified keys from the draft
        // (which includes the NEW name on a rename).
        setForm(addressDraftToForm(draft, addressObjectToForm(existing)));
      }
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  const isLastStep = step === STEPS.length - 1;
  const StepComponent = STEPS[step].Component;
  const fieldsProps: AddressFieldsProps = {
    form, set, errors, interfaces, loadingIf, sdnConnectors, currentColor, isEdit,
  };

  const goNext = () => {
    if (step === 0) {
      const errs = validateAddressForm(form);
      // Only block on the Details-step fields; interface/comment live on step 2.
      const detailErrs = Object.fromEntries(Object.entries(errs).filter(([k]) => k !== "device"));
      if (Object.keys(detailErrs).length) { setErrors(detailErrs); return; }
      setErrors({});
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const handleApply = async () => {
    const errs = validateAddressForm(form);
    if (Object.keys(errs).length) { setErrors(errs); setStep(0); message.error("Please fix the highlighted fields"); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildAddressPayload(form);
      if (isEdit) await DeviceUpdateAddress(device.id, originalName, payload);
      else        await DeviceCreateAddress(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} Address "${form.name}" Success`);
      onApplied(form.name, isEdit);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} address`));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiMapPin size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Address Wizard
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
              Checking device for an existing address…
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
                kind: "address", label: "Address", name: form.name, isEdit,
                facts: [`${form.type}: ${addressValue(form) || "—"}`],
                // An interface-bound address only works in a policy whose srcintf/dstintf matches;
                // FortiGate rejects the whole policy otherwise (error -3), which reads as a policy
                // problem long after this dialog is gone.
                warnings: form.iface && form.iface !== "any" ? [
                  `This address is bound to interface "${form.iface}" — it only works in a policy whose source or destination interface is the same one`,
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

export default AddressWizard;
