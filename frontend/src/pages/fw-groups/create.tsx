import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiLayers, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceCreateAddressGroup, DeviceCreateServiceGroup } from "../../api/objectGroups";
import {
  BLANK_GROUP_DRAFT, validateGroupDraft, addressGroupPayload, serviceGroupPayload,
  useGroupCandidates, type GroupDraft, type GroupKind,
} from "./group-form";
import GroupFields from "./group-fields";

// New Address Group / New Service Group — the same screen Static Routes and DHCP Servers already
// use for a standalone create: a device picked by query string, one form, Save or Back. Replaces
// the modal groups-panel.tsx used to open in place.

const GroupsCreatePage: React.FC<{ kind: GroupKind }> = ({ kind }) => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const noun = kind === "address" ? "address group" : "service group";
  const listPath = kind === "address" ? "/admin/fw-addresses?tab=groups" : "/admin/fw-services?tab=groups";

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [loadingDev, setLoadingDev] = useState(true);
  const [draft, setDraft] = useState<GroupDraft>(BLANK_GROUP_DRAFT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { candidates, error: candError } = useGroupCandidates(device?.id, kind);

  React.useEffect(() => {
    const id = searchParams.get("deviceId");
    if (!id) { setLoadingDev(false); return; }
    ListDevices().then((list) => {
      setDevice(list.find((d) => d.id === Number(id)) ?? null);
    }).finally(() => setLoadingDev(false));
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateGroupDraft(draft);
    if (err) { setFormError(err); return; }
    if (!device) { setFormError("No device selected"); return; }
    setFormError(null);
    setSaving(true);
    try {
      if (kind === "address") {
        const res = await DeviceCreateAddressGroup(device.id, addressGroupPayload(draft));
        if (res.warning) { setFormError(res.warning); setSaving(false); return; }
      } else {
        await DeviceCreateServiceGroup(device.id, serviceGroupPayload(draft));
      }
      message.success(`${noun} "${draft.name.trim()}" created on ${device.name}`);
      navigate(`${listPath}&deviceId=${device.id}`);
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "The device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiLayers />} title={`New ${noun}`} accent={currentColor}
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
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Create</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GroupsCreatePage;
