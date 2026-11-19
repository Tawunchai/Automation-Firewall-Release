/**
 * Thai — the Addresses page and the address create/edit form.
 *
 * The country list this page also renders lives in ./countries.ts.
 *
 * The two-letter codes (SUB, RNG, FQ, GE, MC, WC, DY, IF) are the type badges in the address
 * table's narrow first column — they exist because the full type name does not fit, so their Thai
 * has to be short for the same reason. Where two letters cannot carry the meaning in Thai the badge
 * keeps its FortiOS letters; see ../keep.ts.
 */
import type { Dict } from "../merge";

export const addresses: Dict = {
  "New Address": "แอดเดรสใหม่",
  "Edit Address": "แก้ไขแอดเดรส",
  "Address deleted": "ลบแอดเดรสแล้ว",
  "Failed to create address": "สร้างแอดเดรสไม่สำเร็จ",
  "Failed to update address": "อัปเดตแอดเดรสไม่สำเร็จ",
  "Failed to delete address": "ลบแอดเดรสไม่สำเร็จ",
  "Loading address…": "กำลังโหลดแอดเดรส…",
  "Address not found — it may have been deleted.": "ไม่พบแอดเดรส — อาจถูกลบไปแล้ว",
  "Search addresses…": "ค้นหาแอดเดรส…",
  "Delete from device?": "ลบออกจากอุปกรณ์หรือไม่?",
  "Name can't be changed when editing an existing address.":
    "ไม่สามารถเปลี่ยนชื่อได้เมื่อกำลังแก้ไขแอดเดรสที่มีอยู่แล้ว",
  "· firewall address · ESC close": "· firewall address · ESC เพื่อปิด",
  "firewall policy(ies).": "นโยบายไฟร์วอลล์",
  "will be permanently removed from": "จะถูกลบอย่างถาวรจาก",
  "Go back": "ย้อนกลับ",
  Change: "เปลี่ยน",
  "No Color": "ไม่ระบุสี",

  // -- Table columns ---------------------------------------------------------
  NAME: "ชื่อ",
  TYPE: "ชนิด",
  DETAILS: "รายละเอียด",
  INTERFACE: "อินเทอร์เฟซ",
  "REF.": "อ้างอิง",
  "⚠ Used in": "⚠ ถูกใช้ใน",

  // -- Address types ---------------------------------------------------------
  Subnet: "ซับเน็ต",
  "IP Range": "ช่วง IP",
  Geography: "ภูมิศาสตร์",
  "MAC Address": "MAC แอดเดรส",
  "Add MAC Address": "เพิ่ม MAC แอดเดรส",
  "Device (MAC Address)": "อุปกรณ์ (MAC แอดเดรส)",
  "Interface Subnet": "ซับเน็ตของอินเทอร์เฟซ",
  Dynamic: "ไดนามิก",
  "Sub Type": "ชนิดย่อย",
  "SDN Connector": "SDN Connector",
  "Fabric Connector Address": "แอดเดรสจาก Fabric Connector",
  "Static route configuration": "การตั้งค่าเส้นทางแบบสแตติก",

  // -- Field hints -----------------------------------------------------------
  "CIDR (192.168.1.0/24) or mask (192.168.1.0 255.255.255.0)":
    "CIDR (192.168.1.0/24) หรือมาสก์ (192.168.1.0 255.255.255.0)",
  "e.g. example.com or *.example.com (wildcard)":
    "เช่น example.com หรือ *.example.com (ไวลด์การ์ด)",
  "Start and end IP separated by a hyphen": "IP เริ่มต้นและสิ้นสุด คั่นด้วยเครื่องหมายขีด",
  "MAC address or range (e.g. 00:11:22:33:44:55)":
    "MAC แอดเดรสหรือช่วง (เช่น 00:11:22:33:44:55)",
  "Single: 00:11:22:33:44:55 · Range: 00:11:22:33:44:55-00:11:22:33:44:FF":
    "เดี่ยว: 00:11:22:33:44:55 · ช่วง: 00:11:22:33:44:55-00:11:22:33:44:FF",
  "Select country / region…": "เลือกประเทศ / ภูมิภาค…",
  "Search country…": "ค้นหาประเทศ…",
  "No country found": "ไม่พบประเทศ",

  // -- Fabric connector sub-types -------------------------------------------
  "This sub-type is managed by its matching Fabric Connector on the device.":
    "ชนิดย่อยนี้ถูกจัดการโดย Fabric Connector ที่ตรงกันบนอุปกรณ์",
  "Configure a Fabric Connector under Security Fabric → External Connectors first.":
    "ตั้งค่า Fabric Connector ที่ Security Fabric → External Connectors ก่อน",
  "FortiClient EMS Tag": "แท็ก FortiClient EMS",
  "FortiNAC Tag": "แท็ก FortiNAC",
  "FortiPolicy Tag": "แท็ก FortiPolicy",
  "FortiVoice Tag": "แท็ก FortiVoice",
  "Switch Controller NAC Policy Tag": "แท็กนโยบาย NAC ของ Switch Controller",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Configuration": "การตั้งค่า",
  "No SDN connectors configured": "ยังไม่ได้ตั้งค่า SDN Connector",
  "Select SDN connector…": "เลือก SDN Connector…",
  "Wildcard FQDN": "FQDN แบบไวลด์การ์ด",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP Range/Subnet": "ช่วง IP / ซับเน็ต",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP/Netmask": "IP / เน็ตมาสก์",
};
