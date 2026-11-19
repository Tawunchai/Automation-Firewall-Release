import React from "react";
import {
  FiAlertOctagon, FiAlertTriangle, FiCheckCircle, FiInfo, FiPlusCircle, FiSlash,
} from "react-icons/fi";
import type { BreakItem, LedgerEntry, RuleState, SimHeadline } from "./packetSim";

// The two answers the picture cannot give on its own.
//
// RuleLedger says WHICH rules the change affects and what became of each. The walk shows three
// sample flows; the ledger covers every rule on the interface pair, including the ones no sample
// flow happened to exercise — a rule can be killed by a policy nobody sent a packet at.
//
// BreakList says the same thing in the words of whoever gets the call. "#17 is unreachable" is a
// fact about a table; "FTP stops for Finance-Hosts, and nothing on the device reports it" is the
// sentence somebody can act on before pressing Apply. Both come out of packetSim.ts; this file only
// decides how they look.

const STATE: Record<RuleState, { label: string; tone: string; bg: string; icon: React.ReactNode }> = {
  unreachable: {
    label: "never runs", tone: "var(--flow-deny)", bg: "var(--flow-deny-bg)",
    icon: <FiSlash size={11} />,
  },
  dead: {
    label: "unreachable", tone: "var(--flow-deny)", bg: "var(--flow-deny-bg)",
    icon: <FiAlertOctagon size={11} />,
  },
  narrowed: {
    label: "narrowed", tone: "var(--flow-warn)", bg: "var(--flow-warn-bg)",
    icon: <FiAlertTriangle size={11} />,
  },
  new: {
    label: "new", tone: "var(--flow-info)", bg: "var(--flow-info-bg)",
    icon: <FiPlusCircle size={11} />,
  },
  survives: {
    label: "survives", tone: "var(--flow-allow)", bg: "var(--flow-allow-bg)",
    icon: <FiCheckCircle size={11} />,
  },
};

const BREAK: Record<BreakItem["kind"], { tone: string; bg: string; icon: React.ReactNode }> = {
  stop: { tone: "var(--flow-deny)", bg: "var(--flow-deny-bg)", icon: <FiAlertOctagon size={12} /> },
  care: { tone: "var(--flow-warn)", bg: "var(--flow-warn-bg)", icon: <FiAlertTriangle size={12} /> },
  keep: { tone: "var(--flow-allow)", bg: "var(--flow-allow-bg)", icon: <FiCheckCircle size={12} /> },
};

const TONE: Record<SimHeadline["tone"], string> = {
  allow: "var(--flow-allow)",
  deny: "var(--flow-deny)",
  warn: "var(--flow-warn)",
  info: "var(--flow-info)",
  accent: "var(--accent)",
};

/**
 * The finding, and the three numbers behind it.
 *
 * Two shapes, one component. `bar` is the wide form the chat panel puts above its tabs. `stack` is
 * the same content in a narrow column, for the page, where the verdict sits in a rail beside the
 * drawing instead of as another band above it — the page had six full-width bands stacked down it
 * and the eye had nowhere to rest.
 */
export const SimVerdict: React.FC<{ headline: SimHeadline; layout?: "bar" | "stack" }> = ({
  headline, layout = "bar",
}) => {
  const tone = TONE[headline.tone];
  const Icon = headline.tone === "deny" ? FiAlertOctagon
    : headline.tone === "warn" ? FiAlertTriangle
    : headline.tone === "allow" ? FiCheckCircle : FiInfo;

  if (layout === "stack") {
    return (
      <div className="overflow-hidden rounded-[4px] border hairline surface-card">
        <div className="flex gap-2.5 px-3.5 py-3">
          <span className="mt-0.5 shrink-0" style={{ color: tone }}><Icon size={15} /></span>
          <div className="min-w-0">
            <p className="text-[12.5px] font-bold leading-snug" style={{ color: tone }}>{headline.title}</p>
            <p className="mt-1 text-[11.5px] leading-relaxed ink-2">{headline.detail}</p>
          </div>
        </div>
        <div className="flex flex-col border-t hairline-2">
          {headline.nums.map((n, i) => (
            <div key={n.l} className="flex items-baseline gap-2.5 border-t hairline-2 px-3.5 py-2 first:border-t-0">
              <span className="min-w-[52px] text-[16px] font-extrabold leading-tight tabular-nums"
                style={i === 0 ? { color: tone } : undefined}>{n.v}</span>
              <span className="text-[10.5px] ink-3">{n.l}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-stretch overflow-hidden rounded-[4px] border hairline surface-card">
      <div className="flex min-w-[240px] flex-1 gap-2.5 px-3.5 py-3">
        <span className="mt-0.5 shrink-0" style={{ color: tone }}><Icon size={15} /></span>
        <div className="min-w-0">
          <p className="text-[13px] font-bold leading-snug" style={{ color: tone }}>{headline.title}</p>
          <p className="mt-1 text-[11.5px] leading-relaxed ink-2">{headline.detail}</p>
        </div>
      </div>
      <div className="flex shrink-0">
        {headline.nums.map((n, i) => (
          <div key={n.l} className="flex min-w-[96px] flex-col justify-center gap-px border-l hairline-2 px-3.5 py-3">
            <span className="text-[17px] font-extrabold leading-tight tabular-nums"
              style={i === 0 ? { color: tone } : undefined}>{n.v}</span>
            <span className="text-[9.5px] ink-3">{n.l}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export const RuleLedger: React.FC<{ entries: LedgerEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <p className="text-[11.5px] ink-3">
        Nothing else on this interface pair changes — every other rule still matches traffic of its own.
      </p>
    );
  }
  return (
    <div className="flex flex-col">
      {entries.map((e) => {
        const s = STATE[e.state];
        return (
          <div key={e.key}
            className="grid grid-cols-[34px_minmax(0,1fr)_auto] items-start gap-2.5 border-t hairline-2 py-2 first:border-t-0 first:pt-0">
            <span className="pt-0.5 font-mono text-[10.5px] font-bold ink-3">#{e.shown}</span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-1.5 text-[12px] font-bold"
                style={e.state === "dead" || e.state === "unreachable"
                  ? { textDecoration: "line-through", color: "var(--shell-ink-3)" } : undefined}>
                {e.name}
                <span className="rounded px-1.5 py-px text-[8.5px] font-extrabold uppercase tracking-wide"
                  style={{
                    background: e.action === "deny" ? "var(--flow-deny-bg)" : "var(--flow-allow-bg)",
                    color: e.action === "deny" ? "var(--flow-deny)" : "var(--flow-allow)",
                  }}>
                  {e.action}
                </span>
              </p>
              <p className="mt-px truncate font-mono text-[10px] ink-3">{e.summary}</p>
              {e.note && <p className="mt-1 text-[11px] leading-relaxed ink-2">{e.note}</p>}
            </div>
            <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-[4px] px-1.5 py-1 text-[9px] font-extrabold uppercase tracking-wide"
              style={{ background: s.bg, color: s.tone }}>
              {s.icon} {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export const BreakList: React.FC<{ items: BreakItem[] }> = ({ items }) => {
  if (items.length === 0) {
    return <p className="text-[11.5px] ink-3">Nothing changes in this run.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.map((b, i) => {
        const s = BREAK[b.kind];
        return (
          <div key={`${b.title}-${i}`}
            className="flex items-start gap-2.5 rounded-[4px] border px-2.5 py-2"
            style={{ background: s.bg, borderColor: `color-mix(in srgb, ${s.tone} 34%, transparent)` }}>
            <span className="mt-0.5 shrink-0" style={{ color: s.tone }}>{s.icon}</span>
            <div className="min-w-0">
              <p className="text-[11.5px] font-bold ink">{b.title}</p>
              <p className="mt-px text-[11px] leading-relaxed ink-2">{b.detail}</p>
            </div>
            <span className="ml-auto shrink-0 pt-0.5 font-mono text-[10px] font-bold" style={{ color: s.tone }}>
              {b.port}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default RuleLedger;
