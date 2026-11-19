import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FiActivity, FiChevronRight, FiGlobe, FiPlay, FiSquare, FiTarget } from "react-icons/fi";
import { NoDeviceState } from "../../components/ui/StateBlock";
import MinimalSelect from "../../components/ui/MinimalSelect";
import { useSelectedDevice } from "../../contexts/DeviceContext.logic";
import { useDiagStream } from "./diagStream";
import { DiagError, Field, LiveConsole, Panel, Stat } from "./diag-ui";
import { latencyTone } from "./diagFormat";
import { useFreshFrom } from "./useFreshFrom";

// Ping — from the FIREWALL, live.
//
// This was its own page; it now lives as the "Ping" tab of Troubleshooting. The two belong together —
// Troubleshooting answers "why can't A reach B?" by walking the policy table, and Ping answers the
// other half of the same question, "does the far end actually answer?", by asking the device. It is a
// tab rather than a page because it opens SSH (the policy walk does not), so the tab is admin-only
// even though the page around it is open to everyone.
//
// Two things make it what it is.
//
// First, it pings from the DEVICE, not from this server. The Devices list already pings each firewall
// from the backend container to show whether it is up. That answers "can the app reach the firewall?"
// and cannot answer "can the firewall reach the internet?" — which is the question someone opens a
// diagnostics tool to ask.
//
// Second, it is streamed. FortiOS emits its replies one per second (measured: 1.000s apart on the lab
// FGT80E), so the replies tick in as the device gets them instead of appearing in a lump five seconds
// later. The socket is opened by useDiagStream; the backend runs `execute ping` over SSH and forwards
// each line as it is printed.

const COUNTS = [3, 5, 10];

/** One ICMP reply, drawn as a bar so the shape of the latency is visible at a glance. */
const ReplyRow: React.FC<{ seq: number; ttl: number; ms: number; worst: number; fresh: boolean }> =
  ({ seq, ttl, ms, worst, fresh }) => {
    const tone = latencyTone(ms);
    const colour = tone === "ok" ? "#10b981" : tone === "warn" ? "#f59e0b" : "#ef4444";
    return (
      <div className={`flex items-center gap-2.5 ${fresh ? "diag-row-in" : ""}`}>
        <span className="w-10 shrink-0 text-right font-mono text-[10.5px] ink-3">#{seq}</span>
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full surface-sunken">
          <div
            className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${Math.max(4, (ms / Math.max(worst, 1)) * 100)}%`, background: colour }}
          />
        </div>
        <span className="w-16 shrink-0 text-right font-mono text-[11px] tnum ink">{ms.toFixed(1)} ms</span>
        <span className="w-14 shrink-0 text-right text-[10.5px] tnum ink-3">ttl {ttl}</span>
      </div>
    );
  };

const PingPanel: React.FC = () => {
  const { device } = useSelectedDevice();

  // Prefilled from `?host=` so "Ping this hop" on the Trace Route page lands here ready to run.
  const [params] = useSearchParams();
  const [target, setTarget] = useState(() => params.get("host")?.trim() || "8.8.8.8");
  const [count, setCount] = useState(5);
  const [size, setSize] = useState(56);
  const [sourceIP, setSourceIP] = useState("");

  const stream = useDiagStream(device?.id ?? null, "ping");
  const { status, lines, replies, resolvedIP, pingResult, error, running, start, stop } = stream;

  // Which replies are new since the last change, so only those animate in. Without this every row
  // re-animates on each arrival and the list flickers instead of growing.
  const freshFrom = useFreshFrom(replies.length);

  const run = () => {
    if (!device || running || !target.trim()) return;
    start({ target: target.trim(), count, size, source: sourceIP.trim() || undefined });
  };

  const worst = replies.reduce((m, r) => Math.max(m, r.time_ms), 0) || 1;
  // While the run is live these come from the replies as they land; once it finishes the backend's
  // own summary takes over, because that is the parse the non-streaming path would have produced.
  const received = pingResult?.received ?? replies.length;
  const transmitted = pingResult?.transmitted ?? count;
  const lossPercent = pingResult?.loss_percent ?? null;
  const allLost = pingResult?.all_lost ?? false;
  const avg = pingResult?.avg_ms ?? (replies.length
    ? replies.reduce((a, r) => a + r.time_ms, 0) / replies.length
    : 0);

  const started = status !== "idle";

  if (!device) return <NoDeviceState />;

  return (
    <div className="page-stack">
      <Panel title="Destination" icon={<FiTarget size={13} />}>
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5"
          onSubmit={(e) => { e.preventDefault(); run(); }}
        >
          <Field label="Host or IP" hint="A domain name works too — the resolved IP is shown as well" className="lg:col-span-2">
            <input
              className="shell-input"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="8.8.8.8 or www.google.com"
              disabled={running}
            />
          </Field>

          <Field label="Packets">
            <MinimalSelect ariaLabel="Packets" className="w-full" value={String(count)} disabled={running}
              onChange={(v) => setCount(Number(v))}
              options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))} />
          </Field>

          <Field label="Size (bytes)" hint="32–1400">
            <input className="shell-input" type="number" min={32} max={1400} value={size}
              disabled={running} onChange={(e) => setSize(Number(e.target.value))} />
          </Field>

          <Field label="Source IP" hint="Leave blank and the device chooses">
            <input className="shell-input" value={sourceIP} disabled={running}
              onChange={(e) => setSourceIP(e.target.value)} placeholder="e.g. 10.0.99.201" />
          </Field>

          <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-5">
            <button type="submit" className="btn btn-accent btn-sm" disabled={running || !target.trim()}>
              <FiPlay size={13} />
              {running ? "Pinging…" : "Ping"}
            </button>
            {/* Stop is not cosmetic: it tells the backend to abort the command, which releases
                the device's diagnostic lock instead of leaving the next run queued behind it. */}
            {running && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={stop}>
                <FiSquare size={12} />
                Stop
              </button>
            )}
          </div>
        </form>
      </Panel>

      {error && <DiagError message={error} />}

      {started && (
        <>
          {/* The resolved address appears the moment the device prints it — before any reply.
              FortiOS 7.2 has no nslookup, so this IS the forward DNS answer from the firewall. */}
          {resolvedIP && resolvedIP !== target.trim() && (
            <div className="panel panel-body flex flex-wrap items-center gap-2">
              <FiGlobe size={14} className="accent-text" />
              <span className="t-body font-semibold">{target.trim()}</span>
              <FiChevronRight size={12} className="ink-3" />
              <span className="t-mono rounded-[4px] surface-sunken px-2 py-0.5 text-[12px] font-semibold">
                {resolvedIP}
              </span>
              <span className="t-meta">(the device resolved this name)</span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Sent / received"
              value={`${running ? replies.length : transmitted} / ${received}`}
              tone={allLost ? "danger" : lossPercent ? "warn" : "ok"}
              hint={running ? "Counting while packets are still going out" : undefined}
            />
            <Stat
              label="Packet loss"
              value={lossPercent === null ? "…" : lossPercent}
              unit={lossPercent === null ? undefined : "%"}
              tone={lossPercent === null ? "plain" : lossPercent === 0 ? "ok" : lossPercent < 100 ? "warn" : "danger"}
            />
            {/* A total loss prints no round-trip line at all, so the average shows "—" rather
                than 0 ms — "instant" and "never came back" must not look alike. */}
            <Stat
              label="Average"
              value={allLost ? "—" : avg ? avg.toFixed(1) : "…"}
              unit={allLost || !avg ? undefined : "ms"}
              tone={allLost ? "danger" : avg ? latencyTone(avg) : "plain"}
            />
            <Stat
              label="Min / max"
              value={pingResult && !allLost
                ? `${pingResult.min_ms.toFixed(1)} / ${pingResult.max_ms.toFixed(1)}`
                : allLost ? "—" : "…"}
              unit={pingResult && !allLost ? "ms" : undefined}
            />
          </div>

          <Panel
            title={`Result — ${target.trim()}`}
            icon={<FiActivity size={13} />}
            right={running
              ? <span className="t-meta flex items-center gap-1.5">
                  <span className="diag-live-dot" /> Receiving live
                </span>
              : undefined}
          >
            {allLost ? (
              <p className="m-0 text-[12.5px] font-semibold text-red-700 dark:text-red-400">
                The device finished, but <strong>not one packet came back</strong> —
                the destination may not answer ICMP, a policy may be blocking it, or there is no route to it
              </p>
            ) : replies.length === 0 ? (
              <p className="m-0 text-[12.5px] ink-2">
                {running ? "Waiting for the first packet from the device…" : "No per-packet detail — see the raw output below"}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {replies.map((r, i) => (
                  <ReplyRow key={`${r.seq}-${i}`} seq={r.seq} ttl={r.ttl} ms={r.time_ms}
                    worst={worst} fresh={i >= freshFrom} />
                ))}
              </div>
            )}

            <LiveConsole lines={lines} running={running} />
          </Panel>
        </>
      )}
    </div>
  );
};

export default PingPanel;
