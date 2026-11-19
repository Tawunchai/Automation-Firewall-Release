/**
 * Thai — the interpolated sentences of the Security Profile forms.
 *
 * The profile name inside each confirmation is the mkey on the device, so it stays verbatim and the
 * Thai is built around it.
 *
 * `Failed to {} …` takes a verb — "create" or "update" — from the call site, which is why the Thai
 * has to be phrased so that a verb can land in the middle of it rather than at the front where Thai
 * would normally want it.
 */
import type { Dict } from "../merge";

export const securityPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'AntiVirus profile "{}" created on {}': 'สร้างโปรไฟล์แอนตี้ไวรัส "{}" บน {} แล้ว',
  'AntiVirus profile "{}" updated on {}': 'อัปเดตโปรไฟล์แอนตี้ไวรัส "{}" บน {} แล้ว',
  'Web Filter profile "{}" created on {}': 'สร้างโปรไฟล์กรองเว็บ "{}" บน {} แล้ว',
  'Web Filter profile "{}" updated on {}': 'อัปเดตโปรไฟล์กรองเว็บ "{}" บน {} แล้ว',
  'DNS Filter profile "{}" created on {}': 'สร้างโปรไฟล์กรอง DNS "{}" บน {} แล้ว',
  'DNS Filter profile "{}" updated on {}': 'อัปเดตโปรไฟล์กรอง DNS "{}" บน {} แล้ว',
  'Application sensor "{}" created on {}': 'สร้างเซนเซอร์แอปพลิเคชัน "{}" บน {} แล้ว',
  'Application sensor "{}" updated on {}': 'อัปเดตเซนเซอร์แอปพลิเคชัน "{}" บน {} แล้ว',
  'File filter profile "{}" created on {}': 'สร้างโปรไฟล์กรองไฟล์ "{}" บน {} แล้ว',
  'File filter profile "{}" updated on {}': 'อัปเดตโปรไฟล์กรองไฟล์ "{}" บน {} แล้ว',
  'Web rating override "{}" created on {}': 'สร้างการแทนที่การจัดเรตเว็บ "{}" บน {} แล้ว',
  'Web rating override "{}" updated on {}': 'อัปเดตการแทนที่การจัดเรตเว็บ "{}" บน {} แล้ว',

  // -- Titles ----------------------------------------------------------------
  "Edit AntiVirus Profile — {}": "แก้ไขโปรไฟล์แอนตี้ไวรัส — {}",
  "Edit Web Filter Profile — {}": "แก้ไขโปรไฟล์กรองเว็บ — {}",
  "Edit DNS Filter Profile — {}": "แก้ไขโปรไฟล์กรอง DNS — {}",
  "Edit Application Sensor — {}": "แก้ไขเซนเซอร์แอปพลิเคชัน — {}",
  "Edit File Filter Profile — {}": "แก้ไขโปรไฟล์กรองไฟล์ — {}",
  "Edit Web Rating Override — {}": "แก้ไขการแทนที่การจัดเรตเว็บ — {}",
  "Create {} — coming soon": "สร้าง{} — เร็ว ๆ นี้",
  "Edit {} — coming soon": "แก้ไข{} — เร็ว ๆ นี้",

  // -- Failures --------------------------------------------------------------
  "Failed to {} application sensor": "{}เซนเซอร์แอปพลิเคชันไม่สำเร็จ",
  "Failed to {} file filter profile": "{}โปรไฟล์กรองไฟล์ไม่สำเร็จ",
  "Failed to {} the web rating override": "{}การแทนที่การจัดเรตเว็บไม่สำเร็จ",
  "Failed to delete {}": "ลบ{}ไม่สำเร็จ",

  // -- Filter chips and pickers ---------------------------------------------
  "Category {}": "หมวดหมู่ {}",
  "Group {}": "กลุ่ม {}",
  "Risk {}": "ความเสี่ยง {}",
  "Pop {}": "ความนิยม {}",
  "Selected {}": "เลือกแล้ว {}",
  "Search {}…": "ค้นหา{}…",

  // -- The security-profile list footer — see the note at its call site ------
  "{} {} profile": "โปรไฟล์{2} {1} รายการ",
  "{} {} profiles": "โปรไฟล์{2} {1} รายการ",
  "{} of {} {} profiles": "โปรไฟล์{3} {1} จาก {2} รายการ",

  // -- IPS sensor and SSL/SSH inspection forms ----------------------------------
  "Edit IPS Sensor — {}": "แก้ไขเซนเซอร์ IPS — {}",
  "Edit SSL/SSH Inspection Profile — {}": "แก้ไขโปรไฟล์ตรวจสอบ SSL/SSH — {}",
  "Failed to {} IPS sensor": "{}เซนเซอร์ IPS ไม่สำเร็จ",
  "Failed to {} SSL/SSH profile": "{}โปรไฟล์ SSL/SSH ไม่สำเร็จ",
  "IPS sensor \"{}\" created on {}": "สร้างเซนเซอร์ IPS \"{}\" บน {} แล้ว",
  "IPS sensor \"{}\" updated on {}": "อัปเดตเซนเซอร์ IPS \"{}\" บน {} แล้ว",
  "SSL/SSH profile \"{}\" created on {}": "สร้างโปรไฟล์ SSL/SSH \"{}\" บน {} แล้ว",
  "SSL/SSH profile \"{}\" updated on {}": "อัปเดตโปรไฟล์ SSL/SSH \"{}\" บน {} แล้ว",
  "showing {} of {} — narrow the search": "แสดง {} จาก {} — ค้นหาให้แคบลง",

  // -- ProfileLoadGuard: a profile that could not be read must not open as blank defaults --
  "Could not read the {}{}{}": "อ่าน {}{}{} ไม่สำเร็จ",
  "It may be unreachable, or the {} may no longer exist on the device.":
    "อาจติดต่อไม่ได้ หรือ {} อาจไม่มีอยู่บนอุปกรณ์แล้ว",
  "Nothing was opened for editing — saving a form built from defaults would have replaced the {} on the firewall.":
    "ยังไม่มีอะไรถูกเปิดขึ้นมาแก้ไข — การบันทึกฟอร์มที่สร้างจากค่าเริ่มต้น จะทับ {} ตัวจริงบนไฟร์วอลล์",
};
