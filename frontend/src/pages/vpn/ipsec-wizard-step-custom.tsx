import React from "react";
import { FiEye, FiEyeOff } from "react-icons/fi";
import { labelCls, inputCls, rowCls } from "../fw-addresses/address-form";
import { ParentDropdown, Segmented } from "../../components/ui/form-controls";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { Toggle, CheckRow, Err, ProposalEditor, DHGroupGrid } from "./ipsec-wizard-controls";
import {
  isCustom, type CustomState, type CustomRemoteGateway, type CustomDPD,
} from "./ipsec-wizard-rules";
import type { IPsecAuthMethod } from "../../api/policyObject";
import type { WizardCtx } from "./ipsec-wizard-context";

/**
 * The Custom template's three middle steps — Network, Authentication and Phase 2 Selectors —
 * which together mirror the FortiGate GUI's manual "New VPN Tunnel" form.
 *
 * They are the only steps that write into `f.custom`, so they share a file and the `setC`
 * setter rather than being spread through the other steps' flows.
 */
const CustomSteps: React.FC<WizardCtx> = ({
  currentColor, ring, meta, step, f, setF, errors, showPSK, setShowPSK, set, setC, c,
  setCustomIKE, parentIfaces, autoFilledRef,
}) => (<>
    {/* ── Custom Step 2 — Network ── */}
    {step === 1 && isCustom(f) && (<>
      <div className={rowCls}>
        <label htmlFor="comments" className={labelCls}>Comments</label>
        <div className="w-full max-w-sm">
          <input id="comments" value={c.comments} onChange={(e) => setC("comments", e.target.value)} maxLength={255}
            placeholder="Optional" className={`${inputCls} w-full`} {...ring} />
        </div>
      </div>

      <div role="group" aria-labelledby="ip-version-label" className={rowCls}>
        <span id="ip-version-label" className={labelCls}>IP Version</span>
        <Segmented label="IP Version" value={c.ipVersion} currentColor={currentColor}
          onChange={(v) => setC("ipVersion", v as "4" | "6")}
          options={[{ v: "4", l: "IPv4" }, { v: "6", l: "IPv6" }]} />
      </div>

      <div className={rowCls}>
        <label htmlFor="remote-gateway" className={labelCls}>Remote Gateway</label>
        <div className="w-full max-w-sm">
          <MinimalSelect id="remote-gateway" value={c.remoteGateway} ariaLabel="Remote Gateway" className="w-full"
            onChange={(val) => {
              const v = val as CustomRemoteGateway;
              // Match the GUI's DPD re-default: Dialup User idles (On Idle / 60s), the rest poll On Demand.
              setF((p) => ({ ...p, custom: { ...p.custom, remoteGateway: v,
                dpd: v === "dialup" ? "on-idle" : "on-demand",
                dpdRetryInterval: v === "dialup" ? "60" : "20" } }));
            }}
            options={[
              { value: "static", label: "Static IP Address" },
              { value: "dialup", label: "Dialup User" },
              { value: "ddns", label: "Dynamic DNS" },
            ]} />
        </div>
      </div>

      {c.remoteGateway === "static" && (
        <div className={rowCls}>
          <label htmlFor="ip-address" className={labelCls}>IP Address</label>
          <div className="w-full max-w-sm">
            <input id="ip-address" value={c.remoteGwIP} onChange={(e) => setC("remoteGwIP", e.target.value)}
              placeholder={c.ipVersion === "6" ? "2001:db8::1" : "0.0.0.0"} className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.remoteGwIP} />
          </div>
        </div>
      )}
      {c.remoteGateway === "ddns" && (
        <div className={rowCls}>
          <label htmlFor="dynamic-dns" className={labelCls}>Dynamic DNS</label>
          <div className="w-full max-w-sm">
            <input id="dynamic-dns" value={c.remoteDdns} onChange={(e) => setC("remoteDdns", e.target.value)}
              placeholder="branch.example.com" className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.remoteDdns} />
          </div>
        </div>
      )}

      <div role="group" aria-labelledby="interface-label" className={rowCls}>
        <span id="interface-label" className={labelCls}>Interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.outInterface} currentColor={currentColor} options={parentIfaces}
            onChange={(v) => { autoFilledRef.current = false; set("outInterface", v); }}
            placeholder="Select interface…" />
          <Err msg={errors.outInterface} />
        </div>
      </div>

      <div className={rowCls} style={{ alignItems: "flex-start" }}>
        <label htmlFor="local-gateway-7" className={`${labelCls} pt-1`}>Local Gateway</label>
        <div className="w-full max-w-sm space-y-2">
          <Toggle label="Specify the local gateway" checked={c.localGwEnabled} onChange={(v) => setC("localGwEnabled", v)} currentColor={currentColor} />
          {c.localGwEnabled && (<>
            <Segmented label="Specify the local gateway" value={c.localGwMode} currentColor={currentColor}
              onChange={(v) => setC("localGwMode", v as "primary" | "specify")}
              options={[{ v: "primary", l: "Primary IP" }, { v: "specify", l: "Specify" }]} />
            {c.localGwMode === "specify" && (<>
              <input id="local-gateway-7" value={c.localGwIP} onChange={(e) => setC("localGwIP", e.target.value)}
                placeholder="0.0.0.0" className={`${inputCls} w-full font-mono`} {...ring} />
              <Err msg={errors.localGwIP} />
            </>)}
          </>)}
        </div>
      </div>

      <div role="group" aria-labelledby="mode-config-label" className={rowCls}>
        <span id="mode-config-label" className={labelCls}>Mode Config</span>
        <Toggle label="Mode config" checked={c.modeConfig} onChange={(v) => setC("modeConfig", v)} currentColor={currentColor} />
      </div>

      <div role="group" aria-labelledby="nat-traversal-label" className={rowCls}>
        <span id="nat-traversal-label" className={labelCls}>NAT Traversal</span>
        <Segmented label="NAT Traversal" value={c.natTraversal} currentColor={currentColor}
          onChange={(v) => setC("natTraversal", v as CustomState["natTraversal"])}
          options={[{ v: "enable", l: "Enable" }, { v: "disable", l: "Disable" }, { v: "forced", l: "Forced" }]} />
      </div>

      <div className={rowCls}>
        <label htmlFor="keepalive-frequency" className={labelCls}>Keepalive Frequency</label>
        <div className="w-full max-w-sm">
          <input id="keepalive-frequency" value={c.keepalive} onChange={(e) => setC("keepalive", e.target.value)}
            className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.keepalive} />
        </div>
      </div>

      <div role="group" aria-labelledby="dead-peer-detection-label" className={rowCls}>
        <span id="dead-peer-detection-label" className={labelCls}>Dead Peer Detection</span>
        <Segmented label="Dead Peer Detection" value={c.dpd} currentColor={currentColor}
          onChange={(v) => setC("dpd", v as CustomDPD)}
          options={[{ v: "disable", l: "Disable" }, { v: "on-idle", l: "On Idle" }, { v: "on-demand", l: "On Demand" }]} />
      </div>
      {c.dpd !== "disable" && (<>
        <div className={rowCls}>
          <label htmlFor="dpd-retry-count" className={labelCls}>DPD retry count</label>
          <div className="w-full max-w-sm">
            <input id="dpd-retry-count" value={c.dpdRetryCount} onChange={(e) => setC("dpdRetryCount", e.target.value)}
              className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.dpdRetryCount} />
          </div>
        </div>
        <div className={rowCls}>
          <label htmlFor="dpd-retry-interval" className={labelCls}>DPD retry interval</label>
          <div className="w-full max-w-sm">
            <input id="dpd-retry-interval" value={c.dpdRetryInterval} onChange={(e) => setC("dpdRetryInterval", e.target.value)}
              className={`${inputCls} w-full font-mono`} {...ring} />
            <Err msg={errors.dpdRetryInterval} />
          </div>
        </div>
      </>)}

      <div role="group" aria-labelledby="forward-error-correction-label" className={rowCls}>
        <span id="forward-error-correction-label" className={labelCls}>Forward Error Correction</span>
        <div className="flex items-center gap-4">
          <CheckRow checked={c.fecEgress} onChange={(v) => setC("fecEgress", v)} label="Egress" currentColor={currentColor} />
          <CheckRow checked={c.fecIngress} onChange={(v) => setC("fecIngress", v)} label="Ingress" currentColor={currentColor} />
        </div>
      </div>

      {/* Advanced — collapsed by default, like the GUI's "＋ Advanced…" disclosure. */}
      <button type="button" onClick={() => setC("advancedOpen", !c.advancedOpen)}
        className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: currentColor }}>
        {c.advancedOpen ? "－" : "＋"} Advanced…
      </button>
      {c.advancedOpen && (
        <div className="space-y-3 rounded-[4px] border hairline p-3">
          {([
            ["Add route", "addRoute"],
            ["Auto discovery sender", "autoDiscoverySender"],
            ["Auto discovery receiver", "autoDiscoveryReceiver"],
            ["Exchange interface IP", "exchangeInterfaceIP"],
            ["Device creation", "netDevice"],
            ["Aggregate member", "aggregateMember"],
          ] as [string, keyof CustomState][]).map(([label, key]) => (
            <div key={key} className={rowCls}>
              <span className={labelCls}>{label}</span>
              <Toggle label={label} checked={c[key] as boolean} onChange={(v) => setC(key, v as never)} currentColor={currentColor} />
            </div>
          ))}
        </div>
      )}
    </>)}

    {/* ── Custom Step 3 — Authentication ── */}
    {step === 2 && isCustom(f) && (<>
      <div role="group" aria-labelledby="method-label" className={rowCls}>
        <span id="method-label" className={labelCls}>Method</span>
        <Segmented label="Method" value={f.authMethod} currentColor={currentColor}
          onChange={(v) => set("authMethod", v as IPsecAuthMethod)}
          options={[{ v: "psk", l: "Pre-shared Key" }, { v: "signature", l: "Signature" }]} />
      </div>

      {f.authMethod === "psk" ? (
        <div className={rowCls}>
          <label htmlFor="pre-shared-key-8" className={labelCls}>Pre-shared Key</label>
          <div className="w-full max-w-sm">
            <div className="relative">
              <input id="pre-shared-key-8" type={showPSK ? "text" : "password"} value={f.psk}
                onChange={(e) => set("psk", e.target.value)} className={`${inputCls} w-full pr-9`} {...ring} />
              <button type="button" onClick={() => setShowPSK((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 ink-3 hover-ink">
                {showPSK ? <FiEyeOff size={13} /> : <FiEye size={13} />}
              </button>
            </div>
            <Err msg={errors.psk} />
          </div>
        </div>
      ) : (<>
        <div className={rowCls}>
          <label htmlFor="certificate-name-9" className={labelCls}>Certificate Name</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="certificate-name-9" value={f.certificate} ariaLabel="Certificate Name" className="w-full"
              onChange={(v) => set("certificate", v)}
              options={[{ value: "", label: "+" }, ...meta.certificates.map((cc) => ({ value: cc, label: cc }))]} />
            <Err msg={errors.certificate} />
          </div>
        </div>
        <div className={rowCls}>
          <label htmlFor="accept-types" className={labelCls}>Accept Types</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="accept-types" value={c.peerType} ariaLabel="Accept Types" className="w-full"
              onChange={(v) => setC("peerType", v as CustomState["peerType"])}
              options={[
                { value: "any", label: "Any peer ID" },
                { value: "one", label: "Specify a peer ID" },
              ]} />
          </div>
        </div>
        {c.peerType === "one" && (
          <div className={rowCls}>
            <label htmlFor="peer-id" className={labelCls}>Peer ID</label>
            <div className="w-full max-w-sm">
              <input id="peer-id" value={c.peerId} onChange={(e) => setC("peerId", e.target.value)}
                className={`${inputCls} w-full`} {...ring} />
              <Err msg={errors.peerId} />
            </div>
          </div>
        )}
        <div className={rowCls}>
          <label htmlFor="peer-certificate-ca-10" className={labelCls}>Peer Certificate CA</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="peer-certificate-ca-10" value={f.peerCA} ariaLabel="Peer Certificate CA" className="w-full"
              onChange={(v) => set("peerCA", v)}
              options={[{ value: "", label: "—" }, ...meta.ca_certificates.map((cc) => ({ value: cc, label: cc }))]} />
          </div>
        </div>
      </>)}

      <div role="group" aria-labelledby="ike-version-label" className={rowCls}>
        <span id="ike-version-label" className={labelCls}>IKE Version</span>
        <Segmented label="IKE Version" value={c.ikeVersion} currentColor={currentColor}
          onChange={(v) => setCustomIKE(v as "1" | "2")}
          options={[{ v: "1", l: "1" }, { v: "2", l: "2" }]} />
      </div>
      {c.ikeVersion === "1" && (
        <div role="group" aria-labelledby="mode-label" className={rowCls}>
          <span id="mode-label" className={labelCls}>Mode</span>
          <Segmented label="Mode" value={c.ikeMode} currentColor={currentColor}
            onChange={(v) => setC("ikeMode", v as CustomState["ikeMode"])}
            options={[{ v: "aggressive", l: "Aggressive" }, { v: "main", l: "Main (ID protection)" }]} />
        </div>
      )}

      <div role="group" aria-labelledby="phase-1-proposal-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="phase-1-proposal-label" className={`${labelCls} pt-1`}>Phase 1 Proposal</span>
        <div>
          <ProposalEditor value={c.p1Proposals} onChange={(v) => setC("p1Proposals", v)} phase="p1" currentColor={currentColor} />
          <Err msg={errors.p1Proposals} />
        </div>
      </div>

      <div role="group" aria-labelledby="diffie-hellman-groups-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="diffie-hellman-groups-label" className={`${labelCls} pt-1`}>Diffie-Hellman Groups</span>
        <div>
          <DHGroupGrid value={c.p1DHGroups} onChange={(v) => setC("p1DHGroups", v)} currentColor={currentColor} />
          <Err msg={errors.p1DHGroups} />
        </div>
      </div>

      <div className={rowCls}>
        <label htmlFor="key-lifetime-seconds" className={labelCls}>Key Lifetime (seconds)</label>
        <div className="w-full max-w-sm">
          <input id="key-lifetime-seconds" value={c.keylife} onChange={(e) => setC("keylife", e.target.value)}
            className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.keylife} />
        </div>
      </div>
      <div className={rowCls}>
        <label htmlFor="local-id" className={labelCls}>Local ID</label>
        <div className="w-full max-w-sm">
          <input id="local-id" value={c.localId} onChange={(e) => setC("localId", e.target.value)}
            placeholder="Optional" className={`${inputCls} w-full`} {...ring} />
        </div>
      </div>
    </>)}

    {/* ── Custom Step 4 — Phase 2 Selectors ── */}
    {step === 3 && isCustom(f) && (<>
      <div className={rowCls}>
        <label htmlFor="local-address" className={labelCls}>Local Address</label>
        <div className="w-full max-w-sm">
          <input id="local-address" value={c.p2LocalSubnet} onChange={(e) => setC("p2LocalSubnet", e.target.value)}
            placeholder={c.ipVersion === "6" ? "::/0" : "0.0.0.0/0"} className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.p2LocalSubnet} />
        </div>
      </div>
      <div className={rowCls}>
        <label htmlFor="remote-address" className={labelCls}>Remote Address</label>
        <div className="w-full max-w-sm">
          <input id="remote-address" value={c.p2RemoteSubnet} onChange={(e) => setC("p2RemoteSubnet", e.target.value)}
            placeholder={c.ipVersion === "6" ? "::/0" : "0.0.0.0/0"} className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.p2RemoteSubnet} />
        </div>
      </div>

      <div role="group" aria-labelledby="phase-2-proposal-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="phase-2-proposal-label" className={`${labelCls} pt-1`}>Phase 2 Proposal</span>
        <div>
          <ProposalEditor value={c.p2Proposals} onChange={(v) => setC("p2Proposals", v)} phase="p2" currentColor={currentColor} />
          <Err msg={errors.p2Proposals} />
        </div>
      </div>

      <div role="group" aria-labelledby="enable-replay-detection-label" className={rowCls}>
        <span id="enable-replay-detection-label" className={labelCls}>Enable Replay Detection</span>
        <Toggle label="Enable replay detection" checked={c.p2Replay} onChange={(v) => setC("p2Replay", v)} currentColor={currentColor} />
      </div>
      <div role="group" aria-labelledby="enable-pfs-label" className={rowCls} style={{ alignItems: "flex-start" }}>
        <span id="enable-pfs-label" className={`${labelCls} pt-1`}>Enable PFS</span>
        <div className="space-y-2">
          <Toggle label="Enable perfect forward secrecy" checked={c.p2Pfs} onChange={(v) => setC("p2Pfs", v)} currentColor={currentColor} />
          {c.p2Pfs && (<>
            <DHGroupGrid value={c.p2DHGroups} onChange={(v) => setC("p2DHGroups", v)} currentColor={currentColor} />
            <Err msg={errors.p2DHGroups} />
          </>)}
        </div>
      </div>

      {([
        ["Local Port", "p2LocalPortAll", "p2LocalPort", errors.p2LocalPort],
        ["Remote Port", "p2RemotePortAll", "p2RemotePort", errors.p2RemotePort],
        ["Protocol", "p2ProtocolAll", "p2Protocol", errors.p2Protocol],
      ] as [string, keyof CustomState, keyof CustomState, string | undefined][]).map(([label, allKey, valKey, err]) => (
        <div key={label} className={rowCls}>
          <label htmlFor="field" className={labelCls}>{label}</label>
          <div className="flex w-full max-w-sm items-center gap-3">
            <CheckRow checked={c[allKey] as boolean} onChange={(v) => setC(allKey, v as never)} label="All" currentColor={currentColor} />
            {!(c[allKey] as boolean) && (
              <div>
                <input id="field" value={c[valKey] as string} onChange={(e) => setC(valKey, e.target.value as never)}
                  className={`${inputCls} w-28 font-mono`} {...ring} />
                <Err msg={err} />
              </div>
            )}
          </div>
        </div>
      ))}

      <div role="group" aria-labelledby="auto-negotiate-label" className={rowCls}>
        <span id="auto-negotiate-label" className={labelCls}>Auto-negotiate</span>
        <Toggle label="Auto-negotiate" checked={c.p2AutoNegotiate} onChange={(v) => setC("p2AutoNegotiate", v)} currentColor={currentColor} />
      </div>
      <div role="group" aria-labelledby="autokey-keep-alive-label" className={rowCls}>
        <span id="autokey-keep-alive-label" className={labelCls}>Autokey Keep Alive</span>
        <Toggle label="Autokey keep alive" checked={c.p2Keepalive} onChange={(v) => setC("p2Keepalive", v)} currentColor={currentColor} />
      </div>
      <div className={rowCls}>
        <label htmlFor="key-lifetime-seconds-11" className={labelCls}>Key Lifetime (seconds)</label>
        <div className="w-full max-w-sm">
          <input id="key-lifetime-seconds-11" value={c.p2KeylifeSeconds} onChange={(e) => setC("p2KeylifeSeconds", e.target.value)}
            className={`${inputCls} w-full font-mono`} {...ring} />
          <Err msg={errors.p2KeylifeSeconds} />
        </div>
      </div>
    </>)}
</>);

export default CustomSteps;
