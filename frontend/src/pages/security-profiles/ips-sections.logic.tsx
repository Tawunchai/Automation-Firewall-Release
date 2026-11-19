// The IPS lookup tables — severity, action, status, botnet mode — and the two helpers that read
// them.
//
// A .tsx because the action entries carry icons.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React from "react";
import { FiShield, FiSlash, FiZap, FiCheck } from "react-icons/fi";
import { type IPSSensorForm, type IPSEntry } from "../../api/inspectionProfiles";

export const SEVERITY_META: Record<string, { label: string; color: string }> = {
  info:     { label: "Info",     color: "#64748b" },
  low:      { label: "Low",      color: "#0ea5e9" },
  medium:   { label: "Medium",   color: "#f59e0b" },
  high:     { label: "High",     color: "#f97316" },
  critical: { label: "Critical", color: "#ef4444" },
};

export const ACTIONS: { v: IPSEntry["action"]; l: string; icon: React.ReactNode; color: string; help: string }[] = [
  { v: "default", l: "Default", icon: <FiCheck size={12} />,  color: "#64748b",
    help: "Use whatever each matched signature recommends. This is what the built-in sensors do." },
  { v: "pass",    l: "Allow",   icon: <FiShield size={12} />, color: "#10b981",
    help: "Let the traffic through even when a signature matches. Logs still fire." },
  { v: "block",   l: "Block",   icon: <FiSlash size={12} />,  color: "#ef4444",
    help: "Drop the packet." },
  { v: "reset",   l: "Reset",   icon: <FiZap size={12} />,    color: "#a855f7",
    help: "Drop the packet and tear the session down with a TCP reset." },
];

export const STATUSES: { v: IPSEntry["status"]; l: string }[] = [
  { v: "default", l: "Default" }, { v: "enable", l: "Enable" }, { v: "disable", l: "Disable" },
];

export const BOTNET_MODES: { v: IPSSensorForm["scan_botnet_connections"]; l: string }[] = [
  { v: "disable", l: "Disable" }, { v: "monitor", l: "Monitor" }, { v: "block", l: "Block" },
];

export const actionMeta = (v: string) => ACTIONS.find((a) => a.v === v) ?? ACTIONS[0];

/** "All" is what the device shows for an empty filter — say it the same way the device does. */
export const filterLabel = (values: string[], pretty?: (v: string) => string) =>
  values.length === 0 ? "All" : values.map((v) => (pretty ? pretty(v) : v)).join(", ");
