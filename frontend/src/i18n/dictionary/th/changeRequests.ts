/**
 * Thai — the Change Requests queue (Automation ▸ Change Requests).
 *
 * The page's whole purpose is to stop a reviewer from approving a sentence instead of a change, so
 * three renderings were chosen rather than transliterated:
 *
 *   "What this request does"   คำขอนี้ทำอะไร — the heading over the SERVER's derived summary. It must
 *                              read as a statement of fact, not as "คำอธิบายจากผู้ขอ".
 *   "What the requester said"  ผู้ขอเขียนไว้ว่าอะไร — deliberately attributive. The title and the reason
 *                              are evidence of intent, and Thai has to keep that distance.
 *   "failed" / 207             อนุมัติแล้ว แต่ไฟร์วอลล์ปฏิเสธการเขียน — never "การอนุมัติล้มเหลว". The
 *                              approval succeeded; the device refused. Reversing those two is the
 *                              one mistranslation on this page that could cost an outage.
 */

import type { Dict } from "../merge";

export const changeRequests: Dict = {
  // ── The page, the menu, the queue ──────────────────────────────────────────
  "Change Requests": "รายการคำขอเปลี่ยนแปลง",
  "Change request": "คำขอเปลี่ยนแปลง",
  "change request queue": "คิวคำขอเปลี่ยนแปลง",
  "Firewall writes proposed by somebody who may not apply them, waiting for a second pair of eyes":
    "การเขียนไฟร์วอลล์ที่เสนอโดยคนที่ไม่มีสิทธิ์นำไปใช้เอง กำลังรอให้อีกคนช่วยตรวจ",
  "Nothing on this list is in force. A write to a firewall policy, a virtual IP or a security profile by an account that may not apply changes is held here instead of reaching the device. Read what each request does — the action and the device it lands on — before the words the requester chose for it.":
    "ไม่มีรายการใดในลิสต์นี้ที่มีผลบังคับใช้ การเขียนนโยบายไฟร์วอลล์ virtual IP หรือโปรไฟล์ความปลอดภัยโดยบัญชีที่ไม่มีสิทธิ์นำการเปลี่ยนแปลงไปใช้ จะถูกกักไว้ที่นี่แทนที่จะไปถึงอุปกรณ์ ให้อ่านว่าแต่ละคำขอทำอะไร — การกระทำและอุปกรณ์ที่จะได้รับผล — ก่อนอ่านถ้อยคำที่ผู้ขอเลือกใช้",
  "Waiting for your review:": "รอให้คุณตรวจ:",
  "Search the queue…": "ค้นหาในคิว…",
  "Whose requests": "คำขอของใคร",
  Everyone: "ทุกคน",
  Mine: "ของฉัน",

  // ── The queue table ───────────────────────────────────────────────────────
  "What it does": "ทำอะไร",
  Raised: "เวลาที่เสนอ",
  "Past its expiry": "เลยกำหนดหมดอายุแล้ว",
  "No change request matches this filter": "ไม่มีคำขอเปลี่ยนแปลงที่ตรงกับตัวกรองนี้",
  "Nothing has been proposed yet": "ยังไม่มีใครเสนอการเปลี่ยนแปลง",
  "You have not raised a change request": "คุณยังไม่ได้เสนอคำขอเปลี่ยนแปลง",
  "A write to a firewall policy, a virtual IP or a security profile by an account that cannot apply changes appears here.":
    "การเขียนนโยบายไฟร์วอลล์ virtual IP หรือโปรไฟล์ความปลอดภัย โดยบัญชีที่ไม่มีสิทธิ์นำการเปลี่ยนแปลงไปใช้ จะมาปรากฏที่นี่",
  "The change request queue could not be read": "อ่านคิวคำขอเปลี่ยนแปลงไม่ได้",
  "Requests may well be waiting for review — this list is “unreadable”, not “empty”":
    "อาจมีคำขอรอการตรวจอยู่จริง — ลิสต์นี้คือ “อ่านไม่ได้” ไม่ใช่ “ว่าง”",

  // ── The derived action ────────────────────────────────────────────────────
  "Enable or disable": "เปิดหรือปิดใช้งาน",
  Reorder: "สลับลำดับ",
  "security profile": "โปรไฟล์ความปลอดภัย",
  "Application Control sensor": "เซ็นเซอร์ควบคุมแอปพลิเคชัน",
  "write to this firewall": "การเขียนลงไฟร์วอลล์นี้",
  "interface zone": "โซนอินเทอร์เฟซ",
  "Exchange connector": "ตัวเชื่อม Exchange",
  "SD-WAN performance SLA": "SLA วัดคุณภาพของ SD-WAN",
  "several at once": "หลายรายการพร้อมกัน",

  // ── Status ────────────────────────────────────────────────────────────────
  "Waiting for review": "รอการตรวจ",
  "Approved, not yet applied": "อนุมัติแล้ว ยังไม่ถูกนำไปใช้",
  "Applied to the firewall": "ถูกนำไปใช้กับไฟร์วอลล์แล้ว",
  "Withdrawn by the requester": "ผู้เสนอถอนคำขอแล้ว",
  "Approved, firewall refused it": "อนุมัติแล้ว ไฟร์วอลล์ปฏิเสธ",
  "Expired unreviewed": "หมดอายุโดยไม่มีใครตรวจ",

  // ── The detail dialog ─────────────────────────────────────────────────────
  "What this request does": "คำขอนี้ทำอะไร",
  "Derived from the stored request, not from what the requester called it.":
    "สรุปจากคำขอที่บันทึกไว้ ไม่ใช่จากชื่อที่ผู้ขอตั้งเอง",
  "On device": "บนอุปกรณ์",
  "This device is no longer in the inventory": "อุปกรณ์นี้ไม่อยู่ในรายการอุปกรณ์แล้ว",
  Request: "คำขอ",
  Resource: "สิ่งที่ถูกแก้",
  "Recorded as": "บันทึกไว้ว่า",
  "Payload to be written": "ข้อมูลที่จะถูกเขียนลงอุปกรณ์",
  "What the requester said": "ผู้ขอเขียนไว้ว่าอะไร",
  "The requester's own wording. It describes their intent, not what the request will do.":
    "ถ้อยคำของผู้ขอเอง บอกเจตนาของเขา ไม่ใช่สิ่งที่คำขอนี้จะทำ",
  "The requester gave no reason.": "ผู้ขอไม่ได้ให้เหตุผลไว้",
  "Where it stands": "สถานะปัจจุบัน",
  "Raised by": "ผู้เสนอ",
  Expires: "หมดอายุ",
  Window: "ช่วงเวลา",
  "Reviewed by": "ผู้ตรวจ",
  "Review note": "บันทึกการตรวจ",
  "What the firewall said": "ไฟร์วอลล์ตอบว่าอะไร",
  "This request was approved by the person who raised it, because no other administrator account existed to review it. It was not a second pair of eyes.":
    "คำขอนี้ถูกอนุมัติโดยคนที่เสนอเอง เพราะไม่มีบัญชีผู้ดูแลระบบคนอื่นให้ตรวจ จึงไม่ถือว่ามีคนที่สองช่วยตรวจ",

  // ── Deciding ──────────────────────────────────────────────────────────────
  "Your decision": "การตัดสินใจของคุณ",
  "Note (kept with the request)": "บันทึกเพิ่มเติม (เก็บไว้กับคำขอ)",
  "Why you approved or rejected this": "เหตุผลที่คุณอนุมัติหรือปฏิเสธ",
  "Apply in a maintenance window instead of now (optional)":
    "เลือกให้ไปใช้ในช่วงเวลาปิดปรับปรุงแทนที่จะใช้เดี๋ยวนี้ (ไม่บังคับ)",
  "Leave this empty to apply the change as soon as you approve it.":
    "เว้นว่างไว้ถ้าต้องการให้นำไปใช้ทันทีที่อนุมัติ",
  "Approve and apply": "อนุมัติและนำไปใช้",
  "Approve for the window": "อนุมัติไว้ให้ใช้ตามช่วงเวลา",
  Reject: "ปฏิเสธ",

  // ── What a decision achieved ──────────────────────────────────────────────
  "Approved, waiting for its window": "อนุมัติแล้ว กำลังรอช่วงเวลาที่กำหนด",
  "Approved, not applied yet": "อนุมัติแล้ว ยังไม่ได้นำไปใช้",
  "Approved, but the firewall refused the write": "อนุมัติแล้ว แต่ไฟร์วอลล์ปฏิเสธการเขียน",
  "Approved, but it could not be applied": "อนุมัติแล้ว แต่นำไปใช้ไม่ได้",
  "The approval was recorded, but the firewall refused the write":
    "บันทึกการอนุมัติไว้แล้ว แต่ไฟร์วอลล์ปฏิเสธการเขียน",
  "The approval was recorded, but the change could not be applied":
    "บันทึกการอนุมัติไว้แล้ว แต่นำการเปลี่ยนแปลงไปใช้ไม่ได้",
  "The decision is recorded. The firewall does not carry this change — do not approve it again; it has already left the queue.":
    "การตัดสินใจถูกบันทึกไว้แล้ว ไฟร์วอลล์ยังไม่มีการเปลี่ยนแปลงนี้ — อย่ากดอนุมัติซ้ำ เพราะคำขอออกจากคิวไปแล้ว",
  "Change request approved": "อนุมัติคำขอเปลี่ยนแปลงแล้ว",
  "Change request approved and applied": "อนุมัติคำขอเปลี่ยนแปลงและนำไปใช้แล้ว",
  "Change request approved — it will be applied in its window":
    "อนุมัติคำขอเปลี่ยนแปลงแล้ว — จะถูกนำไปใช้ในช่วงเวลาที่กำหนด",
  "Change request rejected": "ปฏิเสธคำขอเปลี่ยนแปลงแล้ว",
  "Change request withdrawn": "ถอนคำขอเปลี่ยนแปลงแล้ว",

  // ── Why a button is not offered ───────────────────────────────────────────
  "Only an administrator can approve or reject a change request.":
    "มีเพียงผู้ดูแลระบบที่อนุมัติหรือปฏิเสธคำขอเปลี่ยนแปลงได้",
  "This request has already been decided.": "คำขอนี้ถูกตัดสินไปแล้ว",
  "You raised this request, so you cannot approve it. Separation of duties is the point of the queue — another administrator has to review it.":
    "คุณเป็นคนเสนอคำขอนี้ จึงอนุมัติเองไม่ได้ การแยกหน้าที่คือเหตุผลที่มีคิวนี้ — ต้องให้ผู้ดูแลระบบคนอื่นตรวจ",
  "This request has expired. It was written against the firewall as it was then, and nobody can see what has changed since.":
    "คำขอนี้หมดอายุแล้ว มันถูกเขียนขึ้นกับไฟร์วอลล์ในสภาพตอนนั้น และไม่มีใครเห็นว่าหลังจากนั้นมีอะไรเปลี่ยนไป",

  // ── Withdrawing ───────────────────────────────────────────────────────────
  "Withdraw this request": "ถอนคำขอนี้",
  "Withdraw this request?": "ถอนคำขอนี้หรือไม่",
  "It will not be reviewed and nothing will reach the firewall. This cannot be undone — you would have to raise the change again.":
    "จะไม่มีใครตรวจคำขอนี้ และไม่มีอะไรไปถึงไฟร์วอลล์ การถอนย้อนกลับไม่ได้ — ต้องเสนอการเปลี่ยนแปลงใหม่อีกครั้ง",
  "Yes, withdraw it": "ใช่ ถอนเลย",
  "Keep it in the queue": "เก็บไว้ในคิวต่อ",
};
