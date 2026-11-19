/**
 * Simplified Chinese — the interpolated sentences of the AI Assistant.
 *
 * This is the largest pattern set in the app, because almost everything the impact analysis says is
 * a sentence built around a name the model chose or a value read back from the firewall. Two
 * conventions hold throughout:
 *
 *   - The quoted name inside a hole is the object's mkey. It stays verbatim, in Chinese quotation
 *     marks, so it can still be matched against `show` output.
 *   - `Failed to {} X` takes an English verb ("create" / "update") from the call site. Chinese puts
 *     the verb first, so these are phrased as `{}X 失败` — the verb lands where Chinese wants it and
 *     the sentence still reads as one clause.
 */
import type { Dict } from "../merge";

export const aiPatterns: Dict = {
  // -- Chat and wizards ------------------------------------------------------
  "Ask {} anything… (Enter to send, Shift+Enter for a new line)":
    "向 {} 提问…（回车发送，Shift+回车换行）",
  "Something went wrong: {}": "出错了：{}",
  "Note: {}": "注意：{}",
  "Command: {}": "命令：{}",
  "CLI commands: {}": "CLI 命令：{}",
  "Config deploy {}": "配置下发 {}",
  "Address Wizard{}": "地址向导{}",
  "Service Wizard{}": "服务向导{}",
  "Schedule Wizard{}": "计划表向导{}",
  "User Wizard{}": "用户向导{}",
  "User Group Wizard{}": "用户组向导{}",
  "LDAP Server Wizard{}": "LDAP 服务器向导{}",
  "RADIUS Server Wizard{}": "RADIUS 服务器向导{}",
  "SD-WAN Wizard ({})": "SD-WAN 向导（{}）",
  "Apply ALL ({})": "全部应用（{}）",
  "+{} more": "+ 另外 {} 项",
  "Position {} of {}": "第 {} 项，共 {} 项",
  "EDIT #{}": "编辑 #{}",
  "(unnamed #{})": "（未命名 #{}）",
  "Type {}": "类型 {}",
  "Country {}": "国家 {}",
  "Source: {}": "源：{}",
  "Ports: {}": "端口：{}",
  "SSL: {}": "SSL：{}",
  "Protocols scanned: {}": "已扫描的协议：{}",
  "Accepted on interface: {}": "在此接口上接受：{}",
  "NPE {} rule": "NPE {} 规则",
  "Every {}, {}": "每 {}，{}",
  "Once, {} {} → {} {}": "一次性，{} {} → {} {}",
  "A group of {} schedules ({})": "由 {} 个计划表组成的组（{}）",
  "during {} only": "仅在 {} 期间",
  "only during {}": "仅在 {} 期间",
  "· auth {}": "· 认证 {}",
  "· email {}": "· 邮箱 {}",
  "· two-factor: {}": "· 双因素：{}",
  "· secondary {}": "· 备用 {}",
  "· {} member(s) ({}{})": "· {} 位成员（{}{}）",
  "Primary server {}": "主服务器 {}",
  "Server {}:{} · {} bind": "服务器 {}:{} · {} 绑定",
  "User Group · {}": "用户组 · {}",
  "Users → groups ({} → {})": "用户 → 用户组（{} → {}）",
  "Users / authentication servers ({})": "用户 / 认证服务器（{}）",
  "users on {}": "{} 上的用户",
  "~{} hosts": "约 {} 台主机",
  "out of {}": "，共 {}",

  // -- What Apply would do ---------------------------------------------------
  'Creates a new policy "{}" on the device': '在设备上创建新策略“{}”',
  'Edits the existing policy "{}" on the device': '修改设备上已有的策略“{}”',
  'Creates a new {} "{}" on the device': '在设备上创建新的{}“{}”',
  'Overwrites the existing {} "{}" on the device — the previous values of the edited fields are lost':
    '覆盖设备上已有的{}“{}”— 被修改字段的原有值将丢失',
  'Checked: policy "{}" already exists on the device, so this apply edits it':
    '已核实：策略“{}”在设备上已存在，因此本次应用是修改而非新建',
  'Checked: policy "{}" is not on the device, so this apply creates it':
    '已核实：设备上没有策略“{}”，因此本次应用会新建它',
  "Checked: a {} with this name already exists on the device, so this apply overwrites rather than creates":
    "已核实：设备上已存在同名的{}，因此本次应用是覆盖而非新建",
  "Checked: no {} with this name is on the device, so this apply creates a new one":
    "已核实：设备上没有同名的{}，因此本次应用会新建一个",
  'This edits an existing object rather than creating one — every policy that references {} "{}" picks up the new values the moment you apply':
    '这是修改已有对象而不是新建 — 只要您一应用，所有引用{}“{}”的策略都会立即使用新值',
  "Creates the {} object(s) this policy references first":
    "先创建此策略引用的 {} 个对象",
  "Creates {} security profile(s) — a profile no policy references inspects nothing":
    "创建 {} 个安全配置文件 — 没有任何策略引用的配置文件不会检测任何内容",
  'Creates IPsec tunnel "{}" ({}) with its phase 1 / phase 2 and the addresses, policies and routes it needs':
    '创建 IPsec 隧道“{}”（{}），包含其阶段 1 / 阶段 2 以及所需的地址、策略和路由',
  "Adds {} user account(s) and {} group(s) —": "新增 {} 个用户账户和 {} 个用户组 —",
  "Interacts with {} existing {}": "与 {} 个已有的{}相互影响",
  "Applied {} object{} to the device": "已向设备应用 {} 个对象{}",
  "({}), then the policy itself": "（{}），然后才是策略本身",
  "This config contains a section with no REST endpoint ({}),":
    "此配置中包含没有 REST 接口的部分（{}），",
  'Create {} "{}" Success': '创建{}“{}”成功',
  'Update {} "{}" Success': '更新{}“{}”成功',
  'Create Exchange Connector "{}" Success': '创建 Exchange 连接器“{}”成功',

  // -- SD-WAN apply ----------------------------------------------------------
  "Builds {} SD-WAN object(s) on {}, in the order they depend on each other: zones → members → performance SLAs → rules":
    "在 {2} 上创建 {1} 个 SD-WAN 对象，按依赖顺序：区域 → 成员 → 性能 SLA → 规则",
  "Created {} SD-WAN object(s) on {}": "已在 {2} 上创建 {1} 个 SD-WAN 对象",
  "All {} {} are on the device.": "全部 {} 个{}都已在设备上。",
  "Adds {} to SD-WAN — once SD-WAN is on,": "把 {} 加入 SD-WAN — 一旦启用 SD-WAN，",
  "Adds {} to SD-WAN — the firewall assigns each a sequence number, and the SLAs and rules below are pointed at those numbers, not at the ones in the proposal":
    "把 {} 加入 SD-WAN — 防火墙会为每个成员分配一个序号，下面的 SLA 和规则引用的是这些序号，而不是方案中写的序号",
  "Adds {} SD-WAN rule(s), which are first-match top to bottom like firewall policies":
    "新增 {} 条 SD-WAN 规则，与防火墙策略一样自上而下、首个匹配生效",
  'Member "{}" names no SD-WAN zone.': '成员“{}”没有指定 SD-WAN 区域。',
  'Member "{}" is in zone "{}", which this proposal does not create and the device does not have.':
    '成员“{}”属于区域“{}”，而此方案不会创建该区域，设备上也没有。',
  'Rule "{}" names no outgoing member or zone this proposal creates, so it would never steer anything.':
    '规则“{}”没有指定此方案会创建的出向成员或区域，因此它不会引导任何流量。',
  'Rule "{}" uses the Best-quality strategy but names no measured SLA.':
    '规则“{}”使用了“最佳质量”策略，却没有指定用于测量的 SLA。',
  'Rule "{}" uses the {} strategy but names no required SLA target.':
    '规则“{1}”使用了 {2} 策略，却没有指定必须满足的 SLA 目标。',
  '"{}" cannot become an SD-WAN member while firewall':
    '在以下防火墙策略仍指向它时，“{}”无法成为 SD-WAN 成员：',

  // -- Missing prerequisites -------------------------------------------------
  'Address "{}" doesn\'t exist on the device and has no definition to create it. Open the Address Wizard for it first, or pick an existing address.':
    '设备上不存在地址“{}”，也没有可用于创建它的定义。请先为它打开地址向导，或改选一个已有的地址。',
  'Service "{}" doesn\'t exist on the device and has no definition to create it. Open the Service Wizard for it first, or pick an existing service.':
    '设备上不存在服务“{}”，也没有可用于创建它的定义。请先为它打开服务向导，或改选一个已有的服务。',
  'Schedule "{}" doesn\'t exist on the device and has no definition to create it. Open the Schedule Wizard for it first, or pick an existing schedule.':
    '设备上不存在计划表“{}”，也没有可用于创建它的定义。请先为它打开计划表向导，或改选一个已有的计划表。',
  'The name "{}" is already taken on the device (type {}) — FortiGate shares one name space across all schedule types':
    '名称“{}”在设备上已被占用（类型 {}）— FortiGate 的所有计划表类型共用一个命名空间',
  'This address is bound to interface "{}" — it only works in a policy whose source or destination interface is the same one':
    '此地址绑定到接口“{}”— 它只能用在源接口或目标接口相同的策略中',
  "Could not evaluate {} (FQDN / geography / not readable from the device) —":
    "无法评估 {}（FQDN / 地理位置 / 无法从设备读取）—",

  // -- Policy shadowing ------------------------------------------------------
  'Placement: above policy "{}" — FortiGate matches top to bottom (first match wins)':
    '位置：位于策略“{}”之上 — FortiGate 自上而下匹配（首个匹配生效）',
  '"{}" (position {}) matches this traffic first —': '“{}”（第 {} 位）会先匹配到此流量 —',
  'the new policy would never be reached (first match wins); move it above "{}" for it to take effect':
    '新策略将永远不会被匹配到（首个匹配生效）；把它移到“{}”之上才能生效',
  "the new policy fully covers this one and does the opposite ({} vs {}) —":
    "新策略完全覆盖了这一条并且动作相反（{} 对 {}）—",
  "this policy already covers the same traffic and does the same thing ({}) — the new one adds nothing":
    "此策略已经覆盖了相同的流量并且做同样的事（{}）— 新策略没有增加任何效果",
  "this policy sits above it and {} all of the same traffic —":
    "此策略位于其上方，并且{}了全部相同的流量 —",
  "traffic partly overlaps and the actions differ ({} vs {}) — order decides which one wins":
    "流量部分重叠且动作不同（{} 对 {}）— 由顺序决定哪一条胜出",
  "so which rule shadows which cannot be confirmed ({} vs {})":
    "因此无法确认哪条规则遮蔽了哪条（{} 对 {}）",
  'Policy "{}" allows every source, destination and service — it is wide open':
    '策略“{}”放行所有源、目标和服务 — 完全没有限制',
  'Policy "{}" has no security profile attached — traffic passes without being scanned':
    '策略“{}”没有附加任何安全配置文件 — 流量不经扫描直接通过',
  'before "{}"': '在“{}”之前',
  "Top of {}": "{} 的顶部",
  "Bottom of {}": "{} 的底部",

  // -- Traffic descriptions --------------------------------------------------
  "Traffic to {} leaves through {}": "发往 {} 的流量经由 {} 出去",
  "Traffic to {} will leave through {} instead": "发往 {} 的流量将改为经由 {} 出去",
  "All traffic to {} is dropped (blackhole)": "发往 {} 的所有流量都会被丢弃（黑洞）",
  "Drops all traffic to {} (blackhole route)": "丢弃发往 {} 的所有流量（黑洞路由）",
  "Allowed by {} —": "由 {} 放行 —",
  "IP of interface {}": "接口 {} 的 IP",
  "IP pool {}{}": "IP 池 {}{}",
  "IP protocol {}": "IP 协议 {}",
  "· NAT on — the source is rewritten to the IP of {}":
    "· 已开启 NAT — 源地址被改写为 {} 的 IP",
  "({}) on service {}{}{}": "（{}）作用于服务 {}{}{}",
  "Internet Service #{}": "互联网服务 #{}",
  "Internet Service {}": "互联网服务 {}",
  "Static Route → {}": "静态路由 → {}",
  "via gateway {}": "经由网关 {}",
  "via {} ({})": "经由 {}（{}）",
  "distance {} · priority {}": "距离 {} · 优先级 {}",
  "bound to {}": "绑定到 {}",
  "(bound to interface {})": "（绑定到接口 {}）",
  "— behind interface {}": "— 位于接口 {} 之后",

  // -- Per-profile summaries -------------------------------------------------
  "AntiVirus — {}": "防病毒 — {}",
  "Web Filter — {}": "Web 过滤 — {}",
  "DNS Filter — {}": "DNS 过滤 — {}",
  "Application Control — {}": "应用控制 — {}",
  "File Filter — {}": "文件过滤 — {}",
  "Virtual IP — {}": "虚拟 IP — {}",
  "IPsec VPN — {}": "IPsec VPN — {}",
  "Hub-and-Spoke (FortiGate {}) — created by the AI Assistant":
    "中心-分支（FortiGate {}）— 由 AI 助手创建",
  "Remote Access ({}) — created by the AI Assistant": "远程接入（{}）— 由 AI 助手创建",

  // -- Failures --------------------------------------------------------------
  "Failed to {} policy": "{}策略失败",
  "Failed to {} address": "{}地址失败",
  "Failed to {} service": "{}服务失败",
  "Failed to {} schedule": "{}计划表失败",
  "Failed to {} route": "{}路由失败",
  "Failed to {} virtual IP": "{}虚拟 IP 失败",
  "Failed to {} user": "{}用户失败",
  "Failed to {} user group": "{}用户组失败",
  "Failed to {} LDAP server": "{} LDAP 服务器失败",
  "Failed to {} RADIUS server": "{} RADIUS 服务器失败",
  "Failed to {} AntiVirus profile": "{}防病毒配置文件失败",
  "Failed to {} Web Filter profile": "{} Web 过滤配置文件失败",
  "Failed to {} DNS Filter profile": "{} DNS 过滤配置文件失败",
  "Failed to {} Application Control list": "{}应用控制列表失败",
  "Failed to {} File Filter profile": "{}文件过滤配置文件失败",

  // -- Fallback --------------------------------------------------------------
  "Fallback ({})": "回退（{}）",
  'Fallback: {} "{}"': '回退：{}“{}”',
  'Fallback: {} "{}" — previous values restored': '回退：{}“{}”— 已恢复原有值',
  'Fallback failed for {} "{}" — {}': '{}“{}”回退失败 — {}',
  "Fallback success — {}": "回退成功 — {}",
  "Fallback incomplete — {} object(s) are still on the device":
    "回退不完整 — 仍有 {} 个对象留在设备上",
  "Removed {} object(s) from the firewall": "已从防火墙上删除 {} 个对象",
  "Restored {} object(s)": "已恢复 {} 个对象",
  '"{}" is still referenced by another object on the device, so FortiGate refuses to delete it':
    '“{}”仍被设备上的另一个对象引用，因此 FortiGate 拒绝删除它',

  // -- Simulate ----------------------------------------------------------------------
  "~{} addresses": "约 {} 个地址",
  "~{} addresses · on {}": "约 {} 个地址 · 位于 {}",
  "unrestricted · on {}": "不受限 · 位于 {}",
  "any source · on {}": "任意来源 · 位于 {}",
  "Above “{}”": "位于“{}”之上",
  "Walk the rule table again from \"{}\"": "从“{}”重新沿规则表走一遍",
  "Place it above \"{}\", which currently claims this traffic first": "将其置于“{}”之上——该规则目前会先认领此流量",
  "“{}” already matches this traffic and sits above it. FortiOS stops at the first match, so the firewall would behave exactly as it does now.":
    "“{}”已匹配此流量并位于其上方。FortiOS 在第一条匹配处停止，因此防火墙的行为将与现在完全相同。",
  "\"{}\" already matches this traffic and sits above it, so the new rule can never run.":
    "“{}”已匹配此流量并位于其上方，因此新规则永远不会生效。",
  ", and {}": "，并且 {}",
  "And it is now inspected by {}.": "并且现在由 {} 检测。",
  "AntiVirus: {}": "防病毒：{}",
  "Web Filter: {}": "Web 过滤：{}",
  "DNS Filter: {}": "DNS 过滤：{}",
  "App Control: {}": "应用控制：{}",
  "IPS: {}": "IPS：{}",
  "File Filter: {}": "文件过滤：{}",
  "\"{}\" (#{}) carries less than it did": "“{}”（#{}）承载的流量比以前少",
  "Everything it matches is already claimed by \"{}\" one row above, so it can never run again.":
    "它匹配的所有流量都已被上一行的“{}”认领，因此它再也不会生效。",
  "Flow {} could not be evaluated": "流量 {} 无法评估",
  "It still matches {} → {} on {}, minus the part \"{}\" now claims one row above. Worth checking that what it keeps is still what it was written for.":
    "它仍匹配 {3} 上的 {1} → {2}，但要减去上一行“{4}”现在认领的部分。值得检查它保留的部分是否仍符合其原本用途。",
  "Out of {}. Anything on that network that still needs to get out needs a rule ABOVE this one, created in the same change.":
    "从 {} 出去。该网络中仍需要出去的流量，都需要在同一次更改中于此规则之上创建一条规则。",
  "Still matches, but the part it shares with \"{}\" now stops one row higher.":
    "仍然匹配，但它与“{}”共享的部分现在会提前一行停止。",
  "Taken from \"{}\" — a rule below the new one on the same interface pair":
    "取自“{}”——同一接口对上位于新规则下方的一条规则",
  "Tested top to bottom. {} of the {} policies never share this interface pair and are folded into the grey bands.":
    "自上而下测试。{} / {} 条策略不在此接口对上，已折叠到灰色区域中。",
  "The walk stopped at \"{}\" because {} cannot be reduced to an address range — an FQDN, a geography object, or a name the device did not answer for. No conclusion is drawn about it either way.":
    "路径在“{}”处停止，因为 {} 无法归结为地址范围——可能是 FQDN、地理对象，或设备未作应答的名称。对此不作任何结论。",
  "\"{}\" (#{}) was permitting it on this path and can no longer be reached. Nothing on the device reports this; the traffic simply starts failing.":
    "“{}”（#{}）原本在此路径上放行该流量，现在再也无法被匹配。设备不会报告这一点，流量只会开始失败。",

  // -- The AI Chat Clear control -------------------------------------------------
  "Clearing leaves the {} objects this conversation put on the firewall exactly where they are, and removes the Fallback buttons that would have taken them back off — you would have to delete them by hand.": "清空不会改动这段对话在防火墙上创建的 {} 个对象，但会一并移除用来撤回它们的 Fallback 按钮——你将需要手动删除它们。",

  "Another service the new rule {}": "新规则{}的另一个服务",
  "Only {} more image{} could be added (max {})": "最多只能再添加 {} 张图片{}（上限 {}）",
  "SD-WAN member \"{}\" is not on the device": "设备上没有 SD-WAN 成员 \"{}\"",
  "Up to {} images per message": "每条消息最多 {} 张图片",
  "VPN Wizard · {}": "VPN 向导 · {}",
  "You can attach up to {} images per message": "每条消息最多可以附加 {} 张图片",
  "any source · {} sample flow{}": "任意源 · {} 条示例流{}",
  "static route \"{}\" is not in the device's route table": "设备的路由表中没有静态路由 \"{}\"",
  "the {} network": "{} 网络",
};
