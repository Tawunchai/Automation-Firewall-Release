import React from "react";
import { useNavigate } from "react-router-dom";
import { FiServer, FiLock, FiUnlock } from "react-icons/fi";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { LdapMascot } from "../../components/ui/authMascots";
import { DeviceListLDAPServers, DeviceDeleteLDAPServer, type LDAPServer } from "../../api/policyObject";

// User & Authentication > LDAP Servers — live user/ldap objects from the selected FortiGate.

const BIND_LABEL: Record<string, string> = {
  simple: "Simple", anonymous: "Anonymous", regular: "Regular",
};

// Slot 3 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#1baf7a", dark: "#199e70" }; // aqua

const LDAPServersPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<LDAPServer>
      title="LDAP Servers"
      icon={<FiServer />}
      noun="LDAP server"
      subtitle="Directory servers this firewall can check for authentication."
      hue={HUE}
      heroChips={(rows) => [
        {
          icon: <FiLock />,
          label: `${rows.filter((s) => s.secure !== "disable").length} encrypted`,
        },
      ]}
      fetcher={DeviceListLDAPServers}
      gridCols="1.3fr 1.4fr 0.6fr 1.6fr 0.9fr 0.9fr 0.5fr"
      matches={(s, q) =>
        s.name.toLowerCase().includes(q) ||
        s.server.toLowerCase().includes(q) ||
        s.dn.toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/ldap-servers/create?deviceId=${d.id}`),
        onEdit: (d, s) => navigate(`/admin/ldap-servers/edit?deviceId=${d.id}&name=${encodeURIComponent(s.name)}`),
        onDelete: (d, s) => DeviceDeleteLDAPServer(d.id, s.name),
        describe: (s) => s.name,
        deleteLabel: "DELETE LDAP SERVER",
        mascot: LdapMascot,
      }}
      columns={[
        { key: "name", header: "Name", render: (s) => (
          <span className="font-semibold ink">{s.name}</span>
        ) },
        { key: "server", header: "Server IP/Name", render: (s) => s.server || "—" },
        { key: "port", header: "Port", render: (s) => s.port || "—" },
        { key: "dn", header: "Distinguished Name", render: (s) => (
          <span className="truncate font-mono text-[11.5px] ink-2">{s.dn || "—"}</span>
        ) },
        { key: "bind", header: "Bind Type", render: (s) => BIND_LABEL[s.bind_type] ?? s.bind_type ?? "—" },
        { key: "secure", header: "Connection", render: (s) =>
          s.secure === "disable" ? (
            <span className="inline-flex items-center gap-1 ink-3">
              <FiUnlock size={11} /> Plain
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
              <FiLock size={11} /> {s.secure === "ldaps" ? "LDAPS" : "STARTTLS"}
            </span>
          ) },
        { key: "ref", header: "Ref.", render: (s) => <span className="ink-3">{s.ref}</span> },
      ]}
    />
  );
};

export default LDAPServersPage;
