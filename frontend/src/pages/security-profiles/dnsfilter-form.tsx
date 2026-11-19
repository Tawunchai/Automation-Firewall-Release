import React, { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiWifi, FiChevronLeft, FiSave, FiHardDrive,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink, FiAlertTriangle,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { Toggle, ToggleRow, avSectionHdr } from "./antivirus-form";
import { SegmentedPills } from "../../components/ui/filter-table";
import { DNSFortiGuardFilter, DNSStaticDomainFilter } from "./dnsfilter-sections";
import { dnsPresetCategories, redirectPortalField } from "./dnsfilter-sections.logic";
import {
  DeviceGetInfo, DeviceGetDNSFilterMetadata, DeviceGetDNSFilterProfile,
  DeviceCreateDNSFilterProfile, DeviceUpdateDNSFilterProfile,
  type DNSFilterProfileForm, type DNSFilterMetadata,
} from "../../api/policyObject";
import { DEFAULT_DNSFILTER_META, EMPTY_DNSFILTER_FORM, validateDNSFilterForm } from "./dnsfilter-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// ─── Defaults for a brand-new profile — matches FortiOS's own blank "New DNS Filter
// Profile" page: everything off except the FortiGuard Category Based Filter, whose grid
// starts with every category on Monitor (seeded once the taxonomy arrives, see below) ────
// Fail-open so a metadata glitch never shows a false "unlicensed" warning.
const labelCls = "block text-[12px] font-medium ink-2 min-w-[300px] shrink-0";
const rowCls = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";
const toggleGridCls = "grid items-center gap-x-3 gap-y-3";
const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };

const YOUTUBE_OPTS: { v: "strict" | "moderate"; l: string }[] = [
  { v: "strict", l: "Strict" }, { v: "moderate", l: "Moderate" },
];

// ─── Reusable form sections — used by both this page and the AI DNS Filter wizard ─────
export type DNSFieldsProps = {
  form: DNSFilterProfileForm;
  set: <K extends keyof DNSFilterProfileForm>(k: K, v: DNSFilterProfileForm[K]) => void;
  meta: DNSFilterMetadata;
  currentColor: string;
  errors?: Record<string, string>;
  isEdit?: boolean;
};

const focusRing = (color: string) => ({
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = color;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${color}20`;
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  },
});

// Section 1 — Basic Setup: name, comments, botnet redirect, safe search (+ YouTube restriction).
export const DNSFieldsBasic: React.FC<DNSFieldsProps> = ({ form, set, meta, currentColor, errors, isEdit }) => {
  const ring = focusRing(currentColor);
  return (
    <div className="space-y-4 px-6 py-5">
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
        <div className="flex-1">
          <input id="name" value={form.name} disabled={isEdit}
            onChange={(e) => set("name", e.target.value)}
            placeholder="e.g. custom-dns-filter"
            className={`${inputCls} w-full ${isEdit ? "surface-sunken cursor-not-allowed" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
            {...ring} />
          {errors?.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
        </div>
      </div>

      <div className={rowCls} style={{ alignItems: "flex-start" }}>
        <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
        <div className="relative flex-1">
          <textarea id="comments" value={form.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
            placeholder="Comments" rows={2}
            className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
            {...ring} />
          <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">
            {form.comment.length}/255
          </span>
        </div>
      </div>

      <div className={toggleGridCls} style={toggleGridStyle}>
        <ToggleRow label="Redirect botnet C&C requests to Block Portal"
          checked={form.redirect_botnet} onChange={(v) => set("redirect_botnet", v)} color={currentColor} />
        <ToggleRow label="Enforce 'Safe Search' on Google, Bing, YouTube"
          checked={form.safe_search} onChange={(v) => set("safe_search", v)} color={currentColor} />
      </div>

      {/* The GUI shows this the moment the botnet toggle goes on, and it is the reason the feature
          does nothing here: the botnet C&C domain package ships with the AntiVirus (AVDB)
          entitlement, which this device does not have. */}
      {form.redirect_botnet && !meta.botnet_licensed && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            <p className="font-semibold">0 domains in botnet package</p>
            <p>Botnet package update unavailable, AntiVirus subscription not found.</p>
          </div>
        </div>
      )}

      {/* Restrict YouTube Access only exists while Safe Search is on — same as the GUI. */}
      {form.safe_search && (
        <div role="group" aria-labelledby="restrict-youtube-access-label" className={rowCls}>
          <span id="restrict-youtube-access-label" className={labelCls}>Restrict YouTube Access</span>
          <div className="flex-1">
            <SegmentedPills label="Restrict YouTube Access" opts={YOUTUBE_OPTS} value={form.youtube_restrict} color={currentColor}
              onChange={(v) => set("youtube_restrict", v)} />
          </div>
        </div>
      )}
    </div>
  );
};

// Section 4 — Options: redirect portal IP, rating-error behaviour, logging.
export const DNSFieldsOptions: React.FC<DNSFieldsProps> = ({ form, set, currentColor, errors }) => {
  const ring = focusRing(currentColor);
  const portal = redirectPortalField(form);
  return (
    <div className="space-y-4 px-6 py-5">
      <div className={rowCls} style={{ alignItems: "flex-start" }}>
        <label htmlFor="redirect-portal-ip" className={`${labelCls} pt-1`}>Redirect Portal IP</label>
        <div className="flex-1 space-y-2">
          <SegmentedPills label="Redirect Portal IP"
            opts={[{ v: "default" as const, l: "Use FortiGuard Default" }, { v: "specify" as const, l: "Specify" }]}
            value={form.use_default_redirect_portal ? "default" : "specify"}
            color={currentColor}
            onChange={(v) => set("use_default_redirect_portal", v === "default")} />
          <input id="redirect-portal-ip"
            value={portal.value}
            disabled={portal.disabled}
            placeholder={portal.placeholder}
            onChange={(e) => set("redirect_portal_ip", e.target.value)}
            className={`${inputCls} w-full ${portal.disabled ? "cursor-not-allowed surface-sunken ink-3" : ""}`}
            {...ring} />
          {errors?.redirect_portal_ip && (
            <p className="text-[11px] text-red-500">{errors.redirect_portal_ip}</p>
          )}
        </div>
      </div>

      <div className={toggleGridCls} style={toggleGridStyle}>
        <ToggleRow label="Allow DNS requests when a rating error occurs"
          checked={form.allow_rating_error} onChange={(v) => set("allow_rating_error", v)} color={currentColor} />
        <ToggleRow label="Log all DNS queries and responses"
          checked={form.log_all_domains} onChange={(v) => set("log_all_domains", v)} color={currentColor} />
      </div>
    </div>
  );
};

// The FortiGuard Category Based Filter section header carries the feature's own master toggle —
// shared so the wizard's step 2 and the page render the same control.
export const DNSCategorySectionHeader: React.FC<DNSFieldsProps> = ({ form, set, currentColor }) => (
  <div className={`${avSectionHdr} flex items-center gap-3`}>
    <Toggle label="FortiGuard category based filter" checked={form.fortiguard_category_filter} color={currentColor}
      onChange={(v) => set("fortiguard_category_filter", v)} />
    FortiGuard Category Based Filter
  </div>
);

// Shared validation — the page and the wizard must reject exactly the same input.
// ─── Right info panel — mirrors the real FortiGate "New DNS Filter Profile" sidebar ───
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
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/577585/dns-filter" },
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

// ─── Main page — handles both Create ("New DNS Filter Profile") and Edit ─────
const DNSFilterFormPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceIdParam = searchParams.get("deviceId");
  const editName = searchParams.get("name");
  const isEdit = !!editName;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(isEdit);
  // An EDIT whose profile could not be read. Blocks the form rather than letting a
  // Save built from blank defaults overwrite it — see ProfileLoadGuard.tsx.
  const [unreadable, setUnreadable] = useState(false);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [form, setForm] = useState<DNSFilterProfileForm>(EMPTY_DNSFILTER_FORM);
  const [meta, setMeta] = useState<DNSFilterMetadata>(DEFAULT_DNSFILTER_META);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // A NEW profile's grid starts on the "Custom" preset (every category Monitor), but the
  // category ids only exist once the device's taxonomy has arrived — so the seed happens on
  // metadata load, exactly once. Without the guard, a later metadata refresh would wipe the
  // user's choices; on an EDIT the device's own categories are the truth and are never seeded.
  const seededRef = useRef(false);

  useEffect(() => {
    if (!deviceIdParam) { setLoadingDev(false); setLoadingProfile(false); setLoadingMeta(false); return; }
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
    const metaP = DeviceGetDNSFilterMetadata(deviceId);
    const profileP = isEdit && editName ? DeviceGetDNSFilterProfile(deviceId, editName) : Promise.resolve(null);
    // Consumed right here, not inside the `found` branch below: this read does not depend on
    // the device being in the list, and a promise that is only sometimes awaited is an
    // uncaught rejection waiting for one of these getters to stop being lenient.
    void metaP
      .then((m) => {
        setMeta(m);
        if (!seededRef.current && !isEdit && m.categories.length > 0) {
          seededRef.current = true;
          setForm((f) => ({ ...f, categories: dnsPresetCategories(m.categories, "custom") }));
        }
      })
      .finally(() => setLoadingMeta(false));

    Promise.all([ListDevices(), infoP, profileP]).then(([list, info, existing]) => {
      const found = list.find((d) => d.id === deviceId) ?? null;
      setDevice(found);
      if (!found) { setLoadingProfile(false); setLoadingMeta(false); return; }

      setHostname(info.hostname || found.name);

      if (isEdit && editName) {
        if (existing) {
          setForm(existing);
          seededRef.current = true; // the device's categories win — never seed over them
        } else {
          setUnreadable(true);
        }
        setLoadingProfile(false);
      }

    }).catch(() => { if (isEdit) setUnreadable(true); })
      .finally(() => setLoadingDev(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const set = <K extends keyof DNSFilterProfileForm>(key: K, value: DNSFilterProfileForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateDNSFilterForm(form);
    if (!device) errs.device = "No device";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});

    try {
      setSaving(true);
      if (isEdit && editName) {
        await DeviceUpdateDNSFilterProfile(device!.id, editName, form);
        message.success(`DNS Filter profile "${form.name}" updated on ${hostname || device!.name}`);
      } else {
        await DeviceCreateDNSFilterProfile(device!.id, form);
        message.success(`DNS Filter profile "${form.name}" created on ${hostname || device!.name}`);
      }
      navigate(`/admin/security-profiles/dnsfilter?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} DNS Filter profile`));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps: DNSFieldsProps = { form, set, meta, currentColor, errors, isEdit };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="DNS Filter profile" name={editName} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading profile…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiWifi />}
        title={isEdit ? `Edit DNS Filter Profile — ${editName}` : "New DNS Filter Profile"}
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

          {/* Left card — the same four sections the AI DNS Filter wizard walks through */}
          <div className="overflow-hidden rounded-sm border hairline surface-card shadow-sm">
            <DNSFieldsBasic {...fieldsProps} />

            <DNSCategorySectionHeader {...fieldsProps} />
            {form.fortiguard_category_filter && (
              <DNSFortiGuardFilter form={form} set={set} meta={meta}
                currentColor={currentColor} loadingMeta={loadingMeta} />
            )}

            <div className={avSectionHdr}>Static Domain Filter</div>
            <DNSStaticDomainFilter form={form} set={set} meta={meta} currentColor={currentColor} />

            <div className={avSectionHdr}>Options</div>
            <DNSFieldsOptions {...fieldsProps} />
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

export default DNSFilterFormPage;
