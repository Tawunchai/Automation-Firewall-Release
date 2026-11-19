/**
 * Chinese — the interpolated sentences of Log & Report ▸ Local Traffic.
 *
 * `Nothing in the last {} matched` puts the period BEFORE the verb in Chinese, which is why this
 * is a pattern rather than a concatenation: 在最近 {} 内 has to wrap the value, and building the
 * sentence by joining a prefix and a suffix around it would put the time period in the wrong place.
 */
import type { Dict } from "../merge";

export const logsPatterns: Dict = {
  "Could not read the Local Traffic log from {}": "无法从 {} 读取本地流量日志",
  "Nothing in the last {} matched. Try a wider time period.":
    "在最近 {} 内没有匹配项。请尝试扩大时间范围。",
  "Recording: {}": "正在记录：{}",
  // The tail of "…holds no local traffic for the last 24 hours." — a fragment because the
  // sentence around it is assembled from parts the page decides on at render time.
  "for the last {}": "最近 {} 内",

  // -- Traffic log: stories, tiles, pivots -------------------------------------
  "Action {}": "动作 {}",
  "All fields ({})": "全部字段（{}）",
  "Connections to the unit itself on a management port were stopped, {} of them from {}. Refused is the right outcome if these are not your addresses; if they are yours, the local-in policy or the interface's allowaccess is what is turning them away.": "访问设备本身管理端口的连接被阻止，其中 {} 个来自 {}。如果这些不是您的地址，拒绝是正确的结果；如果是您的地址，则是 local-in 策略或接口的 allowaccess 拒绝了它们。",
  "Could not read the {} log from {}": "无法从 {2} 读取 {1} 日志",
  "Could not tell from this log: {}": "此日志无法判断：{}",
  "Everything below is computed from the {} entries read from {}.": "以下所有内容均根据从 {2} 读取的 {1} 条记录计算。",
  "Everything below is computed from the newest {} entries read from {} — the device holds more than one read returns.": "以下所有内容均根据从 {2} 读取的最新 {1} 条记录计算——设备保存的内容多于一次读取能返回的数量。",
  "From {}": "从 {}",
  "from the {} entries read": "来自读取的 {} 条记录",
  "It sent {} and received {}.": "发送 {}，接收 {}。",
  "It sent {} and received {} over {} s.": "在 {3} 秒内发送 {1}，接收 {2}。",
  "No entry here is “{}”.": "这里没有“{}”的条目。",
  "Policy {}": "策略 {}",
  "Policy {} handled it.": "由策略 {} 处理。",
  "Policy {} handled it — that policy has since been deleted or renumbered.": "由策略 {} 处理——该策略此后已被删除或重新编号。",
  "Policy {} matched when these were written and cannot be found now — deleted or renumbered since. That is the usual answer to “it worked yesterday”.": "写入这些条目时匹配的是策略 {}，但现在已找不到——此后被删除或重新编号。这通常就是“昨天还能用”的原因。",
  "Port {}": "端口 {}",
  "Read {} entries. The checks above are computed and link to their rows; this does not.": "读取了 {} 条记录。上面的检查是计算得出并链接到对应条目的；这里没有。",
  "Search: {}": "搜索：{}",
  "sent {} · received {}": "发送 {} · 接收 {}",
  "Show the {} entries": "显示这 {} 条记录",
  "The FortiGate itself connected to {} using {}.": "FortiGate 自身使用 {2} 连接到 {1}。",
  "The FortiGate itself connected to {} using {}, leaving through {}.": "FortiGate 自身使用 {2} 连接到 {1}，从 {3} 出去。",
  "The FortiGate opened them and the other side closed them, {} of those to {}. That is the remote service refusing, not the firewall blocking: a rule change here would not alter it. Worth checking the licence or subscription behind that service, and whether the unit can resolve and reach it.": "FortiGate 打开了这些连接，而对端将其关闭，其中 {} 个发往 {}。这是远端服务拒绝，而不是防火墙阻止：在这里修改规则不会改变结果。建议检查该服务背后的许可证或订阅，以及设备能否解析并访问它。",
  "The FortiGate talked to itself using {} (loopback).": "FortiGate 使用 {} 与自身通信（loopback）。",
  "The rule that matched permits this traffic ({}) — a Web Filter, Application Control or AntiVirus sensor on it made the decision. Editing the rule will change nothing; the profile attached to it is what to look at.": "匹配的规则允许此流量（{}）——是其上的 Web Filter、Application Control 或 AntiVirus 做出了决定。修改规则不会改变任何结果；应查看其关联的配置文件。",
  "They fell through to the implicit deny at the bottom of the table, which means no policy permits them. {} came from {}. If this traffic is supposed to work, the fix is a rule, not a change to an existing one.": "它们落到了表底部的隐式拒绝，说明没有策略允许它们。其中 {} 个来自 {}。如果这些流量应当可用，解决办法是新建规则，而不是修改现有规则。",
  "To {}": "到 {}",
  "{} started by the FortiGate · {} from other devices": "{} 由 FortiGate 发起 · {} 来自其他设备",
  "{} allowed · {} reset or timed out · {} blocked": "放行 {} · 重置或超时 {} · 阻止 {}",
  "{} by the policy's own action, {} by a security profile": "{} 个由策略自身动作阻止，{} 个由安全配置文件阻止",
  "1 time · {}": "1 次 · {}",
  "{} times · {}": "{} 次 · {}",
  "{} connected to {} using {}, arriving on {} and leaving through {}.": "{1} 使用 {3} 连接到 {2}，从 {4} 进入，从 {5} 出去。",
  "{} connected to the FortiGate itself using {}, arriving on {}.": "{1} 使用 {2} 连接到 FortiGate 本身，从 {3} 进入。",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Show {} as a chart or a table": "以图表或表格显示 {}",
};
