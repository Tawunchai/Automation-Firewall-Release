import React from "react";
import { FiUsers, FiShield, FiUser, FiActivity } from "react-icons/fi";
import { StatTile, type IconChipVariant } from "../../dashboard/kpi";

// The four tiles above the user table.
//
// These are the dashboard's own `StatTile` rather than a lookalike written here: same Dastone
// `.report-card` split (label, the one big number, a muted caption on the left; the role's icon
// medallion centred on the right), same type sizes, same chip tints. Importing it is the whole
// point — a copy drifts, and these tiles sat two sizes and one border-radius away from the
// dashboard's for exactly that reason. `kpi.tsx` pulls in nothing heavier than react-icons, so
// this costs the user page nothing.
//
// The old tiles also carried a progress bar under the admin/regular split. The dashboard's shape
// has no bar, and the percentage it encoded is already stated in words in the caption — so the
// bar went rather than being redrawn in a shape the dashboard never uses.
//
// Chips are the dashboard's own four, in its own order (primary / info / accent / warning). They
// are categorical, not semantic: "Admins" is not a warning state, so nothing reads meaning off the
// colour — every tile names itself in text, which is the rule kpi.tsx sets out.

type AnalyticsUser = { role: string };

type StatCardsProps = {
  users: AnalyticsUser[];
  loading: boolean;
  activityCount: number;
  activityLoading: boolean;
};

const StatCards: React.FC<StatCardsProps> = ({
  users, loading, activityCount, activityLoading,
}) => {
  const total      = users.length;
  const adminCount = users.filter((u) => u.role.toLowerCase() === "admin").length;
  const userCount  = users.filter((u) => u.role.toLowerCase() === "user").length;
  const pctOfTotal = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

  const tiles: {
    key: string;
    label: string;
    icon: React.ReactNode;
    variant: IconChipVariant;
    value: string;
    caption: string;
    loading: boolean;
  }[] = [
    {
      key: "total", label: "Total Users", icon: <FiUsers />, variant: "primary",
      value: String(total), caption: "registered accounts", loading,
    },
    {
      key: "admin", label: "Admins", icon: <FiShield />, variant: "info",
      value: String(adminCount), caption: `${pctOfTotal(adminCount)}% of total`, loading,
    },
    {
      key: "user", label: "Regular Users", icon: <FiUser />, variant: "accent",
      value: String(userCount), caption: `${pctOfTotal(userCount)}% of total`, loading,
    },
    {
      key: "activity", label: "My Activities", icon: <FiActivity />, variant: "warning",
      value: String(activityCount), caption: "events logged", loading: activityLoading,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
      {tiles.map(({ key, ...tile }) => (
        <StatTile key={key} {...tile} />
      ))}
    </div>
  );
};

export default StatCards;
