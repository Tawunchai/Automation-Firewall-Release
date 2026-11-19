// The pure half of ldap-server-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import React, { useEffect, useState } from "react";
import { DeviceGetLDAPServerOptions, type LDAPServerOptions, type LDAPServerPayload, type LDAPBindType, type LDAPProtocol } from "../../api/policyObject";

export type LDAPServerFormState = {
  name: string;
  server: string;
  port: string;              // kept as a string so the input can be cleared while typing
  cnid: string;
  dn: string;
  exchangeEnabled: boolean;
  exchangeServer: string;
  bindType: LDAPBindType;
  username: string;
  password: string;
  secureEnabled: boolean;
  protocol: LDAPProtocol;
  certEnabled: boolean;
  caCert: string;
  serverIdentityCheck: boolean;
};

export const LDAP_PORT_PLAIN = 389;

export const LDAP_PORT_LDAPS = 636;

export const BLANK_LDAP_SERVER_FORM: LDAPServerFormState = {
  name: "",
  server: "",
  port: String(LDAP_PORT_PLAIN),
  cnid: "cn",
  dn: "",
  exchangeEnabled: false,
  exchangeServer: "",
  bindType: "simple",
  username: "",
  password: "",
  secureEnabled: false,
  protocol: "starttls",
  certEnabled: false,
  caCert: "",
  serverIdentityCheck: true,
};

export const BIND_TYPE_OPTIONS: { v: LDAPBindType; l: string }[] = [
  { v: "simple", l: "Simple" },
  { v: "anonymous", l: "Anonymous" },
  { v: "regular", l: "Regular" },
];

export const bindTakesCredentials = (t: LDAPBindType) => t === "regular";

export function portForProtocol(currentPort: string, next: LDAPProtocol): string {
  const wanted = next === "ldaps" ? LDAP_PORT_LDAPS : LDAP_PORT_PLAIN;
  const other = next === "ldaps" ? LDAP_PORT_PLAIN : LDAP_PORT_LDAPS;
  return Number(currentPort) === other ? String(wanted) : currentPort;
}

export const NAME_MAX = 35;

export const SERVER_MAX = 63;

export const CNID_MAX = 20;

export const DN_MAX = 511;

export const USERNAME_MAX = 511;

export function validateLDAPServerForm(
  f: LDAPServerFormState, opts?: { isEdit?: boolean }
): Record<string, string> {
  const errs: Record<string, string> = {};

  const name = f.name.trim();
  if (!name) errs.name = "Name is required";
  else if (name.length > NAME_MAX) errs.name = `Name must be ${NAME_MAX} characters or fewer`;

  const server = f.server.trim();
  if (!server) errs.server = "Server IP/Name is required";
  else if (server.length > SERVER_MAX) errs.server = `Server IP/Name must be ${SERVER_MAX} characters or fewer`;

  const port = Number(f.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errs.port = "Server Port must be 1-65535";

  const cnid = f.cnid.trim();
  if (!cnid) errs.cnid = 'Common Name Identifier is required (the FortiGate default is "cn")';
  else if (cnid.length > CNID_MAX) errs.cnid = `Common Name Identifier must be ${CNID_MAX} characters or fewer`;

  if (f.dn.trim().length > DN_MAX) errs.dn = `Distinguished Name must be ${DN_MAX} characters or fewer`;

  if (bindTakesCredentials(f.bindType)) {
    if (!f.username.trim()) errs.username = "Username is required for a Regular bind";
    else if (f.username.trim().length > USERNAME_MAX) errs.username = `Username must be ${USERNAME_MAX} characters or fewer`;
    // On edit the device never returns the stored password, so blank means "keep it".
    if (!opts?.isEdit && !f.password) errs.password = "Password is required for a Regular bind";
  }

  if (f.exchangeEnabled && !f.exchangeServer.trim()) {
    errs.exchangeServer = "Select an Exchange server connector, or turn Exchange server off";
  }
  if (f.secureEnabled && f.certEnabled && !f.caCert.trim()) {
    errs.caCert = "Select a CA certificate, or turn Certificate off";
  }
  return errs;
}

export function buildLDAPServerPayload(f: LDAPServerFormState): LDAPServerPayload {
  const p: LDAPServerPayload = {
    name: f.name.trim(),
    server: f.server.trim(),
    port: Number(f.port),
    cnid: f.cnid.trim(),
    dn: f.dn.trim(),
    exchange_enabled: f.exchangeEnabled,
    bind_type: f.bindType,
    secure_enabled: f.secureEnabled,
    cert_enabled: f.secureEnabled && f.certEnabled,
    server_identity_check: f.secureEnabled && f.certEnabled && f.serverIdentityCheck,
  };

  if (f.exchangeEnabled) p.exchange_server = f.exchangeServer.trim();

  if (bindTakesCredentials(f.bindType)) {
    p.username = f.username.trim();
    // Blank password on edit = keep the stored one; the backend omits the key entirely.
    if (f.password) p.password = f.password;
  }

  if (f.secureEnabled) {
    p.protocol = f.protocol;
    if (f.certEnabled) p.ca_cert = f.caCert.trim();
  }
  return p;
}

export function ldapServerToForm(s: LDAPServerPayload): LDAPServerFormState {
  return {
    ...BLANK_LDAP_SERVER_FORM,
    name: s.name ?? "",
    server: s.server ?? "",
    port: String(s.port ?? LDAP_PORT_PLAIN),
    cnid: s.cnid ?? "cn",
    dn: s.dn ?? "",
    exchangeEnabled: !!s.exchange_enabled,
    exchangeServer: s.exchange_server ?? "",
    bindType: (s.bind_type ?? "simple") as LDAPBindType,
    username: s.username ?? "",
    password: "", // never returned by the device
    secureEnabled: !!s.secure_enabled,
    protocol: (s.protocol ?? "starttls") as LDAPProtocol,
    certEnabled: !!s.cert_enabled,
    caCert: s.ca_cert ?? "",
    // With Certificate off the device holds "disable", but the GUI still pre-selects the check
    // when you turn Certificate back on — so fall back to the schema default.
    serverIdentityCheck: s.cert_enabled ? !!s.server_identity_check : true,
  };
}

export function useLDAPServerOptions(deviceId: number | null | undefined) {
  // `at` records which reload the data in hand answers, and `loadedFor` which device — together
  // they make `loading` a derived value rather than a flag flipped inside the effect. See
  // useUserGroupOptions in ../user-auth/user-group-form.tsx for the full reasoning.
  const [state, setState] = useState<{
    options: LDAPServerOptions; loadedFor: number | null; at: number;
  }>({
    options: {
      ca_certs: [], exchange_servers: [], supports_ldap_test: false, supports_dn_browser: false,
    },
    loadedFor: null,
    at: -1,
  });

  // `nonce` bumps on every manual reload so the effect below runs again for a device it has
  // already loaded — the Exchange connector dialog calls reload() after creating one, and the new
  // connector has to appear in the picker.
  const [nonce, setNonce] = useState(0);
  const reload = React.useCallback(() => { setNonce((n) => n + 1); }, []);

  useEffect(() => {
    if (!deviceId) return;
    let alive = true;
    DeviceGetLDAPServerOptions(deviceId)
      .then((options) => { if (alive) setState({ options, loadedFor: deviceId, at: nonce }); })
      .catch(() => { if (alive) setState((s) => ({ ...s, loadedFor: deviceId, at: nonce })); });
    return () => { alive = false; };
  }, [deviceId, nonce]);

  // reload is exposed so the Exchange connector dialog can refresh the picker after it creates one.
  return {
    options: state.options,
    loading: Boolean(deviceId) && (state.loadedFor !== deviceId || state.at !== nonce),
    reload,
  };
}
