import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiLock, FiChevronLeft, FiSave, FiHardDrive, FiAlertTriangle,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink, FiInfo,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { ProfileUnreadable } from "./ProfileLoadGuard";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo } from "../../api/policyObject";
import {
  DeviceGetSSLSSHProfile, DeviceCreateSSLSSHProfile, DeviceUpdateSSLSSHProfile,
  DeviceGetSSLSSHMetadata, EMPTY_SSLSSH_METADATA, EMPTY_SSLSSH_FORM,
  sslProfileFieldEnabled,
  type SSLSSHProfileForm, type SSLSSHMetadata,
} from "../../api/inspectionProfiles";
import { ToggleRow, avSectionHdr } from "./antivirus-form";
import { SegmentedPills } from "../../components/ui/filter-table";
import { SSLProtocolTable, SSLExemptions } from "./sslssh-sections";
import { activateOnKey } from "../../components/ui/keyActivate";
import { apiErrorDetail } from "../../api/errorText";

const toggleGridCls = "grid items-center gap-x-3 gap-y-3";
const toggleGridStyle: React.CSSProperties = { gridTemplateColumns: "max-content max-content auto" };
const labelCls = "block text-[12px] font-medium ink-2 min-w-[300px] shrink-0";
const rowCls = "flex items-center gap-3";
const inputCls = "h-8 flex-1 rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition placeholder-ink";

const ALPN: { v: SSLSSHProfileForm["supported_alpn"]; l: string }[] = [
  { v: "none", l: "None" }, { v: "http1-1", l: "HTTP/1.1" }, { v: "http2", l: "HTTP/2" }, { v: "all", l: "All" },
];

const MODES: { v: SSLSSHProfileForm["server_cert_mode"]; l: string }[] = [
  { v: "re-sign", l: "Multiple Clients Connecting to Multiple Servers" },
  { v: "replace", l: "Protecting SSL Server" },
];

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

      {/* The single most common support call about deep inspection is "every site shows a
          certificate warning", and the answer is always this. Better said here than found out
          after the profile is live. */}
      <div className="rounded-sm border hairline-2 surface-card shadow-sm overflow-hidden">
        <div className="border-b hairline-2 px-4 py-2.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Before you deploy</p>
        </div>
        <div className="px-4 py-3 text-[11px] ink-2 leading-relaxed">
          Deep inspection re-signs every certificate with the CA chosen here. Every device on the
          network must already trust that CA, or users see a warning on every HTTPS site. Export it
          from the FortiGate's own <span className="font-mono ink-3">System &gt; Certificates</span>{" "}
          and push it to your endpoints first.
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

const SSLSSHFormPage: React.FC = () => {
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

  const [form, setForm] = useState<SSLSSHProfileForm>(EMPTY_SSLSSH_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [meta, setMeta] = useState<SSLSSHMetadata>(EMPTY_SSLSSH_METADATA);

  const set = <K extends keyof SSLSSHProfileForm>(key: K, value: SSLSSHProfileForm[K]) =>
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
    const metaP = DeviceGetSSLSSHMetadata(deviceId);
    const profileP = isEdit && editName ? DeviceGetSSLSSHProfile(deviceId, editName) : Promise.resolve(null);
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

  const anyDeep = form.protocols.some(
    (p) => p.status === "deep-inspection" || (p.protocol === "ssl" && p.inspect_all === "deep-inspection"));

  // A flow-based FortiGate has only part of this profile. Sending the rest is accepted with a 200
  // and silently discarded, so anything the device cannot take is greyed out and said so.
  const can = (field: string) => sslProfileFieldEnabled(meta, field);
  const flowMode = !meta.proxy_inspection;
  const gate = (field: string) => (can(field) ? "" : "pointer-events-none opacity-40");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!form.name.trim()) errs.name = "Name is required";
    if (form.server_cert_mode === "replace" && form.server_certificates.length === 0) {
      errs.server_certificates = "Pick the certificate the firewall should present to clients";
    }
    if (anyDeep && form.server_cert_mode === "re-sign" && !form.ca_certificate.trim()) {
      errs.ca_certificate = "Deep inspection needs a CA certificate to re-sign with";
    }
    if (Object.keys(errs).length || !device) { setErrors(errs); return; }
    setErrors({});

    try {
      setSaving(true);
      if (isEdit && editName) {
        await DeviceUpdateSSLSSHProfile(device.id, editName, form);
        message.success(`SSL/SSH profile "${form.name}" updated on ${hostname || device.name}`);
      } else {
        await DeviceCreateSSLSSHProfile(device.id, form);
        message.success(`SSL/SSH profile "${form.name}" created on ${hostname || device.name}`);
      }
      navigate(`/admin/security-profiles/ssl-ssh-inspection?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, `Failed to ${isEdit ? "update" : "create"} SSL/SSH profile`));
    } finally {
      setSaving(false);
    }
  };

  if (unreadable) {
    return (
      <ProfileUnreadable noun="SSL/SSH profile" name={editName} deviceName={hostname || device?.name}
        onBack={() => navigate(-1)} />
    );
  }

  if (loadingProfile) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading profile…</div>;
  }

  const certOptions = meta.ca_certificates.length ? meta.ca_certificates : [form.ca_certificate].filter(Boolean);

  return (
    <div className="space-y-4">
      <PageHeader
        icon={<FiLock />}
        title={isEdit ? `Edit SSL/SSH Inspection Profile — ${editName}` : "New SSL/SSH Inspection Profile"}
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

      {flowMode && device && (
        <div className="flex items-start gap-2 rounded-[5px] border border-sky-300 bg-sky-50 px-4 py-2.5 text-[12px] text-sky-800 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-300">
          <FiInfo size={14} className="mt-0.5 shrink-0" />
          <span>
            This firewall runs <strong>flow-based</strong> inspection, so it does not have the
            proxy-only half of this profile — per-protocol ports and status, certificate handling
            outside the default block, exemptions, and the reputable-website allowlist. Those
            controls are greyed out below: the device would accept them and store nothing.
            Enable <span className="font-mono">gui-proxy-inspection</span> in{" "}
            <span className="font-mono">System &gt; Feature Visibility</span> to use them.
          </span>
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>

          <div className="overflow-hidden rounded-sm border hairline surface-card shadow-sm">

            <div className="space-y-4 px-6 py-5">
              <div className={rowCls}>
                <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
                <div className="flex-1">
                  <input id="name" value={form.name} disabled={isEdit}
                    onChange={(e) => set("name", e.target.value)} placeholder="e.g. outbound-deep-inspect"
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

              <div role="group" aria-labelledby="enable-ssl-inspection-of-label" className={rowCls} style={{ alignItems: "flex-start" }}>
                <span id="enable-ssl-inspection-of-label" className={`${labelCls} pt-1`}>Enable SSL inspection of</span>
                <div className="flex-1">
                  <div className={gate("server-cert-mode")}>
                    <SegmentedPills<SSLSSHProfileForm["server_cert_mode"]> label="Enable SSL inspection of"
                      opts={MODES} value={form.server_cert_mode} color={currentColor}
                      onChange={(v) => set("server_cert_mode", v)} />
                  </div>
                  <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                    <FiInfo size={11} className="mt-0.5 shrink-0" />
                    {form.server_cert_mode === "re-sign"
                      ? "Outbound: your users reaching the internet. The firewall re-signs each site's certificate with the CA below."
                      : "Inbound: clients reaching a server you own. The firewall presents that server's own certificate."}
                  </p>
                </div>
              </div>

              {form.server_cert_mode === "re-sign" ? (
                <>
                  <div className={rowCls}>
                    <label htmlFor="ca-certificate" className={labelCls}>CA certificate <span className="text-red-500">*</span></label>
                    <div className="flex-1">
                      <MinimalSelect id="ca-certificate" value={form.ca_certificate} ariaLabel="CA certificate"
                        className="w-full" onChange={(v) => set("ca_certificate", v)}
                        options={certOptions.map((c) => ({ value: c, label: c }))} />
                      {errors?.ca_certificate && <p className="mt-1 text-[11px] text-red-500">{errors.ca_certificate}</p>}
                    </div>
                  </div>
                  <div className={`${rowCls} ${gate("untrusted-caname")}`}>
                    <label htmlFor="untrusted-ca-certificate" className={labelCls}>Untrusted CA certificate</label>
                    <div className="flex-1">
                      <MinimalSelect id="untrusted-ca-certificate" value={form.untrusted_ca_certificate}
                        ariaLabel="Untrusted CA certificate" className="w-full" disabled={!can("untrusted-caname")}
                        onChange={(v) => set("untrusted_ca_certificate", v)}
                        options={certOptions.map((c) => ({ value: c, label: c }))} />
                    </div>
                  </div>
                </>
              ) : (
                <div className={rowCls} style={{ alignItems: "flex-start" }}>
                  <label htmlFor="server-certificates" className={`${labelCls} pt-1`}>Server certificates <span className="text-red-500">*</span></label>
                  <div className="flex-1">
                    <div className="overflow-hidden rounded-[4px] border hairline" style={{ maxHeight: 160, overflowY: "auto" }}>
                      {meta.server_certificates.length === 0 ? (
                        <div className="py-6 text-center text-[12px] ink-3">No certificates on this device</div>
                      ) : meta.server_certificates.map((c) => {
                        const on = form.server_certificates.includes(c);
                        const toggle = () => set("server_certificates",
                          on ? form.server_certificates.filter((x) => x !== c) : [...form.server_certificates, c]);
                        return (
                          <div key={c}
                            role="button"
                            tabIndex={0}
                            aria-pressed={on}
                            onClick={toggle}
                            onKeyDown={activateOnKey(toggle)}
                            className={`flex cursor-pointer items-center gap-2 border-b hairline-2 px-3 py-1.5 text-[12px] last:border-0 ${on ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}>
                            <input id="server-certificates" type="checkbox" checked={on} readOnly className="pointer-events-none" />
                            <span className="ink">{c}</span>
                          </div>
                        );
                      })}
                    </div>
                    {errors?.server_certificates && <p className="mt-1 text-[11px] text-red-500">{errors.server_certificates}</p>}
                  </div>
                </div>
              )}
            </div>

            <div className={avSectionHdr}>Protocol Port Mapping</div>
            <SSLProtocolTable form={form} set={set} meta={meta} currentColor={currentColor} />

            <div className={avSectionHdr}>Exempt from SSL Inspection</div>
            <div className="px-6 pt-4">
              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="Exempt reputable websites"
                  checked={form.allowlist} onChange={(v) => set("allowlist", v)} color={currentColor}
                  disabled={!can("allowlist")}
                  info={can("allowlist")
                    ? "FortiGuard's own list of sites known to break under interception — banks, software updaters, OS telemetry."
                    : "Not available on a flow-based FortiGate."} />
                <ToggleRow label="Block certificates on the FortiGuard blocklist"
                  checked={form.block_blocklisted_certificates}
                  onChange={(v) => set("block_blocklisted_certificates", v)} color={currentColor}
                  info="Refuse certificates FortiGuard has flagged as compromised or fraudulent." />
              </div>
            </div>
            {can("ssl-exempt") ? (
              <SSLExemptions form={form} set={set} meta={meta} currentColor={currentColor} />
            ) : (
              <p className="px-6 pb-5 text-[11px] ink-3">
                Per-site exemptions need proxy inspection. On this firewall, exclude traffic from
                inspection with a firewall policy that uses the <span className="font-mono">no-inspection</span>{" "}
                profile instead.
              </p>
            )}

            <div className={avSectionHdr}>Common Options</div>
            <div className="space-y-4 px-6 py-4">
              <div role="group" aria-labelledby="supported-alpn-label" className={`${rowCls} ${gate("supported-alpn")}`}>
                <span id="supported-alpn-label" className={labelCls}>Supported ALPN</span>
                <div className="flex-1">
                  <SegmentedPills<SSLSSHProfileForm["supported_alpn"]> label="Supported ALPN"
                    opts={ALPN} value={form.supported_alpn} color={currentColor}
                    onChange={(v) => set("supported_alpn", v)} />
                </div>
              </div>
              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="Inspect RPC over HTTPS" checked={form.rpc_over_https}
                  disabled={!can("rpc-over-https")}
                  onChange={(v) => set("rpc_over_https", v)} color={currentColor} />
                <ToggleRow label="Inspect MAPI over HTTPS" checked={form.mapi_over_https}
                  disabled={!can("mapi-over-https")}
                  onChange={(v) => set("mapi_over_https", v)} color={currentColor} />
              </div>
            </div>

            <div className={avSectionHdr}>Logging</div>
            <div className="px-6 py-4">
              <div className={toggleGridCls} style={toggleGridStyle}>
                <ToggleRow label="SSL anomalies" checked={form.log_ssl_anomaly}
                  onChange={(v) => set("log_ssl_anomaly", v)} color={currentColor} />
                <ToggleRow label="SSL negotiation" checked={form.log_ssl_negotiation}
                  onChange={(v) => set("log_ssl_negotiation", v)} color={currentColor}
                  info="One log line per TLS handshake. Very high volume — turn it on while diagnosing, not permanently." />
                <ToggleRow label="Server certificate details" checked={form.log_ssl_server_cert}
                  onChange={(v) => set("log_ssl_server_cert", v)} color={currentColor} />
                <ToggleRow label="Handshake details" checked={form.log_ssl_handshake}
                  onChange={(v) => set("log_ssl_handshake", v)} color={currentColor} />
                <ToggleRow label="Exempted sessions" checked={form.log_ssl_exemption}
                  disabled={!can("ssl-exemption-log")}
                  onChange={(v) => set("log_ssl_exemption", v)} color={currentColor}
                  info="Records what was skipped. The fastest way to confirm an exemption is doing what you meant." />
              </div>
            </div>
          </div>

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} />
        </div>

        {anyDeep && (
          <div className="mt-4 flex items-start gap-2 rounded-[5px] border border-amber-300 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
            <FiAlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              This profile decrypts traffic. Attaching it to a policy without first distributing{" "}
              <strong>{form.ca_certificate || "the CA certificate"}</strong> to your endpoints will
              produce a certificate warning on every HTTPS site.
            </span>
          </div>
        )}

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

export default SSLSSHFormPage;
