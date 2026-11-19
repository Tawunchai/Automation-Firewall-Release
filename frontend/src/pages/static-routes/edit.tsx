import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { ProfileUnreadable } from "../security-profiles/ProfileLoadGuard";
import { DeviceGetStaticRoute, DeviceUpdateStaticRoute, DeviceGetInfo } from "../../api/policyObject";
import { RouteFields } from "./route-form";
import { useRouteOptions, buildRoutePayload, validateRouteForm, routeToForm, BLANK_ROUTE_FORM, type RouteFormState } from "./route-form.logic";
import { RouteInfoPanel } from "./create";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

const StaticRouteEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { device, deviceId } = useDeviceFromQuery();
  const seq = Number(searchParams.get("seq"));

  const [hostname, setHostname] = useState("");
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);

  const [form, setForm] = useState<RouteFormState>(BLANK_ROUTE_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RouteFormState>(k: K, v: RouteFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  const { interfaces, services, loadingSvc } = useRouteOptions(deviceId);

  useEffect(() => {
    if (!deviceId || !seq) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    // The two reads go together: this device's hostname and the route being edited do not depend
    // on one another, and awaiting them in turn made opening the form cost their times added up
    // rather than the slower of them. (The device row itself is no longer a read at all — it
    // comes from the inventory the app already holds.)
    (async () => {
      const [info, r] = await Promise.all([
        DeviceGetInfo(deviceId).catch(() => null),
        DeviceGetStaticRoute(deviceId, seq).catch(() => null),
      ]);
      if (!live) return;
      if (info) setHostname(info.hostname || "");
      // A route we could not read is not a route we may overwrite with blank defaults — see
      // ProfileLoadGuard for the whole account of why this stops the form rendering.
      if (!r) setUnreadable(true);
      else setForm(routeToForm(r));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [deviceId, seq]);

  const submit = async (d: NetworkDevice) => {
    const errs = validateRouteForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateStaticRoute(d.id, seq, buildRoutePayload(form));
      message.success(`Static route #${seq} updated on ${hostname || d.name}`);
      navigate(`/admin/static-routes?deviceId=${d.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update route"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeviceFormPage
      noun="static route"
      onSubmit={submit}
      saving={saving}
      loading={loading}
      submitLabel="Save"
      card={false}
      unreadable={unreadable && !loading ? (
        <ProfileUnreadable
          noun="static route"
          name={seq ? `#${seq}` : null}
          deviceName={device?.name}
          onBack={() => navigate(-1)}
        />
      ) : undefined}
    >
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

export default StaticRouteEditPage;
