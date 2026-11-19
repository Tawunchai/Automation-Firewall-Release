import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiGlobe, FiChevronLeft, FiSave, FiHardDrive,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo } from "../../api/policyObject";
import { DeviceGetWebFilterProfile, DeviceCreateWebFilterProfile, DeviceUpdateWebFilterProfile, DeviceGetWebFilterMetadata, type WebFilterProfileForm, type WebFilterMetadata, type WebFilterCategoryAction } from "../../api/policyObject";
// Reuse the exact toggle primitives + section-header styling from the AntiVirus form so the
// two Security-Profile create/edit pages stay visually identical.
import { ToggleRow, avSectionHdr } from "./antivirus-form";
import { WFFortiGuardFilter, WFOverridePanel } from "./webfilter-fortiguard";
import { WFStaticURLFilter } from "./webfilter-staticurl";
import { EMPTY_WEBFILTER_FORM, EMPTY_WEBFILTER_METADATA } from "./webfilter-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// ─── Defaults for a brand-new profile — matches FortiOS's own blank "New Web Filter
// Profile" page (everything off; HTTP POST Action defaults to Allow) ─────────────────
const labelCls = "block text-[12px] font-medium ink-2 min-w-[300px] shrink-0";
const rowCls   = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";
const toggleGridCls = "grid items-center gap-x-3 gap-y-3";
const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const sectionBodyCls = "px-6 py-5";

const FORTIGUARD_GATE_REASON = "Requires FortiGuard Category Based Filter to be enabled.";

// ─── Reusable form sections — split so the AI Web Filter wizard can reuse them later,
// mirroring how the AntiVirus form is structured. ─────────────────────────────────────
export type WFFieldsProps = {
  form: WebFilterProfileForm;
  set: <K extends keyof WebFilterProfileForm>(k: K, v: WebFilterProfileForm[K]) => void;
  currentColor: string;
  errors?: Record<string, string>;
  isEdit?: boolean;
};

// Section 1 — Basic setup (Name + Comments). The FortiGuard master toggle, category tree and
// override sub-form are rendered by the page so sections can appear between the toggles.
export const WFFieldsBasic: React.FC<WFFieldsProps> = ({ form, set, currentColor, errors, isEdit }) => {
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
            placeholder="e.g. corp-web-filter"
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

    </div>
  );
};

// Section 3 — Rating Options (FortiGuard rating behaviour).
export const WFFieldsRating: React.FC<WFFieldsProps> = ({ form, set, currentColor }) => {
  const gated = !form.fortiguard_category_filter;
  return (
    <>
      <div className={avSectionHdr}>Rating Options</div>
      <div className={sectionBodyCls}>
        <div className={toggleGridCls} style={toggleGridStyle}>
          <ToggleRow label="Allow websites when a rating error occurs"
            checked={form.allow_rating_error} onChange={(v) => set("allow_rating_error", v)} color={currentColor}
            disabled={gated} info={FORTIGUARD_GATE_REASON} />
          <ToggleRow label="Rate URLs by domain and IP Address"
            checked={form.rate_by_domain_and_ip} onChange={(v) => set("rate_by_domain_and_ip", v)} color={currentColor}
            disabled={gated} info={FORTIGUARD_GATE_REASON} />
        </div>
      </div>
    </>
  );
};

// Section 4 — Proxy Options (HTTP POST Action + Remove Cookies).
export const WFFieldsProxy: React.FC<WFFieldsProps> = ({ form, set, currentColor }) => (
  <>
    <div className={avSectionHdr}>Proxy Options</div>
    <div className={sectionBodyCls}>
      <div role="group" aria-labelledby="http-post-action-label" className="flex items-center gap-3 mb-4">
        <span id="http-post-action-label" className="text-[12px] font-medium ink-2 whitespace-nowrap">
          HTTP POST Action
        </span>
        <div className="inline-flex overflow-hidden rounded-[4px] border hairline">
          {(["allow", "block"] as const).map((opt) => {
            const active = form.http_post_action === opt;
            return (
              <button key={opt} type="button" onClick={() => set("http_post_action", opt)}
                className={`px-4 py-1 text-[12px] font-semibold capitalize transition-colors ${active ? "text-white" : "ink-2 surface-hover"}`}
                style={active ? { backgroundColor: currentColor } : undefined}>
                {opt}
              </button>
            );
          })}
        </div>
      </div>
      <div className={toggleGridCls} style={toggleGridStyle}>
        <ToggleRow label="Remove Cookies"
          checked={form.remove_cookies} onChange={(v) => set("remove_cookies", v)} color={currentColor} />
      </div>
    </div>
  </>
);

// ─── Right info panel — mirrors the real FortiGate "New Web Filter Profile" sidebar ───
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
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/961128/web-filter" },
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

// ─── Main page — handles both Create ("New Web Filter Profile") and Edit ─────
const WebFilterFormPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceIdParam = searchParams.get("deviceId");
  const editName = searchParams.get("name");
  const isEdit = !!editName;

  const [device, setDevice]                 = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]             = useState("");
  const [loadingDev, setLoadingDev]         = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(isEdit);
  // An EDIT whose profile could not be read. Blocks the form rather than letting a
  // Save built from blank defaults overwrite it — see ProfileLoadGuard.tsx.
  const [unreadable, setUnreadable] = useState(false);

  const [form, setForm]     = useState<WebFilterProfileForm>(EMPTY_WEBFILTER_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [meta, setMeta]           = useState<WebFilterMetadata>(EMPTY_WEBFILTER_METADATA);
  const [loadingMeta, setLoadingMeta] = useState(true);

  // Seed a NEW profile's category actions from each FortiGuard category's default action —
  // this reproduces the "Custom" preset the real GUI shows on a blank profile (e.g. Potentially
  // Liable → Monitor). For an edit we keep whatever the device returned.
  const seedDefaultCategories = (m: WebFilterMetadata): WebFilterCategoryAction[] =>
    [...m.local_categories, ...m.categories]
      .filter((c) => (c.default_action ?? "allow") !== "allow")
      .map((c) => ({ category: c.id, action: c.default_action as WebFilterCategoryAction["action"] }));

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
    const metaP = DeviceGetWebFilterMetadata(deviceId, editName || undefined);
    const profileP = isEdit && editName ? DeviceGetWebFilterProfile(deviceId, editName) : Promise.resolve(null);
    // Consumed right here, not inside the `found` branch below: this read does not depend on
    // the device being in the list, and a promise that is only sometimes awaited is an
    // uncaught rejection waiting for one of these getters to stop being lenient.
    void metaP
      .then((m) => {
        setMeta(m);
        if (!isEdit) setForm((f) => ({ ...f, categories: seedDefaultCategories(m) }));
      })
      .finally(() => setLoadingMeta(false));

    Promise.all([ListDevices(), infoP, profileP]).then(([list, info, existing]) => {
      const found = list.find((d) => d.id === deviceId) ?? null;
      setDevice(found);
      if (found) {
        setHostname(info.hostname || found.name);

        // FortiGuard taxonomy + picker lists (drives the category tree + override panel).

        if (isEdit && editName) {
          if (existing) setForm(existing);
          else setUnreadable(true);
          setLoadingProfile(false);
        }
      } else {
        setLoadingProfile(false);
        setLoadingMeta(false);
      }
    }).catch(() => { if (isEdit) setUnreadable(true); })
      .finally(() => setLoadingDev(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const set = <K extends keyof WebFilterProfileForm>(key: K, value: WebFilterProfileForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (Object.keys(errs).length || !device) { setErrors(errs); return; }
    setErrors({});

    try {
      setSaving(true);
      if (isEdit && editName) {
        await DeviceUpdateWebFilterProfile(device.id, editName, form);
        message.success(`Web Filter profile "${form.name}" updated on ${hostname || device.name}`);
      } else {
        await DeviceCreateWebFilterProfile(device.id, form);
        message.success(`Web Filter profile "${form.name}" created on ${hostname || device.name}`);
      }
      navigate(`/admin/security-profiles/webfilter?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} Web Filter profile`));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps: WFFieldsProps = { form, set, currentColor, errors, isEdit };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="Web Filter profile" name={editName} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading profile…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiGlobe />}
        title={isEdit ? `Edit Web Filter Profile — ${editName}` : "New Web Filter Profile"}
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
            <WFFieldsBasic {...fieldsProps} />

            {/* FortiGuard Category Based Filter (master toggle → category tree) */}
            <div className="border-t hairline-2 surface-sunken px-6 py-3">
              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="FortiGuard Category Based Filter"
                  checked={form.fortiguard_category_filter}
                  onChange={(v) => set("fortiguard_category_filter", v)} color={currentColor} />
              </div>
            </div>
            {form.fortiguard_category_filter && (
              <WFFortiGuardFilter form={form} set={set} meta={meta} currentColor={currentColor} loadingMeta={loadingMeta} />
            )}

            {/* Allow users to override blocked categories (toggle → override sub-form) */}
            <div className="border-t hairline-2 surface-sunken px-6 py-3">
              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="Allow users to override blocked categories"
                  checked={form.allow_override} onChange={(v) => set("allow_override", v)} color={currentColor}
                  disabled={!form.fortiguard_category_filter} info={FORTIGUARD_GATE_REASON} />
              </div>
            </div>
            {form.allow_override && form.fortiguard_category_filter && (
              <WFOverridePanel form={form} set={set} meta={meta} currentColor={currentColor} />
            )}

            <WFStaticURLFilter form={form} set={set} currentColor={currentColor} />
            <WFFieldsRating {...fieldsProps} />
            <WFFieldsProxy {...fieldsProps} />
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

export default WebFilterFormPage;
