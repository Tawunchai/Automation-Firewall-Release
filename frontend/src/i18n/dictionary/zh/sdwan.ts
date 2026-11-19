/**
 * Simplified Chinese — SD-WAN: zones, interface members, rules and performance SLAs.
 *
 * "SLA" stays as it is throughout. It is the name of the object on the device (`health-check`, seen
 * as SLA everywhere in the GUI), the rules refer to one by `<name>#<number>`, and no Chinese
 * expansion would still let someone match this screen against `diagnose sys sdwan health-check`.
 *
 * Zone / member / rule are translated (区域 / 成员 / 规则) — those are ordinary nouns here and
 * nothing downstream is keyed on the English.
 */
import type { Dict } from "../merge";

export const sdwan: Dict = {
  // -- Sections --------------------------------------------------------------
  "SD-WAN Zones": "SD-WAN 区域",
  "SD-WAN Rules": "SD-WAN 规则",
  "SD-WAN view": "SD-WAN 视图",
  "All SD-WAN Members": "全部 SD-WAN 成员",
  "Interface members": "接口成员",
  "Performance SLAs": "性能 SLA",
  "performance SLAs": "性能 SLA",
  "performance SLA": "性能 SLA",
  Member: "成员",
  Rule: "规则",
  "The zones, members and rules this FortiGate steers WAN traffic with":
    "此 FortiGate 用于引导 WAN 流量的区域、成员和规则",

  // -- CRUD ------------------------------------------------------------------
  "Edit zone": "编辑区域",
  "Delete zone": "删除区域",
  "Edit member": "编辑成员",
  "Delete member": "删除成员",
  "Edit performance SLA": "编辑性能 SLA",
  "Delete performance SLA": "删除性能 SLA",
  "SD-WAN zone deleted": "SD-WAN 区域已删除",
  "SD-WAN member deleted": "SD-WAN 成员已删除",
  "SD-WAN rule deleted": "SD-WAN 规则已删除",
  "Performance SLA deleted": "性能 SLA 已删除",
  "The device refused the delete": "设备拒绝了该删除操作",
  "Search members": "搜索成员",
  "Filter members": "筛选成员",
  "No performance SLA matches that search": "没有性能 SLA 匹配该搜索条件",
  "No results": "没有结果",
  "No entries": "没有条目",
  "No member chosen yet": "尚未选择成员",
  "Every interface on this device is already an SD-WAN member.":
    "此设备上的每个接口都已经是 SD-WAN 成员。",
  "There are no SD-WAN members on this device yet. Create one first, then it can be moved into a zone.":
    "此设备上还没有 SD-WAN 成员。请先创建一个，然后才能将其移入区域。",
  "These members point at a zone that no longer exists": "这些成员指向的区域已不存在",
  "A member's zone is stored on the member, so unticking one here moves it back to":
    "成员所属区域保存在成员自身上，因此在此取消勾选会把它移回",
  "rather than leaving it without a zone.": "而不是让它没有所属区域。",
  ". An SD-WAN rule that still selects on it will block the delete.":
    "。若仍有 SD-WAN 规则选择了它，删除将被阻止。",
  "will be removed from": "将从以下位置移除：",
  ") will be removed from": ") 将从以下位置移除：",
  "here. Use": "。请使用",
  "No hyphens: the firewall reserves": "不能包含连字符：防火墙保留了",
  ", as its own Default_AWS does.": "，正如其内置的 Default_AWS 一样。",
  "At least one is required, and the firewall will not let the last one be removed.":
    "至少需要一项，且防火墙不允许删除最后一项。",

  // -- Selection strategy ----------------------------------------------------
  "Interface selection strategy": "接口选择策略",
  "Interface preference": "接口优先级",
  "Zone preference": "区域优先级",
  "Outgoing Interfaces": "出接口",
  "Manually assign outgoing members.": "手动指定出向成员。",
  "Load balancing": "负载均衡",
  "Load balance:": "负载均衡：",
  "The member that meets SLA targets is selected. On a tie, the lowest cost wins.":
    "选择满足 SLA 目标的成员。若相同，则开销最低者胜出。",
  "The member with the best measured performance is selected.":
    "选择实测性能最佳的成员。",
  "Traffic is load balanced among members that meet SLA targets.":
    "流量在满足 SLA 目标的成员之间做负载均衡。",
  "Lower wins when several members are equal.": "多个成员相同时，数值较低者胜出。",
  "Quality criteria": "质量标准",
  Criteria: "标准",
  "Required SLA target": "必须满足的 SLA 目标",
  "SLA Target": "SLA 目标",
  "SLA targets": "SLA 目标",
  "Measured SLA": "实测 SLA",
  "Add another SLA target": "再添加一个 SLA 目标",
  "Remove this SLA target": "移除此 SLA 目标",
  "Remove this server": "移除此服务器",
  "This SLA target also selects on MOS": "此 SLA 目标还依据 MOS 进行选择",
  ", which the FortiGate dialog does not expose. It is kept as it is.":
    "，而 FortiGate 的对话框并未展示该项。此处按原样保留。",
  "An SD-WAN rule selects on one of these by number — the pair it stores is <this SLA>#<number>.":
    "SD-WAN 规则通过编号选择其中之一 — 它保存的组合是 <此 SLA>#<编号>。",
  "+ the implicit fallback": "+ 隐式兜底项",
  Implicit: "隐式",

  // -- Health check ----------------------------------------------------------
  "Detect Server": "探测服务器",
  "Check interval": "检测间隔",
  "Failure Threshold": "失败阈值",
  "Recovery Threshold": "恢复阈值",
  "Failures before inactive": "判定为不可用前的失败次数",
  "Restore link after": "恢复链路所需次数",
  "Actions when Inactive": "不可用时的动作",
  "Link Status": "链路状态",
  "Consecutive missed probes before the member is taken out of service.":
    "连续多少次探测无响应后，将该成员移出服务。",
  "Consecutive good probes before the member is used again.":
    "连续多少次探测正常后，重新启用该成员。",
  "The firewall sends its own probes to the server and measures the replies.":
    "防火墙会主动向服务器发送探测包并测量其响应。",
  "Nothing is sent: quality is inferred from the traffic already crossing the member.":
    "不发送任何探测包：质量由已经流经该成员的流量推断得出。",
  "Measure live traffic where there is some, and fall back to active probes where there is not.":
    "有实际流量时按实际流量测量，没有时则退回主动探测。",
  "Passive mode judges the link from traffic that is already flowing, so it has no probe server and no Link Status thresholds — the firewall discards those settings rather than storing them.":
    "被动模式依据已有流量判断链路状态，因此没有探测服务器，也没有链路状态阈值 — 防火墙会丢弃这些设置而不保存。",
  "Withdraw the static routes that leave by a member the moment this check declares it dead, so traffic reroutes instead of being blackholed.":
    "一旦此检测判定某成员失效，立即撤销经由该成员出去的静态路由，使流量改道而不是被黑洞丢弃。",
  "Update static route": "更新静态路由",

  // -- Metrics ---------------------------------------------------------------
  Latency: "时延",
  Jitter: "抖动",
  "Packet Loss": "丢包率",
  Bandwidth: "带宽",
  Upload: "上传",
  Volume: "流量",
  "Active Sessions": "活动会话",
  "Bytes Sent": "已发送字节",
  "Bytes Received": "已接收字节",
  "received,": "已接收，",
  "Hit Count": "命中次数",
  "Last Used": "最后使用",
  Participants: "参与成员",

  // -- Rule matching ---------------------------------------------------------
  "Internet service": "互联网服务",
  "internet services": "互联网服务",
  "Match on internet service instead of a destination address":
    "按互联网服务匹配，而不是按目标地址",
  "Ignored while an internet service is selected — the device stores one or the other.":
    "在选择了互联网服务时此项会被忽略 — 设备只保存其中之一。",
  "Route tag": "路由标记",
  "Forward DSCP": "正向 DSCP",
  "Reverse DSCP": "反向 DSCP",
  "User group": "用户组",
  "user groups": "用户组",
  "· currently in": "· 当前位于",
  "(seq": "（序号",
  "(id": "（id",
  "At most": "最多",
  Optional: "可选",
  None: "无",
  Specify: "手动指定",
  Port: "端口",

  // -- DNS -------------------------------------------------------------------
  "DNS Server": "DNS 服务器",
  "Primary DNS Server": "主 DNS 服务器",
  "Secondary DNS Server": "备用 DNS 服务器",
  "Same as System DNS": "与系统 DNS 相同",
  "(System DNS)": "（系统 DNS）",
  "Leave 0.0.0.0 on an interface that learns its gateway (DHCP or PPPoE).":
    "对于自动学习网关的接口（DHCP 或 PPPoE），请保留 0.0.0.0。",

  // -- Field hints -----------------------------------------------------------
  "e.g. branch-wan": "例如 branch-wan",
  "e.g. 000010": "例如 000010",
  "— the field itself holds two values and the device refuses a third.":
    "— 该字段本身只能容纳两个值，设备会拒绝第三个。",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Auto": "自动",
  "Link down": "链路中断",
  "New Performance SLA": "新建性能 SLA",
  "New Priority Rule": "新建优先级规则",
  "New SD-WAN Member": "新建 SD-WAN 成员",
  "New SD-WAN Zone": "新建 SD-WAN 区域",
  "No entry matches that filter": "没有条目匹配该筛选条件",
  "No member matches that filter": "没有成员匹配该筛选条件",
  "SD-WAN member": "SD-WAN 成员",
  "The device did not report this interface": "设备未报告此接口",
  "The device rejected the change": "设备拒绝了此更改",
  "The device rejected the performance SLA": "设备拒绝了此性能 SLA",
  "The device rejected the rule": "设备拒绝了此规则",
  "There are no SD-WAN members on this device yet": "此设备上还没有 SD-WAN 成员",
  "This firewall reports no per-member session counts.": "此防火墙不报告每个成员的会话数。",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "FortiOS 7.2 does not expose SD-WAN rule hit counters over the REST API": "FortiOS 7.2 不通过 REST API 暴露 SD-WAN 规则命中计数",
  "The firewall reports measurements only while SD-WAN is enabled and probing.": "只有在 SD-WAN 已启用并正在探测时，防火墙才会报告测量值。",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "Enter a name": "请输入名称",
  "The name is limited to 35 characters": "名称最多 35 个字符",
  "An SLA number must be 1-32": "SLA 编号必须在 1-32 之间",
  "An SLA target needs at least one threshold turned on": "SLA 目标至少需要启用一个阈值",
  "Two SLA targets cannot share the same number": "两个 SLA 目标不能使用相同的编号",
  "This strategy needs at least one required SLA target": "此策略至少需要一个必需的 SLA 目标",
  "Best quality needs a measured SLA": "最佳质量模式需要一个可测量的 SLA",
  "A performance SLA name cannot contain a hyphen — the firewall reserves it (try an underscore)": "性能 SLA 名称不能包含连字符 — 防火墙保留了它（请改用下划线）",
  "A server address cannot contain spaces or quotes": "服务器地址不能包含空格或引号",
  "Enter a server to probe, or choose DNS with Same as System DNS": "请填写要探测的服务器，或选择 DNS 并勾选 Same as System DNS",
  "Choose a destination address, or select an internet service": "请选择一个目的地址，或选择一项互联网服务",
  "Choose at least one internet service": "请至少选择一项互联网服务",
  "Choose at least one outgoing interface or zone": "请至少选择一个出向接口或区域",
  "Failures before inactive must be 1-3600": "判定为失效前的失败次数必须在 1-3600 之间",
  "Restore link after must be 1-3600 checks": "恢复链路所需的检查次数必须在 1-3600 之间",
  "The check interval must be 20-3600000 ms": "检查间隔必须在 20-3600000 毫秒之间",
  "The jitter threshold cannot be negative": "抖动阈值不能为负数",
  "The latency threshold cannot be negative": "时延阈值不能为负数",
  "The packet loss threshold must be 0-100%": "丢包率阈值必须在 0-100% 之间",
  "The start port cannot be above the end port": "起始端口不能大于结束端口",
  "Forward DSCP is on but has no tag": "已启用正向 DSCP，但没有填写标记",
  "Reverse DSCP is on but has no tag": "已启用反向 DSCP，但没有填写标记",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Click a member to add or remove its line — up to four at once": "点击成员以添加或移除它的线条——一次最多四条",
  "No samples in this window. The console records these only while SD-WAN is probing, so a firewall with SD-WAN off has nothing to show here.": "此时间范围内没有采样。控制台只在 SD-WAN 正在探测时记录这些值，所以关闭了 SD-WAN 的防火墙在这里没有任何内容。",
  "Out of SLA": "超出 SLA",
  "Over time": "随时间变化",
  "SLA limit": "SLA 上限",
  "Sampled every five minutes and kept for 90 days — the firewall keeps none of this itself": "每五分钟采样一次并保留 90 天——防火墙自身完全不保留这些",
  "Worst": "最差",
  "no limit set": "未设置上限",
};
