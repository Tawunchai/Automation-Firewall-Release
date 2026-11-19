import React from "react";
import { FiEyeOff, FiInfo, FiShield, FiXCircle } from "react-icons/fi";
import Tooltip from "../../components/ui/Tooltip";
import type { DriftAnalytics, TimelineFilter } from "../../api/drift";
import { compact, outsideShare } from "./analytics";

// The three numbers above the change history. Each is also a way into the list: pressing one filters
// the history to exactly the changes it counts, so a number that looks wrong is one click from the
// rows behind it.
//
// All three count the analysis window, so the window picker governs every number on the page. There
// used to be a fourth, "Needs review", which counted all time and was the only one that did not.
//
// The label is a name, not a definition, and people asked what each one counts. So every tile
// carries an ⓘ with the full answer — what is counted, where it comes from, what is left out. It is
// its own button beside the tile rather than inside it: a focusable control nested in another button
// is invalid, and the tooltip has to open from the keyboard too.

/** What each tile counts, in full. Shown by the tile's ⓘ. */
const TILE_MEANING = {
  console:
    "Changes this console wrote to the firewall that took effect in the window — from any page or the AI Assistant. " +
    "Changes that were later undone still count: they did apply.",
  outside:
    "Objects that changed on the firewall with no record in this console — made through the CLI, the FortiGate's own GUI, " +
    "FortiManager or another tool. Found by comparing backups, and dated by the backup that revealed them.",
  failed:
    "Changes this console tried to make that the firewall refused — an invalid value, a missing object, a duplicate name. " +
    "They never changed the device, so they are not counted as changes.",
} as const;

const Tile: React.FC<{
  label: string;
  meaning: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  tint: string;
  swatch?: string;
  loading: boolean;
  active: boolean;
  onClick: () => void;
}> = ({ label, meaning, value, caption, icon, tint, swatch, loading, active, onClick }) => (
  <div className="relative">
    <button type="button" onClick={onClick} aria-pressed={active}
      className="shell-card flex h-full w-full items-center gap-3 px-4 py-3.5 pr-9 text-left transition surface-hover"
      style={active ? { boxShadow: `0 0 0 2px ${tint}` } : undefined}>
      <span className="medallion h-10 w-10 shrink-0 text-[16px]" style={{ color: tint, background: `${tint}1f` }} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="t-label m-0 flex items-center gap-1.5 truncate">
          {swatch && <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: swatch }} aria-hidden />}
          {label}
        </span>
        {loading
          ? <span className="shell-skeleton mt-1.5 block h-6 w-16" />
          : <span className="t-metric m-0 mt-0.5 block">{value}</span>}
        {/* Two lines, not an ellipsis: a Thai or Chinese caption runs longer than the English. */}
        <span className="t-meta m-0 line-clamp-2">{caption}</span>
      </span>
    </button>
    <Tooltip title={meaning} placement="bottom">
      <button type="button" aria-label={meaning}
        className="btn-icon absolute right-2 top-2 h-6 w-6 text-[13px] ink-3">
        <FiInfo />
      </button>
    </Tooltip>
  </div>
);

const DriftTiles: React.FC<{
  data: DriftAnalytics | null;
  loading: boolean;
  days: number;
  consoleHue: string;
  outsideHue: string;
  filter: TimelineFilter;
  onPick: (f: TimelineFilter) => void;
}> = ({ data, loading, days, consoleHue, outsideHue, filter, onPick }) => {
  const t = data?.totals;
  const share = outsideShare(data);
  const windowText = `last ${days} days`;
  const busy = loading && !data;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <Tile label="Through this console" meaning={TILE_MEANING.console} value={compact(t?.console ?? 0)}
        caption={t?.reverted ? `${t.reverted} since reverted · ${windowText}` : windowText}
        icon={<FiShield />} tint={consoleHue} swatch={consoleHue} loading={busy}
        active={filter === "console"} onClick={() => onPick("console")} />
      <Tile label="Outside the console" meaning={TILE_MEANING.outside} value={compact(t?.outside ?? 0)}
        caption={share === null ? windowText : `${share}% of all changes · ${windowText}`}
        icon={<FiEyeOff />} tint={outsideHue} swatch={outsideHue} loading={busy}
        active={filter === "outside"} onClick={() => onPick("outside")} />
      <Tile label="Rejected writes" meaning={TILE_MEANING.failed} value={compact(t?.failed ?? 0)}
        caption={t?.failed ? `The device refused these · ${windowText}` : `None refused · ${windowText}`}
        icon={<FiXCircle />} tint={t?.failed ? "#f59e0b" : "#94a3b8"} loading={busy}
        active={filter === "failed"} onClick={() => onPick("failed")} />
    </div>
  );
};

export default DriftTiles;
