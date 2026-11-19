/** 简体中文 — the interpolated sentences the topology map and the policy matrix build. */
import type { Dict } from "../merge";

export const topologyPatterns: Dict = {
  "Could not read the interfaces from {}": "无法从 {} 读取接口列表",
  "Topology of {}: {} permitted paths between {} segments":
    "{} 的拓扑：{} 条允许的路径，连接 {} 个网段",
  "Showing {} {} on {}": "正在显示 {2} 上的 {1} {3}",
  "The map is missing its {} — those could not be read. What is drawn is complete for everything else; the missing part is unknown, not absent.":
    "这张图缺少{}，因为它们读不到。已经画出来的部分对其余内容是完整的；缺的那部分是“未知”，不是“没有”。",

  // The scene: the KPI caption, the legend's two counts, and the screen-reader list that is the
  // keyboard path into the same nodes the WebGL canvas draws.
  "Topology of {}, as a list": "{} 的拓扑，以列表形式呈现",
  "Port {} — {}": "端口 {} —— {}",
  "default route via {}{}": "默认路由经由 {}{}",
  "+{} more not drawn — the {} shown are the ones with an issue or traffic":
    "另有 {} 条未绘制 —— 画出来的这 {} 条是有问题或有流量的",
  "· {} off-panel": "· 另有 {} 个不在面板上",

  // My devices: how long ago the firewall last pinged a pinned device.
  "checked {}m ago": "{} 分钟前检测",
  "checked {}h ago": "{} 小时前检测",
};
