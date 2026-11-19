/**
 * Thai — SD-WAN: zones, interface members, rules and performance SLAs.
 *
 * "SLA" stays as it is throughout. It is the name of the object on the device (`health-check`, seen
 * as SLA everywhere in the GUI), the rules refer to one by `<name>#<number>`, and there is no Thai
 * expansion that would still let someone match this screen against `diagnose sys sdwan health-check`.
 *
 * Zone / member / rule are translated (โซน / สมาชิก / กฎ) because those are ordinary nouns here and
 * nothing downstream is keyed on the English.
 */
import type { Dict } from "../merge";

export const sdwan: Dict = {
  // -- Sections --------------------------------------------------------------
  "SD-WAN Zones": "โซน SD-WAN",
  "SD-WAN Rules": "กฎ SD-WAN",
  "SD-WAN view": "มุมมอง SD-WAN",
  "All SD-WAN Members": "สมาชิก SD-WAN ทั้งหมด",
  "Interface members": "สมาชิกอินเทอร์เฟซ",
  "Performance SLAs": "SLA ประสิทธิภาพ",
  "performance SLAs": "SLA ประสิทธิภาพ",
  "performance SLA": "SLA ประสิทธิภาพ",
  Member: "สมาชิก",
  Rule: "กฎ",
  "The zones, members and rules this FortiGate steers WAN traffic with":
    "โซน สมาชิก และกฎที่ FortiGate เครื่องนี้ใช้กำหนดทิศทางทราฟฟิก WAN",

  // -- CRUD ------------------------------------------------------------------
  "Edit zone": "แก้ไขโซน",
  "Delete zone": "ลบโซน",
  "Edit member": "แก้ไขสมาชิก",
  "Delete member": "ลบสมาชิก",
  "Edit performance SLA": "แก้ไข SLA ประสิทธิภาพ",
  "Delete performance SLA": "ลบ SLA ประสิทธิภาพ",
  "SD-WAN zone deleted": "ลบโซน SD-WAN แล้ว",
  "SD-WAN member deleted": "ลบสมาชิก SD-WAN แล้ว",
  "SD-WAN rule deleted": "ลบกฎ SD-WAN แล้ว",
  "Performance SLA deleted": "ลบ SLA ประสิทธิภาพแล้ว",
  "The device refused the delete": "อุปกรณ์ปฏิเสธการลบ",
  "Search members": "ค้นหาสมาชิก",
  "Filter members": "กรองสมาชิก",
  "No performance SLA matches that search": "ไม่มี SLA ประสิทธิภาพที่ตรงกับคำค้นนั้น",
  "No results": "ไม่มีผลลัพธ์",
  "No entries": "ไม่มีรายการ",
  "No member chosen yet": "ยังไม่ได้เลือกสมาชิก",
  "Every interface on this device is already an SD-WAN member.":
    "อินเทอร์เฟซทุกตัวบนอุปกรณ์นี้เป็นสมาชิก SD-WAN อยู่แล้ว",
  "There are no SD-WAN members on this device yet. Create one first, then it can be moved into a zone.":
    "อุปกรณ์นี้ยังไม่มีสมาชิก SD-WAN เลย ให้สร้างสักรายการก่อน แล้วจึงย้ายเข้าโซนได้",
  "These members point at a zone that no longer exists":
    "สมาชิกเหล่านี้ชี้ไปยังโซนที่ไม่มีอยู่แล้ว",
  "A member's zone is stored on the member, so unticking one here moves it back to":
    "โซนของสมาชิกถูกเก็บไว้ที่ตัวสมาชิกเอง การเอาเครื่องหมายถูกออกที่นี่จึงเป็นการย้ายสมาชิกกลับไปยัง",
  "rather than leaving it without a zone.": "แทนที่จะปล่อยให้ไม่มีโซน",
  ". An SD-WAN rule that still selects on it will block the delete.":
    " กฎ SD-WAN ที่ยังเลือกใช้อยู่จะทำให้ลบไม่ได้",
  "will be removed from": "จะถูกเอาออกจาก",
  ") will be removed from": ") จะถูกเอาออกจาก",
  "here. Use": "ที่นี่ ใช้",
  "No hyphens: the firewall reserves": "ห้ามใช้เครื่องหมายขีด: ไฟร์วอลล์สงวน",
  ", as its own Default_AWS does.": " ไว้ เช่นเดียวกับที่ Default_AWS ของระบบใช้",
  "At least one is required, and the firewall will not let the last one be removed.":
    "ต้องมีอย่างน้อยหนึ่งรายการ และไฟร์วอลล์จะไม่ยอมให้ลบรายการสุดท้ายออก",

  // -- Selection strategy ----------------------------------------------------
  "Interface selection strategy": "กลยุทธ์การเลือกอินเทอร์เฟซ",
  "Interface preference": "ลำดับความสำคัญของอินเทอร์เฟซ",
  "Zone preference": "ลำดับความสำคัญของโซน",
  "Outgoing Interfaces": "อินเทอร์เฟซขาออก",
  "Manually assign outgoing members.": "กำหนดสมาชิกขาออกด้วยตนเอง",
  "Load balancing": "การกระจายโหลด",
  "Load balance:": "กระจายโหลด:",
  "The member that meets SLA targets is selected. On a tie, the lowest cost wins.":
    "ระบบจะเลือกสมาชิกที่ผ่านเป้าหมาย SLA หากเสมอกัน สมาชิกที่มีค่าใช้จ่ายต่ำสุดจะชนะ",
  "The member with the best measured performance is selected.":
    "ระบบจะเลือกสมาชิกที่วัดประสิทธิภาพได้ดีที่สุด",
  "Traffic is load balanced among members that meet SLA targets.":
    "ทราฟฟิกจะถูกกระจายโหลดในหมู่สมาชิกที่ผ่านเป้าหมาย SLA",
  "Lower wins when several members are equal.":
    "ค่าที่ต่ำกว่าจะชนะเมื่อสมาชิกหลายรายเท่ากัน",
  "Quality criteria": "เกณฑ์คุณภาพ",
  Criteria: "เกณฑ์",
  "Required SLA target": "เป้าหมาย SLA ที่ต้องผ่าน",
  "SLA Target": "เป้าหมาย SLA",
  "SLA targets": "เป้าหมาย SLA",
  "Measured SLA": "SLA ที่วัดได้",
  "Add another SLA target": "เพิ่มเป้าหมาย SLA อีกรายการ",
  "Remove this SLA target": "ลบเป้าหมาย SLA นี้",
  "Remove this server": "ลบเซิร์ฟเวอร์นี้",
  "This SLA target also selects on MOS": "เป้าหมาย SLA นี้เลือกโดยใช้ค่า MOS ด้วย",
  ", which the FortiGate dialog does not expose. It is kept as it is.":
    " ซึ่งหน้าต่างของ FortiGate ไม่ได้แสดงไว้ ระบบจึงคงค่านี้ไว้ตามเดิม",
  "An SD-WAN rule selects on one of these by number — the pair it stores is <this SLA>#<number>.":
    "กฎ SD-WAN จะเลือกใช้รายการใดรายการหนึ่งเหล่านี้ด้วยหมายเลข — คู่ค่าที่เก็บไว้คือ <SLA นี้>#<หมายเลข>",
  "+ the implicit fallback": "+ การสำรองโดยปริยาย",
  Implicit: "โดยปริยาย",

  // -- Health check ----------------------------------------------------------
  "Detect Server": "เซิร์ฟเวอร์ที่ใช้ตรวจสอบ",
  "Check interval": "ช่วงเวลาตรวจสอบ",
  "Failure Threshold": "เกณฑ์ความล้มเหลว",
  "Recovery Threshold": "เกณฑ์การกู้คืน",
  "Failures before inactive": "จำนวนครั้งที่ล้มเหลวก่อนถือว่าไม่พร้อมใช้งาน",
  "Restore link after": "คืนสถานะลิงก์หลังจาก",
  "Actions when Inactive": "การกระทำเมื่อไม่พร้อมใช้งาน",
  "Link Status": "สถานะลิงก์",
  "Consecutive missed probes before the member is taken out of service.":
    "จำนวนครั้งติดต่อกันที่ไม่ได้รับการตอบกลับ ก่อนที่สมาชิกจะถูกนำออกจากการใช้งาน",
  "Consecutive good probes before the member is used again.":
    "จำนวนครั้งติดต่อกันที่ตอบกลับปกติ ก่อนที่สมาชิกจะถูกนำกลับมาใช้งาน",
  "The firewall sends its own probes to the server and measures the replies.":
    "ไฟร์วอลล์จะส่งแพ็กเก็ตตรวจสอบของตัวเองไปยังเซิร์ฟเวอร์แล้ววัดผลจากคำตอบ",
  "Nothing is sent: quality is inferred from the traffic already crossing the member.":
    "ไม่มีการส่งอะไรออกไป: คุณภาพถูกอนุมานจากทราฟฟิกที่วิ่งผ่านสมาชิกอยู่แล้ว",
  "Measure live traffic where there is some, and fall back to active probes where there is not.":
    "วัดจากทราฟฟิกจริงเมื่อมีทราฟฟิก และถอยไปใช้การส่งแพ็กเก็ตตรวจสอบเมื่อไม่มี",
  "Passive mode judges the link from traffic that is already flowing, so it has no probe server and no Link Status thresholds — the firewall discards those settings rather than storing them.":
    "โหมดพาสซีฟตัดสินสถานะลิงก์จากทราฟฟิกที่วิ่งอยู่แล้ว จึงไม่มีเซิร์ฟเวอร์ตรวจสอบและไม่มีเกณฑ์สถานะลิงก์ — ไฟร์วอลล์จะทิ้งการตั้งค่าเหล่านั้นไป ไม่ได้เก็บไว้",
  "Withdraw the static routes that leave by a member the moment this check declares it dead, so traffic reroutes instead of being blackholed.":
    "ถอนเส้นทางสแตติกที่ออกทางสมาชิกรายนั้นทันทีที่การตรวจสอบนี้ประกาศว่าใช้งานไม่ได้ เพื่อให้ทราฟฟิกเปลี่ยนเส้นทางแทนที่จะถูกทิ้งลง blackhole",
  "Update static route": "อัปเดตเส้นทางสแตติก",

  // -- Metrics ---------------------------------------------------------------
  Latency: "ความหน่วง",
  Jitter: "ความแปรปรวนของความหน่วง",
  "Packet Loss": "อัตราการสูญหายของแพ็กเก็ต",
  Bandwidth: "แบนด์วิดท์",
  Upload: "อัปโหลด",
  Volume: "ปริมาณข้อมูล",
  "Active Sessions": "เซสชันที่ใช้งานอยู่",
  "Bytes Sent": "ไบต์ที่ส่ง",
  "Bytes Received": "ไบต์ที่รับ",
  "received,": "รับแล้ว,",
  "Hit Count": "จำนวนครั้งที่ตรงกัน",
  "Last Used": "ใช้ล่าสุด",
  Participants: "ผู้เข้าร่วม",

  // -- Rule matching ---------------------------------------------------------
  "Internet service": "อินเทอร์เน็ตเซอร์วิส",
  "internet services": "อินเทอร์เน็ตเซอร์วิส",
  "Match on internet service instead of a destination address":
    "จับคู่ด้วยอินเทอร์เน็ตเซอร์วิสแทนแอดเดรสปลายทาง",
  "Ignored while an internet service is selected — the device stores one or the other.":
    "ระบบจะไม่สนใจค่านี้ขณะที่เลือกอินเทอร์เน็ตเซอร์วิสไว้ — อุปกรณ์เก็บได้อย่างใดอย่างหนึ่งเท่านั้น",
  "Route tag": "แท็กเส้นทาง",
  "Forward DSCP": "DSCP ขาไป",
  "Reverse DSCP": "DSCP ขากลับ",
  "User group": "กลุ่มผู้ใช้",
  "user groups": "กลุ่มผู้ใช้",
  "· currently in": "· ปัจจุบันอยู่ใน",
  "(seq": "(ลำดับ",
  "(id": "(id",
  "At most": "ไม่เกิน",
  Optional: "ไม่บังคับ",
  None: "ไม่มี",
  Specify: "ระบุเอง",
  Port: "พอร์ต",

  // -- DNS -------------------------------------------------------------------
  "DNS Server": "เซิร์ฟเวอร์ DNS",
  "Primary DNS Server": "เซิร์ฟเวอร์ DNS หลัก",
  "Secondary DNS Server": "เซิร์ฟเวอร์ DNS สำรอง",
  "Same as System DNS": "เหมือนกับ DNS ของระบบ",
  "(System DNS)": "(DNS ของระบบ)",
  "Leave 0.0.0.0 on an interface that learns its gateway (DHCP or PPPoE).":
    "ปล่อยเป็น 0.0.0.0 สำหรับอินเทอร์เฟซที่เรียนรู้เกตเวย์เอง (DHCP หรือ PPPoE)",

  // -- Field hints -----------------------------------------------------------
  "e.g. branch-wan": "เช่น branch-wan",
  "e.g. 000010": "เช่น 000010",
  "— the field itself holds two values and the device refuses a third.":
    "— ฟิลด์นี้เก็บได้สองค่า และอุปกรณ์จะปฏิเสธค่าที่สาม",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Auto": "อัตโนมัติ",
  "Link down": "ลิงก์ดาวน์",
  "New Performance SLA": "สร้าง Performance SLA ใหม่",
  "New Priority Rule": "สร้างกฎลำดับความสำคัญใหม่",
  "New SD-WAN Member": "เพิ่มสมาชิก SD-WAN",
  "New SD-WAN Zone": "สร้างโซน SD-WAN ใหม่",
  "No entry matches that filter": "ไม่มีรายการที่ตรงกับตัวกรองนั้น",
  "No member matches that filter": "ไม่มีสมาชิกที่ตรงกับตัวกรองนั้น",
  "SD-WAN member": "สมาชิก SD-WAN",
  "The device did not report this interface": "อุปกรณ์ไม่ได้รายงานอินเทอร์เฟซนี้",
  "The device rejected the change": "อุปกรณ์ปฏิเสธการเปลี่ยนแปลงนี้",
  "The device rejected the performance SLA": "อุปกรณ์ปฏิเสธ Performance SLA นี้",
  "The device rejected the rule": "อุปกรณ์ปฏิเสธกฎนี้",
  "There are no SD-WAN members on this device yet": "อุปกรณ์นี้ยังไม่มีสมาชิก SD-WAN",
  "This firewall reports no per-member session counts.": "ไฟร์วอลล์นี้ไม่รายงานจำนวนเซสชันแยกรายสมาชิก",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "FortiOS 7.2 does not expose SD-WAN rule hit counters over the REST API": "FortiOS 7.2 ไม่เปิดเผยตัวนับการใช้งานกฎ SD-WAN ผ่าน REST API",
  "The firewall reports measurements only while SD-WAN is enabled and probing.": "ไฟร์วอลล์จะรายงานค่าที่วัดได้เฉพาะขณะที่ SD-WAN เปิดใช้งานและกำลังตรวจวัดอยู่",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "Enter a name": "กรอกชื่อ",
  "The name is limited to 35 characters": "ชื่อยาวได้ไม่เกิน 35 ตัวอักษร",
  "An SLA number must be 1-32": "หมายเลข SLA ต้องอยู่ระหว่าง 1-32",
  "An SLA target needs at least one threshold turned on": "เป้าหมาย SLA ต้องเปิดเกณฑ์อย่างน้อยหนึ่งข้อ",
  "Two SLA targets cannot share the same number": "เป้าหมาย SLA สองรายการใช้หมายเลขเดียวกันไม่ได้",
  "This strategy needs at least one required SLA target": "กลยุทธ์นี้ต้องมีเป้าหมาย SLA ที่จำเป็นอย่างน้อยหนึ่งรายการ",
  "Best quality needs a measured SLA": "โหมดคุณภาพดีที่สุดต้องมี SLA ที่วัดผลได้",
  "A performance SLA name cannot contain a hyphen — the firewall reserves it (try an underscore)": "ชื่อ Performance SLA มีเครื่องหมายยัติภังค์ไม่ได้ — ไฟร์วอลล์สงวนไว้ (ลองใช้ขีดล่างแทน)",
  "A server address cannot contain spaces or quotes": "แอดเดรสของเซิร์ฟเวอร์มีช่องว่างหรือเครื่องหมายคำพูดไม่ได้",
  "Enter a server to probe, or choose DNS with Same as System DNS": "กรอกเซิร์ฟเวอร์ที่จะตรวจวัด หรือเลือก DNS พร้อมตัวเลือก Same as System DNS",
  "Choose a destination address, or select an internet service": "เลือกแอดเดรสปลายทาง หรือเลือกบริการอินเทอร์เน็ต",
  "Choose at least one internet service": "เลือกบริการอินเทอร์เน็ตอย่างน้อยหนึ่งรายการ",
  "Choose at least one outgoing interface or zone": "เลือกอินเทอร์เฟซขาออกหรือโซนอย่างน้อยหนึ่งรายการ",
  "Failures before inactive must be 1-3600": "จำนวนครั้งที่ล้มเหลวก่อนถือว่าไม่ทำงานต้องอยู่ระหว่าง 1-3600",
  "Restore link after must be 1-3600 checks": "จำนวนครั้งที่ต้องผ่านก่อนคืนสถานะลิงก์ต้องอยู่ระหว่าง 1-3600 ครั้ง",
  "The check interval must be 20-3600000 ms": "ช่วงเวลาตรวจต้องอยู่ระหว่าง 20-3600000 มิลลิวินาที",
  "The jitter threshold cannot be negative": "เกณฑ์ jitter ติดลบไม่ได้",
  "The latency threshold cannot be negative": "เกณฑ์ latency ติดลบไม่ได้",
  "The packet loss threshold must be 0-100%": "เกณฑ์การสูญหายของแพ็กเก็ตต้องอยู่ระหว่าง 0-100%",
  "The start port cannot be above the end port": "พอร์ตเริ่มต้นต้องไม่มากกว่าพอร์ตสิ้นสุด",
  "Forward DSCP is on but has no tag": "เปิด Forward DSCP ไว้แต่ยังไม่ได้ใส่แท็ก",
  "Reverse DSCP is on but has no tag": "เปิด Reverse DSCP ไว้แต่ยังไม่ได้ใส่แท็ก",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Click a member to add or remove its line — up to four at once": "คลิกที่สมาชิกเพื่อเพิ่มหรือเอาเส้นของมันออก — ได้ครั้งละไม่เกินสี่เส้น",
  "No samples in this window. The console records these only while SD-WAN is probing, so a firewall with SD-WAN off has nothing to show here.": "ไม่มีค่าที่เก็บไว้ในช่วงเวลานี้ คอนโซลจะบันทึกค่าเหล่านี้เฉพาะตอนที่ SD-WAN กำลังตรวจวัดอยู่ ไฟร์วอลล์ที่ปิด SD-WAN ไว้จึงไม่มีอะไรให้แสดงตรงนี้",
  "Out of SLA": "หลุด SLA",
  "Over time": "ตามช่วงเวลา",
  "SLA limit": "ขีดจำกัด SLA",
  "Sampled every five minutes and kept for 90 days — the firewall keeps none of this itself": "เก็บค่าทุกห้านาทีและเก็บไว้ 90 วัน — ตัวไฟร์วอลล์เองไม่ได้เก็บส่วนนี้ไว้เลย",
  "Worst": "แย่ที่สุด",
  "no limit set": "ยังไม่ได้ตั้งขีดจำกัด",
};
