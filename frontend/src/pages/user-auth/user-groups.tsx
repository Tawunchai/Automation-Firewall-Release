import React from "react";
import { useNavigate } from "react-router-dom";
import { FiUsers, FiUser } from "react-icons/fi";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { GroupMascot } from "../../components/ui/authMascots";
import { DeviceListUserGroups, DeviceDeleteUserGroup, type UserGroup } from "../../api/policyObject";

// Slot 2 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#eb6834", dark: "#d95926" }; // orange

const UserGroupsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<UserGroup>
      title="User Groups"
      icon={<FiUsers />}
      noun="user group"
      subtitle="Named groups of users, referenced from firewall policy and authentication rules."
      hue={HUE}
      heroChips={(rows) => [
        { icon: <FiUser />, label: `${rows.reduce((n, g) => n + g.members.length, 0)} memberships` },
      ]}
      fetcher={DeviceListUserGroups}
      gridCols="1.4fr 1.8fr 1.6fr 0.6fr"
      matches={(g, q) =>
        g.name.toLowerCase().includes(q) ||
        g.group_type.toLowerCase().includes(q) ||
        g.members.some((m) => m.toLowerCase().includes(q))}
      crud={{
        onCreate: (d) => navigate(`/admin/user-groups/create?deviceId=${d.id}`),
        onEdit: (d, g) => navigate(`/admin/user-groups/edit?deviceId=${d.id}&name=${encodeURIComponent(g.name)}`),
        onDelete: (d, g) => DeviceDeleteUserGroup(d.id, g.name),
        describe: (g) => g.name,
        deleteLabel: "DELETE USER GROUP",
        mascot: GroupMascot,
      }}
      columns={[
        { key: "name", header: "Group Name", render: (g) => (
          <span className="font-semibold ink">{g.name}</span>
        ) },
        { key: "type", header: "Group Type", render: (g) => g.group_type || "—" },
        { key: "members", header: "Members", render: (g) =>
          g.members.length ? (
            <span className="inline-flex flex-wrap items-center gap-1">
              {g.members.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 ink-2">
                  <FiUser size={12} className="ink-3" /> {m}
                </span>
              ))}
            </span>
          ) : "—" },
        { key: "ref", header: "Ref.", render: (g) => <span className="ink-3">{g.ref}</span> },
      ]}
    />
  );
};

export default UserGroupsPage;
