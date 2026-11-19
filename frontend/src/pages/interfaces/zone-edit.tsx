import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { DeviceFormPage } from "../../components/device/DeviceFormPage";
import { useDeviceFromQuery } from "../../hooks/useDeviceFromQuery";
import { ProfileUnreadable } from "../security-profiles/ProfileLoadGuard";
import { DeviceListSystemInterfaces, type SystemInterface } from "../../api/policyObject";
import { DeviceListZones, DeviceUpdateZone, type Zone } from "../../api/objectGroups";
import { ZoneFields } from "./zone-form";
import { BLANK_ZONE, zoneToDraft, buildZonePayload, validateZoneDraft, claimedByMap, type ZoneDraft } from "./zone-form.logic";
import type { NetworkDevice } from "../../api/device";

const ZoneEditPage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { device, deviceId } = useDeviceFromQuery();
  const name = searchParams.get("name") || "";
  const backTo = `/admin/fw-interfaces?tab=zones${deviceId ? `&deviceId=${deviceId}` : ""}`;

  const [interfaces, setInterfaces] = useState<SystemInterface[]>([]);
  const [ifError, setIfError] = useState<string | null>(null);
  const [zones, setZones] = useState<Zone[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadable, setUnreadable] = useState(false);

  const [draft, setDraft] = useState<ZoneDraft>(BLANK_ZONE);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ZoneDraft>(k: K, v: ZoneDraft[K]) => setDraft((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!deviceId || !name) { setLoading(false); setUnreadable(true); return; }
    let live = true;
    (async () => {
      try {
        const zs = await DeviceListZones(deviceId, { strict: true });
        if (!live) return;
        setZones(zs);
        const found = zs.find((z) => z.name === name);
        // A zone we could not read is not a zone we may overwrite with blank defaults — see
        // ProfileLoadGuard for why this stops the form rendering at all.
        if (!found) setUnreadable(true);
        else setDraft(zoneToDraft(found));
      } catch {
        if (live) setUnreadable(true);
      } finally {
        if (live) setLoading(false);
      }
    })();
    DeviceListSystemInterfaces(deviceId, { strict: true })
      .then((is) => live && setInterfaces(is))
      .catch((e: unknown) => live && setIfError(e instanceof Error ? e.message : "the interface list could not be read"));
    return () => { live = false; };
  }, [deviceId, name]);

  const submit = async (d: NetworkDevice) => {
    const problem = validateZoneDraft(draft);
    if (problem) { setFormError(problem); return; }
    setFormError(null);
    try {
      setSaving(true);
      await DeviceUpdateZone(d.id, name, buildZonePayload(draft));
      message.success(`Zone "${draft.name.trim()}" updated on ${d.name}`);
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
      loading={loading}
      submitLabel="Save"
      onCancel={() => navigate(backTo)}
      unreadable={unreadable && !loading ? (
        <ProfileUnreadable noun="zone" name={name} deviceName={device?.name} onBack={() => navigate(backTo)} />
      ) : undefined}
    >
      {() => (
        <ZoneFields draft={draft} set={set} interfaces={interfaces} ifError={ifError}
          claimedBy={claimedByMap(zones)} originalName={name} formError={formError} />
      )}
    </DeviceFormPage>
  );
};

export default ZoneEditPage;
