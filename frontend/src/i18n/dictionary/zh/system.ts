/**
 * Chinese — Log Settings, HA Status and Administrators.
 *
 * The device's own configuration rather than the traffic through it. See the Thai file for the
 * renderings that carry weight; the same care applies here — 可从任意地址登录 for an account
 * with no trusted host, 只读 for a permission level.
 */

import type { Dict } from "../merge";

export const system: Dict = {
  "Log Settings": "日志设置",
  "log setting": "日志设置",
  "Where the logs go": "日志送到哪里",
  "What gets logged": "哪些内容会被记录",
  "Which events produce a log line at all": "哪些事件才真的会产生一条日志",
  "Nowhere — no log destination is both switched on and configured.":
    "哪儿也没去 — 没有一个日志目的地是既启用又配置完整的。",
  "Logging may well be configured — this is 'unreadable', not 'off'":
    "设备上可能确实配置了日志 — 这是“读不到”，不是“关着”",
  "Each section saves on its own. On the device they are five separate settings tables, and one of them refusing a change should not undo the others.":
    "每个部分单独保存。在设备上它们是五张互相独立的设置表，其中一张拒绝修改，不应该连累其他几张。",
  "is switched on with no server address, so it is sending nothing.": "已启用但没有填服务器地址，因此什么也没发出去。",
  "What this firewall records, and where it puts it": "这台防火墙记录什么，以及把它放在哪里",
  "Available": "可用",
  "Not available": "不可用",
  "Needs a server": "需要填写服务器",
  "Memory buffer": "内存缓冲区",
  "Cleared on reboot — every unit has one": "重启即清空 — 每台设备都有",
  "Log to memory": "记录到内存",
  "Local disk": "本地磁盘",
  "Survives a reboot": "重启后仍在",
  "This model has no log disk": "该型号没有日志磁盘",
  "no disk": "没有磁盘",
  "Log to disk": "记录到磁盘",
  "Keep logs for (days)": "日志保留天数",
  "A collector somewhere else — the usual way logs outlive the firewall":
    "放在别处的收集器 — 让日志活得比防火墙久的常用做法",
  "Send logs to syslog": "把日志发往 syslog",
  "Fortinet's own log collector": "Fortinet 自家的日志收集器",
  "Send logs to FortiAnalyzer": "把日志发往 FortiAnalyzer",
  "Reliable transport": "可靠传输",
  "How often": "发送频率",
  "Real time": "实时",
  "Every minute": "每分钟",
  "Every 5 minutes": "每 5 分钟",
  "Store and upload": "先存后传",
  "Transport": "传输方式",
  "UDP loses entries silently under load.": "负载高时 UDP 会悄悄丢日志。",
  "Format": "格式",
  "The port must be between 0 and 65535.": "端口必须在 0 到 65535 之间。",
  "A syslog destination needs a server address — switched on without one it sends nothing.":
    "syslog 目的地必须填服务器地址 — 只开启不填，什么都不会发出去。",
  "A FortiAnalyzer destination needs a server address.": "FortiAnalyzer 目的地必须填服务器地址。",
  "The maximum log file size cannot be negative.": "日志文件最大尺寸不能为负。",
  "The maximum log age cannot be negative.": "日志最长保留天数不能为负。",
  "Log traffic denied by the implicit rule": "记录被隐式规则拒绝的流量",
  "The single most important one. Without it, everything the last rule refuses is invisible.":
    "最重要的一项。不开它，最后一条规则拒绝的一切都看不见。",
  "Log accepted traffic to the firewall itself": "记录被放行、发往防火墙自身的流量",
  "Administrative logins, VPN connections, routing protocols.": "管理登录、VPN 连接、路由协议。",
  "Log denied traffic to the firewall": "记录被拒绝、发往防火墙的流量",
  "What a local-in policy refused. Empty without this even when rules are blocking.":
    "Local-in 策略拒绝掉的东西。不开它，即使规则正在拦截，这里也是空的。",
  "Log denied broadcasts to the firewall": "记录被拒绝、发往防火墙的广播",
  "Noisy on a busy segment — usually left off.": "在繁忙网段上会非常吵 — 一般关着。",
  "Log traffic the firewall itself sends": "记录防火墙自己发出的流量",
  "Its own DNS, NTP, FortiGuard and update traffic.": "它自己的 DNS、NTP、FortiGuard 和更新流量。",
  "Log invalid packets": "记录无效报文",
  "Malformed or out-of-state packets the kernel drops before any policy sees them.":
    "内核在任何策略看到之前就丢掉的畸形或脱离状态的报文。",
  "Resolve addresses to host names": "把地址解析成主机名",
  "Readable, and it makes the firewall do a lookup for every line it writes.":
    "更好读，代价是防火墙每写一行都要做一次查询。",
  "Show service names instead of port numbers": "显示服务名而不是端口号",
  "443 becomes HTTPS.": "443 会显示成 HTTPS。",
  "Include the policy comment in each entry": "在每条记录里带上策略备注",
  "Puts the rule's own description next to what it matched.": "把规则自己的描述放在它匹配到的内容旁边。",
  "Brief traffic format": "精简流量格式",
  "Fewer fields per line. Smaller logs, less to investigate with.": "每行字段更少。日志更小，可供排查的信息也更少。",
  "Anonymise user names": "匿名化用户名",
  "Replaces the user in each entry with a hash.": "把每条记录里的用户替换成哈希值。",
  "System": "系统",
  "HA Status": "HA 状态",
  "HA setting": "HA 设置",
  "Whether this unit is on its own or part of a cluster, and how healthy that cluster is":
    "这台设备是单机运行，还是集群的一部分，以及该集群的健康状况",
  "Clustered": "已组建集群",
  "Standalone": "单机",
  "This is 'unreadable', not 'standalone'": "这是“读不到”，不是“standalone”",
  "the device did not answer": "设备没有响应",
  "Standalone — this unit is on its own": "Standalone — 这台设备是单机",
  "Active-passive — one unit carries the traffic, the other waits":
    "Active-passive — 一台承载流量，另一台待命",
  "Active-active — both units carry traffic": "Active-active — 两台都承载流量",
  "This unit is standalone, but it still holds HA settings. They survive being taken out of a cluster and are not doing anything.":
    "这台设备是单机，但仍然保留着 HA 设置。它们在被移出集群后依然留着，并没有起任何作用。",
  "Group name": "组名",
  "Group ID": "组 ID",
  "priority": "优先级",
  "Higher wins the election, unless override is off": "数值高的赢得选举，除非 override 关着",
  "Heartbeat interfaces": "心跳接口",
  "How the members find each other": "成员之间靠它互相发现",
  "Monitored interfaces": "被监控的接口",
  "Losing one of these triggers a failover": "其中一个断掉就会触发切换",
  "Config sync": "配置同步",
  "Changes on the primary reach the secondary": "主设备上的修改会同步到备设备",
  "Session pickup": "会话接管",
  "Without it, live connections drop on a failover": "不开它，切换时正在进行的连接会断",
  "Heartbeat encryption": "心跳加密",
  "Heartbeat authentication": "心跳认证",
  "Heartbeat interval": "心跳间隔",
  "Uninterruptible upgrade": "不中断升级",
  "Upgrade one member at a time": "一次升级一台成员",
  "Standalone — there are no other members to report": "Standalone — 没有其他成员可报告",
  "this unit": "本机",
  "unnamed member": "未命名成员",
  "Administrators": "设备管理员",
  "administrator": "管理员",
  "New administrator": "新建管理员",
  "Accounts certainly exist — this is 'unreadable', not 'none'": "账号肯定是有的 — 这是“读不到”，不是“没有”",
  "One leaked password is then enough to own this firewall.": "那么一个泄露的密码就足以拿下这台防火墙。",
  "full control": "完全控制",
  "remote auth": "外部认证",
  "the only full administrator": "仅剩的完全管理员",
  "From any address": "可从任意地址登录",
  "No second factor": "没有第二因素",
  "· SSH key set": "· 已设置 SSH 密钥",
  "Access profiles": "权限配置文件",
  "Access profile": "权限配置文件",
  "What each profile allows. Edited on the device — a half-built editor here would produce profiles whose real permissions differ from what the form showed.":
    "每个配置文件允许什么。请在设备上编辑 — 在这里做一个半成品编辑器，只会造出实际权限与表单显示不一致的配置文件。",
  "Full control of the device": "完全控制该设备",
  "Read-only": "只读",
  "Unknown profile": "未知的配置文件",
  "Account name": "账号名",
  "Choose…": "请选择…",
  "Authenticate against a remote server instead of a local password": "用外部服务器认证，而不是本地密码",
  "Remote group": "外部组",
  "Leave the password unchanged": "不修改密码",
  "The firewall never returns a password, so leaving this alone is the only way to keep it.":
    "防火墙从不返回密码，所以不动这一项是保住原密码的唯一办法。",
  "Trusted hosts": "可信主机",
  "One subnet per line, up to ten. Empty means the account can log in from any address — which is the FortiOS default, not a gap in the configuration.":
    "每行一个子网，最多十个。留空表示该账号可以从任意地址登录 — 这是 FortiOS 的默认值，不是配置漏填。",
  "Second factor": "第二因素",
  "Give the account a name.": "请给账号起个名字。",
  "Choose an access profile — it is what the account is allowed to do.":
    "请选择权限配置文件 — 它决定这个账号能做什么。",
  "A new local account needs a password.": "新建的本地账号需要密码。",
  "Enter the new password, or leave the password unchanged.": "请输入新密码，或选择不修改密码。",
  "A remotely authenticated account needs the remote group it belongs to.": "外部认证的账号需要填写它所属的外部组。",
  "The firewall applies this immediately. If the address you are connected from is not in that list, this account stops working for you the moment it is saved — including for undoing it.":
    "防火墙会立即生效。如果你当前连接的地址不在那个列表里，这个账号在保存的那一刻就对你失效了 — 包括用来撤销这次修改。",
  "This is the only account that can fully administer the firewall": "这是唯一能完全管理该防火墙的账号",

  // Administrators (accounts on the FortiGate itself), HA Status and the access-profile list.
  // HA state words stay short: they sit in tiles beside a number.
  "Heartbeat": "心跳",
  "Log in to the device itself, over HTTPS or SSH — not this console's own users (Security ▸ Users).":
    "用于通过 HTTPS 或 SSH 直接登录设备本身——不是本控制台的用户（Security ▸ Users）。",
  "No administrator accounts on this device.": "此设备上没有管理员账号。",
  "Not synced": "未同步",
  "RAM": "内存",
  "Reachable from any address with no second factor": "任何地址都能访问，且没有第二重验证",
  "SSH key set": "已设置 SSH 密钥",
  "Synced": "已同步",
  "This administrator could not be found on the device": "在设备上找不到此管理员",
  "What each profile allows. Edited on the device.": "各配置文件允许哪些操作。在设备上编辑。",
  "exposed": "暴露",
  "member list unreadable": "成员列表无法读取",
  "only full admin": "仅完全管理员",
  "override off": "覆盖已关闭",
  "override on": "覆盖已开启",
  "reporting in": "已上报",
  "session pickup off": "会话接管已关闭",
  "session pickup on": "会话接管已开启",
  "this unit only": "仅本机",

  // Device Identities / host pins
  "Device Identities":
    "设备身份",
  "host key":
    "主机密钥",
  "The SSH host keys and HTTPS certificates this console pinned on first contact":
    "本控制台在首次连接时固定的 SSH 主机密钥与 HTTPS 证书",
  "The first time this console reaches a firewall it remembers the identity that answered, and compares every connection afterwards against it. A connection that does not match is refused before any password is sent.":
    "本控制台首次连接某台防火墙时，会记住应答的身份，之后每次连接都与它比对。不匹配的连接会在发送任何密码之前被拒绝。",
  "A refusal means one of two things, and they are indistinguishable from here: somebody is answering in place of the firewall, or the firewall legitimately changed — a firmware upgrade that regenerated its host key, a replaced or expired certificate.":
    "被拒绝意味着两种情况之一，而在这里无法区分：有人代替防火墙应答，或者防火墙确实变了 — 固件升级重新生成了主机密钥，或证书被更换、已过期。",
  "Compare the fingerprint below with the one on the device’s own console before clearing anything.":
    "在清除任何内容之前，请把下面的指纹与设备自身控制台上的指纹对照一遍。",
  "One firewall can hold several rows. A FortiGate answers with a different SSH key depending on which algorithm the client asks for, so two SSH rows for one address is normal, not two machines.":
    "一台防火墙可以有多行。FortiGate 会根据客户端请求的算法返回不同的 SSH 主机密钥，所以同一地址出现两行 SSH 是正常的，并不是两台机器。",
  "pinned identities":
    "已固定的身份",
  "Could not read the pinned identities":
    "无法读取已固定的身份",
  "Nothing is shown rather than an empty list: this page must never suggest a firewall is unpinned when it simply could not be read.":
    "这里什么都不显示，而不是显示一个空列表：本页绝不能在只是读不到数据时，让人以为某台防火墙未被固定。",
  "SSH host keys":
    "SSH 主机密钥",
  "Port 22 — the backup, config push, terminal and diagnostics paths":
    "端口 22 — 备份、下发配置、终端与诊断所走的通道",
  "HTTPS certificates":
    "HTTPS 证书",
  "Port 443 — every page of this console reads the firewall over it":
    "端口 443 — 本控制台的每个页面都通过它读取防火墙",
  "Clear pinned identity":
    "清除已固定的身份",
  "Forget the HTTPS certificate this console pinned for this device.":
    "忘记本控制台为此设备固定的 HTTPS 证书。",
  "What this console has been checking against:":
    "本控制台一直在比对的内容：",
  "The next connection to":
    "下一次连接到",
  "will pin whatever answers it":
    "将固定任何应答它的身份",
  ", without comparing it to anything. Do this only once you have read the new fingerprint on the device’s own console and it is the one you expect.":
    "，且不与任何内容比对。只有在你已经从设备自身控制台读到新指纹、并且它正是你预期的那一个时，才这样做。",
  "expired":
    "已过期",
  "First seen":
    "首次发现",
  "Clear pin":
    "清除固定",
};
