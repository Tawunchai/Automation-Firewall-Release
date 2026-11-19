/**
 * Simplified Chinese — the bare words the app renders on their own.
 *
 * These are not page copy. They are single nouns and states that arrive between two tags, most of
 * them from the two idioms this codebase counts things with:
 *
 *     {routes.length} route{routes.length !== 1 ? "s" : ""}      // 22 places
 *     <DeviceStates noun="static route" … />                     // 15 places
 *
 * Both hand React a lone word, and both are how a device list says what it is listing — so a word
 * missing from here is an English noun stranded in the middle of an otherwise Chinese sentence.
 * They live in their own file because they belong to no one page: `route` is the Static Routes
 * footer, the SD-WAN rule summary and the AI impact analysis, and one translation serves all three.
 *
 * Singular and plural are both listed where the app renders both. Chinese does not inflect for
 * number, so the two map to the same word — the plural "s" that would otherwise trail it is dropped
 * by ../../jsx-runtime.ts, not here.
 */
import type { Dict } from "../merge";

export const words: Dict = {
  // -- What a device page lists (StateBlock's `noun`) ------------------------
  "static route": "静态路由",
  "address object": "地址对象",
  "service object": "服务对象",
  "LDAP server": "LDAP 服务器",
  "RADIUS server": "RADIUS 服务器",
  "SD-WAN zone": "SD-WAN 区域",
  "SD-WAN rule": "SD-WAN 规则",
  "Web Rating Override": "Web 评级覆盖",
  "network status": "网络状态",
  "the session table read": "会话表读取",

  // -- Counted nouns ---------------------------------------------------------
  route: "条路由",
  policy: "条策略",
  policies: "条策略",
  rule: "条规则",
  address: "个地址",
  addresses: "个地址",
  service: "个服务",
  profile: "个配置文件",
  interface: "个接口",
  tunnel: "条隧道",
  member: "个成员",
  members: "个成员",
  zones: "个区域",
  group: "个组",
  user: "位用户",
  devices: "台设备",
  port: "个端口",
  session: "个会话",
  sessions: "个会话",
  event: "个事件",
  alert: "条告警",
  check: "项检查",
  result: "条结果",
  table: "张表",
  gap: "项差距",
  observation: "项观察",
  frameworks: "个框架",
  mapping: "个映射",
  selector: "个选择器",
  threshold: "个阈值",
  traffic: "流量",
  firewall: "防火墙",
  hits: "次命中",
  hops: "跳",
  lines: "行",
  cores: "核",
  days: "天",
  total: "合计",
  all: "全部",
  one: "一个",
  other: "其他",
  any: "任意",
  local: "本地",
  ms: "毫秒",

  // -- States ----------------------------------------------------------------
  active: "活动",
  inactive: "非活动",
  available: "可用",
  configured: "已配置",
  disabled: "已禁用",
  locked: "已锁定",
  standby: "备用",
  up: "已连通",
  down: "未连通",
  on: "开",
  off: "关",
  unknown: "未知",
  orphaned: "无归属",
  accepted: "已接受",
  evidenced: "有证据支持",
  scanned: "已扫描",
  expires: "到期",
  maintenance: "维护",
  initial: "首次",
  timing: "时序",
  dialup: "拨号",
  "auto-discovery": "自动发现",
  "built-in": "内置",

  // -- Verbs the console reports in the past or the imperative ---------------
  create: "创建",
  replace: "替换",
  overwrite: "覆盖",
  skip: "跳过",
  toggle: "切换",
  reconnect: "重新连接",
  added: "已添加",
  removed: "已移除",
  selected: "已选择",
  sent: "已发送",
  fail: "失败",

  // -- Nouns assembled at runtime — see the note at the top of this file -----
  "antivirus": "防病毒",
  "web filter": "Web 过滤",
  "dns filter": "DNS 过滤",
  "application control": "应用控制",
  "file filter": "文件过滤",
  "ssl/ssh inspection": "SSL/SSH 检测",
  "schedule": "计划表",
  "schedules": "计划表",
  "virtual IP": "虚拟 IP",
  "user group": "用户组",
  "local user": "本地用户",
  "firewall policy": "防火墙策略",
  "IPsec tunnel": "IPsec 隧道",
  "interfaces": "接口",
  "tunnels": "隧道",
  "zone": "区域",
};
