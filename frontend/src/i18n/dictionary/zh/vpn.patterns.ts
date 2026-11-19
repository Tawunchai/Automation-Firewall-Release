/**
 * Simplified Chinese — the interpolated sentences of the VPN pages.
 *
 * `Tunnel "{}" updated, but: {}` is the shape that matters most here: the tunnel wrote, something
 * downstream did not, and both halves have to survive translation. The reason in the second hole
 * comes back from the FortiGate untranslated, which is correct — it is the device's own words.
 */
import type { Dict } from "../merge";

export const vpnPatterns: Dict = {
  'Could not load tunnel "{}"': '无法加载隧道“{}”',
  'Could not load Hub-and-Spoke tunnel "{}"': '无法加载中心-分支隧道“{}”',
  'Tunnel "{}" updated on {}': '已在 {2} 上更新隧道“{1}”',
  'Tunnel "{}" deleted': '隧道“{}”已删除',
  'Tunnel "{}" deleted, but: {}': '隧道“{1}”已删除，但是：{2}',
  'Tunnel "{}" updated, but: {}': '隧道“{1}”已更新，但是：{2}',
  "Bring {} / {} down?": "要断开 {} / {} 吗？",
  "Sent {} to {}": "已将 {1} 发送到 {2}",
  "Enter a valid {} address.": "请输入有效的 {} 地址。",

  // Template names, with the remote device type filled in.
  "Dialup - {}": "拨号 - {}",
  "Custom - {}": "自定义 - {}",
  "Remote {}": "远端 {}",
  "Hub-and-Spoke ({})": "中心-分支（{}）",
  "Hub-and-Spoke - FortiGate ({})": "中心-分支 - FortiGate（{}）",
  "Hub-and-Spoke VPN ({})": "中心-分支 VPN（{}）",
  "Site to Site ({}) — created by the VPN Creation Wizard":
    "站点到站点（{}）— 由 VPN 创建向导生成",
  "Remote Access ({}) — created by the VPN Creation Wizard":
    "远程接入（{}）— 由 VPN 创建向导生成",
  "Hub-and-Spoke (FortiGate {}) — created by the VPN Creation Wizard":
    "中心-分支（FortiGate {}）— 由 VPN 创建向导生成",

  // Summary lines on the review step.
  "Static IP — {}": "静态 IP — {}",
  "Dynamic DNS — {}": "动态 DNS — {}",
  "IP Address — {}": "IP 地址 — {}",
  "Native — {}": "系统自带客户端 — {}",
  "Client-based — {}": "基于客户端 — {}",
  "Specify — {}": "手动指定 — {}",
  "Enabled — DH {}": "已启用 — DH {}",
  "Share Local — via {}": "共享本端 — 经由 {}",
  "Use Remote — local gateway {}": "使用远端 — 本端网关 {}",
  "Routed via {}{}": "经由 {}{} 路由",

  "Failed to {} the VPN tunnel": "{} VPN 隧道失败",
};
