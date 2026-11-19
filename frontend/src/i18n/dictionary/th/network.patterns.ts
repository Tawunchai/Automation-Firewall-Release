/**
 * Thai — the interpolated sentences of DHCP Servers.
 *
 * Each `{}` is a value the app drops in at render time. A translation may put the holes wherever
 * Thai wants them but may not change how many there are — ../../dictionary.test.ts fails on that,
 * because a dropped hole is an interface name or a threshold silently missing from the screen.
 */
import type { Dict } from "../merge";

export const networkPatterns: Dict = {
  // -- DHCP -----------------------------------------------------------------
  "Could not read DHCP servers from {}": "อ่านเซิร์ฟเวอร์ DHCP จาก {} ไม่ได้",
  "DHCP server on {} {} on {}": "เซิร์ฟเวอร์ DHCP บน {} ถูก{}บน {}",
  "DHCP server on {} deleted from {}": "ลบเซิร์ฟเวอร์ DHCP บน {} ออกจาก {} แล้ว",
  "The server on {} takes its addresses from somewhere this form does not edit ({}) — editing it here would rewrite it into a plain range server. Go back to the list.":
    "เซิร์ฟเวอร์บน {} ดึง IP จากที่ที่ฟอร์มนี้แก้ไม่ได้ ({}) — ถ้าแก้ไขที่นี่จะกลายเป็นเซิร์ฟเวอร์แบบช่วง IP ธรรมดา กลับไปที่รายการแทน",
  "Edit the DHCP server on {}": "แก้ไขเซิร์ฟเวอร์ DHCP บน {}",
  "Delete the DHCP server on {}": "ลบเซิร์ฟเวอร์ DHCP บน {}",
  "· gateway {}": "· เกตเวย์ {}",
  "· domain {}": "· โดเมน {}",
  "· {} MAC reservation{}": "· จองตาม MAC {} รายการ{}",
  "· {} excluded range{}": "· กันไว้ {} ช่วง{}",
  "The range {} – {} ends before it starts.": "ช่วง {} – {} จบก่อนเริ่ม",
  "The excluded range {} – {} ends before it starts.": "ช่วงที่กันไว้ {} – {} จบก่อนเริ่ม",
  "The reservation for {} needs an IPv4 address.": "การจองของ {} ต้องมี IPv4",
  "\"{}\" is not an IPv4 address.": "\"{}\" ไม่ใช่ IPv4",
  "\"{}\" is not a netmask.": "\"{}\" ไม่ใช่ netmask",
  "\"{}\" is not a MAC address — the device wants aa:bb:cc:dd:ee:ff.":
    "\"{}\" ไม่ใช่ MAC address — อุปกรณ์ต้องการรูปแบบ aa:bb:cc:dd:ee:ff",
  "Remove {} {}": "ลบ {} {}",
  "Remove reservation {}": "ลบการจอง {}",
  "Reservation {} MAC address": "MAC address ของการจอง {}",
  "Reservation {} IP address": "IP address ของการจอง {}",
  "Reservation {} action": "การกระทำของการจอง {}",
  "Reservation {} description": "คำอธิบายของการจอง {}",
};
