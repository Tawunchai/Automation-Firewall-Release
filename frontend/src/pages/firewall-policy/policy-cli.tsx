import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiTerminal, FiX, FiCopy, FiMaximize2, FiMinimize2 } from "react-icons/fi";
import { DeviceListPolicies, type FirewallPolicy } from "../../api/policyObject";

// The device's own `show firewall policy` output, rendered from what the policy list already
// returned, plus the modal that shows it.
//
// It is here rather than in create.tsx because the modal is opened from four pages (create, edit,
// and the two object pages' info panels) and belongs to none of them.


// ─── CLI output ───────────────────────────────────────────────────────────────
function fmtPolicyCLI(policies: FirewallPolicy[], hostname: string): string {
  const L: string[] = [`${hostname} # show`, "config firewall policy"];
  policies.slice(0, 30).forEach((p) => {
    L.push(`    edit ${p.id}`);
    L.push(`        set name "${p.name}"`);
    L.push(`        set srcintf "${(p.src_intf_list || [p.src_intf]).join('" "')}"`);
    L.push(`        set dstintf "${(p.dst_intf_list || [p.dst_intf]).join('" "')}"`);
    L.push(`        set srcaddr "${(p.src_addr_list || []).join('" "') || "all"}"`);
    L.push(`        set dstaddr "${(p.dst_addr_list || []).join('" "') || "all"}"`);
    L.push(`        set action ${p.action}`);
    L.push(`        set schedule "${p.schedule}"`);
    L.push(`        set service "${(p.service_list || []).join('" "') || "ALL"}"`);
    if (p.nat) L.push(`        set nat enable`);
    L.push(`        set logtraffic ${p.log_traffic}`);
    L.push(`    next`);
  });
  L.push("end");
  return L.join("\n");
}

// ─── CLI Modal ────────────────────────────────────────────────────────────────
export const CliModal: React.FC<{ hostname: string; deviceId: number; onClose: () => void }> = ({ hostname, deviceId, onClose }) => {
  const [lines, setLines]     = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput]     = useState("");
  const [hist, setHist]       = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [maximized, setMaximized] = useState(false);
  const [copied, setCopied]   = useState(false);
  const outRef = useRef<HTMLDivElement>(null);
  const inpRef = useRef<HTMLInputElement>(null);
  const prompt = `${hostname} # `;

  useEffect(() => { if (outRef.current) outRef.current.scrollTop = outRef.current.scrollHeight; }, [lines]);
  useEffect(() => {
    DeviceListPolicies(deviceId).then((p) => {
      setLines(fmtPolicyCLI(p, hostname).split("\n").concat([prompt]));
    }).catch(() => {
      setLines([`${hostname} # show`, "Error", prompt]);
    }).finally(() => { setLoading(false); setTimeout(() => inpRef.current?.focus(), 100); });
  }, [deviceId, hostname, prompt]);

  const run = (cmd: string) => {
    const c = cmd.trim().toLowerCase();
    if (c === "exit" || c === "q" || c === "quit") { onClose(); return; }
    if (c.includes("policy")) {
      DeviceListPolicies(deviceId).then((p) => {
        setLines((prev) => [...prev.filter((l) => !l.endsWith("# ")), fmtPolicyCLI(p, hostname), prompt]);
      }); return;
    }
    setLines((p) => [...p.filter((l) => !l.endsWith("# ")), `Command parse error before '${cmd}'`, prompt]);
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const cmd = input;
      setLines((p) => [...p.filter((l) => !l.endsWith("# ")), `${prompt}${cmd}`]);
      if (cmd.trim()) setHist((h) => [cmd, ...h]);
      setHistIdx(-1); setInput(""); run(cmd);
    } else if (e.key === "ArrowUp") { e.preventDefault(); const n = Math.min(histIdx + 1, hist.length - 1); setHistIdx(n); setInput(hist[n] ?? ""); }
    else if (e.key === "ArrowDown") { e.preventDefault(); const n = Math.max(histIdx - 1, -1); setHistIdx(n); setInput(n === -1 ? "" : (hist[n] ?? "")); }
    else if (e.key === "Escape") onClose();
  };

  const outputText = lines.filter((l) => !l.endsWith("# ")).join("\n");

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <div role="presentation" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="presentation" className={`relative z-10 flex flex-col overflow-hidden rounded-[4px] transition-all ${maximized ? "w-full h-full rounded-none" : "w-full max-w-3xl"}`}
        style={{ height: maximized ? "100%" : "520px", border: "1px solid rgba(255,255,255,.08)", boxShadow: "0 32px 64px rgba(0,0,0,.6)" }}
        onClick={() => inpRef.current?.focus()}>
        <div className="flex h-9 shrink-0 items-center gap-2 bg-[#3d7a3d] px-3">
          <FiTerminal size={13} className="text-white/80" />
          <span className="text-[12px] font-semibold text-white">CLI Console</span>
          <div className="ml-1 flex items-center gap-1 rounded border border-white/25 bg-white/15 px-2 py-0.5 text-[10px] text-white/80">
            <span className="text-green-300">▶</span> {hostname}
          </div>
          <div className="ml-auto flex items-center gap-1">
            <button onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(outputText); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              className="flex h-6 w-6 items-center justify-center rounded text-white/60 hover:bg-white/15 hover:text-white transition"><FiCopy size={12} /></button>
            <button onClick={(e) => { e.stopPropagation(); setMaximized(!maximized); }}
              className="flex h-6 w-6 items-center justify-center rounded text-white/60 hover:bg-white/15 hover:text-white transition">
              {maximized ? <FiMinimize2 size={12} /> : <FiMaximize2 size={12} />}
            </button>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }}
              className="flex h-6 w-6 items-center justify-center rounded text-white/60 hover:bg-red-500 hover:text-white transition"><FiX size={13} /></button>
          </div>
        </div>
        <div ref={outRef} className="flex-1 overflow-auto bg-[#1a1a1a] px-4 pt-3 pb-1 font-mono text-[12px] leading-[1.7] text-[#d4d4d4]">
          {loading ? <div className="flex items-center gap-2 text-green-400"><div className="h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent" /> Loading…</div>
            : <pre className="whitespace-pre-wrap">{outputText}</pre>}
        </div>
        {!loading && (
          <div role="presentation" className="flex items-center bg-[#1a1a1a] px-4 pb-2" onClick={(e) => e.stopPropagation()}>
            <span className="shrink-0 font-mono text-[12px] text-[#d4d4d4] whitespace-nowrap">{prompt}</span>
            <input ref={inpRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={onKey}
              className="flex-1 bg-transparent font-mono text-[12px] text-[#d4d4d4] outline-none caret-green-400"
              autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Type a command…" />
            <span className="ml-1 h-4 w-1.5 animate-pulse bg-[#d4d4d4]/80" />
          </div>
        )}
        <div className="flex h-6 shrink-0 items-center justify-between bg-[#252525] px-3">
          <span className="text-[10px] text-white/35">{hostname} · firewall policy · ESC close</span>
          {copied && <span className="text-[10px] text-green-400">Copied!</span>}
        </div>
      </div>
    </div>,
    document.body
  );
};

