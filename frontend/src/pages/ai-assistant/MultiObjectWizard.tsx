import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FiLayers, FiChevronDown, FiCheckCircle, FiPlusCircle, FiX,
  FiMapPin, FiZap, FiClock, FiUser, FiUsers, FiKey, FiServer,
} from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";
import {
  DeviceListAddresses, DeviceListServices, DeviceListSchedules,
  DeviceListUsers, DeviceListUserGroups, DeviceListLDAPServers, DeviceListRADIUSServers,
  type ScheduleForm,
} from "../../api/policyObject";
import type { AddressFormState } from "../fw-addresses/address-form.logic";
import type { ServiceFormState } from "../fw-services/service-form.logic";
import type { ParsedAddress } from "./parseAddressCLI";
import type { ParsedService } from "./parseServiceCLI";
import type { ParsedSchedule } from "./parseScheduleCLI";
import type { ParsedLocalUser } from "./parseUserDefinitionCLI";
import type { ParsedUserGroup } from "./parseUserGroupCLI";
import type { ParsedLDAPServer } from "./parseLDAPServerCLI";
import type { ParsedRADIUSServer } from "./parseRADIUSServerCLI";
import AddressWizard from "./AddressWizard";
import ServiceWizard from "./ServiceWizard";
import ScheduleWizard from "./ScheduleWizard";
import UserDefinitionWizard from "./UserDefinitionWizard";
import UserGroupWizard from "./UserGroupWizard";
import LDAPServerWizard from "./LDAPServerWizard";
import RADIUSServerWizard from "./RADIUSServerWizard";

// MultiObjectWizard — one wizard button for N objects of the same kind.
//
// "create 10 address objects" used to put ten identical wizard buttons in the chat, one per object.
// This wraps the existing single-object wizards in an object picker instead — the same "Objects n/m"
// dropdown the Policy Wizard uses for its related objects — so the chat shows ONE button, and the
// panel lets you step through every object it will create. The list scrolls once it outgrows the
// panel, so ten (or fifty) objects behave the same as one.
//
// The per-object wizards are untouched: this only chooses which one is mounted and tracks what has
// been created. When an object is applied it is marked ✓ and the picker advances to the next one
// still outstanding, so the natural flow is Apply → Apply → Apply until the badge reads n/n.

export type MultiKind =
  | "address" | "service" | "schedule"
  | "userdef" | "usergroup" | "ldapserver" | "radiusserver";

const KIND_META: Record<MultiKind, { label: string; plural: string; icon: React.ReactNode }> = {
  address:      { label: "Address",       plural: "Addresses",      icon: <FiMapPin size={12} /> },
  service:      { label: "Service",       plural: "Services",       icon: <FiZap size={12} /> },
  schedule:     { label: "Schedule",      plural: "Schedules",      icon: <FiClock size={12} /> },
  userdef:      { label: "User",          plural: "Users",          icon: <FiUser size={12} /> },
  usergroup:    { label: "User Group",    plural: "User Groups",    icon: <FiUsers size={12} /> },
  ldapserver:   { label: "LDAP Server",   plural: "LDAP Servers",   icon: <FiServer size={12} /> },
  radiusserver: { label: "RADIUS Server", plural: "RADIUS Servers", icon: <FiKey size={12} /> },
};

// The drafts this wrapper can page through — one array type per kind.
export type MultiDrafts =
  | { kind: "address";      drafts: ParsedAddress[] }
  | { kind: "service";      drafts: ParsedService[] }
  | { kind: "schedule";     drafts: ParsedSchedule[] }
  | { kind: "userdef";      drafts: ParsedLocalUser[] }
  | { kind: "usergroup";    drafts: ParsedUserGroup[] }
  | { kind: "ldapserver";   drafts: ParsedLDAPServer[] }
  | { kind: "radiusserver"; drafts: ParsedRADIUSServer[] };

// Every parsed draft has the same shape — a form plus the object's current name on the device.
type AnyDraft = MultiDrafts["drafts"][number];

// The name an entry will end up with on the device (a draft may rename: form.name wins over target).
const draftName = (d: AnyDraft): string =>
  ((d.form as { name?: string }).name ?? d.target ?? "").trim();

const MultiObjectWizard: React.FC<{
  device: NetworkDevice;
  hostname: string;
  isAdmin: boolean;
  currentColor: string;
  readOnly?: boolean;
  spec: MultiDrafts;
  // Fires once per object that actually lands on the device, so the chat can print its own ✓ line.
  onObjectCreated?: (label: string, name: string) => void;
  // Fires when an object that ALREADY existed was updated instead. `before` is how it looked first,
  // so Fallback can write it back rather than deleting something the user did not create.
  onObjectEdited?: (label: string, name: string, before: unknown) => void;
  // LDAP only: the "+ Create" button inside its Exchange server picker creates a SEPARATE device
  // object mid-wizard, which the chat has to record or Fallback would leave it behind.
  onExchangeCreated?: (name: string) => void;
  // Fires when EVERY object of this kind is on the device — only then does the chat's wizard button
  // turn green. With ten addresses, creating one of them must not lock the other nine out.
  onAllCreated?: () => void;
  onCancel: () => void;
}> = ({ device, hostname, isAdmin, currentColor, readOnly = false, spec, onObjectCreated, onObjectEdited, onExchangeCreated, onAllCreated, onCancel }) => {
  const meta = KIND_META[spec.kind];
  const drafts = spec.drafts as AnyDraft[];

  const [index, setIndex] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Names already on the device (fetched once) plus the ones created in this panel.
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [created, setCreated] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let names: string[] = [];
      try {
        // One list call per kind, so an object already on the device opens read-only instead of
        // hitting FortiGate's duplicate-name error (-5) on Apply.
        const listers: Record<MultiKind, () => Promise<{ name: string }[]>> = {
          address:      () => DeviceListAddresses(device.id),
          service:      () => DeviceListServices(device.id),
          schedule:     () => DeviceListSchedules(device.id),
          userdef:      () => DeviceListUsers(device.id),
          usergroup:    () => DeviceListUserGroups(device.id),
          ldapserver:   () => DeviceListLDAPServers(device.id),
          radiusserver: () => DeviceListRADIUSServers(device.id),
        };
        names = (await listers[spec.kind]()).map((o) => o.name);
      } catch { /* treat as "nothing exists yet" */ }
      if (!cancelled) { setExisting(new Set(names)); setLoading(false); }
    };
    void load();
    return () => { cancelled = true; };
  }, [device.id, spec.kind]);

  // An object is "done" when it is already on the device or we just created it. A read-only panel
  // means the whole suggestion was applied, so everything in it is on the device by definition.
  const isDone = useCallback(
    (name: string) => readOnly || created.has(name) || existing.has(name),
    [readOnly, created, existing]
  );

  const doneCount = useMemo(
    () => drafts.filter((d) => isDone(draftName(d))).length,
    [drafts, isDone]
  );
  const allDone = doneCount === drafts.length;

  // Report "all done" upward exactly once — the chat button only locks when nothing is left.
  //
  // The latch is a ref, not state: nothing renders from it, so storing it in state only bought an
  // extra render pass and a synchronous setState inside the effect. A ref says what this is — a
  // note to the effect itself that it has already fired.
  const reportedAll = useRef(false);
  useEffect(() => {
    if (!loading && allDone && !reportedAll.current) {
      reportedAll.current = true;
      onAllCreated?.();
    }
  }, [loading, allDone, onAllCreated]);

  const active = drafts[index];
  const activeName = active ? draftName(active) : "";
  // An object that already exists opens read-only — re-applying it would hit FortiGate's
  // duplicate-name error (-5).
  const activeReadOnly = readOnly || isDone(activeName);

  // After an Apply: mark it ✓ and jump to the next object still outstanding (wrapping around), so
  // the user just keeps pressing Apply until the badge reads n/n.
  //
  // wasEdit means the wizard UPDATED an object that was already on the device. It is still ✓ done,
  // but it is NOT ours — deleting it would destroy config the user already had, so it is reported
  // through onObjectEdited with its pre-edit snapshot instead.
  const handleApplied = (appliedName: string, wasEdit?: boolean, before?: unknown) => {
    const name = appliedName || activeName;
    setCreated((s) => new Set(s).add(name));
    if (!wasEdit) onObjectCreated?.(meta.label, name);
    else if (before) onObjectEdited?.(meta.label, name, before);

    const nextIdx = drafts.findIndex((d, i) => {
      if (i === index) return false;
      const n = draftName(d);
      return !(created.has(n) || existing.has(n) || n === name);
    });
    if (nextIdx >= 0) setIndex(nextIdx);
  };

  const common = {
    device, hostname, isAdmin, currentColor,
    target: active?.target,
    readOnly: activeReadOnly,
    onCancel,
  };

  // `key` is the object name so switching entries REMOUNTS the wizard — each one re-runs its own
  // "does this already exist?" check and starts from its own draft rather than inheriting state.
  let inner: React.ReactNode = null;
  if (active) {
    switch (spec.kind) {
      case "address":
        inner = <AddressWizard key={activeName} {...common}
          draft={(active as ParsedAddress).form as Partial<AddressFormState>} onApplied={handleApplied} />;
        break;
      case "service":
        inner = <ServiceWizard key={activeName} {...common}
          draft={(active as ParsedService).form as Partial<ServiceFormState>} onApplied={handleApplied} />;
        break;
      case "schedule":
        inner = <ScheduleWizard key={activeName} {...common}
          draft={(active as ParsedSchedule).form as ScheduleForm} onApplied={handleApplied} />;
        break;
      case "userdef":
        inner = <UserDefinitionWizard key={activeName} {...common}
          draft={(active as ParsedLocalUser).form} onApplied={handleApplied} />;
        break;
      case "usergroup":
        inner = <UserGroupWizard key={activeName} {...common}
          draft={(active as ParsedUserGroup).form} onApplied={handleApplied} />;
        break;
      case "ldapserver":
        inner = <LDAPServerWizard key={activeName} {...common}
          draft={(active as ParsedLDAPServer).form} onApplied={handleApplied}
          onExchangeCreated={onExchangeCreated} />;
        break;
      case "radiusserver":
        inner = <RADIUSServerWizard key={activeName} {...common}
          draft={(active as ParsedRADIUSServer).form} onApplied={handleApplied} />;
        break;
    }
  }

  // A single object needs no picker — show the plain wizard, exactly as before.
  if (drafts.length <= 1) return <>{inner}</>;

  return (
    <div className="flex h-full flex-col">
      {/* Object picker bar — the same "Objects n/m" control the Policy Wizard uses. */}
      <div className="flex items-center justify-between gap-2 border-b hairline-2 px-4 py-2 shrink-0">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] text-white" style={{ background: currentColor }}>
            {meta.icon}
          </span>
          <p className="min-w-0 truncate text-[11px] font-semibold ink-2">
            {meta.plural}
            <span className="ml-1.5 ink-3">
              · {index + 1} of {drafts.length} — “{activeName}”
            </span>
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="relative">
            <button type="button" onClick={() => setPickerOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-2 py-1 text-[10px] font-semibold ink-2 surface-hover">
              <FiLayers size={11} style={{ color: currentColor }} /> {meta.plural}
              <span className="rounded-full px-1 text-[9px] font-bold"
                style={{ background: allDone ? "#16a34a20" : `${currentColor}18`, color: allDone ? "#16a34a" : currentColor }}>
                {doneCount}/{drafts.length}
              </span>
              <FiChevronDown size={11} className={`transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>

            {pickerOpen && (
              <div className="absolute right-0 z-50 mt-1 w-72 overflow-hidden rounded-[4px] border hairline surface-card shadow-xl">
                {/* Scrolls once the list outgrows ~5 rows — ten objects behave like one. */}
                <div style={{ maxHeight: 240, overflowY: "auto" }}>
                  {drafts.map((d, i) => {
                    const n = draftName(d);
                    const done = isDone(n);
                    return (
                      <button key={`${n}-${i}`} type="button"
                        onClick={() => { setIndex(i); setPickerOpen(false); }}
                        className="flex w-full items-center gap-2.5 border-b hairline-2 px-3 py-2 text-left last:border-0 surface-hover"
                        style={i === index ? { background: `${currentColor}10` } : undefined}>
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px]"
                          style={{ background: `${currentColor}12`, color: currentColor }}>
                          {meta.icon}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-[9px] font-bold uppercase tracking-wide ink-3">{meta.label}</span>
                          <span className="block truncate text-[12px] font-semibold ink">{n}</span>
                        </span>
                        {done ? (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-bold text-emerald-600">
                            <FiCheckCircle size={14} /> Created
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold ink-3">
                            <FiPlusCircle size={14} /> Will create
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div className="surface-sunken px-3 py-1.5 text-[9px] ink-3">
                  {loading ? "Checking the device…"
                    : allDone ? `All ${drafts.length} ${meta.plural.toLowerCase()} are on the device.`
                    : "Apply each one — green ones already exist (review only)."}
                </div>
              </div>
            )}
          </div>

          <button type="button" onClick={onCancel}
            className="flex h-6 w-6 items-center justify-center rounded-[4px] ink-3 surface-hover hover-ink">
            <FiX size={13} />
          </button>
        </div>
      </div>

      {/* The single-object wizard for whichever entry is selected. */}
      <div className="min-h-0 flex-1">{inner}</div>
    </div>
  );
};

export default MultiObjectWizard;
