import React from "react";
import { FiAlertTriangle, FiInfo } from "react-icons/fi";
import { labelCls, inputCls, rowCls } from "../fw-addresses/address-form";
import { Segmented } from "../../components/ui/form-controls";
import { VStack, Err } from "./ipsec-wizard-controls";
import {
  VPN_TEMPLATES, VPN_NAT_CONFIGS, templateSupported, isRemoteAccess, raIsL2TP,
  remoteAccessDeviceLabel, isCustom, isHubSpoke, hubIsSpoke, HUB_SPOKE_EASY_KEY_UNSUPPORTED,
  type VPNTemplateType, type VPNNATConfig, type VPNRemoteDeviceType,
  type RADeviceKind, type RAClientType, type RANativeType, type HubSpokeRole,
} from "./ipsec-wizard-rules";
import type { WizardCtx } from "./ipsec-wizard-context";

/**
 * Step 1 — VPN Setup: the name, the template, and (per template) the remote device type,
 * the NAT position and the Hub-and-Spoke role. It is the only step every flow shares.
 */
const SetupStep: React.FC<WizardCtx> = ({
  currentColor, ring, meta, editing, step, f, errors, set, setRAClient,
  setRANative, setRADeviceKind, nameCollision,
}) => (<>
    {/* ── Step 1 — VPN Setup ── */}
    {step === 0 && (<>
      <div className={rowCls}>
        <label htmlFor="name" className={labelCls}>Name</label>
        <div className="w-full max-w-sm">
          <input id="name" value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. HQ-to-Branch" readOnly={editing}
            className={`${inputCls} w-full ${editing ? "cursor-not-allowed surface-sunken ink-2" : "bg-yellow-50 dark:bg-yellow-900/10"}`} {...ring} />
          {editing && <p className="mt-1 text-[11px] ink-3">A tunnel can't be renamed — edit its settings below.</p>}
          <Err msg={errors.name} />
          {nameCollision && (
            <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
              <FiAlertTriangle size={11} /> A tunnel named <b>{f.name.trim()}</b> already exists on this device — Create will fail. Pick another name.
            </p>
          )}
        </div>
      </div>

      {/* The four templates need ~395px of buttons — max-w-sm (384px) wrapped "Custom"
          onto its own line, so this row gets its own wider cap. */}
      <div role="group" aria-labelledby="template-type-label" className={rowCls}>
        <span id="template-type-label" className={labelCls}>Template type</span>
        <div className="w-full max-w-lg">
          {editing ? (
            <span className="inline-flex items-center rounded-[4px] border hairline surface-sunken px-3 py-1.5 text-[12px] font-semibold ink-2">
              {isHubSpoke(f) ? `Hub-and-Spoke (${hubIsSpoke(f) ? "Spoke" : "Hub"})` : "Custom (manual editor)"}
            </span>
          ) : (
            <Segmented label="Template type" value={f.templateType} currentColor={currentColor}
              onChange={(v) => set("templateType", v as VPNTemplateType)}
              options={VPN_TEMPLATES.map((t) => ({ v: t.v, l: t.l }))} />
          )}
          <Err msg={errors.templateType} />
        </div>
      </div>

      {/* Unsupported templates (Hub-and-Spoke / Custom) — say so rather than build the wrong thing. */}
      {!templateSupported(f.templateType) && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            This wizard builds <b>Site to Site</b> and <b>Remote Access</b> tunnels. Hub-and-Spoke and
            Custom aren't wired up here — build those in the FortiGate GUI.
          </p>
        </div>
      )}

      {isCustom(f) ? (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-sky-200 bg-sky-50 px-4 py-2.5 dark:border-sky-500/25 dark:bg-sky-500/10">
          <FiInfo size={15} className="mt-0.5 shrink-0 text-sky-500" />
          <p className="text-[12px] leading-relaxed ink-2">
            <b>Custom</b> is the manual tunnel editor — you set phase 1 and phase 2 by hand. It creates
            {" "}<b>only the tunnel</b> (no address objects, policies or routes), exactly like the FortiGate GUI's
            {" "}Custom form. The next steps are Network, Authentication and Phase 2.
          </p>
        </div>
      ) : isRemoteAccess(f) ? (<>
        {/* Remote device type — Client-based (FortiClient/Cisco) or Native (iOS/Android/Windows). */}
        <div role="group" aria-labelledby="remote-device-type-label" className={rowCls} style={{ alignItems: "flex-start" }}>
          <span id="remote-device-type-label" className={`${labelCls} pt-1`}>Remote device type</span>
          {/* Two rows, as the FortiGate GUI renders it: the kind, then that kind's clients.
              (flex-col — Segmented is inline-flex, so space-y alone left them side by side.) */}
          <div className="flex flex-col items-start gap-2">
            <Segmented label="Remote device type" value={f.raDeviceKind} currentColor={currentColor}
              onChange={(v) => setRADeviceKind(v as RADeviceKind)}
              options={[{ v: "client-based", l: "Client-based" }, { v: "native", l: "Native" }]} />
            {f.raDeviceKind === "client-based" ? (
              <Segmented label="Client software" value={f.raClient} currentColor={currentColor}
                onChange={(v) => setRAClient(v as RAClientType)}
                options={[{ v: "forticlient", l: "FortiClient" }, { v: "cisco", l: "Cisco" }]} />
            ) : (
              <Segmented label="Native client platform" value={f.raNative} currentColor={currentColor}
                onChange={(v) => setRANative(v as RANativeType)}
                options={[{ v: "ios", l: "iOS Native" }, { v: "android", l: "Android Native" }, { v: "windows", l: "Windows Native" }]} />
            )}
          </div>
        </div>

        {/* Android/Windows are a different tunnel TECHNOLOGY, not just a different client —
            say so, because it changes what the next steps even ask for. (iOS is not: it is
            an ordinary mode-config dialup, so it gets no such warning.) */}
        {raIsL2TP(f) && (
          <div className="flex items-start gap-2.5 rounded-[4px] border border-sky-200 bg-sky-50 px-4 py-2.5 dark:border-sky-500/25 dark:bg-sky-500/10">
            <FiInfo size={15} className="mt-0.5 shrink-0 text-sky-500" />
            <p className="text-[12px] leading-relaxed ink-2">
              <b>{remoteAccessDeviceLabel(f)}</b> uses the OS's built-in client: <b>L2TP over IPsec</b>.
              The L2TP server hands out the addresses and checks the user group, so there is no
              split tunnel, DNS push or client options — and only <b>one</b> L2TP server exists per
              device, so a second Android/Windows VPN replaces this one's settings.
            </p>
          </div>
        )}
        {/* The L2TP server is a per-VDOM SINGLETON — if one is already enabled, a Native VPN
            OVERWRITES its range + user group. Warn with the live values so it's a real choice. */}
        {raIsL2TP(f) && meta.l2tp_enabled && (
          <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-300 bg-amber-50 px-4 py-2.5 dark:border-amber-500/30 dark:bg-amber-500/10">
            <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
            <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
              This device already has an <b>L2TP server</b> in use
              {meta.l2tp_range ? <> (range <span className="font-mono">{meta.l2tp_range}</span>{meta.l2tp_user_group ? <>, group <b>{meta.l2tp_user_group}</b></> : null})</> : null}.
              {" "}There is only one per device — creating this Native VPN will <b>replace</b> it.
            </p>
          </div>
        )}
        <Err msg={errors.raDevice} />
      </>) : isHubSpoke(f) ? (<>
        {/* Hub-and-Spoke (ADVPN + BGP) — the GUI's info banner + Role toggle. */}
        <div className="flex items-start gap-2.5 rounded-[4px] border border-sky-200 bg-sky-50 px-4 py-2.5 dark:border-sky-500/25 dark:bg-sky-500/10">
          <FiInfo size={15} className="mt-0.5 shrink-0 text-sky-500" />
          <p className="text-[12px] leading-relaxed ink-2">
            The Hub-and-Spoke VPN will be set up using <b>auto-discovery</b> with <b>BGP</b> as the routing protocol.
          </p>
        </div>

        <div role="group" aria-labelledby="role-label" className={rowCls} style={{ alignItems: "flex-start" }}>
          <span id="role-label" className={`${labelCls} pt-1`}>Role</span>
          <Segmented label="Role" value={f.hsRole} currentColor={currentColor}
            onChange={(v) => set("hsRole", v as HubSpokeRole)}
            options={[{ v: "hub", l: "Hub" }, { v: "spoke", l: "Spoke" }]} />
        </div>

        {/* Spoke's "Easy configuration key" is a FortiManager feature — shown disabled with a
            note, because this wizard collects the spoke's settings directly instead. */}
        {hubIsSpoke(f) && (
          <div className={rowCls} style={{ alignItems: "flex-start" }}>
            <label htmlFor="easy-configuration-key" className={`${labelCls} pt-1`}>Easy configuration key</label>
            <div className="w-full max-w-sm">
              <input id="easy-configuration-key" value={f.hsEasyKey} disabled placeholder="Not supported over API"
                className={`${inputCls} w-full cursor-not-allowed surface-sunken ink-3`} />
              <p className="mt-1 text-[11px] leading-relaxed ink-3">{HUB_SPOKE_EASY_KEY_UNSUPPORTED}</p>
            </div>
          </div>
        )}
      </>) : (<>
        <div role="group" aria-labelledby="nat-configuration-label" className={rowCls} style={{ alignItems: "flex-start" }}>
          <span id="nat-configuration-label" className={`${labelCls} pt-1`}>NAT configuration</span>
          <VStack<VPNNATConfig> value={f.natConfig} currentColor={currentColor}
            onChange={(v) => set("natConfig", v)}
            options={VPN_NAT_CONFIGS.map((o) => ({
              v: o.v, l: o.l,
              hint: o.v === "remote-site"
                ? "A remote behind NAT has no address to dial — the tunnel becomes dialup and waits for it to connect."
                : o.v === "this-site" ? "Forces NAT-T encapsulation instead of auto-detecting it." : undefined,
            }))} />
        </div>

        <div role="group" aria-labelledby="remote-device-type-label-2" className={rowCls} style={{ alignItems: "flex-start" }}>
          <span id="remote-device-type-label-2" className={`${labelCls} pt-1`}>Remote device type</span>
          <VStack<VPNRemoteDeviceType> value={f.remoteDeviceType} currentColor={currentColor}
            onChange={(v) => set("remoteDeviceType", v)}
            options={[{ v: "fortigate", l: "FortiGate" }, { v: "cisco", l: "Cisco" }]} />
        </div>
      </>)}
    </>)}
</>);

export default SetupStep;
