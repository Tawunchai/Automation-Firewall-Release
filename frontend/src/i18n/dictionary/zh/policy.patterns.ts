/**
 * Simplified Chinese — the interpolated sentences of Policy & Objects.
 *
 * Most of these are the confirmations that follow a write to the firewall, and each carries the
 * object's own name plus the device it landed on. Both stay verbatim inside the Chinese sentence:
 * the name is what the operator will look for in `show firewall policy`, and translating around it
 * rather than through it is what keeps the two matchable.
 */
import type { Dict } from "../merge";

export const policyPatterns: Dict = {
  "⚠ Referenced by {} policy(ies) — the device will refuse to delete it until those are removed.":
    "⚠ 有 {} 条策略正在引用它 —— 在移除这些策略之前，设备会拒绝删除。",
  'Policy "{}" created on {}': '已在 {2} 上创建策略“{1}”',
  'Policy "{}" updated on {}': '已在 {2} 上更新策略“{1}”',
  'Service "{}" created on {}': '已在 {2} 上创建服务“{1}”',
  'Service "{}" updated on {}': '已在 {2} 上更新服务“{1}”',
  'Virtual IP "{}" created on {}': '已在 {2} 上创建虚拟 IP“{1}”',
  'Virtual IP "{}" updated on {}': '已在 {2} 上更新虚拟 IP“{1}”',
  'Virtual IP "{}" deleted': '已删除虚拟 IP“{}”',
  "Static route created on {}": "已在 {} 上创建静态路由",
  "Static route #{} updated on {}": "已在 {2} 上更新静态路由 #{1}",
  "Edit Static Route #{}": "编辑静态路由 #{}",
  "Edit Virtual IP — {}": "编辑虚拟 IP — {}",
  "Could not read the policies from {}": "无法从 {} 读取策略列表",
  "· {} existing (max {})": "· 已有 {}（上限 {}）",
  "Command parse error before '{}'": "命令在 '{}' 之前解析出错",
  "Hostname: {}": "主机名：{}",
  "System time: {}": "系统时间：{}",

  // The interface-bound address trap: FortiGate rejects the whole policy, not just the address,
  // so the message has to name all three things involved before it can be acted on.
  '"{}" is bound to interface "{}" and can\'t be used on "{}". Pick an address on {} (or one with no interface), or change the interface.':
    '地址“{1}”已绑定到接口“{2}”，因此不能用于“{3}”。请改选位于 {4} 上的地址（或未绑定接口的地址），或者更换接口。',
};
