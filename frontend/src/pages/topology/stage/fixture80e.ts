// Captured from the lab FortiGate 80E (device 1, at 10.0.99.201 when this was taken; the unit
// now answers on 10.10.20.90) with GET requests only, so the
// stage is designed against what a real firewall returns rather than an invented ideal: 22
// interfaces of which 16 are jacks, one link actually up, eleven ports inside a hard-switch,
// three FortiOS pseudo-tunnels, and a default route that leaves through a port whose role says
// "lan".
import type { SystemInterface, StaticRoute, FirewallPolicy } from "../../../api/policyObject";

export const FGT80E_INTERFACES = [
  {
    "name": "dmz",
    "type": "physical",
    "vdom": "root",
    "ip": "10.10.10.1/24",
    "status": "up",
    "role": "dmz",
    "link_up": false
  },
  {
    "name": "fortilink",
    "type": "aggregate",
    "vdom": "root",
    "ip": "10.255.1.1/24",
    "status": "up",
    "role": "undefined",
    "link_up": null
  },
  {
    "name": "ha",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "l2t.root",
    "type": "tunnel",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": null
  },
  {
    "name": "lan",
    "type": "hard-switch",
    "vdom": "root",
    "ip": "192.168.1.99/24",
    "status": "up",
    "role": "lan",
    "members": [
      "port2",
      "port3",
      "port4",
      "port5",
      "port6",
      "port7",
      "port8",
      "port9",
      "port10",
      "port11",
      "port12"
    ],
    "link_up": null
  },
  {
    "name": "modem",
    "type": "physical",
    "vdom": "root",
    "status": "down",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "naf.root",
    "type": "tunnel",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": null
  },
  {
    "name": "port1",
    "alias": "External",
    "type": "physical",
    "vdom": "root",
    "ip": "10.0.99.201/22",
    "status": "up",
    "role": "lan",
    "link_up": true
  },
  {
    "name": "port2",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port3",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port4",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port5",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port6",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port7",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port8",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port9",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port10",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port11",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "port12",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": false
  },
  {
    "name": "ssl.root",
    "alias": "SSL VPN interface",
    "type": "tunnel",
    "vdom": "root",
    "status": "up",
    "role": "undefined",
    "link_up": null
  },
  {
    "name": "wan1",
    "alias": "WAN1",
    "type": "physical",
    "vdom": "root",
    "ip": "172.200.200.1/30",
    "status": "up",
    "role": "wan",
    "link_up": false
  },
  {
    "name": "wan2",
    "alias": "Internal",
    "type": "physical",
    "vdom": "root",
    "status": "up",
    "role": "wan",
    "link_up": false
  }
] as unknown as SystemInterface[];

export const FGT80E_ROUTES = [
  {
    "seq_num": 2,
    "dst_type": "subnet",
    "dst": "0.0.0.0/0",
    "gateway": "10.0.99.1",
    "device": "port1",
    "device_alias": "External",
    "distance": 10,
    "priority": 1,
    "weight": 0,
    "enabled": true,
    "comment": "",
    "blackhole": false,
    "dstaddr": "",
    "internet_service": 0,
    "internet_service_name": ""
  }
] as unknown as StaticRoute[];

export const FGT80E_POLICIES = [
  { id: 2, name: "Testing-Policy-Object", src_intf_list: ["lan"], dst_intf_list: ["wan1"], action: "accept", nat: true, enabled: true },
  { id: 5, name: "Test-DMZ-to-WAN", src_intf_list: ["dmz"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 6, name: "Guest-WiFi-Access", src_intf_list: ["dmz"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 11, name: "LAN-to-WAN-Secure", src_intf_list: ["lan"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 1, name: "default", src_intf_list: ["lan"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 7, name: "Host-10100-to-Internet", src_intf_list: ["lan"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 10, name: "8888", src_intf_list: ["lan"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true },
  { id: 8, name: "Block-FB-YT-172.16.100.123", src_intf_list: ["lan"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true, ips_sensor: "default" },
  { id: 4, name: "Web-Server", src_intf_list: ["port1"], dst_intf_list: ["lan"], action: "accept", nat: true, enabled: true },
  { id: 9, name: "TS-8.8.8.8-192.168.1.50", src_intf_list: ["port1"], dst_intf_list: ["lan"], action: "accept", nat: true, enabled: true },
  { id: 12, name: "TS-192.168.1.50-8.8.8.8", src_intf_list: ["port1"], dst_intf_list: ["port1"], action: "accept", nat: true, enabled: true },
] as unknown as FirewallPolicy[];
