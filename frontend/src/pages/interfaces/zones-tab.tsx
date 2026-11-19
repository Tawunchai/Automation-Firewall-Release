import React from "react";
import { useNavigate } from "react-router-dom";
import { FiGrid } from "react-icons/fi";
import UsageDeleteModal from "../../components/ui/UsageDelete";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import { DeviceListZones, DeviceDeleteZone, type Zone } from "../../api/objectGroups";

// Network ▸ Zones — a name for several interfaces, so a policy can be written once for "inside"
// instead of once per port.
//
// This is the ONE writable part of Network. Interfaces stay read-only here on purpose (they are
// changed on the device), and a zone is the exception because it is a grouping the operator
// invents rather than a property of the hardware — creating one changes no port's configuration.
//
// ── The constraint that shapes this page ─────────────────────────────────────
//
// FortiOS will not put an interface in a zone if it is already in another zone OR if any firewall
// policy names it directly. On a firewall that is already in service, that is most of the ports.
// So the picker marks which interfaces are unavailable and why, BEFORE the operator selects one
// and gets a numeric refusal — and the refusal, when it comes anyway, is passed through whole
// because only the device knows which of the two conditions bit.

// Slot 3 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#7c5cff", dark: "#9b87ff" }; // violet

const ZonesTab: React.FC<{ toggle?: React.ReactNode }> = ({ toggle }) => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<Zone>
      title="Zones"
      icon={<FiGrid />}
      noun="zone"
      subtitle="A name for several interfaces, so a policy can be written once for “inside”."
      hue={HUE}
      // The Interfaces/Zones toggle this tab is reached through rides along in the card header,
      // where the search and Create button already are.
      headerActions={toggle}
      fetcher={DeviceListZones}
      gridCols="1fr 1.2fr 130px 1fr"
      rowKey={(z) => z.name}
      matches={(z, q) =>
        z.name.toLowerCase().includes(q)
        || z.description.toLowerCase().includes(q)
        || z.interfaces.some((i) => i.toLowerCase().includes(q))}
      crud={{
        onCreate: (d) => navigate(`/admin/fw-interfaces/zones/create?deviceId=${d.id}`),
        onEdit: (d, z) => navigate(`/admin/fw-interfaces/zones/edit?deviceId=${d.id}&name=${encodeURIComponent(z.name)}`),
        onDelete: (d, z) => DeviceDeleteZone(d.id, z.name),
        describe: (z) => z.name,
        deleteLabel: "DELETE ZONE",
        // Kept: a zone is deleted because something should stop using it, and this dialog says
        // what still does instead of leaving the device to refuse with a number.
        dialog: ({ row, device, busy, onCancel, onConfirm }) => (
          <UsageDeleteModal
            deviceId={device.id}
            deviceName={device.name}
            kind="zone"
            noun="zone"
            name={row.name}
            busy={busy}
            onCancel={onCancel}
            onConfirm={onConfirm}
          />
        ),
      }}
      columns={[
        { key: "name", header: "Name", render: (z) => <span className="font-semibold ink">{z.name}</span> },
        {
          key: "interfaces",
          header: "Interfaces",
          render: (z) => (
            <span className="flex min-w-0 flex-wrap gap-1">
              {z.interfaces.length === 0
                ? <span className="t-meta text-red-500">no interfaces — matches nothing</span>
                : z.interfaces.map((i) => <span key={i} className="chip">{i}</span>)}
            </span>
          ),
        },
        {
          key: "intrazone",
          header: "Intra-zone",
          render: (z) => (
            <span className={`chip ${z.intrazone === "allow" ? "chip-warn" : ""}`}>
              {z.intrazone === "allow" ? "allow" : "deny"}
            </span>
          ),
        },
        { key: "description", header: "Description", render: (z) => z.description || "—" },
      ]}
    />
  );
};

export default ZonesTab;
