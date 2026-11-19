import React, { useMemo, useState } from "react";
import { FiSearch, FiX, FiPlus, FiAlertTriangle } from "react-icons/fi";

/**
 * The two-column member picker both group forms use.
 *
 * Left: everything on the device that could be a member, searchable. Right: what is in the group,
 * in the order it will be written. Clicking moves an entry between them.
 *
 * ── Why the order is shown and kept ──────────────────────────────────────────
 *
 * It does not matter to FortiOS — a group is a set. It matters to the person editing it six months
 * later, because the order is the only place the reasoning survives. So the list is not re-sorted
 * behind the operator's back.
 *
 * ── The one piece of real logic here ─────────────────────────────────────────
 *
 * `nested` marks candidates that are themselves groups. Nesting is legal and useful, and it is
 * also how somebody accidentally builds a group that contains itself two levels down — which
 * FortiOS rejects with a code that does not say so. The picker cannot see two levels down, so it
 * does what it honestly can: it refuses the direct self-reference, and it LABELS the nested ones
 * so the operator knows a chain exists.
 */

export type Candidate = {
  name: string;
  /** Sub-label: the address's subnet, the service's ports. */
  detail?: string;
  /** True when this candidate is itself a group — shown, because nesting has consequences. */
  nested?: boolean;
};

type Props = {
  candidates: Candidate[];
  /** Selected members, in the order they will be written. */
  value: string[];
  onChange: (next: string[]) => void;
  /** The group being edited — it can never be its own member. */
  selfName?: string;
  /** "address", "service" — used in the empty and placeholder text. */
  noun: string;
  /** Set when the candidate list could not be read, so the picker says so rather than looking empty. */
  loadError?: string | null;
};

const MemberPicker: React.FC<Props> = ({
  candidates, value, onChange, selfName, noun, loadError,
}) => {
  const [q, setQ] = useState("");

  const chosen = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);

  const available = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return candidates.filter((c) => {
      if (chosen.has(c.name.toLowerCase())) return false;
      if (selfName && c.name.toLowerCase() === selfName.trim().toLowerCase()) return false;
      if (!needle) return true;
      return c.name.toLowerCase().includes(needle)
        || (c.detail ?? "").toLowerCase().includes(needle);
    });
  }, [candidates, chosen, q, selfName]);

  const detailOf = useMemo(() => {
    const m = new Map<string, Candidate>();
    candidates.forEach((c) => m.set(c.name.toLowerCase(), c));
    return m;
  }, [candidates]);

  const add = (name: string) => onChange([...value, name]);
  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* Available */}
      <div className="panel panel-flush flex flex-col" style={{ height: 268 }}>
        <div className="flex items-center gap-2 border-b hairline-2 px-3 py-2">
          <FiSearch size={13} className="ink-3 shrink-0" />
          <label htmlFor="member-search" className="sr-only">Search {noun}s</label>
          <input id="member-search" value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder={`Search ${noun}s…`}
                 className="w-full bg-transparent text-[12px] outline-none ink" />
          <span className="t-meta shrink-0">{available.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loadError && (
            <div className="banner banner-warn m-2">
              <FiAlertTriangle size={13} className="shrink-0" />
              <span>{`Could not read the ${noun} list (${loadError}). This is unreadable, not empty.`}</span>
            </div>
          )}
          {!loadError && available.length === 0 && (
            <p className="t-meta m-0 px-3 py-6 text-center">
              {q ? `No ${noun} matches "${q}"` : `Every ${noun} is already a member`}
            </p>
          )}
          {available.map((c) => (
            <button key={c.name} type="button" onClick={() => add(c.name)}
                    className="flex w-full items-center gap-2 border-b hairline-2 px-3 py-1.5 text-left surface-hover">
              <FiPlus size={12} className="ink-3 shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium ink">{c.name}</span>
                {c.detail && <span className="block truncate t-meta">{c.detail}</span>}
              </span>
              {c.nested && <span className="chip chip-info shrink-0">group</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Chosen */}
      <div className="panel panel-flush flex flex-col" style={{ height: 268 }}>
        <div className="flex items-center justify-between border-b hairline-2 px-3 py-2">
          <span className="t-label m-0">Members</span>
          <span className={`t-meta ${value.length === 0 ? "text-red-500" : ""}`}>{value.length}</span>
        </div>

        <div className="flex-1 overflow-y-auto">
          {value.length === 0 ? (
            <div className="px-3 py-6 text-center">
              <p className="t-meta m-0">No members yet</p>
              <p className="t-meta m-0 mt-1 text-red-500">
                An empty group matches nothing, so a policy using it would silently pass no traffic
              </p>
            </div>
          ) : (
            value.map((name, i) => {
              const c = detailOf.get(name.toLowerCase());
              return (
                <div key={`${name}-${i}`}
                     className="flex items-center gap-2 border-b hairline-2 px-3 py-1.5">
                  <span className="t-meta shrink-0 w-5 tabular-nums">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium ink">{name}</span>
                    {c?.detail && <span className="block truncate t-meta">{c.detail}</span>}
                    {/* A member the device does not list is not a typo we can fix silently — it
                        may be an object created since this page loaded, or one that was deleted
                        out from under the group. Either way, say so. */}
                    {!c && (
                      <span className="block truncate t-meta text-amber-600 dark:text-amber-400">
                        {`not in the current ${noun} list`}
                      </span>
                    )}
                  </span>
                  {c?.nested && <span className="chip chip-info shrink-0">group</span>}
                  <button type="button" onClick={() => remove(name)}
                          aria-label={`Remove ${name}`} className="btn-icon shrink-0">
                    <FiX size={12} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MemberPicker;
