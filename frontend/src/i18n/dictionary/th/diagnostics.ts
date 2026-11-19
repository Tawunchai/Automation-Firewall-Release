/**
 * Thai — Session Monitor, the policy trace, Ping, Trace Route and the network-status panel.
 *
 * The policy-trace half of this page argues about why one rule matched and the others did not, and
 * the Thai keeps that argument's shape: กฎแรกที่ตรงเป็นผู้ชนะ for first-match-wins, and
 * "ไม่ได้ถูกประเมิน" for the rules the walk never reached — which is the whole point of the page,
 * and the one sentence that must not read as "those rules failed".
 */
import type { Dict } from "../merge";

export const diagnostics: Dict = {
  // -- Framing ---------------------------------------------------------------
  "The sessions really flowing through this FortiGate, and which policy a packet would match":
    "เซสชันที่วิ่งผ่าน FortiGate เครื่องนี้จริง ๆ และแพ็กเก็ตจะตรงกับนโยบายข้อใด",
  "What is actually flowing through right now": "สิ่งที่กำลังวิ่งผ่านอยู่จริงในตอนนี้",
  "What the config alone cannot decide": "สิ่งที่ดูจากคอนฟิกอย่างเดียวแล้วตัดสินไม่ได้",
  "Reads from the device only — it writes no config and uses no AI":
    "อ่านจากอุปกรณ์อย่างเดียว — ไม่เขียนคอนฟิกและไม่ใช้ AI",
  "This runs on the real FortiGate, so it can take a moment":
    "คำสั่งนี้รันบน FortiGate ตัวจริง จึงอาจใช้เวลาสักครู่",
  "The servers the device talks to, and how good the connection is":
    "เซิร์ฟเวอร์ที่อุปกรณ์ติดต่อด้วย และคุณภาพของการเชื่อมต่อ",
  "DNS · FortiGuard · the route to the internet · link state — read live from the device":
    "DNS · FortiGuard · เส้นทางออกอินเทอร์เน็ต · สถานะลิงก์ — อ่านสด ๆ จากอุปกรณ์",
  "Could not read this section —": "อ่านส่วนนี้ไม่ได้ —",
  "on the device…": "บนอุปกรณ์…",
  "The command failed": "คำสั่งล้มเหลว",

  // -- Policy trace ----------------------------------------------------------
  "Policy trace": "การไล่ตามนโยบาย",
  "Trace the path": "ไล่ตามเส้นทาง",
  "Fill in the 5-tuple and press “Trace the path”": "กรอก 5-tuple แล้วกด “ไล่ตามเส้นทาง”",
  "Enter a source and a destination IP": "กรอก IP ต้นทางและปลายทาง",
  "It answers which policy the packet matches, and why the others were passed over":
    "ระบบจะตอบว่าแพ็กเก็ตตรงกับนโยบายข้อใด และทำไมข้ออื่นจึงถูกข้ามไป",
  "Which policy this packet would match, and why the others would not":
    "แพ็กเก็ตนี้จะตรงกับนโยบายข้อใด และทำไมข้ออื่นจึงไม่ตรง",
  "Policy evaluation order (top to bottom · first match wins)":
    "ลำดับการประเมินนโยบาย (บนลงล่าง · กฎแรกที่ตรงเป็นผู้ชนะ)",
  "policies below were never evaluated — one above them matched first. (This is why a rule that “ought to apply” so often does not.)":
    "นโยบายด้านล่างไม่เคยถูกประเมินเลย — เพราะมีข้อที่อยู่เหนือกว่าตรงก่อนแล้ว (นี่คือเหตุผลว่าทำไมกฎที่ “น่าจะมีผล” จึงมักไม่มีผล)",
  "The whole table was walked and nothing matched — FortiGate drops the packet at the implicit deny":
    "ไล่ดูทั้งตารางแล้วไม่มีข้อใดตรงเลย — FortiGate จะทิ้งแพ็กเก็ตที่กฎปฏิเสธโดยปริยาย",
  "No policy matches": "ไม่มีนโยบายข้อใดตรง",
  MATCH: "ตรงกัน",
  "Skipped —": "ข้าม —",
  "This policy lets traffic through with": "นโยบายนี้ปล่อยทราฟฟิกผ่านโดยมี",
  "no security profile inspecting it": "ไม่มีโปรไฟล์ความปลอดภัยตรวจสอบเลย",
  "Inspected by:": "ตรวจสอบโดย:",
  "Traffic that has passed through this policy": "ทราฟฟิกที่ผ่านนโยบายนี้ไปแล้ว",

  // -- Session table ---------------------------------------------------------
  "Live sessions": "เซสชันสด",
  "active sessions": "เซสชันที่ใช้งานอยู่",
  "Total sessions": "เซสชันทั้งหมด",
  Session: "เซสชัน",
  "Source → Destination": "ต้นทาง → ปลายทาง",
  "Source IP": "IP ต้นทาง",
  "Source IP (optional)": "IP ต้นทาง (ไม่บังคับ)",
  "Destination IP": "IP ปลายทาง",
  "Destination port": "พอร์ตปลายทาง",
  "Destination Port": "พอร์ตปลายทาง",
  "Incoming Interface": "อินเทอร์เฟซขาเข้า",
  Egress: "ขาออก",
  Proto: "โปรโต",
  State: "สถานะ",
  Age: "อายุ",
  "source NAT": "NAT ต้นทาง",
  "NPU offload": "NPU offload",
  "Sessions offloaded to hardware": "เซสชันที่ถูกโอนไปประมวลผลที่ฮาร์ดแวร์",
  "RX / TX": "รับ / ส่ง",
  "TX / RX": "ส่ง / รับ",
  "in:": "เข้า:",
  "out:": "ออก:",
  Allowed: "อนุญาต",
  "Blocked by a policy": "ถูกบล็อกโดยนโยบาย",
  "A session the device created itself (local) — no policy involved":
    "เซสชันที่อุปกรณ์สร้างขึ้นเอง (ภายในเครื่อง) — ไม่เกี่ยวกับนโยบายใด",
  Filters: "ตัวกรอง",
  "Filter:": "ตัวกรอง:",
  Shown: "แสดงอยู่",
  View: "ดู",
  "Leave everything blank to see every session · filtering happens on the device, not in the browser":
    "เว้นว่างทั้งหมดเพื่อดูทุกเซสชัน · การกรองทำที่อุปกรณ์ ไม่ใช่ในเบราว์เซอร์",
  "The device has more sessions than are shown — this list was truncated, so narrow it with the filters":
    "อุปกรณ์มีเซสชันมากกว่าที่แสดงอยู่ — รายการนี้ถูกตัดให้สั้นลง ให้ใช้ตัวกรองเพื่อจำกัดให้แคบลง",

  // -- Ping and traceroute ---------------------------------------------------
  "Host or IP": "โฮสต์หรือ IP",
  "8.8.8.8 or www.google.com": "8.8.8.8 หรือ www.google.com",
  "A domain name works too — the resolved IP is shown as well":
    "ใช้ชื่อโดเมนก็ได้ — ระบบจะแสดง IP ที่แปลงได้ให้ด้วย",
  "(the device resolved this name)": "(อุปกรณ์แปลงชื่อนี้ได้)",
  "ICMP sent from the FortiGate itself, live — not from this web server":
    "ICMP ถูกส่งจากตัว FortiGate เองแบบสด ๆ — ไม่ได้ส่งจากเว็บเซิร์ฟเวอร์นี้",
  "The path this FortiGate takes to a destination — hops appear one by one, live":
    "เส้นทางที่ FortiGate เครื่องนี้ใช้ไปยังปลายทาง — แต่ละ hop จะปรากฏทีละอันแบบสด ๆ",
  "A traceroute takes a while (up to 32 hops × 3 probes) — hops appear as the device finds them":
    "การทำ traceroute ใช้เวลาสักพัก (มากถึง 32 hop × 3 ครั้ง) — แต่ละ hop จะปรากฏเมื่ออุปกรณ์หาเจอ",
  "Looking for the next hop…": "กำลังหา hop ถัดไป…",
  "No hops came back — see the raw output below": "ไม่มี hop ตอบกลับมาเลย — ดูผลลัพธ์ดิบด้านล่าง",
  "No reply (* * *)": "ไม่มีการตอบกลับ (* * *)",
  "The device finished, but": "อุปกรณ์ทำงานเสร็จแล้ว แต่",
  "not one packet came back": "ไม่มีแพ็กเก็ตตอบกลับมาแม้แต่แพ็กเก็ตเดียว",
  "— the destination may not answer ICMP, a policy may be blocking it, or there is no route to it":
    "— ปลายทางอาจไม่ตอบ ICMP อาจมีนโยบายบล็อกอยู่ หรืออาจไม่มีเส้นทางไปถึง",
  "Automatic (from the routing table)": "อัตโนมัติ (จากตารางเราต์)",
  "Leave blank and the device chooses": "เว้นว่างไว้แล้วให้อุปกรณ์เลือกเอง",
  Packets: "แพ็กเก็ต",
  "Packet loss": "การสูญหายของแพ็กเก็ต",
  Loss: "สูญหาย",
  "Sent / received": "ส่ง / รับ",
  "Size (bytes)": "ขนาด (ไบต์)",
  "Min / max": "ต่ำสุด / สูงสุด",
  Average: "เฉลี่ย",
  Errors: "ข้อผิดพลาด",
  "timeout ×": "หมดเวลา ×",
  "(not used for ICMP)": "(ไม่ใช้กับ ICMP)",
  "e.g. 10.0.99.201": "เช่น 10.0.99.201",
  "e.g. 192.168.1.50": "เช่น 192.168.1.50",
  "e.g. 8.8.8.8": "เช่น 8.8.8.8",
  "e.g. 443": "เช่น 443",

  // -- Network status --------------------------------------------------------
  Link: "ลิงก์",
  Speed: "ความเร็ว",
  Configured: "ตั้งค่าไว้แล้ว",
  DISABLED: "ปิดใช้งาน",
  "Receiving live": "กำลังรับข้อมูลสด",
  "FortiGuard DNS filter": "ตัวกรอง DNS ของ FortiGuard",
  "Route to the internet": "เส้นทางออกอินเทอร์เน็ต",
  "Route used": "เส้นทางที่ใช้",
  "Has a route out": "มีเส้นทางออก",
  "No route": "ไม่มีเส้นทาง",
  "(route": "(เส้นทาง",
  "→ gw": "→ เกตเวย์",
  "The device found no route to the internet": "อุปกรณ์ไม่พบเส้นทางออกอินเทอร์เน็ต",
  "Latency measured by the device": "ความหน่วงที่อุปกรณ์วัดได้",
  "Not measured": "ยังไม่ได้วัด",
  "The device has never measured this successfully": "อุปกรณ์ยังไม่เคยวัดค่านี้ได้สำเร็จเลย",
  The: "ค่า",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Chosen by you": "คุณเป็นผู้เลือกเอง",
  "Could not open the connection": "เปิดการเชื่อมต่อไม่สำเร็จ",
  "Could not read the session table": "อ่านตารางเซสชันไม่สำเร็จ",
  "Counting while packets are still going out": "นับขณะที่ยังส่งแพ็กเก็ตออกไปอยู่",
  "No per-packet detail — see the raw output below": "ไม่มีรายละเอียดรายแพ็กเก็ต — ดูผลลัพธ์ดิบด้านล่าง",
  "No session on the device matches this filter": "ไม่มีเซสชันบนอุปกรณ์ที่ตรงกับตัวกรองนี้",
  "Pinging…": "กำลัง Ping…",
  "Reading…": "กำลังอ่าน…",
  "Show sessions": "แสดงเซสชัน",
  "Taken from the device's routing table": "อ่านจากตารางเราต์ของอุปกรณ์",
  "The device has no readable session right now": "ตอนนี้อุปกรณ์ไม่มีเซสชันที่อ่านได้",
  "The trace failed": "การติดตามเส้นทางล้มเหลว",
  "Trace": "ติดตามเส้นทาง",
  "Tracing…": "กำลังติดตามเส้นทาง…",
  "Waiting for the first packet from the device…": "กำลังรอแพ็กเก็ตแรกจากอุปกรณ์…",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Use a different account": "ใช้บัญชีอื่น",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "The device may well be fine — this page says \"unreadable\", not \"broken\"": "อุปกรณ์อาจปกติดีก็ได้ — หน้านี้บอกว่า \"อ่านไม่ได้\" ไม่ใช่ \"เสีย\"",

  // -- Troubleshooting (was Session Monitor) -----------------------------------
  "Add a route to the destination": "เพิ่ม route ไปยังปลายทาง",
  "Address translation": "การแปลงแอดเดรส",
  "Check the security profiles on the policy in the log (a Web Filter or Application Control block shows there), that the destination is listening on that port, and that the far side can route back.": "ตรวจ security profile ของนโยบายในล็อก (ถ้า Web Filter หรือ Application Control บล็อกจะเห็นที่นั่น) ตรวจว่าปลายทางเปิดพอร์ตนั้นอยู่ และฝั่งปลายทางมี route กลับมา",
  "Click a policy to see each criterion, what it lists, and what the packet had.": "คลิกนโยบายเพื่อดูแต่ละเงื่อนไข ค่าที่นโยบายกำหนด และค่าของ packet",
  "closest": "ใกล้เคียงที่สุด",
  "Confirm with the log": "ยืนยันด้วยล็อก",
  "Copied": "คัดลอกแล้ว",
  "Copy the CLI": "คัดลอก CLI",
  "Create a policy": "สร้างนโยบาย",
  "Destination address": "แอดเดรสปลายทาง",
  "Diagnosis, step by step": "การวินิจฉัยทีละขั้น",
  "enable the policy": "เปิดใช้นโยบาย",
  "Every policy checked (top to bottom · first match wins)": "ทุกนโยบายที่ตรวจ (บนลงล่าง · ตัวแรกที่ตรงชนะ)",
  "Fill in a source, a destination and a service, then press “Trace the path”": "กรอกต้นทาง ปลายทาง และบริการ แล้วกด “Trace the path”",
  "Firewall policy": "นโยบายไฟร์วอลล์",
  "from route": "จาก route",
  "How to fix it": "วิธีแก้ไข",
  "If it still does not work": "ถ้ายังใช้งานไม่ได้",
  "In": "ขาเข้า",
  "Incoming interface": "อินเทอร์เฟซขาเข้า",
  "Inspection": "การตรวจสอบ",
  "Interface links": "ลิงก์ของอินเทอร์เฟซ",
  "Intrusion Prevention": "ป้องกันการบุกรุก",
  "link down": "ลิงก์ไม่ขึ้น",
  "link up": "ลิงก์ขึ้น",
  "make its schedule include the current time": "ทำให้ schedule ครอบคลุมเวลาปัจจุบัน",
  "match": "ตรง",
  "never reached": "ไม่เคยถูกตรวจถึง",
  "No NAT": "ไม่มี NAT",
  "no policy matched": "ไม่มีนโยบายที่ตรง",
  "No policy matches — blocked": "ไม่มีนโยบายที่ตรง — ถูกบล็อก",
  "No route to the destination": "ไม่มี route ไปยังปลายทาง",
  "no security profile": "ไม่มี security profile",
  "No security profile inspects this traffic. It is allowed through without antivirus, web filtering or IPS.": "ไม่มี security profile ตรวจทราฟฟิกนี้ ทราฟฟิกผ่านไปได้โดยไม่มี antivirus, web filtering หรือ IPS",
  "not inspected": "ไม่ถูกตรวจ",
  "not reached": "ไปไม่ถึง",
  "not used for ICMP": "ไม่ใช้กับ ICMP",
  "Open Firewall Policy": "เปิด Firewall Policy",
  "Open Static Routes": "เปิด Static Routes",
  "Or add a policy for this traffic": "หรือเพิ่มนโยบายสำหรับทราฟฟิกนี้",
  "Order": "ลำดับ",
  "Out": "ขาออก",
  "Outgoing interface": "อินเทอร์เฟซขาออก",
  "Reads from the device only — writes nothing, uses no AI": "อ่านจากอุปกรณ์อย่างเดียว — ไม่เขียนอะไร ไม่ใช้ AI",
  "Recent:": "ล่าสุด:",
  "Replay": "เล่นซ้ำ",
  "Reverse direction": "ย้อนทิศทาง",
  "Route back to the source": "route กลับไปยังต้นทาง",
  "Route to the destination": "route ไปยังปลายทาง",
  "Routing": "Routing",
  "Rule order": "ลำดับนโยบาย",
  "Run this trace again": "ตรวจเส้นทางนี้อีกครั้ง",
  "Security inspection": "การตรวจด้านความปลอดภัย",
  "security profiles": "security profile",
  "See the real log entries": "ดูรายการล็อกจริง",
  "Service:": "บริการ:",
  "Source NAT": "Source NAT",
  "The firewall allows it — if it still fails, look beyond this policy": "ไฟร์วอลล์อนุญาตแล้ว — ถ้ายังไม่ได้ ให้ดูนอกเหนือจากนโยบายนี้",
  "the incoming interface": "อินเทอร์เฟซขาเข้า",
  "The link state of the interfaces could not be read.": "อ่านสถานะลิงก์ของอินเทอร์เฟซไม่ได้",
  "The packet reaches the destination": "packet ไปถึงปลายทาง",
  "The traffic log shows what the firewall actually did with these connections.": "ล็อกทราฟฟิกบอกว่าไฟร์วอลล์ทำอะไรกับการเชื่อมต่อเหล่านี้จริงๆ",
  "Trace the reply direction: destination back to source": "ตรวจทิศทางขากลับ: จากปลายทางกลับมาต้นทาง",
  "Traffic on this policy": "ทราฟฟิกบนนโยบายนี้",
  "Troubleshooting": "แก้ไขปัญหา",
  "What the configuration alone cannot decide": "สิ่งที่ตัดสินจาก config อย่างเดียวไม่ได้",
  "Why can't A reach B? Trace one connection through the FortiGate: its route, the policy that decides it, NAT, inspection — and how to fix it": "ทำไม A ถึงไปหา B ไม่ได้? ตรวจการเชื่อมต่อหนึ่งรายการผ่าน FortiGate: route, นโยบายที่ตัดสิน, NAT, การตรวจสอบ — และวิธีแก้",
  "You will see the route the packet takes, the policy that decides it and why every policy above it was passed over, what NAT does, whether anything inspects it — and what to change if it is blocked.": "คุณจะเห็น route ที่ packet ใช้ นโยบายที่ตัดสินและเหตุผลที่นโยบายด้านบนทุกตัวไม่ตรง NAT ทำอะไร มีอะไรตรวจทราฟฟิกหรือไม่ — และต้องแก้อะไรถ้าถูกบล็อก",
  "chosen": "เลือกเอง",
  "reached": "ไปถึง",
  "the policy is disabled": "นโยบายถูกปิดอยู่",
  "the policy is enabled": "นโยบายเปิดใช้อยู่",
  "the ingress interface is unknown, so srcintf was not checked": "ไม่ทราบอินเทอร์เฟซขาเข้า จึงไม่ได้ตรวจ srcintf",
  "Worth knowing about this trace": "ข้อควรรู้เกี่ยวกับการตรวจครั้งนี้",

  // The packet-flow diagram's header row — what the packet carries on each wire.
  "Original packet": "packet ต้นฉบับ",
  "After NAT": "หลัง NAT",
  "Leaves unchanged": "ออกไปโดยไม่เปลี่ยน",

  // Fix it — the what-if, apply and undo around a trace's plans.
  "Fix it": "แก้ไขเลย",
  "Preview this fix": "ดูผลการแก้ไขนี้ก่อน",
  "Add a policy for exactly this connection": "เพิ่มนโยบายสำหรับการเชื่อมต่อนี้โดยเฉพาะ",
  "A new policy for exactly this connection": "นโยบายใหม่สำหรับการเชื่อมต่อนี้โดยเฉพาะ",
  "New policy": "นโยบายใหม่",
  "What if": "ถ้าแก้แบบนี้",
  "Simulated — nothing written yet": "จำลอง — ยังไม่ได้เขียนอะไรลงเครื่อง",
  "Close the preview": "ปิดตัวอย่าง",
  "Blocked now": "ตอนนี้ถูกบล็อก",
  "Allowed after the fix": "อนุญาตหลังแก้ไข",
  "Still blocked": "ยังถูกบล็อก",
  "What will be written": "สิ่งที่จะถูกเขียน",
  "What the policy will accept": "สิ่งที่นโยบายจะอนุญาต",
  "Show the CLI": "แสดง CLI",
  "Hide the CLI": "ซ่อน CLI",
  "Only this connection is opened — nothing else.": "เปิดเฉพาะการเชื่อมต่อนี้ — ไม่มีอย่างอื่น",
  "This policy accepts much more than this one connection — every source, destination and service it lists above, not only this trace. Prefer the new-policy fix unless opening all of that is intended.":
    "นโยบายนี้อนุญาตมากกว่าการเชื่อมต่อนี้มาก — ทุกต้นทาง ปลายทาง และบริการที่ระบุไว้ด้านบน ไม่ใช่แค่การตรวจครั้งนี้ ควรเลือกการแก้ไขแบบสร้างนโยบายใหม่ เว้นแต่ตั้งใจจะเปิดทั้งหมดนั้นจริง",
  "Apply to the firewall": "ปรับใช้กับไฟร์วอลล์",
  "Written to the live rule base and recorded in Change history — one click undoes it.":
    "เขียนลงชุดกฎที่ใช้งานจริงและบันทึกในประวัติการเปลี่ยนแปลง — ย้อนกลับได้ในคลิกเดียว",
  "Only an administrator can apply a fix. The CLI above can be handed to one.":
    "เฉพาะผู้ดูแลระบบเท่านั้นที่ปรับใช้การแก้ไขได้ ส่ง CLI ด้านบนให้ผู้ดูแลระบบได้",
  "Apply this fix to the firewall?": "ปรับใช้การแก้ไขนี้กับไฟร์วอลล์?",
  "Fix applied — the trace is now read back from the firewall": "ปรับใช้แล้ว — ผลการตรวจตอนนี้อ่านกลับมาจากไฟร์วอลล์จริง",
  "The fix is on the firewall": "การแก้ไขอยู่บนไฟร์วอลล์แล้ว",
  "The fix stopped part-way": "การแก้ไขหยุดกลางทาง",
  "The trace below was read back from the firewall after the change, not simulated.":
    "ผลการตรวจด้านล่างอ่านกลับมาจากไฟร์วอลล์หลังการเปลี่ยนแปลง ไม่ใช่การจำลอง",
  "A step failed, so nothing after it was written. What landed before it is listed — undo it, or finish by hand.":
    "มีขั้นตอนหนึ่งล้มเหลว จึงไม่มีการเขียนขั้นตอนหลังจากนั้น รายการด้านล่างคือสิ่งที่เขียนไปแล้ว — ย้อนกลับได้ หรือทำต่อด้วยตนเอง",
  "already there, left as it was": "มีอยู่แล้ว คงไว้ตามเดิม",
  "Undo this fix": "ย้อนกลับการแก้ไขนี้",
  "Undo this fix?": "ย้อนกลับการแก้ไขนี้?",
  "Everything it wrote is put back, newest first. The trace runs again afterwards.":
    "ทุกอย่างที่เขียนไปจะถูกคืนค่า เริ่มจากรายการล่าสุด แล้วจะตรวจเส้นทางใหม่อีกครั้ง",
  "Undone — the firewall is back as it was": "ย้อนกลับแล้ว — ไฟร์วอลล์กลับเป็นเหมือนเดิม",
  "Could not simulate this fix": "จำลองการแก้ไขนี้ไม่สำเร็จ",
  "The fix could not be applied": "ปรับใช้การแก้ไขไม่สำเร็จ",
  "The fix could not be undone": "ย้อนกลับการแก้ไขไม่สำเร็จ",

  // A host name as the destination.
  "Destination IP or host name": "IP ปลายทางหรือชื่อโฮสต์",
  "8.8.8.8 or example.com": "8.8.8.8 หรือ example.com",
  "Enter a source IP and a destination": "กรอก IP ต้นทางและปลายทาง",
  "Resolved by this console's DNS. The FortiGate may get a different address — a CDN answers each resolver by location.":
    "แปลงชื่อด้วย DNS ของคอนโซลนี้ FortiGate อาจได้แอดเดรสต่างออกไป — CDN ตอบแต่ละ resolver ตามตำแหน่งที่อยู่",

  // Troubleshooting tabs (Ping merged in) + Trace Route enrichments (verdict / latency / segments).
  "Diagnostics tool": "เครื่องมือวินิจฉัย",
  "Why can't A reach B?": "ทำไม A ถึงไปหา B ไม่ได้?",
  "Networks crossed": "เครือข่ายที่เส้นทางผ่าน",
  "Latency by hop": "ความหน่วงแต่ละ hop",
  "Round-trip latency by hop": "ความหน่วงไป-กลับแต่ละ hop",
  "Segments are grouped by address kind. Install a GeoLite2 database on the server to label the public stretches by their network owner (AS number and organisation) and country.":
    "แบ่งช่วงตามชนิดของแอดเดรส ติดตั้งฐานข้อมูล GeoLite2 บนเซิร์ฟเวอร์เพื่อระบุเจ้าของเครือข่าย (หมายเลข AS และองค์กร) และประเทศของช่วงที่เป็นสาธารณะ",
  // Path-segment zone labels (from traceroute-model zoneLabelForKind).
  "Public internet": "อินเทอร์เน็ตสาธารณะ",
  "Private network": "เครือข่ายส่วนตัว",
  "Carrier-grade NAT": "Carrier-grade NAT",
  "Loopback": "Loopback",
  "Link-local": "Link-local",
  "Multicast": "Multicast",
  "Unspecified": "ไม่ระบุ",
  "No reply": "ไม่ตอบกลับ",

  // Trace Route's hop-detail strip: what kind of address a hop is, and the verdict sentences.
  // RFC 1918 / 100.64.0.0/10 stay as written — they are the citation, not prose.
  "A public hop out on the internet — it matches none of this device's own networks.":
    "ฮอปสาธารณะบนอินเทอร์เน็ต — ไม่ตรงกับเครือข่ายใดของอุปกรณ์นี้เลย",
  "Carrier-grade NAT (100.64.0.0/10)": "Carrier-grade NAT (100.64.0.0/10)",
  "Matches none of this device's interfaces, routes, or the fleet.":
    "ไม่ตรงกับอินเทอร์เฟซ เส้นทาง หรืออุปกรณ์ใดในฟลีตของเครื่องนี้เลย",
  "No hop answered": "ไม่มีฮอปใดตอบกลับ",
  "Not even the first hop replied. The device may have no route toward this destination, or the source address given is not one it owns — try leaving Source IP blank, or use the Ping tab.":
    "แม้แต่ฮอปแรกก็ไม่ตอบ อุปกรณ์อาจไม่มีเส้นทางไปยังปลายทางนี้ หรือ Source IP ที่ระบุไม่ใช่ของเครื่องนี้ — ลองเว้น Source IP ว่างไว้ หรือใช้แท็บ Ping",
  "Ping this hop": "Ping ฮอปนี้",
  "Private (RFC 1918)": "เครือข่ายส่วนตัว (RFC 1918)",
  "Public — routable on the internet": "สาธารณะ — เราต์ได้บนอินเทอร์เน็ต",
  "the destination": "ปลายทาง",
  "The destination is on the path, though it did not time a round trip on this probe.":
    "ปลายทางอยู่บนเส้นทางนี้ เพียงแต่โพรบรอบนี้จับเวลาไป-กลับไม่ได้",
  "Unspecified address": "แอดเดรสที่ไม่ได้ระบุ",
};
