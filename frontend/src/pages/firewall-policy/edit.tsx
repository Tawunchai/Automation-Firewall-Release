import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiShield, FiChevronLeft, FiSave } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import ImpactPreviewButton from "./ImpactPreview";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetInfo, DeviceListPolicies, DeviceUpdatePolicy,
  type FirewallPolicy,
} from "../../api/policyObject";
import { PolicyFormFields, InfoPanel } from "./create";
import { usePolicyFormOptions, BLANK_POLICY_FORM, buildPolicyPayload, validatePolicyForm, type PolicyFormState } from "./create.logic";
import { CliModal } from "./policy-cli";
import { apiErrorDetail } from "../../api/errorText";

const FirewallPolicyEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceId = searchParams.get("deviceId");
  const policyId = searchParams.get("policyId");

  const [device, setDevice]         = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]     = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [policy, setPolicy]         = useState<FirewallPolicy | null>(null);
  const [showCLI, setShowCLI]       = useState(false);
  const { interfaces, addresses, services, profiles, loadingProfiles } = usePolicyFormOptions(device?.id);

  const [form, setForm]     = useState<PolicyFormState>(BLANK_POLICY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof PolicyFormState>(k: K, v: PolicyFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId) { setLoadingDev(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(deviceId)) ?? null;
      setDevice(found);
      if (found) {
        const info = await DeviceGetInfo(found.id);
        setHostname(info.hostname || found.name);

        if (policyId) {
          const list = await DeviceListPolicies(found.id);
          const p = list.find((x) => x.id === Number(policyId)) ?? null;
          setPolicy(p);
          if (p) {
            setForm({
              name: p.name,
              srcIntf: p.src_intf_list?.[0] || p.src_intf || "",
              dstIntf: p.dst_intf_list?.[0] || p.dst_intf || "",
              srcAddr: p.src_addr_list || [],
              dstAddr: p.dst_addr_list || [],
              schedule: p.schedule || "always",
              service: p.service_list || [],
              action: p.action,
              nat: p.nat,
              ipPoolMode: p.ippool ? "dynamic" : "outgoing",
              poolName: p.poolname || [],
              manageSourcePort: p.fixedport,
              fixedPort: p.fixedport,
              preserveSourcePort: p.fixedport,
              protocolOptions: p.protocol_options || "default",
              avEnabled: !!p.av_profile, avProfile: p.av_profile || "",
              webEnabled: !!p.webfilter_profile, webProfile: p.webfilter_profile || "",
              dnsEnabled: !!p.dnsfilter_profile, dnsProfile: p.dnsfilter_profile || "",
              appEnabled: !!p.app_control, appProfile: p.app_control || "",
              ipsEnabled: !!p.ips_sensor, ipsProfile: p.ips_sensor || "",
              fileEnabled: !!p.file_filter_profile, fileProfile: p.file_filter_profile || "",
              sslSshProfile: p.ssl_ssh_profile || "no-inspection",
              mirrorEnabled: !!p.decrypted_traffic_mirror, mirrorProfile: p.decrypted_traffic_mirror || "",
              logViolation: p.log_traffic === "all" || p.log_traffic === "utm",
              logAllowed: p.log_traffic === "disable" ? "utm" : p.log_traffic,
              comments: p.comments || "",
              enabled: p.enabled,
              policyIndex: "",
            });
          }
        }
      }
    }).finally(() => setLoadingDev(false));
  }, [deviceId, policyId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validatePolicyForm(form, addresses);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    if (!device || !policy) return;

    try {
      setSaving(true);
      await DeviceUpdatePolicy(device.id, policy.id, buildPolicyPayload(form));
      message.success(`Policy "${form.name}" updated on ${hostname || device.name}`);
      navigate(`/admin/firewall-policy?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update policy"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiShield />} title="Edit Policy" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}
      {!loadingDev && device && !policy && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          Policy not found on this device
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="rounded-[4px] border hairline surface-card shadow-sm">
            <PolicyFormFields form={form} set={set} errors={errors}
              interfaces={interfaces} addresses={addresses} services={services}
              profiles={profiles} loadingProfiles={loadingProfiles} currentColor={currentColor} />
          </div>

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} onCLI={() => setShowCLI(true)} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          {device && policy && (
            <ImpactPreviewButton
              deviceId={device.id} op="update" policyId={policy.id}
              policy={buildPolicyPayload(form)} disabled={saving}
            />
          )}
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device || !policy}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>

      {showCLI && device && (
        <CliModal hostname={hostname || device.name} deviceId={device.id} onClose={() => setShowCLI(false)} />
      )}
    </div>
  );
};

export default FirewallPolicyEditPage;
