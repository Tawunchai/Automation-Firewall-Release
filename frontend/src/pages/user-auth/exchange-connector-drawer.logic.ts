// The pure half of exchange-connector-drawer.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type ExchangeConnectorPayload } from "../../api/policyObject";

export type ExchangeAccountParts = {
  username: string;
  serverName: string;  // the full host FQDN
  domainName: string;  // the FQDN minus its first label (the AD domain)
};

export function splitExchangeAccount(account: string): ExchangeAccountParts {
  const raw = account.trim();
  const at = raw.lastIndexOf("@");
  if (at <= 0 || at === raw.length - 1) {
    return { username: "", serverName: "", domainName: "" };
  }
  const username = raw.slice(0, at);
  const serverName = raw.slice(at + 1);
  const labels = serverName.split(".").filter(Boolean);
  const domainName = labels.length > 2 ? labels.slice(1).join(".") : serverName;
  return { username, serverName, domainName };
}

export type ExchangeConnectorFormState = {
  name: string;
  account: string;
  password: string;
  overrideIP: boolean;
  ip: string;
  autoDiscoverKDC: boolean;
};

export const BLANK_EXCHANGE_FORM: ExchangeConnectorFormState = {
  name: "",
  account: "",
  password: "",
  overrideIP: false,
  ip: "0.0.0.0",
  autoDiscoverKDC: true,
};

export const NAME_MAX = 35;

export const IPV4_RE = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function validateExchangeForm(f: ExchangeConnectorFormState): Record<string, string> {
  const errs: Record<string, string> = {};

  const name = f.name.trim();
  if (!name) errs.name = "Name is required";
  else if (name.length > NAME_MAX) errs.name = `Name must be ${NAME_MAX} characters or fewer`;

  const parts = splitExchangeAccount(f.account);
  if (!f.account.trim()) errs.account = "This field is required.";
  else if (!parts.username || !parts.serverName) errs.account = "Use the form username@server.domain.com";

  if (!f.password) errs.password = "This field is required.";

  if (f.overrideIP && !IPV4_RE.test(f.ip.trim())) errs.ip = "Enter a valid IPv4 address";

  return errs;
}

export function buildExchangeConnectorPayload(f: ExchangeConnectorFormState): ExchangeConnectorPayload {
  const parts = splitExchangeAccount(f.account);
  return {
    name: f.name.trim(),
    username: parts.username,
    server_name: parts.serverName,
    domain_name: parts.domainName,
    password: f.password,
    override_ip: f.overrideIP,
    // The device's "not overridden" sentinel; the backend forces it too when the toggle is off.
    ip: f.overrideIP ? f.ip.trim() : "0.0.0.0",
    auto_discover_kdc: f.autoDiscoverKDC,
  };
}
