/**
 * Thai — Firewall Policy, Services, Schedules, Virtual IPs, Static Routes and Interfaces.
 *
 * This is the part of the console that sits closest to the CLI, and the vocabulary follows the
 * FortiOS one deliberately: ปลายทาง for destination, ต้นทาง for source, อินเทอร์เฟซขาออก for
 * outgoing interface. Table headers are shouted in the English (DESTINATION, HIT COUNT) and stay
 * short in Thai for the same reason — they sit in a fixed-width column.
 *
 * The short column codes AV / IPS / APP / WEB / FILE / SSL are the security-profile columns of the
 * policy table. They are FortiOS abbreviations and stay as they are; see ../keep.ts.
 */
import type { Dict } from "../merge";

export const policy: Dict = {
  // -- Policy list -----------------------------------------------------------
  "New Policy": "นโยบายใหม่",
  "Edit policy": "แก้ไขนโยบาย",
  "Edit Policy": "แก้ไขนโยบาย",
  "Delete policy": "ลบนโยบาย",
  "Delete Policy?": "ลบนโยบายหรือไม่?",
  "Policy deleted": "ลบนโยบายแล้ว",
  "Create the first policy": "สร้างนโยบายแรก",
  "This device has no firewall policy yet": "อุปกรณ์นี้ยังไม่มีนโยบายไฟร์วอลล์",
  "Policy not found on this device": "ไม่พบนโยบายบนอุปกรณ์นี้",
  "Failed to create policy": "สร้างนโยบายไม่สำเร็จ",
  "Failed to update policy": "อัปเดตนโยบายไม่สำเร็จ",
  "Failed to delete policy": "ลบนโยบายไม่สำเร็จ",
  "Failed to move policy": "ย้ายนโยบายไม่สำเร็จ",
  "Failed to toggle policy": "สลับสถานะนโยบายไม่สำเร็จ",
  "Enable this policy": "เปิดใช้นโยบายนี้",
  "✓ ACCEPT": "✓ อนุญาต",
  "⊘ DENY": "⊘ ปฏิเสธ",
  Accept: "อนุญาต",
  Deny: "ปฏิเสธ",
  Policies: "นโยบาย",
  "Order matters — top to bottom, the first rule that matches wins":
    "ลำดับมีผล — ไล่จากบนลงล่าง กฎแรกที่ตรงเป็นผู้ชนะ",
  DESTINATION: "ปลายทาง",
  "GATEWAY IP": "IP เกตเวย์",
  "Gateway IP": "IP เกตเวย์",
  "Where this firewall sends traffic it has no connected route for.":
    "ปลายทางที่ไฟร์วอลล์นี้ส่งทราฟฟิกไป เมื่อไม่มีเส้นทางที่ต่ออยู่ตรง ๆ",
  "HIT COUNT": "จำนวนครั้งที่ตรงกัน",
  COMMENTS: "หมายเหตุ",
  PROTOCOL: "โปรโตคอล",
  PROT: "โปรโต",
  MEMBERS: "สมาชิก",
  ADDRESS: "แอดเดรส",
  "ADDRESS GROUP": "กลุ่มแอดเดรส",
  "SERVICE GROUP": "กลุ่มเซอร์วิส",
  CATEGORY: "หมวดหมู่",
  Ref: "อ้างอิง",
  Log: "บันทึก",
  "Log Allowed Traffic": "บันทึกทราฟฟิกที่อนุญาต",
  "Log violation traffic": "บันทึกทราฟฟิกที่ละเมิด",
  "Security Events": "เหตุการณ์ด้านความปลอดภัย",
  "All Sessions": "ทุกเซสชัน",
  "At position": "ที่ตำแหน่ง",
  "Index (order)": "ลำดับ (การเรียง)",
  "1 = top": "1 = บนสุด",
  "Drag to reorder within this interface pair":
    "ลากเพื่อจัดลำดับใหม่ภายในคู่อินเทอร์เฟซนี้",
  "Rules match top-to-bottom (first match wins). Bottom is FortiGate's default for a new policy.":
    "กฎถูกจับคู่จากบนลงล่าง (กฎแรกที่ตรงเป็นผู้ชนะ) ตำแหน่งล่างสุดคือค่าเริ่มต้นของ FortiGate สำหรับนโยบายใหม่",
  "Reordering applies to new policies. Use the Firewall Policy page to drag an existing policy to a new position.":
    "การจัดลำดับนี้ใช้กับนโยบายใหม่เท่านั้น หากต้องการย้ายนโยบายที่มีอยู่แล้ว ให้ลากที่หน้านโยบายไฟร์วอลล์",
  "A security profile is enabled — SSL Inspection must be at least certificate-inspection.":
    "มีการเปิดใช้โปรไฟล์ความปลอดภัย — การตรวจสอบ SSL ต้องเป็นอย่างน้อยระดับ certificate-inspection",
  "Traffic matching this policy will be decrypted for inspection":
    "ทราฟฟิกที่ตรงกับนโยบายนี้จะถูกถอดรหัสเพื่อตรวจสอบ",
  "SSL Inspection": "การตรวจสอบ SSL",
  "Decrypted Traffic Mirror": "การมิเรอร์ทราฟฟิกที่ถอดรหัสแล้ว",
  "Protocol options": "ตัวเลือกโปรโตคอล",
  "Source address": "แอดเดรสต้นทาง",
  "Source IP / range / subnet": "IP / ช่วง / ซับเน็ต ต้นทาง",
  "Source Port": "พอร์ตต้นทาง",
  "Specify Source Ports": "ระบุพอร์ตต้นทาง",
  "Manage source port": "จัดการพอร์ตต้นทาง",
  "Preserve Source Port": "คงพอร์ตต้นทางไว้",
  "Fixed Port": "พอร์ตคงที่",
  "Outgoing Interface": "อินเทอร์เฟซขาออก",
  "Use Outgoing Interface Address": "ใช้แอดเดรสของอินเทอร์เฟซขาออก",
  "Use Dynamic IP Pool": "ใช้ IP Pool แบบไดนามิก",
  "IP pool configuration": "การตั้งค่า IP Pool",
  "Select IP pool…": "เลือก IP Pool…",
  "Optional Filters": "ตัวกรองเพิ่มเติม (ไม่บังคับ)",
  "Advanced Options": "ตัวเลือกขั้นสูง",
  "Additional Information": "ข้อมูลเพิ่มเติม",
  "Edit in CLI": "แก้ไขใน CLI",

  // -- Services --------------------------------------------------------------
  "New Service": "เซอร์วิสใหม่",
  "Create Service": "สร้างเซอร์วิส",
  "Edit Service": "แก้ไขเซอร์วิส",
  "Service deleted": "ลบเซอร์วิสแล้ว",
  "Failed to create service": "สร้างเซอร์วิสไม่สำเร็จ",
  "Failed to update service": "อัปเดตเซอร์วิสไม่สำเร็จ",
  "Failed to delete service": "ลบเซอร์วิสไม่สำเร็จ",
  "Loading service…": "กำลังโหลดเซอร์วิส…",
  "Service not found — it may have been deleted.": "ไม่พบเซอร์วิส — อาจถูกลบไปแล้ว",
  "No service found": "ไม่พบเซอร์วิส",
  "No more services": "ไม่มีเซอร์วิสเพิ่มเติม",
  "Select services": "เลือกเซอร์วิส",
  "Search services…": "ค้นหาเซอร์วิส…",
  "Protocol Type": "ชนิดโปรโตคอล",
  "Protocol Number": "หมายเลขโปรโตคอล",
  "ICMP Type": "ชนิด ICMP",
  "ICMP Code": "รหัส ICMP",
  "Name can't be changed when editing an existing service.":
    "ไม่สามารถเปลี่ยนชื่อได้เมื่อกำลังแก้ไขเซอร์วิสที่มีอยู่แล้ว",
  "Type can't be changed after creation": "ไม่สามารถเปลี่ยนชนิดได้หลังจากสร้างแล้ว",
  "e.g. CUSTOM-HTTP": "เช่น CUSTOM-HTTP",
  "e.g. 50=ESP, 51=AH, 89=OSPF": "เช่น 50=ESP, 51=AH, 89=OSPF",
  "e.g. 80 (single) · 8080-8090 (range) · multiple rows for multiple ports":
    "เช่น 80 (พอร์ตเดียว) · 8080-8090 (ช่วง) · เพิ่มหลายแถวสำหรับหลายพอร์ต",
  "1 to 65535": "1 ถึง 65535",
  "(-1 = any)": "(-1 = ค่าใดก็ได้)",

  // -- Virtual IPs -----------------------------------------------------------
  "Create the first Virtual IP": "สร้างเวอร์ชวล IP แรก",
  "Loading virtual IP…": "กำลังโหลดเวอร์ชวล IP…",
  "Failed to delete virtual IP": "ลบเวอร์ชวล IP ไม่สำเร็จ",
  "VIP type": "ชนิดของ VIP",
  "External IP address/range": "IP/ช่วง IP ภายนอก",
  "External FQDN address": "แอดเดรส FQDN ภายนอก",
  "External service port": "พอร์ตเซอร์วิสภายนอก",
  "Port Forwarding": "การส่งต่อพอร์ต",
  "Port Mapping Type": "ชนิดการแมปพอร์ต",
  "Mapped address": "แอดเดรสปลายทางที่แมป",
  "MAPPED FROM": "แมปจาก",
  "MAPPED TO": "แมปไปยัง",
  "Mapped From": "แมปจาก",
  "Mapped To": "แมปไปยัง",
  "Destination NAT: an address on the firewall that stands in for a server behind it.":
    "Destination NAT: แอดเดรสบนไฟร์วอลล์ที่ยืนแทนเซิร์ฟเวอร์ซึ่งอยู่ด้านหลัง",
  "Map to": "แมปไปยัง",
  "Map to IPv4 port": "แมปไปยังพอร์ต IPv4",
  "Select an FQDN address…": "เลือกแอดเดรส FQDN…",
  "e.g. Web_Server_VIP": "เช่น Web_Server_VIP",

  // -- Static routes ---------------------------------------------------------
  "New Static Route": "เส้นทางสแตติกใหม่",
  "Static Routing": "การกำหนดเส้นทางแบบสแตติก",
  "Static route deleted": "ลบเส้นทางสแตติกแล้ว",
  "Failed to create route": "สร้างเส้นทางไม่สำเร็จ",
  "Failed to update route": "อัปเดตเส้นทางไม่สำเร็จ",
  "Failed to delete route": "ลบเส้นทางไม่สำเร็จ",
  "Loading route…": "กำลังโหลดเส้นทาง…",
  "Route not found — go back to the list.": "ไม่พบเส้นทาง — กลับไปที่รายการ",
  "Route to": "เส้นทางไปยัง",
  "Gateway Address": "แอดเดรสเกตเวย์",
  "Administrative Distance": "ระยะทางเชิงบริหาร",
  "Search routes…": "ค้นหาเส้นทาง…",
  "Starting IPv4 address": "แอดเดรส IPv4 เริ่มต้น",
  "IPv4 address/range": "IP/ช่วง IPv4",
  "Internet Service (": "อินเทอร์เน็ตเซอร์วิส (",
  "Select Internet Service…": "เลือกอินเทอร์เน็ตเซอร์วิส…",
  "Search internet service…": "ค้นหาอินเทอร์เน็ตเซอร์วิส…",
  "CIDR (10.0.0.0/24) or IP/mask (10.0.0.0/255.255.255.0)":
    "CIDR (10.0.0.0/24) หรือ IP/มาสก์ (10.0.0.0/255.255.255.0)",

  // -- Schedules -------------------------------------------------------------
  "Schedule created": "สร้างตารางเวลาแล้ว",
  "Schedule updated": "อัปเดตตารางเวลาแล้ว",
  "Schedule deleted": "ลบตารางเวลาแล้ว",
  "Failed to load schedule": "โหลดตารางเวลาไม่สำเร็จ",
  "Failed to save schedule": "บันทึกตารางเวลาไม่สำเร็จ",
  "Failed to delete schedule": "ลบตารางเวลาไม่สำเร็จ",
  "No other schedules available to add.": "ไม่มีตารางเวลาอื่นให้เพิ่มแล้ว",
  "Number of days before": "จำนวนวันก่อน",

  // -- Interfaces ------------------------------------------------------------
  "ADMINISTRATIVE ACCESS": "การเข้าถึงเพื่อจัดการ",
  "Select interface…": "เลือกอินเทอร์เฟซ…",
  "Search interfaces…": "ค้นหาอินเทอร์เฟซ…",
  "By role": "แยกตามบทบาท",
  "Down / disabled": "ไม่ทำงาน / ปิดใช้งาน",

  // -- Shared form / picker chrome ------------------------------------------
  Back: "ย้อนกลับ",
  OK: "ตกลง",
  "Create new": "สร้างใหม่",
  "Create New": "สร้างใหม่",
  "Copied!": "คัดลอกแล้ว!",
  "More…": "เพิ่มเติม…",
  "Search…": "ค้นหา…",
  "No match": "ไม่พบรายการที่ตรงกัน",
  "No matches": "ไม่พบรายการที่ตรงกัน",
  "No options found": "ไม่พบตัวเลือก",
  "No options — nothing returned by the device": "ไม่มีตัวเลือก — อุปกรณ์ไม่ได้ส่งข้อมูลกลับมา",
  "Showing first 200 — type to search all": "แสดง 200 รายการแรก — พิมพ์เพื่อค้นหาทั้งหมด",
  "No device — go back and select a device": "ไม่มีอุปกรณ์ — ย้อนกลับไปเลือกอุปกรณ์",
  "Type a command…": "พิมพ์คำสั่ง…",
  "Type a command and press Enter…": "พิมพ์คำสั่งแล้วกด Enter…",
  "· firewall policy · ESC close": "· firewall policy · ESC เพื่อปิด",
  "· firewall service custom · ESC close": "· firewall service custom · ESC เพื่อปิด",
  "⚠ Used by": "⚠ ถูกใช้โดย",
  "⚠ Used in": "⚠ ถูกใช้ใน",
  "⚠ Referenced by": "⚠ ถูกอ้างอิงโดย",
  "will be permanently removed": "จะถูกลบอย่างถาวร",
  ") will be permanently removed from": ") จะถูกลบอย่างถาวรจาก",
  "object(s) — FortiGate will refuse if it's still referenced.":
    "อ็อบเจกต์ — FortiGate จะปฏิเสธหากยังมีการอ้างอิงอยู่",
  "policy(ies) — the device will refuse to delete it until those are removed.":
    "นโยบาย — อุปกรณ์จะปฏิเสธการลบจนกว่าจะเอาสิ่งเหล่านั้นออกก่อน",

  // -- Help panel ------------------------------------------------------------
  "Relevant Documentation": "เอกสารที่เกี่ยวข้อง",
  "Online Guides": "คู่มือออนไลน์",
  "Video Tutorials": "วิดีโอสอนการใช้งาน",
  "Fortinet Community": "ชุมชน Fortinet",
  "Join the Discussion": "ร่วมพูดคุย",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "By Sequence": "ตามลำดับ",
  "Could not load firewall policies from the device": "โหลดนโยบายไฟร์วอลล์จากอุปกรณ์ไม่สำเร็จ",
  "EDIT": "แก้ไข",
  "Interface Pair": "คู่อินเทอร์เฟซ",
  "IPv4 Static NAT": "IPv4 Static NAT แบบคงที่",
  "Many to many": "หลายต่อหลาย",
  "Monday": "วันจันทร์",
  "Tuesday": "วันอังคาร",
  "Wednesday": "วันพุธ",
  "Thursday": "วันพฤหัสบดี",
  "Friday": "วันศุกร์",
  "Saturday": "วันเสาร์",
  "Sunday": "วันอาทิตย์",
  "New Virtual IP": "สร้างเวอร์ชวล IP ใหม่",
  "One time": "ครั้งเดียว",
  "One to one": "หนึ่งต่อหนึ่ง",
  "schedule group": "กลุ่มตารางเวลา",
  "Schedule Group": "กลุ่มตารางเวลา",
  "Schedule Groups": "กลุ่มตารางเวลา",
  "Select…": "เลือก…",
  "Static NAT": "NAT แบบคงที่",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Error: Failed to fetch configuration": "ข้อผิดพลาด: ดึงคอนฟิกไม่สำเร็จ",

  // -- The Log column of the policy table: FortiOS logtraffic is all / utm / disable, and 'all' was already translated by the shared word list — leaving the other two English made one column read half-Thai ---
  "disable": "ปิด",
  "utm": "เฉพาะ UTM",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "The device may well still be enforcing policies — this list is 'unreadable', not 'empty'": "อุปกรณ์อาจยังบังคับใช้นโยบายอยู่ก็ได้ — รายการนี้คือ 'อ่านไม่ได้' ไม่ใช่ 'ว่างเปล่า'",

  // -- Report kinds and revert reasons — served by the Go backend, so the extractor never sees them ---
  "Web Proxy": "เว็บพร็อกซี",
  "VoIP, Messaging & Other Applications": "VoIP, ข้อความ และแอปพลิเคชันอื่น ๆ",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Decrypted traffic mirror": "มิเรอร์ทราฟฟิกที่ถอดรหัสแล้ว",
  "Enable security profiles": "เปิดใช้โปรไฟล์ความปลอดภัย",
  "Log allowed traffic": "บันทึกทราฟฟิกที่อนุญาต",
  "No samples for this rule yet": "ยังไม่มีค่าที่เก็บไว้ของกฎนี้",
  "No traffic matched this rule in the last 24 hours": "ไม่มีทราฟฟิกตรงกับกฎนี้ในช่วง 24 ชั่วโมงที่ผ่านมา",
  "Preserve source port": "คงพอร์ตต้นทางไว้",
  "SSL inspection profile": "โปรไฟล์ตรวจสอบ SSL",
  "Source port handling": "การจัดการพอร์ตต้นทาง",
  "Traffic 24h": "ทราฟฟิก 24 ชม.",
  "Specify source ports": "ระบุพอร์ตต้นทาง",
  "Measured from the device's own byte counters every five minutes — it keeps no history of these itself": "วัดจากตัวนับไบต์ของอุปกรณ์เองทุกห้านาที — ตัวอุปกรณ์ไม่ได้เก็บประวัติส่วนนี้ไว้เลย",
  "No samples in this window yet. Ports with no link that have never carried a byte are not recorded at all, so a box with nothing plugged in stays empty here.": "ยังไม่มีค่าที่เก็บไว้ในช่วงเวลานี้ พอร์ตที่ไม่มีลิงก์และไม่เคยส่งข้อมูลเลยจะไม่ถูกบันทึก เครื่องที่ไม่ได้เสียบสายอะไรไว้จึงว่างอยู่ตรงนี้",
  "Not enough samples yet — a rate needs two readings, so the first one draws nothing": "ค่ายังไม่พอ — อัตราต้องใช้ค่าสองครั้ง ครั้งแรกจึงยังวาดอะไรไม่ได้",
  "Peak": "สูงสุด",
  "Received": "รับเข้า",
  "Throughput": "ปริมาณข้อมูลที่ผ่าน",
  "Transmitted": "ส่งออก",
  "Route status": "สถานะเส้นทาง",
  "Enable port forwarding": "เปิดใช้การส่งต่อพอร์ต",
  "Filter by service": "กรองตามเซอร์วิส",
  "Filter by source address": "กรองตามแอดเดรสต้นทาง",
  "Use optional filters": "ใช้ตัวกรองเพิ่มเติม",
  "Virtual IP type": "ชนิดของเวอร์ชวล IP",

  // -- Impact Preview (create/edit form button + its dialog) ------------------
  "Preview Impact": "ดูผลกระทบล่วงหน้า",
  "Replay recent real traffic through this change before saving it": "จำลองทราฟฟิกจริงล่าสุดผ่านการเปลี่ยนแปลงนี้ก่อนบันทึก",
  "Impact Preview — recent real traffic, replayed": "ดูผลกระทบล่วงหน้า — จำลองจากทราฟฟิกจริงล่าสุด",
  "Replaying recent sessions against this change…": "กำลังจำลองเซสชันล่าสุดกับการเปลี่ยนแปลงนี้…",
  "Could not preview the impact of this change": "ดูผลกระทบล่วงหน้าของการเปลี่ยนแปลงนี้ไม่สำเร็จ",
  "Replayed": "จำลองผ่าน",
  "real session": "เซสชันจริง",
  "from this firewall's own recent traffic log against the policy table as it is now and as this change would leave it. Nothing was written to the device.":
    "จากล็อกทราฟฟิกจริงล่าสุดของไฟร์วอลล์นี้ เทียบกับตารางนโยบายทั้งแบบปัจจุบันและแบบที่จะเป็นหลังการเปลี่ยนแปลงนี้ ไม่มีการเขียนอะไรลงอุปกรณ์เลย",
  "Sessions affected": "เซสชันที่ได้รับผลกระทบ",
  "Newly allowed": "เพิ่งอนุญาตใหม่",
  "Newly blocked": "เพิ่งบล็อกใหม่",
  "None of the recently-seen traffic this firewall has handled would be affected by this change.":
    "ไม่มีทราฟฟิกที่พบล่าสุดรายการใดได้รับผลกระทบจากการเปลี่ยนแปลงนี้เลย",
  "showing": "แสดง",
  "affected sessions": "เซสชันที่ได้รับผลกระทบ",

  "DHCP RANGES": "ช่วงแอดเดรส DHCP",
  "Delete static route": "ลบเส้นทางแบบกำหนดเอง",
  "Route #": "เส้นทางที่",
};
