/**
 * Chinese — the interpolated sentences of the System pages.
 *
 * The `{}` holes may move but not disappear; ../../dictionary.test.ts checks the count.
 */

import type { Dict } from "../merge";

export const systemPatterns: Dict = {
  // System ▸ SNMP.
  "Edit SNMP Community — {}": "编辑 SNMP 团体名 — {}",
  "Edit SNMP User — {}": "编辑 SNMP 用户 — {}",
  "Host type for host {}": "第 {} 个主机的类型",
  "Remove host {}": "删除第 {} 个主机",
  // Users table — the row checkbox's accessible name is "Select <first> <last>".
  "Select {} {}": "选择 {} {}",
  "Could not read the log settings from {}": "无法从 {} 读取日志设置",
  "Log settings saved on {}": "日志设置已保存到 {}",
  "syslog ({})": "syslog（{}）",
  "FortiAnalyzer ({})": "FortiAnalyzer（{}）",
  "Disk logging is switched on, but this model reports no log disk ({}). The setting is stored and does nothing.":
    "磁盘日志已启用，但该型号报告没有日志磁盘（{}）。这个设置被保存下来，却不起任何作用。",
  "The unit reports {}. FortiOS still accepts a disk-logging setting on a unit like this and stores it, so the values below are shown as they are on the device — they are not doing anything.":
    "设备报告 {}。FortiOS 在这样的设备上仍会接受并保存磁盘日志设置，所以下面的值就是设备上的原样 — 它们并没有起作用。",
  "Could not read HA from {}": "无法从 {} 读取 HA 配置",
  "(group \"{}\")": "（组 “{}”）",
  "and heartbeat interfaces {}": "以及心跳接口 {}",
  "This unit is standalone, but it still holds HA settings {}. They survive being taken out of a cluster and are not doing anything.":
    "这台设备是单机，但仍然保留着 HA 设置 {}。它们在被移出集群后依然留着，并没有起任何作用。",
  "This unit is in {} mode, but the member list could not be read. That is not the same as having no peers — do not read this as a healthy single member.":
    "这台设备处于 {} 模式，但成员列表读不到。这和“没有对端”不是一回事 — 不要把它当成一台健康的单成员。",
  "This unit is in {} mode and reports no members at all. A cluster that can see nobody is a cluster with a broken heartbeat.":
    "这台设备处于 {} 模式，却报告一个成员都没有。一个谁也看不见的集群，就是心跳坏掉的集群。",
  "Failover after {} missed": "连续丢失 {} 次后切换",
  "CPU {}% · RAM {}%": "CPU {}% · 内存 {}%",
  "Could not read the administrators from {}": "无法从 {} 读取管理员列表",
  "These accounts log in to {} itself, over HTTPS or SSH. They are not this console's users — those are under Security ▸ Users and cannot reach the firewall directly.":
    "这些账号通过 HTTPS 或 SSH 直接登录 {} 本身。它们不是本控制台的用户 — 那些在 Security ▸ Users 下，无法直接访问防火墙。",
  "Only from {}": "仅限 {}",
  "Second factor: {}": "第二因素：{}",
  "Can change: {}": "可修改：{}",
  "\"{}\" is not a subnet. Use 10.0.0.0/24 or 10.0.0.0 255.255.255.0.":
    "“{}” 不是子网。请使用 10.0.0.0/24 或 10.0.0.0 255.255.255.0。",
  "This restricts {} to the addresses below. Every other address — including the one you are connected from, unless it is in the list — stops being able to log in as this account.":
    "这会把 {} 限制在下面这些地址。其他任何地址 — 包括你当前连接的地址，除非它在列表里 — 都将无法再用这个账号登录。",

  "Edit Administrator — {}": "编辑管理员 — {}",
  "failover after {} missed": "丢失 {} 次后切换",

  // Device Identities / host pins
  "Cleared the pinned {} for {}":
    "已清除已固定的 {}（{}）",
  "Forget the {} host key this console pinned for this device.":
    "忘记本控制台为此设备固定的 {} 主机密钥。",
};
