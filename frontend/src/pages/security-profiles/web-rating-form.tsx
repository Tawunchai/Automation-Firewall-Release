import React, { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiTag, FiChevronLeft, FiSave, FiHardDrive, FiAlertTriangle, FiSearch,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo, DeviceGetWebRatingOverride, DeviceCreateWebRatingOverride, DeviceUpdateWebRatingOverride, DeviceGetWebRatingMetadata, DeviceLookupWebRating, EMPTY_WEB_RATING_METADATA, type WebRatingOverrideForm, type WebRatingMetadata, type WebRatingLookup } from "../../api/policyObject";
import { EMPTY_WEB_RATING_FORM, buildCategoryGroups } from "./web-rating-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// "New Web Rating Override" — the FortiGate dialog, as a page.
//
// The dialog asks for four things but the device stores one that matters: `rating`, a single
// category ID. Category and Sub-Category are not two fields on the object — they are the GUI's way
// of narrowing ~93 categories down to one, so this form treats the group purely as a filter and
// submits only the ID the pair resolves to.
//
// Every entry in both dropdowns comes from the device (monitor/webfilter/fortiguard-categories plus
// its own webfilter/ftgd-local-cat table). Nothing here is a written-down list: a firmware or
// FortiGuard package that renames a category, and a custom category somebody adds, both show up
// without touching this file.

const labelCls = "block text-[12px] font-medium ink-2 min-w-[150px] shrink-0";
const rowCls = "flex items-start gap-3";
const inputCls = "h-8 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition";
const sectionHdr = "border-y hairline-2 surface-sunken px-6 py-2 text-[11px] font-bold uppercase tracking-[0.1em] ink-3";

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
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/954635/web-rating-override" },
            { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
          ].map(({ icon, label, href }) => (
            <a key={label} href={href} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
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
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
            <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
          </a>
        </div>
      </div>
    </div>
  );

const WebRatingFormPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const deviceIdParam = searchParams.get("deviceId");
  const editURL = searchParams.get("url");
  const isEdit = !!editURL;

  const [device, setDevice] = useState<NetworkDevice | null>(null);
  const [hostname, setHostname] = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [loadingItem, setLoadingItem] = useState(isEdit);
  // An EDIT whose override could not be read. Without this the failed read fell through to the
  // CREATE branch below — the form pre-selected the first category and offered to save it over
  // the override it had just failed to read. See ProfileLoadGuard.tsx.
  const [unreadable, setUnreadable] = useState(false);

  const [form, setForm] = useState<WebRatingOverrideForm>(EMPTY_WEB_RATING_FORM);
  const [meta, setMeta] = useState<WebRatingMetadata>(EMPTY_WEB_RATING_METADATA);
  const [groupKey, setGroupKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const [lookingUp, setLookingUp] = useState(false);
  const [lookup, setLookup] = useState<WebRatingLookup | null>(null);

  const set = <K extends keyof WebRatingOverrideForm>(key: K, value: WebRatingOverrideForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const groups = useMemo(() => buildCategoryGroups(meta), [meta]);
  const activeGroup = useMemo(
    () => groups.find((g) => g.key === groupKey) ?? null,
    [groups, groupKey],
  );

  useEffect(() => {
    if (!deviceIdParam) { setLoadingDev(false); setLoadingItem(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(deviceIdParam)) ?? null;
      setDevice(found);
      if (!found) { setLoadingItem(false); return; }

      const info = await DeviceGetInfo(found.id);
      setHostname(info.hostname || found.name);

      const [taxonomy, existing] = await Promise.all([
        DeviceGetWebRatingMetadata(found.id),
        isEdit && editURL
          ? DeviceGetWebRatingOverride(found.id, editURL)
          : Promise.resolve(null),
      ]);
      setMeta(taxonomy);

      const tree = buildCategoryGroups(taxonomy);
      if (existing) {
        setForm({
          url: existing.url, rating: existing.rating,
          status: existing.status, comment: existing.comment,
        });
        // Select the group that actually holds the stored ID. A rating whose category is not in
        // the device's taxonomy (a custom category that was since deleted, say) leaves the group
        // unselected rather than silently landing the user on the first one and rewriting it.
        const owner = tree.find((g) => g.items.some((c) => String(c.id) === existing.rating));
        setGroupKey(owner?.key ?? "");
      } else if (isEdit) {
        // Asked to edit, and the device did not hand the override back. The create defaults below
        // must NOT be applied: they would render as a filled-in edit form for a row we never read.
        setUnreadable(true);
      } else if (tree.length > 0 && tree[0].items.length > 0) {
        // A create starts where the dialog starts: the first group, its first category.
        setGroupKey(tree[0].key);
        setForm((f) => ({ ...f, rating: String(tree[0].items[0].id) }));
      }
      setLoadingItem(false);
    }).catch(() => { if (isEdit) setUnreadable(true); })
      .finally(() => setLoadingDev(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  // Switching group moves the rating to that group's first category — the same thing the real
  // dialog does, and the reason it can never submit a Sub-Category from a different Category.
  const handleGroupChange = (key: string) => {
    setGroupKey(key);
    const g = groups.find((x) => x.key === key);
    if (g && g.items.length > 0) set("rating", String(g.items[0].id));
  };

  const handleLookup = async () => {
    if (!device || !form.url.trim()) return;
    try {
      setLookingUp(true);
      setLookup(await DeviceLookupWebRating(device.id, form.url.trim()));
    } catch (err) {
      setLookup(null);
      message.error(apiErrorDetail(err, "Rating lookup failed"));
    } finally {
      setLookingUp(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.url.trim()) errs.url = "URL is required";
    if (!form.rating.trim()) errs.rating = "Choose the category to override to";
    if (Object.keys(errs).length || !device) { setErrors(errs); return; }
    setErrors({});

    const payload: WebRatingOverrideForm = { ...form, url: form.url.trim() };
    try {
      setSaving(true);
      if (isEdit && editURL) {
        await DeviceUpdateWebRatingOverride(device.id, editURL, payload);
        message.success(`Web rating override "${payload.url}" updated on ${hostname || device.name}`);
      } else {
        await DeviceCreateWebRatingOverride(device.id, payload);
        message.success(`Web rating override "${payload.url}" created on ${hostname || device.name}`);
      }
      navigate(`/admin/security-profiles/web-rating-overrides?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} the web rating override`));
    } finally {
      setSaving(false);
    }
  };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="web rating override" name={editURL} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingItem) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading web rating override…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiTag />}
        title={isEdit ? `Edit Web Rating Override — ${editURL}` : "New Web Rating Override"}
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
            <div className="space-y-4 px-6 py-5">

              {/* URL + Lookup rating */}
              <div className={rowCls}>
                <label htmlFor="url" className={`${labelCls} pt-1.5`}>URL <span className="text-red-500">*</span></label>
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <input id="url" value={form.url}
                      onChange={(e) => { set("url", e.target.value.slice(0, 511)); setLookup(null); }}
                      placeholder="e.g. www.example.com"
                      className={`${inputCls} flex-1 bg-yellow-50 dark:bg-yellow-900/10`}
                      onFocus={focus} onBlur={blur} />
                    <button type="button" onClick={() => void handleLookup()}
                      disabled={!device || !form.url.trim() || lookingUp}
                      title="Ask the device how FortiGuard rates this URL today"
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded border hairline surface-sunken px-3 text-[12px] font-medium ink-2 transition surface-hover disabled:opacity-50 disabled:cursor-not-allowed">
                      <FiSearch size={12} /> {lookingUp ? "Looking up…" : "Lookup rating"}
                    </button>
                  </div>
                  {errors?.url && <p className="text-[11px] text-red-500">{errors.url}</p>}

                  {/* The device is not licensed for FortiGuard web filtering — the same warning
                      the real dialog shows. The override still saves; it just has no FortiGuard
                      rating to override until a contract is active. */}
                  {!meta.web_filter_licensed && (
                    <div className="flex items-start gap-2 rounded border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-200">
                      <FiAlertTriangle className="mt-0.5 shrink-0" size={13} />
                      <span>Warning: This device is not licensed for the FortiGuard web filtering service.</span>
                    </div>
                  )}

                  {/* Whatever the device answered, reported as-is. */}
                  {lookup && (
                    <div className="rounded border hairline surface-sunken px-3 py-2 text-[12px]">
                      {lookup.rated ? (
                        <div className="space-y-0.5">
                          <p className="font-semibold ink">Device rating for {lookup.url}</p>
                          {Object.entries(lookup.fields).map(([k, v]) => (
                            <p key={k} className="ink-2">
                              <span className="ink-3">{k}: </span>{typeof v === "object" ? JSON.stringify(v) : String(v)}
                            </p>
                          ))}
                        </div>
                      ) : (
                        <p className="ink-2">
                          The device returned no rating for <b className="ink">{lookup.url}</b> — it has no
                          active FortiGuard web filtering contract to look one up with.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Comments */}
              <div className={rowCls}>
                <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
                <div className="relative flex-1">
                  <textarea id="comments" value={form.comment}
                    onChange={(e) => set("comment", e.target.value.slice(0, 255))}
                    placeholder="Write a comment…" rows={2}
                    className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
                    onFocus={focus} onBlur={blur} />
                  <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">
                    {form.comment.length}/255
                  </span>
                </div>
              </div>
            </div>

            {/* Override to */}
            <div className={sectionHdr}>Override to</div>
            <div className="space-y-4 px-6 py-5">
              <div className={rowCls}>
                <label htmlFor="category" className={`${labelCls} pt-1.5`}>Category</label>
                <div className="flex-1">
                  <MinimalSelect id="category" value={groupKey} ariaLabel="Category"
                    className="w-full max-w-85"
                    onChange={(v) => handleGroupChange(v)}
                    options={[
                      ...(groupKey === "" ? [{ value: "", label: "Select a category…" }] : []),
                      ...groups.map((g) => ({ value: g.key, label: g.label })),
                    ]} />
                </div>
              </div>

              <div className={rowCls}>
                <label htmlFor="sub-category" className={`${labelCls} pt-1.5`}>Sub-Category</label>
                <div className="flex-1">
                  <MinimalSelect id="sub-category" value={form.rating} ariaLabel="Sub-Category"
                    disabled={!activeGroup}
                    className="w-full max-w-85"
                    onChange={(v) => set("rating", v)}
                    options={!activeGroup
                      ? [{ value: form.rating, label: form.rating ? `Category ${form.rating}` : "—" }]
                      : activeGroup.items.map((c) => ({ value: String(c.id), label: c.name }))} />
                  {errors?.rating && <p className="mt-1 text-[11px] text-red-500">{errors.rating}</p>}
                  {groups.length === 0 && (
                    <p className="mt-1 text-[11px] ink-3">
                      The device did not return its category list, so there is nothing to choose from.
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>

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

export default WebRatingFormPage;
