/**
 * Security profile forms — AntiVirus, Web Filter, DNS Filter, App Control, File Filter
 *
 * Carved out of api/policyObject.ts, which reached 2,391 lines carrying every device-proxy call in
 * the console. policyObject.ts re-exports this module, so the ~138 files that import from it keep
 * working unchanged; new code should import from here directly.
 */
import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";
import type { IPSSensorForm, SSLSSHProfileForm } from "./inspectionProfiles";

// ─── Security Profiles — shared list/delete. IPS and SSL/SSH forms: ./inspectionProfiles.ts ───

export type SecurityProfileCategory =
  | "antivirus" | "webfilter" | "dnsfilter" | "application-control"
  | "file-filter" | "ssl-ssh-inspection" | "ips";

export type SecurityProfile = {
  name: string;
  comment: string;
  /** Set for objects FortiOS refuses to modify (its three shipped SSL/SSH profiles): grey, do not offer. */
  readonly?: boolean;
};

export const DeviceListSecurityProfiles = async (
  deviceId: number,
  category: SecurityProfileCategory,
  opts?: DeviceReadOpts
): Promise<SecurityProfile[]> =>
  deviceList<SecurityProfile>(
    `${deviceBase(deviceId)}/security-profiles/${category}`,
    `Could not load ${category} profiles`,
    opts
  );

export const DeviceDeleteSecurityProfile = async (
  deviceId: number,
  category: SecurityProfileCategory,
  name: string
): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/security-profiles/${category}/${encodeURIComponent(name)}`);
};

// ─── AntiVirus Profile (create/update — full form) ───────────────────────────
// Field-for-field mirror of the backend's AVProfileForm (see services/fortigate.go),
// which itself mirrors the toggles on FortiOS's own "New AntiVirus Profile" page.
export type AVProfileForm = {
  name: string;
  comment: string;

  http_scan: boolean;
  smtp_scan: boolean;
  pop3_scan: boolean;
  imap_scan: boolean;
  ftp_scan: boolean;
  cifs_scan: boolean;

  treat_win_exec_as_virus: boolean;
  send_files_to_sandbox: boolean;
  mobile_malware_protection: boolean;
  quarantine: boolean;

  use_outbreak_db: boolean;
  use_external_blocklist: boolean;
  use_ems_threat_feed: boolean;
};

// Device-side capability signals for the AntiVirus create/edit form. Mirror the reasons the
// real FortiGate GUI greys out these options: FortiSandbox connector configured, and an
// active FortiGuard AntiVirus subscription. Defaults fail-open (true) so a probe error never
// wrongly greys a toggle — the backend already fails-closed on real device errors.
export type AVCapabilities = {
  fortisandbox: boolean;          // "Send files to FortiSandbox for inspection"
  fortiguard_av_license: boolean; // "Use FortiGuard outbreak prevention database"
};

export const DeviceGetAVCapabilities = async (deviceId: number): Promise<AVCapabilities> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/antivirus-capabilities`);
    return {
      fortisandbox: !!res.data?.fortisandbox,
      fortiguard_av_license: !!res.data?.fortiguard_av_license,
    };
  } catch {
    return { fortisandbox: true, fortiguard_av_license: true };
  }
};

/**
 * Which form shape belongs to each security-profile category.
 *
 * The three calls below used to declare `payload: AVProfileForm` for all seven categories,
 * because AntiVirus was the first one to get a form and nothing was changed when the other six
 * arrived. The signature was therefore false for six of them, and every caller that was not
 * writing an AntiVirus profile had to add `as any` to get past it — eleven of those, including
 * one with a comment in FileFilterWizard.tsx explaining the lie.
 *
 * That is the shape of `any` worth removing: not a value nobody could type, but a signature that
 * was wrong and a cast per call site hiding it. The route itself is unchanged — the category is in
 * the URL and the payload is JSON — so this is a compile-time correction only.
 */
export type SecurityProfilePayloads = {
  "antivirus": AVProfileForm;
  "webfilter": WebFilterProfileForm;
  "dnsfilter": DNSFilterProfileForm;
  "application-control": AppControlProfileForm;
  "file-filter": FileFilterProfileForm;
  "ips": IPSSensorForm;
  "ssl-ssh-inspection": SSLSSHProfileForm;
};

export const DeviceGetSecurityProfile = async <C extends SecurityProfileCategory>(
  deviceId: number,
  category: C,
  name: string
): Promise<SecurityProfilePayloads[C] | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/${category}/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

export const DeviceCreateSecurityProfile = async <C extends SecurityProfileCategory>(
  deviceId: number,
  category: C,
  payload: SecurityProfilePayloads[C]
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/${category}`, payload);
};

export const DeviceUpdateSecurityProfile = async <C extends SecurityProfileCategory>(
  deviceId: number,
  category: C,
  name: string,
  payload: SecurityProfilePayloads[C]
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/${category}/${encodeURIComponent(name)}`, payload);
};

// ─── Web Filter Profile (create/update — full form) ──────────────────────────
// Field-for-field mirror of the backend's WebFilterProfileForm (see services/fortigate.go),
// which itself mirrors the toggles on FortiOS's own "New Web Filter Profile" page. Every
// mapping was verified against a live FortiGate 7.2.10.
export type WebFilterAction = "allow" | "monitor" | "block" | "warning" | "authenticate";

// One FortiGuard/local category and its chosen action (only non-"allow" ones are stored on
// the device as ftgd-wf.filters entries).
// `auth_groups` = the user group(s) allowed to authenticate past the category (ftgd-wf filters
// "auth-usr-grp"). FortiOS REQUIRES it when action is "authenticate" — without it the device
// returns error -149 and silently discards every category after the offending one.
export type WebFilterCategoryAction = {
  category: number;
  action: WebFilterAction;
  auth_groups?: string[];
};

// "Allow users to override blocked categories" expanded sub-form.
export type WebFilterOverride = {
  groups: string[];                             // Groups that can override (user groups)
  profiles: string[];                           // Profile Name — profiles users can switch to
  scope: "user" | "user-group" | "ip" | "ask";  // Switch applies to
  duration_mode: "predefined" | "ask";          // Switch Duration mode
  duration_days: number;
  duration_hours: number;
  duration_minutes: number;
};

export const EMPTY_WEBFILTER_OVERRIDE: WebFilterOverride = {
  groups: [], profiles: [], scope: "user", duration_mode: "predefined",
  duration_days: 0, duration_hours: 0, duration_minutes: 15,
};

// Static URL Filter · URL Filter table row (webfilter/urlfilter entries).
export type WebFilterURLType = "simple" | "regex" | "wildcard";
export type WebFilterURLEntryAction = "exempt" | "block" | "allow" | "monitor";
export type WebFilterURLEntry = {
  url: string;
  type: WebFilterURLType;
  action: WebFilterURLEntryAction;
  status: "enable" | "disable";
};

// Static URL Filter · Content Filter table row (webfilter/content entries). `pattern` maps to
// the CMDB "name" mkey; `score` defaults to 10 (the GUI default).
export type WebFilterContentPatternType = "wildcard" | "regexp";
export type WebFilterContentLang =
  | "western" | "simch" | "trach" | "japanese" | "korean" | "french" | "thai" | "spanish" | "cyrillic";
export type WebFilterContentEntry = {
  pattern: string;
  pattern_type: WebFilterContentPatternType;
  lang: WebFilterContentLang;
  action: "block" | "exempt";
  status: "enable" | "disable";
  score: number;
};

export type WebFilterProfileForm = {
  name: string;
  comment: string;

  fortiguard_category_filter: boolean;   // FortiGuard Category Based Filter (master)
  allow_override: boolean;               // Allow users to override blocked categories

  block_invalid_urls: boolean;           // Static URL Filter · Block invalid URLs
  url_filter: boolean;                   // Static URL Filter · URL Filter
  block_malicious_fortisandbox: boolean; // Static URL Filter · Block malicious URLs (FortiSandbox)
  content_filter: boolean;               // Static URL Filter · Content Filter

  allow_rating_error: boolean;           // Rating Options · Allow websites when a rating error occurs
  rate_by_domain_and_ip: boolean;        // Rating Options · Rate URLs by domain and IP Address

  http_post_action: "allow" | "block";   // Proxy Options · HTTP POST Action
  remove_cookies: boolean;               // Proxy Options · Remove Cookies

  categories: WebFilterCategoryAction[]; // FortiGuard Category Based Filter tree (non-allow only)
  override: WebFilterOverride;           // Allow-users-to-override sub-form

  url_filter_entries: WebFilterURLEntry[];         // URL Filter table rows
  content_filter_entries: WebFilterContentEntry[]; // Content Filter table rows
};

// One row of the FortiGuard category taxonomy (or a local category) for rendering the tree.
export type WebFilterCategoryMeta = {
  id: number;
  name: string;
  group: string;
  group_id: number;
  rating?: string;                  // G | PG-13 | R
  default_action?: string;          // monitor | block | warning | allow
  blocked_in_ratings?: string[];    // presets that block this category
};

// Everything the Web Filter form needs beyond the profile itself.
export type WebFilterMetadata = {
  categories: WebFilterCategoryMeta[];
  local_categories: WebFilterCategoryMeta[];
  web_filter_licensed: boolean;
  user_groups: string[];
  profiles: string[];
};

export const DeviceGetWebFilterMetadata = async (
  deviceId: number,
  self?: string
): Promise<WebFilterMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/webfilter-metadata`, {
      params: self ? { self } : undefined,
    });
    return {
      categories: res.data?.categories ?? [],
      local_categories: res.data?.local_categories ?? [],
      web_filter_licensed: !!res.data?.web_filter_licensed,
      user_groups: res.data?.user_groups ?? [],
      profiles: res.data?.profiles ?? [],
    };
  } catch {
    return { categories: [], local_categories: [], web_filter_licensed: true, user_groups: [], profiles: [] };
  }
};

export const DeviceGetWebFilterProfile = async (
  deviceId: number,
  name: string
): Promise<WebFilterProfileForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/webfilter/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

export const DeviceCreateWebFilterProfile = async (
  deviceId: number,
  payload: WebFilterProfileForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/webfilter`, payload);
};

export const DeviceUpdateWebFilterProfile = async (
  deviceId: number,
  name: string,
  payload: WebFilterProfileForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/webfilter/${encodeURIComponent(name)}`, payload);
};

// ─── DNS Filter Profile (create/update — full form) ──────────────────────────
// Field-for-field mirror of the backend's DNSFilterProfileForm (see services/fortigate.go),
// which mirrors the FortiOS "New DNS Filter Profile" page. Every mapping was verified against
// a live FortiGate 7.2.10.

// A category's action in the FortiGuard grid. "block" is what the GUI toolbar calls
// "Redirect to Block Portal".
//
// ⚠️ "allow" is stored by OMITTING the category — the backend drops allow rows before they
// reach the device. Never try to shortcut that: FortiOS answers HTTP 200 to action="allow"
// and silently stores "block" instead (verified live), i.e. it would block what you allowed.
export type DNSFilterAction = "allow" | "monitor" | "block";

export type DNSFilterCategoryAction = {
  category: number;
  action: DNSFilterAction;
};

// One row of the Static Domain Filter table.
export type DNSDomainEntry = {
  domain: string;
  type: "simple" | "regex" | "wildcard";
  action: "block" | "allow" | "monitor";
  status: "enable" | "disable";
};

// One row of the DNS Translation table (IPv4 only — see the backend type doc).
export type DNSTranslationEntry = {
  src: string;     // Original Destination
  dst: string;     // Translated Destination
  netmask: string; // Network Mask/Prefix
  status: "enable" | "disable";
};

export type DNSFilterProfileForm = {
  name: string;
  comment: string;

  redirect_botnet: boolean;
  safe_search: boolean;
  youtube_restrict: "strict" | "moderate";

  fortiguard_category_filter: boolean;
  categories: DNSFilterCategoryAction[]; // non-allow rows only

  domain_filter: boolean;
  domain_filter_entries: DNSDomainEntry[];

  external_ip_blocklist: boolean;
  external_ip_blocklist_names: string[];

  dns_translation: boolean;
  dns_translation_entries: DNSTranslationEntry[];

  use_default_redirect_portal: boolean;
  redirect_portal_ip: string;
  allow_rating_error: boolean;
  log_all_domains: boolean;
};

// Everything the DNS Filter form needs beyond the profile itself. The category tree is the
// SAME FortiGuard taxonomy the Web Filter form renders, so it reuses WebFilterCategoryMeta.
export type DNSFilterMetadata = {
  categories: WebFilterCategoryMeta[];
  web_filter_licensed: boolean;  // FortiGuard rating service — the grid does nothing without it
  botnet_licensed: boolean;      // botnet C&C package (ships with the AntiVirus/AVDB entitlement)
  external_resources: string[];  // system/external-resource names for External IP Block Lists
};

export const DeviceGetDNSFilterMetadata = async (deviceId: number): Promise<DNSFilterMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/dnsfilter-metadata`);
    return {
      categories: res.data?.categories ?? [],
      web_filter_licensed: !!res.data?.web_filter_licensed,
      botnet_licensed: !!res.data?.botnet_licensed,
      external_resources: res.data?.external_resources ?? [],
    };
  } catch {
    // Fail-open on the licence flags so a probe glitch never shows a false "unlicensed" banner.
    return { categories: [], web_filter_licensed: true, botnet_licensed: true, external_resources: [] };
  }
};

// The four list fields are normalised to arrays here. The device stores the Static Domain
// Filter rows in a SEPARATE table, so a profile whose Domain Filter is off (or whose table
// read failed) legitimately has no rows — and a null reaching the form would throw the moment
// the user switched that toggle on. The form is entitled to trust its own types.
export const DeviceGetDNSFilterProfile = async (
  deviceId: number,
  name: string
): Promise<DNSFilterProfileForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/dnsfilter/${encodeURIComponent(name)}`);
    if (!res.data) return null;
    return {
      ...res.data,
      categories: res.data.categories ?? [],
      domain_filter_entries: res.data.domain_filter_entries ?? [],
      external_ip_blocklist_names: res.data.external_ip_blocklist_names ?? [],
      dns_translation_entries: res.data.dns_translation_entries ?? [],
    };
  } catch { return null; }
};

export const DeviceCreateDNSFilterProfile = async (
  deviceId: number,
  payload: DNSFilterProfileForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/dnsfilter`, payload);
};

export const DeviceUpdateDNSFilterProfile = async (
  deviceId: number,
  name: string,
  payload: DNSFilterProfileForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/dnsfilter/${encodeURIComponent(name)}`, payload);
};

// ─── Application Control (Application Sensor — create/update, full form) ──────
// Field-for-field mirror of the backend's AppControlProfileForm (see services/fortigate.go),
// which mirrors the FortiOS "New Application Sensor" page. Verified against a live FortiGate 7.2.10.

// Per-tile / per-override action. "monitor"=pass+log, "allow"=pass+no-log, "block"=block,
// "quarantine"=block+quarantine attacker.
export type AppAction = "monitor" | "allow" | "block" | "quarantine";

// One Categories-grid tile: a FortiGuard application category and its chosen action.
export type AppCategoryAction = { category: number; action: AppAction };

// One Network Protocol Enforcement row (default-network-services entry).
export type AppNetworkService = {
  id: number;
  port: number;
  services: string[];          // http, ssh, telnet, ftp, dns, smtp, pop3, imap, snmp, nntp, https
  violation_action: "monitor" | "block"; // pass also accepted by the device
};

// One specific application signature referenced by an Application override.
export type AppSignatureRef = { id: number; name: string };

// One row of the "Application and Filter Overrides" table.
export type AppOverride = {
  type: "application" | "filter";
  action: AppAction;
  // application type
  applications: AppSignatureRef[];
  // filter type
  categories: number[];
  risk: number[];        // 1..5
  popularity: number[];  // 1..5
  technologies: string[];
  behaviors: string[];
  protocols: string[];
  vendors: string[];
};

export const EMPTY_APP_OVERRIDE: AppOverride = {
  type: "application", action: "block",
  applications: [], categories: [], risk: [], popularity: [],
  technologies: [], behaviors: [], protocols: [], vendors: [],
};

export type AppControlProfileForm = {
  name: string;
  comment: string;
  categories: AppCategoryAction[];
  unknown_application_action: AppAction;   // GUI "Unknown Applications" tile (no quarantine)
  network_protocol_enforcement: boolean;
  network_services: AppNetworkService[];
  overrides: AppOverride[];
  block_non_default_ports: boolean;        // "Block applications detected on non-default ports"
  allow_and_log_dns: boolean;              // "Allow and Log DNS Traffic"
  replacement_messages: boolean;           // "Replacement Messages for HTTP-based Applications"
};

// One application category tile in the taxonomy.
export type AppCategoryMeta = { id: number; name: string };
export type AppRiskLevel = { level: number; name: string };
export type AppSignatureMeta = {
  id: number; name: string; category: number;
  technology: string; popularity: number; risk: number; vendor: string;
};

// Everything the Application Control form needs beyond the profile itself.
export type AppControlMetadata = {
  categories: AppCategoryMeta[];
  applications: AppSignatureMeta[];  // signature DB (live when available, else bundled catalog)
  technologies: string[];
  behaviors: string[];
  protocols: string[];
  vendors: string[];
  risk_levels: AppRiskLevel[];
  app_db_source: "live" | "bundled" | "none";
};

export const EMPTY_APPCONTROL_METADATA: AppControlMetadata = {
  categories: [], applications: [], technologies: [], behaviors: [],
  protocols: [], vendors: [], risk_levels: [], app_db_source: "none",
};

export const DeviceGetAppControlMetadata = async (deviceId: number): Promise<AppControlMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/appcontrol-metadata`);
    const d = res.data ?? {};
    // Go marshals empty slices as null — coerce every list back to an array so the form is safe.
    return {
      categories: d.categories ?? [],
      applications: d.applications ?? [],
      technologies: d.technologies ?? [],
      behaviors: d.behaviors ?? [],
      protocols: d.protocols ?? [],
      vendors: d.vendors ?? [],
      risk_levels: d.risk_levels ?? [],
      app_db_source: d.app_db_source ?? "none",
    };
  } catch {
    return EMPTY_APPCONTROL_METADATA;
  }
};

export const DeviceGetAppControlProfile = async (
  deviceId: number,
  name: string
): Promise<AppControlProfileForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/application-control/${encodeURIComponent(name)}`);
    const d = res.data;
    if (!d) return null;
    // Coerce Go's null slices back to arrays and each override's nested lists.
    return {
      ...d,
      categories: d.categories ?? [],
      network_services: d.network_services ?? [],
      overrides: (d.overrides ?? []).map((o: AppOverride) => ({
        ...EMPTY_APP_OVERRIDE, ...o,
        applications: o.applications ?? [], categories: o.categories ?? [],
        risk: o.risk ?? [], popularity: o.popularity ?? [],
        technologies: o.technologies ?? [], behaviors: o.behaviors ?? [],
        protocols: o.protocols ?? [], vendors: o.vendors ?? [],
      })),
    };
  } catch { return null; }
};

export const DeviceCreateAppControlProfile = async (
  deviceId: number,
  payload: AppControlProfileForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/application-control`, payload);
};

export const DeviceUpdateAppControlProfile = async (
  deviceId: number,
  name: string,
  payload: AppControlProfileForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/application-control/${encodeURIComponent(name)}`, payload);
};

// ─── File Filter Profile (create/update — full form) ─────────────────────────
// Field-for-field mirror of the backend's FileFilterProfileForm (see services/fortigate.go),
// which mirrors the FortiOS "New File Filter Profile" page. Verified against a live FortiGate 7.2.10.

// One row of the profile's Rules table = the "Create New File Filter Rule" drawer.
export type FileFilterRule = {
  name: string;
  comment: string;
  protocols: string[];         // cifs, ftp, http, imap, pop3, smtp
  direction: "incoming" | "outgoing" | "any";
  password_protected: boolean; // "Password-protected only" toggle
  file_types: string[];        // antivirus.filetype names (required, ≥1)
  action: "monitor" | "block"; // GUI Monitor (CMDB log-only) | Block
};

export const EMPTY_FILE_FILTER_RULE: FileFilterRule = {
  name: "", comment: "",
  protocols: ["cifs", "ftp", "http", "imap", "pop3", "smtp"],
  direction: "any", password_protected: false, file_types: [], action: "monitor",
};

export type FileFilterProfileForm = {
  name: string;
  comment: string;
  scan_archive_contents: boolean;
  rules: FileFilterRule[];
};

// File-type catalogue + protocol option set the File Filter form needs.
export type FileFilterMetadata = {
  file_types: string[];
  protocols: string[];
  // The subset of file_types a rule may use once "Password-protected only" is on — the device
  // rejects anything else with "-3 entry not found in datasource".
  password_protected_file_types: string[];
};

export const EMPTY_FILE_FILTER_METADATA: FileFilterMetadata = {
  file_types: [], protocols: [], password_protected_file_types: [],
};

export const DeviceGetFileFilterMetadata = async (deviceId: number): Promise<FileFilterMetadata> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/filefilter-metadata`);
    const d = res.data ?? {};
    return {
      file_types: d.file_types ?? [],
      protocols: d.protocols ?? [],
      password_protected_file_types: d.password_protected_file_types ?? [],
    };
  } catch {
    return EMPTY_FILE_FILTER_METADATA;
  }
};

export const DeviceGetFileFilterProfile = async (
  deviceId: number,
  name: string
): Promise<FileFilterProfileForm | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/security-profiles/file-filter/${encodeURIComponent(name)}`);
    const d = res.data;
    if (!d) return null;
    // Coerce Go's null slices back to arrays.
    return {
      ...d,
      rules: (d.rules ?? []).map((r: FileFilterRule) => ({
        ...EMPTY_FILE_FILTER_RULE, ...r,
        protocols: r.protocols ?? [], file_types: r.file_types ?? [],
      })),
    };
  } catch { return null; }
};

export const DeviceCreateFileFilterProfile = async (
  deviceId: number,
  payload: FileFilterProfileForm
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/security-profiles/file-filter`, payload);
};

export const DeviceUpdateFileFilterProfile = async (
  deviceId: number,
  name: string,
  payload: FileFilterProfileForm
): Promise<void> => {
  await baseApi.patch(`${deviceBase(deviceId)}/security-profiles/file-filter/${encodeURIComponent(name)}`, payload);
};
