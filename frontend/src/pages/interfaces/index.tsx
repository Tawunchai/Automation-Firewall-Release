import React from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../components/ui/form-controls";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import InterfacesTab from "./interfaces-tab";
import ZonesTab from "./zones-tab";

// Network ▸ Interfaces — Interfaces and Zones used to be two separate pages. They are one screen
// now, switched by the toggle in the corner: a zone is just a name for several interfaces, so it
// belongs right next to the ports it groups rather than off in its own menu entry.
//
// Interfaces itself stays read-only (ports are changed on the device); Zones is the one writable
// tab here, because a zone is a grouping the operator invents and writing one changes no port's
// configuration — see zones-tab.tsx for the FortiOS constraint that shapes its form.

type Tab = "interfaces" | "zones";
const isTab = (v: string | null): v is Tab => v === "interfaces" || v === "zones";

const InterfacesPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab: Tab = isTab(urlTab) ? urlTab : "interfaces";
  const setTab = (next: Tab) => {
    const p = new URLSearchParams(params);
    p.set("tab", next);
    setParams(p, { replace: true });
  };

  const toggle = (
    <Segmented
      value={tab}
      onChange={(v) => setTab(v as Tab)}
      currentColor={currentColor}
      label="Interfaces view"
      options={[
        { v: "interfaces", l: "Interfaces" },
        { v: "zones", l: "Zones" },
      ]}
    />
  );

  return tab === "interfaces"
    ? <InterfacesTab toggle={toggle} />
    : <ZonesTab toggle={toggle} />;
};

export default InterfacesPage;
