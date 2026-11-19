/**
 * Chinese — System ▸ SNMP. Mirrors th/snmp.ts entry for entry; see that file for which strings
 * are translated and which are deliberately left in keep.ts.
 *
 * Two renderings carry weight, the same two as in Thai:
 *
 *   "No Authentication" / "No Private"  不验证 / 不加密 — these are security LEVELS being chosen,
 *                                       so the Chinese says what is switched off rather than 无,
 *                                       which reads as "not configured".
 *   "unreadable, not off"               无法读取，而不是已关闭 — the strict read's whole point.
 */

import type { Dict } from "../merge";

export const snmp: Dict = {
  // ── Page and sections ──────────────────────────────────────────────────────
  "SNMP Agent": "SNMP 代理",
  "SNMP agent": "SNMP 代理",
  "SNMP Events": "SNMP 事件",
  "Community": "团体名",
  "Community Name": "团体名称",
  "User Name": "用户名",
  "Hosts": "主机",
  "Queries": "查询",
  "Traps": "陷阱通知",
  "Events": "事件",
  "Security Level": "安全级别",
  "Privacy": "加密",
  "Authentication Algorithm": "认证算法",
  "Private Algorithm": "加密算法",
  "No Authentication": "不验证",
  "No Private": "不加密",
  "Private": "加密",
  "Authentication Private": "认证并加密",
  "v1 Enabled": "启用 v1",
  "v2c Enabled": "启用 v2c",
  "Log space": "日志空间",

  // ── Dialogs ────────────────────────────────────────────────────────────────
  "New SNMP Community": "新建 SNMP 团体名",
  "New SNMP User": "新建 SNMP 用户",
  "Add host": "添加主机",
  "Remove this host": "删除此主机",
  "Accept queries and send traps": "接受查询并发送陷阱",
  "Accept queries only": "仅接受查询",
  "Send traps only": "仅发送陷阱",
  "Community enabled": "启用此团体名",
  "User enabled": "启用此用户",
  "SNMP queries": "SNMP 查询",
  "SNMP traps": "SNMP 陷阱",
  "SNMP v1 queries": "SNMP v1 查询",
  "SNMP v2c queries": "SNMP v2c 查询",
  "SNMP v1 traps": "SNMP v1 陷阱",
  "SNMP v2c traps": "SNMP v2c 陷阱",
  "Leave blank to keep the stored password": "留空则保留已保存的密码",
  "No password is stored yet": "尚未保存密码",

  // ── Nouns, for the state blocks ────────────────────────────────────────────
  "SNMP community": "SNMP 团体名",
  "SNMP user": "SNMP 用户",
  "Create the first SNMP community": "创建第一个 SNMP 团体名",
  "Create the first SNMP user": "创建第一个 SNMP 用户",
  "Edit this community": "编辑此团体名",
  "Delete this community": "删除此团体名",
  "Edit this user": "编辑此用户",
  "Delete this user": "删除此用户",

  // ── Results and prose ──────────────────────────────────────────────────────
  "SNMP agent updated": "已更新 SNMP 代理",
  "SNMP community created": "已创建 SNMP 团体名",
  "SNMP community updated": "已更新 SNMP 团体名",
  "SNMP community deleted": "已删除 SNMP 团体名",
  "SNMP user created": "已创建 SNMP 用户",
  "SNMP user updated": "已更新 SNMP 用户",
  "SNMP user deleted": "已删除 SNMP 用户",
  "Reading the SNMP agent…": "正在读取 SNMP 代理…",
  "Select a device to read its SNMP agent.": "请选择设备以读取其 SNMP 代理设置。",
  "The agent may well be running — this is \"unreadable\", not \"off\".":
    "代理很可能正在运行 — 这是「无法读取」，而不是「已关闭」。",
  "Thresholds the CPU, memory and log-space traps fire at (percent).":
    "CPU、内存与日志空间陷阱触发的阈值（百分比）。",
  ". Any manager polling with that community string stops being answered.":
    "。使用该团体名轮询的任何管理端都将不再得到响应。",
  ", along with its stored credentials.": "，连同其保存的凭据一并删除。",

  // ── Refusals ───────────────────────────────────────────────────────────────
  "A community name is required": "必须填写团体名称",
  "A user name is required": "必须填写用户名",
  "An authentication password is required at this security level":
    "该安全级别必须设置认证密码",
  "A privacy password is required at this security level":
    "该安全级别必须设置加密密码",
  "At least one host is required — a community with no hosts answers any address":
    "至少需要一个主机 — 没有主机的团体名会响应任意地址",
  "Traps are enabled but no notify host is set — add a host or turn traps off":
    "已启用陷阱但未设置通知主机 — 请添加主机或关闭陷阱",

  // ── The 42 event labels ────────────────────────────────────────────────────
  "CPU usage too high": "CPU 使用率过高",
  "Available memory is low": "可用内存不足",
  "Available log space is low": "可用日志空间不足",
  "Interface IP address changed": "接口 IP 地址已变更",
  "VPN tunnel is up": "VPN 隧道已建立",
  "VPN tunnel is down": "VPN 隧道已断开",
  "HA cluster status change": "HA 集群状态变更",
  "HA heartbeat interface failure": "HA 心跳接口故障",
  "IPS detected an attack": "IPS 检测到攻击",
  "IPS detected an anomaly": "IPS 检测到异常",
  "AV detected virus": "AV 检测到病毒",
  "AV detected oversized file": "AV 检测到超大文件",
  "AV detected file matching pattern": "AV 检测到匹配特征的文件",
  "AV detected fragmented file": "AV 检测到分片文件",
  "Interface IP change (FM trap)": "接口 IP 变更（FM 陷阱）",
  "Configuration change (FM trap)": "配置变更（FM 陷阱）",
  "BGP FSM enters the established state": "BGP 状态机进入 established 状态",
  "BGP FSM from a high numbered state to a lower numbered state":
    "BGP 状态机从较高状态回落到较低状态",
  "HA cluster member up": "HA 集群成员上线",
  "HA cluster member down": "HA 集群成员下线",
  "Entity config change (RFC4133)": "设备配置变更（RFC4133）",
  "AV system enters conserve mode": "AV 系统进入保守模式",
  "AV bypass happens": "发生 AV 绕过",
  "AV oversized files passed": "超大文件被 AV 放行",
  "AV oversized files blocked": "超大文件被 AV 阻断",
  "IPS package updated": "IPS 特征库已更新",
  "IPS network buffer is full": "IPS 网络缓冲区已满",
  "Temperature is too high": "温度过高",
  "Voltage is out of range": "电压超出范围",
  "Power supply failure": "电源故障",
  "Disconnected from FortiAnalyzer": "与 FortiAnalyzer 断开连接",
  "AP is up": "AP 已上线",
  "AP is down": "AP 已下线",
  "FortiSwitch controller session is up": "FortiSwitch 控制器会话已建立",
  "FortiSwitch controller session is down": "FortiSwitch 控制器会话已断开",
  "Load balance real-server is down": "负载均衡真实服务器已下线",
  "A new device is found": "发现新设备",
  "Per CPU usage is high": "单核 CPU 使用率过高",
  "DHCP addresses at limit": "DHCP 地址接近上限",
  "IP pool usage is high": "IP 地址池使用率过高",
  "OSPF neighbour state change": "OSPF 邻居状态变更",
  "OSPF virtual neighbour state change": "OSPF 虚拟邻居状态变更",

  // SNMP agent page. SNMP, v1/v2c and v3 are version tokens the device and every NMS print,
  // so they stay as they are inside a Chinese sentence.
  "Access": "访问权限",
  "Delete SNMP community": "删除 SNMP community",
  "Delete SNMP user": "删除 SNMP 用户",
  "Edit SNMP community": "编辑 SNMP community",
  "Edit SNMP user": "编辑 SNMP 用户",
  "New SNMP community": "新建 SNMP community",
  "New SNMP user": "新建 SNMP 用户",
  "SNMP v3 User": "SNMP v3 用户",
  "This SNMP community will be permanently removed from": "此 SNMP community 将被永久删除，来源：",
  "This SNMP user will be permanently removed from": "此 SNMP 用户将被永久删除，来源：",
};
