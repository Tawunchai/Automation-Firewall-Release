/**
 * Thai — Log & Report ▸ Local Traffic.
 *
 * THE EMPTY-LOG DIAGNOSIS IS THE POINT OF THE PAGE, so its Thai is written to be read by someone
 * who has just been told "No results" and does not know whether to believe it. ยังไม่ได้บันทึก
 * ("has not been recorded") rather than anything that could be read as "there was no traffic" —
 * that distinction is the whole reason the feature exists, and it must survive translation.
 *
 * The page subtitle is NOT here: it already lives in ./audit.ts, and two areas translating one
 * English string differently is a real defect — the same sentence would read one way or the other
 * depending on which module loaded last.
 */
import type { Dict } from "../merge";

export const logs: Dict = {
  "log entries": "รายการบันทึก",

  // -- Toolbar ---------------------------------------------------------------
  "Refresh the log": "โหลดบันทึกใหม่",
  "Download these entries as CSV": "ดาวน์โหลดรายการเหล่านี้เป็น CSV",
  "Log source": "แหล่งเก็บบันทึก",
  "Which store on the device these entries are read from":
    "รายการเหล่านี้อ่านมาจากที่เก็บใดบนอุปกรณ์",
  "How far back to look": "ย้อนหลังไปไกลแค่ไหน",
  "Search the log": "ค้นหาในบันทึก",
  "Run the search": "ค้นหา",
  "Clear the search": "ล้างคำค้น",
  "Search — an address, a port, a word, or srcip==10.0.0.1":
    "ค้นหา — ที่อยู่ พอร์ต คำ หรือ srcip==10.0.0.1",

  // -- Columns ---------------------------------------------------------------
  "Application Name": "ชื่อแอปพลิเคชัน",
  "Sent / Received": "ส่ง / รับ",
  "Archived packet capture": "แพ็กเก็ตที่เก็บไว้",
  "This entry has an archived packet capture": "รายการนี้มีไฟล์แพ็กเก็ตที่เก็บไว้ด้วย",

  // -- A search the server refused to forward --------------------------------
  "That search was not sent to the firewall": "คำค้นนี้ไม่ถูกส่งไปยังไฟร์วอลล์",
  "That search could not be understood": "ไม่เข้าใจคำค้นนี้",
  "The device would have accepted it and answered “no results”, which would read as a firewall that saw no traffic.":
    "อุปกรณ์จะรับคำค้นนี้แล้วตอบว่า “ไม่พบข้อมูล” ซึ่งจะอ่านเหมือนว่าไฟร์วอลล์ไม่เห็นทราฟฟิกเลย",

  // -- States ----------------------------------------------------------------
  "No entries match this search": "ไม่มีรายการที่ตรงกับคำค้นนี้",
  "Nothing in this log matched.": "ไม่มีรายการใดในบันทึกนี้ตรงกับคำค้น",
  "This log": "บันทึกนี้",
  "The firewall may well be logging normally — this list is unreadable, not empty":
    "ไฟร์วอลล์อาจกำลังบันทึกอยู่ตามปกติ — รายการนี้คือ “อ่านไม่ได้” ไม่ใช่ “ไม่มีข้อมูล”",
  "the device is still searching": "อุปกรณ์กำลังค้นหาอยู่",
  "showing the newest": "แสดงรายการใหม่ที่สุด",
  "Read from": "อ่านจาก",
  "Entries shown": "จำนวนรายการที่แสดง",

  // -- The empty-log diagnosis ----------------------------------------------
  "This firewall is not recording local traffic": "ไฟร์วอลล์เครื่องนี้ยังไม่ได้บันทึกทราฟฟิกถึงตัวเอง",
  "Traffic addressed to the FortiGate itself is only logged when local-in logging is switched on, and it is off by default. Nothing is being written, so there is nothing for any log backend to show.":
    "ทราฟฟิกที่ส่งถึงตัว FortiGate จะถูกบันทึกก็ต่อเมื่อเปิด local-in logging ไว้ ซึ่งค่าเริ่มต้นคือปิด เมื่อไม่มีการเขียนบันทึกเลย ที่เก็บบันทึกใดก็ไม่มีอะไรให้แสดง",
  "The firewall is recording local traffic, but this log backend has the category filtered out, so none of it is kept here. Another backend may still have it — try the log source picker.":
    "ไฟร์วอลล์บันทึกทราฟฟิกถึงตัวเองอยู่ แต่ที่เก็บบันทึกนี้กรองหมวดดังกล่าวทิ้ง จึงไม่มีอะไรถูกเก็บไว้ที่นี่ ที่เก็บอื่นอาจยังมีอยู่ — ลองเปลี่ยนแหล่งเก็บบันทึกดู",
  "Turn it on from the CLI:": "เปิดใช้งานผ่าน CLI:",
  // -- Which traffic log, and the Policy column -----------------------------
  "Forward Traffic":
    "ทราฟฟิกที่วิ่งผ่าน",
  "Addressed to the FortiGate itself":
    "ส่งถึงตัว FortiGate เอง",
  "Passing through, to the internet or another network":
    "วิ่งผ่านไปยังอินเทอร์เน็ตหรือเครือข่ายอื่น",
  "Local is traffic to the FortiGate itself; Forward is traffic passing through it":
    "Local คือทราฟฟิกที่ส่งถึงตัว FortiGate เอง ส่วน Forward คือทราฟฟิกที่วิ่งผ่านมันไป",
  "The log of traffic passing THROUGH this FortiGate, and which rule let it through":
    "บันทึกของทราฟฟิกที่วิ่ง “ผ่าน” FortiGate เครื่องนี้ และกฎข้อใดที่ปล่อยให้ผ่าน",
  "Implicit deny":
    "กฎปฏิเสธโดยปริยาย",
  "Implicit local-in":
    "กฎ local-in โดยปริยาย",
  "no rule matched":
    "ไม่ตรงกับกฎใดเลย",
  "denied by rule":
    "ถูกกฎปฏิเสธ",
  "blocked by profile":
    "ถูกโปรไฟล์บล็อก",
  "rule deleted":
    "กฎถูกลบไปแล้ว",
  "No rule permitted this traffic, so the implicit deny at the bottom of the table stopped it":
    "ไม่มีกฎข้อใดอนุญาตทราฟฟิกนี้ จึงถูกกฎปฏิเสธโดยปริยายที่ท้ายตารางหยุดไว้",
  "This rule denied the traffic":
    "กฎข้อนี้ปฏิเสธทราฟฟิกนี้",
  "The rule permits this traffic — a security profile on it blocked the traffic instead":
    "กฎข้อนี้อนุญาตทราฟฟิกนี้ — สิ่งที่บล็อกคือ security profile ที่ผูกอยู่กับกฎ ไม่ใช่ตัวกฎเอง",
  "This rule is no longer in the policy table — deleted or renumbered since":
    "กฎข้อนี้ไม่อยู่ในตารางนโยบายแล้ว — ถูกลบหรือเปลี่ยนหมายเลขไปหลังจากนั้น",
  "Traffic to the FortiGate itself, handled by the implicit local-in policy":
    "ทราฟฟิกที่ส่งถึงตัว FortiGate เอง จัดการโดยกฎ local-in โดยปริยาย",
  // -- The pager -----------------------------------------------------------
  "Previous page": "หน้าก่อนหน้า",
  "Next page": "หน้าถัดไป",
  "No entries": "ไม่มีรายการ",

  // -- Traffic log: readable results, policies, conversations, charts ----------
  "A firewall policy.": "นโยบายไฟร์วอลล์",
  "A firewall policy whose action is accept.": "นโยบายไฟร์วอลล์ที่มี action เป็น accept (อนุญาต)",
  "A firewall policy whose action is deny.": "นโยบายไฟร์วอลล์ที่มี action เป็น deny (ปฏิเสธ)",
  "All from other devices": "ทั้งหมดมาจากอุปกรณ์อื่น",
  "All results": "ทุกผลลัพธ์",
  "All started by the FortiGate itself": "ทั้งหมดเริ่มโดย FortiGate เอง",
  "Anything to or from one address": "ทุกอย่างที่ไปหรือมาจากแอดเดรสเดียว",
  "A policy matched this traffic and its action is deny. To allow it, change that policy or put an allowing one above it.": "มีนโยบายที่ตรงกับทราฟฟิกนี้และ action เป็น deny ถ้าต้องการอนุญาต ให้แก้นโยบายนั้น หรือวางนโยบายที่อนุญาตไว้เหนือมัน",
  "Arriving on one interface": "เข้ามาทางอินเทอร์เฟซเดียว",
  "A security profile on this policy — the policy itself allows it": "security profile ในนโยบายนี้ — ตัวนโยบายเองอนุญาต",
  "A single = with * is a wildcard match": "= ตัวเดียวคู่กับ * คือการค้นหาแบบ wildcard",
  "Ask the AI to read it": "ให้ AI ช่วยอ่าน",
  "A word, looked for in names, services, apps and interfaces": "คำหนึ่งคำ ค้นในชื่อ บริการ แอป และอินเทอร์เฟซ",
  "Blocked because": "ถูกบล็อกเพราะ",
  "Blocked by a security profile": "ถูกบล็อกโดย security profile",
  "Blocked — no rule matched": "ถูกบล็อก — ไม่มีนโยบายที่ตรง",
  "Both at once — a space means AND": "ทั้งสองเงื่อนไขพร้อมกัน — เว้นวรรคหมายถึง AND",
  "Click a destination to show only its entries.": "คลิกปลายทางเพื่อแสดงเฉพาะรายการของปลายทางนั้น",
  "Click an example to run it — then edit it": "คลิกตัวอย่างเพื่อค้นหาทันที — แล้วแก้ไขต่อได้",
  "Click to see only these entries": "คลิกเพื่อดูเฉพาะรายการเหล่านี้",
  "Closed by the client": "ต้นทางปิดการเชื่อมต่อ",
  "Comparisons: == != > < >= <=": "การเปรียบเทียบ: == != > < >= <=",
  "Connections": "การเชื่อมต่อ",
  "Connections over time, split by result": "การเชื่อมต่อตามช่วงเวลา แยกตามผลลัพธ์",
  "Connections to the unit itself on a management port were stopped. Refused is the right outcome if these are not your addresses; if they are yours, the local-in policy or the interface's allowaccess is what is turning them away.": "การเชื่อมต่อมาที่ตัวเครื่องผ่านพอร์ตจัดการถูกหยุด การปฏิเสธถือว่าถูกต้องถ้าไม่ใช่แอดเดรสของคุณ ถ้าเป็นของคุณ สิ่งที่ปฏิเสธคือ local-in policy หรือ allowaccess ของอินเทอร์เฟซ",
  "Conversations": "บทสนทนา",
  "Data": "ข้อมูล",
  "Entries": "รายการ",
  "Every allowed connection finished normally": "ทุกการเชื่อมต่อที่อนุญาตจบลงตามปกติ",
  "Every entry": "ทุกรายการ",
  "Every number and name on this page is also clickable and fills the box for you.": "ทุกตัวเลขและชื่อบนหน้านี้คลิกได้ และจะเติมคำค้นให้อัตโนมัติ",
  "Find a field": "ค้นหาฟิลด์",
  "For the questions no check was written for — why a service keeps resetting, what to look at first. It sees counts, not entries, and is told to say so when they cannot settle the question.": "สำหรับคำถามที่ไม่มีการตรวจเขียนไว้ — ทำไมบริการถึงถูกรีเซ็ตซ้ำๆ ควรดูอะไรก่อน AI เห็นแค่จำนวน ไม่เห็นรายการ และถูกสั่งให้บอกเมื่อข้อมูลไม่พอจะตอบ",
  "Handled by policy 8 (0 = implicit rules)": "ถูกจัดการโดยนโยบาย 8 (0 = กฎโดยปริยาย)",
  "How to list the traffic": "วิธีแสดงรายการทราฟฟิก",
  "How to search": "วิธีค้นหา",
  "Implicit local-in policy": "local-in policy โดยปริยาย",
  "Let through, but did not finish normally": "ผ่านไปได้ แต่ไม่ได้จบตามปกติ",
  "Local out": "ขาออกจากตัวเครื่อง",
  "None of the checks found anything in these entries. That is not a clean bill of health for the firewall — it means nothing in this sample matched the patterns worth raising.": "ไม่มีการตรวจใดพบอะไรในรายการเหล่านี้ นี่ไม่ได้แปลว่าไฟร์วอลล์ปกติทุกอย่าง — แปลว่าข้อมูลชุดนี้ไม่มีรูปแบบที่ควรแจ้ง",
  "No policy": "ไม่มีนโยบาย",
  "No policy permits this traffic": "ไม่มีนโยบายที่อนุญาตทราฟฟิกนี้",
  "No policy permits this traffic, so the implicit deny at the bottom of the policy table dropped it. To allow it, a policy has to be written for it.": "ไม่มีนโยบายที่อนุญาตทราฟฟิกนี้ implicit deny ที่ท้ายตารางนโยบายจึงทิ้งมันไป ถ้าต้องการอนุญาต ต้องสร้างนโยบายสำหรับทราฟฟิกนี้",
  "No policy (sent by the FortiGate)": "ไม่มีนโยบาย (FortiGate ส่งเอง)",
  "Nothing was blocked": "ไม่มีอะไรถูกบล็อก",
  "Not recorded": "ไม่ได้บันทึก",
  "One line per log entry — click one for the full story": "หนึ่งบรรทัดต่อหนึ่งรายการล็อก — คลิกเพื่อดูรายละเอียดทั้งหมด",
  "Only blocked connections": "เฉพาะการเชื่อมต่อที่ถูกบล็อก",
  "Open this entry": "เปิดรายการนี้",
  "Read it again": "อ่านอีกครั้ง",
  "Read these entries": "อ่านรายการเหล่านี้",
  "Refused by the local-in rules or the interface's administrative access": "ถูกปฏิเสธโดยกฎ local-in หรือการเข้าถึงเพื่อจัดการของอินเทอร์เฟซ",
  "Repeated refusals from one address on several different ports. That is either something probing the unit or a client configured to reach a service it is not allowed to reach — the log cannot tell which, and the addresses and ports below are what separates them.": "แอดเดรสเดียวถูกปฏิเสธซ้ำๆ บนหลายพอร์ต อาจเป็นสิ่งที่กำลังสแกนเครื่อง หรือไคลเอนต์ที่ตั้งค่าให้เข้าถึงบริการที่ไม่ได้รับอนุญาต — ล็อกบอกไม่ได้ว่าเป็นแบบไหน แอดเดรสและพอร์ตด้านล่างคือสิ่งที่แยกทั้งสองออกจากกัน",
  "Repeats of the same exchange folded into one line": "การสื่อสารแบบเดียวกันที่ซ้ำกันถูกรวมเป็นบรรทัดเดียว",
  "Reset by the server": "ปลายทางรีเซ็ตการเชื่อมต่อ",
  "Reset or timed out": "ถูกรีเซ็ตหรือหมดเวลา",
  "sent by the FortiGate": "FortiGate ส่งเอง",
  "Sent by the FortiGate": "FortiGate ส่งเอง",
  "Show other entries with…": "แสดงรายการอื่นที่มี…",
  "stopped by the FortiGate": "ถูก FortiGate หยุด",
  "The AI could not read this log.": "AI อ่านล็อกนี้ไม่ได้",
  "The connection was let through.": "การเชื่อมต่อได้รับอนุญาตให้ผ่าน",
  "The connection was let through and finished normally.": "การเชื่อมต่อได้รับอนุญาตและจบลงตามปกติ",
  "The connection was let through and the destination closed it abruptly. That is the far end refusing or dropping it — nothing on this firewall blocked it.": "การเชื่อมต่อได้รับอนุญาต แต่ปลายทางตัดการเชื่อมต่อทันที นั่นคือฝั่งปลายทางปฏิเสธหรือทิ้งการเชื่อมต่อ — ไม่มีอะไรบนไฟร์วอลล์นี้บล็อก",
  "The connection was let through, then got no answer or sat idle until the session timer expired. Often the destination is unreachable or not responding.": "การเชื่อมต่อได้รับอนุญาต แต่ไม่ได้รับคำตอบหรือไม่มีการใช้งานจนหมดเวลาของเซสชัน มักเกิดจากปลายทางเข้าถึงไม่ได้หรือไม่ตอบสนอง",
  "The firewall stopped this traffic.": "ไฟร์วอลล์หยุดทราฟฟิกนี้",
  "The FortiGate": "FortiGate",
  "the FortiGate itself": "ตัว FortiGate เอง",
  "the log": "ล็อก",
  "The log held nothing to read.": "ล็อกไม่มีข้อมูลให้อ่าน",
  "The path": "เส้นทาง",
  "The policy's action is deny": "action ของนโยบายคือ deny",
  "The policy that matched allows this traffic — a security profile on it (Web Filter, Application Control, AntiVirus, IPS) stopped it. The policy itself is fine; the profile is what decided.": "นโยบายที่ตรงกันอนุญาตทราฟฟิกนี้ — security profile บนนโยบายนั้น (Web Filter, Application Control, AntiVirus, IPS) เป็นตัวหยุด ตัวนโยบายไม่มีปัญหา profile คือสิ่งที่ตัดสิน",
  "The rule that matched permits this traffic — a Web Filter, Application Control or AntiVirus sensor on it made the decision. Editing the rule will change nothing; the profile attached to it is what to look at.": "นโยบายที่ตรงกันอนุญาตทราฟฟิกนี้ — Web Filter, Application Control หรือ AntiVirus บนนโยบายนั้นเป็นตัวตัดสิน การแก้นโยบายจะไม่เปลี่ยนอะไร ให้ดูที่ profile ที่ผูกอยู่แทน",
  "These are connections the FortiGate started itself — FortiGuard, NTP, its own DNS — not anybody reaching the unit. They never meet the policy table, so no rule permitted or denied them.": "นี่คือการเชื่อมต่อที่ FortiGate เริ่มเอง — FortiGuard, NTP, DNS ของตัวเอง — ไม่ใช่ใครพยายามเข้าถึงเครื่อง ทราฟฟิกเหล่านี้ไม่ผ่านตารางนโยบายเลย จึงไม่มีนโยบายใดอนุญาตหรือปฏิเสธ",
  "They fell through to the implicit deny at the bottom of the table, which means no policy permits them. If this traffic is supposed to work, the fix is a rule, not a change to an existing one.": "ทราฟฟิกเหล่านี้ตกไปถึง implicit deny ท้ายตาราง แปลว่าไม่มีนโยบายใดอนุญาต ถ้าทราฟฟิกนี้ควรใช้งานได้ วิธีแก้คือสร้างนโยบายใหม่ ไม่ใช่แก้นโยบายที่มีอยู่",
  "The server reads the same entries again and asks the model what they show": "เซิร์ฟเวอร์จะอ่านรายการชุดเดียวกันอีกครั้งแล้วถามโมเดลว่าหมายถึงอะไร",
  "The source ended the connection with a reset. Usually harmless — an app or browser closing a connection it no longer needs.": "ต้นทางจบการเชื่อมต่อด้วยการรีเซ็ต ส่วนใหญ่ไม่มีปัญหา — แอปหรือเบราว์เซอร์ปิดการเชื่อมต่อที่ไม่ใช้แล้ว",
  "The unit's own UTM engine rated these while they were open. This is the firewall's assessment, not this console's — the score and level are on each row.": "UTM engine ของตัวเครื่องให้คะแนนการเชื่อมต่อเหล่านี้ขณะที่เปิดอยู่ นี่คือการประเมินของไฟร์วอลล์ ไม่ใช่ของคอนโซลนี้ — คะแนนและระดับอยู่ในแต่ละแถว",
  "This policy is no longer in the table — deleted or renumbered since these entries were written.": "นโยบายนี้ไม่อยู่ในตารางแล้ว — ถูกลบหรือเปลี่ยนหมายเลขหลังจากรายการเหล่านี้ถูกบันทึก",
  "Times are the FortiGate's own clock, like the table below.": "เวลาเป็นนาฬิกาของ FortiGate เอง เหมือนตารางด้านล่าง",
  "To one country — quote a value with spaces": "ไปยังประเทศเดียว — ใส่เครื่องหมายคำพูดถ้าค่ามีเว้นวรรค",
  "Top destinations, split by result": "ปลายทางที่มีการเชื่อมต่อมากที่สุด แยกตามผลลัพธ์",
  "Traffic addressed TO this FortiGate — and the traffic it sends itself — with where it went, which policy handled it, and why anything was blocked": "ทราฟฟิกที่ส่ง “ถึง” FortiGate นี้ — และทราฟฟิกที่ตัวเครื่องส่งเอง — พร้อมบอกว่าไปที่ไหน นโยบายไหนจัดการ และทำไมบางอย่างถูกบล็อก",
  "Traffic from one address": "ทราฟฟิกจากแอดเดรสเดียว",
  "Traffic passing THROUGH this FortiGate — where it went, which policy let it through or stopped it, and why": "ทราฟฟิกที่ “ผ่าน” FortiGate นี้ — ไปที่ไหน นโยบายไหนอนุญาตหรือหยุด และทำไม",
  "Traffic to one address": "ทราฟฟิกไปยังแอดเดรสเดียว",
  "Traffic to one port": "ทราฟฟิกไปยังพอร์ตเดียว",
  "Traffic to the FortiGate itself was refused — by a local-in policy or by the interface's administrative access settings.": "ทราฟฟิกที่ส่งถึงตัว FortiGate ถูกปฏิเสธ — โดย local-in policy หรือการตั้งค่าการเข้าถึงเพื่อจัดการของอินเทอร์เฟซ",
  "What can I search for?": "ค้นหาอะไรได้บ้าง?",
  "What happened": "เกิดอะไรขึ้น",
  "What it is": "คืออะไร",
  "When: connections over time": "เมื่อไร: การเชื่อมต่อตามช่วงเวลา",
  "Where: top destinations": "ไปที่ไหน: ปลายทางที่มากที่สุด",
  "Which policy handled it — and why it was blocked": "นโยบายไหนจัดการ — และทำไมถึงถูกบล็อก",
  "Worth a look": "ควรตรวจดู",
  "Every entry read from the log for this search — one entry is one connection. The line underneath says who started them.": "ทุกรายการที่อ่านจากล็อกสำหรับการค้นหานี้ — หนึ่งรายการคือหนึ่งการเชื่อมต่อ บรรทัดด้านล่างบอกว่าใครเป็นผู้เริ่ม",
  "Connections the FortiGate stopped: no policy matched, a policy said deny, or a security profile blocked it. The line underneath names the most common reason.": "การเชื่อมต่อที่ FortiGate หยุด: ไม่มีนโยบายที่ตรง นโยบายสั่ง deny หรือ security profile บล็อก บรรทัดด้านล่างบอกเหตุผลที่พบบ่อยที่สุด",
  "Connections the FortiGate let through that did not finish normally: the destination reset them, or they timed out. Usually the far end or the network, not the firewall.": "การเชื่อมต่อที่ FortiGate อนุญาตแต่ไม่ได้จบตามปกติ: ปลายทางรีเซ็ต หรือหมดเวลา ส่วนใหญ่เกิดจากปลายทางหรือเครือข่าย ไม่ใช่ไฟร์วอลล์",
  "Total data moved by these connections, both directions. Counted in 1000s, exactly as the FortiGate's own log view shows it.": "ปริมาณข้อมูลรวมทั้งสองทิศทางของการเชื่อมต่อเหล่านี้ นับฐาน 1000 เหมือนหน้าล็อกของ FortiGate",
  "most: no policy matched": "ส่วนใหญ่: ไม่มีนโยบายที่ตรง",
  "most: denied by a policy": "ส่วนใหญ่: ถูกนโยบายปฏิเสธ",
  "most: a security profile": "ส่วนใหญ่: security profile",
  "most: refused by the FortiGate": "ส่วนใหญ่: ถูก FortiGate ปฏิเสธ",
};
