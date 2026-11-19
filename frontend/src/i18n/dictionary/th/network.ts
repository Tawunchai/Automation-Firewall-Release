/**
 * Thai — DHCP Servers.
 *
 * One word is load-bearing and was chosen rather than transliterated:
 *
 *   "Skip policy routing"   ข้าม policy routing — NOT ปฏิเสธ/บล็อก. FortiOS calls this action
 *                           `deny` and it drops nothing at all; it hands the packet back to the
 *                           routing table. ปฏิเสธ would say the opposite of what the rule does.
 */
import type { Dict } from "../merge";

export const network: Dict = {
  // -- DHCP servers ---------------------------------------------------------
  "DHCP Servers": "เซิร์ฟเวอร์ DHCP",
  "DHCP server": "เซิร์ฟเวอร์ DHCP",
  "New DHCP Server": "เซิร์ฟเวอร์ DHCP ใหม่",
  "Edit DHCP Server": "แก้ไขเซิร์ฟเวอร์ DHCP",
  "DHCP Server": "เซิร์ฟเวอร์ DHCP",
  "The DHCP server on": "เซิร์ฟเวอร์ DHCP บน",
  "is not handing out addresses on any interface": "ไม่ได้แจก IP บนอินเทอร์เฟซใดเลย",
  "A DHCP server belongs to one interface, and the addresses it hands out have to sit inside that interface's own subnet — the firewall will accept a range that does not and simply lease nothing.":
    "เซิร์ฟเวอร์ DHCP หนึ่งตัวผูกกับอินเทอร์เฟซเดียว และ IP ที่แจกต้องอยู่ในซับเน็ตของอินเทอร์เฟซนั้น — ถ้าไม่ใช่ firewall จะรับค่าไว้เฉย ๆ แล้วไม่แจกอะไรเลย",
  "Servers may well be configured — this is 'unreadable', not 'none'":
    "อาจมีเซิร์ฟเวอร์ตั้งไว้อยู่จริง — นี่คือ 'อ่านไม่ได้' ไม่ใช่ 'ไม่มี'",
  "Loading DHCP server…": "กำลังโหลดเซิร์ฟเวอร์ DHCP…",
  "DHCP server not found — go back to the list.": "ไม่พบเซิร์ฟเวอร์ DHCP — กลับไปที่รายการ",
  "DHCP server status": "สถานะเซิร์ฟเวอร์ DHCP",

  "Address ranges": "ช่วง IP ที่แจก",
  "What the clients get. Inside the interface's own subnet.":
    "ช่วงที่เครื่องลูกข่ายจะได้รับ ต้องอยู่ในซับเน็ตของอินเทอร์เฟซนั้น",
  "Excluded ranges": "ช่วงที่กันไว้",
  "Carved out of the ranges above — for the addresses given out by hand.":
    "เจาะออกจากช่วงด้านบน — สำหรับ IP ที่กำหนดเองด้วยมือ",
  "Start address": "IP เริ่มต้น",
  "End address": "IP สุดท้าย",
  "Add server": "เพิ่มเซิร์ฟเวอร์",
  "Add reservation": "เพิ่มการจอง",
  "Netmask": "Netmask",
  "A netmask is required.": "ต้องระบุ netmask",
  "Default gateway": "เกตเวย์เริ่มต้น",
  "Leave empty for none": "เว้นว่างถ้าไม่มี",
  "Lease time": "อายุ lease",
  "1 day": "1 วัน",
  "8 hours": "8 ชั่วโมง",
  "One server per interface.": "หนึ่งอินเทอร์เฟซต่อหนึ่งเซิร์ฟเวอร์",
  "The interface a server serves cannot be moved — delete it and make another.":
    "ย้ายอินเทอร์เฟซของเซิร์ฟเวอร์ไม่ได้ — ต้องลบแล้วสร้างใหม่",
  "Choose the interface this server serves.": "เลือกอินเทอร์เฟซที่เซิร์ฟเวอร์นี้ให้บริการ",
  "Add at least one address range — a server with none hands out nothing.":
    "ต้องมีช่วง IP อย่างน้อยหนึ่งช่วง — ถ้าไม่มี เซิร์ฟเวอร์จะไม่แจกอะไรเลย",
  "Every address range needs both a start and an end address.":
    "ทุกช่วง IP ต้องมีทั้ง IP เริ่มต้นและ IP สุดท้าย",
  "Every excluded range needs both a start and an end address.":
    "ทุกช่วงที่กันไว้ต้องมีทั้ง IP เริ่มต้นและ IP สุดท้าย",
  "An excluded range contains something that is not an IPv4 address.":
    "ช่วงที่กันไว้มีค่าที่ไม่ใช่ IPv4",
  "no address range": "ไม่มีช่วง IP",

  "DNS:": "DNS:",
  "DNS servers": "เซิร์ฟเวอร์ DNS",
  "Same as the system DNS": "ใช้ DNS ของระบบ",
  "The FortiGate itself": "ตัว FortiGate เอง",
  "Specify — but no server is set": "เลือก Specify ไว้ แต่ยังไม่ได้ใส่เซิร์ฟเวอร์",
  "DNS mode Specify needs at least one DNS server.":
    "โหมด Specify ต้องมีเซิร์ฟเวอร์ DNS อย่างน้อยหนึ่งตัว",
  "Any addresses below are stored but not used in this mode.":
    "โหมดนี้จะเก็บค่าด้านล่างไว้แต่ไม่ได้ใช้",

  "MAC reservations": "การจอง IP ตาม MAC",
  "Reserve gives that MAC the address every time. Block refuses it a lease at all — so this is also the deny list.":
    "Reserve = ให้ MAC นั้นได้ IP เดิมทุกครั้ง · Block = ไม่ให้ lease เลย ตารางนี้จึงเป็นทั้งรายการจองและรายการปฏิเสธ",
  "Reserve": "จองไว้",
  "From pool": "จาก pool",
  "IP address": "IP address",
  "dial-up VPN": "VPN แบบ dial-up",
  "a dial-up VPN": "VPN แบบ dial-up",
  "addresses from a user group": "แจก IP จากกลุ่มผู้ใช้",
  "a user group": "กลุ่มผู้ใช้",
  "This server takes its addresses from somewhere this form does not edit":
    "เซิร์ฟเวอร์นี้ดึง IP จากที่ที่ฟอร์มนี้แก้ไม่ได้",
  ". Clients on that segment stop getting addresses as their leases expire.":
    " เครื่องในเซกเมนต์นั้นจะไม่ได้ IP อีกเมื่อ lease หมดอายุ",
  "FortiOS cannot clear a DHCP domain over the API — it would keep \"":
    "FortiOS ล้างค่า domain ของ DHCP ผ่าน API ไม่ได้ — มันจะเก็บ \"",
  "\" and report success. Put a domain back, or remove it on the device with":
    "\" ไว้แล้วตอบว่าสำเร็จ · ใส่ domain กลับไป หรือลบบนอุปกรณ์ด้วย",

  // Shared with other lockout-style confirmations (e.g. device-admins) — not specific to this file.
  "This can lock you out": "คำสั่งนี้อาจล็อกคุณออกจากเครื่อง",
  "I understand — write it": "เข้าใจแล้ว — เขียนลงเครื่อง",

  "Delete DHCP server": "ลบ DHCP server",
  "New Administrator": "สร้างผู้ดูแลระบบ",
  "The DHCP server on this interface will be removed from": "DHCP server บนอินเทอร์เฟซนี้จะถูกลบออกจาก",
  "The firewall applies this immediately. If the address you are connected from is not in that list, this account stops working for you the moment it is saved.":
    "ไฟร์วอลล์จะใช้ค่านี้ทันที ถ้าแอดเดรสที่คุณเชื่อมต่อมาไม่อยู่ในรายการนั้น บัญชีนี้จะใช้ไม่ได้สำหรับคุณทันทีที่กดบันทึก",
};
