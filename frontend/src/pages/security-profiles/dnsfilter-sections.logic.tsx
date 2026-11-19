// The DNS Filter action list and the pure functions over it: which categories a preset covers,
// which preset is active, and whether the redirect-portal field applies.
//
// A .tsx because the action entries carry icons.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React from "react";
import { FiCheckCircle, FiEye, FiSlash } from "react-icons/fi";
import type { DNSFilterProfileForm, DNSFilterAction, WebFilterCategoryMeta } from "../../api/policyObject";

export type ActionMeta = { value: DNSFilterAction; label: string; icon: React.ReactNode; color: string; bg: string };

export const DNS_ACTIONS: ActionMeta[] = [
  { value: "allow",   label: "Allow",                   icon: <FiCheckCircle size={12} />, color: "#16a34a", bg: "#16a34a14" },
  { value: "monitor", label: "Monitor",                 icon: <FiEye size={12} />,         color: "#2563eb", bg: "#2563eb14" },
  { value: "block",   label: "Redirect to Block Portal", icon: <FiSlash size={12} />,      color: "#dc2626", bg: "#dc262614" },
];

export type DNSPreset = "custom" | "G" | "PG-13" | "R";

export const dnsPresetCategories = (
  cats: WebFilterCategoryMeta[],
  preset: DNSPreset
): { category: number; action: DNSFilterAction }[] => {
  if (preset === "custom") {
    return cats.map((c) => ({ category: c.id, action: "monitor" as DNSFilterAction }));
  }
  return cats
    .filter((c) => (c.blocked_in_ratings ?? []).includes(preset))
    .map((c) => ({ category: c.id, action: "block" as DNSFilterAction }));
};

export const dnsActivePreset = (
  cats: WebFilterCategoryMeta[],
  actionOf: (id: number) => DNSFilterAction
): DNSPreset => {
  if (cats.length === 0) return "custom";
  const matches = (p: "G" | "PG-13" | "R") =>
    cats.every((c) => actionOf(c.id) === ((c.blocked_in_ratings ?? []).includes(p) ? "block" : "allow"));
  return matches("G") ? "G" : matches("PG-13") ? "PG-13" : matches("R") ? "R" : "custom";
};

export type RedirectPortalField = { value: string; placeholder: string; disabled: boolean };

export const redirectPortalField = (form: DNSFilterProfileForm): RedirectPortalField =>
  form.use_default_redirect_portal
    ? { value: "", placeholder: "0.0.0.0", disabled: true }
    : { value: form.redirect_portal_ip, placeholder: "", disabled: false };
