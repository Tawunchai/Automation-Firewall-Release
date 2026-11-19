import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiLayers, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceListAddressGroups, DeviceUpdateAddressGroup,
  DeviceListServiceGroups, DeviceUpdateServiceGroup,
} from "../../api/objectGroups";
import {
  BLANK_GROUP_DRAFT, validateGroupDraft, addressGroupPayload, serviceGroupPayload,
  addressGroupToDraft, serviceGroupToDraft, useGroupCandidates, type GroupDraft, type GroupKind,
} from "./group-form";
import GroupFields from "./group-fields";

const GroupsEditPage: React.FC<{ kind: GroupKind }> = ({ kind }) => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceId = Number(searchParams.get("deviceId"));
  const name = searchParams.get("name") ?? "";
  const noun = kind === "address" ? "address group" : "service group";
  const listPath = kind === "address" ? "/admin/fw-addresses?tab=groups" : "/admin/fw-services?tab=groups";

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState<GroupDraft>(BLANK_GROUP_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { candidates, error: candError } = useGroupCandidates(deviceId || null, kind);

  useEffect(() => {
    if (!deviceId || !name) { setLoading(false); setNotFound(true); return; }
    (async () => {
      try {
        const list = await ListDevices().catch(() => []);
        setDevice(list.find((d) => d.id === deviceId) ?? null);

        if (kind === "address") {
          const g = await DeviceListAddressGroups(deviceId, { strict: true }).then((gs) => gs.find((x) => x.name === name));
          if (!g) setNotFound(true); else setDraft(addressGroupToDraft(g));
        } else {
          const g = await DeviceListServiceGroups(deviceId, { strict: true }).then((gs) => gs.find((x) => x.name === name));
          if (!g) setNotFound(true); else setDraft(serviceGroupToDraft(g));
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [deviceId, name, kind]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateGroupDraft(draft);
    if (err) { setFormError(err); return; }
    setFormError(null);
    setSaving(true);
    try {
      if (kind === "address") {
        const res = await DeviceUpdateAddressGroup(deviceId, name, addressGroupPayload(draft));
        if (res.warning) { setFormError(res.warning); setSaving(false); return; }
      } else {
        await DeviceUpdateServiceGroup(deviceId, name, serviceGroupPayload(draft));
      }
      message.success(`${noun} "${draft.name.trim()}" updated on ${device?.name ?? "device"}`);
      navigate(`${listPath}&deviceId=${deviceId}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "The device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiLayers />} title={`Edit ${noun}`} accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-[13px] ink-3">Loading {noun}…</div>
      ) : notFound ? (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
          {noun.charAt(0).toUpperCase() + noun.slice(1)} not found — go back to the list.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="rounded-[4px] border hairline surface-card p-5 shadow-sm">
            {formError && (
              <div className="banner banner-danger mb-3">
                <FiAlertTriangle size={14} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            <GroupFields kind={kind} draft={draft} setDraft={setDraft} candidates={candidates} candError={candError} />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)}
              className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
            <button type="submit" disabled={saving}
              className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
              style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
              {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Save</>}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default GroupsEditPage;
