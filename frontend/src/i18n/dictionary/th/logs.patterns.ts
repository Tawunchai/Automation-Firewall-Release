/**
 * Thai — the interpolated sentences of Log & Report ▸ Local Traffic.
 *
 * `Recording: {}` takes a comma-joined list of which halves of local logging are switched on
 * ("accepted inbound, denied unicast"), so the Thai has to introduce a list rather than a single
 * noun — กำลังบันทึก: reads correctly with one item or four.
 */
import type { Dict } from "../merge";

export const logsPatterns: Dict = {
  "Could not read the Local Traffic log from {}": "อ่านบันทึก Local Traffic จาก {} ไม่สำเร็จ",
  "Nothing in the last {} matched. Try a wider time period.":
    "ไม่มีรายการใดใน {} ที่ผ่านมาตรงกับคำค้น ลองขยายช่วงเวลาดู",
  "Recording: {}": "กำลังบันทึก: {}",
  // The tail of "…holds no local traffic for the last 24 hours." — a fragment because the
  // sentence around it is assembled from parts the page decides on at render time.
  "for the last {}": "ใน {} ที่ผ่านมา",

  // -- Traffic log: stories, tiles, pivots -------------------------------------
  "Action {}": "Action {}",
  "All fields ({})": "ฟิลด์ทั้งหมด ({})",
  "Connections to the unit itself on a management port were stopped, {} of them from {}. Refused is the right outcome if these are not your addresses; if they are yours, the local-in policy or the interface's allowaccess is what is turning them away.": "การเชื่อมต่อมาที่ตัวเครื่องผ่านพอร์ตจัดการถูกหยุด {} รายการมาจาก {} การปฏิเสธถือว่าถูกต้องถ้าไม่ใช่แอดเดรสของคุณ ถ้าเป็นของคุณ สิ่งที่ปฏิเสธคือ local-in policy หรือ allowaccess ของอินเทอร์เฟซ",
  "Could not read the {} log from {}": "อ่านล็อก {} จาก {} ไม่สำเร็จ",
  "Could not tell from this log: {}": "ล็อกนี้บอกไม่ได้ว่า: {}",
  "Everything below is computed from the {} entries read from {}.": "ทุกอย่างด้านล่างคำนวณจาก {} รายการที่อ่านจาก {}",
  "Everything below is computed from the newest {} entries read from {} — the device holds more than one read returns.": "ทุกอย่างด้านล่างคำนวณจาก {} รายการล่าสุดที่อ่านจาก {} — อุปกรณ์เก็บไว้มากกว่าที่อ่านได้ในครั้งเดียว",
  "From {}": "จาก {}",
  "from the {} entries read": "จาก {} รายการที่อ่าน",
  "It sent {} and received {}.": "ส่ง {} และรับ {}",
  "It sent {} and received {} over {} s.": "ส่ง {} และรับ {} ในเวลา {} วินาที",
  "No entry here is “{}”.": "ไม่มีรายการที่เป็น “{}”",
  "Policy {}": "นโยบาย {}",
  "Policy {} handled it.": "นโยบาย {} เป็นผู้จัดการ",
  "Policy {} handled it — that policy has since been deleted or renumbered.": "นโยบาย {} เป็นผู้จัดการ — นโยบายนั้นถูกลบหรือเปลี่ยนหมายเลขไปแล้ว",
  "Policy {} matched when these were written and cannot be found now — deleted or renumbered since. That is the usual answer to “it worked yesterday”.": "นโยบาย {} ตรงกันตอนที่รายการเหล่านี้ถูกบันทึก แต่ตอนนี้หาไม่พบแล้ว — ถูกลบหรือเปลี่ยนหมายเลข นี่มักเป็นคำตอบของ “เมื่อวานยังใช้ได้”",
  "Port {}": "พอร์ต {}",
  "Read {} entries. The checks above are computed and link to their rows; this does not.": "อ่าน {} รายการ การตรวจด้านบนคำนวณได้และลิงก์ไปยังรายการ ส่วนนี้ไม่มี",
  "Search: {}": "ค้นหา: {}",
  "sent {} · received {}": "ส่ง {} · รับ {}",
  "Show the {} entries": "แสดง {} รายการ",
  "The FortiGate itself connected to {} using {}.": "FortiGate เชื่อมต่อไปยัง {} เองโดยใช้ {}",
  "The FortiGate itself connected to {} using {}, leaving through {}.": "FortiGate เชื่อมต่อไปยัง {} เองโดยใช้ {} ออกทาง {}",
  "The FortiGate opened them and the other side closed them, {} of those to {}. That is the remote service refusing, not the firewall blocking: a rule change here would not alter it. Worth checking the licence or subscription behind that service, and whether the unit can resolve and reach it.": "FortiGate เปิดการเชื่อมต่อแล้วอีกฝั่งเป็นผู้ปิด {} รายการในนั้นไปยัง {} นี่คือบริการปลายทางปฏิเสธ ไม่ใช่ไฟร์วอลล์บล็อก การแก้นโยบายที่นี่ไม่ช่วยอะไร ควรตรวจไลเซนส์หรือ subscription ของบริการนั้น และดูว่าเครื่อง resolve และเข้าถึงได้หรือไม่",
  "The FortiGate talked to itself using {} (loopback).": "FortiGate สื่อสารกับตัวเองโดยใช้ {} (loopback)",
  "The rule that matched permits this traffic ({}) — a Web Filter, Application Control or AntiVirus sensor on it made the decision. Editing the rule will change nothing; the profile attached to it is what to look at.": "นโยบายที่ตรงกันอนุญาตทราฟฟิกนี้ ({}) — Web Filter, Application Control หรือ AntiVirus บนนโยบายนั้นเป็นตัวตัดสิน การแก้นโยบายจะไม่เปลี่ยนอะไร ให้ดูที่ profile ที่ผูกอยู่แทน",
  "They fell through to the implicit deny at the bottom of the table, which means no policy permits them. {} came from {}. If this traffic is supposed to work, the fix is a rule, not a change to an existing one.": "ทราฟฟิกเหล่านี้ตกไปถึง implicit deny ท้ายตาราง แปลว่าไม่มีนโยบายใดอนุญาต {} รายการมาจาก {} ถ้าทราฟฟิกนี้ควรใช้งานได้ วิธีแก้คือสร้างนโยบายใหม่ ไม่ใช่แก้นโยบายที่มีอยู่",
  "To {}": "ไปยัง {}",
  "{} started by the FortiGate · {} from other devices": "{} เริ่มโดย FortiGate · {} มาจากอุปกรณ์อื่น",
  "{} allowed · {} reset or timed out · {} blocked": "อนุญาต {} · รีเซ็ตหรือหมดเวลา {} · บล็อก {}",
  "{} by the policy's own action, {} by a security profile": "{} จาก action ของนโยบายเอง, {} จาก security profile",
  "1 time · {}": "1 ครั้ง · {}",
  "{} times · {}": "{} ครั้ง · {}",
  "{} connected to {} using {}, arriving on {} and leaving through {}.": "{} เชื่อมต่อไปยัง {} โดยใช้ {} เข้ามาทาง {} และออกทาง {}",
  "{} connected to the FortiGate itself using {}, arriving on {}.": "{} เชื่อมต่อมาที่ตัว FortiGate โดยใช้ {} เข้ามาทาง {}",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Show {} as a chart or a table": "แสดง {} เป็นกราฟหรือตาราง",
};
