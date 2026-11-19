// Shared FortiOS value formatting for the AI Assistant.
//
// FortiOS writes a subnet as "10.0.1.0 255.255.255.0" — never as CIDR — so every feature that has
// to SHOW a subnet converts it first. That conversion lived twice already (parseRouteCLI for
// `set dst`, parseVPNCLI for its phase-2 selectors) and the flow chart needs it a third time, on
// address objects. One copy, so "10.0.1.0/24" is what the user reads everywhere.

/**
 * Contiguous 1-bits from the left → prefix length (255.255.255.0 → 24).
 *
 * Returns null for a non-contiguous or invalid mask so the caller can fall back to the raw text
 * rather than printing a confidently wrong prefix: 255.0.255.0 has 16 one-bits but is not a /16.
 */
export function maskToPrefix(mask: string): number | null {
  const parts = mask.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
  let bits = 0;
  let seenZero = false;
  for (const octet of parts) {
    for (let i = 7; i >= 0; i--) {
      if ((octet >> i) & 1) { if (seenZero) return null; bits++; }
      else seenZero = true;
    }
  }
  return bits;
}

/**
 * "10.0.1.0 255.255.255.0" → "10.0.1.0/24".
 *
 * Anything that is not an "ip mask" pair passes through untouched — a value already in CIDR, an
 * FQDN, or an empty string — so callers can hand it whatever the device gave them.
 */
export function fgSubnetToCIDR(value: string): string {
  const v = (value ?? "").trim();
  const parts = v.split(/\s+/);
  if (parts.length !== 2) return v;
  const prefix = maskToPrefix(parts[1]);
  return prefix == null ? v : `${parts[0]}/${prefix}`;
}
