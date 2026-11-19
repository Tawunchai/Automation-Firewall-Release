/**
 * Thai — the interpolated sentences of Devices and Config Deploy.
 *
 * Several of these carry a job or backup number the operator will quote to someone else. The `#`
 * stays where it is and the digits stay Arabic: a Thai sentence around a reference the device also
 * printed is easier to act on than a fully localised one nobody can match back.
 */
import type { Dict } from "../merge";

export const devicePatterns: Dict = {
  // -- The shared device-scoped form page ------------------------------------
  // {} is the page's noun, passed through untranslated: it is the word the operator also sees in
  // the FortiOS CLI for that object type.
  "Loading the {}…": "กำลังโหลด {}…",
  "No device selected — go back and choose the firewall this {} belongs on.":
    "ยังไม่ได้เลือกอุปกรณ์ — ย้อนกลับไปเลือกไฟร์วอลล์ที่ {} นี้อยู่",

  // -- Backup ----------------------------------------------------------------
  "Backup successful: {}": "สำรองข้อมูลสำเร็จ: {}",
  "Backup failed: {}": "สำรองข้อมูลไม่สำเร็จ: {}",
  "Backup triggered for {} (job #{})": "สั่งสำรองข้อมูลให้ {} แล้ว (งาน #{})",
  "Batch backup queued: {} device(s)": "เข้าคิวสำรองข้อมูลเป็นชุดแล้ว: {} อุปกรณ์",
  "Reset job #{} — triggering a fresh backup…":
    "รีเซ็ตงาน #{} แล้ว — กำลังสั่งสำรองข้อมูลใหม่…",
  "Job #{} is stuck — press Force Retry to reset it and back up again":
    "งาน #{} ค้างอยู่ — กด Force Retry เพื่อรีเซ็ตแล้วสำรองข้อมูลอีกครั้ง",
  "· {} already running": "· {} กำลังทำงานอยู่แล้ว",
  "Rollback queued (deploy #{}) — check Config Deploy page":
    "เข้าคิวย้อนคืนค่าแล้ว (การปรับใช้ #{}) — ดูที่หน้าปรับใช้คอนฟิก",

  // -- Config diff -----------------------------------------------------------
  "+++ Backup #{} ({})": "+++ การสำรองครั้งที่ {} ({})",
  "--- Backup #{} ({})": "--- การสำรองครั้งที่ {} ({})",
  "Backup #{} vs #{}": "การสำรองครั้งที่ {} เทียบกับครั้งที่ {}",
  "Compare #{} vs #{}": "เปรียบเทียบครั้งที่ {} กับครั้งที่ {}",
  "Viewing: {}": "กำลังดู: {}",
  "History: {}": "ประวัติ: {}",
  "Edit: {}": "แก้ไข: {}",
  "Delete {}": "ลบ {}",
  "Downstream of {}": "อยู่ใต้ {}",

  "· {} unreachable": "· เข้าถึงไม่ได้ {} เครื่อง",

  // -- Terminal --------------------------------------------------------------
  "Send {} command(s)": "ส่ง {} คำสั่ง",
  "Send {} command(s) to {} device(s)": "ส่ง {} คำสั่งไปยังอุปกรณ์ {} เครื่อง",
  "Multi Config · {} devices · {}": "คอนฟิกหลายเครื่อง · {} อุปกรณ์ · {}",
  "The device must have {} in the allowaccess list of the interface you connect through":
    "อุปกรณ์ต้องมี {} อยู่ในรายการ allowaccess ของอินเทอร์เฟซที่คุณใช้เชื่อมต่อ",

  // -- Dashboard -------------------------------------------------------------
  "current usage · {} cores": "การใช้งานปัจจุบัน · {} คอร์",
  "Per core ({})": "แยกตามคอร์ ({})",
  "peak {} in this window": "สูงสุด {} ในช่วงเวลานี้",
  "Show {} more entitlements": "แสดงสิทธิ์การใช้งานอีก {} รายการ",

  // -- Report kinds and revert reasons — served by the Go backend, so the extractor never sees them ---
  "{} — Connected": "{} — เชื่อมต่อแล้ว",
  "{} — Not connected": "{} — ไม่ได้เชื่อมต่อ",
  "{} — Disabled (admin down)": "{} — ปิดใช้งาน (admin down)",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----

  // -- Phase 13: the VDOM picker ------------------------------------------------
  "Virtual domain: {}": "โดเมนเสมือน: {}",

  // -- Dashboard Services KPI card -----------------------------------------
  "across {} categories": "ใน {} หมวดหมู่",

  "Backup #{} deleted": "ลบข้อมูลสำรอง #{} แล้ว",
  "Delete backup #{}": "ลบข้อมูลสำรอง #{}",
  "Job #{} is stuck — force retry": "งาน #{} ค้างอยู่ — บังคับลองใหม่",
};
