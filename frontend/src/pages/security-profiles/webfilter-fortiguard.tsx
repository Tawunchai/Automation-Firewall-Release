import React, { useMemo, useState } from "react";
import { FiAlertTriangle, FiUser, FiChevronDown, FiChevronRight, FiAlertCircle, FiX, FiPlus } from "react-icons/fi";
import type {
  WebFilterProfileForm, WebFilterAction, WebFilterMetadata, WebFilterCategoryMeta,
  WebFilterCategoryAction, WebFilterOverride,
} from "../../api/policyObject";
import { WF_ACTIONS } from "./webfilter-fortiguard.logic";
import type { ActionMeta } from "./webfilter-fortiguard.logic";

// ─── Action vocabulary (matches the FortiGate category-filter toolbar) ───────────────
const ACTION_BY_VALUE = Object.fromEntries(WF_ACTIONS.map((a) => [a.value, a])) as Record<WebFilterAction, ActionMeta>;

export type WFPreset = "custom" | "G" | "PG-13" | "R";
const PRESETS: WFPreset[] = ["custom", "G", "PG-13", "R"];
const PRESET_LABEL: Record<WFPreset, string> = { custom: "Custom", G: "G", "PG-13": "PG-13", R: "R" };

// FortiGate renders the category groups in this fixed order (Local Categories first).
const GROUP_ORDER = [
  "Local Categories", "Potentially Liable", "Adult/Mature Content", "Bandwidth Consuming",
  "Security Risk", "General Interest - Personal", "General Interest - Business", "Unrated",
];

// ─── Action badge shown at the end of every category row ─────────────────────────────
// An "authenticate" category is meaningless without its user group(s), so the badge names them
// (and warns when they're missing — the device would reject the save with -149).
const ActionBadge: React.FC<{ action: WebFilterAction; authGroups?: string[] }> = ({ action, authGroups }) => {
  const a = ACTION_BY_VALUE[action] ?? ACTION_BY_VALUE.allow;
  const groups = authGroups ?? [];
  const missing = action === "authenticate" && groups.length === 0;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[11px] font-semibold"
      style={{ color: missing ? "#dc2626" : a.color, backgroundColor: missing ? "#dc262614" : a.bg }}
      title={action === "authenticate" ? (missing ? "No user group — the device will reject this" : groups.join(", ")) : undefined}>
      {missing ? <FiAlertCircle size={12} /> : a.icon}
      {a.label}
      {action === "authenticate" && groups.length > 0 && (
        <span className="font-normal opacity-70">· {groups.join(", ")}</span>
      )}
    </span>
  );
};

// ─── FortiGuard Category Based Filter — presets, action toolbar, grouped tree ─────────
export const WFFortiGuardFilter: React.FC<{
  form: WebFilterProfileForm;
  set: <K extends keyof WebFilterProfileForm>(k: K, v: WebFilterProfileForm[K]) => void;
  meta: WebFilterMetadata;
  currentColor: string;
  loadingMeta: boolean;
}> = ({ form, set, meta, currentColor, loadingMeta }) => {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Local categories first, then every FortiGuard category, grouped in GUI order.
  const allCats = useMemo<WebFilterCategoryMeta[]>(
    () => [...meta.local_categories, ...meta.categories],
    [meta]
  );
  const groups = useMemo(
    () => GROUP_ORDER
      .map((g) => ({ group: g, cats: allCats.filter((c) => c.group === g) }))
      .filter((x) => x.cats.length > 0),
    [allCats]
  );

  const catMap = useMemo(() => {
    const m = new Map<number, WebFilterCategoryAction>();
    form.categories.forEach((c) => m.set(c.category, c));
    return m;
  }, [form.categories]);
  const actionOf = (id: number): WebFilterAction => catMap.get(id)?.action ?? "allow";
  const groupsOf = (id: number): string[] => catMap.get(id)?.auth_groups ?? [];

  // Rebuild form.categories from a map, dropping "allow" (allow = no stored entry). authGroups is
  // carried only by "authenticate" categories — FortiOS needs it there and rejects the profile
  // without it.
  const setActions = (ids: number[], action: WebFilterAction, authGroups: string[] = []) => {
    const m = new Map(form.categories.map((c) => [c.category, c] as const));
    ids.forEach((id) => {
      if (action === "allow") m.delete(id);
      else m.set(id, { category: id, action, ...(action === "authenticate" ? { auth_groups: authGroups } : {}) });
    });
    set("categories", [...m.values()]);
  };

  // "Authenticate" can't be applied straight from the toolbar: it needs the user group(s) that may
  // authenticate past the category, so the button opens a picker first.
  const [authPick, setAuthPick] = useState<string[] | null>(null);

  // Presets. Custom = each category's FortiGuard default; G/PG-13/R = block anything the
  // rating blocks, allow the rest (derived from blocked_in_ratings — verified live).
  const applyPreset = (p: WFPreset) => {
    if (p === "custom") {
      set("categories", allCats
        .filter((c) => (c.default_action ?? "allow") !== "allow")
        .map((c) => ({ category: c.id, action: (c.default_action as WebFilterAction) })));
    } else {
      set("categories", allCats
        .filter((c) => (c.blocked_in_ratings ?? []).includes(p))
        .map((c) => ({ category: c.id, action: "block" as WebFilterAction })));
    }
  };
  const matchesRating = (p: "G" | "PG-13" | "R") =>
    allCats.length > 0 && allCats.every((c) =>
      actionOf(c.id) === ((c.blocked_in_ratings ?? []).includes(p) ? "block" : "allow"));
  const activePreset: WFPreset = matchesRating("G") ? "G" : matchesRating("PG-13") ? "PG-13" : matchesRating("R") ? "R" : "custom";

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
  const nonAllow = form.categories.length;
  const pct = totalCats ? Math.round((nonAllow / totalCats) * 100) : 0;

  return (
    <div className="px-6 py-5 space-y-3">
      {/* License warning banner (shown when FortiGuard web-filtering isn't licensed) */}
      {!meta.web_filter_licensed && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2.5 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" />
          <div className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-400">
            <p className="font-semibold">Warning: This device is not licensed for the FortiGuard web filtering service.</p>
            <p>Traffic may be blocked if this option is enabled.</p>
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
        {WF_ACTIONS.map((a, i) => {
          // Authenticate needs user group(s) — no groups on the device means the action can't be
          // saved at all, so it's disabled rather than failing later with -149.
          const noGroups = a.value === "authenticate" && meta.user_groups.length === 0;
          return (
            <button key={a.value} type="button" disabled={selected.size === 0 || noGroups}
              title={noGroups ? "This device has no user groups — create one first" : undefined}
              onClick={() => (a.value === "authenticate" ? setAuthPick([]) : setActions([...selected], a.value))}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${i > 0 ? "border-l hairline" : ""} surface-hover`}
              style={{ color: selected.size === 0 || noGroups ? undefined : a.color }}>
              {a.icon} {a.label}
            </button>
          );
        })}
        {selected.size > 0 && (
          <span className="px-3 text-[11px] ink-3">{selected.size} selected</span>
        )}
      </div>

      {/* Authenticate → pick the user group(s) allowed through (ftgd-wf auth-usr-grp) */}
      {authPick !== null && (
        <div className="rounded-[4px] border hairline surface-sunken px-4 py-3">
          <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold ink">
            <FiUser size={13} /> Authenticate — which user groups may proceed?
          </p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {meta.user_groups.map((g) => {
              const on = authPick.includes(g);
              return (
                <button key={g} type="button"
                  onClick={() => setAuthPick(on ? authPick.filter((x) => x !== g) : [...authPick, g])}
                  className={`rounded-[4px] border px-2.5 py-1 text-[11px] font-semibold transition ${on ? "text-white" : "hairline ink-2 surface-hover"}`}
                  style={on ? { backgroundColor: currentColor, borderColor: currentColor } : undefined}>
                  {g}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={authPick.length === 0}
              onClick={() => { setActions([...selected], "authenticate", authPick); setAuthPick(null); }}
              className="rounded-[4px] px-3 py-1 text-[12px] font-semibold text-white transition disabled:opacity-40"
              style={{ backgroundColor: currentColor }}>
              Apply to {selected.size} categor{selected.size === 1 ? "y" : "ies"}
            </button>
            <button type="button" onClick={() => setAuthPick(null)}
              className="rounded-[4px] border hairline px-3 py-1 text-[12px] font-semibold ink-2 surface-hover">
              Cancel
            </button>
            {authPick.length === 0 && (
              <span className="text-[11px] ink-3">Pick at least one group — FortiGate rejects the profile without it</span>
            )}
          </div>
        </div>
      )}

      {/* Category tree */}
      <div className="overflow-hidden rounded-[4px] border hairline">
        {/* header */}
        <div className="grid items-center border-b hairline surface-sunken px-3 py-1.5"
          style={{ gridTemplateColumns: "28px 1fr 130px" }}>
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
                  {/* group header */}
                  <div className="group-band">
                    <input type="checkbox" checked={allSel} onChange={() => toggleGroupSel(cats)}
                      className="h-3.5 w-3.5 cursor-pointer accent-current" style={{ accentColor: currentColor }} />
                    <button type="button" onClick={() => toggleCollapse(group)} className="flex items-center gap-1.5">
                      {isCollapsed ? <FiChevronRight size={13} /> : <FiChevronDown size={13} />}
                      <span>{group}</span>
                    </button>
                    <span className="group-count">{cats.length}</span>
                  </div>

                  {/* rows */}
                  {!isCollapsed && cats.map((c) => (
                    <div key={c.id}
                      className="grid items-center border-b hairline-2 px-3 py-1.5 surface-hover"
                      style={{ gridTemplateColumns: "28px 1fr 130px" }}>
                      <input type="checkbox" checked={selected.has(c.id)} onChange={() => toggleSel(c.id)}
                        className="h-3.5 w-3.5 cursor-pointer" style={{ accentColor: currentColor }} />
                      <span className="truncate pr-2 text-[13px] ink">{c.name}</span>
                      <ActionBadge action={actionOf(c.id)} authGroups={groupsOf(c.id)} />
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

// ─── Compact chip multi-select for the override group/profile pickers ────────────────
const ChipMultiSelect: React.FC<{
  values: string[]; options: string[]; placeholder: string; currentColor: string;
  onChange: (v: string[]) => void;
}> = ({ values, options, placeholder, currentColor, onChange }) => {
  const [open, setOpen] = useState(false);
  const remaining = options.filter((o) => !values.includes(o));
  return (
    <div className="relative w-[320px]">
      <div className="flex min-h-8 flex-wrap items-center gap-1 rounded border hairline surface-card px-1.5 py-1">
        {values.length === 0 && (
          <span className="px-1 text-[12px] ink-3">{placeholder}</span>
        )}
        {values.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-semibold"
            style={{ color: currentColor, backgroundColor: `${currentColor}14` }}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))}>
              <FiX size={11} />
            </button>
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
              <div className="px-3 py-2 text-[12px] ink-3">No more entries</div>
            ) : remaining.map((o) => (
              <button key={o} type="button"
                onClick={() => { onChange([...values, o]); setOpen(false); }}
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

// ─── "Allow users to override blocked categories" expanded sub-form ──────────────────
const SCOPES: { value: WebFilterOverride["scope"]; label: string }[] = [
  { value: "user", label: "User" }, { value: "user-group", label: "User Groups" },
  { value: "ip", label: "IP" }, { value: "ask", label: "Ask" },
];

export const WFOverridePanel: React.FC<{
  form: WebFilterProfileForm;
  set: <K extends keyof WebFilterProfileForm>(k: K, v: WebFilterProfileForm[K]) => void;
  meta: WebFilterMetadata;
  currentColor: string;
}> = ({ form, set, meta, currentColor }) => {
  const o = form.override;
  const patch = (p: Partial<WebFilterOverride>) => set("override", { ...o, ...p });
  const labelCls = "text-[12px] font-medium ink-2 w-[160px] shrink-0";
  const numCls = "h-8 w-16 rounded border hairline surface-card px-2 text-center text-[13px] ink outline-none";
  const num = (v: number) => (Number.isFinite(v) ? v : 0);

  const Segmented = <T extends string>(opts: { value: T; label: string }[], value: T, onChange: (v: T) => void) => (
    <div className="inline-flex overflow-hidden rounded-[4px] border hairline">
      {opts.map((opt, i) => {
        const active = value === opt.value;
        return (
          <button key={opt.value} type="button" onClick={() => onChange(opt.value)}
            className={`px-3 py-1 text-[12px] font-semibold transition-colors ${active ? "text-white" : "ink-2 surface-hover"} ${i > 0 ? "border-l hairline" : ""}`}
            style={active ? { backgroundColor: currentColor } : undefined}>
            {opt.label}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="space-y-3 surface-sunken px-6 py-4">
      <div role="group" aria-labelledby="groups-that-can-override-label" className="flex items-center gap-3">
        <span id="groups-that-can-override-label" className={labelCls}>Groups that can override</span>
        <ChipMultiSelect values={o.groups} options={meta.user_groups} placeholder="Select user groups"
          currentColor={currentColor} onChange={(v) => patch({ groups: v })} />
      </div>
      <div role="group" aria-labelledby="profile-name-label" className="flex items-center gap-3">
        <span id="profile-name-label" className={labelCls}>Profile Name</span>
        <ChipMultiSelect values={o.profiles} options={meta.profiles} placeholder="Select profiles"
          currentColor={currentColor} onChange={(v) => patch({ profiles: v })} />
      </div>
      <div role="group" aria-labelledby="switch-applies-to-label" className="flex items-center gap-3">
        <span id="switch-applies-to-label" className={labelCls}>Switch applies to</span>
        {Segmented(SCOPES, o.scope, (v) => patch({ scope: v }))}
      </div>

      {/* The 'Source' reminder only applies when the override is scoped to a user/user-group —
          for IP or Ask the original user need not be the policy Source, so the GUI hides it. */}
      {(o.scope === "user" || o.scope === "user-group") && (
        <div className="flex items-start gap-2.5 rounded-[4px] border border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-500/25 dark:bg-amber-500/10">
          <FiAlertCircle size={14} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="text-[12px] text-amber-700 dark:text-amber-400">
            The original user or group must be specified as the 'Source' in firewall policies using this profile
          </p>
        </div>
      )}

      <div role="group" aria-labelledby="switch-duration-label" className="flex items-center gap-3">
        <span id="switch-duration-label" className={labelCls}>Switch Duration</span>
        {Segmented(
          [{ value: "predefined" as const, label: "Predefined" }, { value: "ask" as const, label: "Ask" }],
          o.duration_mode, (v) => patch({ duration_mode: v })
        )}
      </div>
      {o.duration_mode === "predefined" && (
        <div className="flex items-center gap-2 pl-43">
          <input type="number" min={0} value={o.duration_days} className={numCls}
            onChange={(e) => patch({ duration_days: num(+e.target.value) })} />
          <span className="text-[12px] ink-2">day(s)</span>
          <input type="number" min={0} max={23} value={o.duration_hours} className={numCls}
            onChange={(e) => patch({ duration_hours: num(+e.target.value) })} />
          <span className="text-[12px] ink-2">hour(s)</span>
          <input type="number" min={0} max={59} value={o.duration_minutes} className={numCls}
            onChange={(e) => patch({ duration_minutes: num(+e.target.value) })} />
          <span className="text-[12px] ink-2">minute(s)</span>
        </div>
      )}
    </div>
  );
};
