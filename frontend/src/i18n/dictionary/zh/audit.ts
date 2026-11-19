/**
 * Simplified Chinese — Audit / Review, Rule Lifecycle, Change Ledger, Notify and the log pages.
 *
 * These pages are unusually careful about the difference between what this console computed and
 * what the FortiGate itself reported, and that distinction is the thing the Chinese must not blur:
 * "our summary" / "reported by the device" / "not assessed here" are load-bearing hedges, not
 * padding. Each is translated as the same phrase everywhere it appears, so a reader learns it once
 * — 本控制台的判断 / 由设备报告 / 此处未评估.
 *
 * The framework names (PCI, PCI DSS, FSBP) are not translated: they are cited identifiers, and a
 * reviewer looks them up under those names.
 */
import type { Dict } from "../merge";

export const audit: Dict = {
  // -- Page framing ----------------------------------------------------------
  Overview: "概览",
  Findings: "发现项",
  Standards: "标准",
  "Device Rating": "设备评级",
  Advice: "建议",
  Observation: "观察项",
  Severity: "严重级别",
  High: "高",
  Low: "低",
  History: "历史",
  Trend: "趋势",
  Rescan: "重新扫描",
  Reload: "重新加载",
  Copy: "复制",
  "CLI copied": "已复制 CLI",
  "Could not copy — select the text and press Ctrl+C":
    "无法复制 — 请选中文本后按 Ctrl+C",
  "How to read this": "如何解读",
  "How to read this page": "如何解读本页",
  "What this page is meant to do": "本页的用途",
  "Pick a device to start the scan": "选择一台设备以开始扫描",
  "Reading policies, objects and counters from the device…":
    "正在从设备读取策略、对象和计数器…",
  "Reading the device's Security Rating…": "正在读取设备的 Security Rating…",
  "Reading the scan history…": "正在读取扫描历史…",
  "Reading the ledger…": "正在读取台账…",
  "Reading the policies and their hit counters from the device…":
    "正在从设备读取策略及其命中计数器…",
  "Entirely computed — no AI involved, and nothing is written to the device":
    "全部由本地计算得出 — 不涉及 AI，也不会向设备写入任何内容",
  "Read-only — nothing is written to the device": "只读 — 不会向设备写入任何内容",
  "Written by this console, not by the firewall": "由本控制台撰写，而非防火墙",
  "Reported by the firewall, not by this console.": "由防火墙报告，而非本控制台。",
  "Reported by the device": "由设备报告",
  "What this console computed from the policy table": "本控制台依据策略表计算得出的结果",
  "(our summary)": "（本控制台的判断）",
  "our summary": "本控制台的判断",
  "Speaks to — our mapping, not the device's": "关联到 — 本控制台的映射，而非设备的",

  // -- Standards and controls ------------------------------------------------
  "controls across": "个控制项，分布于",
  "controls listed here are assessed by this scan": "此处列出的控制项由本次扫描评估",
  "Control by control: what this scan evidences, and what it does not assess at all":
    "逐项控制：本次扫描能提供哪些证据，以及哪些完全未评估",
  Evidenced: "有证据支持",
  Scanned: "已扫描",
  "Gap found": "发现差距",
  "not assessed": "未评估",
  "not assessed here": "此处未评估",
  "Not assessed here": "此处未评估",
  "Actually evaluated": "实际已评估",
  "Could not determine": "无法判定",
  "reaches no verdict": "得不出结论",
  "Partly incomplete": "部分不完整",
  "Checks in the set": "该集合中的检查项",
  "Every check": "全部检查项",
  "No finding at this severity": "此严重级别下没有发现项",
  "No equivalent check": "没有等效的检查项",
  "Not licensed on this device": "此设备未授权",
  "Excluded on the device itself": "在设备上被排除",
  Label: "标签",
  "PCI (vendor edition)": "PCI（厂商版本）",
  "PCI DSS reference as numbered by this FortiOS version":
    "按此 FortiOS 版本编号的 PCI DSS 引用",
  "Fortinet Security Best Practices — reported by the device":
    "Fortinet Security Best Practices — 由设备报告",
  "Fortinet Security Best Practices — the vendor's own control ids":
    "Fortinet Security Best Practices — 厂商自有的控制项编号",
  "Grade from the device": "来自设备的评级",
  "Latest scan": "最近一次扫描",
  "Generated at": "生成于",
  "This device has no Security Rating report yet": "此设备还没有 Security Rating 报告",
  "The firewall's own Security Rating, relayed unchanged":
    "防火墙自身的 Security Rating，原样转发",
  "Run one on the firewall under Security Fabric > Security Rating. This console only reads the result — it cannot start a rating run.":
    "请在防火墙的 Security Fabric > Security Rating 下运行一次。本控制台只读取结果 — 无法发起评级运行。",
  "This scan carries no standards mapping": "本次扫描没有对应的标准映射",
  "Our summary of what this control is about — not the publisher's own wording, and not quotable as such":
    "本控制台对该控制项含义的概括 — 并非标准发布方的原文，不可作为原文引用",
  "This mapping was written by this console and has not yet been signed off by a qualified assessor":
    "此映射由本控制台撰写，尚未经过合格评估师确认",
  "These mappings are our interpretation of which controls a finding speaks to. They are evidence for a review, not a compliance verdict — only a qualified assessor can decide whether a control is met. The list below is the set of controls a firewall configuration could speak to, not a whole framework; the rows marked":
    "这些映射是本控制台对“某个发现项关联到哪些控制项”的解读。它们是复核所用的证据，而不是合规结论 — 只有合格评估师才能判定某个控制项是否满足。下面的列表是防火墙配置可能关联到的控制项集合，并非完整框架；标记为",
  "are part of that list on purpose, so that what was checked can be read against what was not. The vendor's own control ids are on the Device Rating tab, relayed from the firewall untouched.":
    "的行是有意保留在列表中的，以便把“已检查的内容”与“未检查的内容”对照阅读。厂商自有的控制项编号在“设备评级”页签，原样自防火墙转发。",
  "The vendor's PCI references, in the vendor's edition of the standard — an earlier one than the catalogue above. Not matched to our control numbers.":
    "厂商版本标准中的 PCI 引用 — 版本早于上面的目录，且未与本控制台的控制项编号对应。",
  "Checks, grade, severities and control ids are Fortinet's own. The device ran this scan on":
    "检查项、评级、严重级别和控制项编号均来自 Fortinet 自身。设备执行本次扫描的时间为",
  "what our severities and statuses mean": "本控制台的严重级别与状态含义",

  // -- Verdict wording -------------------------------------------------------
  "Both agree": "双方一致",
  "They disagree": "双方不一致",
  "Checked twice": "经过两次检查",
  "Only we answered": "只有本控制台给出了结论",
  "Only the device answered": "只有设备给出了结论",
  "related — does not vote": "相关 — 但不计入判定",
  "Both checks ran and reached the same conclusion": "两项检查都已运行，且结论一致",
  "Both checks ran and reached different conclusions — one is looking at something the other is not":
    "两项检查都已运行但结论不同 — 其中一方查看的内容是另一方没有查看的",
  "The device checked this and it passed": "设备检查了此项并且通过",
  "The device checked this and it did not pass": "设备检查了此项并且未通过",
  "This device has no licence for the check — it was not evaluated either way":
    "此设备没有该检查项的授权 — 因此未做任何评估",
  "The check needs something else in the fabric before it can run":
    "该检查需要 fabric 中的其他条件具备后才能运行",
  "A check behind this control could not be evaluated on this device":
    "该控制项背后的某项检查无法在此设备上评估",
  "Every check behind this control ran and found nothing against it":
    "该控制项背后的所有检查均已运行，未发现任何不符合之处",
  "These checks were not evaluated at all — neither passed nor failed":
    "这些检查完全没有被评估 — 既未通过也未失败",
  "This scan found something that contradicts the control":
    "本次扫描发现了与该控制项相抵触的内容",
  "This scan could not evaluate the question and the firewall could":
    "本次扫描无法评估该问题，而防火墙可以",
  "Nothing in this console evaluates this control. The row says what would have to be read for it to be answerable":
    "本控制台没有任何检查评估该控制项。该行说明了需要读取什么才能回答这个问题",
  "The firewall did not evaluate its equivalent check — not a licence, exempted, or dependencies unmet. This is not the vendor agreeing":
    "防火墙没有评估其等效检查 — 可能是缺少授权、被豁免，或依赖条件未满足。这并不代表厂商认同",
  "The firewall publishes nothing that asks this question; the checks below cover the same subject by a different test":
    "防火墙没有发布任何提出该问题的检查；下面的检查以不同的方式覆盖同一主题",
  "The same subject by a different test. Shown for context; it does not count towards the verdict":
    "同一主题、不同测试方式。仅作参考展示，不计入判定",
  "The only findings against this control are advisory — a disabled rule, a rule that has never matched, an object nothing references. Worth tidying; not a control failure":
    "针对该控制项的发现项全部属于建议性质 — 已禁用的规则、从未命中的规则、无人引用的对象。值得整理，但不构成控制项失败",
  "The only findings against this control carry a signed, unexpired acceptance — the risk was decided on, not removed":
    "针对该控制项的发现项都已有签署且未过期的风险接受记录 — 风险是被决定接受，而不是被消除",
  "Nothing this scan looks for is present on this device. That is not the same as full coverage — the Standards tab lists what is checked and what is not.":
    "本次扫描所查找的问题在此设备上均不存在。这并不等于覆盖完整 — “标准”页签列出了哪些被检查、哪些没有。",
  "A scan is stored when its findings differ from the previous one, or once every 12 hours if nothing has changed. Come back after the next change to this firewall.":
    "当扫描结果与上一次不同时会被保存；若没有变化，则每 12 小时保存一次。请在此防火墙下次发生变更后再回来查看。",
  "Not enough history to draw a trend yet": "历史数据不足，暂时无法绘制趋势",
  "Open findings over time": "未关闭发现项随时间的变化",
  "Whether this firewall is getting better, and what has been signed off":
    "此防火墙是否在改善，以及有哪些已被签署确认",
  "stored scans · accepted risks are excluded, so a line falling because somebody signed a waiver looks the same as one falling because somebody fixed the rule — check the register below.":
    "份已保存的扫描 · 已接受的风险不计入其中，因此曲线因有人签署豁免而下降，与因有人真正修复规则而下降看起来完全一样 — 请查看下方的登记表。",

  // -- Risk acceptance -------------------------------------------------------
  "Accept this risk": "接受此风险",
  "Accept this risk…": "接受此风险…",
  "Accepted risk register": "已接受风险登记表",
  "Risk accepted": "风险已接受",
  "risk accepted": "风险已接受",
  "Risk accepted by": "风险接受人",
  "· accepted by": "· 接受人",
  "Acceptance withdrawn": "已撤回接受",
  Withdraw: "撤回",
  "Withdraw this acceptance?": "要撤回此接受记录吗？",
  "Could not withdraw the acceptance": "无法撤回该接受记录",
  "Risk accepted — the finding stays on the report with your name on it":
    "风险已接受 — 该发现项仍留在报告中，并署上您的姓名",
  "Why is this acceptable? An assessor will read this":
    "为什么这是可以接受的？评估师会阅读这段说明",
  'Give at least 10 characters — "n/a" is not a justification anyone can use':
    '请至少填写 10 个字符 — “n/a”不是任何人能采信的理由',
  "e.g. legacy payment terminal needs this path until the Q4 migration; compensating control is the IPS profile on the upstream rule":
    "例如：旧的支付终端在第四季度迁移完成前需要这条路径；补偿控制是上游规则上的 IPS 配置文件",
  "The finding is": "该发现项为",
  ". It stays on the report and in the evidence pack, marked as accepted and carrying your name, your reason and the expiry date below.":
    "。它会保留在报告和证据包中，标记为已接受，并附上您的姓名、理由和下面的到期日期。",
  "Findings somebody signed off on. They are excluded from the severity counts but never removed from the report.":
    "已有人签署确认的发现项。它们不计入严重级别统计，但绝不会从报告中移除。",
  "Nothing on this firewall is running on a waiver.":
    "此防火墙上没有任何内容是靠豁免在运行的。",
  "· expires": "· 到期",

  // -- Rule Lifecycle --------------------------------------------------------
  Idle: "闲置",
  Stale: "陈旧",
  "Never used": "从未使用",
  Watching: "监视中",
  "Stale-rule threshold": "陈旧规则阈值",
  "How many idle days before a rule counts as stale": "闲置多少天后规则算作陈旧",
  "Carried traffic within the past week": "过去一周内有流量通过",
  "Still carries traffic, just not in the past week": "仍有流量通过，只是不在过去一周内",
  "It carried traffic once, but has been silent for longer than the threshold":
    "曾经有流量通过，但静默时间已超过阈值",
  "The device has counted no packet for this rule since the counters were reset":
    "自计数器重置以来，设备没有为此规则统计到任何报文",
  "Switched off — the counter is zero because it is disabled, not because nobody needs it":
    "已关闭 — 计数为零是因为规则被禁用，而不是因为没人需要它",
  "Suggested for removal": "建议删除",
  "Pick a device to see which rules are still being used":
    "选择一台设备以查看哪些规则仍在使用",
  "Daily hit count, the last 8 buckets reported by the device":
    "每日命中次数，取设备报告的最近 8 个区间",
  "The device did not return hit counters (monitor/firewall/policy), so this page":
    "设备没有返回命中计数器（monitor/firewall/policy），因此本页",
  "about which rules are dead, rather than reporting that all of them are":
    "关于哪些规则已经失效，而不是笼统地报告全部都已失效",
  "days = active · silent for more than": "天 = 活跃 · 静默超过",
  "days = stale": "天 = 陈旧",
  "Current thresholds: traffic within": "当前阈值：流量出现在",
  "hits / traffic / sessions": "命中 / 流量 / 会话",
  "Delete this policy from the firewall?": "要从防火墙上删除此策略吗？",
  "This device runs cfg-save automatic — once deleted there is no revision to roll back to":
    "此设备启用了 cfg-save automatic — 一旦删除就没有可回滚的版本",

  // -- Change Ledger ---------------------------------------------------------
  "No change has been recorded yet": "尚未记录任何变更",
  "Every time Policy & Objects, Security Profiles or VPN writes to a device, the change shows up here with its before and after values":
    "每当“策略与对象”、“安全配置文件”或 VPN 向设备写入内容时，变更都会连同变更前后的值出现在这里",
  Revert: "回退",
  Reverted: "已回退",
  "Reverted on the device": "已在设备上回退",
  "Reverts #": "回退 #",
  "Cannot revert": "无法回退",
  "Any action": "任意动作",
  "Any status": "任意状态",
  Before: "变更前",
  After: "变更后",
  Newer: "更新",
  Older: "更早",
  Previous: "上一条",
  "Current:": "当前：",
  "Some entries were rejected by the device. Part of a rejected change may still have applied — check the device itself":
    "部分条目被设备拒绝。被拒绝的变更仍可能有一部分已经生效 — 请到设备上核实",

  // -- Shared, generic phrases (download errors, range math) -----------------
  "The download failed": "下载失败",
  "in total": "总计",
  "of the": "，共",

  // -- Notify ----------------------------------------------------------------
  Channels: "通道",
  "Channels & recipients": "通道与接收人",
  "Edit channel": "编辑通道",
  "Remove channel": "移除通道",
  "Channel removed": "通道已移除",
  "LINE channel": "LINE 通道",
  "Email channel": "邮件通道",
  "Channel access token": "通道访问令牌",
  "Channel access token (long-lived)": "通道访问令牌（长期有效）",
  "What this channel is for": "此通道的用途",
  "A channel is a way out of the building. Alerts are sent to the recipients inside it.":
    "通道是消息离开系统的出口。告警会发送给通道内的接收人。",
  "Add recipient": "添加接收人",
  "Recipient added": "已添加接收人",
  "Recipient removed": "已移除接收人",
  "Remove recipient": "移除接收人",
  "no recipient": "无接收人",
  "no token": "无令牌",
  "Or type an address": "或直接输入一个地址",
  "address ·": "地址 ·",
  "Loading the address book…": "正在加载通讯录…",
  "Loading channels…": "正在加载通道…",
  "Loading alert rules…": "正在加载告警规则…",
  "Loading the alert history…": "正在加载告警历史…",
  "New alert rule": "新建告警规则",
  "Alert rules": "告警规则",
  "No alert rules yet": "还没有告警规则",
  "No rule in this category": "此分类下没有规则",
  "Rule name": "规则名称",
  "Edit rule": "编辑规则",
  "Delete rule": "删除规则",
  "Add the first rule": "添加第一条规则",
  "What to watch": "监视什么",
  "Watch the firewalls, and say something when they change":
    "监视这些防火墙，并在其发生变化时发出通知",
  "State changes — a port, or the whole firewall": "状态变化 — 某个端口，或整台防火墙",
  "A number crossing a line you set": "某个数值越过您设定的界线",
  "Resource thresholds": "资源阈值",
  "Link & reachability": "链路与可达性",
  Threshold: "阈值",
  "Threshold (": "阈值（",
  "Hold for": "持续时长",
  "Look back": "回溯范围",
  "How long, at most": "最长多久",
  "Repeat at most every": "重复发送的最小间隔",
  "Also send a message when it recovers": "恢复时也发送一条消息",
  "Recovery messages are never held back.": "恢复消息从不会被抑制。",
  "Firing now": "正在告警",
  "Firing only": "仅正在告警",
  "Firing and resolved": "正在告警与已恢复",
  "Resolved only": "仅已恢复",
  "firing on": "正在告警于",
  "Sent in 24h": "24 小时内已发送",
  "Nothing has been sent": "尚未发送任何内容",
  "Nothing was delivered": "没有任何内容被送达",
  "Nothing can be delivered yet": "目前还无法送达任何内容",
  Delivery: "投递",
  "test ok": "测试通过",
  "test failed": "测试失败",
  "Clear old": "清除旧记录",
  "Clear old alerts": "清除旧告警",
  "Clear alerts older than 7 days?": "要清除 7 天前的告警吗？",
  "Anything from the last week is kept. This cannot be undone.":
    "最近一周的记录会被保留。此操作无法撤销。",
  "7 days": "7 天",
  "Every device (including ones added later)": "全部设备（包括之后新增的）",
  "Every enabled rule is checked against each firewall once every":
    "每条已启用的规则会对每台防火墙检查一次，间隔为",
  "port1,port2 — blank means all": "port1,port2 — 留空表示全部",
  "Either nothing has gone wrong, or no rule is watching for it yet. The Rules tab says which.":
    "要么是没有出现任何问题，要么是还没有规则在监视它。“规则”页签会告诉您是哪一种。",
  "Nothing is being watched. A good first pair is “Port Up / Down” on every device, and CPU over 85% held for two checks.":
    "目前没有监视任何内容。建议先配置这两条：对所有设备的“端口 Up / Down”，以及 CPU 连续两次检查超过 85%。",
  "Alert rules can be written now, but with no channel configured they would fire into nothing. Add a LINE bot's access token, or an email channel that uses the SMTP account from Service ▸ Email.":
    "现在就可以编写告警规则，但如果没有配置通道，规则触发后无处可发。请添加 LINE 机器人的访问令牌，或添加一个使用“服务 ▸ 邮件”中 SMTP 账号的邮件通道。",
  "No delivery channel is usable yet — every rule below would fire into nothing. Add a LINE channel with an access token, or configure the mail account under Service ▸ Email.":
    "目前还没有可用的投递通道 — 下面每条规则触发后都无处可发。请添加带访问令牌的 LINE 通道，或在“服务 ▸ 邮件”下配置邮件账号。",
  "No recipient exists yet. Add one under the": "还没有任何接收人。请在",
  "tab, or this rule will fire into nothing.": "页签下添加一个，否则此规则触发后无处可发。",
  "No recipient yet — this channel can hold a token but has nowhere to send.":
    "还没有接收人 — 此通道可以保存令牌，但没有可发送的目标。",
  "Email is sent through the account under": "邮件通过以下位置配置的账号发送：",
  "Service ▸ Email": "服务 ▸ 邮件",
  ". There is no separate password here — one place to configure means one place for it to be wrong.":
    "。此处没有单独的密码 — 只在一个地方配置，也就只有一个地方可能配错。",
  "From the LINE Developers console: your Messaging API channel →":
    "在 LINE Developers 控制台中：您的 Messaging API 通道 →",
  "A userId, groupId or roomId —": "一个 userId、groupId 或 roomId —",
  "followed by 32 hex characters. Not the display name: that is accepted by nothing and fails silently at 3am. The bot must already have been added to the chat.":
    "后面跟 32 个十六进制字符。不是显示名称：显示名称不被任何接口接受，而且会在凌晨三点悄无声息地失败。机器人必须已经被加入该聊天。",
  "This is a group or room, not one person": "这是一个群或聊天室，而不是某一个人",
  ". It is stored encrypted and never sent back to this page.":
    "。该值加密保存，且绝不会回传到本页面。",
  "The history of what it already sent is kept. Only the rule and its live state go.":
    "它已发送内容的历史记录会保留。被删除的只是规则本身及其当前状态。",
  "They are dropped from every alert rule that names them.":
    "他们会从每一条指名了他们的告警规则中被移除。",
  ". What a rule watches cannot be changed after it is created — its threshold and its stored state mean different things per check.":
    "。规则监视的对象在创建后无法更改 — 因为不同检查项的阈值和已保存状态含义各不相同。",
  "is currently disabled)": "当前已禁用）",
  "not removed": "未被删除",

  // -- Logs ------------------------------------------------------------------
  "Read the log of traffic addressed to the firewall itself":
    "查看发往防火墙自身的流量日志",
  "The log of traffic addressed TO this FortiGate, not the traffic passing through it":
    "发往此 FortiGate 的流量日志，而不是经由它转发的流量",
  "Not connected to the device log yet": "尚未连接到设备日志",
  "This page is reserved for reading the Local Traffic log. There is no server endpoint that fetches it yet, so there is nothing to show.":
    "本页预留用于查看本地流量日志。目前还没有服务端接口能够获取该日志，因此暂无内容可显示。",
  "Lab device limitation (FortiGate 80E):": "实验设备限制（FortiGate 80E）：",
  "it has no log disk (": "它没有日志磁盘（",
  ") — so logs live in memory only — a small buffer, lost on reboot":
    "）— 因此日志只存在于内存中 — 缓冲区很小，重启即丢失",
  "For real retention the device has to forward to syslog or a FortiAnalyzer (":
    "若要真正长期留存，设备必须转发到 syslog 或 FortiAnalyzer（",
  "Filter by source, destination and action, as Session Monitor does":
    "按源、目标和动作筛选，与“会话监控”一致",
  "Jump from a log line to the policy behind it": "从一条日志跳转到其背后的策略",
  "s)": "秒）",

  // -- Licence-limited grading (Device Rating tab) --------------------------
  "checks could not run on this device for want of a licence, so this grade describes":
    "项检查因缺少授权而无法在此设备上运行，因此该评级只反映",
  "checks, not the full set. The rule-table checks on the Findings tab need no licence and are unaffected.":
    "项检查，而不是完整的检查集。“发现项”页签上的规则表检查无需授权，不受影响。",
  '— reported as "could not determine" on the Standards tab rather than counted as passing':
    "— 在“标准”页签中报告为“无法判定”，而不是计为通过",
  "our scan against the firewall's own Security Rating":
    "本控制台的扫描与防火墙自身 Security Rating 的对比",
  "The CLI that fixes this — copy it and run it yourself; the console will not":
    "用于修复此问题的 CLI — 请自行复制并执行；本控制台不会替您执行",


  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Accept and sign": "接受并签署",
  "Could not record the acceptance": "无法记录此次接受",
  "All devices": "所有设备",
  "Cannot be reverted": "无法撤销",
  "(cited, not reproduced)": "（仅引用，未复制原文）",
  "Could not delete the policy": "无法删除该策略",
  "Could not read the counters from the device": "无法从设备读取计数器",
  "Could not read the ledger": "无法读取变更台账",
  "Could not read the rating": "无法读取评级",
  "EXPIRED": "已过期",
  "IN FORCE": "生效中",
  "WITHDRAWN": "已撤回",
  "Nothing selected": "未选择任何内容",
  "Reading the firewall…": "正在读取防火墙…",
  "Recording…": "正在记录…",
  "(system)": "（系统）",
  "The deleted object will be recreated with its original values": "被删除的对象将以其原始值重新创建",
  "The object that was created will be deleted from the live device": "已创建的对象将从实际设备上删除",
  "The previous values will be written back over the current ones": "此前的值将覆盖写回当前值",
  "The device did not evaluate this check, so it is not an opinion either way": "设备未评估此项检查，因此不构成任何一方的判断",
  "The device evaluated this check": "设备已评估此项检查",
  "The scan failed": "扫描失败",
  "This scan found no problem": "本次扫描未发现问题",
  "Worth reviewing": "值得复核",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "1 day ago": "1 天前",
  "Today": "今天",
  "The device returned no hit counters, so this page cannot confirm the rule is unused — check it yourself before deleting": "设备没有返回命中计数，因此本页无法确认该规则未被使用 — 删除前请自行核实",
  "This rule carried traffic within the past week — it is still in use": "此规则在过去一周内承载过流量 — 它仍在使用中",
  "This rule is disabled, so its counter is zero because it is off rather than unused — find out who disabled it and why": "此规则已被禁用，计数为零是因为它被关闭，而不是因为没人用 — 请查清是谁禁用的以及原因",

  // -- Revert reasons, and the posture-score tile's own label — served by the Go backend, so the
  // extractor never sees them ---
  "Security Posture": "安全态势",
  "already reverted": "已经撤销过了",
  "the change never applied, so there is nothing to undo": "该变更从未被应用，因此没有可撤销的内容",
  "this entry is itself a revert — undo it from the original change": "此条目本身就是一次撤销 — 请从原始变更处撤销",
  "no FortiOS table was recorded for this change": "此变更没有记录对应的 FortiOS 表",
  "the created object's key was not captured": "未捕获所创建对象的键",
  "no snapshot of the previous state was captured": "未捕获此前状态的快照",
  "no object key was recorded": "未记录对象的键",
  "no snapshot of the deleted object was captured": "未捕获被删除对象的快照",
  "unsupported change type": "不支持的变更类型",

  // -- Configuration Drift (drift + ledger tabs, change analysis) --------------
  "Acknowledge": "确认",
  "Acknowledgement removed": "已撤销确认",
  "Analysis window": "分析时间范围",
  "Baseline": "基线",
  "Changes per day": "每日变更",
  "Changes per day, through this console and outside it": "每日变更，包括通过本控制台和在控制台之外的变更",
  "Changes per FortiOS table, through this console and outside it": "按 FortiOS 表统计的变更，包括通过本控制台和在控制台之外的变更",
  "Changes this console cannot account for": "本控制台无法解释来源的变更",
  "Chart": "图表",
  "Clean": "无异常",
  "Compare now": "立即比较",
  "Comparing…": "正在比较…",
  "Configuration Drift": "配置漂移",
  "Configuration Drift view": "配置漂移视图",
  "Console": "控制台",
  "Day": "日期",
  "Drift": "漂移",
  "Drift findings": "漂移发现",
  "Every change to your firewalls — made through this console, or outside it": "防火墙上的每一项变更——无论是通过本控制台还是在控制台之外进行的",
  "Every finding has been reviewed": "所有发现均已复核",
  "Everything that changed was done through this console": "所有变更均通过本控制台完成",
  "Every write this console makes is recorded in the Change Ledger. Every backup is compared with the one before it, and the ledger's changes are subtracted — what is left changed on the firewall some other way: the CLI, its own web GUI, or another tool. That is not automatically wrong; it is unaccounted for, and worth a look.": "本控制台的每一次写入都会记录在变更台账中。每次备份都会与上一次比较，并减去台账中的变更——剩下的就是通过其他方式在防火墙上发生的变更：CLI、设备自带的 Web GUI 或其他工具。这并不一定有问题，但它来源不明，值得查看。",
  "Filter by action": "按操作筛选",
  "Filter by status": "按状态筛选",
  "Finding acknowledged": "已确认该发现",
  "First backup — nothing to compare against yet": "首次备份——暂无可比较的对象",
  "FortiOS table": "FortiOS 表",
  "Last checked": "上次检查",
  "Loading the snapshots…": "正在加载快照…",
  "Modified": "已修改",
  "Neither through this console nor, as far as the backups show, outside it": "既没有通过本控制台，就备份所见也没有在控制台之外",
  "No backup yet — take one from Devices before this can compare anything.": "尚无备份——请先在“设备”页面创建备份，然后才能进行比较。",
  "No comparison has run yet. Take a backup, or press “Compare now” above.": "尚未进行任何比较。请创建备份，或点击上方的“立即比较”。",
  "No line detail stored for this object.": "未保存该对象的行级详情。",
  "Nothing changed between these two backups.": "这两次备份之间没有任何变更。",
  "Nothing unaccounted for": "没有来源不明的变更",
  "Not run": "未运行",
  "open finding": "项未处理发现",
  "open findings": "项未处理发现",
  "Open findings": "未处理的发现",
  "Open last run": "打开最近一次运行",
  "Outside": "控制台之外",
  "Outside changes are dated by the backup that revealed them, not by when they were made — a change is only seen once the next backup has been compared.": "控制台之外的变更按发现它们的备份计日期，而不是实际发生的时间——只有在下一次备份比较完成后才能看到该变更。",
  "Outside the console": "控制台之外",
  "Centralize MGMT": "集中管理",
  "Local MGMT": "本地管理",
  "Rejected writes": "被拒绝的写入",
  "Reviewed": "已复核",
  "Table": "表格",
  "The comparison itself failed": "比较本身失败",
  "This console": "本控制台",
  "This firewall has never been analysed": "该防火墙从未被分析",
  "This was the device's first backup — there was nothing to compare it against.": "这是该设备的首次备份——没有可比较的对象。",
  "Through this console": "通过本控制台",
  "Unaccounted for": "来源不明",
  "Unaccounted for and not yet reviewed": "来源不明且尚未复核",
  "Un-acknowledge": "撤销确认",
  "When": "时间",
  "Where changes land": "变更发生在哪里",
  "Could not compute the change analysis": "无法计算变更分析",
  "Could not load this change's snapshots": "无法加载该变更的快照",
  "Could not load drift data": "无法加载配置漂移数据",
  "Could not load that run": "无法加载该次运行",
  "The analysis failed": "分析失败",
  "Could not update the finding": "无法更新该发现",
  "1 change nobody here can account for": "有 1 项变更无人能够解释来源",

  // -- Configuration Drift: one change history, fallback guide, restore dialog ----
  "All accounted for": "全部可解释",
  "Backup comparison": "备份比较",
  "Backup comparisons": "备份比较记录",
  "Backups are compared": "比较备份",
  "Can I take a change back?": "变更可以撤回吗？",
  "Can this be taken back?": "这项变更可以撤回吗？",
  "Change history": "变更历史",
  "Changes made here are recorded": "在本控制台所做的变更都会被记录",
  "Changes made in Policy & Objects, Security Profiles, VPN and the other pages appear here as they happen; changes made elsewhere appear after the next backup comparison.": "在策略与对象、安全配置文件、VPN 等页面所做的变更会立即显示在这里；在其他地方所做的变更会在下一次备份比较后显示。",
  "Checking this backup…": "正在检查该备份…",
  "Compare the two newest backups now": "立即比较最新的两份备份",
  "Comparison failed": "比较失败",
  "Could not read this backup": "无法读取该备份",
  "Deleted from the firewall": "已从防火墙删除",
  "Each row is one comparison of a backup with the one before it. Outside changes in the history above come from these.": "每一行是一次备份与上一份备份的比较。上方历史中的“控制台之外”变更就来自这里。",
  "Every change to this firewall — made in this console or outside it — and how to take it back": "该防火墙上的每一项变更——无论在本控制台内还是控制台之外——以及如何撤回",
  "Every outside change has been reviewed": "所有控制台之外的变更均已复核",
  "Everything": "全部",
  "First backup — baseline": "首次备份——基线",
  "From": "来源",
  "How this page works": "本页如何工作",
  "It has already been undone.": "该变更已被撤销。",
  "It has already been undone from this console — the object was deleted from the firewall.": "已从本控制台撤销——该对象已从防火墙删除。",
  "It was already gone from the firewall": "该对象已不在防火墙上",
  "I understand that": "我了解",
  "Kind of change": "变更类型",
  "Loading the details…": "正在加载详情…",
  "Marked as reviewed": "已标记为已复核",
  "Mark reviewed": "标记为已复核",
  "Needs review": "待复核",
  "Never compared": "从未比较",
  "No.": "不可以。",
  "No backup yet — take one from Devices before anything can be compared.": "尚无备份——请先在“设备”页面创建备份，然后才能进行比较。",
  "No change made outside the console has been found": "尚未发现在控制台之外所做的变更",
  "No line detail was stored for this object.": "未保存该对象的行级详情。",
  "Nothing to undo — the firewall rejected this change, so it never applied.": "无可撤销——防火墙拒绝了该变更，因此它从未生效。",
  "Nothing waiting for review": "没有待复核的变更",
  "Other firewalls with unreviewed outside changes:": "其他有待复核的控制台之外变更的防火墙：",
  "Outside changes": "存在控制台之外的变更",
  "Outside changes appear only after two backups have been compared": "只有在比较两份备份之后，才会显示控制台之外的变更",
  "Outside changes found": "发现控制台之外的变更",
  "Outside changes nobody has reviewed yet": "尚无人复核的控制台之外变更",
  "“Outside the console” does not mean wrong — it means unrecorded. If it was expected, mark it reviewed and it stops counting as open. Undo, Restore and Mark reviewed are for admins.": "“控制台之外”并不代表有问题——它代表没有记录。如果是预期内的变更，请标记为已复核，它将不再计为待处理。撤销、恢复和标记复核仅限管理员。",
  "Reading the change history…": "正在读取变更历史…",
  "Rejected by the device": "被设备拒绝",
  "Reopen": "重新打开",
  "Reopened": "已重新打开",
  "Restore and reboot": "恢复并重启",
  "Restore anyway": "仍然恢复",
  "Restore backup…": "恢复备份…",
  "Restore configuration": "恢复配置",
  "Restoring…": "正在恢复…",
  ". Restoring it is very likely to leave the unit unusable. Continue only if you know why the two differ.": "。恢复它很可能导致设备无法使用。只有在您清楚两者为何不同时才继续。",
  "Show": "显示",
  "Show details": "显示详情",
  "Size": "大小",
  "Take a backup from Devices first": "请先在“设备”页面创建备份",
  "Taken": "创建时间",
  "The device has not rejected any change": "设备尚未拒绝任何变更",
  "This backup cannot be restored.": "该备份无法恢复。",
  "This backup does not match this firewall.": "该备份与此防火墙不匹配。",
  "This device": "本设备",
  "This page lists every change to the selected firewall in one history — the ones made through this console and the ones made any other way — and tells you, for each, whether and how it can be taken back.": "本页在一个历史中列出所选防火墙的每一项变更——包括通过本控制台所做的和通过其他方式所做的——并说明每一项能否撤回以及如何撤回。",
  "Undo": "撤销",
  "Undone": "已撤销",
  "Undone on the firewall": "已在防火墙上撤销",
  "Undo, Restore and Mark reviewed are on the matching rows of the change history.": "撤销、恢复和标记复核位于变更历史中对应的行上。",
  "Unrecorded changes are flagged": "未记录的变更会被标出",
  "What changed in the backup": "备份中的变更内容",
  "What happens": "会发生什么",
  "What will happen": "将会发生什么",
  "will reboot and that its current configuration will be replaced.": "将会重启，且其当前配置将被替换。",
  "Yes. This object was created outside the console, so undoing it deletes it from the firewall. The firewall refuses if something still uses it. The delete is recorded, so it can be undone too.": "可以。该对象是在控制台之外创建的，因此撤销即是将其从防火墙删除。如果仍有其他对象在使用它，防火墙会拒绝。删除操作会被记录，因此也可以再次撤销。",
  "Yes. Undo deletes the object this change created. The undo is recorded here too.": "可以。撤销会删除此变更创建的对象，撤销操作也会记录在此。",
  "Yes. Undo recreates the object with the values recorded before it was deleted. The undo is recorded here too.": "可以。撤销会用删除前记录的值重新创建该对象，撤销操作也会记录在此。",
  "Yes. Undo writes back the values the object had before this change. The undo is recorded here too.": "可以。撤销会写回该对象在此变更之前的值，撤销操作也会记录在此。",
  "Not on its own — the console holds the deleted object only as lines in a backup, which cannot be recreated safely one object at a time. The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, every change made since is lost (including ones made here), and the firewall reboots. You see a preview first.": "无法单独撤回——控制台只以备份中的配置行形式保存了被删除的对象，无法安全地逐个对象重新创建。备选方案是恢复变更之前的备份：整台防火墙将回到那一时刻，此后的所有变更（包括在本控制台所做的）都会丢失，并且防火墙会重启。确认前您会先看到预览。",
  "Not on its own — the console holds this object's earlier version only as lines in a backup, which cannot be put back safely one object at a time. The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, every change made since is lost (including ones made here), and the firewall reboots. You see a preview first.": "无法单独撤回——控制台只以备份中的配置行形式保存了该对象之前的版本，无法安全地逐个对象写回。备选方案是恢复变更之前的备份：整台防火墙将回到那一时刻，此后的所有变更（包括在本控制台所做的）都会丢失，并且防火墙会重启。确认前您会先看到预览。",
  "Every write this console makes to a firewall — policies, objects, profiles, VPN — is saved with who made it, when, and the object before and after.": "本控制台对防火墙的每一次写入——策略、对象、配置文件、VPN——都会记录操作人、时间以及对象变更前后的内容。",
  "Each new backup is compared with the one before it, to find everything that changed on the firewall between the two.": "每一份新备份都会与上一份比较，以找出两者之间防火墙上发生的所有变更。",
  "A change no recorded write explains was made some other way — the CLI, the FortiGate's own GUI, FortiManager. It is listed as “Outside the console”.": "没有任何写入记录可以解释的变更是通过其他方式完成的——CLI、FortiGate 自带的 GUI 或 FortiManager——它会显示为“控制台之外”。",
  "Made in this console": "在本控制台所做",
  "New object, made outside": "在控制台之外新建的对象",
  "Edit or delete, made outside": "在控制台之外的修改或删除",
  "Restore a backup": "恢复备份",
  "Reverses exactly that change on the firewall, from what was recorded. The undo is recorded too.": "按记录内容在防火墙上精确撤销该变更。撤销操作也会被记录。",
  "Deletes that object from the firewall. Refused if something still uses it. The delete is recorded, so it can be undone as well.": "将该对象从防火墙删除。如果仍有其他对象在使用它则会被拒绝。删除会被记录，因此也可以再次撤销。",
  "Only the whole configuration can go back — to the backup taken before the change. Everything changed since is lost, and the firewall reboots. You see a preview first.": "只能整体恢复配置——恢复到变更之前的备份。此后的所有变更都会丢失，并且防火墙会重启。确认前您会先看到预览。",
  "Could not read the change history": "无法读取变更历史",
  "Could not load the details": "无法加载详情",
  "The undo failed": "撤销失败",
  "Could not update the change": "无法更新该变更",
  "Could not load the comparisons": "无法加载比较记录",
  "Could not load that comparison": "无法加载该次比较",
  "The comparison failed": "比较失败",
  "made through this console — undo it from its Change Ledger entry": "通过本控制台所做——请从其变更台账条目撤销",
  "already undone from this console": "已从本控制台撤销",
  "an edit made outside the console cannot be undone object by object — restore the backup taken before it": "在控制台之外所做的修改无法逐个对象撤销——请恢复在此之前的备份",
  "an object deleted outside the console cannot be recreated object by object — restore the backup taken before it": "在控制台之外删除的对象无法逐个重新创建——请恢复在此之前的备份",
  "unknown kind of change": "未知的变更类型",
  "the object has no key, and a delete without one would clear the whole table": "该对象没有键，没有键的删除会清空整张表",
  "the FortiOS table could not be worked out from the backup": "无法从备份中确定 FortiOS 表",
  "deletes this object from the firewall; refused if something still uses it": "将该对象从防火墙删除；如果仍被使用则会被拒绝",

  // -- Configuration Drift: what each number and the comparison mean -----------
  "Changes this console wrote to the firewall that took effect in the window — from any page or the AI Assistant. Changes that were later undone still count: they did apply.": "在所选时间范围内，本控制台写入防火墙并已生效的变更——来自任何页面或 AI 助手。之后被撤销的变更也计入，因为它们确实生效过。",
  "Objects that changed on the firewall with no record in this console — made through the CLI, the FortiGate's own GUI, FortiManager or another tool. Found by comparing backups, and dated by the backup that revealed them.": "防火墙上发生变化、但本控制台没有任何记录的对象——通过 CLI、FortiGate 自带的 GUI、FortiManager 或其他工具完成。通过比较备份发现，并以发现它的备份时间计日期。",
  "Outside changes nobody has looked at yet. Mark one reviewed, or undo it, and it leaves this count. Counts all time, not only the window.": "尚无人查看的控制台之外变更。标记为已复核或将其撤销后，它就不再计入。统计全部时间，而不仅是所选时间范围。",
  "Changes this console tried to make that the firewall refused — an invalid value, a missing object, a duplicate name. They never changed the device, so they are not counted as changes.": "本控制台尝试执行但被防火墙拒绝的变更——值无效、对象不存在或名称重复。它们从未改变设备，因此不计为变更。",
  "Every backup reads the firewall's whole configuration. The console compares it with the previous backup, subtracts the changes it recorded itself, and lists whatever is left as “Outside the console”. It runs by itself after each backup; Compare now runs it on the two newest backups straight away.": "每次备份都会读取防火墙的完整配置。控制台将其与上一份备份比较，减去自己记录的变更，剩下的就列为“控制台之外”。每次备份后自动运行；“立即比较”会马上比较最新的两份备份。",

  // -- Audit: ISO/IEC 27001 control view -------------------------------------------
  "Annex A control by control: what this scan evidences, and what it does not assess at all":
    "逐项查看 Annex A 控制：本次扫描能提供哪些证据，以及哪些完全没有评估",
  "Speaks to — ISO/IEC 27001 Annex A, our mapping": "对应——ISO/IEC 27001 Annex A（我们的映射）",
  "Why these controls:": "为什么是这些控制：",
  "(our reading)": "（我们的解读）",
  "partial": "部分",
  "The correspondence covers part of the Annex A control, not all of it": "此对应只覆盖该 Annex A 控制的一部分，而非全部",
  "NIST SP 800-53 Rev. 5 · public domain": "NIST SP 800-53 Rev. 5 · 公有领域",
  "NIST's discussion of it": "NIST 对此的说明",
  "— the authoritative wording ↗": "——权威原文 ↗",
  "Hide what is wrong": "隐藏问题",
  "What this control asks for": "此控制的要求",
  "Hide what this control asks for": "隐藏此控制的要求",
  "How to close this": "如何关闭此项",
  "The remediation panel": "修复面板",
  "are part of that list on purpose, so that what was checked can be read against what was not. This console assesses ISO/IEC 27001 and no other standard, so nothing on this page speaks to PCI DSS, NIST or the firewall's own vendor rating.":
    "是有意列入的，以便把已检查的内容与未检查的内容对照阅读。本控制台只评估 ISO/IEC 27001，不评估其他标准，因此本页没有任何内容涉及 PCI DSS、NIST 或防火墙厂商自己的评分。",
  "controls": "项控制",

  // -- Audit: remediation steps ------------------------------------------------------
  "How to close": "如何关闭",
  "Re-reading the firewall and working out the plan…": "正在重新读取防火墙并制定方案…",
  "Running every step below would close this control": "执行下方所有步骤即可关闭此控制",
  "Running every step below would not close this control on its own": "仅执行下方所有步骤仍无法单独关闭此控制",
  "There is nothing to fix on this control": "此控制没有需要修复的内容",
  "Steps": "步骤",
  "checked against": "已对照",
  "Says who": "依据来源",
  "Copied — review it before you run it": "已复制——运行前请先检查",
  "This took longer than the request was allowed. The scan, the schema reads and the model call together can run to half a minute on a busy firewall — try again.":
    "耗时超过了请求允许的时间。在繁忙的防火墙上，扫描、读取 schema 和调用模型加起来可能需要半分钟——请重试。",
  "This firewall's own schema confirms the attribute and accepts this value": "此防火墙自身的 schema 确认了该属性并接受此值",
  "attribute verified": "属性已验证",
  "The attribute exists on this firmware. Its value is not one the schema enumerates — a name, a number, an address — so the value is yours to choose":
    "此固件中存在该属性。它的值不在 schema 枚举范围内——可能是名称、数字或地址——因此由您自行选择",
  "table verified": "表已验证",
  "The table exists on this device. A delete or a move writes no attribute, so there is nothing further to check":
    "此设备上存在该表。删除或移动不写入任何属性，因此无需进一步检查",
  "not in this firmware": "此固件中没有",
  "This device publishes no such attribute — the command would not do what it says. Check it before running it":
    "此设备没有该属性——命令不会按字面生效。运行前请检查",
  "value not accepted": "值不被接受",
  "The attribute exists but this device does not list this value among the ones it accepts":
    "该属性存在，但此设备可接受的值中没有此值",
  "could not check": "无法检查",
  "This device did not answer the schema request, so the command was not checked against its firmware":
    "此设备没有响应 schema 请求，因此命令未对照其固件检查",
  "accepts:": "可接受：",
  "already accepted": "已接受",
  "advisory": "建议",
  "Clutter rather than exposure. Fixing it moves an observation, never a gap.":
    "属于杂乱而非暴露。修复它只会改变一项观察结果，不会关闭任何缺口。",
  "more": "项",

  // -- Audit: applying a remediation ---------------------------------------------------
  "Fix this with AI help": "在 AI 帮助下修复",
  "Before it writes anything": "写入任何内容之前",
  "value": "个值",
  "cannot be chosen for you — a wrong one here changes who can reach this firewall.":
    "无法替您选择——选错会改变谁能访问此防火墙。",
  "Exactly what would be written": "将写入的确切内容",
  "— replaces": "——替换",
  "waiting on:": "等待：",
  "Not done from here": "不在此处执行",
  "This device did not confirm the command for": "此设备未确认以下项的命令：",
  ". Apply it anyway.": "。仍然应用。",
  "Asking the AI what this changes…": "正在询问 AI 此更改会带来什么…",
  "Once done —": "完成后——",
  "Confirm and write to": "确认并写入",
  "this firewall": "此防火墙",
  "The firewall took too long to answer — try again.": "防火墙响应超时——请重试。",
  "This takes effect immediately on the live device. Each change is recorded with what it replaced, so it can be put back from here or from the Change Ledger.":
    "此操作会立即在运行中的设备上生效。每项更改都会连同被替换的内容一起记录，因此可以在此处或变更台账中恢复。",
  "Write it": "写入",
  "Write 1 change to this firewall?": "将 1 项更改写入此防火墙？",
  "Put 1 change back?": "恢复 1 项更改？",
  "Each object is restored to the snapshot taken just before it was written, newest first. This is itself a change to the live firewall and is recorded as one.":
    "每个对象都会按从新到旧的顺序恢复到写入前的快照。这本身也是对运行中防火墙的一次更改，同样会被记录。",
  "Restore it": "恢复",
  "Put back": "恢复",
  "Put it back": "恢复原样",
  "change": "项更改",
  "written": "已写入",
  "Every one is in the Change Ledger with what it replaced. Rescan to see the control move.":
    "每一项都已连同被替换的内容记录在变更台账中。重新扫描即可看到控制状态的变化。",

  // -- Configuration Drift: an outside change is either still in place, or undone ------
  "Still in place": "仍然存在",
  "Other firewalls with outside changes still in place:": "其他仍存在控制台之外变更的防火墙：",
  "Undo and Restore are on the matching rows of the change history.":
    "撤销和恢复按钮位于变更历史中对应的条目上。",
  "“Outside the console” does not mean wrong — it means unrecorded. A change stays listed as still in place until it is actually taken back, so an expected one stays on the list too. Undo and Restore are for admins.":
    "“控制台之外”并不代表有错——它代表没有记录。变更会一直显示为仍然存在，直到它真正被撤销，因此预期内的变更也会留在列表中。撤销和恢复仅限管理员使用。",

  // -- Configuration Drift: who made a change the console did not make --------------
  "What the firewall logged": "防火墙记录的内容",
  "Connected from": "连接来源",
  "Values changed": "变更的值",
  "and one more change to it": "并且还有 1 次变更",
  "The firewall's log no longer goes back this far": "防火墙的日志已不再追溯到这个时间",
  "The firewall's log covers this time and names nobody":
    "防火墙的日志覆盖了这段时间，但没有记录任何人",
  "The firewall records every API call as “GUI” as well, so that word means the web interface or a tool — the address is what tells them apart.":
    "防火墙也将每一次 API 调用记录为“GUI”，因此这个词既可能指 Web 界面，也可能指工具——区分它们的是地址。",
  "For a change made outside, the firewall itself is asked who made it — the account, the way in, and the address they came from. It keeps those records in memory only, so an older change says the log no longer goes back that far instead of naming nobody.":
    "对于在控制台之外做出的变更，系统会向防火墙本身查询是谁做的——账号、登录方式以及来源地址。防火墙仅将这些记录保存在内存中，因此较早的变更会显示日志已不再追溯到那个时间，而不是说没有人做过。",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Hits over time": "命中次数随时间变化",
  "Matches per five-minute sample — the device itself keeps no history of these": "每次五分钟采样内的命中次数——设备本身并不保留这些历史",
  "No hits recorded in this window. If the console was restarted recently, history starts from then.": "此时间范围内没有记录到任何命中。如果控制台最近重启过，历史会从那时开始。",

  // -- Security Posture Score (dashboard tile) --------------------------------
  "Security Posture Score": "安全态势评分",
  "Security Posture Score — open Audit / Review": "安全态势评分 — 打开 Audit / Review",
  "Not scanned yet": "尚未扫描",
  "controls assessed": "项控制已评估",
  "Open Audit / Review": "打开 Audit / Review",

  "No channel — go back and pick one": "未选择通道——请返回并选择一个",
  "changes": "处变更",
};
