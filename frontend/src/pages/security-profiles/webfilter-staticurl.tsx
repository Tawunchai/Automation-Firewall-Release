import React, { useState } from "react";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { Toggle, avSectionHdr } from "./antivirus-form";
import type {
  WebFilterProfileForm, WebFilterURLEntry, WebFilterContentEntry,
  WebFilterURLType, WebFilterURLEntryAction, WebFilterContentPatternType, WebFilterContentLang,
} from "../../api/policyObject";
import { SegmentedPills, SideDrawer, DrawerRow, FilterTable } from "../../components/ui/filter-table";

// ─── Option vocabularies (label ↔ CMDB value), matching the FortiGate modals ─────────
const URL_TYPES: { v: WebFilterURLType; l: string }[] = [
  { v: "simple", l: "Simple" }, { v: "regex", l: "Regular Expression" }, { v: "wildcard", l: "Wildcard" },
];
const URL_ACTIONS: { v: WebFilterURLEntryAction; l: string }[] = [
  { v: "exempt", l: "Exempt" }, { v: "block", l: "Block" }, { v: "allow", l: "Allow" }, { v: "monitor", l: "Monitor" },
];
const CONTENT_PATTERN_TYPES: { v: WebFilterContentPatternType; l: string }[] = [
  { v: "wildcard", l: "Wildcard" }, { v: "regexp", l: "Regular Expression" },
];
const CONTENT_ACTIONS: { v: "block" | "exempt"; l: string }[] = [
  { v: "block", l: "Block" }, { v: "exempt", l: "Exempt" },
];
const STATUS: { v: "enable" | "disable"; l: string }[] = [
  { v: "enable", l: "Enable" }, { v: "disable", l: "Disable" },
];
const LANGS: { v: WebFilterContentLang; l: string }[] = [
  { v: "western", l: "Western" }, { v: "simch", l: "Simplified Chinese" }, { v: "trach", l: "Traditional Chinese" },
  { v: "japanese", l: "Japanese" }, { v: "korean", l: "Korean" }, { v: "french", l: "French" },
  { v: "thai", l: "Thai" }, { v: "spanish", l: "Spanish" }, { v: "cyrillic", l: "Cyrillic" },
];
const labelOf = <T extends string>(opts: { v: T; l: string }[], v: T) => opts.find((o) => o.v === v)?.l ?? v;

// FortiOS's own defaults for a fresh row in each modal (verified against the GUI screenshots).
const NEW_URL_ENTRY: WebFilterURLEntry = { url: "", type: "simple", action: "exempt", status: "enable" };
const NEW_CONTENT_ENTRY: WebFilterContentEntry = {
  pattern: "", pattern_type: "wildcard", lang: "western", action: "block", status: "disable", score: 10,
};

const StatusBadge: React.FC<{ status: "enable" | "disable" }> = ({ status }) => (
  <span className={`chip ${status === "enable" ? "chip-ok" : ""}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${status === "enable" ? "bg-emerald-500" : "dot-muted"}`} />
    {status === "enable" ? "Enable" : "Disable"}
  </span>
);

// A single toggle line (label + switch inline), matching the FortiGate Static-URL layout.
const ToggleLine: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; color: string }> =
  ({ label, checked, onChange, color }) => (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium ink-2">{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} color={color} />
    </div>
  );

const inputCls = "h-8 w-full rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none  dark:bg-yellow-900/10 ";

// ─── Static URL Filter section (4 toggles + the URL Filter and Content Filter tables) ───
export const WFStaticURLFilter: React.FC<{
  form: WebFilterProfileForm;
  set: <K extends keyof WebFilterProfileForm>(k: K, v: WebFilterProfileForm[K]) => void;
  currentColor: string;
}> = ({ form, set, currentColor }) => {
  // Drawer state for each table: null = closed; editIndex null = create, else editing that row.
  const [urlDraft, setUrlDraft] = useState<{ entry: WebFilterURLEntry; index: number | null } | null>(null);
  const [contentDraft, setContentDraft] = useState<{ entry: WebFilterContentEntry; index: number | null } | null>(null);

  const urlRows = form.url_filter_entries;
  const contentRows = form.content_filter_entries;

  const saveUrl = () => {
    if (!urlDraft) return;
    const next = [...urlRows];
    if (urlDraft.index === null) next.push(urlDraft.entry);
    else next[urlDraft.index] = urlDraft.entry;
    set("url_filter_entries", next);
    setUrlDraft(null);
  };
  const saveContent = () => {
    if (!contentDraft) return;
    const next = [...contentRows];
    if (contentDraft.index === null) next.push(contentDraft.entry);
    else next[contentDraft.index] = contentDraft.entry;
    set("content_filter_entries", next);
    setContentDraft(null);
  };

  return (
    <>
      <div className={avSectionHdr}>Static URL Filter</div>
      <div className="space-y-3 px-6 py-5">
        <ToggleLine label="Block invalid URLs" checked={form.block_invalid_urls}
          onChange={(v) => set("block_invalid_urls", v)} color={currentColor} />

        {/* URL Filter toggle → table */}
        <ToggleLine label="URL Filter" checked={form.url_filter}
          onChange={(v) => set("url_filter", v)} color={currentColor} />
        {form.url_filter && (
          <FilterTable<WebFilterURLEntry>
            rows={urlRows} color={currentColor} gridCols="2fr 1.2fr 1fr 1fr"
            matches={(r, q) => r.url.toLowerCase().includes(q) || labelOf(URL_TYPES, r.type).toLowerCase().includes(q)}
            columns={[
              { key: "url", header: "URL", render: (r) => r.url },
              { key: "type", header: "Type", render: (r) => labelOf(URL_TYPES, r.type) },
              { key: "action", header: "Action", render: (r) => labelOf(URL_ACTIONS, r.action) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            onCreate={() => setUrlDraft({ entry: { ...NEW_URL_ENTRY }, index: null })}
            onEdit={(i) => setUrlDraft({ entry: { ...urlRows[i] }, index: i })}
            onDelete={(i) => set("url_filter_entries", urlRows.filter((_, x) => x !== i))}
          />
        )}

        <ToggleLine label="Block malicious URLs discovered by FortiSandbox" checked={form.block_malicious_fortisandbox}
          onChange={(v) => set("block_malicious_fortisandbox", v)} color={currentColor} />

        {/* Content Filter toggle → table */}
        <ToggleLine label="Content Filter" checked={form.content_filter}
          onChange={(v) => set("content_filter", v)} color={currentColor} />
        {form.content_filter && (
          <FilterTable<WebFilterContentEntry>
            rows={contentRows} color={currentColor} gridCols="1.3fr 2fr 1.3fr 1fr 1fr"
            matches={(r, q) => r.pattern.toLowerCase().includes(q)}
            columns={[
              { key: "pt", header: "Pattern Type", render: (r) => labelOf(CONTENT_PATTERN_TYPES, r.pattern_type) },
              { key: "pattern", header: "Pattern", render: (r) => r.pattern },
              { key: "lang", header: "Language", render: (r) => labelOf(LANGS, r.lang) },
              { key: "action", header: "Action", render: (r) => labelOf(CONTENT_ACTIONS, r.action) },
              { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
            ]}
            onCreate={() => setContentDraft({ entry: { ...NEW_CONTENT_ENTRY }, index: null })}
            onEdit={(i) => setContentDraft({ entry: { ...contentRows[i] }, index: i })}
            onDelete={(i) => set("content_filter_entries", contentRows.filter((_, x) => x !== i))}
          />
        )}
      </div>

      {/* New / Edit URL Filter drawer */}
      <SideDrawer open={!!urlDraft} color={currentColor}
        title={urlDraft?.index === null ? "New URL Filter" : "Edit URL Filter"}
        canSave={!!urlDraft?.entry.url.trim()} onOK={saveUrl} onCancel={() => setUrlDraft(null)}>
        {urlDraft && (
          <>
            <DrawerRow label="URL">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus value={urlDraft.entry.url} className={inputCls} placeholder="e.g. www.example.com"
                onChange={(e) => setUrlDraft({ ...urlDraft, entry: { ...urlDraft.entry, url: e.target.value } })} />
            </DrawerRow>
            <DrawerRow label="Type">
              <SegmentedPills label="URL entry type" opts={URL_TYPES} value={urlDraft.entry.type} color={currentColor}
                onChange={(v) => setUrlDraft({ ...urlDraft, entry: { ...urlDraft.entry, type: v } })} />
            </DrawerRow>
            <DrawerRow label="Action">
              <SegmentedPills label="URL entry action" opts={URL_ACTIONS} value={urlDraft.entry.action} color={currentColor}
                onChange={(v) => setUrlDraft({ ...urlDraft, entry: { ...urlDraft.entry, action: v } })} />
            </DrawerRow>
            <DrawerRow label="Status">
              <SegmentedPills label="URL entry status" opts={STATUS} value={urlDraft.entry.status} color={currentColor}
                onChange={(v) => setUrlDraft({ ...urlDraft, entry: { ...urlDraft.entry, status: v } })} />
            </DrawerRow>
          </>
        )}
      </SideDrawer>

      {/* New / Edit Web Content Filter drawer */}
      <SideDrawer open={!!contentDraft} color={currentColor}
        title={contentDraft?.index === null ? "New Web Content Filter" : "Edit Web Content Filter"}
        canSave={!!contentDraft?.entry.pattern.trim()} onOK={saveContent} onCancel={() => setContentDraft(null)}>
        {contentDraft && (
          <>
            <DrawerRow label="Pattern Type">
              <SegmentedPills label="Pattern Type" opts={CONTENT_PATTERN_TYPES} value={contentDraft.entry.pattern_type} color={currentColor}
                onChange={(v) => setContentDraft({ ...contentDraft, entry: { ...contentDraft.entry, pattern_type: v } })} />
            </DrawerRow>
            <DrawerRow label="Pattern">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus value={contentDraft.entry.pattern} className={inputCls} placeholder="e.g. example*"
                onChange={(e) => setContentDraft({ ...contentDraft, entry: { ...contentDraft.entry, pattern: e.target.value } })} />
            </DrawerRow>
            <DrawerRow label="Language">
              <MinimalSelect value={contentDraft.entry.lang} ariaLabel="Language" className="w-56"
                onChange={(v) => setContentDraft({ ...contentDraft, entry: { ...contentDraft.entry, lang: v as WebFilterContentLang } })}
                options={LANGS.map((l) => ({ value: l.v, label: l.l }))} />
            </DrawerRow>
            <DrawerRow label="Action">
              <SegmentedPills label="Content entry action" opts={CONTENT_ACTIONS} value={contentDraft.entry.action} color={currentColor}
                onChange={(v) => setContentDraft({ ...contentDraft, entry: { ...contentDraft.entry, action: v } })} />
            </DrawerRow>
            <DrawerRow label="Status">
              <SegmentedPills label="Content entry status" opts={STATUS} value={contentDraft.entry.status} color={currentColor}
                onChange={(v) => setContentDraft({ ...contentDraft, entry: { ...contentDraft.entry, status: v } })} />
            </DrawerRow>
          </>
        )}
      </SideDrawer>
    </>
  );
};
