/**
 * Chinese — DHCP Servers.
 *
 * One word is load-bearing:
 *
 *   "Skip policy routing"   跳过策略路由 — NOT 拒绝/阻止. FortiOS calls the action `deny` and it
 *                           drops nothing: the packet falls back to the routing table.
 */
import type { Dict } from "../merge";

export const network: Dict = {
  // -- DHCP servers ---------------------------------------------------------
  "DHCP Servers": "DHCP 服务器",
  "DHCP server": "DHCP 服务器",
  "New DHCP Server": "新建 DHCP 服务器",
  "Edit DHCP Server": "编辑 DHCP 服务器",
  "DHCP Server": "DHCP 服务器",
  "The DHCP server on": "位于",
  "is not handing out addresses on any interface": "没有在任何接口上分发地址",
  "A DHCP server belongs to one interface, and the addresses it hands out have to sit inside that interface's own subnet — the firewall will accept a range that does not and simply lease nothing.":
    "一个 DHCP 服务器只属于一个接口，它分发的地址必须落在该接口自己的子网内 — 否则防火墙会照单全收，然后什么租约都不发。",
  "Servers may well be configured — this is 'unreadable', not 'none'":
    "设备上可能确实配置了服务器 — 这是“读不到”，不是“没有”",
  "Loading DHCP server…": "正在加载 DHCP 服务器…",
  "DHCP server not found — go back to the list.": "未找到该 DHCP 服务器 — 请返回列表",
  "DHCP server status": "DHCP 服务器状态",

  "Address ranges": "地址范围",
  "What the clients get. Inside the interface's own subnet.":
    "客户端拿到的地址，必须在该接口自己的子网内。",
  "Excluded ranges": "排除范围",
  "Carved out of the ranges above — for the addresses given out by hand.":
    "从上面的范围里挖出来 — 留给手工分配的地址。",
  "Start address": "起始地址",
  "End address": "结束地址",
  "Add server": "添加服务器",
  "Add reservation": "添加保留",
  "Netmask": "子网掩码",
  "A netmask is required.": "必须填写子网掩码。",
  "Default gateway": "默认网关",
  "Leave empty for none": "留空表示没有",
  "Lease time": "租约时长",
  "1 day": "1 天",
  "8 hours": "8 小时",
  "One server per interface.": "每个接口一个服务器。",
  "The interface a server serves cannot be moved — delete it and make another.":
    "服务器所属的接口不能更改 — 请删除后重建。",
  "Choose the interface this server serves.": "请选择该服务器服务的接口。",
  "Add at least one address range — a server with none hands out nothing.":
    "至少添加一个地址范围 — 没有范围的服务器什么也不会分发。",
  "Every address range needs both a start and an end address.":
    "每个地址范围都需要起始地址和结束地址。",
  "Every excluded range needs both a start and an end address.":
    "每个排除范围都需要起始地址和结束地址。",
  "An excluded range contains something that is not an IPv4 address.":
    "某个排除范围里有不是 IPv4 地址的内容。",
  "no address range": "没有地址范围",

  "DNS:": "DNS：",
  "DNS servers": "DNS 服务器",
  "Same as the system DNS": "与系统 DNS 相同",
  "The FortiGate itself": "FortiGate 自身",
  "Specify — but no server is set": "选择了 Specify，但没有填服务器",
  "DNS mode Specify needs at least one DNS server.":
    "Specify 模式至少需要一个 DNS 服务器。",
  "Any addresses below are stored but not used in this mode.":
    "该模式下，下面的地址会被保存但不会被使用。",

  "MAC reservations": "MAC 地址保留",
  "Reserve gives that MAC the address every time. Block refuses it a lease at all — so this is also the deny list.":
    "Reserve 让该 MAC 每次都拿到同一个地址；Block 则完全不给租约 — 所以这张表同时也是拒绝列表。",
  "Reserve": "保留",
  "From pool": "从地址池",
  "IP address": "IP 地址",
  "dial-up VPN": "拨号 VPN",
  "a dial-up VPN": "拨号 VPN",
  "addresses from a user group": "地址来自用户组",
  "a user group": "一个用户组",
  "This server takes its addresses from somewhere this form does not edit":
    "该服务器的地址来自此表单无法编辑的地方",
  ". Clients on that segment stop getting addresses as their leases expire.":
    "。该网段上的客户端在租约到期后将不再获得地址。",
  "FortiOS cannot clear a DHCP domain over the API — it would keep \"":
    "FortiOS 无法通过 API 清空 DHCP 的 domain — 它会保留 “",
  "\" and report success. Put a domain back, or remove it on the device with":
    "” 并报告成功。请填回一个 domain，或在设备上用以下命令删除",

  // Shared with other lockout-style confirmations (e.g. device-admins) — not specific to this file.
  "This can lock you out": "这会把你自己锁在门外",
  "I understand — write it": "我明白 — 写入设备",

  "Delete DHCP server": "删除 DHCP 服务器",
  "New Administrator": "新建管理员",
  "The DHCP server on this interface will be removed from": "此接口上的 DHCP 服务器将被删除，来源：",
  "The firewall applies this immediately. If the address you are connected from is not in that list, this account stops working for you the moment it is saved.":
    "防火墙会立即生效。如果你当前连入的地址不在该列表中，保存的那一刻这个账号对你就失效了。",
};
