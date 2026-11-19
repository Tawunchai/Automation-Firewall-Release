import React from "react";
import { FiEye, FiEyeOff, FiInfo, FiLoader } from "react-icons/fi";
import { labelCls, inputCls, rowCls } from "../fw-addresses/address-form";
import { ParentDropdown, Segmented } from "../../components/ui/form-controls";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { CheckRow, Err } from "./ipsec-wizard-controls";
import {
  showsRemoteAddress, isRemoteAccess, raShowsGroupName, isCustom, isHubSpoke,
  type VPNRemoteDeviceKind,
} from "./ipsec-wizard-rules";
import type { IPsecAuthMethod } from "../../api/policyObject";
import type { WizardCtx } from "./ipsec-wizard-context";

/**
 * Step 2 — Authentication, in its three shapes: Site-to-Site, Hub-and-Spoke and Remote
 * Access. They ask different questions of the same three things — who the far end is, how it
 * proves it, and which interface the tunnel leaves by — so they live together.
 *
 * Custom's own Authentication step is in ipsec-wizard-step-custom.tsx, with the rest of that flow.
 */
const AuthStep: React.FC<WizardCtx> = ({
  currentColor, ring, meta, step, f, errors, showPSK, setShowPSK, set, parentIfaces,
  lookingUp, lookupNote, autoFilledRef,
}) => (<>
    {/* ── Step 2 — Authentication (Site to Site) ── */}
    {step === 1 && !isRemoteAccess(f) && !isCustom(f) && !isHubSpoke(f) && (<>
      {showsRemoteAddress(f) ? (<>
        <div role="group" aria-labelledby="remote-device-label" className={rowCls}>
          <span id="remote-device-label" className={labelCls}>Remote device</span>
          <Segmented label="Remote device" value={f.remoteDeviceKind} currentColor={currentColor}
            onChange={(v) => set("remoteDeviceKind", v as VPNRemoteDeviceKind)}
            options={[{ v: "ip", l: "IP Address" }, { v: "ddns", l: "Dynamic DNS" }]} />
        </div>

        {f.remoteDeviceKind === "ip" ? (
          <div className={rowCls}>
            <label htmlFor="remote-ip-address" className={labelCls}>Remote IP address</label>
            <div className="w-full max-w-sm">
              <input id="remote-ip-address" value={f.remoteGw} onChange={(e) => set("remoteGw", e.target.value)}
                placeholder="10.10.10.254" className={`${inputCls} w-full font-mono`} {...ring} />
              <Err msg={errors.remoteGw} />
              {/* What the device's routing table says about that address — the reason the
                  Outgoing Interface below fills itself in. */}
              {(lookingUp || lookupNote) && (
                <p className="mt-1 flex items-center gap-1.5 text-[11px] ink-3">
                  {lookingUp
                    ? <><FiLoader size={11} className="animate-spin" /> Looking up the route…</>
                    : <><FiInfo size={11} /> {lookupNote}</>}
                </p>
              )}
            </div>
          </div>
        ) : (
          <div className={rowCls}>
            <label htmlFor="fqdn" className={labelCls}>FQDN</label>
            <div className="w-full max-w-sm">
              <input id="fqdn" value={f.remoteFqdn} onChange={(e) => set("remoteFqdn", e.target.value)}
                placeholder="branch.example.com" className={`${inputCls} w-full bg-yellow-50 font-mono dark:bg-yellow-900/10`} {...ring} />
              <Err msg={errors.remoteFqdn} />
            </div>
          </div>
        )}
      </>) : (
        <div className="flex items-start gap-2.5 rounded-[4px] border hairline surface-sunken px-4 py-2.5">
          <FiInfo size={15} className="mt-0.5 shrink-0 ink-3" />
          <p className="text-[12px] leading-relaxed ink-2">
            The remote site is behind NAT, so it has no address to dial: this becomes a <b>dialup</b>
            {" "}tunnel and the remote FortiGate connects to <b>this</b> one.
          </p>
        </div>
      )}

      <div role="group" aria-labelledby="outgoing-interface-label" className={rowCls}>
        <span id="outgoing-interface-label" className={labelCls}>Outgoing Interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.outInterface} currentColor={currentColor} options={parentIfaces}
            onChange={(v) => { autoFilledRef.current = false; set("outInterface", v); }}
            placeholder="Select interface…" />
          <Err msg={errors.outInterface} />
        </div>
      </div>

      <div role="group" aria-labelledby="authentication-method-label" className={rowCls}>
        <span id="authentication-method-label" className={labelCls}>Authentication method</span>
        <Segmented label="Authentication method" value={f.authMethod} currentColor={currentColor}
          onChange={(v) => set("authMethod", v as IPsecAuthMethod)}
          options={[{ v: "psk", l: "Pre-shared Key" }, { v: "signature", l: "Signature" }]} />
      </div>

      {f.authMethod === "psk" ? (
        <div className={rowCls}>
          <label htmlFor="pre-shared-key" className={labelCls}>Pre-shared key</label>
          <div className="w-full max-w-sm">
            <div className="relative">
              <input id="pre-shared-key" type={showPSK ? "text" : "password"} value={f.psk}
                onChange={(e) => set("psk", e.target.value)}
                className={`${inputCls} w-full pr-9`} {...ring} />
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
          <label htmlFor="certificate-name" className={labelCls}>Certificate Name</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="certificate-name" value={f.certificate} ariaLabel="Certificate Name" className="w-full"
              onChange={(v) => set("certificate", v)}
              options={[{ value: "", label: "+" }, ...meta.certificates.map((c) => ({ value: c, label: c }))]} />
            <Err msg={errors.certificate} />
          </div>
        </div>
        <div className={rowCls}>
          <label htmlFor="peer-certificate-ca" className={labelCls}>Peer Certificate CA</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="peer-certificate-ca" value={f.peerCA} ariaLabel="Peer Certificate CA" className="w-full"
              onChange={(v) => set("peerCA", v)}
              options={[{ value: "", label: "—" }, ...meta.ca_certificates.map((c) => ({ value: c, label: c }))]} />
            <p className="mt-1 text-[11px] ink-3">
              Optional — pins which CA must have signed the remote's certificate.
            </p>
          </div>
        </div>
      </>)}
    </>)}

    {/* ── Step 2 — Authentication (Hub-and-Spoke) ── */}
    {step === 1 && isHubSpoke(f) && (<>
      <div role="group" aria-labelledby="incoming-interface-label" className={rowCls}>
        <span id="incoming-interface-label" className={labelCls}>Incoming Interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.outInterface} currentColor={currentColor} options={parentIfaces}
            onChange={(v) => set("outInterface", v)}
            placeholder="Select the interface the tunnel binds to…" />
          <Err msg={errors.outInterface} />
        </div>
      </div>

      <div role="group" aria-labelledby="authentication-method-label-2" className={rowCls}>
        <span id="authentication-method-label-2" className={labelCls}>Authentication method</span>
        <Segmented label="Authentication method" value={f.authMethod} currentColor={currentColor}
          onChange={(v) => set("authMethod", v as IPsecAuthMethod)}
          options={[{ v: "psk", l: "Pre-shared Key" }, { v: "signature", l: "Signature" }]} />
      </div>

      {f.authMethod === "psk" ? (
        <div className={rowCls}>
          <label htmlFor="pre-shared-key-1" className={labelCls}>Pre-shared key</label>
          <div className="w-full max-w-sm">
            <div className="relative">
              <input id="pre-shared-key-1" type={showPSK ? "text" : "password"} value={f.psk}
                onChange={(e) => set("psk", e.target.value)}
                className={`${inputCls} w-full pr-9`} {...ring} />
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
          <label htmlFor="certificate-name-2" className={labelCls}>Certificate Name</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="certificate-name-2" value={f.certificate} ariaLabel="Certificate Name" className="w-full"
              onChange={(v) => set("certificate", v)}
              options={[{ value: "", label: "+" }, ...meta.certificates.map((cn) => ({ value: cn, label: cn }))]} />
            <Err msg={errors.certificate} />
          </div>
        </div>
        <div className={rowCls}>
          <label htmlFor="peer-certificate-ca-3" className={labelCls}>Peer Certificate CA</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="peer-certificate-ca-3" value={f.peerCA} ariaLabel="Peer Certificate CA" className="w-full"
              onChange={(v) => set("peerCA", v)}
              options={[{ value: "", label: "—" }, ...meta.ca_certificates.map((cn) => ({ value: cn, label: cn }))]} />
            <p className="mt-1 text-[11px] ink-3">
              Optional — pins which CA must have signed the peer's certificate.
            </p>
          </div>
        </div>
      </>)}
    </>)}

    {/* ── Step 2 — Authentication (Remote Access) ── */}
    {step === 1 && isRemoteAccess(f) && (<>
      <div role="group" aria-labelledby="incoming-interface-label-2" className={rowCls}>
        <span id="incoming-interface-label-2" className={labelCls}>Incoming Interface</span>
        <div className="w-full max-w-sm">
          <ParentDropdown value={f.outInterface} currentColor={currentColor} options={parentIfaces}
            onChange={(v) => { autoFilledRef.current = false; set("outInterface", v); }}
            placeholder="Select the interface clients connect to…" />
          <Err msg={errors.outInterface} />
        </div>
      </div>

      <div role="group" aria-labelledby="authentication-method-label-3" className={rowCls}>
        <span id="authentication-method-label-3" className={labelCls}>Authentication method</span>
        <Segmented label="Authentication method" value={f.authMethod} currentColor={currentColor}
          onChange={(v) => set("authMethod", v as IPsecAuthMethod)}
          options={[{ v: "psk", l: "Pre-shared Key" }, { v: "signature", l: "Signature" }]} />
      </div>

      {f.authMethod === "psk" ? (
        <div className={rowCls}>
          <label htmlFor="pre-shared-key-4" className={labelCls}>Pre-shared key</label>
          <div className="w-full max-w-sm">
            <div className="relative">
              <input id="pre-shared-key-4" type={showPSK ? "text" : "password"} value={f.psk}
                onChange={(e) => set("psk", e.target.value)}
                className={`${inputCls} w-full pr-9`} {...ring} />
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
          <label htmlFor="certificate-name-5" className={labelCls}>Certificate Name</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="certificate-name-5" value={f.certificate} ariaLabel="Certificate Name" className="w-full"
              onChange={(v) => set("certificate", v)}
              options={[{ value: "", label: "+" }, ...meta.certificates.map((c) => ({ value: c, label: c }))]} />
            <Err msg={errors.certificate} />
          </div>
        </div>
      </>)}

      <div className={rowCls}>
        <label htmlFor="user-group" className={labelCls}>User Group</label>
        <div className="w-full max-w-sm">
          <MinimalSelect id="user-group" value={f.userGroup} ariaLabel="User Group" className="w-full"
            onChange={(v) => set("userGroup", v)}
            options={[{ value: "", label: "Select a user group…" }, ...meta.user_groups.map((g) => ({ value: g, label: g }))]} />
          <Err msg={errors.userGroup} />
        </div>
      </div>

      {f.authMethod === "signature" && (
        <div className={rowCls}>
          <label htmlFor="peer-certificate-ca-6" className={labelCls}>Peer Certificate CA</label>
          <div className="w-full max-w-sm">
            <MinimalSelect id="peer-certificate-ca-6" value={f.peerCA} ariaLabel="Peer Certificate CA" className="w-full"
              onChange={(v) => set("peerCA", v)}
              options={[{ value: "", label: "—" }, ...meta.ca_certificates.map((c) => ({ value: c, label: c }))]} />
            <p className="mt-1 text-[11px] ink-3">
              Optional — pins which CA must have signed the client's certificate.
            </p>
          </div>
        </div>
      )}

      {/* Cisco only — a group name is an IKE identifier, so requiring one switches the
          tunnel to aggressive mode (main mode can only identify a peer by its IP). */}
      {raShowsGroupName(f) && (<>
        <CheckRow checked={f.requireGroupName} currentColor={currentColor}
          onChange={(v) => set("requireGroupName", v)}
          label="Require 'Group Name' on VPN client" />
        {f.requireGroupName && (
          <div className={rowCls}>
            <label htmlFor="group-name-peerid" className={labelCls}>Group Name (peerid)</label>
            <div className="w-full max-w-sm">
              <input id="group-name-peerid" value={f.groupName} onChange={(e) => set("groupName", e.target.value)}
                className={`${inputCls} w-full bg-yellow-50 dark:bg-yellow-900/10`} {...ring} />
              <p className="mt-1 text-[11px] ink-3">
                Clients must present this name — the tunnel negotiates in aggressive mode.
              </p>
              <Err msg={errors.groupName} />
            </div>
          </div>
        )}
      </>)}
    </>)}
</>);

export default AuthStep;
