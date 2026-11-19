import React from "react";
import {
  FiHardDrive, FiBookOpen, FiVideo, FiMessageSquare, FiExternalLink, FiSmartphone,
} from "react-icons/fi";
import type { NetworkDevice } from "../../api/device";

// The right-hand rail shared by every User & Authentication form. Same card structure as
// pages/fw-addresses/create.tsx (FortiGate → extra info → Online Guides → Fortinet Community),
// with the FortiExplorer card the FortiGate user/group dialogs show in that slot.

const card = "panel panel-flush";
const cardHdr = "border-b hairline-2 px-4 py-2.5 ";
const cardTitle = "text-[10px] font-bold uppercase tracking-[0.12em] ink-3";

const ExtLink: React.FC<{ href: string; icon: React.ReactNode; label: string; currentColor: string }> = ({
  href, icon, label, currentColor,
}) => (
  <a href={href} target="_blank" rel="noopener noreferrer"
    className="flex items-center gap-2 rounded-[4px] px-2 py-2 text-[12px] transition-colors" style={{ color: currentColor }}
    onMouseEnter={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = `${currentColor}10`; }}
    onMouseLeave={(e) => { (e.currentTarget as HTMLAnchorElement).style.backgroundColor = ""; }}>
    {icon} {label} <FiExternalLink size={10} className="ml-auto opacity-60" />
  </a>
);

export const UserAuthInfoPanel: React.FC<{
  device: NetworkDevice | null;
  hostname: string;
  currentColor: string;
  docsHref: string;
  docsLabel?: string;
}> = ({ device, hostname, currentColor, docsHref, docsLabel = "Relevant Documentation" }) => (
  <div className="space-y-3">
    <div className={card}>
      <div className={cardHdr}><p className={cardTitle}>FortiGate</p></div>
      <div className="flex items-center gap-2.5 px-4 py-3">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[4px] text-white"
          style={{ background: `linear-gradient(135deg, ${currentColor}, color-mix(in srgb, ${currentColor} 70%, #6366f1))` }}>
          <FiHardDrive size={12} />
        </div>
        {/* The device's OWN hostname, read live from system/global — not the inventory name the
            navbar shows, which is why this line stays. The management IP does not: the navbar
            already carries it. */}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold ink">{hostname || device?.name || "—"}</p>
        </div>
      </div>
    </div>

    <div className={card}>
      <div className={cardHdr}><p className={cardTitle}>FortiExplorer</p></div>
      <div className="px-4 py-2">
        <p className="px-2 pb-1 text-[11px] leading-relaxed ink-3">
          Manage your devices on iOS or Android. iOS users can also manage FortiToken Cloud subscriptions.
        </p>
        <ExtLink href="https://www.fortinet.com/support/product-downloads#fortiexplorer"
          icon={<FiSmartphone size={13} />} label="Get the app" currentColor={currentColor} />
      </div>
    </div>

    <div className={card}>
      <div className={cardHdr}><p className={cardTitle}>Online Guides</p></div>
      <div className="space-y-0.5 px-4 py-2">
        <ExtLink href={docsHref} icon={<FiBookOpen size={13} />} label={docsLabel} currentColor={currentColor} />
        <ExtLink href="https://video.fortinet.com/" icon={<FiVideo size={13} />} label="Video Tutorials" currentColor={currentColor} />
      </div>
    </div>

    <div className={card}>
      <div className={cardHdr}><p className={cardTitle}>Fortinet Community</p></div>
      <div className="px-4 py-2">
        <ExtLink href="https://community.fortinet.com/" icon={<FiMessageSquare size={13} />}
          label="Join the Discussion" currentColor={currentColor} />
      </div>
    </div>
  </div>
);

// ─── Wizard step bar ───────────────────────────────────────────────────────────
// The chevron strip from the FortiGate "Users/Groups Creation Wizard": a done step shows a
// check, the current one is filled, later ones are grey.
export const WizardSteps: React.FC<{
  steps: string[]; current: number; currentColor: string; onStep?: (i: number) => void;
}> = ({ steps, current, currentColor, onStep }) => (
  <div className="flex flex-wrap items-center gap-y-1 px-4 pt-4 pb-1">
    {steps.map((label, i) => {
      const done = i < current;
      const active = i === current;
      const clickable = done && !!onStep;
      return (
        <button key={label} type="button" disabled={!clickable}
          onClick={() => clickable && onStep!(i)}
          className={`relative flex items-center gap-2 py-1.5 pl-4 pr-6 text-[12.5px] font-semibold transition-colors ${clickable ? "cursor-pointer" : "cursor-default"}`}
          style={{
            background: active || done ? currentColor : "#94a3b8",
            color: "white",
            clipPath: "polygon(0 0, calc(100% - 10px) 0, 100% 50%, calc(100% - 10px) 100%, 0 100%, 10px 50%)",
            marginLeft: i === 0 ? 0 : -8,
            opacity: done ? 0.75 : 1,
          }}>
          <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-white/25 text-[9px] font-bold">
            {done ? "✓" : i + 1}
          </span>
          {label}
        </button>
      );
    })}
  </div>
);
