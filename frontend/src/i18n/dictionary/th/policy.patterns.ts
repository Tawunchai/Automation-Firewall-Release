/**
 * Thai — the interpolated sentences of Policy & Objects.
 *
 * Most of these are the confirmations that follow a write to the firewall, and each carries the
 * object's own name plus the device it landed on. Both stay verbatim inside the Thai sentence: the
 * name is what the operator will look for in `show firewall policy`, and translating around it
 * rather than through it is what keeps the two matchable.
 */
import type { Dict } from "../merge";

export const policyPatterns: Dict = {
  "⚠ Referenced by {} policy(ies) — the device will refuse to delete it until those are removed.":
    "⚠ มี policy อ้างถึงอยู่ {} รายการ — อุปกรณ์จะปฏิเสธการลบจนกว่าจะนำ policy เหล่านั้นออกก่อน",
  'Policy "{}" created on {}': 'สร้างนโยบาย "{}" บน {} แล้ว',
  'Policy "{}" updated on {}': 'อัปเดตนโยบาย "{}" บน {} แล้ว',
  'Service "{}" created on {}': 'สร้างเซอร์วิส "{}" บน {} แล้ว',
  'Service "{}" updated on {}': 'อัปเดตเซอร์วิส "{}" บน {} แล้ว',
  'Virtual IP "{}" created on {}': 'สร้างเวอร์ชวล IP "{}" บน {} แล้ว',
  'Virtual IP "{}" updated on {}': 'อัปเดตเวอร์ชวล IP "{}" บน {} แล้ว',
  'Virtual IP "{}" deleted': 'ลบเวอร์ชวล IP "{}" แล้ว',
  "Static route created on {}": "สร้างเส้นทางสแตติกบน {} แล้ว",
  "Static route #{} updated on {}": "อัปเดตเส้นทางสแตติก #{} บน {} แล้ว",
  "Edit Static Route #{}": "แก้ไขเส้นทางสแตติก #{}",
  "Edit Virtual IP — {}": "แก้ไขเวอร์ชวล IP — {}",
  "Could not read the policies from {}": "อ่านรายการนโยบายจาก {} ไม่สำเร็จ",
  "· {} existing (max {})": "· มีอยู่แล้ว {} (สูงสุด {})",
  "Command parse error before '{}'": "คำสั่งผิดรูปแบบก่อนถึง '{}'",
  "Hostname: {}": "ชื่อโฮสต์: {}",
  "System time: {}": "เวลาระบบ: {}",

  // The interface-bound address trap: FortiGate rejects the whole policy, not just the address,
  // so the message has to name all three things involved before it can be acted on.
  '"{}" is bound to interface "{}" and can\'t be used on "{}". Pick an address on {} (or one with no interface), or change the interface.':
    'แอดเดรส "{}" ผูกอยู่กับอินเทอร์เฟซ "{}" จึงใช้กับ "{}" ไม่ได้ ให้เลือกแอดเดรสที่อยู่บน {} (หรือแอดเดรสที่ไม่ผูกอินเทอร์เฟซ) หรือเปลี่ยนอินเทอร์เฟซ',
};
