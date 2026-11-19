/**
 * Simplified Chinese — IPsec Tunnels, the VPN Creation Wizard, its templates, and Tunnel Health.
 *
 * IKE vocabulary follows Chinese networking usage: 阶段 1 / 阶段 2 for the phases, 预共享密钥 for the
 * PSK, 主模式/野蛮模式 where the negotiation mode is named. The acronyms both ends of a tunnel print
 * in their logs — SA, DPD, PFS, IKEv1/2, Diffie-Hellman group numbers — stay as they are, because a
 * tunnel that will not come up is debugged by comparing this console's screen against the peer's.
 *
 * The template descriptions ("On-demand tunnel for users using the FortiClient software") are the
 * console's own, not FortiOS's, and are translated in full.
 */
import type { Dict } from "../merge";

export const vpn: Dict = {
  // -- Tunnel list -----------------------------------------------------------
  Tunnel: "隧道",
  TUNNEL: "隧道",
  "Create the first tunnel": "创建第一条隧道",
  "Edit tunnel": "编辑隧道",
  "Delete tunnel": "删除隧道",
  "Failed to create tunnel": "创建隧道失败",
  "Failed to delete tunnel": "删除隧道失败",
  "This device has no IPsec tunnel yet": "此设备上还没有 IPsec 隧道",
  "Search tunnels…": "搜索隧道…",
  "Search templates…": "搜索模板…",
  "A tunnel can't be renamed — edit its settings below.":
    "隧道无法重命名 — 请在下方编辑其设置。",
  "A tunnel named": "名为",
  "already exists on this device — Create will fail. Pick another name.":
    "的隧道在此设备上已存在 — 创建将会失败。请换一个名称。",
  "e.g. HQ-to-Branch": "例如 HQ-to-Branch",
  DESCRIPTION: "描述",
  TEMPLATE: "模板",
  WIZARD: "向导",
  Actions: "操作",
  Settings: "设置",
  Method: "方式",
  Custom: "自定义",
  Individual: "单个",
  Range: "范围",
  "(range": "（范围",
  ", group": "，组",
  "in use": "使用中",
  "src → dst": "源 → 目标",
  "Advanced…": "高级…",

  // -- Wizard flow -----------------------------------------------------------
  "VPN Setup": "VPN 设置",
  "Review Settings": "检查设置",
  "Template type": "模板类型",
  "Object Summary": "对象汇总",
  "Computing impact…": "正在计算影响…",
  "Device creation": "在设备上创建",
  "The following settings should be reviewed prior to creating the VPN.":
    "创建 VPN 之前应先检查以下设置。",
  "Select a FortiGate above to start — the wizard reads its interfaces and routing table.":
    "请在上方选择一台 FortiGate 开始 — 向导会读取它的接口和路由表。",
  "These are FortiGate's built-in IPsec templates. Use":
    "这些是 FortiGate 内置的 IPsec 模板。使用",
  "to launch the IPsec Wizard, or configure a tunnel directly under":
    "以启动 IPsec 向导，或直接在以下位置配置隧道：",
  "IPsec Tunnels → Create New": "IPsec 隧道 → 新建",
  "This wizard builds": "此向导可创建",
  "tunnels. Hub-and-Spoke and Custom aren't wired up here — build those in the FortiGate GUI.":
    "隧道。中心-分支和自定义类型尚未接入此处 — 请在 FortiGate GUI 中创建。",
  "Custom form. The next steps are Network, Authentication and Phase 2.":
    "自定义表单。接下来的步骤是网络、认证和阶段 2。",
  "Configure phase 1 and phase 2 by hand — the full manual tunnel editor.":
    "手动配置阶段 1 与阶段 2 — 完整的手动隧道编辑器。",
  "is the manual tunnel editor — you set phase 1 and phase 2 by hand. It creates":
    "是手动隧道编辑器 — 阶段 1 与阶段 2 由您自行设置。它只创建",
  "only the tunnel": "隧道本身",
  "(no address objects, policies or routes), exactly like the FortiGate GUI's":
    "（不创建地址对象、策略或路由），与 FortiGate GUI 的行为完全一致",

  // -- Templates -------------------------------------------------------------
  "Site to Site": "站点到站点",
  "Site to Site - FortiGate": "站点到站点 - FortiGate",
  "Site to Site - Cisco": "站点到站点 - Cisco",
  "Site to Site - FortiGate (SD-WAN)": "站点到站点 - FortiGate（SD-WAN）",
  "Site-to-Site / Custom": "站点到站点 / 自定义",
  "Dialup User": "拨号用户",
  "Dialup - FortiGate": "拨号 - FortiGate",
  "Dialup - FortiClient (Windows, Mac OS, Android)":
    "拨号 - FortiClient（Windows、macOS、Android）",
  "Dialup - iOS (Native)": "拨号 - iOS（系统自带客户端）",
  "Dialup - Android (Native L2TP/IPsec)": "拨号 - Android（系统自带 L2TP/IPsec）",
  "Dialup - Windows (Native L2TP/IPsec)": "拨号 - Windows（系统自带 L2TP/IPsec）",
  "Dialup - Cisco Firewall": "拨号 - Cisco 防火墙",
  "Dialup - Cisco IPsec Client": "拨号 - Cisco IPsec 客户端",
  "Hub-and-Spoke": "中心-分支",
  "Hub-and-Spoke - FortiGate (Hub)": "中心-分支 - FortiGate（中心）",
  "Hub-and-Spoke - FortiGate (Spoke)": "中心-分支 - FortiGate（分支）",
  "Static tunnel between this FortiGate and a remote FortiGate.":
    "本 FortiGate 与远端 FortiGate 之间的静态隧道。",
  "Static tunnel between this FortiGate and a remote Cisco firewall.":
    "本 FortiGate 与远端 Cisco 防火墙之间的静态隧道。",
  "Static tunnel between this FortiGate using SD-WAN and a remote FortiGate.":
    "使用 SD-WAN 的本 FortiGate 与远端 FortiGate 之间的静态隧道。",
  "On-demand tunnel between two FortiGate devices.":
    "两台 FortiGate 设备之间的按需隧道。",
  "On-demand tunnel between a FortiGate device and a Cisco Firewall.":
    "FortiGate 设备与 Cisco 防火墙之间的按需隧道。",
  "On-demand tunnel for users using the FortiClient software.":
    "面向使用 FortiClient 软件的用户的按需隧道。",
  "On-demand tunnel for users using the Cisco IPsec client.":
    "面向使用 Cisco IPsec 客户端的用户的按需隧道。",
  "On-demand tunnel for iPhone/iPad users using the native iOS IPsec client.":
    "面向使用 iOS 自带 IPsec 客户端的 iPhone/iPad 用户的按需隧道。",
  "On-demand tunnel for Android users using the native L2TP/IPsec client.":
    "面向使用系统自带 L2TP/IPsec 客户端的 Android 用户的按需隧道。",
  "On-demand tunnel for Windows users using the native L2TP/IPsec client.":
    "面向使用系统自带 L2TP/IPsec 客户端的 Windows 用户的按需隧道。",
  "Hub role in a Hub-and-Spoke auto-discovery VPN configuration.":
    "中心-分支自动发现 VPN 配置中的中心角色。",
  "Spoke role in a Hub-and-Spoke auto-discovery VPN configuration.":
    "中心-分支自动发现 VPN 配置中的分支角色。",

  // -- Network / gateway -----------------------------------------------------
  "Remote Gateway": "远端网关",
  "Remote Gateway Address": "远端网关地址",
  "Remote Gateway Route": "远端网关路由",
  "Remote device": "远端设备",
  "Remote device type": "远端设备类型",
  "Remote IP address": "远端 IP 地址",
  "Remote IP/netmask": "远端 IP/掩码",
  "Remote Address": "远端地址",
  "Remote address group": "远端地址组",
  "Remote Subnets": "远端子网",
  "Local Gateway": "本端网关",
  "Local Address": "本端地址",
  "Local address group": "本端地址组",
  "Local subnets": "本端子网",
  "Local interface": "本端接口",
  "Local subnets fills in from this interface's network.":
    "本端子网会依据此接口所在的网络自动填入。",
  "Static IP Address": "静态 IP 地址",
  "Dynamic DNS": "动态 DNS",
  "IP Address": "IP 地址",
  "IP Version": "IP 版本",
  "Subnet Mask": "子网掩码",
  "Interface binding": "接口绑定",
  "INTERFACE BINDING": "接口绑定",
  "Tunnel interface": "隧道接口",
  "Tunnel Interface": "隧道接口",
  "Tunnel IP": "隧道 IP",
  "Select an address…": "选择一个地址…",
  "Select a user group…": "选择一个用户组…",
  "Select the interface the tunnel binds to…": "选择隧道绑定的接口…",
  "Select the interface clients connect to…": "选择客户端接入的接口…",
  "Select the LAN interface…": "选择 LAN 侧接口…",
  "Select the WAN to share…": "选择要共享的 WAN…",
  "This side is behind NAT": "本端位于 NAT 之后",
  "The remote site is behind NAT, so it has no address to dial: this becomes a":
    "远端站点位于 NAT 之后，没有可拨号的地址，因此这将变成一条",
  "Exchange interface IP": "交换接口 IP",

  // -- Authentication --------------------------------------------------------
  "Pre-shared key": "预共享密钥",
  "Pre-shared Key": "预共享密钥",
  "Certificate Name": "证书名称",
  "Peer Certificate CA": "对端证书 CA",
  "Peer ID": "对端 ID",
  "Any peer ID": "任意对端 ID",
  "Specify a peer ID": "指定一个对端 ID",
  "Local ID": "本端 ID",
  "Group Name (peerid)": "组名（peerid）",
  "Require 'Group Name' on VPN client": "要求 VPN 客户端提供“组名”",
  "Clients must present this name — the tunnel negotiates in aggressive mode.":
    "客户端必须提供此名称 — 隧道以野蛮模式进行协商。",
  "Accept Types": "接受类型",
  "Optional — pins which CA must have signed the client's certificate.":
    "可选 — 指定客户端证书必须由哪个 CA 签发。",
  "Optional — pins which CA must have signed the peer's certificate.":
    "可选 — 指定对端证书必须由哪个 CA 签发。",
  "Optional — pins which CA must have signed the remote's certificate.":
    "可选 — 指定远端证书必须由哪个 CA 签发。",

  // -- Phase 1 / phase 2 -----------------------------------------------------
  "IKE Version": "IKE 版本",
  "Phase 1 interface": "阶段 1 接口",
  "Phase 1 Proposal": "阶段 1 提议",
  "Phase 2": "阶段 2",
  "Phase 2 interface": "阶段 2 接口",
  "Phase 2 Proposal": "阶段 2 提议",
  "Phase 2 Selectors": "阶段 2 选择器",
  "Diffie-Hellman Groups": "Diffie-Hellman 组",
  "Key Lifetime (seconds)": "密钥生存期（秒）",
  "Enable PFS": "启用 PFS",
  "Enable Replay Detection": "启用重放检测",
  "Always Up (Keep Alive)": "始终在线（Keep Alive）",
  "Auto-negotiate": "自动协商",
  "Dead Peer Detection": "对端失效检测（DPD）",
  "DPD retry count": "DPD 重试次数",
  "DPD retry interval": "DPD 重试间隔",
  "Keepalive Frequency": "Keepalive 频率",
  "NAT Traversal": "NAT 穿越",
  "Forward Error Correction": "前向纠错（FEC）",
  "Not supported over API": "不支持通过 API 配置",

  // -- Client / mode config --------------------------------------------------
  "Client Options": "客户端选项",
  "Client Address Range": "客户端地址范围",
  "Enable IPv4 Split Tunnel": "启用 IPv4 分离隧道",
  "Split Tunnel Group": "分离隧道地址组",
  "Auto Connect": "自动连接",
  "Save Password": "保存密码",
  "Allow Endpoint Registration": "允许终端注册",
  "Endpoint Registration": "终端注册",
  "Easy configuration key": "简易配置密钥",

  // -- L2TP ------------------------------------------------------------------
  "L2TP over IPsec": "基于 IPsec 的 L2TP",
  "L2TP server": "L2TP 服务器",
  "L2TP Policy": "L2TP 策略",
  "L2TP Route": "L2TP 路由",
  "L2TP route:": "L2TP 路由：",
  "via l2t.root": "经由 l2t.root",
  "uses the OS's built-in client:": "使用操作系统自带的客户端：",
  "This device already has an": "此设备上已经有一个",
  "There is only one per device — creating this Native VPN will":
    "每台设备只能有一个 — 创建此原生 VPN 将会",
  "disabled (last Native VPN)": "已禁用（上一个原生 VPN）",
  "L2TP server exists per device, so a second Android/Windows VPN replaces this one's settings.":
    "每台设备只有一个 L2TP 服务器，因此再创建一个 Android/Windows VPN 会替换掉这一个的设置。",
  ". The L2TP server hands out the addresses and checks the user group, so there is no split tunnel, DNS push or client options — and only":
    "。地址由 L2TP 服务器分配并校验用户组，因此没有分离隧道、DNS 下发或客户端选项 — 而且只有",

  // -- Policy and routing ----------------------------------------------------
  "Policy & Routing": "策略与路由",
  "Local to remote policies": "本端到远端的策略",
  "Remote to local policies": "远端到本端的策略",
  "Internet Access": "互联网访问",
  "Internet access policy": "互联网访问策略",
  Internet: "互联网",
  "Shared WAN": "共享的 WAN",
  "NAT configuration": "NAT 配置",
  "Add route": "添加路由",
  "Static route": "静态路由",
  "BGP route": "BGP 路由",
  "Blackhole route": "黑洞路由",
  "Routing protocol": "路由协议",
  "as the routing protocol.": "作为路由协议。",
  "Looking up the route…": "正在查找路由…",
  "None — the tunnel carries only the subnets above. Share Local — the remote site reaches the Internet through this site's WAN. Use Remote — this site reaches the Internet through the remote site.":
    "无 — 隧道只承载上面列出的子网。共享本端 — 远端站点经由本站点的 WAN 访问互联网。使用远端 — 本站点经由远端站点访问互联网。",
  "Once the default route points into the tunnel, the tunnel's own packets would loop back into it. This gateway keeps a host route to the remote gateway on the physical link.":
    "一旦默认路由指向隧道，隧道自身的报文就会回环进入隧道。此网关会在物理链路上保留一条通往远端网关的主机路由。",
  "Just the tunnel (phase1/phase2) — no dependent objects found.":
    "仅创建隧道（阶段 1/阶段 2）— 未发现依赖对象。",
  "and everything created with it will be permanently removed from":
    "以及随之创建的所有内容都将被永久地从以下位置移除：",
  "object(s). Policies on this tunnel are removed automatically; anything else still pointing at it will be reported and left in place.":
    "个对象。此隧道上的策略会被自动移除；其他仍指向它的内容会被报告出来并原样保留。",

  // -- Hub and spoke ---------------------------------------------------------
  "BGP (auto-discovery)": "BGP（自动发现）",
  "Auto discovery sender": "自动发现发送方",
  "Auto discovery receiver": "自动发现接收方",
  "Local AS": "本端 AS",
  "Hub gateway (public IP)": "中心网关（公网 IP）",
  "Spoke type": "分支类型",
  "Spoke range prefix": "分支地址段前缀",
  "Spoke tunnel IPs": "分支隧道 IP",
  "Aggregate member": "聚合成员",
  "The Hub-and-Spoke VPN will be set up using": "此中心-分支 VPN 将使用以下方式建立：",
  "The hub FortiGate's public address this spoke dials.":
    "此分支所拨号的中心 FortiGate 的公网地址。",
  "The private BGP AS both ends share.": "两端共用的私有 BGP AS 号。",
  "The overlay subnet the hub accepts dynamic BGP peers from.":
    "中心接受动态 BGP 邻居接入的 overlay 子网。",
  "This device's address on the tunnel overlay.": "本设备在隧道 overlay 上的地址。",
  "Each spoke's tunnel IP — one BGP neighbor per entry.":
    "每个分支的隧道 IP — 每条记录对应一个 BGP 邻居。",
  "tunnel and the remote FortiGate connects to": "隧道，远端 FortiGate 则连接到",

  // -- Tunnel Health ---------------------------------------------------------
  "VPN Tunnel Health": "VPN 隧道健康度",
  "Pick a device to see its tunnel status": "选择一台设备以查看其隧道状态",
  "Reading the IPsec status from the device…": "正在从设备读取 IPsec 状态…",
  Up: "已建立",
  Down: "未建立",
  "Partly up": "部分建立",
  "Bring down": "断开",
  "Reset counters": "重置计数器",
  "SA left": "剩余 SA",
  "No SA at all": "完全没有 SA",
  "Every phase 2 selector has an SA": "每个阶段 2 选择器都有对应的 SA",
  "Never negotiated": "从未协商过",
  "peers established": "个对端已建立连接",
  Ingress: "入向",
  "No selectors configured.": "尚未配置任何选择器。",
  "The device lists no phase 2 selector for this tunnel in its runtime table":
    "设备的运行时表中没有列出此隧道的任何阶段 2 选择器",
  "No selector in the runtime table — it has never negotiated, or phase 2 was never configured":
    "运行时表中没有选择器 — 可能从未协商过，或者从未配置阶段 2",
  "Some selectors are still down, so part of the traffic will not pass":
    "部分选择器仍未建立，因此有一部分流量无法通过",
  "Traffic using this selector drops immediately until it negotiates again":
    "使用此选择器的流量会立即被丢弃，直到重新协商成功",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Address objects": "地址对象",
  "Firewall policies": "防火墙策略",
  "Routes": "路由",
  "Aggressive": "野蛮模式",
  "Main": "主模式",
  "Main (ID protection)": "主模式（身份保护）",
  "All (full tunnel)": "全部（全隧道）",
  "Disabled (full tunnel)": "已禁用（全隧道）",
  "Full tunnel — all client traffic is sent through this FortiGate.": "全隧道 — 客户端的所有流量都经由此 FortiGate 转发。",
  "Android Native": "Android 原生",
  "Android (Native L2TP/IPsec)": "Android（原生 L2TP/IPsec）",
  "iOS Native": "iOS 原生",
  "iOS (Native)": "iOS（原生）",
  "Windows Native": "Windows 原生",
  "Windows (Native L2TP/IPsec)": "Windows（原生 L2TP/IPsec）",
  "Native": "原生",
  "Client-based": "基于客户端",
  "Cisco Client": "Cisco 客户端",
  "Cisco IPsec Client": "Cisco IPsec 客户端",
  "FortiClient (Windows, Mac OS, Android)": "FortiClient（Windows、Mac OS、Android）",
  "A remote behind NAT has no address to dial — the tunnel becomes dialup and waits for it to connect.": "位于 NAT 之后的远端没有可拨号的地址 — 隧道将改为拨号方式，等待对端连入。",
  "Could not read the tunnel status": "无法读取隧道状态",
  "Counters reset": "计数器已重置",
  "Creating…": "正在创建…",
  "Custom — created by the VPN Creation Wizard": "自定义 — 由 VPN 创建向导生成",
  "Custom IPsec tunnel": "自定义 IPsec 隧道",
  "Custom (manual editor)": "自定义（手动编辑）",
  "Dialup": "拨号",
  "Dialup — the remote connects in": "拨号 — 由远端连入",
  "(directly connected)": "（直连）",
  "Edit IPsec Tunnel": "编辑 IPsec 隧道",
  "IPsec tunnel": "IPsec 隧道",
  "No tunnel matches your search": "没有隧道匹配您的搜索条件",
  "Enter a valid CIDR (e.g. 192.168.1.0/24).": "请输入有效的 CIDR（例如 192.168.1.0/24）。",
  "Enter a valid CIDR (e.g. 2001:db8::/64).": "请输入有效的 CIDR（例如 2001:db8::/64）。",
  "Forced": "强制",
  "Forces NAT-T encapsulation instead of auto-detecting it.": "强制使用 NAT-T 封装，而不是自动探测。",
  "Key Lifetime": "密钥生存期",
  "Phase 2 Key Lifetime": "第二阶段密钥生存期",
  "Phase 1 DH Groups": "第一阶段 DH 组",
  "Phase 2 Local": "第二阶段本端",
  "Phase 2 Remote": "第二阶段对端",
  "Phase 2 selectors": "第二阶段选择器",
  "Local Port": "本端端口",
  "Remote Port": "对端端口",
  "Ports / Protocol": "端口 / 协议",
  "Primary IP": "主 IP",
  "Not required": "不需要",
  "No NAT between sites": "站点之间没有 NAT",
  "The remote site is behind NAT": "对端站点位于 NAT 之后",
  "This site is behind NAT": "本站点位于 NAT 之后",
  "On Demand": "按需",
  "On Idle": "空闲时",
  "PFS": "PFS 完美前向保密",
  "Replay Detection": "重放检测",
  "Share Local": "共享本端",
  "Signature": "数字签名",
  "Static": "静态",
  "The device rejected the command": "设备拒绝了此命令",
  "The first spoke's tunnel IP + the overlay netmask (its mask sizes the whole overlay subnet).": "第一个分支的隧道 IP + 叠加网掩码（该掩码决定整个叠加子网的大小）。",
  "The hub's tunnel IP + the overlay netmask.": "中心节点的隧道 IP + 叠加网掩码。",
  "The local networks clients may reach (the policy's destination).": "客户端可访问的本地网络（策略的目的地址）。",
  "The local networks clients reach over the VPN (the split-tunnel group).": "客户端通过 VPN 访问的本地网络（分隧道地址组）。",
  "Use in Wizard": "在向导中使用",
  "Use Remote": "使用对端设置",
  "Use System DNS": "使用系统 DNS",
  "VPN Creation Wizard": "VPN 创建向导",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Hub gateway": "中心节点网关",
  "Split Tunnel": "分隧道",
  "Easy configuration key is a FortiManager feature — enter the hub's gateway and tunnel settings manually below.": "Easy configuration key 是 FortiManager 的功能 — 请在下方手动填写中心节点的网关和隧道设置。",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Allow endpoint registration": "允许终端注册",
  "Always up (keep alive)": "始终保持连通（keep alive）",
  "Auto connect": "自动连接",
  "Autokey keep alive": "自动密钥保活（autokey keep alive）",
  "Availability": "可用性",
  "Client software": "客户端软件",
  "Enable IPv4 split tunnel": "启用 IPv4 分离隧道",
  "Enable perfect forward secrecy": "启用完全前向保密（PFS）",
  "Enable replay detection": "启用重放检测",
  "Internet access": "互联网访问",
  "Mode config": "模式配置（mode config）",
  "Native client platform": "原生客户端平台",
  "No samples in this window yet — history starts when the console does.": "此时间范围内还没有采样——历史从控制台开始运行时算起。",
  "Pick a tunnel": "选择隧道",
  "Sampled every five minutes — a partial tunnel counts as half": "每五分钟采样一次——部分连通的隧道按一半计算",
  "Save password": "保存密码",
  "Specify the local gateway": "指定本端网关",

  // -- The AI Assistant's VPN wizard: its review rows, validation and apply note ----
  // IKEv1 / IKEv2 are deliberately absent: they are the version tokens both ends print, and
  // ../keep.ts is where a string that stays English in both languages belongs.
  "A pre-shared key is required": "必须填写预共享密钥",
  "A tunnel name is required": "必须填写隧道名称",
  "A tunnel with this name already exists — Apply overwrites its phase 1 / phase 2.":
    "已存在同名隧道——应用会覆盖它的第一阶段 / 第二阶段配置。",
  "Apply creates everything this tunnel needs over REST. You can undo it from the chat with Fallback.":
    "应用会通过 REST 创建这条隧道所需的全部对象，可以在对话中用“回退”撤销。",
  "Certificate (signature)": "证书（数字签名）",
  "Client pool": "客户端地址池",
  "Creates": "创建",
  "Delete IPsec tunnel": "删除 IPsec 隧道",
  "Dialup (clients connect in)": "Dialup（客户端拨入）",
  "Dialup (dynamic peer)": "Dialup（动态对端）",
  "Disabled (all traffic)": "禁用（全部流量）",
  "Everything created with this tunnel will be permanently removed from":
    "随这条隧道一并创建的所有对象都将被永久删除，来源：",
  "Hide the key": "隐藏密钥",
  "Hub-and-Spoke (ADVPN + BGP)": "中心辐射型（ADVPN + BGP）",
  "IKE version": "IKE 版本",
  "NAT traversal": "NAT 穿越",
  "Names the device already has are reused, not duplicated.":
    "设备上已有的名称会被复用，不会重复创建。",
  "Networks": "网络",
  "Only admins can apply": "只有管理员可以应用",
  "Peer CA": "对端 CA",
  "Remote gateway": "对端网关",
  "Remote subnets": "对端子网",
  "Remote tunnel IP": "对端隧道 IP",
  "Reviewed from the AI's proposal": "依据 AI 的建议核对过",
  "Show the key": "显示密钥",
  "Split destinations": "分离隧道的目的地址",
  "Split tunnel": "分离隧道",
  "System DNS": "系统 DNS",
  "The far end must be set to the same key.": "对端必须设置相同的密钥。",
  "The tunnel stays down until the far end is configured to match (PSK, proposal, selectors).":
    "在对端配置为相互匹配（PSK、proposal、selectors）之前，隧道会一直处于断开状态。",
  "Tunnel name": "隧道名称",
  "Updates": "更新",
  "as a dialup listener with its client pool, split-tunnel group and policy":
    "作为 dialup 侦听端，连同它的客户端地址池、分离隧道用户组和策略",
  "shared secret": "共享密钥",
  "templates": "模板",
  "with its phase 1 / phase 2 and the addresses, policies and routes it needs":
    "连同它的第一阶段 / 第二阶段，以及所需的地址、策略和路由",
  "with its tunnel interface, BGP process and policies":
    "连同它的隧道接口、BGP 进程和策略",
};
