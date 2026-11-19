// The Application Control action list: each action's label, icon and colour.
//
// A .tsx rather than a .ts because the entries carry icons, which is JSX — but a list of
// actions is not a component, which is why it does not belong in the sections file.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React from "react";
import { FiEye, FiCheckCircle, FiSlash, FiPackage } from "react-icons/fi";
import type { AppAction } from "../../api/policyObject";

export type ActionMeta = { v: AppAction; label: string; icon: React.ReactNode; color: string };

export const APP_ACTIONS: ActionMeta[] = [
  { v: "monitor", label: "Monitor", icon: <FiEye size={13} />, color: "#3b82f6" },
  { v: "allow", label: "Allow", icon: <FiCheckCircle size={13} />, color: "#10b981" },
  { v: "block", label: "Block", icon: <FiSlash size={13} />, color: "#ef4444" },
  { v: "quarantine", label: "Quarantine", icon: <FiPackage size={13} />, color: "#f59e0b" },
];
