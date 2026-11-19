import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiActivity, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { DeviceListTrafficShapers, DeviceUpdateTrafficShaper } from "../../api/trafficShaper";
import { BLANK_SHAPER, validateShaperDraft, buildShaperPayload, type ShaperDraft } from "./shaper-form";
import ShaperFields from "./shaper-fields";

const ShaperEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const name = searchParams.get("name") ?? "";

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [draft, setDraft] = useState<ShaperDraft>(BLANK_SHAPER);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!device || !name) { setLoading(false); setNotFound(true); return; }
    DeviceListTrafficShapers(device.id, { strict: true })
      .then((list) => {
        const s = list.find((x) => x.name === name);
        if (!s) setNotFound(true); else setDraft(s);
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [device, name]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateShaperDraft(draft);
    if (err) { setFormError(err); return; }
    if (!device) { setFormError("No device selected"); return; }
    setFormError(null);
    setSaving(true);
    try {
      await DeviceUpdateTrafficShaper(device.id, name, buildShaperPayload(draft));
      message.success(`Shaper "${draft.name.trim()}" updated on ${device.name}`);
      navigate("/admin/traffic-shaping");
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "the device refused the change"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiActivity />} title="Edit shaper" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-[13px] ink-3">Loading shaper…</div>
      ) : notFound ? (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
          Shaper not found — go back to the list.
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
            <ShaperFields draft={draft} setDraft={setDraft} />
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

export default ShaperEditPage;
