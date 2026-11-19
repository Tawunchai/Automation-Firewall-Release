import { baseApi } from "./http";
import type { WebFilterCategoryMeta } from "./policyObject";

// Device-proxy calls for the two Security Profiles whose forms arrived last: Intrusion Prevention
// and SSL/SSH Inspection.
//
// They live here rather than in policyObject.ts because that file is already the console's largest
// module and is capped by backend/test/layout_budget_test.go. Both of these are self-contained —
// one CMDB table each, one metadata endpoint each — so they are exactly the kind of thing that
// should not be appended to a 2,800-line file.

const deviceBase = (deviceId: number) => `/policy/device/${deviceId}`;

// ─── IPS Sensor (create/update — full form) ──────────────────────────────────
// Field-for-field mirror of the backend's IPSSensorForm (services/fortigate_ips.go), which
// mirrors the FortiOS "New IPS Sensor" page. Verified against a live FortiGate 7.2.10.
//
// IPS is the profile a firewall policy could always REFERENCE here but never CREATE — the picker
// in PolicyWizard has offered `ips_sensors` since the beginning, while the only way to add one
// was FortiGate's own GUI.

/**
 * One row of the sensor's table. FortiOS keeps filters and explicit-signature entries in the
 * same table and tells them apart by whether `rules` is populated; `kind` carries that to the UI
 * so it can open the right drawer.
 */
export type IPSEntry = {
  id: number;
  kind: "filter" | "signature";

  /** Empty array means "all" — the device's own spelling of an unset filter. */
  severity: string[];
  location: string[];
  protocol: string[];
  os: string[];
  application: string[];

  rules: number[];
  cves: string[];

  status: "default" | "enable" | "disable";
  action: "default" | "pass" | "block" | "reset";
  log: boolean;
  log_packet: boolean;
  quarantine: "none" | "attacker";
};

export const EMPTY_IPS_ENTRY: IPSEntry = {
  id: 0, kind: "filter",
  severity: [], location: [], protocol: [], os: [], application: [],
  rules: [], cves: [],
  status: "default", action: "default", log: true, log_packet: false, quarantine: "none",
};

export type IPSSensorForm = {
  name: string;
  comment: string;
  block_malicious_url: boolean;
  extended_log: boolean;
  /** Three-way on the device, not a toggle. */
  scan_botnet_connections: "disable" | "block" | "monitor";
  entries: IPSEntry[];
};

export const EMPTY_IPS_FORM: IPSSensorForm = {
  name: "", comment: "",
  block_malicious_url: false, extended_log: false,
  scan_botnet_connections: "disable",
  entries: [],
};

/** One row of the signature picker. */
export type IPSSignature = {
  id: number;
  name: string;
  severity: string;
  location: string;
  os: string;
  service: string;
  action: string;
};

/**
 * Filter options derived from the device's own signature database, so the dropdowns offer values
 * that firewall actually carries. `signature_count` is 0 when the database could not be read —
 * the form then falls back to FortiOS's generic lists.
 */
export type IPSMetadata = {
  severities: string[];
  locations: string[];
  protocols: string[];
  oses: string[];
  applications: string[];
  signature_count: number;
  signatures: IPSSignature[];
};

export const EMPTY_IPS_METADATA: IPSMetadata = {
  severities: [], locations: [], protocols: [], oses: [], applications: [],
  signature_count: 0, signatures: [],
};

export const DeviceGetIPSMetadata = async (deviceId: number): Promise<IPSMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/ips-metadata`);
    const d = res.data ?? {};
    return {
      severities: d.severities ?? [],
      locations: d.locations ?? [],
      protocols: d.protocols ?? [],
      oses: d.oses ?? [],
      applications: d.applications ?? [],
      signature_count: d.signature_count ?? 0,
      signatures: d.signatures ?? [],
    };
  } catch {
    return EMPTY_IPS_METADATA;
  }
};

export const DeviceGetIPSSensor = async (
  deviceId: number,
  name: string
): Promise<IPSSensorForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/ips/${encodeURIComponent(name)}`);
    const d = res.data;
    if (!d) return null;
    // Go marshals an empty slice as null; the form indexes these, so coerce back to arrays.
    return {
      ...EMPTY_IPS_FORM, ...d,
      entries: (d.entries ?? []).map((e: IPSEntry) => ({
        ...EMPTY_IPS_ENTRY, ...e,
        severity: e.severity ?? [], location: e.location ?? [], protocol: e.protocol ?? [],
        os: e.os ?? [], application: e.application ?? [],
        rules: e.rules ?? [], cves: e.cves ?? [],
      })),
    };
  } catch { return null; }
};

export const DeviceCreateIPSSensor = async (
  deviceId: number,
  payload: IPSSensorForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/ips`, payload);
};

export const DeviceUpdateIPSSensor = async (
  deviceId: number,
  name: string,
  payload: IPSSensorForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/ips/${encodeURIComponent(name)}`, payload);
};

// ─── SSL/SSH Inspection Profile (create/update — full form) ──────────────────
// Mirror of the backend's SSLSSHProfileForm (services/fortigate_sslssh.go).
//
// This page used to be list-only. Without it the other five Security Profiles pages only ever saw
// unencrypted traffic: AntiVirus, Web Filter, DNS Filter, Application Control and File Filter all
// need an inspection profile to decrypt first.

export type SSLProtocolOptions = {
  /** https | ftps | imaps | pop3s | smtps | dot | ssh */
  protocol: string;
  status: "disable" | "certificate-inspection" | "deep-inspection";
  ports: number[];
  proxy_after_tcp_handshake: boolean;

  // Certificate handling — every protocol except ssh.
  client_certificate: "bypass" | "inspect" | "block";
  unsupported_ssl_version: "allow" | "block";
  unsupported_ssl_cipher: "allow" | "block";
  unsupported_ssl_negotiation: "allow" | "block";
  expired_server_cert: "allow" | "block" | "ignore";
  revoked_server_cert: "allow" | "block" | "ignore";
  untrusted_server_cert: "allow" | "block" | "ignore";
  cert_validation_timeout: "allow" | "block" | "ignore";
  cert_validation_failure: "allow" | "block" | "ignore";
  sni_server_cert_check: "enable" | "strict" | "disable";
  cert_probe_failure: "allow" | "block";
  min_allowed_ssl_version: "ssl-3.0" | "tls-1.0" | "tls-1.1" | "tls-1.2" | "tls-1.3";

  // SSH only.
  inspect_all: "disable" | "deep-inspection";
  unsupported_version: "bypass" | "block";
  ssh_algorithm: "compatible" | "high-encryption";
  ssh_tun_policy_check: boolean;
};

export type SSLExemptEntry = {
  type: "fortiguard-category" | "address" | "address6" | "wildcard-fqdn" | "regex";
  fortiguard_category: number;
  address: string;
  address6: string;
  wildcard_fqdn: string;
  regex: string;
};

export const EMPTY_SSL_EXEMPT: SSLExemptEntry = {
  type: "address", fortiguard_category: 0,
  address: "", address6: "", wildcard_fqdn: "", regex: "",
};

export type SSLSSHProfileForm = {
  name: string;
  comment: string;
  /** re-sign = outbound (the CA re-signs) · replace = protecting an SSL server (inbound). */
  server_cert_mode: "re-sign" | "replace";
  ca_certificate: string;
  untrusted_ca_certificate: string;
  server_certificates: string[];
  protocols: SSLProtocolOptions[];
  allowlist: boolean;
  block_blocklisted_certificates: boolean;
  exemptions: SSLExemptEntry[];
  supported_alpn: "http1-1" | "http2" | "all" | "none";
  rpc_over_https: boolean;
  mapi_over_https: boolean;
  log_ssl_exemption: boolean;
  log_ssl_anomaly: boolean;
  log_ssl_negotiation: boolean;
  log_ssl_server_cert: boolean;
  log_ssl_handshake: boolean;
};

/**
 * The blocks, in the order the FortiOS page shows them.
 *
 * `ssl` leads and is not a protocol: it is the device's catch-all for TLS on a port no other
 * block claims. On a FLOW-based FortiGate it is the only block that carries certificate handling
 * at all, which is why it is a row here rather than one stray field.
 */
export const SSL_PROTOCOL_NAMES = ["ssl", "https", "ftps", "imaps", "pop3s", "smtps", "dot", "ssh"] as const;

/** FortiOS's own defaults, read off the device — not the well-known-ports list. */
export const SSL_DEFAULT_PORTS: Record<string, number[]> = {
  ssl: [], // the catch-all matches whatever no other block claimed
  https: [443], ftps: [990], imaps: [993], pop3s: [995], smtps: [465], dot: [853], ssh: [22],
};

export const emptySSLProtocol = (protocol: string): SSLProtocolOptions => ({
  protocol,
  status: "disable",
  ports: SSL_DEFAULT_PORTS[protocol] ?? [],
  proxy_after_tcp_handshake: false,
  client_certificate: "bypass",
  unsupported_ssl_version: "block",
  unsupported_ssl_cipher: "allow",
  unsupported_ssl_negotiation: "allow",
  expired_server_cert: "block",
  revoked_server_cert: "block",
  untrusted_server_cert: "allow",
  cert_validation_timeout: "allow",
  cert_validation_failure: "block",
  sni_server_cert_check: "enable",
  cert_probe_failure: "block",
  min_allowed_ssl_version: "tls-1.1",
  // The `ssl` catch-all has no ports by design (SSL_DEFAULT_PORTS.ssl = []) — it inspects
  // whatever no other block claimed. Found live: a brand-new profile where EVERY block is
  // "disable" (this function's own default, for every protocol) is refused outright —
  // `-651 Must set at least one port or enable ssl inspect-all` — because the `ssl` row then has
  // neither ports nor inspect-all to fall back on. Confirmed live that `https`'s own status alone
  // does not satisfy this device-side check; only this field does, and "deep-inspection" is the
  // only non-"disable" value `inspect_all` accepts (there is no lighter certificate-only option
  // for the catch-all the way there is for a named protocol's own `status`). Scoped to the `ssl`
  // row only — every other protocol keeps the inert "disable" default it always had.
  inspect_all: protocol === "ssl" ? "deep-inspection" : "disable",
  unsupported_version: "bypass",
  ssh_algorithm: "compatible",
  ssh_tun_policy_check: false,
});

export const EMPTY_SSLSSH_FORM: SSLSSHProfileForm = {
  name: "", comment: "",
  server_cert_mode: "re-sign",
  ca_certificate: "Fortinet_CA_SSL",
  untrusted_ca_certificate: "Fortinet_CA_Untrusted",
  server_certificates: [],
  protocols: SSL_PROTOCOL_NAMES.map(emptySSLProtocol),
  allowlist: false,
  block_blocklisted_certificates: true,
  exemptions: [],
  supported_alpn: "all",
  rpc_over_https: false,
  mapi_over_https: false,
  log_ssl_exemption: false,
  log_ssl_anomaly: true,
  log_ssl_negotiation: false,
  log_ssl_server_cert: false,
  log_ssl_handshake: false,
};

export type SSLSSHMetadata = {
  ca_certificates: string[];
  server_certificates: string[];
  addresses: string[];
  wildcard_fqdns: string[];
  categories: WebFilterCategoryMeta[];
  protocols: string[];
  default_ports: Record<string, number[]>;
  builtin_profiles: string[];

  /**
   * false on a flow-based FortiGate, where most of this profile does not exist.
   *
   * ⚠️ The device does NOT report this itself: a flow unit answers a write containing proxy-only
   * fields with 200 "success" and `revision_changed: false`, having stored nothing (verified live
   * on the lab FGT80E). So the form has to grey those controls, or it tells the operator a
   * setting was saved that was silently discarded.
   */
  proxy_inspection: boolean;
  /** Per block, the keys a flow-mode device accepts. Empty when proxy_inspection is true. */
  flow_fields: Record<string, string[]>;
  /** Profile-level controls to grey out when proxy_inspection is false. */
  proxy_only_profile_fields: string[];
};

export const EMPTY_SSLSSH_METADATA: SSLSSHMetadata = {
  ca_certificates: [], server_certificates: [], addresses: [], wildcard_fqdns: [],
  categories: [], protocols: [...SSL_PROTOCOL_NAMES],
  default_ports: SSL_DEFAULT_PORTS, builtin_profiles: [],
  // Assume proxy until the device says otherwise: a metadata read that failed must not silently
  // strip controls out of the form.
  proxy_inspection: true, flow_fields: {}, proxy_only_profile_fields: [],
};

/**
 * Whether a block's field is settable on this device.
 *
 * Proxy-capable units take everything. On a flow unit the answer comes from the device's own
 * field list (metadata.flow_fields), so this never drifts from what the firewall will accept.
 */
export const sslFieldEnabled = (
  meta: SSLSSHMetadata, block: string, field: string
): boolean => {
  if (meta.proxy_inspection) return true;
  const allowed = meta.flow_fields[block];
  // No entry for this block means we do not know — allow rather than grey out wrongly.
  if (!allowed) return true;
  return allowed.includes(field);
};

/** Whether a profile-level control is settable on this device. */
export const sslProfileFieldEnabled = (meta: SSLSSHMetadata, field: string): boolean =>
  meta.proxy_inspection || !meta.proxy_only_profile_fields.includes(field);

export const DeviceGetSSLSSHMetadata = async (deviceId: number): Promise<SSLSSHMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/sslssh-metadata`);
    const d = res.data ?? {};
    return {
      ca_certificates: d.ca_certificates ?? [],
      server_certificates: d.server_certificates ?? [],
      addresses: d.addresses ?? [],
      wildcard_fqdns: d.wildcard_fqdns ?? [],
      categories: d.categories ?? [],
      protocols: d.protocols ?? [...SSL_PROTOCOL_NAMES],
      default_ports: d.default_ports ?? SSL_DEFAULT_PORTS,
      builtin_profiles: d.builtin_profiles ?? [],
      proxy_inspection: d.proxy_inspection ?? true,
      flow_fields: d.flow_fields ?? {},
      proxy_only_profile_fields: d.proxy_only_profile_fields ?? [],
    };
  } catch {
    return EMPTY_SSLSSH_METADATA;
  }
};

export const DeviceGetSSLSSHProfile = async (
  deviceId: number,
  name: string
): Promise<SSLSSHProfileForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/ssl-ssh-inspection/${encodeURIComponent(name)}`);
    const d = res.data;
    if (!d) return null;
    // The device always answers with all seven blocks, but a firmware that drops one must not
    // leave the form with an undefined row to render.
    const byName = new Map<string, SSLProtocolOptions>(
      (d.protocols ?? []).map((p: SSLProtocolOptions) => [p.protocol, p] as const)
    );
    return {
      ...EMPTY_SSLSSH_FORM, ...d,
      server_certificates: d.server_certificates ?? [],
      exemptions: d.exemptions ?? [],
      protocols: SSL_PROTOCOL_NAMES.map((n) => ({
        ...emptySSLProtocol(n), ...(byName.get(n) ?? {}),
        ports: byName.get(n)?.ports ?? SSL_DEFAULT_PORTS[n] ?? [],
      })),
    };
  } catch { return null; }
};

export const DeviceCreateSSLSSHProfile = async (
  deviceId: number,
  payload: SSLSSHProfileForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/ssl-ssh-inspection`, payload);
};

export const DeviceUpdateSSLSSHProfile = async (
  deviceId: number,
  name: string,
  payload: SSLSSHProfileForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/ssl-ssh-inspection/${encodeURIComponent(name)}`, payload);
};

