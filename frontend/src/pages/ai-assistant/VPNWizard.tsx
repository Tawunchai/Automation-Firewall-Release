import React, { useEffect, useState } from "react";
import { FiLock, FiEye, FiEyeOff } from "react-icons/fi";
import { message } from "../../components/ui/toast";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreateIPsecTunnel, DeviceUpdateIPsecTunnel, DeviceListIPsecTunnels,
  type IPsecTunnelPayload,
} from "../../api/policyObject";
import type { VPNKind } from "./parseVPNCLI";
import type { ApplyImpact } from "./applyImpact";
import WizardShell from "./WizardShell";

// VPNWizard — the AI's VPN proposal, reviewed step by step IN THE CHAT and created over REST.
//
// Every other object wizard (Policy, User Group, Route, …) reviews the AI's draft in the right-hand
// panel and applies from there; VPN used to be the exception — its button navigated away to the
// standalone /admin/ipsec-wizard page. This brings it into the family: the same multi-step review,
// the same confirm-before-write, the same Apply-over-REST, for the three IPsec shapes the AI emits
// (Site-to-Site, Remote Access, Hub-and-Spoke).
//
// It is a REVIEW wizard, not a from-scratch builder: parseVPNFromCLI has already produced a complete
// IPsecTunnelPayload, so the steps lay that payload out for a last look and let the two fields an
// operator most often wants to change — the tunnel name and the pre-shared key — be edited before
// Create. Deep phase1/phase2 surgery still lives on the full page wizard; this is the quick,
// consistent path from an AI suggestion to a tunnel on the device.

type Props = {
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: IPsecTunnelPayload;
  vpnKind: VPNKind;
  readOnly?: boolean;
  currentColor: string;
  onApplied: (name: string, wasEdit: boolean) => void;
  onCancel: () => void;
};

const KIND_LABEL: Record<VPNKind, string> = {
  "site-to-site": "Site-to-Site",
  "remote-access": "Remote Access (dialup)",
  "hub-spoke": "Hub-and-Spoke (ADVPN + BGP)",
};

/** One read-only review line. */
const Row: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-start justify-between gap-3 py-1.5">
    <span className="shrink-0 text-[11.5px] ink-3">{label}</span>
    <span className="min-w-0 break-words text-right text-[12px] font-semibold ink">
      {value === undefined || value === "" || value === null ? "—" : value}
    </span>
  </div>
);

const Section: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="divide-y hairline-2 rounded-[6px] border hairline px-3">{children}</div>
);

const VPNWizard: React.FC<Props> = ({
  device, hostname, isAdmin, draft, vpnKind, readOnly = false, currentColor, onApplied, onCancel,
}) => {
  // A working copy: the name and PSK are editable, everything else is reviewed as the AI proposed it.
  const [payload, setPayload] = useState<IPsecTunnelPayload>(() => ({ ...draft }));
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isEdit, setIsEdit] = useState(false);
  const [showPsk, setShowPsk] = useState(false);

  const kindLabel = KIND_LABEL[vpnKind];
  const hs = payload.hub_spoke;
  const signature = payload.auth_method === "signature";

  // Does a tunnel with this name already exist? Then Apply is an UPDATE, exactly as the other wizards
  // decide — a name collision on the device is -5, and overwriting is a different promise from creating.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    DeviceListIPsecTunnels(device.id)
      .then((list) => { if (!cancelled) setIsEdit(list.some((t) => t.name === draft.name)); })
      .catch(() => { /* best-effort: if the list fails we assume create and let the device answer */ })
      .finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft.name]);

  const remoteGateway =
    payload.remote_access ? "Dialup (clients connect in)"
    : payload.remote_type === "ddns" ? payload.remote_ddns
    : payload.remote_type === "dynamic" ? "Dialup (dynamic peer)"
    : payload.remote_gw;

  const nameError = !payload.name.trim() ? "A tunnel name is required" : "";
  const pskError = !signature && !payload.psk.trim() ? "A pre-shared key is required" : "";
  const canApply = isAdmin && !nameError && !pskError;

  const buildImpact = (): ApplyImpact => ({
    mode: isEdit ? "edit" : "create",
    transport: "rest",
    destructive: false,
    objects: [{ kind: "ipsec-tunnel", label: `${kindLabel} VPN`, name: payload.name.trim() }],
    policies: [],
    effects: [
      `${isEdit ? "Updates" : "Creates"} IPsec tunnel "${payload.name.trim()}" (${kindLabel})`
        + (vpnKind === "site-to-site" ? " with its phase 1 / phase 2 and the addresses, policies and routes it needs"
          : vpnKind === "hub-spoke" ? " with its tunnel interface, BGP process and policies"
          : " as a dialup listener with its client pool, split-tunnel group and policy"),
      "The tunnel stays down until the far end is configured to match (PSK, proposal, selectors).",
    ],
    warnings: isEdit ? ["A tunnel with this name already exists — Apply overwrites its phase 1 / phase 2."] : [],
    aiImpact: [],
    note: "Names the device already has are reused, not duplicated.",
  });

  const handleApply = async () => {
    if (!canApply) return;
    setSaving(true);
    try {
      const out: IPsecTunnelPayload = { ...payload, name: payload.name.trim(), psk: payload.psk };
      if (isEdit) await DeviceUpdateIPsecTunnel(device.id, draft.name, out);
      else        await DeviceCreateIPsecTunnel(device.id, out);
      message.success(`${isEdit ? "Update" : "Create"} VPN "${out.name}" Success`);
      onApplied(out.name, isEdit);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      message.error(e?.response?.data?.error || e?.message || `Failed to ${isEdit ? "update" : "create"} the VPN tunnel`);
    } finally {
      setSaving(false);
    }
  };

  const STEPS = ["Tunnel", "Authentication", "Networks"];

  return (
    <WizardShell
      title="VPN Wizard"
      icon={<FiLock size={13} />}
      device={device}
      hostname={hostname}
      currentColor={currentColor}
      stepLabels={STEPS}
      step={step}
      onStep={setStep}
      isEdit={isEdit}
      checking={checking}
      checkingLabel="Checking the device for a tunnel with this name…"
      readOnly={readOnly}
      saving={saving}
      canApply={canApply}
      applyDisabledReason={!isAdmin ? "Only admins can apply" : nameError || pskError || undefined}
      onApply={() => void handleApply()}
      buildImpact={buildImpact}
      onCancel={onCancel}
    >
      <div className="space-y-4 px-4 py-4">
        <div className="flex items-center gap-2">
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold"
            style={{ background: `${currentColor}18`, color: currentColor }}>{kindLabel}</span>
          <span className="t-meta">Reviewed from the AI's proposal</span>
        </div>

        {/* ── Step 1 · Tunnel ─────────────────────────────────────────── */}
        {step === 0 && (
          <>
            <label className="block">
              <span className="field-label">Tunnel name</span>
              <input className="shell-input" value={payload.name} disabled={readOnly}
                onChange={(e) => setPayload((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. HQ-to-Branch" />
              {nameError && <span className="field-hint" style={{ color: "#dc2626" }}>{nameError}</span>}
            </label>
            <Section>
              <Row label="Type" value={kindLabel} />
              <Row label="Outgoing interface" value={payload.interface} />
              <Row label="IKE version" value={payload.ike_version === "1" ? "IKEv1" : "IKEv2"} />
              <Row label="Remote gateway" value={remoteGateway} />
              {payload.nattraversal && <Row label="NAT traversal" value={payload.nattraversal} />}
              {vpnKind === "remote-access" && <Row label="Client" value={payload.ra_client} />}
              {hs && <Row label="Role" value={hs.role} />}
              {hs && <Row label="Tunnel IP" value={hs.tunnel_ip} />}
              {hs && <Row label="Local AS" value={hs.local_as} />}
            </Section>
          </>
        )}

        {/* ── Step 2 · Authentication ─────────────────────────────────── */}
        {step === 1 && (
          <>
            <Section>
              <Row label="Method" value={signature ? "Certificate (signature)" : "Pre-shared key"} />
              {signature && <Row label="Certificate" value={payload.certificate} />}
              {signature && <Row label="Peer CA" value={payload.peer_ca} />}
            </Section>
            {!signature && (
              <label className="block">
                <span className="field-label">Pre-shared key</span>
                <div className="relative">
                  <input className="shell-input pr-9" type={showPsk ? "text" : "password"}
                    value={payload.psk} disabled={readOnly}
                    onChange={(e) => setPayload((p) => ({ ...p, psk: e.target.value }))}
                    placeholder="shared secret" />
                  <button type="button" onClick={() => setShowPsk((v) => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 ink-3 hover-ink"
                    aria-label={showPsk ? "Hide the key" : "Show the key"}>
                    {showPsk ? <FiEyeOff size={14} /> : <FiEye size={14} />}
                  </button>
                </div>
                {pskError && <span className="field-hint" style={{ color: "#dc2626" }}>{pskError}</span>}
                <span className="field-hint">The far end must be set to the same key.</span>
              </label>
            )}
          </>
        )}

        {/* ── Step 3 · Networks ───────────────────────────────────────── */}
        {step === 2 && (
          <>
            {vpnKind === "site-to-site" && (
              <Section>
                <Row label="Local subnets" value={(payload.local_subnets || []).join(", ")} />
                <Row label="Remote subnets" value={(payload.remote_subnets || []).join(", ")} />
                <Row label="Local interface" value={payload.local_interface} />
                {payload.internet_access && payload.internet_access !== "none" &&
                  <Row label="Internet access" value={payload.internet_access} />}
              </Section>
            )}
            {vpnKind === "remote-access" && (
              <Section>
                <Row label="Client pool" value={payload.client_range_start
                  ? `${payload.client_range_start} – ${payload.client_range_end} / ${payload.client_netmask}` : undefined} />
                <Row label="User group" value={payload.user_group} />
                <Row label="DNS" value={payload.dns_mode === "manual" ? payload.dns_server : "System DNS"} />
                <Row label="Split tunnel" value={payload.split_tunnel ? "Enabled" : "Disabled (all traffic)"} />
                {(payload.local_addresses?.length ?? 0) > 0 &&
                  <Row label="Split destinations" value={payload.local_addresses!.join(", ")} />}
              </Section>
            )}
            {vpnKind === "hub-spoke" && hs && (
              <Section>
                <Row label="Local subnets" value={(hs.local_subnets || []).join(", ")} />
                <Row label="Remote tunnel IP" value={hs.remote_ip} />
                {hs.remote_gw && <Row label="Hub gateway" value={hs.remote_gw} />}
                {hs.spoke_type && <Row label="Spoke type" value={hs.spoke_type} />}
              </Section>
            )}
            <p className="t-meta m-0">
              Apply creates everything this tunnel needs over REST. You can undo it from the chat with Fallback.
            </p>
          </>
        )}
      </div>
    </WizardShell>
  );
};

export default VPNWizard;
