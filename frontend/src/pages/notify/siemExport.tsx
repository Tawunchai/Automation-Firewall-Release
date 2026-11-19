import React, { useEffect, useState } from "react";
import { FiSend, FiShield } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { GetSIEMExportPolicy, UpdateSIEMExportPolicy, TestSIEMWebhook } from "../../api/siemExport";

// Phase C1 — every Change Ledger row, streamed to an external SIEM as it happens. A sibling of the
// channels above, not one of them: a channel delivers an ALERT a rule decided to fire; this
// delivers every change unconditionally, so it keeps its own small settings card rather than being
// bent into the channel/recipient/rule shape built for a different question.

const SIEMExport: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    GetSIEMExportPolicy()
      .then((p) => { setEnabled(p.enabled); setWebhookUrl(p.webhook_url); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const save = async (nextEnabled: boolean) => {
    setSaving(true);
    try {
      const p = await UpdateSIEMExportPolicy(nextEnabled, webhookUrl);
      setEnabled(p.enabled);
      message.success("SIEM export settings saved");
    } catch (e: unknown) {
      message.error(apiErrorText(e, "Could not save SIEM export settings"));
    } finally {
      setSaving(false);
    }
  };

  const runTest = async () => {
    setTesting(true);
    try {
      await TestSIEMWebhook(webhookUrl);
      message.success("Test event sent — check your SIEM's receiver");
    } catch (e: unknown) {
      message.error(apiErrorText(e, "The webhook did not accept the test event"));
    } finally {
      setTesting(false);
    }
  };

  if (loading) return <p className="t-meta">Loading…</p>;

  return (
    <div className="panel space-y-3 p-4">
      <div className="flex items-center gap-2.5">
        <span className="medallion h-8 w-8 text-[15px]" style={{ background: "color-mix(in srgb, #6366f1 14%, transparent)", color: "#6366f1" }}>
          <FiShield />
        </span>
        <div>
          <p className="t-card m-0">SIEM Export</p>
          <p className="t-meta m-0">Send every Change Ledger row to an external webhook (Splunk, Elastic, QRadar, …) as it happens</p>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="t-label">Webhook URL</span>
        <input
          type="url"
          className="shell-input"
          placeholder="https://your-siem.example.com/ingest"
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11.5px] font-medium ink-2">
          <input
            type="checkbox"
            checked={enabled}
            disabled={saving}
            onChange={(e) => { setEnabled(e.target.checked); void save(e.target.checked); }}
          />
          Export is {enabled ? "on" : "off"}
        </label>

        <div className="flex gap-2">
          <button type="button" className="btn btn-soft btn-sm" disabled={testing || !webhookUrl.trim()}
            onClick={() => void runTest()}>
            <FiSend size={12} /> {testing ? "Sending…" : "Send test event"}
          </button>
          <button type="button" className="btn btn-accent btn-sm" disabled={saving}
            onClick={() => void save(enabled)}>
            Save
          </button>
        </div>
      </div>

      <p className="t-meta m-0">
        Export never slows down or fails a device write — a webhook that is slow or unreachable is
        logged on the server and nothing else. A rejected write is sent too, with its error, because
        a rejected change attempt is itself worth a security team seeing.
      </p>
    </div>
  );
};

export default SIEMExport;
