import React, { useMemo, useState } from "react";
import { FiEye, FiSlash, FiSearch, FiX, FiPlus, FiInfo } from "react-icons/fi";
import { SideDrawer, DrawerRow, SegmentedPills, FilterTable } from "../../components/ui/filter-table";
import { Toggle } from "./antivirus-form";
import type { FileFilterProfileForm, FileFilterRule, FileFilterMetadata } from "../../api/policyObject";
import { activateOnKey } from "../../components/ui/keyActivate";
import { allowedFileTypes, directionApplies } from "./file-filter-sections.logic";

type SetFn = <K extends keyof FileFilterProfileForm>(k: K, v: FileFilterProfileForm[K]) => void;

// GUI protocol labels (uppercase) — CMDB stores the lowercase value.
const protoLabel = (v: string) => v.toUpperCase();

// Traffic direction — the FortiGate GUI labels CMDB "any" as "Both".
const DIRECTIONS: { v: FileFilterRule["direction"]; l: string }[] = [
  { v: "incoming", l: "Incoming" }, { v: "outgoing", l: "Outgoing" }, { v: "any", l: "Both" },
];
const dirLabel = (v: string) => DIRECTIONS.find((d) => d.v === v)?.l ?? v;

// The only protocols a rule's Traffic direction applies to — the CMDB schema says so
// ("Traffic direction (HTTP, FTP, SSH, CIFS only).") and the device enforces it silently:
// a mail-only rule (smtp/imap/pop3/mapi) gets direction forced to "any" with a 200 OK.
// So the drawer greys the control out instead of offering a choice that gets discarded.
// "Password-protected only" narrows the file-type datasource to the formats that can carry a
// password. The schema doesn't say so — the device enforces it at runtime and answers
// "-3 entry not found in datasource" for anything else (verified live: 6 of the 56 types pass).
// The backend sends the list in the metadata; this is the fallback if that's missing.
// allowedFileTypes returns the types selectable for a rule, given its Password-protected toggle.
const ACTIONS: { v: FileFilterRule["action"]; l: string; icon: React.ReactNode; color: string }[] = [
  { v: "monitor", l: "Monitor", icon: <FiEye size={13} />, color: "#3b82f6" },
  { v: "block", l: "Block", icon: <FiSlash size={13} />, color: "#ef4444" },
];

const NEW_RULE: FileFilterRule = {
  name: "", comment: "",
  protocols: ["cifs", "ftp", "http", "imap", "pop3", "smtp"],
  direction: "any", password_protected: false, file_types: [], action: "monitor",
};

const inputCls = "h-8 w-full rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none  dark:bg-yellow-900/10 ";

// ─── Selectable chip (toggle) ────────────────────────────────────────────────
const Chip: React.FC<{ on: boolean; label: string; onClick: () => void; color: string }> =
  ({ on, label, onClick, color }) => (
    <button type="button" onClick={onClick}
      className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "text-white" : "ink-2 hairline surface-hover"}`}
      style={on ? { backgroundColor: color, borderColor: color } : undefined}>
      {label}
    </button>
  );

// ─── File-type multi-select (mirrors FortiGate's "Select Entries" list) ───────
const FileTypePicker: React.FC<{
  selected: string[]; options: string[]; onToggle: (v: string) => void; color: string;
}> = ({ selected, options, onToggle, color }) => {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.toLowerCase().includes(s)) : options;
  }, [q, options]);

  return (
    <div>
      {/* Selected chips */}
      {selected.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {selected.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded-[4px] px-2 py-1 text-[11px] font-semibold text-white" style={{ backgroundColor: color }}>
              {t}
              <button type="button" onClick={() => onToggle(t)} className="opacity-80 hover:opacity-100"><FiX size={11} /></button>
            </span>
          ))}
        </div>
      )}
      {/* Search + catalogue list */}
      <div className="overflow-hidden rounded-[4px] border hairline">
        <div className="relative border-b hairline">
          <FiSearch size={12} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 ink-3" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search file types"
            className="h-8 w-full surface-card pl-8 pr-2 text-[12px] outline-none" />
        </div>
        <div style={{ maxHeight: 200, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div className="py-6 text-center text-[12px] ink-3">No file types</div>
          ) : filtered.map((t) => {
            const on = selected.includes(t);
            return (
              <div key={t} role="button" tabIndex={0} aria-pressed={on}
                onClick={() => onToggle(t)}
                onKeyDown={activateOnKey(() => onToggle(t))}
                className={`flex cursor-pointer items-center gap-2 border-b hairline-2 px-3 py-1.5 text-[12px] last:border-0  ${on ? "bg-blue-50 dark:bg-blue-500/10" : "surface-hover"}`}>
                <input type="checkbox" checked={on} readOnly className="pointer-events-none" />
                <span className="ink">{t}</span>
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between border-t hairline px-3 py-1 text-[11px] ink-3">
          <span>{selected.length} selected</span>
          <span className="rounded-[5px] surface-sunken px-2 font-bold ink-2">{filtered.length}</span>
        </div>
      </div>
    </div>
  );
};

// ─── Rules section (table + create/edit rule drawer) ──────────────────────────
export const FFRules: React.FC<{
  form: FileFilterProfileForm; set: SetFn; meta: FileFilterMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const rows = form.rules;
  const [draft, setDraft] = useState<{ entry: FileFilterRule; index: number | null } | null>(null);

  const protoOptions = meta.protocols.length ? meta.protocols : NEW_RULE.protocols;
  const ppTypes = meta.password_protected_file_types ?? [];

  const save = () => {
    if (!draft) return;
    const next = [...rows];
    if (draft.index === null) next.push(draft.entry);
    else next[draft.index] = draft.entry;
    set("rules", next);
    setDraft(null);
  };

  const patch = (p: Partial<FileFilterRule>) => draft && setDraft({ ...draft, entry: { ...draft.entry, ...p } });
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // Changing the protocols can take Traffic out of play — snap the draft back to "Both" so the
  // rules table shows what the device will actually store, not a direction it will drop.
  const patchProtocols = (protocols: string[]) =>
    patch(directionApplies(protocols) ? { protocols } : { protocols, direction: "any" });

  // Turning "Password-protected only" on narrows the file types the device will accept, so drop
  // any already-picked type that would now come back as -3 and tell the user which ones went.
  const patchPasswordProtected = (on: boolean) => {
    if (!draft) return;
    if (!on) { patch({ password_protected: false }); return; }
    const allow = new Set(allowedFileTypes(true, meta.file_types, ppTypes).map((t) => t.toLowerCase()));
    patch({
      password_protected: true,
      file_types: draft.entry.file_types.filter((t) => allow.has(t.toLowerCase())),
    });
  };

  // The device rejects a rule with no file types (-61) and defaults an empty protocol list to
  // six protocols behind the user's back, so require both rather than silently changing them.
  const canSave = !!draft
    && draft.entry.name.trim().length > 0
    && draft.entry.file_types.length > 0
    && draft.entry.protocols.length > 0;

  const dirOff = !!draft && !directionApplies(draft.entry.protocols);
  const ftOptions = draft ? allowedFileTypes(draft.entry.password_protected, meta.file_types, ppTypes) : meta.file_types;

  return (
    <div className="px-6 pb-5">
      <FilterTable<FileFilterRule>
        rows={rows} color={currentColor} gridCols="1.2fr 1.4fr 1fr 1.4fr 0.9fr 1.6fr"
        matches={(r, q) =>
          r.name.toLowerCase().includes(q) ||
          (r.comment || "").toLowerCase().includes(q) ||
          r.file_types.some((t) => t.includes(q))}
        columns={[
          { key: "rule", header: "Rule", render: (r) => r.name },
          { key: "comment", header: "Comments", render: (r) => r.comment || "—" },
          { key: "traffic", header: "Traffic", render: (r) => dirLabel(r.direction) },
          { key: "protocols", header: "Protocols", render: (r) => r.protocols.map(protoLabel).join(", ") || "—" },
          { key: "action", header: "Action", render: (r) => {
            const m = ACTIONS.find((a) => a.v === r.action) ?? ACTIONS[0];
            return <span className="inline-flex items-center gap-1" style={{ color: m.color }}>{m.icon} {m.l}</span>;
          } },
          { key: "filetypes", header: "File Types", render: (r) => r.file_types.join(", ") || "—" },
        ]}
        onCreate={() => setDraft({ entry: { ...NEW_RULE, protocols: [...protoOptions] }, index: null })}
        onEdit={(i) => setDraft({ entry: JSON.parse(JSON.stringify(rows[i])), index: i })}
        onDelete={(i) => set("rules", rows.filter((_, x) => x !== i))}
      />

      <SideDrawer open={!!draft} color={currentColor}
        title={draft?.index === null ? "Create New File Filter Rule" : "Edit File Filter Rule"}
        canSave={canSave} onOK={save} onCancel={() => setDraft(null)}>
        {draft && (
          <>
            <DrawerRow label="Name">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus value={draft.entry.name} className={inputCls} placeholder="e.g. block-executables"
                onChange={(e) => patch({ name: e.target.value })} />
            </DrawerRow>
            <DrawerRow label="Comments" top>
              <div className="relative">
                <textarea value={draft.entry.comment} rows={2} placeholder="Write a comment…"
                  onChange={(e) => patch({ comment: e.target.value.slice(0, 255) })}
                  className="w-full rounded border hairline surface-card px-2.5 py-1.5 pr-12 text-[13px] ink outline-none resize-none" />
                <span className="pointer-events-none absolute right-2.5 top-2 text-[10px] ink-3">{draft.entry.comment.length}/255</span>
              </div>
            </DrawerRow>
            <DrawerRow label="Protocols" top>
              <div className="flex flex-wrap gap-1.5">
                {protoOptions.map((p) => (
                  <Chip key={p} on={draft.entry.protocols.includes(p)} label={protoLabel(p)} color={currentColor}
                    onClick={() => patchProtocols(toggleIn(draft.entry.protocols, p))} />
                ))}
              </div>
              {draft.entry.protocols.length === 0 && (
                <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-500">
                  <FiPlus size={11} /> Select at least one protocol
                </p>
              )}
            </DrawerRow>
            <DrawerRow label="Traffic" top>
              <div className={dirOff ? "pointer-events-none opacity-40" : undefined}>
                <SegmentedPills label="Traffic" opts={DIRECTIONS} value={draft.entry.direction} color={currentColor}
                  onChange={(v) => patch({ direction: v })} />
              </div>
              {dirOff && (
                <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                  <FiInfo size={11} className="mt-0.5 shrink-0" />
                  Traffic direction applies to HTTP, FTP, SSH and CIFS only — with just mail
                  protocols selected the FortiGate always matches both directions.
                </p>
              )}
            </DrawerRow>

            <div className="mt-3 border-t hairline-2 pt-3">
              <p className="mb-2 text-[11px] font-bold uppercase tracking-wider ink-3">Match Files</p>
              <DrawerRow label="Password-protected only" top>
                <Toggle label="Match files" checked={draft.entry.password_protected} color={currentColor}
                  onChange={patchPasswordProtected} />
                {draft.entry.password_protected && (
                  <p className="mt-1 flex items-start gap-1 text-[11px] ink-3">
                    <FiInfo size={11} className="mt-0.5 shrink-0" />
                    Only formats that can carry a password are matchable, so File types is limited
                    to {ftOptions.join(", ")}.
                  </p>
                )}
              </DrawerRow>
              <DrawerRow label="File types" top>
                <FileTypePicker selected={draft.entry.file_types} options={ftOptions}
                  color={currentColor} onToggle={(v) => patch({ file_types: toggleIn(draft.entry.file_types, v) })} />
                {draft.entry.file_types.length === 0 && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-amber-500">
                    <FiPlus size={11} /> Select at least one file type
                  </p>
                )}
              </DrawerRow>
              <DrawerRow label="Action">
                <SegmentedPills label="Rule action" opts={ACTIONS.map((a) => ({ v: a.v, l: a.l }))} value={draft.entry.action}
                  color={currentColor} onChange={(v) => patch({ action: v })} />
              </DrawerRow>
            </div>
          </>
        )}
      </SideDrawer>
    </div>
  );
};
