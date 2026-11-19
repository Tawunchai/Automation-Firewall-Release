import React from "react";
import { useNavigate } from "react-router-dom";
import { FiPackage } from "react-icons/fi";
import UsageDeleteModal from "../../components/ui/UsageDelete";
import { DeviceListPage } from "../../components/device/DeviceListPage";
import {
  DeviceListIPPools, DeviceDeleteIPPool,
  type IPPool, type IPPoolType,
} from "../../api/objectGroups";
import { describePool } from "./pool-model";

// Policy & Objects ▸ IP Pools — the source addresses a policy's NAT translates to.
//
// The console could already pick a pool in the firewall policy form and could not create one, so
// the dropdown was a dead end: the operator had to leave for the device's own GUI in the middle of
// writing a rule. That is the thing this console exists to avoid.
//
// The page's real work is the arithmetic in pool-model.ts. A NAT pool is four numbers whose
// relationship decides whether traffic survives, and FortiOS accepts every combination of them
// without comment — including the one where half your hosts stop being translated.

const TYPE_LABEL: Record<IPPoolType, string> = {
  "overload": "Overload",
  "one-to-one": "One-to-One",
  "fixed-port-range": "Fixed Port Range",
  "port-block-allocation": "Port Block Allocation",
};

// Slot 6 of the validated categorical set (dataviz skill) — see lib/categoryColor.ts.
const HUE = { light: "#0ea5a4", dark: "#2dd4bf" }; // teal

const IPPoolsPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <DeviceListPage<IPPool>
      title="IP Pools"
      icon={<FiPackage />}
      noun="IP pool"
      subtitle="The source addresses a policy's NAT translates to."
      hue={HUE}
      fetcher={DeviceListIPPools}
      gridCols="1fr 150px 1fr 120px 130px"
      rowKey={(p) => p.name}
      matches={(p, q) =>
        p.name.toLowerCase().includes(q)
        || p.start_ip.includes(q) || p.end_ip.includes(q)
        || (p.comments ?? "").toLowerCase().includes(q)}
      crud={{
        onCreate: (d) => navigate(`/admin/ip-pools/create?deviceId=${d.id}`),
        onEdit: (d, p) => navigate(`/admin/ip-pools/edit?deviceId=${d.id}&name=${encodeURIComponent(p.name)}`),
        onDelete: (d, p) => DeviceDeleteIPPool(d.id, p.name),
        describe: (p) => p.name,
        deleteLabel: "DELETE IP POOL",
        // Kept, not replaced by the standard dialog: this one asks the device what still uses the
        // pool and lists it, which is the difference between a refusal the operator understands
        // and FortiOS error -23.
        dialog: ({ row, device, busy, onCancel, onConfirm }) => (
          <UsageDeleteModal
            deviceId={device.id}
            deviceName={device.name}
            kind="ippool"
            noun="IP pool"
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
          render: (p) => (
            <div className="min-w-0">
              <p className="m-0 truncate font-semibold ink">{p.name}</p>
              {p.comments && <p className="m-0 truncate t-meta">{p.comments}</p>}
            </div>
          ),
        },
        { key: "type", header: "Type", render: (p) => <span className="chip">{TYPE_LABEL[p.type] ?? p.type}</span> },
        {
          key: "range",
          header: "External Range",
          render: (p) => (
            <span className="font-mono">
              {p.start_ip === p.end_ip ? p.start_ip : `${p.start_ip} – ${p.end_ip}`}
            </span>
          ),
        },
        {
          key: "addresses",
          header: "Addresses",
          render: (p) => {
            const d = describePool(p);
            return (
              <span className="tabular-nums">
                {d.externalCount.toLocaleString()}
                {/* The warning that is worth the whole page: a fixed-port-range pool whose
                    internal range is larger than its external one leaves the hosts past the end
                    untranslated, and the device never says so. */}
                {d.warning && <span className="ml-1 t-meta text-red-500" title={d.warning}>⚠</span>}
              </span>
            );
          },
        },
        {
          key: "interface",
          header: "Interface",
          render: (p) => p.associated_interface || <span className="ink-3">any</span>,
        },
      ]}
    />
  );
};

export default IPPoolsPage;
