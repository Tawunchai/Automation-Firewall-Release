import type {
  SNMPCommunity, SNMPCommunityPayload, SNMPHost,
  SNMPSecurityLevel, SNMPUser, SNMPUserPayload,
} from "../../api/snmp";

// Form state ↔ API payload for the two SNMP dialogs.
//
// Kept out of the components for the usual reason — these conversions are where a password gets
// cleared or a host silently dropped, and they are worth testing without rendering anything.

/** One row of the Hosts repeater. `id` is 0 until the device has assigned one. */
export type HostRow = { id: number; ip: string; host_type: string };

export type CommunityForm = {
  name: string;
  status: boolean;
  hosts: HostRow[];
  query_v1_status: boolean;
  query_v1_port: string;
  query_v2c_status: boolean;
  query_v2c_port: string;
  trap_v1_status: boolean;
  trap_v1_lport: string;
  trap_v1_rport: string;
  trap_v2c_status: boolean;
  trap_v2c_lport: string;
  trap_v2c_rport: string;
  events: string[];
};

export type UserForm = {
  name: string;
  status: boolean;
  security_level: SNMPSecurityLevel;
  auth_proto: string;
  auth_pwd: string;
  priv_proto: string;
  priv_pwd: string;
  notify_hosts: HostRow[];
  queries: boolean;
  query_port: string;
  trap_status: boolean;
  trap_lport: string;
  trap_rport: string;
  events: string[];
};

/** Ports are held as strings so a half-typed field is not coerced to 0 mid-keystroke. */
const num = (v: string, fallback: number): number => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const blankHost = (): HostRow => ({ id: 0, ip: "", host_type: "any" });

/**
 * The defaults FortiGate's own "New SNMP Community" dialog opens with: everything enabled, the
 * standard ports, and every event subscribed EXCEPT the two FortiOS itself leaves off.
 *
 * Those two exceptions are not a style choice — `fm-conf-change` and `device-new` are off in the
 * device's own default value, and a console that turned them on by default would be adding two
 * trap subscriptions nobody asked for every time somebody clicked Create.
 */
export const COMMUNITY_DEFAULT_OFF_EVENTS = ["fm-conf-change", "device-new"];

export const emptyCommunityForm = (allEvents: string[]): CommunityForm => ({
  name: "",
  status: true,
  hosts: [blankHost()],
  query_v1_status: true,
  query_v1_port: "161",
  query_v2c_status: true,
  query_v2c_port: "161",
  trap_v1_status: true,
  trap_v1_lport: "162",
  trap_v1_rport: "162",
  trap_v2c_status: true,
  trap_v2c_lport: "162",
  trap_v2c_rport: "162",
  events: allEvents.filter((e) => !COMMUNITY_DEFAULT_OFF_EVENTS.includes(e)),
});

export const communityToForm = (c: SNMPCommunity): CommunityForm => ({
  name: c.name,
  status: c.status,
  // A community with no hosts cannot be saved, so the form always offers one empty row to fill.
  hosts: c.hosts.length > 0
    ? c.hosts.map((h) => ({ id: h.id, ip: h.ip, host_type: h.host_type || "any" }))
    : [blankHost()],
  query_v1_status: c.query_v1_status,
  query_v1_port: String(c.query_v1_port || 161),
  query_v2c_status: c.query_v2c_status,
  query_v2c_port: String(c.query_v2c_port || 161),
  trap_v1_status: c.trap_v1_status,
  trap_v1_lport: String(c.trap_v1_lport || 162),
  trap_v1_rport: String(c.trap_v1_rport || 162),
  trap_v2c_status: c.trap_v2c_status,
  trap_v2c_lport: String(c.trap_v2c_lport || 162),
  trap_v2c_rport: String(c.trap_v2c_rport || 162),
  events: [...c.events],
});

export const communityToPayload = (f: CommunityForm): SNMPCommunityPayload => ({
  name: f.name.trim(),
  status: f.status,
  hosts: f.hosts
    .filter((h) => h.ip.trim() !== "")
    .map((h): Partial<SNMPHost> => ({ id: h.id, ip: h.ip.trim(), host_type: h.host_type || "any" })),
  query_v1_status: f.query_v1_status,
  query_v1_port: num(f.query_v1_port, 161),
  query_v2c_status: f.query_v2c_status,
  query_v2c_port: num(f.query_v2c_port, 161),
  trap_v1_status: f.trap_v1_status,
  trap_v1_lport: num(f.trap_v1_lport, 162),
  trap_v1_rport: num(f.trap_v1_rport, 162),
  trap_v2c_status: f.trap_v2c_status,
  trap_v2c_lport: num(f.trap_v2c_lport, 162),
  trap_v2c_rport: num(f.trap_v2c_rport, 162),
  events: f.events,
});

export const emptyUserForm = (allEvents: string[]): UserForm => ({
  name: "",
  status: true,
  security_level: "no-auth-no-priv",
  auth_proto: "sha",
  auth_pwd: "",
  priv_proto: "aes",
  priv_pwd: "",
  notify_hosts: [blankHost()],
  queries: true,
  query_port: "161",
  trap_status: true,
  trap_lport: "162",
  trap_rport: "162",
  events: allEvents.filter((e) => !COMMUNITY_DEFAULT_OFF_EVENTS.includes(e)),
});

export const userToForm = (u: SNMPUser): UserForm => ({
  name: u.name,
  status: u.status,
  security_level: u.security_level || "no-auth-no-priv",
  auth_proto: u.auth_proto || "sha",
  // Always blank. The device never returns a password — only the fact that one exists — and
  // prefilling anything here would turn "I did not touch it" into a password change.
  auth_pwd: "",
  priv_proto: u.priv_proto || "aes",
  priv_pwd: "",
  notify_hosts: u.notify_hosts.length > 0
    ? u.notify_hosts.map((ip) => ({ id: 0, ip, host_type: "any" }))
    : [blankHost()],
  queries: u.queries,
  query_port: String(u.query_port || 161),
  trap_status: u.trap_status,
  trap_lport: String(u.trap_lport || 162),
  trap_rport: String(u.trap_rport || 162),
  events: [...u.events],
});

/**
 * Builds the v3 user write.
 *
 * The password rule is the whole reason this is a function and not a spread: a blank box means
 * "leave the stored password alone", so the key is OMITTED rather than sent empty. Sending `""`
 * would be the console replacing a working credential with nothing on every unrelated edit — and
 * the backend refuses it for that reason, so getting this wrong is a failed save, not a silent
 * loss. Fields the security level does not use are dropped here too, matching what the device
 * accepts at that level.
 */
export const userToPayload = (f: UserForm): SNMPUserPayload => {
  const needsAuth = f.security_level === "auth-no-priv" || f.security_level === "auth-priv";
  const needsPriv = f.security_level === "auth-priv";

  const payload: SNMPUserPayload = {
    name: f.name.trim(),
    status: f.status,
    security_level: f.security_level,
    auth_proto: needsAuth ? f.auth_proto : "",
    priv_proto: needsPriv ? f.priv_proto : "",
    notify_hosts: f.notify_hosts.map((h) => h.ip.trim()).filter((ip) => ip !== ""),
    queries: f.queries,
    query_port: num(f.query_port, 161),
    trap_status: f.trap_status,
    trap_lport: num(f.trap_lport, 162),
    trap_rport: num(f.trap_rport, 162),
    events: f.events,
  };
  if (needsAuth && f.auth_pwd.trim() !== "") payload.auth_pwd = f.auth_pwd;
  if (needsPriv && f.priv_pwd.trim() !== "") payload.priv_pwd = f.priv_pwd;
  return payload;
};

/**
 * What the form refuses before anything reaches the device, in the order the operator reads the
 * dialog. Empty string means it is fine to save.
 *
 * `editing` is what makes the password rule correct: on a create there is nothing stored to fall
 * back on, so an auth level without a password cannot be saved; on an edit a blank box is the
 * normal case and means "keep it".
 */
export const validateUserForm = (f: UserForm, editing: boolean): string => {
  if (f.name.trim() === "") return "A user name is required";
  const needsAuth = f.security_level === "auth-no-priv" || f.security_level === "auth-priv";
  const needsPriv = f.security_level === "auth-priv";
  if (needsAuth && !editing && f.auth_pwd.trim() === "") {
    return "An authentication password is required at this security level";
  }
  if (needsPriv && !editing && f.priv_pwd.trim() === "") {
    return "A privacy password is required at this security level";
  }
  if (f.trap_status && f.notify_hosts.every((h) => h.ip.trim() === "")) {
    return "Traps are enabled but no notify host is set — add a host or turn traps off";
  }
  return "";
};

export const validateCommunityForm = (f: CommunityForm): string => {
  if (f.name.trim() === "") return "A community name is required";
  if (f.hosts.every((h) => h.ip.trim() === "")) {
    return "At least one host is required — a community with no hosts answers any address";
  }
  return "";
};

/** "Enable"/"Disable" for a table cell, matching FortiGate's own wording. */
export const onOff = (v: boolean) => (v ? "Enable" : "Disable");

/** The Hosts column of both tables: the addresses, or an explicit note that there are none. */
export const hostSummary = (ips: string[]): string => (ips.length > 0 ? ips.join(", ") : "—");
