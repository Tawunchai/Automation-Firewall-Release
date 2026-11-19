import React, { useEffect, useMemo, useRef, useState } from "react";
import { FiMove, FiChevronDown, FiChevronRight, FiArrowUp, FiArrowDown } from "react-icons/fi";
import type { FirewallPolicy } from "../../api/policyObject";
import type { PolicyFormState } from "../firewall-policy/create.logic";

// PolicyPlacementBoard renders — like the FortiGate policy table — ONLY the interface pair the
// new/edited policy belongs to (e.g. "lan → port1"), because that is the only set of rules whose
// order affects it (first match wins is per interface pair). The policy being placed is a
// draggable amber row.
//
// Placement is REFERENCE-BASED: we track `beforeId` — the id of the existing policy the new one
// should sit BEFORE (null = after the whole relevant group / bottom). Dragging maps the drop
// position to that id; PolicyWizard.applyPlacement() then creates the policy and moves it there.
//
// DRAG MECHANICS (important): the amber row stays MOUNTED AT ITS COMMITTED POSITION during a drag
// (never re-keyed / spliced elsewhere) — moving the drag-source node mid-drag makes the browser
// fire `dragend` early with a stale position, which previously left the policy at the bottom. We
// instead show a thin insertion indicator at the hovered slot and keep the live target in a ref
// (no stale closure), committing once on dragend.

const intfSet = (list: string[] | undefined, single: string): string[] =>
  (list?.length ? list : single ? [single] : []);
const pairSrc = (p: FirewallPolicy) => intfSet(p.src_intf_list, p.src_intf).join(", ") || "any";
const pairDst = (p: FirewallPolicy) => intfSet(p.dst_intf_list, p.dst_intf).join(", ") || "any";
const addrText = (list: string[] | undefined, fallback: string) => (list?.length ? list.join(", ") : fallback);

// isPairRelevant lives in packetSim.ts, which needs the same predicate to decide which rules a
// simulated packet can even be compared against — and is a pure module, so it can be tested
// without mounting a drag-and-drop board. Callers import it from there directly: re-exporting it
// here made this file export a non-component, which is not a fast-refresh boundary.
import { isPairRelevant } from "./packetSim";
import { activateOnKey } from "../../components/ui/keyActivate";

const PolicyPlacementBoard: React.FC<{
  policies: FirewallPolicy[];   // full device rule base in order (includes self when editing)
  selfId: number | null;        // edit: id of the policy being moved; create: null
  form: PolicyFormState;
  beforeId: number | null;      // place the new policy BEFORE this id; null = bottom of its pair
  onChange: (beforeId: number | null) => void;
  currentColor: string;
  isEdit: boolean;
  loading?: boolean;
  // Multi-policy: once a SIBLING policy from the same suggestion is already on the device, this
  // policy's slot is fixed relative to it (drag off, Top/Bottom off) so the two can't collide —
  // requirement "คงตำแหน่งไว้ เลื่อนไม่ได้". `siblingNote` explains the linked placement.
  disabled?: boolean;
  siblingNote?: React.ReactNode;
}> = ({ policies, selfId, form, beforeId, onChange, currentColor, isEdit, loading, disabled = false, siblingNote }) => {
  const existing = useMemo(() => policies.filter((p) => p.id !== selfId), [policies, selfId]);

  // relevant = only the policies on the same interface pair as the new one (in global order).
  const relevant = useMemo(
    () => existing.filter((p) => isPairRelevant(p, form.srcIntf, form.dstIntf)),
    [existing, form.srcIntf, form.dstIntf]
  );

  // tailBeforeId = the policy that immediately follows the LAST relevant one in the full rule base
  // (null = the relevant group already sits at the global bottom). "Bottom of the pair" maps here,
  // so the new policy nestles right after its group without disturbing unrelated rules.
  const tailBeforeId = useMemo<number | null>(() => {
    const last = relevant[relevant.length - 1];
    if (!last) return null;
    const gi = existing.findIndex((p) => p.id === last.id);
    return gi >= 0 && gi < existing.length - 1 ? existing[gi + 1].id : null;
  }, [relevant, existing]);

  const groups = useMemo(() => {
    const order: string[] = [];
    const byKey = new Map<string, FirewallPolicy[]>();
    for (const p of relevant) {
      const key = `${pairSrc(p)} → ${pairDst(p)}`;
      if (!byKey.has(key)) { byKey.set(key, []); order.push(key); }
      byKey.get(key)!.push(p);
    }
    return order.map((key) => ({ key, items: byKey.get(key)! }));
  }, [relevant]);

  // pos = index within `relevant` the amber row sits at; relevant.length = bottom of the pair.
  const beforeIdToPos = (id: number | null) => {
    const i = relevant.findIndex((p) => p.id === id);
    return i < 0 ? relevant.length : i; // null / tail / unknown → bottom
  };
  const posToBeforeId = (p: number) => (p >= relevant.length ? tailBeforeId : relevant[p].id);

  const [pos, setPos] = useState<number>(() => beforeIdToPos(beforeId));
  const [dragging, setDragging] = useState(false);
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const hoverRef = useRef<number>(pos); // live drop target — always current, no stale closure

  // Follow external beforeId changes (e.g. edit seeding) — but never while mid-drag.
  useEffect(() => { if (!dragging) setPos(beforeIdToPos(beforeId)); /* eslint-disable-line */ }, [beforeId, relevant.length]);

  // Normalize the incoming beforeId to a concrete reference for the current relevant set, so
  // "leave at the default bottom" applies exactly where it is shown (right after the pair group).
  useEffect(() => {
    const norm = posToBeforeId(beforeIdToPos(beforeId));
    if (norm !== beforeId) onChange(norm);
    // eslint-disable-next-line
  }, [relevant.length, tailBeforeId]);

  const pairLabel = `${form.srcIntf || "any"} → ${form.dstIntf || "any"}`;

  const commit = (p: number) => {
    const clamped = Math.min(Math.max(p, 0), relevant.length);
    setPos(clamped);
    onChange(posToBeforeId(clamped));
  };
  const setHover = (k: number) => { hoverRef.current = k; setHoverPos(k); };
  const toggle = (key: string) =>
    setCollapsed((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const onRowDragOver = (e: React.DragEvent, flatIndex: number) => {
    if (!dragging) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    setHover(e.clientY < r.top + r.height / 2 ? flatIndex : flatIndex + 1);
  };

  const startDrag = () => { setDragging(true); setHover(pos); };
  const endDrag   = () => { commit(hoverRef.current); setDragging(false); setHoverPos(null); };

  const actionBadge = (action: string) => (
    <span className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold ${action === "deny" ? "bg-red-100 text-red-600" : "bg-emerald-100 text-emerald-700"}`}>
      {action === "deny" ? "DENY" : "ACCEPT"}
    </span>
  );

  // The amber row keeps a STABLE key ("amber-self") and stays at `pos` during a drag.
  const selfRow = (
    <div
      key="amber-self"
      draggable={!disabled}
      onDragStart={(e) => { if (disabled) return; startDrag(); e.dataTransfer.effectAllowed = "move"; }}
      onDragEnd={disabled ? undefined : endDrag}
      className={`flex items-center gap-2 border-l-2 bg-amber-50 px-3 py-2 ${disabled ? "cursor-default" : "cursor-grab active:cursor-grabbing"}`}
      style={{ borderLeftColor: "#f59e0b", opacity: dragging ? 0.5 : 1 }}
      title={disabled ? "Position is locked relative to the sibling policies already created" : "Drag to choose where this policy sits in the rule base"}>
      <FiMove size={13} className={`shrink-0 ${disabled ? "ink-3" : "text-amber-500"}`} />
      <span className="rounded px-1.5 py-0.5 text-[9px] font-bold text-white" style={{ background: "#f59e0b" }}>
        {isEdit ? "THIS" : "NEW"}
      </span>
      <span className="truncate text-[12px] font-bold text-amber-900">{form.name || "(unnamed policy)"}</span>
      <span className="truncate text-[10.5px] text-amber-700/80">
        {addrText(form.srcAddr, "all")} → {addrText(form.dstAddr, "all")}
      </span>
      <span className="ml-auto">{actionBadge(form.action)}</span>
    </div>
  );

  const indicator = (key: string) => (
    <div key={key} className="mx-2 my-0.5 h-1 rounded-full" style={{ background: currentColor }} />
  );

  // Interleave headers + rows; at every slot boundary render the drop indicator (hoverPos) and the
  // committed amber row (pos). The amber never moves during a drag → the native drag stays alive.
  const rows: React.ReactNode[] = [];
  let fi = 0;
  const boundary = (n: number) => {
    if (dragging && hoverPos === n) rows.push(indicator(`ind-${n}`));
    if (pos === n) rows.push(selfRow);
  };
  for (const g of groups) {
    const startFi = fi;
    const isCollapsed = collapsed.has(g.key);
    rows.push(
      <div key={`h-${g.key}`}
        role="button"
        tabIndex={0}
        aria-expanded={!isCollapsed}
        onClick={() => toggle(g.key)}
        onKeyDown={activateOnKey(() => toggle(g.key))}
        onDragOver={(e) => { if (dragging) { e.preventDefault(); setHover(startFi); } }}
        className="group-band cursor-pointer">
        {isCollapsed ? <FiChevronRight size={13} className="shrink-0 opacity-70" /> : <FiChevronDown size={13} className="shrink-0 opacity-70" />}
        <span className="truncate">{g.key}</span>
        <span className="group-count">{g.items.length}</span>
      </div>
    );
    for (const item of g.items) {
      boundary(fi); // indicator + amber before this row
      if (!isCollapsed) {
        const thisFi = fi;
        rows.push(
          <div key={`p-${item.id}`} onDragOver={(e) => onRowDragOver(e, thisFi)}
            className="flex items-center gap-2 border-b hairline-2 surface-card px-3 py-2"
            style={{ opacity: item.enabled === false ? 0.5 : 1 }}>
            <span className="w-5 shrink-0 text-center text-[10px] font-bold ink-3">{item.seq_num}</span>
            <span className="truncate text-[12px] font-semibold ink">
              {item.name || `(unnamed #${item.seq_num})`}
            </span>
            <span className="truncate text-[10.5px] ink-3">
              {addrText(item.src_addr_list, "all")} → {addrText(item.dst_addr_list, "all")}
            </span>
            <span className="ml-auto">{actionBadge(item.action)}</span>
          </div>
        );
      }
      fi++;
    }
  }
  boundary(relevant.length); // indicator + amber at the very bottom of the pair

  const atTop = pos === 0;
  const atBottom = pos >= relevant.length;

  return (
    <div>
      {/* Sibling-placement banner (multi-policy): explains the linked / locked slot. */}
      {siblingNote && (
        <div className="flex items-start gap-2 border-b border-amber-100 bg-amber-50 px-3 py-2 text-[10.5px] leading-relaxed text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          {siblingNote}
        </div>
      )}
      {/* Toolbar: which pair we're placing within + Top/Bottom shortcuts */}
      <div className="flex items-center justify-between gap-2 border-b hairline-2 px-3 py-2">
        <p className="truncate text-[10.5px] ink-3">
          Only the <span className="font-semibold ink-2">{pairLabel}</span> pair — where this policy matches.
        </p>
        {!disabled && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" onClick={() => commit(0)} disabled={atTop}
              className="flex items-center gap-1 rounded-[4px] border hairline px-2 py-1 text-[10px] font-semibold ink-2 transition surface-hover disabled:opacity-40">
              <FiArrowUp size={10} /> Top
            </button>
            <button type="button" onClick={() => commit(relevant.length)} disabled={atBottom}
              className="flex items-center gap-1 rounded-[4px] border hairline px-2 py-1 text-[10px] font-semibold ink-2 transition surface-hover disabled:opacity-40">
              <FiArrowDown size={10} /> Bottom
            </button>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center gap-2 px-3 py-8 text-[12px] ink-3">
          <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 hairline border-t-transparent" />
          Loading device rule base…
        </div>
      ) : relevant.length === 0 ? (
        <div className="px-3 py-4">
          <div className="group-band -mx-3 mb-2">
            <span className="truncate">{pairLabel}</span>
            <span className="group-count">0</span>
          </div>
          {selfRow}
          <p className="mt-2 text-[10.5px] ink-3">No existing policy on this interface pair — this will be the first rule for {pairLabel}.</p>
        </div>
      ) : (
        <div onDragOver={(e) => { if (dragging) e.preventDefault(); }} onDrop={(e) => { if (dragging) { e.preventDefault(); endDrag(); } }}>
          {rows}
          {/* Bottom catch-zone so releasing below the last row lands at the bottom of the pair. */}
          <div onDragOver={(e) => { if (dragging) { e.preventDefault(); setHover(relevant.length); } }} className="h-5" />
        </div>
      )}

      <p className="border-t hairline-2 px-3 py-2 text-[10px] ink-3">
        Position: <span className="font-semibold" style={{ color: currentColor }}>
          {atTop ? `Top of ${pairLabel}` : atBottom ? `Bottom of ${pairLabel}` : `before "${relevant[pos]?.name || `#${relevant[pos]?.seq_num}`}"`}
        </span>
        {disabled ? " — locked, placed automatically relative to the siblings already created" : isEdit ? " — moved on Apply." : ""}
      </p>
    </div>
  );
};

export default PolicyPlacementBoard;
