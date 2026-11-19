/**
 * Thai — the interpolated sentences the grouping objects, IP pools, zones and the usage scan build.
 *
 * Object names, device names and counts stay verbatim inside the holes: the name is the mkey on the
 * firewall, and the operator will type it again in a policy or look for it in `show`.
 *
 * Two of these reorder their holes with {1}/{2}, because Thai puts the count before the noun where
 * English puts it after. The dictionary test checks that no hole is dropped — losing one would make
 * a count, a device name or a refusal silently vanish from the screen.
 */
import type { Dict } from "../merge";

export const groupsPatterns: Dict = {
  // ── Saved / deleted ───────────────────────────────────────────────────────
  'IP pool "{}" {} on {}': 'IP pool "{}" {} บน {} แล้ว',
  'IP pool "{}" deleted from {}': 'ลบ IP pool "{}" ออกจาก {} แล้ว',
  'Zone "{}" {} on {}': 'โซน "{}" {} บน {} แล้ว',
  'Zone "{}" deleted from {}': 'ลบโซน "{}" ออกจาก {} แล้ว',
  'Could not delete "{}"': 'ลบ "{}" ไม่สำเร็จ',
  'Could not read {} "{}"': 'อ่าน{} "{}" ไม่ได้',

  // ── Pickers and empty states ──────────────────────────────────────────────
  "New {}": "สร้าง{}",
  "Search {}s…": "ค้นหา{}…",
  'No {} matches "{}"': 'ไม่มี{}ที่ตรงกับ "{}"',
  "Every {} is already a member": "{}ทุกตัวเป็นสมาชิกอยู่แล้ว",
  "not in the current {} list": "ไม่อยู่ในรายการ{}ปัจจุบัน",
  "Could not read the {} list ({}). This is unreadable, not empty.":
    "อ่านรายการ{}ไม่ได้ ({}) — นี่คืออ่านไม่ได้ ไม่ใช่ว่างเปล่า",
  "Could not read the interface list ({}). This is unreadable, not empty.":
    "อ่านรายการอินเทอร์เฟซไม่ได้ ({}) — นี่คืออ่านไม่ได้ ไม่ใช่ว่างเปล่า",

  // ── Clone + bulk ──────────────────────────────────────────────────────────
  'A policy called "{}" already exists — FortiOS will refuse this with error -5.':
    'มี policy ชื่อ "{}" อยู่แล้ว — FortiOS จะปฏิเสธด้วย error -5',
  'The copy carries every field of the original, including the ones no form here shows. It arrives DISABLED, directly below "{}"{} — enable it once you have changed whatever you cloned it to change.':
    'สำเนาจะได้ทุกฟิลด์ของตัวต้นฉบับ รวมถึงฟิลด์ที่ไม่มีฟอร์มไหนในนี้แสดง และจะมาถึงในสถานะ DISABLED วางไว้ใต้ "{}"{} ทันที — เปิดใช้งานเมื่อแก้สิ่งที่ตั้งใจจะแก้เรียบร้อยแล้ว',
  "DELETE {} POLICIES": "ลบ {} POLICY",
  "Select policy {}": "เลือก policy {}",
  "Select every policy in {}": "เลือกทุก policy ใน {}",
  "These rules will be permanently removed{}. They are deleted one at a time, highest id first, and a failure part-way through leaves the rest in place — the result is reported per rule.":
    "กฎเหล่านี้จะถูกลบถาวร{} ระบบลบทีละตัวโดยไล่จาก id มากไปน้อย ถ้าพังกลางทางตัวที่เหลือจะยังอยู่ — และจะรายงานผลเป็นรายกฎ",

  // ── The usage scan ────────────────────────────────────────────────────────
  "Still referenced by {} places": "ยังถูกอ้างถึงอยู่ {} ที่",
  "Could not read {}, so the list above may be incomplete. An empty result from a table that never answered is not evidence that nothing uses this object.":
    "อ่าน{}ไม่ได้ รายการด้านบนจึงอาจไม่ครบ ผลลัพธ์ว่างจากตารางที่ไม่เคยตอบ ไม่ใช่หลักฐานว่าไม่มีอะไรใช้ออบเจ็กต์นี้",
  "The device counts {} references to this object and only {} are listed above — something outside the tables this console reads is using it.":
    "อุปกรณ์นับการอ้างถึงออบเจ็กต์นี้ได้ {} รายการ แต่ด้านบนแสดงได้แค่ {} รายการ — มีบางอย่างนอกตารางที่คอนโซลนี้อ่าน กำลังใช้มันอยู่",
  "The usage check could not run ({}), so this console cannot say what would break. Delete is disabled — retry, or remove the object on the device itself.":
    "ตรวจการใช้งานไม่สำเร็จ ({}) คอนโซลนี้จึงบอกไม่ได้ว่าลบแล้วอะไรจะพัง ปุ่มลบถูกปิดไว้ — ลองใหม่ หรือไปลบที่ตัวอุปกรณ์เอง",
  "Fixed Port Range keeps the source port, so each internal address needs its own external one. There are {} internal and only {} external — the last {} would not be translated at all, and the device will not warn you.":
    "Fixed Port Range คงพอร์ตต้นทางไว้ แต่ละ IP ภายในจึงต้องมี IP ภายนอกของตัวเอง ตอนนี้มีภายใน {} แต่ภายนอกมีแค่ {} — {} ตัวสุดท้ายจะไม่ถูกแปลงเลย และอุปกรณ์จะไม่เตือนอะไร",

  "Zone \"{}\" created on {}": "สร้างโซน \"{}\" บน {} แล้ว",
};
