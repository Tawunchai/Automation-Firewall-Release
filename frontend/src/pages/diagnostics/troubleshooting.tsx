import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  FiActivity, FiAlertTriangle, FiCheckCircle, FiCopy, FiCrosshair, FiExternalLink, FiEye, FiHelpCircle,
  FiPlay, FiRepeat, FiRotateCcw, FiSlash, FiTool, FiXCircle, FiZap,
} from "react-icons/fi";
import { message } from "../../components/ui/toast";
import MinimalSelect from "../../components/ui/MinimalSelect";
import confirm from "../../components/ui/confirm";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { useAuth } from "../../contexts/AuthContext.logic";
import { DeviceListInterfaces } from "../../api/policyObject";
import {
  DeviceApplyTraceFix, DeviceTracePolicy, DeviceTraceWhatIf, DeviceUndoTraceFix,
  type FixApplyResult, type FixPreview, type PolicyTrace, type PolicyTraceQuery, type PolicyTraceVerdict,
} from "../../api/troubleshoot";
import PacketFlow from "./PacketFlow";
import PolicyMatrix from "./PolicyMatrix";
import PingPanel from "./PingPanel";
import { FixAppliedPanel, FixPreviewPanel } from "./FixPanel";
import {
  fixesFor, serviceOf, type SavedTrace,
} from "./trace-model";

// Diagnostics ▸ Troubleshooting — "why can't A reach B?", answered the way an engineer would.
//
// Enter a 5-tuple. The backend walks the policy table exactly as FortiOS does (top-down, first match
// wins) from CMDB and monitor reads — no SSH, no AI, nothing written — and the page lays the answer
// out in the order the questions come:
//
//   The verdict        allowed / blocked by a policy / no policy matches / no route, in one line
//   The path           the packet animated through the FortiGate, stopping where it stops
//   The diagnosis      route out, route back, links, policy, NAT, inspection, traffic, rule order
//   How to fix it      specific to this trace: the closest rule and what it lacks, a rule to move,
//                      a route to add — and a link to the real log for this pair
//   Every rule         a ✓/✗ matrix of every criterion of every rule the walk looked at
//
// This page was Session Monitor, with a second tab listing live sessions over SSH. That tab was
// removed on request; the policy walk is open to every signed-in user because nothing on it opens SSH.
//
// Ping now lives here too, as a second tab (?tab=ping). It answers the other half of "why can't A
// reach B?" — "does the far end actually answer?" — by asking the device over SSH. Because it opens
// SSH, that tab is ADMIN-ONLY: a non-admin sees only the policy walk and no tab bar at all, exactly
// as before. The old /admin/diagnostics/ping route redirects here with ?tab=ping.
//
// A trace can be linked: ?src=&dst=&proto=&port=&in= fills the form and runs it.

const PROTOCOLS = [
  { value: "tcp", label: "TCP", port: true },
  { value: "udp", label: "UDP", port: true },
  { value: "icmp", label: "ICMP", port: false },
];

const PRESETS: { label: string; protocol: string; port: string }[] = [
  { label: "HTTPS", protocol: "tcp", port: "443" },
  { label: "HTTP", protocol: "tcp", port: "80" },
  { label: "DNS", protocol: "udp", port: "53" },
  { label: "SSH", protocol: "tcp", port: "22" },
  { label: "RDP", protocol: "tcp", port: "3389" },
  { label: "NTP", protocol: "udp", port: "123" },
  { label: "SMTP", protocol: "tcp", port: "25" },
  { label: "Ping", protocol: "icmp", port: "" },
];

const VERDICT: Record<PolicyTraceVerdict, { label: string; tone: string; icon: React.ReactNode }> = {
  allowed:         { label: "Allowed", tone: "#10b981", icon: <FiCheckCircle size={20} /> },
  denied:          { label: "Blocked by a policy", tone: "#E11D48", icon: <FiSlash size={20} /> },
  "implicit-deny": { label: "No policy matches — blocked", tone: "#E11D48", icon: <FiXCircle size={20} /> },
  "no-route":      { label: "No route to the destination", tone: "#D97706", icon: <FiAlertTriangle size={20} /> },
};

/** The verdict as one translated sentence, built from the fields rather than the API's English. */
function headline(t: PolicyTrace): string {
  const pair = `${t.query.src_ip} → ${t.query.dst_ip} (${serviceOf(t)})`;
  const m = t.matched;
  switch (t.verdict) {
    case "allowed":
      return `${pair} is allowed by policy #${m?.policy_id} ${m?.name || "(unnamed)"} and leaves through ${t.egress}.`;
    case "denied":
      return `${pair} is blocked by policy #${m?.policy_id} ${m?.name || "(unnamed)"}.`;
    case "implicit-deny":
      return `${pair} matches none of the ${t.total} policies, so the implicit deny drops it.`;
    default:
      return `${pair} is dropped at routing: the FortiGate has no route to ${t.query.dst_ip}.`;
  }
}

/** A saved question as the API asks it. */
const toQuery = (s: SavedTrace): PolicyTraceQuery => {
  const withPort = PROTOCOLS.find((p) => p.value === s.protocol)?.port ?? false;
  return {
    src: s.src, dst: s.dst, protocol: s.protocol,
    port: withPort ? Number(s.port) || 0 : undefined,
    src_intf: s.srcIntf || undefined,
  };
};

/** The server's own error text, or a fallback. */
const errorText = (e: unknown, fallback: string): string => {
  const data = (e as { response?: { data?: { error?: unknown } } })?.response?.data;
  return typeof data?.error === "string" ? data.error : fallback;
};

const Section: React.FC<{ title: string; icon: React.ReactNode; accent: string; action?: React.ReactNode; children: React.ReactNode }> = ({
  title, icon, accent, action, children,
}) => (
  <section className="shell-card overflow-hidden">
    <header className="card-head">
      <h2 className="card-title t-card">
        <span className="medallion h-6 w-6 text-[12px]" style={{ color: accent, background: `${accent}1f` }}>{icon}</span>
        {title}
      </h2>
      {action}
    </header>
    <div className="px-4 py-3">{children}</div>
  </section>
);

const TroubleshootingPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const { device } = useSelectedDevice();
  const [params, setParams] = useSearchParams();

  const [interfaces, setInterfaces] = useState<string[]>([]);
  const [src, setSrc] = useState(params.get("src") ?? "");
  const [dst, setDst] = useState(params.get("dst") ?? "");
  const [protocol, setProtocol] = useState(params.get("proto") ?? "tcp");
  const [port, setPort] = useState(params.get("port") ?? "443");
  const [srcIntf, setSrcIntf] = useState(params.get("in") ?? "");

  const [trace, setTrace] = useState<PolicyTrace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replay, setReplay] = useState(0);

  // Fix it. `asked` is the question the trace on screen answers — the form may have been edited
  // since, and a what-if or an apply must be about THIS trace, not about what is typed now.
  // isAdmin comes from the context, which trims and lower-cases the role first. A role stored as
  // "Admin" made the router serve the admin page while every hand-rolled check on it said no.
  const { isAdmin } = useAuth();

  // Ping is a tab, admin-only. A non-admin can never reach it, so ?tab=ping is ignored for them and
  // the tab bar is not drawn — their page is the policy walk alone, as it was before Ping moved in.
  const tab: "trace" | "ping" = isAdmin && params.get("tab") === "ping" ? "ping" : "trace";
  const setTab = (t: "trace" | "ping") => {
    const next = new URLSearchParams(params);
    if (t === "ping") next.set("tab", "ping");
    else next.delete("tab");
    setParams(next, { replace: true });
  };
  const [asked, setAsked] = useState<SavedTrace | null>(null);
  const [preview, setPreview] = useState<FixPreview | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<FixApplyResult | null>(null);
  const [undoing, setUndoing] = useState(false);
  const previewRef = useRef<HTMLDivElement>(null);
  const appliedRef = useRef<HTMLDivElement>(null);

  const needsPort = PROTOCOLS.find((p) => p.value === protocol)?.port ?? false;

  useEffect(() => {
    if (!device) { setInterfaces([]); return; }
    void DeviceListInterfaces(device.id).then((rows) => setInterfaces(rows.map((r) => r.name))).catch(() => setInterfaces([]));
  }, [device]);

  // A new device invalidates the answer — leaving it under another firewall's name would mislead.
  const [seenDevice, setSeenDevice] = useState(device?.id);
  if (seenDevice !== device?.id) {
    setSeenDevice(device?.id);
    setTrace(null);
    setError(null);
    // A fix belongs to the firewall it was planned or applied on.
    setPreview(null);
    setApplied(null);
    setAsked(null);
  }

  const run = useCallback(async (input?: SavedTrace) => {
    const q = input ?? { src, dst, protocol, port, srcIntf };
    if (!device) { message.warning("Pick a device first"); return; }
    if (!q.src.trim() || !q.dst.trim()) { message.warning("Enter a source IP and a destination"); return; }
    const withPort = PROTOCOLS.find((p) => p.value === q.protocol)?.port ?? false;
    setLoading(true);
    setError(null);
    setPreview(null);
    try {
      const clean = { ...q, src: q.src.trim(), dst: q.dst.trim() };
      const result = await DeviceTracePolicy(device.id, toQuery(clean));
      setTrace(result);
      // A host name is pinned to the address the trace actually ran on, so a later what-if or apply
      // is about THIS answer — not about whatever the name resolves to by then.
      setAsked({ ...clean, dst: result.query.dst_ip || clean.dst });
      setReplay((k) => k + 1);
      // The address bar carries the question, so the answer can be linked.
      const next = new URLSearchParams({ src: q.src.trim(), dst: q.dst.trim(), proto: q.protocol });
      if (withPort && q.port) next.set("port", q.port);
      if (q.srcIntf) next.set("in", q.srcIntf);
      setParams(next, { replace: true });
    } catch (e: unknown) {
      setTrace(null);
      const data = (e as { response?: { data?: { error?: unknown } } })?.response?.data;
      setError(typeof data?.error === "string" ? data.error : "The trace failed");
    } finally {
      setLoading(false);
    }
  }, [device, src, dst, protocol, port, srcIntf, setParams]);

  // Opened from a link with a question in it: answer it once the device is known.
  const autoRan = useRef(false);
  useEffect(() => {
    if (autoRan.current || !device || !params.get("src") || !params.get("dst")) return;
    autoRan.current = true;
    void run();
  }, [device, params, run]);

  const load = (t: SavedTrace, go = false) => {
    setSrc(t.src); setDst(t.dst); setProtocol(t.protocol); setPort(t.port); setSrcIntf(t.srcIntf);
    if (go) void run(t);
  };

  const swap = () => {
    const next = { src: dst, dst: src, protocol, port, srcIntf: "" };
    load(next, !!(dst && src));
  };

  // ── Fix it ────────────────────────────────────────────────────────────────

  // Bring each panel into view once it has RENDERED. Scrolling from the handler did nothing: after an
  // await, React commits the update on a later task, so a requestAnimationFrame found no element yet
  // and the applied result — with its Undo — opened above the viewport, announced only by a toast.
  const previewKey = preview ? `${preview.plan.id}-${preview.plan.fingerprint}` : "";
  useEffect(() => {
    if (previewKey) previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [previewKey]);
  useEffect(() => {
    if (applied) appliedRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [applied]);

  /** Simulates one of the trace's plans and opens the what-if panel. Writes nothing. */
  const previewFix = async (planId: string) => {
    if (!device || !asked) return;
    setPreviewing(planId);
    try {
      const p = await DeviceTraceWhatIf(device.id, toQuery(asked), planId);
      setPreview(p);
    } catch (e: unknown) {
      message.error(errorText(e, "Could not simulate this fix"));
    } finally {
      setPreviewing(null);
    }
  };

  /** Writes the previewed plan, then shows the trace read back from the firewall. Admin only. */
  const applyFix = async () => {
    if (!device || !asked || !preview) return;
    const n = preview.plan.steps.length;
    const ok = await confirm({
      title: "Apply this fix to the firewall?",
      content: `Changes to write: ${n}. They go straight to the live rule base; each is recorded in Change history and can be undone from here.`,
      okText: "Apply",
      danger: false,
    });
    if (!ok) return;
    setApplying(true);
    try {
      const r = await DeviceApplyTraceFix(device.id, toQuery(asked), preview.plan.id, preview.plan.fingerprint);
      setApplied(r);
      setPreview(null);
      if (r.after) {
        setTrace(r.after);
        setReplay((k) => k + 1);
      }
      if (r.error) message.error(r.error);
      else message.success("Fix applied — the trace is now read back from the firewall");
    } catch (e: unknown) {
      message.error(errorText(e, "The fix could not be applied"));
      // A stale preview (409) means the firewall changed: re-trace so the offered fixes are current.
      if ((e as { response?: { status?: number } })?.response?.status === 409) void run(asked);
    } finally {
      setApplying(false);
    }
  };

  /** Puts back everything the applied fix wrote, then traces again. Admin only. */
  const undoFix = async () => {
    if (!device || !applied) return;
    const ok = await confirm({
      title: "Undo this fix?",
      content: "Everything it wrote is put back, newest first. The trace runs again afterwards.",
      okText: "Undo",
    });
    if (!ok) return;
    setUndoing(true);
    try {
      const r = await DeviceUndoTraceFix(device.id, applied.change_ids);
      const failed = r.results.filter((x) => !x.ok);
      if (failed.length) {
        message.error(`Changes that could not be undone: ${failed.length}. ${failed[0].error ?? ""}`);
      } else {
        message.success("Undone — the firewall is back as it was");
        setApplied(null);
      }
      if (asked) void run(asked);
    } catch (e: unknown) {
      message.error(errorText(e, "The fix could not be undone"));
    } finally {
      setUndoing(false);
    }
  };

  const fixes = useMemo(() => (trace ? fixesFor(trace) : []), [trace]);
  const inputCls = "shell-input h-9 w-full text-[12.5px]";

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      message.success("Copied");
    } catch {
      message.error("Could not copy — select the text and press Ctrl+C");
    }
  };

  return (
    <div className="page-stack">

      {/* Ping shares this page as an admin-only tab; a non-admin sees no tab bar, only the walk. */}
      {isAdmin && (
        <div className="seg" role="tablist" aria-label="Diagnostics tool">
          <button type="button" role="tab" aria-selected={tab === "trace"} onClick={() => setTab("trace")}
            className={`seg-item inline-flex items-center gap-1.5${tab === "trace" ? " seg-item--on" : ""}`}>
            <FiCrosshair size={12} /> Why can't A reach B?
          </button>
          <button type="button" role="tab" aria-selected={tab === "ping"} onClick={() => setTab("ping")}
            className={`seg-item inline-flex items-center gap-1.5${tab === "ping" ? " seg-item--on" : ""}`}>
            <FiActivity size={12} /> Ping
          </button>
        </div>
      )}

      {tab === "ping" ? (
        <PingPanel />
      ) : (
        <>

      {/* ── The question ─────────────────────────────────────────────────────── */}
      <section className="shell-card p-4">
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
          <label className="block">
            <span className="t-label mb-1 block">Source IP</span>
            <input className={inputCls} value={src} onChange={(e) => setSrc(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()} placeholder="192.168.1.50" />
          </label>
          <label className="block">
            <span className="t-label mb-1 block">Destination IP or host name</span>
            <input className={inputCls} value={dst} onChange={(e) => setDst(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()} placeholder="8.8.8.8 or example.com" />
          </label>
          <div className="block">
            <span className="t-label mb-1 block">Protocol</span>
            <MinimalSelect ariaLabel="Protocol" className="w-full" value={protocol} onChange={setProtocol}
              options={PROTOCOLS.map((p) => ({ value: p.value, label: p.label }))} />
          </div>
          <label className="block">
            <span className="t-label mb-1 block">Destination port</span>
            <input className={inputCls} value={needsPort ? port : ""} onChange={(e) => setPort(e.target.value)} disabled={!needsPort}
              onKeyDown={(e) => e.key === "Enter" && run()} placeholder={needsPort ? "443" : "not used for ICMP"} />
          </label>
          <div className="block">
            <span className="t-label mb-1 block">Incoming interface</span>
            {/* Default: the device's own routing table decides, which is what a reverse-path check
                does. Choosing one is for testing a source that is not routed back this way. */}
            <MinimalSelect ariaLabel="Incoming interface" className="w-full" value={srcIntf} onChange={setSrcIntf}
              options={[
                { value: "", label: "Automatic (from the routing table)" },
                ...interfaces.map((i) => ({ value: i, label: i })),
              ]} />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="t-meta mr-1">Service:</span>
          {PRESETS.map((p) => {
            const on = protocol === p.protocol && (p.port === "" || port === p.port);
            return (
              <button key={p.label} type="button" onClick={() => { setProtocol(p.protocol); if (p.port) setPort(p.port); }}
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold transition ${
                  on ? "border-transparent text-white" : "hairline ink-2 surface-hover"}`}
                style={on ? { background: currentColor } : undefined}>
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => void run()} disabled={loading || !device}
            className="btn btn-accent gap-1.5 disabled:opacity-50">
            {loading ? <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <FiCrosshair size={13} />}
            Trace the path
          </button>
          <button type="button" onClick={swap} disabled={loading || !src || !dst}
            className="btn btn-ghost hairline gap-1.5 border disabled:opacity-50" title="Trace the reply direction: destination back to source">
            <FiRepeat size={12} /> Reverse direction
          </button>
          <p className="t-meta m-0">Reads from the device only — writes nothing, uses no AI</p>
        </div>

      </section>

      {error && (
        <div className="banner banner-warn flex items-start gap-2">
          <FiAlertTriangle size={13} className="mt-0.5 shrink-0" />
          <span className="text-[12px]">{error}</span>
        </div>
      )}

      {!trace && !error && (
        <div className="flex flex-col items-center rounded-[4px] border border-dashed hairline py-14 text-center ink-3">
          <FiHelpCircle size={28} className="mb-3 opacity-30" />
          <p className="t-body m-0">Fill in a source, a destination and a service, then press “Trace the path”</p>
          <p className="t-meta m-0 mt-1 max-w-lg">
            You will see the route the packet takes, the policy that decides it and why every policy above it
            was passed over, what NAT does, whether anything inspects it — and what to change if it is blocked.
          </p>
        </div>
      )}

      {applied && (
        <div ref={appliedRef} className="scroll-mt-4">
          <FixAppliedPanel result={applied} undoing={undoing} isAdmin={isAdmin}
            onUndo={() => void undoFix()} onDismiss={() => setApplied(null)} />
        </div>
      )}

      {trace && (
        <>
          {/* ── The verdict + the path ─────────────────────────────────────── */}
          <section className="shell-card overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b hairline-2 px-4 py-3"
              style={{ background: `${VERDICT[trace.verdict].tone}12` }}>
              <span style={{ color: VERDICT[trace.verdict].tone }}>{VERDICT[trace.verdict].icon}</span>
              <div className="min-w-0 flex-1">
                <p className="m-0 text-[15px] font-bold" style={{ color: VERDICT[trace.verdict].tone }}>
                  {VERDICT[trace.verdict].label}
                </p>
                <p className="t-body m-0 ink">{headline(trace)}</p>
                {trace.resolved_from && (
                  <p className="t-meta m-0 mt-1 flex flex-wrap items-center gap-1.5">
                    {/* <code>: a host name and an address are data, not words to translate. */}
                    <span className="chip font-mono">
                      <code style={{ fontSize: "inherit" }}>{`${trace.resolved_from} → ${trace.query.dst_ip}`}</code>
                    </span>
                    {(trace.resolved_ips?.length ?? 0) > 1 && (
                      <span className="chip" title={trace.resolved_ips!.join(", ")}>
                        <code style={{ fontSize: "inherit" }}>{`+${trace.resolved_ips!.length - 1}`}</code>
                      </span>
                    )}
                    <span>Resolved by this console's DNS. The FortiGate may get a different address — a CDN answers each resolver by location.</span>
                  </p>
                )}
                {!!trace.notes?.length && (
                  <div className="mt-2 rounded-[4px] border border-amber-300/50 bg-amber-500/8 px-3 py-2">
                    <p className="m-0 mb-1 flex items-center gap-1.5 text-[11.5px] font-bold text-amber-700 dark:text-amber-400">
                      <FiAlertTriangle size={12} /> Worth knowing about this trace
                    </p>
                    <ul className="m-0 ml-4 list-disc space-y-0.5 text-[11.5px] text-amber-700 dark:text-amber-300">
                      {trace.notes.map((n, i) => <li key={i}>{n}</li>)}
                    </ul>
                  </div>
                )}
              </div>
              {/* The narrowest fix, one click away — it opens the what-if, it does not write. */}
              {!!trace.fixes?.length && (
                <button type="button" onClick={() => void previewFix(trace.fixes![0].id)} disabled={!!previewing}
                  className="btn btn-accent btn-sm gap-1.5 disabled:opacity-60">
                  {previewing === trace.fixes[0].id
                    ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    : <FiZap size={12} />}
                  <span>Fix it</span>
                </button>
              )}
              <button type="button" onClick={() => setReplay((k) => k + 1)} className="btn btn-ghost btn-sm hairline gap-1.5 border">
                <FiRotateCcw size={11} /> Replay
              </button>
            </div>
            <div className="px-3 py-2">
              <PacketFlow key={replay} trace={trace} />
            </div>
          </section>

          {/* ── What if: a fix, simulated before anything is written ───────── */}
          {preview && (
            <div ref={previewRef} className="scroll-mt-4">
              <FixPreviewPanel preview={preview} isAdmin={isAdmin} applying={applying} accent={currentColor}
                onApply={() => void applyFix()} onClose={() => setPreview(null)}
                onCopied={(ok) => (ok ? message.success("Copied") : message.error("Could not copy — select the text and press Ctrl+C"))} />
            </div>
          )}

          {/* ── How to fix it — only when there is something to fix ─────────── */}
          {trace.verdict !== "allowed" && (
            <Section title="How to fix it" icon={<FiTool />} accent={currentColor}>
              <div className="space-y-2.5">
                {fixes.map((f, i) => (
                  <div key={i} className="rounded-[4px] border hairline-2 px-3 py-2.5"
                    style={f.planId && preview?.plan.id === f.planId ? { borderColor: currentColor } : undefined}>
                    <p className="m-0 text-[12.5px] font-semibold ink">{f.title}</p>
                    <p className="t-meta m-0 mt-0.5">{f.detail}</p>
                    {f.planId && (
                      <button type="button" onClick={() => void previewFix(f.planId!)} disabled={!!previewing}
                        className="btn btn-soft btn-sm mt-2 gap-1.5 disabled:opacity-60">
                        {previewing === f.planId
                          ? <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                          : <FiEye size={12} />}
                        <span>Preview this fix</span>
                      </button>
                    )}
                    {f.cli && (
                      <div className="relative mt-2">
                        <pre className="code-surface m-0 overflow-x-auto rounded-[4px] px-3 py-2 text-[11px]">{f.cli}</pre>
                        <button type="button" onClick={() => void copy(f.cli!)} className="btn-icon absolute right-1.5 top-1.5 h-6 w-6 text-[11px]"
                          aria-label="Copy the CLI" title="Copy the CLI">
                          <FiCopy />
                        </button>
                      </div>
                    )}
                    {f.link && (
                      <Link to={f.link.to} className="mt-1.5 inline-flex items-center gap-1 text-[11.5px] font-semibold" style={{ color: currentColor }}>
                        {/* In a <span>: the i18n runtime translates text inside HTML elements, and <Link>
                            is a component — a bare label here rendered English in every language. */}
                        <FiExternalLink size={11} /> <span>{f.link.label}</span>
                      </Link>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {/* ── Every rule ─────────────────────────────────────────────────── */}
          <Section title="Every policy checked (top to bottom · first match wins)" icon={<FiPlay />} accent={currentColor}
            action={<span className="t-meta">{`${trace.evaluated.length} checked of ${trace.total}`}</span>}>
            <PolicyMatrix trace={trace} />
            <p className="t-meta m-0 mt-2">Click a policy to see each criterion, what it lists, and what the packet had.</p>
          </Section>
        </>
      )}
        </>
      )}
    </div>
  );
};

export default TroubleshootingPage;
