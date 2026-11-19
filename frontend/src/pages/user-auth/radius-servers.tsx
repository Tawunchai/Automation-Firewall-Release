import React from "react";
import { useNavigate } from "react-router-dom";
import { FiKey, FiCheck } from "react-icons/fi";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { RadiusMascot } from "../../components/ui/authMascots";
import { DeviceListRADIUSServers, DeviceDeleteRADIUSServer, type RADIUSServer } from "../../api/policyObject";

// User & Authentication > RADIUS Servers — live user/radius objects from the selected FortiGate.
// One object carries a primary and a secondary host, so the list shows both.

const AUTH_LABEL: Record<string, string> = {
  auto: "Default", pap: "PAP", chap: "CHAP", ms_chap: "MS-CHAP", ms_chap_v2: "MS-CHAP-v2",
};

// Slot 4 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#eda100", dark: "#c98500" }; // yellow

const RADIUSServersPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<RADIUSServer>
      title="RADIUS Servers"
      icon={<FiKey />}
      noun="RADIUS server"
      subtitle="AAA servers this firewall can hand authentication off to."
      hue={HUE}
      heroChips={(rows) => [
        {
          icon: <FiCheck />,
          label: `${rows.filter((s) => !!s.secondary_server).length} with backup`,
        },
      ]}
      fetcher={DeviceListRADIUSServers}
      gridCols="1.3fr 1.4fr 1.4fr 1fr 1fr 0.9fr 0.5fr"
      matches={(s, q) =>
        s.name.toLowerCase().includes(q) ||
        s.server.toLowerCase().includes(q) ||
        s.secondary_server.toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/radius-servers/create?deviceId=${d.id}`),
        onEdit: (d, s) => navigate(`/admin/radius-servers/edit?deviceId=${d.id}&name=${encodeURIComponent(s.name)}`),
        onDelete: (d, s) => DeviceDeleteRADIUSServer(d.id, s.name),
        describe: (s) => s.name,
        deleteLabel: "DELETE RADIUS SERVER",
        mascot: RadiusMascot,
      }}
      columns={[
        { key: "name", header: "Name", render: (s) => (
          <span className="font-semibold ink">{s.name}</span>
        ) },
        { key: "server", header: "Primary Server", render: (s) => s.server || "—" },
        { key: "backup", header: "Secondary Server", render: (s) =>
          s.secondary_server || <span className="ink-3">—</span> },
        { key: "auth", header: "Auth Method", render: (s) => AUTH_LABEL[s.auth_type] ?? s.auth_type ?? "—" },
        { key: "nas", header: "NAS IP", render: (s) =>
          s.nas_ip ? <span className="font-mono text-[11.5px]">{s.nas_ip}</span> : <span className="ink-3">—</span> },
        { key: "allgrp", header: "All Groups", render: (s) =>
          s.all_usergroup ? (
            <span className="inline-flex items-center gap-1 font-semibold text-emerald-600">
              <FiCheck size={11} /> Yes
            </span>
          ) : <span className="ink-3">No</span> },
        { key: "ref", header: "Ref.", render: (s) => <span className="ink-3">{s.ref}</span> },
      ]}
    />
  );
};

export default RADIUSServersPage;
