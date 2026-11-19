import React from "react";
import { useNavigate } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiUser, FiCheckCircle, FiXCircle, FiShield } from "react-icons/fi";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { UserMascot } from "../../components/ui/authMascots";
import { DeviceListUsers, DeviceDeleteUser, type UserDefinition } from "../../api/policyObject";

// Slot 1 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#2a78d6", dark: "#3987e5" }; // blue

// Small status/2FA badges matching the FortiGate list look.
const YesNo: React.FC<{ on: boolean }> = ({ on }) =>
  on ? <FiCheckCircle size={15} className="text-emerald-500" />
     : <FiXCircle size={15} className="text-red-500" />;

const EnabledBadge: React.FC<{ on: boolean }> = ({ on }) => (
  <span className={`chip ${on ? "chip-ok" : ""}`}>
    <FiCheckCircle size={11} /> {on ? "Enabled" : "Disabled"}
  </span>
);

const UserDefinitionPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<UserDefinition>
      title="User Definition"
      icon={<FiUser />}
      noun="user"
      subtitle="Local and remote accounts that can authenticate through this firewall."
      hue={HUE}
      heroChips={(rows) => [
        { icon: <FiCheckCircle />, label: `${rows.filter((u) => u.enabled).length} enabled` },
        { icon: <FiShield />, label: `${rows.filter((u) => u.two_factor).length} with 2FA` },
      ]}
      fetcher={DeviceListUsers}
      gridCols="1.3fr 1fr 1.6fr 1.4fr 1fr 0.6fr"
      matches={(u, q) =>
        u.name.toLowerCase().includes(q) ||
        u.type.toLowerCase().includes(q) ||
        u.groups.some((g) => g.toLowerCase().includes(q))}
      crud={{
        onCreate: (d) => navigate(`/admin/user-definition/create?deviceId=${d.id}`),
        // Only local users are editable here — the wizard builds user/local objects, and a
        // remote (RADIUS/TACACS+/LDAP) user's settings live on its server object instead.
        onEdit: (d, u) => {
          if (u.type !== "LOCAL") {
            message.info(`"${u.name}" is a ${u.type} user — this app only edits local users.`);
            return;
          }
          navigate(`/admin/user-definition/edit?deviceId=${d.id}&name=${encodeURIComponent(u.name)}`);
        },
        onDelete: (d, u) => DeviceDeleteUser(d.id, u.name),
        describe: (u) => u.name,
        deleteLabel: "DELETE USER",
        mascot: UserMascot,
      }}
      columns={[
        { key: "name", header: "Name", render: (u) => (
          <span className="inline-flex items-center gap-1.5 font-semibold ink">
            <FiUser size={13} className="ink-3" /> {u.name}
          </span>
        ) },
        { key: "type", header: "Type", render: (u) => u.type || "—" },
        { key: "2fa", header: "Two-factor Authentication", render: (u) => <YesNo on={u.two_factor} /> },
        { key: "groups", header: "Groups", render: (u) => u.groups.join(", ") || "—" },
        { key: "status", header: "Status", render: (u) => <EnabledBadge on={u.enabled} /> },
        { key: "ref", header: "Ref.", render: (u) => <span className="ink-3">{u.ref}</span> },
      ]}
    />
  );
};

export default UserDefinitionPage;
