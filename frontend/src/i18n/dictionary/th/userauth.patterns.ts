/**
 * Thai — the interpolated sentences of User & Authentication.
 *
 * The length-limit family ("must be {} characters or fewer") carries the FortiGate's own field
 * limit, which differs per field and per firmware — so the number comes from the schema rather than
 * being written into the sentence.
 */
import type { Dict } from "../merge";

export const userauthPatterns: Dict = {
  // -- Written to the device -------------------------------------------------
  'User "{}" created on {}': 'สร้างผู้ใช้ "{}" บน {} แล้ว',
  'User "{}" updated on {}': 'อัปเดตผู้ใช้ "{}" บน {} แล้ว',
  'User group "{}" created on {}': 'สร้างกลุ่มผู้ใช้ "{}" บน {} แล้ว',
  'User group "{}" updated on {}': 'อัปเดตกลุ่มผู้ใช้ "{}" บน {} แล้ว',
  'LDAP server "{}" created on {}': 'สร้างเซิร์ฟเวอร์ LDAP "{}" บน {} แล้ว',
  'LDAP server "{}" updated on {}': 'อัปเดตเซิร์ฟเวอร์ LDAP "{}" บน {} แล้ว',
  'RADIUS server "{}" created on {}': 'สร้างเซิร์ฟเวอร์ RADIUS "{}" บน {} แล้ว',
  'RADIUS server "{}" updated on {}': 'อัปเดตเซิร์ฟเวอร์ RADIUS "{}" บน {} แล้ว',
  'Exchange connector "{}" created': 'สร้างตัวเชื่อมต่อ Exchange "{}" แล้ว',

  // -- Titles ----------------------------------------------------------------
  "Edit User{}": "แก้ไขผู้ใช้{}",
  "Edit User Group{}": "แก้ไขกลุ่มผู้ใช้{}",
  "Edit LDAP Server{}": "แก้ไขเซิร์ฟเวอร์ LDAP{}",
  "Edit RADIUS Server{}": "แก้ไขเซิร์ฟเวอร์ RADIUS{}",

  // -- Validation ------------------------------------------------------------
  "Name must be {} characters or fewer": "ชื่อต้องยาวไม่เกิน {} ตัวอักษร",
  "Username must be {} characters or fewer": "ชื่อผู้ใช้ต้องยาวไม่เกิน {} ตัวอักษร",
  "IP/Name must be {} characters or fewer": "IP/ชื่อ ต้องยาวไม่เกิน {} ตัวอักษร",
  "Server IP/Name must be {} characters or fewer":
    "IP/ชื่อเซิร์ฟเวอร์ ต้องยาวไม่เกิน {} ตัวอักษร",
  "Distinguished Name must be {} characters or fewer":
    "Distinguished Name ต้องยาวไม่เกิน {} ตัวอักษร",
  "Common Name Identifier must be {} characters or fewer":
    "Common Name Identifier ต้องยาวไม่เกิน {} ตัวอักษร",
  "Maximum Accounts must be 1-{}": "จำนวนบัญชีสูงสุดต้องอยู่ระหว่าง 1-{}",
  '"{}" is a {} user — this app only edits local users.':
    '"{}" เป็นผู้ใช้ชนิด {} — แอปนี้แก้ไขได้เฉพาะผู้ใช้ในเครื่องเท่านั้น',

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "{}% of total": "{}% ของทั้งหมด",

  "(filtered from {})": "(กรองจาก {})",
};
