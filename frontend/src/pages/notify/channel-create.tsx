import React, { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiBell, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { CreateNotifyChannel, type NotifyChannelType } from "../../api/notify";
import { blankChannelDraft, buildChannelCreatePayload, type ChannelDraft } from "./channel-form";
import ChannelFields from "./channel-fields";

// New LINE or email channel — standalone page replacing the ChannelForm modal that used to open in
// place from the Channels & recipients tab.

const ChannelCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const type: NotifyChannelType = searchParams.get("type") === "email" ? "email" : "line";
  const [draft, setDraft] = useState<ChannelDraft>(() => blankChannelDraft(type));
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.name.trim()) { setFormError("Name is required"); return; }
    setFormError(null);
    setSaving(true);
    try {
      await CreateNotifyChannel(buildChannelCreatePayload(draft, type));
      message.success("Channel added");
      navigate("/admin/notify?tab=channels");
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "Could not save the channel"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiBell />} title={type === "line" ? "New LINE channel" : "New email channel"} accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      <form onSubmit={handleSubmit}>
        <div className="rounded-sm border hairline surface-card p-5 shadow-sm">
          {formError && (
            <div className="banner banner-danger mb-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <ChannelFields type={type} draft={draft} setDraft={setDraft} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
          <button type="submit" disabled={saving || !draft.name.trim()}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Create</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ChannelCreatePage;
