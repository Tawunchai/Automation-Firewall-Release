/**
 * Chinese — the Change Requests queue (Automation ▸ Change Requests).
 *
 * The page exists to stop a reviewer from approving a sentence instead of a change, so three
 * renderings were chosen rather than transliterated:
 *
 *   "What this request does"   这条申请做什么 — the heading over the SERVER's derived summary. It is a
 *                              statement of fact, not "申请人的描述".
 *   "What the requester said"  申请人的说法 — deliberately attributive. The title and the reason are
 *                              evidence of intent, and Chinese has to keep that distance.
 *   "failed" / 207             已批准，防火墙拒绝 — never "批准失败". The approval succeeded and the device
 *                              refused; swapping those two is the one mistranslation on this page
 *                              that could cost an outage.
 */

import type { Dict } from "../merge";

export const changeRequests: Dict = {
  // ── The page, the menu, the queue ──────────────────────────────────────────
  "Change Requests": "变更申请列表",
  "Change request": "变更申请",
  "change request queue": "变更申请队列",
  "Firewall writes proposed by somebody who may not apply them, waiting for a second pair of eyes":
    "由无权自行应用的人提出的防火墙写入，正在等待第二双眼睛审核",
  "Nothing on this list is in force. A write to a firewall policy, a virtual IP or a security profile by an account that may not apply changes is held here instead of reaching the device. Read what each request does — the action and the device it lands on — before the words the requester chose for it.":
    "此列表中的任何一项都尚未生效。无权应用变更的账号对防火墙策略、虚拟 IP 或安全配置文件的写入会被扣留在这里，而不会到达设备。请先看清每条申请做了什么 — 动作以及落到哪台设备 — 再看申请人自己的措辞。",
  "Waiting for your review:": "等待你审核：",
  "Search the queue…": "搜索队列…",
  "Whose requests": "谁的申请",
  Everyone: "所有人",
  Mine: "我的",

  // ── The queue table ───────────────────────────────────────────────────────
  "What it does": "做什么",
  Raised: "提出时间",
  "Past its expiry": "已超过过期时间",
  "No change request matches this filter": "没有变更申请符合此筛选条件",
  "Nothing has been proposed yet": "还没有人提出任何变更",
  "You have not raised a change request": "你还没有提出过变更申请",
  "A write to a firewall policy, a virtual IP or a security profile by an account that cannot apply changes appears here.":
    "无权应用变更的账号对防火墙策略、虚拟 IP 或安全配置文件的写入，都会出现在这里。",
  "The change request queue could not be read": "读不到变更申请队列",
  "Requests may well be waiting for review — this list is “unreadable”, not “empty”":
    "可能确实有申请在等待审核 — 此列表是“读不到”，而不是“空的”",

  // ── The derived action ────────────────────────────────────────────────────
  "Enable or disable": "启用或禁用",
  Reorder: "调整顺序",
  "security profile": "安全配置文件",
  "Application Control sensor": "应用控制传感器",
  "write to this firewall": "对这台防火墙的写入",
  "interface zone": "接口区域",
  "Exchange connector": "Exchange 连接器",
  "SD-WAN performance SLA": "SD-WAN 性能 SLA",
  "several at once": "一次多个",

  // ── Status ────────────────────────────────────────────────────────────────
  "Waiting for review": "等待审核",
  "Approved, not yet applied": "已批准，还没有应用",
  "Applied to the firewall": "已应用到防火墙",
  "Withdrawn by the requester": "已被申请人撤回",
  "Approved, firewall refused it": "已批准，防火墙拒绝",
  "Expired unreviewed": "未经审核即过期",

  // ── The detail dialog ─────────────────────────────────────────────────────
  "What this request does": "这条申请做什么",
  "Derived from the stored request, not from what the requester called it.":
    "由保存下来的请求推导得出，而不是申请人给它起的名字。",
  "On device": "所在设备",
  "This device is no longer in the inventory": "该设备已不在设备清单中",
  Request: "请求",
  Resource: "所涉对象",
  "Recorded as": "记录为",
  "Payload to be written": "将要写入的内容",
  "What the requester said": "申请人的说法",
  "The requester's own wording. It describes their intent, not what the request will do.":
    "申请人自己的措辞。它说明的是其意图，而不是这条申请会做什么。",
  "The requester gave no reason.": "申请人没有给出原因。",
  "Where it stands": "当前进展",
  "Raised by": "提出人",
  Expires: "过期时间",
  Window: "窗口期",
  "Reviewed by": "审核人",
  "Review note": "审核备注",
  "What the firewall said": "防火墙的回复",
  "This request was approved by the person who raised it, because no other administrator account existed to review it. It was not a second pair of eyes.":
    "这条申请是由提出它的人自己批准的，因为当时没有其他管理员账号可以审核。这并不算第二双眼睛。",

  // ── Deciding ──────────────────────────────────────────────────────────────
  "Your decision": "你的决定",
  "Note (kept with the request)": "备注（随申请一起保存）",
  "Why you approved or rejected this": "你批准或驳回的原因",
  "Apply in a maintenance window instead of now (optional)": "改在维护窗口期应用，而不是立即应用（可选）",
  "Leave this empty to apply the change as soon as you approve it.": "留空表示批准后立即应用该变更。",
  "Approve and apply": "批准并应用",
  "Approve for the window": "批准并留到窗口期",
  Reject: "驳回",

  // ── What a decision achieved ──────────────────────────────────────────────
  "Approved, waiting for its window": "已批准，等待其窗口期",
  "Approved, not applied yet": "已批准，尚未应用",
  "Approved, but the firewall refused the write": "已批准，但防火墙拒绝了写入",
  "Approved, but it could not be applied": "已批准，但无法应用",
  "The approval was recorded, but the firewall refused the write": "批准已记录，但防火墙拒绝了写入",
  "The approval was recorded, but the change could not be applied": "批准已记录，但该变更无法应用",
  "The decision is recorded. The firewall does not carry this change — do not approve it again; it has already left the queue.":
    "决定已记录。防火墙并没有这项变更 — 不要再次批准，它已经离开队列了。",
  "Change request approved": "变更申请已批准",
  "Change request approved and applied": "变更申请已批准并应用",
  "Change request approved — it will be applied in its window": "变更申请已批准 — 将在其窗口期应用",
  "Change request rejected": "变更申请已驳回",
  "Change request withdrawn": "变更申请已撤回",

  // ── Why a button is not offered ───────────────────────────────────────────
  "Only an administrator can approve or reject a change request.": "只有管理员才能批准或驳回变更申请。",
  "This request has already been decided.": "这条申请已经被裁定过了。",
  "You raised this request, so you cannot approve it. Separation of duties is the point of the queue — another administrator has to review it.":
    "这条申请是你提出的，所以你不能自己批准。职责分离正是这个队列存在的理由 — 必须由另一位管理员来审核。",
  "This request has expired. It was written against the firewall as it was then, and nobody can see what has changed since.":
    "这条申请已过期。它是针对当时的防火墙写的，没有人能看出此后又改了什么。",

  // ── Withdrawing ───────────────────────────────────────────────────────────
  "Withdraw this request": "撤回这条申请",
  "Withdraw this request?": "要撤回这条申请吗？",
  "It will not be reviewed and nothing will reach the firewall. This cannot be undone — you would have to raise the change again.":
    "它不会被审核，也不会有任何内容到达防火墙。此操作无法撤销 — 你需要重新提出这项变更。",
  "Yes, withdraw it": "是，撤回它",
  "Keep it in the queue": "继续留在队列中",
};
