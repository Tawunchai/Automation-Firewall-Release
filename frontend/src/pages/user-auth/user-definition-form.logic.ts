// The pure half of user-definition-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { useEffect, useState } from "react";
import { DeviceGetLocalUserOptions, type LocalUserOptions, type LocalUserPayload, type LocalUserTwoFactor } from "../../api/policyObject";

export type LocalUserFormState = {
  // 1 User Type
  userType: "password";
  // 2 Login Credentials
  name: string;
  password: string;
  // 3 Contact Info
  twoFactorEnabled: boolean;
  authType: "fortitoken-cloud" | "fortitoken";
  fortitoken: string;
  emailTo: string;
  smsEnabled: boolean;
  smsCountryCode: string;
  smsPhone: string;
  // 4 Extra Info
  status: boolean;
  groupEnabled: boolean;
  groups: string[];
};

export const BLANK_LOCAL_USER_FORM: LocalUserFormState = {
  userType: "password",
  name: "",
  password: "",
  twoFactorEnabled: false,
  authType: "fortitoken-cloud", // the wizard's default selection
  fortitoken: "",
  emailTo: "",
  smsEnabled: false,
  smsCountryCode: "",
  smsPhone: "",
  status: true,
  groupEnabled: false,
  groups: [],
};

export const USER_TYPE_OPTIONS: { v: string; l: string; enabled: boolean }[] = [
  { v: "password", l: "Local User",          enabled: true },
  { v: "radius",   l: "Remote RADIUS User",  enabled: false },
  { v: "tacacs+",  l: "Remote TACACS+ User", enabled: false },
  { v: "ldap",     l: "Remote LDAP User",    enabled: false },
  { v: "fsso",     l: "FSSO",                enabled: false },
  { v: "fortinac", l: "FortiNAC User",       enabled: false },
];

export const COUNTRY_DIAL_CODES: { code: string; name: string }[] = [
  { code: "+66", name: "Thailand" },
  { code: "+1", name: "United States / Canada" },
  { code: "+7", name: "Russia / Kazakhstan" },
  { code: "+20", name: "Egypt" },
  { code: "+27", name: "South Africa" },
  { code: "+31", name: "Netherlands" },
  { code: "+33", name: "France" },
  { code: "+34", name: "Spain" },
  { code: "+39", name: "Italy" },
  { code: "+44", name: "United Kingdom" },
  { code: "+49", name: "Germany" },
  { code: "+52", name: "Mexico" },
  { code: "+55", name: "Brazil" },
  { code: "+60", name: "Malaysia" },
  { code: "+61", name: "Australia" },
  { code: "+62", name: "Indonesia" },
  { code: "+63", name: "Philippines" },
  { code: "+64", name: "New Zealand" },
  { code: "+65", name: "Singapore" },
  { code: "+81", name: "Japan" },
  { code: "+82", name: "South Korea" },
  { code: "+84", name: "Vietnam" },
  { code: "+86", name: "China" },
  { code: "+90", name: "Turkey" },
  { code: "+91", name: "India" },
  { code: "+92", name: "Pakistan" },
  { code: "+95", name: "Myanmar" },
  { code: "+351", name: "Portugal" },
  { code: "+352", name: "Luxembourg" },
  { code: "+353", name: "Ireland" },
  { code: "+356", name: "Malta" },
  { code: "+358", name: "Finland" },
  { code: "+41", name: "Switzerland" },
  { code: "+43", name: "Austria" },
  { code: "+45", name: "Denmark" },
  { code: "+46", name: "Sweden" },
  { code: "+47", name: "Norway" },
  { code: "+48", name: "Poland" },
  { code: "+56", name: "Chile" },
  { code: "+57", name: "Colombia" },
  { code: "+800", name: "International Freephone" },
  { code: "+852", name: "Hong Kong" },
  { code: "+853", name: "Macau" },
  { code: "+855", name: "Cambodia" },
  { code: "+856", name: "Laos" },
  { code: "+880", name: "Bangladesh" },
  { code: "+886", name: "Taiwan" },
  { code: "+960", name: "Maldives" },
  { code: "+962", name: "Jordan" },
  { code: "+966", name: "Saudi Arabia" },
  { code: "+971", name: "United Arab Emirates" },
  { code: "+972", name: "Israel" },
  { code: "+974", name: "Qatar" },
  { code: "+977", name: "Nepal" },
];

export const NAME_MAX = 64;

export const WIZARD_STEPS = ["User Type", "Login Credentials", "Contact Info", "Extra Info"];

export function validateStep(step: number, f: LocalUserFormState): Record<string, string> {
  const e: Record<string, string> = {};
  switch (step) {
    case 0:
      if (f.userType !== "password") e.userType = "Only Local User is supported";
      break;
    case 1: {
      const n = f.name.trim();
      if (!n) e.name = "Username is required";
      else if (n.length > NAME_MAX) e.name = `Username must be ${NAME_MAX} characters or fewer`;
      if (!f.password) e.password = "Password is required";
      break;
    }
    case 2:
      if (f.twoFactorEnabled) {
        // Every rule here is the device's, confirmed live:
        //   · FortiToken with no serial            ⇒ -7522 "Invalid fortitoken id"
        //   · ANY 2FA with no email AND no SMS     ⇒ -7524 "You must specify a phone number or
        //     email address" (either channel satisfies it)
        if (f.authType === "fortitoken" && !f.fortitoken) e.fortitoken = "This field is required.";
        if (f.emailTo.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.emailTo.trim())) e.emailTo = "Enter a valid email address.";
        if (f.smsEnabled) {
          if (!f.smsCountryCode) e.smsCountryCode = "This field is required.";
          if (!f.smsPhone.trim()) e.smsPhone = "This field is required.";
          else if (!/^[0-9][0-9 ()-]*$/.test(f.smsPhone.trim())) e.smsPhone = "Digits only.";
        }
        if (!f.emailTo.trim() && !f.smsEnabled) {
          e.emailTo = "Enter an email address, or turn on SMS — two-factor needs one of them.";
        }
      }
      break;
    case 3:
      if (f.groupEnabled && f.groups.length === 0) e.groups = "Select at least one group, or turn User Group off.";
      break;
  }
  return e;
}

export function validateLocalUserForm(f: LocalUserFormState, requirePassword = true): Record<string, string> {
  const all: Record<string, string> = {};
  for (let i = 0; i < WIZARD_STEPS.length; i++) Object.assign(all, validateStep(i, f));
  // On edit a blank password means "keep the stored one" — the device never returns it to prefill.
  if (!requirePassword) delete all.password;
  return all;
}

export function buildLocalUserPayload(f: LocalUserFormState): LocalUserPayload {
  const two_factor: LocalUserTwoFactor = f.twoFactorEnabled ? f.authType : "disable";
  const p: LocalUserPayload = {
    name: f.name.trim(),
    type: "password",
    two_factor,
    status: f.status,
    groups: f.groupEnabled ? f.groups : [],
  };
  if (f.password) p.password = f.password; // omitted when blank ⇒ backend keeps the current one
  if (f.twoFactorEnabled) {
    if (f.authType === "fortitoken") p.fortitoken = f.fortitoken;
    p.email_to = f.emailTo.trim();
    p.sms_enabled = f.smsEnabled;
    if (f.smsEnabled) {
      p.sms_country_code = f.smsCountryCode;
      p.sms_phone = f.smsPhone.trim();
    }
  }
  return p;
}

export function localUserToForm(u: LocalUserPayload): LocalUserFormState {
  const tf = u.two_factor ?? "disable";
  return {
    ...BLANK_LOCAL_USER_FORM,
    userType: "password",
    name: u.name ?? "",
    password: "", // never returned by the device
    twoFactorEnabled: tf !== "disable",
    authType: tf === "fortitoken" ? "fortitoken" : "fortitoken-cloud",
    fortitoken: u.fortitoken ?? "",
    emailTo: u.email_to ?? "",
    smsEnabled: !!u.sms_enabled,
    smsCountryCode: u.sms_country_code ?? "",
    smsPhone: u.sms_phone ?? "",
    status: !!u.status,
    groupEnabled: (u.groups ?? []).length > 0,
    groups: u.groups ?? [],
  };
}

export function useLocalUserOptions(deviceId: number | null | undefined) {
  // Loading is derived from which device the options belong to — see useUserGroupOptions for why.
  const [state, setState] = useState<{ options: LocalUserOptions; loadedFor: number | null }>({
    options: { fortitokens: [], groups: [] },
    loadedFor: null,
  });

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceGetLocalUserOptions(deviceId)
      .then((options) => { if (alive) setState({ options, loadedFor: deviceId }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loadedFor: deviceId })); });
    return () => { alive = false; };
  }, [deviceId]);

  return { options: state.options, loading: Boolean(deviceId) && state.loadedFor !== deviceId };
}
