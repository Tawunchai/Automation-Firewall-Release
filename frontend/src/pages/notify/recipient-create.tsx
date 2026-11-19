import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiUsers, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { CreateNotifyRecipient, ListNotifyChannels, type NotifyChannel } from "../../api/notify";
import { BLANK_RECIPIENT, buildRecipientPayload, type RecipientDraft } from "./recipient-form";
import RecipientFields from "./recipient-fields";

// Add recipient — standalone page replacing the RecipientForm modal that used to open from a
// specific channel's "Add recipient" button.

const RecipientCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const channelId = Number(searchParams.get("channelId"));
  const [channel, setChannel] = useState<NotifyChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<RecipientDraft>(BLANK_RECIPIENT);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!channelId) { setLoading(false); return; }
    ListNotifyChannels()
      .then((list) => setChannel(list.find((c) => c.id === channelId) ?? null))
      .finally(() => setLoading(false));
  }, [channelId]);

  const isLine = channel?.type === "line";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!channel) { setFormError("No channel selected"); return; }
    if (!draft.target.trim()) { setFormError("Target is required"); return; }
    setFormError(null);
    setSaving(true);
    try {
      await CreateNotifyRecipient(buildRecipientPayload(draft, channel.id));
      message.success("Recipient added");
      navigate("/admin/notify?tab=channels");
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "Could not save the recipient"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiUsers />} title={channel ? `Add recipient — ${channel.name}` : "Add recipient"} accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loading && !channel && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">No channel — go back and pick one</div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="rounded-sm border hairline surface-card p-5 shadow-sm">
          {formError && (
            <div className="banner banner-danger mb-3">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{formError}</span>
            </div>
          )}
          <RecipientFields draft={draft} setDraft={setDraft} isLine={isLine} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
          <button type="submit" disabled={saving || !channel || !draft.target.trim()}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</> : <><FiSave size={14} /> Add</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default RecipientCreatePage;
