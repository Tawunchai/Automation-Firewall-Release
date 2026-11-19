/**
 * Chinese — Log & Report ▸ Local Traffic.
 *
 * The vocabulary follows FortiOS's own Simplified Chinese GUI where it has one, because an
 * operator switching between this console and the device should not have to learn two words for
 * the same column: 本地流量 for Local Traffic, 日志 for log, 源 / 目标 for source / destination.
 *
 * The page subtitle is NOT here: it already lives in ./audit.ts, and two areas translating one
 * English string differently is a real defect — the same sentence would read one way or the other
 * depending on which module loaded last.
 */
import type { Dict } from "../merge";

export const logs: Dict = {
  "log entries": "日志条目",

  // -- Toolbar ---------------------------------------------------------------
  "Refresh the log": "刷新日志",
  "Download these entries as CSV": "将这些条目下载为 CSV",
  "Log source": "日志来源",
  "Which store on the device these entries are read from": "这些条目读取自设备上的哪个存储",
  "How far back to look": "回溯多长时间",
  "Search the log": "搜索日志",
  "Run the search": "搜索",
  "Clear the search": "清除搜索",
  "Search — an address, a port, a word, or srcip==10.0.0.1":
    "搜索 — 地址、端口、关键词，或 srcip==10.0.0.1",

  // -- Columns ---------------------------------------------------------------
  "Application Name": "应用名称",
  "Sent / Received": "发送 / 接收",
  "Archived packet capture": "已归档的抓包",
  "This entry has an archived packet capture": "该条目附有已归档的抓包文件",

  // -- A search the server refused to forward --------------------------------
  "That search was not sent to the firewall": "该搜索未发送到防火墙",
  "That search could not be understood": "无法理解该搜索",
  "The device would have accepted it and answered “no results”, which would read as a firewall that saw no traffic.":
    "设备会接受它并回答“无结果”，这看上去就像防火墙没有看到任何流量。",

  // -- States ----------------------------------------------------------------
  "No entries match this search": "没有条目匹配该搜索",
  "Nothing in this log matched.": "该日志中没有匹配项。",
  "This log": "该日志",
  "The firewall may well be logging normally — this list is unreadable, not empty":
    "防火墙很可能正在正常记录 — 该列表是“读取不到”，而不是“没有数据”",
  "the device is still searching": "设备仍在检索",
  "showing the newest": "显示最新的",
  "Read from": "读取自",
  "Entries shown": "显示的条目数",

  // -- The empty-log diagnosis ----------------------------------------------
  "This firewall is not recording local traffic": "该防火墙没有记录发往本机的流量",
  "Traffic addressed to the FortiGate itself is only logged when local-in logging is switched on, and it is off by default. Nothing is being written, so there is nothing for any log backend to show.":
    "只有开启 local-in 日志后，发往 FortiGate 本机的流量才会被记录，而它默认是关闭的。既然什么都没有写入，任何日志存储都无内容可显示。",
  "The firewall is recording local traffic, but this log backend has the category filtered out, so none of it is kept here. Another backend may still have it — try the log source picker.":
    "防火墙正在记录本机流量，但该日志存储把这一类别过滤掉了，因此这里不保留任何内容。其他存储可能仍有 — 试试切换日志来源。",
  "Turn it on from the CLI:": "通过 CLI 开启：",
  // -- Which traffic log, and the Policy column -----------------------------
  "Forward Traffic":
    "转发流量",
  "Addressed to the FortiGate itself":
    "发往 FortiGate 本机",
  "Passing through, to the internet or another network":
    "穿越设备，前往互联网或其他网络",
  "Local is traffic to the FortiGate itself; Forward is traffic passing through it":
    "Local 是发往 FortiGate 本机的流量；Forward 是穿越它的流量",
  "The log of traffic passing THROUGH this FortiGate, and which rule let it through":
    "穿越该 FortiGate 的流量日志，以及是哪条策略放行了它",
  "Implicit deny":
    "隐含拒绝策略",
  "Implicit local-in":
    "隐含 local-in 策略",
  "no rule matched":
    "没有策略匹配",
  "denied by rule":
    "被策略拒绝",
  "blocked by profile":
    "被安全配置文件阻断",
  "rule deleted":
    "策略已删除",
  "No rule permitted this traffic, so the implicit deny at the bottom of the table stopped it":
    "没有任何策略放行该流量，因此被策略表底部的隐含拒绝拦下",
  "This rule denied the traffic":
    "该策略拒绝了这条流量",
  "The rule permits this traffic — a security profile on it blocked the traffic instead":
    "该策略是放行的 — 真正阻断流量的是挂在它上面的安全配置文件，而不是策略本身",
  "This rule is no longer in the policy table — deleted or renumbered since":
    "该策略已不在策略表中 — 此后被删除或重新编号",
  "Traffic to the FortiGate itself, handled by the implicit local-in policy":
    "发往 FortiGate 本机的流量，由隐含 local-in 策略处理",
  // -- The pager -----------------------------------------------------------
  "Previous page": "上一页",
  "Next page": "下一页",
  "No entries": "没有条目",

  // -- Traffic log: readable results, policies, conversations, charts ----------
  "A firewall policy.": "一条防火墙策略。",
  "A firewall policy whose action is accept.": "动作为 accept（允许）的防火墙策略。",
  "A firewall policy whose action is deny.": "动作为 deny（拒绝）的防火墙策略。",
  "All from other devices": "全部来自其他设备",
  "All results": "全部结果",
  "All started by the FortiGate itself": "全部由 FortiGate 自身发起",
  "Anything to or from one address": "进出某个地址的所有流量",
  "A policy matched this traffic and its action is deny. To allow it, change that policy or put an allowing one above it.": "有一条策略匹配了此流量且其动作为拒绝。若要放行，请修改该策略，或在其上方放置一条允许的策略。",
  "Arriving on one interface": "从某个接口进入",
  "A security profile on this policy — the policy itself allows it": "该策略上的安全配置文件——策略本身是允许的",
  "A single = with * is a wildcard match": "单个 = 加 * 表示通配符匹配",
  "Ask the AI to read it": "让 AI 解读",
  "A word, looked for in names, services, apps and interfaces": "一个词，会在名称、服务、应用和接口中查找",
  "Blocked because": "被阻止的原因",
  "Blocked by a security profile": "被安全配置文件阻止",
  "Blocked — no rule matched": "被阻止——没有匹配的策略",
  "Both at once — a space means AND": "同时满足——空格表示 AND",
  "Click a destination to show only its entries.": "点击某个目标，只显示它的条目。",
  "Click an example to run it — then edit it": "点击示例即可运行——之后可以修改",
  "Click to see only these entries": "点击只查看这些条目",
  "Closed by the client": "由客户端关闭",
  "Comparisons: == != > < >= <=": "比较运算：== != > < >= <=",
  "Connections": "连接",
  "Connections over time, split by result": "按时间统计的连接，按结果拆分",
  "Connections to the unit itself on a management port were stopped. Refused is the right outcome if these are not your addresses; if they are yours, the local-in policy or the interface's allowaccess is what is turning them away.": "访问设备本身管理端口的连接被阻止。如果这些不是您的地址，拒绝是正确的结果；如果是您的地址，则是 local-in 策略或接口的 allowaccess 拒绝了它们。",
  "Conversations": "会话",
  "Data": "数据量",
  "Entries": "条目",
  "Every allowed connection finished normally": "所有被放行的连接都正常结束",
  "Every entry": "全部条目",
  "Every number and name on this page is also clickable and fills the box for you.": "本页上的每个数字和名称都可以点击，并会自动填入搜索框。",
  "Find a field": "查找字段",
  "For the questions no check was written for — why a service keeps resetting, what to look at first. It sees counts, not entries, and is told to say so when they cannot settle the question.": "用于没有编写检查的问题——为什么某个服务不断被重置、应先查看什么。它只看到计数而不是条目，并被要求在数据不足以下结论时如实说明。",
  "Handled by policy 8 (0 = implicit rules)": "由策略 8 处理（0 = 隐式规则）",
  "How to list the traffic": "流量的列出方式",
  "How to search": "如何搜索",
  "Implicit local-in policy": "隐式 local-in 策略",
  "Let through, but did not finish normally": "已放行，但没有正常结束",
  "Local out": "本机外发",
  "None of the checks found anything in these entries. That is not a clean bill of health for the firewall — it means nothing in this sample matched the patterns worth raising.": "所有检查都没有在这些条目中发现问题。这并不代表防火墙完全健康——只是说明该样本中没有值得指出的模式。",
  "No policy": "无策略",
  "No policy permits this traffic": "没有策略允许此流量",
  "No policy permits this traffic, so the implicit deny at the bottom of the policy table dropped it. To allow it, a policy has to be written for it.": "没有策略允许此流量，因此策略表底部的隐式拒绝将其丢弃。若要放行，需要为它编写一条策略。",
  "No policy (sent by the FortiGate)": "无策略（由 FortiGate 发出）",
  "Nothing was blocked": "没有任何流量被阻止",
  "Not recorded": "未记录",
  "One line per log entry — click one for the full story": "每条日志一行——点击查看完整经过",
  "Only blocked connections": "仅被阻止的连接",
  "Open this entry": "打开此条目",
  "Read it again": "再读一次",
  "Read these entries": "解读这些条目",
  "Refused by the local-in rules or the interface's administrative access": "被 local-in 规则或接口的管理访问设置拒绝",
  "Repeated refusals from one address on several different ports. That is either something probing the unit or a client configured to reach a service it is not allowed to reach — the log cannot tell which, and the addresses and ports below are what separates them.": "同一地址在多个不同端口上被反复拒绝。这要么是有东西在探测设备，要么是某个客户端被配置去访问不允许的服务——日志无法区分，下面的地址和端口可以帮助判断。",
  "Repeats of the same exchange folded into one line": "相同交互的重复记录合并为一行",
  "Reset by the server": "被服务器重置",
  "Reset or timed out": "被重置或超时",
  "sent by the FortiGate": "由 FortiGate 发出",
  "Sent by the FortiGate": "由 FortiGate 发出",
  "Show other entries with…": "显示具有以下特征的其他条目…",
  "stopped by the FortiGate": "被 FortiGate 阻止",
  "The AI could not read this log.": "AI 无法解读此日志。",
  "The connection was let through.": "该连接已被放行。",
  "The connection was let through and finished normally.": "该连接已被放行并正常结束。",
  "The connection was let through and the destination closed it abruptly. That is the far end refusing or dropping it — nothing on this firewall blocked it.": "该连接已被放行，但目标方突然关闭了它。这是对端拒绝或丢弃了连接——本防火墙上没有任何东西阻止它。",
  "The connection was let through, then got no answer or sat idle until the session timer expired. Often the destination is unreachable or not responding.": "该连接已被放行，但一直没有应答或处于空闲状态，直到会话计时器到期。通常是目标不可达或无响应。",
  "The firewall stopped this traffic.": "防火墙阻止了此流量。",
  "The FortiGate": "FortiGate",
  "the FortiGate itself": "FortiGate 本身",
  "the log": "日志",
  "The log held nothing to read.": "日志中没有可解读的内容。",
  "The path": "路径",
  "The policy's action is deny": "策略的动作为拒绝",
  "The policy that matched allows this traffic — a security profile on it (Web Filter, Application Control, AntiVirus, IPS) stopped it. The policy itself is fine; the profile is what decided.": "匹配的策略允许此流量——是该策略上的安全配置文件（Web Filter、Application Control、AntiVirus、IPS）阻止了它。策略本身没有问题，是配置文件做出的决定。",
  "The rule that matched permits this traffic — a Web Filter, Application Control or AntiVirus sensor on it made the decision. Editing the rule will change nothing; the profile attached to it is what to look at.": "匹配的规则允许此流量——是其上的 Web Filter、Application Control 或 AntiVirus 做出了决定。修改规则不会改变任何结果；应查看其关联的配置文件。",
  "These are connections the FortiGate started itself — FortiGuard, NTP, its own DNS — not anybody reaching the unit. They never meet the policy table, so no rule permitted or denied them.": "这些是 FortiGate 自己发起的连接——FortiGuard、NTP、它自己的 DNS——而不是有人访问设备。它们从不经过策略表，因此没有任何规则允许或拒绝它们。",
  "They fell through to the implicit deny at the bottom of the table, which means no policy permits them. If this traffic is supposed to work, the fix is a rule, not a change to an existing one.": "它们落到了表底部的隐式拒绝，说明没有策略允许它们。如果这些流量应当可用，解决办法是新建规则，而不是修改现有规则。",
  "The server reads the same entries again and asks the model what they show": "服务器会再次读取相同的条目，并询问模型它们说明了什么",
  "The source ended the connection with a reset. Usually harmless — an app or browser closing a connection it no longer needs.": "源端以重置方式结束了连接。通常无害——只是应用或浏览器关闭了不再需要的连接。",
  "The unit's own UTM engine rated these while they were open. This is the firewall's assessment, not this console's — the score and level are on each row.": "设备自身的 UTM 引擎在这些连接打开时对其进行了评分。这是防火墙的评估，而不是本控制台的——分数和级别在每一行上。",
  "This policy is no longer in the table — deleted or renumbered since these entries were written.": "该策略已不在表中——在这些条目写入后被删除或重新编号。",
  "Times are the FortiGate's own clock, like the table below.": "时间为 FortiGate 自身的时钟，与下方表格一致。",
  "To one country — quote a value with spaces": "发往某个国家——值中有空格时请加引号",
  "Top destinations, split by result": "主要目标，按结果拆分",
  "Traffic addressed TO this FortiGate — and the traffic it sends itself — with where it went, which policy handled it, and why anything was blocked": "发往本 FortiGate 的流量——以及它自己发出的流量——包括去向、由哪条策略处理，以及为什么被阻止",
  "Traffic from one address": "来自某个地址的流量",
  "Traffic passing THROUGH this FortiGate — where it went, which policy let it through or stopped it, and why": "穿过本 FortiGate 的流量——去向、由哪条策略放行或阻止，以及原因",
  "Traffic to one address": "发往某个地址的流量",
  "Traffic to one port": "发往某个端口的流量",
  "Traffic to the FortiGate itself was refused — by a local-in policy or by the interface's administrative access settings.": "发往 FortiGate 本身的流量被拒绝——由 local-in 策略或接口的管理访问设置拒绝。",
  "What can I search for?": "可以搜索什么？",
  "What happened": "发生了什么",
  "What it is": "说明",
  "When: connections over time": "何时：按时间统计的连接",
  "Where: top destinations": "去向：主要目标",
  "Which policy handled it — and why it was blocked": "由哪条策略处理——以及为什么被阻止",
  "Worth a look": "值得一看",
  "Every entry read from the log for this search — one entry is one connection. The line underneath says who started them.": "本次搜索从日志中读取的所有条目——一条即一个连接。下面一行说明由谁发起。",
  "Connections the FortiGate stopped: no policy matched, a policy said deny, or a security profile blocked it. The line underneath names the most common reason.": "被 FortiGate 阻止的连接：没有匹配的策略、策略为拒绝，或被安全配置文件阻止。下面一行给出最常见的原因。",
  "Connections the FortiGate let through that did not finish normally: the destination reset them, or they timed out. Usually the far end or the network, not the firewall.": "被 FortiGate 放行但没有正常结束的连接：被目标重置或超时。通常是对端或网络的问题，而不是防火墙。",
  "Total data moved by these connections, both directions. Counted in 1000s, exactly as the FortiGate's own log view shows it.": "这些连接双向传输的数据总量。以 1000 为进制计算，与 FortiGate 自身的日志视图一致。",
  "most: no policy matched": "最多：没有匹配的策略",
  "most: denied by a policy": "最多：被策略拒绝",
  "most: a security profile": "最多：安全配置文件",
  "most: refused by the FortiGate": "最多：被 FortiGate 拒绝",
};
