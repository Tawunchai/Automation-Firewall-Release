// The Web Filter action list and its shape.
//
// A .tsx because the entries carry icons.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React from "react";
import { FiCheckCircle, FiEye, FiSlash, FiAlertTriangle, FiUser } from "react-icons/fi";
import type { WebFilterAction } from "../../api/policyObject";

export type ActionMeta = { value: WebFilterAction; label: string; icon: React.ReactNode; color: string; bg: string };

export const WF_ACTIONS: ActionMeta[] = [
  { value: "allow",        label: "Allow",        icon: <FiCheckCircle size={12} />,  color: "#16a34a", bg: "#16a34a14" },
  { value: "monitor",      label: "Monitor",      icon: <FiEye size={12} />,          color: "#2563eb", bg: "#2563eb14" },
  { value: "block",        label: "Block",        icon: <FiSlash size={12} />,        color: "#dc2626", bg: "#dc262614" },
  { value: "warning",      label: "Warning",      icon: <FiAlertTriangle size={12} />,color: "#d97706", bg: "#d9770614" },
  { value: "authenticate", label: "Authenticate", icon: <FiUser size={12} />,         color: "#64748b", bg: "#64748b14" },
];
