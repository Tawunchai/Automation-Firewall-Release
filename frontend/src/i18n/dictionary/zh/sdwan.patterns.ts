/**
 * Simplified Chinese — the interpolated sentences of SD-WAN.
 *
 * The "no X named/with id {} on this device" family are what the edit pages show when a URL points
 * at something that has since been deleted on the firewall. The identifier stays verbatim: it is
 * what the operator would paste into `show system sdwan` to check for themselves.
 */
import type { Dict } from "../merge";

export const sdwanPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'SD-WAN zone "{}" created': '已创建 SD-WAN 区域“{}”',
  'SD-WAN zone "{}" updated': '已更新 SD-WAN 区域“{}”',
  'SD-WAN member "{}" created on {}': '已在 {2} 上创建 SD-WAN 成员“{1}”',
  'SD-WAN member "{}" updated on {}': '已在 {2} 上更新 SD-WAN 成员“{1}”',
  'SD-WAN rule "{}" created on {}': '已在 {2} 上创建 SD-WAN 规则“{1}”',
  'SD-WAN rule "{}" updated on {}': '已在 {2} 上更新 SD-WAN 规则“{1}”',
  'Performance SLA "{}" created on {}': '已在 {2} 上创建性能 SLA“{1}”',
  'Performance SLA "{}" updated on {}': '已在 {2} 上更新性能 SLA“{1}”',

  // -- Titles ----------------------------------------------------------------
  "Edit SD-WAN Zone — {}": "编辑 SD-WAN 区域 — {}",
  "Edit SD-WAN Member — {}": "编辑 SD-WAN 成员 — {}",
  "Performance SLA — {}": "性能 SLA — {}",
  "Priority Rule — {}": "优先级规则 — {}",
  "Search {}": "搜索{}",

  // -- Not found on the device ----------------------------------------------
  'No SD-WAN zone named "{}" on this device': '此设备上没有名为“{}”的 SD-WAN 区域',
  'No performance SLA named "{}" on this device': '此设备上没有名为“{}”的性能 SLA',
  "No SD-WAN member with sequence number {} on this device":
    "此设备上没有序号为 {} 的 SD-WAN 成员",
  "No SD-WAN rule with id {} on this device": "此设备上没有 id 为 {} 的 SD-WAN 规则",

  // -- Limits the firewall imposes ------------------------------------------
  "A performance SLA accepts at most {} servers": "一个性能 SLA 最多接受 {} 台服务器",
  "A performance SLA name cannot contain {}": "性能 SLA 名称不能包含 {}",

  // -- Readouts --------------------------------------------------------------
  "Best quality · {}": "最佳质量 · {}",
  "· every {}ms": "· 每 {} 毫秒",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Choose {}": "选择 {}",
};
