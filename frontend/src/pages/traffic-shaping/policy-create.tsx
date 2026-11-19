import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiActivity, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { DeviceCreateShapingPolicy } from "../../api/trafficShaper";
import { BLANK_POLICY, buildPolicyPayload, usePolicyOptions, type PolicyDraft } from "./policy-form";
import PolicyFields from "./policy-fields";

// New shaping policy — standalone page replacing the second modal that used to live in index.tsx.
// There is no edit page: the device API offers create and delete only for this object.

const PolicyCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();
  const navigate = useNavigate();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const { addresses, services, interfaces, shapers, error: loadError } = usePolicyOptions(device?.id);

  const [draft, setDraft] = useState<PolicyDraft>(BLANK_POLICY);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!device) { setFormError("No device selected"); return; }
    setFormError(null);
    setSaving(true);
    try {
      await DeviceCreateShapingPolicy(device.id, buildPolicyPayload(draft));
      message.success(`Shaping policy "${draft.name.trim() || "(unnamed)"}" created on ${device.name}`);
      navigate("/admin/traffic-shaping");
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "the device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiActivity />} title="New shaping policy" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">No device selected — pick one from the navbar</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="rounded-[4px] border hairline surface-card p-5 shadow-sm">
          {formError && (
            <div className="banner banner-danger mb-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <PolicyFields draft={draft} setDraft={setDraft} addresses={addresses} services={services}
                        interfaces={interfaces} shapers={shapers} loadError={loadError} />
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

export default PolicyCreatePage;
