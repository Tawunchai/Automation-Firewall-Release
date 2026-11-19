/**
 * 简体中文 — Address Groups, Service Groups, IP Pools, Zones, and the usage scan that guards every
 * delete in Policy & Objects.
 *
 * Same two decisions as the Thai file next door. Object type names read as descriptions of the
 * FortiOS term ("地址组") rather than replacing it, so a reader can still match the screen against
 * `show firewall addrgrp`; the four NAT pool types stay in English in ../keep.ts because they are
 * CLI values. And the warnings keep their edge: several of these strings exist only because the
 * device accepts something and then silently does not do it.
 */
import type { Dict } from "../merge";

export const groups: Dict = {
  // ── Page and section names ────────────────────────────────────────────────
  "Address Groups": "地址组",
  "Service Groups": "服务组",
  "IP Pools": "IP 池",
  "Zones": "区域",
  "address group": "地址组",
  "service group": "服务组",
  "IP pool": "IP 池",

  // The one-line subtitle under each page title.
  "A named set of members a policy can reference once instead of one rule per address.":
    "一组命名的成员，策略引用一次即可，不必为每个地址各写一条规则。",
  "A name for several interfaces, so a policy can be written once for “inside”.":
    "给多个接口起一个名字，这样“内网”只写一条策略就够了。",
  "The source addresses a policy's NAT translates to.":
    "策略做 NAT 时转换成的源地址。",

  // ── Table headers ─────────────────────────────────────────────────────────
  "CONTAINS": "包含",
  "FLAGS": "标记",
  "EXTERNAL RANGE": "外部地址范围",
  "ADDRESSES": "地址数",
  "INTERFACES": "接口",
  "INTRA-ZONE": "区域内",
  // The same four headers as rendered in mixed case — the table stopped upper-casing them in CSS.
  "Contains": "包含",
  "Flags": "标记",
  "External Range": "外部地址范围",
  "Intra-zone": "区域内",
  "DELETE": "删除",

  // ── Group form ────────────────────────────────────────────────────────────
  "What this group is for": "这个组的用途",
  "No members yet": "还没有成员",
  "Search name or member…": "搜索名称或成员…",
  "Create the first one": "创建第一个",
  "matches nothing": "匹配不到任何流量",
  "An empty group matches nothing, so a policy using it would silently pass no traffic":
    "空组匹配不到任何东西，引用它的策略会在毫无提示的情况下放行不了任何流量",
  "Exclude members": "排除成员",
  "— subtract addresses from the group above": "— 从上面的组里减去这些地址",
  "— lets a static route name this group as its destination": "— 允许静态路由把这个组作为目的地址",
  "Explicit proxy group": "显式代理组",
  "— for proxy policies, not firewall policies": "— 用于代理策略，不是防火墙策略",

  // ── IP pool form ──────────────────────────────────────────────────────────
  "New IP pool": "新建 IP 池",
  "Edit IP pool": "编辑 IP 池",
  "Search pools…": "搜索 IP 池…",
  "External IP — start": "外部 IP — 起始",
  "External IP — end": "外部 IP — 结束",
  "Internal IP — start": "内部 IP — 起始",
  "Internal IP — end": "内部 IP — 结束",
  "Block size": "端口块大小",
  "Blocks per user": "每用户块数",
  "Associated interface": "关联接口",
  "ARP reply": "ARP 应答",
  "Any": "全部",
  "— on by default on the device. With it off, nothing answers ARP for this range and the pool is unreachable unless something else does.":
    "— 设备上默认开启。关闭后没有任何设备为该地址段应答 ARP，除非另有设备代答，否则这个池不可达。",
  "Enter an external IP range to see what this pool will do.":
    "填入外部 IP 范围，就能看到这个池实际会做什么。",
  "One external address shared by everything, ports rewritten. This is plain PAT — pick One-to-One or Fixed Port Range if you meant each host to get its own address.":
    "所有流量共用一个外部地址并改写端口，这就是普通的 PAT —— 如果本意是让每台主机各占一个地址，请改选 One-to-One 或 Fixed Port Range。",

  // ── IP pool validation ────────────────────────────────────────────────────
  "External IP range needs two IPv4 addresses": "外部 IP 范围需要两个 IPv4 地址",
  "The external range ends before it starts": "外部范围的结束地址在起始地址之前",
  "The internal range ends before it starts": "内部范围的结束地址在起始地址之前",
  "Fixed Port Range needs an internal IP range as well as an external one":
    "Fixed Port Range 除了外部范围，还需要一个内部 IP 范围",
  "Block size is required": "必须填写端口块大小",
  "Blocks per user is required": "必须填写每用户块数",
  "Name is too long — FortiOS allows 79 characters": "名称过长 —— FortiOS 最多 79 个字符",

  // ── Zones ─────────────────────────────────────────────────────────────────
  "New zone": "新建区域",
  "Search zones or ports…": "搜索区域或端口…",
  "Intra-zone traffic": "区域内流量",
  "Deny — traffic between members still needs a policy": "Deny —— 成员之间的流量仍需要策略",
  "Allow — members can reach each other with no rule": "Allow —— 成员之间无需规则即可互通",
  "No interfaces reported": "设备没有报告任何接口",
  "no address": "没有地址",
  "no interfaces — matches nothing": "没有接口 —— 匹配不到任何流量",
  "An interface can only be in one zone, and FortiOS also refuses one that a firewall policy names directly. Ports already in another zone are greyed out here; the policy conflict only shows as the device's refusal when you save.":
    "一个接口只能属于一个区域，而且被防火墙策略直接引用的接口，FortiOS 同样会拒绝。已经属于其他区域的端口在这里是灰色的；与策略冲突的那一种，只会在保存时以设备的拒绝信息出现。",

  // ── Clone + bulk ──────────────────────────────────────────────────────────
  "Clone": "克隆",
  "Clone policy": "克隆策略",
  "CLONE POLICY": "克隆策略",
  "Name for the copy": "副本名称",
  "Select every policy": "选择全部策略",
  "Clear selection": "清除选择",
  "PARTLY APPLIED": "部分生效",

  // ── The usage scan ────────────────────────────────────────────────────────
  "Checking what still references it…": "正在检查还有什么在引用它…",
  "Still referenced by 1 place": "仍被 1 处引用",
  "Remove it from these first. FortiOS refuses the delete anyway, with an error code that names none of them.":
    "请先从这些地方移除。FortiOS 本来也会拒绝这次删除，但它只回一个错误码，一个都不会告诉你。",
  "Nothing references it. Every table was readable and the device agrees the count is zero.":
    "没有任何东西引用它。所有表都读到了，设备给出的引用计数也是零。",
  "the list could not be read": "列表读不到",
  "the interface list could not be read": "接口列表读不到",

  "A group needs at least one member — an empty group matches nothing, so a policy that uses it would silently pass no traffic":
    "组至少需要一个成员——空组什么都匹配不到，使用它的策略会悄无声息地不放行任何流量",
  "A zone needs at least one interface — an empty zone matches nothing, so a policy that uses it would silently pass no traffic":
    "区域至少需要一个接口——空区域什么都匹配不到，使用它的策略会悄无声息地不放行任何流量",
  "New Zone": "新建区域",
  "Zone names are limited to 35 characters": "区域名称最长 35 个字符",
};
