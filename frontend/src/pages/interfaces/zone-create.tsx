import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { DeviceListSystemInterfaces, type SystemInterface } from "../../api/policyObject";
import { DeviceListZones, DeviceCreateZone, type Zone } from "../../api/objectGroups";
import { ZoneFields } from "./zone-form";
import { BLANK_ZONE, buildZonePayload, validateZoneDraft, claimedByMap, type ZoneDraft } from "./zone-form.logic";
import type { NetworkDevice } from "../../api/device";

const ZoneCreatePage: React.FC = () => {
  const navigate = useNavigate();
  const { deviceId } = useDeviceFromQuery();
  const backTo = `/admin/fw-interfaces?tab=zones${deviceId ? `&deviceId=${deviceId}` : ""}`;

  const [interfaces, setInterfaces] = useState<SystemInterface[]>([]);
  const [ifError, setIfError] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);

  const [draft, setDraft] = useState<ZoneDraft>(BLANK_ZONE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ZoneDraft>(k: K, v: ZoneDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId) return;
    // Strict: the picker marks which interfaces are already claimed, and a list that failed to
    // read must not be drawn as "every port is free".
    DeviceListSystemInterfaces(deviceId, { strict: true })
      .then(setInterfaces)
      .catch((e: unknown) => setIfError(e instanceof Error ? e.message : "the interface list could not be read"));
    DeviceListZones(deviceId).then(setZones).catch(() => { /* claimed-by is advisory */ });
  }, [deviceId]);

  const submit = async (device: NetworkDevice) => {
    const problem = validateZoneDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceCreateZone(device.id, buildZonePayload(draft));
      message.success(`Zone "${draft.name.trim()}" created on ${device.name}`);
      navigate(backTo);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "The device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <DeviceFormPage
      noun="zone"
      onSubmit={submit}
      saving={saving}
      submitLabel="Create"
      onCancel={() => navigate(backTo)}
    >
      {() => (
        <ZoneFields draft={draft} set={set} interfaces={interfaces} ifError={ifError}
          claimedBy={claimedByMap(zones)} originalName={null} formError={formError} />
      )}
    </DeviceFormPage>
  );
};

export default ZoneCreatePage;
