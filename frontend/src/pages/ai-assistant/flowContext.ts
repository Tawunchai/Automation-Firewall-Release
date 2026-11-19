import { useEffect, useRef, useState } from "react";
import {
  DeviceListAddresses, DeviceListPolicies, DeviceListServices, DeviceListStaticRoutes,
  DeviceListSystemInterfaces, DeviceListVirtualIPs,
  type AddressObject, type FirewallPolicy, type ServiceObject, type StaticRoute,
  type SystemInterface, type VirtualIP,
} from "../../api/policyObject";
import { EMPTY_FLOW_CONTEXT, type FlowContext } from "./deviceFacts";

// useFlowContext — the device facts that turn a NAME in the flow chart into a VALUE.
//
// The AI reuses objects that already exist on the firewall ("reuse before create" is rule 2 of its
// prompt), so a policy commonly references `LAN-Subnet` without the CLI ever saying what that is.
// The diagram would then show a box labelled "LAN-Subnet" — true, but not the thing the user asked
// to see. These lists fill in the subnet, the interface's alias/role/IP, the service's ports — and
// the external address behind a Virtual IP, which is the only way an INBOUND rule can be compared
// to anything at all.
//
// DELIBERATELY LENIENT. This is enrichment: if the firewall cannot be read the chart still draws,
// with names instead of values, and the chips that could not be resolved say so in their tooltip
// rather than pretending the object is empty. That is the opposite trade-off from a device LIST
// page (see useDeviceData), and for the opposite reason — here the authoritative content is the
// AI's own CLI, which is already on screen; the device is only being asked to annotate it.
//
// It is also LAZY: nothing is fetched until a proposal that can be drawn actually exists, so a
// conversation that never produces config never touches the device.

export type FlowContextState = { ctx: FlowContext; loading: boolean };

/**
 * The device lists → the lookup the chart annotates names with.
 *
 * Pure and exported so the mapping can be checked against a real firewall's payloads rather than
 * only through the hook — the field shapes here are the device's, and they are the part that would
 * silently stop resolving if the backend's response ever changed.
 */
/** An interface a default route points out of — the way to the internet. */
const isDefaultRoute = (r: StaticRoute) =>
  r.enabled && !r.blackhole && r.dst_type === "subnet" && /^0\.0\.0\.0(\/0)?$/.test((r.dst ?? "").trim());

export function buildFlowContext(
  addresses: AddressObject[], services: ServiceObject[], interfaces: SystemInterface[],
  policies: FirewallPolicy[] = [], routes: StaticRoute[] = [], vips: VirtualIP[] = [],
): FlowContext {
  const addrMap = new Map<string, string>();
  const addrIface = new Map<string, string>();
  for (const a of addresses) {
    // The backend already normalises each type into the one field worth showing: `subnet` is CIDR
    // for ipmask and the FQDN for an fqdn object (see device_proxy.go).
    const detail = a.subnet
      || (a.start_ip && a.end_ip ? `${a.start_ip} – ${a.end_ip}` : "")
      || (a.country ? `Country ${a.country}` : "")
      || (a.mac_addrs ?? []).join(", ")
      // A dynamic (Fabric Connector) address has no IP of its own — its connector IS the answer,
      // and showing it beats leaving the chip looking unresolved.
      || (a.sdn ? `SDN ${a.sdn}` : a.sub_type || "");
    if (detail) addrMap.set(a.name, detail);
    if (a.interface && a.interface !== "any") addrIface.set(a.name, a.interface);
  }

  // A VIP IS A VALID dstaddr, AND IT IS NOT AN ADDRESS OBJECT.
  //
  // An inbound rule reads `set dstaddr "Web_Server_VIP"`, and firewall/vip is a separate table from
  // firewall/address — so without this loop the name resolved to nothing, every comparison against
  // that rule became UNDECIDABLE, and the packet walk stopped dead on the first inbound policy it
  // met (see packetSim.verdictFor). A simulation that halts on the most common inbound rule there
  // is tells the viewer nothing, which is why this is not merely enrichment.
  //
  // THE EXTERNAL ADDRESS IS THE ANSWER. A VIP in dstaddr means DNAT: the packet on the wire is
  // addressed to the VIP's EXTERNAL ip, and FortiOS translates it afterwards. The backend's own
  // trace engine resolves it the same way (services/fortigate_troubleshoot.go, vipExternalIPs), and
  // the two must not disagree about which address a rule claims.
  //
  // An `fqdn`-type VIP carries a NAME rather than an IP in ext_addr, which parses to nothing and so
  // stays undecidable — correctly: nothing here is allowed to guess what a hostname resolves to.
  for (const v of vips) {
    const detail = v.ext_ip || v.ext_addr;
    // Addresses win a name collision: the device cannot hold both, and an address object is the
    // literal value while a VIP's external ip is an interpretation of one.
    if (detail && !addrMap.has(v.name)) addrMap.set(v.name, detail);
  }

  const svcMap = new Map<string, string>();
  for (const s of services) if (s.details) svcMap.set(s.name, s.details);

  const ifaceMap = new Map(interfaces.map((i) => [i.name, {
    name: i.name,
    alias: i.alias || undefined,
    // FortiOS stores "no role chosen" as the literal string "undefined" — treated as absent here so
    // no box ends up subtitled "UNDEFINED".
    role: i.role && i.role !== "undefined" ? i.role : undefined,
    ip: i.ip && !/^0\.0\.0\.0/.test(i.ip) ? i.ip : undefined,
  }]));

  const internetIfaces = new Set<string>();
  for (const r of routes) if (isDefaultRoute(r) && r.device) internetIfaces.add(r.device);
  // Fall back to the role tag when the device has no default route configured at all.
  if (internetIfaces.size === 0) {
    for (const i of interfaces) if (i.role === "wan") internetIfaces.add(i.name);
  }

  return {
    addresses: addrMap, addressIface: addrIface, interfaces: ifaceMap, services: svcMap,
    // Kept in device order — the impact analysis needs it to say WHICH rule matches first.
    policies,
    internetIfaces,
  };
}

export function useFlowContext(deviceId: number | null, enabled: boolean): FlowContextState {
  const [state, setState] = useState<FlowContextState>({ ctx: EMPTY_FLOW_CONTEXT, loading: false });

  // Which device the loaded context belongs to, so switching firewalls re-reads instead of
  // annotating one device's proposal with another's subnets.
  const loadedFor = useRef<number | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (!enabled || !deviceId) return;
    if (loadedFor.current === deviceId) return;

    const ticket = ++seq.current;
    loadedFor.current = deviceId;
    setState({ ctx: EMPTY_FLOW_CONTEXT, loading: true });

    void (async () => {
      const [addresses, services, interfaces, policies, routes, vips] = await Promise.all([
        DeviceListAddresses(deviceId),
        DeviceListServices(deviceId),
        DeviceListSystemInterfaces(deviceId),
        DeviceListPolicies(deviceId),
        DeviceListStaticRoutes(deviceId),
        DeviceListVirtualIPs(deviceId),
      ]);
      if (ticket !== seq.current) return; // a newer device won the race
      setState({
        ctx: buildFlowContext(addresses, services, interfaces, policies, routes, vips),
        loading: false,
      });
    })().catch(() => {
      if (ticket !== seq.current) return;
      // Enrichment failed — the charts keep rendering from the CLI alone. Allow a later retry.
      loadedFor.current = null;
      setState({ ctx: EMPTY_FLOW_CONTEXT, loading: false });
    });
  }, [deviceId, enabled]);

  return state;
}
