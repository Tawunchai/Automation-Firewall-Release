import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { DeviceListSystemInterfaces } from "../../api/policyObject";
import { DeviceCreateIPPool } from "../../api/objectGroups";
import { PoolFields } from "./pool-form";
import { validateDraft as validatePoolDraft } from "./pool-model";
import { BLANK_POOL, buildPoolPayload } from "./pool-form.logic";
import type { PoolDraft } from "./pool-model";
import type { NetworkDevice } from "../../api/device";

const IPPoolCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { deviceId } = useDeviceFromQuery();

  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [draft, setDraft] = useState<PoolDraft>(BLANK_POOL);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PoolDraft>(k: K, v: PoolDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  // The interface list is the page's own read; the device itself comes from the inventory the app
  // already has (useDeviceFromQuery), not from a GET /devices of this page's own.
  useEffect(() => {
    if (!deviceId) return;
    DeviceListSystemInterfaces(deviceId)
      .then((is) => setInterfaces(is.map((i) => i.name)))
      .catch(() => { /* the pool can be created without the picker's suggestions */ });
  }, [deviceId]);

  const submit = async (device: NetworkDevice) => {
    const problem = validatePoolDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceCreateIPPool(device.id, buildPoolPayload(draft));
      message.success(`IP pool "${draft.name.trim()}" created on ${device.name}`);
      navigate(`/admin/ip-pools?deviceId=${device.id}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "The device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeviceFormPage noun="IP pool" onSubmit={submit} saving={saving} submitLabel="Create">
      {() => <PoolFields draft={draft} set={set} interfaces={interfaces} formError={formError} />}
    </DeviceFormPage>
  );
};

export default IPPoolCreatePage;
