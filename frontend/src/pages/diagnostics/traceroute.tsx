import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiActivity, FiAlertTriangle, FiCheckCircle, FiChevronDown, FiChevronRight, FiCornerDownRight, FiGlobe, FiMapPin, FiPlay, FiSquare, FiTarget, FiTrendingUp } from "react-icons/fi";
import { NoDeviceState } from "../../components/ui/StateBlock";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import {
  DeviceLookupIpInfo, DeviceLookupIpGeoBatch, classifyHopKind,
  type TraceHop, type HopInfo, type HopGeoEntry,
} from "../../api/diagnostics";
import { useDiagStream } from "./diagStream";
import { DiagError, Field, LiveConsole, Panel } from "./diag-ui";
import { latencyTone } from "./diagFormat";
import { useFreshFrom } from "./useFreshFrom";
import {
  hopAvg, flagEmoji, diagnoseTrace, buildSegments, latencyPoints, biggestJump,
  type PathSegment, type LatencyPoint,
} from "./traceroute-model";

// Trace Route — the path the FIREWALL takes, drawn hop by hop as the device finds them.
//
// This is the page streaming was built for. A traceroute to a public address took 31 seconds on the
// lab device, and several of those seconds are spent on hops that never answer — so a
// request/response version shows a frozen page for half a minute and then the whole path at once,
// which is indistinguishable from a hang right up until it finishes. Streamed, each hop appears as
// it resolves and the silent ones are visibly being waited on.
//
// Pairs with Ping: ping says whether the far end answers, traceroute says where it stops answering.

// Address-kind accent — a categorical tint, not a status colour.
const KIND_TONE: Record<string, string> = {
  public: "#2563eb", private: "#64748b", cgnat: "#d97706", multicast: "#7c3aed", as: "#2563eb",
  loopback: "#64748b", "link-local": "#64748b", unspecified: "#64748b", reserved: "#64748b",
  silent: "#94a3b8", unknown: "#64748b",
};

/** The expanded "where is this hop?" panel — local rDNS + address kind + geo/ASN + internal role. */
const HopDetail: React.FC<{ info: HopInfo; onPing: () => void }> = ({ info, onPing }) => {
  const geo = info.geo;
  const place = geo ? [geo.city, geo.country].filter(Boolean).join(", ") : "";
  return (
    <div className="space-y-2">
      {info.rdns && <div className="t-mono text-[11.5px] ink-2">{info.rdns}</div>}

      {geo && (place || geo.asn) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] ink-2">
          {place && (
            <span className="inline-flex items-center gap-1">
              {flagEmoji(geo.country_code) || <FiMapPin className="text-[11px] ink-3" />}
              {place}
            </span>
          )}
          {geo.asn ? (
            <span className="inline-flex items-center gap-1">
              <FiGlobe className="text-[11px] ink-3" />
              AS{geo.asn}{geo.org ? ` · ${geo.org}` : ""}
            </span>
          ) : null}
        </div>
      )}

      {info.internal.length > 0 ? (
        <ul className="m-0 list-none space-y-1 p-0">
          {info.internal.map((line) => (
            <li key={line} className="flex items-start gap-1.5 text-[11.5px] ink-2">
              <FiCornerDownRight className="mt-0.5 shrink-0 text-[11px] ink-3" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-[11.5px] ink-3">
          {info.kind === "public"
            ? "A public hop out on the internet — it matches none of this device's own networks."
            : "Matches none of this device's interfaces, routes, or the fleet."}
        </p>
      )}

      <button type="button" className="btn btn-ghost btn-sm" onClick={onPing}>
        <FiActivity size={12} /> Ping this hop
      </button>
    </div>
  );
};

const HopRow: React.FC<{ hop: TraceHop; last: boolean; worst: number; fresh: boolean; deviceId: number; geo?: HopGeoEntry }> =
  ({ hop, last, worst, fresh, deviceId, geo }) => {
    const navigate = useNavigate();
    const avg = hopAvg(hop);
    const silent = avg === null;
    const tone = silent ? "danger" : latencyTone(avg);
    const colour = silent ? "#94a3b8" : tone === "ok" ? "#10b981" : tone === "warn" ? "#f59e0b" : "#ef4444";

    // A hop with no IP answered nothing, so there is nothing to look up — only IP hops expand.
    const expandable = !!hop.ip;
    // Kind is pure from the IP, so it shows inline immediately — no round-trip needed for the label.
    const kind = expandable ? classifyHopKind(hop.ip as string) : null;
    const [open, setOpen] = useState(false);
    const [info, setInfo] = useState<HopInfo | null>(null);
    const [loadingInfo, setLoadingInfo] = useState(false);
    const [infoError, setInfoError] = useState<string | null>(null);

    const toggle = () => {
      if (!expandable) return;
      const next = !open;
      setOpen(next);
      // Lazy — the lookup only runs the first time a hop is opened, not for every hop on screen.
      if (next && !info && !loadingInfo) {
        setLoadingInfo(true);
        setInfoError(null);
        DeviceLookupIpInfo(deviceId, hop.ip as string)
          .then(setInfo)
          .catch(() => setInfoError("Could not look this hop up"))
          .finally(() => setLoadingInfo(false));
      }
    };

    return (
      <div className={fresh ? "diag-row-in" : ""}>
        <div
          className={`flex items-start gap-3 px-4 py-2.5 ${expandable ? "cursor-pointer surface-hover" : ""}`}
          onClick={toggle}
          role={expandable ? "button" : undefined}
          tabIndex={expandable ? 0 : undefined}
          onKeyDown={expandable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } } : undefined}
        >
          {/* Hop number + the connector line, so the list reads as a path rather than as rows. */}
          <div className="flex shrink-0 flex-col items-center" style={{ width: 26 }}>
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold"
              style={{ background: `color-mix(in srgb, ${colour} 16%, transparent)`, color: colour }}
            >
              {hop.hop}
            </span>
            {!last && (
              <span className="mt-1 w-px flex-1 self-center"
                style={{ background: "var(--shell-border)", minHeight: 12 }} />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              {hop.ip ? (
                <span className="t-mono text-[12.5px] font-semibold ink">{hop.ip}</span>
              ) : (
                // A hop that answered nothing is still a hop — dropping it would renumber the path,
                // and "hop 10 is silent" is often the finding itself.
                <span className="t-body font-semibold ink-3">No reply (* * *)</span>
              )}
              {hop.hostname && <span className="t-meta truncate">{hop.hostname}</span>}
              {expandable && kind && (
                <span className="inline-flex items-center gap-1">
                  <span className="rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold"
                    style={{
                      background: `color-mix(in srgb, ${KIND_TONE[kind.kind] ?? "#64748b"} 15%, transparent)`,
                      color: KIND_TONE[kind.kind] ?? "#64748b",
                    }}>
                    {kind.label}
                  </span>
                  {open ? <FiChevronDown size={11} className="ink-3" /> : <FiChevronRight size={11} className="ink-3" />}
                </span>
              )}
              {/* Owner + country inline, from the batch geo lookup — "tell me more" without a click. */}
              {geo?.geo && (geo.geo.asn || geo.geo.country_code) && (
                <span className="inline-flex items-center gap-1 t-meta">
                  {flagEmoji(geo.geo.country_code)}
                  {geo.geo.asn ? `AS${geo.geo.asn}${geo.geo.org ? ` · ${geo.geo.org}` : ""}` : geo.geo.country}
                </span>
              )}
            </div>

            {(hop.rtts.length > 0 || hop.timeouts > 0) && (
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                {hop.rtts.map((ms, i) => (
                  <span key={i} className="rounded-[4px] surface-sunken px-1.5 py-0.5 font-mono text-[10.5px] tnum ink-2">
                    {ms.toFixed(1)} ms
                  </span>
                ))}
                {hop.timeouts > 0 && (
                  <span className="rounded-[4px] px-1.5 py-0.5 text-[10.5px] font-semibold"
                    style={{ background: "#94a3b81f", color: "#64748b" }}>
                    timeout ×{hop.timeouts}
                  </span>
                )}
              </div>
            )}
          </div>

          {avg !== null && (
            <div className="shrink-0 text-right">
              <span className="t-mono text-[12px] font-bold tnum" style={{ color: colour }}>
                {avg.toFixed(1)} ms
              </span>
              <div className="mt-1 h-1 w-20 overflow-hidden rounded-full surface-sunken">
                <div className="h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${Math.max(4, (avg / Math.max(worst, 1)) * 100)}%`, background: colour }} />
              </div>
            </div>
          )}
        </div>

        {open && (
          <div className="pb-3 pr-4" style={{ paddingLeft: 54 }}>
            <div className="rounded-[5px] border hairline surface-sunken p-3">
              {loadingInfo ? (
                <p className="m-0 text-[11.5px] ink-3">Looking up…</p>
              ) : infoError ? (
                <p className="m-0 text-[11.5px] text-red-500">{infoError}</p>
              ) : info ? (
                <HopDetail info={info} onPing={() => navigate(`/admin/diagnostics/troubleshooting?tab=ping&host=${encodeURIComponent(hop.ip as string)}`)} />
              ) : null}
            </div>
          </div>
        )}
      </div>
    );
  };

/** The row that shows the device is still working, below the hops found so far. */
const WaitingRow: React.FC = () => (
  <div className="flex items-center gap-3 px-4 py-2.5">
    <div className="flex shrink-0 justify-center" style={{ width: 26 }}>
      <span className="diag-live-dot" />
    </div>
    <span className="t-meta">Looking for the next hop…</span>
  </div>
);

// ── E · The verdict — one sentence that says what the path means ───────────────────
const VERDICT_STYLE = {
  ok: { color: "#15803d", bg: "#10b98114", icon: <FiCheckCircle size={18} /> },
  warn: { color: "#b45309", bg: "#f59e0b14", icon: <FiAlertTriangle size={18} /> },
  danger: { color: "#b91c1c", bg: "#ef444414", icon: <FiAlertTriangle size={18} /> },
} as const;

const VerdictBanner: React.FC<{ tone: "ok" | "warn" | "danger"; title: string; detail: string }> =
  ({ tone, title, detail }) => {
    const s = VERDICT_STYLE[tone];
    return (
      <div className="flex items-start gap-3 rounded-[6px] px-3.5 py-3" style={{ background: s.bg }}>
        <span className="mt-0.5 shrink-0" style={{ color: s.color }}>{s.icon}</span>
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-bold" style={{ color: s.color }}>{title}</p>
          <p className="t-body m-0 mt-0.5 ink-2">{detail}</p>
        </div>
      </div>
    );
  };

// ── C · Latency across the path — where it gets slow ───────────────────────────────
// A single-series line: one measure (round-trip ms) over position (hop). The connecting line is a
// recessive grey — structure, not signal — while each dot carries the latency tone the hop rows use,
// so "fast/slow" reads the same everywhere on the page. The one point that jumps most is ringed and
// labelled; silent hops break the line, because a gap IS the information.
const LatencyChart: React.FC<{ points: LatencyPoint[] }> = ({ points }) => {
  const answered = points.filter((p) => p.ms !== null);
  if (answered.length < 2) return null; // one point is not a trend

  const jump = biggestJump(points);
  const maxMs = Math.max(...answered.map((p) => p.ms as number), 1);
  const PAD = { t: 16, r: 16, b: 20, l: 40 };
  const stepX = 36;
  const H = 104;
  const plotH = H - PAD.t - PAD.b;
  const W = PAD.l + Math.max(points.length - 1, 1) * stepX + PAD.r;
  const xOf = (i: number) => PAD.l + i * stepX;
  const yOf = (ms: number) => PAD.t + plotH * (1 - ms / maxMs);

  // Break the line into runs of consecutive answering hops, so a silent hop leaves a gap.
  const runs: { i: number; ms: number }[][] = [];
  let cur: { i: number; ms: number }[] = [];
  points.forEach((p, i) => {
    if (p.ms === null) { if (cur.length) { runs.push(cur); cur = []; } }
    else cur.push({ i, ms: p.ms });
  });
  if (cur.length) runs.push(cur);

  const tone = (ms: number) => {
    const t = latencyTone(ms);
    return t === "ok" ? "#10b981" : t === "warn" ? "#f59e0b" : "#ef4444";
  };

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} role="img" aria-label="Round-trip latency by hop" className="block">
        {/* baseline + max gridline, recessive */}
        {[0, maxMs].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yOf(v)} y2={yOf(v)} stroke="var(--shell-border-2, #e2e8f0)" strokeWidth={1} />
            <text x={PAD.l - 6} y={yOf(v) + 3} textAnchor="end" className="tnum" style={{ fontSize: 9, fill: "var(--ink-3, #94a3b8)" }}>
              {v === 0 ? "0" : `${Math.round(v)}ms`}
            </text>
          </g>
        ))}
        {/* the line runs */}
        {runs.map((run, ri) => (
          <polyline key={ri} fill="none" stroke="#94a3b8" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
            points={run.map((pt) => `${xOf(pt.i)},${yOf(pt.ms)}`).join(" ")} />
        ))}
        {/* the dots */}
        {points.map((p, i) => p.ms === null ? null : (
          <g key={i}>
            {jump?.index === i && (
              <circle cx={xOf(i)} cy={yOf(p.ms)} r={7} fill="none" stroke={tone(p.ms)} strokeWidth={1.5} opacity={0.5} />
            )}
            <circle cx={xOf(i)} cy={yOf(p.ms)} r={3.5} fill={tone(p.ms)}>
              <title>{`Hop ${p.hop}${p.ip ? ` · ${p.ip}` : ""} · ${p.ms.toFixed(1)} ms`}</title>
            </circle>
            <text x={xOf(i)} y={H - 6} textAnchor="middle" className="tnum" style={{ fontSize: 8.5, fill: "var(--ink-3, #94a3b8)" }}>
              {p.hop}
            </text>
          </g>
        ))}
        {/* the jump marker label */}
        {jump && points[jump.index].ms !== null && (
          <text x={xOf(jump.index)} y={yOf(points[jump.index].ms as number) - 10} textAnchor="middle"
            style={{ fontSize: 9, fontWeight: 700, fill: "#b45309" }}>
            +{jump.delta.toFixed(0)}ms
          </text>
        )}
      </svg>
    </div>
  );
};

// ── D · Path segments — who owns each stretch of the route ─────────────────────────
const SegmentStrip: React.FC<{ segments: PathSegment[]; geoEnabled: boolean; hasPublic: boolean }> =
  ({ segments, geoEnabled, hasPublic }) => {
    if (segments.length === 0) return null;
    return (
      <div>
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          {segments.map((seg, i) => {
            const colour = KIND_TONE[seg.kind] ?? "#64748b";
            const flag = flagEmoji(seg.countryCode);
            return (
              <React.Fragment key={`${seg.fromHop}-${seg.kind}-${i}`}>
                {i > 0 && <FiChevronRight size={12} className="ink-3 shrink-0" />}
                <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
                  style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)`, color: colour }}
                  title={`Hops ${seg.fromHop}${seg.toHop !== seg.fromHop ? `–${seg.toHop}` : ""}`}>
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: colour }} />
                  {flag && <span aria-hidden>{flag}</span>}
                  <span className="truncate" style={{ maxWidth: 220 }}>{seg.label}</span>
                  {seg.count > 1 && <span className="opacity-70">×{seg.count}</span>}
                </span>
              </React.Fragment>
            );
          })}
        </div>
        {!geoEnabled && hasPublic && (
          <p className="t-meta m-0 mt-2">
            Segments are grouped by address kind. Install a GeoLite2 database on the server to label the public
            stretches by their network owner (AS number and organisation) and country.
          </p>
        )}
      </div>
    );
  };

const TraceroutePage: React.FC = () => {
  const { device } = useSelectedDevice();

  const [target, setTarget] = useState("8.8.8.8");
  // Optional, exactly like Ping's. A firewall with several interfaces picks its egress from the
  // route to the target, so "which way would a DMZ host go?" is a different question from "which
  // way does the firewall go?" — and only a source address can ask it. Empty means the device
  // chooses, which is what it did before this field existed.
  const [sourceIP, setSourceIP] = useState("");
  const stream = useDiagStream(device?.id ?? null, "traceroute");
  const { status, lines, hops, resolvedIP, traceResult, error, running, start, stop } = stream;

  // Owner/geo for every hop at once, fetched when the run finishes (one call, local GeoLite2 — see
  // the ip-geo endpoint). It powers the path-segment strip, the per-hop owner line and the verdict.
  const [geoMap, setGeoMap] = useState<Record<string, HopGeoEntry>>({});
  const [geoEnabled, setGeoEnabled] = useState(false);

  // Only newly arrived hops animate in; without this the whole list re-animates on each arrival.
  const freshFrom = useFreshFrom(hops.length);

  const run = () => {
    if (!device || running || !target.trim()) return;
    setGeoMap({}); // a new run's hops belong to a new path — drop the last run's owners
    setGeoEnabled(false);
    start({ target: target.trim(), source: sourceIP.trim() || undefined });
  };

  useEffect(() => {
    if (!device || running || !traceResult) return;
    const ips = Array.from(new Set(traceResult.hops.map((h) => h.ip).filter(Boolean))) as string[];
    if (ips.length === 0) return;
    let cancelled = false;
    void DeviceLookupIpGeoBatch(device.id, ips)
      .then((res) => { if (!cancelled) { setGeoMap(res.ips); setGeoEnabled(res.enabled); } })
      .catch(() => { /* geo is an enrichment; the trace stands without it */ });
    return () => { cancelled = true; };
  }, [device, running, traceResult]);

  const worst = hops.reduce((m, h) => Math.max(m, hopAvg(h) ?? 0), 0) || 1;
  // Whether the last hop IS the destination is the answer to "did it get there?", and traceroute
  // never says so in words.
  const destination = resolvedIP || target.trim();
  const reached = hops.some((h) => h.ip === destination);
  const started = status !== "idle";
  const done = !running && !!traceResult;

  // E / C / D, all computed from what is on screen plus the geo map.
  const verdict = diagnoseTrace(hops, destination, done);
  const segments = buildSegments(hops, geoMap);
  const points = latencyPoints(hops);
  const hasPublic = hops.some((h) => h.ip && classifyHopKind(h.ip).kind === "public");

  return (
    <div className="page-stack">

      {!device ? (
        <NoDeviceState />
      ) : (
        <>
          <Panel title="Destination" icon={<FiTarget size={13} />}>
            <form className="grid grid-cols-1 gap-3 sm:grid-cols-2"
              onSubmit={(e) => { e.preventDefault(); run(); }}>
              <Field label="Host or IP">
                <input
                  className="shell-input"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="8.8.8.8 or www.google.com"
                  disabled={running}
                />
              </Field>

              {/* Optional — same wording as Ping's field, because it is the same idea and people
                  arrive here from that page. */}
              <Field label="Source IP (optional)" hint="Leave blank and the device chooses">
                <input
                  className="shell-input"
                  value={sourceIP}
                  onChange={(e) => setSourceIP(e.target.value)}
                  placeholder="e.g. 10.0.99.201"
                  disabled={running}
                />
              </Field>

              <div className="flex items-center gap-2 sm:col-span-2">
                <button type="submit" className="btn btn-accent btn-sm" disabled={running || !target.trim()}>
                  <FiPlay size={13} />
                  {running ? "Tracing…" : "Trace"}
                </button>
                {/* Stop aborts the command on the device, which releases the diagnostic lock — a
                    traceroute can run for a full minute and the next one would queue behind it. */}
                {running && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={stop}>
                    <FiSquare size={12} />
                    Stop
                  </button>
                )}
              </div>

              <p className="t-meta m-0 sm:col-span-2">
                A traceroute takes a while (up to 32 hops × 3 probes) — hops appear as the device finds them
                {sourceIP.trim() && " · a source the device does not own answers * * * on every hop"}
              </p>
            </form>
          </Panel>

          {error && <DiagError message={error} />}

          {started && (
            <Panel
              // The source is part of what was asked, so it belongs in the answer's title: two runs
              // to the same target from different sources are different results, and a heading that
              // does not say which is which makes them look like one flapping.
              title={`Path to ${target.trim()}${resolvedIP && resolvedIP !== target.trim() ? ` (${resolvedIP})` : ""}${sourceIP.trim() ? ` · from ${sourceIP.trim()}` : ""}`}
              icon={<FiCornerDownRight size={13} />}
              right={
                <span className="t-meta flex items-center gap-1.5">
                  {running && <span className="diag-live-dot" />}
                  {hops.length} hops
                  {!running && traceResult && (reached ? " · reached" : " · did not reach")}
                </span>
              }
              flush
            >
              {hops.length === 0 && !running ? (
                <div className="panel-body">
                  <p className="m-0 text-[12.5px] ink-2">No hops came back — see the raw output below</p>
                  <LiveConsole lines={lines} running={running} />
                </div>
              ) : (
                <>
                  {/* E / C / D — the "what does this mean?" layer, above the raw hop list. */}
                  {(verdict || points.filter((p) => p.ms !== null).length >= 2 || segments.length > 0) && (
                    <div className="panel-body hairline-b space-y-3">
                      {verdict && <VerdictBanner tone={verdict.tone} title={verdict.title} detail={verdict.detail} />}
                      {segments.length > 0 && (
                        <div>
                          <p className="t-label m-0 mb-1.5 flex items-center gap-1.5">
                            <FiGlobe size={11} className="ink-3" /> Networks crossed
                          </p>
                          <SegmentStrip segments={segments} geoEnabled={geoEnabled} hasPublic={hasPublic} />
                        </div>
                      )}
                      {points.filter((p) => p.ms !== null).length >= 2 && (
                        <div>
                          <p className="t-label m-0 mb-1 flex items-center gap-1.5">
                            <FiTrendingUp size={11} className="ink-3" /> Latency by hop
                          </p>
                          <LatencyChart points={points} />
                        </div>
                      )}
                    </div>
                  )}
                  <div className="divide-y divide-[var(--shell-border-2)]">
                    {hops.map((h, i) => (
                      <HopRow key={`${h.hop}-${i}`} hop={h}
                        last={i === hops.length - 1 && !running}
                        worst={worst} fresh={i >= freshFrom} deviceId={device.id}
                        geo={h.ip ? geoMap[h.ip] : undefined} />
                    ))}
                    {running && <WaitingRow />}
                  </div>
                  <div className="panel-body hairline-t">
                    <LiveConsole lines={lines} running={running} />
                  </div>
                </>
              )}
            </Panel>
          )}
        </>
      )}
    </div>
  );
};

export default TraceroutePage;
