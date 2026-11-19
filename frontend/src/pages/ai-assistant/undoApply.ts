// undoApply — the chat's "Fallback" button.
//
// WHY THIS EXISTS
// Apply pushes the AI's suggestion straight onto a live firewall. If the network then misbehaves,
// the user needs to get back to where they were in one click — not hunt down six objects across
// five pages while traffic is broken. Fallback removes exactly what THIS chat message put on the
// device, and nothing else.
//
// TWO RULES THIS FILE IS BUILT AROUND
//
// 1. Only ever remove what we created. Every object here comes from an AppliedObject that a create
//    call actually returned — objects that already existed are skipped by applyViaREST (and open
//    read-only in the wizards), so they never enter the undo list and can never be deleted.
//    An object that was EDITED rather than created carries a `restore` snapshot instead: undoing it
//    means writing the old payload back, never deleting an object the user already had.
//
// 2. Delete by mkey, never at a collection URL. A DELETE on a CMDB collection wipes the whole table
//    (this project has lost every firewall policy that way once). Each branch below names its object.
//
// ORDER MATTERS: it is the reverse of the create order. A policy references the addresses,
// services, schedule and profiles it was built from, and FortiGate refuses to delete an object that
// is still in use (error -23). So the policy goes first, then the objects it pointed at.

import {
  DeviceUpdateSecurityProfile,
  DeviceUpdateVirtualIP,
  DeviceUpdateUser,
  DeviceUpdateLDAPServer, DeviceUpdateRADIUSServer,
  DeviceDeleteAddress,
  DeviceDeleteService,
  DeviceListSchedules, DeviceDeleteSchedule,
  DeviceDeleteSecurityProfile,
  DeviceListPolicies, DeviceDeletePolicy,
  DeviceListStaticRoutes, DeviceDeleteStaticRoute,
  DeviceDeleteVirtualIP,
  DeviceDeleteUser,
  DeviceDeleteUserGroup, DeviceUpdateUserGroup,
  DeviceDeleteLDAPServer, DeviceDeleteRADIUSServer, DeviceDeleteExchangeConnector,
  DeviceDeleteIPsecTunnel,
  DeviceGetSDWAN, DeviceDeleteSDWANZone, DeviceDeleteSDWANMember,
  DeviceListSDWANHealthChecks, DeviceDeleteSDWANHealthCheck,
  DeviceListSDWANRules, DeviceDeleteSDWANRule,
  type SecurityProfileCategory,
} from "../../api/policyObject";
import type { AppliedObject, AppliedKind } from "./applyViaREST";
import {
  AlreadyGoneError, deviceMessage, isGoneError, isStillReferencedError,
} from "./fortiosError";

// Reverse dependency order — lower rank is deleted first.
//
// The two user kinds sit at the end and in this order for a reason: a policy may reference a
// group, a group references its users, and FortiGate refuses to delete anything still pointed at
// (-23). So policy → … → group → user.
const UNDO_RANK: Record<AppliedKind, number> = {
  "ipsec-tunnel": -1,      // a whole ADVPN set — its own cascade delete removes its policies/BGP/etc first
  policy: 0,               // references everything below → must go first
  "static-route": 1,
  // SD-WAN unwinds in the exact reverse of the order Apply built it: a rule points at members and
  // health checks, a health check names members, and a member sits in a zone — and FortiGate
  // refuses to delete anything still pointed at. They rank between the policy and the profiles
  // because a firewall policy can name an SD-WAN zone as its outgoing interface.
  "sdwan-rule": 1.1,
  "sdwan-health-check": 1.2,
  "sdwan-member": 1.3,
  "sdwan-zone": 1.4,
  antivirus: 2,
  webfilter: 2,
  dnsfilter: 2,
  "application-control": 2,
  "file-filter": 2,
  schedule: 3,
  service: 4,
  "virtual-ip": 5,       // referenced by a policy's dstaddr → after the policy, with addresses
  address: 5,
  "user-group": 6,         // must go before its members
  user: 7,
  // Auth servers go LAST: a user group can list one as a member, so they can only be removed
  // once every group that pointed at them is gone (FortiGate answers -23 otherwise).
  "ldap-server": 8,
  "radius-server": 8,
  // …and the Exchange connector after the LDAP server that named it, for the same reason.
  "exchange-connector": 9,
};

const PROFILE_CATEGORY: Partial<Record<AppliedKind, SecurityProfileCategory>> = {
  antivirus: "antivirus",
  webfilter: "webfilter",
  dnsfilter: "dnsfilter",
  "application-control": "application-control",
  "file-filter": "file-filter",
};

// The object is already off the device (someone deleted it by hand, or a previous Fallback got it).
// The end state is what we wanted, so this is a success, not an error.
//
// Read as NUMBERS (fortiosError.ts): the device's -3 / -15, the proxy's 404, or our own
// AlreadyGoneError for "we looked the object up and it is not in the device's table". The old test
// scanned the message for `-3\b|-15\b`, which `VLAN-3` and `port 1-15` satisfy with no error code
// present — so a delete that failed for an unrelated reason was crossed off the list as "already
// gone" while the object was still on a live firewall. With no code and no 404 this is false, and
// the object is reported as one Fallback could not remove, which is the honest answer.
const isGone = isGoneError;

// FortiGate refuses to delete an object another object still points at. This is the one failure
// worth spelling out — it usually means something OUTSIDE this chat message now uses the object.
//
// The code (-23) is compared as a number. The device's own 7.2.10 wording ("The entry is used by
// other 1 entry") is kept as a second signal because it is a PHRASE, not an error code dressed as
// one — and because this only chooses the wording of an already-failed delete. It can never turn a
// failure into a success, which is what the numeric rule exists to protect.
const inUseMessage = (obj: AppliedObject, err: unknown): string => {
  if (isStillReferencedError(err) || /\b(used by|in use|referenced)\b/i.test(deviceMessage(err, ""))) {
    return `"${obj.name}" is still referenced by another object on the device, so FortiGate refuses to delete it`;
  }
  return deviceMessage(err);
};

// The route label is either the bare destination (Apply) or "<destination> via <interface>" (the
// wizard). Anchor on the destination so "10.5.0.0/16" can never match "10.55.0.0/16 via port1".
const matchesRoute = (dst: string, label: string): boolean =>
  !!dst && (label === dst || label.startsWith(dst + " "));

// restoreObject writes a pre-edit snapshot back. Every branch is the SAME endpoint the wizard's
// own Save uses, with the payload the wizard read off the device before editing — so this is
// exactly "open the object and press Save without changing anything", which is why it is safe.
async function restoreObject(deviceId: number, obj: AppliedObject): Promise<void> {
  const r = obj.restore!;
  switch (r.kind) {
    case "antivirus":
    case "webfilter":
    case "dnsfilter":
    case "application-control":
    case "file-filter":
      await DeviceUpdateSecurityProfile(deviceId, r.kind, obj.name, r.payload as never);
      return;
    case "virtual-ip":
      await DeviceUpdateVirtualIP(deviceId, obj.name, r.payload);
      return;
    case "user":
      await DeviceUpdateUser(deviceId, obj.name, r.payload);
      return;
    case "user-group":
      await DeviceUpdateUserGroup(deviceId, obj.name, r.payload);
      return;
    case "ldap-server":
      await DeviceUpdateLDAPServer(deviceId, obj.name, r.payload);
      return;
    case "radius-server":
      await DeviceUpdateRADIUSServer(deviceId, obj.name, r.payload);
      return;
  }
}

export type UndoResult = {
  // Everything Fallback dealt with — deleted creates AND restored edits. `restore` on the entry
  // says which happened, so the chat can word its line honestly.
  removed: AppliedObject[];
  failed: { obj: AppliedObject; error: string }[];
};

// A restored object whose write-only secret the edit had changed. The device never returns the old
// password/secret, so nothing could put it back — the caller is told rather than left to assume the
// rollback was complete.
export const restoreKeepsSecret = (obj: AppliedObject): boolean =>
  !!obj.restore && ["user", "ldap-server", "radius-server"].includes(obj.restore.kind);

// undoApply removes every object in `objects` from the device, most-dependent first.
// A failure on one object does NOT abort the rest: if a policy can't be deleted we still report it
// and move on, so the user gets as much of their firewall back as we can give them, plus an honest
// list of what is left. onProgress fires per object removed, so the chat can stream its lines.
export async function undoApply(
  deviceId: number,
  objects: AppliedObject[],
  onProgress?: (o: AppliedObject) => void,
): Promise<UndoResult> {
  const removed: AppliedObject[] = [];
  const failed: { obj: AppliedObject; error: string }[] = [];

  const ordered = [...objects].sort((a, b) => UNDO_RANK[a.kind] - UNDO_RANK[b.kind]);

  // Lazy lookups — only fetched if the undo list actually holds one of these kinds, and only once.
  let policies: Awaited<ReturnType<typeof DeviceListPolicies>> | null = null;
  let schedules: Awaited<ReturnType<typeof DeviceListSchedules>> | null = null;
  let routes: Awaited<ReturnType<typeof DeviceListStaticRoutes>> | null = null;
  let sdwan: Awaited<ReturnType<typeof DeviceGetSDWAN>> | null = null;
  let sdwanRules: Awaited<ReturnType<typeof DeviceListSDWANRules>> | null = null;
  let sdwanHealth: Awaited<ReturnType<typeof DeviceListSDWANHealthChecks>> | null = null;

  for (const obj of ordered) {
    try {
      // An EDIT is undone by writing the snapshot back — never by deleting an object that was
      // already there before this chat message touched it.
      if (obj.restore) {
        await restoreObject(deviceId, obj);
        removed.push(obj);
        onProgress?.(obj);
        continue;
      }

      switch (obj.kind) {
        case "address":
          await DeviceDeleteAddress(deviceId, obj.name);
          break;

        case "service":
          await DeviceDeleteService(deviceId, obj.name);
          break;

        case "virtual-ip":
          await DeviceDeleteVirtualIP(deviceId, obj.name);
          break;

        case "schedule": {
          // firewall.schedule is three separate CMDB tables — the mkey alone isn't enough, the
          // delete needs the type too. Look it up on the device rather than trusting a stale draft.
          schedules ??= await DeviceListSchedules(deviceId);
          const s = schedules.find((x) => x.name === obj.name);
          if (!s) throw { message: "not found" };
          await DeviceDeleteSchedule(deviceId, s.type, obj.name);
          break;
        }

        case "antivirus":
        case "webfilter":
        case "dnsfilter":
        case "application-control":
        case "file-filter":
          // The DNS Filter's Static Domain Filter table is deliberately left behind: FortiGate
          // keeps it too (as it does a Web Filter's urlfilter table), and another profile may
          // reference the same table — deleting it would break that one.
          await DeviceDeleteSecurityProfile(deviceId, PROFILE_CATEGORY[obj.kind]!, obj.name);
          break;

        case "user":
          await DeviceDeleteUser(deviceId, obj.name);
          break;

        case "ldap-server":
          await DeviceDeleteLDAPServer(deviceId, obj.name);
          break;

        case "radius-server":
          await DeviceDeleteRADIUSServer(deviceId, obj.name);
          break;

        case "exchange-connector":
          // Created from the "+ Create" button inside the LDAP form's Exchange server picker.
          // It ranks AFTER the LDAP server that referenced it: FortiGate answers -23 while the
          // server still names it.
          await DeviceDeleteExchangeConnector(deviceId, obj.name);
          break;

        case "ipsec-tunnel":
          // The cascade delete removes the whole ADVPN object set it created — phase2/phase1, the
          // tunnel interface, its policies, its address group and its BGP rows — in the right order.
          await DeviceDeleteIPsecTunnel(deviceId, obj.name);
          break;

        case "user-group":
          // Reaching here means the group was CREATED by this message. A group that merely gained
          // members carries a restore snapshot instead and is handled above.
          await DeviceDeleteUserGroup(deviceId, obj.name);
          break;

        case "policy": {
          // A policy is keyed by the numeric id FortiOS assigned at create (the AI's CLI says
          // `edit 0` and lets the device pick), so resolve the id from its name.
          const id = obj.policyId ?? (policies ??= await DeviceListPolicies(deviceId))
            .find((p) => p.name === obj.name)?.id;
          if (id == null) throw { message: "not found" };
          await DeviceDeletePolicy(deviceId, id);
          break;
        }

        case "sdwan-zone":
          // Refused with -23 while a member is still in it, which is why members rank ahead of it.
          await DeviceDeleteSDWANZone(deviceId, obj.name);
          break;

        case "sdwan-member": {
          // Keyed by a seq-num the device assigned, captured at create time. The fallback lookup is
          // by INTERFACE, because that is what the entry is named after and what stays stable — a
          // firewall cannot have two SD-WAN members on one interface.
          const seq = obj.seq ?? (sdwan ??= await DeviceGetSDWAN(deviceId))
            .members.find((m) => m.interface === obj.name)?.seq_num;
          // Not an error dressed up as one: we read the device's SD-WAN config and the member is
          // not in it, so the end state Fallback wanted is already true. A typed sentinel says that
          // outright instead of leaving `isGone` to recognise the words "not found".
          if (seq == null) throw new AlreadyGoneError(`SD-WAN member "${obj.name}" is not on the device`);
          await DeviceDeleteSDWANMember(deviceId, seq);
          break;
        }

        case "sdwan-health-check": {
          // Keyed by name. The existence check keeps "someone already deleted it" out of the
          // failure list — the end state is the one we wanted.
          const names = (sdwanHealth ??= await DeviceListSDWANHealthChecks(deviceId))
            .map((h) => h.name);
          if (!names.includes(obj.name)) throw { message: "not found" };
          await DeviceDeleteSDWANHealthCheck(deviceId, obj.name);
          break;
        }

        case "sdwan-rule": {
          // `name` is NOT this table's mkey — the id is — so the id captured at create time is the
          // authority, and matching by name is only a fallback for a wizard-created rule.
          const id = obj.seq ?? (sdwanRules ??= await DeviceListSDWANRules(deviceId))
            .rules.find((r) => r.name === obj.name)?.id;
          if (id == null) throw { message: "not found" };
          await DeviceDeleteSDWANRule(deviceId, id);
          break;
        }

        case "static-route": {
          // A static route has no name — it is keyed by the sequence number FortiOS assigned.
          // Apply captures that seq at create time, so it deletes the exact row it added.
          // The Static Route Wizard reports a human label instead ("10.55.0.0/16 via port1"), so
          // fall back to matching the destination it starts with — never a loose contains(), which
          // could match a different route that merely shares a prefix.
          const seq = obj.seq ?? (routes ??= await DeviceListStaticRoutes(deviceId))
            .find((r) => matchesRoute(r.dst, obj.name) || matchesRoute(r.internet_service_name, obj.name))
            ?.seq_num;
          // Same as the SD-WAN member above: the route table was read and the row is not in it.
          if (seq == null) throw new AlreadyGoneError(`static route "${obj.name}" is not in the device's route table`);
          await DeviceDeleteStaticRoute(deviceId, seq);
          break;
        }
      }

      removed.push(obj);
      onProgress?.(obj);
    } catch (err) {
      // Already gone = the state we wanted. Anything else is a real failure the user must see.
      if (isGone(err)) {
        removed.push(obj);
        onProgress?.(obj);
      } else {
        failed.push({ obj, error: inUseMessage(obj, err) });
      }
    }
  }

  return { removed, failed };
}
