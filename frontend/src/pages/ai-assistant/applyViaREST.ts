// applyViaREST — the fast path for the chat's "Apply" button.
//
// WHY THIS EXISTS
// Applying the AI's CLI used to go through the config-deploy pipeline: Redis queue → Python worker
// → SSH (netmiko) → `show full-configuration` (before) → send_config_set → `show full-configuration`
// (after) → diff. Measured against the lab FortiGate that is ~17s for a single address object,
// while the wizards — which talk to the device over the REST device-proxy — do the same work in
// ~0.25s. The two buttons produced the same objects; only the transport differed.
//
// So the Apply button now takes the wizards' transport: parse the AI's CLI into the same drafts the
// wizards use and create each object over REST, in dependency order. A suggestion that contains a
// section we have no REST endpoint for (VPN, SD-WAN, DHCP, HA, system settings…) still falls back
// to the SSH pipeline — canApplyViaREST() is what decides, and it is deliberately conservative:
// unknown section ⇒ fall back.
//
// PLAN, THEN EXECUTE
// The work is split in two: planApply() decides WHAT would happen (reading the device but never
// writing to it) and applyViaREST() carries the plan out. The split exists so the Dry-run button can
// show the user exactly what Apply is about to do without a second, parallel implementation that
// could drift out of step with this one. There is one decision path; Dry-run stops before `run()`
// and Apply calls it.

import {
  DeviceListAddresses, DeviceCreateAddress,
  DeviceListServices, DeviceCreateService,
  DeviceListSchedules, DeviceCreateSchedule,
  DeviceGetPolicyProfiles, DeviceCreateSecurityProfile, DeviceGetSecurityProfile,
  DeviceGetAppControlMetadata,
  DeviceCreatePolicy, DeviceListPolicies, DeviceListStaticRoutes, DeviceCreateStaticRoute,
  DeviceListVirtualIPs, DeviceCreateVirtualIP,
  DeviceListUsers, DeviceCreateUser,
  DeviceListLDAPServers, DeviceCreateLDAPServer,
  DeviceListRADIUSServers, DeviceCreateRADIUSServer,
  DeviceListUserGroups, DeviceCreateUserGroup, DeviceUpdateUserGroup, DeviceGetUserGroup,
  DeviceListIPsecTunnels, DeviceCreateIPsecTunnel,
  type VirtualIP, type LocalUserPayload, type UserGroupPayload,
  type LDAPServerPayload, type RADIUSServerPayload,
  type SecurityProfileCategory, type FirewallPolicy,
} from "../../api/policyObject";
import { isDuplicateError } from "./fortiosError";
import { parseVPNFromCLI } from "./parseVPNCLI";
import { parseSDWANFromCLI } from "./parseSDWANCLI";
import { planSDWANSteps } from "./applySDWAN";
import { parsedApplyObjects } from "./applyObjects";
import { normalizeCLI, topLevelConfigBlocks, extractPrereqBlocks,
  type PrereqBlock, type PrereqKind } from "./parsePrereqCLI";
import { parseAllAddressesFromCLI, addressDraftToForm } from "./parseAddressCLI";
import { parseAllServicesFromCLI, serviceDraftToForm } from "./parseServiceCLI";
import { parseAllSchedulesFromCLI, scheduleDraftToForm } from "./parseScheduleCLI";
import { parseAntivirusFromCLI, avDraftToForm } from "./parseAntivirusCLI";
import { parseWebFilterFromCLI, webFilterDraftToForm } from "./parseWebFilterCLI";
import { parseDNSFilterFromCLI, dnsFilterDraftToForm } from "./parseDNSFilterCLI";
import { parseAllVIPsFromCLI, vipDraftToForm } from "./parseVirtualIPCLI";
import { parseAppControlFromCLI, appControlDraftToForm } from "./parseAppControlCLI";
import { parseFileFilterFromCLI, fileFilterDraftToForm } from "./parseFileFilterCLI";
import { parseAllUserDefinitionsFromCLI, userDefinitionDraftToForm } from "./parseUserDefinitionCLI";
import { parseAllUserGroupsFromCLI, userGroupDraftToForm, groupTakesMembers } from "./parseUserGroupCLI";
import { parseAllLDAPServersFromCLI, ldapServerDraftToForm } from "./parseLDAPServerCLI";
import { parseAllRADIUSServersFromCLI, radiusServerDraftToForm } from "./parseRADIUSServerCLI";
import { parseAllPoliciesFromCLI, policyDraftToFormState } from "./parsePolicyCLI";
import { parseRouteFromCLI, routeDraftToForm } from "./parseRouteCLI";
import { buildAddressPayload } from "../fw-addresses/address-form.logic";
import { buildServicePayload } from "../fw-services/service-form.logic";
import { buildPolicyPayload } from "../firewall-policy/create.logic";
import { buildRoutePayload } from "../static-routes/route-form.logic";
import { EMPTY_APPCONTROL_FORM } from "../security-profiles/appcontrol-form.logic";

// One object this applier created on the device — the chat renders one green ✓ line per entry, and
// the Fallback button (undoApply.ts) replays the list backwards to take it all off again.
//
// `kind` is what undo dispatches on; `label` is only ever shown to the user. The two extra keys are
// for the objects FortiOS names itself: a policy gets an id and a static route a sequence number, so
// they are captured at create time rather than guessed later.
export type AppliedKind =
  | "address" | "service" | "schedule" | "virtual-ip"
  | "antivirus" | "webfilter" | "dnsfilter" | "application-control" | "file-filter"
  | "user" | "user-group" | "ldap-server" | "radius-server" | "exchange-connector"
  | "policy" | "static-route"
  // system/sdwan's four child tables. They are separate kinds rather than one "sdwan" because they
  // are four CMDB tables with four endpoints, and Fallback has to remove them in the reverse of the
  // order they were created in — a zone cannot go while a member still sits in it.
  | "sdwan-zone" | "sdwan-member" | "sdwan-health-check" | "sdwan-rule"
  | "ipsec-tunnel"; // a whole Hub-and-Spoke VPN (tunnel + interface + BGP + policies), created/undone as one

// A snapshot of an object as it was BEFORE a wizard edited it, so Fallback can put it back.
//
// WHY THIS SHAPE: an edit cannot be undone by deleting — the object existed before we touched it,
// and deleting it would destroy someone else's config. Undoing an edit means writing the old
// payload back, which is exactly what the wizard already fetched to prefill its form. So the
// snapshot is free: no extra device round-trip, and it is by construction the same shape the
// Update endpoint accepts (that is how the edit form round-trips in the first place).
//
// ⚠️ WRITE-ONLY SECRETS ARE NOT RESTORED. The device never returns a password or a shared secret
// (it answers "ENC XXXX"), so a snapshot carries a blank one and the Update treats blank as "keep
// what is stored". That is right for every field the edit did NOT change — but if the edit set a
// NEW password, Fallback cannot bring the old one back, because nothing ever had it. undoApply
// says so in its result rather than pretending otherwise.
export type RestoreSnapshot =
  // The five security profiles share one endpoint, keyed by category.
  | { kind: "antivirus" | "webfilter" | "dnsfilter" | "application-control" | "file-filter"; payload: unknown }
  | { kind: "virtual-ip"; payload: VirtualIP }
  | { kind: "user"; payload: LocalUserPayload }
  | { kind: "user-group"; payload: UserGroupPayload }
  | { kind: "ldap-server"; payload: LDAPServerPayload }
  | { kind: "radius-server"; payload: RADIUSServerPayload };

export type AppliedObject = {
  kind: AppliedKind;
  label: string;
  name: string;
  policyId?: number;      // policy only
  // The numeric mkey FortiOS assigned itself: a static route's sequence number, an SD-WAN member's
  // seq-num, an SD-WAN rule's id. Captured at create time so Fallback deletes the exact row it
  // added rather than matching on a name the table does not key by.
  seq?: number;
  // Present when this entry records an EDIT rather than a create. Fallback replays the payload
  // through the Update endpoint instead of deleting an object the user did not create.
  restore?: RestoreSnapshot;
};

// The `config <section>` headers we can create over REST. Anything else forces the SSH fallback.
//
// "webfilter urlfilter" and "dnsfilter domain-filter" are listed but never applied on their own:
// those tables are built by the backend as part of the structured Web Filter / DNS Filter profile
// create (deploying the raw table separately would hard-code a table id and could overwrite a
// live one). Listing them only means "a suggestion containing this section can still take the
// REST path" — the rows travel inside the profile's own form.
const REST_SECTIONS = new Set([
  "firewall address",
  "firewall vip",
  "firewall service custom",
  "firewall schedule recurring",
  "firewall schedule onetime",
  "firewall schedule group",
  "firewall.schedule recurring",
  "firewall.schedule onetime",
  "firewall.schedule group",
  "antivirus profile",
  "webfilter profile",
  "webfilter urlfilter",
  "dnsfilter profile",
  "dnsfilter domain-filter",
  "application list",
  "file-filter profile",
  "user local",
  "user group",
  "user ldap",
  "user radius",
  "firewall policy",
  "router static",
  // The whole SD-WAN complex object. Its four child tables live inside this one header, which is
  // why countRESTApplicable has to ask the SD-WAN parser how many objects are in there — a
  // `config system sdwan` block has no top-level `edit` of its own.
  "system sdwan",
]);

// Statements this applier CANNOT carry out. Everything below builds objects out of `edit … next`
// bodies, so a `delete`/`unset`/`purge` line is invisible to it.
//
// ⚠️ THIS GUARD EXISTS BECAUSE THE SILENT VERSION SHIPPED. "ลบ policy Allow-Guest" makes the model
// emit `config firewall policy / delete 5 / end`. That header IS in REST_SECTIONS, so the fast path
// took it, parsed ZERO drafts out of it, created nothing — and the chat reported success. The user
// read "already exists on the device" and believed the policy was gone. Routing these to the SSH
// pipeline instead actually performs them, and shows the before/after diff while doing it.
//
// `purge` is matched too even though nothing proposes it: it empties a whole table, and this app has
// already lost every firewall policy once to a collection-wide delete.
const DESTRUCTIVE_STATEMENT = /^\s*(delete|unset|purge)\b/im;

export const hasDestructiveStatement = (cli: string): boolean =>
  DESTRUCTIVE_STATEMENT.test(normalizeCLI(cli));

// canApplyViaREST reports whether EVERY top-level section in the CLI has a REST endpoint. One
// unknown section and the whole suggestion goes down the SSH path — we never apply half of it here
// and half of it there.
//
// A VPN suggestion (Site-to-Site, Remote Access or Hub-and-Spoke) is the exception: it contains
// sections we otherwise force to SSH (vpn.ipsec phase1/phase2, system interface, router bgp) but they
// are one self-contained tunnel object set the device proxy builds in a single call — so if the whole
// CLI parses as a VPN, the REST path owns it.
export function canApplyViaREST(cli: string): boolean {
  // Checked before the VPN branch too: a suggestion that removes part of a tunnel is not something
  // the tunnel builder can express either.
  if (hasDestructiveStatement(cli)) return false;
  if (parseVPNFromCLI(cli)) return true;
  const headers = topLevelConfigBlocks(normalizeCLI(cli).split("\n")).map((b) => b.header);
  return headers.length > 0 && headers.every((h) => REST_SECTIONS.has(h));
}

// countRESTApplicable reports how many objects applyViaREST would even look at. The chat needs it
// to tell two very different "nothing happened" outcomes apart:
//   > 0  → every object the CLI defines was already on the device (a real, useful answer)
//   = 0  → nothing in this CLI is something we build (so saying "already exists" would be a lie)
//
// ⚠️ IT COUNTS PARSED OBJECTS, NOT `edit` LINES. It used to count `topLevelEdits(block).length` —
// the edit statements in the TEXT — which meant a block whose parser returns null still counted as
// one object. Apply then created nothing, found created.length === 0, asked this function whether
// anything was applicable, got 1, and told the user "Everything in this config already exists on
// the device". Nothing existed and nothing was created: the same false success the delete bug used
// to produce, reached from the other side. parsedApplyObjects asks the parsers themselves.
export function countRESTApplicable(cli: string): number {
  if (parseVPNFromCLI(cli)) return 1;
  return parsedApplyObjects(cli).length;
}

// ─── The plan ────────────────────────────────────────────────────────────────
//
// One entry per object the CLI names, in the order Apply would touch them.
//   create → not on the device; Apply will build it from `payload`
//   update → on the device and Apply will WRITE to it (only user-group members reach this today)
//   skip   → on the device already; Apply leaves it exactly as it is
//
// A "skip" is not nothing: the device's copy may differ from what the AI just proposed, and Apply
// will NOT reconcile it. That gap is invisible today — the chat only says "already exists" — and
// showing it is the main thing Dry-run adds.
export type PlanAction = "create" | "update" | "skip";

type Rec = Record<string, unknown>;

export type PlanStep = {
  kind: AppliedKind;
  label: string;
  name: string;
  action: PlanAction;
  /** The body Apply would send. Absent when there is nothing meaningful to compare (a VPN). */
  payload?: Rec;
  /**
   * The object as it stands on the device now, in the payload's key space so the two can be
   * compared field by field. Only populated for update, and for skip in `detailed` mode.
   */
  existing?: Rec | null;
  /** Performs the create/update. Absent ⇒ this step is a skip and Apply does nothing for it. */
  run?: () => Promise<unknown>;
  /** Reads back an id FortiOS assigned (policy id, route seq) once the create succeeded. */
  resolve?: () => Promise<Partial<AppliedObject>>;
  /** Set on an update: how Fallback puts the object back the way it was. */
  restore?: RestoreSnapshot;
};

// FortiGate rejects a duplicate name with error -5; treat that as "already there" so Apply is
// idempotent and a re-run never aborts over an object that already exists.
//
// Compared as a NUMBER (fortiosError.ts), never as a substring of the message. The old test here
// was /(-5\b|already exist|duplicat)/i, which an object called `spoke-5` or a `tcp-portrange 1-5`
// satisfies with no error code in sight — so a create that genuinely failed was recorded as
// "already there" and the policy referencing the object that was never made went on to be applied.
// With no code on the error this is false and the failure is rethrown below, which stops the run on
// the object that failed instead of continuing past it.
const isDuplicate = isDuplicateError;

// `resolve` runs only after a create actually succeeded, for the objects FortiOS keys itself
// (policy id, route seq): it looks the new object up so Fallback can delete it by mkey later.
async function createSkippingDuplicates(
  obj: AppliedObject, create: () => Promise<unknown>, out: AppliedObject[],
  onProgress?: (o: AppliedObject) => void,
  resolve?: () => Promise<Partial<AppliedObject>>,
) {
  try {
    await create();
  } catch (err) {
    if (isDuplicate(err)) return; // already on the device — fine
    throw err;
  }
  // A failed lookup must not fail the Apply — the object IS on the device. Undo can still find it
  // by name at that point; this is only a shortcut.
  const extra = resolve ? await resolve().catch(() => ({})) : {};
  const created = { ...obj, ...extra };
  out.push(created);
  onProgress?.(created);
}

// planApply works out what Apply would do, in dependency order:
//   addresses → virtual IPs → services → schedules → security profiles → auth servers → users →
//   groups → policies → static route
// It READS the device (to see what is already there) and never writes to it. Objects already
// present are planned as "skip", which is what makes Apply safe to press twice.
//
// `detailed` is set by Dry-run only. It makes the plan also carry the payload and the device's
// current copy for steps Apply would skip, so the preview can show where the two disagree. Apply
// leaves it off, which keeps its device-read profile exactly as it was — in particular the
// Application Control metadata (a ~2,400-entry download) is still fetched only when a sensor
// actually has to be built.
export async function planApply(
  deviceId: number,
  cli: string,
  opts?: { detailed?: boolean },
): Promise<PlanStep[]> {
  const detailed = opts?.detailed === true;
  const steps: PlanStep[] = [];

  // ── 0. VPN tunnel (whole suggestion: Site-to-Site / Remote Access / Hub-and-Spoke) ──
  // A VPN is created as ONE object set by the device proxy (phase1/phase2 → addresses → policies →
  // routes/BGP), so it is applied wholesale here and the per-object loop below is skipped — trying to
  // create its policies/addresses separately would fail (the tunnel interface wouldn't exist yet).
  // Fallback removes it via the cascade delete (see undoApply's "ipsec-tunnel").
  const vpn = parseVPNFromCLI(cli);
  if (vpn) {
    const label = vpn.kind === "hub-spoke" ? "Hub-and-Spoke VPN"
      : vpn.kind === "remote-access" ? "Remote Access VPN" : "Site-to-Site VPN";
    const existing = new Set((await DeviceListIPsecTunnels(deviceId)).map((t) => t.name));
    steps.push(existing.has(vpn.name)
      ? { kind: "ipsec-tunnel", label, name: vpn.name, action: "skip" }
      : { kind: "ipsec-tunnel", label, name: vpn.name, action: "create",
          run: () => DeviceCreateIPsecTunnel(deviceId, vpn.payload) });
    return steps;
  }

  // ── 1. Addresses ──
  const addrs = parseAllAddressesFromCLI(cli);
  if (addrs.length) {
    const onDevice = new Map((await DeviceListAddresses(deviceId)).map((a) => [a.name, a] as const));
    const planned = new Set<string>();
    for (const a of addrs) {
      const name = a.form.name ?? a.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const addressPayload = buildAddressPayload(addressDraftToForm(a.form));
      const payload = addressPayload as unknown as Rec;
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "address", label: "Address", name, action: "skip", payload, existing: current as unknown as Rec }
        : { kind: "address", label: "Address", name, action: "create", payload,
            run: () => DeviceCreateAddress(deviceId, addressPayload) });
    }
  }

  // ── 1b. Virtual IPs ──
  // A VIP is referenced by NAME in a policy's dstaddr (it is a DNAT object, not a security
  // profile), so it must exist before the policy — same ordering as a plain address.
  const vips = parseAllVIPsFromCLI(cli);
  if (vips.length) {
    const onDevice = new Map((await DeviceListVirtualIPs(deviceId)).map((v) => [v.name, v] as const));
    const planned = new Set<string>();
    for (const v of vips) {
      const name = v.form.name ?? v.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const payload = vipDraftToForm(v.form);
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "virtual-ip", label: "Virtual IP", name, action: "skip",
            payload: payload as unknown as Rec, existing: current as unknown as Rec }
        : { kind: "virtual-ip", label: "Virtual IP", name, action: "create",
            payload: payload as unknown as Rec, run: () => DeviceCreateVirtualIP(deviceId, payload) });
    }
  }

  // ── 2. Services ──
  const svcs = parseAllServicesFromCLI(cli);
  if (svcs.length) {
    const onDevice = new Map((await DeviceListServices(deviceId)).map((s) => [s.name, s] as const));
    const planned = new Set<string>();
    for (const s of svcs) {
      const name = s.form.name ?? s.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const servicePayload = buildServicePayload(serviceDraftToForm(s.form));
      const payload = servicePayload as unknown as Rec;
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "service", label: "Service", name, action: "skip", payload, existing: current as unknown as Rec }
        : { kind: "service", label: "Service", name, action: "create", payload,
            run: () => DeviceCreateService(deviceId, servicePayload) });
    }
  }

  // ── 3. Schedules (a policy's "set schedule" points at one of these) ──
  const scheds = parseAllSchedulesFromCLI(cli);
  if (scheds.length) {
    const onDevice = new Map((await DeviceListSchedules(deviceId)).map((s) => [s.name, s] as const));
    const planned = new Set<string>();
    for (const s of scheds) {
      const name = s.form.name ?? s.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const payload = scheduleDraftToForm(s.form);
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "schedule", label: "Schedule", name, action: "skip",
            payload: payload as unknown as Rec, existing: current as unknown as Rec }
        : { kind: "schedule", label: "Schedule", name, action: "create",
            payload: payload as unknown as Rec, run: () => DeviceCreateSchedule(deviceId, payload) });
    }
  }

  // ── 4. Security profiles (ALL of them — a multi-policy suggestion may define several) ──
  // Structured creates (not raw CLI): the backend builds the per-protocol fields, the Static URL /
  // Static Domain Filter tables and validates signature ids against the device's live application
  // database. Two notable things it does that raw CLI would not:
  //   · DNS Filter — drops "allow" category rows, which FortiOS otherwise stores as "block", the
  //     opposite of what was asked (see the DNS Filter section of fortigate.go).
  //   · File Filter — maps Monitor→log-only and rejects a password-protected rule carrying a
  //     non-archive type, which the device would answer with a bare -3.
  // Each block is parsed from its OWN standalone CLI (extractPrereqBlocks), so two different app
  // sensors or web filters across two policies both get built — not just the first of each kind.
  // (ips never reaches here: canApplyViaREST rejects that section, so the whole suggestion takes
  // the SSH path instead.)
  const profiles = await DeviceGetPolicyProfiles(deviceId).catch(() => null);
  const profileState: Partial<Record<PrereqKind, { label: string; onDevice: Set<string> }>> = {
    "antivirus":           { label: "AntiVirus",           onDevice: new Set(profiles?.av_profiles ?? []) },
    "webfilter":           { label: "Web Filter",          onDevice: new Set(profiles?.webfilter_profiles ?? []) },
    "dnsfilter":           { label: "DNS Filter",          onDevice: new Set(profiles?.dnsfilter_profiles ?? []) },
    "application-control": { label: "Application Control", onDevice: new Set(profiles?.app_lists ?? []) },
    "file-filter":         { label: "File Filter",         onDevice: new Set(profiles?.file_filter_profiles ?? []) },
  };

  // The Application Control signature database is a ~2,400-entry download, so it is fetched at most
  // once per plan and only when a form actually has to be built out of it.
  let appMeta: Awaited<ReturnType<typeof DeviceGetAppControlMetadata>> | null = null;
  const appMetaOnce = async () => (appMeta ??= await DeviceGetAppControlMetadata(deviceId));

  // Parsing a block yields its name plus a builder for the form — deliberately separate, because the
  // name decides whether the object needs building at all, and building an app sensor costs a device
  // round-trip we do not want to spend on a profile that is already there.
  const parseProfileBlock = (block: PrereqBlock): { name: string; build: () => Promise<Rec> } | null => {
    switch (block.kind) {
      case "antivirus": {
        const d = parseAntivirusFromCLI(block.cli);
        const name = d?.form.name ?? d?.target ?? block.name;
        return d && name ? { name, build: async () => avDraftToForm(d.form) as unknown as Rec } : null;
      }
      case "webfilter": {
        const d = parseWebFilterFromCLI(block.cli);
        const name = d?.form.name ?? d?.target ?? block.name;
        return d && name ? { name, build: async () => webFilterDraftToForm(d.form) as unknown as Rec } : null;
      }
      case "dnsfilter": {
        const d = parseDNSFilterFromCLI(block.cli);
        const name = d?.form.name ?? d?.target ?? block.name;
        return d && name ? { name, build: async () => dnsFilterDraftToForm(d.form) as unknown as Rec } : null;
      }
      case "file-filter": {
        const d = parseFileFilterFromCLI(block.cli);
        const name = d?.form.name ?? d?.target ?? block.name;
        return d && name ? { name, build: async () => fileFilterDraftToForm(d.form) as unknown as Rec } : null;
      }
      case "application-control": {
        const d = parseAppControlFromCLI(block.cli);
        const name = d?.name ?? d?.target ?? block.name;
        return d && name ? {
          name,
          build: async () => {
            const meta = await appMetaOnce();
            return appControlDraftToForm(d, EMPTY_APPCONTROL_FORM, meta.categories, meta.applications) as unknown as Rec;
          },
        } : null;
      }
      default: return null; // "ips" — no REST endpoint, so this CLI never took the fast path
    }
  };

  for (const block of extractPrereqBlocks(cli)) {
    const state = profileState[block.kind];
    if (!state) continue;
    const parsed = parseProfileBlock(block);
    if (!parsed) continue;
    const category = block.kind as SecurityProfileCategory;
    const kind = block.kind as Extract<AppliedKind,
      "antivirus" | "webfilter" | "dnsfilter" | "application-control" | "file-filter">;
    const { name } = parsed;

    if (state.onDevice.has(name)) {
      // Apply leaves this profile alone. Dry-run still pulls both sides so it can show whether the
      // profile on the device actually matches what was just proposed.
      steps.push(detailed
        ? { kind, label: state.label, name, action: "skip",
            payload: await parsed.build(),
            existing: (await DeviceGetSecurityProfile(deviceId, category, name)) as unknown as Rec | null }
        : { kind, label: state.label, name, action: "skip" });
      continue;
    }
    state.onDevice.add(name); // guard against the same name appearing twice in one batch
    const payload = await parsed.build();
    steps.push({ kind, label: state.label, name, action: "create", payload,
      run: () => DeviceCreateSecurityProfile(deviceId, category, payload as never) });
  }

  // ── 4a2. Remote auth servers (LDAP / RADIUS) ──
  // Before local users and groups: a user group can list an LDAP or RADIUS server as a member,
  // and a member the device doesn't have kills the whole group with -3.
  const ldaps = parseAllLDAPServersFromCLI(cli);
  if (ldaps.length) {
    const onDevice = new Map((await DeviceListLDAPServers(deviceId)).map((s) => [s.name, s] as const));
    const planned = new Set<string>();
    for (const l of ldaps) {
      const name = l.form.name ?? l.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const payload = ldapServerDraftToForm({ ...l.form, name });
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "ldap-server", label: "LDAP Server", name, action: "skip",
            payload: payload as unknown as Rec, existing: current as unknown as Rec }
        : { kind: "ldap-server", label: "LDAP Server", name, action: "create",
            payload: payload as unknown as Rec, run: () => DeviceCreateLDAPServer(deviceId, payload) });
    }
  }

  const radiuses = parseAllRADIUSServersFromCLI(cli);
  if (radiuses.length) {
    const onDevice = new Map((await DeviceListRADIUSServers(deviceId)).map((s) => [s.name, s] as const));
    const planned = new Set<string>();
    for (const r of radiuses) {
      const name = r.form.name ?? r.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const payload = radiusServerDraftToForm({ ...r.form, name });
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "radius-server", label: "RADIUS Server", name, action: "skip",
            payload: payload as unknown as Rec, existing: current as unknown as Rec }
        : { kind: "radius-server", label: "RADIUS Server", name, action: "create",
            payload: payload as unknown as Rec, run: () => DeviceCreateRADIUSServer(deviceId, payload) });
    }
  }

  // ── 4b. Local users (before groups — a group's members must already exist, or the device
  //        rejects the whole group with "-3 entry not found in datasource") ──
  const users = parseAllUserDefinitionsFromCLI(cli);
  if (users.length) {
    const onDevice = new Map((await DeviceListUsers(deviceId)).map((u) => [u.name, u] as const));
    const planned = new Set<string>();
    for (const u of users) {
      const name = u.form.name ?? u.target;
      if (!name || planned.has(name)) continue;
      planned.add(name);
      const payload = userDefinitionDraftToForm(u.form);
      const current = onDevice.get(name);
      steps.push(current
        ? { kind: "user", label: "User", name, action: "skip",
            payload: payload as unknown as Rec, existing: current as unknown as Rec }
        : { kind: "user", label: "User", name, action: "create",
            payload: payload as unknown as Rec, run: () => DeviceCreateUser(deviceId, payload) });
    }
  }

  // ── 4c. User groups ──
  // A group the device already has is UPDATED, not skipped: "put alice in Office-Users" is a
  // member-list edit on an existing group. The AI is told to re-emit the full member line, but we
  // merge with what's on the device anyway so a forgotten name can't silently drop a member.
  const groups = parseAllUserGroupsFromCLI(cli);
  if (groups.length) {
    const existing = new Set((await DeviceListUserGroups(deviceId)).map((g) => g.name));
    for (const g of groups) {
      const name = g.form.name ?? g.target;
      if (!name) continue;
      const form = userGroupDraftToForm({ ...g.form, name });

      if (!existing.has(name)) {
        existing.add(name);
        steps.push({ kind: "user-group", label: "User Group", name, action: "create",
          payload: form as unknown as Rec, run: () => DeviceCreateUserGroup(deviceId, form) });
        continue;
      }
      // Existing group: only a member change is meaningful here, and only for the types that
      // store members at all.
      if (!groupTakesMembers(form.group_type) || !form.members?.length) {
        steps.push({ kind: "user-group", label: "User Group", name, action: "skip" });
        continue;
      }
      const current = await DeviceGetUserGroup(deviceId, name).catch(() => null);
      if (!current) {
        steps.push({ kind: "user-group", label: "User Group", name, action: "skip" });
        continue;
      }
      const before = current.members ?? [];
      const merged = Array.from(new Set([...before, ...form.members]));
      if (merged.length === before.length) { // nothing new to add
        steps.push({ kind: "user-group", label: "User Group", name, action: "skip",
          payload: { members: form.members } as Rec, existing: { members: before } as Rec });
        continue;
      }
      // An EDIT, not a create: Fallback puts the group back as it was rather than deleting a group
      // the user already had. This is the ONE step in the plan that writes to an object the user
      // did not ask us to create, which is exactly what Dry-run's before/after is for.
      const updated = { ...current, name, members: merged };
      steps.push({
        kind: "user-group", label: "User Group (members)", name, action: "update",
        payload: updated as unknown as Rec,
        existing: { ...current, name, members: before } as unknown as Rec,
        run: () => DeviceUpdateUserGroup(deviceId, name, updated),
        restore: { kind: "user-group", payload: { ...current, name, members: before } },
      });
    }
  }

  // ── 4b. SD-WAN ──
  // After the addresses a rule matches on and before the policies, which may name an SD-WAN zone as
  // their outgoing interface. See applySDWAN.ts for the sequence-number handover that makes the
  // health checks and rules point at the members created just above rather than at strangers.
  const sdwan = parseSDWANFromCLI(cli);
  if (sdwan) {
    steps.push(...await planSDWANSteps(deviceId, sdwan, { detailed }));
  }

  // ── 5. Policies (last — every object they reference now exists) ──
  // EVERY policy the suggestion defines, created in the AI's written order. FortiOS `edit 0` appends
  // to the bottom, so creating them in order lands them bottom-of-rule-base in that same order — and
  // the AI writes the more-specific policy BEFORE the broader one, so the specific one ends up ABOVE
  // (first match wins). The per-policy Policy Wizard is where a user pins an exact position instead.
  const pols = parseAllPoliciesFromCLI(cli);
  if (pols.length) {
    const onDevice = new Map((await DeviceListPolicies(deviceId)).map((p) => [p.name, p] as const));
    const planned = new Set<string>();
    for (const pol of pols) {
      const form = policyDraftToFormState(pol.form);
      if (!form.name || planned.has(form.name)) continue;
      planned.add(form.name);
      const policyPayload = buildPolicyPayload(form);
      const payload = policyPayload as unknown as Rec;
      const current = onDevice.get(form.name);
      if (current) {
        steps.push({ kind: "policy", label: "Policy", name: form.name, action: "skip",
          payload, existing: policyToComparable(current) });
        continue;
      }
      steps.push({
        kind: "policy", label: "Policy", name: form.name, action: "create", payload,
        run: () => DeviceCreatePolicy(deviceId, policyPayload),
        // The AI's CLI says `edit 0` and lets FortiOS assign the policy id, so read it back — that id
        // is the mkey Fallback deletes by.
        resolve: async () => ({ policyId: (await DeviceListPolicies(deviceId)).find((p) => p.name === form.name)?.id }),
      });
    }
  }

  // ── 6. Static route ──
  const route = parseRouteFromCLI(cli);
  if (route) {
    const form = routeDraftToForm(route.form);
    // A static route has no name — it is keyed by a sequence number FortiOS assigns. Treat
    // "same destination + same gateway" as already-present so a re-Apply doesn't add a twin.
    const label = form.dstType === "internet-service" ? form.internetServiceName : form.dst;
    const before = await DeviceListStaticRoutes(deviceId).catch(() => []);
    const twin = before.find((r) => r.dst === form.dst && String(r.gateway) === String(form.gateway));
    const routePayload = buildRoutePayload(form);
    const payload = routePayload as unknown as Rec;
    const name = label || "route";
    if (twin) {
      steps.push({ kind: "static-route", label: "Static Route", name, action: "skip",
        payload, existing: twin as unknown as Rec });
    } else {
      const seen = new Set(before.map((r) => r.seq_num));
      steps.push({
        kind: "static-route", label: "Static Route", name, action: "create", payload,
        run: () => DeviceCreateStaticRoute(deviceId, routePayload),
        // Routes have no name to look up by, so identify the new one as the seq that wasn't there
        // before the create. Without this, Fallback could only match on destination.
        resolve: async () => ({ seq: (await DeviceListStaticRoutes(deviceId)).find((r) => !seen.has(r.seq_num))?.seq_num }),
      });
    }
  }

  return steps;
}

// A firewall policy comes back from the device with its multi-value fields split into `*_list`
// arrays, while the create payload carries them under the bare name. Line the two up so a diff
// compares src_addr with src_addr, not with nothing.
function policyToComparable(p: FirewallPolicy): Rec {
  return {
    name: p.name,
    src_intf: p.src_intf, dst_intf: p.dst_intf,
    src_intf_list: p.src_intf_list, dst_intf_list: p.dst_intf_list,
    src_addr: p.src_addr_list, dst_addr: p.dst_addr_list, service: p.service_list,
    schedule: p.schedule, action: p.action, nat: p.nat, log_traffic: p.log_traffic,
    enabled: p.enabled, comments: p.comments,
    ippool: p.ippool, poolname: p.poolname, fixedport: p.fixedport,
    protocol_options: p.protocol_options,
    av_profile: p.av_profile, webfilter_profile: p.webfilter_profile,
    dnsfilter_profile: p.dnsfilter_profile, app_control: p.app_control,
    ips_sensor: p.ips_sensor, file_filter_profile: p.file_filter_profile,
    ssl_ssh_profile: p.ssl_ssh_profile, decrypted_traffic_mirror: p.decrypted_traffic_mirror,
  };
}

// applyViaREST carries out the plan. Objects already present on the device are skipped, so Apply is
// safe to press twice. onProgress fires as each object lands, so the chat can stream its ✓ lines
// instead of dumping them all at the end.
export async function applyViaREST(
  deviceId: number,
  cli: string,
  onProgress?: (o: AppliedObject) => void,
): Promise<AppliedObject[]> {
  const created: AppliedObject[] = [];
  for (const step of await planApply(deviceId, cli)) {
    if (!step.run) continue; // a skip — the device already has it
    const obj: AppliedObject = {
      kind: step.kind, label: step.label, name: step.name,
      ...(step.restore ? { restore: step.restore } : {}),
    };
    if (step.action === "update") {
      // An update targets an object that is already there, so -5 cannot happen and a failure is
      // real: let it propagate rather than swallowing it as "already exists".
      await step.run();
      created.push(obj);
      onProgress?.(obj);
      continue;
    }
    await createSkippingDuplicates(obj, step.run, created, onProgress, step.resolve);
  }
  return created;
}
