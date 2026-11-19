/**
 * Thai — the interpolated sentences of Audit / Review, Rule Lifecycle, the Change Ledger and Notify.
 *
 * `Revert "{} {} {}"?` holds an action, a CMDB table and an mkey, in that order. All three stay
 * verbatim: the sentence around them is the console's, but those words are the change as the ledger
 * recorded it and as the device would name it.
 */
import type { Dict } from "../merge";

export const auditPatterns: Dict = {
  // -- Findings and scans ----------------------------------------------------
  "None of the {} checks found a problem": "การตรวจทั้ง {} รายการไม่พบปัญหาเลย",
  "Checked {} rule(s) on {} device(s) — nothing to report":
    "ตรวจกฎ {} ข้อบนอุปกรณ์ {} เครื่องแล้ว — ไม่มีอะไรต้องรายงาน",
  "— {} finding{}": "— พบ {} รายการ{}",
  "; the remaining {} say why they are not": "; อีก {} รายการที่เหลือระบุเหตุผลไว้ว่าทำไมจึงไม่ใช่",
  "· catalogue {}": "· แคตตาล็อก {}",
  "· catalogue {} ({})": "· แคตตาล็อก {} ({})",
  "· rated {}": "· ให้เรต {}",
  "· the device graded itself {}": "· อุปกรณ์ให้เกรดตัวเองว่า {}",
  "· run by {}": "· รันโดย {}",
  "withdrawn by {} on {}": "ถอนโดย {} เมื่อ {}",
  "This rule has carried traffic before (last used {}) — idle, not dead":
    "กฎนี้เคยมีทราฟฟิกวิ่งผ่าน (ใช้ล่าสุด {}) — เพียงไม่มีการใช้งาน ไม่ใช่ตายแล้ว",

  // -- Deleting a policy from Rule Lifecycle --------------------------------
  "Delete policy {} {}": "ลบนโยบาย {} {}",
  "Delete policy {} from the device": "ลบนโยบาย {} ออกจากอุปกรณ์",
  "Deleted policy {} {} from the device": "ลบนโยบาย {} {} ออกจากอุปกรณ์แล้ว",
  "will be permanently removed from {}": "จะถูกลบอย่างถาวรจาก {}",

  // -- Change Ledger ---------------------------------------------------------
  'Revert "{} {} {}"?': 'ย้อนกลับ "{} {} {}" หรือไม่?',

  // -- Notify ----------------------------------------------------------------
  "Add recipient — {}": "เพิ่มผู้รับ — {}",
  "Remove {}": "ลบ {}",
  'Delete "{}"?': 'ลบ "{}" หรือไม่?',
  "Edit {}": "แก้ไข {}",
  "Edit “{}”": "แก้ไข “{}”",
  "Send to {}": "ส่งไปยัง {}",
  "sent to {}": "ส่งไปยัง {} แล้ว",
  '"{}" is not a valid email address': '"{}" ไม่ใช่ที่อยู่อีเมลที่ถูกต้อง',
  "Its {} recipient(s) go too, and any alert rule pointing at them stops reaching anyone.":
    "ผู้รับ {} รายของช่องทางนี้จะถูกลบไปด้วย และกฎการแจ้งเตือนใดที่ชี้มาที่พวกเขาจะส่งไม่ถึงใครอีก",
  "Test message delivered to {} recipient(s)": "ส่งข้อความทดสอบถึงผู้รับ {} รายแล้ว",
  "Test sent to {} recipient(s)": "ส่งการทดสอบไปยังผู้รับ {} รายแล้ว",
  "fires after {} checks (about {} min)": "แจ้งเตือนหลังการตรวจ {} ครั้ง (ราว {} นาที)",
  "fires after {} checks ({}s)": "แจ้งเตือนหลังการตรวจ {} ครั้ง ({} วินาที)",
  "repeats at most every {} min": "ส่งซ้ำได้อย่างมากทุก {} นาที",
  "repeats at most every {} h": "ส่งซ้ำได้อย่างมากทุก {} ชั่วโมง",
  "({} disabled)": "({} รายการถูกปิดใช้งาน)",
  "failed ({})": "ล้มเหลว ({})",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{} of the rules that could be evaluated": "{} ของกฎที่ประเมินได้",

  // -- Configuration Drift -----------------------------------------------------
  "last {} days": "{} วันที่ผ่านมา",
  "{} days": "{} วัน",
  "Most outside changes: {} ({})": "วันที่เปลี่ยนนอกคอนโซลมากที่สุด: {} ({})",
  "None refused · {}": "ไม่มีการปฏิเสธ · {}",
  "Nothing changed in the {}": "ไม่มีการเปลี่ยนแปลงในช่วง {}",
  "The device refused these · {}": "อุปกรณ์ปฏิเสธรายการเหล่านี้ · {}",
  "{} since reverted · {}": "ย้อนกลับไปแล้ว {} รายการ · {}",
  "{}% of all changes · {}": "{}% ของการเปลี่ยนแปลงทั้งหมด · {}",
  "{} rejected by the device": "อุปกรณ์ปฏิเสธ {} รายการ",
  "{} changes nobody here can account for": "มี {} การเปลี่ยนแปลงที่ไม่มีใครในนี้ระบุที่มาได้",
  "{}–{} of {}": "{}–{} จาก {}",
  "Device #{}": "อุปกรณ์ #{}",
  "Reviewed by {}": "ตรวจทานโดย {}",
  "Reviewed by {} on {}": "ตรวจทานโดย {} เมื่อ {}",
  "Reviewed by {} — {}": "ตรวจทานโดย {} — {}",
  "Reviewed by {} on {} — {}": "ตรวจทานโดย {} เมื่อ {} — {}",
  "Reverted {} by {}": "ย้อนกลับเมื่อ {} โดย {}",

  // -- Configuration Drift: change history -------------------------------------
  "Backup #{} → #{}": "แบ็กอัป #{} → #{}",
  "Delete {} from the firewall?": "ลบ {} ออกจากไฟร์วอลล์หรือไม่?",
  "Undo this change to {}?": "ย้อนการเปลี่ยนแปลงนี้ของ {} หรือไม่?",
  "Found by backup comparison {}": "พบจากการเปรียบเทียบแบ็กอัป {}",
  "Happened between {} and {} — found by backup comparison": "เกิดขึ้นระหว่าง {} ถึง {} — พบจากการเปรียบเทียบแบ็กอัป",
  "Last compared {}": "เปรียบเทียบล่าสุด {}",
  "Made by the console's {} feature": "ทำโดยฟีเจอร์ {} ของคอนโซล",
  "No — {}.": "ไม่ได้ — {}",
  "Showing the newest {} of {}": "แสดง {} รายการล่าสุดจาก {}",
  "Step {}": "ขั้นที่ {}",
  "Undone {} by {}": "ย้อนกลับเมื่อ {} โดย {}",
  "Undo of #{}": "ย้อนกลับของ #{}",
  "this is part of a larger object ({}) — restore the backup taken before it": "นี่เป็นส่วนหนึ่งของอ็อบเจกต์ที่ใหญ่กว่า ({}) — ให้กู้คืนแบ็กอัปที่สร้างก่อนหน้านั้น",

  // -- Audit: controls and remediation ------------------------------------------------
  "What is wrong right now ({})": "สิ่งที่ผิดอยู่ตอนนี้ ({})",
  "across {} frameworks": "จาก {} เฟรมเวิร์ก",
  "Commands checked with {} on this device": "ตรวจคำสั่งด้วย {} บนอุปกรณ์นี้",
  "per-attribute ({})": "รายแอตทริบิวต์ ({})",
  "Applied {} change(s)": "ปรับใช้ {} รายการแล้ว",
  ", {} failed": " ล้มเหลว {} รายการ",
  "Write {} changes to this firewall?": "เขียนการเปลี่ยนแปลง {} รายการลงไฟร์วอลล์นี้?",
  "Put {} changes back?": "คืนค่าการเปลี่ยนแปลง {} รายการ?",

  // -- Configuration Drift: the one-line answer to "who changed this" ----------------
  "By {} over {} from {}": "โดย {} ผ่าน {} จาก {}",
  "By {} over {}": "โดย {} ผ่าน {}",
  "and {} more changes to it": "และมีการเปลี่ยนอีก {} ครั้ง",

  // -- Security Posture Score (dashboard tile) --------------------------------
  "· scanned {}": "· สแกนเมื่อ {}",

  "Changes by FortiOS table — {}": "การเปลี่ยนแปลงแยกตามตารางของ FortiOS — {}",
};
