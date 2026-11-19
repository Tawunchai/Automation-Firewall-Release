import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiTarget, FiChevronLeft, FiSave, FiHardDrive,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink, FiInfo,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo } from "../../api/policyObject";
import {
  DeviceGetIPSSensor, DeviceCreateIPSSensor, DeviceUpdateIPSSensor, DeviceGetIPSMetadata, EMPTY_IPS_METADATA, EMPTY_IPS_FORM,
  type IPSSensorForm, type IPSMetadata,
} from "../../api/inspectionProfiles";
import { ToggleRow, avSectionHdr } from "./antivirus-form";
import { SegmentedPills } from "../../components/ui/filter-table";
import { IPSEntries } from "./ips-sections";
import { BOTNET_MODES } from "./ips-sections.logic";
import { apiErrorDetail } from "../../api/errorText";

const toggleGridCls = "grid items-center gap-x-3 gap-y-3";
const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const labelCls = "block text-[12px] font-medium ink-2 min-w-[300px] shrink-0";
const rowCls = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";

const InfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string; meta: IPSMetadata }> =
  ({ device, hostname, currentColor, meta }) => (
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

      {/* The signature count is the honest answer to "is IPS actually usable on this box". A unit
          with an expired subscription still accepts sensors but has nothing to match with. */}
      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Signature Database</p>
        </div>
        <div className="px-4 py-3">
          {meta.signature_count > 0 ? (
            <>
              <p className="text-[18px] font-bold ink">{meta.signature_count.toLocaleString()}</p>
              <p className="text-[11px] ink-3">signatures on this device</p>
            </>
          ) : (
            <p className="flex items-start gap-1.5 text-[11px] ink-3">
              <FiInfo size={12} className="mt-0.5 shrink-0" />
              Not readable from this device — filter lists fall back to FortiOS defaults.
            </p>
          )}
        </div>
      </div>

      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
        </div>
        <div className="px-4 py-2 space-y-0.5">
          {[
            { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/" },
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

const IPSFormPage: React.FC = () => {
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

  const [form, setForm] = useState<IPSSensorForm>(EMPTY_IPS_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<IPSMetadata>(EMPTY_IPS_METADATA);

  const set = <K extends keyof IPSSensorForm>(key: K, value: IPSSensorForm[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

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
    const metaP = DeviceGetIPSMetadata(deviceId);
    const profileP = isEdit && editName ? DeviceGetIPSSensor(deviceId, editName) : Promise.resolve(null);
    // Consumed right here, not inside the `found` branch below: this read does not depend on
    // the device being in the list, and a promise that is only sometimes awaited is an
    // uncaught rejection waiting for one of these getters to stop being lenient.
    void metaP.then(setMeta);

    Promise.all([ListDevices(), infoP, profileP]).then(([list, info, existing]) => {
      const found = list.find((d) => d.id === deviceId) ?? null;
      setDevice(found);
      if (found) {
        setHostname(info.hostname || found.name);


        if (isEdit && editName) {
          if (existing) setForm(existing);
          else setUnreadable(true);
          setLoadingProfile(false);
        }
      } else {
        setLoadingProfile(false);
      }
    }).catch(() => { if (isEdit) setUnreadable(true); })
      .finally(() => setLoadingDev(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceIdParam]);

  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    // Caught here as well as on the server: a sensor with no entries is accepted by FortiOS and
    // inspects nothing, which is the failure people do not notice.
    if (form.entries.length === 0) errs.entries = "Add at least one filter or signature entry";
    if (Object.keys(errs).length || !device) { setErrors(errs); return; }
    setErrors({});

    try {
      setSaving(true);
      if (isEdit && editName) {
        await DeviceUpdateIPSSensor(device.id, editName, form);
        message.success(`IPS sensor "${form.name}" updated on ${hostname || device.name}`);
      } else {
        await DeviceCreateIPSSensor(device.id, form);
        message.success(`IPS sensor "${form.name}" created on ${hostname || device.name}`);
      }
      navigate(`/admin/security-profiles/ips?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} IPS sensor`));
    } finally {
      setSaving(false);
    }
  };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="IPS sensor" name={editName} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading sensor…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiTarget />}
        title={isEdit ? `Edit IPS Sensor — ${editName}` : "New IPS Sensor"}
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
              <div className={rowCls}>
                <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
                <div className="flex-1">
                  <input id="name" value={form.name} disabled={isEdit}
                    onChange={(e) => set("name", e.target.value)} placeholder="e.g. block-critical-attacks"
                    className={`${inputCls} w-full ${isEdit ? "surface-sunken cursor-not-allowed" : "bg-yellow-50 dark:bg-yellow-900/10"}`}
                    onFocus={focus} onBlur={blur} />
                  {errors?.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
                </div>
              </div>

              <div className={rowCls} style={{ alignItems: "flex-start" }}>
                <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
                <div className="relative flex-1">
                  <textarea id="comments" value={form.comment} onChange={(e) => set("comment", e.target.value.slice(0, 255))}
                    placeholder="Write a comment…" rows={2}
                    className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-14 text-[13px] ink outline-none resize-none"
                    onFocus={focus} onBlur={blur} />
                  <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{form.comment.length}/255</span>
                </div>
              </div>

              {/* Botnet scanning is a three-way on the device (disable | monitor | block), not the
                  toggle it looks like in some FortiOS builds — Monitor logs without dropping. */}
              <div role="group" aria-labelledby="scan-outgoing-connections-to-bot-label" className={rowCls} style={{ alignItems: "flex-start" }}>
                <span id="scan-outgoing-connections-to-bot-label" className={`${labelCls} pt-1`}>Scan outgoing connections to botnet sites</span>
                <div className="flex-1">
                  <SegmentedPills<IPSSensorForm["scan_botnet_connections"]> label="Scan outgoing connections to botnet sites"
                    opts={BOTNET_MODES} value={form.scan_botnet_connections} color={currentColor}
                    onChange={(v) => set("scan_botnet_connections", v)} />
                </div>
              </div>

              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="Block malicious URLs"
                  checked={form.block_malicious_url}
                  onChange={(v) => set("block_malicious_url", v)} color={currentColor}
                  info="Match downloads against FortiGuard's malicious-URL database. Needs an active IPS subscription to have anything to match against." />
                <ToggleRow label="Extended logging"
                  checked={form.extended_log}
                  onChange={(v) => set("extended_log", v)} color={currentColor}
                  info="Record extra detail on each match. Useful while tuning; noisy in steady state." />
              </div>
            </div>

            <div className={avSectionHdr}>IPS Signatures and Filters</div>
            {errors?.entries && (
              <p className="px-6 pt-3 text-[11px] text-red-500">{errors.entries}</p>
            )}
            <IPSEntries form={form} set={set} meta={meta} currentColor={currentColor} />
          </div>

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} meta={meta} />
        </div>

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

export default IPSFormPage;
