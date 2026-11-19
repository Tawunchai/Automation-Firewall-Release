import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiShield, FiChevronLeft, FiSave, FiHardDrive,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink, FiAlertTriangle, FiAlertCircle, FiInfo,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import {
  DeviceGetInfo, DeviceGetSecurityProfile, DeviceCreateSecurityProfile, DeviceUpdateSecurityProfile,
  DeviceGetAVCapabilities,
  type AVProfileForm, type AVCapabilities,
} from "../../api/policyObject";
import { DEFAULT_AV_CAPS, EMPTY_AV_FORM, computeAVGating, seedAntivirusScanOn } from "./antivirus-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// ─── Defaults for a brand-new profile — matches FortiOS's own blank "New AntiVirus
// Profile" page (everything off except "Include mobile malware protection") ────────
// Defaults fail-open so a capabilities probe glitch never wrongly greys a toggle.
// ─── Field styling — matches fw-services create/edit pages ───────────────────
const labelCls = "block text-[12px] font-medium ink-2 min-w-[300px] shrink-0";
const rowCls   = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";

// A CSS Grid with grid-template-columns: max-content max-content auto — three columns:
// label | icon cluster | toggle. Column widths auto-size to the widest cell rendered as
// a direct child of THIS grid (native browser layout, not a guessed pixel width), so the
// toggles in a section line up regardless of which rows carry an (i)/warning icon.
const toggleGridCls = "grid items-center gap-x-3 gap-y-3";
const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const sectionBodyCls = "px-6 py-5";
export const avSectionHdr = "px-5 py-2.5 text-[11px] font-semibold ink-2 surface-sunken border-b border-t hairline";

// A switch, not a clickable box. `label` is required rather than optional: a toggle with no
// accessible name is announced as "switch, checked" and nothing else, and the only reliable way to
// stop that happening again is to make the compiler ask for the name.
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; color: string; label: string; disabled?: boolean }> =
  ({ checked, onChange, color, label, disabled }) => (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative h-5 w-10 shrink-0 rounded-full border-0 p-0 transition-colors ${disabled ? "cursor-not-allowed" : "cursor-pointer"}`}
      style={{ backgroundColor: checked ? (disabled ? "#94a3b8" : color) : "#cbd5e1", opacity: disabled ? 0.6 : 1 }}>
      <span className={`absolute top-0.5 block h-4 w-4 rounded-full surface-card shadow transition-transform ${checked ? "translate-x-5" : "translate-x-0.5"}`} />
    </button>
  );

// Renders as THREE grid cells (label, icons, toggle) — must be used as a direct child of
// an element with toggleGridCls, never wrapped in its own div, or the column alignment breaks.
export const ToggleRow: React.FC<{
  label: string; checked: boolean; onChange: (v: boolean) => void; color: string;
  warn?: boolean; info?: string; disabled?: boolean;
}> = ({ label, checked, onChange, color, warn, info, disabled }) => (
  <>
    <span className="text-[12px] font-medium ink-2 whitespace-nowrap">
      {label}
    </span>
    <div className="flex items-center gap-1">
      {info && (
        <FiInfo size={12} className="shrink-0 cursor-help ink-3" title={info} />
      )}
      {warn && <FiAlertTriangle size={11} className="shrink-0 text-amber-500" />}
    </div>
    <Toggle label={label} checked={checked} onChange={onChange} color={color} disabled={disabled} />
  </>
);

// ─── Shared gating logic — identical rules on the full page and the AI wizard ─────
// "AntiVirus scan" is an independent master switch on the real FortiGate GUI. APT Protection
// Options / Virus Outbreak Prevention require it ON plus ≥1 protocol inspected. On top of
// that, two toggles are gated by device capability (confirmed against a live FortiGate 7.2.10):
//   - "Send files to FortiSandbox" → needs a FortiSandbox connector configured
//   - "Use FortiGuard outbreak prevention database" → needs an active FortiGuard AV subscription
// ─── Reusable form sections — used by both the full create/edit page and the AI wizard ───
export type AVFieldsProps = {
  form: AVProfileForm;
  set: <K extends keyof AVProfileForm>(k: K, v: AVProfileForm[K]) => void;
  antivirusScanOn: boolean;
  setAntivirusScanOn: (v: boolean) => void;
  caps: AVCapabilities;
  currentColor: string;
  errors?: Record<string, string>;
  isEdit?: boolean;
};

// Section 1 — Basic Setup: name, comments, master "AntiVirus scan" toggle.
export const AVFieldsBasic: React.FC<AVFieldsProps> = ({ form, set, antivirusScanOn, setAntivirusScanOn, currentColor, errors, isEdit }) => {
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };
  return (
    <div className="space-y-4 px-6 py-5">
      {/* Name */}
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
        <div className="flex-1">
          <input id="name" value={form.name} disabled={isEdit}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. custom-av-profile"
            className={`${inputCls} w-full ${isEdit ? "surface-sunken cursor-not-allowed" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
            onFocus={focus} onBlur={blur} />
          {errors?.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
        </div>
      </div>

      {/* Comments */}
      <div className={rowCls} style={{ alignItems: "flex-start" }}>
        <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
        <div className="relative flex-1">
          <textarea id="comments" value={form.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
            placeholder="Write a comment…" rows={2}
            className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
            onFocus={focus} onBlur={blur} />
          <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">
            {form.comment.length}/255
          </span>
        </div>
      </div>

      {/* Master AntiVirus scan toggle — independent, does not touch protocol toggles */}
      <div className={toggleGridCls} style={toggleGridStyle}>
        <ToggleRow label="AntiVirus scan" checked={antivirusScanOn} onChange={setAntivirusScanOn} color={currentColor} />
      </div>
    </div>
  );
};

// Section 2 — Inspected Protocols.
export const AVFieldsProtocols: React.FC<AVFieldsProps> = ({ form, set, antivirusScanOn, caps, currentColor }) => {
  const g = computeAVGating(form, antivirusScanOn, caps);
  return (
    <>
      <div className={avSectionHdr}>Inspected Protocols</div>
      <div className={sectionBodyCls}>
        {g.showScanOffWarning && (
          <div className="mb-3 flex items-center gap-2 rounded-[4px] bg-red-50 dark:bg-red-500/10 px-4 py-2.5 text-[12px] font-medium text-red-600 dark:text-red-400">
            <FiAlertCircle size={14} className="shrink-0" />
            No scan options set for any of the inspected protocols.
          </div>
        )}
        <div className={toggleGridCls} style={toggleGridStyle}>
          <ToggleRow label="HTTP" checked={form.http_scan} onChange={(v) => set("http_scan", v)} color={currentColor} />
          <ToggleRow label="SMTP" checked={form.smtp_scan} onChange={(v) => set("smtp_scan", v)} color={currentColor} />
          <ToggleRow label="POP3" checked={form.pop3_scan} onChange={(v) => set("pop3_scan", v)} color={currentColor} />
          <ToggleRow label="IMAP" checked={form.imap_scan} onChange={(v) => set("imap_scan", v)} color={currentColor} />
          <ToggleRow label="FTP"  checked={form.ftp_scan}  onChange={(v) => set("ftp_scan", v)}  color={currentColor} />
          <ToggleRow label="CIFS" checked={form.cifs_scan} onChange={(v) => set("cifs_scan", v)} color={currentColor} />
        </div>
      </div>
    </>
  );
};

// Section 3 — APT Protection Options.
export const AVFieldsAPT: React.FC<AVFieldsProps> = ({ form, set, antivirusScanOn, caps, currentColor }) => {
  const g = computeAVGating(form, antivirusScanOn, caps);
  return (
    <>
      <div className={avSectionHdr}>APT Protection Options</div>
      <div className={sectionBodyCls}>
        <div className={toggleGridCls} style={toggleGridStyle}>
          <ToggleRow label="Treat Windows executables in email attachments as viruses"
            checked={form.treat_win_exec_as_virus} onChange={(v) => set("treat_win_exec_as_virus", v)} color={currentColor}
            info={g.scanFeatureGateReason} disabled={!g.scanFeatureGateOn} />
          <ToggleRow label="Send files to FortiSandbox for inspection" warn
            checked={form.send_files_to_sandbox} onChange={(v) => set("send_files_to_sandbox", v)} color={currentColor}
            info={g.sandboxReason} disabled={g.sandboxDisabled} />
          <ToggleRow label="Include mobile malware protection"
            checked={form.mobile_malware_protection} onChange={(v) => set("mobile_malware_protection", v)} color={currentColor} />
          <ToggleRow label="Quarantine"
            checked={form.quarantine} onChange={(v) => set("quarantine", v)} color={currentColor}
            info={g.scanFeatureGateReason} disabled={!g.scanFeatureGateOn} />
        </div>
      </div>
    </>
  );
};

// Section 4 — Virus Outbreak Prevention.
export const AVFieldsOutbreak: React.FC<AVFieldsProps> = ({ form, set, antivirusScanOn, caps, currentColor }) => {
  const g = computeAVGating(form, antivirusScanOn, caps);
  return (
    <>
      <div className={`${avSectionHdr} flex items-center gap-1.5`}>
        Virus Outbreak Prevention
        <FiInfo size={12} className="cursor-help ink-3"
          title={"Use FortiGuard outbreak prevention database, external malware block list, or EMS threat feed to preempt outbreaks before AV signatures are created.\n\n" + g.scanFeatureGateReason} />
      </div>
      <div className={sectionBodyCls}>
        <div className={toggleGridCls} style={toggleGridStyle}>
          <ToggleRow label="Use FortiGuard outbreak prevention database" warn
            checked={form.use_outbreak_db} onChange={(v) => set("use_outbreak_db", v)} color={currentColor}
            info={g.outbreakReason} disabled={g.outbreakDisabled} />
          <ToggleRow label="Use external malware block list"
            checked={form.use_external_blocklist} onChange={(v) => set("use_external_blocklist", v)} color={currentColor}
            info={g.scanFeatureGateReason} disabled={!g.scanFeatureGateOn} />
          <ToggleRow label="Use EMS threat feed"
            checked={form.use_ems_threat_feed} onChange={(v) => set("use_ems_threat_feed", v)} color={currentColor}
            info={g.scanFeatureGateReason} disabled={!g.scanFeatureGateOn} />
        </div>
      </div>
    </>
  );
};

// Seed the master "AntiVirus scan" switch for an existing profile — the real device doesn't
// return this independent flag, so we best-guess it from whether any protocol is being scanned.
// ─── Right info panel — mirrors the real FortiGate "New AntiVirus Profile" sidebar ───
const InfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string }> =
  ({ device, hostname, currentColor }) => (
    <div className="space-y-3">
      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
        </div>
        <div className="flex items-center gap-2.5 px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
            style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
            <FiHardDrive size={12} />
          </div>
          <div>
            <p className="text-[13px] font-semibold ink">{hostname || (device?.name ?? "—")}</p>
            {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
          </div>
        </div>
      </div>

      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
        </div>
        <div className="px-4 py-2 space-y-0.5">
          {[
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/952490/antivirus" },
            { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
          ].map(({ icon, label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors"
              style={{ color: currentColor }}>
              {icon} {label} <FiExternalLink size={10} className="ml-auto opacity-60" />
            </a>
          ))}
        </div>
      </div>

      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Fortinet Community</p>
        </div>
        <div className="px-4 py-2">
          <a href="https://community.fortinet.com/" target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors"
            style={{ color: currentColor }}>
            <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
          </a>
        </div>
      </div>
    </div>
  );

// ─── Main page — handles both Create ("New AntiVirus Profile") and Edit ─────
const AntiVirusFormPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceIdParam = searchParams.get("deviceId");
  const editName = searchParams.get("name");
  const isEdit = !!editName;

  const [device, setDevice]             = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]         = useState("");
  const [loadingDev, setLoadingDev]     = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(isEdit);
  // An EDIT whose profile could not be read. Blocks the form rather than letting a
  // Save built from blank defaults overwrite it — see ProfileLoadGuard.tsx.
  const [unreadable, setUnreadable] = useState(false);

  const [form, setForm]     = useState<AVProfileForm>(EMPTY_AV_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [antivirusScanOn, setAntivirusScanOn] = useState(false);
  const [caps, setCaps] = useState<AVCapabilities>(DEFAULT_AV_CAPS);

  useEffect(() => {
    if (!deviceIdParam) { setLoadingDev(false); setLoadingProfile(false); return; }
    // Everything this page needs, started TOGETHER.
    //
    // It used to be a waterfall: ListDevices, then — once that answered — DeviceGetInfo, then, once
    // THAT answered, the profile. Three round trips end to end, each waiting on the one before, for
    // three calls that share a single input. The device id is already in the query string, so none
    // of them ever needed `found.id`: `found` only decides what renders.
    //
    // The metadata is deliberately NOT awaited with the rest. It is the big read on several of
    // these forms and the form is usable without it, so it starts early and lands when it lands.
    const deviceId = Number(deviceIdParam);
    const infoP = DeviceGetInfo(deviceId);
    const capsP = DeviceGetAVCapabilities(deviceId);
    const profileP = isEdit && editName ? DeviceGetSecurityProfile(deviceId, "antivirus", editName) : Promise.resolve(null);
    // Consumed right here, not inside the `found` branch below: this read does not depend on
    // the device being in the list, and a promise that is only sometimes awaited is an
    // uncaught rejection waiting for one of these getters to stop being lenient.
    void capsP.then(setCaps);

    Promise.all([ListDevices(), infoP, profileP]).then(([list, info, existing]) => {
      const found = list.find((d) => d.id === deviceId) ?? null;
      setDevice(found);
      if (found) {
        setHostname(info.hostname || found.name);
        if (isEdit && editName) {
          if (existing) {
            setForm(existing);
            setAntivirusScanOn(seedAntivirusScanOn(existing));
          } else {
          setUnreadable(true);
        }
          setLoadingProfile(false);
        }
      } else {
        setLoadingProfile(false);
      }
    }).catch(() => { if (isEdit) setUnreadable(true); })
      .finally(() => setLoadingDev(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const set = <K extends keyof AVProfileForm>(key: K, value: AVProfileForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (!device) errs.device = "No device";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    try {
      setSaving(true);
      if (isEdit && editName) {
        await DeviceUpdateSecurityProfile(device!.id, "antivirus", editName, form);
        message.success(`AntiVirus profile "${form.name}" updated on ${hostname || device!.name}`);
      } else {
        await DeviceCreateSecurityProfile(device!.id, "antivirus", form);
        message.success(`AntiVirus profile "${form.name}" created on ${hostname || device!.name}`);
      }
      navigate(`/admin/security-profiles/antivirus?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} AntiVirus profile`));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps: AVFieldsProps = {
    form, set, antivirusScanOn, setAntivirusScanOn, caps, currentColor, errors, isEdit,
  };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="AntiVirus profile" name={editName} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading profile…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiShield />}
        title={isEdit ? `Edit AntiVirus Profile — ${editName}` : "New AntiVirus Profile"}
        accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[5px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="rounded-[5px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>

          {/* Left card */}
          <div className="overflow-hidden rounded-sm border hairline surface-card shadow-sm">
            <AVFieldsBasic {...fieldsProps} />
            <AVFieldsProtocols {...fieldsProps} />
            <AVFieldsAPT {...fieldsProps} />
            <AVFieldsOutbreak {...fieldsProps} />
          </div>

          {/* Right panel */}
          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} />
        </div>

        {/* Footer */}
        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[5px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[5px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>
    </div>
  );
};

export default AntiVirusFormPage;
