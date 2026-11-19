import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { UserAuthFormPage } from "./UserAuthFormPage";
import { DeviceCreateRADIUSServer } from "../../api/policyObject";
import { RADIUSServerFields } from "./radius-server-form";
import { buildRADIUSServerPayload, validateRADIUSServerForm, BLANK_RADIUS_SERVER_FORM, type RADIUSServerFormState } from "./radius-server-form.logic";
import type { NetworkDevice } from "../../api/device";
import { apiErrorDetail } from "../../api/errorText";

export const RADIUS_DOCS_HREF =
  "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/166685/radius-servers";

const RADIUSServerCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();

  const [form, setForm] = useState<RADIUSServerFormState>(BLANK_RADIUS_SERVER_FORM);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof RADIUSServerFormState>(k: K, v: RADIUSServerFormState[K]) =>
    setForm((p) => ({ ...p, [k]: v }));

  const submit = async (device: NetworkDevice, hostname: string) => {
    const errs = validateRADIUSServerForm(form);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceCreateRADIUSServer(device.id, buildRADIUSServerPayload(form));
      message.success(`RADIUS server "${form.name.trim()}" created on ${hostname || device.name}`);
      navigate(`/admin/radius-servers?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create RADIUS server"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <UserAuthFormPage
      noun="RADIUS server"
      docsHref={RADIUS_DOCS_HREF}
      onSubmit={submit}
      saving={saving}
      panelClass="panel panel-flush"
    >
      {({ device }) => (
        <RADIUSServerFields form={form} set={set} errors={errors} currentColor={currentColor}
          deviceId={device.id} savedName="" />
      )}
    </UserAuthFormPage>
  );
};

export default RADIUSServerCreatePage;
