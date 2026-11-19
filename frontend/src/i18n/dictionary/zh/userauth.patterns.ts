/**
 * Simplified Chinese — the interpolated sentences of User & Authentication.
 *
 * The length-limit family ("must be {} characters or fewer") carries the FortiGate's own field
 * limit, which differs per field and per firmware — so the number comes from the schema rather than
 * being written into the sentence.
 */
import type { Dict } from "../merge";

export const userauthPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'User "{}" created on {}': '已在 {2} 上创建用户“{1}”',
  'User "{}" updated on {}': '已在 {2} 上更新用户“{1}”',
  'User group "{}" created on {}': '已在 {2} 上创建用户组“{1}”',
  'User group "{}" updated on {}': '已在 {2} 上更新用户组“{1}”',
  'LDAP server "{}" created on {}': '已在 {2} 上创建 LDAP 服务器“{1}”',
  'LDAP server "{}" updated on {}': '已在 {2} 上更新 LDAP 服务器“{1}”',
  'RADIUS server "{}" created on {}': '已在 {2} 上创建 RADIUS 服务器“{1}”',
  'RADIUS server "{}" updated on {}': '已在 {2} 上更新 RADIUS 服务器“{1}”',
  'Exchange connector "{}" created': '已创建 Exchange 连接器“{}”',

  // -- Titles ----------------------------------------------------------------
  "Edit User{}": "编辑用户{}",
  "Edit User Group{}": "编辑用户组{}",
  "Edit LDAP Server{}": "编辑 LDAP 服务器{}",
  "Edit RADIUS Server{}": "编辑 RADIUS 服务器{}",

  // -- Validation ------------------------------------------------------------
  "Name must be {} characters or fewer": "名称长度不能超过 {} 个字符",
  "Username must be {} characters or fewer": "用户名长度不能超过 {} 个字符",
  "IP/Name must be {} characters or fewer": "IP/名称长度不能超过 {} 个字符",
  "Server IP/Name must be {} characters or fewer": "服务器 IP/名称长度不能超过 {} 个字符",
  "Distinguished Name must be {} characters or fewer":
    "Distinguished Name 长度不能超过 {} 个字符",
  "Common Name Identifier must be {} characters or fewer":
    "Common Name Identifier 长度不能超过 {} 个字符",
  "Maximum Accounts must be 1-{}": "最大账户数必须在 1-{} 之间",
  '"{}" is a {} user — this app only edits local users.':
    '“{1}”是 {2} 类型的用户 — 本应用只能编辑本地用户。',

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{}% of total": "占总数的 {}%",

  "(filtered from {})": "（从 {} 中筛选）",
};
