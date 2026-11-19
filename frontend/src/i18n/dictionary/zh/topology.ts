/**
 * 简体中文 — Network ▸ Topology and the Firewall Policy matrix.
 *
 * As in the Thai file: the level names keep the clause that makes them a finding. A cell that
 * reads only "允许" would hide the half the grid exists to show.
 */
import type { Dict } from "../merge";

export const topology: Dict = {
  "Topology": "拓扑图",
  "topology": "拓扑图",
  "Matrix": "矩阵",
  "Paths": "路径",
  "Permitted paths": "允许的路径",
  "Source → destination": "源 → 目的",
  "Show all": "显示全部",
  "IPsec tunnels": "IPsec 隧道",

  "permitted": "允许",
  "permitted, inspected": "允许，且有检测",
  "permitted, not inspected": "允许，但没有任何检测",
  "permitted, nothing inspecting it": "允许，但没有任何东西在检测它",
  "deny only": "只有拒绝规则",
  "no rule": "没有规则",
  "all inspected": "全部路径都有检测",
  // The legend's own label for the amber path, standing on its own line.
  "nothing inspecting it": "没有任何检测",

  ", NAT": "，NAT",
  "· no inspection": "· 无检测",
  "· intra-zone allowed": "· 允许区域内互通",
  "· measured": "· 实测到流量",

  "up / total": "在线 / 总数",
  "up / configured": "在线 / 已配置",
  "policies name ports directly": "策略直接引用端口",

  // Stage KPI captions, and the port states the screen-reader list reads out. Every one of these
  // sits in a tile caption or on a canvas label, so the Chinese stays as short as the English.
  "all up": "全部在线",
  "no default route": "没有默认路由",
  "no tunnels configured": "未配置隧道",
  "nothing configured": "未配置",

  "Hover a cell to read it. Click one to filter the table below to just those rules.":
    "把指针放到格子上可以读出它的含义；点击可把下面的表格筛选成这些规则。",
  "No enabled rule names an interface pair, so there is nothing to grid.":
    "没有任何已启用的规则引用接口对，所以还没有可以排成矩阵的内容。",
  "Without them there is nothing to draw — this is 'unreadable', not 'a firewall with no ports'":
    "没有接口就没有可画的东西 —— 这是“读不到”，不是“一台没有端口的防火墙”",
  "moving dots = measured traffic on that path": "移动的光点 = 该路径上实测到的流量",
  "Link state could not be read from this device — the ports below show how they are CONFIGURED, not whether a cable is in them.":
    "无法从这台设备读取链路状态 —— 下面的端口显示的是它们被“配置”成什么样，而不是里面是否插着网线。",
  "This browser can't render the 3D topology": "此浏览器无法渲染 3D 拓扑图",
  "Try a different browser, or enable hardware acceleration in this one.":
    "请换一个浏览器，或在当前浏览器中启用硬件加速。",

  // ── Add Device: the user's own pinned devices the firewall pings ──────────────
  "My devices": "我的设备",
  "Pinged from this firewall, drawn on the map": "由此防火墙 ping，绘制在拓扑图上",
  "Confirming live status…": "正在确认最新状态…",
  "Add device": "添加设备",
  "Edit device": "编辑设备",
  "No pinned devices yet": "尚未固定任何设备",
  "Add a switch, access point or server by its IP, and the firewall will ping it on the schedule you set — its status then shows on the 3D map.":
    "通过 IP 添加交换机、接入点或服务器，防火墙会按你设定的周期 ping 它——其状态随后显示在 3D 拓扑图上。",
  "checks paused": "已暂停检测",
  "not checked yet": "尚未检测",
  "The firewall pings this address to tell whether the device is up.":
    "防火墙 ping 此地址以判断设备是否在线。",
  "Check this device on a schedule": "按计划检测此设备",
  "When off, the device still shows on the map but the firewall stops pinging it.":
    "关闭后，设备仍显示在拓扑图上，但防火墙会停止 ping 它。",
  "This only removes the pin from your map and stops the firewall pinging it. The device itself is not touched.":
    "此操作仅从拓扑图移除该固定项并停止防火墙 ping，不会影响设备本身。",

  // Form fields and the device-kind labels (the kind picks the 3D glyph).
  "Device type": "设备类型",
  "Ping check": "Ping 检测周期",
  "Switch": "交换机",
  "Router": "路由器",
  "Endpoint": "终端",
  "Access Point": "接入点",
  "Other": "其他",
  "Core Switch": "核心交换机",
  "Optional — where it is, what it does": "可选——它在哪里、做什么",
  "Every 30 seconds": "每 30 秒",
  "Every 2 minutes": "每 2 分钟",
  "Every 10 minutes": "每 10 分钟",
  "Every 30 minutes": "每 30 分钟",

  // Toasts.
  "Give the device a name": "给设备起个名称",
  "Enter a valid IP address": "请输入有效的 IP 地址",
  "Device added to the map": "设备已添加到拓扑图",
  "Device removed": "设备已删除",
  "Could not save the device": "无法保存设备",
  "Could not remove the device": "无法删除设备",
  "Could not reach the firewall to run the check": "无法连接防火墙执行检测",
};
