/**
 * Simplified Chinese — the interpolated sentences of Audit / Review, Rule Lifecycle, the Change
 * Ledger and Notify.
 *
 * `Revert "{} {} {}"?` holds an action, a CMDB table and an mkey, in that order. All three stay
 * verbatim: the sentence around them is the console's, but those words are the change as the ledger
 * recorded it and as the device would name it.
 */
import type { Dict } from "../merge";

export const auditPatterns: Dict = {
  // -- Findings and scans ----------------------------------------------------
  "None of the {} checks found a problem": "全部 {} 项检查均未发现问题",
  "Checked {} rule(s) on {} device(s) — nothing to report":
    "已在 {2} 台设备上检查了 {1} 条规则 — 没有需要报告的内容",
  "— {} finding{}": "— 发现 {} 项{}",
  "; the remaining {} say why they are not": "；其余 {} 项说明了未被评估的原因",
  "· catalogue {}": "· 目录 {}",
  "· catalogue {} ({})": "· 目录 {}（{}）",
  "· rated {}": "· 评级为 {}",
  "· the device graded itself {}": "· 设备给自己的评级为 {}",
  "· run by {}": "· 由 {} 运行",
  "withdrawn by {} on {}": "由 {1} 于 {2} 撤回",
  "This rule has carried traffic before (last used {}) — idle, not dead":
    "此规则曾经有流量通过（最后使用于 {}）— 属于闲置，而非失效",

  // -- Deleting a policy from Rule Lifecycle --------------------------------
  "Delete policy {} {}": "删除策略 {} {}",
  "Delete policy {} from the device": "从设备上删除策略 {}",
  "Deleted policy {} {} from the device": "已从设备上删除策略 {} {}",
  "will be permanently removed from {}": "将被永久地从 {} 中移除",

  // -- Change Ledger ---------------------------------------------------------
  'Revert "{} {} {}"?': '要回退“{} {} {}”吗？',

  // -- Notify ----------------------------------------------------------------
  "Add recipient — {}": "添加接收人 — {}",
  "Remove {}": "移除 {}",
  'Delete "{}"?': '要删除“{}”吗？',
  "Edit {}": "编辑 {}",
  "Edit “{}”": "编辑“{}”",
  "Send to {}": "发送到 {}",
  "sent to {}": "已发送到 {}",
  '"{}" is not a valid email address': '“{}”不是有效的邮箱地址',
  "Its {} recipient(s) go too, and any alert rule pointing at them stops reaching anyone.":
    "它的 {} 位接收人也会一并删除，任何指向他们的告警规则都将无法送达任何人。",
  "Test message delivered to {} recipient(s)": "测试消息已送达 {} 位接收人",
  "Test sent to {} recipient(s)": "已向 {} 位接收人发送测试",
  "fires after {} checks (about {} min)": "连续 {} 次检查后触发（约 {} 分钟）",
  "fires after {} checks ({}s)": "连续 {} 次检查后触发（{} 秒）",
  "repeats at most every {} min": "重复发送最小间隔 {} 分钟",
  "repeats at most every {} h": "重复发送最小间隔 {} 小时",
  "({} disabled)": "（{} 项已禁用）",
  "failed ({})": "失败（{}）",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{} of the rules that could be evaluated": "占可评估规则的 {}",

  // -- Configuration Drift -----------------------------------------------------
  "last {} days": "最近 {} 天",
  "{} days": "{} 天",
  "Most outside changes: {} ({})": "控制台之外变更最多的一天：{}（{}）",
  "None refused · {}": "无拒绝 · {}",
  "Nothing changed in the {}": "{}内没有任何变更",
  "The device refused these · {}": "设备拒绝了这些写入 · {}",
  "{} since reverted · {}": "其中 {} 项已回滚 · {}",
  "{}% of all changes · {}": "占全部变更的 {}% · {}",
  "{} rejected by the device": "设备拒绝了 {} 项",
  "{} changes nobody here can account for": "有 {} 项变更无人能够解释来源",
  "{}–{} of {}": "第 {}–{} 条，共 {} 条",
  "Device #{}": "设备 #{}",
  "Reviewed by {}": "由 {} 复核",
  "Reviewed by {} on {}": "由 {} 于 {} 复核",
  "Reviewed by {} — {}": "由 {} 复核 — {}",
  "Reviewed by {} on {} — {}": "由 {} 于 {} 复核 — {}",
  "Reverted {} by {}": "于 {} 由 {} 回滚",

  // -- Configuration Drift: change history -------------------------------------
  "Backup #{} → #{}": "备份 #{} → #{}",
  "Delete {} from the firewall?": "要从防火墙删除 {} 吗？",
  "Undo this change to {}?": "要撤销对 {} 的这项变更吗？",
  "Found by backup comparison {}": "由备份比较发现 {}",
  "Happened between {} and {} — found by backup comparison": "发生于 {} 至 {} 之间——由备份比较发现",
  "Last compared {}": "上次比较 {}",
  "Made by the console's {} feature": "由控制台的 {} 功能完成",
  "No — {}.": "不可以——{}。",
  "Showing the newest {} of {}": "显示最新 {} 条，共 {} 条",
  "Step {}": "第 {} 步",
  "Undone {} by {}": "于 {} 由 {} 撤销",
  "Undo of #{}": "#{} 的撤销",
  "this is part of a larger object ({}) — restore the backup taken before it": "这是更大对象（{}）的一部分——请恢复在此之前的备份",

  // -- Audit: controls and remediation ------------------------------------------------
  "What is wrong right now ({})": "当前存在的问题（{}）",
  "across {} frameworks": "，涵盖 {} 个框架",
  "Commands checked with {} on this device": "已在此设备上用 {} 检查命令",
  "per-attribute ({})": "逐属性（{}）",
  "Applied {} change(s)": "已应用 {} 项更改",
  ", {} failed": "，{} 项失败",
  "Write {} changes to this firewall?": "将 {} 项更改写入此防火墙？",
  "Put {} changes back?": "恢复 {} 项更改？",

  // -- Configuration Drift: the one-line answer to "who changed this" ----------------
  "By {} over {} from {}": "由 {} 通过 {} 从 {} 发起",
  "By {} over {}": "由 {} 通过 {} 发起",
  "and {} more changes to it": "并且还有 {} 次变更",

  // -- Security Posture Score (dashboard tile) --------------------------------
  "· scanned {}": "· 扫描于 {}",

  "Changes by FortiOS table — {}": "按 FortiOS 表划分的变更 — {}",
};
