import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { FiBell, FiChevronLeft, FiSave, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListNotifyChannels, UpdateNotifyChannel, type NotifyChannel } from "../../api/notify";
import { channelToDraft, buildChannelUpdatePayload, type ChannelDraft } from "./channel-form";
import ChannelFields from "./channel-fields";

const ChannelEditPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const id = Number(searchParams.get("id"));

  const [channel, setChannel] = useState<NotifyChannel | null>(null);
  const [draft, setDraft] = useState<ChannelDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) { setLoading(false); setNotFound(true); return; }
    ListNotifyChannels()
      .then((list) => {
        const ch = list.find((c) => c.id === id);
        if (!ch) { setNotFound(true); return; }
        setChannel(ch);
        setDraft(channelToDraft(ch));
      })
      .catch(() => setNotFound(true))
      .finally(() => setLoading(false));
  }, [id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !channel) return;
    if (!draft.name.trim()) { setFormError("Name is required"); return; }
    setFormError(null);
    setSaving(true);
    try {
      await UpdateNotifyChannel(channel.id, buildChannelUpdatePayload(draft));
      message.success("Channel updated");
      navigate("/admin/notify?tab=channels");
    } catch (err: unknown) {
      setFormError(apiErrorText(err, "Could not save the channel"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiBell />} title={channel ? `Edit ${channel.name}` : "Edit channel"} accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {loading ? (
        <div className="py-20 text-center text-[13px] ink-3">Loading channel…</div>
      ) : notFound || !draft || !channel ? (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-600">
          Channel not found — go back to the list.
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <div className="rounded-sm border hairline surface-card p-5 shadow-sm">
            {formError && (
              <div className="banner banner-danger mb-3">
                <FiAlertTriangle size={14} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}
            <ChannelFields type={channel.type} draft={draft} setDraft={setDraft} hasToken={channel.has_token} />
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button type="button" onClick={() => navigate(-1)}
              className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">Cancel</button>
            <button type="submit" disabled={saving || !draft.name.trim()}
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

export default ChannelEditPage;
