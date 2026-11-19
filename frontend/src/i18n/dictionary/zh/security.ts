/**
 * Simplified Chinese — the six Security Profile forms: AntiVirus, Web Filter, DNS Filter,
 * Application Control, File Filter and SSL/SSH Inspection, plus Web Rating Overrides.
 *
 * Two things in here are the console repeating what the FortiGate said about its own licensing —
 * the "not licensed for FortiGuard web filtering" and "signature database not available" notices.
 * They are translated, because they are the console's own sentences about the device's state, not
 * the device's error text.
 *
 * FortiGuard's category names (Adult/Mature Content, Bandwidth Consuming, Potentially Liable …) are
 * translated as headings but the categories themselves are matched by numeric ID on the device, so
 * nothing downstream depends on the wording here.
 */
import type { Dict } from "../merge";

export const security: Dict = {
  // -- Shared form chrome ----------------------------------------------------
  "Profile Name": "配置文件名称",
  Comment: "备注",
  "Loading profile…": "正在加载配置文件…",
  "Select profiles": "选择配置文件",
  "Apply to": "应用于",
  Protocols: "协议",
  "Enforce protocols": "强制应用于协议",
  "Select at least one protocol": "请至少选择一个协议",
  "Proxy Options": "代理选项",
  Traffic: "流量",
  Filter: "过滤器",
  "Pre-configured filters": "预设过滤器",
  Predefined: "预定义",
  "No more entries": "没有更多条目",

  // -- Actions ---------------------------------------------------------------
  Allow: "允许",
  Block: "阻断",
  Monitor: "监控",
  Ask: "询问",
  Warning: "警告",
  Authenticate: "认证",
  Quarantine: "隔离",
  "Violation action": "违规处理动作",
  "HTTP POST Action": "HTTP POST 处理动作",
  "Remove Cookies": "移除 Cookie",
  "Authenticate — which user groups may proceed?": "认证 — 哪些用户组可以继续访问？",
  "Groups that can override": "可执行覆盖的用户组",
  "Select user groups": "选择用户组",
  "Pick at least one group — FortiGate rejects the profile without it":
    "请至少选择一个用户组 — 否则 FortiGate 会拒绝此配置文件",
  "The original user or group must be specified as the 'Source' in firewall policies using this profile":
    "在使用此配置文件的防火墙策略中，必须把原始用户或用户组指定为“源”",

  // -- AntiVirus -------------------------------------------------------------
  "AntiVirus scan": "病毒扫描",
  "Include mobile malware protection": "包含移动端恶意软件防护",
  "Treat Windows executables in email attachments as viruses":
    "将邮件附件中的 Windows 可执行文件视为病毒",
  "Send files to FortiSandbox for inspection": "将文件发送到 FortiSandbox 进行检测",
  "Block malicious URLs discovered by FortiSandbox":
    "阻断 FortiSandbox 发现的恶意 URL",
  "Use FortiGuard outbreak prevention database": "使用 FortiGuard 爆发防护数据库",
  "Use external malware block list": "使用外部恶意软件阻断列表",
  "Use EMS threat feed": "使用 EMS 威胁情报源",
  "External IP Block Lists": "外部 IP 阻断列表",
  "Select external resources": "选择外部资源",
  "No scan options set for any of the inspected protocols.":
    "所检测的协议均未设置任何扫描选项。",
  "0 domains in botnet package": "僵尸网络特征库中有 0 个域名",
  "Botnet package update unavailable, AntiVirus subscription not found.":
    "无法更新僵尸网络特征库，未找到防病毒订阅。",
  "Redirect botnet C&C requests to Block Portal":
    "将僵尸网络 C&C 请求重定向到阻断门户",

  // -- Web Filter ------------------------------------------------------------
  "URL Filter": "URL 过滤器",
  "Local Categories": "本地类别",
  "Set all categories": "设置所有类别",
  "Choose an action to apply to every category": "选择一个要应用到所有类别的动作",
  "Select a category…": "选择一个类别…",
  "Loading FortiGuard categories…": "正在加载 FortiGuard 类别…",
  "No categories returned by the device.": "设备没有返回任何类别。",
  "The device did not return its category list, so there is nothing to choose from.":
    "设备没有返回类别列表，因此没有可供选择的内容。",
  "Warning: This device is not licensed for the FortiGuard web filtering service.":
    "警告：此设备没有 FortiGuard Web 过滤服务的授权。",
  "Allow websites when a rating error occurs": "评级出错时放行网站",
  "Block invalid URLs": "阻断无效的 URL",
  "Rate URLs by domain and IP Address": "按域名和 IP 地址对 URL 评级",
  "Rating Options": "评级选项",
  "Enforce 'Safe Search' on Google, Bing, YouTube":
    "在 Google、Bing、YouTube 上强制启用“安全搜索”",
  "Restrict YouTube Access": "限制 YouTube 访问",
  "Content Filter": "内容过滤器",
  "Pattern Type": "模式类型",
  Pattern: "模式",
  "Traffic may be blocked if this option is enabled.": "启用此选项后流量可能被阻断。",
  "Adult/Mature Content": "成人/限制级内容",
  "Bandwidth Consuming": "高带宽消耗",
  "General Interest - Business": "一般兴趣 - 商务",
  "General Interest - Personal": "一般兴趣 - 个人",
  "Potentially Liable": "可能涉及法律责任",
  "Security Risk": "安全风险",
  Unrated: "未评级",

  // -- Web rating override ---------------------------------------------------
  "web rating override": "Web 评级覆盖",
  "Web rating override deleted": "Web 评级覆盖已删除",
  "Failed to delete the web rating override": "删除 Web 评级覆盖失败",
  "Loading web rating override…": "正在加载 Web 评级覆盖…",
  "Search web rating overrides…": "搜索 Web 评级覆盖…",
  "Ask the device how FortiGuard rates this URL today":
    "询问设备 FortiGuard 目前如何评级此 URL",
  "Device rating for": "设备对以下 URL 的评级：",
  "The device returned no rating for": "设备未返回以下 URL 的评级：",
  "Rating lookup failed": "评级查询失败",
  "The override for": "以下项的覆盖设置：",
  "Override to": "覆盖为",
  "— it has no active FortiGuard web filtering contract to look one up with.":
    "— 它没有有效的 FortiGuard Web 过滤合约，因而无法进行查询。",

  // -- DNS Filter ------------------------------------------------------------
  "Domain Filter": "域名过滤器",
  Domain: "域名",
  "DNS Translation": "DNS 转换",
  "Original Destination": "原始目标",
  "Translated Destination": "转换后的目标",
  "Network Mask": "网络掩码",
  "Log all DNS queries and responses": "记录所有 DNS 查询与响应",
  "Allow DNS requests when a rating error occurs": "评级出错时放行 DNS 请求",
  "Redirect to Block Portal": "重定向到阻断门户",
  "Redirect Portal IP": "阻断门户 IP",
  "DNS lookups cannot be rated, so category actions below will not take effect.":
    "DNS 查询无法评级，因此下面的类别动作不会生效。",

  // -- Application Control ---------------------------------------------------
  "Application Category": "应用类别",
  "Sub-Category": "子类别",
  Technology: "技术",
  Behavior: "行为",
  Popularity: "流行度",
  Risk: "风险",
  Vendor: "厂商",
  Cloud: "云",
  "Add All Results": "添加全部结果",
  "Application signature database not available on this device":
    "此设备上没有应用特征库",
  "Protocol and Vendor lists come from the live signature database (not available on this device).":
    "协议与厂商列表来自实时特征库（此设备上不可用）。",
  "This form reads the same source the FortiGate GUI uses for its 2,414-app table (":
    "此表单读取的数据源与 FortiGate GUI 用于其 2,414 个应用表格的数据源相同（",
  "), but this device's FortiGuard Application Control service returns no signatures (unlicensed / cloud unreachable), so there are none to pick — and this form never saves a made-up ID. Use a":
    "），但此设备的 FortiGuard 应用控制服务没有返回任何特征（未授权 / 无法连接云端），因此没有可选项 — 并且此表单绝不会保存凭空编造的 ID。请改用",
  "override to match applications by category, risk, technology, behavior or popularity (no signature database required), or connect a device whose FortiGuard Application Control service is active to browse the full list.":
    "覆盖规则，按类别、风险、技术、行为或流行度匹配应用（无需特征库）；或者连接一台 FortiGuard 应用控制服务有效的设备以浏览完整列表。",

  // -- File Filter -----------------------------------------------------------
  "Match Files": "匹配文件",
  "File types": "文件类型",
  "No file types": "没有文件类型",
  "Search file types": "搜索文件类型",
  "Select at least one file type": "请至少选择一种文件类型",
  "Only formats that can carry a password are matchable, so File types is limited to":
    "只有可以设置密码的格式才能匹配，因此“文件类型”仅限于",
  "Traffic direction applies to HTTP, FTP, SSH and CIFS only — with just mail protocols selected the FortiGate always matches both directions.":
    "流量方向仅对 HTTP、FTP、SSH 和 CIFS 生效 — 若只选择了邮件协议，FortiGate 始终会匹配双向流量。",

  // -- Override durations ----------------------------------------------------
  "Switch to Filter override": "切换为过滤器覆盖",
  "Switch applies to": "切换适用于",
  "Switch Duration": "切换时长",
  "minute(s)": "分钟",
  "hour(s)": "小时",
  "day(s)": "天",

  // -- Field hints -----------------------------------------------------------
  "e.g. custom-av-profile": "例如 custom-av-profile",
  "e.g. corp-web-filter": "例如 corp-web-filter",
  "e.g. custom-dns-filter": "例如 custom-dns-filter",
  "e.g. corp-app-sensor": "例如 corp-app-sensor",
  "e.g. block-executables": "例如 block-executables",
  "e.g. block-risky-files": "例如 block-risky-files",
  "e.g. example*": "例如 example*",
  "e.g. *.facebook.com": "例如 *.facebook.com",
  "e.g. www.example.com": "例如 www.example.com",
  "e.g. 10.1.1.1": "例如 10.1.1.1",
  "e.g. 10.2.2.2": "例如 10.2.2.2",
  "e.g. 53": "例如 53",
  "Failed to change the status": "更改状态失败",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Add New Override": "新增覆盖规则",
  "New Web Rating Override": "新建网页评级覆盖",
  "Put a URL in the category you say it belongs to, whatever FortiGuard rates it.":
    "由你指定 URL 属于哪个类别，无论 FortiGuard 把它评为什么。",
  "Edit Override": "编辑覆盖规则",
  "Enable this override": "启用此覆盖规则",
  "Disable this override": "禁用此覆盖规则",
  "Lookup rating": "查询评级",
  "Looking up…": "正在查询…",
  "All applications": "所有应用",
  "No applications": "没有应用",
  "Application": "应用",
  "AntiVirus profile": "防病毒配置文件",
  "Web Filter profile": "Web 过滤配置文件",
  "DNS Filter profile": "DNS 过滤配置文件",
  "File Filter profile": "文件过滤配置文件",
  "Application Control list": "应用控制列表",
  "SSL/SSH Inspection profile": "SSL/SSH 检测配置文件",
  "New AntiVirus Profile": "新建防病毒配置文件",
  "New Web Filter Profile": "新建 Web 过滤配置文件",
  "New DNS Filter Profile": "新建 DNS 过滤配置文件",
  "New File Filter Profile": "新建文件过滤配置文件",
  "New Application Sensor": "新建应用传感器",
  "Both": "两者",
  "Incoming": "入站",
  "Outgoing": "出站",
  "Cloud Applications require deep inspection.": "云应用需要深度检测。",
  "Create New File Filter Rule": "新建文件过滤规则",
  "Edit File Filter Rule": "编辑文件过滤规则",
  "Custom Categories": "自定义类别",
  "Edit Default Network Service": "编辑默认网络服务",
  "New Default Network Service": "新建默认网络服务",
  "Edit DNS Translation": "编辑 DNS 转换",
  "New DNS Translation": "新建 DNS 转换",
  "Edit Domain Filter": "编辑域名过滤",
  "New Domain Filter": "新建域名过滤",
  "Edit URL Filter": "编辑 URL 过滤",
  "New URL Filter": "新建 URL 过滤",
  "Edit Web Content Filter": "编辑网页内容过滤",
  "New Web Content Filter": "新建网页内容过滤",
  "Exempt": "豁免",
  "Regular Expression": "正则表达式",
  "Wildcard": "通配符",
  "Simple": "简单",
  "Strict": "严格",
  "Moderate": "适中",
  "Cyrillic": "西里尔文",
  "French": "法语",
  "Japanese": "日语",
  "Korean": "韩语",
  "Spanish": "西班牙语",
  "Thai": "泰语",
  "Simplified Chinese": "简体中文",
  "Traditional Chinese": "繁体中文",
  "Western": "西文",
  "FortiSandbox is not configured on this device. Configure a FortiSandbox connector (Security Fabric → Fabric Connectors) to enable this option.": "此设备未配置 FortiSandbox。请先配置 FortiSandbox 连接器（Security Fabric → Fabric Connectors）才能启用此选项。",
  "Requires an active FortiGuard AntiVirus subscription. This device's AntiVirus license is not active (expired or unlicensed).": "需要有效的 FortiGuard 防病毒订阅。此设备的防病毒许可证未生效（已过期或未授权）。",
  "No user group — the device will reject this": "未选择用户组 — 设备将拒绝此项",
  "This device has no user groups — create one first": "此设备上还没有用户组 — 请先创建一个",
  "This device has no external resources — add one under Security Fabric → External Connectors": "此设备上还没有外部资源 — 请在 Security Fabric → External Connectors 中添加",
  "Use FortiGuard Default": "使用 FortiGuard 默认值",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Details": "详情",
  "Enforce Protocols": "强制协议",
  "File Types": "文件类型",
  "Network Mask/Prefix": "网络掩码 / 前缀",
  "Violation Action": "违规处理动作",
  "Must be inspecting at least one protocol and enable AntiVirus scan to use this feature.": "必须至少检测一种协议并启用防病毒扫描，才能使用此功能。",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Application Control profile": "应用控制配置文件",
  "Unknown Applications": "未知应用",
  "allow": "允许",
  "block": "阻断",
  "Block traffic from an application seen on a port other than its known default.": "阻断在非其已知默认端口上出现的应用流量。",
  "Inspect files packed inside archives (zip, rar, 7z…) against the rules below.": "按下方规则检查压缩包（zip、rar、7z…）中的文件。",
  "Rewrite the address in a DNS reply — the client resolves the original destination to the translated one.": "改写 DNS 应答中的地址 — 客户端会把原始目的地解析为转换后的地址。",
  "Use FortiGuard outbreak prevention database, external malware block list, or EMS threat feed to preempt outbreaks before AV signatures are created. Must be inspecting at least one protocol and enable AntiVirus scan to use this feature.": "使用 FortiGuard 爆发防护数据库、外部恶意软件阻断列表或 EMS 威胁情报源，在防病毒特征库生成之前先行拦截爆发。必须至少检测一种协议并启用防病毒扫描，才能使用此功能。",

  // -- Language names — shared by the Web Filter content list and the navbar switcher ---
  "English": "英语",
  "Chinese": "中文",

  // -- Profile list ------------------------------------------------------------
  "Built-in": "内置",
  "FortiOS ships this profile and does not allow it to be changed. Create a new one instead.":
    "此配置文件由 FortiOS 预置，不允许修改。请新建一个。",
  "IPS sensor": "IPS 传感器",

  // -- IPS sensor form -----------------------------------------------------------
  "New IPS Sensor": "新建 IPS 传感器",
  "Loading sensor…": "正在加载传感器…",
  "e.g. block-critical-attacks": "例如 block-critical-attacks",
  "Scan outgoing connections to botnet sites": "扫描连接到僵尸网络站点的出站连接",
  "Block malicious URLs": "阻断恶意 URL",
  "Extended logging": "扩展日志",
  "IPS Signatures and Filters": "IPS 特征与过滤器",
  "Signature Database": "特征库",
  "signatures on this device": "本设备上的特征数",
  "Not readable from this device — filter lists fall back to FortiOS defaults.":
    "无法从此设备读取——过滤器列表将回退为 FortiOS 默认值。",
  "This firewall did not return its IPS signature database, so the filter lists below are FortiOS's generic ones rather than this unit's. Filters still work; the signature picker will be empty. An expired IPS subscription is the usual cause.":
    "此防火墙没有返回其 IPS 特征库，因此下方的过滤器列表是 FortiOS 的通用列表，而非本机的。过滤器仍然有效，但特征选择器将为空。通常原因是 IPS 订阅已过期。",
  "A sensor with no entries inspects nothing. Add at least one filter or signature entry before saving — otherwise a policy can show IPS as \"on\" while no traffic is examined.":
    "没有任何条目的传感器不会检测任何流量。保存前请至少添加一个过滤器或特征条目——否则策略可能显示 IPS 为“开启”，却没有检测任何流量。",
  "New IPS Entry": "新建 IPS 条目",
  "Edit IPS Entry": "编辑 IPS 条目",
  "signature": "特征",
  "Signatures": "特征",
  "Target": "目标",
  "OS / Application": "操作系统 / 应用",
  "Packet Log": "数据包日志",
  "Match signatures by their attributes — this keeps working as FortiGuard adds new ones.":
    "按属性匹配特征——FortiGuard 添加新特征后依然有效。",
  "Pick exact signatures by name or CVE. Precise, but it will not cover signatures added later.":
    "按名称或 CVE 精确选择特征。精确，但不会覆盖之后新增的特征。",
  "Nothing selected = every severity.": "未选择 = 所有严重级别。",
  "Nothing selected = both directions.": "未选择 = 双向。",
  "Client": "客户端",
  "Search protocols…": "搜索协议…",
  "Search operating systems…": "搜索操作系统…",
  "Search applications…": "搜索应用…",
  "Search signatures by name, id or severity…": "按名称、ID 或严重级别搜索特征…",
  "none selected": "未选择",
  "This device did not return a signature database — pick signatures by CVE below, or use a filter entry instead.":
    "此设备没有返回特征库——请在下方按 CVE 选择特征，或改用过滤器条目。",
  "CVE IDs": "CVE 编号",
  "Comma separated. Wildcards are allowed, e.g.": "以逗号分隔。可使用通配符，例如",
  "Log matches": "记录匹配",
  "Packet capture": "数据包捕获",
  "Attacker": "攻击者",
  "The source address is banned for every service, not just the one that tripped the signature. A false positive takes that host off the network entirely.":
    "源地址会被禁止访问所有服务，而不仅是触发特征的那一个。一旦误报，该主机将完全无法使用网络。",
  "Use whatever each matched signature recommends. This is what the built-in sensors do.":
    "采用每个匹配特征推荐的动作。内置传感器就是这样做的。",
  "Let the traffic through even when a signature matches. Logs still fire.":
    "即使匹配到特征也放行流量，但仍会记录日志。",
  "Drop the packet.": "丢弃数据包。",
  "Drop the packet and tear the session down with a TCP reset.": "丢弃数据包，并用 TCP reset 断开会话。",

  // -- SSL/SSH inspection form ---------------------------------------------------
  "New SSL/SSH Inspection Profile": "新建 SSL/SSH 检测配置文件",
  "e.g. outbound-deep-inspect": "例如 outbound-deep-inspect",
  "Before you deploy": "部署之前",
  "Deep inspection re-signs every certificate with the CA chosen here. Every device on the network must already trust that CA, or users see a warning on every HTTPS site. Export it from the FortiGate's own":
    "深度检测会用此处选择的 CA 重新签发每一张证书。网络中的每台设备都必须事先信任该 CA，否则用户在每个 HTTPS 网站上都会看到警告。请从 FortiGate 自己的",
  "and push it to your endpoints first.": "导出，并先推送到各终端。",
  "This firewall runs": "此防火墙使用",
  "inspection, so it does not have the proxy-only half of this profile — per-protocol ports and status, certificate handling outside the default block, exemptions, and the reputable-website allowlist. Those controls are greyed out below: the device would accept them and store nothing. Enable":
    "检测，因此没有此配置文件中仅代理模式才有的部分——各协议的端口和状态、默认块之外的证书处理、豁免以及信誉网站白名单。这些控件在下方显示为灰色：设备会接受这些设置，但什么也不会保存。启用",
  "in": "在",
  "to use them.": "中即可使用这些功能。",
  "Enable SSL inspection of": "启用 SSL 检测的对象",
  "Multiple Clients Connecting to Multiple Servers": "多个客户端连接多个服务器",
  "Protecting SSL Server": "保护 SSL 服务器",
  "Outbound: your users reaching the internet. The firewall re-signs each site's certificate with the CA below.":
    "出站：您的用户访问互联网。防火墙会用下方的 CA 重新签发每个站点的证书。",
  "Inbound: clients reaching a server you own. The firewall presents that server's own certificate.":
    "入站：客户端访问您自己的服务器。防火墙会出示该服务器自己的证书。",
  "CA certificate": "CA 证书",
  "Untrusted CA certificate": "不受信任的 CA 证书",
  "Server certificates": "服务器证书",
  "No certificates on this device": "此设备上没有证书",
  "Protocol Port Mapping": "协议端口映射",
  "Exempt from SSL Inspection": "免于 SSL 检测",
  "Exempt reputable websites": "豁免信誉良好的网站",
  "FortiGuard's own list of sites known to break under interception — banks, software updaters, OS telemetry.":
    "FortiGuard 自己维护的、被拦截检测后会出问题的网站列表——银行、软件更新程序、操作系统遥测。",
  "Not available on a flow-based FortiGate.": "在基于 flow 的 FortiGate 上不可用。",
  "Block certificates on the FortiGuard blocklist": "阻断 FortiGuard 阻止列表中的证书",
  "Per-site exemptions need proxy inspection. On this firewall, exclude traffic from inspection with a firewall policy that uses the":
    "按站点豁免需要代理检测。在此防火墙上，请改用引用",
  "profile instead.": "配置文件的防火墙策略，将流量排除在检测之外。",
  "Common Options": "通用选项",
  "Supported ALPN": "支持的 ALPN",
  "Inspect RPC over HTTPS": "检测 RPC over HTTPS",
  "Inspect MAPI over HTTPS": "检测 MAPI over HTTPS",
  "SSL anomalies": "SSL 异常",
  "SSL negotiation": "SSL 协商",
  "Server certificate details": "服务器证书详情",
  "Handshake details": "握手详情",
  "Exempted sessions": "已豁免的会话",
  "This profile decrypts traffic. Attaching it to a policy without first distributing":
    "此配置文件会解密流量。若未先将",
  "the CA certificate": "CA 证书",
  "to your endpoints will produce a certificate warning on every HTTPS site.":
    "分发到各终端就将其关联到策略，每个 HTTPS 网站都会出现证书警告。",
  "Default (other ports)": "默认（其他端口）",
  "Ports": "端口",
  "no ports — inspects nothing": "没有端口——不检测任何流量",
  "TLS on any port no block below claims": "未被下方任何块认领的任意端口上的 TLS",
  "Inspect all SSH ports": "检测所有 SSH 端口",
  "Inspect SSH found on any port, not just the ones listed above.": "检测在任意端口上发现的 SSH，而不仅是上面列出的端口。",
  "Deep": "深度",
  "Unsupported SSH version": "不支持的 SSH 版本",
  "What to do with an SSH version this firewall cannot inspect.": "如何处理此防火墙无法检测的 SSH 版本。",
  "Bypass": "绕过",
  "SSH algorithm": "SSH 算法",
  "high-encryption restricts the session to strong ciphers; older clients may fail to connect.":
    "high-encryption 会将会话限制为强加密套件；旧客户端可能无法连接。",
  "Compatible": "兼容",
  "High encryption": "高强度加密",
  "SSH tunnel policy check": "SSH 隧道策略检查",
  "Ignore": "忽略",
  "Inspect": "检测",
  "Expired certificate": "已过期的证书",
  "A server certificate whose validity period has passed.": "有效期已过的服务器证书。",
  "Revoked certificate": "已吊销的证书",
  "A certificate the issuing CA has withdrawn.": "已被签发 CA 撤回的证书。",
  "Untrusted certificate": "不受信任的证书",
  "Signed by a CA this firewall does not trust. FortiOS allows these by default.":
    "由此防火墙不信任的 CA 签发。FortiOS 默认允许这类证书。",
  "Certificate validation failure": "证书验证失败",
  "Certificate validation timeout": "证书验证超时",
  "Client certificate": "客户端证书",
  "What to do when the client presents a certificate of its own.": "客户端出示自己的证书时如何处理。",
  "SNI / server certificate check": "SNI / 服务器证书检查",
  "Strict requires the certificate to match the name the client asked for.": "Strict 要求证书与客户端请求的名称一致。",
  "Minimum TLS version": "最低 TLS 版本",
  "Sessions negotiating below this are treated as unsupported.": "协商低于此版本的会话将被视为不受支持。",
  "Unsupported TLS version": "不支持的 TLS 版本",
  "Unsupported cipher": "不支持的加密套件",
  "Failed handshake": "握手失败",
  "Certificate probe failure": "证书探测失败",
  "Proxy after TCP handshake": "TCP 握手后代理",
  "inspection reads only the certificate — enough for Web Filter to see the site name, but AntiVirus and Application Control still cannot see inside.":
    "检测只读取证书——足以让 Web Filter 看到站点名称，但 AntiVirus 和 Application Control 仍然看不到内容。",
  "inspection decrypts the session, which is what the other Security Profiles need — and what requires the CA above to be trusted by every endpoint.":
    "检测会解密会话，这是其他安全配置文件所需要的——也因此要求每个终端都信任上面的 CA。",
  "Deep inspection breaks certificate pinning. Banking apps, software updaters and some mobile apps will fail until they are exempted below.":
    "深度检测会破坏证书固定（certificate pinning）。银行应用、软件更新程序和部分移动应用将无法使用，直到在下方将其豁免。",
  "IPv6 Address": "IPv6 地址",
  "IPv6 address": "IPv6 地址",
  "Regex": "正则表达式",
  "Value": "值",
  "New Exemption": "新建豁免",
  "Edit Exemption": "编辑豁免",
  "This device returned no FortiGuard categories — an inactive web-filtering subscription. Use an address or wildcard FQDN instead.":
    "此设备没有返回 FortiGuard 分类——Web 过滤订阅未激活。请改用地址或通配符 FQDN。",
  "Select an address object…": "选择地址对象…",
  "an IPv6 address object name": "IPv6 地址对象名称",
  "Select an FQDN object…": "选择 FQDN 对象…",
  "Only FQDN-type address objects appear here — the device rejects anything else in this slot.":
    "此处只显示 FQDN 类型的地址对象——设备会拒绝其他类型。",

  // -- The noun ProfileLoadGuard names when a profile could not be read --------------
  "Application sensor": "应用控制传感器",
  "SSL/SSH profile": "SSL/SSH 配置文件",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Content entry action": "内容条目动作",
  "Content entry status": "内容条目状态",
  "Domain entry action": "域名条目动作",
  "Domain entry status": "域名条目状态",
  "Domain entry type": "域名条目类型",
  "Exempt entry type": "豁免条目类型",
  "External IP block lists": "外部 IP 阻止列表",
  "External list status": "外部列表状态",
  "FortiGuard category based filter": "基于 FortiGuard 分类的过滤",
  "Inspection mode": "检测模式",
  "Match files": "匹配文件",
  "Override action": "覆盖动作",
  "Override type": "覆盖类型",
  "Rule action": "规则动作",
  "Signature action": "特征码动作",
  "Signature filter type": "特征码筛选类型",
  "Signature status": "特征码状态",
  "URL entry action": "URL 条目动作",
  "URL entry status": "URL 条目状态",
  "URL entry type": "URL 条目类型",

  // The Security Profiles landing page: one caption per profile type, plus Web Rating Overrides.
  "Delete web rating override": "删除网站分级覆盖",
  "No comment": "无备注",
  "Profiles that allow, block or monitor web traffic by category and URL.": "按类别和 URL 允许、阻断或监控网页流量的配置文件。",
  "Profiles that block DNS lookups for botnet and category-based domains.": "阻断僵尸网络域名和按类别划分域名的 DNS 查询的配置文件。",
  "Profiles that block or log files by type as they pass through the firewall.": "在文件穿过防火墙时按类型阻断或记录的配置文件。",
  "Profiles that decide how deeply encrypted traffic is inspected.": "决定对加密流量检测深度的配置文件。",
  "Profiles that scan traffic for malware as it crosses the firewall.": "在流量穿过防火墙时扫描恶意软件的配置文件。",
  "Sensors that identify and control traffic by the application generating it.": "按产生流量的应用来识别和管控流量的传感器。",
  "Sensors that match traffic against known exploit and attack signatures.": "将流量与已知漏洞利用和攻击特征进行匹配的传感器。",
  "This web rating override will be permanently removed from": "此网站分级覆盖将被永久删除，来源：",
};
