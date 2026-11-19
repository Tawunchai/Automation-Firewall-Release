import React, { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import { message } from "../../components/ui/toast";
import {
  FiZap, FiChevronLeft, FiSave,
  FiHardDrive, FiTerminal, FiBookOpen, FiVideo,
  FiMessageSquare, FiExternalLink, FiX, FiMaximize2, FiMinimize2, FiCopy,
} from "react-icons/fi";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import PageHeader from "../../components/ui/PageHeader";
import { ListDevices, type NetworkDevice } from "../../api/device";
import { DeviceCreateService, DeviceListServices, DeviceGetInfo } from "../../api/policyObject";
import { ServiceFieldsBasic, ServiceFieldsProtocol } from "./service-form";
import { buildServicePayload, validateServiceForm, blankServiceForm, fmtSvcCLI, type ServiceFormState } from "./service-form.logic";
import { apiErrorDetail } from "../../api/errorText";

// ─── Interactive CLI Modal ────────────────────────────────────────────────────
export const CliModal: React.FC<{ hostname: string; deviceId: number; onClose: () => void }> = ({ hostname, deviceId, onClose }) => {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [histIdx, setHistIdx] = useState(-1);
  const [maximized, setMaximized] = useState(false);
  const [copied, setCopied] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);
  const prompt = `${hostname} (custom) # `;

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);

  useEffect(() => {
    DeviceListServices(deviceId).then((svcs) => {
      setLines(fmtSvcCLI(svcs, hostname).split("\n").concat([prompt]));
    }).catch(() => {
      setLines([`${hostname} (custom) # show`, "Error: Failed to fetch configuration", prompt]);
    }).finally(() => { setLoading(false); setTimeout(() => inputRef.current?.focus(), 100); });
  }, [deviceId, hostname, prompt]);

  const runCommand = useCallback((cmd: string) => {
    const c = cmd.trim().toLowerCase();
    let out: string[] = [];
    if (c === "") { /* noop */ }
    else if (c.includes("service")) {
      DeviceListServices(deviceId).then((svcs) => {
        setLines((p) => [...p.filter((l) => !l.endsWith("# ")), fmtSvcCLI(svcs, hostname), prompt]);
      });
      return;
    } else if (c === "get system status" || c === "get status") {
      out = [`Hostname: ${hostname}`, `System time: ${new Date().toUTCString()}`];
    } else if (c === "help" || c === "?") {
      out = ["show config firewall service custom", "get system status", "exit"];
    } else if (c === "exit" || c === "q" || c === "quit") { onClose(); return; }
    else { out = [`Command parse error before '${cmd}'`]; }
    setLines((p) => [...p.filter((l) => !l.endsWith("# ")), ...out, prompt]);
  }, [deviceId, hostname, onClose, prompt]);

  const handleKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const cmd = input;
      setLines((p) => [...p.filter((l) => !l.endsWith("# ")), `${prompt}${cmd}`]);
      if (cmd.trim()) setHistory((h) => [cmd, ...h]);
      setHistIdx(-1); setInput(""); runCommand(cmd);
    } else if (e.key === "ArrowUp") { e.preventDefault(); const n = Math.min(histIdx + 1, history.length - 1); setHistIdx(n); setInput(history[n] ?? ""); }
    else if (e.key === "ArrowDown") { e.preventDefault(); const n = Math.max(histIdx - 1, -1); setHistIdx(n); setInput(n === -1 ? "" : (history[n] ?? "")); }
    else if (e.key === "Escape") onClose();
  };

  const outputText = lines.filter((l) => !l.endsWith("# ")).join("\n");

  return createPortal(
    <div className="fixed inset-0 z-9999 flex items-center justify-center p-4">
      <div role="presentation" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div role="presentation" className={`relative z-10 flex flex-col overflow-hidden rounded-[4px] shadow-2xl transition-all duration-200 ${maximized ? "w-full h-full rounded-none" : "w-full max-w-3xl"}`}
        style={{ height: maximized ? "100%" : "520px", border: "1px solid rgba(255,255,255,.08)" }}
        onClick={() => inputRef.current?.focus()}>
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
        <div ref={outputRef} className="flex-1 overflow-auto bg-[#1a1a1a] px-4 pt-3 pb-1 font-mono text-[12px] leading-[1.7] text-[#d4d4d4]">
          {loading ? <div className="flex items-center gap-2 text-green-400"><div className="h-3 w-3 animate-spin rounded-full border-2 border-green-400 border-t-transparent" /> Loading…</div>
            : <pre className="whitespace-pre-wrap break-all">{outputText}</pre>}
        </div>
        {!loading && (
          <div role="presentation" className="flex items-center bg-[#1a1a1a] px-4 pb-2" onClick={(e) => e.stopPropagation()}>
            <span className="shrink-0 font-mono text-[12px] text-[#d4d4d4] whitespace-nowrap">{prompt}</span>
            <input ref={inputRef} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={handleKey}
              className="flex-1 bg-transparent font-mono text-[12px] text-[#d4d4d4] outline-none caret-green-400 placeholder:text-white/20"
              autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="Type a command and press Enter…" />
            <span className="ml-1 h-4 w-1.5 animate-pulse bg-[#d4d4d4]/80" />
          </div>
        )}
        <div className="flex h-6 shrink-0 items-center justify-between bg-[#252525] px-3">
          <span className="text-[10px] text-white/35">{hostname} · firewall service custom · ESC close</span>
          {copied && <span className="text-[10px] text-green-400">Copied!</span>}
        </div>
      </div>
    </div>,
    document.body
  );
};

// ─── Right Info Panel ─────────────────────────────────────────────────────────
export const InfoPanel: React.FC<{ device: NetworkDevice | null; hostname: string; currentColor: string; onCLI: () => void }> = ({ device, hostname, currentColor, onCLI }) => (
  <div className="space-y-3">
    <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">FortiGate</p>
      </div>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
          style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
          <FiHardDrive size={12} />
        </div>
        <div>
          <p className="text-[13px] font-semibold ink">{hostname || (device?.name ?? "—")}</p>
          {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
        </div>
      </div>
    </div>

    <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Additional Information</p>
      </div>
      <div className="px-4 py-2">
        <button type="button" onClick={onCLI}
          className="flex w-full items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] ink-2 surface-hover hover-ink transition-colors">
          <FiTerminal size={13} className="ink-3" /> Edit in CLI
        </button>
      </div>
    </div>

    <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
      </div>
      <div className="px-4 py-2 space-y-0.5">
        {[
          { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/954635/services" },
          { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
        ].map(({ icon, label, href }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
            {icon} {label} <FiExternalLink size={10} className="ml-auto opacity-60" />
          </a>
        ))}
      </div>
    </div>

    <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Fortinet Community</p>
      </div>
      <div className="px-4 py-2">
        <a href="https://community.fortinet.com/" target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
          <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
        </a>
      </div>
    </div>
  </div>
);

// ─── Main Page ────────────────────────────────────────────────────────────────
const FwServicesCreatePage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  const [device, setDevice]       = useState<NetworkDevice | null>(null);
  const [hostname, setHostname]   = useState("");
  const [loadingDev, setLoadingDev] = useState(true);
  const [showCLI, setShowCLI]     = useState(false);

  const [form, setForm]     = useState<ServiceFormState>(blankServiceForm);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof ServiceFormState>(k: K, v: ServiceFormState[K]) => setForm((p) => ({ ...p, [k]: v }));

  useEffect(() => {
    const id = searchParams.get("deviceId");
    if (!id) { setLoadingDev(false); return; }
    ListDevices().then(async (list) => {
      const found = list.find((d) => d.id === Number(id)) ?? null;
      setDevice(found);
      if (found) {
        const info = await DeviceGetInfo(found.id);
        setHostname(info.hostname || found.name);
      }
    }).finally(() => setLoadingDev(false));
  }, [searchParams]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateServiceForm(form);
    if (!device) errs.device = "No device";
    if (Object.keys(errs).length) { setErrors(errs); return; }
    setErrors({});
    try {
      setSaving(true);
      await DeviceCreateService(device!.id, buildServicePayload(form));
      message.success(`Service "${form.name}" created on ${hostname || device!.name}`);
      navigate(`/admin/fw-services?deviceId=${device!.id}`);
    } catch (err) {
      message.error(apiErrorDetail(err, "Failed to create service"));
    } finally {
      setSaving(false);
    }
  };

  const fieldsProps = { form, set, errors, currentColor };

  return (
    <div className="space-y-4">
      <PageHeader icon={<FiZap />} title="New Service" accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(-1)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!loadingDev && !device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="overflow-hidden rounded-[4px] border hairline surface-card shadow-sm">
            <ServiceFieldsBasic {...fieldsProps} />
            <ServiceFieldsProtocol {...fieldsProps} />
          </div>

          <InfoPanel device={device} hostname={hostname} currentColor={currentColor} onCLI={() => setShowCLI(true)} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(-1)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> Create Service</>}
          </button>
        </div>
      </form>

      {showCLI && device && (
        <CliModal hostname={hostname || device.name} deviceId={device.id} onClose={() => setShowCLI(false)} />
      )}
    </div>
  );
};

export default FwServicesCreatePage;
