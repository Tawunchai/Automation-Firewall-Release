import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FiAlertTriangle, FiEdit2, FiMail, FiPlus, FiSend, FiTrash2, FiUsers, FiKey,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import confirm from "../../components/ui/confirm";
import { DeleteNotifyChannel, DeleteNotifyRecipient, TestNotifyChannel, UpdateNotifyChannel, UpdateNotifyRecipient, type NotifyChannel } from "../../api/notify";
import LineMascot from "./LineMascot";
import { apiErrorDetail } from "../../api/errorText";

// Channels and recipients — "where can an alert go, and to whom".
//
// A channel is the credential (a LINE bot's access token) or, for email, nothing at all: mail goes
// through the SMTP account already configured under Service ▸ Email, because a second place to type
// a mail password is a second place for it to be wrong.
//
// The access token is write-only. Once stored it never comes back to the browser, so the form shows
// "configured" and offers to replace it rather than pre-filling a secret into an input.

const LINE_GREEN = "#06C755";

type Props = {
  channels: NotifyChannel[];
  loading: boolean;
  onChanged: () => void;
};

const Channels: React.FC<Props> = ({ channels, loading, onChanged }) => {
  const navigate = useNavigate();
  const [testing, setTesting] = useState<number | null>(null);

  const test = async (ch: NotifyChannel) => {
    setTesting(ch.id);
    try {
      const res = await TestNotifyChannel(ch.id);
      if (res.status === "sent") message.success(`Test message delivered to ${res.sent} recipient(s)`);
      else if (res.status === "partial") message.warning(`${res.sent} delivered, ${res.failed} failed`);
      else message.error(res.results?.find((r) => !r.ok)?.error ?? "Nothing was delivered");
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "The test message could not be sent"));
    } finally {
      setTesting(null);
    }
  };

  const removeChannel = async (ch: NotifyChannel) => {
    const ok = await confirm({
      title: `Remove ${ch.name}?`,
      content: `Its ${ch.recipient_count} recipient(s) go too, and any alert rule pointing at them stops reaching anyone.`,
      okText: "Remove channel",
    });
    if (!ok) return;
    try {
      await DeleteNotifyChannel(ch.id);
      message.success("Channel removed");
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not remove the channel"));
    }
  };

  const removeRecipient = async (id: number, name: string) => {
    const ok = await confirm({
      title: `Remove ${name}?`,
      content: "They are dropped from every alert rule that names them.",
      okText: "Remove",
    });
    if (!ok) return;
    try {
      await DeleteNotifyRecipient(id);
      message.success("Recipient removed");
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not remove the recipient"));
    }
  };

  const toggleRecipient = async (id: number, enabled: boolean) => {
    try {
      await UpdateNotifyRecipient(id, { enabled });
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not change the recipient"));
    }
  };

  const toggleChannel = async (ch: NotifyChannel) => {
    try {
      await UpdateNotifyChannel(ch.id, { name: ch.name, description: ch.description, enabled: !ch.enabled });
      onChanged();
    } catch (e) {
      message.error(apiErrorDetail(e, "Could not change the channel"));
    }
  };

  if (loading) {
    return <div className="state-block py-14"><p className="state-title m-0">Loading channels…</p></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="t-meta m-0">
          A channel is a way out of the building. Alerts are sent to the recipients inside it.
        </p>
        <div className="flex gap-2">
          <button type="button" className="btn btn-soft btn-sm" onClick={() => navigate("/admin/notify/channels/create?type=line")}>
            <FiPlus size={12} /> LINE channel
          </button>
          <button type="button" className="btn btn-soft btn-sm" onClick={() => navigate("/admin/notify/channels/create?type=email")}>
            <FiPlus size={12} /> Email channel
          </button>
        </div>
      </div>

      {channels.length === 0 ? (
        <div className="rounded-sm border hairline-2 surface-card px-6 py-10 text-center shadow-sm">
          <LineMascot className="mx-auto h-32 w-full max-w-56" />
          <h3 className="mt-3 text-[15px] font-bold ink">Nothing can be delivered yet</h3>
          <p className="mx-auto mt-1.5 max-w-100 text-[12.5px] leading-relaxed ink-3">
            Alert rules can be written now, but with no channel configured they would fire into
            nothing. Add a LINE bot's access token, or an email channel that uses the SMTP account
            from Service ▸ Email.
          </p>
        </div>
      ) : (
        channels.map((ch) => (
          <div key={ch.id} className="overflow-hidden rounded-sm border hairline-2 surface-card shadow-sm">
            <div className="card-head">
              <div className="min-w-0">
                <h3 className="card-title t-card">
                  <span
                    className="medallion h-6 w-6 text-[12px]"
                    style={
                      ch.type === "line"
                        ? { background: `${LINE_GREEN}1f`, color: LINE_GREEN }
                        : { background: "color-mix(in srgb, var(--accent) 13%, transparent)", color: "var(--accent)" }
                    }
                  >
                    {ch.type === "line" ? <FiSend /> : <FiMail />}
                  </span>
                  <span className="truncate">{ch.name}</span>
                  <span className="chip">{ch.type === "line" ? "LINE" : "Email"}</span>
                  {!ch.enabled && <span className="chip chip-warn">disabled</span>}
                  {ch.type === "line" && !ch.has_token && (
                    <span className="chip chip-danger"><FiKey size={10} /> no token</span>
                  )}
                  {ch.last_test_status === "ok" && <span className="chip chip-ok">test ok</span>}
                  {ch.last_test_status === "fail" && (
                    <span className="chip chip-danger" title={ch.last_test_error}>test failed</span>
                  )}
                </h3>
                {ch.description && <p className="mt-1 pl-3 text-[11.5px] ink-3">{ch.description}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void toggleChannel(ch)}>
                  {ch.enabled ? "Disable" : "Enable"}
                </button>
                <button
                  type="button"
                  className="btn btn-soft btn-sm"
                  onClick={() => void test(ch)}
                  disabled={testing === ch.id || ch.recipient_count === 0}
                  title={ch.recipient_count === 0 ? "Add a recipient first" : "Send a real test message"}
                >
                  <FiSend size={12} /> {testing === ch.id ? "Sending…" : "Test"}
                </button>
                <button type="button" className="btn-icon" onClick={() => navigate(`/admin/notify/channels/edit?id=${ch.id}`)} title="Edit channel">
                  <FiEdit2 size={13} />
                </button>
                <button
                  type="button"
                  className="btn-icon btn-icon--danger"
                  onClick={() => void removeChannel(ch)}
                  title="Remove channel"
                >
                  <FiTrash2 size={13} />
                </button>
              </div>
            </div>

            <div className="px-3.5 py-3">
              {ch.last_test_status === "fail" && ch.last_test_error && (
                <div className="banner banner-danger mb-2.5">
                  <FiAlertTriangle size={14} className="shrink-0" />
                  <span className="min-w-0 wrap-break-word">{ch.last_test_error}</span>
                </div>
              )}

              {ch.recipients.length === 0 ? (
                <p className="text-[12px] ink-3">
                  No recipient yet — this channel can hold a token but has nowhere to send.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {ch.recipients.map((r) => (
                    <div
                      key={r.id}
                      className="flex flex-wrap items-center gap-2 rounded-[4px] border hairline px-3 py-2"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-semibold ink">
                          {r.name}
                          {r.is_group && <span className="ml-1.5 chip chip-info">group</span>}
                        </span>
                        <span className="block truncate font-mono text-[11px] ink-3">{r.target}</span>
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => void toggleRecipient(r.id, !r.enabled)}
                      >
                        {r.enabled ? "On" : "Off"}
                      </button>
                      <button
                        type="button"
                        className="btn-icon btn-icon--danger"
                        onClick={() => void removeRecipient(r.id, r.name)}
                        title="Remove recipient"
                      >
                        <FiTrash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button type="button" className="btn btn-ghost btn-sm mt-2.5" onClick={() => navigate(`/admin/notify/recipients/create?channelId=${ch.id}`)}>
                <FiUsers size={12} /> Add recipient
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
};

export default Channels;
