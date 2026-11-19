/**
 * Thai — the interpolated sentences of the VPN pages.
 *
 * `Tunnel "{}" updated, but: {}` is the shape that matters most here: the tunnel wrote, something
 * downstream did not, and both halves have to survive translation. The reason in the second hole
 * comes back from the FortiGate untranslated, which is correct — it is the device's own words.
 */
import type { Dict } from "../merge";

export const vpnPatterns: Dict = {
  'Could not load tunnel "{}"': 'โหลดอุโมงค์ "{}" ไม่สำเร็จ',
  'Could not load Hub-and-Spoke tunnel "{}"': 'โหลดอุโมงค์ฮับแอนด์สโป๊ก "{}" ไม่สำเร็จ',
  'Tunnel "{}" updated on {}': 'อัปเดตอุโมงค์ "{}" บน {} แล้ว',
  'Tunnel "{}" deleted': 'ลบอุโมงค์ "{}" แล้ว',
  'Tunnel "{}" deleted, but: {}': 'ลบอุโมงค์ "{}" แล้ว แต่: {}',
  'Tunnel "{}" updated, but: {}': 'อัปเดตอุโมงค์ "{}" แล้ว แต่: {}',
  "Bring {} / {} down?": "สั่งให้ {} / {} หยุดทำงานหรือไม่?",
  "Sent {} to {}": "ส่ง {} ไปยัง {} แล้ว",
  "Enter a valid {} address.": "กรอกแอดเดรส {} ที่ถูกต้อง",

  // Template names, with the remote device type filled in.
  "Dialup - {}": "ไดอัลอัป - {}",
  "Custom - {}": "กำหนดเอง - {}",
  "Remote {}": "ปลายทาง {}",
  "Hub-and-Spoke ({})": "ฮับแอนด์สโป๊ก ({})",
  "Hub-and-Spoke - FortiGate ({})": "ฮับแอนด์สโป๊ก - FortiGate ({})",
  "Hub-and-Spoke VPN ({})": "VPN แบบฮับแอนด์สโป๊ก ({})",
  "Site to Site ({}) — created by the VPN Creation Wizard":
    "ไซต์ต่อไซต์ ({}) — สร้างโดยตัวช่วยสร้าง VPN",
  "Remote Access ({}) — created by the VPN Creation Wizard":
    "การเข้าถึงระยะไกล ({}) — สร้างโดยตัวช่วยสร้าง VPN",
  "Hub-and-Spoke (FortiGate {}) — created by the VPN Creation Wizard":
    "ฮับแอนด์สโป๊ก (FortiGate {}) — สร้างโดยตัวช่วยสร้าง VPN",

  // Summary lines on the review step.
  "Static IP — {}": "IP คงที่ — {}",
  "Dynamic DNS — {}": "ไดนามิก DNS — {}",
  "IP Address — {}": "IP แอดเดรส — {}",
  "Native — {}": "ไคลเอนต์ในตัว — {}",
  "Client-based — {}": "ใช้ไคลเอนต์ — {}",
  "Specify — {}": "ระบุเอง — {}",
  "Enabled — DH {}": "เปิดใช้งาน — DH {}",
  "Share Local — via {}": "แชร์ฝั่งนี้ — ผ่าน {}",
  "Use Remote — local gateway {}": "ใช้ฝั่งปลายทาง — เกตเวย์ต้นทาง {}",
  "Routed via {}{}": "กำหนดเส้นทางผ่าน {}{}",

  "Failed to {} the VPN tunnel": "{}อุโมงค์ VPN ไม่สำเร็จ",
};
