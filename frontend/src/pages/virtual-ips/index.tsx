import React from "react";
import { useNavigate } from "react-router-dom";
import { FiGlobe } from "react-icons/fi";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { DeviceListVirtualIPs, DeviceDeleteVirtualIP, type VirtualIP } from "../../api/policyObject";
import { vipMappedFrom, vipMappedTo } from "./vip-form-rules";

// Slot 4 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#3b82f6", dark: "#60a5fa" }; // blue

const VirtualIPsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<VirtualIP>
      title="Virtual IPs"
      icon={<FiGlobe />}
      noun="Virtual IP"
      subtitle="Destination NAT: an address on the firewall that stands in for a server behind it."
      hue={HUE}
      fetcher={DeviceListVirtualIPs}
      gridCols="1.6fr 1fr 1.4fr 1.4fr 0.6fr"
      rowKey={(v) => v.name}
      matches={(v, q) =>
        v.name.toLowerCase().includes(q) ||
        (v.interface || "").toLowerCase().includes(q) ||
        vipMappedFrom(v).toLowerCase().includes(q) ||
        vipMappedTo(v).toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/virtual-ips/create?deviceId=${d.id}`),
        onEdit: (d, v) => navigate(`/admin/virtual-ips/edit?deviceId=${d.id}&name=${encodeURIComponent(v.name)}`),
        onDelete: (d, v) => DeviceDeleteVirtualIP(d.id, v.name),
        describe: (v) => v.name,
        deleteLabel: "DELETE VIRTUAL IP",
        // The device will refuse while a policy still points at it (FortiOS -23), so say so
        // before the click rather than after the refusal.
        warn: (v) => ((v.ref_count ?? 0) > 0
          ? `⚠ Referenced by ${v.ref_count} policy(ies) — the device will refuse to delete it until those are removed.`
          : null),
      }}
      columns={[
        {
          key: "name",
          header: "Name",
          render: (v) => (
            <div className="min-w-0">
              <p className="m-0 truncate font-semibold ink">{v.name}</p>
              <p className="m-0 truncate text-[10px] ink-3">
                {v.type === "fqdn" ? "FQDN" : "IPv4 Static NAT"}
              </p>
            </div>
          ),
        },
        { key: "interface", header: "Interface", render: (v) => v.interface || "any" },
        {
          key: "from",
          header: "Mapped From",
          render: (v) => <span className="font-mono">{vipMappedFrom(v)}</span>,
        },
        {
          key: "to",
          header: "Mapped To",
          render: (v) => <span className="font-mono">{vipMappedTo(v)}</span>,
        },
        {
          key: "ref",
          header: "Ref.",
          render: (v) => (
            <span className={(v.ref_count ?? 0) > 0 ? "font-semibold text-blue-600 dark:text-blue-400" : "ink-3"}>
              {v.ref_count ?? 0}
            </span>
          ),
        },
      ]}
    />
  );
};

export default VirtualIPsPage;
