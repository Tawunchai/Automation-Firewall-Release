// The shared form constants: the address-type labels, and the focus-ring style every control
// in the console uses.
//
// The controls themselves are components and stay in form-controls.tsx.//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else: the whole module reloads instead of re-rendering, and every
// piece of state in it is lost on each save.

import React from "react";

export const TYPE_LABELS: Record<string, string> = {
  physical:    "Physical Interface",
  vlan:        "VLAN",
  aggregate:   "802.3ad Aggregate",
  redundant:   "Redundant Interface",
  "hard-switch": "Hardware Switch",
  switch:      "Software Switch",
  loopback:    "Loopback Interface",
  tunnel:      "Tunnel Interface",
  "emac-vlan": "EMAC VLAN",
  vxlan:       "VXLAN",
  vap_switch:  "WiFi SSID",
  "vap-switch": "WiFi SSID",
};

export const focusRing = (currentColor: string) => ({
  onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = currentColor;
    e.currentTarget.style.boxShadow = `0 0 0 3px color-mix(in srgb, ${currentColor} 15%, transparent)`;
  },
  onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    e.currentTarget.style.borderColor = "";
    e.currentTarget.style.boxShadow = "";
  },
});
