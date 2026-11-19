import React from "react";
import { FiCloud, FiServer, FiMove } from "react-icons/fi";
import {
  diagramTitle, natBadgeSide, remoteDeviceLabel, isRemoteAccess, remoteAccessShortLabel,
  type VPNWizardState,
} from "./ipsec-wizard-rules";

// The right-hand topology panel, mirroring the FortiGate VPN Creation Wizard's own:
//   · a heading that follows the tunnel TYPE ("Site to Site - FortiGate" / "Dialup - FortiGate")
//   · this FortiGate in a highlighted box, the Internet cloud, and the remote device
//   · a NAT badge on whichever side of the cloud is behind NAT
// All three come from the pure rules in ipsec-wizard-rules.ts, so the picture can never disagree
// with the config being built.

const NATBadge: React.FC<{ color: string }> = ({ color }) => (
  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
    style={{ background: color }} title="This side is behind NAT">
    <FiMove size={13} />
  </div>
);

const DeviceBox: React.FC<{ label: string; highlight?: boolean; color: string }> = ({ label, highlight, color }) => (
  <div className="flex min-w-0 flex-col items-center gap-1.5 rounded-[4px] border-2 px-3 py-3"
    style={{ borderColor: highlight ? `${color}66` : "#e2e8f0" }}>
    <FiServer size={22} style={{ color: highlight ? color : "#94a3b8" }} />
    <span className="text-center text-[10px] font-semibold leading-tight ink-2">{label}</span>
  </div>
);

export const VPNDiagram: React.FC<{ state: VPNWizardState; currentColor: string }> = ({ state, currentColor }) => {
  const side = natBadgeSide(state);
  return (
    <div className="rounded-[4px] border hairline-2 surface-card p-4 shadow-sm">
      <p className="mb-4 text-center text-[12px] font-bold ink">
        {diagramTitle(state)}
      </p>
      <div className="flex items-center justify-center gap-1.5">
        <DeviceBox label="This FortiGate" highlight color={currentColor} />
        {side === "local" && <NATBadge color={currentColor} />}
        <div className="flex shrink-0 flex-col items-center gap-0.5 px-1 ink-3">
          <FiCloud size={20} />
          <span className="text-[9px]">Internet</span>
        </div>
        {side === "remote" && <NATBadge color={currentColor} />}
        <DeviceBox label={isRemoteAccess(state) ? remoteAccessShortLabel(state) : `Remote ${remoteDeviceLabel(state)}`} color={currentColor} />
      </div>
    </div>
  );
};

export default VPNDiagram;
