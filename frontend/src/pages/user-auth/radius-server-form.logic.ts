// The pure half of radius-server-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type RADIUSServerPayload, type RADIUSAuthType } from "../../api/policyObject";

export type RADIUSServerFormState = {
  name: string;
  authMethodSpecify: boolean;
  authType: RADIUSAuthType;
  nasIP: string;
  allUserGroup: boolean;
  server: string;
  secret: string;
  secondaryServer: string;
  secondarySecret: string;
};

export const BLANK_RADIUS_SERVER_FORM: RADIUSServerFormState = {
  name: "",
  authMethodSpecify: false,
  authType: "pap",           // the Specify dropdown's first entry; ignored while Default is on
  nasIP: "",
  allUserGroup: false,
  server: "",
  secret: "",
  secondaryServer: "",
  secondarySecret: "",
};

export const RADIUS_AUTH_OPTIONS: { v: RADIUSAuthType; l: string }[] = [
  { v: "pap", l: "PAP" },
  { v: "chap", l: "CHAP" },
  { v: "ms_chap", l: "MS-CHAP" },
  { v: "ms_chap_v2", l: "MS-CHAP-v2" },
];

export const NAME_MAX = 35;

export const SERVER_MAX = 63;

export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function validateRADIUSServerForm(
  f: RADIUSServerFormState, opts?: { isEdit?: boolean }
): Record<string, string> {
  const errs: Record<string, string> = {};

  const name = f.name.trim();
  if (!name) errs.name = "Name is required";
  else if (name.length > NAME_MAX) errs.name = `Name must be ${NAME_MAX} characters or fewer`;

  const server = f.server.trim();
  if (!server) errs.server = "This field is required.";
  else if (server.length > SERVER_MAX) errs.server = `IP/Name must be ${SERVER_MAX} characters or fewer`;
  // On edit the device never returns the stored secret, so blank means "keep it".
  if (!opts?.isEdit && !f.secret) errs.secret = "This field is required.";

  if (f.nasIP.trim() && !IPV4_RE.test(f.nasIP.trim())) errs.nasIP = "NAS IP must be a valid IPv4 address";

  // A secondary host with no secret can never authenticate — catch it here rather than shipping
  // a server that silently fails over into nothing.
  const secondary = f.secondaryServer.trim();
  if (secondary) {
    if (secondary.length > SERVER_MAX) errs.secondaryServer = `IP/Name must be ${SERVER_MAX} characters or fewer`;
    if (!opts?.isEdit && !f.secondarySecret) errs.secondarySecret = "This field is required.";
    // FortiOS requires the addresses to be DISTINCT, and reports a repeat as the cryptic
    // "<host> is already the secondary server" (-61). Name the colliding field instead.
    if (secondary === server) {
      errs.secondaryServer = "Already used as the primary server — each RADIUS server address must be different";
    }
  }
  return errs;
}

export function buildRADIUSServerPayload(f: RADIUSServerFormState): RADIUSServerPayload {
  const p: RADIUSServerPayload = {
    name: f.name.trim(),
    auth_method_specify: f.authMethodSpecify,
    // Default ⇒ auto, whatever stale value the Specify dropdown still holds.
    auth_type: f.authMethodSpecify ? f.authType : "auto",
    nas_ip: f.nasIP.trim(),
    all_usergroup: f.allUserGroup,
    server: f.server.trim(),
  };
  if (f.secondaryServer.trim()) p.secondary_server = f.secondaryServer.trim();
  if (f.secret) p.secret = f.secret;
  if (f.secondarySecret) p.secondary_secret = f.secondarySecret;
  return p;
}

export function radiusServerToForm(s: RADIUSServerPayload): RADIUSServerFormState {
  const authType = (s.auth_type ?? "auto") as RADIUSAuthType;
  return {
    ...BLANK_RADIUS_SERVER_FORM,
    name: s.name ?? "",
    authMethodSpecify: !!s.auth_method_specify,
    // "auto" has no position in the Specify dropdown — park it on PAP so switching to Specify
    // shows a real method instead of an empty select.
    authType: authType === "auto" ? "pap" : authType,
    nasIP: s.nas_ip ?? "",
    allUserGroup: !!s.all_usergroup,
    server: s.server ?? "",
    secret: "", // never returned by the device
    secondaryServer: s.secondary_server ?? "",
    secondarySecret: "",
  };
}
