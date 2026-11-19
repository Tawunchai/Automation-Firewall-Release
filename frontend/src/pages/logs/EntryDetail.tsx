import React, { useMemo, useState } from "react";
import { FiArrowRight, FiSearch, FiServer, FiShield, FiMonitor, FiGlobe } from "react-icons/fi";
import Modal from "../../components/ui/Modal";
import type { TrafficLogRow } from "../../api/logs";
import { formatLogTime, policyVerdict, rowDirection } from "./format";
import { destinationLabel, GROUP_CHIP, rowResult, serviceLabel, sourceLabel, storyOf, term, type ResultGroup } from "./story";

// One entry, opened: what happened in sentences, the path it took through the firewall, and every
// field the device sent — each field one click from a search on it.
//
// The table row is built to be scanned, which means it drops detail. This is where the detail comes
// back, arranged to answer the questions in order: who went where → how → which policy → what
// happened and why.

/**
 * Fields the search box understands, so a field's "filter by this" button only appears where the
 * search would honour it. Mirrors services/fortigate_logsearch.go's logSearchFields — a field the
 * backend does not know is refused there, so offering it here would be a button that always fails.
 */
const SEARCHABLE = new Set([
  "srcip", "dstip", "srcport", "dstport", "policyid", "proto", "sessionid", "duration",
  "sentbyte", "rcvdbyte", "sentpkt", "rcvdpkt", "crscore",
  "action", "service", "app", "appcat", "srcintf", "dstintf", "srcintfrole", "dstintfrole",
  "user", "group", "level", "policytype", "srccountry", "dstcountry", "devtype", "dstdevtype",
  "srcmac", "dstmac", "srcname", "dstname", "srchwvendor", "dsthwvendor", "trandisp", "crlevel",
  "logid", "vd", "subtype", "msg", "osname",
]);

const Hop: React.FC<{ icon: React.ReactNode; title: string; detail: string; tint?: string }> = ({ icon, title, detail, tint }) => (
  <div className="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[4px] border hairline-2 surface-card px-2 py-2 text-center"
    style={tint ? { borderColor: tint } : undefined}>
    <span className="text-[15px]" style={{ color: tint ?? "var(--shell-ink-3)" }}>{icon}</span>
    <span className="w-full truncate text-[11.5px] font-semibold ink" title={title}>{title}</span>
    <span className="t-meta w-full truncate" title={detail}>{detail || "—"}</span>
  </div>
);

const Arrow: React.FC<{ label: string }> = ({ label }) => (
  <div className="flex shrink-0 flex-col items-center px-1">
    <FiArrowRight size={14} className="ink-3" />
    <span className="font-mono text-[10px] ink-3">{label || "—"}</span>
  </div>
);

const EntryDetail: React.FC<{
  row: TrafficLogRow | null;
  hues: Record<ResultGroup, string>;
  onClose: () => void;
  onPivot: (expression: string) => void;
}> = ({ row, hues, onClose, onPivot }) => {
  const [filter, setFilter] = useState("");
  const fields = useMemo(() => {
    if (!row) return [];
    const raw = row.raw ?? {};
    return Object.keys(raw).sort().map((k) => [k, raw[k]] as const);
  }, [row]);

  if (!row) return null;
  const result = rowResult(row);
  const verdict = policyVerdict(row);
  const dir = rowDirection(row);
  const story = storyOf(row);
  const shown = filter
    ? fields.filter(([k, v]) => k.includes(filter.toLowerCase()) || v.toLowerCase().includes(filter.toLowerCase()))
    : fields;

  const go = (expression: string) => {
    onPivot(expression);
    onClose();
  };

  const quick: { label: string; expr: string }[] = [
    row.srcip && dir === "inbound" ? { label: `From ${row.srcip}`, expr: term("srcip", row.srcip) } : null,
    row.dstip ? { label: `To ${row.dstip}`, expr: term("dstip", row.dstip) } : null,
    row.dstport !== null && row.dstport !== undefined ? { label: `Port ${row.dstport}`, expr: term("dstport", row.dstport) } : null,
    row.policyid !== null && row.policyid !== undefined && verdict.by !== "local-out"
      ? { label: `Policy ${row.policyid}`, expr: term("policyid", row.policyid) } : null,
    row.action ? { label: `Action ${row.action}`, expr: term("action", row.action) } : null,
  ].filter((q): q is { label: string; expr: string } => q !== null);

  return (
    <Modal open width="max-w-3xl" onClose={onClose}
      title={
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">{formatLogTime(row)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-[14px] font-semibold ink">{`${sourceLabel(row)} → ${destinationLabel(row)}`}</span>
            <span className={`${GROUP_CHIP[result.group]} text-[10.5px]`}>{result.label}</span>
          </div>
        </div>
      }>
      <div className="space-y-4">
        {/* What happened, in order */}
        <div>
          <p className="t-label m-0 mb-1">What happened</p>
          <ol className="m-0 space-y-1 pl-5">
            {story.map((s, i) => <li key={i} className="t-body ink-2">{s}</li>)}
          </ol>
        </div>

        {/* The path through the firewall */}
        <div>
          <p className="t-label m-0 mb-1.5">The path</p>
          <div className="flex items-stretch gap-1 overflow-x-auto">
            <Hop icon={dir === "inbound" ? <FiMonitor /> : <FiServer />} title={sourceLabel(row)}
              detail={row.srcip} />
            <Arrow label={dir === "inbound" ? row.srcintf : ""} />
            <Hop icon={<FiShield />} title={verdict.by === "local-out" ? "No policy" : verdict.label}
              detail={serviceLabel(row)} tint={hues[result.group]} />
            <Arrow label={row.dstintf !== row.vd ? row.dstintf : ""} />
            <Hop icon={dir === "loopback" ? <FiServer /> : <FiGlobe />} title={destinationLabel(row)}
              detail={row.dstcountry && row.dstcountry !== "Reserved" ? `${row.dstip} · ${row.dstcountry}` : row.dstip} />
          </div>
        </div>

        {/* Pivots */}
        {quick.length > 0 && (
          <div>
            <p className="t-label m-0 mb-1">Show other entries with…</p>
            <div className="flex flex-wrap gap-1.5">
              {quick.map((q) => (
                <button key={q.expr} type="button" onClick={() => go(q.expr)} title={`Search: ${q.expr}`}
                  className="btn btn-ghost btn-sm hairline gap-1.5 border">
                  <FiSearch size={11} /> {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Every field the device sent */}
        {fields.length > 0 && (
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <p className="t-label m-0">{`All fields (${fields.length})`}</p>
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a field"
                className="shell-input h-7 w-44 text-[11.5px]" aria-label="Find a field" />
            </div>
            <div className="max-h-64 overflow-auto rounded-[4px] border hairline-2">
              <table className="shell-table">
                <tbody>
                  {shown.map(([k, v]) => (
                    <tr key={k}>
                      <td className="td-key w-40 font-mono text-[11px]">{k}</td>
                      <td className="break-all font-mono text-[11px]">{v}</td>
                      <td className="w-10 text-right">
                        {SEARCHABLE.has(k) && v !== "" && (
                          <button type="button" onClick={() => go(term(k, v))} title={`Search: ${term(k, v)}`}
                            aria-label={`Search: ${term(k, v)}`} className="btn-icon h-6 w-6 text-[11px] ink-3">
                            <FiSearch />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EntryDetail;
