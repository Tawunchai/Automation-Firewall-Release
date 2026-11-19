/**
 * Thai — the interpolated sentences of the System pages.
 *
 * A translation may move the `{}` holes but may not change how many there are: ../../dictionary.test.ts
 * fails on that, because a dropped hole is a device name or a day count missing from the screen.
 */

import type { Dict } from "../merge";

export const systemPatterns: Dict = {
  // System ▸ SNMP.
  "Edit SNMP Community — {}": "แก้ไขชุมชน SNMP — {}",
  "Edit SNMP User — {}": "แก้ไขผู้ใช้ SNMP — {}",
  "Host type for host {}": "ชนิดโฮสต์ของโฮสต์ที่ {}",
  "Remove host {}": "ลบโฮสต์ที่ {}",
  // Users table — the row checkbox's accessible name is "Select <first> <last>".
  "Select {} {}": "เลือก {} {}",
  "Could not read the log settings from {}": "อ่านการตั้งค่าบันทึกจาก {} ไม่ได้",
  "Log settings saved on {}": "บันทึกการตั้งค่าลง {} แล้ว",
  "syslog ({})": "syslog ({})",
  "FortiAnalyzer ({})": "FortiAnalyzer ({})",
  "Disk logging is switched on, but this model reports no log disk ({}). The setting is stored and does nothing.":
    "เปิดบันทึกลงดิสก์ไว้ แต่รุ่นนี้แจ้งว่าไม่มีดิสก์สำหรับบันทึก ({}) · ค่าถูกเก็บไว้เฉย ๆ แต่ไม่มีผลอะไร",
  "The unit reports {}. FortiOS still accepts a disk-logging setting on a unit like this and stores it, so the values below are shown as they are on the device — they are not doing anything.":
    "อุปกรณ์แจ้งว่า {} · FortiOS ยังรับค่าบันทึกลงดิสก์บนเครื่องแบบนี้แล้วเก็บไว้ ค่าด้านล่างจึงแสดงตามที่อยู่บนอุปกรณ์จริง — แต่ไม่ได้ทำงานอะไร",
  "Could not read HA from {}": "อ่านค่า HA จาก {} ไม่ได้",
  "(group \"{}\")": "(กลุ่ม \"{}\")",
  "and heartbeat interfaces {}": "และอินเทอร์เฟซ heartbeat {}",
  "This unit is standalone, but it still holds HA settings {}. They survive being taken out of a cluster and are not doing anything.":
    "เครื่องนี้เป็น standalone แต่ยังเก็บค่า HA ไว้อยู่ {} · ค่าพวกนี้ค้างอยู่หลังถูกถอดออกจากคลัสเตอร์ และไม่ได้ทำงานอะไร",
  "This unit is in {} mode, but the member list could not be read. That is not the same as having no peers — do not read this as a healthy single member.":
    "เครื่องนี้อยู่ในโหมด {} แต่อ่านรายชื่อสมาชิกไม่ได้ · นี่ไม่เหมือนกับ \"ไม่มีสมาชิก\" อย่าตีความว่าเป็นเครื่องเดียวที่สุขภาพดี",
  "This unit is in {} mode and reports no members at all. A cluster that can see nobody is a cluster with a broken heartbeat.":
    "เครื่องนี้อยู่ในโหมด {} และรายงานว่าไม่มีสมาชิกเลย · คลัสเตอร์ที่มองไม่เห็นใครคือคลัสเตอร์ที่ heartbeat พัง",
  "Failover after {} missed": "failover เมื่อขาดไป {} ครั้ง",
  "CPU {}% · RAM {}%": "CPU {}% · แรม {}%",
  "Could not read the administrators from {}": "อ่านรายชื่อผู้ดูแลจาก {} ไม่ได้",
  "These accounts log in to {} itself, over HTTPS or SSH. They are not this console's users — those are under Security ▸ Users and cannot reach the firewall directly.":
    "บัญชีเหล่านี้ล็อกอินเข้า {} โดยตรงผ่าน HTTPS หรือ SSH · ไม่ใช่ผู้ใช้ของคอนโซลนี้ ซึ่งอยู่ที่ Security ▸ Users และเข้าถึง firewall โดยตรงไม่ได้",
  "Only from {}": "เฉพาะจาก {}",
  "Second factor: {}": "ปัจจัยที่สอง: {}",
  "Can change: {}": "แก้ไขได้: {}",
  "\"{}\" is not a subnet. Use 10.0.0.0/24 or 10.0.0.0 255.255.255.0.":
    "\"{}\" ไม่ใช่ซับเน็ต · ใช้ 10.0.0.0/24 หรือ 10.0.0.0 255.255.255.0",
  "This restricts {} to the addresses below. Every other address — including the one you are connected from, unless it is in the list — stops being able to log in as this account.":
    "คำสั่งนี้จำกัดให้ {} เข้าได้เฉพาะที่อยู่ด้านล่าง · ที่อยู่อื่นทั้งหมด รวมถึงที่อยู่ที่คุณต่อมาอยู่ตอนนี้ถ้าไม่อยู่ในรายการ จะล็อกอินด้วยบัญชีนี้ไม่ได้อีก",

  "Edit Administrator — {}": "แก้ไขผู้ดูแลระบบ — {}",
  "failover after {} missed": "สลับการทำงานเมื่อขาดไป {} ครั้ง",

  // Device Identities / host pins
  "Cleared the pinned {} for {}":
    "ล้างการปัก {} ของ {} แล้ว",
  "Forget the {} host key this console pinned for this device.":
    "ลืมโฮสต์คีย์ {} ที่คอนโซลนี้ปักไว้สำหรับอุปกรณ์นี้",
};
