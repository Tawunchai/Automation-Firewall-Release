/**
 * Thai — the interpolated sentences of the shell.
 *
 * Each `{}` is a value the app drops in at render time, and the translation may put them wherever
 * Thai wants them: `Showing {} users` becomes `แสดงผู้ใช้ {} คน`, with the classifier after the
 * number where Thai puts it, not before it where English does. What a translation may NOT do is
 * change how many holes there are — ../../dictionary.test.ts fails on that, because a dropped hole
 * is a count or a device name silently missing from the screen.
 */
import type { Dict } from "../merge";

export const commonPatterns: Dict = {
  "Showing {} users": "แสดงผู้ใช้ {} คน",
  "Selected {} accounts will be removed. This cannot be undone from here.":
    "บัญชีที่เลือกไว้ {} บัญชีจะถูกลบ และย้อนกลับจากหน้านี้ไม่ได้",
  "Delete {} users?": "ลบผู้ใช้ {} คนหรือไม่?",
  "Delete {} Users": "ลบผู้ใช้ {} คน",
  "Deleted {} users": "ลบผู้ใช้ไปแล้ว {} คน",
  "Changed role to {} for {} users": "เปลี่ยนบทบาทเป็น {} ให้ผู้ใช้ {} คน",
  "Make sure the email {} is not in use before restoring.":
    "ตรวจสอบว่าอีเมล {} ยังไม่ถูกใช้งานก่อนกู้คืน",
  "No {} matches your search": "ไม่มี{}ที่ตรงกับคำค้นของคุณ",
  "This device has no {} yet": "อุปกรณ์นี้ยังไม่มี{}",
  "All {} devices": "อุปกรณ์ทั้งหมด {} เครื่อง",
  "Could not load {} profiles": "โหลดโปรไฟล์{}ไม่สำเร็จ",
  "Could not read the {} list from {}": "อ่านรายการ{}จาก {} ไม่สำเร็จ",
  "At least {} characters": "อย่างน้อย {} ตัวอักษร",
  "Enter all {} digits": "กรอกให้ครบทั้ง {} หลัก",
  "Digit {} of {}": "หลักที่ {} จาก {}",
  "Code expires in {}": "รหัสหมดอายุใน {}",
  "Resend in {}s": "ส่งใหม่ได้ในอีก {} วินาที",
  "Expires every {} days": "หมดอายุทุก {} วัน",
  "Expiring in {} — verify now": "จะหมดอายุใน {} — ยืนยันเดี๋ยวนี้",
  "Users with passwords older than {} days will see a warning to change their password":
    "ผู้ใช้ที่ใช้รหัสผ่านเดิมนานเกิน {} วันจะเห็นคำเตือนให้เปลี่ยนรหัสผ่าน",
  "Purged {} expired backups": "ล้างข้อมูลสำรองที่หมดอายุแล้ว {} รายการ",
  "Purge Expired ({})": "ล้างรายการที่หมดอายุ ({})",
  "Purge in {}d": "จะล้างในอีก {} วัน",
  "Language — {}": "ภาษา — {}",
  "Copyright {} Firewall Automation": "ลิขสิทธิ์ {} Firewall Automation",
  "The AI assistant request failed (HTTP {})": "คำขอไปยังผู้ช่วย AI ล้มเหลว (HTTP {})",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "from {}": "จาก {}",
  "{} percent": "{} เปอร์เซ็นต์",

  // -- The shared list-page footer and search box ----------------------------
  "Search {}…": "ค้นหา{}…",

  "Edit Zone — {}": "แก้ไขโซน — {}",
  "IP pool \"{}\" created on {}": "สร้าง IP pool \"{}\" บน {} แล้ว",
  "IP pool \"{}\" updated on {}": "อัปเดต IP pool \"{}\" บน {} แล้ว",
  "Zone \"{}\" updated on {}": "อัปเดตโซน \"{}\" บน {} แล้ว",
  "\"{}\" is a {} file — only PNG, JPEG, GIF and WebP images can be attached":
    "\"{}\" เป็นไฟล์ {} — แนบได้เฉพาะรูปภาพ PNG, JPEG, GIF และ WebP",
  "\"{}\" is too large (max 4 MB per image)": "\"{}\" ใหญ่เกินไป (สูงสุด 4 MB ต่อรูป)",
  "\"{}\" is too large even after resizing (max 4 MB per image)":
    "\"{}\" ยังใหญ่เกินไปแม้ย่อขนาดแล้ว (สูงสุด 4 MB ต่อรูป)",
  "up · {} ms": "ขึ้น · {} ms",

  "This {} will be permanently removed from {}.": "{} นี้จะถูกลบอย่างถาวรจาก {}",
};
