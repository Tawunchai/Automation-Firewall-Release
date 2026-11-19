/**
 * 简体中文 — Policy & Objects ▸ Traffic Shaping.
 */
import type { Dict } from "../merge";

export const trafficShaping: Dict = {
  "Traffic Shaping": "流量整形",
  "traffic shaper": "整形器",
  "Shapers": "整形器",
  "Shaping policies": "整形策略",
  "New shaper": "新建整形器",
  "Edit shaper": "编辑整形器",
  "New shaping policy": "新建整形策略",
  "Unit": "单位",
  "Guaranteed (floor)": "保障带宽（下限）",
  "Maximum (ceiling)": "最大带宽（上限）",
  "Source interface": "源接口",
  "Destination interface": "目的接口",
  "Shaper — forward": "整形器 —— 正向",
  "Shaper — reverse": "整形器 —— 反向",
  "Apply the limit per policy": "按策略分别计算这个上限",
  "used by nothing": "没有任何策略在用",
  "usage unknown": "使用情况未知",
  "This device has no traffic shaper yet": "这台设备还没有任何整形器",
  "No shaping policy, so none of the shapers above are applied to anything":
    "没有任何整形策略，所以上面的整形器都还没有被用到任何流量上",
  "Shapers may well be configured — this is 'unreadable', not 'none'":
    "很可能确实配置了整形器 —— 这是读不到，不是没有",
  "Shaping policy deleted from device": "已从设备删除整形策略",

  "A shaper is a limit. A shaping policy is which traffic gets it. Either is valid on its own, and a shaper with no policy shapes nothing — which is what the \"used by\" column is for.":
    "整形器是一个上限，整形策略决定哪些流量吃这个上限。两者单独存在都是合法的，而没有策略的整形器什么也限制不了 —— “被谁使用”这一列就是为此而设。",
  "0 means UNLIMITED on FortiOS, which is almost never what a shaper is for.":
    "在 FortiOS 上 0 表示不限速，而这几乎从来不是设置整形器的目的。",
  "A maximum of 0 means UNLIMITED on FortiOS — set a real ceiling, or delete the shaper if no limit is what you want":
    "上限填 0 在 FortiOS 上等于不限速 —— 请填一个真实的上限，或者如果本来就不想限速就删掉这个整形器",
  "The guaranteed bandwidth is higher than the maximum — the floor cannot be above the ceiling":
    "保障带宽高于最大带宽 —— 下限不能高过上限",
  "Bandwidth cannot be negative": "带宽不能是负数",
  "Shaper names are limited to 35 characters": "整形器名称最多 35 个字符",
  "Each shaping policy using this shaper gets its OWN full allowance.":
    "用到这个整形器的每一条策略，都各自拿到完整的配额。",
  "The allowance is SHARED: three policies using this shaper share one limit between them.":
    "配额是共用的：三条策略用同一个整形器，就是三条一起分这一个上限。",
  "each policy gets its own allowance": "每条策略各自拿到自己的配额",
  "the allowance is SHARED by every policy using it": "所有用到它的策略共用同一份配额",
  "This is the half people forget: a download limit set only in the forward direction shapes the REQUESTS, not the file coming back.":
    "这是最容易被忘掉的一半：只在正向设下载限速，限住的是请求，不是回来的那个文件。",
  "— none —": "— 无 —",
  "— any —": "— 任意 —",

  "Loading shaper…": "正在加载 shaper…",
  "No device selected — pick one from the navbar": "未选择设备——请在顶部导航栏中选择",
  "Shaper list could not be read:": "无法读取 shaper 列表：",
  "Shaper not found — go back to the list.": "找不到该 shaper——请返回列表。",
};
