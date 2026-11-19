import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiHardDrive, FiBookOpen, FiExternalLink } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { DeviceCreateStaticRoute, DeviceGetInfo } from "../../api/policyObject";
import { RouteFields } from "./route-form";
import { useRouteOptions, buildRoutePayload, validateRouteForm, BLANK_ROUTE_FORM, type RouteFormState } from "./route-form.logic";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

export const RouteInfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string }> = ({ device, hostname, currentColor }) => (
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
        <a href="https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/1006004/static-routing" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
          <FiBookOpen size={13} /> Static Routing <FiExternalLink size={10} className="ml-auto opacity-60" />
        </a>
      </div>
    </div>
  </div>
);

const StaticRouteCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const { deviceId } = useDeviceFromQuery();

  const [hostname, setHostname] = useState("");
  const [form, setForm] = useState<RouteFormState>(BLANK_ROUTE_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RouteFormState>(k: K, v: RouteFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { interfaces, services, loadingSvc } = useRouteOptions(deviceId ?? undefined);

  // The hostname the device calls itself, which is what the panel shows. The device row itself
  // comes from the app's inventory, so this is the page's only device call.
  useEffect(() => {
    if (!deviceId) return;
    let live = true;
    DeviceGetInfo(deviceId)
      .then((info) => { if (live) setHostname(info.hostname || ""); })
      .catch(() => { /* the panel falls back to the inventory's name */ });
    return () => { live = false; };
  }, [deviceId]);

  const submit = async (d: NetworkDevice) => {
    const errs = validateRouteForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceCreateStaticRoute(d.id, buildRoutePayload(form));
      message.success(`Static route created on ${hostname || d.name}`);
      navigate(`/admin/static-routes?deviceId=${d.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create route"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeviceFormPage noun="static route" onSubmit={submit} saving={saving} submitLabel="OK" card={false}>
      {(d) => (
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="rounded-[4px] border hairline surface-card shadow-sm">
            <RouteFields form={form} set={set} errors={errors} interfaces={interfaces}
              services={services} loadingSvc={loadingSvc} currentColor={currentColor} />
          </div>
          <RouteInfoPanel device={d} hostname={hostname} currentColor={currentColor} />
        </div>
      )}
    </DeviceFormPage>
  );
};

export default StaticRouteCreatePage;
