import React from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../components/ui/form-controls";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import GroupsPanel from "../fw-groups/groups-panel";
import AddressesTab from "./addresses-tab";

// Policy & Objects ▸ Addresses — Addresses and Address Groups used to be two separate pages. They
// are one screen now, switched by the toggle in the corner — see fw-services/index.tsx for why.

type Tab = "addresses" | "groups";
const isTab = (v: string | null): v is Tab => v === "addresses" || v === "groups";

const FwAddressesPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab: Tab = isTab(urlTab) ? urlTab : "addresses";
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
      label="Addresses view"
      options={[
        { v: "addresses", l: "Addresses" },
        { v: "groups", l: "Address groups" },
      ]}
    />
  );

  return tab === "addresses"
    ? <AddressesTab toggle={toggle} />
    : <GroupsPanel kind="address" toggle={toggle} />;
};

export default FwAddressesPage;
