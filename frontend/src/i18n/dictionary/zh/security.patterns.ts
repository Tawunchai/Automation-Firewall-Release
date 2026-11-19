/**
 * Simplified Chinese — the interpolated sentences of the Security Profile forms.
 *
 * The profile name inside each confirmation is the mkey on the device, so it stays verbatim and the
 * Chinese is built around it. The device name comes second in English and first in Chinese, hence
 * the numbered holes.
 *
 * `Failed to {} …` takes a verb — "create" or "update" — from the call site, so the Chinese is
 * phrased to accept a verb in the middle: "创建/更新…失败".
 */
import type { Dict } from "../merge";

export const securityPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'AntiVirus profile "{}" created on {}': '已在 {2} 上创建防病毒配置文件“{1}”',
  'AntiVirus profile "{}" updated on {}': '已在 {2} 上更新防病毒配置文件“{1}”',
  'Web Filter profile "{}" created on {}': '已在 {2} 上创建 Web 过滤配置文件“{1}”',
  'Web Filter profile "{}" updated on {}': '已在 {2} 上更新 Web 过滤配置文件“{1}”',
  'DNS Filter profile "{}" created on {}': '已在 {2} 上创建 DNS 过滤配置文件“{1}”',
  'DNS Filter profile "{}" updated on {}': '已在 {2} 上更新 DNS 过滤配置文件“{1}”',
  'Application sensor "{}" created on {}': '已在 {2} 上创建应用传感器“{1}”',
  'Application sensor "{}" updated on {}': '已在 {2} 上更新应用传感器“{1}”',
  'File filter profile "{}" created on {}': '已在 {2} 上创建文件过滤配置文件“{1}”',
  'File filter profile "{}" updated on {}': '已在 {2} 上更新文件过滤配置文件“{1}”',
  'Web rating override "{}" created on {}': '已在 {2} 上创建 Web 评级覆盖“{1}”',
  'Web rating override "{}" updated on {}': '已在 {2} 上更新 Web 评级覆盖“{1}”',

  // -- Titles ----------------------------------------------------------------
  "Edit AntiVirus Profile — {}": "编辑防病毒配置文件 — {}",
  "Edit Web Filter Profile — {}": "编辑 Web 过滤配置文件 — {}",
  "Edit DNS Filter Profile — {}": "编辑 DNS 过滤配置文件 — {}",
  "Edit Application Sensor — {}": "编辑应用传感器 — {}",
  "Edit File Filter Profile — {}": "编辑文件过滤配置文件 — {}",
  "Edit Web Rating Override — {}": "编辑 Web 评级覆盖 — {}",
  "Create {} — coming soon": "创建{} — 即将推出",
  "Edit {} — coming soon": "编辑{} — 即将推出",

  // -- Failures --------------------------------------------------------------
  "Failed to {} application sensor": "{}应用传感器失败",
  "Failed to {} file filter profile": "{}文件过滤配置文件失败",
  "Failed to {} the web rating override": "{} Web 评级覆盖失败",
  "Failed to delete {}": "删除{}失败",

  // -- Filter chips and pickers ---------------------------------------------
  "Category {}": "类别 {}",
  "Group {}": "分组 {}",
  "Risk {}": "风险 {}",
  "Pop {}": "流行度 {}",
  "Selected {}": "已选择 {}",
  "Search {}…": "搜索{}…",

  // -- The security-profile list footer — see the note at its call site ------
  "{} {} profile": "{2}配置文件 {1} 个",
  "{} {} profiles": "{2}配置文件 {1} 个",
  "{} of {} {} profiles": "{3}配置文件 {1} / {2} 个",

  // -- IPS sensor and SSL/SSH inspection forms ----------------------------------
  "Edit IPS Sensor — {}": "编辑 IPS 传感器 — {}",
  "Edit SSL/SSH Inspection Profile — {}": "编辑 SSL/SSH 检测配置文件 — {}",
  "Failed to {} IPS sensor": "{} IPS 传感器失败",
  "Failed to {} SSL/SSH profile": "{} SSL/SSH 配置文件失败",
  "IPS sensor \"{}\" created on {}": "IPS 传感器“{}”已在 {} 上创建",
  "IPS sensor \"{}\" updated on {}": "IPS 传感器“{}”已在 {} 上更新",
  "SSL/SSH profile \"{}\" created on {}": "SSL/SSH 配置文件“{}”已在 {} 上创建",
  "SSL/SSH profile \"{}\" updated on {}": "SSL/SSH 配置文件“{}”已在 {} 上更新",
  "showing {} of {} — narrow the search": "显示 {} / {} 条——请缩小搜索范围",

  // -- ProfileLoadGuard: a profile that could not be read must not open as blank defaults --
  "Could not read the {}{}{}": "无法读取 {}{}{}",
  "It may be unreachable, or the {} may no longer exist on the device.":
    "可能无法连接，或该 {} 已不在设备上。",
  "Nothing was opened for editing — saving a form built from defaults would have replaced the {} on the firewall.":
    "没有打开任何内容进行编辑——保存一个由默认值生成的表单会覆盖防火墙上的 {}。",
};
