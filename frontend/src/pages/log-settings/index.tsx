import React, { useCallback, useEffect, useState } from "react";
import {
  FiFileText, FiAlertTriangle, FiRefreshCw, FiInfo, FiSave, FiHardDrive, FiServer, FiCpu, FiCloud,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import { apiErrorText } from "../../api/errorText";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { ErrorState, LoadingState, NoDeviceState } from "../../components/ui/StateBlock";
import MinimalSelect from "../../components/ui/MinimalSelect";
import {
  DeviceGetLogSettings, DeviceUpdateLogSettings, type LogSettings,
} from "../../api/systemSettings";
import {
  EVENT_HELP, FAZ_UPLOAD_OPTIONS, SYSLOG_FACILITIES, SYSLOG_FORMATS, SYSLOG_MODES,
  describeDestinations, diskOnWithoutADisk, draftFrom, enabledButUnconfigured,
  patchFor, validateSection,
  type LogDraft, type LogSection,
} from "./model";

// Log & Report ▸ Log Settings — what this firewall records, and where it puts it.
//
// Five single-object tables on the device, one page here, and each section saves on its own. That
// is not a convenience: each section is a separate PUT, and a unit with no log disk refuses the
// disk one. Submitting everything together would make every save depend on the section that cannot
// succeed.
//
// The page leads with two things the device never says:
//
//   · a destination can be switched on with no server and is then sending nowhere
//   · "on" on a unit with no log disk is stored and does nothing
//
// Each is computed rather than assumed — see ./model.ts.

/** A switch, not a checkbox — matches the convention already used on the other security-profile forms. */
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color: string; label: string; disabled?: boolean }> =
  ({ checked, onChange, color, label, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-5 w-10 shrink-0 rounded-full border-0 p-0 transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{ backgroundColor: checked ? (disabled ? "#94a3b8" : color) : "var(--shell-sunken-2, #cbd5e1)", opacity: disabled ? 0.6 : 1 }}>
      <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );

const tint = (hex: string) => ({ color: hex, background: `color-mix(in srgb, ${hex} 14%, transparent)` });

const SectionCard: React.FC<{
  title: string;
  icon: React.ReactNode;
  tintColor: string;
  subtitle?: string;
  badge?: React.ReactNode;
  canSave: boolean;
  saving: boolean;
  onSave: () => void;
  children: React.ReactNode;
}> = ({ title, icon, tintColor, subtitle, badge, canSave, saving, onSave, children }) => (
  <div className="shell-card p-0! overflow-hidden">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b hairline-2 px-4 py-3">
      <div className="flex items-center gap-2.5">
        <span className="medallion h-8 w-8 text-[14px]" style={tint(tintColor)}>{icon}</span>
        <div>
          <span className="t-card m-0 flex items-center gap-2 font-semibold">{title}{badge}</span>
          {subtitle && <p className="t-meta m-0 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {canSave && (
        <button className="btn btn-accent btn-sm" onClick={onSave} disabled={saving}>
          <FiSave size={13} className={saving ? "animate-pulse" : ""} /> {saving ? "Saving…" : "Save"}
        </button>
      )}
    </div>
    <div className="space-y-3 px-4 py-4">{children}</div>
  </div>
);

/** One tile in the "where the logs go" strip. */
const DestinationTile: React.FC<{ icon: React.ReactNode; label: string; active: boolean; detail?: string }> = ({
  icon, label, active, detail,
}) => (
  <div className={`flex items-center gap-2.5 rounded-[5px] border hairline-2 px-3 py-2.5 ${active ? "surface-card" : "surface-sunken"}`}>
    <span className="medallion h-8 w-8 text-[13px]" style={active ? tint("#1e9e6b") : tint("#757f79")}>{icon}</span>
    <div className="min-w-0 flex-1">
      <p className="t-meta m-0">{label}</p>
      <p className="m-0 truncate text-[12.5px] font-semibold ink">{active ? (detail || "Active") : "Off"}</p>
    </div>
    <span className={`badge-soft shrink-0 ${active ? "badge-success" : "badge-neutral"}`}>{active ? "On" : "Off"}</span>
  </div>
);

const LogSettingsPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { isAdmin } = useAuth();
  const { device } = useSelectedDevice();

  const [settings, setSettings] = useState<LogSettings | null>(null);
  const [draft, setDraft] = useState<LogDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<LogSection | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async (deviceId: number) => {
    setLoading(true);
    setError(null);
    try {
      const s = await DeviceGetLogSettings(deviceId);
      setSettings(s);
      setDraft(draftFrom(s));
    } catch (e: unknown) {
      setSettings(null);
      setDraft(null);
      setError(apiErrorText(e, "the log settings could not be read"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!device) return;
    void load(device.id);
  }, [device, load]);

  const save = async (section: LogSection) => {
    if (!device || !draft) return;
    const problem = validateSection(draft, section);
    if (problem) { setFormError(problem); return; }
    setSaving(section);
    setFormError(null);
    try {
      await DeviceUpdateLogSettings(device.id, patchFor(draft, section));
      message.success(`Log settings saved on ${device.name}`);
      await load(device.id);
    } catch (e: unknown) {
      setFormError(apiErrorText(e, "the device refused the change"));
    } finally {
      setSaving(null);
    }
  };

  if (!device) return <NoDeviceState />;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass. The hero's chip (where the logs go) is not lost, just not repeated here —
          the panel right below already says it; Refresh moved into that panel's own header. */}
      {loading ? (
        <div className="panel"><LoadingState what="log setting" from={device.name} /></div>
      ) : error || !settings || !draft ? (
        <div className="panel">
          <ErrorState
            title={`Could not read the log settings from ${device.name}`}
            detail={error ?? "the device did not answer"}
            note="Logging may well be configured — this is 'unreadable', not 'off'"
            onRetry={() => void load(device.id)}
          />
        </div>
      ) : (
        <>
          {formError && (
            <div className="banner banner-danger">
              <FiAlertTriangle size={14} className="shrink-0" /><span>{formError}</span>
            </div>
          )}

          {/* ── Where the logs go ───────────────────────────────────────────── */}
          <div className="shell-card p-4">
            <div className="mb-3 flex items-start justify-between gap-2">
              <div>
                <p className="t-label m-0">Where the logs go</p>
                <p className="t-meta m-0 mt-0.5">{describeDestinations(settings)}</p>
              </div>
              <button className="btn btn-soft btn-sm" onClick={() => void load(device.id)} disabled={loading}>
                <FiRefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
              <DestinationTile icon={<FiCpu size={14} />} label="Memory"
                active={settings.memory.enabled} />
              <DestinationTile icon={<FiHardDrive size={14} />} label="Local disk"
                active={settings.disk.enabled && settings.disk_available} />
              <DestinationTile icon={<FiServer size={14} />} label="Syslog"
                active={settings.syslog.enabled && settings.syslog.configured} detail={settings.syslog.server} />
              <DestinationTile icon={<FiCloud size={14} />} label="FortiAnalyzer"
                active={settings.fortianalyzer.enabled && settings.fortianalyzer.configured} detail={settings.fortianalyzer.server} />
            </div>
          </div>

          {enabledButUnconfigured(settings).map((d) => (
            <div className="banner banner-warn" key={d}>
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>{d} is switched on with no server address, so it is sending nothing.</span>
            </div>
          ))}

          {diskOnWithoutADisk(settings) && (
            <div className="banner banner-warn">
              <FiAlertTriangle size={14} className="shrink-0" />
              <span>
                {`Disk logging is switched on, but this model reports no log disk (${settings.disk_status || "unknown"}). The setting is stored and does nothing.`}
              </span>
            </div>
          )}

          {/* ── What gets logged ─────────────────────────────────────────── */}
          <SectionCard
            title="What gets logged"
            subtitle="Which events produce a log line at all"
            icon={<FiFileText size={14} />}
            tintColor="#3e7ead"
            canSave={isAdmin}
            saving={saving === "events"}
            onSave={() => void save("events")}
          >
            <div className="grid gap-2 md:grid-cols-2">
              {EVENT_HELP.map((e) => (
                <div key={e.key}
                  className="flex items-start justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block text-[12.5px] font-semibold ink">{e.label}</span>
                    <span className="block t-meta mt-0.5">{e.help}</span>
                  </span>
                  <Toggle
                    label={e.label}
                    checked={draft.events[e.key]}
                    disabled={!isAdmin}
                    color={currentColor}
                    onChange={(v) => setDraft({ ...draft, events: { ...draft.events, [e.key]: v } })}
                  />
                </div>
              ))}
            </div>
          </SectionCard>

          {/* ── Memory ───────────────────────────────────────────────────── */}
          <SectionCard
            title="Memory buffer"
            subtitle="Cleared on reboot — every unit has one"
            icon={<FiCpu size={14} />}
            tintColor="#757f79"
            canSave={isAdmin}
            saving={saving === "memory"}
            onSave={() => void save("memory")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3.5 py-3">
              <span className="text-[13px] font-medium ink">Log to memory</span>
              <Toggle label="Log to memory" checked={draft.memory} disabled={!isAdmin} color={currentColor}
                onChange={(v) => setDraft({ ...draft, memory: v })} />
            </div>
          </SectionCard>

          {/* ── Disk ─────────────────────────────────────────────────────── */}
          <SectionCard
            title="Local disk"
            subtitle={settings.disk_available ? "Survives a reboot" : "This model has no log disk"}
            icon={<FiHardDrive size={14} />}
            tintColor={settings.disk_available ? "#1e9e6b" : "#757f79"}
            badge={
              <span className={`badge-soft ${settings.disk_available ? "badge-success" : "badge-neutral"}`}>
                {settings.disk_available ? "Available" : "Not available"}
              </span>
            }
            canSave={isAdmin && settings.disk_available}
            saving={saving === "disk"}
            onSave={() => void save("disk")}
          >
            {!settings.disk_available ? (
              <p className="t-meta m-0">
                {`The unit reports ${settings.disk_status || "no disk"}. FortiOS still accepts a disk-logging setting on a unit like this and stores it, so the values below are shown as they are on the device — they are not doing anything.`}
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex items-center justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3.5 py-3 md:col-span-2">
                  <span className="text-[13px] font-medium ink">Log to disk</span>
                  <Toggle label="Log to disk" checked={draft.disk.enabled} disabled={!isAdmin} color={currentColor}
                    onChange={(v) => setDraft({ ...draft, disk: { ...draft.disk, enabled: v } })} />
                </div>
                <div>
                  <label htmlFor="ld-age" className="field-label">Keep logs for (days)</label>
                  <input
                    id="ld-age"
                    type="number"
                    className="shell-input"
                    value={draft.disk.maximum_log_age_days}
                    disabled={!isAdmin}
                    onChange={(e) =>
                      setDraft({ ...draft, disk: { ...draft.disk, maximum_log_age_days: Number(e.target.value) } })
                    }
                  />
                </div>
              </div>
            )}
          </SectionCard>

          {/* ── Syslog ───────────────────────────────────────────────────── */}
          <SectionCard
            title="Syslog"
            subtitle="A collector somewhere else — the usual way logs outlive the firewall"
            icon={<FiServer size={14} />}
            tintColor="#dc9a2c"
            badge={
              draft.syslog.enabled ? (
                <span className={`badge-soft ${settings.syslog.configured ? "badge-success" : "badge-warning"}`}>
                  {settings.syslog.configured ? "Configured" : "Needs a server"}
                </span>
              ) : undefined
            }
            canSave={isAdmin}
            saving={saving === "syslog"}
            onSave={() => void save("syslog")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3.5 py-3">
              <span className="text-[13px] font-medium ink">Send logs to syslog</span>
              <Toggle label="Send logs to syslog" checked={draft.syslog.enabled} disabled={!isAdmin} color={currentColor}
                onChange={(v) => setDraft({ ...draft, syslog: { ...draft.syslog, enabled: v } })} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="sl-server" className="field-label">Server</label>
                <input
                  id="sl-server"
                  className="shell-input font-mono"
                  placeholder="10.0.0.5"
                  value={draft.syslog.server}
                  disabled={!isAdmin}
                  onChange={(e) => setDraft({ ...draft, syslog: { ...draft.syslog, server: e.target.value } })}
                />
              </div>
              <div>
                <label htmlFor="sl-port" className="field-label">Port</label>
                <input
                  id="sl-port"
                  type="number"
                  className="shell-input"
                  value={draft.syslog.port}
                  disabled={!isAdmin}
                  onChange={(e) => setDraft({ ...draft, syslog: { ...draft.syslog, port: Number(e.target.value) } })}
                />
              </div>
              <div>
                <label htmlFor="sl-mode" className="field-label">Transport</label>
                <MinimalSelect
                  id="sl-mode"
                  ariaLabel="Transport"
                  className="w-full"
                  value={draft.syslog.mode}
                  disabled={!isAdmin}
                  onChange={(v) => setDraft({ ...draft, syslog: { ...draft.syslog, mode: v } })}
                  options={SYSLOG_MODES.map((m) => ({ value: m.value, label: m.label }))}
                />
                <p className="t-meta m-0 mt-1">UDP loses entries silently under load.</p>
              </div>
              <div>
                <label htmlFor="sl-format" className="field-label">Format</label>
                <MinimalSelect
                  id="sl-format"
                  ariaLabel="Format"
                  className="w-full"
                  value={draft.syslog.format}
                  disabled={!isAdmin}
                  onChange={(v) => setDraft({ ...draft, syslog: { ...draft.syslog, format: v } })}
                  options={SYSLOG_FORMATS.map((f) => ({ value: f.value, label: f.label }))}
                />
              </div>
              <div>
                <label htmlFor="sl-facility" className="field-label">Facility</label>
                <MinimalSelect
                  id="sl-facility"
                  ariaLabel="Facility"
                  className="w-full"
                  value={draft.syslog.facility}
                  disabled={!isAdmin}
                  onChange={(v) => setDraft({ ...draft, syslog: { ...draft.syslog, facility: v } })}
                  options={SYSLOG_FACILITIES.map((f) => ({ value: f, label: f }))}
                />
              </div>
            </div>
          </SectionCard>

          {/* ── FortiAnalyzer ────────────────────────────────────────────── */}
          <SectionCard
            title="FortiAnalyzer"
            subtitle="Fortinet's own log collector"
            icon={<FiCloud size={14} />}
            tintColor={currentColor}
            badge={
              draft.fortianalyzer.enabled ? (
                <span className={`badge-soft ${settings.fortianalyzer.configured ? "badge-success" : "badge-warning"}`}>
                  {settings.fortianalyzer.configured ? "Configured" : "Needs a server"}
                </span>
              ) : undefined
            }
            canSave={isAdmin}
            saving={saving === "fortianalyzer"}
            onSave={() => void save("fortianalyzer")}
          >
            <div className="flex items-center justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3.5 py-3">
              <span className="text-[13px] font-medium ink">Send logs to FortiAnalyzer</span>
              <Toggle label="Send logs to FortiAnalyzer" checked={draft.fortianalyzer.enabled} disabled={!isAdmin} color={currentColor}
                onChange={(v) => setDraft({ ...draft, fortianalyzer: { ...draft.fortianalyzer, enabled: v } })} />
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <label htmlFor="faz-server" className="field-label">Server</label>
                <input
                  id="faz-server"
                  className="shell-input font-mono"
                  value={draft.fortianalyzer.server}
                  disabled={!isAdmin}
                  onChange={(e) =>
                    setDraft({ ...draft, fortianalyzer: { ...draft.fortianalyzer, server: e.target.value } })
                  }
                />
              </div>
              <div>
                <label htmlFor="faz-upload" className="field-label">How often</label>
                <MinimalSelect
                  id="faz-upload"
                  ariaLabel="How often"
                  className="w-full"
                  value={draft.fortianalyzer.upload_option}
                  disabled={!isAdmin}
                  onChange={(v) =>
                    setDraft({ ...draft, fortianalyzer: { ...draft.fortianalyzer, upload_option: v } })
                  }
                  options={FAZ_UPLOAD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </div>
              <div className="flex items-center justify-between gap-3 rounded-[5px] border hairline-2 surface-sunken px-3.5 py-3 md:col-span-2">
                <span className="text-[13px] font-medium ink">Reliable transport</span>
                <Toggle label="Reliable transport" checked={draft.fortianalyzer.reliable} disabled={!isAdmin} color={currentColor}
                  onChange={(v) => setDraft({ ...draft, fortianalyzer: { ...draft.fortianalyzer, reliable: v } })} />
              </div>
            </div>
          </SectionCard>

          <div className="banner banner-accent">
            <FiInfo size={14} className="shrink-0" />
            <span>
              Each section saves on its own. On the device they are five separate settings tables,
              and one of them refusing a change should not undo the others.
            </span>
          </div>
        </>
      )}
    </div>
  );
};

export default LogSettingsPage;
