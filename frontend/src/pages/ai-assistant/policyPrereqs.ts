import { CreateConfigDeploy, GetConfigDeploy } from "../../api/device";
import {
  DeviceListAddresses, DeviceCreateAddress, DeviceListServices, DeviceCreateService,
  DeviceCreateSecurityProfile, DeviceGetAppControlMetadata,
  DeviceListSchedules, DeviceCreateSchedule,
  DeviceListVirtualIPs, DeviceCreateVirtualIP,
} from "../../api/policyObject";
import { buildAddressPayload } from "../fw-addresses/address-form.logic";
import { buildServicePayload } from "../fw-services/service-form.logic";
import { EMPTY_APPCONTROL_FORM } from "../security-profiles/appcontrol-form.logic";
import { webFilterDraftToForm } from "./parseWebFilterCLI";
import { appControlDraftToForm } from "./parseAppControlCLI";
import { avDraftToForm } from "./parseAntivirusCLI";
import { dnsFilterDraftToForm } from "./parseDNSFilterCLI";
import { fileFilterDraftToForm } from "./parseFileFilterCLI";
import { addressDraftToForm } from "./parseAddressCLI";
import { serviceDraftToForm } from "./parseServiceCLI";
import { scheduleDraftToForm } from "./parseScheduleCLI";
import { vipDraftToForm } from "./parseVirtualIPCLI";
import type { PolicyFormState } from "../firewall-policy/create.logic";
import type { PrereqBlock, PrereqKind } from "./parsePrereqCLI";
import type { CreatedObject, PendingDefs, RelKind } from "./relObjects";
import { deviceMessage } from "./fortiosError";

// Apply builds every prerequisite the policy POINTS AT before the policy itself, for both create
// and edit: an edit can newly reference a schedule, address, service, VIP or profile that is not on
// the device yet, and without this DeviceUpdatePolicy fails with FortiGate -3 "entry not found in
// datasource". Each function is idempotent - it re-reads what the device holds and treats a
// duplicate (-5) as "already there" - so a re-Apply over existing objects creates nothing.
//
// Moved out of PolicyWizard.tsx unchanged when that file crossed the 48 KB byte ceiling. The five
// functions closed over a dozen of the component props and two of its setters, so rather than a
// hook whose signature would list all of them they take ONE context object plus the two callbacks
// the component needs back (markRelCreated, onObjectCreated) - the shape useAiConversation already
// uses. Nothing here touches React, which is the point: it is testable without one.

/** Everything the prerequisite builders need from the wizard. */
export type PrereqCtx = PendingDefs & {
  deviceId: number;
  form: PolicyFormState;
  /** The live group/sensor lists - a referenced GROUP already exists and is never built here. */
  profiles: { address_groups: string[]; service_groups: string[]; ips_sensors: string[] };
  pendingProfiles?: PrereqBlock[];
  /** "kind:name" of everything built in a sub-wizard this session - never built twice. */
  createdRel: Set<string>;
  markRelCreated: (kind: RelKind, name: string) => void;
  onObjectCreated?: (obj: CreatedObject) => void;
};

const relKey = (k: RelKind, n: string) => (k + ":" + n) as string;

// The terminal deploy states (mirrors the AI page's TERMINAL constant).
const DEPLOY_TERMINAL = ["SUCCESS", "FAILED", "PARTIAL"];

// FortiGate rejects a duplicate name with -5; every create path treats that as "already there"
// so a re-Apply never aborts over an object that exists.
const isDuplicateErr = (err: unknown) =>
  /(-5\b|already exist|duplicat)/i.test(deviceMessage(err, ""));

// deployAndWait pushes the given CLI to the device and resolves only when it finishes, throwing on
// anything but SUCCESS. Used to create a prerequisite security profile from the AI's CLI block
// before the policy that references it, for the profile kinds with no structured REST create.
async function deployAndWait(deviceId: number, cli: string): Promise<void> {
  const res = await CreateConfigDeploy({ device_ids: [deviceId], command_text: cli });
  let d = await GetConfigDeploy(res.id);
  for (let i = 0; i < 60 && !DEPLOY_TERMINAL.includes(d.status); i++) {
    await new Promise((r) => setTimeout(r, 1000));
    d = await GetConfigDeploy(res.id);
  }
  if (d.status !== "SUCCESS") {
    const err = (d.results ?? []).map((r) => r.error).filter(Boolean).join("; ");
    throw new Error(err || `Config deploy ${d.status}`);
  }
}

// ensureReferencedAddresses auto-creates any src/dst address the policy references that
// doesn't exist on the device yet — using the AI's proposed definition (pendingAddresses).
// This lets the user go straight to the Policy Wizard and Apply without first opening the
// Address Wizard: the system creates the address (the "related object") first, then the
// policy. Returns the names it created (for a friendly message). Throws a clear error if a
// referenced address is missing AND has no definition to build from.
// ensureReferencedVIPs auto-creates any Virtual IP the policy references in src/dst that isn't on
// the device yet — a VIP is a DNAT object referenced by name in dstaddr, so it must exist before
// the policy AND before ensureReferencedAddresses (which would otherwise mistake the VIP name for
// a missing plain address and throw). Returns the names it created.
export async function ensureReferencedVIPs(ctx: PrereqCtx): Promise<string[]> {
  const { deviceId, form, pendingVIPs = [], markRelCreated } = ctx;
  if (pendingVIPs.length === 0) return [];
  const referenced = new Set([...form.srcAddr, ...form.dstAddr].filter(Boolean));
  const existing = new Set((await DeviceListVirtualIPs(deviceId)).map((v) => v.name));
  const created: string[] = [];
  for (const v of pendingVIPs) {
    const name = v.form.name ?? v.target;
    if (!name || !referenced.has(name) || existing.has(name)) continue;
    try {
      await DeviceCreateVirtualIP(deviceId, vipDraftToForm(v.form));
    } catch (err) {
      if (!isDuplicateErr(err)) throw err;
    }
    markRelCreated("virtualip", name);
    created.push(name);
  }
  return created;
}

export async function ensureReferencedAddresses(ctx: PrereqCtx): Promise<string[]> {
  const { deviceId, form, profiles, pendingVIPs = [], pendingAddresses = [] } = ctx;
  const referenced = Array.from(new Set([...form.srcAddr, ...form.dstAddr])).filter(Boolean);
  const builtins = new Set(["all", "none"]);
  const groups = new Set(profiles.address_groups);
  const existing = new Set((await DeviceListAddresses(deviceId)).map((a) => a.name));
  // A VIP referenced in dstaddr is NOT a firewall/address — ensureReferencedVIPs already made it,
  // and it lives in a different CMDB table, so it must be skipped here or this throws "no
  // definition" for a name that is, correctly, absent from firewall/address.
  const vipNames = new Set(pendingVIPs.map((p) => p.form.name ?? p.target));
  const created: string[] = [];
  for (const name of referenced) {
    if (existing.has(name) || groups.has(name) || builtins.has(name) || vipNames.has(name)) continue;
    const draftAddr = pendingAddresses.find((p) => (p.form.name ?? p.target) === name);
    if (!draftAddr) {
      throw new Error(`Address "${name}" doesn't exist on the device and has no definition to create it. Open the Address Wizard for it first, or pick an existing address.`);
    }
    await DeviceCreateAddress(deviceId, buildAddressPayload(addressDraftToForm(draftAddr.form)));
    created.push(name);
  }
  return created;
}

// ensureReferencedServices auto-creates any service the policy references that isn't on the
// device yet — using the AI's proposed definition (pendingServices). Built-in services (ALL,
// HTTP, HTTPS, DNS, …) and service groups already exist, so only genuinely-new custom services
// are created. Returns the names it created; throws if a referenced service is missing AND has
// no definition to build from.
export async function ensureReferencedServices(ctx: PrereqCtx): Promise<string[]> {
  const { deviceId, form, profiles, pendingServices = [] } = ctx;
  const referenced = Array.from(new Set(form.service)).filter(Boolean);
  const groups = new Set(profiles.service_groups);
  const existing = new Set((await DeviceListServices(deviceId)).map((s) => s.name));
  const created: string[] = [];
  for (const name of referenced) {
    if (existing.has(name) || groups.has(name)) continue;
    const draftSvc = pendingServices.find((p) => (p.form.name ?? p.target) === name);
    if (!draftSvc) {
      throw new Error(`Service "${name}" doesn't exist on the device and has no definition to create it. Open the Service Wizard for it first, or pick an existing service.`);
    }
    await DeviceCreateService(deviceId, buildServicePayload(serviceDraftToForm(draftSvc.form)));
    created.push(name);
  }
  return created;
}

// ensureReferencedSchedule auto-creates the schedule the policy references when it isn't on the
// device yet — using the AI's proposed definition (pendingSchedules). "always"/"none" are built in
// and always present. Same contract as ensureReferencedAddresses: create the prerequisite first,
// then the policy that points at it. Throws a clear error if the schedule is missing AND the AI
// gave no definition to build it from (FortiGate would otherwise reject the whole policy).
export async function ensureReferencedSchedule(ctx: PrereqCtx): Promise<string[]> {
  const { deviceId, form, createdRel, pendingSchedules = [] } = ctx;
  const wanted = (form.schedule || "").trim();
  if (!wanted || wanted === "always" || wanted === "none") return [];
  // Already built from the Related Objects sub-wizard this session → don't create it twice.
  if (createdRel.has(relKey("schedule", wanted))) return [];

  const existing = new Set((await DeviceListSchedules(deviceId)).map((s) => s.name));
  if (existing.has(wanted)) return [];

  const draftSched = pendingSchedules.find((p) => (p.form.name ?? p.target) === wanted);
  if (!draftSched) {
    throw new Error(`Schedule "${wanted}" doesn't exist on the device and has no definition to create it. Open the Schedule Wizard for it first, or pick an existing schedule.`);
  }
  await DeviceCreateSchedule(deviceId, scheduleDraftToForm(draftSched.form));
  return [wanted];
}

// ensureReferencedProfiles auto-creates any enabled security profile the policy references
// that isn't on the device yet — by deploying the AI's own CLI block for it (pendingProfiles).
// This is the security-profile equivalent of ensureReferencedAddresses: the user can go straight
// to the Policy Wizard and Apply, and the system creates every prerequisite object (new
// Application Control / Web Filter / AntiVirus / … profile) first, then the policy. Returns the
// "kind:name" labels it created. Throws a clear error if a referenced profile is missing AND has
// no CLI block to build it from (the user must then pick an existing profile).
export async function ensureReferencedProfiles(
  ctx: PrereqCtx,
  fresh: { av: Set<string>; web: Set<string>; dns: Set<string>; app: Set<string>; file: Set<string> },
): Promise<CreatedObject[]> {
  const { deviceId, form, profiles, createdRel, markRelCreated, onObjectCreated,
    pendingProfiles = [], pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF } = ctx;
  const KIND_LABEL: Record<PrereqKind, string> = {
    "antivirus": "AntiVirus", "webfilter": "Web Filter", "application-control": "Application Control",
    "dnsfilter": "DNS Filter", "ips": "IPS", "file-filter": "File Filter",
  };
  // Each enabled profile field → its referenced name + the LIVE existing list for that kind. Every
  // kind with a structured create uses the just-refreshed sets (so a re-Apply skips one already
  // created); only IPS falls back to the mount-time snapshot, as it isn't auto-created here.
  const refs: { name: string; kind: PrereqKind; existing: Set<string> | string[] }[] = [
    form.avEnabled  && form.avProfile   ? { name: form.avProfile,   kind: "antivirus" as const,           existing: fresh.av } : null,
    form.webEnabled && form.webProfile  ? { name: form.webProfile,  kind: "webfilter" as const,           existing: fresh.web } : null,
    form.appEnabled && form.appProfile  ? { name: form.appProfile,  kind: "application-control" as const, existing: fresh.app } : null,
    form.dnsEnabled && form.dnsProfile  ? { name: form.dnsProfile,  kind: "dnsfilter" as const,           existing: fresh.dns } : null,
    form.ipsEnabled && form.ipsProfile  ? { name: form.ipsProfile,  kind: "ips" as const,                 existing: profiles.ips_sensors } : null,
    form.fileEnabled && form.fileProfile ? { name: form.fileProfile, kind: "file-filter" as const,        existing: fresh.file } : null,
  ].filter(Boolean) as { name: string; kind: PrereqKind; existing: Set<string> | string[] }[];

  const relKindOf: Partial<Record<PrereqKind, RelKind>> = {
    antivirus: "antivirus", webfilter: "webfilter", dnsfilter: "dnsfilter",
    "application-control": "appcontrol", "file-filter": "filefilter",
  };
  const has = (e: Set<string> | string[], n: string) => (e instanceof Set ? e.has(n) : e.includes(n));
  const created: CreatedObject[] = [];
  for (const r of refs) {
    const rk = relKindOf[r.kind];
    // Skip if already on the device (fresh check) OR created this session.
    if (has(r.existing, r.name) || (rk && createdRel.has(`${rk}:${r.name}`))) continue;

    // A duplicate (device error -5) can still race in — treat it as "already there" and skip,
    // so Apply is idempotent and never aborts the whole policy over an object that exists.
    try {
      // Web Filter: STRUCTURED create so the Static URL Filter table gets built by the backend
      // (raw CLI is fragile — a hard-coded urlfilter-table id would overwrite a live table).
      if (r.kind === "webfilter" && pendingWeb && (pendingWeb.form.name ?? pendingWeb.target) === r.name) {
        await DeviceCreateSecurityProfile(deviceId, "webfilter", webFilterDraftToForm(pendingWeb.form));
      } else if (r.kind === "antivirus" && pendingAV && (pendingAV.form.name ?? pendingAV.target) === r.name) {
        // AntiVirus: STRUCTURED create too — same path the AntiVirus Wizard and the Security
        // Profiles page use, so the per-protocol scan/quarantine fields are built by the backend
        // instead of round-tripping raw CLI through the worker.
        await DeviceCreateSecurityProfile(deviceId, "antivirus", avDraftToForm(pendingAV.form));
      } else if (r.kind === "dnsfilter" && pendingDNS && (pendingDNS.form.name ?? pendingDNS.target) === r.name) {
        // DNS Filter: STRUCTURED create too. Raw CLI would be actively dangerous here — its
        // `set domain-filter-table <id>` hard-codes a table id that may already belong to another
        // profile, and a `set action allow` category row is stored by FortiOS as "block" (200 OK,
        // no error). The backend resolves the table by name and drops allow rows instead.
        await DeviceCreateSecurityProfile(deviceId, "dnsfilter", dnsFilterDraftToForm(pendingDNS.form));
      } else if (r.kind === "application-control" && pendingApp && pendingApp.name === r.name) {
        // Application Control: STRUCTURED create too, so the draft's signature ids are checked
        // against the device's live application database first — an id the device doesn't have is
        // dropped rather than deployed, since it would build a profile that matches nothing.
        const m = await DeviceGetAppControlMetadata(deviceId);
        const acForm = appControlDraftToForm(pendingApp, EMPTY_APPCONTROL_FORM, m.categories, m.applications);
        await DeviceCreateSecurityProfile(deviceId, "application-control", acForm);
      } else if (r.kind === "file-filter" && pendingFF && (pendingFF.form.name ?? pendingFF.target) === r.name) {
        // File Filter: STRUCTURED create too, so the backend maps Monitor→log-only and enforces
        // the rule constraints the CLI path would only surface as a bare device code (a
        // password-protected rule carrying a non-archive type is -3; no file types is -61).
        await DeviceCreateSecurityProfile(deviceId, "file-filter", fileFilterDraftToForm(pendingFF.form));
      } else {
        const block = pendingProfiles.find((b) => b.kind === r.kind && b.name === r.name);
        if (!block) {
          throw new Error(`${KIND_LABEL[r.kind]} profile "${r.name}" doesn't exist on the device and there's no definition to create it. Open its Wizard first, or pick an existing profile.`);
        }
        await deployAndWait(deviceId, block.cli);
      }
      if (rk) markRelCreated(rk, r.name);
      const obj: CreatedObject = { kind: rk ?? (r.kind as CreatedObject["kind"]), label: KIND_LABEL[r.kind], name: r.name };
      created.push(obj);
      onObjectCreated?.(obj); // report each profile to the chat as it lands on the device
    } catch (err) {
      if (isDuplicateErr(err)) continue; // already exists — fine, skip
      throw err;
    }
  }
  return created;
}
