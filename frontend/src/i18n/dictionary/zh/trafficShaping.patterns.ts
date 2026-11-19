/** 简体中文 — the interpolated sentences the Traffic Shaping page builds. */
import type { Dict } from "../merge";

export const trafficShapingPatterns: Dict = {
  "Could not read traffic shaping from {}": "无法从 {} 读取流量整形配置",
  'Shaper "{}" {} on {}': '已在 {3} 上{2}整形器 "{1}"',
  'Shaper "{}" deleted from {}': '已从 {2} 删除整形器 "{1}"',
  'Shaper "{}" will be removed from {}.': '整形器 "{}" 将从 {} 上删除。',
  'Shaping policy "{}" created on {}': '已在 {2} 上创建整形策略 "{1}"',
  '"{}" is used by {} shaping {}. The device refuses the delete while that is true.':
    '"{}" 正被 {} 条{}使用。只要还是这样，设备就会拒绝删除。',
  '"{}" could not be deleted': '无法删除 "{}"',
  "Delete policy {}": "删除策略 {}",
  "used by {}": "被 {} 处使用",
  "forward: {} · reverse: {}": "正向：{} · 反向：{}",
  "up to {}{} · {} priority · {}": "最高 {}{} · {} 优先级 · {}",
  ", never below {} {}": "，且不低于 {} {}",

  "Shaper \"{}\" created on {}": "已在 {2} 上创建 shaper \"{1}\"",
  "Shaper \"{}\" updated on {}": "已在 {2} 上更新 shaper \"{1}\"",
};
