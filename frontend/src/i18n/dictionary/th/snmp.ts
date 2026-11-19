/**
 * Thai — System ▸ SNMP.
 *
 * Three groups of string, and only the first is a free translation:
 *
 *   The page's own chrome ("Hosts", "Queries", "Traps", "Security Level") is rendered in Thai.
 *
 *   The 42 SNMP event labels are rendered in Thai too, because they are sentences describing what
 *   the firewall is reporting, not identifiers — an operator ticking "CPU usage too high" is
 *   reading a description, and leaving 42 English sentences in a Thai dialog is exactly the
 *   half-translated screen dictionary.test.ts exists to prevent. The CMDB names behind them
 *   (`cpu-high`, `ha-switch`) never render, so nothing the device understands is translated here.
 *
 *   The protocol tokens do NOT appear in this file at all — "SNMP", "v1", "v2c", "v3", "MD5",
 *   "AES256" and the rest live in keep.ts, because they are the words written on the manager's own
 *   configuration screen and on Fortinet's documentation. Transliterating them would make this
 *   page impossible to match against either.
 *
 * Two renderings carry weight:
 *
 *   "No Authentication" / "No Private"  ไม่ใช้การยืนยันตัวตน / ไม่เข้ารหัส — these are SECURITY
 *                                       LEVELS the operator is choosing, so the Thai says what is
 *                                       switched off, not "ไม่มี" which reads as "none configured".
 *   "unreadable, not off"               อ่านไม่ได้ ไม่ใช่ปิดอยู่ — the whole point of the strict
 *                                       read. Thai must not collapse the two.
 */

import type { Dict } from "../merge";

export const snmp: Dict = {
  // ── Page and sections ──────────────────────────────────────────────────────
  "SNMP Agent": "ตัวแทน SNMP",
  "SNMP agent": "ตัวแทน SNMP",
  "SNMP Events": "เหตุการณ์ SNMP",
  "Community": "ชุมชน (Community)",
  "Community Name": "ชื่อชุมชน",
  "User Name": "ชื่อผู้ใช้",
  "Hosts": "โฮสต์",
  "Queries": "การสอบถาม",
  "Traps": "การแจ้งเตือน (Trap)",
  "Events": "เหตุการณ์",
  "Security Level": "ระดับความปลอดภัย",
  "Privacy": "การเข้ารหัส",
  "Authentication Algorithm": "อัลกอริทึมยืนยันตัวตน",
  "Private Algorithm": "อัลกอริทึมเข้ารหัส",
  "No Authentication": "ไม่ใช้การยืนยันตัวตน",
  "No Private": "ไม่เข้ารหัส",
  "Private": "เข้ารหัส",
  "Authentication Private": "ยืนยันตัวตนและเข้ารหัส",
  "v1 Enabled": "เปิด v1",
  "v2c Enabled": "เปิด v2c",
  "Log space": "พื้นที่บันทึก",

  // ── Dialogs ────────────────────────────────────────────────────────────────
  "New SNMP Community": "เพิ่มชุมชน SNMP",
  "New SNMP User": "เพิ่มผู้ใช้ SNMP",
  "Add host": "เพิ่มโฮสต์",
  "Remove this host": "ลบโฮสต์นี้",
  "Accept queries and send traps": "รับการสอบถามและส่ง trap",
  "Accept queries only": "รับการสอบถามอย่างเดียว",
  "Send traps only": "ส่ง trap อย่างเดียว",
  "Community enabled": "เปิดใช้ชุมชนนี้",
  "User enabled": "เปิดใช้ผู้ใช้นี้",
  "SNMP queries": "การสอบถาม SNMP",
  "SNMP traps": "trap ของ SNMP",
  "SNMP v1 queries": "การสอบถาม SNMP v1",
  "SNMP v2c queries": "การสอบถาม SNMP v2c",
  "SNMP v1 traps": "trap ของ SNMP v1",
  "SNMP v2c traps": "trap ของ SNMP v2c",
  "Leave blank to keep the stored password": "เว้นว่างไว้ถ้าต้องการใช้รหัสผ่านเดิม",
  "No password is stored yet": "ยังไม่มีรหัสผ่านที่เก็บไว้",

  // ── Nouns, for the state blocks ────────────────────────────────────────────
  "SNMP community": "ชุมชน SNMP",
  "SNMP user": "ผู้ใช้ SNMP",
  "Create the first SNMP community": "สร้างชุมชน SNMP แรก",
  "Create the first SNMP user": "สร้างผู้ใช้ SNMP แรก",
  "Edit this community": "แก้ไขชุมชนนี้",
  "Delete this community": "ลบชุมชนนี้",
  "Edit this user": "แก้ไขผู้ใช้นี้",
  "Delete this user": "ลบผู้ใช้นี้",

  // ── Results and prose ──────────────────────────────────────────────────────
  "SNMP agent updated": "อัปเดตตัวแทน SNMP แล้ว",
  "SNMP community created": "สร้างชุมชน SNMP แล้ว",
  "SNMP community updated": "อัปเดตชุมชน SNMP แล้ว",
  "SNMP community deleted": "ลบชุมชน SNMP แล้ว",
  "SNMP user created": "สร้างผู้ใช้ SNMP แล้ว",
  "SNMP user updated": "อัปเดตผู้ใช้ SNMP แล้ว",
  "SNMP user deleted": "ลบผู้ใช้ SNMP แล้ว",
  "Reading the SNMP agent…": "กำลังอ่านตัวแทน SNMP…",
  "Select a device to read its SNMP agent.": "เลือกอุปกรณ์เพื่ออ่านตัวแทน SNMP ของเครื่องนั้น",
  "The agent may well be running — this is \"unreadable\", not \"off\".":
    "ตัวแทนอาจทำงานอยู่จริง — นี่คือ \"อ่านไม่ได้\" ไม่ใช่ \"ปิดอยู่\"",
  "Thresholds the CPU, memory and log-space traps fire at (percent).":
    "ระดับที่ trap ของ CPU หน่วยความจำ และพื้นที่บันทึกจะถูกส่ง (เปอร์เซ็นต์)",
  ". Any manager polling with that community string stops being answered.":
    " ระบบจัดการที่สอบถามด้วยชุมชนนั้นจะไม่ได้รับคำตอบอีกต่อไป",
  ", along with its stored credentials.": " พร้อมกับรหัสผ่านที่เก็บไว้ด้วย",

  // ── Refusals ───────────────────────────────────────────────────────────────
  "A community name is required": "ต้องระบุชื่อชุมชน",
  "A user name is required": "ต้องระบุชื่อผู้ใช้",
  "An authentication password is required at this security level":
    "ระดับความปลอดภัยนี้ต้องมีรหัสผ่านยืนยันตัวตน",
  "A privacy password is required at this security level":
    "ระดับความปลอดภัยนี้ต้องมีรหัสผ่านเข้ารหัส",
  "At least one host is required — a community with no hosts answers any address":
    "ต้องมีโฮสต์อย่างน้อยหนึ่งรายการ — ชุมชนที่ไม่มีโฮสต์จะตอบทุกหมายเลขไอพี",
  "Traps are enabled but no notify host is set — add a host or turn traps off":
    "เปิด trap ไว้แต่ยังไม่ได้ตั้งโฮสต์ปลายทาง — เพิ่มโฮสต์หรือปิด trap",

  // ── The 42 event labels ────────────────────────────────────────────────────
  "CPU usage too high": "การใช้งาน CPU สูงเกินไป",
  "Available memory is low": "หน่วยความจำว่างเหลือน้อย",
  "Available log space is low": "พื้นที่บันทึกว่างเหลือน้อย",
  "Interface IP address changed": "ไอพีของอินเทอร์เฟซเปลี่ยน",
  "VPN tunnel is up": "อุโมงค์ VPN เชื่อมต่อแล้ว",
  "VPN tunnel is down": "อุโมงค์ VPN หลุด",
  "HA cluster status change": "สถานะคลัสเตอร์ HA เปลี่ยน",
  "HA heartbeat interface failure": "อินเทอร์เฟซ heartbeat ของ HA ล้มเหลว",
  "IPS detected an attack": "IPS ตรวจพบการโจมตี",
  "IPS detected an anomaly": "IPS ตรวจพบความผิดปกติ",
  "AV detected virus": "AV ตรวจพบไวรัส",
  "AV detected oversized file": "AV ตรวจพบไฟล์ขนาดเกินกำหนด",
  "AV detected file matching pattern": "AV ตรวจพบไฟล์ที่ตรงกับรูปแบบที่กำหนด",
  "AV detected fragmented file": "AV ตรวจพบไฟล์ที่ถูกแบ่งส่วน",
  "Interface IP change (FM trap)": "ไอพีของอินเทอร์เฟซเปลี่ยน (trap ของ FM)",
  "Configuration change (FM trap)": "การตั้งค่าเปลี่ยน (trap ของ FM)",
  "BGP FSM enters the established state": "BGP FSM เข้าสู่สถานะ established",
  "BGP FSM from a high numbered state to a lower numbered state":
    "BGP FSM ถอยจากสถานะลำดับสูงลงไปสถานะลำดับต่ำกว่า",
  "HA cluster member up": "สมาชิกคลัสเตอร์ HA พร้อมทำงาน",
  "HA cluster member down": "สมาชิกคลัสเตอร์ HA หยุดทำงาน",
  "Entity config change (RFC4133)": "การตั้งค่าของอุปกรณ์เปลี่ยน (RFC4133)",
  "AV system enters conserve mode": "ระบบ AV เข้าสู่โหมดประหยัดหน่วยความจำ",
  "AV bypass happens": "มีการข้ามการตรวจของ AV",
  "AV oversized files passed": "ไฟล์เกินขนาดถูกปล่อยผ่านโดย AV",
  "AV oversized files blocked": "ไฟล์เกินขนาดถูกบล็อกโดย AV",
  "IPS package updated": "อัปเดตชุดข้อมูล IPS แล้ว",
  "IPS network buffer is full": "บัฟเฟอร์เครือข่ายของ IPS เต็ม",
  "Temperature is too high": "อุณหภูมิสูงเกินไป",
  "Voltage is out of range": "แรงดันไฟอยู่นอกช่วงที่กำหนด",
  "Power supply failure": "แหล่งจ่ายไฟล้มเหลว",
  "Disconnected from FortiAnalyzer": "ขาดการเชื่อมต่อกับ FortiAnalyzer",
  "AP is up": "AP พร้อมทำงาน",
  "AP is down": "AP หยุดทำงาน",
  "FortiSwitch controller session is up": "เซสชันตัวควบคุม FortiSwitch เชื่อมต่อแล้ว",
  "FortiSwitch controller session is down": "เซสชันตัวควบคุม FortiSwitch หลุด",
  "Load balance real-server is down": "เซิร์ฟเวอร์จริงในการกระจายโหลดหยุดทำงาน",
  "A new device is found": "พบอุปกรณ์ใหม่",
  "Per CPU usage is high": "การใช้งานรายคอร์ CPU สูง",
  "DHCP addresses at limit": "ที่อยู่ DHCP ใกล้เต็มโควตา",
  "IP pool usage is high": "การใช้งาน IP pool สูง",
  "OSPF neighbour state change": "สถานะเพื่อนบ้าน OSPF เปลี่ยน",
  "OSPF virtual neighbour state change": "สถานะเพื่อนบ้านเสมือนของ OSPF เปลี่ยน",

  // SNMP agent page. SNMP, v1/v2c and v3 are version tokens the device and every NMS print,
  // so they stay as they are inside a Thai sentence.
  "Access": "สิทธิ์การเข้าถึง",
  "Delete SNMP community": "ลบ SNMP community",
  "Delete SNMP user": "ลบผู้ใช้ SNMP",
  "Edit SNMP community": "แก้ไข SNMP community",
  "Edit SNMP user": "แก้ไขผู้ใช้ SNMP",
  "New SNMP community": "สร้าง SNMP community",
  "New SNMP user": "สร้างผู้ใช้ SNMP",
  "SNMP v3 User": "ผู้ใช้ SNMP v3",
  "This SNMP community will be permanently removed from": "SNMP community นี้จะถูกลบอย่างถาวรจาก",
  "This SNMP user will be permanently removed from": "ผู้ใช้ SNMP รายนี้จะถูกลบอย่างถาวรจาก",
};
