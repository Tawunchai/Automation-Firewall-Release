import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { DeviceGetRADIUSServer, DeviceUpdateRADIUSServer } from "../../api/policyObject";
import { RADIUSServerFields } from "./radius-server-form";
import { buildRADIUSServerPayload, validateRADIUSServerForm, radiusServerToForm, BLANK_RADIUS_SERVER_FORM, type RADIUSServerFormState } from "./radius-server-form.logic";
import { RADIUS_DOCS_HREF } from "./radius-server-create";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

const RADIUSServerEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { deviceId } = useDeviceFromQuery();
  const originalName = searchParams.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);
  const [form, setForm] = useState<RADIUSServerFormState>(BLANK_RADIUS_SERVER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RADIUSServerFormState>(k: K, v: RADIUSServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId || !originalName) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      const s = await DeviceGetRADIUSServer(deviceId, originalName).catch(() => null);
      if (!live) return;
      // A server we could not read is not a server we may overwrite with blank defaults — the
      // shared secret alone would be enough to stop every RADIUS login on this firewall.
      if (!s) setUnreadable(true);
      else setForm(radiusServerToForm(s));
      setLoading(false);
    })();
    return () => { live = false; };
  }, [deviceId, originalName]);

  const submit = async (device: NetworkDevice, hostname: string) => {
    // isEdit relaxes the secret rules: blank keeps the stored shared secrets.
    const errs = validateRADIUSServerForm(form, { isEdit: true });
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceUpdateRADIUSServer(device.id, originalName, buildRADIUSServerPayload(form));
      message.success(`RADIUS server "${form.name.trim()}" updated on ${hostname || device.name}`);
      navigate(`/admin/radius-servers?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to update RADIUS server"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UserAuthFormPage
      noun="RADIUS server"
      docsHref={RADIUS_DOCS_HREF}
      name={originalName}
      loading={loading}
      unreadable={unreadable}
      saving={saving}
      submitLabel="Save"
      onSubmit={submit}
      panelClass="panel panel-flush"
    >
      {({ device }) => (
        // The server exists here, so the device's own Test Connectivity / Test User Credentials
        // checks are live. They test what is SAVED, not the unsaved edits.
        <RADIUSServerFields form={form} set={set} errors={errors} currentColor={currentColor}
          deviceId={device.id} savedName={originalName} isEdit />
      )}
    </UserAuthFormPage>
  );
};

export default RADIUSServerEditPage;
