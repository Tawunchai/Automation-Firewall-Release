import React, { useCallback, useEffect, useState } from "react";
import {
  FiAlertTriangle, FiBell, FiMail, FiPlay, FiSend, FiZap,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import {
  GetNotifyOverview, ListNotifyKinds, ListNotifyRules, RunNotifySweep,
  type NotifyKindInfo, type NotifyOverview, type NotifyRule,
} from "../../api/notify";
import Rules from "./rules";
import Channels from "./channels";
import { useNotifyChannels } from "./channels.logic";
import SIEMExport from "./siemExport";
import History from "./history";
import { apiErrorDetail } from "../../api/errorText";

// Notify Management.
//
// Three tabs, in the order the job is actually done: write a rule, give it somewhere to go, then
// look at what went out. The tiles across the top are there to answer one question before any of
// that — "would anything actually be delivered right now?" — because every other failure on this
// page is visible and that one is not.
//
// This page replaced a deliberately empty placeholder. The placeholder existed because a fake
// "Connect LINE" button is worse than nothing: people believe alerting is configured and nobody is
// told about anything. The same standard applies to what is here now, which is why a rule that
// could never reach anybody says so in the list rather than showing a green tick.

type Tab = "rules" | "channels" | "history" | "siem";

const TABS: { key: Tab; label: string }[] = [
  { key: "rules", label: "Alert rules" },
  { key: "channels", label: "Channels & recipients" },
  { key: "history", label: "History" },
  { key: "siem", label: "SIEM Export" },
];

const NotifyPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { devices } = useSelectedDevice();

  const [tab, setTab] = useState<Tab>("rules");
  const [kinds, setKinds] = useState<NotifyKindInfo[]>([]);
  const [pollSeconds, setPollSeconds] = useState(60);
  const [rules, setRules] = useState<NotifyRule[]>([]);
  const [overview, setOverview] = useState<NotifyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  const { channels, recipients, loading: channelsLoading, reload: reloadChannels } = useNotifyChannels();

  const reload = useCallback(async () => {
    try {
      const [ruleRows, ov] = await Promise.all([ListNotifyRules(), GetNotifyOverview()]);
      setRules(ruleRows);
      setOverview(ov);
    } catch {
      setRules([]);
      setOverview(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    ListNotifyKinds()
      .then((c) => { setKinds(c.kinds); setPollSeconds(c.pollSeconds); })
      .catch(() => setKinds([]));
    void reload();
  }, [reload]);

  const reloadAll = useCallback(() => {
    void reload();
    void reloadChannels();
  }, [reload, reloadChannels]);

  // Running a sweep on demand is not a debugging leftover: after writing a rule the honest question
  // is "does this fire on what my firewall is doing right now", and the alternative is waiting a
  // minute and then guessing why nothing happened.
  const runNow = async () => {
    setRunning(true);
    try {
      const res = await RunNotifySweep();
      if (res.Fired === 0 && res.Resolved === 0) {
        message.info(`Checked ${res.Rules} rule(s) on ${res.Devices} device(s) — nothing to report`);
      } else {
        message.success(`${res.Fired} alert(s) fired, ${res.Resolved} resolved`);
      }
      reloadAll();
    } catch (e) {
      message.error(apiErrorDetail(e, "The check could not be run"));
    } finally {
      setRunning(false);
    }
  };

  const nothingCanDeliver = overview !== null && !overview.smtp_ready && !overview.line_ready;

  return (
    <div className="page-stack">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. The hero's badge (enabled/total rules, or "nothing can deliver") is not
          repeated here — the first tile below and the warning banner already say it. */}
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="btn btn-soft btn-sm" onClick={() => void runNow()} disabled={running}>
          <FiPlay size={12} /> {running ? "Checking…" : "Check now"}
        </button>
      </div>

      {/* ── Can anything be delivered? ── */}
      {nothingCanDeliver && (
        <div className="banner banner-warn">
          <FiAlertTriangle size={15} className="shrink-0" />
          <span>
            No delivery channel is usable yet — every rule below would fire into nothing. Add a LINE
            channel with an access token, or configure the mail account under Service ▸ Email.
          </span>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Rules"
          value={overview ? `${overview.rules_enabled}/${overview.rules}` : "—"}
          note="enabled of total"
          icon={<FiZap />}
          color={currentColor}
        />
        <Tile
          label="Firing now"
          value={overview ? String(overview.firing) : "—"}
          note={overview?.firing ? "needs attention" : "all clear"}
          icon={<FiAlertTriangle />}
          color={overview?.firing ? "#ef4444" : "#10b981"}
        />
        <Tile
          label="Sent in 24h"
          value={overview ? String(overview.events_24h) : "—"}
          note={overview?.failed_24h ? `${overview.failed_24h} did not get through` : "all delivered"}
          icon={<FiBell />}
          color={overview?.failed_24h ? "#f59e0b" : currentColor}
        />
        <Tile
          label="Delivery"
          value={
            overview
              ? [overview.line_ready ? "LINE" : null, overview.smtp_ready ? "Email" : null]
                .filter(Boolean).join(" + ") || "none"
              : "—"
          }
          note={overview?.smtp_ready === false ? (overview.smtp_error ?? "email not configured") : `${overview?.recipients ?? 0} recipients`}
          icon={overview?.line_ready ? <FiSend /> : <FiMail />}
          color={overview && (overview.line_ready || overview.smtp_ready) ? "#10b981" : "#f59e0b"}
        />
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b hairline-2">
        {TABS.map((t) => {
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="-mb-px border-b-2 px-3 py-2 text-[12.5px] font-semibold transition"
              style={
                on
                  ? { borderColor: currentColor, color: currentColor }
                  : { borderColor: "transparent", color: "var(--shell-ink-3)" }
              }
            >
              {t.label}
              {t.key === "rules" && rules.length > 0 && (
                <span className="ml-1.5 chip">{rules.length}</span>
              )}
              {t.key === "channels" && channels.length > 0 && (
                <span className="ml-1.5 chip">{channels.length}</span>
              )}
            </button>
          );
        })}
      </div>

      {tab === "rules" && (
        <Rules
          rules={rules}
          kinds={kinds}
          pollSeconds={pollSeconds}
          channels={channels}
          recipients={recipients}
          devices={devices}
          loading={loading}
          onChanged={reloadAll}
        />
      )}
      {tab === "channels" && (
        <Channels channels={channels} loading={channelsLoading} onChanged={reloadAll} />
      )}
      {tab === "history" && <History kinds={kinds} />}
      {tab === "siem" && <SIEMExport />}
    </div>
  );
};

const Tile: React.FC<{
  label: string;
  value: string;
  note: string;
  icon: React.ReactNode;
  color: string;
}> = ({ label, value, note, icon, color }) => (
  <div className="rounded-sm border hairline-2 surface-card px-3.5 py-3 shadow-sm">
    <div className="flex items-center justify-between">
      <p className="m-0 text-[10.5px] font-bold uppercase tracking-[0.09em] ink-3">{label}</p>
      <span
        className="medallion h-6 w-6 text-[12px]"
        style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
      >
        {icon}
      </span>
    </div>
    <p className="m-0 mt-1.5 text-[20px] font-bold leading-none ink">{value}</p>
    <p className="m-0 mt-1 truncate text-[10.5px] ink-3" title={note}>{note}</p>
  </div>
);

export default NotifyPage;
