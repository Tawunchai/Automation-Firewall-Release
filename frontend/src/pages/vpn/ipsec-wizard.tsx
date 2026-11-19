import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import { FiLock, FiChevronLeft, FiCheck, FiAlertTriangle } from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import {
  DeviceListSystemInterfaces, DeviceCreateIPsecTunnel, DeviceGetInfo,
  DeviceRouterLookup, DeviceGetVPNMetadata, DeviceListAddresses, DeviceListIPsecTunnels,
  DeviceGetIPsecTunnelFull, DeviceUpdateIPsecTunnel, DeviceGetHubSpokeTunnel,
  type SystemInterface, type VPNWizardMetadata,
} from "../../api/policyObject";
import { focusRing } from "../../components/ui/form-controls.logic";
import VPNDiagram from "./ipsec-wizard-diagram";
import {
  BLANK_VPN_WIZARD, templateSupported, showsRemoteAddress, validateVPNStep, buildTunnelPayload,
  isRemoteAccess, buildRemoteAccessPayload, raHasClientOptions, RA_DEFAULT_NETMASK,
  isCustom, buildCustomPayload, p1ProposalDefaultFor, customStateFromEdit,
  isHubSpoke, hubIsSpoke, buildHubSpokePayload, deriveInterfaceSubnet, hubSpokeStateFromEdit,
  vpnStateFromPayload, AI_VPN_PREFILL_KEY,
  type VPNWizardState, type VPNTemplateType, type RADeviceKind, type RAClientType,
  type RANativeType, type CustomState, type HubSpokeRole,
} from "./ipsec-wizard-rules";
const STEPS_S2S = ["VPN Setup", "Authentication", "Policy & Routing", "Review Settings"];
// FortiClient is the only template with a Client Options step (they are IKE mode-config keys) —
// 5 steps. Cisco and every Native template are 4, exactly as the GUI renders them.
const STEPS_RA_FORTICLIENT = ["VPN Setup", "Authentication", "Policy & Routing", "Client Options", "Review Settings"];
const STEPS_RA_BASIC       = ["VPN Setup", "Authentication", "Policy & Routing", "Review Settings"];
// Custom mirrors the GUI's manual "New VPN Tunnel" form, split into its own sections as steps.
const STEPS_CUSTOM         = ["VPN Setup", "Network", "Authentication", "Phase 2", "Review Settings"];
// Hub-and-Spoke (ADVPN + BGP) — the GUI's five-step flow for both Hub and Spoke roles.
const STEPS_HUBSPOKE       = ["VPN Setup", "Authentication", "Tunnel Interface", "Policy & Routing", "Review Settings"];

import SetupStep from "./ipsec-wizard-step-setup";
import AuthStep from "./ipsec-wizard-step-auth";
import PolicyStep from "./ipsec-wizard-step-policy";
import CustomSteps from "./ipsec-wizard-step-custom";
import ReviewStep from "./ipsec-wizard-step-review";
import type { WizardCtx } from "./ipsec-wizard-context";
import { apiErrorDetail } from "../../api/errorText";


const IPsecWizardPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;
  const ring = focusRing(currentColor);

  const { device, setDevice, devices } = useSelectedDevice();
  const [hostname, setHostname] = useState("");
  const [interfaces, setInterfaces] = useState<SystemInterface[]>([]);
  const [meta, setMeta] = useState<VPNWizardMetadata>({ certificates: [], ca_certificates: [], default_gateway: "", user_groups: [], l2tp_enabled: false, l2tp_range: "", l2tp_user_group: "" });
  const [addresses, setAddresses] = useState<string[]>([]);
  // Existing tunnel names on the device — a name collision fails on FortiGate with -5, so the
  // wizard warns before Create rather than after.
  const [existingNames, setExistingNames] = useState<string[]>([]);
  // Edit mode: ?edit=<name> loads that tunnel into the Custom form and turns Create into Save.
  const editName = searchParams.get("edit");
  const [editing, setEditing] = useState(false);
  const [loadingEdit, setLoadingEdit] = useState(false);

  const [step, setStep] = useState(0);
  const [f, setF] = useState<VPNWizardState>(BLANK_VPN_WIZARD);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [showPSK, setShowPSK] = useState(false);
  const set = <K extends keyof VPNWizardState>(k: K, v: VPNWizardState[K]) => setF((p) => ({ ...p, [k]: v }));
  // Custom lives in a nested object — a dedicated setter keeps the call sites as terse as `set`.
  const setC = <K extends keyof CustomState>(k: K, v: CustomState[K]) =>
    setF((p) => ({ ...p, custom: { ...p.custom, [k]: v } }));
  const c = f.custom;

  // Switching the Custom IKE version re-defaults the Phase 1 proposal list the way the GUI does —
  // an AEAD+PRF row is invalid on IKEv1, and IKEv1's HMAC-only set is stale on IKEv2.
  const setCustomIKE = (v: "1" | "2") =>
    setF((p) => ({ ...p, custom: { ...p.custom, ikeVersion: v, p1Proposals: p1ProposalDefaultFor(v) } }));

  // Four steps everywhere except Remote Access → FortiClient (adds "Client Options") and Custom.
  const STEPS = isCustom(f) ? STEPS_CUSTOM
    : isHubSpoke(f) ? STEPS_HUBSPOKE
    : isRemoteAccess(f) ? (raHasClientOptions(f) ? STEPS_RA_FORTICLIENT : STEPS_RA_BASIC)
    : STEPS_S2S;
  const lastStep = STEPS.length - 1;

  // Local subnet auto-fill (Hub-and-Spoke Policy & Routing): choosing a Local interface fills Local
  // subnets with that interface's own network, exactly like the FortiGate GUI. Only overwrites the
  // empty default so a user's manual edit is never clobbered.
  const setHubLocalInterface = (name: string) =>
    setF((p) => {
      const iface = interfaces.find((i) => i.name === name);
      const derived = iface ? deriveInterfaceSubnet(iface.ip) : "";
      const onlyBlank = p.localSubnets.length === 1 && p.localSubnets[0].trim() === "";
      return { ...p, localInterface: name, ...(derived && onlyBlank ? { localSubnets: [derived] } : {}) };
    });

  // Switching the remote device type re-defaults the Subnet Mask the way the GUI does (FortiClient
  // and the Native templates fill in a /24; Cisco shows the device default). Also clears the
  // Cisco-only Group Name so it can never leak onto another template.
  const setRAClient = (v: RAClientType) =>
    setF((p) => ({
      ...p, raClient: v, clientNetmask: RA_DEFAULT_NETMASK[v],
      ...(v === "forticlient" ? { requireGroupName: false, groupName: "" } : {}),
    }));
  const setRANative = (v: RANativeType) =>
    setF((p) => ({ ...p, raNative: v, clientNetmask: RA_DEFAULT_NETMASK[v], requireGroupName: false, groupName: "" }));
  const setRADeviceKind = (v: RADeviceKind) =>
    setF((p) => ({
      ...p, raDeviceKind: v,
      clientNetmask: RA_DEFAULT_NETMASK[v === "native" ? p.raNative : p.raClient],
      ...(v === "native" ? { requireGroupName: false, groupName: "" } : {}),
    }));

  // ── Device ─────────────────────────────────────────────────────────────────
  // The device is the console-wide selection from the navbar picker, so the sidebar can link here
  // with no ?deviceId and the wizard still has a firewall to build on. (Requiring the query param
  // left the whole wizard dead-ended: no device meant Next was disabled forever, with nothing on
  // screen saying why.)
  //
  // A ?deviceId IS still honoured — the AI Assistant and the tunnel list both link here with one —
  // by MOVING the console's selection to it rather than holding a second, page-local one. So
  // following such a link re-points the navbar too, and the wizard can never be building against a
  // different firewall than the one the header names.
  const deviceIdParam = searchParams.get("deviceId");
  useEffect(() => {
    if (!deviceIdParam) return;
    const wanted = Number(deviceIdParam);
    if (device?.id === wanted) return;
    const found = devices.find((d) => d.id === wanted);
    if (found) setDevice(found);
  }, [deviceIdParam, devices, device?.id, setDevice]);

  // AI Assistant prefill: the chat writes a parsed VPN payload to sessionStorage and opens the wizard
  // with ?aiPrefill=1. Read it ONCE, rebuild the full wizard state (any VPN type) and clear it, so an
  // AI VPN suggestion opens the same reviewed multi-step wizard as a manual build.
  const aiPrefill = searchParams.get("aiPrefill");
  useEffect(() => {
    if (aiPrefill !== "1") return;
    const raw = sessionStorage.getItem(AI_VPN_PREFILL_KEY);
    if (!raw) return;
    sessionStorage.removeItem(AI_VPN_PREFILL_KEY);
    try { setF(vpnStateFromPayload(JSON.parse(raw))); } catch { /* ignore a malformed slot */ }
  }, [aiPrefill]);

  // The IPsec Tunnel Template page links here with ?template=<type> (and, for Remote Access, the
  // client sub-type) to open the wizard on that template. Only supported ones are honoured.
  const templateParam = searchParams.get("template");
  useEffect(() => {
    if (!templateParam || !templateSupported(templateParam as VPNTemplateType)) return;
    const raKind = searchParams.get("raKind") as RADeviceKind | null;
    const raClient = searchParams.get("raClient") as RAClientType | null;
    const raNative = searchParams.get("raNative") as RANativeType | null;
    const role = searchParams.get("role") as HubSpokeRole | null;
    setF((p) => ({
      ...p,
      templateType: templateParam as VPNTemplateType,
      ...(raKind ? { raDeviceKind: raKind } : {}),
      ...(raClient ? { raClient, clientNetmask: RA_DEFAULT_NETMASK[raClient] } : {}),
      ...(raNative ? { raNative, clientNetmask: RA_DEFAULT_NETMASK[raNative] } : {}),
      ...(role === "hub" || role === "spoke" ? { hsRole: role } : {}),
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateParam]);

  // Edit mode: once the device is known, load the tunnel into the matching wizard flow. A
  // Hub-and-Spoke tunnel (?kind=hub-and-spoke) opens its own flow reconstructed from the device;
  // everything else uses the Custom editor (item 1).
  const editKind = searchParams.get("kind");
  useEffect(() => {
    if (!device || !editName) return;
    let cancelled = false;
    setLoadingEdit(true);
    (async () => {
      if (editKind === "hub-and-spoke") {
        const rb = await DeviceGetHubSpokeTunnel(device.id, editName);
        if (cancelled) return;
        if (rb) { setF(hubSpokeStateFromEdit(rb)); setEditing(true); }
        else message.error(`Could not load Hub-and-Spoke tunnel "${editName}"`);
        setLoadingEdit(false);
        return;
      }
      const full = await DeviceGetIPsecTunnelFull(device.id, editName);
      if (cancelled) return;
      if (full) { setF(customStateFromEdit(full)); setEditing(true); }
      else message.error(`Could not load tunnel "${editName}"`);
      setLoadingEdit(false);
    })();
    return () => { cancelled = true; };
  }, [device, editName, editKind]);

  // Everything the wizard needs FROM the device, refetched whenever the device changes.
  //
  // All five at once, because not one of them reads another's answer. Awaited one after another —
  // as they were — the wizard could not open until their times had been ADDED UP, and one of them
  // dominates: the certificate list behind DeviceGetVPNMetadata takes ~0.8s on the lab FGT80E
  // however little else is happening, because the device serialises the whole certificate store to
  // answer it. Sequentially that is ~1.7s of waiting on a form nobody can touch yet; together it
  // is the slowest one, ~0.8s.
  //
  // The one behavioural difference is that the fields now populate together instead of appearing
  // in the order they were awaited, which is the better of the two: the interface and address
  // pickers no longer fill in underneath whoever has already started typing a name.
  //
  // A section the device will not answer for must not take the others down with it, so each result
  // is settled on its own — the wizard has always degraded to an empty picker rather than a broken
  // page, and Promise.all would have turned one refused read into exactly that broken page.
  useEffect(() => {
    if (!device) { setHostname(""); setInterfaces([]); return; }
    let cancelled = false;
    (async () => {
      const [info, ifs, m, addrs, tuns] = await Promise.all([
        DeviceGetInfo(device.id).catch(() => null),
        DeviceListSystemInterfaces(device.id).catch(() => []),
        DeviceGetVPNMetadata(device.id).catch(() => null),
        DeviceListAddresses(device.id).catch(() => []),
        DeviceListIPsecTunnels(device.id).catch(() => []),
      ]);
      if (cancelled) return;

      setHostname(info?.hostname || device.name);
      setInterfaces(ifs);
      if (m) {
        setMeta(m);
        // "Use Remote" needs this site's real default gateway; prefill it the way the GUI does.
        if (m.default_gateway) setF((p) => (p.localGateway ? p : { ...p, localGateway: m.default_gateway }));
      }
      // Existing address objects — the "Local Address" picker in Remote Access split tunnelling.
      setAddresses(addrs.map((a) => a.name).sort((a, b) => a.localeCompare(b)));
      // Existing tunnel names — for the duplicate-name warning on the Name field.
      setExistingNames(tuns.map((t) => t.name));
    })();
    return () => { cancelled = true; };
  }, [device]);

  // A tunnel with this exact name already exists — FortiGate would reject Create with -5. (Not a
  // concern when editing: the name IS an existing tunnel, the one being edited.)
  const nameCollision = !editing && !!f.name.trim() && existingNames.includes(f.name.trim());

  const parentIfaces = interfaces.filter((i) =>
    ["physical", "aggregate", "hard-switch", "switch", "redundant", "vlan"].includes(i.type));

  // ── Outgoing Interface, auto-filled from the Remote IP address ──────────────
  //
  // The device does the routing lookup, not us: the answer depends on the live routing table, and
  // guessing it from interface subnets is wrong on any interface whose link is down (measured:
  // dmz is 10.10.10.1/24 but 10.10.10.254 routes out port1, because dmz has no carrier — which is
  // exactly what the real GUI shows).
  //
  // `auto` tracks whether the current value came from us: once the user picks an interface by
  // hand, a later lookup must not overwrite their choice.
  const [lookingUp, setLookingUp] = useState(false);
  const [lookupNote, setLookupNote] = useState("");
  const autoFilledRef = useRef(true);
  const lookupSeq = useRef(0);

  const runLookup = useCallback(async (ip: string) => {
    if (!device || !ip.trim()) { setLookupNote(""); return; }
    const seq = ++lookupSeq.current;
    setLookingUp(true);
    const lk = await DeviceRouterLookup(device.id, ip.trim());
    // A slower earlier request must never clobber a newer answer.
    if (seq !== lookupSeq.current) return;
    setLookingUp(false);
    if (!lk?.success || !lk.interface) {
      setLookupNote("No route to that address — pick the outgoing interface yourself.");
      return;
    }
    setLookupNote(`Routed via ${lk.network}${lk.gateway && lk.gateway !== "0.0.0.0" ? ` → ${lk.gateway}` : " (directly connected)"}`);
    if (autoFilledRef.current) setF((p) => ({ ...p, outInterface: lk.interface }));
  }, [device]);

  // Debounced so a lookup fires when the user pauses, not on every keystroke.
  useEffect(() => {
    if (!showsRemoteAddress(f) || f.remoteDeviceKind !== "ip") return;
    const ip = f.remoteGw.trim();
    if (!ip) { setLookupNote(""); return; }
    const t = setTimeout(() => void runLookup(ip), 450);
    return () => clearTimeout(t);
  }, [f.remoteGw, f.remoteDeviceKind, f.natConfig, runLookup]); // eslint-disable-line react-hooks/exhaustive-deps

  const ifaceLabel = (name: string) => {
    const i = interfaces.find((x) => x.name === name);
    return i?.alias ? `${i.alias} (${i.name})` : name;
  };

  const next = () => {
    const e = validateVPNStep(f, step, editing);
    // A duplicate name only fails at Create time on the device; catch it at step 0 so the user
    // isn't walked through the whole wizard for a tunnel that can't be saved.
    if (step === 0 && nameCollision) e.name = "This name is already in use on the device.";
    if (Object.keys(e).length) { setErrors(e); return; }
    setErrors({});
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };
  const back = () => { setErrors({}); setStep((s) => Math.max(s - 1, 0)); };

  const submit = async () => {
    if (!device) { message.error("No device selected"); return; }
    // Re-check every step: the user can walk back and empty a field after passing it once.
    for (let s = 0; s < lastStep; s++) {
      const e = validateVPNStep(f, s, editing);
      if (Object.keys(e).length) { setErrors(e); setStep(s); return; }
    }
    try {
      setSaving(true);
      // Edit mode: PATCH the existing tunnel and land back on the list. Hub-and-Spoke re-applies its
      // own payload (phase1/phase2 + tunnel IP + BGP + address group); everything else is Custom.
      if (editing) {
        const editPayload = isHubSpoke(f) ? buildHubSpokePayload(f) : buildCustomPayload(f);
        const res = await DeviceUpdateIPsecTunnel(device.id, f.name.trim(), editPayload);
        if (res?.warnings?.length) message.warning(`Tunnel "${f.name}" updated, but: ${res.warnings.join("; ")}`, 8);
        else message.success(`Tunnel "${f.name}" updated on ${hostname || device.name}`);
        navigate(`/admin/ipsec-tunnels?deviceId=${device.id}`);
        return;
      }
      const payload = isCustom(f) ? buildCustomPayload(f)
        : isHubSpoke(f) ? buildHubSpokePayload(f)
        : isRemoteAccess(f) ? buildRemoteAccessPayload(f)
        : buildTunnelPayload(f);
      const res = await DeviceCreateIPsecTunnel(device.id, payload);
      const kind = isCustom(f) ? "Custom IPsec tunnel"
        : isHubSpoke(f) ? `Hub-and-Spoke VPN (${hubIsSpoke(f) ? "Spoke" : "Hub"})`
        : isRemoteAccess(f) ? "Remote Access VPN" : "IPsec tunnel";
      if (res.warnings?.length) {
        message.warning(`${kind} created, but: ${res.warnings.join("; ")}`, 8);
      } else {
        message.success(`${kind} "${f.name}" created on ${hostname || device.name}`);
      }
      // Land on the tunnels list — that is where the thing we just built shows up (and where its
      // status goes green once the far end connects).
      navigate(`/admin/ipsec-tunnels?deviceId=${device.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create tunnel"), 8);
    } finally { setSaving(false); }
  };

  const wanIfaces = interfaces.filter((i) => i.role === "wan" || parentIfaces.includes(i));

  // One object for the step panels, which used to be thirteen blocks inside this component's own
  // return and so simply closed over all of this. Naming the closure is what let them move into
  // their own files; see ipsec-wizard-context.ts for what each field is.
  const ctx: WizardCtx = {
    currentColor, ring, device, meta, addresses, parentIfaces, wanIfaces, ifaceLabel,
    editing, nameCollision, step, lastStep, f, setF, errors, set, c, setC,
    setCustomIKE, setHubLocalInterface, setRAClient, setRANative, setRADeviceKind,
    showPSK, setShowPSK, lookingUp, lookupNote, autoFilledRef,
  };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiLock />} title={editing ? "Edit IPsec Tunnel" : "VPN Creation Wizard"} accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 transition surface-hover">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {/* Device — the wizard writes to whichever FortiGate is selected here */}
      <div className="flex items-center gap-3 rounded-[4px] border hairline surface-card px-4 py-3">
        <span className="text-[11px] font-bold uppercase tracking-[0.12em] ink-3">Device</span>
      </div>

      {!device && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            Select a FortiGate above to start — the wizard reads its interfaces and routing table.
          </p>
        </div>
      )}

      {/* Stepper */}
      <div className="flex items-center gap-1 overflow-x-auto rounded-[4px] border hairline surface-card px-3 py-3">
        {STEPS.map((label, i) => {
          const done = i < step, active = i === step;
          return (
            <React.Fragment key={label}>
              <button type="button" disabled={i > step} onClick={() => i < step && setStep(i)}
                className="flex shrink-0 items-center gap-2 disabled:cursor-default">
                <span className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold text-white"
                  style={{ background: done || active ? currentColor : "#cbd5e1" }}>
                  {done ? <FiCheck size={12} /> : i + 1}
                </span>
                <span className="text-[12.5px] font-semibold" style={{ color: active ? currentColor : done ? "#64748b" : "#94a3b8" }}>{label}</span>
              </button>
              {i < STEPS.length - 1 && <div className="h-px w-8 shrink-0 surface-sunken" />}
            </React.Fragment>
          );
        })}
      </div>

      {/* 70/30 — minmax(0,…) lets both columns shrink instead of being forced wide by their content. */}
      <div className="grid gap-4" style={{ gridTemplateColumns: "minmax(0, 7fr) minmax(0, 3fr)" }}>
        <div className="rounded-[4px] border hairline surface-card shadow-sm">
          <div className="space-y-4 px-6 py-6">

            {/* The step panels. Each one is gated on `step` (and, where flows differ, on the template),
                so exactly one renders at a time — the same arrangement as when they were thirteen
                blocks in this file. They all take the same context object; see ipsec-wizard-context.ts. */}
            <SetupStep {...ctx} />
            <AuthStep {...ctx} />
            <PolicyStep {...ctx} />
            <CustomSteps {...ctx} />
            <ReviewStep {...ctx} />
          </div>

          {/* Footer nav */}
          <div className="flex justify-end gap-3 border-t hairline-2 px-6 py-4">
            <button type="button" onClick={step === 0 ? () => navigate(-1) : back}
              className="h-9 rounded-[4px] border hairline px-5 text-[13px] font-semibold ink-2 transition surface-hover">
              {step === 0 ? "Cancel" : "< Back"}
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" onClick={next} disabled={!device || loadingEdit}
                className="flex h-9 items-center gap-2 rounded-[4px] px-6 text-[13px] font-semibold text-white transition disabled:opacity-50"
                style={{ background: gradient }}>Next {">"}</button>
            ) : (
              <button type="button" onClick={submit} disabled={saving || !device}
                className="flex h-9 items-center gap-2 rounded-[4px] px-6 text-[13px] font-semibold text-white transition disabled:opacity-50"
                style={{ background: gradient }}>
                {saving
                  ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> {editing ? "Saving…" : "Creating…"}</>
                  : <><FiCheck size={14} /> {editing ? "Save changes" : "Create"}</>}
              </button>
            )}
          </div>
        </div>

        {/* Right panel — the live topology + the target device */}
        <div className="space-y-3">
          <VPNDiagram state={f} currentColor={currentColor} />
          <div className="rounded-[4px] border hairline-2 surface-card p-4 shadow-sm">
            {/* The device's OWN hostname, read live from the box — not the inventory name in the
                navbar, so it still earns its line. The management IP does not. */}
            <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
            <p className="mt-1.5 text-[13px] font-semibold ink">{hostname || device?.name || "—"}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default IPsecWizardPage;
