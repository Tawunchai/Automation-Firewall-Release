import React from "react";
import { FiPlus, FiX } from "react-icons/fi";
import { SNMP_EVENTS } from "../../api/snmp";
import MinimalSelect from "../../components/ui/MinimalSelect";
import type { HostRow } from "./model";

// The three blocks both SNMP dialogs share. Lifted out of the forms so neither one grows past the
// layout budget, and so the Hosts repeater behaves identically on a community and on a v3 user —
// FortiGate's own two dialogs differ there for no reason anyone can act on (the community's rows
// carry a host type, the user's do not), and that difference is the only one kept.

/** A labelled field row: a fixed label column and the control beside it, like FortiGate's own. */
export const Field: React.FC<{
  label: string;
  htmlFor?: string;
  hint?: string;
  children: React.ReactNode;
}> = ({ label, htmlFor, hint, children }) => (
  <div className="flex flex-wrap items-center gap-2 py-1.5">
    <label htmlFor={htmlFor} className="w-40 shrink-0 text-[12.5px] ink-2">{label}</label>
    <div className="min-w-0 flex-1">{children}</div>
    {hint && <p className="w-full pl-42 text-[11px] ink-3">{hint}</p>}
  </div>
);

/** A section heading inside a dialog — FortiGate's grey band, in this console's own vocabulary. */
export const FormSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title, children,
}) => (
  <section className="mt-4 first:mt-0">
    <h3 className="card-title m-0 mb-2 text-[13px]">{title}</h3>
    <div className="pl-1">{children}</div>
  </section>
);

/** A switch. Same shape as the one on /admin/service, so a toggle reads the same everywhere. */
export const Switch: React.FC<{
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}> = ({ checked, onChange, label, disabled }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => onChange(!checked)}
    className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    style={{ backgroundColor: checked ? "var(--accent)" : "var(--shell-ink-3)" }}
  >
    <span
      className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform"
      style={{ transform: checked ? "translateX(16px)" : "translateX(0)" }}
    />
  </button>
);

/**
 * The Hosts repeater.
 *
 * Every row is removable including the last one, and the list can reach zero. That is deliberate
 * even though a community with no hosts cannot be saved: the form refuses it with a sentence
 * saying why, which teaches the rule, where a disabled remove button on the last row just feels
 * broken. `withType` adds the community's own "Host Type" menu; a v3 user's notify-hosts have no
 * such field on the device, so it is not drawn for them.
 */
export const HostsEditor: React.FC<{
  rows: HostRow[];
  onChange: (rows: HostRow[]) => void;
  withType?: boolean;
  idPrefix: string;
}> = ({ rows, onChange, withType = false, idPrefix }) => {
  const set = (i: number, patch: Partial<HostRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-2">
      {rows.map((row, i) => (
        // Each host is its own tidy card: an IP row and (where the type applies) an Access row, both
        // on the same label column so the two controls line up, and the card keeps multiple hosts
        // from running into one another in a narrow drawer.
        <div key={i} className="space-y-2 rounded-[4px] border hairline surface-sunken p-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor={`${idPrefix}-ip-${i}`} className="w-24 shrink-0 text-[12.5px] ink-2">
              IP Address
            </label>
            <input
              id={`${idPrefix}-ip-${i}`}
              className="shell-input shell-input--sm min-w-0 flex-1"
              value={row.ip}
              placeholder="10.0.0.5"
              onChange={(e) => set(i, { ip: e.target.value })}
            />
            <button
              type="button"
              className="btn-icon btn-icon--danger shrink-0"
              title="Remove this host"
              aria-label={`Remove host ${i + 1}`}
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
            >
              <FiX size={13} />
            </button>
          </div>
          {withType && (
            <div className="flex items-center gap-2">
              <label htmlFor={`${idPrefix}-type-${i}`} className="w-24 shrink-0 text-[12.5px] ink-2">
                Access
              </label>
              <MinimalSelect
                id={`${idPrefix}-type-${i}`}
                className="min-w-0 flex-1"
                size="sm"
                ariaLabel={`Host type for host ${i + 1}`}
                value={row.host_type}
                onChange={(v) => set(i, { host_type: v })}
                options={[
                  { value: "any", label: "Accept queries and send traps" },
                  { value: "query", label: "Accept queries only" },
                  { value: "trap", label: "Send traps only" },
                ]}
              />
              {/* Keeps the select's right edge level with the IP input above it (which has the
                  remove button beside it). */}
              <span className="w-7 shrink-0" aria-hidden />
            </div>
          )}
        </div>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onChange([...rows, { id: 0, ip: "", host_type: "any" }])}
      >
        <FiPlus size={12} /> Add host
      </button>
    </div>
  );
};

/**
 * The SNMP Events list — 42 toggles, in the device's own order.
 *
 * Drawn as a scrolling two-column grid rather than FortiGate's single tall column: the dialog is
 * already long, and 42 rows stacked one per line is most of a screen of scrolling before the OK
 * button comes back into reach. "All"/"None" are here for the same reason — the realistic edits
 * are "everything except a couple" and "only these two", and both start from one of those.
 */
export const EventsEditor: React.FC<{
  selected: string[];
  onChange: (events: string[]) => void;
  idPrefix: string;
}> = ({ selected, onChange, idPrefix }) => {
  const chosen = new Set(selected);
  const toggle = (name: string) => {
    const next = new Set(chosen);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    // Kept in the catalogue's order, not click order — the device stores the string it is given,
    // and a reordered one shows up in the Change Ledger as a diff nobody made.
    onChange(SNMP_EVENTS.filter((e) => next.has(e.name)).map((e) => e.name));
  };

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11.5px] ink-3">{chosen.size} of {SNMP_EVENTS.length} selected</span>
        <div className="ml-auto flex items-center gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm"
            onClick={() => onChange(SNMP_EVENTS.map((e) => e.name))}>
            All
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
            None
          </button>
        </div>
      </div>
      <div
        className="shell-scroll-thin grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto rounded-[5px] border hairline p-2 sm:grid-cols-2"
      >
        {SNMP_EVENTS.map((e) => (
          <label
            key={e.name}
            htmlFor={`${idPrefix}-ev-${e.name}`}
            className="flex cursor-pointer items-center gap-2 rounded-[5px] px-1.5 py-1 surface-hover"
          >
            <input
              id={`${idPrefix}-ev-${e.name}`}
              type="checkbox"
              className="h-3.5 w-3.5 shrink-0 cursor-pointer"
              style={{ accentColor: "var(--accent)" }}
              checked={chosen.has(e.name)}
              onChange={() => toggle(e.name)}
            />
            <span className="min-w-0 flex-1 truncate text-[12px] ink" title={e.label}>{e.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
};
