// The pure half of zone-form.tsx: the blank form, the validators, the payload
// builders and the constants — everything that is not a component.
//
// Split out so the .tsx beside it exports components ONLY. Vite's fast refresh gives up on a
// module that exports anything else, and the whole file then reloads instead of re-rendering,
// which on a form means the state you were testing is gone on every keystroke you save.

import type { Zone, ZonePayload } from "../../api/objectGroups";

export type ZoneDraft = { name: string; interfaces: string[]; intrazone: string; description: string };

export const BLANK_ZONE: ZoneDraft = { name: "", interfaces: [], intrazone: "deny", description: "" };

export const zoneToDraft = (z: Zone): ZoneDraft =>
  ({ name: z.name, interfaces: [...z.interfaces], intrazone: z.intrazone || "deny", description: z.description });

export const buildZonePayload = (d: ZoneDraft): ZonePayload =>
  ({ name: d.name.trim(), interfaces: d.interfaces, intrazone: d.intrazone, description: d.description });

export const validateZoneDraft = (d: ZoneDraft): string | null => {
  const name = d.name.trim();
  if (!name) return "Name is required";
  if (name.length > 35) return "Zone names are limited to 35 characters";
  if (d.interfaces.length === 0) {
    return "A zone needs at least one interface — an empty zone matches nothing, so a policy that uses it would silently pass no traffic";
  }
  return null;
};

/** interface name (lowercased) → the zone that already holds it. */
export const claimedByMap = (zones: Zone[]): Map<string, string> => {
  const m = new Map<string, string>();
  zones.forEach((z) => z.interfaces.forEach((i) => m.set(i.toLowerCase(), z.name)));
  return m;
};
