import React, { useMemo, useState } from "react";
import { FiAlertTriangle, FiChevronDown, FiChevronRight, FiX, FiPlus } from "react-icons/fi";
import { SideDrawer, DrawerRow, SegmentedPills, FilterTable } from "../../components/ui/filter-table";
import { Toggle } from "./antivirus-form";
import type {
  DNSFilterProfileForm, DNSFilterAction, DNSFilterMetadata,
  DNSDomainEntry, DNSTranslationEntry, WebFilterCategoryMeta,
} from "../../api/policyObject";
import { DNS_ACTIONS, dnsActivePreset, dnsPresetCategories } from "./dnsfilter-sections.logic";
import type { ActionMeta, DNSPreset } from "./dnsfilter-sections.logic";

type SetFn = <K extends keyof DNSFilterProfileForm>(k: K, v: DNSFilterProfileForm[K]) => void;

// ─── Action vocabulary (matches the FortiGate DNS category-filter toolbar) ────────────
// "block" is labelled "Redirect to Block Portal" — that is the GUI's name for it, and the DNS
// filter has no plain "Block": a blocked lookup is answered with the block portal's address.
const ACTION_BY_VALUE = Object.fromEntries(DNS_ACTIONS.map((a) => [a.value, a])) as Record<DNSFilterAction, ActionMeta>;

const PRESETS: DNSPreset[] = ["custom", "G", "PG-13", "R"];
const PRESET_LABEL: Record<DNSPreset, string> = { custom: "Custom", G: "G", "PG-13": "PG-13", R: "R" };

// FortiGate renders the category groups in this fixed order.
const GROUP_ORDER = [
  "Potentially Liable", "Adult/Mature Content", "Bandwidth Consuming",
  "Security Risk", "General Interest - Personal", "General Interest - Business", "Unrated",
];

// ─── Preset helpers (exported for tests) ─────────────────────────────────────────────
//
// Custom  → every category Monitor. That is what FortiOS's own blank "New DNS Filter Profile"
//           page shows (all 15 Adult/Mature Content rows read "Monitor"), and it differs from
//           the Web Filter form, whose Custom preset uses each category's FortiGuard default.
// G/PG-13/R → block exactly the categories the rating blocks and ALLOW the rest. Derived from
//           blocked_in_ratings, which the device itself reports (verified live: G blocks 39
//           categories, PG-13 33, R 6 — and under R all 15 Adult/Mature rows read "Allow",
//           matching the GUI).
//
// Only non-allow rows are returned: "allow" is the absence of an entry (see the api type doc).
// Which preset the current selection corresponds to, or "custom" when it matches none.
// ─── Redirect Portal IP field state ──────────────────────────────────────────────────
//
// The device's own page renders this control in two distinct states, and the difference is
// easy to get subtly wrong:
//   · "Use FortiGuard Default" → greyed out, NOT editable, showing 0.0.0.0 as a PLACEHOLDER
//     (0.0.0.0 is the value FortiOS actually stores to mean "use the default portal").
//   · "Specify"                → an EMPTY, editable box with NO placeholder at all. Leaving the
//     0.0.0.0 hint here would read as "0.0.0.0 is already filled in" when the field is in fact
//     empty and required.
// Exported as a pure function so both the page and the wizard render the same thing, and so the
// distinction is pinned by a test rather than by two hand-copied JSX blocks.
// ─── Action badge shown at the end of every category row ─────────────────────────────
const ActionBadge: React.FC<{ action: DNSFilterAction }> = ({ action }) => {
  const a = ACTION_BY_VALUE[action] ?? ACTION_BY_VALUE.allow;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: a.color, backgroundColor: a.bg }}>
      {a.icon} {a.label}
    </span>
  );
};

// ─── FortiGuard Category Based Filter — presets, action toolbar, grouped tree ─────────
export const DNSFortiGuardFilter: React.FC<{
  form: DNSFilterProfileForm;
  set: SetFn;
  meta: DNSFilterMetadata;
  currentColor: string;
  loadingMeta: boolean;
}> = ({ form, set, meta, currentColor, loadingMeta }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const allCats = meta.categories;
  const groups = useMemo(
    () => GROUP_ORDER
      .map((g) => ({ group: g, cats: allCats.filter((c) => c.group === g) }))
      .filter((x) => x.cats.length > 0),
    [allCats]
  );

  const catMap = useMemo(() => {
    const m = new Map<number, DNSFilterAction>();
    form.categories.forEach((c) => m.set(c.category, c.action));
    return m;
  }, [form.categories]);
  const actionOf = (id: number): DNSFilterAction => catMap.get(id) ?? "allow";

  // Rebuild form.categories from a map, dropping "allow" — allow is stored as no entry at all.
  const setActions = (ids: number[], action: DNSFilterAction) => {
    const m = new Map(form.categories.map((c) => [c.category, c] as const));
    ids.forEach((id) => {
      if (action === "allow") m.delete(id);
      else m.set(id, { category: id, action });
    });
    set("categories", [...m.values()]);
  };

  const applyPreset = (p: DNSPreset) => set("categories", dnsPresetCategories(allCats, p));
  const activePreset = dnsActivePreset(allCats, actionOf);

  const toggleSel = (id: number) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleGroupSel = (cats: WebFilterCategoryMeta[]) =>
    setSelected((s) => {
      const n = new Set(s);
      const allIn = cats.every((c) => n.has(c.id));
      cats.forEach((c) => (allIn ? n.delete(c.id) : n.add(c.id)));
      return n;
    });
  const toggleCollapse = (g: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(g)) n.delete(g); else n.add(g); return n; });

  const totalCats = allCats.length;
  const pct = totalCats ? Math.round((form.categories.length / totalCats) * 100) : 0;

  return (
    <div className="px-6 py-5 space-y-3">
      {/* The DNS category filter is rated by the FortiGuard web-filtering service — without the
          subscription the device rates nothing, so the grid silently does nothing. */}
      {!meta.web_filter_licensed && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            <p className="font-semibold">Warning: This device is not licensed for the FortiGuard web filtering service.</p>
            <p>DNS lookups cannot be rated, so category actions below will not take effect.</p>
          </div>
        </div>
      )}

      {/* Pre-configured filters (presets) */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium ink-2">Pre-configured filters</span>
        <div className="inline-flex overflow-hidden rounded-[4px] border hairline">
          {PRESETS.map((p) => {
            const active = activePreset === p;
            return (
              <button key={p} type="button" onClick={() => applyPreset(p)}
                className={`px-3 py-1 text-[12px] font-semibold transition-colors ${active ? "text-white" : "ink-2 surface-hover"} ${p !== "custom" ? "border-l hairline" : ""}`}
                style={active ? { backgroundColor: currentColor } : undefined}>
                {PRESET_LABEL[p]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Action toolbar — applies to the checked categories */}
      <div className="inline-flex flex-wrap items-center overflow-hidden rounded-[4px] border hairline">
        {DNS_ACTIONS.map((a, i) => (
          <button key={a.value} type="button" disabled={selected.size === 0}
            onClick={() => setActions([...selected], a.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${i > 0 ? "border-l hairline" : ""} surface-hover`}
            style={{ color: selected.size === 0 ? undefined : a.color }}>
            {a.icon} {a.label}
          </button>
        ))}
        {selected.size > 0 && (
          <span className="px-3 text-[11px] ink-3">{selected.size} selected</span>
        )}
      </div>

      {/* Category tree */}
      <div className="overflow-hidden rounded-[4px] border hairline">
        <div className="grid items-center border-b hairline surface-sunken px-3 py-1.5"
          style={{ gridTemplateColumns: "28px 1fr 190px" }}>
          <span />
          <span className="text-[11px] font-bold uppercase tracking-wider ink-3">Name</span>
          <span className="text-[11px] font-bold uppercase tracking-wider ink-3">Action</span>
        </div>

        <div style={{ maxHeight: 340, overflowY: "auto" }}>
          {loadingMeta ? (
            <div className="py-10 text-center text-[12px] ink-3">Loading FortiGuard categories…</div>
          ) : groups.length === 0 ? (
            <div className="py-10 text-center text-[12px] ink-3">No categories returned by the device.</div>
          ) : (
            groups.map(({ group, cats }) => {
              const isCollapsed = collapsed.has(group);
              const allSel = cats.every((c) => selected.has(c.id));
              return (
                <div key={group}>
                  <div className="group-band">
                    <input type="checkbox" checked={allSel} onChange={() => toggleGroupSel(cats)}
                      className="h-3.5 w-3.5 cursor-pointer" style={{ accentColor: currentColor }} />
                    <button type="button" onClick={() => toggleCollapse(group)} className="flex items-center gap-1.5">
                      {isCollapsed ? <FiChevronRight size={13} /> : <FiChevronDown size={13} />}
                      <span>{group}</span>
                    </button>
                    <span className="group-count">{cats.length}</span>
                  </div>

                  {!isCollapsed && cats.map((c) => (
                    <div key={c.id}
                      className="grid items-center border-b hairline-2 px-3 py-1.5 surface-hover"
                      style={{ gridTemplateColumns: "28px 1fr 190px" }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)}
                        className="h-3.5 w-3.5 cursor-pointer" style={{ accentColor: currentColor }} />
                      <span className="truncate pr-2 text-[13px] ink">{c.name}</span>
                      <ActionBadge action={actionOf(c.id)} />
                    </div>
                  ))}
                </div>
              );
            })
          )}
        </div>

        {/* footer quota/count bar — mirrors the GUI's "N% [total]" strip */}
        <div className="flex items-center gap-2 border-t hairline px-3 py-1.5">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full surface-sunken">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: currentColor }} />
          </div>
          <span className="text-[10px] font-semibold ink-3">{pct}%</span>
          <span className="rounded-[5px] surface-sunken px-2 text-[10px] font-bold ink-2">{totalCats}</span>
        </div>
      </div>
    </div>
  );
};

// ─── Static Domain Filter (domain table + external block lists + DNS translation) ─────

const DOMAIN_TYPES: { v: DNSDomainEntry["type"]; l: string }[] = [
  { v: "simple", l: "Simple" }, { v: "regex", l: "Regular Expression" }, { v: "wildcard", l: "Wildcard" },
];
const DOMAIN_ACTIONS: { v: DNSDomainEntry["action"]; l: string }[] = [
  { v: "block", l: "Block" }, { v: "allow", l: "Allow" }, { v: "monitor", l: "Monitor" },
];
const STATUS: { v: "enable" | "disable"; l: string }[] = [
  { v: "enable", l: "Enable" }, { v: "disable", l: "Disable" },
];
const labelOf = <T extends string>(opts: { v: T; l: string }[], v: T) => opts.find((o) => o.v === v)?.l ?? v;

const NEW_DOMAIN: DNSDomainEntry = { domain: "", type: "simple", action: "block", status: "enable" };
const NEW_TRANSLATION: DNSTranslationEntry = { src: "", dst: "", netmask: "255.255.255.255", status: "enable" };

const StatusBadge: React.FC<{ status: "enable" | "disable" }> = ({ status }) => (
  <span className={`chip ${status === "enable" ? "chip-ok" : ""}`}>
    <span className={`h-1.5 w-1.5 rounded-full ${status === "enable" ? "bg-emerald-500" : "dot-muted"}`} />
    {status === "enable" ? "Enable" : "Disable"}
  </span>
);

const ToggleLine: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void; color: string; info?: string }> =
  ({ label, checked, onChange, color, info }) => (
    <div className="flex items-center gap-3">
      <span className="text-[12px] font-medium ink-2" title={info}>{label}</span>
      <Toggle label={label} checked={checked} onChange={onChange} color={color} />
    </div>
  );

const drawerInputCls = "h-8 w-full rounded border hairline bg-yellow-50 px-2.5 text-[13px] ink outline-none  dark:bg-yellow-900/10 ";

// Chip multi-select for External IP Block Lists (system/external-resource names).
const ResourcePicker: React.FC<{
  values: string[]; options: string[]; currentColor: string; onChange: (v: string[]) => void;
}> = ({ values, options, currentColor, onChange }) => {
  const [open, setOpen] = useState(false);
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div className="relative w-80">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded border hairline surface-card px-1.5 py-1">
        {values.length === 0 && <span className="px-1 text-[12px] ink-3">Select external resources</span>}
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: currentColor, backgroundColor: `${currentColor}14` }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}><FiX size={11} /></button>
          </span>
        ))}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="ml-auto flex h-5 w-5 items-center justify-center rounded ink-3 surface-hover">
          <FiPlus size={13} />
        </button>
      </div>
      {open && (
        <>
          <div role="presentation" className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-[4px] border hairline surface-card py-1 shadow-lg">
            {remaining.length === 0 ? (
              <div className="px-3 py-2 text-[12px] ink-3">
                {options.length === 0
                  ? "This device has no external resources — add one under Security Fabric → External Connectors"
                  : "No more entries"}
              </div>
            ) : remaining.map((o) => (
              <button key={o} type="button" onClick={() => { onChange([...values, o]); setOpen(false); }}
                className="block w-full px-3 py-1.5 text-left text-[12px] ink surface-hover">
                {o}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const DNSStaticDomainFilter: React.FC<{
  form: DNSFilterProfileForm; set: SetFn; meta: DNSFilterMetadata; currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const [domainDraft, setDomainDraft] = useState<{ entry: DNSDomainEntry; index: number | null } | null>(null);
  const [transDraft, setTransDraft] = useState<{ entry: DNSTranslationEntry; index: number | null } | null>(null);

  const saveDomain = () => {
    if (!domainDraft) return;
    const next = [...form.domain_filter_entries];
    if (domainDraft.index === null) next.push(domainDraft.entry);
    else next[domainDraft.index] = domainDraft.entry;
    set("domain_filter_entries", next);
    setDomainDraft(null);
  };
  const saveTrans = () => {
    if (!transDraft) return;
    const next = [...form.dns_translation_entries];
    if (transDraft.index === null) next.push(transDraft.entry);
    else next[transDraft.index] = transDraft.entry;
    set("dns_translation_entries", next);
    setTransDraft(null);
  };

  const patchDomain = (p: Partial<DNSDomainEntry>) =>
    domainDraft && setDomainDraft({ ...domainDraft, entry: { ...domainDraft.entry, ...p } });
  const patchTrans = (p: Partial<DNSTranslationEntry>) =>
    transDraft && setTransDraft({ ...transDraft, entry: { ...transDraft.entry, ...p } });

  return (
    <div className="space-y-4 px-6 py-5">
      {/* Domain Filter */}
      <ToggleLine label="Domain Filter" checked={form.domain_filter} color={currentColor}
        onChange={(v) => set("domain_filter", v)} />
      {form.domain_filter && (
        <FilterTable<DNSDomainEntry>
          rows={form.domain_filter_entries} color={currentColor} gridCols="2fr 1.2fr 1fr 1fr"
          matches={(r, q) => r.domain.toLowerCase().includes(q)}
          columns={[
            { key: "domain", header: "Domain", render: (r) => r.domain },
            { key: "type", header: "Type", render: (r) => labelOf(DOMAIN_TYPES, r.type) },
            { key: "action", header: "Action", render: (r) => labelOf(DOMAIN_ACTIONS, r.action) },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
          onCreate={() => setDomainDraft({ entry: { ...NEW_DOMAIN }, index: null })}
          onEdit={(i) => setDomainDraft({ entry: { ...form.domain_filter_entries[i] }, index: i })}
          onDelete={(i) => set("domain_filter_entries", form.domain_filter_entries.filter((_, x) => x !== i))}
        />
      )}

      {/* External IP Block Lists */}
      <div className="flex items-center gap-3">
        <span className="text-[12px] font-medium ink-2">External IP Block Lists</span>
        <Toggle label="External IP block lists" checked={form.external_ip_blocklist} color={currentColor}
          onChange={(v) => set("external_ip_blocklist", v)} />
        {form.external_ip_blocklist && (
          <ResourcePicker values={form.external_ip_blocklist_names} options={meta.external_resources}
            currentColor={currentColor} onChange={(v) => set("external_ip_blocklist_names", v)} />
        )}
      </div>

      {/* DNS Translation */}
      <ToggleLine label="DNS Translation" checked={form.dns_translation} color={currentColor}
        info="Rewrite the address in a DNS reply — the client resolves the original destination to the translated one."
        onChange={(v) => set("dns_translation", v)} />
      {form.dns_translation && (
        <FilterTable<DNSTranslationEntry>
          rows={form.dns_translation_entries} color={currentColor} gridCols="1.4fr 1.4fr 1.4fr 1fr"
          matches={(r, q) => r.src.toLowerCase().includes(q) || r.dst.toLowerCase().includes(q)}
          columns={[
            { key: "src", header: "Original Destination", render: (r) => r.src },
            { key: "dst", header: "Translated Destination", render: (r) => r.dst },
            { key: "netmask", header: "Network Mask/Prefix", render: (r) => r.netmask },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={r.status} /> },
          ]}
          onCreate={() => setTransDraft({ entry: { ...NEW_TRANSLATION }, index: null })}
          onEdit={(i) => setTransDraft({ entry: { ...form.dns_translation_entries[i] }, index: i })}
          onDelete={(i) => set("dns_translation_entries", form.dns_translation_entries.filter((_, x) => x !== i))}
        />
      )}

      {/* Domain rule drawer */}
      <SideDrawer open={!!domainDraft} color={currentColor}
        title={domainDraft?.index === null ? "New Domain Filter" : "Edit Domain Filter"}
        canSave={!!domainDraft && domainDraft.entry.domain.trim().length > 0}
        onOK={saveDomain} onCancel={() => setDomainDraft(null)}>
        {domainDraft && (
          <>
            <DrawerRow label="Domain">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus value={domainDraft.entry.domain} className={drawerInputCls}
                placeholder="e.g. *.facebook.com"
                onChange={(e) => patchDomain({ domain: e.target.value })} />
            </DrawerRow>
            <DrawerRow label="Type">
              <SegmentedPills label="Domain entry type" opts={DOMAIN_TYPES} value={domainDraft.entry.type} color={currentColor}
                onChange={(v) => patchDomain({ type: v })} />
            </DrawerRow>
            <DrawerRow label="Action">
              <SegmentedPills label="Domain entry action" opts={DOMAIN_ACTIONS} value={domainDraft.entry.action} color={currentColor}
                onChange={(v) => patchDomain({ action: v })} />
            </DrawerRow>
            <DrawerRow label="Status">
              <SegmentedPills label="Domain entry status" opts={STATUS} value={domainDraft.entry.status} color={currentColor}
                onChange={(v) => patchDomain({ status: v })} />
            </DrawerRow>
          </>
        )}
      </SideDrawer>

      {/* DNS translation drawer */}
      <SideDrawer open={!!transDraft} color={currentColor}
        title={transDraft?.index === null ? "New DNS Translation" : "Edit DNS Translation"}
        canSave={!!transDraft && transDraft.entry.src.trim().length > 0 && transDraft.entry.dst.trim().length > 0}
        onOK={saveTrans} onCancel={() => setTransDraft(null)}>
        {transDraft && (
          <>
            <DrawerRow label="Original Destination">
              {/* eslint-disable-next-line jsx-a11y/no-autofocus -- the drawer has just opened over the page, so focus belongs on its first field rather than on whatever the page had focused before it */}
              <input autoFocus value={transDraft.entry.src} className={drawerInputCls} placeholder="e.g. 10.1.1.1"
                onChange={(e) => patchTrans({ src: e.target.value })} />
            </DrawerRow>
            <DrawerRow label="Translated Destination">
              <input value={transDraft.entry.dst} className={drawerInputCls} placeholder="e.g. 10.2.2.2"
                onChange={(e) => patchTrans({ dst: e.target.value })} />
            </DrawerRow>
            <DrawerRow label="Network Mask">
              <input value={transDraft.entry.netmask} className={drawerInputCls} placeholder="255.255.255.0"
                onChange={(e) => patchTrans({ netmask: e.target.value })} />
            </DrawerRow>
            <DrawerRow label="Status">
              <SegmentedPills label="External list status" opts={STATUS} value={transDraft.entry.status} color={currentColor}
                onChange={(v) => patchTrans({ status: v })} />
            </DrawerRow>
          </>
        )}
      </SideDrawer>
    </div>
  );
};
