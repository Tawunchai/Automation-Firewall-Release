import React from "react";
import { FiShield, FiMapPin, FiZap, FiGlobe, FiWifi, FiCpu, FiClock, FiFile } from "react-icons/fi";
import type { PolicyFormState } from "../firewall-policy/create.logic";
import type { ParsedAddress } from "./parseAddressCLI";
import type { ParsedService } from "./parseServiceCLI";
import type { ParsedSchedule } from "./parseScheduleCLI";
import type { ParsedAV } from "./parseAntivirusCLI";
import type { ParsedWebFilter } from "./parseWebFilterCLI";
import type { ParsedAppControl } from "./parseAppControlCLI";
import type { ParsedFileFilter } from "./parseFileFilterCLI";
import type { ParsedDNSFilter } from "./parseDNSFilterCLI";
import type { ParsedVIP } from "./parseVirtualIPCLI";

// The "related objects" vocabulary of the Policy Wizard: which kinds of object a policy can drag
// along, what each one is called on screen, and which of the AI-proposed definitions THIS policy
// actually points at.
//
// Moved out of PolicyWizard.tsx when that file crossed the 48 KB byte ceiling. It was already the
// part of that file that renders nothing - a type union, a label table and one pure function with
// its own test - and three other modules import from it (undoKinds.ts and two test files). That is
// also one react-refresh/only-export-components finding fewer: PolicyWizard.tsx exports the
// component and nothing else now.

// Kinds of related object the Policy Wizard's "Related Objects" dropdown can open a sub-wizard for.
export type RelKind = "address" | "service" | "schedule" | "virtualip" | "antivirus" | "webfilter" | "dnsfilter" | "appcontrol" | "filefilter";
export const REL_META: Record<RelKind, { label: string; icon: React.ReactNode }> = {
  address:    { label: "Address",             icon: <FiMapPin size={12} /> },
  service:    { label: "Service",             icon: <FiZap size={12} /> },
  schedule:   { label: "Schedule",            icon: <FiClock size={12} /> },
  antivirus:  { label: "AntiVirus",           icon: <FiShield size={12} /> },
  webfilter:  { label: "Web Filter",          icon: <FiGlobe size={12} /> },
  dnsfilter:  { label: "DNS Filter",          icon: <FiWifi size={12} /> },
  virtualip:  { label: "Virtual IP",          icon: <FiGlobe size={12} /> },
  appcontrol: { label: "Application Control", icon: <FiCpu size={12} /> },
  filefilter: { label: "File Filter",         icon: <FiFile size={12} /> },
};

// One object the wizard created on the device. `kind` covers the ones the Related-Objects dropdown
// knows about, plus the PrereqKind spellings for the profile types with no sub-wizard (IPS), which
// are reported under their own name.
export type CreatedObject = {
  kind: RelKind | "ips" | "file-filter";
  label: string; // human name for the chat line ("Address", "Web Filter", …)
  name: string;
};

// Every AI-proposed definition a policy might draw on. The wizard is handed the FULL set the
// suggestion produced (any policy must be able to build any object, in any apply order), so this
// is deliberately wider than what one policy references.
export type PendingDefs = {
  pendingAddresses?: ParsedAddress[];
  pendingServices?: ParsedService[];
  pendingSchedules?: ParsedSchedule[];
  pendingVIPs?: ParsedVIP[];
  pendingAV?: ParsedAV;
  pendingWeb?: ParsedWebFilter;
  pendingDNS?: ParsedDNSFilter;
  pendingApp?: ParsedAppControl;
  pendingFF?: ParsedFileFilter;
};

// computeRelItems narrows those definitions to the objects THIS policy actually points at — its own
// addresses, services, schedule and ENABLED profiles — which is what the "Objects" dropdown lists and
// what Apply auto-creates. Without the narrowing a sibling policy's objects would show up here too.
// Deduped by kind:name.
//
// Exported and pure on purpose: it is the rule that decides whether a proposed object is visible to
// the user at all, and a missing line here is invisible in TypeScript (every pending* is optional) —
// it just silently drops an object from the UI. So it is unit-tested rather than eyeballed.
export function computeRelItems(
  form: PolicyFormState,
  defs: PendingDefs,
): { kind: RelKind; name: string }[] {
  const { pendingAddresses = [], pendingServices = [], pendingSchedules = [], pendingVIPs = [],
    pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF } = defs;

  const items: { kind: RelKind; name: string }[] = [];
  const seen = new Set<string>();
  const push = (kind: RelKind, name?: string) => {
    const n = (name ?? "").trim();
    if (!n || seen.has(`${kind}:${n}`)) return;
    seen.add(`${kind}:${n}`);
    items.push({ kind, name: n });
  };

  const refAddr = new Set([...(form.srcAddr ?? []), ...(form.dstAddr ?? [])]);
  const refSvc = new Set(form.service ?? []);
  // A VIP is referenced in dstaddr/srcaddr by name (it is a DNAT object). Match those first so a
  // VIP name is offered as a Virtual IP, not mistaken for a plain address it has no definition for.
  const vipNames = new Set(pendingVIPs.map((v) => v.form.name ?? v.target));
  for (const v of pendingVIPs) { const n = v.form.name ?? v.target; if (refAddr.has(n)) push("virtualip", n); }
  for (const a of pendingAddresses) { const n = a.form.name ?? a.target; if (refAddr.has(n) && !vipNames.has(n)) push("address", n); }
  for (const s of pendingServices) { const n = s.form.name ?? s.target; if (refSvc.has(n)) push("service", n); }
  // Only the schedule this policy actually points at. "always"/"none" are built into FortiOS.
  for (const sc of pendingSchedules) {
    const n = sc.form.name ?? sc.target;
    if (n && n === form.schedule && n !== "always" && n !== "none") push("schedule", n);
  }
  // A profile is a related object only when THIS policy enables it and references THAT profile name.
  if (pendingAV && form.avEnabled && (pendingAV.form.name ?? pendingAV.target) === form.avProfile) push("antivirus", form.avProfile);
  if (pendingWeb && form.webEnabled && (pendingWeb.form.name ?? pendingWeb.target) === form.webProfile) push("webfilter", form.webProfile);
  if (pendingDNS && form.dnsEnabled && (pendingDNS.form.name ?? pendingDNS.target) === form.dnsProfile) push("dnsfilter", form.dnsProfile);
  if (pendingApp && form.appEnabled && pendingApp.name === form.appProfile) push("appcontrol", form.appProfile);
  if (pendingFF && form.fileEnabled && (pendingFF.form.name ?? pendingFF.target) === form.fileProfile) push("filefilter", form.fileProfile);
  return items;
}
