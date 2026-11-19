import React, { useMemo, useState } from "react";
import { FiArrowRight, FiSearch } from "react-icons/fi";
import type { TrafficLogRow } from "../../api/logs";
import { clampPage, formatBytes, pageSlice } from "./format";
import LogPager from "./LogPager";
import { conversations, GROUP_CHIP, type ResultGroup } from "./story";

// The log as conversations: every entry that is the same exchange — same source, destination,
// service and policy — folded into one line that says where it went, how, which rule handled it,
// how often, and how it tended to end.
//
// This is the view that answers "where is the traffic going". The lab unit's 200 entries are about a
// dozen conversations; as rows they read as a wall, as lines they read as a list.

const Conversations: React.FC<{
  rows: TrafficLogRow[];
  hues: Record<ResultGroup, string>;
  onPivot: (expression: string) => void;
}> = ({ rows, hues, onPivot }) => {
  const list = useMemo(() => conversations(rows), [rows]);

  // Paged in memory, the same 20-a-page the "Every entry" view uses, so a long list of
  // conversations gets a Previous/Next instead of one endless scroll. The page is reset the moment
  // the underlying set changes shape (a new search, a different source) — done during render rather
  // than in an effect, so page 3 of the old data is never shown over the new.
  const [pageIndex, setPageIndex] = useState(0);
  const [trackedLen, setTrackedLen] = useState(list.length);
  if (list.length !== trackedLen) {
    setTrackedLen(list.length);
    setPageIndex(0);
  }
  const safePage = clampPage(pageIndex, list.length);
  const visible = pageSlice(list, safePage);

  if (list.length === 0) return null;

  return (
    <div className="space-y-2 p-3">
      {visible.map((c) => (
        <div key={c.key}
          className="grid items-center gap-x-4 gap-y-1 rounded-[4px] border hairline-2 surface-card px-3.5 py-2.5 transition-colors surface-hover"
          style={{ gridTemplateColumns: "minmax(0,2.3fr) minmax(0,1.4fr) 150px auto" }}>
          {/* Who → where, and how */}
          <div className="min-w-0">
            <p className="m-0 flex min-w-0 items-center gap-1.5 text-[12.5px] ink">
              <span className="truncate font-semibold">{c.source}</span>
              <FiArrowRight size={12} className="shrink-0 ink-3" />
              <span className="truncate font-semibold">{c.destination}</span>
              {c.country && <span className="t-meta shrink-0">{c.country}</span>}
            </p>
            <p className="t-meta m-0 truncate">
              {c.destination !== c.destinationIp && <span className="font-mono">{c.destinationIp} · </span>}
              {c.service}{c.path ? ` · ${c.path}` : ""}
            </p>
          </div>

          {/* Which rule, and how it ended — the headline is the WORST result present */}
          <div className="min-w-0">
            <p className="m-0 truncate text-[12px] ink-2" title={c.policy}>{c.policy}</p>
            <span className={`${GROUP_CHIP[c.result.group]} mt-1 inline-block text-[10.5px]`} title={c.result.why}>
              {c.result.label}
            </span>
          </div>

          {/* How often, split by result */}
          <div className="min-w-0">
            <div className="flex h-1.5 overflow-hidden rounded-full surface-sunken"
              title={`${c.byGroup.ok} allowed · ${c.byGroup.problem} reset or timed out · ${c.byGroup.blocked} blocked`}>
              {(["ok", "problem", "blocked"] as const).map((g) => c.byGroup[g] > 0 && (
                <span key={g} style={{ width: `${(c.byGroup[g] / c.count) * 100}%`, background: hues[g] }} />
              ))}
            </div>
            <p className="t-meta m-0 mt-1 tnum">
              {c.count === 1 ? `1 time · ${formatBytes(c.bytes)}` : `${c.count} times · ${formatBytes(c.bytes)}`}
            </p>
          </div>

          <button type="button" onClick={() => onPivot(c.pivot)} title={`Search: ${c.pivot}`}
            className="btn btn-ghost btn-sm hairline gap-1.5 border whitespace-nowrap">
            <FiSearch size={11} /> Entries
          </button>
        </div>
      ))}
      <div className="flex items-center justify-end pt-1">
        <LogPager total={list.length} index={safePage} onChange={setPageIndex} />
      </div>
    </div>
  );
};

export default Conversations;
