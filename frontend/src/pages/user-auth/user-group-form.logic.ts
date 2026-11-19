// The non-component half of the User Group dialog: form state, validation, the CMDB payload
// mapping and the datasource hook.
//
// Split out of user-group-form.tsx because a module that exports both a component and a pile of
// helpers breaks React Fast Refresh — editing one helper reloads the whole route instead of
// swapping the component in place (eslint react-refresh/only-export-components). The component
// stays next door and imports from here; the tests and the two page shells import from here too.
import { useEffect, useState } from "react";
import {
  DeviceGetUserGroupOptions,
  type MemberOption, type UserGroupOptions, type UserGroupPayload, type UserGroupType,
  type UserGroupMatch,
} from "../../api/policyObject";

// Form state for the FortiGate "New User Group" dialog. One flat shape covers all four
// group types; buildUserGroupPayload() emits only the fields the chosen type actually uses.
export type UserGroupFormState = {
  name: string;
  groupType: UserGroupType;
  members: string[];
  // "Remote Groups" — which group ON a remote auth server counts as membership here.
  matches: UserGroupMatch[];
  // rsso
  ssoAttributeValue: string;
  // guest
  multipleGuestAdd: boolean;                              // "Batch Guest Account Creation"
  userId: "email" | "auto-generate" | "specify";
  maxAccountsEnabled: boolean;                            // toggle; off ⇒ max_accounts 0 (unlimited)
  maxAccounts: string;
  userName: boolean;                                      // "Enable Name"
  email: boolean;                                         // "Enable Email"
  mobilePhone: boolean;                                   // "Enable SMS"
  smsServer: "fortiguard" | "custom";
  smsCustomServer: string;
  passwordEnabled: boolean;                               // Password toggle; off ⇒ password "disable"
  password: "auto-generate" | "specify";
  sponsorEnabled: boolean;                                // off ⇒ sponsor "disabled"
  sponsor: "optional" | "mandatory";
  companyEnabled: boolean;                                // off ⇒ company "disabled"
  company: "optional" | "mandatory";
  expireType: "immediately" | "first-successful-login";   // "Start Countdown"
  expireDays: string;
  expireHours: string;
  expireMinutes: string;
  expireSeconds: string;
};

// Defaults mirror the FortiGate dialog's initial state, which is also the CMDB schema's
// defaults: user-id=email, password=auto-generate, email=enable, sponsor/company=optional,
// expire-type=immediately, expire=14400s (= 4 hours, what the GUI pre-fills).
export const BLANK_USER_GROUP_FORM: UserGroupFormState = {
  name: "",
  groupType: "firewall",
  members: [],
  matches: [],
  ssoAttributeValue: "",
  multipleGuestAdd: false,
  userId: "email",
  maxAccountsEnabled: false,
  maxAccounts: "0",
  userName: false,
  email: true,
  mobilePhone: false,
  smsServer: "fortiguard",
  smsCustomServer: "",
  passwordEnabled: true,
  password: "auto-generate",
  sponsorEnabled: true,
  sponsor: "optional",
  companyEnabled: true,
  company: "optional",
  expireType: "immediately",
  expireDays: "0",
  expireHours: "4",
  expireMinutes: "0",
  expireSeconds: "0",
};

export const GROUP_TYPE_OPTIONS: { v: UserGroupType; l: string }[] = [
  { v: "firewall",     l: "Firewall" },
  { v: "fsso-service", l: "Fortinet Single Sign-On (FSSO)" },
  { v: "rsso",         l: "RADIUS Single Sign-On (RSSO)" },
  { v: "guest",        l: "Guest" },
];

// Only Firewall and FSSO groups have a Members list. The device SILENTLY DROPS a member list
// sent with group-type guest or rsso (verified live: HTTP 200, member stored as []), so the
// form hides the picker rather than offering a control that does nothing.
export const takesMembers = (t: UserGroupType) => t === "firewall" || t === "fsso-service";

// Only a Firewall group can carry the Remote Groups table. Verified live: a guest/rsso group
// answers 200 and stores match=[], and an fsso-service group cannot even hold the LDAP server as a
// member (its members are user/adgrp), so a match on one is impossible.
export const takesMatches = (t: UserGroupType) => t === "firewall";

// The member sources that are remote AUTH SERVERS — the only ones a match row can name. Local
// users, PKI peers and certificates have no group directory to match against.
const REMOTE_SOURCES = new Set(["RADIUS", "LDAP", "TACACS+", "SAML"]);
export const remoteServerOptions = (o: UserGroupOptions): MemberOption[] =>
  o.firewall.filter((m) => REMOTE_SOURCES.has(m.source));

const EXPIRE_MIN = 1;
const EXPIRE_MAX = 31536000; // FortiOS cap: 1 year in seconds
export const MAX_ACCOUNTS_MAX = 500;

export const num = (s: string) => { const n = Number(s); return Number.isFinite(n) ? n : 0; };

export const expireToSeconds = (f: UserGroupFormState): number =>
  num(f.expireDays) * 86400 + num(f.expireHours) * 3600 + num(f.expireMinutes) * 60 + num(f.expireSeconds);

export function validateUserGroupForm(f: UserGroupFormState): Record<string, string> {
  const errs: Record<string, string> = {};
  const name = f.name.trim();
  if (!name) errs.name = "Name is required";
  else if (name.length > 35) errs.name = "Name must be 35 characters or fewer";

  if (f.groupType === "rsso" && !f.ssoAttributeValue.trim()) {
    errs.ssoAttributeValue = "RADIUS Attribute Value is required";
  }

  if (takesMatches(f.groupType)) {
    const seen = new Set<string>();
    f.matches.forEach((m, i) => {
      const server = m.server_name.trim();
      const group = m.group_name.trim();
      if (!server) errs[`match.${i}.server`] = "Select a remote server";
      if (!group) errs[`match.${i}.group`] = "Remote group name is required";
      else if (group.length > 511) errs[`match.${i}.group`] = "Remote group name must be 511 characters or fewer";
      // FortiOS keys the table by id, so a repeated pair silently collapses into one row.
      const key = `${server}\u0000${group}`;
      if (server && group && seen.has(key)) errs[`match.${i}.group`] = "This remote group is already listed for that server";
      seen.add(key);
    });
  }

  if (f.groupType === "guest") {
    const secs = expireToSeconds(f);
    if (secs < EXPIRE_MIN) errs.expire = "Expiration must be at least 1 second";
    else if (secs > EXPIRE_MAX) errs.expire = "Expiration cannot exceed 365 days";

    if (f.maxAccountsEnabled) {
      const m = num(f.maxAccounts);
      if (m < 1 || m > MAX_ACCOUNTS_MAX) errs.maxAccounts = `Maximum Accounts must be 1-${MAX_ACCOUNTS_MAX}`;
    }
    // Guest Details only exist when batch mode is off (the device ignores them otherwise).
    if (!f.multipleGuestAdd && f.mobilePhone && f.smsServer === "custom" && !f.smsCustomServer.trim()) {
      errs.smsCustomServer = "Select a custom SMS server, or use FortiGuard";
    }
  }
  return errs;
}

export function buildUserGroupPayload(f: UserGroupFormState): UserGroupPayload {
  const p: UserGroupPayload = { name: f.name.trim(), group_type: f.groupType };

  if (takesMembers(f.groupType)) {
    p.members = f.members;
    if (takesMatches(f.groupType) && f.matches.length > 0) {
      p.matches = f.matches.map((m) => ({
        server_name: m.server_name.trim(),
        group_name: m.group_name.trim(),
      }));
    }
    return p;
  }
  if (f.groupType === "rsso") {
    p.sso_attribute_value = f.ssoAttributeValue.trim();
    return p;
  }
  // guest
  p.multiple_guest_add = f.multipleGuestAdd;
  p.max_accounts = f.maxAccountsEnabled ? num(f.maxAccounts) : 0; // 0 = unlimited
  p.expire_type = f.expireType;
  p.expire = expireToSeconds(f);

  // Under batch mode FortiOS forces user-id/password to auto-generate and resets the rest of
  // the Guest Details to defaults — sending them is a silent no-op, so we omit them and the
  // form hides that section too.
  if (!f.multipleGuestAdd) {
    p.user_id = f.userId;
    p.password = f.passwordEnabled ? f.password : "disable";
    p.user_name = f.userName;
    p.email = f.email;
    p.mobile_phone = f.mobilePhone;
    p.sponsor = f.sponsorEnabled ? f.sponsor : "disabled";
    p.company = f.companyEnabled ? f.company : "disabled";
    if (f.mobilePhone) {
      p.sms_server = f.smsServer;
      if (f.smsServer === "custom") p.sms_custom_server = f.smsCustomServer.trim();
    }
  }
  return p;
}

export function userGroupToForm(g: UserGroupPayload): UserGroupFormState {
  const secs = g.expire ?? 14400;
  return {
    ...BLANK_USER_GROUP_FORM,
    name: g.name ?? "",
    groupType: (g.group_type ?? "firewall") as UserGroupType,
    members: g.members ?? [],
    matches: g.matches ?? [],
    ssoAttributeValue: g.sso_attribute_value ?? "",
    multipleGuestAdd: !!g.multiple_guest_add,
    userId: g.user_id ?? "email",
    maxAccountsEnabled: (g.max_accounts ?? 0) > 0,
    maxAccounts: String(g.max_accounts ?? 0),
    userName: !!g.user_name,
    email: !!g.email,
    mobilePhone: !!g.mobile_phone,
    smsServer: g.sms_server ?? "fortiguard",
    smsCustomServer: g.sms_custom_server ?? "",
    passwordEnabled: (g.password ?? "auto-generate") !== "disable",
    password: g.password === "specify" ? "specify" : "auto-generate",
    sponsorEnabled: (g.sponsor ?? "optional") !== "disabled",
    sponsor: g.sponsor === "mandatory" ? "mandatory" : "optional",
    companyEnabled: (g.company ?? "optional") !== "disabled",
    company: g.company === "mandatory" ? "mandatory" : "optional",
    expireType: g.expire_type ?? "immediately",
    expireDays: String(Math.floor(secs / 86400)),
    expireHours: String(Math.floor((secs % 86400) / 3600)),
    expireMinutes: String(Math.floor((secs % 3600) / 60)),
    expireSeconds: String(secs % 60),
  };
}

// ─── Datasource hook ───────────────────────────────────────────────────────────
export function useUserGroupOptions(deviceId: number | null | undefined) {
  // `loadedFor` is the device the options in hand came from. Keeping it alongside them — rather
  // than a separate `loading` flag set at the top of the effect — means loading is derived, and a
  // late answer for a device the operator has already switched away from cannot be mistaken for
  // the current one.
  const [state, setState] = useState<{ options: UserGroupOptions; loadedFor: number | null }>({
    options: { firewall: [], fsso: [], sms_servers: [] },
    loadedFor: null,
  });

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceGetUserGroupOptions(deviceId)
      .then((options) => { if (alive) setState({ options, loadedFor: deviceId }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loadedFor: deviceId })); });
    return () => { alive = false; };
  }, [deviceId]);

  return { options: state.options, loading: Boolean(deviceId) && state.loadedFor !== deviceId };
}

