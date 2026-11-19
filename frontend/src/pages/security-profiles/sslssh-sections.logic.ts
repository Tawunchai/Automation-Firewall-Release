// The pure half of sslssh-sections.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import { type SSLExemptEntry, type SSLSSHMetadata } from "../../api/inspectionProfiles";

export const PROTOCOL_LABELS: Record<string, string> = {
  // `ssl` is the catch-all, not a protocol — named for what it does rather than for its CMDB key.
  ssl: "Default (other ports)",
  https: "HTTPS", ftps: "FTPS", imaps: "IMAPS", pop3s: "POP3S",
  smtps: "SMTPS", dot: "DNS over TLS", ssh: "SSH",
};

/** ssh and dot have no certificate-inspection mode — the device rejects it. */
export const deepOnly = (protocol: string) => protocol === "ssh" || protocol === "dot";

/** "443, 8443" ↔ [443, 8443]. Invalid fragments are dropped rather than becoming NaN. */
export const parsePorts = (text: string): number[] =>
  text.split(",").map((p) => parseInt(p.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0 && n <= 65535);

export const exemptValue = (e: SSLExemptEntry, meta: SSLSSHMetadata): string => {
  switch (e.type) {
    case "fortiguard-category":
      return meta.categories.find((c) => c.id === e.fortiguard_category)?.name
        ?? `category ${e.fortiguard_category}`;
    case "address": return e.address;
    case "address6": return e.address6;
    case "wildcard-fqdn": return e.wildcard_fqdn;
    case "regex": return e.regex;
    default: return "—";
  }
};
