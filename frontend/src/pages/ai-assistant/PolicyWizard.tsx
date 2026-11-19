import React, { useEffect, useMemo, useRef, useState } from "react";
import { message } from "../../components/ui/toast";
import {
  FiCheck, FiCheckCircle, FiChevronLeft, FiChevronRight, FiChevronDown,
  FiHardDrive, FiShield, FiX, FiPlusCircle, FiLayers, FiLock,
} from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceCreatePolicy, DeviceUpdatePolicy, DeviceListPolicies, DeviceMovePolicy,
  DeviceListAddresses, DeviceListServices, DeviceGetPolicyProfiles,
  DeviceListSchedules, DeviceListVirtualIPs,
  type FirewallPolicy,
} from "../../api/policyObject";
import { PolicyFieldsGeneral, PolicyFieldsNetwork, PolicyFieldsSecurity, PolicyFieldsLogging, type PolicyFieldsProps } from "../firewall-policy/create";
import { usePolicyFormOptions, buildPolicyPayload, validatePolicyForm, policyObjectToFormState, type PolicyFormState } from "../firewall-policy/create.logic";
import { policyDraftToFormState } from "./parsePolicyCLI";
import type { ParsedAddress } from "./parseAddressCLI";
import type { ParsedService } from "./parseServiceCLI";
import type { ParsedSchedule } from "./parseScheduleCLI";
import type { PrereqBlock, PrereqKind } from "./parsePrereqCLI";
import type { ParsedAV } from "./parseAntivirusCLI";
import type { ParsedWebFilter } from "./parseWebFilterCLI";
import type { ParsedAppControl } from "./parseAppControlCLI";
import type { ParsedFileFilter } from "./parseFileFilterCLI";
import type { ParsedDNSFilter } from "./parseDNSFilterCLI";
import type { ParsedVIP } from "./parseVirtualIPCLI";
import AntivirusWizard from "./AntivirusWizard";
import WebFilterWizard from "./WebFilterWizard";
import AppControlWizard from "./AppControlWizard";
import FileFilterWizard from "./FileFilterWizard";
import DNSFilterWizard from "./DNSFilterWizard";
import VirtualIPWizard from "./VirtualIPWizard";
import AddressWizard from "./AddressWizard";
import ServiceWizard from "./ServiceWizard";
import ScheduleWizard from "./ScheduleWizard";
import PolicyPlacementBoard from "./PolicyPlacementBoard";
import { isPairRelevant } from "./packetSim";
import WizardApplyButton from "./WizardApplyButton";
import { policyApplyImpact } from "./wizardImpact";
import { REL_TO_UNDO } from "./undoKinds";
import { REL_META, computeRelItems, type RelKind, type CreatedObject } from "./relObjects";
import {
  ensureReferencedVIPs, ensureReferencedAddresses, ensureReferencedServices,
  ensureReferencedSchedule, ensureReferencedProfiles, type PrereqCtx,
} from "./policyPrereqs";
import { apiErrorText } from "../../api/errorText";

// The "placement" step has no PolicyFieldsProps component — it renders PolicyPlacementBoard,
// which needs the live rule base. It's special-cased in the render below (Component unused).
type StepDef = { key: string; label: string; Component: React.FC<PolicyFieldsProps> | null };

const ALL_STEPS: StepDef[] = [
  { key: "general",   label: "First Setup",                Component: PolicyFieldsGeneral },
  { key: "network",   label: "Firewall / Network Options", Component: PolicyFieldsNetwork },
  { key: "security",  label: "Security Profiles",          Component: PolicyFieldsSecurity },
  { key: "logging",   label: "Logging",                    Component: PolicyFieldsLogging },
  { key: "placement", label: "Policy Placement",           Component: null },
];

const PolicyWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  draft: Partial<PolicyFormState>;
  target?: string;   // current policy name on the device (edit); empty/undefined = create
  pendingAddresses?: ParsedAddress[]; // AI-proposed address definitions to auto-create if referenced but missing
  pendingServices?: ParsedService[];  // AI-proposed custom-service definitions to auto-create if referenced but missing
  pendingProfiles?: PrereqBlock[];    // AI-proposed security-profile CLI blocks to auto-create if referenced but missing
  pendingSchedules?: ParsedSchedule[]; // AI-proposed schedule definitions to auto-create if referenced but missing
  pendingVIPs?: ParsedVIP[];          // AI-proposed Virtual IP definitions (referenced in dstaddr)
  pendingAV?: ParsedAV;               // AI-proposed AntiVirus draft (for the Related-Objects sub-wizard)
  pendingWeb?: ParsedWebFilter;       // AI-proposed Web Filter draft
  pendingDNS?: ParsedDNSFilter;       // AI-proposed DNS Filter draft
  pendingApp?: ParsedAppControl;      // AI-proposed Application Control draft
  pendingFF?: ParsedFileFilter;       // AI-proposed File Filter draft
  readOnly?: boolean; // true = already applied → review only
  currentColor: string;
  // ── Multi-policy placement coordination (only set when the suggestion has 2+ policies) ──
  selfOrder?: number;                              // this policy's index in the suggestion (AI order, top→bottom)
  siblings?: { name: string; order: number }[];    // the OTHER policies in the same suggestion
  appliedSiblingNames?: Set<string>;               // which siblings are already on the device
  groupBeforeId?: number | null;                   // shared anchor for same-suggestion policies (create, unlocked)
  onGroupBeforeIdChange?: (beforeId: number | null) => void; // write the shared anchor back up
  // ── Multi-policy switcher (in the wizard header, next to Objects) ──
  // `locked` = a policy that can't be opened yet because an earlier one must be created first;
  // `lockReason` is that earlier policy's name (shown as "กรุณาสร้าง … ก่อน").
  policyList?: { name: string; action: "accept" | "deny"; applied: boolean; locked?: boolean; lockReason?: string }[];
  activePolicyIdx?: number;                         // which one this wizard is showing
  onSwitchPolicy?: (idx: number) => void;           // switch the wizard to another policy
  // Fires once per object the wizard actually creates on the device — the prerequisites it
  // auto-creates during Apply AND the ones the user builds in a sub-wizard beforehand — so the
  // chat can report each of them as its own success line.
  onObjectCreated?: (obj: CreatedObject) => void;
  onApplied: (policyName: string, wasEdit: boolean) => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, draft, target, pendingAddresses = [], pendingServices = [], pendingProfiles = [], pendingSchedules = [], pendingVIPs = [], pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF, readOnly = false, currentColor, selfOrder, siblings = [], appliedSiblingNames, groupBeforeId, onGroupBeforeIdChange, policyList = [], activePolicyIdx = 0, onSwitchPolicy, onObjectCreated, onApplied, onCancel }) => {
  const { interfaces, addresses, services, profiles, loadingProfiles } = usePolicyFormOptions(device.id);

  // Surface any AI-proposed NEW profile (one that has a pending CLI block but isn't on the device
  // yet) in the Security Profiles dropdowns so it shows as selected and marked "will be created".
  const augmentedProfiles = useMemo(() => {
    const add = (list: string[], kind: PrereqKind) => {
      const extra = pendingProfiles.filter((b) => b.kind === kind && !list.includes(b.name)).map((b) => b.name);
      return extra.length ? [...list, ...extra] : list;
    };
    return {
      ...profiles,
      av_profiles:          add(profiles.av_profiles, "antivirus"),
      webfilter_profiles:   add(profiles.webfilter_profiles, "webfilter"),
      app_lists:            add(profiles.app_lists, "application-control"),
      dnsfilter_profiles:   add(profiles.dnsfilter_profiles, "dnsfilter"),
      ips_sensors:          add(profiles.ips_sensors, "ips"),
      file_filter_profiles: add(profiles.file_filter_profiles, "file-filter"),
    };
  }, [profiles, pendingProfiles]);

  const [form, setForm]     = useState<PolicyFormState>(() => policyDraftToFormState(draft));
  const [isEdit, setIsEdit] = useState(false);
  const [policyId, setPolicyId] = useState<number | null>(null);
  const [policies, setPolicies] = useState<FirewallPolicy[]>([]);
  // Placement is reference-based: the new/edited policy goes BEFORE this policy id (null = bottom).
  const [beforeId, setBeforeId] = useState<number | null>(null);
  const [checking, setChecking] = useState(true);
  const [step, setStep]     = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // ── Policy switcher (2+ policies) — dropdown in the header next to Objects ──
  const [polSwOpen, setPolSwOpen] = useState(false);
  const polSwRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (polSwRef.current && !polSwRef.current.contains(e.target as Node)) setPolSwOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  // ── Related Objects (the dropdown of sub-wizards for this policy's referenced objects) ──
  const [relOpen, setRelOpen] = useState(false);
  const [subWizard, setSubWizard] = useState<{ kind: RelKind; name: string; readOnly: boolean } | null>(null);
  // Objects created THIS session via a sub-wizard — "kind:name". Combined with device-existence
  // so the dropdown shows a green check and the final Apply skips re-creating them.
  const [createdRel, setCreatedRel] = useState<Set<string>>(new Set());
  const relKey = (k: RelKind, n: string) => `${k}:${n}`;
  const markRelCreated = (k: RelKind, n: string) => setCreatedRel((s) => new Set(s).add(relKey(k, n)));
  // Live names already on the device — refreshed on mount AND right before Apply so a re-Apply (or an
  // object created earlier this session) is correctly recognised and SKIPPED, never re-created (the
  // FortiGate rejects a duplicate with "error code -5"). Profiles are included here too (not just the
  // stale mount-time usePolicyFormOptions snapshot).
  const [existingAddr, setExistingAddr] = useState<Set<string>>(new Set());
  const [existingSvc, setExistingSvc] = useState<Set<string>>(new Set());
  const [existingSched, setExistingSched] = useState<Set<string>>(new Set());
  const [existingVIP, setExistingVIP] = useState<Set<string>>(new Set());
  const [existingProf, setExistingProf] = useState<{ av: Set<string>; web: Set<string>; dns: Set<string>; app: Set<string>; file: Set<string> }>(
    { av: new Set(), web: new Set(), dns: new Set(), app: new Set(), file: new Set() });
  const refreshExistence = async () => {
    const [a, s, sc, vp, p] = await Promise.all([
      DeviceListAddresses(device.id).catch(() => []),
      DeviceListServices(device.id).catch(() => []),
      DeviceListSchedules(device.id).catch(() => []),
      DeviceListVirtualIPs(device.id).catch(() => []),
      DeviceGetPolicyProfiles(device.id).catch(() => null),
    ]);
    setExistingAddr(new Set(a.map((x) => x.name)));
    setExistingVIP(new Set(vp.map((x) => x.name)));
    setExistingSvc(new Set(s.map((x) => x.name)));
    setExistingSched(new Set(sc.map((x) => x.name)));
    if (p) setExistingProf({
      av: new Set(p.av_profiles), web: new Set(p.webfilter_profiles),
      dns: new Set(p.dnsfilter_profiles),
      app: new Set(p.app_lists), file: new Set(p.file_filter_profiles),
    });
    return { addr: new Set(a.map((x) => x.name)), svc: new Set(s.map((x) => x.name)),
      sched: new Set(sc.map((x) => x.name)), vip: new Set(vp.map((x) => x.name)),
      av: new Set(p?.av_profiles ?? []), web: new Set(p?.webfilter_profiles ?? []),
      dns: new Set(p?.dnsfilter_profiles ?? []),
      app: new Set(p?.app_lists ?? []), file: new Set(p?.file_filter_profiles ?? []) };
  };
  useEffect(() => { void refreshExistence(); }, [device.id]);

  const set = <K extends keyof PolicyFormState>(k: K, v: PolicyFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  // If a policy with the AI-proposed name already exists, switch to edit mode: prefill from the
  // live policy, then overlay the AI's changes → Apply becomes an update instead of a create.
  useEffect(() => {
    let cancelled = false;
    setChecking(true);
    // Always pull the live rule base — the Placement board needs it even for a plain create.
    DeviceListPolicies(device.id).then((list) => {
      if (cancelled) return;
      setPolicies(list);
      // Match on the object's current name (target); fall back to the draft name for a create.
      const lookup = target || draft.name;
      const existing = lookup ? list.find((p) => p.name && p.name === lookup) : undefined;
      if (existing) {
        setIsEdit(true);
        setPolicyId(existing.id);
        // Initial placement = the policy's CURRENT position within its own interface pair, so the
        // board opens where it sits: beforeId = the next SAME-PAIR policy after it (null = it's last
        // in its pair). The board only lists that pair, so we skip unrelated policies in between.
        const eSrc = existing.src_intf_list?.[0] || existing.src_intf;
        const eDst = existing.dst_intf_list?.[0] || existing.dst_intf;
        const selfPos = list.findIndex((p) => p.id === existing.id);
        let nextSamePair: number | null = null;
        for (let i = selfPos + 1; i < list.length; i++) {
          if (list[i].id !== existing.id && isPairRelevant(list[i], eSrc, eDst)) { nextSamePair = list[i].id; break; }
        }
        setBeforeId(nextSamePair);
        // Base = live policy mapped to form; overlay only the AI-specified keys from the draft
        // (which includes the NEW name on a rename).
        setForm({ ...policyObjectToFormState(existing), ...draft });
      }
    }).catch(() => { /* treat as create */ }).finally(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [device.id, draft, target]);

  // ── Multi-policy placement coordination ──────────────────────────────────────
  // When the suggestion holds 2+ policies, their placement is linked so applying them one at a
  // time can never collide: while none is created they share ONE anchor (move one, the other
  // follows); once a sibling IS on the device, this policy's slot is LOCKED to the AI order
  // relative to it. `siblings` is empty for a normal single-policy suggestion → all no-ops.
  const isGroup = siblings.length > 0;
  const rbIndex = (id: number) => policies.findIndex((p) => p.id === id);

  // Siblings from this suggestion that are already on the device, with their live rule-base id.
  const createdSiblings = useMemo(() => {
    if (!isGroup || !appliedSiblingNames) return [] as { name: string; order: number; id: number }[];
    const out: { name: string; order: number; id: number }[] = [];
    for (const s of siblings) {
      if (!appliedSiblingNames.has(s.name)) continue;
      const live = policies.find((p) => p.name === s.name);
      if (live) out.push({ name: s.name, order: s.order, id: live.id });
    }
    return out;
  }, [isGroup, appliedSiblingNames, siblings, policies]);

  // Locked once any sibling exists on the device (create mode only).
  const placementLocked = !isEdit && createdSiblings.length > 0;

  // The exact slot a LOCKED policy must take, from AI order (lower = higher up) vs created siblings.
  const lockedBeforeId = useMemo<number | null>(() => {
    if (!placementLocked) return null;
    const me = selfOrder ?? 0;
    // Siblings AI wants BELOW me → sit directly ABOVE the earliest one in the rule base.
    const below = createdSiblings.filter((s) => s.order > me).sort((a, b) => rbIndex(a.id) - rbIndex(b.id));
    if (below.length) return below[0].id;
    // Otherwise every created sibling is ABOVE me → sit right AFTER the lowest one.
    const above = createdSiblings.filter((s) => s.order <= me).sort((a, b) => rbIndex(b.id) - rbIndex(a.id));
    const anchor = above[0];
    if (!anchor) return null;
    const gi = rbIndex(anchor.id);
    return gi >= 0 && gi < policies.length - 1 ? policies[gi + 1].id : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placementLocked, createdSiblings, selfOrder, policies]);

  // Seed / enforce beforeId for the group: locked → force the computed slot; unlocked create →
  // follow the shared anchor so opening the sibling starts where the first one was placed.
  useEffect(() => {
    if (isEdit) return;
    if (placementLocked) { setBeforeId(lockedBeforeId); return; }
    if (isGroup && groupBeforeId !== undefined) setBeforeId(groupBeforeId ?? null);
  }, [isEdit, placementLocked, lockedBeforeId, isGroup, groupBeforeId, policies.length]);

  // Board change handler — in an unlocked group, lift the anchor up so the sibling follows.
  const handlePlacementChange = (id: number | null) => {
    setBeforeId(id);
    if (isGroup && !placementLocked) onGroupBeforeIdChange?.(id);
  };

  // Banner on the placement step for a multi-policy suggestion.
  const placementNote = useMemo<React.ReactNode>(() => {
    if (!isGroup) return null;
    const ordered = [...siblings, { name: form.name || "(this policy)", order: selfOrder ?? 0 }]
      .sort((a, b) => a.order - b.order).map((s) => s.name);
    if (placementLocked) {
      const names = createdSiblings.map((s) => `"${s.name}"`).join(", ");
      return <span>Policy {names} has already been created, so this one's position is <b>locked</b> to the order the model proposed (top→bottom: {ordered.join(" → ")}) to keep the indexes from colliding</span>;
    }
    return <span>Creating {siblings.length + 1} policies together, in the order the model proposed (top→bottom): <b>{ordered.join(" → ")}</b>. Drag as usual — the others follow the same placement automatically</span>;
  }, [isGroup, siblings, form.name, selfOrder, placementLocked, createdSiblings]);

  // Deny policies skip Firewall/Network Options + Security Profiles — same rule the
  // fields themselves already enforce (PolicyFieldsNetwork/Security render nothing then).
  const steps = useMemo(
    () => form.action === "deny" ? ALL_STEPS.filter((s) => s.key !== "network" && s.key !== "security") : ALL_STEPS,
    [form.action]
  );
  useEffect(() => { setStep((s) => Math.min(s, steps.length - 1)); }, [steps.length]);

  const isLastStep = step === steps.length - 1;
  const StepComponent = steps[step].Component;

  // relExists → is this related object already on the device (or created this session)?
  //
  // A read-only wizard means this policy has ALREADY been applied — and Apply creates every
  // prerequisite before the policy itself, so all of them are necessarily on the device. Saying so
  // here (rather than relying on the live-existence fetch having landed) is what stops a user from
  // re-opening a sub-wizard on an applied policy and Applying it a second time, which the FortiGate
  // rejects with "error code -5".
  const relExists = (kind: RelKind, name: string): boolean => {
    if (readOnly) return true;
    if (createdRel.has(relKey(kind, name))) return true;
    switch (kind) {
      case "address":    return existingAddr.has(name);
      case "service":    return existingSvc.has(name);
      case "schedule":   return existingSched.has(name);
      case "virtualip":  return existingVIP.has(name);
      case "antivirus":  return existingProf.av.has(name);
      case "webfilter":  return existingProf.web.has(name);
      case "dnsfilter":  return existingProf.dns.has(name);
      case "appcontrol": return existingProf.app.has(name);
      case "filefilter": return existingProf.file.has(name);
    }
  };

  // The related objects THIS policy actually references — each opens a sub-wizard from the "Related
  // Objects" dropdown. The wizard is handed the FULL definition set of the whole suggestion (so it can
  // create anything in any apply order), so the dropdown is narrowed here to only the objects the
  // current policy points at — its own addresses, services, schedule and enabled profiles — otherwise
  // a sibling policy's objects would show up too. Deduped by kind:name.
  const relItems = useMemo(
    () => computeRelItems(form, {
      pendingAddresses, pendingServices, pendingSchedules, pendingVIPs, pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pendingAddresses, pendingServices, pendingSchedules, pendingVIPs, pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF,
     form.srcAddr, form.dstAddr, form.service, form.schedule,
     form.avEnabled, form.avProfile, form.webEnabled, form.webProfile, form.appEnabled, form.appProfile,
     form.dnsEnabled, form.dnsProfile, form.fileEnabled, form.fileProfile]);

  const relCreatedCount = relItems.filter((r) => relExists(r.kind, r.name)).length;

  // The Policy switcher — shown only for a multi-policy suggestion, in the header next to Objects.
  // Switches the whole wizard to another policy of the same suggestion; a green ✓ marks the ones
  // already on the device (they open read-only). This replaces the old chat-side policy dropdown.
  const renderPolicySwitcher = () => {
    if (policyList.length < 2) return null;
    const doneCount = policyList.filter((p) => p.applied).length;
    return (
      <div className="relative shrink-0" ref={polSwRef}>
        <button type="button" onClick={() => setPolSwOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-2 py-1 text-[10px] font-semibold ink-2 surface-hover">
          <FiShield size={11} style={{ color: currentColor }} /> Policy {activePolicyIdx + 1}/{policyList.length}
          <span className="rounded-full px-1 text-[9px] font-bold"
            style={{ background: doneCount === policyList.length ? "#16a34a20" : `${currentColor}18`, color: doneCount === policyList.length ? "#16a34a" : currentColor }}>
            {doneCount}/{policyList.length}
          </span>
          <FiChevronDown size={11} className={`transition-transform ${polSwOpen ? "rotate-180" : ""}`} />
        </button>
        {polSwOpen && (
          <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-[4px] border hairline surface-card shadow-xl">
            {policyList.map((p, idx) => {
              const active = idx === activePolicyIdx;
              // Locked = an earlier policy must be created first. It can't be opened or edited: opening
              // it before its predecessor exists would let the user build it out of order (and the
              // placement / first-match ordering would be wrong).
              const locked = !!p.locked && !active;
              return (
                <button key={idx} type="button" disabled={locked}
                  onClick={() => { if (locked) return; if (!active) onSwitchPolicy?.(idx); setPolSwOpen(false); }}
                  className={`flex w-full items-center gap-2.5 border-b hairline-2 px-3 py-2 text-left last:border-0  ${locked ? "cursor-not-allowed opacity-70" : "surface-hover"}`}
                  style={active ? { background: `${currentColor}10` } : undefined}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white"
                    style={{ background: locked ? "#cbd5e1" : p.action === "deny" ? "#ef4444" : currentColor }}>
                    {locked ? <FiLock size={11} /> : <FiShield size={12} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-wide ink-3">
                      Policy {idx + 1} · {p.action === "deny" ? "DENY" : "ACCEPT"}{active ? " · current" : ""}
                    </span>
                    <span className="block truncate text-[12px] font-semibold ink">{p.name}</span>
                    {locked && (
                      <span className="mt-0.5 block truncate text-[9.5px] font-semibold text-amber-600">
                        Create “{p.lockReason}” first
                      </span>
                    )}
                  </span>
                  {p.applied
                    ? <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-600"><FiCheckCircle size={14} /> Applied</span>
                    : locked
                    ? <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold ink-3"><FiLock size={13} /> Locked</span>
                    : <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold ink-3"><FiChevronRight size={14} /> Open</span>}
                </button>
              );
            })}
            <div className="surface-sunken px-3 py-1.5 text-[9px] ink-3">
              The policies must be created in order, top to bottom — finish the one above before the next unlocks
            </div>
          </div>
        )}
      </div>
    );
  };

  // The Related Objects dropdown — rendered in the wizard HEADER and in every sub-wizard's top bar
  // (so it's reachable from every wizard, not just the policy steps). Green check = already on the
  // device / created this session (opens read-only); otherwise the sub-wizard lets you tune it and
  // the policy Apply auto-creates it.
  const renderRelated = (align: "left" | "right" = "right") => {
    if (relItems.length === 0) return null;
    const allReady = relCreatedCount === relItems.length;
    return (
      <div className="relative shrink-0">
        <button type="button" onClick={() => setRelOpen((o) => !o)}
          className="flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-2 py-1 text-[10px] font-semibold ink-2 surface-hover">
          <FiLayers size={11} style={{ color: currentColor }} /> Objects
          <span className="rounded-full px-1 text-[9px] font-bold"
            style={{ background: allReady ? "#16a34a20" : `${currentColor}18`, color: allReady ? "#16a34a" : currentColor }}>
            {relCreatedCount}/{relItems.length}
          </span>
          <FiChevronDown size={11} className={`transition-transform ${relOpen ? "rotate-180" : ""}`} />
        </button>
        {relOpen && (
          <div className={`absolute ${align === "right" ? "right-0" : "left-0"} z-50 mt-1 w-64 overflow-hidden rounded-[4px] border hairline surface-card shadow-xl`}>
            {relItems.map((it) => {
              const created = relExists(it.kind, it.name);
              const active = subWizard?.kind === it.kind && subWizard?.name === it.name;
              return (
                <button key={`${it.kind}:${it.name}`} type="button"
                  onClick={() => {
                    // A sub-wizard is read-only when its object already exists OR the policy itself
                    // is read-only (applied) — an applied policy's objects must never be re-Applied.
                    setSubWizard({ kind: it.kind, name: it.name, readOnly: readOnly || created });
                    setRelOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 border-b hairline-2 px-3 py-2 text-left last:border-0 surface-hover"
                  style={active ? { background: `${currentColor}10` } : undefined}>
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px]" style={{ background: `${currentColor}12`, color: currentColor }}>
                    {REL_META[it.kind].icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[9px] font-bold uppercase tracking-wide ink-3">{REL_META[it.kind].label}</span>
                    <span className="block truncate text-[12px] font-semibold ink">{it.name}</span>
                  </span>
                  {created ? (
                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-600"><FiCheckCircle size={14} /> Created</span>
                  ) : (
                    <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold ink-3"><FiPlusCircle size={14} /> Will create</span>
                  )}
                </button>
              );
            })}
            <div className="surface-sunken px-3 py-1.5 text-[9px] ink-3">
              {readOnly
                ? "This policy is already applied — every object below is on the device (review only)."
                : "Green = ready (opens read-only). The rest are auto-created when you Apply the policy."}
            </div>
          </div>
        )}
      </div>
    );
  };

  const fieldsProps: PolicyFieldsProps = {
    form, set, errors, interfaces, addresses, services, profiles: augmentedProfiles, loadingProfiles, currentColor,
  };

  const goNext = () => {
    if (step === 0) {
      const errs = validatePolicyForm(form, addresses);
      if (Object.keys(errs).length) { setErrors(errs); return; }
      setErrors({});
    }
    setStep((s) => Math.min(s + 1, steps.length - 1));
  };

  // applyPlacement moves the just-created (or just-edited) policy to where the user dragged the
  // amber row. Reference-based: move it BEFORE `beforeId`, or after the last other policy for
  // "bottom" (null). Best-effort — a move failure never undoes the (successful) create/update.
  const applyPlacement = async () => {
    try {
      const list = await DeviceListPolicies(device.id);
      const self = isEdit && policyId != null
        ? list.find((p) => p.id === policyId)
        : list.find((p) => p.name === form.name);
      if (!self) return;
      if (beforeId != null) {
        if (beforeId !== self.id) await DeviceMovePolicy(device.id, self.id, "before", beforeId);
        return;
      }
      // Bottom: a freshly-created policy already sits there; an edited one may need moving down.
      const others = list.filter((p) => p.id !== self.id);
      const last = list[list.length - 1];
      if (others.length && last && last.id !== self.id) {
        await DeviceMovePolicy(device.id, self.id, "after", others[others.length - 1].id);
      }
    } catch { /* leave in place on any error */ }
  };

  // Everything the prerequisite builders in policyPrereqs.ts need, assembled in one place.
  const prereqCtx = (): PrereqCtx => ({
    deviceId: device.id,
    form,
    profiles: {
      address_groups: profiles.address_groups,
      service_groups: profiles.service_groups,
      ips_sensors: profiles.ips_sensors,
    },
    pendingAddresses, pendingServices, pendingSchedules, pendingVIPs, pendingProfiles,
    pendingAV, pendingWeb, pendingDNS, pendingApp, pendingFF,
    createdRel,
    markRelCreated,
    onObjectCreated,
  });


  // buildApplyImpact — what the confirmation dialog says, assembled at click time.
  //
  // The Policy Wizard can say two things the chat's own dialog cannot, and both are the difference
  // between a rule that works and one that quietly does not:
  //
  //   · WHICH PREREQUISITES IT IS ABOUT TO CREATE. Apply builds every referenced-but-missing
  //     address / service / schedule / profile BEFORE the policy, and those objects stay on the
  //     device even if the policy itself then fails. relExists() is the same check Apply's
  //     ensureReferenced* functions make, so the list is exactly what will be built.
  //   · WHERE THE RULE LANDS. The placement board's `beforeId` is a live policy id, so the dialog
  //     can name the rule this one will sit above instead of the chat's generic "goes to the bottom".
  const buildApplyImpact = () => policyApplyImpact({
    form,
    isEdit,
    prerequisites: relItems
      .filter((r) => !relExists(r.kind, r.name))
      .map((r) => ({
        kind: REL_TO_UNDO[r.kind] ?? "address",
        label: REL_META[r.kind].label,
        name: r.name,
      })),
    placement: {
      beforeName: beforeId != null ? (policies.find((p) => p.id === beforeId)?.name ?? null) : null,
      locked: placementLocked,
    },
  });

  const handleApply = async () => {
    const errs = validatePolicyForm(form, addresses);
    if (Object.keys(errs).length) {
      setErrors(errs);
      setStep(0);
      message.error(errs.srcAddr || errs.dstAddr || "Please fix the highlighted fields in First Setup");
      return;
    }
    if (!isAdmin) { message.warning("Only admins can apply config changes"); return; }
    setErrors({});
    try {
      setSaving(true);
      const payload = buildPolicyPayload(form);
      // Create every referenced-but-missing prerequisite object FIRST — for BOTH edit and create.
      // An EDIT can newly reference a schedule/address/service/VIP/profile that doesn't exist yet
      // (e.g. the AI proposes a new "Block-YouTube-09-12" schedule AND edits the policy to use it);
      // without this, DeviceUpdatePolicy fails with FortiGate -3 "entry not found in datasource".
      // Refresh live existence FIRST so a re-Apply (or objects created earlier this session) skips
      // cleanly instead of hitting a duplicate — then create addresses → services → schedule →
      // security profiles. Each one is reported to the chat via onObjectCreated the moment it lands
      // on the device. This is idempotent: every ensureReferenced* checks live existence and treats
      // a duplicate (-5) as "already there", so a plain edit over pre-existing objects creates nothing.
      const fresh = await refreshExistence();
      // VIPs before addresses — a VIP name in dstaddr must be created as a VIP, and the address
      // step skips those names once they exist.
      for (const name of await ensureReferencedVIPs(prereqCtx())) {
        onObjectCreated?.({ kind: "virtualip", label: "Virtual IP", name });
      }
      for (const name of await ensureReferencedAddresses(prereqCtx())) {
        onObjectCreated?.({ kind: "address", label: "Address", name });
      }
      for (const name of await ensureReferencedServices(prereqCtx())) {
        onObjectCreated?.({ kind: "service", label: "Service", name });
      }
      for (const name of await ensureReferencedSchedule(prereqCtx())) {
        onObjectCreated?.({ kind: "schedule", label: "Schedule", name });
      }
      await ensureReferencedProfiles(prereqCtx(), fresh); // reports its own objects as it creates them
      if (isEdit && policyId != null) {
        await DeviceUpdatePolicy(device.id, policyId, payload);
        await applyPlacement();   // move the edited policy if the user dragged it (best-effort)
      } else {
        await DeviceCreatePolicy(device.id, payload);
        await applyPlacement();   // move the new policy to the chosen Index (best-effort)
      }
      message.success(isEdit ? "Update Policy Success" : "Create Policy Success");
      onApplied(form.name, isEdit);
    } catch (err) {
      // Surface the ACTUAL reason — a FortiGate error, or a prerequisite that couldn't be built
      // (e.g. a referenced object with no definition). Falling straight to the generic string is
      // what turned a real failure into a mystery "Failed to create policy" before.
      message.error(apiErrorText(err, `Failed to ${isEdit ? "update" : "create"} policy`), 6);
    } finally {
      setSaving(false);
    }
  };

  // ── Related-object sub-wizard takes over the panel (opened from the dropdown). Its Cancel/Close
  // returns to the Policy Wizard; on Apply we mark it created so the dropdown shows a green check
  // and the final policy Apply skips re-creating it. ──
  if (subWizard) {
    const back = () => setSubWizard(null);
    // A sub-wizard's Apply may rename the object (its own form's name wins), so take the name the
    // wizard reports back, not the one we opened it with — otherwise the chat would announce the
    // old name and the policy's later skip-check would look for the wrong object.
    const done = (appliedName?: string) => {
      const name = appliedName || subWizard.name;
      markRelCreated(subWizard.kind, name);
      onObjectCreated?.({ kind: subWizard.kind, label: REL_META[subWizard.kind].label, name });
      setSubWizard(null);
    };
    const nm = subWizard.name;
    const common = { device, hostname, isAdmin, target: nm, readOnly: subWizard.readOnly, currentColor, onCancel: back };
    let inner: React.ReactNode = null;
    if (subWizard.kind === "address") {
      const d = pendingAddresses.find((p) => (p.form.name ?? p.target) === nm);
      inner = <AddressWizard {...common} draft={d?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "service") {
      const d = pendingServices.find((p) => (p.form.name ?? p.target) === nm);
      inner = <ServiceWizard {...common} draft={d?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "schedule") {
      const d = pendingSchedules.find((p) => (p.form.name ?? p.target) === nm);
      inner = <ScheduleWizard {...common} draft={d?.form ?? { name: nm, type: "recurring" }} onApplied={done} />;
    } else if (subWizard.kind === "antivirus") {
      inner = <AntivirusWizard {...common} draft={pendingAV?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "webfilter") {
      inner = <WebFilterWizard {...common} draft={pendingWeb?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "dnsfilter") {
      inner = <DNSFilterWizard {...common} draft={pendingDNS?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "virtualip") {
      const d = pendingVIPs.find((p) => (p.form.name ?? p.target) === nm);
      inner = <VirtualIPWizard {...common} draft={d?.form ?? { name: nm }} onApplied={done} />;
    } else if (subWizard.kind === "filefilter") {
      inner = <FileFilterWizard {...common} draft={pendingFF?.form ?? { name: nm }} onApplied={done} />;
    } else {
      inner = <AppControlWizard {...common} parsed={pendingApp ?? null} onApplied={done} />;
    }
    return (
      <div className="flex h-full flex-col">
        {/* Top bar in EVERY sub-wizard: back to policy + the same Related Objects selector. */}
        <div className="flex items-center justify-between gap-2 border-b hairline-2 px-4 py-2 shrink-0">
          <button type="button" onClick={back}
            className="flex min-w-0 items-center gap-1.5 text-[11px] font-semibold ink-2 hover-ink">
            <FiChevronLeft size={13} /> Back to Policy Wizard
            <span className="ml-1 truncate ink-3">· {REL_META[subWizard.kind].label} “{nm}”{subWizard.readOnly ? " (read-only)" : ""}</span>
          </button>
          <div className="flex items-center gap-1.5">
            {renderPolicySwitcher()}
            {renderRelated("right")}
          </div>
        </div>
        <div className="min-h-0 flex-1">{inner}</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b hairline-2 px-4 py-2.5 shrink-0">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
          <FiShield size={12} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-semibold ink">
            AI Policy Wizard
            {!checking && (
              // An applied policy is neither a create nor an edit any more — saying "CREATE NEW"
              // there invites a second Apply, which is exactly what read-only mode exists to prevent.
              <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold"
                style={readOnly
                  ? { background: "#16a34a20", color: "#16a34a" }
                  : { background: isEdit ? "#f59e0b20" : `${currentColor}20`, color: isEdit ? "#b45309" : currentColor }}>
                {readOnly ? "APPLIED" : isEdit ? "EDIT EXISTING" : "CREATE NEW"}
              </span>
            )}
          </p>
          <p className="flex items-center gap-1 truncate text-[10px] ink-3">
            <FiHardDrive size={9} /> {hostname || device.name}
          </p>
        </div>
        {/* Policy switcher (2+ policies) + Related Objects selector — in the header. */}
        {renderPolicySwitcher()}
        {renderRelated("right")}
        <button type="button" onClick={onCancel}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink transition">
          <FiX size={13} />
        </button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1 px-4 py-2.5 border-b hairline-2 shrink-0 overflow-x-auto">
        {steps.map((s, i) => (
          <React.Fragment key={s.key}>
            {i > 0 && <div className="h-px w-3 shrink-0" style={{ background: i <= step ? currentColor : "#e2e8f0" }} />}
            <button type="button" onClick={() => i < step && setStep(i)} disabled={i > step}
              className="flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-semibold transition disabled:cursor-default"
              style={{
                background: i === step ? currentColor : i < step ? `${currentColor}15` : "transparent",
                color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
              }}>
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold"
                style={{
                  background: i === step ? "rgba(255,255,255,.25)" : i < step ? `${currentColor}22` : "#e2e8f0",
                  color: i === step ? "white" : i < step ? currentColor : "#94a3b8",
                }}>
                {i + 1}
              </span>
              {i === step && <span className="pr-0.5">{s.label}</span>}
            </button>
          </React.Fragment>
        ))}
      </div>


      {/* Step content */}
      <div className="flex-1 overflow-y-auto">
        {readOnly && (
          <div className="flex items-center gap-2 border-b border-emerald-100 bg-emerald-50 px-4 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-400">
            <FiCheck size={12} /> Already applied — review only (read-only)
          </div>
        )}
        {checking
          ? <div className="flex items-center gap-2 px-6 py-8 text-[12px] ink-3">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
              Checking device for an existing policy…
            </div>
          : <div style={readOnly ? { pointerEvents: "none", opacity: 0.7 } : undefined}>
              {steps[step].key === "placement"
                ? <PolicyPlacementBoard
                    policies={policies} selfId={isEdit ? policyId : null} form={form}
                    beforeId={beforeId} onChange={handlePlacementChange}
                    currentColor={currentColor} isEdit={isEdit} loading={checking}
                    disabled={placementLocked} siblingNote={placementNote} />
                : StepComponent && <StepComponent {...fieldsProps} />}
            </div>}
      </div>

      {/* Footer nav */}
      <div className="flex items-center justify-between gap-2 border-t hairline-2 px-4 py-3 shrink-0">
        <button type="button" onClick={() => step === 0 ? onCancel() : setStep((s) => s - 1)}
          className="flex items-center gap-1.5 rounded-[4px] border hairline px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
          <FiChevronLeft size={13} /> {step === 0 ? (readOnly ? "Close" : "Cancel") : "Back"}
        </button>

        <span className="text-[10px] ink-3">Step {step + 1} of {steps.length}</span>

        {isLastStep ? (
          readOnly ? (
            <button type="button" disabled
              className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white cursor-default"
              style={{ background: "#16a34a" }}>
              <FiCheck size={13} /> Applied
            </button>
          ) : (
            <WizardApplyButton
              isEdit={isEdit} saving={saving} disabled={!isAdmin || checking}
              title={!isAdmin ? "Only admins can apply config changes" : ""}
              deviceName={hostname || device.name}
              onApply={handleApply}
              buildImpact={buildApplyImpact}
            />
          )
        ) : (
          <button type="button" onClick={goNext} disabled={checking}
            className="flex items-center gap-1.5 rounded-[4px] px-4 py-1.5 text-[12px] font-semibold text-white transition disabled:opacity-50"
            style={{ background: currentColor }}>
            Next <FiChevronRight size={13} />
          </button>
        )}
      </div>
    </div>
  );
};

export default PolicyWizard;
