import { useEffect, useState } from "react";
import {
  DeviceListAddresses, DeviceListServices,
} from "../../api/policyObject";
import {
  DeviceListAddressGroups, DeviceListServiceGroups,
  type AddressGroup, type ServiceGroup,
} from "../../api/objectGroups";
import type { Candidate } from "./member-picker";

// Shared state, validation and payload-building for the Address Group / Service Group create and
// edit pages — pulled out of the old modal in groups-panel.tsx so the two standalone pages and the
// list page can all build the exact same request the device already accepted, rather than each
// reaching for its own copy of the five fields.

export type GroupKind = "address" | "service";

export type GroupDraft = {
  name: string;
  members: string[];
  comment: string;
  exclude: boolean;
  excludeMembers: string[];
  allowRouting: boolean;
  proxy: boolean;
};

export const BLANK_GROUP_DRAFT: GroupDraft = {
  name: "", members: [], comment: "",
  exclude: false, excludeMembers: [], allowRouting: false, proxy: false,
};

export function addressGroupToDraft(g: AddressGroup): GroupDraft {
  return {
    name: g.name, members: g.members, comment: g.comment,
    exclude: g.exclude, excludeMembers: g.exclude_members,
    allowRouting: g.allow_routing, proxy: false,
  };
}

export function serviceGroupToDraft(g: ServiceGroup): GroupDraft {
  return {
    name: g.name, members: g.members, comment: g.comment,
    exclude: false, excludeMembers: [], allowRouting: false, proxy: g.proxy,
  };
}

/** Validates the draft that is common to both kinds — the device-specific fields need no check of
    their own, they are plain booleans. Returns an error string, or "" when the draft may be saved. */
export function validateGroupDraft(d: GroupDraft): string {
  if (!d.name.trim()) return "Name is required";
  if (d.members.length === 0) {
    return "A group needs at least one member — an empty group matches nothing, so a policy that uses it would silently pass no traffic";
  }
  return "";
}

export function addressGroupPayload(d: GroupDraft) {
  return {
    name: d.name.trim(), members: d.members, comment: d.comment,
    exclude: d.exclude, exclude_members: d.excludeMembers, allow_routing: d.allowRouting,
  };
}

export function serviceGroupPayload(d: GroupDraft) {
  return { name: d.name.trim(), members: d.members, comment: d.comment, proxy: d.proxy };
}

/**
 * The member candidates for a device: every object of the right kind, plus every existing group of
 * that kind (nested membership is legal — see member-picker.tsx). Loaded independently of the group
 * list itself, so a page that can show its groups still opens even when the object table cannot be
 * read for a moment; the picker reports that in its own panel instead of taking the page down.
 */
export function useGroupCandidates(deviceId: number | null | undefined, kind: GroupKind) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deviceId) { setCandidates([]); return; }
    let live = true;
    setError(null);

    const objects = kind === "address"
      ? DeviceListAddresses(deviceId, { strict: true }).then(
          (as) => as.map((a): Candidate => ({ name: a.name, detail: a.subnet || a.start_ip || a.country })))
      : DeviceListServices(deviceId, { strict: true }).then(
          (ss) => ss.map((s): Candidate => ({ name: s.name, detail: s.details })));
    const groups = kind === "address"
      ? DeviceListAddressGroups(deviceId).then(
          (gs) => gs.map((g): Candidate => ({ name: g.name, detail: `${g.members.length} members`, nested: true })))
      : DeviceListServiceGroups(deviceId).then(
          (gs) => gs.map((g): Candidate => ({ name: g.name, detail: `${g.members.length} members`, nested: true })));

    Promise.all([objects, groups])
      .then(([o, g]) => { if (live) setCandidates([...o, ...g]); })
      .catch((e: unknown) => {
        if (!live) return;
        setCandidates([]);
        setError(e instanceof Error ? e.message : "the list could not be read");
      });
    return () => { live = false; };
  }, [deviceId, kind]);

  return { candidates, error };
}
