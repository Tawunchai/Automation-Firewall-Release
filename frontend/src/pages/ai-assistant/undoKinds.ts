// The kind vocabularies the AI Assistant's Fallback (undo) bookkeeping runs on, and the tables
// that translate between them.
//
// These live in their own module for two reasons:
//
//   · They are CONSTANT. They used to be declared inside the AI Assistant component, which
//     re-renders on every stream flush — every 80ms for the ~30s a proposal takes to write — so
//     three object literals were being rebuilt hundreds of times per answer for values that never
//     change. Module scope builds them once.
//   · Both type imports below are `import type`, so they are erased at compile time. That keeps
//     this module free of any runtime dependency on the 3,000-line page component or the wizard,
//     which is what makes the lookup tables testable on their own.
import type { AppliedKind } from "./applyViaREST";
import type { CreatedObject } from "./relObjects";

// Every wizard button a suggestion can offer. Used as the id for "already applied" bookkeeping
// (wizKey) and, for all but one of them, to look the AppliedKind up in WIZ_BTN_TO_UNDO.
//
// A runtime ARRAY with the type derived from it, rather than a hand-written union: the tests and
// the starter-chip list both have to enumerate these, and a union cannot be enumerated at runtime.
// The two used to be maintained separately, which is how a wizard could exist with no starter
// prompt and nothing to say so.
export const WIZARD_BTN_KINDS = [
  "policy", "antivirus", "webfilter", "dnsfilter", "virtualip", "appcontrol",
  "address", "service", "route", "schedule", "filefilter",
  "usergroup", "userdef", "ldapserver", "radiusserver",
  "sdwan", "vpn",
] as const;

export type WizardBtnKind = typeof WIZARD_BTN_KINDS[number];

// The buttons that build MORE THAN ONE device object, so no single AppliedKind describes them.
//
// SD-WAN is the only one: `config system sdwan` is a complex object whose four child tables are
// four separate CMDB endpoints, and its wizard records each created zone / member / performance SLA
// / rule under its own kind. A row in WIZ_BTN_TO_UNDO would have to pick one of the four and would
// be wrong for the other three.
export const COMPOSITE_WIZARDS = new Set<WizardBtnKind>(["sdwan"]);

/** A wizard button that creates exactly one kind of object — everything except the composites. */
export type SingleObjectWizardKind = Exclude<WizardBtnKind, "sdwan">;

// TWO maps, because two different vocabularies reach this lookup and conflating them hid a real
// footgun: a Record<string, …> silently returns undefined for a kind nobody remembered to add,
// and that object is then NEVER undoable — with no compile error to say so.
//
// WIZ_BTN_TO_UNDO is keyed by SingleObjectWizardKind, so adding a wizard button without a row here
// fails the build — unless it is declared a composite above, which is the deliberate way to say
// "this one records its own objects".
export const WIZ_BTN_TO_UNDO: Record<SingleObjectWizardKind, AppliedKind> = {
  policy: "policy", antivirus: "antivirus", webfilter: "webfilter", dnsfilter: "dnsfilter",
  virtualip: "virtual-ip", appcontrol: "application-control", filefilter: "file-filter",
  address: "address", service: "service",
  schedule: "schedule", route: "static-route",
  userdef: "user", usergroup: "user-group",
  ldapserver: "ldap-server", radiusserver: "radius-server",
  // A whole IPsec tunnel records as the single "ipsec-tunnel" AppliedKind (tunnel + its addresses,
  // policies and routes), undone as one by Fallback's cascade delete — so it is NOT a composite.
  vpn: "ipsec-tunnel",
};

// REL_TO_UNDO is keyed by the Policy Wizard's own CreatedObject kinds, which are device categories
// ("file-filter") rather than button ids ("filefilter"). `null` means the object genuinely cannot
// be undone: an IPS sensor has no delete endpoint in this app yet, so recording it would promise a
// rollback Fallback could not deliver.
export const REL_TO_UNDO: Record<CreatedObject["kind"], AppliedKind | null> = {
  address: "address", service: "service", schedule: "schedule", virtualip: "virtual-ip",
  antivirus: "antivirus", webfilter: "webfilter", dnsfilter: "dnsfilter",
  appcontrol: "application-control", filefilter: "file-filter", "file-filter": "file-filter",
  ips: null,
};

// The Policy Wizard reports "file-filter" where the button id is "filefilter"; normalise so the
// ✓ lands on the button the user is actually looking at.
export const REL_TO_BTN: Partial<Record<CreatedObject["kind"], WizardBtnKind>> = {
  "file-filter": "filefilter",
};

// wizKey identifies one wizard button on one chat message, for the "already applied" bookkeeping.
export const wizKey = (i: number, kind: string) => `${i}:${kind}`;
