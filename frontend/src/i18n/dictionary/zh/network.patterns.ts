/**
 * Chinese — the interpolated sentences of DHCP Servers.
 *
 * A translation may move the `{}` holes but may not change how many there are; ../../dictionary.test.ts
 * fails on that, because a dropped hole is an interface name or a threshold missing from the screen.
 */
import type { Dict } from "../merge";

export const networkPatterns: Dict = {
  // -- DHCP -----------------------------------------------------------------
  "Could not read DHCP servers from {}": "无法从 {} 读取 DHCP 服务器",
  "DHCP server on {} {} on {}": "{} 上的 DHCP 服务器已在 {} 上{}",
  "DHCP server on {} deleted from {}": "已从 {} 删除 {} 上的 DHCP 服务器",
  "The server on {} takes its addresses from somewhere this form does not edit ({}) — editing it here would rewrite it into a plain range server. Go back to the list.":
    "{} 上的服务器从本表单无法编辑的地方获取地址（{}）— 在此编辑会把它改写成普通的地址范围服务器，请返回列表。",
  "Edit the DHCP server on {}": "编辑 {} 上的 DHCP 服务器",
  "Delete the DHCP server on {}": "删除 {} 上的 DHCP 服务器",
  "· gateway {}": "· 网关 {}",
  "· domain {}": "· 域名 {}",
  "· {} MAC reservation{}": "· {} 条 MAC 保留{}",
  "· {} excluded range{}": "· {} 个排除范围{}",
  "The range {} – {} ends before it starts.": "范围 {} – {} 的结束值小于起始值。",
  "The excluded range {} – {} ends before it starts.": "排除范围 {} – {} 的结束值小于起始值。",
  "The reservation for {} needs an IPv4 address.": "{} 的保留需要一个 IPv4 地址。",
  "\"{}\" is not an IPv4 address.": "“{}” 不是 IPv4 地址。",
  "\"{}\" is not a netmask.": "“{}” 不是子网掩码。",
  "\"{}\" is not a MAC address — the device wants aa:bb:cc:dd:ee:ff.":
    "“{}” 不是 MAC 地址 — 设备需要 aa:bb:cc:dd:ee:ff 这种格式。",
  "Remove {} {}": "移除 {} {}",
  "Remove reservation {}": "移除保留 {}",
  "Reservation {} MAC address": "保留 {} 的 MAC 地址",
  "Reservation {} IP address": "保留 {} 的 IP 地址",
  "Reservation {} action": "保留 {} 的动作",
  "Reservation {} description": "保留 {} 的描述",
};
