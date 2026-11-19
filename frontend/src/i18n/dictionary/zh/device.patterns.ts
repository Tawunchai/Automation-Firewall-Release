/**
 * Simplified Chinese — the interpolated sentences of Devices and Config Deploy.
 *
 * Several of these carry a job or backup number the operator will quote to someone else. The `#`
 * stays where it is and the digits stay Arabic: a Chinese sentence around a reference the device
 * also printed is easier to act on than a fully localised one nobody can match back.
 */
import type { Dict } from "../merge";

export const devicePatterns: Dict = {
  // -- The shared device-scoped form page ------------------------------------
  // {} is the page's noun, passed through untranslated: it is the word the operator also sees in
  // the FortiOS CLI for that object type.
  "Loading the {}…": "正在加载 {}…",
  "No device selected — go back and choose the firewall this {} belongs on.":
    "尚未选择设备 —— 请返回并选择这个 {} 所属的防火墙。",

  // -- Backup ----------------------------------------------------------------
  "Backup successful: {}": "备份成功：{}",
  "Backup failed: {}": "备份失败：{}",
  "Backup triggered for {} (job #{})": "已为 {1} 触发备份（任务 #{2}）",
  "Batch backup queued: {} device(s)": "批量备份已排队：{} 台设备",
  "Reset job #{} — triggering a fresh backup…": "已重置任务 #{} — 正在触发新的备份…",
  "Job #{} is stuck — press Force Retry to reset it and back up again":
    "任务 #{} 卡住了 — 点击“强制重试”可重置并重新备份",
  "· {} already running": "· {} 已在运行",
  "Rollback queued (deploy #{}) — check Config Deploy page":
    "回滚已排队（下发 #{}）— 请查看“配置下发”页面",

  // -- Config diff -----------------------------------------------------------
  "+++ Backup #{} ({})": "+++ 备份 #{}（{}）",
  "--- Backup #{} ({})": "--- 备份 #{}（{}）",
  "Backup #{} vs #{}": "备份 #{} 对比 #{}",
  "Compare #{} vs #{}": "比较 #{} 与 #{}",
  "Viewing: {}": "正在查看：{}",
  "History: {}": "历史：{}",
  "Edit: {}": "编辑：{}",
  "Delete {}": "删除 {}",
  "Downstream of {}": "位于 {} 的下游",

  "· {} unreachable": "· {} 台无法访问",

  // -- Terminal --------------------------------------------------------------
  "Send {} command(s)": "发送 {} 条命令",
  "Send {} command(s) to {} device(s)": "向 {2} 台设备发送 {1} 条命令",
  "Multi Config · {} devices · {}": "多设备配置 · {} 台设备 · {}",
  "The device must have {} in the allowaccess list of the interface you connect through":
    "您所连接接口的 allowaccess 列表中必须包含 {}",

  // -- Dashboard -------------------------------------------------------------
  "current usage · {} cores": "当前使用率 · {} 核",
  "Per core ({})": "各核心（{}）",
  "peak {} in this window": "此时间窗口内峰值 {}",
  "Show {} more entitlements": "再显示 {} 项授权",

  // -- Report kinds and revert reasons — served by the Go backend, so the extractor never sees them ---
  "{} — Connected": "{} — 已连接",
  "{} — Not connected": "{} — 未连接",
  "{} — Disabled (admin down)": "{} — 已禁用（管理性关闭）",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----

  // -- Phase 13: the VDOM picker ------------------------------------------------
  "Virtual domain: {}": "虚拟域：{}",

  // -- Dashboard Services KPI card -----------------------------------------
  "across {} categories": "分布于 {} 个类别",

  "Backup #{} deleted": "已删除备份 #{}",
  "Delete backup #{}": "删除备份 #{}",
  "Job #{} is stuck — force retry": "任务 #{} 卡住了——强制重试",
};
