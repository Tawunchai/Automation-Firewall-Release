import React from "react";
import { useSearchParams } from "react-router-dom";
import { Segmented } from "../../components/ui/form-controls";
import { useStateContext } from "../../contexts/ProviderContext.logic";
import GroupsPanel from "../fw-groups/groups-panel";
import ServicesTab from "./services-tab";

// Policy & Objects ▸ Services — Services and Service Groups used to be two separate pages. They
// are one screen now, switched by the toggle in the corner, because they are one errand looked at
// two ways: pick the individual ports first, then group them. A page that always showed both
// tables at once made the group table an afterthought at the bottom of a long scroll; this way
// only the one a person is working on is on screen.
//
// The tab lives in the URL, same reason as SD-WAN's three tabs: a create/edit page is its own
// route, and coming back from one has to land on the table it was opened from.

type Tab = "services" | "groups";
const isTab = (v: string | null): v is Tab => v === "services" || v === "groups";

const FwServicesPage: React.FC = () => {
  const { currentColor } = useStateContext();
  const [params, setParams] = useSearchParams();
  const urlTab = params.get("tab");
  const tab: Tab = isTab(urlTab) ? urlTab : "services";
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
      label="Services view"
      options={[
        { v: "services", l: "Services" },
        { v: "groups", l: "Service groups" },
      ]}
    />
  );

  return tab === "services"
    ? <ServicesTab toggle={toggle} />
    : <GroupsPanel kind="service" toggle={toggle} />;
};

export default FwServicesPage;
