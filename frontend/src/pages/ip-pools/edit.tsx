import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { ProfileUnreadable } from "../security-profiles/ProfileLoadGuard";
import { DeviceListSystemInterfaces } from "../../api/policyObject";
import { DeviceListIPPools, DeviceUpdateIPPool } from "../../api/objectGroups";
import { PoolFields } from "./pool-form";
import { validateDraft as validatePoolDraft } from "./pool-model";
import { BLANK_POOL, poolToDraft, buildPoolPayload } from "./pool-form.logic";
import type { PoolDraft } from "./pool-model";
import type { NetworkDevice } from "../../api/device";

const IPPoolEditPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { device, deviceId } = useDeviceFromQuery();
  const name = searchParams.get("name") || "";

  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);

  const [draft, setDraft] = useState<PoolDraft>(BLANK_POOL);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof PoolDraft>(k: K, v: PoolDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId || !name) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      try {
        const pools = await DeviceListIPPools(deviceId, { strict: true });
        if (!live) return;
        const found = pools.find((p) => p.name === name);
        // A pool we could not read is not a pool we may overwrite with blank defaults — see
        // ProfileLoadGuard for the whole account of why this stops the form rendering.
        if (!found) setUnreadable(true);
        else setDraft(poolToDraft(found));
      } catch {
        if (live) setUnreadable(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    DeviceListSystemInterfaces(deviceId)
      .then((is) => live && setInterfaces(is.map((i) => i.name)))
      .catch(() => { /* the form works without the picker's suggestions */ });
    return () => { live = false; };
  }, [deviceId, name]);

  const submit = async (d: NetworkDevice) => {
    const problem = validatePoolDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceUpdateIPPool(d.id, name, buildPoolPayload(draft));
      message.success(`IP pool "${draft.name.trim()}" updated on ${d.name}`);
      navigate(`/admin/ip-pools?deviceId=${d.id}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "The device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeviceFormPage
      noun="IP pool"
      onSubmit={submit}
      saving={saving}
      loading={loading}
      submitLabel="Save"
      unreadable={unreadable && !loading ? (
        <ProfileUnreadable
          noun="IP pool"
          name={name}
          deviceName={device?.name}
          onBack={() => navigate(-1)}
        />
      ) : undefined}
    >
      {() => <PoolFields draft={draft} set={set} interfaces={interfaces} formError={formError} />}
    </DeviceFormPage>
  );
};

export default IPPoolEditPage;
