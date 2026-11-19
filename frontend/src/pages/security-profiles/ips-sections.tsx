import React, { useMemo, useState } from "react";
import { FiSearch, FiInfo, FiTarget, FiAlertTriangle } from "react-icons/fi";
import { SideDrawer, DrawerRow, SegmentedPills, FilterTable } from "../../components/ui/filter-table";
import { Toggle } from "./antivirus-form";
import {
  EMPTY_IPS_ENTRY,
  type IPSSensorForm, type IPSEntry, type IPSMetadata, type IPSSignature,
} from "../../api/inspectionProfiles";
import { activateOnKey } from "../../components/ui/keyActivate";
import { ACTIONS, SEVERITY_META, STATUSES, actionMeta, filterLabel } from "./ips-sections.logic";

type SetFn = <K extends keyof IPSSensorForm>(k: K, v: IPSSensorForm[K]) => void;

// ─── Vocabulary ──────────────────────────────────────────────────────────────
//
// The device stores lowercase tokens; FortiOS's GUI shows title case. Everything the user reads
// is translated here so the CMDB value never leaks into the page.

const severityLabel = (v: string) => SEVERITY_META[v.toLowerCase()]?.label ?? v;

// ─── Small controls ──────────────────────────────────────────────────────────

const Chip: React.FC<{ on: boolean; label: string; onClick: () => void; color: string }> =
  ({ on, label, onClick, color }) => (
    <button type="button" onClick={onClick}
      className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "text-white" : "ink-2 hairline surface-hover"}`}
      style={on ? { backgroundColor: color, borderColor: color } : undefined}>
      {label}
    </button>
  );

/**
 * Searchable multi-select — the same shape as FortiGate's "Select Entries" list.
 *
 * Used for protocol / OS / application, where the device's signature database yields 29, 6 and
 * ~30 values respectively. Severity and Target are short enough to be plain chips.
 */
export const MultiPicker: React.FC<{
  selected: string[]; options: string[]; onToggle: (v: string) => void;
  color: string; placeholder: string; emptyMeans?: string;
}> = ({ selected, options, onToggle, color, placeholder, emptyMeans }) => {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.toLowerCase().includes(s)) : options;
  }, [options, q]);

  return (
    <div className="overflow-hidden rounded-[4px] border hairline">
      <div className="relative border-b hairline surface-sunken">
        <FiSearch size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder}
          className="h-8 w-full bg-transparent pl-7 pr-2 text-[12px] ink outline-none" />
      </div>
      <div style={{ maxHeight: 150, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-[12px] ink-3">No matches</div>
        ) : filtered.map((o) => {
          const on = selected.includes(o);
          return (
            <div key={o} role="button" tabIndex={0} aria-pressed={on}
              onClick={() => onToggle(o)}
              onKeyDown={activateOnKey(() => onToggle(o))}
              className={`flex cursor-pointer items-center gap-2 border-b hairline-2 px-3 py-1.5 text-[12px] last:border-0 ${on ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}>
              <input type="checkbox" checked={on} readOnly className="pointer-events-none" />
              <span className="ink">{o}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t hairline px-3 py-1 text-[11px] ink-3">
        <span>{selected.length === 0 ? (emptyMeans ?? "none selected") : `${selected.length} selected`}</span>
        <span className="rounded-[5px] surface-sunken px-2 font-bold" style={{ color }}>{filtered.length}</span>
      </div>
    </div>
  );
};

/**
 * Signature picker for an explicit-signature entry.
 *
 * The device holds thousands (5,864 on the lab unit) so this never renders the whole list: it
 * shows what matches the search, capped, and tells you how many more there are. A picker that
 * tries to paint six thousand rows is a picker that hangs the tab.
 */
const SIGNATURE_ROWS_SHOWN = 200;

const SignaturePicker: React.FC<{
  selected: number[]; signatures: IPSSignature[]; onToggle: (id: number) => void; color: string;
}> = ({ selected, signatures, onToggle, color }) => {
  const [q, setQ] = useState("");

  const { rows, total } = useMemo(() => {
    const s = q.trim().toLowerCase();
    // With no search, lead with what is already selected so an edit shows its own contents
    // instead of the alphabetical top of the database.
    const pool = s
      ? signatures.filter((x) =>
          x.name.toLowerCase().includes(s) ||
          String(x.id).includes(s) ||
          x.severity.toLowerCase().includes(s))
      : [...signatures].sort((a, b) =>
          Number(selected.includes(b.id)) - Number(selected.includes(a.id)));
    return { rows: pool.slice(0, SIGNATURE_ROWS_SHOWN), total: pool.length };
  }, [signatures, q, selected]);

  return (
    <div className="overflow-hidden rounded-[4px] border hairline">
      <div className="relative border-b hairline surface-sunken">
        <FiSearch size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
        <input value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Search signatures by name, id or severity…"
          className="h-8 w-full bg-transparent pl-7 pr-2 text-[12px] ink outline-none" />
      </div>
      <div style={{ maxHeight: 220, overflowY: "auto" }}>
        {signatures.length === 0 ? (
          <div className="px-3 py-6 text-center text-[12px] ink-3">
            This device did not return a signature database — pick signatures by CVE below, or use a filter entry instead.
          </div>
        ) : rows.length === 0 ? (
          <div className="py-6 text-center text-[12px] ink-3">No matches</div>
        ) : rows.map((sig) => {
          const on = selected.includes(sig.id);
          const sev = SEVERITY_META[sig.severity?.toLowerCase()] ?? SEVERITY_META.info;
          return (
            <div key={sig.id} role="button" tabIndex={0} aria-pressed={on}
              onClick={() => onToggle(sig.id)}
              onKeyDown={activateOnKey(() => onToggle(sig.id))}
              className={`flex cursor-pointer items-center gap-2 border-b hairline-2 px-3 py-1.5 text-[12px] last:border-0 ${on ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}>
              <input type="checkbox" checked={on} readOnly className="pointer-events-none shrink-0" />
              <span className="truncate ink" title={sig.name}>{sig.name}</span>
              <span className="ml-auto shrink-0 rounded px-1.5 text-[10px] font-bold"
                style={{ color: sev.color, backgroundColor: `${sev.color}1a` }}>
                {sev.label}
              </span>
              <span className="shrink-0 font-mono text-[10px] ink-3">{sig.id}</span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t hairline px-3 py-1 text-[11px] ink-3">
        <span>{selected.length} selected</span>
        <span>
          {total > rows.length ? `showing ${rows.length} of ${total} — narrow the search` : `${total}`}
        </span>
      </div>
      <div className="border-t hairline px-3 py-1 text-[11px]" style={{ color }}>
        {selected.length > 0 && (
          <span className="font-mono">{selected.slice(0, 12).join(", ")}{selected.length > 12 ? ` +${selected.length - 12}` : ""}</span>
        )}
      </div>
    </div>
  );
};

// ─── Entries section (table + create/edit drawer) ────────────────────────────

export const IPSEntries: React.FC<{
  form: IPSSensorForm; set: SetFn; meta: IPSMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const rows = form.entries;
  const [draft, setDraft] = useState<{ entry: IPSEntry; index: number | null } | null>(null);

  const patch = (p: Partial<IPSEntry>) => draft && setDraft({ ...draft, entry: { ...draft.entry, ...p } });
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
  const toggleId = (arr: number[], v: number) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const save = () => {
    if (!draft) return;
    const e = draft.entry;
    // Switching the drawer's type must not leave the other flavour's data behind: a filter with
    // stale rule ids reads back from the device as a signature entry, and the row the user sees
    // in the table would not be the row they built.
    const cleaned: IPSEntry = e.kind === "signature"
      ? { ...e, severity: [], location: [], protocol: [], os: [], application: [] }
      : { ...e, rules: [], cves: [] };

    const next = [...rows];
    if (draft.index === null) next.push(cleaned);
    else next[draft.index] = cleaned;
    set("entries", next);
    setDraft(null);
  };

  // A signature entry with nothing selected matches nothing; a filter with everything blank and
  // no action change is the "matches everything, does nothing" row the backend rejects.
  const canSave = !!draft && (
    draft.entry.kind === "signature"
      ? draft.entry.rules.length > 0 || draft.entry.cves.length > 0
      : draft.entry.severity.length > 0 || draft.entry.location.length > 0 ||
        draft.entry.protocol.length > 0 || draft.entry.os.length > 0 ||
        draft.entry.application.length > 0 ||
        draft.entry.action !== "default" || draft.entry.status !== "default"
  );

  const usingFallback = meta.signature_count === 0;

  return (
    <div className="px-6 pb-5">
      {usingFallback && (
        <div className="mb-2 flex items-start gap-2 rounded-[4px] border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-400">
          <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span>
            This firewall did not return its IPS signature database, so the filter lists below are
            FortiOS's generic ones rather than this unit's. Filters still work; the signature picker
            will be empty. An expired IPS subscription is the usual cause.
          </span>
        </div>
      )}

      <FilterTable<IPSEntry>
        rows={rows} color={currentColor} gridCols="0.7fr 1fr 0.8fr 1fr 1.1fr 0.8fr 0.8fr"
        matches={(r, q) =>
          r.kind.includes(q) ||
          r.severity.some((s) => s.includes(q)) ||
          r.protocol.some((s) => s.toLowerCase().includes(q)) ||
          r.action.includes(q)}
        columns={[
          { key: "kind", header: "Type", render: (r) => (
            <span className="inline-flex items-center gap-1">
              <FiTarget size={11} className="ink-3" />
              {r.kind === "signature" ? "Signature" : "Filter"}
            </span>
          ) },
          { key: "severity", header: "Severity", render: (r) =>
            r.kind === "signature"
              ? <span className="ink-3">{r.rules.length} signature{r.rules.length === 1 ? "" : "s"}</span>
              : filterLabel(r.severity, severityLabel) },
          { key: "location", header: "Target", render: (r) => r.kind === "signature" ? "—" : filterLabel(r.location) },
          { key: "protocol", header: "Protocol", render: (r) => r.kind === "signature" ? "—" : filterLabel(r.protocol) },
          { key: "os", header: "OS / Application", render: (r) =>
            r.kind === "signature" ? "—" : `${filterLabel(r.os)} / ${filterLabel(r.application)}` },
          { key: "action", header: "Action", render: (r) => {
            const m = actionMeta(r.action);
            return <span className="inline-flex items-center gap-1" style={{ color: m.color }}>{m.icon} {m.l}</span>;
          } },
          { key: "packet", header: "Packet Log", render: (r) => (r.log_packet ? "Enabled" : "Disabled") },
        ]}
        onCreate={() => setDraft({ entry: { ...EMPTY_IPS_ENTRY }, index: null })}
        onEdit={(i) => setDraft({ entry: JSON.parse(JSON.stringify(rows[i])), index: i })}
        onDelete={(i) => set("entries", rows.filter((_, x) => x !== i))}
      />

      {rows.length === 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-500">
          <FiAlertTriangle size={12} className="mt-0.5 shrink-0" />
          A sensor with no entries inspects nothing. Add at least one filter or signature entry
          before saving — otherwise a policy can show IPS as "on" while no traffic is examined.
        </p>
      )}

      <SideDrawer open={!!draft} color={currentColor}
        title={draft?.index === null ? "New IPS Entry" : "Edit IPS Entry"}
        canSave={canSave} onOK={save} onCancel={() => setDraft(null)}>
        {draft && (
          <>
            <DrawerRow label="Type" top>
              <SegmentedPills<IPSEntry["kind"]> label="Signature filter type"
                opts={[{ v: "filter", l: "Filter" }, { v: "signature", l: "Signature" }]}
                value={draft.entry.kind} color={currentColor}
                onChange={(v) => patch({ kind: v })} />
              <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                <FiInfo size={11} className="mt-0.5 shrink-0" />
                {draft.entry.kind === "filter"
                  ? "Match signatures by their attributes — this keeps working as FortiGuard adds new ones."
                  : "Pick exact signatures by name or CVE. Precise, but it will not cover signatures added later."}
              </p>
            </DrawerRow>

            {draft.entry.kind === "filter" ? (
              <>
                <DrawerRow label="Severity" top>
                  <div className="flex flex-wrap gap-1.5">
                    {(meta.severities.length ? meta.severities : Object.keys(SEVERITY_META)).map((sv) => (
                      <Chip key={sv} on={draft.entry.severity.includes(sv)}
                        label={severityLabel(sv)} color={SEVERITY_META[sv.toLowerCase()]?.color ?? currentColor}
                        onClick={() => patch({ severity: toggleIn(draft.entry.severity, sv) })} />
                    ))}
                  </div>
                  {draft.entry.severity.length === 0 && (
                    <p className="mt-1 text-[11px] ink-3">Nothing selected = every severity.</p>
                  )}
                </DrawerRow>

                <DrawerRow label="Target" top>
                  <div className="flex flex-wrap gap-1.5">
                    {(meta.locations.length ? meta.locations : ["client", "server"]).map((l) => (
                      <Chip key={l} on={draft.entry.location.includes(l)}
                        label={l === "client" ? "Client" : "Server"} color={currentColor}
                        onClick={() => patch({ location: toggleIn(draft.entry.location, l) })} />
                    ))}
                  </div>
                  {draft.entry.location.length === 0 && (
                    <p className="mt-1 text-[11px] ink-3">Nothing selected = both directions.</p>
                  )}
                </DrawerRow>

                <DrawerRow label="Protocol" top>
                  <MultiPicker selected={draft.entry.protocol} options={meta.protocols} color={currentColor}
                    placeholder="Search protocols…" emptyMeans="all protocols"
                    onToggle={(v) => patch({ protocol: toggleIn(draft.entry.protocol, v) })} />
                </DrawerRow>

                <DrawerRow label="OS" top>
                  <MultiPicker selected={draft.entry.os} options={meta.oses} color={currentColor}
                    placeholder="Search operating systems…" emptyMeans="all operating systems"
                    onToggle={(v) => patch({ os: toggleIn(draft.entry.os, v) })} />
                </DrawerRow>

                <DrawerRow label="Application" top>
                  <MultiPicker selected={draft.entry.application} options={meta.applications} color={currentColor}
                    placeholder="Search applications…" emptyMeans="all applications"
                    onToggle={(v) => patch({ application: toggleIn(draft.entry.application, v) })} />
                </DrawerRow>
              </>
            ) : (
              <>
                <DrawerRow label="Signatures" top>
                  <SignaturePicker selected={draft.entry.rules} signatures={meta.signatures}
                    color={currentColor}
                    onToggle={(id) => patch({ rules: toggleId(draft.entry.rules, id) })} />
                </DrawerRow>
                <DrawerRow label="CVE IDs" top>
                  <input
                    value={draft.entry.cves.join(", ")}
                    placeholder="CVE-2021-44228, CVE-2014-*"
                    onChange={(e) => patch({
                      cves: e.target.value.split(",").map((x) => x.trim()).filter(Boolean),
                    })}
                    className="h-8 w-full rounded border hairline surface-card px-2.5 text-[13px] ink outline-none" />
                  <p className="mt-1 text-[11px] ink-3">
                    Comma separated. Wildcards are allowed, e.g. <span className="font-mono">CVE-2014-*</span>.
                  </p>
                </DrawerRow>
              </>
            )}

            <DrawerRow label="Action" top>
              <SegmentedPills<IPSEntry["action"]> label="Signature action" opts={ACTIONS.map((a) => ({ v: a.v, l: a.l }))}
                value={draft.entry.action}
                color={currentColor} onChange={(v) => patch({ action: v })} />
              <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                <FiInfo size={11} className="mt-0.5 shrink-0" />
                {actionMeta(draft.entry.action).help}
              </p>
            </DrawerRow>

            <DrawerRow label="Status" top>
              <SegmentedPills<IPSEntry["status"]> label="Signature status" opts={STATUSES} value={draft.entry.status}
                color={currentColor} onChange={(v) => patch({ status: v })} />
            </DrawerRow>

            <DrawerRow label="Logging">
              <div className="flex items-center gap-6">
                <span className="flex items-center gap-2 text-[12px] ink-2">
                  <Toggle label="Log matches" checked={draft.entry.log} color={currentColor}
                    onChange={(v) => patch({ log: v })} />
                  Log matches
                </span>
                <span className="flex items-center gap-2 text-[12px] ink-2">
                  <Toggle label="Packet capture" checked={draft.entry.log_packet} color={currentColor}
                    onChange={(v) => patch({ log_packet: v })} />
                  Packet capture
                </span>
              </div>
            </DrawerRow>

            <DrawerRow label="Quarantine" top>
              <SegmentedPills<IPSEntry["quarantine"]> label="Quarantine"
                opts={[{ v: "none", l: "None" }, { v: "attacker", l: "Attacker" }]}
                value={draft.entry.quarantine} color={currentColor}
                onChange={(v) => patch({ quarantine: v })} />
              {draft.entry.quarantine === "attacker" && (
                <p className="mt-1 flex items-start gap-1 text-[11px] text-amber-500">
                  <FiAlertTriangle size={11} className="mt-0.5 shrink-0" />
                  The source address is banned for every service, not just the one that tripped the
                  signature. A false positive takes that host off the network entirely.
                </p>
              )}
            </DrawerRow>
          </>
        )}
      </SideDrawer>
    </div>
  );
};
