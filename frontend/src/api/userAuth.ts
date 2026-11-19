/**
 * User & Authentication — local users, groups, LDAP and RADIUS servers
 *
 * Carved out of api/policyObject.ts, which reached 2,391 lines carrying every device-proxy call in
 * the console. policyObject.ts re-exports this module, so the ~138 files that import from it keep
 * working unchanged; new code should import from here directly.
 */
import { baseApi } from "./http";
import { deviceBase, deviceList, type DeviceReadOpts } from "./deviceRequest";

// ─── User & Authentication ───────────────────────────────────────────────────
// Mirror the backend's FGUserDefinition / FGUserGroup (see services/fortigate.go).

export type UserDefinition = {
  name: string;
  type: string;        // LOCAL | RADIUS | TACACS+ | LDAP
  two_factor: boolean;
  groups: string[];
  enabled: boolean;
  ref: number;
};

// The 2FA modes the FortiGate creation wizard offers for a Local User.
export type LocalUserTwoFactor = "disable" | "fortitoken" | "fortitoken-cloud";

// LocalUserPayload is both the create/update body and the shape GET returns, so the edit form
// round-trips without a second mapping layer. `password` is write-only — the device never
// returns it, and a blank one on update means "keep the stored password".
export type LocalUserPayload = {
  name: string;
  type: "password";
  password?: string;
  two_factor: LocalUserTwoFactor;
  fortitoken?: string;
  email_to?: string;
  sms_enabled?: boolean;
  sms_country_code?: string;
  sms_phone?: string;
  status: boolean;
  groups?: string[];
};

export type LocalUserOptions = {
  fortitokens: string[]; // Token dropdown (user/fortitoken serial numbers)
  groups: string[];      // Extra Info → User Group picker
};

// The four FortiOS group-type values (user/group?action=schema).
export type UserGroupType = "firewall" | "fsso-service" | "rsso" | "guest";

export type UserGroup = {
  name: string;
  group_type: string;     // display label: Firewall | Fortinet Single Sign-On (FSSO) | …
  type_code: UserGroupType; // raw group-type — what the edit form switches on
  members: string[];
  ref: number;
};

// UserGroupPayload is both the create/update body and the shape GET returns, so the edit
// form can round-trip a group without a second mapping layer.
// One row of the "Remote Groups" table (user/group's `match`): users in <group_name> on the remote
// auth server <server_name> count as members of this local group. Firewall groups only.
export type UserGroupMatch = { server_name: string; group_name: string };

export type UserGroupPayload = {
  name: string;
  group_type: UserGroupType;
  members?: string[];
  matches?: UserGroupMatch[];
  sso_attribute_value?: string;
  // guest
  multiple_guest_add?: boolean;
  user_id?: "email" | "auto-generate" | "specify";
  max_accounts?: number;
  user_name?: boolean;
  email?: boolean;
  mobile_phone?: boolean;
  sms_server?: "fortiguard" | "custom";
  sms_custom_server?: string;
  password?: "auto-generate" | "specify" | "disable";
  sponsor?: "optional" | "mandatory" | "disabled";
  company?: "optional" | "mandatory" | "disabled";
  expire_type?: "immediately" | "first-successful-login";
  expire?: number; // seconds
};

// One selectable member in the "Select Entries" panel, tagged with its source table.
export type MemberOption = { name: string; source: string };

export type UserGroupOptions = {
  firewall: MemberOption[];   // members valid for a Firewall group
  fsso: MemberOption[];       // members valid for an FSSO group (user/adgrp)
  sms_servers: string[];      // system/sms-server names (Enable SMS → custom)
};

export const DeviceListUsers = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<UserDefinition[]> => {
  // The device row, as this console reads it.
  //
  // Partial<T> rather than T: these are FortiOS CMDB objects, so which keys come back depends on the
  // firmware and on how the object was created, and the mapper below defaults every one of them for
  // exactly that reason. It was `any`, which said the same thing while also promising that any
  // property name at all would be there — including one misspelt.
  const rows = await deviceList<Partial<UserDefinition>>(
    `${deviceBase(deviceId)}/users`, "Could not load users", opts);
  return rows.map((u) => ({
    name: u.name ?? "", type: u.type ?? "", two_factor: !!u.two_factor,
    groups: u.groups ?? [], enabled: !!u.enabled, ref: u.ref ?? 0,
  }));
};

// The wizard's datasources. Empty lists on failure so the form still renders.
export const DeviceGetLocalUserOptions = async (deviceId: number): Promise<LocalUserOptions> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/user-options`);
    return { fortitokens: res.data?.fortitokens ?? [], groups: res.data?.groups ?? [] };
  } catch { return { fortitokens: [], groups: [] }; }
};

export const DeviceGetUser = async (deviceId: number, name: string): Promise<LocalUserPayload | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/users/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

// Writes let errors propagate so the form can show the device's own message (duplicate = -5,
// still-referenced on delete = -23, bad FortiToken = -7522, …).
export const DeviceCreateUser = async (deviceId: number, payload: LocalUserPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/users`, payload);
};

export const DeviceUpdateUser = async (deviceId: number, name: string, payload: LocalUserPayload): Promise<void> => {
  await baseApi.put(`${deviceBase(deviceId)}/users/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteUser = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/users/${encodeURIComponent(name)}`);
};

export const DeviceListUserGroups = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<UserGroup[]> => {
  const rows = await deviceList<Partial<UserGroup>>(
    `${deviceBase(deviceId)}/user-groups`, "Could not load user groups", opts);
  return rows.map((g) => ({
    name: g.name ?? "", group_type: g.group_type ?? "",
    type_code: (g.type_code ?? "firewall") as UserGroupType,
    members: g.members ?? [], ref: g.ref ?? 0,
  }));
};

// The "Select Entries" datasource. Falls back to empty lists so the form still renders
// (and the user can still save a group with no members) if the fetch fails.
export const DeviceGetUserGroupOptions = async (deviceId: number): Promise<UserGroupOptions> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/user-group-options`);
    return {
      firewall: res.data?.firewall ?? [],
      fsso: res.data?.fsso ?? [],
      sms_servers: res.data?.sms_servers ?? [],
    };
  } catch { return { firewall: [], fsso: [], sms_servers: [] }; }
};

export const DeviceGetUserGroup = async (deviceId: number, name: string): Promise<UserGroupPayload | null> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/user-groups/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

// The three writes deliberately let errors propagate: the form shows the device's own
// message (duplicate name = -5, bad member = -3 entry not found in datasource, …).
export const DeviceCreateUserGroup = async (deviceId: number, payload: UserGroupPayload): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/user-groups`, payload);
};

export const DeviceUpdateUserGroup = async (deviceId: number, name: string, payload: UserGroupPayload): Promise<void> => {
  await baseApi.put(`${deviceBase(deviceId)}/user-groups/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteUserGroup = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/user-groups/${encodeURIComponent(name)}`);
};

// ─── LDAP Servers (user/ldap) ────────────────────────────────────────────────
// Mirrors the FortiGate "Edit LDAP Server" dialog. See services/fortigate_authserver.go for
// the GUI → CMDB field map; the four *_enabled booleans are the dialog's toggles.

export type LDAPBindType = "simple" | "anonymous" | "regular";
export type LDAPProtocol = "starttls" | "ldaps";

export type LDAPServer = {
  name: string;
  server: string;
  port: number;
  cnid: string;
  dn: string;
  bind_type: LDAPBindType;
  secure: "disable" | LDAPProtocol;
  ref: number;
};

// LDAPServerPayload is both the create/update body and the shape GET returns, so the edit form
// round-trips without a second mapping layer. `password` is write-only — the device answers
// "ENC XXXX", and a blank one on update means "keep the stored password".
export type LDAPServerPayload = {
  name: string;
  server: string;
  port: number;
  cnid: string;
  dn: string;
  exchange_enabled: boolean;
  exchange_server?: string;
  bind_type: LDAPBindType;
  username?: string;
  password?: string;
  secure_enabled: boolean;
  protocol?: LDAPProtocol;
  cert_enabled: boolean;
  ca_cert?: string;
  server_identity_check: boolean;
};

export type ExchangeConnector = {
  name: string;
  server_name: string;
  domain_name: string;
  username: string;
};

// The "New External Connector" dialog. The GUI's single "Exchange account" field is split into
// username / server_name / domain_name by the form (splitExchangeAccount) so the derived values
// can be shown before saving.
export type ExchangeConnectorPayload = {
  name: string;
  username: string;
  server_name: string;
  domain_name: string;
  password: string;
  override_ip: boolean;
  ip?: string;
  auto_discover_kdc: boolean;
};

export type LDAPServerOptions = {
  ca_certs: string[];                     // Certificate dropdown (vpn.certificate.ca)
  exchange_servers: ExchangeConnector[];  // Exchange server dropdown (user/exchange)
  // FortiOS 7.2.10 has no monitor endpoint for LDAP, so Test Connectivity / Test User
  // Credentials / the DN Browse button render disabled. The backend reports it rather than the
  // UI guessing, so a newer firmware only needs a backend change.
  supports_ldap_test: boolean;
  supports_dn_browser: boolean;
};

const ldapBase = (deviceId: number) => `${deviceBase(deviceId)}/ldap-servers`;

export const DeviceListLDAPServers = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<LDAPServer[]> => {
  const rows = await deviceList<Partial<LDAPServer>>(ldapBase(deviceId), "Could not load LDAP servers", opts);
  return rows.map((s) => ({
    name: s.name ?? "", server: s.server ?? "", port: s.port ?? 389,
    cnid: s.cnid ?? "", dn: s.dn ?? "",
    bind_type: (s.bind_type ?? "simple") as LDAPBindType,
    secure: (s.secure ?? "disable") as LDAPServer["secure"],
    ref: s.ref ?? 0,
  }));
};

// The form's datasources. Empty lists on failure so the form still renders and can be saved.
export const DeviceGetLDAPServerOptions = async (deviceId: number): Promise<LDAPServerOptions> => {
  try {
    const res = await baseApi.get(`${deviceBase(deviceId)}/ldap-server-options`);
    return {
      ca_certs: res.data?.ca_certs ?? [],
      exchange_servers: res.data?.exchange_servers ?? [],
      supports_ldap_test: !!res.data?.supports_ldap_test,
      supports_dn_browser: !!res.data?.supports_dn_browser,
    };
  } catch { return { ca_certs: [], exchange_servers: [], supports_ldap_test: false, supports_dn_browser: false }; }
};

export const DeviceGetLDAPServer = async (
  deviceId: number, name: string
): Promise<LDAPServerPayload | null> => {
  try {
    const res = await baseApi.get(`${ldapBase(deviceId)}/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

// The writes let errors propagate so the form can show the device's own message
// (duplicate name = -5, unknown CA cert / Exchange connector = -3, still referenced = -23).
export const DeviceCreateLDAPServer = async (deviceId: number, payload: LDAPServerPayload): Promise<void> => {
  await baseApi.post(ldapBase(deviceId), payload);
};

export const DeviceUpdateLDAPServer = async (
  deviceId: number, name: string, payload: LDAPServerPayload
): Promise<void> => {
  await baseApi.put(`${ldapBase(deviceId)}/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteLDAPServer = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${ldapBase(deviceId)}/${encodeURIComponent(name)}`);
};

export const DeviceCreateExchangeConnector = async (
  deviceId: number, payload: ExchangeConnectorPayload
): Promise<void> => {
  await baseApi.post(`${deviceBase(deviceId)}/exchange-connectors`, payload);
};

export const DeviceDeleteExchangeConnector = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${deviceBase(deviceId)}/exchange-connectors/${encodeURIComponent(name)}`);
};

// ─── RADIUS Servers (user/radius) ────────────────────────────────────────────
// One user/radius object holds the primary + secondary host the GUI dialog collects.

export type RADIUSAuthType = "auto" | "ms_chap_v2" | "ms_chap" | "chap" | "pap";
export type RADIUSOrdinal = "primary" | "secondary";

export type RADIUSServer = {
  name: string;
  server: string;
  secondary_server: string;
  auth_type: RADIUSAuthType;
  nas_ip: string;
  all_usergroup: boolean;
  ref: number;
};

// Mirrors the FortiGate "New RADIUS Server" dialog: one object, a Primary and a Secondary host.
// (user/radius also has tertiary-* and timeout; the GUI hides them, so this form omits both keys
// and leaves whatever the CLI set.) Blank optional keys are OMITTED, never sent as "": the
// secrets are write-only (blank = "keep the stored one") and the address fields are rejected
// outright by FortiOS when empty (-257) — so removing a secondary host is CLI-only, see
// RADIUS_BACKUP_CLEAR_NOTE in radius-server-form.tsx.
export type RADIUSServerPayload = {
  name: string;
  auth_method_specify: boolean;
  auth_type: RADIUSAuthType;
  nas_ip?: string;
  all_usergroup: boolean;
  server: string;
  secret?: string;
  secondary_server?: string;
  secondary_secret?: string;
};

// What the device's own "Test Connectivity" / "Test User Credentials" buttons return
// (monitor/user/radius/test-connect — the only auth-server test endpoint on 7.2.10).
export type RADIUSTestResult = {
  status: string;          // successful | unreachable | …
  access_status: string;   // "Access-Accept", "Unknown Response", …
  access_message: string;  // the server's Reply-Message, when it sends one
};

const radiusBase = (deviceId: number) => `${deviceBase(deviceId)}/radius-servers`;

export const DeviceListRADIUSServers = async (
  deviceId: number, opts?: DeviceReadOpts
): Promise<RADIUSServer[]> => {
  const rows = await deviceList<Partial<RADIUSServer>>(radiusBase(deviceId), "Could not load RADIUS servers", opts);
  return rows.map((s) => ({
    name: s.name ?? "", server: s.server ?? "",
    secondary_server: s.secondary_server ?? "",
    auth_type: (s.auth_type ?? "auto") as RADIUSAuthType,
    nas_ip: s.nas_ip ?? "", all_usergroup: !!s.all_usergroup, ref: s.ref ?? 0,
  }));
};

export const DeviceGetRADIUSServer = async (
  deviceId: number, name: string
): Promise<RADIUSServerPayload | null> => {
  try {
    const res = await baseApi.get(`${radiusBase(deviceId)}/${encodeURIComponent(name)}`);
    return res.data ?? null;
  } catch { return null; }
};

export const DeviceCreateRADIUSServer = async (deviceId: number, payload: RADIUSServerPayload): Promise<void> => {
  await baseApi.post(radiusBase(deviceId), payload);
};

export const DeviceUpdateRADIUSServer = async (
  deviceId: number, name: string, payload: RADIUSServerPayload
): Promise<void> => {
  await baseApi.put(`${radiusBase(deviceId)}/${encodeURIComponent(name)}`, payload);
};

export const DeviceDeleteRADIUSServer = async (deviceId: number, name: string): Promise<void> => {
  await baseApi.delete(`${radiusBase(deviceId)}/${encodeURIComponent(name)}`);
};

// Runs against a SAVED server (the monitor API keys off the stored object by name). Passing
// user+password turns the connectivity test into the "Test User Credentials" check.
export const DeviceTestRADIUSServer = async (
  deviceId: number, name: string, ordinal: RADIUSOrdinal, user?: string, password?: string
): Promise<RADIUSTestResult> => {
  const res = await baseApi.post(`${radiusBase(deviceId)}/${encodeURIComponent(name)}/test`,
    { ordinal, user: user ?? "", password: password ?? "" });
  return {
    status: res.data?.status ?? "",
    access_status: res.data?.access_status ?? "",
    access_message: res.data?.access_message ?? "",
  };
};
