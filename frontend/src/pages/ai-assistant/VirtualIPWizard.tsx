import React, { useEffect, useState } from "react";
import { message } from "../../components/ui/toast";
import { FiGlobe } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateVirtualIP, DeviceUpdateVirtualIP, DeviceGetVirtualIP,
  DeviceListInterfaces, DeviceListServices, DeviceListAddresses,
  type VirtualIP,
} from "../../api/policyObject";
import { VIPFormFields } from "../virtual-ips/vip-form";
import {
  validateVIP, buildVIPPayload, initialFilterState, type FilterState,
} from "../virtual-ips/vip-form-rules";
import { vipDraftToForm } from "./parseVirtualIPCLI";
import WizardShell from "./WizardShell";
import { objectApplyImpact } from "./wizardImpact";
import { apiErrorDetail } from "../../api/errorText";

// The AI Virtual IP wizard — one step (the VIP page has no natural step boundaries), reusing the
// exact form fields the standalone page uses so a VIP built from the chat is identical to a
// hand-built one. Same shape as the DNS Filter / Web Filter wizards otherwise.
const VirtualIPWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<VirtualIP>;
  target?: string;
  readOnly?: boolean;
  currentColor: string;
  // wasEdit=true means an EXISTING VIP was updated — Fallback can't undo an edit by deleting the
  // object, so it is never recorded as ours (see undoApply.ts).
  // The object as it stood on the device BEFORE this wizard changed it, handed over on an EDIT so
  // Fallback can write it back. It is the payload the existence check already fetched, so it costs
  // no extra round-trip and is by construction what the Update endpoint accepts.
  onApplied: (name: string, wasEdit: boolean, before?: VirtualIP) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, readOnly = false, currentColor, onApplied, onCancel }) => {
  const [form, setForm] = useState<VirtualIP>(() => vipDraftToForm(draft));
  const [filters, setFilters] = useState<FilterState>(() => initialFilterState(vipDraftToForm(draft)));
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [services, setServices] = useState<string[]>([]);
  const [fqdnAddrs, setFqdnAddrs] = useState<string[]>([]);
  const [isEdit, setIsEdit] = useState(false);
  const [originalName, setOriginalName] = useState("");
  const [before, setBefore] = useState<VirtualIP | null>(null);
  const [checking, setChecking] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof VirtualIP>(k: K, v: VirtualIP[K]) => setForm((f) => ({ ...f, [k]: v }));

  // If a VIP with the AI-proposed name already exists, switch to edit: prefill from the device,
  // overlay the AI's changes → Apply becomes an update (a duplicate name is -5 on the device).
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    const lookup = target || draft.name;
    (async () => {
      DeviceListInterfaces(device.id).then((ifs) => !cancelled && setInterfaces(["any", ...ifs.map((i) => i.name)]));
      DeviceListServices(device.id).then((svcs) => !cancelled && setServices(svcs.map((s) => s.name)));
      DeviceListAddresses(device.id).then((addrs) => !cancelled &&
        setFqdnAddrs(addrs.filter((a) => a.type === "fqdn" || a.type === "wildcard-fqdn").map((a) => a.name)));

      let existing: VirtualIP | null = null;
      if (lookup) {
        try { existing = await DeviceGetVirtualIP(device.id, lookup); } catch { /* create */ }
      }
      if (cancelled) return;
      if (existing) {
        setIsEdit(true);
        setOriginalName(existing.name);
      setBefore(existing);
        const merged = { ...existing, ...draft } as VirtualIP;
        setForm(merged);
        setFilters(initialFilterState(merged));
      }
    })().finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  // Optional Filters enable-switches — tracked apart from the data (see FilterState).
  const patchFilters = (p: Partial<FilterState>) => setFilters((s) => ({ ...s, ...p }));
  const toggleSource = (on: boolean) => {
    patchFilters({ source: on });
    if (!on) set("source_filter", []);
    else if (form.source_filter.length === 0) set("source_filter", [""]);
  };
  const toggleServices = (on: boolean) => {
    patchFilters({ services: on });
    if (!on) set("services", []);
  };
  const toggleOptional = (on: boolean) => {
    if (on) { patchFilters({ optional: true }); return; }
    setFilters({ optional: false, source: false, services: false });
    setForm((f) => ({ ...f, source_filter: [], services: [] }));
  };

  const handleApply = async () => {
    const errs = validateVIP(form);
    if (Object.keys(errs).length) { setErrors(errs); message.error(Object.values(errs)[0]); return; }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildVIPPayload(form);
      if (isEdit) await DeviceUpdateVirtualIP(device.id, originalName || form.name, payload);
      else        await DeviceCreateVirtualIP(device.id, payload);
      message.success(`${isEdit ? "Update" : "Create"} Virtual IP "${form.name}" Success`);
      onApplied(form.name, isEdit, before ?? undefined);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} virtual IP`), 8);
    } finally { setSaving(false); }
  };

  return (
    <WizardShell
      title="AI Virtual IP Wizard"
      icon={<FiGlobe size={12} />}
      device={device}
      hostname={hostname}
      currentColor={currentColor}
      stepLabels={["Virtual IP"]}
      step={0}
      onStep={() => {}}
      isEdit={isEdit}
      checking={checking}
      checkingLabel="Checking device for an existing virtual IP…"
      readOnly={readOnly}
      saving={saving}
      canApply={isAdmin}
      applyDisabledReason={!isAdmin ? "Only admins can apply config changes" : undefined}
      onApply={handleApply}
      buildImpact={() => objectApplyImpact({
        kind: "virtual-ip", label: "Virtual IP", name: form.name, isEdit,
        facts: [
          form.port_forward
            ? `DNAT ${form.ext_ip}:${form.ext_port} → ${form.mapped_ip}:${form.mapped_port} (${form.protocol})`
            : `DNAT ${form.ext_ip || form.ext_addr} → ${form.mapped_ip || form.mapped_addr}`,
          `Accepted on interface: ${form.interface || "any"}`,
        ],
      })}
      onCancel={onCancel}
    >
      <div className="px-4 py-4">
        <VIPFormFields
          form={form} set={set} filters={filters}
          onToggleOptional={toggleOptional} onToggleSource={toggleSource} onToggleServices={toggleServices}
          interfaces={interfaces} services={services} fqdnAddrs={fqdnAddrs}
          errors={errors} currentColor={currentColor} isEdit={isEdit}
        />
      </div>
    </WizardShell>
  );
};

export default VirtualIPWizard;
