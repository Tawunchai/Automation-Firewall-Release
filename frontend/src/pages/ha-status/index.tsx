import React, { useCallback, useEffect, useState } from "react";
import {
  FiShare2, FiAlertTriangle, FiUsers, FiSliders, FiTrendingUp, FiWifi, FiRepeat, FiServer,
} from "react-icons/fi";
import { apiErrorText } from "../../api/errorText";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import { DeviceGetHAStatus, type HAStatus } from "../../api/systemSettings";
import { ICON_CHIP, type IconChipVariant } from "../dashboard/kpi";
import { utilisationHealth, type Health } from "../dashboard/kpi.logic";
import { formatUptime, formatUptimeLong, TONE_COLORS, type Tone } from "../dashboard/format";

// System ▸ HA Status — is this firewall one box or half of a pair, and is the pair healthy.
//
// READ-ONLY: forming or breaking a cluster changes what the unit IS. FortiOS renegotiates
// membership the moment the mode changes, with no confirmation and no undo, and it could not be
// verified here — the lab has one unit. services/fortigate_ha.go carries the full reasoning.
//
// The distinction the page is built around: what is CONFIGURED versus what is HAPPENING. A
// standalone unit keeps whatever HA settings it once had, so a group name and a pair of heartbeat
// interfaces can sit there looking like a cluster that does not exist.

/** Section header strip: tinted medallion + title, matching the rest of the console's panels. */
const CardHead: React.FC<{ icon: React.ReactNode; title: string; tintColor: string; right?: React.ReactNode }> = ({
  icon, title, tintColor, right,
}) => (
  <div className="flex items-center justify-between gap-2 border-b hairline-2 px-4 py-2.5">
    <span className="flex items-center gap-2.5">
      <span className="medallion h-7 w-7 text-[13px]" style={{ color: tintColor, background: `color-mix(in srgb, ${tintColor} 14%, transparent)` }}>
        {icon}
      </span>
      <span className="t-card font-semibold">{title}</span>
    </span>
    {right}
  </div>
);

const YesNo: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`badge-soft ${on ? "badge-success" : "badge-neutral"}`}>{on ? "Yes" : "No"}</span>
);

/** A glance tile for the quick-facts row: icon chip, label, one bold value, a caption underneath. */
const QuickFact: React.FC<{
  icon: React.ReactNode;
  variant: IconChipVariant;
  label: string;
  value: React.ReactNode;
  caption?: string;
}> = ({ icon, variant, label, value, caption }) => (
  <section className="shell-card flex items-center gap-3 p-4">
    <span
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[18px]"
      style={ICON_CHIP[variant]}
      aria-hidden
    >
      {icon}
    </span>
    <div className="min-w-0">
      <p className="m-0 truncate text-[10.5px] font-bold uppercase tracking-wider text-(--shell-ink-3)">
        {label}
      </p>
      <p className="m-0 mt-0.5 truncate text-[16px] font-bold leading-tight text-(--shell-ink)">{value}</p>
      {caption && <p className="m-0 mt-0.5 truncate text-[11px] text-(--shell-ink-3)">{caption}</p>}
    </div>
  </section>
);

/** One row of the Configured panel — a clean spec line, label + hint on the left and the value on
    the right. The per-row icon medallions were dropped on purpose: thirteen tinted circles down one
    panel read as noise, not information. Status now lives in the value itself (the Yes/No badge). */
const ConfigItem: React.FC<{
  label: string;
  value: React.ReactNode;
  hint?: string;
}> = ({ label, value, hint }) => (
  <div className="flex items-start justify-between gap-4 border-b hairline-2 py-3">
    <div className="min-w-0">
      <p className="t-label m-0">{label}</p>
      {hint && <p className="t-meta m-0 mt-0.5 leading-snug">{hint}</p>}
    </div>
    <div className="shrink-0 pt-0.5 text-right text-[13px] font-semibold ink">{value}</div>
  </div>
);

/** Utilisation → the same ok/warn/error tone the dashboard's health pills use, so a loaded member
    reads the same red/amber/green here as it does there. */
const HEALTH_TO_TONE: Record<Health, Tone> = { normal: "ok", warning: "warn", critical: "error" };
const utilColor = (pct: number): string => TONE_COLORS[HEALTH_TO_TONE[utilisationHealth(pct)]];

/** A member's CPU or RAM, as a labelled bar rather than a number buried in a meta line. */
const UsageBar: React.FC<{ label: string; pct: number }> = ({ label, pct }) => (
  <div className="w-24 shrink-0">
    <div className="flex items-center justify-between gap-2">
      <span className="t-meta">{label}</span>
      <span className="t-meta tnum font-semibold">{pct}%</span>
    </div>
    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--shell-sunken)" }}>
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: utilColor(pct) }}
      />
    </div>
  </div>
);

/**
 * The leftover-settings sentence, built as ONE string.
 *
 * Concatenating fragments here would leave half of it in English: the extractor that feeds the
 * translation dictionaries reads whole literals and template strings, not the pieces of a `+`
 * expression. The detail is interpolated instead, so both shapes of the sentence are translatable.
 */
const leftoverSentence = (ha: HAStatus): string => {
  const detail = [
    ha.group_name ? `(group "${ha.group_name}")` : "",
    ha.heartbeat_devs.length ? `and heartbeat interfaces ${ha.heartbeat_devs.join(", ")}` : "",
  ].filter(Boolean).join(" ");
  return detail
    ? `This unit is standalone, but it still holds HA settings ${detail}. They survive being taken out of a cluster and are not doing anything.`
    : "This unit is standalone, but it still holds HA settings. They survive being taken out of a cluster and are not doing anything.";
};

/** The device's mode word, in a sentence that says what it means. */
const describeMode = (mode: string): string => {
  switch (mode) {
    case "a-p": return "Active-passive — one unit carries the traffic, the other waits";
    case "a-a": return "Active-active — both units carry traffic";
    case "standalone": return "Standalone — this unit is on its own";
    default: return mode;
  }
};

const HAStatusPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();

  const [ha, setHA] = useState<HAStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (deviceId: number) => {
    setLoading(true);
    setError(null);
    try {
      setHA(await DeviceGetHAStatus(deviceId));
    } catch (e: unknown) {
      setHA(null);
      setError(apiErrorText(e, "the HA configuration could not be read"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) return;
    void load(device.id);
  }, [device, load]);

  if (!device) return <NoDeviceState />;

  // Leftover settings on a standalone unit: worth pointing at, because they read as a cluster.
  const leftovers = ha && !ha.clustered && (ha.group_name !== "" || ha.heartbeat_devs.length > 0);

  // A cluster that cannot see its members is the one state here that is genuinely wrong — drives
  // the Mode row's colour the same way it used to drive the (now-removed) hero's tone.
  const clusterUnhealthy = !!ha && ha.clustered && (!ha.peers_readable || ha.members.length === 0);

  return (
    <div className="space-y-4">
      {(loading || error || !ha) && (
        <PageHeader
          icon={<FiShare2 />}
          title="HA Status"
          subtitle="Whether this unit is on its own or part of a cluster, and how healthy that cluster is"
          accent={currentColor}
        />
      )}

      {loading ? (
        <div className="panel"><LoadingState what="HA setting" from={device.name} /></div>
      ) : error || !ha ? (
        <div className="panel">
          <ErrorState
            title={`Could not read HA from ${device.name}`}
            detail={error ?? "the device did not answer"}
            note="This is 'unreadable', not 'standalone'"
            onRetry={() => void load(device.id)}
          />
        </div>
      ) : (
        <>
          {/* Page title/breadcrumb now come from the navbar, same as every other page since the
              Dastone pass — the hero's group name/ID/priority/heartbeat chips are not lost, just
              not repeated here: they're the first rows of the Configured panel below. The one
              thing the hero said that wasn't shown anywhere else — the mode verdict ("Active-
              passive…", clustered vs. standalone) — is now the first row of that same panel
              instead of a second place to look. */}

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <QuickFact
              icon={<FiUsers />}
              variant={ha.clustered ? "success" : "neutral"}
              label="Members"
              value={ha.clustered ? ha.members.length : 1}
              caption={ha.clustered ? (ha.peers_readable ? "reporting in" : "member list unreadable") : "this unit only"}
            />
            <QuickFact
              icon={<FiTrendingUp />}
              variant="info"
              label="Priority"
              value={ha.priority}
              caption={ha.override ? "override on" : "override off"}
            />
            <QuickFact
              icon={<FiWifi />}
              variant="accent"
              label="Heartbeat"
              value={`${ha.hb_interval} × 100 ms`}
              caption={`failover after ${ha.hb_lost_threshold} missed`}
            />
            <QuickFact
              icon={<FiRepeat />}
              variant={ha.sync_config ? "success" : "warning"}
              label="Config sync"
              value={ha.sync_config ? "Synced" : "Not synced"}
              caption={ha.session_pickup ? "session pickup on" : "session pickup off"}
            />
          </div>

          {leftovers && (
            <div className="banner banner-warn">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{leftoverSentence(ha)}</span>
            </div>
          )}

          <div className="shell-card p-0! overflow-hidden">
            <CardHead icon={<FiSliders size={14} />} title="Configured" tintColor={currentColor} />
            <div className="grid gap-x-10 px-4 pb-2 pt-1 sm:grid-cols-2 [&>*:last-child]:border-b-0 sm:[&>*:nth-last-child(2)]:border-b-0">
              <ConfigItem
                label="Mode"
                value={<span className={clusterUnhealthy ? "text-red-600 dark:text-red-400" : undefined}>{describeMode(ha.mode)}</span>}
                hint={ha.clustered ? "Clustered" : "Standalone"}
              />
              <ConfigItem label="Group name" value={ha.group_name || "—"} />
              <ConfigItem label="Group ID" value={ha.group_id} />
              <ConfigItem
                label="Priority"
                value={ha.priority}
                hint="Higher wins the election, unless override is off"
              />
              <ConfigItem label="Override" value={<YesNo on={ha.override} />} />
              <ConfigItem
                label="Heartbeat interfaces"
                value={ha.heartbeat_devs.length ? ha.heartbeat_devs.join(", ") : "—"}
                hint="How the members find each other"
              />
              <ConfigItem
                label="Monitored interfaces"
                value={ha.monitored_intfs.length ? ha.monitored_intfs.join(", ") : "—"}
                hint="Losing one of these triggers a failover"
              />
              <ConfigItem
                label="Config sync"
                value={<YesNo on={ha.sync_config} />}
                hint="Changes on the primary reach the secondary"
              />
              <ConfigItem
                label="Session pickup"
                value={<YesNo on={ha.session_pickup} />}
                hint="Without it, live connections drop on a failover"
              />
              <ConfigItem label="Heartbeat encryption" value={<YesNo on={ha.encryption} />} />
              <ConfigItem label="Heartbeat authentication" value={<YesNo on={ha.authentication} />} />
              <ConfigItem
                label="Heartbeat interval"
                value={`${ha.hb_interval} × 100 ms`}
                hint={`Failover after ${ha.hb_lost_threshold} missed`}
              />
              <ConfigItem
                label="Uninterruptible upgrade"
                value={<YesNo on={ha.uninterruptible_upgrade} />}
                hint="Upgrade one member at a time"
              />
            </div>
          </div>

          <div className="shell-card p-0! overflow-hidden">
            <CardHead icon={<FiUsers size={14} />} title="Members" tintColor={currentColor}
              right={ha.clustered && ha.peers_readable && ha.members.length > 0
                ? <span className="t-meta">{ha.members.length} member{ha.members.length === 1 ? "" : "s"}</span>
                : undefined} />
            {!ha.clustered ? (
              <p className="t-meta m-0 px-4 py-6 text-center">
                Standalone — there are no other members to report
              </p>
            ) : !ha.peers_readable ? (
              <div className="px-4 py-4">
                <div className="banner banner-warn">
                  <FiAlertTriangle size={14} className="shrink-0" />
                  <span>
                    {`This unit is in ${ha.mode} mode, but the member list could not be read. That is not the same as having no peers — do not read this as a healthy single member.`}
                  </span>
                </div>
              </div>
            ) : ha.members.length === 0 ? (
              <div className="px-4 py-4">
                <div className="banner banner-danger">
                  <FiAlertTriangle size={14} className="shrink-0" />
                  <span>
                    {`This unit is in ${ha.mode} mode and reports no members at all. A cluster that can see nobody is a cluster with a broken heartbeat.`}
                  </span>
                </div>
              </div>
            ) : ha.members.map((m, i) => (
              <div
                key={m.serial_number || i}
                className={`flex flex-wrap items-center gap-4 px-4 py-3.5${i < ha.members.length - 1 ? " border-b hairline-2" : ""}`}
              >
                <span
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-[16px]"
                  style={ICON_CHIP[m.is_this_unit ? (ha.clustered ? "success" : "neutral") : "info"]}
                  aria-hidden
                >
                  <FiServer />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 flex flex-wrap items-center gap-2 text-[13px] font-semibold ink">
                    {m.hostname || m.serial_number || "unnamed member"}
                    {m.is_this_unit && <span className="badge-soft badge-info">this unit</span>}
                    {m.role && <span className="chip">{m.role}</span>}
                  </p>
                  <p className="m-0 t-meta font-mono">{m.serial_number}</p>
                  <p className="m-0 t-meta" title={formatUptimeLong(m.uptime_sec)}>
                    up {formatUptime(m.uptime_sec)}
                  </p>
                </div>
                <UsageBar label="CPU" pct={m.cpu_usage} />
                <UsageBar label="RAM" pct={m.mem_usage} />
                <div className="w-20 shrink-0 text-right">
                  <p className="t-meta m-0">priority {m.priority}</p>
                  <p className="m-0 mt-0.5 text-[13px] font-semibold tnum ink">
                    {m.sessions > 0 ? m.sessions.toLocaleString() : "—"}
                  </p>
                  <p className="t-meta m-0">sessions</p>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default HAStatusPage;
