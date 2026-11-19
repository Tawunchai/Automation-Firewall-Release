import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { FiEye, FiShield, FiGitMerge, FiSettings } from "react-icons/fi";
import { FaApple, FaAndroid, FaWindows } from "react-icons/fa";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import SearchInput from "../../components/ui/SearchInput";
import { activateOnKey } from "../../components/ui/keyActivate";

// Built-in FortiGate IPsec tunnel templates — identical on every device, so this catalogue is
// static (there is no CMDB object behind it). Matches the FortiGate 7.2.10 VPN > IPsec Tunnel
// Template list field-for-field. `nav`, when present, is the query string that opens the IPsec
// Creation Wizard already switched to that template (the ones the wizard implements).
type Template = { name: string; description: string; icon: React.ReactNode; nav?: string };

const FGT_ICON = (
  <span className="grid grid-cols-2 gap-px">
    {[0, 1, 2, 3].map((i) => <span key={i} className="h-1.5 w-1.5 rounded-[1px] bg-red-500" />)}
  </span>
);

const TEMPLATES: Template[] = [
  { name: "Site to Site - FortiGate",           description: "Static tunnel between this FortiGate and a remote FortiGate.", icon: FGT_ICON, nav: "template=site-to-site" },
  { name: "Site to Site - FortiGate (SD-WAN)",  description: "Static tunnel between this FortiGate using SD-WAN and a remote FortiGate.", icon: FGT_ICON },
  { name: "Dialup - FortiGate",                 description: "On-demand tunnel between two FortiGate devices.", icon: FGT_ICON, nav: "template=site-to-site" },
  { name: "Site to Site - Cisco",               description: "Static tunnel between this FortiGate and a remote Cisco firewall.", icon: <FiGitMerge className="text-sky-600" />, nav: "template=site-to-site" },
  { name: "Dialup - Cisco Firewall",            description: "On-demand tunnel between a FortiGate device and a Cisco Firewall.", icon: <FiGitMerge className="text-sky-600" /> },
  { name: "Dialup - FortiClient (Windows, Mac OS, Android)", description: "On-demand tunnel for users using the FortiClient software.", icon: <FiShield className="text-red-500" />, nav: "template=remote-access&raKind=client-based&raClient=forticlient" },
  { name: "Dialup - iOS (Native)",              description: "On-demand tunnel for iPhone/iPad users using the native iOS IPsec client.", icon: <FaApple className="ink" />, nav: "template=remote-access&raKind=native&raNative=ios" },
  { name: "Dialup - Android (Native L2TP/IPsec)", description: "On-demand tunnel for Android users using the native L2TP/IPsec client.", icon: <FaAndroid className="text-green-600" />, nav: "template=remote-access&raKind=native&raNative=android" },
  { name: "Dialup - Windows (Native L2TP/IPsec)", description: "On-demand tunnel for Windows users using the native L2TP/IPsec client.", icon: <FaWindows className="text-sky-500" />, nav: "template=remote-access&raKind=native&raNative=windows" },
  { name: "Dialup - Cisco IPsec Client",        description: "On-demand tunnel for users using the Cisco IPsec client.", icon: <FiGitMerge className="text-sky-600" />, nav: "template=remote-access&raKind=client-based&raClient=cisco" },
  { name: "Custom",                             description: "Configure phase 1 and phase 2 by hand — the full manual tunnel editor.", icon: <FiSettings className="ink-2" />, nav: "template=custom" },
  { name: "Hub-and-Spoke - FortiGate (Spoke)",  description: "Spoke role in a Hub-and-Spoke auto-discovery VPN configuration.", icon: FGT_ICON, nav: "template=hub-and-spoke&role=spoke" },
  { name: "Hub-and-Spoke - FortiGate (Hub)",    description: "Hub role in a Hub-and-Spoke auto-discovery VPN configuration.", icon: FGT_ICON, nav: "template=hub-and-spoke&role=hub" },
];

const IPsecTemplatesPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const q = search.toLowerCase();
  const filtered = TEMPLATES.filter((t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q));
  const active = TEMPLATES.find((t) => t.name === selected) || null;

  return (
    <div className="space-y-4">
      {/* Page title/breadcrumb now come from the navbar, same as every other page since the
          Dastone pass — this row keeps only what the old hero's `actions` slot carried: the
          template count (nowhere else on the page shows it), search, and the view/wizard action. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="t-meta">{TEMPLATES.length} templates</span>
        <div className="flex items-center gap-2">
          <SearchInput value={search} onChange={setSearch} placeholder="Search templates…" width="w-52" />
          <button
            disabled={!active}
            onClick={() => { if (active?.nav) navigate(`/admin/ipsec-wizard?${active.nav}`); }}
            className="inline-flex items-center gap-1.5 rounded-sm border px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-40"
            style={{ borderColor: `${currentColor}40`, color: currentColor }}>
            <FiEye size={13} /> {active?.nav ? "Use in Wizard" : "View"}
          </button>
        </div>
      </div>

      <div className="panel panel-flush">
        <div className="grid border-b hairline-2 px-4 py-2.5" style={{ gridTemplateColumns: "minmax(320px,1fr) 2fr" }}>
          <span className="t-label">TEMPLATE</span>
          <span className="t-label">DESCRIPTION</span>
        </div>
        {filtered.map((t, idx) => {
          const isSel = t.name === selected;
          return (
            <div key={t.name} role="button" tabIndex={0} aria-pressed={isSel}
              onClick={() => setSelected(t.name)} onDoubleClick={() => { if (t.nav) navigate(`/admin/ipsec-wizard?${t.nav}`); }}
              onKeyDown={activateOnKey(() => setSelected(t.name))}
              className={`grid cursor-pointer items-center px-4 py-3 transition-colors ${idx < filtered.length - 1 ? "border-b hairline-2" : ""}`}
              style={{ gridTemplateColumns: "minmax(320px,1fr) 2fr", backgroundColor: isSel ? `${currentColor}0e` : undefined }}
              onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = "rgba(148,163,184,.06)"; }}
              onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.backgroundColor = ""; }}>
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[14px]">{t.icon}</span>
                <span className="truncate text-[13px] font-semibold ink">{t.name}</span>
                {t.nav && <span className="shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold" style={{ background: `${currentColor}15`, color: currentColor }}>WIZARD</span>}
              </div>
              <span className="truncate text-[12.5px] ink-2">{t.description}</span>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] ink-3">
        These are FortiGate's built-in IPsec templates. Use <strong>Site to Site - FortiGate</strong> to launch the IPsec Wizard, or configure a tunnel directly under <strong>IPsec Tunnels → Create New</strong>.
      </p>
    </div>
  );
};

export default IPsecTemplatesPage;
