/**
 * Simplified Chinese — the Addresses page and the address create/edit form.
 *
 * The country list this page also renders lives in ./countries.ts.
 *
 * The two-letter codes (SUB, RNG, FQ, GE, MC, WC, DY, IF) are the type badges in the address
 * table's narrow first column — they exist because the full type name does not fit. Chinese can
 * usually say the type in two characters, which fits the same column; where it cannot, the badge
 * keeps its FortiOS letters (see ../keep.ts).
 */
import type { Dict } from "../merge";

export const addresses: Dict = {
  "New Address": "新建地址",
  "Edit Address": "编辑地址",
  "Address deleted": "地址已删除",
  "Failed to create address": "创建地址失败",
  "Failed to update address": "更新地址失败",
  "Failed to delete address": "删除地址失败",
  "Loading address…": "正在加载地址…",
  "Address not found — it may have been deleted.": "未找到该地址 — 可能已被删除。",
  "Search addresses…": "搜索地址…",
  "Delete from device?": "要从设备上删除吗？",
  "Name can't be changed when editing an existing address.":
    "编辑已有地址时无法更改名称。",
  "· firewall address · ESC close": "· firewall address · 按 ESC 关闭",
  "firewall policy(ies).": "条防火墙策略。",
  "will be permanently removed from": "将被永久地从以下位置移除",
  "Go back": "返回",
  Change: "更改",
  "No Color": "不设颜色",

  // -- Table columns ---------------------------------------------------------
  NAME: "名称",
  TYPE: "类型",
  DETAILS: "详情",
  INTERFACE: "接口",
  "REF.": "引用",
  "⚠ Used in": "⚠ 使用于",

  // -- Address types ---------------------------------------------------------
  Subnet: "子网",
  "IP Range": "IP 范围",
  Geography: "地理位置",
  "MAC Address": "MAC 地址",
  "Add MAC Address": "添加 MAC 地址",
  "Device (MAC Address)": "设备（MAC 地址）",
  "Interface Subnet": "接口子网",
  Dynamic: "动态",
  "Sub Type": "子类型",
  "SDN Connector": "SDN 连接器",
  "Fabric Connector Address": "Fabric 连接器地址",
  "Static route configuration": "静态路由配置",

  // -- Field hints -----------------------------------------------------------
  "CIDR (192.168.1.0/24) or mask (192.168.1.0 255.255.255.0)":
    "CIDR（192.168.1.0/24）或掩码（192.168.1.0 255.255.255.0）",
  "e.g. example.com or *.example.com (wildcard)":
    "例如 example.com 或 *.example.com（通配符）",
  "Start and end IP separated by a hyphen": "起始 IP 与结束 IP，用连字符分隔",
  "MAC address or range (e.g. 00:11:22:33:44:55)":
    "MAC 地址或范围（例如 00:11:22:33:44:55）",
  "Single: 00:11:22:33:44:55 · Range: 00:11:22:33:44:55-00:11:22:33:44:FF":
    "单个：00:11:22:33:44:55 · 范围：00:11:22:33:44:55-00:11:22:33:44:FF",
  "Select country / region…": "选择国家 / 地区…",
  "Search country…": "搜索国家…",
  "No country found": "未找到国家",

  // -- Fabric connector sub-types -------------------------------------------
  "This sub-type is managed by its matching Fabric Connector on the device.":
    "此子类型由设备上对应的 Fabric 连接器管理。",
  "Configure a Fabric Connector under Security Fabric → External Connectors first.":
    "请先在 Security Fabric → External Connectors 下配置一个 Fabric 连接器。",
  "FortiClient EMS Tag": "FortiClient EMS 标签",
  "FortiNAC Tag": "FortiNAC 标签",
  "FortiPolicy Tag": "FortiPolicy 标签",
  "FortiVoice Tag": "FortiVoice 标签",
  "Switch Controller NAC Policy Tag": "交换机控制器 NAC 策略标签",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Configuration": "配置",
  "No SDN connectors configured": "未配置 SDN 连接器",
  "Select SDN connector…": "选择 SDN 连接器…",
  "Wildcard FQDN": "通配符 FQDN",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP Range/Subnet": "IP 范围 / 子网",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP/Netmask": "IP / 掩码",
};
