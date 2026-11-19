import React from "react";
import { useNavigate } from "react-router-dom";
import {
  FiChevronLeft, FiSave, FiHardDrive, FiAlertTriangle,
  FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink,
} from "react-icons/fi";
import PageHeader from "../../components/ui/PageHeader";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import type { NetworkDevice } from "../../api/device";

// The page chrome shared by the three SD-WAN forms.
//
// They were dialogs. A dialog was the wrong shape for them: the Priority Rule form alone has four
// strategies, six pickers and a dozen fields, which meant a scrolling box floating over a table the
// user could not read anyway — and no URL, so a half-filled rule could not be linked to, reloaded,
// or reached with the browser's Back button. Each one is a page now, matching how the Security
// Profile forms in this console already work.

export const SDWAN_DOCS = "https://docs.fortinet.com/document/fortigate/7.2.10/administration-guide/357698/sd-wan";

const InfoPanel: React.FC<{ device: NetworkDevice | null; currentColor: string }> = ({ device, currentColor }) => (
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
          <p className="text-[13px] font-semibold ink">{device?.name ?? "—"}</p>
          {device && <p className="text-[10px] font-mono ink-3">{device.mgmt_ip}</p>}
        </div>
      </div>
    </div>

    <div className="rounded-[4px] border hairline-2 surface-card shadow-sm overflow-hidden">
      <div className="border-b hairline-2 px-4 py-2.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.12em] ink-3">Online Guides</p>
      </div>
      <div className="px-4 py-2 space-y-0.5">
        {[
          { icon: <FiBookOpen size={13} />, label: "Relevant Documentation", href: SDWAN_DOCS },
          { icon: <FiVideo size={13} />, label: "Video Tutorials", href: "https://video.fortinet.com/" },
        ].map(({ icon, label, href }) => (
          <a key={label} href={href} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
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
          className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}>
          <FiMessageSquare size={13} /> Join the Discussion <FiExternalLink size={10} className="ml-auto opacity-60" />
        </a>
      </div>
    </div>
  </div>
);

export type SDWANFormShellProps = {
  icon: React.ReactNode;
  title: string;
  device: NetworkDevice | null;
  /** Where Cancel and a successful save return to — carries the tab so the list opens where it was. */
  backTo: string;
  loading?: boolean;
  saving?: boolean;
  error?: string;
  onSubmit: () => void;
  children: React.ReactNode;
};

export const SDWANFormShell: React.FC<SDWANFormShellProps> = ({
  icon, title, device, backTo, loading, saving, error, onSubmit, children,
}) => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const gradient = `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))`;

  if (loading) {
    return <div className="py-24 text-center text-[13px] ink-3">Loading…</div>;
  }

  return (
    <div className="space-y-4">
      <PageHeader
        icon={icon}
        title={title}
        accent={currentColor}
        actions={
          <button type="button" onClick={() => navigate(backTo)}
            className="inline-flex items-center gap-1.5 rounded-[4px] border hairline surface-card px-3 py-1.5 text-[12px] font-semibold ink-2 surface-hover transition">
            <FiChevronLeft size={14} /> Back
          </button>
        }
      />

      {!device && (
        <div className="rounded-[4px] border border-red-200 bg-red-50 px-4 py-2 text-[12px] text-red-600">
          No device — go back and select a device
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>
        <div className="grid gap-4" style={{ gridTemplateColumns: "1fr 270px" }}>
          <div className="overflow-hidden rounded-[4px] border hairline surface-card shadow-sm">
            {error && (
              <div className="m-4 flex items-start gap-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:border-red-400/25 dark:bg-red-500/10 dark:text-red-300">
                <FiAlertTriangle className="mt-0.5 shrink-0" size={13} />
                <span>{error}</span>
              </div>
            )}
            {children}
          </div>

          <InfoPanel device={device} currentColor={currentColor} />
        </div>

        <div className="mt-4 flex justify-end gap-3">
          <button type="button" onClick={() => navigate(backTo)}
            className="h-10 px-5 rounded-[4px] border hairline text-[13px] font-semibold ink-2 surface-hover transition">
            Cancel
          </button>
          <button type="submit" disabled={saving || !device}
            className="h-10 px-6 rounded-[4px] text-[13px] font-semibold text-white flex items-center gap-2 transition disabled:opacity-50"
            style={{ background: gradient, boxShadow: `0 4px 14px -4px ${currentColor}50` }}>
            {saving
              ? <><div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> Saving…</>
              : <><FiSave size={14} /> OK</>}
          </button>
        </div>
      </form>
    </div>
  );
};

// ── Shared field styling, so the three forms read as one form ────────────────
export const fRow = "flex items-start gap-3";
export const fLabel = "block w-[160px] shrink-0 pt-1.5 text-[12px] font-medium ink-2";
export const fInput = "h-8 w-full rounded border hairline surface-card px-2.5 text-[13px] ink outline-none transition";
export const fSection = "border-y hairline-2 surface-sunken px-5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] ink-3";

export default SDWANFormShell;
