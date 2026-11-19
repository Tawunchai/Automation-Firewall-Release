import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiServer, FiChevronLeft, FiSave, FiHardDrive, FiBookOpen, FiExternalLink, FiAlertTriangle,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo, DeviceListSystemInterfaces } from "../../api/policyObject";
import { DeviceCreateDHCPServer } from "../../api/dhcp";
import { apiErrorText } from "../../api/errorText";
import { BLANK_DRAFT, buildPayload, validateDraft, type DHCPDraft } from "./model";
import { DHCPFields } from "./dhcp-form";

export const DhcpInfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string }> = ({
  device, hostname, currentColor,
}) => (
  <div className="space-y-3">
    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
      </div>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
          style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
          <FiHardDrive size={12} />
        </div>
        <div>
          <p className="text-[13px] font-semibold ink">{hostname || device?.name || "—"}</p>
          {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
        </div>
      </div>
    </div>
    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
      </div>
      <div className="px-4 py-2">
        <a href="https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/954635/dhcp-server"
          target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
          <FiBookOpen size={13} /> DHCP Server <FiExternalLink size={10} className="ml-auto opacity-60" />
        </a>
      </div>
    </div>
  </div>
);

const DHCPServerCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [loadingDev, setLoadingDev] = useState(true);

  const [draft, setDraft] = useState<DHCPDraft>({ ...BLANK_DRAFT });
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof DHCPDraft>(k: K, v: DHCPDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const id = searchParams.get("deviceId");
    if (!id) { setLoadingDev(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(id)) ?? null;
      setDevice(found);
      if (found) {
        const info = await DeviceGetInfo(found.id);
        setHostname(info.hostname || found.name);
        const ifaces = await DeviceListSystemInterfaces(found.id).catch(() => []);
        setInterfaces(ifaces.map((i) => i.name));
      }
    }).finally(() => setLoadingDev(false));
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) { setFormError("No device selected"); return; }
    const problem = validateDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceCreateDHCPServer(device.id, buildPayload(draft));
      // The {} {} {} shape matches the edit page's message — translated once for both as
      // "DHCP server on {} {} on {}".
      const verb = "created";
      message.success(`DHCP server on ${draft.interface} ${verb} on ${hostname || device.name}`);
      navigate(`/admin/dhcp-servers?deviceId=${device.id}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "the device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiServer />} title="New DHCP Server" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">No device — go back and select a device</div>
      )}

      {formError && (
        <div className="banner banner-danger">
          <FiAlertTriangle size={14} className="shrink-0" /><span>{formError}</span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="rounded-[4px] border hairline surface-card shadow-sm">
            <DHCPFields draft={draft} set={set} interfaces={interfaces} isEditing={false} currentColor={currentColor} />
          </div>
          <DhcpInfoPanel device={device} hostname={hostname} currentColor={currentColor} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default DHCPServerCreatePage;
