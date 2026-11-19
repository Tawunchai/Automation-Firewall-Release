import type { VirtualIP } from "../../api/policyObject";

// The pure rules behind the "New Virtual IP" form — field visibility, validation and the payload
// — kept out of the component so they can be unit-tested. The FortiGate GUI changes which fields
// even EXIST as you toggle Type / Optional Filters / Port Forwarding (see the screenshots), and a
// field left visible in the wrong combination produces a VIP the device rejects with a bare code.

export const EMPTY_VIP: VirtualIP = {
  name: "", comment: "",
  type: "static-nat", interface: "any",
  ext_ip: "", mapped_ip: "",
  ext_addr: "", mapped_addr: "",
  source_filter: [], services: [],
  port_forward: false, protocol: "tcp", port_mapping_type: "1-to-1",
  ext_port: "", mapped_port: "",
};

// ── Optional Filters enable-state ────────────────────────────────────────────
//
// The Source address / Services toggles are UI enable-switches, NOT data — an editor can be
// "enabled but empty" (image 4: Services on, nothing picked yet). That state cannot be read back
// from the arrays (an enabled-but-empty Source is []; a Service picker with nothing chosen is []),
// so the toggle's on/off MUST be tracked separately from the values. Deriving it from the array —
// which the first version did — makes the toggle un-turn-on-able: flip it on, the array is still
// empty, the derivation reports off, and it snaps back.
//
// FilterState is that separate switch set. `optional` is the section master (like Port Forwarding).
export type FilterState = { optional: boolean; source: boolean; services: boolean };

// initialFilterState opens the form (edit mode) with the switches reflecting what was saved: a VIP
// that already has a source filter or services shows those sub-toggles on, and the section open.
export const initialFilterState = (v: VirtualIP): FilterState => {
  const source = v.source_filter.some((s) => s.trim().length > 0);
  const services = v.services.length > 0;
  return { source, services, optional: source || services };
};

// ── Field visibility (straight from the screenshots) ─────────────────────────

// Static NAT shows the IP rows; FQDN swaps them for the External/Mapped FQDN-address pickers.
export const showsStaticNAT = (v: VirtualIP): boolean => v.type === "static-nat";
export const showsFQDN = (v: VirtualIP): boolean => v.type === "fqdn";

// Port Forwarding is a Static-NAT-only feature — the FQDN form has no port-forward section.
export const showsPortForwarding = (v: VirtualIP): boolean => v.type === "static-nat";

// icmp has no ports, so the protocol row's port fields disappear for it.
export const showsPortFields = (v: VirtualIP): boolean =>
  v.port_forward && v.protocol !== "icmp";

// ⚠️ The subtle one, and the reason image 3 differs from image 2: once "Services" is enabled the
// service DEFINES the external port, so the GUI HIDES "External service port" (the device stores
// extport=0 and derives it). "Map to IPv4 port" stays — the mapped side still needs a port.
export const showsExternalServicePort = (v: VirtualIP): boolean =>
  showsPortFields(v) && v.services.length === 0;

// The "Services" optional filter only makes sense for a port-forwarding Static NAT (it narrows
// which service the forward applies to). The GUI hides it otherwise.
export const showsServicesFilter = (v: VirtualIP): boolean => v.type === "static-nat";

// ── Validation ───────────────────────────────────────────────────────────────

const isIPOrRange = (s: string): boolean => {
  s = s.trim();
  const ip = /^(\d{1,3}\.){3}\d{1,3}$/;
  const ok = (x: string) => ip.test(x.trim()) && x.trim().split(".").every((o) => +o >= 0 && +o <= 255);
  if (ok(s)) return true;
  const [lo, hi, ...rest] = s.split("-");
  return rest.length === 0 && hi !== undefined && ok(lo) && ok(hi);
};

const cleanList = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean);

export const validateVIP = (v: VirtualIP): Record<string, string> => {
  const e: Record<string, string> = {};
  if (!v.name.trim()) e.name = "This field is required.";

  if (v.type === "static-nat") {
    if (!v.ext_ip.trim()) e.ext_ip = "This field is required.";
    else if (!isIPOrRange(v.ext_ip)) e.ext_ip = "Enter an IP or range (e.g. 203.0.113.10 or 203.0.113.10-203.0.113.20).";
    if (!v.mapped_ip.trim()) e.mapped_ip = "This field is required.";
    else if (!isIPOrRange(v.mapped_ip)) e.mapped_ip = "Enter an IP or range.";
  } else {
    // FQDN — both sides are FQDN address names; extip is never sent (that is the -8 trap).
    if (!v.ext_addr.trim()) e.ext_addr = "This field is required.";
    if (!v.mapped_addr.trim()) e.mapped_addr = "This field is required.";
  }

  // Port fields are required only when they are actually shown.
  if (showsPortFields(v)) {
    if (showsExternalServicePort(v) && !v.ext_port.trim()) e.ext_port = "This field is required.";
    if (!v.mapped_port.trim()) e.mapped_port = "This field is required.";
  }
  return e;
};

export const vipValid = (v: VirtualIP): boolean => Object.keys(validateVIP(v)).length === 0;

// ── Payload ──────────────────────────────────────────────────────────────────

// Sends only the fields that apply to the chosen shape, so a value left over from an earlier
// choice (an ext_ip after switching to FQDN, a port after enabling Services) never reaches the
// device. Mirrors what the backend's vipPayload builds.
export const buildVIPPayload = (v: VirtualIP): VirtualIP => {
  const base: VirtualIP = {
    ...EMPTY_VIP,
    name: v.name.trim(),
    comment: v.comment,
    type: v.type,
    interface: v.interface.trim() || "any",
    source_filter: cleanList(v.source_filter),
    services: cleanList(v.services),
    // reset the shape-specific fields; fill the ones that apply below
    ext_ip: "", mapped_ip: "", ext_addr: "", mapped_addr: "",
    port_forward: false, ext_port: "", mapped_port: "",
    protocol: v.protocol, port_mapping_type: v.port_mapping_type,
  };

  if (v.type === "static-nat") {
    base.ext_ip = v.ext_ip.trim();
    base.mapped_ip = v.mapped_ip.trim();
    base.port_forward = v.port_forward;
    if (v.port_forward && v.protocol !== "icmp") {
      // Mapped port is always kept; the external port is dropped when Services drive it (the
      // device derives it and stores 0 — matching the GUI hiding only that one field).
      base.mapped_port = v.mapped_port.trim();
      base.ext_port = v.services.length === 0 ? v.ext_port.trim() : "";
    }
  } else {
    base.ext_addr = v.ext_addr.trim();
    base.mapped_addr = v.mapped_addr.trim();
    base.services = []; // FQDN VIP has no Services filter
  }
  return base;
};

// A one-line "Mapped From / Mapped To" summary for the list page, matching the GUI's columns.
export const vipMappedFrom = (v: VirtualIP): string => {
  if (v.type === "fqdn") return v.ext_addr || "—";
  const port = v.port_forward && v.protocol !== "icmp" && v.ext_port ? ` (${v.protocol.toUpperCase()}: ${v.ext_port})` : "";
  return `${v.ext_ip}${port}`;
};

export const vipMappedTo = (v: VirtualIP): string => {
  if (v.type === "fqdn") return v.mapped_addr || "—";
  const port = v.port_forward && v.protocol !== "icmp" && v.mapped_port ? ` (${v.protocol.toUpperCase()}: ${v.mapped_port})` : "";
  return `${v.mapped_ip}${port}`;
};
