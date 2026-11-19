import React from "react";
import { FiInfo } from "react-icons/fi";
import {
  VPN_TEMPLATES, VPN_NAT_CONFIGS, showsRemoteAddress, remoteSubnetsLocked, vpnObjectSummary,
  isRemoteAccess, raObjectSummary, raHasClientOptions, raShowsGroupName, raIsNative, raIsL2TP,
  l2tpRouteNetwork, remoteAccessDeviceLabel, isCustom, customObjectSummary, serializeP1Proposal,
  serializeP2Proposal, serializeDH, isHubSpoke, hubIsSpoke, hubSpokeObjectSummary,
} from "./ipsec-wizard-rules";
import type { WizardCtx } from "./ipsec-wizard-context";

/**
 * The last step, for every flow: the Object Summary — every object this configuration will put
 * on the device — and, below it, the settings behind those objects.
 *
 * It renders from the same `*ObjectSummary` builders the payload builders use, so what the
 * review lists and what Create sends cannot drift apart.
 */
const ReviewStep: React.FC<WizardCtx> = ({
  step, f, c, lastStep, ifaceLabel,
}) => (<>
    {/* ── Review Settings (last step) ── */}
    {step === lastStep && (
      <div className="-mx-6 -my-6">
        <div className="mx-6 mt-6 flex items-start gap-2.5 rounded border border-sky-200 bg-sky-50 px-4 py-3 dark:border-sky-500/25 dark:bg-sky-500/10">
          <FiInfo size={15} className="mt-0.5 shrink-0 text-sky-500" />
          <p className="text-[12.5px] ink">
            The following settings should be reviewed prior to creating the VPN.
          </p>
        </div>

        {/* Object Summary — every object this configuration will put on the device, with
            the exact names it will use. */}
        <div className="mt-5 border-y hairline surface-sunken px-6 py-2">
          <p className="text-[12.5px] font-semibold ink">Object Summary</p>
        </div>
        <div className="px-6 py-4">
          {(isCustom(f) ? customObjectSummary(f) : isHubSpoke(f) ? hubSpokeObjectSummary(f) : isRemoteAccess(f) ? raObjectSummary(f) : vpnObjectSummary(f)).map((r) => (
            <div key={r.label} className="grid items-baseline gap-3 py-1.5" style={{ gridTemplateColumns: "220px 1fr" }}>
              <span className="text-[12.5px] ink-2">{r.label}</span>
              <span className="break-all font-mono text-[12.5px] text-amber-700 dark:text-amber-400">{r.value}</span>
            </div>
          ))}
        </div>

        {/* The settings behind those objects — the GUI keeps them off this screen, but a
            tunnel is easy to get wrong and this is the last stop before it goes live. */}
        <div className="border-y hairline surface-sunken px-6 py-2">
          <p className="text-[12.5px] font-semibold ink">Settings</p>
        </div>
        <div className="px-6 py-4 pb-6">
          {((isCustom(f) ? [
            ["Name", f.name],
            ["Template type", "Custom"],
            ["IP Version", `IPv${c.ipVersion}`],
            ["Remote Gateway", c.remoteGateway === "static" ? `Static IP — ${c.remoteGwIP}`
              : c.remoteGateway === "ddns" ? `Dynamic DNS — ${c.remoteDdns}` : "Dialup User"],
            ["Interface", ifaceLabel(f.outInterface)],
            ["Local Gateway", c.localGwEnabled ? (c.localGwMode === "specify" ? `Specify — ${c.localGwIP}` : "Primary IP") : "Default"],
            ["Mode Config", c.modeConfig ? "Enabled" : "Disabled"],
            ["NAT Traversal", c.natTraversal],
            ["Dead Peer Detection", c.dpd],
            ["Authentication method", f.authMethod === "psk" ? "Pre-shared Key" : "Signature"],
            ...(f.authMethod === "psk"
              ? [["Pre-shared key", "•".repeat(Math.min(f.psk.length, 12))] as [string, string]]
              : [["Certificate Name", f.certificate] as [string, string],
                 ["Accept Types", c.peerType === "one" ? `Specify — ${c.peerId}` : "Any peer ID"] as [string, string],
                 ["Peer Certificate CA", f.peerCA || "—"] as [string, string]]),
            ["IKE Version", c.ikeVersion],
            ...(c.ikeVersion === "1" ? [["Mode", c.ikeMode === "aggressive" ? "Aggressive" : "Main"] as [string, string]] : []),
            ["Phase 1 Proposal", serializeP1Proposal(c.p1Proposals) || "—"],
            ["Phase 1 DH Groups", serializeDH(c.p1DHGroups) || "—"],
            ["Key Lifetime", `${c.keylife}s`],
            ...(c.localId.trim() ? [["Local ID", c.localId] as [string, string]] : []),
            ["Phase 2 Local", c.p2LocalSubnet.trim() || "0.0.0.0/0"],
            ["Phase 2 Remote", c.p2RemoteSubnet.trim() || "0.0.0.0/0"],
            ["Phase 2 Proposal", serializeP2Proposal(c.p2Proposals) || "—"],
            ["PFS", c.p2Pfs ? `Enabled — DH ${serializeDH(c.p2DHGroups) || "—"}` : "Disabled"],
            ["Replay Detection", c.p2Replay ? "Enabled" : "Disabled"],
            ["Ports / Protocol", `${c.p2LocalPortAll ? "All" : c.p2LocalPort} / ${c.p2RemotePortAll ? "All" : c.p2RemotePort} / ${c.p2ProtocolAll ? "All" : c.p2Protocol}`],
            ["Auto-negotiate", c.p2AutoNegotiate ? "Enabled" : "Disabled"],
            ["Autokey Keep Alive", c.p2Keepalive ? "Enabled" : "Disabled"],
            ["Phase 2 Key Lifetime", `${c.p2KeylifeSeconds}s`],
          ] : isRemoteAccess(f) ? [
            ["Name", f.name],
            ["Template type", "Remote Access"],
            ["Remote device type", raIsNative(f)
              ? `Native — ${remoteAccessDeviceLabel(f)}`
              : `Client-based — ${f.raClient === "cisco" ? "Cisco" : "FortiClient"}`],
            ["Incoming Interface", ifaceLabel(f.outInterface)],
            ["Authentication method", f.authMethod === "psk" ? "Pre-shared Key" : "Signature"],
            ...(f.authMethod === "psk"
              ? [["Pre-shared key", "•".repeat(Math.min(f.psk.length, 12))] as [string, string]]
              : [["Certificate Name", f.certificate] as [string, string],
                 ["Peer Certificate CA", f.peerCA || "—"] as [string, string]]),
            ["User Group", f.userGroup || "—"],
            // Cisco only — and it is what forces aggressive mode.
            ...(raShowsGroupName(f)
              ? [["Group Name (peerid)", f.requireGroupName ? `${f.groupName || "—"} (aggressive mode)` : "Not required"] as [string, string]]
              : []),
            ["Local interface", f.localInterface ? ifaceLabel(f.localInterface) : "—"],
            ["Local Address", raIsL2TP(f) || f.splitTunnel
              ? (f.localAddresses.filter(Boolean).join(", ") || "—")
              : "All (full tunnel)"],
            ["Client Address Range", f.clientRangeStart && f.clientRangeEnd ? `${f.clientRangeStart}-${f.clientRangeEnd}` : "—"],
            ["Subnet Mask", f.clientNetmask],
            // L2TP: the mask's only job is the L2TP route, so show the route it builds.
            ...(raIsL2TP(f)
              ? [["L2TP Route", `${l2tpRouteNetwork(f.clientRangeStart, f.clientNetmask) || "—"} via l2t.root`] as [string, string]]
              : [
                  ["DNS Server", f.dnsMode === "auto" ? "Use System DNS" : `Specify — ${f.dnsServer || "—"}`] as [string, string],
                  ["Split Tunnel", f.splitTunnel ? "Enabled" : "Disabled (full tunnel)"] as [string, string],
                ]),
            // Endpoint Registration + Client Options are FortiClient-template rows only.
            ...(raHasClientOptions(f)
              ? [
                  ["Endpoint Registration", f.endpointRegistration ? "Allowed" : "Off"] as [string, string],
                  ["Save Password", f.savePassword ? "On" : "Off"] as [string, string],
                  ["Auto Connect", f.autoConnect ? "On" : "Off"] as [string, string],
                  ["Always Up (Keep Alive)", f.alwaysUp ? "On" : "Off"] as [string, string],
                ]
              : []),
          ] : isHubSpoke(f) ? [
            ["Name", f.name],
            ["Template type", "Hub-and-Spoke"],
            ["Role", hubIsSpoke(f) ? "Spoke" : "Hub"],
            ["Incoming Interface", ifaceLabel(f.outInterface)],
            ["Authentication method", f.authMethod === "psk" ? "Pre-shared Key" : "Signature"],
            ...(f.authMethod === "psk"
              ? [["Pre-shared key", "•".repeat(Math.min(f.psk.length, 12))] as [string, string]]
              : [["Certificate Name", f.certificate] as [string, string],
                 ["Peer Certificate CA", f.peerCA || "—"] as [string, string]]),
            ["Tunnel IP", f.hsTunnelIP],
            ["Remote IP/netmask", f.hsRemoteIP],
            ["Local AS", f.hsLocalAS],
            ["Local interface", f.localInterface ? ifaceLabel(f.localInterface) : "—"],
            ["Local subnets", f.localSubnets.filter(Boolean).join(", ")],
            ...(hubIsSpoke(f)
              ? [["Hub gateway", f.hsRemoteGW || "—"] as [string, string]]
              : f.hsSpokeType === "range"
                ? [["Spoke type", "Range"] as [string, string],
                   ["Spoke range prefix", f.hsSpokeRangePrefix || "—"] as [string, string]]
                : [["Spoke type", "Individual"] as [string, string],
                   ["Spoke tunnel IPs", f.hsSpokeTunnelIPs.filter(Boolean).join(", ") || "—"] as [string, string]]),
            ["Routing protocol", "BGP (auto-discovery)"],
          ] : [
            ["Name", f.name],
            ["Template type", VPN_TEMPLATES.find((t) => t.v === f.templateType)?.l ?? ""],
            ["NAT configuration", VPN_NAT_CONFIGS.find((n) => n.v === f.natConfig)?.l ?? ""],
            ["Remote device type", f.remoteDeviceType === "fortigate" ? "FortiGate" : "Cisco"],
            ["Remote device", !showsRemoteAddress(f)
              ? "Dialup — the remote connects in"
              : f.remoteDeviceKind === "ip" ? `IP Address — ${f.remoteGw}` : `Dynamic DNS — ${f.remoteFqdn}`],
            ["Outgoing Interface", ifaceLabel(f.outInterface)],
            ["Authentication method", f.authMethod === "psk" ? "Pre-shared Key" : "Signature"],
            ...(f.authMethod === "psk"
              ? [["Pre-shared key", "•".repeat(Math.min(f.psk.length, 12))] as [string, string]]
              : [["Certificate Name", f.certificate] as [string, string],
                 ["Peer Certificate CA", f.peerCA || "—"] as [string, string]]),
            ["Local interface", f.localInterface ? ifaceLabel(f.localInterface) : "—"],
            ["Local subnets", f.localSubnets.filter(Boolean).join(", ")],
            ["Remote Subnets", (remoteSubnetsLocked(f) ? ["0.0.0.0/0"] : f.remoteSubnets).filter(Boolean).join(", ")],
            ["Internet Access", f.internetAccess === "none" ? "None"
              : f.internetAccess === "share-local" ? `Share Local — via ${ifaceLabel(f.sharedWAN)}`
              : `Use Remote — local gateway ${f.localGateway}`],
          ]) as [string, string][]).map(([k, v]) => (
            <div key={k} className="grid items-baseline gap-3 py-1.5" style={{ gridTemplateColumns: "220px 1fr" }}>
              <span className="text-[12.5px] ink-2">{k}</span>
              <span className="break-all text-[12.5px] font-semibold ink">{v || "—"}</span>
            </div>
          ))}
        </div>
      </div>
    )}
</>);

export default ReviewStep;
