/**
 * Thai — Audit / Review, Rule Lifecycle, Change Ledger, Notify and the log pages.
 *
 * These pages are unusually careful about the difference between what this console computed and
 * what the FortiGate itself reported, and that distinction is the thing the Thai must not blur:
 * "our summary" / "reported by the device" / "not assessed here" are load-bearing hedges, not
 * padding. Each is translated as the same phrase everywhere it appears, so that a reader learns it
 * once — การประเมินของเรา, รายงานโดยอุปกรณ์, ไม่ได้ประเมินที่นี่.
 *
 * The framework names (PCI, PCI DSS, FSBP) are not translated: they are cited identifiers, and a
 * reviewer looks them up under those names.
 */
import type { Dict } from "../merge";

export const audit: Dict = {
  // -- Page framing ----------------------------------------------------------
  Overview: "ภาพรวม",
  Findings: "สิ่งที่ตรวจพบ",
  Standards: "มาตรฐาน",
  "Device Rating": "เรตติ้งจากอุปกรณ์",
  Advice: "คำแนะนำ",
  Observation: "ข้อสังเกต",
  Severity: "ระดับความรุนแรง",
  High: "สูง",
  Low: "ต่ำ",
  History: "ประวัติ",
  Trend: "แนวโน้ม",
  Rescan: "สแกนใหม่",
  Reload: "โหลดใหม่",
  Copy: "คัดลอก",
  "CLI copied": "คัดลอก CLI แล้ว",
  "Could not copy — select the text and press Ctrl+C":
    "คัดลอกไม่สำเร็จ — เลือกข้อความแล้วกด Ctrl+C",
  "How to read this": "วิธีอ่านข้อมูลนี้",
  "How to read this page": "วิธีอ่านหน้านี้",
  "What this page is meant to do": "หน้านี้มีไว้เพื่ออะไร",
  "Pick a device to start the scan": "เลือกอุปกรณ์เพื่อเริ่มสแกน",
  "Reading policies, objects and counters from the device…":
    "กำลังอ่านนโยบาย อ็อบเจกต์ และตัวนับจากอุปกรณ์…",
  "Reading the device's Security Rating…": "กำลังอ่าน Security Rating ของอุปกรณ์…",
  "Reading the scan history…": "กำลังอ่านประวัติการสแกน…",
  "Reading the ledger…": "กำลังอ่านสมุดบันทึก…",
  "Reading the policies and their hit counters from the device…":
    "กำลังอ่านนโยบายและตัวนับจำนวนครั้งที่ตรงกันจากอุปกรณ์…",
  "Entirely computed — no AI involved, and nothing is written to the device":
    "คำนวณทั้งหมดในระบบ — ไม่มี AI เข้ามาเกี่ยวข้อง และไม่มีการเขียนอะไรลงอุปกรณ์",
  "Read-only — nothing is written to the device": "อ่านอย่างเดียว — ไม่มีการเขียนลงอุปกรณ์",
  "Written by this console, not by the firewall": "เขียนโดยคอนโซลนี้ ไม่ใช่โดยไฟร์วอลล์",
  "Reported by the firewall, not by this console.": "รายงานโดยไฟร์วอลล์ ไม่ใช่โดยคอนโซลนี้",
  "Reported by the device": "รายงานโดยอุปกรณ์",
  "What this console computed from the policy table":
    "สิ่งที่คอนโซลนี้คำนวณได้จากตารางนโยบาย",
  "(our summary)": "(การประเมินของเรา)",
  "our summary": "การประเมินของเรา",
  "Speaks to — our mapping, not the device's": "เกี่ยวข้องกับ — การแมปของเรา ไม่ใช่ของอุปกรณ์",

  // -- Standards and controls ------------------------------------------------
  "controls across": "การควบคุมทั้งหมดใน",
  "controls listed here are assessed by this scan":
    "การควบคุมที่แสดงที่นี่ถูกประเมินโดยการสแกนครั้งนี้",
  "Control by control: what this scan evidences, and what it does not assess at all":
    "ทีละการควบคุม: การสแกนนี้เป็นหลักฐานให้อะไรได้บ้าง และอะไรที่ไม่ได้ประเมินเลย",
  Evidenced: "มีหลักฐานรองรับ",
  Scanned: "สแกนแล้ว",
  "Gap found": "พบช่องว่าง",
  "not assessed": "ไม่ได้ประเมิน",
  "not assessed here": "ไม่ได้ประเมินที่นี่",
  "Not assessed here": "ไม่ได้ประเมินที่นี่",
  "Actually evaluated": "ที่ประเมินจริง",
  "Could not determine": "สรุปไม่ได้",
  "reaches no verdict": "ยังไม่ได้ข้อสรุป",
  "Partly incomplete": "ไม่สมบูรณ์บางส่วน",
  "Checks in the set": "รายการตรวจในชุดนี้",
  "Every check": "ทุกรายการตรวจ",
  "No finding at this severity": "ไม่พบสิ่งใดที่ระดับความรุนแรงนี้",
  "No equivalent check": "ไม่มีรายการตรวจที่เทียบเท่ากัน",
  "Not licensed on this device": "อุปกรณ์นี้ไม่มีไลเซนส์",
  "Excluded on the device itself": "ถูกยกเว้นที่ตัวอุปกรณ์เอง",
  Label: "ป้ายกำกับ",
  "PCI (vendor edition)": "PCI (ฉบับของผู้ผลิต)",
  "PCI DSS reference as numbered by this FortiOS version":
    "การอ้างอิง PCI DSS ตามหมายเลขที่ FortiOS เวอร์ชันนี้ใช้",
  "Fortinet Security Best Practices — reported by the device":
    "Fortinet Security Best Practices — รายงานโดยอุปกรณ์",
  "Fortinet Security Best Practices — the vendor's own control ids":
    "Fortinet Security Best Practices — รหัสการควบคุมของผู้ผลิตเอง",
  "Grade from the device": "เกรดจากอุปกรณ์",
  "Latest scan": "การสแกนล่าสุด",
  "Generated at": "สร้างเมื่อ",
  "This device has no Security Rating report yet":
    "อุปกรณ์นี้ยังไม่มีรายงาน Security Rating",
  "The firewall's own Security Rating, relayed unchanged":
    "Security Rating ของไฟร์วอลล์เอง ส่งต่อมาโดยไม่แก้ไข",
  "Run one on the firewall under Security Fabric > Security Rating. This console only reads the result — it cannot start a rating run.":
    "สั่งรันบนไฟร์วอลล์ได้ที่ Security Fabric > Security Rating คอนโซลนี้อ่านผลลัพธ์ได้อย่างเดียว — สั่งให้เริ่มรันไม่ได้",
  "This scan carries no standards mapping": "การสแกนนี้ไม่มีการแมปกับมาตรฐานใด",
  "Our summary of what this control is about — not the publisher's own wording, and not quotable as such":
    "บทสรุปของเราว่าการควบคุมนี้ว่าด้วยเรื่องอะไร — ไม่ใช่ถ้อยคำของผู้ออกมาตรฐานเอง และไม่ควรนำไปอ้างอิงแทน",
  "This mapping was written by this console and has not yet been signed off by a qualified assessor":
    "การแมปนี้เขียนโดยคอนโซลนี้ และยังไม่ได้รับการรับรองจากผู้ประเมินที่มีคุณสมบัติ",
  "These mappings are our interpretation of which controls a finding speaks to. They are evidence for a review, not a compliance verdict — only a qualified assessor can decide whether a control is met. The list below is the set of controls a firewall configuration could speak to, not a whole framework; the rows marked":
    "การแมปเหล่านี้คือการตีความของเราว่าสิ่งที่ตรวจพบเกี่ยวข้องกับการควบคุมใด ใช้เป็นหลักฐานประกอบการทบทวนได้ แต่ไม่ใช่คำตัดสินด้านการปฏิบัติตามมาตรฐาน — มีเพียงผู้ประเมินที่มีคุณสมบัติเท่านั้นที่ตัดสินได้ว่าผ่านการควบคุมหรือไม่ รายการด้านล่างคือชุดการควบคุมที่การตั้งค่าไฟร์วอลล์อาจเกี่ยวข้องได้ ไม่ใช่กรอบมาตรฐานทั้งฉบับ แถวที่ทำเครื่องหมาย",
  "are part of that list on purpose, so that what was checked can be read against what was not. The vendor's own control ids are on the Device Rating tab, relayed from the firewall untouched.":
    "อยู่ในรายการนั้นโดยตั้งใจ เพื่อให้อ่านเทียบได้ว่าอะไรถูกตรวจและอะไรไม่ถูกตรวจ ส่วนรหัสการควบคุมของผู้ผลิตเองอยู่ที่แท็บเรตติ้งจากอุปกรณ์ ส่งต่อมาจากไฟร์วอลล์โดยไม่แก้ไข",
  "The vendor's PCI references, in the vendor's edition of the standard — an earlier one than the catalogue above. Not matched to our control numbers.":
    "การอ้างอิง PCI ของผู้ผลิต ตามฉบับมาตรฐานของผู้ผลิตเอง ซึ่งเก่ากว่าแคตตาล็อกด้านบน และไม่ได้จับคู่กับหมายเลขการควบคุมของเรา",
  "Checks, grade, severities and control ids are Fortinet's own. The device ran this scan on":
    "รายการตรวจ เกรด ระดับความรุนแรง และรหัสการควบคุม เป็นของ Fortinet เอง อุปกรณ์รันการสแกนนี้เมื่อ",
  "what our severities and statuses mean": "ระดับความรุนแรงและสถานะของเราหมายถึงอะไร",

  // -- Verdict wording -------------------------------------------------------
  "Both agree": "ทั้งสองฝ่ายตรงกัน",
  "They disagree": "ทั้งสองฝ่ายไม่ตรงกัน",
  "Checked twice": "ตรวจสองครั้ง",
  "Only we answered": "มีเพียงฝ่ายเราที่ตอบ",
  "Only the device answered": "มีเพียงอุปกรณ์ที่ตอบ",
  "related — does not vote": "เกี่ยวข้อง — แต่ไม่นับเป็นคะแนน",
  "Both checks ran and reached the same conclusion":
    "การตรวจทั้งสองรันแล้วและได้ข้อสรุปตรงกัน",
  "Both checks ran and reached different conclusions — one is looking at something the other is not":
    "การตรวจทั้งสองรันแล้วแต่ได้ข้อสรุปต่างกัน — ฝ่ายหนึ่งกำลังดูสิ่งที่อีกฝ่ายไม่ได้ดู",
  "The device checked this and it passed": "อุปกรณ์ตรวจเรื่องนี้แล้วและผ่าน",
  "The device checked this and it did not pass": "อุปกรณ์ตรวจเรื่องนี้แล้วและไม่ผ่าน",
  "This device has no licence for the check — it was not evaluated either way":
    "อุปกรณ์นี้ไม่มีไลเซนส์สำหรับการตรวจนี้ — จึงไม่ได้ประเมินไม่ว่าทางใด",
  "The check needs something else in the fabric before it can run":
    "การตรวจนี้ต้องมีองค์ประกอบอื่นใน fabric ก่อนจึงจะรันได้",
  "A check behind this control could not be evaluated on this device":
    "การตรวจที่อยู่เบื้องหลังการควบคุมนี้ประเมินบนอุปกรณ์นี้ไม่ได้",
  "Every check behind this control ran and found nothing against it":
    "การตรวจทุกรายการที่อยู่เบื้องหลังการควบคุมนี้รันแล้ว และไม่พบสิ่งใดที่ขัดกับการควบคุม",
  "These checks were not evaluated at all — neither passed nor failed":
    "การตรวจเหล่านี้ไม่ได้ถูกประเมินเลย — ไม่ผ่านและไม่ตก",
  "This scan found something that contradicts the control":
    "การสแกนนี้พบสิ่งที่ขัดกับการควบคุม",
  "This scan could not evaluate the question and the firewall could":
    "การสแกนนี้ประเมินคำถามนี้ไม่ได้ แต่ไฟร์วอลล์ประเมินได้",
  "Nothing in this console evaluates this control. The row says what would have to be read for it to be answerable":
    "ไม่มีสิ่งใดในคอนโซลนี้ที่ประเมินการควบคุมข้อนี้ แถวนี้ระบุว่าต้องอ่านอะไรจึงจะตอบได้",
  "The firewall did not evaluate its equivalent check — not a licence, exempted, or dependencies unmet. This is not the vendor agreeing":
    "ไฟร์วอลล์ไม่ได้ประเมินการตรวจที่เทียบเท่ากัน — อาจเพราะไม่มีไลเซนส์ ถูกยกเว้น หรือเงื่อนไขที่ต้องมีก่อนยังไม่ครบ กรณีนี้ไม่ได้แปลว่าผู้ผลิตเห็นด้วย",
  "The firewall publishes nothing that asks this question; the checks below cover the same subject by a different test":
    "ไฟร์วอลล์ไม่ได้เผยแพร่อะไรที่ถามคำถามนี้ การตรวจด้านล่างครอบคลุมเรื่องเดียวกันด้วยวิธีทดสอบอื่น",
  "The same subject by a different test. Shown for context; it does not count towards the verdict":
    "เรื่องเดียวกันแต่ทดสอบด้วยวิธีอื่น แสดงไว้เป็นบริบทเท่านั้น ไม่นับรวมในคำตัดสิน",
  "The only findings against this control are advisory — a disabled rule, a rule that has never matched, an object nothing references. Worth tidying; not a control failure":
    "สิ่งที่ตรวจพบทั้งหมดที่ขัดกับการควบคุมนี้เป็นเพียงข้อแนะนำ — กฎที่ปิดใช้งาน กฎที่ไม่เคยตรงกับอะไรเลย อ็อบเจกต์ที่ไม่มีอะไรอ้างอิง ควรจัดระเบียบ แต่ไม่ถือว่าไม่ผ่านการควบคุม",
  "The only findings against this control carry a signed, unexpired acceptance — the risk was decided on, not removed":
    "สิ่งที่ตรวจพบทั้งหมดที่ขัดกับการควบคุมนี้มีการยอมรับความเสี่ยงที่ลงนามแล้วและยังไม่หมดอายุ — ความเสี่ยงถูกตัดสินใจแล้ว ไม่ได้ถูกกำจัด",
  "Nothing this scan looks for is present on this device. That is not the same as full coverage — the Standards tab lists what is checked and what is not.":
    "ไม่พบสิ่งที่การสแกนนี้มองหาอยู่บนอุปกรณ์นี้เลย ซึ่งไม่ได้แปลว่าครอบคลุมครบถ้วน — แท็บมาตรฐานระบุไว้ว่าอะไรถูกตรวจและอะไรไม่ถูกตรวจ",
  "A scan is stored when its findings differ from the previous one, or once every 12 hours if nothing has changed. Come back after the next change to this firewall.":
    "ระบบจะเก็บผลการสแกนเมื่อสิ่งที่ตรวจพบต่างจากครั้งก่อน หรือทุก 12 ชั่วโมงหากไม่มีอะไรเปลี่ยน กลับมาดูอีกครั้งหลังจากไฟร์วอลล์นี้มีการเปลี่ยนแปลงครั้งถัดไป",
  "Not enough history to draw a trend yet": "ประวัติยังไม่พอสำหรับวาดแนวโน้ม",
  "Open findings over time": "สิ่งที่ตรวจพบซึ่งยังค้างอยู่ ตามช่วงเวลา",
  "Whether this firewall is getting better, and what has been signed off":
    "ไฟร์วอลล์นี้ดีขึ้นหรือไม่ และมีอะไรที่ได้รับการรับรองไปแล้วบ้าง",
  "stored scans · accepted risks are excluded, so a line falling because somebody signed a waiver looks the same as one falling because somebody fixed the rule — check the register below.":
    "ผลการสแกนที่เก็บไว้ · ความเสี่ยงที่ยอมรับแล้วจะไม่ถูกนับ ดังนั้นเส้นกราฟที่ลดลงเพราะมีคนลงนามยกเว้นจะดูเหมือนกับที่ลดลงเพราะมีคนแก้กฎจริง — ตรวจสอบทะเบียนด้านล่าง",

  // -- Risk acceptance -------------------------------------------------------
  "Accept this risk": "ยอมรับความเสี่ยงนี้",
  "Accept this risk…": "ยอมรับความเสี่ยงนี้…",
  "Accepted risk register": "ทะเบียนความเสี่ยงที่ยอมรับแล้ว",
  "Risk accepted": "ยอมรับความเสี่ยงแล้ว",
  "risk accepted": "ยอมรับความเสี่ยงแล้ว",
  "Risk accepted by": "ยอมรับความเสี่ยงโดย",
  "· accepted by": "· ยอมรับโดย",
  "Acceptance withdrawn": "ถอนการยอมรับแล้ว",
  Withdraw: "ถอน",
  "Withdraw this acceptance?": "ถอนการยอมรับนี้หรือไม่?",
  "Could not withdraw the acceptance": "ถอนการยอมรับไม่สำเร็จ",
  "Risk accepted — the finding stays on the report with your name on it":
    "ยอมรับความเสี่ยงแล้ว — สิ่งที่ตรวจพบจะยังอยู่ในรายงานพร้อมชื่อของคุณ",
  "Why is this acceptable? An assessor will read this":
    "เหตุใดจึงยอมรับได้? ผู้ประเมินจะอ่านข้อความนี้",
  'Give at least 10 characters — "n/a" is not a justification anyone can use':
    'กรอกอย่างน้อย 10 ตัวอักษร — "n/a" ไม่ใช่เหตุผลที่ใครใช้ได้',
  "e.g. legacy payment terminal needs this path until the Q4 migration; compensating control is the IPS profile on the upstream rule":
    "เช่น เครื่องรับชำระเงินรุ่นเก่าต้องใช้เส้นทางนี้จนกว่าจะย้ายระบบใน Q4 โดยมีมาตรการชดเชยคือโปรไฟล์ IPS บนกฎที่อยู่เหนือขึ้นไป",
  "The finding is": "สิ่งที่ตรวจพบคือ",
  ". It stays on the report and in the evidence pack, marked as accepted and carrying your name, your reason and the expiry date below.":
    " รายการนี้จะยังอยู่ในรายงานและในชุดหลักฐาน โดยระบุว่ายอมรับแล้ว พร้อมชื่อของคุณ เหตุผล และวันหมดอายุด้านล่าง",
  "Findings somebody signed off on. They are excluded from the severity counts but never removed from the report.":
    "สิ่งที่ตรวจพบซึ่งมีผู้ลงนามรับรองแล้ว รายการเหล่านี้จะไม่ถูกนับในยอดตามระดับความรุนแรง แต่จะไม่ถูกลบออกจากรายงานเด็ดขาด",
  "Nothing on this firewall is running on a waiver.":
    "ไม่มีสิ่งใดบนไฟร์วอลล์นี้ที่ทำงานอยู่ภายใต้การยกเว้น",
  "· expires": "· หมดอายุ",

  // -- Rule Lifecycle --------------------------------------------------------
  Idle: "ไม่มีการใช้งาน",
  Stale: "ค้างเก่า",
  "Never used": "ไม่เคยถูกใช้",
  Watching: "กำลังเฝ้าดู",
  "Stale-rule threshold": "เกณฑ์ตัดสินว่ากฎค้างเก่า",
  "How many idle days before a rule counts as stale":
    "ต้องไม่มีการใช้งานกี่วันจึงจะนับว่ากฎค้างเก่า",
  "Carried traffic within the past week": "มีทราฟฟิกวิ่งผ่านภายในสัปดาห์ที่ผ่านมา",
  "Still carries traffic, just not in the past week":
    "ยังมีทราฟฟิกวิ่งผ่านอยู่ เพียงแต่ไม่ใช่ในสัปดาห์ที่ผ่านมา",
  "It carried traffic once, but has been silent for longer than the threshold":
    "เคยมีทราฟฟิกวิ่งผ่าน แต่เงียบมานานกว่าเกณฑ์ที่ตั้งไว้",
  "The device has counted no packet for this rule since the counters were reset":
    "อุปกรณ์ไม่ได้นับแพ็กเก็ตให้กฎนี้เลยนับตั้งแต่รีเซ็ตตัวนับ",
  "Switched off — the counter is zero because it is disabled, not because nobody needs it":
    "ถูกปิดใช้งาน — ตัวนับเป็นศูนย์เพราะกฎถูกปิด ไม่ใช่เพราะไม่มีใครต้องใช้",
  "Suggested for removal": "แนะนำให้ลบออก",
  "Pick a device to see which rules are still being used":
    "เลือกอุปกรณ์เพื่อดูว่ากฎใดยังถูกใช้งานอยู่",
  "Daily hit count, the last 8 buckets reported by the device":
    "จำนวนครั้งที่ตรงกันรายวัน จาก 8 ช่วงล่าสุดที่อุปกรณ์รายงาน",
  "The device did not return hit counters (monitor/firewall/policy), so this page":
    "อุปกรณ์ไม่ได้ส่งตัวนับจำนวนครั้งที่ตรงกันกลับมา (monitor/firewall/policy) หน้านี้จึง",
  "about which rules are dead, rather than reporting that all of them are":
    "เกี่ยวกับว่ากฎใดตายไปแล้ว แทนที่จะรายงานว่าตายหมดทุกข้อ",
  "days = active · silent for more than": "วัน = ใช้งานอยู่ · เงียบนานเกิน",
  "days = stale": "วัน = ค้างเก่า",
  "Current thresholds: traffic within": "เกณฑ์ปัจจุบัน: มีทราฟฟิกภายใน",
  "hits / traffic / sessions": "จำนวนครั้ง / ทราฟฟิก / เซสชัน",
  "Delete this policy from the firewall?": "ลบนโยบายนี้ออกจากไฟร์วอลล์หรือไม่?",
  "This device runs cfg-save automatic — once deleted there is no revision to roll back to":
    "อุปกรณ์นี้ตั้งค่า cfg-save automatic ไว้ — เมื่อลบแล้วจะไม่มีเวอร์ชันให้ย้อนกลับ",

  // -- Change Ledger ---------------------------------------------------------
  "No change has been recorded yet": "ยังไม่มีการบันทึกการเปลี่ยนแปลง",
  "Every time Policy & Objects, Security Profiles or VPN writes to a device, the change shows up here with its before and after values":
    "ทุกครั้งที่หน้านโยบายและอ็อบเจกต์ โปรไฟล์ความปลอดภัย หรือ VPN เขียนค่าลงอุปกรณ์ การเปลี่ยนแปลงจะปรากฏที่นี่พร้อมค่าก่อนและหลัง",
  Revert: "ย้อนกลับ",
  Reverted: "ย้อนกลับแล้ว",
  "Reverted on the device": "ย้อนกลับบนอุปกรณ์แล้ว",
  "Reverts #": "ย้อนกลับรายการ #",
  "Cannot revert": "ย้อนกลับไม่ได้",
  "Any action": "ทุกการกระทำ",
  "Any status": "ทุกสถานะ",
  Before: "ก่อน",
  After: "หลัง",
  Newer: "ใหม่กว่า",
  Older: "เก่ากว่า",
  Previous: "ก่อนหน้า",
  "Current:": "ปัจจุบัน:",
  "Some entries were rejected by the device. Part of a rejected change may still have applied — check the device itself":
    "บางรายการถูกอุปกรณ์ปฏิเสธ ส่วนหนึ่งของการเปลี่ยนแปลงที่ถูกปฏิเสธอาจถูกนำไปใช้แล้ว — ตรวจสอบที่ตัวอุปกรณ์เอง",

  // -- Shared, generic phrases (download errors, range math) -----------------
  "The download failed": "ดาวน์โหลดไม่สำเร็จ",
  "in total": "รวมทั้งหมด",
  "of the": "จาก",

  // -- Notify ----------------------------------------------------------------
  Channels: "ช่องทาง",
  "Channels & recipients": "ช่องทางและผู้รับ",
  "Edit channel": "แก้ไขช่องทาง",
  "Remove channel": "ลบช่องทาง",
  "Channel removed": "ลบช่องทางแล้ว",
  "LINE channel": "ช่องทาง LINE",
  "Email channel": "ช่องทางอีเมล",
  "Channel access token": "โทเคนเข้าถึงช่องทาง",
  "Channel access token (long-lived)": "โทเคนเข้าถึงช่องทาง (อายุยาว)",
  "What this channel is for": "ช่องทางนี้มีไว้เพื่ออะไร",
  "A channel is a way out of the building. Alerts are sent to the recipients inside it.":
    "ช่องทางคือทางออกจากอาคาร การแจ้งเตือนจะถูกส่งไปยังผู้รับที่อยู่ในช่องทางนั้น",
  "Add recipient": "เพิ่มผู้รับ",
  "Recipient added": "เพิ่มผู้รับแล้ว",
  "Recipient removed": "ลบผู้รับแล้ว",
  "Remove recipient": "ลบผู้รับ",
  "no recipient": "ไม่มีผู้รับ",
  "no token": "ไม่มีโทเคน",
  "Or type an address": "หรือพิมพ์ที่อยู่",
  "address ·": "ที่อยู่ ·",
  "Loading the address book…": "กำลังโหลดสมุดที่อยู่…",
  "Loading channels…": "กำลังโหลดช่องทาง…",
  "Loading alert rules…": "กำลังโหลดกฎการแจ้งเตือน…",
  "Loading the alert history…": "กำลังโหลดประวัติการแจ้งเตือน…",
  "New alert rule": "กฎการแจ้งเตือนใหม่",
  "Alert rules": "กฎการแจ้งเตือน",
  "No alert rules yet": "ยังไม่มีกฎการแจ้งเตือน",
  "No rule in this category": "ไม่มีกฎในหมวดนี้",
  "Rule name": "ชื่อกฎ",
  "Edit rule": "แก้ไขกฎ",
  "Delete rule": "ลบกฎ",
  "Add the first rule": "เพิ่มกฎแรก",
  "What to watch": "จะเฝ้าดูอะไร",
  "Watch the firewalls, and say something when they change":
    "เฝ้าดูไฟร์วอลล์ และแจ้งเมื่อมีอะไรเปลี่ยนแปลง",
  "State changes — a port, or the whole firewall": "การเปลี่ยนสถานะ — ของพอร์ต หรือของทั้งไฟร์วอลล์",
  "A number crossing a line you set": "ตัวเลขที่ข้ามเส้นที่คุณกำหนดไว้",
  "Resource thresholds": "เกณฑ์การใช้ทรัพยากร",
  "Link & reachability": "ลิงก์และการเข้าถึง",
  Threshold: "เกณฑ์",
  "Threshold (": "เกณฑ์ (",
  "Hold for": "คงสภาพนาน",
  "Look back": "ย้อนดูย้อนหลัง",
  "How long, at most": "นานที่สุดเท่าไร",
  "Repeat at most every": "ส่งซ้ำได้อย่างมากทุก",
  "Also send a message when it recovers": "ส่งข้อความเมื่อกลับสู่ปกติด้วย",
  "Recovery messages are never held back.": "ข้อความแจ้งการกลับสู่ปกติจะไม่ถูกหน่วงไว้เลย",
  "Firing now": "กำลังแจ้งเตือนอยู่",
  "Firing only": "เฉพาะที่กำลังแจ้งเตือน",
  "Firing and resolved": "ทั้งที่กำลังแจ้งเตือนและที่คลี่คลายแล้ว",
  "Resolved only": "เฉพาะที่คลี่คลายแล้ว",
  "firing on": "กำลังแจ้งเตือนบน",
  "Sent in 24h": "ส่งไปใน 24 ชั่วโมง",
  "Nothing has been sent": "ยังไม่มีการส่งอะไรเลย",
  "Nothing was delivered": "ไม่มีอะไรถูกส่งถึง",
  "Nothing can be delivered yet": "ยังส่งอะไรไม่ได้",
  Delivery: "การส่ง",
  "test ok": "ทดสอบผ่าน",
  "test failed": "ทดสอบไม่ผ่าน",
  "Clear old": "ล้างรายการเก่า",
  "Clear old alerts": "ล้างการแจ้งเตือนเก่า",
  "Clear alerts older than 7 days?": "ล้างการแจ้งเตือนที่เก่ากว่า 7 วันหรือไม่?",
  "Anything from the last week is kept. This cannot be undone.":
    "รายการจากสัปดาห์ล่าสุดจะถูกเก็บไว้ การกระทำนี้ย้อนกลับไม่ได้",
  "7 days": "7 วัน",
  "Every device (including ones added later)":
    "ทุกอุปกรณ์ (รวมถึงอุปกรณ์ที่เพิ่มเข้ามาภายหลัง)",
  "Every enabled rule is checked against each firewall once every":
    "กฎที่เปิดใช้งานทุกข้อจะถูกตรวจกับไฟร์วอลล์แต่ละเครื่องหนึ่งครั้งทุก",
  "port1,port2 — blank means all": "port1,port2 — เว้นว่างหมายถึงทั้งหมด",
  "Either nothing has gone wrong, or no rule is watching for it yet. The Rules tab says which.":
    "อาจเป็นเพราะยังไม่มีอะไรผิดพลาด หรือยังไม่มีกฎใดเฝ้าดูอยู่ แท็บกฎจะบอกว่าเป็นกรณีใด",
  "Nothing is being watched. A good first pair is “Port Up / Down” on every device, and CPU over 85% held for two checks.":
    "ยังไม่มีอะไรถูกเฝ้าดูอยู่ คู่แรกที่ควรตั้งคือ “พอร์ตขึ้น / ลง” บนทุกอุปกรณ์ และ CPU เกิน 85% ต่อเนื่องสองรอบการตรวจ",
  "Alert rules can be written now, but with no channel configured they would fire into nothing. Add a LINE bot's access token, or an email channel that uses the SMTP account from Service ▸ Email.":
    "ตอนนี้เขียนกฎการแจ้งเตือนได้แล้ว แต่ถ้ายังไม่ได้ตั้งค่าช่องทางไว้ การแจ้งเตือนจะส่งออกไปที่ที่ไม่มีอะไรอยู่ ให้เพิ่มโทเคนเข้าถึงของบอต LINE หรือช่องทางอีเมลที่ใช้บัญชี SMTP จาก บริการ ▸ อีเมล",
  "No delivery channel is usable yet — every rule below would fire into nothing. Add a LINE channel with an access token, or configure the mail account under Service ▸ Email.":
    "ยังไม่มีช่องทางส่งที่ใช้งานได้ — กฎทุกข้อด้านล่างจะส่งออกไปที่ที่ไม่มีอะไรอยู่ ให้เพิ่มช่องทาง LINE พร้อมโทเคนเข้าถึง หรือตั้งค่าบัญชีอีเมลที่ บริการ ▸ อีเมล",
  "No recipient exists yet. Add one under the": "ยังไม่มีผู้รับเลย เพิ่มได้ที่แท็บ",
  "tab, or this rule will fire into nothing.": "มิฉะนั้นกฎนี้จะส่งออกไปที่ที่ไม่มีอะไรอยู่",
  "No recipient yet — this channel can hold a token but has nowhere to send.":
    "ยังไม่มีผู้รับ — ช่องทางนี้เก็บโทเคนได้ แต่ไม่มีที่ให้ส่ง",
  "Email is sent through the account under": "อีเมลถูกส่งผ่านบัญชีที่ตั้งไว้ที่",
  "Service ▸ Email": "บริการ ▸ อีเมล",
  ". There is no separate password here — one place to configure means one place for it to be wrong.":
    " ที่นี่ไม่มีรหัสผ่านแยกต่างหาก — ตั้งค่าที่เดียวหมายถึงมีที่เดียวที่จะผิดพลาดได้",
  "From the LINE Developers console: your Messaging API channel →":
    "จากคอนโซล LINE Developers: ช่อง Messaging API ของคุณ →",
  "A userId, groupId or roomId —": "userId, groupId หรือ roomId —",
  "followed by 32 hex characters. Not the display name: that is accepted by nothing and fails silently at 3am. The bot must already have been added to the chat.":
    "ตามด้วยอักขระฐานสิบหก 32 ตัว ไม่ใช่ชื่อที่แสดง เพราะชื่อที่แสดงไม่มีระบบใดรับ และจะล้มเหลวเงียบ ๆ ตอนตีสาม บอตต้องถูกเพิ่มเข้าแชทไว้แล้วด้วย",
  "This is a group or room, not one person": "นี่คือกลุ่มหรือห้อง ไม่ใช่บุคคลเดียว",
  ". It is stored encrypted and never sent back to this page.":
    " ค่านี้ถูกเก็บแบบเข้ารหัส และจะไม่ถูกส่งกลับมายังหน้านี้เลย",
  "The history of what it already sent is kept. Only the rule and its live state go.":
    "ประวัติของสิ่งที่ส่งไปแล้วจะถูกเก็บไว้ มีเพียงตัวกฎและสถานะปัจจุบันเท่านั้นที่ถูกลบ",
  "They are dropped from every alert rule that names them.":
    "ระบบจะเอาออกจากกฎการแจ้งเตือนทุกข้อที่ระบุถึงพวกเขา",
  ". What a rule watches cannot be changed after it is created — its threshold and its stored state mean different things per check.":
    " สิ่งที่กฎเฝ้าดูจะเปลี่ยนไม่ได้หลังจากสร้างแล้ว — เพราะเกณฑ์และสถานะที่เก็บไว้มีความหมายต่างกันไปในแต่ละรายการตรวจ",
  "is currently disabled)": "ถูกปิดใช้งานอยู่)",
  "not removed": "ไม่ได้ถูกลบ",

  // -- Logs ------------------------------------------------------------------
  "Read the log of traffic addressed to the firewall itself":
    "อ่านบันทึกทราฟฟิกที่ส่งถึงตัวไฟร์วอลล์เอง",
  "The log of traffic addressed TO this FortiGate, not the traffic passing through it":
    "บันทึกทราฟฟิกที่ส่งถึง FortiGate เครื่องนี้ ไม่ใช่ทราฟฟิกที่วิ่งผ่านไป",
  "Not connected to the device log yet": "ยังไม่ได้เชื่อมต่อกับบันทึกของอุปกรณ์",
  "This page is reserved for reading the Local Traffic log. There is no server endpoint that fetches it yet, so there is nothing to show.":
    "หน้านี้สงวนไว้สำหรับอ่านบันทึก Local Traffic ยังไม่มีปลายทางฝั่งเซิร์ฟเวอร์ที่ดึงข้อมูลนี้ จึงยังไม่มีอะไรให้แสดง",
  "Lab device limitation (FortiGate 80E):": "ข้อจำกัดของอุปกรณ์ในแล็บ (FortiGate 80E):",
  "it has no log disk (": "อุปกรณ์ไม่มีดิสก์สำหรับเก็บบันทึก (",
  ") — so logs live in memory only — a small buffer, lost on reboot":
    ") — บันทึกจึงอยู่ในหน่วยความจำเท่านั้น เป็นบัฟเฟอร์เล็ก ๆ ที่หายไปเมื่อรีบูต",
  "For real retention the device has to forward to syslog or a FortiAnalyzer (":
    "หากต้องการเก็บบันทึกจริงจัง อุปกรณ์ต้องส่งต่อไปยัง syslog หรือ FortiAnalyzer (",
  "Filter by source, destination and action, as Session Monitor does":
    "กรองตามต้นทาง ปลายทาง และการกระทำ เช่นเดียวกับหน้าเฝ้าดูเซสชัน",
  "Jump from a log line to the policy behind it":
    "กระโดดจากบรรทัดบันทึกไปยังนโยบายที่อยู่เบื้องหลัง",
  "s)": "วินาที)",

  // -- Licence-limited grading (Device Rating tab) --------------------------
  "checks could not run on this device for want of a licence, so this grade describes":
    "รายการตรวจไม่สามารถรันบนอุปกรณ์นี้ได้เพราะไม่มีไลเซนส์ เกรดนี้จึงอธิบายเพียง",
  "checks, not the full set. The rule-table checks on the Findings tab need no licence and are unaffected.":
    "รายการตรวจเท่านั้น ไม่ใช่ทั้งชุด ส่วนการตรวจตารางกฎบนแท็บสิ่งที่ตรวจพบไม่ต้องใช้ไลเซนส์และไม่ได้รับผลกระทบ",
  '— reported as "could not determine" on the Standards tab rather than counted as passing':
    '— รายงานเป็น "สรุปไม่ได้" บนแท็บมาตรฐาน แทนที่จะนับว่าผ่าน',
  "our scan against the firewall's own Security Rating":
    "การสแกนของเราเทียบกับ Security Rating ของไฟร์วอลล์เอง",
  "The CLI that fixes this — copy it and run it yourself; the console will not":
    "คำสั่ง CLI ที่ใช้แก้ปัญหานี้ — คัดลอกไปรันเอง คอนโซลจะไม่รันให้",


  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Accept and sign": "ยอมรับและลงนาม",
  "Could not record the acceptance": "บันทึกการยอมรับไม่สำเร็จ",
  "All devices": "อุปกรณ์ทั้งหมด",
  "Cannot be reverted": "ย้อนกลับไม่ได้",
  "(cited, not reproduced)": "(อ้างอิงไว้ ไม่ได้คัดลอกมา)",
  "Could not delete the policy": "ลบนโยบายไม่สำเร็จ",
  "Could not read the counters from the device": "อ่านตัวนับจากอุปกรณ์ไม่สำเร็จ",
  "Could not read the ledger": "อ่านบันทึกการเปลี่ยนแปลงไม่สำเร็จ",
  "Could not read the rating": "อ่านผลการจัดเรตไม่สำเร็จ",
  "EXPIRED": "หมดอายุ",
  "IN FORCE": "มีผลบังคับใช้",
  "WITHDRAWN": "ถอนแล้ว",
  "Nothing selected": "ยังไม่ได้เลือกรายการใด",
  "Reading the firewall…": "กำลังอ่านข้อมูลจากไฟร์วอลล์…",
  "Recording…": "กำลังบันทึก…",
  "(system)": "(ระบบ)",
  "The deleted object will be recreated with its original values": "อ็อบเจกต์ที่ถูกลบจะถูกสร้างขึ้นใหม่ด้วยค่าเดิม",
  "The object that was created will be deleted from the live device": "อ็อบเจกต์ที่ถูกสร้างขึ้นจะถูกลบออกจากอุปกรณ์จริง",
  "The previous values will be written back over the current ones": "ค่าเดิมจะถูกเขียนทับค่าปัจจุบัน",
  "The device did not evaluate this check, so it is not an opinion either way": "อุปกรณ์ไม่ได้ประเมินการตรวจนี้ จึงไม่ถือเป็นความเห็นในทางใดทางหนึ่ง",
  "The device evaluated this check": "อุปกรณ์ได้ประเมินการตรวจนี้แล้ว",
  "The scan failed": "การสแกนล้มเหลว",
  "This scan found no problem": "การสแกนนี้ไม่พบปัญหา",
  "Worth reviewing": "ควรตรวจสอบ",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "1 day ago": "1 วันที่แล้ว",
  "Today": "วันนี้",
  "The device returned no hit counters, so this page cannot confirm the rule is unused — check it yourself before deleting": "อุปกรณ์ไม่ได้ส่งตัวนับการใช้งานกลับมา หน้านี้จึงยืนยันไม่ได้ว่ากฎนี้ไม่ถูกใช้ — ตรวจสอบด้วยตัวเองก่อนลบ",
  "This rule carried traffic within the past week — it is still in use": "กฎนี้มีทราฟฟิกผ่านภายในสัปดาห์ที่ผ่านมา — ยังถูกใช้งานอยู่",
  "This rule is disabled, so its counter is zero because it is off rather than unused — find out who disabled it and why": "กฎนี้ถูกปิดใช้งาน ตัวนับจึงเป็นศูนย์เพราะมันปิดอยู่ ไม่ใช่เพราะไม่มีใครใช้ — หาให้ได้ว่าใครปิดและเพราะอะไร",

  // -- Revert reasons, and the posture-score tile's own label — served by the Go backend, so the
  // extractor never sees them ---
  "Security Posture": "สถานะความมั่นคงปลอดภัย",
  "already reverted": "ย้อนกลับไปแล้ว",
  "the change never applied, so there is nothing to undo": "การเปลี่ยนแปลงนี้ไม่เคยถูกปรับใช้ จึงไม่มีอะไรให้ย้อนกลับ",
  "this entry is itself a revert — undo it from the original change": "รายการนี้เป็นการย้อนกลับอยู่แล้ว — ให้ย้อนจากการเปลี่ยนแปลงต้นทางแทน",
  "no FortiOS table was recorded for this change": "ไม่มีการบันทึกตาราง FortiOS สำหรับการเปลี่ยนแปลงนี้",
  "the created object's key was not captured": "ไม่ได้เก็บคีย์ของอ็อบเจกต์ที่สร้างขึ้นไว้",
  "no snapshot of the previous state was captured": "ไม่ได้เก็บสแนปช็อตของสถานะก่อนหน้าไว้",
  "no object key was recorded": "ไม่ได้บันทึกคีย์ของอ็อบเจกต์ไว้",
  "no snapshot of the deleted object was captured": "ไม่ได้เก็บสแนปช็อตของอ็อบเจกต์ที่ถูกลบไว้",
  "unsupported change type": "ประเภทการเปลี่ยนแปลงที่ไม่รองรับ",

  // -- Configuration Drift (drift + ledger tabs, change analysis) --------------
  "Acknowledge": "รับทราบ",
  "Acknowledgement removed": "ยกเลิกการรับทราบแล้ว",
  "Analysis window": "ช่วงเวลาที่วิเคราะห์",
  "Baseline": "ฐานอ้างอิง",
  "Changes per day": "การเปลี่ยนแปลงรายวัน",
  "Changes per day, through this console and outside it": "การเปลี่ยนแปลงรายวัน ทั้งที่ทำผ่านคอนโซลนี้และนอกคอนโซล",
  "Changes per FortiOS table, through this console and outside it": "การเปลี่ยนแปลงแยกตามตาราง FortiOS ทั้งที่ทำผ่านคอนโซลนี้และนอกคอนโซล",
  "Changes this console cannot account for": "มีการเปลี่ยนแปลงที่คอนโซลนี้ระบุที่มาไม่ได้",
  "Chart": "กราฟ",
  "Clean": "ปกติ",
  "Compare now": "เปรียบเทียบตอนนี้",
  "Comparing…": "กำลังเปรียบเทียบ…",
  "Configuration Drift": "คอนฟิกคลาดเคลื่อน",
  "Configuration Drift view": "มุมมองคอนฟิกคลาดเคลื่อน",
  "Console": "คอนโซล",
  "Day": "วัน",
  "Drift": "คลาดเคลื่อน",
  "Drift findings": "รายการคลาดเคลื่อน",
  "Every change to your firewalls — made through this console, or outside it": "ทุกการเปลี่ยนแปลงบนไฟร์วอลล์ — ทั้งที่ทำผ่านคอนโซลนี้และนอกคอนโซล",
  "Every finding has been reviewed": "ทุกรายการได้รับการตรวจทานแล้ว",
  "Everything that changed was done through this console": "ทุกอย่างที่เปลี่ยนไปทำผ่านคอนโซลนี้",
  "Every write this console makes is recorded in the Change Ledger. Every backup is compared with the one before it, and the ledger's changes are subtracted — what is left changed on the firewall some other way: the CLI, its own web GUI, or another tool. That is not automatically wrong; it is unaccounted for, and worth a look.": "ทุกการเขียนที่คอนโซลนี้ทำจะถูกบันทึกในสมุดบันทึกการเปลี่ยนแปลง แต่ละแบ็กอัปจะถูกเทียบกับครั้งก่อนหน้า แล้วหักการเปลี่ยนแปลงที่อยู่ในสมุดบันทึกออก — ส่วนที่เหลือคือสิ่งที่เปลี่ยนบนไฟร์วอลล์ด้วยวิธีอื่น เช่น CLI, เว็บ GUI ของตัวเครื่อง หรือเครื่องมืออื่น ซึ่งไม่ได้แปลว่าผิดเสมอไป แต่ระบุที่มาไม่ได้และควรตรวจดู",
  "Filter by action": "กรองตามการกระทำ",
  "Filter by status": "กรองตามสถานะ",
  "Finding acknowledged": "รับทราบรายการแล้ว",
  "First backup — nothing to compare against yet": "แบ็กอัปแรก — ยังไม่มีอะไรให้เปรียบเทียบ",
  "FortiOS table": "ตาราง FortiOS",
  "Last checked": "ตรวจล่าสุด",
  "Loading the snapshots…": "กำลังโหลดสแนปช็อต…",
  "Modified": "แก้ไข",
  "Neither through this console nor, as far as the backups show, outside it": "ทั้งผ่านคอนโซลนี้ และนอกคอนโซลเท่าที่แบ็กอัปแสดงให้เห็น",
  "No backup yet — take one from Devices before this can compare anything.": "ยังไม่มีแบ็กอัป — สร้างแบ็กอัปจากหน้า Devices ก่อน จึงจะเปรียบเทียบได้",
  "No comparison has run yet. Take a backup, or press “Compare now” above.": "ยังไม่เคยเปรียบเทียบ สร้างแบ็กอัป หรือกด “เปรียบเทียบตอนนี้” ด้านบน",
  "No line detail stored for this object.": "ไม่ได้เก็บรายละเอียดบรรทัดของอ็อบเจกต์นี้ไว้",
  "Nothing changed between these two backups.": "ไม่มีอะไรเปลี่ยนระหว่างแบ็กอัปทั้งสองนี้",
  "Nothing unaccounted for": "ไม่มีการเปลี่ยนแปลงที่ระบุที่มาไม่ได้",
  "Not run": "ยังไม่เคยรัน",
  "open finding": "รายการที่ยังเปิดอยู่",
  "open findings": "รายการที่ยังเปิดอยู่",
  "Open findings": "รายการที่ยังเปิดอยู่",
  "Open last run": "เปิดการรันล่าสุด",
  "Outside": "นอกคอนโซล",
  "Outside changes are dated by the backup that revealed them, not by when they were made — a change is only seen once the next backup has been compared.": "การเปลี่ยนแปลงนอกคอนโซลนับวันตามแบ็กอัปที่พบ ไม่ใช่วันที่ถูกแก้จริง — จะเห็นการเปลี่ยนแปลงได้ก็ต่อเมื่อแบ็กอัปครั้งถัดไปถูกเปรียบเทียบแล้ว",
  "Outside the console": "นอกคอนโซล",
  "Centralize MGMT": "จัดการจากศูนย์กลาง",
  "Local MGMT": "จัดการที่ตัวอุปกรณ์",
  "Rejected writes": "การเขียนที่ถูกปฏิเสธ",
  "Reviewed": "ตรวจทานแล้ว",
  "Table": "ตาราง",
  "The comparison itself failed": "การเปรียบเทียบล้มเหลว",
  "This console": "คอนโซลนี้",
  "This firewall has never been analysed": "ไฟร์วอลล์นี้ยังไม่เคยถูกวิเคราะห์",
  "This was the device's first backup — there was nothing to compare it against.": "นี่คือแบ็กอัปแรกของอุปกรณ์ — จึงไม่มีอะไรให้เปรียบเทียบ",
  "Through this console": "ผ่านคอนโซลนี้",
  "Unaccounted for": "ระบุที่มาไม่ได้",
  "Unaccounted for and not yet reviewed": "ระบุที่มาไม่ได้และยังไม่ได้ตรวจทาน",
  "Un-acknowledge": "ยกเลิกการรับทราบ",
  "When": "เมื่อ",
  "Where changes land": "การเปลี่ยนแปลงเกิดที่ใด",
  "Could not compute the change analysis": "คำนวณการวิเคราะห์การเปลี่ยนแปลงไม่สำเร็จ",
  "Could not load this change's snapshots": "โหลดสแนปช็อตของการเปลี่ยนแปลงนี้ไม่สำเร็จ",
  "Could not load drift data": "โหลดข้อมูลคอนฟิกคลาดเคลื่อนไม่สำเร็จ",
  "Could not load that run": "โหลดการรันนั้นไม่สำเร็จ",
  "The analysis failed": "การวิเคราะห์ล้มเหลว",
  "Could not update the finding": "อัปเดตรายการไม่สำเร็จ",
  "1 change nobody here can account for": "มี 1 การเปลี่ยนแปลงที่ไม่มีใครในนี้ระบุที่มาได้",

  // -- Configuration Drift: one change history, fallback guide, restore dialog ----
  "All accounted for": "ระบุที่มาได้ทั้งหมด",
  "Backup comparison": "การเปรียบเทียบแบ็กอัป",
  "Backup comparisons": "ประวัติการเปรียบเทียบแบ็กอัป",
  "Backups are compared": "แบ็กอัปถูกนำมาเปรียบเทียบ",
  "Can I take a change back?": "ย้อนการเปลี่ยนแปลงได้ไหม?",
  "Can this be taken back?": "ย้อนรายการนี้ได้ไหม?",
  "Change history": "ประวัติการเปลี่ยนแปลง",
  "Changes made here are recorded": "ทุกการเปลี่ยนแปลงที่ทำในคอนโซลนี้ถูกบันทึก",
  "Changes made in Policy & Objects, Security Profiles, VPN and the other pages appear here as they happen; changes made elsewhere appear after the next backup comparison.": "การเปลี่ยนแปลงที่ทำในหน้า Policy & Objects, Security Profiles, VPN และหน้าอื่นๆ จะแสดงที่นี่ทันที ส่วนที่ทำจากที่อื่นจะแสดงหลังการเปรียบเทียบแบ็กอัปครั้งถัดไป",
  "Checking this backup…": "กำลังตรวจสอบแบ็กอัปนี้…",
  "Compare the two newest backups now": "เปรียบเทียบแบ็กอัปสองชุดล่าสุดตอนนี้",
  "Comparison failed": "การเปรียบเทียบล้มเหลว",
  "Could not read this backup": "อ่านแบ็กอัปนี้ไม่สำเร็จ",
  "Deleted from the firewall": "ลบออกจากไฟร์วอลล์แล้ว",
  "Each row is one comparison of a backup with the one before it. Outside changes in the history above come from these.": "แต่ละแถวคือการเปรียบเทียบแบ็กอัปหนึ่งชุดกับชุดก่อนหน้า รายการ “นอกคอนโซล” ในประวัติด้านบนมาจากตรงนี้",
  "Every change to this firewall — made in this console or outside it — and how to take it back": "ทุกการเปลี่ยนแปลงบนไฟร์วอลล์นี้ — ทั้งที่ทำในคอนโซลและนอกคอนโซล — และวิธีย้อนกลับ",
  "Every outside change has been reviewed": "ทุกการเปลี่ยนแปลงนอกคอนโซลได้รับการตรวจทานแล้ว",
  "Everything": "ทั้งหมด",
  "First backup — baseline": "แบ็กอัปแรก — ฐานอ้างอิง",
  "From": "จาก",
  "How this page works": "หน้านี้ทำงานอย่างไร",
  "It has already been undone.": "รายการนี้ถูกย้อนกลับไปแล้ว",
  "It has already been undone from this console — the object was deleted from the firewall.": "รายการนี้ถูกย้อนกลับจากคอนโซลแล้ว — อ็อบเจกต์ถูกลบออกจากไฟร์วอลล์",
  "It was already gone from the firewall": "อ็อบเจกต์นี้ไม่อยู่บนไฟร์วอลล์แล้ว",
  "I understand that": "ฉันเข้าใจว่า",
  "Kind of change": "ประเภทการเปลี่ยนแปลง",
  "Loading the details…": "กำลังโหลดรายละเอียด…",
  "Marked as reviewed": "ทำเครื่องหมายว่าตรวจทานแล้ว",
  "Mark reviewed": "ทำเครื่องหมายว่าตรวจทานแล้ว",
  "Needs review": "รอตรวจทาน",
  "Never compared": "ยังไม่เคยเปรียบเทียบ",
  "No.": "ไม่ได้",
  "No backup yet — take one from Devices before anything can be compared.": "ยังไม่มีแบ็กอัป — สร้างแบ็กอัปจากหน้า Devices ก่อน จึงจะเปรียบเทียบได้",
  "No change made outside the console has been found": "ยังไม่พบการเปลี่ยนแปลงที่ทำนอกคอนโซล",
  "No line detail was stored for this object.": "ไม่ได้เก็บรายละเอียดบรรทัดของอ็อบเจกต์นี้ไว้",
  "Nothing to undo — the firewall rejected this change, so it never applied.": "ไม่มีอะไรให้ย้อน — ไฟร์วอลล์ปฏิเสธการเปลี่ยนแปลงนี้ จึงไม่เคยมีผล",
  "Nothing waiting for review": "ไม่มีรายการรอตรวจทาน",
  "Other firewalls with unreviewed outside changes:": "ไฟร์วอลล์อื่นที่มีการเปลี่ยนแปลงนอกคอนโซลรอตรวจทาน:",
  "Outside changes": "มีการเปลี่ยนแปลงนอกคอนโซล",
  "Outside changes appear only after two backups have been compared": "การเปลี่ยนแปลงนอกคอนโซลจะแสดงหลังจากเปรียบเทียบแบ็กอัปสองชุดแล้วเท่านั้น",
  "Outside changes found": "พบการเปลี่ยนแปลงนอกคอนโซล",
  "Outside changes nobody has reviewed yet": "การเปลี่ยนแปลงนอกคอนโซลที่ยังไม่มีใครตรวจทาน",
  "“Outside the console” does not mean wrong — it means unrecorded. If it was expected, mark it reviewed and it stops counting as open. Undo, Restore and Mark reviewed are for admins.": "“นอกคอนโซล” ไม่ได้แปลว่าผิด — แปลว่าไม่มีบันทึก ถ้าเป็นสิ่งที่ตั้งใจไว้ ให้ทำเครื่องหมายว่าตรวจทานแล้ว รายการจะไม่ถูกนับว่ารอตรวจทานอีก ปุ่มย้อนกลับ กู้คืน และตรวจทาน ใช้ได้เฉพาะผู้ดูแลระบบ",
  "Reading the change history…": "กำลังอ่านประวัติการเปลี่ยนแปลง…",
  "Rejected by the device": "อุปกรณ์ปฏิเสธ",
  "Reopen": "เปิดใหม่",
  "Reopened": "เปิดรายการใหม่แล้ว",
  "Restore and reboot": "กู้คืนและรีบูต",
  "Restore anyway": "กู้คืนต่อไป",
  "Restore backup…": "กู้คืนแบ็กอัป…",
  "Restore configuration": "กู้คืนคอนฟิก",
  "Restoring…": "กำลังกู้คืน…",
  ". Restoring it is very likely to leave the unit unusable. Continue only if you know why the two differ.": " การกู้คืนมีโอกาสสูงที่จะทำให้เครื่องใช้งานไม่ได้ ดำเนินการต่อเฉพาะเมื่อคุณรู้ว่าทำไมทั้งสองจึงต่างกัน",
  "Show": "แสดง",
  "Show details": "แสดงรายละเอียด",
  "Size": "ขนาด",
  "Take a backup from Devices first": "สร้างแบ็กอัปจากหน้า Devices ก่อน",
  "Taken": "สร้างเมื่อ",
  "The device has not rejected any change": "อุปกรณ์ยังไม่เคยปฏิเสธการเปลี่ยนแปลงใด",
  "This backup cannot be restored.": "แบ็กอัปนี้กู้คืนไม่ได้",
  "This backup does not match this firewall.": "แบ็กอัปนี้ไม่ตรงกับไฟร์วอลล์นี้",
  "This device": "อุปกรณ์นี้",
  "This page lists every change to the selected firewall in one history — the ones made through this console and the ones made any other way — and tells you, for each, whether and how it can be taken back.": "หน้านี้แสดงทุกการเปลี่ยนแปลงของไฟร์วอลล์ที่เลือกไว้ในประวัติเดียว — ทั้งที่ทำผ่านคอนโซลนี้และที่ทำด้วยวิธีอื่น — และบอกว่าแต่ละรายการย้อนกลับได้หรือไม่ และทำอย่างไร",
  "Undo": "ย้อนกลับ",
  "Undone": "ย้อนกลับแล้ว",
  "Undone on the firewall": "ย้อนกลับบนไฟร์วอลล์แล้ว",
  "Undo, Restore and Mark reviewed are on the matching rows of the change history.": "ปุ่มย้อนกลับ กู้คืน และตรวจทาน อยู่ที่แถวที่ตรงกันในประวัติการเปลี่ยนแปลง",
  "Unrecorded changes are flagged": "การเปลี่ยนแปลงที่ไม่มีบันทึกจะถูกแจ้ง",
  "What changed in the backup": "สิ่งที่เปลี่ยนในแบ็กอัป",
  "What happens": "ผลที่เกิดขึ้น",
  "What will happen": "สิ่งที่จะเกิดขึ้น",
  "will reboot and that its current configuration will be replaced.": "จะรีบูต และคอนฟิกปัจจุบันจะถูกแทนที่",
  "Yes. This object was created outside the console, so undoing it deletes it from the firewall. The firewall refuses if something still uses it. The delete is recorded, so it can be undone too.": "ได้ อ็อบเจกต์นี้ถูกสร้างนอกคอนโซล การย้อนกลับจึงเป็นการลบออกจากไฟร์วอลล์ ไฟร์วอลล์จะปฏิเสธถ้ายังมีสิ่งอื่นใช้อยู่ การลบจะถูกบันทึกไว้ จึงย้อนกลับได้อีกครั้ง",
  "Yes. Undo deletes the object this change created. The undo is recorded here too.": "ได้ การย้อนกลับจะลบอ็อบเจกต์ที่การเปลี่ยนแปลงนี้สร้างขึ้น และการย้อนกลับจะถูกบันทึกไว้ที่นี่ด้วย",
  "Yes. Undo recreates the object with the values recorded before it was deleted. The undo is recorded here too.": "ได้ การย้อนกลับจะสร้างอ็อบเจกต์ขึ้นใหม่ด้วยค่าที่บันทึกไว้ก่อนถูกลบ และการย้อนกลับจะถูกบันทึกไว้ที่นี่ด้วย",
  "Yes. Undo writes back the values the object had before this change. The undo is recorded here too.": "ได้ การย้อนกลับจะเขียนค่าที่อ็อบเจกต์มีก่อนการเปลี่ยนแปลงนี้กลับไป และการย้อนกลับจะถูกบันทึกไว้ที่นี่ด้วย",
  "Not on its own — the console holds the deleted object only as lines in a backup, which cannot be recreated safely one object at a time. The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, every change made since is lost (including ones made here), and the firewall reboots. You see a preview first.": "ย้อนเฉพาะรายการนี้ไม่ได้ — คอนโซลมีอ็อบเจกต์ที่ถูกลบเพียงในรูปบรรทัดของแบ็กอัป ซึ่งสร้างกลับทีละอ็อบเจกต์อย่างปลอดภัยไม่ได้ ทางสำรองคือกู้คืนแบ็กอัปที่สร้างก่อนการเปลี่ยนแปลง: ไฟร์วอลล์ทั้งเครื่องจะกลับไปเป็นเหมือนตอนนั้น การเปลี่ยนแปลงทั้งหมดหลังจากนั้นจะหายไป (รวมถึงที่ทำในคอนโซลนี้) และไฟร์วอลล์จะรีบูต คุณจะเห็นตัวอย่างก่อนยืนยัน",
  "Not on its own — the console holds this object's earlier version only as lines in a backup, which cannot be put back safely one object at a time. The fallback is to restore the backup taken before the change: the whole firewall returns to that moment, every change made since is lost (including ones made here), and the firewall reboots. You see a preview first.": "ย้อนเฉพาะรายการนี้ไม่ได้ — คอนโซลมีค่าเดิมของอ็อบเจกต์นี้เพียงในรูปบรรทัดของแบ็กอัป ซึ่งใส่กลับทีละอ็อบเจกต์อย่างปลอดภัยไม่ได้ ทางสำรองคือกู้คืนแบ็กอัปที่สร้างก่อนการเปลี่ยนแปลง: ไฟร์วอลล์ทั้งเครื่องจะกลับไปเป็นเหมือนตอนนั้น การเปลี่ยนแปลงทั้งหมดหลังจากนั้นจะหายไป (รวมถึงที่ทำในคอนโซลนี้) และไฟร์วอลล์จะรีบูต คุณจะเห็นตัวอย่างก่อนยืนยัน",
  "Every write this console makes to a firewall — policies, objects, profiles, VPN — is saved with who made it, when, and the object before and after.": "ทุกการเขียนที่คอนโซลนี้ทำกับไฟร์วอลล์ — นโยบาย อ็อบเจกต์ โปรไฟล์ VPN — ถูกบันทึกว่าใครทำ เมื่อไร และค่าอ็อบเจกต์ก่อนและหลัง",
  "Each new backup is compared with the one before it, to find everything that changed on the firewall between the two.": "แบ็กอัปใหม่แต่ละชุดจะถูกเทียบกับชุดก่อนหน้า เพื่อหาทุกอย่างที่เปลี่ยนบนไฟร์วอลล์ระหว่างสองชุดนั้น",
  "A change no recorded write explains was made some other way — the CLI, the FortiGate's own GUI, FortiManager. It is listed as “Outside the console”.": "การเปลี่ยนแปลงที่ไม่มีบันทึกการเขียนใดอธิบายได้ ถูกทำด้วยวิธีอื่น — CLI, GUI ของ FortiGate เอง หรือ FortiManager — และแสดงเป็น “นอกคอนโซล”",
  "Made in this console": "ทำในคอนโซลนี้",
  "New object, made outside": "อ็อบเจกต์ใหม่ที่สร้างนอกคอนโซล",
  "Edit or delete, made outside": "การแก้ไขหรือลบที่ทำนอกคอนโซล",
  "Restore a backup": "กู้คืนแบ็กอัป",
  "Reverses exactly that change on the firewall, from what was recorded. The undo is recorded too.": "ย้อนการเปลี่ยนแปลงนั้นบนไฟร์วอลล์อย่างตรงตัวตามที่บันทึกไว้ และการย้อนกลับก็ถูกบันทึกด้วย",
  "Deletes that object from the firewall. Refused if something still uses it. The delete is recorded, so it can be undone as well.": "ลบอ็อบเจกต์นั้นออกจากไฟร์วอลล์ จะถูกปฏิเสธถ้ายังมีสิ่งอื่นใช้อยู่ การลบถูกบันทึกไว้ จึงย้อนกลับได้อีก",
  "Only the whole configuration can go back — to the backup taken before the change. Everything changed since is lost, and the firewall reboots. You see a preview first.": "ย้อนได้เฉพาะทั้งคอนฟิก — กลับไปที่แบ็กอัปที่สร้างก่อนการเปลี่ยนแปลง ทุกอย่างที่เปลี่ยนหลังจากนั้นจะหายไป และไฟร์วอลล์จะรีบูต คุณจะเห็นตัวอย่างก่อนยืนยัน",
  "Could not read the change history": "อ่านประวัติการเปลี่ยนแปลงไม่สำเร็จ",
  "Could not load the details": "โหลดรายละเอียดไม่สำเร็จ",
  "The undo failed": "การย้อนกลับล้มเหลว",
  "Could not update the change": "อัปเดตรายการไม่สำเร็จ",
  "Could not load the comparisons": "โหลดประวัติการเปรียบเทียบไม่สำเร็จ",
  "Could not load that comparison": "โหลดการเปรียบเทียบนั้นไม่สำเร็จ",
  "The comparison failed": "การเปรียบเทียบล้มเหลว",
  "made through this console — undo it from its Change Ledger entry": "ทำผ่านคอนโซลนี้ — ให้ย้อนกลับจากรายการในสมุดบันทึกการเปลี่ยนแปลง",
  "already undone from this console": "ถูกย้อนกลับจากคอนโซลนี้แล้ว",
  "an edit made outside the console cannot be undone object by object — restore the backup taken before it": "การแก้ไขที่ทำนอกคอนโซลย้อนทีละอ็อบเจกต์ไม่ได้ — ให้กู้คืนแบ็กอัปที่สร้างก่อนหน้านั้น",
  "an object deleted outside the console cannot be recreated object by object — restore the backup taken before it": "อ็อบเจกต์ที่ถูกลบนอกคอนโซลสร้างกลับทีละอ็อบเจกต์ไม่ได้ — ให้กู้คืนแบ็กอัปที่สร้างก่อนหน้านั้น",
  "unknown kind of change": "ไม่ทราบประเภทการเปลี่ยนแปลง",
  "the object has no key, and a delete without one would clear the whole table": "อ็อบเจกต์นี้ไม่มีคีย์ และการลบโดยไม่มีคีย์จะล้างทั้งตาราง",
  "the FortiOS table could not be worked out from the backup": "ระบุตาราง FortiOS จากแบ็กอัปไม่ได้",
  "deletes this object from the firewall; refused if something still uses it": "ลบอ็อบเจกต์นี้ออกจากไฟร์วอลล์ จะถูกปฏิเสธถ้ายังมีสิ่งอื่นใช้อยู่",

  // -- Configuration Drift: what each number and the comparison mean -----------
  "Changes this console wrote to the firewall that took effect in the window — from any page or the AI Assistant. Changes that were later undone still count: they did apply.": "การเปลี่ยนแปลงที่คอนโซลนี้เขียนลงไฟร์วอลล์และมีผลจริงในช่วงเวลาที่เลือก — จากทุกหน้าหรือจาก AI Assistant รายการที่ถูกย้อนกลับภายหลังก็นับด้วย เพราะเคยมีผลแล้ว",
  "Objects that changed on the firewall with no record in this console — made through the CLI, the FortiGate's own GUI, FortiManager or another tool. Found by comparing backups, and dated by the backup that revealed them.": "อ็อบเจกต์ที่เปลี่ยนบนไฟร์วอลล์โดยไม่มีบันทึกในคอนโซลนี้ — ทำผ่าน CLI, GUI ของ FortiGate เอง, FortiManager หรือเครื่องมืออื่น พบจากการเปรียบเทียบแบ็กอัป และนับวันตามแบ็กอัปที่พบ",
  "Outside changes nobody has looked at yet. Mark one reviewed, or undo it, and it leaves this count. Counts all time, not only the window.": "การเปลี่ยนแปลงนอกคอนโซลที่ยังไม่มีใครตรวจดู เมื่อทำเครื่องหมายว่าตรวจทานแล้วหรือย้อนกลับ รายการจะออกจากตัวเลขนี้ นับตลอดเวลา ไม่ใช่เฉพาะช่วงเวลาที่เลือก",
  "Changes this console tried to make that the firewall refused — an invalid value, a missing object, a duplicate name. They never changed the device, so they are not counted as changes.": "การเปลี่ยนแปลงที่คอนโซลนี้พยายามทำแต่ไฟร์วอลล์ปฏิเสธ — ค่าไม่ถูกต้อง อ็อบเจกต์ไม่มีอยู่ หรือชื่อซ้ำ ไม่เคยเปลี่ยนอุปกรณ์ จึงไม่ถูกนับเป็นการเปลี่ยนแปลง",
  "Every backup reads the firewall's whole configuration. The console compares it with the previous backup, subtracts the changes it recorded itself, and lists whatever is left as “Outside the console”. It runs by itself after each backup; Compare now runs it on the two newest backups straight away.": "ทุกครั้งที่แบ็กอัป ระบบจะอ่านคอนฟิกทั้งหมดของไฟร์วอลล์ แล้วเทียบกับแบ็กอัปครั้งก่อน หักการเปลี่ยนแปลงที่คอนโซลบันทึกไว้เองออก ส่วนที่เหลือจะแสดงเป็น “นอกคอนโซล” ทำงานเองหลังทุกแบ็กอัป ส่วนปุ่ม Compare now จะเทียบแบ็กอัปสองชุดล่าสุดทันที",

  // -- Audit: ISO/IEC 27001 control view -------------------------------------------
  "Annex A control by control: what this scan evidences, and what it does not assess at all":
    "Annex A ทีละการควบคุม: สิ่งที่การสแกนนี้เป็นหลักฐานได้ และสิ่งที่ไม่ได้ประเมินเลย",
  "Speaks to — ISO/IEC 27001 Annex A, our mapping": "เกี่ยวข้องกับ — ISO/IEC 27001 Annex A ตามการจับคู่ของเรา",
  "Why these controls:": "ทำไมจึงเป็นการควบคุมเหล่านี้:",
  "(our reading)": "(ตามการตีความของเรา)",
  "partial": "บางส่วน",
  "The correspondence covers part of the Annex A control, not all of it": "การจับคู่นี้ครอบคลุมเพียงบางส่วนของการควบคุมใน Annex A ไม่ใช่ทั้งหมด",
  "NIST SP 800-53 Rev. 5 · public domain": "NIST SP 800-53 Rev. 5 · สาธารณสมบัติ",
  "NIST's discussion of it": "คำอธิบายของ NIST",
  "— the authoritative wording ↗": "— ถ้อยคำฉบับทางการ ↗",
  "Hide what is wrong": "ซ่อนสิ่งที่ผิด",
  "What this control asks for": "สิ่งที่การควบคุมนี้กำหนด",
  "Hide what this control asks for": "ซ่อนสิ่งที่การควบคุมนี้กำหนด",
  "How to close this": "วิธีปิดข้อนี้",
  "The remediation panel": "แผงแนวทางแก้ไข",
  "are part of that list on purpose, so that what was checked can be read against what was not. This console assesses ISO/IEC 27001 and no other standard, so nothing on this page speaks to PCI DSS, NIST or the firewall's own vendor rating.":
    "อยู่ในรายการนั้นโดยตั้งใจ เพื่อให้อ่านสิ่งที่ตรวจเทียบกับสิ่งที่ไม่ได้ตรวจได้ คอนโซลนี้ประเมินเฉพาะ ISO/IEC 27001 ไม่มีมาตรฐานอื่น จึงไม่มีส่วนใดในหน้านี้ที่พูดถึง PCI DSS, NIST หรือคะแนนของผู้ผลิตไฟร์วอลล์เอง",
  "controls": "การควบคุม",

  // -- Audit: remediation steps ------------------------------------------------------
  "How to close": "วิธีปิด",
  "Re-reading the firewall and working out the plan…": "กำลังอ่านไฟร์วอลล์ใหม่และวางแผน…",
  "Running every step below would close this control": "ถ้าทำทุกขั้นตอนด้านล่าง การควบคุมนี้จะปิดได้",
  "Running every step below would not close this control on its own": "ทำทุกขั้นตอนด้านล่างแล้วก็ยังปิดการควบคุมนี้ไม่ได้ด้วยตัวเอง",
  "There is nothing to fix on this control": "การควบคุมนี้ไม่มีอะไรต้องแก้",
  "Steps": "ขั้นตอน",
  "checked against": "ตรวจเทียบกับ",
  "Says who": "อ้างอิงจากใคร",
  "Copied — review it before you run it": "คัดลอกแล้ว — ตรวจทานก่อนนำไปรัน",
  "This took longer than the request was allowed. The scan, the schema reads and the model call together can run to half a minute on a busy firewall — try again.":
    "ใช้เวลานานเกินกว่าที่คำขออนุญาต การสแกน การอ่าน schema และการเรียกโมเดลรวมกันอาจใช้ถึงครึ่งนาทีบนไฟร์วอลล์ที่งานเยอะ — ลองอีกครั้ง",
  "This firewall's own schema confirms the attribute and accepts this value": "schema ของไฟร์วอลล์นี้ยืนยันแอตทริบิวต์และรับค่านี้",
  "attribute verified": "ยืนยันแอตทริบิวต์แล้ว",
  "The attribute exists on this firmware. Its value is not one the schema enumerates — a name, a number, an address — so the value is yours to choose":
    "แอตทริบิวต์นี้มีอยู่ในเฟิร์มแวร์นี้ ค่าของมันไม่ใช่ค่าที่ schema ระบุไว้ — อาจเป็นชื่อ ตัวเลข หรือแอดเดรส — จึงให้คุณเป็นผู้เลือกค่า",
  "table verified": "ยืนยันตารางแล้ว",
  "The table exists on this device. A delete or a move writes no attribute, so there is nothing further to check":
    "ตารางนี้มีอยู่บนอุปกรณ์ การลบหรือย้ายไม่ได้เขียนแอตทริบิวต์ใด จึงไม่มีอะไรต้องตรวจเพิ่ม",
  "not in this firmware": "ไม่มีในเฟิร์มแวร์นี้",
  "This device publishes no such attribute — the command would not do what it says. Check it before running it":
    "อุปกรณ์นี้ไม่มีแอตทริบิวต์นี้ — คำสั่งจะไม่ทำงานตามที่เขียนไว้ ตรวจสอบก่อนรัน",
  "value not accepted": "ค่าที่ไม่รับ",
  "The attribute exists but this device does not list this value among the ones it accepts":
    "แอตทริบิวต์นี้มีอยู่ แต่อุปกรณ์ไม่ได้ระบุค่านี้ไว้ในค่าที่รับ",
  "could not check": "ตรวจไม่ได้",
  "This device did not answer the schema request, so the command was not checked against its firmware":
    "อุปกรณ์นี้ไม่ตอบคำขอ schema คำสั่งจึงไม่ได้ถูกตรวจเทียบกับเฟิร์มแวร์",
  "accepts:": "รับค่า:",
  "already accepted": "ยอมรับแล้ว",
  "advisory": "คำแนะนำ",
  "Clutter rather than exposure. Fixing it moves an observation, never a gap.":
    "เป็นความรกมากกว่าช่องโหว่ การแก้จะย้ายข้อสังเกต ไม่ได้ปิดช่องว่างใด",
  "more": "รายการ",

  // -- Audit: applying a remediation ---------------------------------------------------
  "Fix this with AI help": "แก้ข้อนี้โดยให้ AI ช่วย",
  "Before it writes anything": "ก่อนเขียนอะไรลงเครื่อง",
  "value": "ค่า",
  "cannot be chosen for you — a wrong one here changes who can reach this firewall.":
    "ที่ระบบเลือกแทนคุณไม่ได้ — ถ้าเลือกผิด จะเปลี่ยนว่าใครเข้าถึงไฟร์วอลล์นี้ได้",
  "Exactly what would be written": "สิ่งที่จะถูกเขียนทั้งหมด",
  "— replaces": "— แทนที่",
  "waiting on:": "รอค่า:",
  "Not done from here": "ไม่ได้ทำจากที่นี่",
  "This device did not confirm the command for": "อุปกรณ์นี้ไม่ได้ยืนยันคำสั่งสำหรับ",
  ". Apply it anyway.": " — ปรับใช้ต่อไปอยู่ดี",
  "Asking the AI what this changes…": "กำลังถาม AI ว่าสิ่งนี้เปลี่ยนอะไร…",
  "Once done —": "เมื่อเสร็จแล้ว —",
  "Confirm and write to": "ยืนยันและเขียนลง",
  "this firewall": "ไฟร์วอลล์นี้",
  "The firewall took too long to answer — try again.": "ไฟร์วอลล์ตอบช้าเกินไป — ลองอีกครั้ง",
  "This takes effect immediately on the live device. Each change is recorded with what it replaced, so it can be put back from here or from the Change Ledger.":
    "มีผลทันทีบนอุปกรณ์จริง ทุกการเปลี่ยนแปลงถูกบันทึกพร้อมค่าเดิม จึงคืนค่าได้จากที่นี่หรือจากสมุดบันทึกการเปลี่ยนแปลง",
  "Write it": "เขียนลงเครื่อง",
  "Write 1 change to this firewall?": "เขียนการเปลี่ยนแปลง 1 รายการลงไฟร์วอลล์นี้?",
  "Put 1 change back?": "คืนค่าการเปลี่ยนแปลง 1 รายการ?",
  "Each object is restored to the snapshot taken just before it was written, newest first. This is itself a change to the live firewall and is recorded as one.":
    "แต่ละอ็อบเจกต์จะถูกคืนค่าเป็น snapshot ที่เก็บไว้ก่อนเขียน เริ่มจากรายการล่าสุด การคืนค่านี้เองก็เป็นการเปลี่ยนแปลงบนไฟร์วอลล์จริงและถูกบันทึกไว้ด้วย",
  "Restore it": "คืนค่า",
  "Put back": "คืนค่า",
  "Put it back": "คืนค่ากลับ",
  "change": "รายการ",
  "written": "เขียนแล้ว",
  "Every one is in the Change Ledger with what it replaced. Rescan to see the control move.":
    "ทุกรายการอยู่ในสมุดบันทึกการเปลี่ยนแปลงพร้อมค่าเดิม สแกนใหม่เพื่อดูว่าการควบคุมเปลี่ยนสถานะ",

  // -- Configuration Drift: an outside change is either still in place, or undone ------
  "Still in place": "ยังมีอยู่บนอุปกรณ์",
  "Other firewalls with outside changes still in place:":
    "ไฟร์วอลล์อื่นที่มีการเปลี่ยนนอกคอนโซลค้างอยู่:",
  "Undo and Restore are on the matching rows of the change history.":
    "ปุ่มย้อนกลับและกู้คืนอยู่ที่แถวที่ตรงกันในประวัติการเปลี่ยนแปลง",
  "“Outside the console” does not mean wrong — it means unrecorded. A change stays listed as still in place until it is actually taken back, so an expected one stays on the list too. Undo and Restore are for admins.":
    "“นอกคอนโซล” ไม่ได้แปลว่าผิด — แปลว่าไม่มีบันทึก รายการจะขึ้นว่ายังมีอยู่บนอุปกรณ์จนกว่าจะถูกย้อนกลับจริง ดังนั้นรายการที่ตั้งใจทำเองก็จะค้างอยู่ในรายการเช่นกัน ปุ่มย้อนกลับและกู้คืนใช้ได้เฉพาะผู้ดูแลระบบ",

  // -- Configuration Drift: who made a change the console did not make --------------
  "What the firewall logged": "สิ่งที่ไฟร์วอลล์บันทึกไว้",
  "Connected from": "เชื่อมมาจาก",
  "Values changed": "ค่าที่เปลี่ยน",
  "and one more change to it": "และมีการเปลี่ยนอีก 1 ครั้ง",
  "The firewall's log no longer goes back this far":
    "ล็อกของไฟร์วอลล์ย้อนกลับไม่ถึงช่วงเวลานี้แล้ว",
  "The firewall's log covers this time and names nobody":
    "ล็อกของไฟร์วอลล์ครอบช่วงเวลานี้ แต่ไม่มีชื่อใคร",
  "The firewall records every API call as “GUI” as well, so that word means the web interface or a tool — the address is what tells them apart.":
    "ไฟร์วอลล์บันทึกทุกการเรียก API เป็น “GUI” ด้วย คำนี้จึงหมายถึงหน้าเว็บหรือเครื่องมือก็ได้ — สิ่งที่แยกได้คือหมายเลข IP",
  "For a change made outside, the firewall itself is asked who made it — the account, the way in, and the address they came from. It keeps those records in memory only, so an older change says the log no longer goes back that far instead of naming nobody.":
    "สำหรับการเปลี่ยนที่ทำนอกคอนโซล ระบบจะถามไฟร์วอลล์เองว่าใครเป็นคนทำ — ทั้งบัญชี ช่องทางที่เข้า และหมายเลขต้นทาง แต่ไฟร์วอลล์เก็บบันทึกเหล่านี้ไว้ในหน่วยความจำเท่านั้น รายการเก่าจึงขึ้นว่าล็อกย้อนไม่ถึง แทนที่จะบอกว่าไม่มีใครทำ",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Hits over time": "จำนวนครั้งที่ตรงกฎตามช่วงเวลา",
  "Matches per five-minute sample — the device itself keeps no history of these": "จำนวนครั้งที่ตรงกฎต่อการเก็บค่าหนึ่งครั้ง (ทุกห้านาที) — ตัวอุปกรณ์ไม่ได้เก็บประวัติส่วนนี้ไว้",
  "No hits recorded in this window. If the console was restarted recently, history starts from then.": "ไม่มีการตรงกฎถูกบันทึกไว้ในช่วงเวลานี้ ถ้าเพิ่งรีสตาร์ตคอนโซลไป ประวัติจะเริ่มนับจากตอนนั้น",

  // -- Security Posture Score (dashboard tile) --------------------------------
  "Security Posture Score": "คะแนนความปลอดภัยโดยรวม",
  "Security Posture Score — open Audit / Review": "คะแนนความปลอดภัยโดยรวม — เปิดหน้า Audit / Review",
  "Not scanned yet": "ยังไม่เคยสแกน",
  "controls assessed": "ข้อควบคุมที่ประเมินแล้ว",
  "Open Audit / Review": "เปิดหน้า Audit / Review",

  "No channel — go back and pick one": "ยังไม่ได้เลือกช่องทาง — ย้อนกลับไปเลือกก่อน",
  "changes": "การเปลี่ยนแปลง",
};
