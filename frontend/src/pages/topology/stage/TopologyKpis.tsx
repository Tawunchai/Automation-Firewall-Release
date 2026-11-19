import React from "react";
import { FiActivity, FiGlobe, FiLock, FiShield } from "react-icons/fi";
import { ICON_CHIP, type IconChipVariant } from "../../dashboard/kpi";
import type { StageModel } from "./stageModel";
import type { Topology } from "../model";

// The four numbers worth the top of the page, in the dashboard's own report-card shape.
//
// The row this replaces was Interfaces / Zones / IPsec / Permitted paths. Two problems: it had no
// WAN tile, which is the first thing an operator looks at, and "Permitted" plus "Uninspected" said
// the same thing twice. An interface count is also the wrong denominator — the device reports 22 and
// fits 16 jacks — so Ports counts jacks and says how many are unused rather than implying they are
// broken.

type Tone = "muted" | "danger" | "warning" | "success";

const TONE_CLASS: Record<Tone, string> = {
  muted: "text-(--shell-ink-3)",
  danger: "text-red-500",
  warning: "text-amber-500",
  success: "text-emerald-500",
};

const Tile: React.FC<{
  label: string; value: string; caption: string; tone?: Tone;
  icon: React.ReactNode; variant: IconChipVariant;
}> = ({ label, value, caption, tone = "muted", icon, variant }) => (
  <section className="shell-card flex items-center gap-3 p-4">
    <div className="min-w-0 flex-1">
      <p className="m-0 truncate text-[14px] font-semibold text-(--shell-ink)">{label}</p>
      <p className="tnum m-0 mt-1 text-[20px] font-bold leading-none text-(--shell-ink)">{value}</p>
      <p className={`m-0 mt-1 truncate text-[12.5px] ${TONE_CLASS[tone]}`}>{caption}</p>
    </div>
    <span className="grid h-9 w-9 shrink-0 place-items-center self-center rounded-full text-[18px]"
      style={ICON_CHIP[variant]} aria-hidden>
      {icon}
    </span>
  </section>
);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const TopologyKpis: React.FC<{ stage: StageModel; topo: Topology }> = ({ stage, topo }) => {
  const { ports, wan } = stage;
  const { stats } = topo;

  // A section that could not be read shows an em dash, never a zero. See stageModel's note on the
  // backend swallowing a failed monitor read into an empty map.
  const linkless = stage.linkUnreadable;

  const wanCaption = wan.via.length
    ? `default route via ${wan.via.join(", ")}${wan.gateway ? ` → ${wan.gateway}` : ""}`
    : "no default route";

  const portsCaption = linkless
    ? "link state could not be read"
    : [
      `${ports.down} down`,
      ports.unknown ? `${ports.unknown} no link data` : "",
      ports.unused ? `${ports.unused} unused` : "",
    ].filter(Boolean).join(" · ");

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Tile
        label="WAN"
        value={linkless ? "—" : `${wan.up}/${wan.total} up`}
        caption={wanCaption}
        tone={!linkless && wan.total > 0 && wan.up === 0 ? "danger" : "muted"}
        icon={<FiGlobe />}
        variant="info"
      />
      <Tile
        label="Ports"
        value={linkless ? `— / ${ports.jacks}` : `${ports.up}/${ports.jacks} up`}
        caption={portsCaption}
        tone={linkless ? "warning" : "muted"}
        icon={<FiActivity />}
        variant="primary"
      />
      <Tile
        label="IPsec"
        value={stats.tunnels === 0 ? "none" : `${stats.tunnelsUp}/${stats.tunnels} up`}
        caption={stats.tunnels === 0
          ? "no tunnels configured"
          : stats.tunnelsUp === stats.tunnels ? "all up" : `${stats.tunnels - stats.tunnelsUp} down`}
        tone={stats.tunnels > 0 && stats.tunnelsUp < stats.tunnels ? "danger" : "muted"}
        icon={<FiLock />}
        variant="accent"
      />
      <Tile
        label="Policies"
        value={plural(stats.paths, "path")}
        caption={stats.uninspectedPaths > 0
          ? `${stats.uninspectedPaths} with nothing inspecting them`
          : "all inspected"}
        tone={stats.uninspectedPaths > 0 ? "warning" : "success"}
        icon={<FiShield />}
        variant={stats.uninspectedPaths > 0 ? "warning" : "success"}
      />
    </div>
  );
};

export default TopologyKpis;
