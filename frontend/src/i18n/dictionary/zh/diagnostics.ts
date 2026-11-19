/**
 * Simplified Chinese — Session Monitor, the policy trace, Ping, Trace Route and the network-status
 * panel.
 *
 * The policy-trace half of this page argues about why one rule matched and the others did not, and
 * the Chinese keeps that argument's shape: 首个匹配生效 for first-match-wins, and 未被评估 for the
 * rules the walk never reached — which is the whole point of the page, and the one sentence that
 * must not read as "those rules failed".
 */
import type { Dict } from "../merge";

export const diagnostics: Dict = {
  // -- Framing ---------------------------------------------------------------
  "The sessions really flowing through this FortiGate, and which policy a packet would match":
    "真正流经此 FortiGate 的会话，以及报文会匹配到哪条策略",
  "What is actually flowing through right now": "此刻实际正在通过的流量",
  "What the config alone cannot decide": "仅凭配置无法判断的部分",
  "Reads from the device only — it writes no config and uses no AI":
    "只从设备读取 — 不写入配置，也不使用 AI",
  "This runs on the real FortiGate, so it can take a moment":
    "此操作在真实的 FortiGate 上执行，可能需要稍等片刻",
  "The servers the device talks to, and how good the connection is":
    "设备所连接的服务器，以及连接质量如何",
  "DNS · FortiGuard · the route to the internet · link state — read live from the device":
    "DNS · FortiGuard · 通往互联网的路由 · 链路状态 — 实时从设备读取",
  "Could not read this section —": "无法读取此部分 —",
  "on the device…": "在设备上…",
  "The command failed": "命令执行失败",

  // -- Policy trace ----------------------------------------------------------
  "Policy trace": "策略追踪",
  "Trace the path": "追踪路径",
  "Fill in the 5-tuple and press “Trace the path”": "填写五元组后点击“追踪路径”",
  "Enter a source and a destination IP": "请输入源 IP 和目标 IP",
  "It answers which policy the packet matches, and why the others were passed over":
    "它会给出报文匹配到哪条策略，以及其他策略为何被跳过",
  "Which policy this packet would match, and why the others would not":
    "此报文会匹配哪条策略，以及其他策略为何不会匹配",
  "Policy evaluation order (top to bottom · first match wins)":
    "策略匹配顺序（自上而下 · 首个匹配生效）",
  "policies below were never evaluated — one above them matched first. (This is why a rule that “ought to apply” so often does not.)":
    "下面这些策略从未被评估 — 因为上面已有一条先匹配成功。（这正是“本应生效”的规则经常没有生效的原因。）",
  "The whole table was walked and nothing matched — FortiGate drops the packet at the implicit deny":
    "整张策略表已遍历完毕但无一匹配 — FortiGate 会在隐式拒绝处丢弃该报文",
  "No policy matches": "没有策略匹配",
  MATCH: "匹配",
  "Skipped —": "已跳过 —",
  "This policy lets traffic through with": "此策略放行流量，但",
  "no security profile inspecting it": "没有任何安全配置文件对其进行检测",
  "Inspected by:": "检测方式：",
  "Traffic that has passed through this policy": "已经通过此策略的流量",

  // -- Session table ---------------------------------------------------------
  "Live sessions": "实时会话",
  "active sessions": "个活动会话",
  "Total sessions": "会话总数",
  Session: "会话",
  "Source → Destination": "源 → 目标",
  "Source IP": "源 IP",
  "Source IP (optional)": "源 IP（可选）",
  "Destination IP": "目标 IP",
  "Destination port": "目标端口",
  "Destination Port": "目标端口",
  "Incoming Interface": "入接口",
  Egress: "出向",
  Proto: "协议",
  State: "状态",
  Age: "存活时长",
  "source NAT": "源 NAT",
  "NPU offload": "NPU 卸载",
  "Sessions offloaded to hardware": "已卸载到硬件处理的会话",
  "RX / TX": "接收 / 发送",
  "TX / RX": "发送 / 接收",
  "in:": "入：",
  "out:": "出：",
  Allowed: "已放行",
  "Blocked by a policy": "被某条策略阻断",
  "A session the device created itself (local) — no policy involved":
    "设备自身发起的会话（本地）— 不涉及任何策略",
  Filters: "筛选条件",
  "Filter:": "筛选：",
  Shown: "已显示",
  View: "查看",
  "Leave everything blank to see every session · filtering happens on the device, not in the browser":
    "全部留空可查看所有会话 · 筛选在设备上完成，而不是在浏览器中",
  "The device has more sessions than are shown — this list was truncated, so narrow it with the filters":
    "设备上的会话数多于此处所示 — 该列表已被截断，请用筛选条件缩小范围",

  // -- Ping and traceroute ---------------------------------------------------
  "Host or IP": "主机或 IP",
  "8.8.8.8 or www.google.com": "8.8.8.8 或 www.google.com",
  "A domain name works too — the resolved IP is shown as well":
    "也可以填域名 — 解析出的 IP 也会一并显示",
  "(the device resolved this name)": "（该名称由设备解析）",
  "ICMP sent from the FortiGate itself, live — not from this web server":
    "ICMP 由 FortiGate 自身实时发出 — 而不是从这台 Web 服务器发出",
  "The path this FortiGate takes to a destination — hops appear one by one, live":
    "此 FortiGate 通往目标的路径 — 每一跳会实时逐个出现",
  "A traceroute takes a while (up to 32 hops × 3 probes) — hops appear as the device finds them":
    "路由跟踪需要一些时间（最多 32 跳 × 3 次探测）— 设备每找到一跳就会显示一跳",
  "Looking for the next hop…": "正在查找下一跳…",
  "No hops came back — see the raw output below": "没有任何一跳返回 — 请看下面的原始输出",
  "No reply (* * *)": "无响应（* * *）",
  "The device finished, but": "设备已执行完毕，但",
  "not one packet came back": "没有一个报文返回",
  "— the destination may not answer ICMP, a policy may be blocking it, or there is no route to it":
    "— 可能目标不响应 ICMP，可能有策略在阻断，也可能根本没有通往它的路由",
  "Automatic (from the routing table)": "自动（依据路由表）",
  "Leave blank and the device chooses": "留空则由设备自行选择",
  Packets: "报文",
  "Packet loss": "丢包",
  Loss: "丢包",
  "Sent / received": "发送 / 接收",
  "Size (bytes)": "大小（字节）",
  "Min / max": "最小 / 最大",
  Average: "平均",
  Errors: "错误",
  "timeout ×": "超时 ×",
  "(not used for ICMP)": "（ICMP 不使用此项）",
  "e.g. 10.0.99.201": "例如 10.0.99.201",
  "e.g. 192.168.1.50": "例如 192.168.1.50",
  "e.g. 8.8.8.8": "例如 8.8.8.8",
  "e.g. 443": "例如 443",

  // -- Network status --------------------------------------------------------
  Link: "链路",
  Speed: "速率",
  Configured: "已配置",
  DISABLED: "已禁用",
  "Receiving live": "正在实时接收",
  "FortiGuard DNS filter": "FortiGuard DNS 过滤",
  "Route to the internet": "通往互联网的路由",
  "Route used": "使用的路由",
  "Has a route out": "存在出向路由",
  "No route": "没有路由",
  "(route": "（路由",
  "→ gw": "→ 网关",
  "The device found no route to the internet": "设备找不到通往互联网的路由",
  "Latency measured by the device": "设备实测的时延",
  "Not measured": "未测量",
  "The device has never measured this successfully": "设备从未成功测量过此项",
  The: "该",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Chosen by you": "由您选择",
  "Could not open the connection": "无法打开连接",
  "Could not read the session table": "无法读取会话表",
  "Counting while packets are still going out": "在数据包仍在发送时统计",
  "No per-packet detail — see the raw output below": "没有逐包详情 — 请查看下方的原始输出",
  "No session on the device matches this filter": "设备上没有会话匹配此筛选条件",
  "Pinging…": "正在 Ping…",
  "Reading…": "正在读取…",
  "Show sessions": "显示会话",
  "Taken from the device's routing table": "取自设备的路由表",
  "The device has no readable session right now": "此刻设备上没有可读取的会话",
  "The trace failed": "路由跟踪失败",
  "Trace": "跟踪",
  "Tracing…": "正在跟踪…",
  "Waiting for the first packet from the device…": "正在等待设备的第一个数据包…",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Use a different account": "使用其他账号",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "The device may well be fine — this page says \"unreadable\", not \"broken\"": "设备很可能一切正常 — 本页说的是\"读不到\"，不是\"坏了\"。",

  // -- Troubleshooting (was Session Monitor) -----------------------------------
  "Add a route to the destination": "添加到目标的路由",
  "Address translation": "地址转换",
  "Check the security profiles on the policy in the log (a Web Filter or Application Control block shows there), that the destination is listening on that port, and that the far side can route back.": "在日志中检查策略上的安全配置文件（Web Filter 或 Application Control 的阻止会显示在那里），确认目标在该端口上监听，并确认对端有回程路由。",
  "Click a policy to see each criterion, what it lists, and what the packet had.": "点击某条策略，查看每个条件、策略所列的值以及数据包的值。",
  "closest": "最接近",
  "Confirm with the log": "用日志确认",
  "Copied": "已复制",
  "Copy the CLI": "复制 CLI",
  "Create a policy": "创建策略",
  "Destination address": "目标地址",
  "Diagnosis, step by step": "逐步诊断",
  "enable the policy": "启用该策略",
  "Every policy checked (top to bottom · first match wins)": "已检查的每条策略（自上而下 · 首个匹配生效）",
  "Fill in a source, a destination and a service, then press “Trace the path”": "填写源、目标和服务，然后点击“Trace the path”",
  "Firewall policy": "防火墙策略",
  "from route": "来自路由",
  "How to fix it": "如何修复",
  "If it still does not work": "如果仍然不通",
  "In": "入",
  "Incoming interface": "入接口",
  "Inspection": "检测",
  "Interface links": "接口链路",
  "Intrusion Prevention": "入侵防御",
  "link down": "链路断开",
  "link up": "链路正常",
  "make its schedule include the current time": "让其计划表包含当前时间",
  "match": "匹配",
  "never reached": "从未到达",
  "No NAT": "无 NAT",
  "no policy matched": "没有匹配的策略",
  "No policy matches — blocked": "没有匹配的策略——被阻止",
  "No route to the destination": "没有到目标的路由",
  "no security profile": "无安全配置文件",
  "No security profile inspects this traffic. It is allowed through without antivirus, web filtering or IPS.": "没有安全配置文件检测此流量。它在没有防病毒、Web 过滤或 IPS 的情况下被放行。",
  "not inspected": "未检测",
  "not reached": "未到达",
  "not used for ICMP": "ICMP 不使用",
  "Open Firewall Policy": "打开防火墙策略",
  "Open Static Routes": "打开静态路由",
  "Or add a policy for this traffic": "或为此流量添加策略",
  "Order": "顺序",
  "Out": "出",
  "Outgoing interface": "出接口",
  "Reads from the device only — writes nothing, uses no AI": "仅从设备读取——不写入任何内容，不使用 AI",
  "Recent:": "最近：",
  "Replay": "重播",
  "Reverse direction": "反向",
  "Route back to the source": "回到源的路由",
  "Route to the destination": "到目标的路由",
  "Routing": "路由",
  "Rule order": "规则顺序",
  "Run this trace again": "再次运行此追踪",
  "Security inspection": "安全检测",
  "security profiles": "安全配置文件",
  "See the real log entries": "查看真实日志条目",
  "Service:": "服务：",
  "Source NAT": "源 NAT",
  "The firewall allows it — if it still fails, look beyond this policy": "防火墙已允许——如果仍然失败，请排查此策略之外的原因",
  "the incoming interface": "入接口",
  "The link state of the interfaces could not be read.": "无法读取接口的链路状态。",
  "The packet reaches the destination": "数据包到达目标",
  "The traffic log shows what the firewall actually did with these connections.": "流量日志显示防火墙实际如何处理这些连接。",
  "Trace the reply direction: destination back to source": "追踪回复方向：从目标回到源",
  "Traffic on this policy": "此策略上的流量",
  "Troubleshooting": "故障排查",
  "What the configuration alone cannot decide": "仅凭配置无法判断的内容",
  "Why can't A reach B? Trace one connection through the FortiGate: its route, the policy that decides it, NAT, inspection — and how to fix it": "为什么 A 访问不了 B？追踪一条连接穿过 FortiGate 的过程：路由、决定它的策略、NAT、检测——以及如何修复",
  "You will see the route the packet takes, the policy that decides it and why every policy above it was passed over, what NAT does, whether anything inspects it — and what to change if it is blocked.": "您将看到数据包经过的路由、决定它的策略以及其上每条策略被跳过的原因、NAT 做了什么、是否有检测——以及被阻止时需要修改什么。",
  "chosen": "手动选择",
  "reached": "已到达",
  "the policy is disabled": "该策略已禁用",
  "the policy is enabled": "该策略已启用",
  "the ingress interface is unknown, so srcintf was not checked": "入接口未知，因此未检查 srcintf",
  "Worth knowing about this trace": "关于此次追踪的注意事项",

  // The packet-flow diagram's header row — what the packet carries on each wire.
  "Original packet": "原始数据包",
  "After NAT": "NAT 之后",
  "Leaves unchanged": "原样发出",

  // Fix it — the what-if, apply and undo around a trace's plans.
  "Fix it": "一键修复",
  "Preview this fix": "预览此修复",
  "Add a policy for exactly this connection": "为此连接单独添加一条策略",
  "A new policy for exactly this connection": "专为此连接新建的策略",
  "New policy": "新策略",
  "What if": "假如",
  "Simulated — nothing written yet": "模拟结果——尚未写入任何内容",
  "Close the preview": "关闭预览",
  "Blocked now": "当前被阻止",
  "Allowed after the fix": "修复后允许",
  "Still blocked": "仍被阻止",
  "What will be written": "将写入的内容",
  "What the policy will accept": "该策略将放行的内容",
  "Show the CLI": "显示 CLI",
  "Hide the CLI": "隐藏 CLI",
  "Only this connection is opened — nothing else.": "只放行此连接——不放行其他任何流量。",
  "This policy accepts much more than this one connection — every source, destination and service it lists above, not only this trace. Prefer the new-policy fix unless opening all of that is intended.":
    "该策略放行的远不止这一个连接——上面列出的所有源、目标和服务都会放行，而不仅是这次追踪。除非确实打算放开这些，否则请优先选择新建策略的修复。",
  "Apply to the firewall": "应用到防火墙",
  "Written to the live rule base and recorded in Change history — one click undoes it.":
    "写入正在运行的规则库并记录在变更历史中——一键即可撤销。",
  "Only an administrator can apply a fix. The CLI above can be handed to one.":
    "只有管理员可以应用修复。可以把上面的 CLI 交给管理员。",
  "Apply this fix to the firewall?": "将此修复应用到防火墙？",
  "Fix applied — the trace is now read back from the firewall": "修复已应用——现在的追踪结果读取自防火墙",
  "The fix is on the firewall": "修复已写入防火墙",
  "The fix stopped part-way": "修复中途停止",
  "The trace below was read back from the firewall after the change, not simulated.":
    "下方的追踪结果是在更改后从防火墙读回的，并非模拟。",
  "A step failed, so nothing after it was written. What landed before it is listed — undo it, or finish by hand.":
    "某个步骤失败，其后的内容均未写入。之前已写入的内容列在下方——可以撤销，或手动完成。",
  "already there, left as it was": "已存在，保持不变",
  "Undo this fix": "撤销此修复",
  "Undo this fix?": "撤销此修复？",
  "Everything it wrote is put back, newest first. The trace runs again afterwards.":
    "它写入的所有内容都会按从新到旧的顺序恢复，之后会重新追踪。",
  "Undone — the firewall is back as it was": "已撤销——防火墙已恢复原状",
  "Could not simulate this fix": "无法模拟此修复",
  "The fix could not be applied": "无法应用此修复",
  "The fix could not be undone": "无法撤销此修复",

  // A host name as the destination.
  "Destination IP or host name": "目标 IP 或主机名",
  "8.8.8.8 or example.com": "8.8.8.8 或 example.com",
  "Enter a source IP and a destination": "请输入源 IP 和目标",
  "Resolved by this console's DNS. The FortiGate may get a different address — a CDN answers each resolver by location.":
    "由本控制台的 DNS 解析。FortiGate 可能得到不同的地址——CDN 会按位置向不同的解析器返回不同结果。",

  // Troubleshooting tabs (Ping merged in) + Trace Route enrichments (verdict / latency / segments).
  "Diagnostics tool": "诊断工具",
  "Why can't A reach B?": "为什么 A 无法访问 B？",
  "Networks crossed": "经过的网络",
  "Latency by hop": "各跳延迟",
  "Round-trip latency by hop": "各跳往返延迟",
  "Segments are grouped by address kind. Install a GeoLite2 database on the server to label the public stretches by their network owner (AS number and organisation) and country.":
    "分段按地址类型分组。在服务器上安装 GeoLite2 数据库，即可按网络所有者（AS 号与组织）和国家/地区标注公网段。",
  // Path-segment zone labels (from traceroute-model zoneLabelForKind).
  "Public internet": "公共互联网",
  "Private network": "私有网络",
  "Carrier-grade NAT": "运营商级 NAT",
  "Loopback": "环回",
  "Link-local": "链路本地",
  "Multicast": "组播",
  "Unspecified": "未指定",
  "No reply": "无响应",

  // Trace Route's hop-detail strip: what kind of address a hop is, and the verdict sentences.
  // RFC 1918 / 100.64.0.0/10 stay as written — they are the citation, not prose.
  "A public hop out on the internet — it matches none of this device's own networks.":
    "互联网上的公网跳点——它不属于本设备的任何网络。",
  "Carrier-grade NAT (100.64.0.0/10)": "运营商级 NAT（100.64.0.0/10）",
  "Matches none of this device's interfaces, routes, or the fleet.": "与本设备的接口、路由以及机群中的任何设备都不匹配。",
  "No hop answered": "没有任何跳点响应",
  "Not even the first hop replied. The device may have no route toward this destination, or the source address given is not one it owns — try leaving Source IP blank, or use the Ping tab.":
    "连第一跳都没有响应。设备可能没有通往该目的地的路由，或者填写的源地址并不属于它——试试把 Source IP 留空，或改用 Ping 标签页。",
  "Ping this hop": "Ping 这一跳",
  "Private (RFC 1918)": "私有网络（RFC 1918）",
  "Public — routable on the internet": "公网——可在互联网上路由",
  "the destination": "目的地",
  "The destination is on the path, though it did not time a round trip on this probe.":
    "目的地就在这条路径上，只是本次探测没有测到往返时间。",
  "Unspecified address": "未指定地址",
};
