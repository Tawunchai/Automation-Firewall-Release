/**
 * Simplified Chinese — Firewall Policy, Services, Schedules, Virtual IPs, Static Routes and
 * Interfaces.
 *
 * This is the part of the console that sits closest to the CLI, and the vocabulary follows
 * Fortinet's own Chinese GUI: 源地址 for source address, 目标 for destination, 出接口 for outgoing
 * interface, 虚拟 IP for VIP. Table headers stay short in Chinese for the same reason they are
 * shouted in English — they sit in a fixed-width column.
 *
 * The short column codes AV / IPS / APP / WEB / FILE / SSL are the security-profile columns of the
 * policy table. They are FortiOS abbreviations and stay as they are; see ../keep.ts.
 */
import type { Dict } from "../merge";

export const policy: Dict = {
  // -- Policy list -----------------------------------------------------------
  "New Policy": "新建策略",
  "Edit policy": "编辑策略",
  "Edit Policy": "编辑策略",
  "Delete policy": "删除策略",
  "Delete Policy?": "要删除此策略吗？",
  "Policy deleted": "策略已删除",
  "Create the first policy": "创建第一条策略",
  "This device has no firewall policy yet": "此设备上还没有防火墙策略",
  "Policy not found on this device": "在此设备上未找到该策略",
  "Failed to create policy": "创建策略失败",
  "Failed to update policy": "更新策略失败",
  "Failed to delete policy": "删除策略失败",
  "Failed to move policy": "移动策略失败",
  "Failed to toggle policy": "切换策略状态失败",
  "Enable this policy": "启用此策略",
  "✓ ACCEPT": "✓ 允许",
  "⊘ DENY": "⊘ 拒绝",
  Accept: "允许",
  Deny: "拒绝",
  Policies: "策略",
  "Order matters — top to bottom, the first rule that matches wins":
    "顺序很重要 — 从上到下，第一条匹配的规则生效",
  DESTINATION: "目标",
  "GATEWAY IP": "网关 IP",
  "Gateway IP": "网关 IP",
  "Where this firewall sends traffic it has no connected route for.":
    "没有直连路由的流量，这台防火墙会发往哪里。",
  "HIT COUNT": "命中次数",
  COMMENTS: "备注",
  PROTOCOL: "协议",
  PROT: "协议",
  MEMBERS: "成员",
  ADDRESS: "地址",
  "ADDRESS GROUP": "地址组",
  "SERVICE GROUP": "服务组",
  CATEGORY: "类别",
  Ref: "引用",
  Log: "日志",
  "Log Allowed Traffic": "记录放行流量",
  "Log violation traffic": "记录违规流量",
  "Security Events": "安全事件",
  "All Sessions": "所有会话",
  "At position": "位于位置",
  "Index (order)": "序号（顺序）",
  "1 = top": "1 = 最顶端",
  "Drag to reorder within this interface pair": "在此接口对内拖动可重新排序",
  "Rules match top-to-bottom (first match wins). Bottom is FortiGate's default for a new policy.":
    "规则自上而下匹配（首个匹配生效）。FortiGate 新建策略时默认放在最底部。",
  "Reordering applies to new policies. Use the Firewall Policy page to drag an existing policy to a new position.":
    "此排序仅对新策略生效。若要移动已有策略，请到“防火墙策略”页面拖动。",
  "A security profile is enabled — SSL Inspection must be at least certificate-inspection.":
    "已启用安全配置文件 — SSL 检查至少须为 certificate-inspection。",
  "Traffic matching this policy will be decrypted for inspection":
    "匹配此策略的流量将被解密以供检查",
  "SSL Inspection": "SSL 检查",
  "Decrypted Traffic Mirror": "解密流量镜像",
  "Protocol options": "协议选项",
  "Source address": "源地址",
  "Source IP / range / subnet": "源 IP / 范围 / 子网",
  "Source Port": "源端口",
  "Specify Source Ports": "指定源端口",
  "Manage source port": "管理源端口",
  "Preserve Source Port": "保留源端口",
  "Fixed Port": "固定端口",
  "Outgoing Interface": "出接口",
  "Use Outgoing Interface Address": "使用出接口地址",
  "Use Dynamic IP Pool": "使用动态 IP 池",
  "IP pool configuration": "IP 池配置",
  "Select IP pool…": "选择 IP 池…",
  "Optional Filters": "可选筛选条件",
  "Advanced Options": "高级选项",
  "Additional Information": "附加信息",
  "Edit in CLI": "在 CLI 中编辑",

  // -- Services --------------------------------------------------------------
  "New Service": "新建服务",
  "Create Service": "创建服务",
  "Edit Service": "编辑服务",
  "Service deleted": "服务已删除",
  "Failed to create service": "创建服务失败",
  "Failed to update service": "更新服务失败",
  "Failed to delete service": "删除服务失败",
  "Loading service…": "正在加载服务…",
  "Service not found — it may have been deleted.": "未找到该服务 — 可能已被删除。",
  "No service found": "未找到服务",
  "No more services": "没有更多服务了",
  "Select services": "选择服务",
  "Search services…": "搜索服务…",
  "Protocol Type": "协议类型",
  "Protocol Number": "协议号",
  "ICMP Type": "ICMP 类型",
  "ICMP Code": "ICMP 代码",
  "Name can't be changed when editing an existing service.":
    "编辑已有服务时无法更改名称。",
  "Type can't be changed after creation": "创建后无法更改类型",
  "e.g. CUSTOM-HTTP": "例如 CUSTOM-HTTP",
  "e.g. 50=ESP, 51=AH, 89=OSPF": "例如 50=ESP、51=AH、89=OSPF",
  "e.g. 80 (single) · 8080-8090 (range) · multiple rows for multiple ports":
    "例如 80（单个）· 8080-8090（范围）· 多个端口请添加多行",
  "1 to 65535": "1 到 65535",
  "(-1 = any)": "（-1 = 任意）",

  // -- Virtual IPs -----------------------------------------------------------
  "Create the first Virtual IP": "创建第一个虚拟 IP",
  "Loading virtual IP…": "正在加载虚拟 IP…",
  "Failed to delete virtual IP": "删除虚拟 IP 失败",
  "VIP type": "VIP 类型",
  "External IP address/range": "外部 IP 地址/范围",
  "External FQDN address": "外部 FQDN 地址",
  "External service port": "外部服务端口",
  "Port Forwarding": "端口转发",
  "Port Mapping Type": "端口映射类型",
  "Mapped address": "映射后的地址",
  "MAPPED FROM": "映射自",
  "MAPPED TO": "映射到",
  "Mapped From": "映射自",
  "Mapped To": "映射到",
  "Destination NAT: an address on the firewall that stands in for a server behind it.":
    "目的地址转换（DNAT）：防火墙上的一个地址，代表它后面的服务器。",
  "Map to": "映射到",
  "Map to IPv4 port": "映射到 IPv4 端口",
  "Select an FQDN address…": "选择一个 FQDN 地址…",
  "e.g. Web_Server_VIP": "例如 Web_Server_VIP",

  // -- Static routes ---------------------------------------------------------
  "New Static Route": "新建静态路由",
  "Static Routing": "静态路由",
  "Static route deleted": "静态路由已删除",
  "Failed to create route": "创建路由失败",
  "Failed to update route": "更新路由失败",
  "Failed to delete route": "删除路由失败",
  "Loading route…": "正在加载路由…",
  "Route not found — go back to the list.": "未找到该路由 — 请返回列表。",
  "Route to": "路由至",
  "Gateway Address": "网关地址",
  "Administrative Distance": "管理距离",
  "Search routes…": "搜索路由…",
  "Starting IPv4 address": "起始 IPv4 地址",
  "IPv4 address/range": "IPv4 地址/范围",
  "Internet Service (": "互联网服务（",
  "Select Internet Service…": "选择互联网服务…",
  "Search internet service…": "搜索互联网服务…",
  "CIDR (10.0.0.0/24) or IP/mask (10.0.0.0/255.255.255.0)":
    "CIDR（10.0.0.0/24）或 IP/掩码（10.0.0.0/255.255.255.0）",

  // -- Schedules -------------------------------------------------------------
  "Schedule created": "计划表已创建",
  "Schedule updated": "计划表已更新",
  "Schedule deleted": "计划表已删除",
  "Failed to load schedule": "加载计划表失败",
  "Failed to save schedule": "保存计划表失败",
  "Failed to delete schedule": "删除计划表失败",
  "No other schedules available to add.": "没有其他可添加的计划表。",
  "Number of days before": "提前天数",

  // -- Interfaces ------------------------------------------------------------
  "ADMINISTRATIVE ACCESS": "管理访问",
  "Select interface…": "选择接口…",
  "Search interfaces…": "搜索接口…",
  "By role": "按角色",
  "Down / disabled": "未连接 / 已停用",

  // -- Shared form / picker chrome ------------------------------------------
  Back: "返回",
  OK: "确定",
  "Create new": "新建",
  "Create New": "新建",
  "Copied!": "已复制！",
  "More…": "更多…",
  "Search…": "搜索…",
  "No match": "无匹配项",
  "No matches": "无匹配项",
  "No options found": "未找到选项",
  "No options — nothing returned by the device": "没有选项 — 设备没有返回任何内容",
  "Showing first 200 — type to search all": "仅显示前 200 条 — 输入内容可搜索全部",
  "No device — go back and select a device": "没有设备 — 请返回并选择一台设备",
  "Type a command…": "输入命令…",
  "Type a command and press Enter…": "输入命令后按回车…",
  "· firewall policy · ESC close": "· firewall policy · 按 ESC 关闭",
  "· firewall service custom · ESC close": "· firewall service custom · 按 ESC 关闭",
  "⚠ Used by": "⚠ 被以下项使用",
  "⚠ Used in": "⚠ 使用于",
  "⚠ Referenced by": "⚠ 被以下项引用",
  "will be permanently removed": "将被永久删除",
  ") will be permanently removed from": ") 将被永久地从以下位置移除",
  "object(s) — FortiGate will refuse if it's still referenced.":
    "个对象 — 若仍被引用，FortiGate 会拒绝该操作。",
  "policy(ies) — the device will refuse to delete it until those are removed.":
    "条策略 — 在移除这些引用之前，设备会拒绝删除。",

  // -- Help panel ------------------------------------------------------------
  "Relevant Documentation": "相关文档",
  "Online Guides": "在线指南",
  "Video Tutorials": "视频教程",
  "Fortinet Community": "Fortinet 社区",
  "Join the Discussion": "参与讨论",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "By Sequence": "按序号",
  "Could not load firewall policies from the device": "无法从设备加载防火墙策略",
  "EDIT": "编辑",
  "Interface Pair": "接口对",
  "IPv4 Static NAT": "IPv4 静态 NAT",
  "Many to many": "多对多",
  "Monday": "星期一",
  "Tuesday": "星期二",
  "Wednesday": "星期三",
  "Thursday": "星期四",
  "Friday": "星期五",
  "Saturday": "星期六",
  "Sunday": "星期日",
  "New Virtual IP": "新建虚拟 IP",
  "One time": "一次性",
  "One to one": "一对一",
  "schedule group": "计划组",
  "Schedule Group": "计划组",
  "Schedule Groups": "计划组",
  "Select…": "选择…",
  "Static NAT": "静态 NAT",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Error: Failed to fetch configuration": "错误：获取配置失败",

  // -- The Log column of the policy table: FortiOS logtraffic is all / utm / disable, and 'all' was already translated by the shared word list — leaving the other two English made one column read half-Thai ---
  "disable": "禁用",
  "utm": "仅 UTM",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "The device may well still be enforcing policies — this list is 'unreadable', not 'empty'": "设备很可能仍在执行策略 — 这份列表是\"读不到\"，不是\"空的\"。",

  // -- Report kinds and revert reasons — served by the Go backend, so the extractor never sees them ---
  "Web Proxy": "Web 代理",
  "VoIP, Messaging & Other Applications": "VoIP、消息与其他应用",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Decrypted traffic mirror": "解密流量镜像",
  "Enable security profiles": "启用安全配置文件",
  "Log allowed traffic": "记录放行的流量",
  "No samples for this rule yet": "尚无此规则的采样",
  "No traffic matched this rule in the last 24 hours": "过去 24 小时内没有流量匹配此规则",
  "Preserve source port": "保留源端口",
  "SSL inspection profile": "SSL 检测配置文件",
  "Source port handling": "源端口处理",
  "Traffic 24h": "流量（24 小时）",
  "Specify source ports": "指定源端口",
  "Measured from the device's own byte counters every five minutes — it keeps no history of these itself": "每五分钟从设备自身的字节计数器测量一次——设备本身并不保留这些历史",
  "No samples in this window yet. Ports with no link that have never carried a byte are not recorded at all, so a box with nothing plugged in stays empty here.": "此时间范围内还没有采样。没有链路且从未传输过任何字节的端口完全不会被记录，所以一台没有插任何线的设备在这里是空的。",
  "Not enough samples yet — a rate needs two readings, so the first one draws nothing": "采样还不够——速率需要两次读数，所以第一次读数画不出任何东西",
  "Peak": "峰值",
  "Received": "接收",
  "Throughput": "吞吐量",
  "Transmitted": "发送",
  "Route status": "路由状态",
  "Enable port forwarding": "启用端口转发",
  "Filter by service": "按服务筛选",
  "Filter by source address": "按源地址筛选",
  "Use optional filters": "使用可选筛选条件",
  "Virtual IP type": "虚拟 IP 类型",

  // -- Impact Preview (create/edit form button + its dialog) ------------------
  "Preview Impact": "预览影响",
  "Replay recent real traffic through this change before saving it": "保存前，用最近的真实流量重放这项变更",
  "Impact Preview — recent real traffic, replayed": "影响预览 —— 基于最近真实流量重放",
  "Replaying recent sessions against this change…": "正在用最近的会话重放这项变更……",
  "Could not preview the impact of this change": "无法预览这项变更的影响",
  "Replayed": "已重放",
  "real session": "个真实会话",
  "from this firewall's own recent traffic log against the policy table as it is now and as this change would leave it. Nothing was written to the device.":
    "来自这台防火墙自身最近的流量日志，分别对照当前的策略表和这项变更后的策略表进行比对。没有向设备写入任何内容。",
  "Sessions affected": "受影响的会话",
  "Newly allowed": "新变为允许",
  "Newly blocked": "新变为阻止",
  "None of the recently-seen traffic this firewall has handled would be affected by this change.":
    "这台防火墙最近处理过的流量中，没有一个会受到这项变更的影响。",
  "showing": "显示",
  "affected sessions": "个受影响的会话",

  "DHCP RANGES": "DHCP 地址范围",
  "Delete static route": "删除静态路由",
  "Route #": "路由 #",
};
