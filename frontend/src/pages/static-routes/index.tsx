import React from "react";
import { useNavigate } from "react-router-dom";
import { FiGitBranch, FiSlash, FiGlobe } from "react-icons/fi";
import { RouteMascot } from "../../components/ui/networkMascots";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import {
  DeviceListStaticRoutes, DeviceDeleteStaticRoute, type StaticRoute,
} from "../../api/policyObject";

// Slot 5 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#e0a800", dark: "#f0c040" }; // amber

const InterfaceCell: React.FC<{ r: StaticRoute }> = ({ r }) => {
  if (r.blackhole) return <span className="inline-flex items-center gap-1.5 ink-2"><FiSlash size={12} /> Blackhole</span>;
  if (!r.device) return <span className="ink-3">—</span>;
  return (
    <span className="ink">
      {r.device_alias ? `${r.device_alias} ` : ""}
      <span className={r.device_alias ? "ink-3" : ""}>{r.device_alias ? `(${r.device})` : r.device}</span>
    </span>
  );
};

/** What this route points AT — a subnet, or a named Internet Service. */
const destText = (r: StaticRoute) =>
  r.dst_type === "internet-service"
    ? (r.internet_service_name || `Internet Service ${r.internet_service}`)
    : (r.dst || "—");

const StaticRoutesPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<StaticRoute>
      title="Static Routes"
      icon={<FiGitBranch />}
      noun="static route"
      subtitle="Where this firewall sends traffic it has no connected route for."
      hue={HUE}
      fetcher={DeviceListStaticRoutes}
      gridCols="1.4fr 160px 1fr 120px 1fr"
      // seq_num, not the row's position: FortiOS renumbers routes, and a dialog left pointing at
      // a slot instead of a route would delete the wrong one.
      rowKey={(r) => String(r.seq_num)}
      matches={(r, q) =>
        destText(r).toLowerCase().includes(q) ||
        (r.gateway || "").toLowerCase().includes(q) ||
        (r.device || "").toLowerCase().includes(q) ||
        (r.comment || "").toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/static-routes/create?deviceId=${d.id}`),
        onEdit: (d, r) => navigate(`/admin/static-routes/edit?deviceId=${d.id}&seq=${r.seq_num}`),
        onDelete: (d, r) => DeviceDeleteStaticRoute(d.id, r.seq_num),
        describe: (r) => destText(r),
        deleteLabel: "DELETE STATIC ROUTE",
        mascot: RouteMascot,
      }}
      columns={[
        {
          key: "dst",
          header: "Destination",
          render: (r) => (
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="shrink-0 ink-3">
                {r.dst_type === "internet-service" ? <FiGlobe size={12} /> : <FiGitBranch size={12} />}
              </span>
              <span className="truncate font-mono font-semibold ink">{destText(r)}</span>
            </span>
          ),
        },
        {
          key: "gateway",
          header: "Gateway IP",
          render: (r) => (
            <span className="font-mono">
              {r.blackhole ? "—" : (r.gateway && r.gateway !== "0.0.0.0" ? r.gateway : "—")}
            </span>
          ),
        },
        { key: "device", header: "Interface", render: (r) => <InterfaceCell r={r} /> },
        {
          key: "status",
          header: "Status",
          render: (r) => (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: r.enabled ? "#10b981" : "#94a3b8" }} />
              {r.enabled ? "Enabled" : "Disabled"}
            </span>
          ),
        },
        { key: "comment", header: "Comments", render: (r) => r.comment || "—" },
      ]}
    />
  );
};

export default StaticRoutesPage;
