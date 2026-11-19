/**
 * Thai — the bare words the app renders on their own.
 *
 * These are not page copy. They are single nouns and states that arrive between two tags, most of
 * them from the two idioms this codebase counts things with:
 *
 *     {routes.length} route{routes.length !== 1 ? "s" : ""}      // 22 places
 *     <DeviceStates noun="static route" … />                     // 15 places
 *
 * Both hand React a lone word, and both are how a device list says what it is listing — so a word
 * missing from here is an English noun stranded in the middle of a Thai sentence. They live in
 * their own file because they belong to no one page: `route` is the Static Routes footer, the SD-WAN
 * rule summary and the AI impact analysis, and one translation has to serve all three.
 *
 * Singular and plural are both listed where the app renders both. Thai does not inflect for number,
 * so the two map to the same word — the plural "s" that would otherwise trail it is dropped by
 * ../../jsx-runtime.ts, not here.
 */
import type { Dict } from "../merge";

export const words: Dict = {
  // -- What a device page lists (StateBlock's `noun`) ------------------------
  "static route": "เส้นทางสแตติก",
  "address object": "แอดเดรสอ็อบเจกต์",
  "service object": "เซอร์วิสอ็อบเจกต์",
  "LDAP server": "เซิร์ฟเวอร์ LDAP",
  "RADIUS server": "เซิร์ฟเวอร์ RADIUS",
  "SD-WAN zone": "โซน SD-WAN",
  "SD-WAN rule": "กฎ SD-WAN",
  "Web Rating Override": "การแทนที่การจัดเรตเว็บ",
  "network status": "สถานะเครือข่าย",
  "the session table read": "การอ่านตารางเซสชัน",

  // -- Counted nouns ---------------------------------------------------------
  route: "เส้นทาง",
  policy: "นโยบาย",
  policies: "นโยบาย",
  rule: "กฎ",
  address: "แอดเดรส",
  addresses: "แอดเดรส",
  service: "เซอร์วิส",
  profile: "โปรไฟล์",
  interface: "อินเทอร์เฟซ",
  tunnel: "อุโมงค์",
  member: "สมาชิก",
  members: "สมาชิก",
  zones: "โซน",
  group: "กลุ่ม",
  user: "ผู้ใช้",
  devices: "อุปกรณ์",
  port: "พอร์ต",
  session: "เซสชัน",
  sessions: "เซสชัน",
  event: "เหตุการณ์",
  alert: "การแจ้งเตือน",
  check: "การตรวจสอบ",
  result: "ผลลัพธ์",
  table: "ตาราง",
  gap: "ช่องว่าง",
  observation: "ข้อสังเกต",
  frameworks: "กรอบมาตรฐาน",
  mapping: "การแมป",
  selector: "ตัวเลือก",
  threshold: "เกณฑ์",
  traffic: "ทราฟฟิก",
  firewall: "ไฟร์วอลล์",
  hits: "ครั้งที่ตรงกัน",
  hops: "hop",
  lines: "บรรทัด",
  cores: "คอร์",
  days: "วัน",
  total: "รวม",
  all: "ทั้งหมด",
  one: "หนึ่ง",
  other: "อื่น ๆ",
  any: "ใดก็ได้",
  local: "ภายในเครื่อง",
  ms: "มิลลิวินาที",

  // -- States ----------------------------------------------------------------
  active: "ใช้งานอยู่",
  inactive: "ไม่ได้ใช้งาน",
  available: "พร้อมใช้งาน",
  configured: "ตั้งค่าแล้ว",
  disabled: "ปิดใช้งาน",
  locked: "ล็อกอยู่",
  standby: "สำรอง",
  up: "ทำงาน",
  down: "ไม่ทำงาน",
  on: "เปิด",
  off: "ปิด",
  unknown: "ไม่ทราบ",
  orphaned: "ไม่มีเจ้าของ",
  accepted: "ยอมรับแล้ว",
  evidenced: "มีหลักฐานรองรับ",
  scanned: "สแกนแล้ว",
  expires: "หมดอายุ",
  maintenance: "การบำรุงรักษา",
  initial: "ครั้งแรก",
  timing: "จังหวะเวลา",
  dialup: "ไดอัลอัป",
  "auto-discovery": "การค้นหาอัตโนมัติ",
  "built-in": "มีมาให้ในตัว",

  // -- Verbs the console reports in the past or the imperative ---------------
  create: "สร้าง",
  replace: "แทนที่",
  overwrite: "เขียนทับ",
  skip: "ข้าม",
  toggle: "สลับ",
  reconnect: "เชื่อมต่อใหม่",
  added: "เพิ่มแล้ว",
  removed: "ลบแล้ว",
  selected: "เลือกแล้ว",
  sent: "ส่งแล้ว",
  fail: "ล้มเหลว",

  // -- Nouns assembled at runtime — see the note at the top of this file -----
  "antivirus": "แอนตี้ไวรัส",
  "web filter": "ตัวกรองเว็บ",
  "dns filter": "ตัวกรอง DNS",
  "application control": "การควบคุมแอปพลิเคชัน",
  "file filter": "ตัวกรองไฟล์",
  "ssl/ssh inspection": "การตรวจสอบ SSL/SSH",
  "schedule": "ตารางเวลา",
  "schedules": "ตารางเวลา",
  "virtual IP": "เวอร์ชวล IP",
  "user group": "กลุ่มผู้ใช้",
  "local user": "ผู้ใช้ในเครื่อง",
  "firewall policy": "นโยบายไฟร์วอลล์",
  "IPsec tunnel": "อุโมงค์ IPsec",
  "interfaces": "อินเทอร์เฟซ",
  "tunnels": "อุโมงค์",
  "zone": "โซน",
};
