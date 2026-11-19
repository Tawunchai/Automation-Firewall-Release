/**
 * Thai — the AI Assistant: the chat, the fifteen wizards, the impact analysis and the flow charts.
 *
 * Two rules specific to this page:
 *
 *   1. THE CLI IS NEVER TRANSLATED. What the model proposes is FortiOS CLI, and it is rendered
 *      inside <code>/<pre>, which ../../jsx-runtime.ts leaves alone. The CMDB table names that
 *      appear as LABELS beside it (`firewall address`, `router static`, `system sdwan`) are in
 *      ../keep.ts for the same reason: they are the path the object is written to.
 *
 *   2. THE HEDGES ARE THE POINT. This page says what Apply WOULD do, and the difference between
 *      "creates", "overwrites" and "already on the device — Apply leaves it alone" is the whole
 *      safety story. Each is translated consistently: สร้าง / เขียนทับ / มีอยู่บนอุปกรณ์แล้ว.
 */
import type { Dict } from "../merge";

export const ai: Dict = {
  // -- Chat ------------------------------------------------------------------
  "AI Chat": "แชท AI",
  "Ask anything about this FortiGate": "ถามอะไรก็ได้เกี่ยวกับ FortiGate เครื่องนี้",
  "Type a request, or pick one of the examples below":
    "พิมพ์คำขอ หรือเลือกจากตัวอย่างด้านล่าง",
  "Ask AI for commands, then click Apply or Fetch":
    "ขอคำสั่งจาก AI แล้วคลิก ปรับใช้ หรือ ดึงข้อมูล",
  "Write a comment…": "เขียนความคิดเห็น…",
  "writing…": "กำลังเขียน…",
  "Running…": "กำลังทำงาน…",
  Stop: "หยุด",
  Recover: "กู้คืน",
  Expand: "ขยาย",
  Open: "เปิด",
  "No job yet": "ยังไม่มีงาน",
  "Pick a device first": "เลือกอุปกรณ์ก่อน",
  "The AI answer was for a different device and was discarded":
    "คำตอบของ AI เป็นของอุปกรณ์อื่น จึงถูกทิ้งไป",
  "Listening… tap the microphone again, or press Send when you are done":
    "กำลังฟัง… แตะไมโครโฟนอีกครั้ง หรือกดส่งเมื่อพูดเสร็จ",
  "Microphone access was denied — allow it in your browser settings":
    "การเข้าถึงไมโครโฟนถูกปฏิเสธ — อนุญาตได้ในการตั้งค่าเบราว์เซอร์",
  "No microphone found — connect one and try again":
    "ไม่พบไมโครโฟน — เชื่อมต่อไมโครโฟนแล้วลองอีกครั้ง",
  "This browser does not support voice input — use Chrome or Edge":
    "เบราว์เซอร์นี้ไม่รองรับการป้อนด้วยเสียง — ให้ใช้ Chrome หรือ Edge",
  "📊 CLI output attached — the model will see this live device data automatically":
    "📊 แนบผลลัพธ์ CLI มาด้วย — โมเดลจะเห็นข้อมูลสด ๆ จากอุปกรณ์นี้โดยอัตโนมัติ",
  "Using CLI output": "ใช้ผลลัพธ์จาก CLI",

  // -- Example prompts -------------------------------------------------------
  "Create a LAN → WAN policy": "สร้างนโยบาย LAN → WAN",
  "Create a custom service": "สร้างเซอร์วิสแบบกำหนดเอง",
  "Create an AntiVirus profile": "สร้างโปรไฟล์แอนตี้ไวรัส",
  "Create a staff user group": "สร้างกลุ่มผู้ใช้สำหรับพนักงาน",
  "Create a user in a group": "สร้างผู้ใช้ในกลุ่ม",
  "Create office-hours schedule": "สร้างตารางเวลาสำหรับเวลาทำการ",
  "Block Facebook (Web Filter)": "บล็อก Facebook (กรองเว็บ)",
  "Block TikTok (App Control)": "บล็อก TikTok (ควบคุมแอปพลิเคชัน)",
  "Block YouTube (DNS Filter)": "บล็อก YouTube (กรอง DNS)",
  "Block .exe downloads": "บล็อกการดาวน์โหลดไฟล์ .exe",
  "Port forward to a server": "ส่งต่อพอร์ตไปยังเซิร์ฟเวอร์",
  "Static route to a subnet": "เส้นทางสแตติกไปยังซับเน็ต",
  "SD-WAN across two ISPs": "SD-WAN ข้ามผู้ให้บริการสองราย",
  "IPsec site-to-site VPN": "VPN IPsec แบบไซต์ต่อไซต์",
  "Remote-access VPN": "VPN สำหรับเข้าถึงระยะไกล",
  "Add an address object": "เพิ่มแอดเดรสอ็อบเจกต์",
  "Add an LDAP server (AD)": "เพิ่มเซิร์ฟเวอร์ LDAP (AD)",
  "Add a RADIUS server": "เพิ่มเซิร์ฟเวอร์ RADIUS",
  "Show every policy": "แสดงนโยบายทั้งหมด",
  "Show interface status": "แสดงสถานะอินเทอร์เฟซ",
  "Check the routing table": "ตรวจสอบตารางเราต์",
  "Check VPN tunnel status": "ตรวจสอบสถานะอุโมงค์ VPN",

  // -- Wizard names ----------------------------------------------------------
  "AI Policy Wizard": "ตัวช่วยสร้างนโยบายด้วย AI",
  "AI Address Wizard": "ตัวช่วยสร้างแอดเดรสด้วย AI",
  "AI Service Wizard": "ตัวช่วยสร้างเซอร์วิสด้วย AI",
  "AI Schedule Wizard": "ตัวช่วยสร้างตารางเวลาด้วย AI",
  "AI Static Route Wizard": "ตัวช่วยสร้างเส้นทางสแตติกด้วย AI",
  "AI Virtual IP Wizard": "ตัวช่วยสร้างเวอร์ชวล IP ด้วย AI",
  "AI AntiVirus Wizard": "ตัวช่วยสร้างโปรไฟล์แอนตี้ไวรัสด้วย AI",
  "AI Web Filter Wizard": "ตัวช่วยสร้างตัวกรองเว็บด้วย AI",
  "AI DNS Filter Wizard": "ตัวช่วยสร้างตัวกรอง DNS ด้วย AI",
  "AI Application Control Wizard": "ตัวช่วยสร้างการควบคุมแอปพลิเคชันด้วย AI",
  "AI File Filter Wizard": "ตัวช่วยสร้างตัวกรองไฟล์ด้วย AI",
  "AI User Wizard": "ตัวช่วยสร้างผู้ใช้ด้วย AI",
  "AI User Group Wizard": "ตัวช่วยสร้างกลุ่มผู้ใช้ด้วย AI",
  "AI LDAP Server Wizard": "ตัวช่วยสร้างเซิร์ฟเวอร์ LDAP ด้วย AI",
  "AI RADIUS Server Wizard": "ตัวช่วยสร้างเซิร์ฟเวอร์ RADIUS ด้วย AI",
  "AI SD-WAN Wizard": "ตัวช่วยสร้าง SD-WAN ด้วย AI",
  "VPN Wizard": "ตัวช่วยสร้าง VPN",
  "Policy Wizard": "ตัวช่วยสร้างนโยบาย",
  "Back to Policy Wizard": "กลับไปยังตัวช่วยสร้างนโยบาย",
  "First Setup": "การตั้งค่าเริ่มต้น",
  "Basic Setup": "การตั้งค่าพื้นฐาน",
  Step: "ขั้นตอน",
  Next: "ถัดไป",
  "Name is required": "ต้องระบุชื่อ",
  "Please fix the highlighted fields": "โปรดแก้ไขช่องที่ไฮไลต์ไว้",
  "Please fix the highlighted fields in Basic Setup":
    "โปรดแก้ไขช่องที่ไฮไลต์ไว้ในการตั้งค่าพื้นฐาน",
  "Please fix the highlighted fields in First Setup":
    "โปรดแก้ไขช่องที่ไฮไลต์ไว้ในการตั้งค่าเริ่มต้น",

  // -- Apply, dry run and fallback ------------------------------------------
  "Fetch from Device": "ดึงข้อมูลจากอุปกรณ์",
  "Dry-run": "ทดลองรัน",
  "Dry run — what Apply would do": "ทดลองรัน — ดูว่าการปรับใช้จะทำอะไรบ้าง",
  "See what Apply would create or overwrite — nothing is written to the device yet":
    "ดูว่าการปรับใช้จะสร้างหรือเขียนทับอะไรบ้าง — ยังไม่มีการเขียนอะไรลงอุปกรณ์",
  "· read-only, nothing has been written to the device":
    "· อ่านอย่างเดียว ยังไม่มีการเขียนอะไรลงอุปกรณ์",
  "Read before you apply": "อ่านก่อนปรับใช้",
  "Applying would change": "การปรับใช้จะเปลี่ยนแปลง",
  "Reading from the device…": "กำลังอ่านจากอุปกรณ์…",
  "Reading the current values from the device…": "กำลังอ่านค่าปัจจุบันจากอุปกรณ์…",
  "Reading the device to fill in the subnets…": "กำลังอ่านจากอุปกรณ์เพื่อเติมค่าซับเน็ต…",
  "Loading device rule base…": "กำลังโหลดชุดกฎของอุปกรณ์…",
  "Loading application categories…": "กำลังโหลดหมวดหมู่แอปพลิเคชัน…",
  "Checking device for an existing address…": "กำลังตรวจสอบว่ามีแอดเดรสนี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  "Checking device for an existing policy…": "กำลังตรวจสอบว่ามีนโยบายนี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  "Checking device for an existing profile…": "กำลังตรวจสอบว่ามีโปรไฟล์นี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  "Checking device for an existing route…": "กำลังตรวจสอบว่ามีเส้นทางนี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  "Checking device for an existing schedule…":
    "กำลังตรวจสอบว่ามีตารางเวลานี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  "Checking device for an existing service…":
    "กำลังตรวจสอบว่ามีเซอร์วิสนี้อยู่บนอุปกรณ์แล้วหรือไม่…",
  Applied: "ปรับใช้แล้ว",
  Created: "สร้างแล้ว",
  Creating: "กำลังสร้าง",
  CREATE: "สร้าง",
  UPDATE: "อัปเดต",
  SKIP: "ข้าม",
  QUERY: "สอบถาม",
  SUCCESS: "สำเร็จ",
  FAILED: "ล้มเหลว",
  PARTIAL: "บางส่วน",
  "ON DEVICE": "มีบนอุปกรณ์",
  "Added:": "เพิ่ม:",
  "Removed:": "ลบ:",
  "Already applied — review only (read-only)": "ปรับใช้ไปแล้ว — ดูอย่างเดียว (อ่านอย่างเดียว)",
  "Already on the device": "มีอยู่บนอุปกรณ์แล้ว",
  "Already on the device — Apply leaves it alone":
    "มีอยู่บนอุปกรณ์แล้ว — การปรับใช้จะไม่แตะต้อง",
  "Already on the device, but its values": "มีอยู่บนอุปกรณ์แล้ว แต่ค่าของมัน",
  "differs from the device": "ต่างจากที่อยู่บนอุปกรณ์",
  "do not match": "ไม่ตรงกัน",
  "Everything in this config already exists on the device":
    "ทุกอย่างในคอนฟิกนี้มีอยู่บนอุปกรณ์แล้ว",
  "on the device — every object already exists": "บนอุปกรณ์ — ทุกอ็อบเจกต์มีอยู่แล้ว",
  "Objects that would be created": "อ็อบเจกต์ที่จะถูกสร้าง",
  "New objects that would be created": "อ็อบเจกต์ใหม่ที่จะถูกสร้าง",
  "Will be created on the device": "จะถูกสร้างบนอุปกรณ์",
  "Will create": "จะสร้าง",
  "will not change it": "จะไม่เปลี่ยนแปลงมัน",
  "Overwrites an object that already exists": "เขียนทับอ็อบเจกต์ที่มีอยู่แล้ว",
  "Leave this object out": "ไม่รวมอ็อบเจกต์นี้",
  "Cannot preview this one object at a time":
    "ไม่สามารถดูตัวอย่างอ็อบเจกต์นี้ทีละรายการได้",
  "Objects already on the device are skipped, not overwritten — the ones marked ON DEVICE above.":
    "อ็อบเจกต์ที่มีอยู่บนอุปกรณ์แล้วจะถูกข้าม ไม่ถูกเขียนทับ — คือรายการที่ทำเครื่องหมาย มีบนอุปกรณ์ ไว้ด้านบน",
  "Names that already exist on the device are skipped, not overwritten — run a dry run to see which ones exist":
    "ชื่อที่มีอยู่บนอุปกรณ์แล้วจะถูกข้าม ไม่ถูกเขียนทับ — ลองทดลองรันเพื่อดูว่าชื่อใดมีอยู่แล้ว",
  "No creatable object was found in this config — nothing was sent to the device":
    "ไม่พบอ็อบเจกต์ที่สร้างได้ในคอนฟิกนี้ — จึงไม่มีอะไรถูกส่งไปยังอุปกรณ์",
  "No object in this config is one Apply could create":
    "ไม่มีอ็อบเจกต์ใดในคอนฟิกนี้ที่การปรับใช้สร้างได้",
  "No object in this config is one the console can create":
    "ไม่มีอ็อบเจกต์ใดในคอนฟิกนี้ที่คอนโซลสร้างได้",
  "This proposal cannot be built as written": "ข้อเสนอนี้สร้างตามที่เขียนไว้ไม่ได้",
  "This config is not built object by object — the whole CLI block is sent to the device, and a before/after diff is shown once it finishes":
    "คอนฟิกนี้ไม่ได้ถูกสร้างทีละอ็อบเจกต์ — ระบบจะส่งบล็อก CLI ทั้งก้อนไปยังอุปกรณ์ แล้วแสดงความต่างก่อน/หลังเมื่อทำงานเสร็จ",
  "Sent as one block over SSH": "ส่งเป็นบล็อกเดียวผ่าน SSH",
  "Only admins can apply config changes":
    "เฉพาะผู้ดูแลระบบเท่านั้นที่ปรับใช้การเปลี่ยนแปลงคอนฟิกได้",
  "Only admins can change config on the device":
    "เฉพาะผู้ดูแลระบบเท่านั้นที่เปลี่ยนคอนฟิกบนอุปกรณ์ได้",
  Fallback: "ย้อนคืน",
  "Fallback — remove the objects this apply just created":
    "ย้อนคืน — ลบอ็อบเจกต์ที่เพิ่งถูกสร้างจากการปรับใช้ครั้งนี้",
  "This removes": "การกระทำนี้จะลบ",
  "object(s) from the device — policies first, then the objects they referenced:":
    "อ็อบเจกต์ออกจากอุปกรณ์ — ลบนโยบายก่อน แล้วจึงลบอ็อบเจกต์ที่นโยบายนั้นอ้างอิง:",
  "💾 rollback #": "💾 ย้อนคืนครั้งที่ ",

  // -- Impact analysis -------------------------------------------------------
  Impact: "ผลกระทบ",
  "Rough impact": "ผลกระทบโดยประมาณ",
  "Impact summary from the model": "สรุปผลกระทบจากโมเดล",
  "Incomplete evaluation": "การประเมินยังไม่สมบูรณ์",
  "For information": "เพื่อทราบ",
  "Worth checking": "ควรตรวจสอบ",
  "Broad — worth a second look": "กว้างมาก — ควรดูอีกรอบ",
  "Fix first": "แก้ก่อน",
  "What this policy affects": "นโยบายนี้ส่งผลกับอะไรบ้าง",
  "Traffic paths": "เส้นทางของทราฟฟิก",
  "Subnets in scope": "ซับเน็ตที่อยู่ในขอบเขต",
  "hosts in scope": "โฮสต์ที่อยู่ในขอบเขต",
  "source networks affected": "เครือข่ายต้นทางที่ได้รับผลกระทบ",
  "unrestricted source": "ต้นทางไม่จำกัด",
  "existing policies involved": "นโยบายที่มีอยู่แล้วซึ่งเกี่ยวข้อง",
  "Existing policies on the device that this traffic collides with":
    "นโยบายที่มีอยู่บนอุปกรณ์ซึ่งทราฟฟิกนี้ไปชนด้วย",
  "No existing policy overlaps": "ไม่มีนโยบายเดิมข้อใดทับซ้อน",
  "No existing policy on this interface pair — this will be the first rule for":
    "ยังไม่มีนโยบายบนคู่อินเทอร์เฟซนี้ — ข้อนี้จะเป็นกฎแรกสำหรับ",
  "No rule on this interface pair matches the same traffic — the new policy will work as configured":
    "ไม่มีกฎบนคู่อินเทอร์เฟซนี้ที่ตรงกับทราฟฟิกเดียวกัน — นโยบายใหม่จะทำงานตามที่ตั้งค่าไว้",
  "This traffic is allowed right now": "ทราฟฟิกนี้ได้รับอนุญาตอยู่ในตอนนี้",
  "Traffic is blocked here": "ทราฟฟิกถูกบล็อกที่นี่",
  "No blocking rule yet": "ยังไม่มีกฎที่บล็อก",
  "No rule yet": "ยังไม่มีกฎ",
  "nothing at all": "ไม่มีอะไรเลย",
  "Only the": "เฉพาะ",
  "pair — where this policy matches.": "คู่นี้ — จุดที่นโยบายนี้ตรงกัน",
  "Drops the packet": "ทิ้งแพ็กเก็ต",
  "Traffic matching this policy is inspected by these profiles before it reaches the destination":
    "ทราฟฟิกที่ตรงกับนโยบายนี้จะถูกตรวจสอบด้วยโปรไฟล์เหล่านี้ก่อนไปถึงปลายทาง",
  "Rewrites the destination from the external IP to the internal host":
    "เขียนปลายทางใหม่จาก IP ภายนอกไปยังโฮสต์ภายใน",
  "Source NAT — the source is rewritten to the egress IP":
    "NAT ต้นทาง — ต้นทางถูกเขียนใหม่เป็น IP ขาออก",
  "Traffic to this destination is dropped immediately rather than forwarded":
    "ทราฟฟิกไปยังปลายทางนี้จะถูกทิ้งทันทีแทนที่จะถูกส่งต่อ",
  "The tunnel stays down until the far end is configured to match (PSK, proposal, selectors)":
    "อุโมงค์จะไม่ทำงานจนกว่าฝั่งตรงข้ามจะถูกตั้งค่าให้ตรงกัน (PSK, proposal, selectors)",
  "These take effect on the network as soon as you apply":
    "สิ่งเหล่านี้จะมีผลกับเครือข่ายทันทีที่คุณปรับใช้",
  "These change no traffic until a policy references them":
    "สิ่งเหล่านี้จะไม่เปลี่ยนทราฟฟิกใดจนกว่าจะมีนโยบายอ้างอิงถึง",
  "These objects change no traffic until a policy references them":
    "อ็อบเจกต์เหล่านี้จะไม่เปลี่ยนทราฟฟิกใดจนกว่าจะมีนโยบายอ้างอิงถึง",
  "The profile inspects nothing until a policy references it":
    "โปรไฟล์นี้จะไม่ตรวจสอบอะไรเลยจนกว่าจะมีนโยบายอ้างอิงถึง",
  "Accounts and groups do nothing to traffic until a policy or a VPN references the group":
    "บัญชีและกลุ่มจะไม่มีผลกับทราฟฟิกใดจนกว่าจะมีนโยบายหรือ VPN อ้างอิงถึงกลุ่มนั้น",
  "This time window does nothing until a policy sets its schedule to this name":
    "ช่วงเวลานี้จะไม่มีผลใดจนกว่าจะมีนโยบายตั้งตารางเวลาเป็นชื่อนี้",
  "A VIP opens nothing until a policy sets its destination to this VIP — creating the VIP alone does not forward a port":
    "VIP จะไม่เปิดอะไรเลยจนกว่าจะมีนโยบายตั้งปลายทางเป็น VIP นี้ — การสร้าง VIP อย่างเดียวไม่ได้ส่งต่อพอร์ตให้",
  "This is the default route (0.0.0.0/0) — changing it affects every packet with no more specific route":
    "นี่คือเส้นทางเริ่มต้น (0.0.0.0/0) — การเปลี่ยนแปลงจะส่งผลกับทุกแพ็กเก็ตที่ไม่มีเส้นทางเฉพาะเจาะจงกว่า",

  // -- Placement -------------------------------------------------------------
  "Policy Placement": "ตำแหน่งของนโยบาย",
  "Position:": "ตำแหน่ง:",
  Top: "บนสุด",
  Bottom: "ล่างสุด",
  Manual: "กำหนดเอง",
  Locked: "ล็อกไว้",
  "Device default (cfg-order)": "ค่าเริ่มต้นของอุปกรณ์ (cfg-order)",
  "Check the order before applying — FortiGate matches top to bottom and the first match wins":
    "ตรวจลำดับก่อนปรับใช้ — FortiGate จับคู่จากบนลงล่าง และกฎแรกที่ตรงเป็นผู้ชนะ",
  "FortiGate matches top to bottom — a more specific policy must sit above a broader one":
    "FortiGate จับคู่จากบนลงล่าง — นโยบายที่เฉพาะเจาะจงกว่าต้องอยู่เหนือนโยบายที่กว้างกว่า",
  "The policies must be created in order, top to bottom — finish the one above before the next unlocks":
    "ต้องสร้างนโยบายตามลำดับจากบนลงล่าง — ทำข้อบนให้เสร็จก่อน ข้อถัดไปจึงจะปลดล็อก",
  "has already been created, so this one's position is": "ถูกสร้างไปแล้ว ตำแหน่งของข้อนี้จึงเป็น",
  ". Drag as usual — the others follow the same placement automatically":
    " ลากได้ตามปกติ — ข้ออื่นจะใช้ตำแหน่งเดียวกันโดยอัตโนมัติ",
  "policies together, in the order the model proposed (top→bottom):":
    "นโยบายพร้อมกัน ตามลำดับที่โมเดลเสนอ (บน→ล่าง):",
  "to the order the model proposed (top→bottom:": "ตามลำดับที่โมเดลเสนอ (บน→ล่าง:",
  ") to keep the indexes from colliding": ") เพื่อไม่ให้ลำดับชนกัน",

  // -- Flow chart ------------------------------------------------------------
  "Flow Chart": "แผนภาพการไหล",
  "Flow chart — this proposal, drawn": "แผนภาพการไหล — วาดจากข้อเสนอนี้",
  "· drawn from the same config the Apply button would create":
    "· วาดจากคอนฟิกชุดเดียวกับที่ปุ่มปรับใช้จะสร้าง",
  "Open the full diagram of this proposal in the right-hand panel":
    "เปิดแผนภาพเต็มของข้อเสนอนี้ในแผงด้านขวา",
  "Open every diagram in the right-hand panel": "เปิดแผนภาพทั้งหมดในแผงด้านขวา",
  "more diagram(s) of objects that would be created — open the full panel":
    "แผนภาพเพิ่มเติมของอ็อบเจกต์ที่จะถูกสร้าง — เปิดแผงเต็ม",
  "This answer has nothing that can be drawn as a diagram":
    "คำตอบนี้ไม่มีอะไรที่วาดเป็นแผนภาพได้",
  "Download as an SVG file": "ดาวน์โหลดเป็นไฟล์ SVG",
  "External side": "ฝั่งภายนอก",
  "Internal host (mapped)": "โฮสต์ภายใน (ที่แมปไว้)",
  "This FortiGate": "FortiGate เครื่องนี้",
  "next hop": "hop ถัดไป",

  // -- Object kinds ----------------------------------------------------------
  OBJECT: "อ็อบเจกต์",
  Objects: "อ็อบเจกต์",
  "object group(s)": "กลุ่มอ็อบเจกต์",
  Address: "แอดเดรส",
  "Address Details": "รายละเอียดแอดเดรส",
  Policy: "นโยบาย",
  ROUTE: "เส้นทาง",
  "Static Route": "เส้นทางสแตติก",
  "Route Settings": "การตั้งค่าเส้นทาง",
  "Destination & Gateway": "ปลายทางและเกตเวย์",
  Destination: "ปลายทาง",
  Source: "ต้นทาง",
  Gateway: "เกตเวย์",
  Blackhole: "หลุมดำ (blackhole)",
  BLACKHOLE: "หลุมดำ (blackhole)",
  "NAT on": "เปิด NAT",
  "Virtual IP": "เวอร์ชวล IP",
  Schedule: "ตารางเวลา",
  Recurring: "ทำซ้ำ",
  "One Time": "ครั้งเดียว",
  Days: "วัน",
  "Days before": "จำนวนวันก่อน",
  "Start date": "วันที่เริ่ม",
  "End date": "วันที่สิ้นสุด",
  Time: "เวลา",
  "Pre-expiration event log": "บันทึกเหตุการณ์ก่อนหมดอายุ",
  "Local User": "ผู้ใช้ในเครื่อง",
  "User Group": "กลุ่มผู้ใช้",
  "user group": "กลุ่มผู้ใช้",
  "User Group (members)": "กลุ่มผู้ใช้ (สมาชิก)",
  "Membership of each group": "การเป็นสมาชิกของแต่ละกลุ่ม",
  Members: "สมาชิก",
  "Login Credentials": "ข้อมูลรับรองการเข้าสู่ระบบ",
  "Contact Info": "ข้อมูลติดต่อ",
  IDENTITY: "ตัวตน",
  "LDAP Server": "เซิร์ฟเวอร์ LDAP",
  "RADIUS Server": "เซิร์ฟเวอร์ RADIUS",
  "Exchange Connector": "ตัวเชื่อมต่อ Exchange",
  Server: "เซิร์ฟเวอร์",
  Type: "ชนิด",
  Protocol: "โปรโตคอล",
  "Protocol Options": "ตัวเลือกโปรโตคอล",
  Comments: "หมายเหตุ",
  Options: "ตัวเลือก",
  "Additional Options": "ตัวเลือกเพิ่มเติม",
  "Extra Info": "ข้อมูลเพิ่มเติม",
  Categories: "หมวดหมู่",
  Profile: "โปรไฟล์",
  Active: "ใช้งานอยู่",
  "Firewall / Network Options": "ตัวเลือกไฟร์วอลล์ / เครือข่าย",
  "Security Inspection": "การตรวจสอบด้านความปลอดภัย",
  "UTM profiles": "โปรไฟล์ UTM",
  "Inspected / encrypted": "ตรวจสอบแล้ว / เข้ารหัส",
  "Inspected Protocols": "โปรโตคอลที่ตรวจสอบ",
  ALL: "ทั้งหมด",
  "ALL · every port": "ทั้งหมด · ทุกพอร์ต",
  "all · 0.0.0.0/0": "ทั้งหมด · 0.0.0.0/0",
  "Every IP — no source or destination limit": "ทุก IP — ไม่จำกัดต้นทางหรือปลายทาง",
  "0.0.0.0 (learn it)": "0.0.0.0 (ให้เรียนรู้เอง)",
  "not found": "ไม่พบ",
  "still name": "ยังคงชื่อ",
  "” first": "” ก่อน",
  "Create “": "สร้าง “",
  "Cost": "ค่าใช้จ่าย",
  Priority: "ลำดับความสำคัญ",
  "Tie break": "ตัวตัดสินเมื่อเสมอ",
  "Fail after": "ล้มเหลวหลังจาก",

  // -- Security profile wizards ---------------------------------------------
  ANTIVIRUS: "แอนตี้ไวรัส",
  "AntiVirus Profile": "โปรไฟล์แอนตี้ไวรัส",
  "APT Protection Options": "ตัวเลือกการป้องกัน APT",
  "Virus Outbreak Prevention": "การป้องกันการระบาดของไวรัส",
  "Outbreak Prevention": "การป้องกันการระบาด",
  "Send to FortiSandbox": "ส่งไปยัง FortiSandbox",
  "Scan archive contents": "สแกนเนื้อหาในไฟล์บีบอัด",
  "Scan inside archives": "สแกนภายในไฟล์บีบอัด",
  "Virus found → block": "พบไวรัส → บล็อก",
  "EXE = virus": "EXE = ไวรัส",
  "mobile malware": "มัลแวร์บนมือถือ",
  "block botnet C&C": "บล็อก C&C ของบ็อตเน็ต",
  "AntiVirus scanning is off — this profile scans no malware for the policies that reference it":
    "การสแกนแอนตี้ไวรัสถูกปิดอยู่ — โปรไฟล์นี้จะไม่สแกนมัลแวร์ให้กับนโยบายที่อ้างอิงถึงเลย",
  "WEB FILTER": "กรองเว็บ",
  "Web Filter Profile": "โปรไฟล์กรองเว็บ",
  "FortiGuard Categories": "หมวดหมู่ของ FortiGuard",
  "FortiGuard Category Filter": "ตัวกรองตามหมวดหมู่ของ FortiGuard",
  "FortiGuard Category Based Filter": "ตัวกรองตามหมวดหมู่ของ FortiGuard",
  "Static URL Filter": "ตัวกรอง URL แบบสแตติก",
  "Rating & Proxy Options": "ตัวเลือกการจัดเรตและพร็อกซี",
  "Allow users to override blocked categories":
    "อนุญาตให้ผู้ใช้แทนที่หมวดหมู่ที่ถูกบล็อกได้",
  "safe search": "การค้นหาแบบปลอดภัย",
  "Needs a FortiGuard licence": "ต้องมีไลเซนส์ FortiGuard",
  "Needs a FortiGuard Web Filter licence — on a device without one it blocks nothing":
    "ต้องมีไลเซนส์ FortiGuard Web Filter — บนอุปกรณ์ที่ไม่มีไลเซนส์ จะบล็อกอะไรไม่ได้เลย",
  "Works without a FortiGuard licence": "ใช้งานได้โดยไม่ต้องมีไลเซนส์ FortiGuard",
  "HTTPS sites need SSL inspection — certificate-inspection at least — before a domain name can be blocked":
    "เว็บไซต์ HTTPS ต้องมีการตรวจสอบ SSL — อย่างน้อยระดับ certificate-inspection — จึงจะบล็อกตามชื่อโดเมนได้",
  "DNS FILTER": "กรอง DNS",
  "DNS Filter Profile": "โปรไฟล์กรอง DNS",
  "Static Domain Filter": "ตัวกรองโดเมนแบบสแตติก",
  "Allow and Log DNS Traffic": "อนุญาตและบันทึกทราฟฟิก DNS",
  "DNS Filter acts on the lookup, so it needs no SSL inspection — but it is bypassed by a hard-coded IP or by DoH/DoT":
    "ตัวกรอง DNS ทำงานที่ขั้นตอนการค้นหาชื่อ จึงไม่ต้องมีการตรวจสอบ SSL — แต่จะถูกข้ามได้ด้วยการใส่ IP ตรง ๆ หรือด้วย DoH/DoT",
  "APP CONTROL": "ควบคุมแอปพลิเคชัน",
  "Application Sensor": "เซนเซอร์แอปพลิเคชัน",
  "Application categories": "หมวดหมู่แอปพลิเคชัน",
  "application list": "รายการแอปพลิเคชัน",
  "Blocked applications": "แอปพลิเคชันที่ถูกบล็อก",
  "Application and Filter Overrides": "การแทนที่ระดับแอปพลิเคชันและตัวกรอง",
  "Filter overrides": "การแทนที่ด้วยตัวกรอง",
  "Network Protocol Enforcement": "การบังคับใช้โปรโตคอลเครือข่าย",
  "Enable Network Protocol Enforcement": "เปิดใช้การบังคับใช้โปรโตคอลเครือข่าย",
  "Block applications detected on non-default ports":
    "บล็อกแอปพลิเคชันที่ตรวจพบบนพอร์ตที่ไม่ใช่ค่าเริ่มต้น",
  "Replacement Messages for HTTP-based Applications":
    "ข้อความแทนที่สำหรับแอปพลิเคชันที่ทำงานบน HTTP",
  "Application Control needs no FortiGuard licence — but apps running over HTTPS need SSL inspection to be told apart":
    "การควบคุมแอปพลิเคชันไม่ต้องมีไลเซนส์ FortiGuard — แต่แอปที่ทำงานบน HTTPS ต้องมีการตรวจสอบ SSL จึงจะแยกออกจากกันได้",
  "FortiOS stores signature ids — every variant of the app has to be covered for the block to hold":
    "FortiOS เก็บเป็นรหัสลายเซ็น — ต้องครอบคลุมทุกตัวแปรของแอปนั้น การบล็อกจึงจะได้ผลจริง",
  "FILE FILTER": "กรองไฟล์",
  "File Filter Profile": "โปรไฟล์กรองไฟล์",
  "Password-protected only": "เฉพาะไฟล์ที่มีรหัสผ่าน",
  "No rules — a File Filter profile with no rules matches nothing. Add at least one rule.":
    "ไม่มีกฎ — โปรไฟล์กรองไฟล์ที่ไม่มีกฎจะไม่ตรงกับอะไรเลย เพิ่มอย่างน้อยหนึ่งกฎ",
  Rules: "กฎ",

  // -- SD-WAN wizard ---------------------------------------------------------
  "SD-WAN Zone": "โซน SD-WAN",
  "SD-WAN Member": "สมาชิก SD-WAN",
  "SD-WAN Rule": "กฎ SD-WAN",
  "Performance SLA": "SLA ประสิทธิภาพ",
  "SLA target": "เป้าหมาย SLA",
  "Required SLA:": "เป้าหมาย SLA ที่ต้องผ่าน:",
  "Participants:": "ผู้เข้าร่วม:",
  "Outgoing:": "ขาออก:",
  Zone: "โซน",
  Strategy: "กลยุทธ์",
  "Best quality": "คุณภาพดีที่สุด",
  "Lowest cost (SLA)": "ค่าใช้จ่ายต่ำสุด (SLA)",
  "Maximize bandwidth (SLA)": "ใช้แบนด์วิดท์ให้มากที่สุด (SLA)",
  "Probe mode": "โหมดการตรวจสอบ",
  Passive: "พาสซีฟ",
  "Prefer Passive": "เลือกพาสซีฟก่อน",
  "SD-WAN is currently": "ปัจจุบัน SD-WAN อยู่ในสถานะ",
  "A zone groups the WAN links traffic may leave by. A rule steers to a zone or to specific members inside one.":
    "โซนคือการจัดกลุ่มลิงก์ WAN ที่ทราฟฟิกออกไปได้ กฎจะกำหนดทิศทางไปยังโซน หรือไปยังสมาชิกเฉพาะรายในโซนนั้น",
  "Each member is one interface inside a zone. Cost and priority decide which one wins when several are healthy.":
    "สมาชิกแต่ละรายคืออินเทอร์เฟซหนึ่งตัวในโซน ค่าใช้จ่ายและลำดับความสำคัญเป็นตัวตัดสินว่ารายใดชนะเมื่อหลายรายใช้งานได้ปกติ",
  "A performance SLA probes a server over each member and measures the replies. Its thresholds are what an SD-WAN rule selects on.":
    "SLA ประสิทธิภาพจะส่งแพ็กเก็ตตรวจสอบไปยังเซิร์ฟเวอร์ผ่านสมาชิกแต่ละรายแล้ววัดผลจากคำตอบ เกณฑ์ของ SLA คือสิ่งที่กฎ SD-WAN ใช้เลือก",
  "A rule says which traffic leaves by which members, and how one is chosen. Rules are first-match, top to bottom.":
    "กฎระบุว่าทราฟฟิกใดออกทางสมาชิกรายใด และเลือกอย่างไร กฎทำงานแบบกฎแรกที่ตรงเป็นผู้ชนะ จากบนลงล่าง",
  "Every SD-WAN object in this proposal is already on the device":
    "อ็อบเจกต์ SD-WAN ทุกรายการในข้อเสนอนี้มีอยู่บนอุปกรณ์แล้ว",
  "The device rejected the SD-WAN configuration": "อุปกรณ์ปฏิเสธการตั้งค่า SD-WAN",
  "Applied in dependency order — zones, then members, then performance SLAs, then rules. Anything already on the device is skipped rather than overwritten, and the sequence numbers the SLAs and rules point at are the ones this firewall assigns, not the ones in the proposal.":
    "ปรับใช้ตามลำดับการพึ่งพา — โซน แล้วสมาชิก แล้ว SLA ประสิทธิภาพ แล้วจึงเป็นกฎ สิ่งที่มีอยู่บนอุปกรณ์แล้วจะถูกข้าม ไม่ถูกเขียนทับ และหมายเลขลำดับที่ SLA และกฎชี้ไปหาคือหมายเลขที่ไฟร์วอลล์เครื่องนี้กำหนดให้ ไม่ใช่หมายเลขในข้อเสนอ",
  ". These objects will be created and will not steer any traffic until SD-WAN is turned on — which this wizard does not do, because enabling it re-homes every route leaving through a member interface. Turn it on from Network ▸ SD-WAN when you are ready.":
    " อ็อบเจกต์เหล่านี้จะถูกสร้างขึ้น แต่จะยังไม่กำหนดทิศทางทราฟฟิกใดจนกว่าจะเปิดใช้ SD-WAN — ซึ่งตัวช่วยสร้างนี้ไม่ได้ทำให้ เพราะการเปิดใช้จะย้ายเส้นทางทุกเส้นที่ออกทางอินเทอร์เฟซของสมาชิก ให้เปิดใช้เองที่ เครือข่าย ▸ SD-WAN เมื่อพร้อม",
  'No hyphens here — the firewall reserves “-” in a performance SLA name. Use “_”.':
    'ห้ามใช้เครื่องหมายขีดที่นี่ — ไฟร์วอลล์สงวน “-” ไว้ในชื่อ SLA ประสิทธิภาพ ให้ใช้ “_” แทน',
  ". FortiGate refuses to make it an SD-WAN member until those are repointed at the SD-WAN zone — pick another interface, or fix the policies first.":
    " FortiGate จะไม่ยอมให้อินเทอร์เฟซนี้เป็นสมาชิก SD-WAN จนกว่าจะเปลี่ยนให้ชี้ไปที่โซน SD-WAN — ให้เลือกอินเทอร์เฟซอื่น หรือแก้นโยบายเหล่านั้นก่อน",

  // -- Miscellaneous warnings -----------------------------------------------
  "An interface-bound address only works in a policy on that same interface":
    "แอดเดรสที่ผูกกับอินเทอร์เฟซจะใช้ได้เฉพาะในนโยบายบนอินเทอร์เฟซเดียวกันเท่านั้น",
  "— FortiGate shares one name space across all types, so pick another name":
    "— FortiGate ใช้เนมสเปซเดียวร่วมกันทุกชนิด ให้ตั้งชื่ออื่น",
  "This name already exists on the device as type": "ชื่อนี้มีอยู่บนอุปกรณ์แล้วในชนิด",
  "The type of an existing schedule cannot be changed — create a new one under a different name":
    "ไม่สามารถเปลี่ยนชนิดของตารางเวลาที่มีอยู่แล้วได้ — ให้สร้างใหม่ภายใต้ชื่ออื่น",
  "The member list is replaced wholesale — anyone not in this list is removed from the group":
    "รายชื่อสมาชิกจะถูกแทนที่ทั้งชุด — ใครที่ไม่อยู่ในรายการนี้จะถูกเอาออกจากกลุ่ม",
  "This sets a new password on the account — FortiGate never hands the old one back, so it cannot be undone":
    "การทำเช่นนี้จะตั้งรหัสผ่านใหม่ให้บัญชี — FortiGate จะไม่คืนรหัสผ่านเดิมมาให้ จึงย้อนกลับไม่ได้",
  "This connection is not encrypted — the bind password crosses the network in plaintext":
    "การเชื่อมต่อนี้ไม่ได้เข้ารหัส — รหัสผ่านสำหรับ bind จะวิ่งผ่านเครือข่ายเป็นข้อความธรรมดา",
  "If a secondary server was set before, clearing the field does nothing — FortiOS will not remove a backup host over REST":
    "หากเคยตั้งเซิร์ฟเวอร์สำรองไว้ การล้างช่องนี้จะไม่มีผล — FortiOS ไม่ยอมลบโฮสต์สำรองผ่าน REST",
  "No other schedules to add.": "ไม่มีตารางเวลาอื่นให้เพิ่มแล้ว",
  "the CLI on the left — Apply": "CLI ทางซ้าย — ปรับใช้",
  "IPsec tunnel — traffic between the two sides is encrypted":
    "อุโมงค์ IPsec — ทราฟฟิกระหว่างสองฝั่งถูกเข้ารหัส",
  "split tunnel": "split tunnel",
  "path(s) ·": "เส้นทาง ·",
  "out of": "จาก",
  "Command:": "คำสั่ง:",
  Logging: "การบันทึก",

  // -- Flow chart legend -----------------------------------------------------
  "Allowed (accept)": "อนุญาต (accept)",
  "Blocked (deny)": "ถูกบล็อก (deny)",
  "e.g. AppCtrl-Standard": "เช่น AppCtrl-Standard",
  "e.g. Work-Hours": "เช่น Work-Hours",


  // -- Runtime sweep: strings the extractor could not see statically ---------
  "1-to-1": "หนึ่งต่อหนึ่ง",
  "ACCEPT": "อนุญาต",
  "ACCEPT — allowed": "อนุญาต — ผ่านได้",
  "DENY": "ปฏิเสธ",
  "DENY — blocked": "ปฏิเสธ — ถูกบล็อก",
  "Allows": "อนุญาต",
  "Blocks": "บล็อก",
  "Blocked": "ถูกบล็อก",
  "Log only": "บันทึกอย่างเดียว",
  "all SD-WAN members": "สมาชิก SD-WAN ทั้งหมด",
  "Already applied — nothing to re-apply": "ปรับใช้ไปแล้ว — ไม่มีอะไรให้ปรับใช้ซ้ำ",
  "the chosen interface": "อินเทอร์เฟซที่เลือกไว้",
  "the egress interface": "อินเทอร์เฟซขาออก",
  "(no interface)": "(ไม่มีอินเทอร์เฟซ)",
  "APPLIED": "ปรับใช้แล้ว",
  "Applied ✓": "ปรับใช้แล้ว ✓",
  "Apply": "ปรับใช้",
  "Apply this": "ปรับใช้รายการนี้",
  "Apply Changes": "ปรับใช้การเปลี่ยนแปลง",
  "Apply each one — green ones already exist (review only).": "ปรับใช้ทีละรายการ — รายการสีเขียวมีอยู่แล้ว (ดูอย่างเดียว)",
  "Apply failed": "ปรับใช้ไม่สำเร็จ",
  "Applying…": "กำลังปรับใช้…",
  "Applying to the device…": "กำลังปรับใช้กับอุปกรณ์…",
  "Apply — overwrite the existing object": "ปรับใช้ — เขียนทับอ็อบเจกต์เดิม",
  "Apply — write to the device": "ปรับใช้ — เขียนลงอุปกรณ์",
  "Will be written to the device": "จะถูกเขียนลงอุปกรณ์",
  "Checking the device…": "กำลังตรวจสอบอุปกรณ์…",
  "Reading live data from the device…": "กำลังอ่านข้อมูลสดจากอุปกรณ์…",
  "Could not read the current values from the device": "อ่านค่าปัจจุบันจากอุปกรณ์ไม่สำเร็จ",
  "— choose —": "— เลือก —",
  "— nothing chosen —": "— ยังไม่ได้เลือก —",
  "Click to speak": "คลิกเพื่อพูด",
  "Listening… click to stop": "กำลังฟัง… คลิกเพื่อหยุด",
  "The model is thinking…": "โมเดลกำลังคิด…",
  "Config Changed": "คอนฟิกเปลี่ยนแปลง",
  "No Change": "ไม่มีการเปลี่ยนแปลง",
  "Matches what is on the device — nothing changes": "ตรงกับที่มีอยู่บนอุปกรณ์ — ไม่มีอะไรเปลี่ยน",
  "Confirm this change on the device": "ยืนยันการเปลี่ยนแปลงนี้บนอุปกรณ์",
  "Confirm this creation on the device": "ยืนยันการสร้างรายการนี้บนอุปกรณ์",
  "Create every policy and the objects they need, in one go": "สร้างทุกนโยบายพร้อมอ็อบเจกต์ที่ต้องใช้ในคราวเดียว",
  "CREATE NEW": "สร้างใหม่",
  "EDIT EXISTING": "แก้ไขของเดิม",
  "NEW": "ใหม่",
  "Create Policy Success": "สร้างนโยบายสำเร็จ",
  "Update Policy Success": "อัปเดตนโยบายสำเร็จ",
  "· current": "· ปัจจุบัน",
  "delete failed": "ลบไม่สำเร็จ",
  "Fallback failed": "การย้อนคืนไม่สำเร็จ",
  "Job failed": "งานล้มเหลว",
  "Query failed": "การสอบถามล้มเหลว",
  "Query Result": "ผลการสอบถาม",
  "Deploy Result": "ผลการปรับใช้",
  "Rolling back…": "กำลังย้อนคืน…",
  "dialup client": "ไคลเอ็นต์แบบ dialup",
  "dynamic peer": "ปลายทางแบบไดนามิก",
  "remote peer": "ปลายทางระยะไกล",
  "Remote": "ปลายทาง",
  "DNAT + Port Forward": "DNAT + ส่งต่อพอร์ต",
  "DNAT (Virtual IP)": "DNAT (เวอร์ชวล IP)",
  "Drag to choose where this policy sits in the rule base": "ลากเพื่อเลือกตำแหน่งของนโยบายนี้ในชุดกฎ",
  "Position is locked relative to the sibling policies already created": "ตำแหน่งถูกล็อกไว้สัมพันธ์กับนโยบายพี่น้องที่สร้างไว้แล้ว",
  "— locked, placed automatically relative to the siblings already created": "— ล็อกไว้ ระบบจัดตำแหน่งให้อัตโนมัติสัมพันธ์กับรายการพี่น้องที่สร้างไว้แล้ว",
  "— moved on Apply.": "— จะถูกย้ายเมื่อปรับใช้",
  "Placement: bottom of this interface pair — if a broader policy sits above it, this one never matches": "ตำแหน่ง: ล่างสุดของคู่อินเทอร์เฟซนี้ — ถ้ามีนโยบายที่กว้างกว่าอยู่เหนือขึ้นไป กฎนี้จะไม่ถูกใช้เลย",
  "Every day": "ทุกวัน",
  "Mon": "จ.",
  "Tue": "อ.",
  "Wed": "พ.",
  "Thu": "พฤ.",
  "Fri": "ศ.",
  "Sat": "ส.",
  "Sun": "อา.",
  "external FQDN address": "แอดเดรส FQDN ภายนอก",
  "external IP": "IP ภายนอก",
  "Green = ready (opens read-only). The rest are auto-created when you Apply the policy.": "สีเขียว = พร้อมแล้ว (เปิดแบบอ่านอย่างเดียว) ที่เหลือจะถูกสร้างให้อัตโนมัติเมื่อคุณปรับใช้นโยบาย",
  "The entries above the policy are objects the device does not have yet; they are created first, in this order": "รายการที่อยู่เหนือนโยบายคืออ็อบเจกต์ที่อุปกรณ์ยังไม่มี ระบบจะสร้างก่อนตามลำดับนี้",
  "Group": "กลุ่ม",
  "Hub": "ฮับ",
  "Spoke": "สโปก",
  "spoke sites": "ไซต์สโปก",
  "Hub-and-Spoke (ADVPN)": "Hub-and-Spoke (ADVPN)",
  "Hub-and-Spoke VPN": "VPN แบบ Hub-and-Spoke",
  "Hub-Spoke": "Hub-Spoke",
  "Site-to-Site": "ระหว่างไซต์",
  "Site-to-Site VPN": "VPN ระหว่างไซต์",
  "S2S": "S2S (ระหว่างไซต์)",
  "Remote Access (dialup)": "การเข้าถึงระยะไกล (dialup)",
  "Remote Access VPN": "VPN สำหรับเข้าถึงระยะไกล",
  "Interface Members": "สมาชิกอินเทอร์เฟซ",
  "Internet Service": "บริการอินเทอร์เน็ต",
  "IPS Sensor": "เซนเซอร์ IPS",
  "No FortiGate has been added yet — add one on the Devices page first": "ยังไม่ได้เพิ่ม FortiGate — เพิ่มที่หน้าอุปกรณ์ก่อน",
  "Pick a FortiGate from the selector in the top bar to start": "เลือก FortiGate จากตัวเลือกบนแถบด้านบนเพื่อเริ่ม",
  "No gateway": "ไม่มีเกตเวย์",
  "No gateway = a connected route straight out of the interface": "ไม่มีเกตเวย์ = เส้นทางแบบ connected ที่ออกทางอินเทอร์เฟซโดยตรง",
  "No protocol is being scanned": "ยังไม่ได้สแกนโปรโตคอลใดเลย",
  "Protocols scanned": "โปรโตคอลที่สแกน",
  "Nothing left to build — every object was removed from the draft": "ไม่เหลืออะไรให้สร้าง — อ็อบเจกต์ทุกตัวถูกเอาออกจากแบบร่างแล้ว",
  "Partly applied — create the remaining policies from the Policy Wizard so objects are not duplicated": "ปรับใช้ไปบางส่วน — สร้างนโยบายที่เหลือจากตัวช่วยสร้างนโยบายเพื่อไม่ให้อ็อบเจกต์ซ้ำ",
  "This policy is already applied — every object below is on the device (review only).": "นโยบายนี้ปรับใช้ไปแล้ว — อ็อบเจกต์ทุกตัวด้านล่างอยู่บนอุปกรณ์แล้ว (ดูอย่างเดียว)",
  "partly overlaps": "ทับซ้อนกันบางส่วน",
  "traffic partly overlaps (same action)": "ทราฟฟิกทับซ้อนกันบางส่วน (แอ็กชันเดียวกัน)",
  "shadowed by the new policy": "ถูกบังโดยนโยบายใหม่",
  "shadows the new policy": "บังนโยบายใหม่",
  "(read-only)": "(อ่านอย่างเดียว)",
  "Review & Apply": "ตรวจสอบและปรับใช้",
  "(this policy)": "(นโยบายนี้)",
  "(unnamed)": "(ไม่มีชื่อ)",
  "(unnamed policy)": "(นโยบายไม่มีชื่อ)",
  "(unnamed rule)": "(กฎไม่มีชื่อ)",
  "(unnamed SLA)": "(SLA ไม่มีชื่อ)",
  "(unnamed zone)": "(โซนไม่มีชื่อ)",
  "Unrestricted source — anything arriving on this interface": "ต้นทางไม่จำกัด — อะไรก็ตามที่เข้ามาทางอินเทอร์เฟซนี้",
  "Where the traffic comes from": "ทราฟฟิกมาจากที่ใด",
  "Where the traffic is going": "ทราฟฟิกกำลังไปที่ใด",
  "[... output truncated]": "[... ตัดผลลัพธ์บางส่วนออก]",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Add an address object for 10.20.30.0/24": "เพิ่มแอดเดรสอ็อบเจกต์สำหรับ 10.20.30.0/24",
  "Add LDAP server 192.168.1.10 pointing at Active Directory": "เพิ่มเซิร์ฟเวอร์ LDAP 192.168.1.10 ที่ชี้ไปยัง Active Directory",
  "Add RADIUS server 192.168.1.20": "เพิ่มเซิร์ฟเวอร์ RADIUS 192.168.1.20",
  "A route only changes the path — a policy still has to allow the traffic for it to get through": "เส้นทางเปลี่ยนแค่ทางเดิน — ยังต้องมีนโยบายอนุญาตทราฟฟิกด้วยจึงจะผ่านได้",
  "Block .exe files downloaded from the internet": "บล็อกไฟล์ .exe ที่ดาวน์โหลดจากอินเทอร์เน็ต",
  "Block Facebook with a Web Filter": "บล็อก Facebook ด้วยตัวกรองเว็บ",
  "Block TikTok and Instagram with Application Control": "บล็อก TikTok และ Instagram ด้วยการควบคุมแอปพลิเคชัน",
  "Block YouTube with a DNS Filter": "บล็อก YouTube ด้วยตัวกรอง DNS",
  "Create a custom service on TCP 9000": "สร้างเซอร์วิสแบบกำหนดเองบน TCP 9000",
  "Create an office-hours schedule, Mon-Fri 08:00-17:00": "สร้างตารางเวลาทำการ จันทร์-ศุกร์ 08:00-17:00",
  "Create a static route for 172.16.0.0/16 via 192.168.1.1": "สร้างเส้นทางสแตติกสำหรับ 172.16.0.0/16 ผ่าน 192.168.1.1",
  "Create a user group for staff": "สร้างกลุ่มผู้ใช้สำหรับพนักงาน",
  "Create user somchai and put them in the Staff group": "สร้างผู้ใช้ somchai แล้วใส่ไว้ในกลุ่ม Staff",
  "Port forward WAN 8080 → 192.168.1.50:80": "ส่งต่อพอร์ต WAN 8080 → 192.168.1.50:80",
  "Set up an IPsec site-to-site tunnel to 203.0.113.50": "ตั้งค่าอุโมงค์ IPsec ระหว่างไซต์ไปยัง 203.0.113.50",
  "Set up a VPN for staff working from home (FortiClient)": "ตั้งค่า VPN สำหรับพนักงานที่ทำงานจากบ้าน (FortiClient)",
  "Set up SD-WAN over wan1 (gateway 203.0.113.254) and wan2 (gateway 203.0.114.254), with a ping health check to 1.1.1.1 and a rule that sends all internet traffic out whichever link is meeting the SLA": "ตั้งค่า SD-WAN บน wan1 (เกตเวย์ 203.0.113.254) และ wan2 (เกตเวย์ 203.0.114.254) พร้อมตรวจสุขภาพลิงก์ด้วย ping ไปยัง 1.1.1.1 และกฎที่ส่งทราฟฟิกอินเทอร์เน็ตทั้งหมดออกทางลิงก์ที่ผ่าน SLA",
  "ips sensor": "เซนเซอร์ IPS",
  "Requires FortiGuard Category Based Filter to be enabled.": "ต้องเปิดใช้ FortiGuard Category Based Filter ก่อน",
  "The microphone only works over HTTPS, and this page was opened over HTTP. Open it via https:// (see README.md), or on localhost on the server itself.": "ไมโครโฟนใช้งานได้เฉพาะบน HTTPS แต่หน้านี้เปิดผ่าน HTTP เปิดใหม่ด้วย https:// (ดู README.md) หรือเปิดบน localhost บนเครื่องเซิร์ฟเวอร์เอง",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "Add at least one member": "เพิ่มสมาชิกอย่างน้อยหนึ่งราย",
  "No config block was found in this output": "ไม่พบบล็อกคอนฟิกในผลลัพธ์นี้",
  "Select at least one day": "เลือกอย่างน้อยหนึ่งวัน",
  "Start and end date are required": "ต้องระบุวันเริ่มต้นและวันสิ้นสุด",
  "This config contains delete / unset / purge, so Apply sends it over the SSH pipeline (which shows a whole-device diff when it finishes). A dry run cannot preview it object by object.": "คอนฟิกนี้มี delete / unset / purge อยู่ การปรับใช้จึงส่งผ่านช่องทาง SSH (ซึ่งจะแสดงส่วนต่างของทั้งเครื่องเมื่อเสร็จ) การทดลองรันจึงดูตัวอย่างทีละอ็อบเจกต์ไม่ได้",

  // -- Simulate: walking a proposal down the device's own rule table -------------
  "Simulate": "จำลอง",
  "Walk a packet down the rule table and see which policies this one kills": "ส่งแพ็กเก็ตไล่ลงไปตามตารางกฎ แล้วดูว่านโยบายนี้ทำให้นโยบายใดหยุดทำงาน",
  "Simulate — what this does to the rule base": "จำลอง — สิ่งที่การเปลี่ยนแปลงนี้ทำกับชุดกฎ",
  "· walked against the device's own policy table": "· ไล่ตามตารางนโยบายของอุปกรณ์จริง",
  "Open this run on its own page, walked down the whole rule table": "เปิดการรันนี้ในหน้าของตัวเอง ไล่ลงไปตลอดทั้งตารางกฎ",
  "This answer proposes no firewall policy, so there is no traffic to walk": "คำตอบนี้ไม่ได้เสนอนโยบายไฟร์วอลล์ จึงไม่มีทราฟฟิกให้ไล่",
  "Objects, profiles and routes change nothing on their own — they take effect when a policy references them.":
    "อ็อบเจกต์ โปรไฟล์ และ route ไม่เปลี่ยนอะไรด้วยตัวเอง — จะมีผลเมื่อมีนโยบายอ้างอิงถึง",
  "Resolving object names…": "กำลังแปลงชื่ออ็อบเจกต์…",
  "This is the journey.": "นี่คือเส้นทางของแพ็กเก็ต",
  "Open full view": "เปิดมุมมองเต็ม",
  "walks the same run down the device's rule table, one policy at a time — that is where you see which rules the change takes out.":
    "จะไล่การรันเดียวกันลงไปตามตารางกฎของอุปกรณ์ทีละนโยบาย — ตรงนั้นจะเห็นว่าการเปลี่ยนแปลงทำให้กฎใดหยุดทำงาน",
  "nothing to simulate": "ไม่มีอะไรให้จำลอง",
  "Now": "ตอนนี้",
  "After Apply": "หลังปรับใช้",
  "Placed above it": "วางไว้เหนือกฎนั้น",
  "no run loaded": "ยังไม่ได้โหลดการรัน",
  "Sample flows": "โฟลว์ตัวอย่าง",
  "One packet per address the source stands for, sent at": "หนึ่งแพ็กเก็ตต่อหนึ่งแอดเดรสที่ต้นทางครอบคลุม ส่งเข้าที่",
  "the proposed policy": "นโยบายที่เสนอ",
  "There is no simulation loaded": "ยังไม่มีการจำลองที่โหลดไว้",
  "A run is handed to this page from the conversation it belongs to, and a reload does not carry it — the proposal, the device's rule table and the placement it would use all live in the chat. Open the answer again and press":
    "การรันจะถูกส่งมายังหน้านี้จากบทสนทนาที่มันเป็นเจ้าของ และการรีโหลดจะไม่พามันมาด้วย — ข้อเสนอ ตารางกฎของอุปกรณ์ และตำแหน่งที่จะวาง อยู่ในแชตทั้งหมด เปิดคำตอบอีกครั้งแล้วกด",
  "Back to AI Assistant": "กลับไปที่ AI Assistant",
  "Walk": "ไล่เส้นทาง",
  "Inspected by": "ตรวจสอบโดย",
  "— on the rule that claims the traffic": "— บนกฎที่รับทราฟฟิกนี้",
  "The flows below belong to other rules on this interface pair. Nothing here shows what “":
    "โฟลว์ด้านล่างเป็นของกฎอื่นบนคู่อินเทอร์เฟซนี้ ไม่มีส่วนใดแสดงว่า “",
  "” itself would carry — that object is not an address range.": "” จะรับทราฟฟิกอะไร — ออบเจกต์นั้นไม่ใช่ช่วงแอดเดรส",
  "No packet could be built for this policy": "สร้างแพ็กเก็ตสำหรับนโยบายนี้ไม่ได้",
  "Its source resolves to": "ต้นทางของนโยบายนี้แปลงได้เป็น",
  "nothing this console can read": "สิ่งที่คอนโซลนี้อ่านไม่ได้",
  ", which has no address range to send from. The rule states in the other tabs are still computed wherever the comparison was decidable.":
    "ซึ่งไม่มีช่วงแอดเดรสให้ส่งแพ็กเก็ตออกไป สถานะของกฎในแท็บอื่นยังคำนวณให้ในทุกจุดที่เปรียบเทียบได้",
  "Every policy on": "ทุกนโยบายบน",
  "whose behaviour the change alters. FortiOS stops at the first match, so a rule fully covered by one above it never runs again.":
    "ที่พฤติกรรมเปลี่ยนไปเพราะการแก้ไขนี้ FortiOS หยุดที่กฎแรกที่ตรง กฎที่ถูกกฎด้านบนครอบไว้ทั้งหมดจึงไม่มีวันถูกใช้อีก",
  "no traffic changes until a policy references them": "ทราฟฟิกจะไม่เปลี่ยนจนกว่าจะมีนโยบายอ้างอิงถึง",
  "never runs": "ไม่มีวันถูกใช้",
  "Nothing else on this interface pair changes — every other rule still matches traffic of its own.":
    "ไม่มีอะไรอื่นบนคู่อินเทอร์เฟซนี้เปลี่ยน — กฎอื่นทุกตัวยังตรงกับทราฟฟิกของตัวเอง",
  "Nothing changes in this run.": "ไม่มีอะไรเปลี่ยนในการรันนี้",
  "SOURCE": "ต้นทาง",
  "INTERNET": "อินเทอร์เน็ต",
  "first match wins": "กฎแรกที่ตรงเป็นผู้ตัดสิน",
  "rules passed over": "กฎที่ถูกข้ามไป",
  "→ forwarded": "→ ส่งต่อ",
  "✕ dropped": "✕ ถูกทิ้ง",
  "? unresolved": "? แปลงไม่ได้",

  // -- Simulate: the verdict and its numbers (packetSim.ts) ----------------------
  "The rule base as it stands, before anything is applied": "ชุดกฎตามสภาพปัจจุบัน ก่อนปรับใช้อะไร",
  "the internet": "อินเทอร์เน็ต",
  "their destination": "ปลายทางของโฟลว์",
  "flows getting through": "โฟลว์ที่ผ่านได้",
  "of them inspected": "ในนั้นถูกตรวจสอบ",
  "every source": "ทุกต้นทาง",
  "addresses in scope": "แอดเดรสในขอบเขต",
  "its source": "ต้นทางของนโยบาย",
  "This policy's own traffic could not be simulated": "จำลองทราฟฟิกของนโยบายนี้เองไม่ได้",
  "rule becomes dead": "กฎที่ใช้ไม่ได้อีก",
  "rules become dead": "กฎที่ใช้ไม่ได้อีก",
  "source objects unresolved": "อ็อบเจกต์ต้นทางที่แปลงไม่ได้",
  "flows for this rule": "โฟลว์ของกฎนี้",
  "Nothing changes — the new rule is unreachable where Apply would put it": "ไม่มีอะไรเปลี่ยน — กฎใหม่ไม่มีวันถูกใช้ในตำแหน่งที่การปรับใช้จะวาง",
  "flows affected": "โฟลว์ที่ได้รับผลกระทบ",
  "rule that still wins": "กฎที่ยังเป็นผู้ตัดสิน",
  "No existing rule is affected": "ไม่มีกฎเดิมตัวใดได้รับผลกระทบ",
  "The new rule is wider than the rule below it, so that rule becomes unreachable. Nothing is deleted and the device gives no warning — it simply never matches again.":
    "กฎใหม่กว้างกว่ากฎที่อยู่ด้านล่าง กฎนั้นจึงไม่มีวันถูกใช้อีก ไม่มีอะไรถูกลบและอุปกรณ์ไม่แจ้งเตือน — กฎนั้นจะไม่ตรงกับทราฟฟิกใดอีกเลย",
  "The new rule is wider than the rules below it, so they become unreachable. Nothing is deleted and the device gives no warning — they simply never match again.":
    "กฎใหม่กว้างกว่ากฎที่อยู่ด้านล่าง กฎเหล่านั้นจึงไม่มีวันถูกใช้อีก ไม่มีอะไรถูกลบและอุปกรณ์ไม่แจ้งเตือน — กฎเหล่านั้นจะไม่ตรงกับทราฟฟิกใดอีกเลย",
  "Nothing below it becomes unreachable, but the traffic they share now stops one row higher. Each of those rules still matches what the new one does not claim.":
    "ไม่มีกฎด้านล่างตัวใดที่ใช้ไม่ได้ แต่ทราฟฟิกที่ใช้ร่วมกันจะหยุดเร็วขึ้นหนึ่งแถว กฎเหล่านั้นแต่ละตัวยังตรงกับทราฟฟิกที่กฎใหม่ไม่ได้รับไป",
  "Every other rule on this interface pair still matches traffic the new one does not claim.":
    "กฎอื่นทุกตัวบนคู่อินเทอร์เฟซนี้ยังตรงกับทราฟฟิกที่กฎใหม่ไม่ได้รับไป",
  "rule narrowed": "กฎที่ถูกลดขอบเขต",
  "rules narrowed": "กฎที่ถูกลดขอบเขต",
  "sample flows dropped": "โฟลว์ตัวอย่างที่ถูกทิ้ง",
  "A service the new rule does not cover — shown so its limit is visible": "บริการที่กฎใหม่ไม่ครอบคลุม — แสดงไว้เพื่อให้เห็นขอบเขตของกฎ",
  "Another service the new rule allows": "อีกบริการหนึ่งที่กฎใหม่อนุญาต",
  "Another service the new rule blocks": "อีกบริการหนึ่งที่กฎใหม่บล็อก",
  "The change you asked for does not happen": "การเปลี่ยนแปลงที่คุณขอไม่เกิดขึ้นจริง",
  "No traffic is affected and no rule changes. Applying this and walking away leaves the firewall exactly as it was — move the rule above the one that shadows it first.":
    "ไม่มีทราฟฟิกใดได้รับผลและไม่มีกฎใดเปลี่ยน ถ้าปรับใช้แล้วปล่อยไว้ ไฟร์วอลล์จะเหมือนเดิมทุกอย่าง — ย้ายกฎขึ้นไปไว้เหนือกฎที่บังมันก่อน",
  "No security profile is attached, so it passes without being scanned.": "ไม่ได้ผูก security profile ไว้ ทราฟฟิกจึงผ่านไปโดยไม่ถูกสแกน",
  "Part of this proposal could not be evaluated": "มีบางส่วนของข้อเสนอนี้ที่ประเมินไม่ได้",
  "No other rule is shadowed": "ไม่มีกฎอื่นถูกบัง",
  "Nothing else on this interface pair is covered by the new rule, so every existing policy still matches exactly the traffic it did before.":
    "ไม่มีส่วนอื่นบนคู่อินเทอร์เฟซนี้ถูกกฎใหม่ครอบ นโยบายเดิมทุกตัวจึงยังตรงกับทราฟฟิกเดิมทุกประการ",
  "Policy lookup": "การค้นหานโยบาย",
  "Tested top to bottom — the first rule that matches decides, and nothing below it is consulted.":
    "ทดสอบจากบนลงล่าง — กฎแรกที่ตรงเป็นผู้ตัดสิน และจะไม่ดูกฎที่อยู่ด้านล่างอีก",
  "Verdicts": "ผลการตัดสิน",
  "flow address": "แอดเดรสของโฟลว์",
  "different interface pair": "คู่อินเทอร์เฟซอื่น",
  "new policy": "นโยบายใหม่",

  // -- The AI Chat Clear control -------------------------------------------------
  "Clear this conversation?": "ล้างบทสนทนานี้ใช่ไหม",
  "Clear anyway": "ล้างต่อไป",
  "Empty this conversation": "ล้างบทสนทนานี้",
  "Nothing to clear yet": "ยังไม่มีอะไรให้ล้าง",
  "Stop the answer and empty this conversation": "หยุดคำตอบแล้วล้างบทสนทนานี้",
  "Clearing leaves the one object this conversation put on the firewall exactly where it is, and removes the Fallback button that would have taken it back off — you would have to delete it by hand.": "การล้างจะไม่แตะอ็อบเจกต์หนึ่งรายการที่บทสนทนานี้สร้างไว้บนไฟร์วอลล์ แต่จะทำให้ปุ่ม Fallback ที่ใช้ถอนมันออกหายไปด้วย — คุณจะต้องไปลบเองด้วยมือ",

  // The AI Assistant shell and its image attachments.
  "AI assistant": "ผู้ช่วย AI",
  "Attach an image (or paste a screenshot)": "แนบรูปภาพ (หรือวางภาพหน้าจอ)",
  "Close this panel and ask again.": "ปิดแผงนี้แล้วถามใหม่อีกครั้ง",
  "Could not attach that image": "แนบรูปภาพนั้นไม่ได้",
  "IPsec Tunnel": "อุโมงค์ IPsec",
  "This proposal is no longer available.": "ข้อเสนอนี้ใช้ไม่ได้แล้ว",
  "the AI wizard": "ตัวช่วยสร้างด้วย AI",

  // Impact fields + Stop generating (Phase 3)
  "Subnets":
    "ซับเน็ต",
  "Affected":
    "ผลกระทบต่อ",
  "Placement":
    "ตำแหน่งในตาราง",
  "Stop writing this answer — the conversation is kept":
    "หยุดเขียนคำตอบนี้ — บทสนทนายังอยู่",
  "Stop generating":
    "หยุดสร้างคำตอบ",
  "Stopped. The conversation is kept — ask again or rephrase.":
    "หยุดแล้ว บทสนทนายังอยู่ — ถามใหม่หรือปรับคำถามได้เลย",
};
