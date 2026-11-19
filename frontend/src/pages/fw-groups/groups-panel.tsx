import React, { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { FiLayers } from "react-icons/fi";
import UsageDeleteModal from "../../components/ui/UsageDelete";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import {
  DeviceListAddressGroups, DeviceDeleteAddressGroup,
  DeviceListServiceGroups, DeviceDeleteServiceGroup,
  type AddressGroup, type ServiceGroup, type UsageKind,
} from "../../api/objectGroups";
import type { DeviceReadOpts } from "../../api/policyObject";

// Address Groups and Service Groups — one page, two object types.
//
// They are the same screen because they are the same object: a name, a member list, a comment. The
// differences are three fields (exclude / allow-routing on address groups, proxy on service
// groups) and which table the members come from, so splitting them into two nearly identical files
// would mean every future fix landing twice — which is how the eight device list pages came to
// disagree about what an unreadable device looks like.
//
// What this page exists for: until now the console could REFERENCE a group in a policy form and
// could not make one. A rule base with no groups grows one rule per address, permanently.

/** A group of either kind, flattened to what this page renders. */
type Row = {
  name: string;
  members: string[];
  comment: string;
  /** Extra facts shown as chips — "excludes 2", "proxy", "static route". */
  flags: string[];
};

type Kind = "address" | "service";

// Slot 7 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#d9488a", dark: "#e879b0" }; // pink

const toRowsAddress = (gs: AddressGroup[]): Row[] =>
  gs.map((g) => ({
    name: g.name,
    members: g.members,
    comment: g.comment,
    flags: [
      ...(g.exclude ? [`excludes ${g.exclude_members.length}`] : []),
      ...(g.allow_routing ? ["static route"] : []),
      ...(g.fabric_object ? ["fabric"] : []),
    ],
  }));

const toRowsService = (gs: ServiceGroup[]): Row[] =>
  gs.map((g) => ({
    name: g.name,
    members: g.members,
    comment: g.comment,
    flags: [
      ...(g.proxy ? ["proxy"] : []),
      ...(g.fabric_object ? ["fabric"] : []),
    ],
  }));

const GroupsPanel: React.FC<{ kind: Kind; toggle?: React.ReactNode }> = ({ kind, toggle }) => {
  const navigate = useNavigate();

  const isAddr = kind === "address";
  const noun = isAddr ? "address group" : "service group";
  const usageKind: UsageKind = isAddr ? "addrgrp" : "servicegrp";
  const createPath = isAddr ? "/admin/fw-addresses/groups/create" : "/admin/fw-services/groups/create";
  const editPath = isAddr ? "/admin/fw-addresses/groups/edit" : "/admin/fw-services/groups/edit";

  // Strict — this page PRESENTS what the firewall enforces, so an unreachable device must render
  // as an error and never as "there are no groups". (The shared list asks for strict itself; the
  // option is passed on here because this fetcher is the one that maps two API shapes into one.)
  const fetcher = useCallback(
    async (deviceId: number, opts?: DeviceReadOpts): Promise<Row[]> =>
      isAddr
        ? toRowsAddress(await DeviceListAddressGroups(deviceId, opts))
        : toRowsService(await DeviceListServiceGroups(deviceId, opts)),
    [isAddr],
  );

  return (
    <DeviceListPage<Row>
      title={isAddr ? "Address Groups" : "Service Groups"}
      icon={<FiLayers />}
      noun={noun}
      subtitle="A named set of members a policy can reference once instead of one rule per address."
      hue={HUE}
      headerActions={toggle}
      fetcher={fetcher}
      gridCols="1fr 110px 1.2fr 150px"
      rowKey={(r) => r.name}
      matches={(r, q) =>
        r.name.toLowerCase().includes(q)
        || r.comment.toLowerCase().includes(q)
        // Searching by MEMBER is the point: "which group is 10.0.5.0/24 in?" is the question
        // people actually arrive with, and it is unanswerable from the name column alone.
        || r.members.some((m) => m.toLowerCase().includes(q))}
      crud={{
        onCreate: (d) => navigate(`${createPath}?deviceId=${d.id}`),
        onEdit: (d, r) => navigate(`${editPath}?deviceId=${d.id}&name=${encodeURIComponent(r.name)}`),
        onDelete: (d, r) => (isAddr
          ? DeviceDeleteAddressGroup(d.id, r.name)
          : DeviceDeleteServiceGroup(d.id, r.name)),
        describe: (r) => r.name,
        deleteLabel: isAddr ? "DELETE ADDRESS GROUP" : "DELETE SERVICE GROUP",
        // Kept: the usage scan in front of the delete is what turns "the device said -23" into
        // "these three policies still use it".
        dialog: ({ row, device, busy, onCancel, onConfirm }) => (
          <UsageDeleteModal
            deviceId={device.id}
            deviceName={device.name}
            kind={usageKind}
            noun={noun}
            name={row.name}
            busy={busy}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        ),
      }}
      columns={[
        {
          key: "name",
          header: "Name",
          render: (r) => (
            <div className="min-w-0">
              <p className="m-0 truncate font-semibold ink">{r.name}</p>
              {r.comment && <p className="m-0 truncate t-meta">{r.comment}</p>}
            </div>
          ),
        },
        {
          key: "count",
          header: "Members",
          render: (r) => (
            <span className={`tabular-nums ${r.members.length === 0 ? "text-red-500" : ""}`}>
              {r.members.length}
              {/* A group the device holds with no members is not a display quirk — it is a rule
                  that matches nothing. It is called out rather than shown as "0". */}
              {r.members.length === 0 && <span className="ml-1 t-meta text-red-500">matches nothing</span>}
            </span>
          ),
        },
        {
          key: "members",
          header: "Contains",
          render: (r) => (
            <span className="flex min-w-0 flex-wrap gap-1">
              {r.members.slice(0, 4).map((m) => <span key={m} className="chip max-w-36 truncate">{m}</span>)}
              {r.members.length > 4 && <span className="chip chip-info">+{r.members.length - 4}</span>}
            </span>
          ),
        },
        {
          key: "flags",
          header: "Flags",
          render: (r) => (
            <span className="flex flex-wrap gap-1">
              {r.flags.map((f) => <span key={f} className="chip chip-warn">{f}</span>)}
            </span>
          ),
        },
      ]}
    />
  );
};

export default GroupsPanel;
