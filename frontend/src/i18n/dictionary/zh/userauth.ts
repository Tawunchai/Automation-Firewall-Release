/**
 * Simplified Chinese — User & Authentication: User Definition, User Groups, LDAP and RADIUS
 * servers, and the Exchange connector.
 *
 * LDAP's own vocabulary (Distinguished Name, Common Name Identifier, Bind Type, and the sample DNs)
 * is kept close to the English because it has to match what the directory administrator sees on the
 * other side — a `cn=` is a `cn=` in every language, and the sample strings are literal.
 *
 * The dial-code country names are a separate short list from ./countries.ts; they are the entries
 * the SMS field offers, and they are translated the same way.
 */
import type { Dict } from "../merge";

export const userauth: Dict = {
  // -- Users -----------------------------------------------------------------
  Username: "用户名",
  "User ID": "用户 ID",
  "User Type": "用户类型",
  "User Account Status": "用户账户状态",
  "Users/Groups Creation Wizard": "用户/用户组创建向导",
  "Loading user…": "正在加载用户…",
  "Loading user group…": "正在加载用户组…",
  "Failed to create user": "创建用户失败",
  "Failed to update user": "更新用户失败",
  "Failed to create user group": "创建用户组失败",
  "Failed to update user group": "更新用户组失败",
  "User not found — go back to the list.": "未找到该用户 — 请返回列表。",
  "User group not found — go back to the list.": "未找到该用户组 — 请返回列表。",
  "Enter both a username and a password": "请同时输入用户名和密码",
  "Leave blank to keep the stored password — the FortiGate never returns it.":
    "留空表示保留已保存的密码 — FortiGate 从不回传密码。",
  "Leave blank to keep the stored secret — the FortiGate never returns it.":
    "留空表示保留已保存的 Secret — FortiGate 从不回传该值。",
  "Create the first": "创建第一个",
  "Stored as username": "以用户名形式保存",
  "is available — the remote types need a RADIUS/TACACS+/LDAP server object, and FSSO/FortiNAC users aren't stored on this device.":
    "可用 — 远程类型需要 RADIUS/TACACS+/LDAP 服务器对象，而 FSSO/FortiNAC 用户并不保存在此设备上。",
  Only: "仅",

  // -- Groups ----------------------------------------------------------------
  "New User Group": "新建用户组",
  "Remote Groups": "远程组",
  "Add Remote Group": "添加远程组",
  "— remote server —": "— 远程服务器 —",
  "Include in every user group": "包含在每个用户组中",
  "Select Entries": "选择条目",
  Browse: "浏览",
  "Name of the RADIUS user group this group represents":
    "此组所代表的 RADIUS 用户组名称",
  "RADIUS Attribute Value": "RADIUS 属性值",
  "Changing the type clears the settings that don't apply to the new type (members are dropped).":
    "更改类型会清除不适用于新类型的设置（成员会被移除）。",
  "Each remote server used here is added to Members automatically — the FortiGate rejects the whole group otherwise (error -518).":
    "此处用到的每个远程服务器都会自动加入“成员”— 否则 FortiGate 会拒绝整个用户组（错误 -518）。",
  "No Firewall/FSSO groups on this device — guest and RSSO groups can't take members.":
    "此设备上没有 Firewall/FSSO 组 — 访客组和 RSSO 组无法添加成员。",
  "No FSSO groups on this device — configure an FSSO agent first (User & Authentication > Single Sign-On).":
    "此设备上没有 FSSO 组 — 请先配置 FSSO 代理（用户与认证 > 单点登录）。",
  "No remote authentication servers on this device — add one under User & Authentication > LDAP Servers or RADIUS Servers first.":
    "此设备上没有远程认证服务器 — 请先在“用户与认证 > LDAP 服务器”或“RADIUS 服务器”下添加一个。",

  // -- Guest accounts --------------------------------------------------------
  "Batch Guest Account Creation": "批量创建访客账户",
  "Guest Details": "访客信息",
  "Maximum Accounts": "最大账户数",
  Expiration: "有效期",
  "Start Countdown": "开始倒计时",
  Sponsor: "担保人",
  Company: "公司",
  "Auto Generated": "自动生成",
  "Batch creation generates accounts automatically: the FortiGate forces":
    "批量创建会自动生成账户：FortiGate 会强制使用",
  "and ignores the Guest Details below. Expiration and Maximum Accounts still apply.":
    "并忽略下面的访客信息。有效期和最大账户数仍然生效。",

  // -- Two-factor / tokens ---------------------------------------------------
  "Two-factor Authentication": "双因素认证",
  Token: "令牌",
  "Enable Email": "启用邮箱",
  "Enable SMS": "启用短信",
  "Enable Name": "启用姓名",
  SMS: "短信",
  "SMS Server": "短信服务器",
  "— select an SMS server —": "— 选择一个短信服务器 —",
  "Email Address": "邮箱地址",
  "Phone Number": "电话号码",
  "Country Dial Code": "国家区号",
  "This FortiGate has no FortiToken Cloud subscription":
    "此 FortiGate 没有 FortiToken Cloud 订阅",
  "FortiToken Cloud offers scalable and centrally-managed two factor authentication. A":
    "FortiToken Cloud 提供可扩展、集中管理的双因素认证。可申请",
  "trial subscription": "试用订阅",
  "is available free of charge.": "，免费提供。",
  "for a token that already exists on the device.": "，用于设备上已存在的令牌。",
  "until one is activated. Use": "，直到有令牌被激活为止。请使用",
  "— saving will return": "— 保存后将返回",
  "No FortiTokens on this device — add one under User & Authentication > FortiTokens first.":
    "此设备上没有 FortiToken — 请先在“用户与认证 > FortiTokens”下添加一个。",
  "No custom SMS servers on this device — add one under System > SMS Server, or use FortiGuard.":
    "此设备上没有自定义短信服务器 — 请在“系统 > 短信服务器”下添加一个，或使用 FortiGuard。",
  "Get the app": "获取应用",
  "Manage your devices on iOS or Android. iOS users can also manage FortiToken Cloud subscriptions.":
    "在 iOS 或 Android 上管理您的设备。iOS 用户还可以管理 FortiToken Cloud 订阅。",

  // -- LDAP ------------------------------------------------------------------
  "New LDAP Server": "新建 LDAP 服务器",
  "Loading LDAP server…": "正在加载 LDAP 服务器…",
  "LDAP server not found — go back to the list.": "未找到该 LDAP 服务器 — 请返回列表。",
  "Failed to create LDAP server": "创建 LDAP 服务器失败",
  "Failed to update LDAP server": "更新 LDAP 服务器失败",
  "Bind Type": "绑定类型",
  "Server IP/Name": "服务器 IP/名称",
  "Server Port": "服务器端口",
  "Server identity check": "服务器身份校验",
  "Secure Connection": "安全连接",
  Certificate: "证书",
  Plain: "明文",
  "FortiOS 7.2.10 exposes no LDAP test endpoint, so these are disabled. RADIUS servers do have one — see User & Authentication > RADIUS Servers.":
    "FortiOS 7.2.10 没有提供 LDAP 测试接口，因此这些按钮被禁用。RADIUS 服务器则有该接口 — 见“用户与认证 > RADIUS 服务器”。",

  // -- RADIUS ----------------------------------------------------------------
  "New RADIUS Server": "新建 RADIUS 服务器",
  "Loading RADIUS server…": "正在加载 RADIUS 服务器…",
  "RADIUS server not found — go back to the list.": "未找到该 RADIUS 服务器 — 请返回列表。",
  "Failed to create RADIUS server": "创建 RADIUS 服务器失败",
  "Failed to update RADIUS server": "更新 RADIUS 服务器失败",
  "Authentication method": "认证方式",
  "Authentication Type": "认证类型",
  Secret: "共享密钥",
  "Override server IP address": "覆盖服务器 IP 地址",
  "Auto-discover KDC": "自动发现 KDC",
  Test: "测试",
  "Testing…": "正在测试…",
  "Test Connectivity": "测试连通性",
  "Test User Credentials": "测试用户凭据",

  // -- Exchange connector ----------------------------------------------------
  "Exchange account": "Exchange 账号",
  "Exchange server": "Exchange 服务器",
  "Exchange Server Connector": "Exchange 服务器连接器",
  "New External Connector": "新建外部连接器",
  "Connector Settings": "连接器设置",
  "Failed to create Exchange connector": "创建 Exchange 连接器失败",
  ", domain": "，域",
  ", server": "，服务器",

  // -- Small controls --------------------------------------------------------
  "< Back": "< 返回",
  Submit: "提交",
  Yes: "是",
  No: "否",

  // -- SMS dial-code countries ----------------------------------------------
  "United States / Canada": "美国 / 加拿大",
  "Russia / Kazakhstan": "俄罗斯 / 哈萨克斯坦",
  "South Korea": "韩国",
  Macau: "澳门",
  "International Freephone": "国际免费电话",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Administrators reach every device": "管理员可访问所有设备",
  "After First Login": "首次登录后",
  "Anonymous": "匿名",
  "Default": "默认",
  "Edit this user to change which devices they can work on": "编辑此用户以更改其可操作的设备",
  "events logged": "已记录的事件",
  "Firewall": "防火墙",
  "FortiNAC User": "FortiNAC 用户",
  "No activity recorded yet.": "尚未记录任何活动。",
  "No results found.": "未找到结果。",
  "Not supported yet — this app builds Local Users only": "尚不支持 — 本应用只创建本地用户",
  "On Account Creation": "创建账号时",
  "registered accounts": "已注册的账号",
  "Regular": "常规",
  "Remote LDAP User": "远程 LDAP 用户",
  "Remote RADIUS User": "远程 RADIUS 用户",
  "Remote TACACS+ User": "远程 TACACS+ 用户",
  "Required": "必填",
  "Test failed": "测试失败",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "All Groups": "所有组",
  "Auth Method": "认证方式",
  "Connection": "连接",
  "Device access": "设备访问权限",
  "Group Name": "组名称",
  "Group Type": "组类型",
  "Groups": "组",
  "Primary Server": "主服务器",
  "Secondary Server": "备用服务器",
  "Ref.": "引用",
  "Clearing this field will not remove the server — the FortiGate's REST API cannot unset a secondary RADIUS host. Change it to a different address here, or remove it from the CLI with `config user radius / edit <name> / unset secondary-server`.": "清空此字段并不会移除该服务器 — FortiGate 的 REST API 无法取消设置备用 RADIUS 主机。请在此改为另一个地址，或用 CLI 执行 `config user radius / edit <name> / unset secondary-server` 将其移除。",
  "FortiOS 7.2.10 has no LDAP test endpoint — monitor/user/ldap/query, /test-connect and /test-user-credentials all return 404 on this device.": "FortiOS 7.2.10 没有 LDAP 测试接口 — 在此设备上，monitor/user/ldap/query、/test-connect 和 /test-user-credentials 全部返回 404。",
  "Save the RADIUS server first — the FortiGate tests a stored server by name.": "请先保存 RADIUS 服务器 — FortiGate 是按名称测试已保存的服务器的。",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP/Name": "IP / 名称",
  "Server IP/Name is required": "必须填写服务器 IP / 名称",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Admin": "管理员",
  "Login": "登录",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Add to a user group": "加入用户组",
  "Ask for a company": "询问公司",
  "Ask for a mobile number": "询问手机号码",
  "Ask for a name": "询问姓名",
  "Ask for a password": "询问密码",
  "Ask for a sponsor": "询问担保人",
  "Ask for an email address": "询问电子邮件地址",
  "Batch guest account creation": "批量创建访客账户",
  "Limit the number of accounts": "限制账户数量",
  "Secure connection": "安全连接",
  "Send the code by SMS": "通过短信发送验证码",
  "Two-factor authentication": "双因素认证",
  "Use a certificate": "使用证书",
  "Use an Exchange server": "使用 Exchange 服务器",

  "AAA servers this firewall can hand authentication off to.": "本防火墙可以把认证转交给这些 AAA 服务器。",
  "Directory servers this firewall can check for authentication.": "本防火墙可以向这些目录服务器核验身份。",
  "FIREWALL AUTOMATION": "防火墙自动化",
  "Local and remote accounts that can authenticate through this firewall.": "可以通过本防火墙完成认证的本地账号和远端账号。",
  "Named groups of users, referenced from firewall policy and authentication rules.": "具名的用户组，可被防火墙策略和认证规则引用。",
};
