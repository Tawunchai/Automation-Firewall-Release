import React from "react";
import { FiAlertTriangle } from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import type { ChatItem, ActiveWizard } from "./chat-model";
import { isRestorableKind } from "./chat-model";
import type { AppliedObject, RestoreSnapshot } from "./applyViaREST";
import { WIZ_BTN_TO_UNDO, REL_TO_UNDO, REL_TO_BTN } from "./undoKinds";
import { anchorKey, pairOf } from "./placement";
import { policyOrderLocks } from "./parsePolicyCLI";
import type { PolicyFormState } from "../firewall-policy/create.logic";
import type { ParsedAddress } from "./parseAddressCLI";
import type { ParsedService } from "./parseServiceCLI";
import type { ParsedSchedule } from "./parseScheduleCLI";
import type { ParsedVIP } from "./parseVirtualIPCLI";
import type { ParsedAV } from "./parseAntivirusCLI";
import type { ParsedWebFilter } from "./parseWebFilterCLI";
import type { ParsedDNSFilter } from "./parseDNSFilterCLI";
import type { ParsedAppControl } from "./parseAppControlCLI";
import type { ParsedFileFilter } from "./parseFileFilterCLI";
import type { PrereqBlock } from "./parsePrereqCLI";

import PolicyWizard from "./PolicyWizard";
import AntivirusWizard from "./AntivirusWizard";
import WebFilterWizard from "./WebFilterWizard";
import DNSFilterWizard from "./DNSFilterWizard";
import VirtualIPWizard from "./VirtualIPWizard";
import AppControlWizard from "./AppControlWizard";
import FileFilterWizard from "./FileFilterWizard";
import RouteWizard from "./RouteWizard";
import VPNWizard from "./VPNWizard";
import MultiObjectWizard from "./MultiObjectWizard";
import SDWANWizard from "./SDWANWizard";

// What scopeForPolicy (in index.tsx) produces for ONE policy of a suggestion — the draft plus the
// FULL pending-definition set, spread straight into PolicyWizard. Kept here next to the only
// component that consumes it so the two cannot drift.
export type PolicyScope = {
  draft: Partial<PolicyFormState>;
  target?: string;
  selfOrder: number;
  pendingAddresses: ParsedAddress[];
  pendingServices: ParsedService[];
  pendingSchedules: ParsedSchedule[];
  pendingProfiles: PrereqBlock[];
  pendingAV?: ParsedAV;
  pendingWeb?: ParsedWebFilter;
  pendingDNS?: ParsedDNSFilter;
  pendingVIPs: ParsedVIP[];
  pendingApp?: ParsedAppControl;
  pendingFF?: ParsedFileFilter;
  siblings: { name: string; order: number }[];
};

// The right-hand panel's wizard half.
//
// Lifted out of index.tsx verbatim: it was ~290 lines of a single component that the layout budget
// flags as needing a split, and extracting it is also where the AI Assistant's one crash risk gets
// contained — index.tsx wraps this in <PanelBoundary>, and the policy branch here guards the stale
// selection that used to white-screen the whole page (a chat item cleared out from under an open
// wizard). All the data decisions stay in index.tsx and arrive as props; this only renders.
type Props = {
  device: NetworkDevice;
  isAdmin: boolean;
  currentColor: string;
  activeWizard: ActiveWizard;
  items: ChatItem[];
  groupAnchors: Map<string, number | null>;
  setGroupAnchors: React.Dispatch<React.SetStateAction<Map<string, number | null>>>;
  appliedPolNames: (i: number) => Set<string>;
  scopeForPolicy: (it: ChatItem, k: number) => PolicyScope;
  setActiveWizard: (w: ActiveWizard | null) => void;
  markWizardApplied: (i: number, kind: string) => void;
  pushSuccess: (text: string) => void;
  recordCreated: (i: number | undefined, objs: AppliedObject[]) => void;
  recordEdited: (i: number | undefined, kind: RestoreSnapshot["kind"], label: string, name: string, before: unknown) => void;
};

const WizardPanel: React.FC<Props> = ({
  device, isAdmin, currentColor, activeWizard, items, groupAnchors, setGroupAnchors,
  appliedPolNames, scopeForPolicy, setActiveWizard, markWizardApplied, pushSuccess,
  recordCreated, recordEdited,
}) => {
  const selectedDevice = device; // keep the extracted JSX byte-for-byte below

  return activeWizard.kind === "antivirus" ? (
    <AntivirusWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(profileName, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "antivirus");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} AntiVirus "${profileName}" Success`);
        // An UPDATE is not ours to undo — only a profile we created goes in the undo list.
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "antivirus", label: "AntiVirus", name: profileName }]);
        else recordEdited(activeWizard.itemIndex, "antivirus", "AntiVirus", profileName, before);
      }}
    />
  ) : activeWizard.kind === "webfilter" ? (
    <WebFilterWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(profileName, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "webfilter");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} Web Filter "${profileName}" Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "webfilter", label: "Web Filter", name: profileName }]);
        else recordEdited(activeWizard.itemIndex, "webfilter", "Web Filter", profileName, before);
      }}
    />
  ) : activeWizard.kind === "dnsfilter" ? (
    <DNSFilterWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(profileName, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "dnsfilter");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} DNS Filter "${profileName}" Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "dnsfilter", label: "DNS Filter", name: profileName }]);
        else recordEdited(activeWizard.itemIndex, "dnsfilter", "DNS Filter", profileName, before);
      }}
    />
  ) : activeWizard.kind === "virtualip" ? (
    <VirtualIPWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(name, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "virtualip");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} Virtual IP "${name}" Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "virtual-ip", label: "Virtual IP", name }]);
        else recordEdited(activeWizard.itemIndex, "virtual-ip", "Virtual IP", name, before);
      }}
    />
  ) : activeWizard.kind === "appcontrol" ? (
    <AppControlWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      parsed={activeWizard.parsed}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(profileName, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "appcontrol");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} Application Control "${profileName}" Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "application-control", label: "Application Control", name: profileName }]);
        else recordEdited(activeWizard.itemIndex, "application-control", "Application Control", profileName, before);
      }}
    />
  ) : activeWizard.kind === "filefilter" ? (
    <FileFilterWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(profileName, wasEdit, before) => {
        markWizardApplied(activeWizard.itemIndex, "filefilter");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} File Filter "${profileName}" Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "file-filter", label: "File Filter", name: profileName }]);
        else recordEdited(activeWizard.itemIndex, "file-filter", "File Filter", profileName, before);
      }}
    />
  ) : activeWizard.kind === "address" || activeWizard.kind === "service"
       || activeWizard.kind === "schedule" || activeWizard.kind === "userdef"
       || activeWizard.kind === "usergroup" || activeWizard.kind === "ldapserver"
       || activeWizard.kind === "radiusserver" ? (
    // Every kind a suggestion can define MORE THAN ONE of goes through MultiObjectWizard,
    // which pages through the drafts behind a single chat button. Users, groups and the two
    // auth servers were single-draft until now, so their "(4)" badge was a promise the UI
    // never kept: only the first object was reachable and the rest needed Apply. With one
    // draft the wrapper renders the plain wizard, so nothing changes for the common case.
    <MultiObjectWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      currentColor={currentColor}
      readOnly={activeWizard.readOnly}
      spec={
        activeWizard.kind === "address"      ? { kind: "address",      drafts: activeWizard.drafts } :
        activeWizard.kind === "service"      ? { kind: "service",      drafts: activeWizard.drafts } :
        activeWizard.kind === "schedule"     ? { kind: "schedule",     drafts: activeWizard.drafts } :
        activeWizard.kind === "userdef"      ? { kind: "userdef",      drafts: activeWizard.drafts } :
        activeWizard.kind === "usergroup"    ? { kind: "usergroup",    drafts: activeWizard.drafts } :
        activeWizard.kind === "ldapserver"   ? { kind: "ldapserver",   drafts: activeWizard.drafts } :
                                               { kind: "radiusserver", drafts: activeWizard.drafts }
      }
      onObjectCreated={(label, name) => {
        pushSuccess(`Create ${label} "${name}" Success`);
        recordCreated(activeWizard.itemIndex,
          [{ kind: WIZ_BTN_TO_UNDO[activeWizard.kind], label, name }]);
      }}
      // An object that already existed was UPDATED — Fallback restores it instead of
      // deleting something the user did not create. Only the kinds with a restore path
      // are recorded; the rest stay un-undoable rather than promising a rollback.
      onObjectEdited={(label, name, before) => {
        pushSuccess(`Update ${label} "${name}" Success`);
        const kind = WIZ_BTN_TO_UNDO[activeWizard.kind];
        if (isRestorableKind(kind)) recordEdited(activeWizard.itemIndex, kind, label, name, before);
      }}
      // LDAP only: the connector lands on the device the moment its sub-panel saves —
      // before the LDAP server itself — so it is recorded straight away, not at Apply time.
      onExchangeCreated={(name) => {
        pushSuccess(`Create Exchange Connector "${name}" Success`);
        recordCreated(activeWizard.itemIndex,
          [{ kind: "exchange-connector", label: "Exchange Connector", name }]);
      }}
      // Only lock the chat button once EVERY object of this kind is on the device.
      onAllCreated={() => markWizardApplied(activeWizard.itemIndex, activeWizard.kind)}
      onCancel={() => setActiveWizard(null)}
    />
  ) : activeWizard.kind === "sdwan" ? (
    <SDWANWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      parsed={activeWizard.parsed}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      // SD-WAN builds four different kinds of object, so it reports what actually landed
      // instead of being looked up in WIZ_BTN_TO_UNDO (see COMPOSITE_WIZARDS in
      // undoKinds.ts). Each entry carries the numeric mkey the firewall assigned, which is
      // what Fallback deletes by.
      onApplied={(created) => {
        markWizardApplied(activeWizard.itemIndex, "sdwan");
        setActiveWizard(null);
        for (const o of created) pushSuccess(`Create ${o.label} "${o.name}" Success`);
        if (created.length) recordCreated(activeWizard.itemIndex, created);
      }}
    />
  ) : activeWizard.kind === "route" ? (
    <RouteWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      target={activeWizard.target}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(label, wasEdit) => {
        markWizardApplied(activeWizard.itemIndex, "route");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} Static Route ${label} Success`);
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "static-route", label: "Static Route", name: label }]);
      }}
    />
  ) : activeWizard.kind === "vpn" ? (
    <VPNWizard
      device={selectedDevice}
      hostname={selectedDevice.name}
      isAdmin={isAdmin}
      draft={activeWizard.draft}
      vpnKind={activeWizard.vpnKind}
      readOnly={activeWizard.readOnly}
      currentColor={currentColor}
      onCancel={() => setActiveWizard(null)}
      onApplied={(name, wasEdit) => {
        markWizardApplied(activeWizard.itemIndex, "vpn");
        setActiveWizard(null);
        pushSuccess(`${wasEdit ? "Update" : "Create"} VPN "${name}" Success`);
        // The whole tunnel records as one "ipsec-tunnel" object (see undoKinds.ts); Fallback
        // removes it and everything it created via the cascade delete. An update is not ours to undo.
        if (!wasEdit) recordCreated(activeWizard.itemIndex,
          [{ kind: "ipsec-tunnel", label: "IPsec Tunnel", name }]);
      }}
    />
  ) : (() => {
    // Derive everything for the ACTIVE policy from live state so switching policies via the
    // dropdown and creating siblings stays in sync: scoped prerequisites, the shared placement
    // anchor for its interface pair, which siblings are already on the device, and whether this
    // one is already applied (→ read-only).
    const it = items[activeWizard.itemIndex];
    // Guard the stale selection that used to white-screen the page: a chat item (or its policy
    // draft) can be gone by the time this renders — Clear, a device switch, a session reload all
    // rebuild `items`. scopeForPolicy would then dereference undefined. Show a way out instead.
    const draftsArr = it?.policyDrafts ?? [];
    if (!it || !draftsArr[activeWizard.policyIdx]) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center ink-3">
          <FiAlertTriangle size={20} className="opacity-40" />
          <p className="text-[12px] ink-2">This proposal is no longer available.</p>
          <p className="text-[11px]">Close this panel and ask again.</p>
          <button type="button" onClick={() => setActiveWizard(null)}
            className="mt-1 rounded-[5px] border hairline px-3 py-1 text-[11px] font-semibold ink-2 surface-hover">
            Close
          </button>
        </div>
      );
    }
    const scope = scopeForPolicy(it, activeWizard.policyIdx);
    const selfName = scope.draft.name ?? scope.target ?? "";
    const appliedNames = appliedPolNames(activeWizard.itemIndex);
    const key = anchorKey(activeWizard.itemIndex, pairOf(scope.draft));
    // All policies of this suggestion — for the wizard's "Policy n/m" switcher (next to
    // Objects). Policies must be created in the AI's written order (specific first → it ends
    // up above the broad one), so a policy is LOCKED until every policy before it is applied;
    // `lockReason` names the one that must be created first.
    const drafts = it.policyDrafts ?? [];
    const polNames = drafts.map((d) => d.form.name ?? d.target);
    const locks = policyOrderLocks(polNames, appliedNames);
    const policyList = drafts.map((d, idx) => ({
      name: polNames[idx],
      action: (d.form.action ?? "accept") as "accept" | "deny",
      ...locks[idx],
    }));
    return (
      <PolicyWizard
        // Remount when the active policy changes so the form (and all wizard state) resets to
        // THAT policy's draft — a switch keeps the same component instance otherwise, so the
        // previous policy's field values would linger (the "shows the wrong policy" bug).
        key={`pw-${activeWizard.itemIndex}-${activeWizard.policyIdx}`}
        device={selectedDevice}
        hostname={selectedDevice.name}
        isAdmin={isAdmin}
        // Everything scopeForPolicy produced — draft, target, every pending* definition
        // set, selfOrder and siblings — forwarded in ONE spread rather than listed prop by
        // prop. That is deliberate: each pending* prop is OPTIONAL, so forgetting one is
        // invisible to TypeScript and merely makes an object vanish from the Objects
        // dropdown (pendingDNS was dropped exactly that way). With the spread, a new kind
        // added to scopeForPolicy reaches the wizard automatically.
        {...scope}
        policyList={policyList}
        activePolicyIdx={activeWizard.policyIdx}
        onSwitchPolicy={(idx) => setActiveWizard({ kind: "policy", itemIndex: activeWizard.itemIndex, policyIdx: idx })}
        readOnly={appliedNames.has(selfName)}
        currentColor={currentColor}
        appliedSiblingNames={appliedNames}
        groupBeforeId={groupAnchors.get(key)}
        onGroupBeforeIdChange={(id) => setGroupAnchors((m) => new Map(m).set(key, id))}
        onCancel={() => setActiveWizard(null)}
        // Every prerequisite the wizard creates — whether the user built it in a sub-wizard
        // or Apply auto-created it — gets its own ✓ line, and lights up that wizard's button.
        onObjectCreated={({ kind, label, name }) => {
          markWizardApplied(activeWizard.itemIndex, REL_TO_BTN[kind] ?? kind);
          pushSuccess(`Create ${label} "${name}" Success`);
          // Prerequisites the wizard created for this policy — Fallback removes them too,
          // after the policy that references them. A null kind is not undoable (see the map).
          const undoKind = REL_TO_UNDO[kind];
          if (undoKind) recordCreated(activeWizard.itemIndex, [{ kind: undoKind, label, name }]);
        }}
        onApplied={(policyName, wasEdit) => {
          markWizardApplied(activeWizard.itemIndex, "policy");
          setActiveWizard(null);
          pushSuccess(`${wasEdit ? "Update" : "Create"} Policy "${policyName}" Success`);
          // Record by name so the dropdown ✓, the next sibling's placement lock, and the
          // Apply-ALL "all done" check all pick it up. An UPDATE is not ours to undo.
          if (!wasEdit) recordCreated(activeWizard.itemIndex,
            [{ kind: "policy", label: "Policy", name: policyName }]);
        }}
      />
    );
  })();
};

export default WizardPanel;
