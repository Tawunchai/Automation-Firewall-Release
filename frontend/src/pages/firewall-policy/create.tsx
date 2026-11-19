import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiShield, FiChevronLeft, FiSave, FiHardDrive, FiTerminal, FiBookOpen, FiVideo,
  FiMessageSquare, FiExternalLink,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import ImpactPreviewButton from "./ImpactPreview";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceGetInfo, DeviceCreatePolicy, type DeviceInterface, type AddressObject, type ServiceObject, type DevicePolicyProfileOptions, type PolicyAction, type LogTraffic } from "../../api/policyObject";
import {
  labelCls, inputCls, rowCls, Toggle, ButtonGroup, MultiSelect, NameDropdown,
  type MultiSelectGroup,
} from "./policy-controls";
import { CliModal } from "./policy-cli";
import { BLANK_POLICY_FORM, SSL_PROFILES_WITHOUT_DECRYPTION, anyProfileEnabled, buildPolicyPayload, checkAddressInterfaceBinding, usePolicyFormOptions, validatePolicyForm } from "./create.logic";
import type { PolicyFormState } from "./create.logic";
import { apiErrorDetail } from "../../api/errorText";

// ─── Right Info Panel ──────────────────────────────────────────────────────────
export const InfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string; onCLI: () => void }> = ({ device, hostname, currentColor, onCLI }) => (
  <div className="space-y-3">
    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
      </div>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
          style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
          <FiHardDrive size={12} />
        </div>
        <div>
          <p className="text-[13px] font-semibold ink">{hostname || device?.name || "—"}</p>
          {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
        </div>
      </div>
    </div>

    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Additional Information</p>
      </div>
      <div className="px-4 py-2">
        <button type="button" onClick={onCLI}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] ink-2 surface-hover hover-ink transition-colors">
          <FiTerminal size={13} className="ink-3" /> Edit in CLI
        </button>
      </div>
    </div>

    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
      </div>
      <div className="px-4 py-2 space-y-0.5">
        {[
          { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.4.7/administration-guide/954635/firewall-policies" },
          { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
        ].map(({ icon, label, href }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
            {icon} {label} <FiExternalLink size={10} className="ml-auto opacity-60" />
          </a>
        ))}
      </div>
    </div>

    <div className="overflow-hidden rounded-[4px] border hairline-2 surface-card shadow-sm">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Fortinet Community</p>
      </div>
      <div className="px-4 py-2">
        <a href="https://community.fortinet.com/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
          <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
        </a>
      </div>
    </div>
  </div>
);

function ifaceLabel(iface: DeviceInterface): string {
  if (iface.name === "any") return "any";
  return iface.alias ? `${iface.alias} (${iface.name})` : iface.name;
}

// ─── Form state shared by create & edit ───────────────────────────────────────
// certificate-inspection is the one built-in SSL/SSH profile that doesn't decrypt
// traffic (it only inspects the certificate), so it's the sole profile FortiGate's own
// GUI does *not* flag with a warning icon, and the only one for which mirroring
// decrypted traffic makes no sense either.
const SSL_PROFILES_WITHOUT_WARNING = new Set(["certificate-inspection"]);
// anyProfileEnabled — is at least one security-profile category turned on for this policy?
// Enabling any UTM inspection requires an SSL/SSH profile that at least inspects the
// certificate, so "no-inspection" is not allowed alongside a profile.
// effectiveSSLProfile enforces the rule "≥1 security profile ⇒ SSL Inspection must be at
// least certificate-inspection" — if a profile is on but SSL is still no-inspection (or
// blank), it snaps to certificate-inspection.
// Maps a device FirewallPolicy (as returned by DeviceListPolicies) back into editable
// PolicyFormState — the reverse of buildPolicyPayload(). Used to prefill the policy wizard /
// edit flow so Apply updates the existing policy instead of creating a new one.
// A FortiGate address with an associated-interface can ONLY be used in a policy whose
// interface matches it — otherwise FortiGate rejects the whole policy with the opaque
// "entry not found in datasource" (error -3). checkAddressInterfaceBinding catches that
// on the client with a clear message BEFORE we hit the device. `addresses` carries each
// object's `interface` binding (empty = usable anywhere).
// validatePolicyForm checks required fields, and (when the address list is supplied) that
// no source/destination address is bound to an incompatible interface.
// ─── Shared section props ─────────────────────────────────────────────────────
export type PolicyFieldsProps = {
  form: PolicyFormState; set: <K extends keyof PolicyFormState>(k: K, v: PolicyFormState[K]) => void;
  errors: Record<string, string>;
  interfaces: DeviceInterface[]; addresses: AddressObject[]; services: ServiceObject[];
  profiles: DevicePolicyProfileOptions; loadingProfiles: boolean; currentColor: string;
};

export const sectionHdr = "px-6 py-2.5 text-[11px] font-semibold ink-2 surface-sunken border-b border-t hairline";

// ─── Section 1: First Setup (name, interfaces, source/destination, schedule, service, action) ──
export const PolicyFieldsGeneral: React.FC<PolicyFieldsProps> = ({ form: f, set, errors, interfaces, addresses, services, profiles, loadingProfiles, currentColor }) => {
  const focus = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const blur = (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  const ifaceOptions = interfaces.map((i) => i.name);
  const ifaceLabels = Object.fromEntries(interfaces.map((i) => [i.name, ifaceLabel(i)]));

  // Grouped like FortiGate's "Select Entries" panel — real objects only, no fabricated entries.
  const addressGroupsData: MultiSelectGroup[] = [
    { label: "ADDRESS", options: addresses.map((a) => a.name) },
    { label: "ADDRESS GROUP", options: profiles.address_groups },
  ].filter((g) => g.options.length > 0);

  // Annotate interface-bound addresses (e.g. "Address-Testing (lan)") so the user can see
  // which interface an address is locked to before picking it — and a live amber hint when
  // the current selection conflicts with the chosen interface (the cause of FortiGate's -3).
  const addrLabels = Object.fromEntries(
    addresses.filter((a) => a.interface && a.interface !== "any").map((a) => [a.name, `${a.name} (${a.interface})`])
  );
  const bindHints = checkAddressInterfaceBinding(f, addresses);

  // Build category groups from the categories the device actually returned — not a
  // fixed list — so a real category name we didn't anticipate (e.g. FortiGate's
  // "VoIP, Messaging & Other Applications" or "Web Proxy") never gets silently dropped.
  const realCategories = Array.from(new Set(services.map((s) => s.category))).sort();
  const serviceGroupsData: MultiSelectGroup[] = [
    ...realCategories.map((cat) => ({
      label: cat,
      options: services.filter((s) => s.category === cat).map((s) => s.name),
    })),
    { label: "SERVICE GROUP", options: profiles.service_groups },
  ].filter((g) => g.options.length > 0);

  const scheduleOptions = profiles.schedules.map((s) => s.name);

  return (
    <div className="space-y-4 px-6 py-5">
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name <span className="text-red-500">*</span></label>
        <div className="flex-1">
          <input id="name" value={f.name} onChange={(e) => set("name", e.target.value)}
            className={`${inputCls} w-full bg-yellow-50 dark:bg-yellow-900/10`} onFocus={focus} onBlur={blur} />
          {errors.name && <p className="mt-1 text-[11px] text-red-500">{errors.name}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="incoming-interface-label" className={rowCls}>
        <span id="incoming-interface-label" className={labelCls}>Incoming Interface <span className="text-red-500">*</span></span>
        <div className="flex-1">
          <NameDropdown label="Incoming interface" options={ifaceOptions} value={f.srcIntf} onChange={(v) => set("srcIntf", v)} currentColor={currentColor} labels={ifaceLabels} />
          {errors.srcIntf && <p className="mt-1 text-[11px] text-red-500">{errors.srcIntf}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="outgoing-interface-label" className={rowCls}>
        <span id="outgoing-interface-label" className={labelCls}>Outgoing Interface <span className="text-red-500">*</span></span>
        <div className="flex-1">
          <NameDropdown label="Outgoing interface" options={ifaceOptions} value={f.dstIntf} onChange={(v) => set("dstIntf", v)} currentColor={currentColor} labels={ifaceLabels} />
          {errors.dstIntf && <p className="mt-1 text-[11px] text-red-500">{errors.dstIntf}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="source-label" className={rowCls}>
        <span id="source-label" className={labelCls}>Source <span className="text-red-500">*</span></span>
        <div className="flex-1">
          <MultiSelect groups={addressGroupsData} value={f.srcAddr} onChange={(v) => set("srcAddr", v)} currentColor={currentColor} labels={addrLabels} />
          {errors.srcAddr && <p className="mt-1 text-[11px] text-red-500">{errors.srcAddr}</p>}
          {!errors.srcAddr && bindHints.srcAddr && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">⚠ {bindHints.srcAddr}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="destination-label" className={rowCls}>
        <span id="destination-label" className={labelCls}>Destination <span className="text-red-500">*</span></span>
        <div className="flex-1">
          <MultiSelect groups={addressGroupsData} value={f.dstAddr} onChange={(v) => set("dstAddr", v)} currentColor={currentColor} labels={addrLabels} />
          {errors.dstAddr && <p className="mt-1 text-[11px] text-red-500">{errors.dstAddr}</p>}
          {!errors.dstAddr && bindHints.dstAddr && <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">⚠ {bindHints.dstAddr}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="schedule-label" className={rowCls}>
        <span id="schedule-label" className={labelCls}>Schedule</span>
        <NameDropdown label="Schedule" value={f.schedule} onChange={(v) => set("schedule", v)} options={scheduleOptions} loading={loadingProfiles} currentColor={currentColor} />
      </div>
      <div role="group" aria-labelledby="service-label" className={rowCls}>
        <span id="service-label" className={labelCls}>Service <span className="text-red-500">*</span></span>
        <div className="flex-1">
          <MultiSelect groups={serviceGroupsData} value={f.service} onChange={(v) => set("service", v)} currentColor={currentColor} />
          {errors.service && <p className="mt-1 text-[11px] text-red-500">{errors.service}</p>}
        </div>
      </div>
      <div role="group" aria-labelledby="action-label" className={rowCls}>
        <span id="action-label" className={labelCls}>Action</span>
        <ButtonGroup label="Action" value={f.action} onChange={(v) => set("action", v as PolicyAction)} currentColor={currentColor}
          options={[{ value: "accept", label: "✓ ACCEPT", color: "#16a34a" }, { value: "deny", label: "⊘ DENY", color: "#dc2626" }]} />
      </div>
    </div>
  );
};

// ─── Section 2: Firewall / Network Options (NAT, IP pool, protocol options) ────
// No-op (just the section header + nothing) for deny policies — matches the real
// GUI, which hides this whole section when Action is Deny.
export const PolicyFieldsNetwork: React.FC<PolicyFieldsProps> = ({ form: f, set, profiles, loadingProfiles, currentColor }) => {
  if (f.action !== "accept") return null;
  return (
    <>
      <div className={sectionHdr}>Firewall / Network Options</div>
      <div className="space-y-4 px-6 py-5">
        <div role="group" aria-labelledby="nat-label" className={rowCls}>
          <span id="nat-label" className={labelCls}>NAT</span>
          <Toggle label="NAT" checked={f.nat} onChange={(v) => set("nat", v)} color={currentColor} />
        </div>
        {f.nat && (
          <>
            <div role="group" aria-labelledby="ip-pool-configuration-label" className={rowCls}>
              <span id="ip-pool-configuration-label" className={labelCls}>IP pool configuration</span>
              <ButtonGroup label="IP pool configuration" value={f.ipPoolMode} onChange={(v) => set("ipPoolMode", v as "outgoing" | "dynamic")} currentColor={currentColor}
                options={[{ value: "outgoing", label: "Use Outgoing Interface Address" }, { value: "dynamic", label: "Use Dynamic IP Pool" }]} />
            </div>
            {f.ipPoolMode === "dynamic" ? (
              <>
                <div className={rowCls}>
                  <span className={labelCls} />
                  <MultiSelect options={profiles.ip_pools} value={f.poolName} onChange={(v) => set("poolName", v)} currentColor={currentColor} placeholder="Select IP pool…" />
                </div>
                <div role="group" aria-labelledby="preserve-source-port-label" className={rowCls}>
                  <span id="preserve-source-port-label" className={labelCls}>Preserve Source Port</span>
                  <Toggle label="Preserve source port" checked={f.preserveSourcePort} onChange={(v) => set("preserveSourcePort", v)} color={currentColor} />
                </div>
              </>
            ) : (
              <>
                <div role="group" aria-labelledby="manage-source-port-label" className={rowCls}>
                  <span id="manage-source-port-label" className={labelCls}>Manage source port</span>
                  <Toggle label="Manage source port" checked={f.manageSourcePort} onChange={(v) => set("manageSourcePort", v)} color={currentColor} />
                </div>
                {f.manageSourcePort && (
                  <div className={rowCls}>
                    <span className={labelCls} />
                    <ButtonGroup label="Source port handling" value={f.fixedPort ? "fixed" : "preserve"} onChange={(v) => set("fixedPort", v === "fixed")} currentColor={currentColor}
                      options={[{ value: "fixed", label: "Fixed Port" }, { value: "preserve", label: "Preserve Source Port" }]} />
                  </div>
                )}
              </>
            )}
          </>
        )}
        <div role="group" aria-labelledby="protocol-options-label" className={rowCls}>
          <span id="protocol-options-label" className={labelCls}>Protocol options</span>
          <NameDropdown label="Protocol options" value={f.protocolOptions} onChange={(v) => set("protocolOptions", v)}
            options={profiles.protocol_options} loading={loadingProfiles} currentColor={currentColor}
            badge={{ text: "PROT", color: "#7a8a3d" }} />
        </div>
      </div>
    </>
  );
};

// ─── Section 3: Security Profiles (AV/Web Filter/DNS Filter/App Control/IPS/File Filter/SSL) ──
// Hidden entirely for deny policies, same as Network Options above.
export const PolicyFieldsSecurity: React.FC<PolicyFieldsProps> = ({ form: f, set, profiles, loadingProfiles, currentColor }) => {
  if (f.action !== "accept") return null;

  // Auto-select a sensible profile the moment a category is toggled on — matches the
  // real FortiGate GUI (AntiVirus/Web Filter/DNS Filter/Application Control jump straight
  // to "default"), except File Filter, which the real GUI leaves blank until the admin
  // explicitly picks one (confirmed against a live device's New Policy page).
  // Enabling any UTM profile requires SSL Inspection ≥ certificate-inspection, so snap it up
  // from no-inspection/blank the moment a profile turns on (the user's rule + FortiGate's).
  const forceSSL = () => {
    if (!f.sslSshProfile || f.sslSshProfile === "no-inspection") set("sslSshProfile", "certificate-inspection");
  };
  const withAutoFill = (setEnabled: (v: boolean) => void, setProfile: (v: string) => void, profile: string, options: string[]) =>
    (v: boolean) => {
      setEnabled(v);
      if (v) {
        if (!profile) setProfile(options.includes("default") ? "default" : (options[0] ?? ""));
        forceSSL();
      }
    };
  const anyOn = anyProfileEnabled(f);

  const vis = profiles.security_profile_visibility;
  const securityProfiles: { key: string; label: string; enabled: boolean; setEnabled: (v: boolean) => void; profile: string; setProfile: (v: string) => void; options: string[]; badge: { text: string; color: string }; visible: boolean }[] = [
    { key: "av",   label: "AntiVirus",           enabled: f.avEnabled,   setEnabled: (v: boolean) => set("avEnabled", v),   profile: f.avProfile,   setProfile: (v: string) => set("avProfile", v),   options: profiles.av_profiles,          badge: { text: "AV",   color: "#e2574c" }, visible: vis.antivirus },
    { key: "web",  label: "Web Filter",          enabled: f.webEnabled,  setEnabled: (v: boolean) => set("webEnabled", v),  profile: f.webProfile,  setProfile: (v: string) => set("webProfile", v),  options: profiles.webfilter_profiles,   badge: { text: "WEB",  color: "#2f7bbf" }, visible: vis.webfilter },
    { key: "dns",  label: "DNS Filter",          enabled: f.dnsEnabled,  setEnabled: (v: boolean) => set("dnsEnabled", v),  profile: f.dnsProfile,  setProfile: (v: string) => set("dnsProfile", v),  options: profiles.dnsfilter_profiles,   badge: { text: "DNS",  color: "#3aa17e" }, visible: vis.dnsfilter },
    { key: "app",  label: "Application Control", enabled: f.appEnabled,  setEnabled: (v: boolean) => set("appEnabled", v),  profile: f.appProfile,  setProfile: (v: string) => set("appProfile", v),  options: profiles.app_lists,            badge: { text: "APP",  color: "#5a9c3f" }, visible: vis.application_control },
    { key: "ips",  label: "IPS",                 enabled: f.ipsEnabled,  setEnabled: (v: boolean) => set("ipsEnabled", v),  profile: f.ipsProfile,  setProfile: (v: string) => set("ipsProfile", v),  options: profiles.ips_sensors,          badge: { text: "IPS",  color: "#c2410c" }, visible: vis.ips },
  ].map((p) => ({ ...p, setEnabled: withAutoFill(p.setEnabled, p.setProfile, p.profile, p.options) }));
  // File Filter is the one category the real GUI leaves blank on enable — added after
  // the auto-fill map so it keeps its own plain setEnabled.
  securityProfiles.push({
    key: "file", label: "File Filter", enabled: f.fileEnabled,
    setEnabled: (v) => { set("fileEnabled", v); if (v) forceSSL(); },
    profile: f.fileProfile, setProfile: (v) => set("fileProfile", v), options: profiles.file_filter_profiles,
    badge: { text: "FILE", color: "#64748b" }, visible: vis.file_filter,
  });
  const visibleSecurityProfiles = securityProfiles.filter((p) => p.visible);

  return (
    <>
      <div className={sectionHdr}>Security Profiles</div>
      <div className="space-y-4 px-6 py-5">
        {visibleSecurityProfiles.map((item) => (
          <div key={item.key} className={rowCls}>
            <span className={labelCls}>{item.label}</span>
            <div className="flex flex-1 items-center gap-3">
              <Toggle label="Enable security profiles" checked={item.enabled} onChange={item.setEnabled} color={currentColor} />
              {item.enabled && (
                <NameDropdown label={item.label} value={item.profile} onChange={item.setProfile}
                  options={item.options} loading={loadingProfiles} currentColor={currentColor} badge={item.badge} />
              )}
            </div>
          </div>
        ))}
        <div role="group" aria-labelledby="ssl-inspection-label" className={rowCls}>
          <span id="ssl-inspection-label" className={`${labelCls} flex items-center gap-1`}>
            SSL Inspection
            {!SSL_PROFILES_WITHOUT_WARNING.has(f.sslSshProfile) && (
              <span title="Traffic matching this policy will be decrypted for inspection">⚠️</span>
            )}
          </span>
          <div className="flex-1">
            <NameDropdown label="SSL inspection profile"
              value={anyOn && (!f.sslSshProfile || f.sslSshProfile === "no-inspection") ? "certificate-inspection" : f.sslSshProfile}
              onChange={(v) => {
                // With a security profile enabled, "no-inspection" isn't allowed — snap to certificate-inspection.
                if (anyOn && v === "no-inspection") set("sslSshProfile", "certificate-inspection");
                else set("sslSshProfile", v);
              }}
              options={anyOn ? profiles.ssl_ssh_profiles.filter((p) => p !== "no-inspection") : profiles.ssl_ssh_profiles}
              loading={loadingProfiles} currentColor={currentColor} badge={{ text: "SSL", color: "#a68a5b" }} />
            {anyOn && (
              <p className="mt-1 text-[10px] ink-3">A security profile is enabled — SSL Inspection must be at least certificate-inspection.</p>
            )}
          </div>
        </div>
        {!SSL_PROFILES_WITHOUT_DECRYPTION.has(f.sslSshProfile) && (
          <div role="group" aria-labelledby="decrypted-traffic-mirror-label" className={rowCls}>
            <span id="decrypted-traffic-mirror-label" className={labelCls}>Decrypted Traffic Mirror</span>
            <div className="flex flex-1 items-center gap-3">
              <Toggle label="Decrypted traffic mirror" checked={f.mirrorEnabled} onChange={(v) => set("mirrorEnabled", v)} color={currentColor} />
              {f.mirrorEnabled && (
                <NameDropdown label="Decrypted traffic mirror" value={f.mirrorProfile} onChange={(v) => set("mirrorProfile", v)}
                  options={profiles.decrypted_traffic_mirrors} loading={loadingProfiles} currentColor={currentColor} />
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// ─── Section 4: Logging Options (log traffic, comments, enable policy) ────────
export const PolicyFieldsLogging: React.FC<PolicyFieldsProps> = ({ form: f, set, currentColor }) => {
  const focus = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 2px ${currentColor}20`;
  };
  const blur = (e: React.FocusEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  };

  return (
    <>
      <div className={sectionHdr}>Logging</div>
      <div className="space-y-4 px-6 py-5">
        {f.action === "deny" ? (
          <div role="group" aria-labelledby="log-violation-traffic-label" className={rowCls}>
            <span id="log-violation-traffic-label" className={labelCls}>Log violation traffic</span>
            <Toggle label="Log violation traffic" checked={f.logViolation} onChange={(v) => set("logViolation", v)} color={currentColor} />
          </div>
        ) : (
          <div role="group" aria-labelledby="log-allowed-traffic-label" className={rowCls}>
            <span id="log-allowed-traffic-label" className={labelCls}>Log Allowed Traffic</span>
            <ButtonGroup label="Log allowed traffic" value={f.logAllowed} onChange={(v) => set("logAllowed", v as LogTraffic)} currentColor={currentColor}
              options={[{ value: "utm", label: "Security Events" }, { value: "all", label: "All Sessions" }]} />
          </div>
        )}
        <div className={rowCls}>
          <label htmlFor="comments" className={`${labelCls} pt-0.5`}>Comments</label>
          <div className="relative flex-1">
            <textarea id="comments" value={f.comments} onChange={(e) => set("comments", e.target.value.slice(0, 1023))}
              placeholder="Write a comment…" rows={2}
              className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-16 text-[13px] ink outline-none resize-none"
              onFocus={focus} onBlur={blur} />
            <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{f.comments.length}/1023</span>
          </div>
        </div>
        <div role="group" aria-labelledby="enable-this-policy-label" className={rowCls}>
          <span id="enable-this-policy-label" className={labelCls}>Enable this policy</span>
          <Toggle label="Enable this policy" checked={f.enabled} onChange={(v) => set("enabled", v)} color={currentColor} />
        </div>
      </div>
    </>
  );
};

// ─── Shared form body (rendered by both create.tsx and edit.tsx) — composes all
// four sections in one continuous scroll. The AI Assistant's policy wizard renders
// the same four sections one at a time instead (see pages/ai-assistant/PolicyWizard.tsx).
export const PolicyFormFields: React.FC<PolicyFieldsProps> = (props) => (
  <>
    <PolicyFieldsGeneral {...props} />
    <PolicyFieldsNetwork {...props} />
    <PolicyFieldsSecurity {...props} />
    <PolicyFieldsLogging {...props} />
  </>
);

// ─── Shared data fetch: interfaces/addresses/services/policy-profile options ──
// Used by the create/edit pages below and by the AI Assistant's policy wizard, so
// all three stay in sync on how device options are loaded.
// ─── Main Page ─────────────────────────────────────────────────────────────────
const FirewallPolicyCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const [device, setDevice]         = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]     = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [showCLI, setShowCLI]       = useState(false);
  const { interfaces, addresses, services, profiles, loadingProfiles } = usePolicyFormOptions(device?.id);

  const [form, setForm]     = useState<PolicyFormState>(BLANK_POLICY_FORM);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const set = <K extends keyof PolicyFormState>(k: K, v: PolicyFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const id = searchParams.get("deviceId");
    if (!id) { setLoadingDev(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(id)) ?? null;
      setDevice(found);
      if (found) {
        const info = await DeviceGetInfo(found.id);
        setHostname(info.hostname || found.name);
      }
    }).finally(() => setLoadingDev(false));
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validatePolicyForm(form, addresses);
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    if (!device) return;

    try {
      setSaving(true);
      await DeviceCreatePolicy(device.id, buildPolicyPayload(form));
      message.success(`Policy "${form.name}" created on ${hostname || device.name}`);
      navigate(`/admin/firewall-policy?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create policy"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiShield />} title="New Policy" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="rounded-[4px] border hairline surface-card shadow-sm">
            <PolicyFormFields form={form} set={set} errors={errors}
              interfaces={interfaces} addresses={addresses} services={services}
              profiles={profiles} loadingProfiles={loadingProfiles} currentColor={currentColor} />
          </div>

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} onCLI={() => setShowCLI(true)} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          {device && (
            <ImpactPreviewButton deviceId={device.id} op="create" policy={buildPolicyPayload(form)} disabled={saving} />
          )}
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>

      {showCLI && device && (
        <CliModal hostname={hostname || device.name} deviceId={device.id} onClose={() => setShowCLI(false)} />
      )}
    </div>
  );
};

export default FirewallPolicyCreatePage;
