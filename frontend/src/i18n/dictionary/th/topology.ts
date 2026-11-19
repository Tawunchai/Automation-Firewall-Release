/**
 * Thai — Network ▸ Topology and the Firewall Policy matrix.
 *
 * The level names are the whole point of both screens, so they are translated as SENTENCES about
 * what is true, not as one-word labels: "permitted, nothing inspecting it" has to keep its second
 * half in Thai, because that half is the finding. A grid whose amber cell reads only "อนุญาต"
 * would hide exactly what it was built to show.
 */
import type { Dict } from "../merge";

export const topology: Dict = {
  "Topology": "แผนผังเครือข่าย",
  "topology": "แผนผังเครือข่าย",
  "Matrix": "ตาราง",
  "Paths": "เส้นทาง",
  "Permitted paths": "เส้นทางที่อนุญาต",
  "Source → destination": "ต้นทาง → ปลายทาง",
  "Show all": "แสดงทั้งหมด",
  "IPsec tunnels": "IPsec tunnel",

  // Cell / edge levels — each keeps the clause that makes it a finding.
  "permitted": "อนุญาต",
  "permitted, inspected": "อนุญาต และมีการตรวจ",
  "permitted, not inspected": "อนุญาต แต่ไม่มีอะไรตรวจ",
  "permitted, nothing inspecting it": "อนุญาต แต่ไม่มีอะไรตรวจเลย",
  "deny only": "มีแต่กฎปฏิเสธ",
  "no rule": "ไม่มีกฎ",
  "all inspected": "ตรวจครบทุกเส้นทาง",
  // The legend's own label for the amber path, standing on its own line.
  "nothing inspecting it": "ไม่มีอะไรตรวจ",

  // Suffixes the hover line and the cell description append.
  ", NAT": ", NAT",
  "· no inspection": "· ไม่มีการตรวจ",
  "· intra-zone allowed": "· อนุญาตภายในโซน",
  "· measured": "· มีทราฟฟิกวัดได้",

  "up / total": "ขึ้น / ทั้งหมด",
  "up / configured": "ขึ้น / ที่ตั้งไว้",
  "policies name ports directly": "policy อ้างถึงพอร์ตโดยตรง",

  // Stage KPI captions, and the port states the screen-reader list reads out. Every one of these
  // sits in a tile caption or on a canvas label, so the Thai stays as short as the English.
  "all up": "ขึ้นครบ",
  "no default route": "ไม่มี default route",
  "no tunnels configured": "ยังไม่ได้ตั้ง tunnel",
  "nothing configured": "ยังไม่ได้ตั้งค่า",

  "Hover a cell to read it. Click one to filter the table below to just those rules.":
    "ชี้ที่ช่องเพื่ออ่านความหมาย คลิกเพื่อกรองตารางด้านล่างให้เหลือเฉพาะกฎเหล่านั้น",
  "No enabled rule names an interface pair, so there is nothing to grid.":
    "ไม่มีกฎที่เปิดใช้งานตัวไหนอ้างถึงคู่อินเทอร์เฟซเลย จึงยังไม่มีอะไรให้วางเป็นตาราง",
  "Without them there is nothing to draw — this is 'unreadable', not 'a firewall with no ports'":
    "ถ้าไม่มีอินเทอร์เฟซก็ไม่มีอะไรให้วาด — นี่คือ \"อ่านไม่ได้\" ไม่ใช่ \"firewall ที่ไม่มีพอร์ต\"",
  "moving dots = measured traffic on that path": "จุดที่เคลื่อนที่ = มีทราฟฟิกจริงวัดได้บนเส้นทางนั้น",
  "Link state could not be read from this device — the ports below show how they are CONFIGURED, not whether a cable is in them.":
    "อ่านสถานะลิงก์จากอุปกรณ์นี้ไม่ได้ — พอร์ตด้านล่างบอกว่าถูก \"ตั้งค่า\" ไว้อย่างไร ไม่ได้บอกว่ามีสายเสียบอยู่หรือไม่",
  "This browser can't render the 3D topology": "เบราว์เซอร์นี้แสดงแผนผัง 3 มิติไม่ได้",
  "Try a different browser, or enable hardware acceleration in this one.":
    "ลองใช้เบราว์เซอร์อื่น หรือเปิดการเร่งความเร็วด้วยฮาร์ดแวร์ในเบราว์เซอร์นี้",

  // ── Add Device: the user's own pinned devices the firewall pings ──────────────
  "My devices": "อุปกรณ์ของฉัน",
  "Pinged from this firewall, drawn on the map": "ping จากไฟร์วอลล์นี้ แสดงบนแผนผัง",
  "Confirming live status…": "กำลังยืนยันสถานะล่าสุด…",
  "Add device": "เพิ่มอุปกรณ์",
  "Edit device": "แก้ไขอุปกรณ์",
  "No pinned devices yet": "ยังไม่มีอุปกรณ์ที่ปักหมุดไว้",
  "Add a switch, access point or server by its IP, and the firewall will ping it on the schedule you set — its status then shows on the 3D map.":
    "เพิ่มสวิตช์ แอ็กเซสพอยต์ หรือเซิร์ฟเวอร์ด้วย IP แล้วไฟร์วอลล์จะ ping ตามรอบที่ตั้งไว้ — สถานะจะแสดงบนแผนผัง 3 มิติ",
  "checks paused": "หยุดตรวจชั่วคราว",
  "not checked yet": "ยังไม่ได้ตรวจ",
  "The firewall pings this address to tell whether the device is up.":
    "ไฟร์วอลล์จะ ping ที่อยู่นี้เพื่อบอกว่าอุปกรณ์ออนไลน์อยู่หรือไม่",
  "Check this device on a schedule": "ตรวจอุปกรณ์นี้ตามรอบเวลา",
  "When off, the device still shows on the map but the firewall stops pinging it.":
    "เมื่อปิด อุปกรณ์ยังแสดงบนแผนผังแต่ไฟร์วอลล์จะหยุด ping",
  "This only removes the pin from your map and stops the firewall pinging it. The device itself is not touched.":
    "การลบนี้เอาหมุดออกจากแผนผังและหยุดให้ไฟร์วอลล์ ping เท่านั้น ไม่ได้แตะตัวอุปกรณ์จริง",

  // Form fields and the device-kind labels (the kind picks the 3D glyph).
  "Device type": "ชนิดอุปกรณ์",
  "Ping check": "รอบ ping ตรวจสอบ",
  "Switch": "สวิตช์",
  "Router": "เราเตอร์",
  "Endpoint": "อุปกรณ์ปลายทาง",
  "Access Point": "แอ็กเซสพอยต์",
  "Other": "อื่น ๆ",
  "Core Switch": "คอร์สวิตช์",
  "Optional — where it is, what it does": "ไม่บังคับ — อยู่ที่ไหน ทำหน้าที่อะไร",
  "Every 30 seconds": "ทุก 30 วินาที",
  "Every 2 minutes": "ทุก 2 นาที",
  "Every 10 minutes": "ทุก 10 นาที",
  "Every 30 minutes": "ทุก 30 นาที",

  // Toasts.
  "Give the device a name": "ตั้งชื่อให้อุปกรณ์",
  "Enter a valid IP address": "กรอก IP ให้ถูกต้อง",
  "Device added to the map": "เพิ่มอุปกรณ์ลงแผนผังแล้ว",
  "Device removed": "ลบอุปกรณ์แล้ว",
  "Could not save the device": "บันทึกอุปกรณ์ไม่สำเร็จ",
  "Could not remove the device": "ลบอุปกรณ์ไม่สำเร็จ",
  "Could not reach the firewall to run the check": "ติดต่อไฟร์วอลล์เพื่อตรวจไม่ได้",
};
