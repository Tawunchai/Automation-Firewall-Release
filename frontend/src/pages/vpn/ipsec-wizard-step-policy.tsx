import React from "react";
import { FiInfo } from "react-icons/fi";
import { labelCls, inputCls, rowCls } from "../fw-addresses/address-form";
import { ParentDropdown, Segmented } from "../../components/ui/form-controls";
import { Toggle, SubnetList, AddressList, Err } from "./ipsec-wizard-controls";
import {
  remoteSubnetsLocked, isRemoteAccess, raHasClientOptions, raShowsEndpointRegistration,
  raShowsModeCfgOptions, raIsL2TP, l2tpRouteNetwork, isCustom, isHubSpoke, hubIsHub, hubIsSpoke,
  deriveOverlaySubnet, type RADNSMode, type HubSpokeSpokeType,
} from "./ipsec-wizard-rules";
import type { IPsecInternetAccess } from "../../api/policyObject";
import type { WizardCtx } from "./ipsec-wizard-context";

/**
 * Policy & Routing, plus the two steps that only exist on one flow each: FortiClient's Client
 * Options (IKE mode-config keys) and Hub-and-Spoke's Tunnel Interface.
 *
 * All of them answer the same question — what the tunnel is allowed to carry and where its
 * routes point — so the overlay-subnet and split-tunnel rules stay in one file.
 */
const PolicyStep: React.FC<WizardCtx> = ({
  currentColor, ring, addresses, step, f, setF, errors, set, setHubLocalInterface,
  parentIfaces, wanIfaces,
}) => (<>
    {/* ── Step 3 — Policy & Routing (Site to Site) ── */}
    {step === 2 && !isRemoteAccess(f) && !isCustom(f) && !isHubSpoke(f) && (<>
      <div role="group" aria-labelledby="local-interface-label" className={rowCls}>
        <span id="local-interface-label" className={labelCls}>Local interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.localInterface} onChange={(v) => set("localInterface", v)}
            options={parentIfaces} currentColor={currentColor} placeholder="+" />
        </div>
      </div>

      <div role="group" aria-labelledby="local-subnets-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="local-subnets-label" className={`${labelCls} pt-1`}>Local subnets</span>
        <div>
          <SubnetList value={f.localSubnets} onChange={(v) => set("localSubnets", v)}
            currentColor={currentColor} placeholder="192.168.1.0/24" />
          <Err msg={errors.localSubnets} />
        </div>
      </div>

      <div role="group" aria-labelledby="remote-subnets-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="remote-subnets-label" className={`${labelCls} pt-1`}>Remote Subnets</span>
        <div>
          {/* "Use Remote" routes everything through the tunnel, so the selector IS the
              default route — shown locked rather than left for the user to get wrong. */}
          <SubnetList
            value={remoteSubnetsLocked(f) ? ["0.0.0.0/0"] : f.remoteSubnets}
            onChange={(v) => set("remoteSubnets", v)}
            currentColor={currentColor} placeholder="192.168.9.0/24"
            disabled={remoteSubnetsLocked(f)} />
          <Err msg={errors.remoteSubnets} />
        </div>
      </div>

      <div role="group" aria-labelledby="internet-access-label" className={rowCls}>
        <span id="internet-access-label" className={`${labelCls} flex items-center gap-1.5`}>
          Internet Access
          <FiInfo size={11} className="cursor-help ink-3"
            title={"None — the tunnel carries only the subnets above.\nShare Local — the remote site reaches the Internet through this site's WAN.\nUse Remote — this site reaches the Internet through the remote site."} />
        </span>
        <Segmented label="Internet access" value={f.internetAccess} currentColor={currentColor}
          onChange={(v) => set("internetAccess", v as IPsecInternetAccess)}
          options={[{ v: "none", l: "None" }, { v: "share-local", l: "Share Local" }, { v: "use-remote", l: "Use Remote" }]} />
      </div>

      {f.internetAccess === "share-local" && (
        <div role="group" aria-labelledby="shared-wan-label" className={rowCls}>
          <span id="shared-wan-label" className={labelCls}>Shared WAN</span>
          <div className="w-full max-w-sm">
            <ParentDropdown value={f.sharedWAN} onChange={(v) => set("sharedWAN", v)}
              options={wanIfaces} currentColor={currentColor} placeholder="Select the WAN to share…" />
            <Err msg={errors.sharedWAN} />
          </div>
        </div>
      )}

      {f.internetAccess === "use-remote" && (
        <div className={rowCls}>
          <label htmlFor="local-gateway" className={`${labelCls} flex items-center gap-1.5`}>
            Local Gateway
            <FiInfo size={11} className="cursor-help ink-3"
              title="Once the default route points into the tunnel, the tunnel's own packets would loop back into it. This gateway keeps a host route to the remote gateway on the physical link." />
          </label>
          <div className="w-full max-w-sm">
            <input id="local-gateway" value={f.localGateway} onChange={(e) => set("localGateway", e.target.value)}
              placeholder="10.0.99.1" className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.localGateway} />
          </div>
        </div>
      )}
    </>)}

    {/* ── Step 3 — Policy & Routing (Remote Access) ── */}
    {step === 2 && isRemoteAccess(f) && (<>
      <div role="group" aria-labelledby="local-interface-label-2" className={rowCls}>
        <span id="local-interface-label-2" className={labelCls}>Local interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.localInterface} onChange={(v) => set("localInterface", v)}
            options={parentIfaces} currentColor={currentColor} placeholder="Select the LAN interface…" />
          <Err msg={errors.localInterface} />
        </div>
      </div>

      <div role="group" aria-labelledby="local-address-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="local-address-label" className={`${labelCls} pt-1`}>Local Address</span>
        <div>
          <AddressList value={f.localAddresses} onChange={(v) => set("localAddresses", v)}
            options={addresses} currentColor={currentColor}
            disabled={raShowsModeCfgOptions(f) && !f.splitTunnel} />
          <p className="mt-1 text-[11px] ink-3">
            {raIsL2TP(f) ? "The local networks clients may reach (the policy's destination)."
              : f.splitTunnel ? "The local networks clients reach over the VPN (the split-tunnel group)."
                              : "Full tunnel — all client traffic is sent through this FortiGate."}
          </p>
          <Err msg={errors.localAddresses} />
        </div>
      </div>

      <div className={rowCls}>
        <label htmlFor="client-address-range" className={labelCls}>Client Address Range</label>
        <div className="w-full max-w-sm">
          <input id="client-address-range"
            value={f.clientRangeStart && f.clientRangeEnd ? `${f.clientRangeStart}-${f.clientRangeEnd}` : f.clientRangeStart}
            onChange={(e) => { const [a, b] = e.target.value.split("-"); setF((p) => ({ ...p, clientRangeStart: (a || "").trim(), clientRangeEnd: (b || "").trim() })); }}
            placeholder="10.10.70.1-10.10.70.254" className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.clientRangeStart || errors.clientRangeEnd} />
        </div>
      </div>

      <div className={rowCls}>
        <label htmlFor="subnet-mask" className={labelCls}>Subnet Mask</label>
        <div className="w-full max-w-sm">
          <input id="subnet-mask" value={f.clientNetmask} onChange={(e) => set("clientNetmask", e.target.value)}
            placeholder="255.255.255.0" className={`${inputCls} w-full font-mono`} {...ring} />
          {/* On an L2TP tunnel this mask is not stored anywhere — it ONLY decides the L2TP
              route, so show the route it will build rather than let a wrong mask pass. */}
          {raIsL2TP(f) && l2tpRouteNetwork(f.clientRangeStart, f.clientNetmask) && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] ink-3">
              <FiInfo size={11} /> L2TP route:{" "}
              <span className="font-mono">{l2tpRouteNetwork(f.clientRangeStart, f.clientNetmask)}</span>
              {" "}via l2t.root
            </p>
          )}
          <Err msg={errors.clientNetmask} />
        </div>
      </div>

      {/* Split tunnel + DNS push are IKE mode-config features — the Native (L2TP) templates
          have neither, and the GUI shows neither row for them. */}
      {raShowsModeCfgOptions(f) && (<>
        <div className={rowCls}>
          <label htmlFor="dns-server" className={labelCls}>DNS Server</label>
          <div className="w-full max-w-sm space-y-2">
            <Segmented label="DNS Server" value={f.dnsMode} currentColor={currentColor}
              onChange={(v) => set("dnsMode", v as RADNSMode)}
              options={[{ v: "auto", l: "Use System DNS" }, { v: "manual", l: "Specify" }]} />
            {f.dnsMode === "manual" && (<>
              <input id="dns-server" value={f.dnsServer} onChange={(e) => set("dnsServer", e.target.value)}
                placeholder="8.8.8.8" className={`${inputCls} w-full font-mono`} {...ring} />
              <Err msg={errors.dnsServer} />
            </>)}
          </div>
        </div>

        <div role="group" aria-labelledby="enable-ipv4-split-tunnel-label" className={rowCls}>
          <span id="enable-ipv4-split-tunnel-label" className={labelCls}>Enable IPv4 Split Tunnel</span>
          <Toggle label="Enable IPv4 split tunnel" checked={f.splitTunnel} onChange={(v) => set("splitTunnel", v)} currentColor={currentColor} />
        </div>
      </>)}

      {/* FortiClient template only — the GUI shows no such row for Cisco or Native. */}
      {raShowsEndpointRegistration(f) && (
        <div role="group" aria-labelledby="allow-endpoint-registration-label" className={rowCls}>
          <span id="allow-endpoint-registration-label" className={labelCls}>Allow Endpoint Registration</span>
          <Toggle label="Allow endpoint registration" checked={f.endpointRegistration} onChange={(v) => set("endpointRegistration", v)} currentColor={currentColor} />
        </div>
      )}
    </>)}

    {/* ── Step 4 — Client Options (FortiClient only; the Cisco template is 4 steps) ── */}
    {step === 3 && raHasClientOptions(f) && (<>
      <div role="group" aria-labelledby="save-password-label" className={rowCls}>
        <span id="save-password-label" className={labelCls}>Save Password</span>
        <Toggle label="Save password" checked={f.savePassword} onChange={(v) => set("savePassword", v)} currentColor={currentColor} />
      </div>
      <div role="group" aria-labelledby="auto-connect-label" className={rowCls}>
        <span id="auto-connect-label" className={labelCls}>Auto Connect</span>
        <Toggle label="Auto connect" checked={f.autoConnect} onChange={(v) => set("autoConnect", v)} currentColor={currentColor} />
      </div>
      <div role="group" aria-labelledby="always-up-keep-alive-label" className={rowCls}>
        <span id="always-up-keep-alive-label" className={labelCls}>Always Up (Keep Alive)</span>
        <Toggle label="Always up (keep alive)" checked={f.alwaysUp} onChange={(v) => set("alwaysUp", v)} currentColor={currentColor} />
      </div>
    </>)}
    {/* ── Step 3 — Tunnel Interface (Hub-and-Spoke) ── */}
    {step === 2 && isHubSpoke(f) && (<>
      <div className={rowCls}>
        <label htmlFor="tunnel-ip" className={labelCls}>Tunnel IP</label>
        <div className="w-full max-w-sm">
          <input id="tunnel-ip" value={f.hsTunnelIP} onChange={(e) => set("hsTunnelIP", e.target.value)}
            placeholder="10.10.1.1" className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.hsTunnelIP} />
          <p className="mt-1 text-[11px] ink-3">This device's address on the tunnel overlay.</p>
        </div>
      </div>
      <div className={rowCls}>
        <label htmlFor="remote-ip-netmask" className={labelCls}>Remote IP/netmask</label>
        <div className="w-full max-w-sm">
          <input id="remote-ip-netmask" value={f.hsRemoteIP}
            onChange={(e) => {
              const v = e.target.value;
              // Prefill the Range-mode overlay prefix from the netmask, only while it's blank.
              setF((p) => {
                const overlay = deriveOverlaySubnet(v);
                const fillRange = hubIsHub(p) && p.hsSpokeType === "range" && !p.hsSpokeRangePrefix.trim();
                return { ...p, hsRemoteIP: v, ...(overlay && fillRange ? { hsSpokeRangePrefix: overlay } : {}) };
              });
            }}
            placeholder="10.10.1.2/24" className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.hsRemoteIP} />
          <p className="mt-1 text-[11px] ink-3">
            {hubIsSpoke(f) ? "The hub's tunnel IP + the overlay netmask." : "The first spoke's tunnel IP + the overlay netmask (its mask sizes the whole overlay subnet)."}
          </p>
        </div>
      </div>
    </>)}

    {/* ── Step 4 — Policy & Routing (Hub-and-Spoke, BGP) ── */}
    {step === 3 && isHubSpoke(f) && (<>
      <div className={rowCls}>
        <label htmlFor="local-as" className={labelCls}>Local AS</label>
        <div className="w-full max-w-sm">
          <input id="local-as" value={f.hsLocalAS} onChange={(e) => set("hsLocalAS", e.target.value)}
            placeholder="65400" className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.hsLocalAS} />
          <p className="mt-1 text-[11px] ink-3">The private BGP AS both ends share.</p>
        </div>
      </div>

      <div role="group" aria-labelledby="local-interface-label-3" className={rowCls}>
        <span id="local-interface-label-3" className={labelCls}>Local interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.localInterface} onChange={setHubLocalInterface}
            options={parentIfaces} currentColor={currentColor} placeholder="Select the LAN interface…" />
          <Err msg={errors.localInterface} />
          <p className="mt-1 text-[11px] ink-3">Local subnets fills in from this interface's network.</p>
        </div>
      </div>

      <div role="group" aria-labelledby="local-subnets-label-2" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="local-subnets-label-2" className={`${labelCls} pt-1`}>Local subnets</span>
        <div className="w-full max-w-sm">
          <SubnetList value={f.localSubnets} onChange={(v) => set("localSubnets", v)}
            currentColor={currentColor} placeholder="10.0.96.0/22" />
          <Err msg={errors.localSubnets} />
        </div>
      </div>

      {hubIsSpoke(f) ? (
        <div className={rowCls}>
          <label htmlFor="hub-gateway-public-ip" className={labelCls}>Hub gateway (public IP)</label>
          <div className="w-full max-w-sm">
            <input id="hub-gateway-public-ip" value={f.hsRemoteGW} onChange={(e) => set("hsRemoteGW", e.target.value)}
              placeholder="203.0.113.10" className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.hsRemoteGW} />
            <p className="mt-1 text-[11px] ink-3">The hub FortiGate's public address this spoke dials.</p>
          </div>
        </div>
      ) : (<>
        <div role="group" aria-labelledby="spoke-type-label" className={rowCls}>
          <span id="spoke-type-label" className={labelCls}>Spoke type</span>
          <Segmented label="Spoke type" value={f.hsSpokeType} currentColor={currentColor}
            onChange={(v) => set("hsSpokeType", v as HubSpokeSpokeType)}
            options={[{ v: "range", l: "Range" }, { v: "individual", l: "Individual" }]} />
        </div>

        {f.hsSpokeType === "range" ? (
          <div className={rowCls}>
            <label htmlFor="spoke-range-prefix" className={labelCls}>Spoke range prefix</label>
            <div className="w-full max-w-sm">
              <input id="spoke-range-prefix" value={f.hsSpokeRangePrefix} onChange={(e) => set("hsSpokeRangePrefix", e.target.value)}
                placeholder="10.10.1.0/24" className={`${inputCls} w-full font-mono`} {...ring} />
              <Err msg={errors.hsSpokeRangePrefix} />
              <p className="mt-1 text-[11px] ink-3">The overlay subnet the hub accepts dynamic BGP peers from.</p>
            </div>
          </div>
        ) : (
          <div role="group" aria-labelledby="spoke-tunnel-ips-label" className={rowCls} style={{ alignItems: "flex-start" }}>
            <span id="spoke-tunnel-ips-label" className={`${labelCls} pt-1`}>Spoke tunnel IPs</span>
            <div className="w-full max-w-sm">
              <SubnetList value={f.hsSpokeTunnelIPs} onChange={(v) => set("hsSpokeTunnelIPs", v)}
                currentColor={currentColor} placeholder="10.10.1.3" />
              <Err msg={errors.hsSpokeTunnelIPs} />
              <p className="mt-1 text-[11px] ink-3">Each spoke's tunnel IP — one BGP neighbor per entry.</p>
            </div>
          </div>
        )}
      </>)}
    </>)}
</>);

export default PolicyStep;
