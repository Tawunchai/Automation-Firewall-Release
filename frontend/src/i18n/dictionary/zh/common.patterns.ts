/**
 * Simplified Chinese — the interpolated sentences of the shell.
 *
 * Each `{}` is a value the app drops in at render time, and the translation may place them where
 * Chinese wants them — after a measure word, before a unit, either side of the verb. What it may
 * NOT do is change how many holes there are: ../../dictionary.test.ts fails on that, because a
 * dropped hole is a count or a device name silently missing from the screen.
 */
import type { Dict } from "../merge";

export const commonPatterns: Dict = {
  "Showing {} users": "显示 {} 位用户",
  "Selected {} accounts will be removed. This cannot be undone from here.":
    "所选的 {} 个账户将被删除，且无法在此处撤销。",
  "Delete {} users?": "要删除 {} 位用户吗？",
  "Delete {} Users": "删除 {} 位用户",
  "Deleted {} users": "已删除 {} 位用户",
  "Changed role to {} for {} users": "已将 {2} 位用户的角色更改为 {1}",
  "Make sure the email {} is not in use before restoring.":
    "恢复前请确认邮箱 {} 未被占用。",
  "No {} matches your search": "没有匹配您搜索条件的{}",
  "This device has no {} yet": "此设备上还没有{}",
  "All {} devices": "全部 {} 台设备",
  "Could not load {} profiles": "无法加载{}配置文件",
  "Could not read the {} list from {}": "无法从 {2} 读取{1}列表",
  "At least {} characters": "至少 {} 个字符",
  "Enter all {} digits": "请输入全部 {} 位数字",
  "Digit {} of {}": "第 {} 位，共 {} 位",
  "Code expires in {}": "验证码将在 {} 后过期",
  "Resend in {}s": "{} 秒后可重新发送",
  "Expires every {} days": "每 {} 天过期一次",
  "Expiring in {} — verify now": "将在 {} 后过期 — 请立即验证",
  "Users with passwords older than {} days will see a warning to change their password":
    "密码超过 {} 天未更改的用户将看到更改密码的提醒",
  "Purged {} expired backups": "已清除 {} 个过期备份",
  "Purge Expired ({})": "清除过期项（{}）",
  "Purge in {}d": "{} 天后清除",
  "Language — {}": "语言 — {}",
  "Copyright {} Firewall Automation": "版权所有 {} Firewall Automation",
  "The AI assistant request failed (HTTP {})": "AI 助手请求失败（HTTP {}）",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "from {}": "来自 {}",
  "{} percent": "{} 百分比",

  // -- The shared list-page footer and search box ----------------------------
  "Search {}…": "搜索{}…",

  "Edit Zone — {}": "编辑区域 — {}",
  "IP pool \"{}\" created on {}": "已在 {2} 上创建 IP 池 \"{1}\"",
  "IP pool \"{}\" updated on {}": "已在 {2} 上更新 IP 池 \"{1}\"",
  "Zone \"{}\" updated on {}": "已在 {2} 上更新区域 \"{1}\"",
  "\"{}\" is a {} file — only PNG, JPEG, GIF and WebP images can be attached":
    "\"{}\" 是 {} 文件——只能附加 PNG、JPEG、GIF 和 WebP 图片",
  "\"{}\" is too large (max 4 MB per image)": "\"{}\" 太大了（每张图片上限 4 MB）",
  "\"{}\" is too large even after resizing (max 4 MB per image)": "\"{}\" 即使压缩后仍然太大（每张图片上限 4 MB）",
  "up · {} ms": "在线 · {} ms",

  "This {} will be permanently removed from {}.": "此 {} 将从 {} 中被永久删除。",
};
