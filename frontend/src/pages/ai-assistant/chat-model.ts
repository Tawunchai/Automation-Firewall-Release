/**
 * The AI Assistant's data model: what a transcript entry is, what the right-hand panel can be
 * showing, and how a finished ConfigSuggestion becomes a chat item.
 *
 * Split out of index.tsx, which was a 2,061-line file holding one 1,825-line component plus these
 * ~150 lines of declarations on top of it. None of this renders anything, most of it is imported
 * elsewhere already (session.ts persists ChatItem), and buildAssistantItem is pure — it reads a
 * suggestion and the CLI parsers and touches no component state, which is exactly why it was
 * extracted from the send handler in the first place.
 *
 * index.tsx re-exports ChatItem and buildAssistantItem, so nothing that imported them from there
 * had to change.
 */
import { type ConfigSuggestion } from "../../api/ai";
import type { DeployStatus } from "../../api/device";
import type { AVProfileForm, FileFilterProfileForm } from "../../api/policyObject";
import type { WebFilterProfileForm, DNSFilterProfileForm, VirtualIP } from "../../api/policyObject";
import type { RouteFormState } from "../static-routes/route-form.logic";
import { parseAllPoliciesFromCLI, type ParsedPolicy } from "./parsePolicyCLI";
import { parseAntivirusFromCLI, type ParsedAV } from "./parseAntivirusCLI";
import { parseAddressFromCLI, parseAllAddressesFromCLI, type ParsedAddress } from "./parseAddressCLI";
import { parseServiceFromCLI, parseAllServicesFromCLI, type ParsedService } from "./parseServiceCLI";
import { parseRouteFromCLI, type ParsedRoute } from "./parseRouteCLI";
import { parseScheduleFromCLI, parseAllSchedulesFromCLI, type ParsedSchedule } from "./parseScheduleCLI";
import type { AppliedKind, RestoreSnapshot } from "./applyViaREST";
import { parseVPNFromCLI, type VPNKind } from "./parseVPNCLI";
import { parseWebFilterFromCLI, type ParsedWebFilter } from "./parseWebFilterCLI";
import { parseDNSFilterFromCLI, type ParsedDNSFilter } from "./parseDNSFilterCLI";
import { parseVIPFromCLI, parseAllVIPsFromCLI, type ParsedVIP } from "./parseVirtualIPCLI";
import { parseAppControlFromCLI, type ParsedAppControl } from "./parseAppControlCLI";
import { extractPrereqBlocks, type PrereqBlock } from "./parsePrereqCLI";
import { parseFileFilterFromCLI, type ParsedFileFilter } from "./parseFileFilterCLI";
import { parseUserGroupFromCLI, parseAllUserGroupsFromCLI, type ParsedUserGroup } from "./parseUserGroupCLI";
import { parseUserDefinitionFromCLI, parseAllUserDefinitionsFromCLI, type ParsedLocalUser } from "./parseUserDefinitionCLI";
import { parseLDAPServerFromCLI, parseAllLDAPServersFromCLI, type ParsedLDAPServer } from "./parseLDAPServerCLI";
import { parseRADIUSServerFromCLI, parseAllRADIUSServersFromCLI, type ParsedRADIUSServer } from "./parseRADIUSServerCLI";
import { parseSDWANFromCLI, type ParsedSDWAN } from "./parseSDWANCLI";

// ─── Constants ─────────────────────────────────────────────────────────────────
export const TERMINAL: DeployStatus[] = ["SUCCESS", "FAILED", "PARTIAL"];
// QUEUED has no shared --flow- token (it is not an allow/warn/deny/info state); the other three
// now read the console's own custom properties instead of a second, driftable copy of them.
export const RESULT_DOT: Record<string, string> = {
  QUEUED: "#94a3b8", RUNNING: "var(--flow-info)", SUCCESS: "var(--flow-allow)", FAILED: "var(--flow-deny)",
};
export const MAX_CONTEXT_CHARS = 2500; // max CLI output chars injected into AI prompt

// ─── Types ─────────────────────────────────────────────────────────────────────

// QueryContext stores the last Fetch result so it can be injected into the AI prompt
export interface QueryContext {
  cmd:    string; // commands that were run (e.g. "get system status")
  output: string; // CLI output (truncated to MAX_CONTEXT_CHARS)
  device: string; // device label for display
}

// Exported for session.ts, which persists a list of these. A type-only import, so the two files
// referring to each other costs nothing at runtime.
export interface ChatItem {
  // "success"  = an object the user just created on the device through a wizard. It is rendered as
  //              its own green ✓ line so a policy Apply that auto-creates five prerequisites reads
  //              as five confirmations plus the policy, not one paragraph.
  // "fallback" = an object Fallback took back OFF the device — the mirror image, in amber.
  role:        "user" | "assistant" | "error" | "success" | "fallback";
  text:        string;
  suggestion?: ConfigSuggestion;
  retryPrompt?: string;
  hasContext?: boolean; // whether QueryContext was injected into this message
  // Images the user attached to this message (user bubbles only). `dataUrl` is a self-contained
  // `data:` URL for the thumbnail. Stripped from the persisted session snapshot (session.ts) so a
  // few screenshots can't blow the localStorage quota — they show until reload, like a live preview.
  images?: { dataUrl: string }[];
  policyDraft?: ParsedPolicy;  // first parsed "config firewall policy" block (back-compat / single-policy button)
  policyDrafts?: ParsedPolicy[]; // ALL policy blocks — a suggestion may define several (Apply ALL + Policy dropdown)
  avDraft?: ParsedAV;          // parsed "config antivirus profile" block, if any
  webDraft?: ParsedWebFilter;  // parsed "config webfilter profile" block, if any
  dnsDraft?: ParsedDNSFilter;  // parsed "config dnsfilter profile" block, if any
  vipDraft?: ParsedVIP;        // first parsed "config firewall vip" block (VIP Wizard button)
  vipDrafts?: ParsedVIP[];     // ALL vip blocks — used to auto-create VIPs a policy references
  appDraft?: ParsedAppControl; // parsed "config application list" block, if any
  addrDraft?: ParsedAddress;   // first parsed "config firewall address" block (Address Wizard button)
  addrDrafts?: ParsedAddress[]; // ALL address blocks — used to auto-create missing addresses on policy apply
  svcDraft?: ParsedService;    // parsed "config firewall service custom" block, if any
  svcDrafts?: ParsedService[]; // ALL service blocks — used to auto-create missing services on policy apply
  routeDraft?: ParsedRoute;    // parsed "config router static" block, if any
  schedDraft?: ParsedSchedule;   // first parsed "config firewall schedule" block (Schedule Wizard button)
  schedDrafts?: ParsedSchedule[]; // ALL schedule blocks — used to auto-create a missing schedule on policy apply
  ffDraft?: ParsedFileFilter;    // parsed "config file-filter profile" block, if any
  ugDraft?: ParsedUserGroup;     // first parsed "config user group" block (User Group Wizard button)
  ugDrafts?: ParsedUserGroup[];  // ALL user-group blocks
  ulDraft?: ParsedLocalUser;     // first parsed "config user local" block (User Wizard button)
  ulDrafts?: ParsedLocalUser[];  // ALL local-user blocks
  ldapDraft?: ParsedLDAPServer;      // first parsed "config user ldap" block (LDAP Wizard button)
  ldapDrafts?: ParsedLDAPServer[];   // ALL LDAP blocks
  radDraft?: ParsedRADIUSServer;     // first parsed "config user radius" block (RADIUS Wizard button)
  radDrafts?: ParsedRADIUSServer[];  // ALL RADIUS blocks
  // The whole `config system sdwan` block: zones + members + performance SLAs + rules, reviewed and
  // built by ONE wizard because they only make sense together (a rule steers out of members that
  // meet a health check's SLA, and a member lives in a zone).
  sdwanDraft?: ParsedSDWAN;
  prereqBlocks?: PrereqBlock[]; // security-profile CLI blocks — auto-created if the policy references them
  vpnDraft?: { kind: VPNKind; name: string; payload: import("../../api/policyObject").IPsecTunnelPayload }; // a whole VPN tunnel (S2S/RA/hub-spoke) — Apply builds it, one "VPN Wizard" button reviews it
}

// What's currently shown in the right-hand panel — either the normal deploy/query result,
// or a step-by-step wizard (policy / antivirus / address) opened from a suggestion's parsed draft.
// `target` is the object's CURRENT name on the device (empty for a brand-new object) — it lets the
// wizard open in edit mode and locate the object even when the user is renaming it.
export type ActiveWizard =
  // policy carries only WHICH policy of WHICH chat message; the draft, its scoped prerequisites and
  // the live placement coordination (shared anchor, applied siblings) are all derived at render time
  // so switching policies from the dropdown and creating siblings stays in sync.
  | { kind: "policy"; itemIndex: number; policyIdx: number }
  | { kind: "antivirus"; draft: Partial<AVProfileForm>; target: string; itemIndex: number; readOnly: boolean }
  | { kind: "webfilter"; draft: Partial<WebFilterProfileForm>; target: string; itemIndex: number; readOnly: boolean }
  | { kind: "dnsfilter"; draft: Partial<DNSFilterProfileForm>; target: string; itemIndex: number; readOnly: boolean }
  | { kind: "virtualip"; draft: Partial<VirtualIP>; target: string; itemIndex: number; readOnly: boolean }
  | { kind: "appcontrol"; parsed: ParsedAppControl | null; target: string; itemIndex: number; readOnly: boolean }
  // address / service / schedule can be proposed in bulk ("create 10 address objects"), so the panel
  // holds EVERY draft of that kind and MultiObjectWizard pages through them behind one button.
  | { kind: "address"; drafts: ParsedAddress[]; itemIndex: number; readOnly: boolean }
  | { kind: "service"; drafts: ParsedService[]; itemIndex: number; readOnly: boolean }
  | { kind: "schedule"; drafts: ParsedSchedule[]; itemIndex: number; readOnly: boolean }
  | { kind: "filefilter"; draft: Partial<FileFilterProfileForm>; target: string; itemIndex: number; readOnly: boolean }
  // Users, groups and the two auth servers can also be proposed in bulk ("add these four staff
  // accounts"), so they carry EVERY draft of their kind and MultiObjectWizard pages through them —
  // the badge used to say (4) but the panel only ever opened the first one.
  | { kind: "usergroup"; drafts: ParsedUserGroup[]; itemIndex: number; readOnly: boolean }
  | { kind: "userdef"; drafts: ParsedLocalUser[]; itemIndex: number; readOnly: boolean }
  | { kind: "ldapserver"; drafts: ParsedLDAPServer[]; itemIndex: number; readOnly: boolean }
  | { kind: "radiusserver"; drafts: ParsedRADIUSServer[]; itemIndex: number; readOnly: boolean }
  | { kind: "route"; draft: Partial<RouteFormState>; target: string; itemIndex: number; readOnly: boolean }
  // SD-WAN carries the WHOLE parsed block, not one object: its four child tables are applied
  // together, in dependency order, by a single wizard.
  | { kind: "sdwan"; parsed: ParsedSDWAN; itemIndex: number; readOnly: boolean }
  // VPN carries the whole parsed IPsec tunnel (S2S / Remote Access / Hub-and-Spoke). The VPN wizard
  // reviews it in the chat and creates it over REST — the one wizard that used to navigate away.
  | { kind: "vpn"; draft: import("../../api/policyObject").IPsecTunnelPayload; vpnKind: VPNKind; target: string; itemIndex: number; readOnly: boolean };

// The AppliedKinds a pre-edit snapshot can be written back to. An address, service, schedule,
// policy or static route is NOT here: those wizards never fetch the live object, so there is no
// "before" to restore — and inventing one would be worse than leaving the edit un-undoable.
export const RESTORABLE_KINDS = new Set<AppliedKind>([
  "antivirus", "webfilter", "dnsfilter", "application-control", "file-filter",
  "virtual-ip", "user", "user-group", "ldap-server", "radius-server",
]);
export const isRestorableKind = (k: AppliedKind): k is RestoreSnapshot["kind"] => RESTORABLE_KINDS.has(k);

// The starter chips live in examplePrompts.ts, tagged with the wizard each one exercises and
// pinned to the real wizard vocabulary by a test — see the note there for why an example the app
// cannot actually build is worse than no example.

// ─── Main Component ────────────────────────────────────────────────────────────
/**
 * A finished ConfigSuggestion, turned into the assistant's transcript entry.
 *
 * Extracted from the send handler because the answer no longer necessarily arrives while this page
 * is mounted — the request runs in AiJobProvider and is claimed whenever the page next opens, so
 * the interpretation had to become something callable from an effect rather than the tail of an
 * await. Pure: it reads the suggestion and the CLI parsers, and touches no component state.
 */
export const buildAssistantItem = (suggestion: ConfigSuggestion): ChatItem => {
  const text = suggestion.explanation || "";
  const cli = suggestion.commands.join("\n");
  // A VPN suggestion (Site-to-Site / Remote Access / Hub-and-Spoke) is applied WHOLESALE by
  // applyViaREST (one tunnel object set), so its individual policies/addresses must NOT surface
  // their own wizard buttons — creating those pieces separately would fail (the tunnel interface
  // wouldn't exist yet). Instead it gets ONE "VPN Wizard" button. `config` gates every per-object
  // draft on "not a VPN suggestion".
  const vpn = suggestion.mode !== "query" ? parseVPNFromCLI(cli) : null;
  const config = suggestion.mode !== "query" && !vpn;
  const policyDrafts = config ? parseAllPoliciesFromCLI(cli) : [];
  const policyDraft = policyDrafts[0] ?? undefined;
  const avDraft = config ? parseAntivirusFromCLI(cli) ?? undefined : undefined;
  const webDraft = config ? parseWebFilterFromCLI(cli) ?? undefined : undefined;
  const dnsDraft = config ? parseDNSFilterFromCLI(cli) ?? undefined : undefined;
  const vipDraft = config ? parseVIPFromCLI(cli) ?? undefined : undefined;
  const vipDrafts = config ? parseAllVIPsFromCLI(cli) : [];
  const appDraft = config ? parseAppControlFromCLI(cli) ?? undefined : undefined;
  const addrDraft = config ? parseAddressFromCLI(cli) ?? undefined : undefined;
  const addrDrafts = config ? parseAllAddressesFromCLI(cli) : [];
  const svcDraft = config ? parseServiceFromCLI(cli) ?? undefined : undefined;
  const svcDrafts = config ? parseAllServicesFromCLI(cli) : [];
  const routeDraft = config ? parseRouteFromCLI(cli) ?? undefined : undefined;
  const schedDraft = config ? parseScheduleFromCLI(cli) ?? undefined : undefined;
  const schedDrafts = config ? parseAllSchedulesFromCLI(cli) : [];
  const ffDraft = config ? parseFileFilterFromCLI(cli) ?? undefined : undefined;
  const ugDraft = config ? parseUserGroupFromCLI(cli) ?? undefined : undefined;
  const ugDrafts = config ? parseAllUserGroupsFromCLI(cli) : [];
  const ulDraft = config ? parseUserDefinitionFromCLI(cli) ?? undefined : undefined;
  const ulDrafts = config ? parseAllUserDefinitionsFromCLI(cli) : [];
  const ldapDraft = config ? parseLDAPServerFromCLI(cli) ?? undefined : undefined;
  const ldapDrafts = config ? parseAllLDAPServersFromCLI(cli) : [];
  const radDraft = config ? parseRADIUSServerFromCLI(cli) ?? undefined : undefined;
  const radDrafts = config ? parseAllRADIUSServersFromCLI(cli) : [];
  const sdwanDraft = config ? parseSDWANFromCLI(cli) ?? undefined : undefined;
  const prereqBlocks = config ? extractPrereqBlocks(cli) : [];
  const vpnDraft = vpn ? { kind: vpn.kind, name: vpn.name, payload: vpn.payload } : undefined;
  return { role: "assistant", text, suggestion, policyDraft, policyDrafts, avDraft, webDraft, dnsDraft, vipDraft, vipDrafts, appDraft, addrDraft, addrDrafts, svcDraft, svcDrafts, routeDraft, schedDraft, schedDrafts, ffDraft, ugDraft, ugDrafts, ulDraft, ulDrafts, ldapDraft, ldapDrafts, radDraft, radDrafts, sdwanDraft, prereqBlocks, vpnDraft };
};
