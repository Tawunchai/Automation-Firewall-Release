/**
 * 简体中文 — the interpolated sentences the grouping objects, IP pools, zones and the usage scan
 * build.
 *
 * Object names, device names and counts stay verbatim inside the holes: the name is the mkey on the
 * firewall, and the operator will type it again in a policy or look for it in `show`.
 */
import type { Dict } from "../merge";

export const groupsPatterns: Dict = {
  // ── Saved / deleted ───────────────────────────────────────────────────────
  'IP pool "{}" {} on {}': '已在 {3} 上{2} IP 池 "{1}"',
  'IP pool "{}" deleted from {}': '已从 {2} 删除 IP 池 "{1}"',
  'Zone "{}" {} on {}': '已在 {3} 上{2}区域 "{1}"',
  'Zone "{}" deleted from {}': '已从 {2} 删除区域 "{1}"',
  'Could not delete "{}"': '无法删除 "{}"',
  'Could not read {} "{}"': '无法读取{} "{}"',

  // ── Pickers and empty states ──────────────────────────────────────────────
  "New {}": "新建{}",
  "Search {}s…": "搜索{}…",
  'No {} matches "{}"': '没有{}与 "{}" 匹配',
  "Every {} is already a member": "所有{}都已经是成员了",
  "not in the current {} list": "不在当前{}列表中",
  "Could not read the {} list ({}). This is unreadable, not empty.":
    "无法读取{}列表（{}）。这是读不到，不是没有。",
  "Could not read the interface list ({}). This is unreadable, not empty.":
    "无法读取接口列表（{}）。这是读不到，不是没有。",

  // ── Clone + bulk ──────────────────────────────────────────────────────────
  'A policy called "{}" already exists — FortiOS will refuse this with error -5.':
    '已经存在名为 "{}" 的策略 —— FortiOS 会以 error -5 拒绝。',
  'The copy carries every field of the original, including the ones no form here shows. It arrives DISABLED, directly below "{}"{} — enable it once you have changed whatever you cloned it to change.':
    '副本会带上原策略的每一个字段，包括这里任何表单都不显示的那些。它到达时是 DISABLED 状态，紧挨着 "{}"{} 的下面 —— 改完你要改的东西之后再启用它。',
  "DELETE {} POLICIES": "删除 {} 条策略",
  "Select policy {}": "选择策略 {}",
  "Select every policy in {}": "选择 {} 中的全部策略",
  "These rules will be permanently removed{}. They are deleted one at a time, highest id first, and a failure part-way through leaves the rest in place — the result is reported per rule.":
    "这些规则将被永久删除{}。系统按 id 从大到小逐条删除，中途失败不会影响已经留下的规则 —— 结果会逐条报告。",

  // ── The usage scan ────────────────────────────────────────────────────────
  "Still referenced by {} places": "仍被 {} 处引用",
  "Could not read {}, so the list above may be incomplete. An empty result from a table that never answered is not evidence that nothing uses this object.":
    "无法读取{}，因此上面的列表可能不完整。一张从未应答的表返回空，并不能证明没有东西在用这个对象。",
  "The device counts {} references to this object and only {} are listed above — something outside the tables this console reads is using it.":
    "设备统计到这个对象有 {} 处引用，上面却只列出了 {} 处 —— 有本控制台读不到的表在使用它。",
  "The usage check could not run ({}), so this console cannot say what would break. Delete is disabled — retry, or remove the object on the device itself.":
    "引用检查没能执行（{}），本控制台无法判断删除会破坏什么。删除按钮已禁用 —— 请重试，或直接在设备上删除该对象。",
  "Fixed Port Range keeps the source port, so each internal address needs its own external one. There are {} internal and only {} external — the last {} would not be translated at all, and the device will not warn you.":
    "Fixed Port Range 会保留源端口，所以每个内部地址都需要一个自己的外部地址。现在内部有 {}，外部只有 {} —— 最后 {} 根本不会被转换，而设备不会给任何提示。",

  "Zone \"{}\" created on {}": "已在 {2} 上创建区域 \"{1}\"",
};
