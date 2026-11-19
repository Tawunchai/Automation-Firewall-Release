/**
 * Thai — the six Security Profile forms: AntiVirus, Web Filter, DNS Filter, Application Control,
 * File Filter and SSL/SSH Inspection, plus Web Rating Overrides.
 *
 * Two things in here are the console repeating what the FortiGate said about its own licensing —
 * the "not licensed for FortiGuard web filtering" and "signature database not available" notices.
 * They are translated, because they are the console's own sentences about the device's state, not
 * the device's error text.
 *
 * FortiGuard's category names (Adult/Mature Content, Bandwidth Consuming, Potentially Liable …) are
 * translated as headings but the categories themselves are matched by numeric ID on the device, so
 * nothing downstream depends on the wording here.
 */
import type { Dict } from "../merge";

export const security: Dict = {
  // -- Shared form chrome ----------------------------------------------------
  "Profile Name": "ชื่อโปรไฟล์",
  Comment: "หมายเหตุ",
  "Loading profile…": "กำลังโหลดโปรไฟล์…",
  "Select profiles": "เลือกโปรไฟล์",
  "Apply to": "ใช้กับ",
  Protocols: "โปรโตคอล",
  "Enforce protocols": "บังคับใช้กับโปรโตคอล",
  "Select at least one protocol": "เลือกโปรโตคอลอย่างน้อยหนึ่งรายการ",
  "Proxy Options": "ตัวเลือกพร็อกซี",
  Traffic: "ทราฟฟิก",
  Filter: "ตัวกรอง",
  "Pre-configured filters": "ตัวกรองที่ตั้งค่าไว้ล่วงหน้า",
  Predefined: "กำหนดไว้ล่วงหน้า",
  "No more entries": "ไม่มีรายการเพิ่มเติม",

  // -- Actions ---------------------------------------------------------------
  Allow: "อนุญาต",
  Block: "บล็อก",
  Monitor: "เฝ้าดู",
  Ask: "ถามก่อน",
  Warning: "คำเตือน",
  Authenticate: "ยืนยันตัวตน",
  Quarantine: "กักกัน",
  "Violation action": "การจัดการเมื่อละเมิด",
  "HTTP POST Action": "การจัดการ HTTP POST",
  "Remove Cookies": "ลบคุกกี้",
  "Authenticate — which user groups may proceed?":
    "ยืนยันตัวตน — กลุ่มผู้ใช้ใดบ้างที่ผ่านต่อไปได้?",
  "Groups that can override": "กลุ่มที่สามารถแทนที่ได้",
  "Select user groups": "เลือกกลุ่มผู้ใช้",
  "Pick at least one group — FortiGate rejects the profile without it":
    "เลือกอย่างน้อยหนึ่งกลุ่ม — หากไม่เลือก FortiGate จะปฏิเสธโปรไฟล์นี้",
  "The original user or group must be specified as the 'Source' in firewall policies using this profile":
    "ต้องระบุผู้ใช้หรือกลุ่มเดิมเป็น 'ต้นทาง' ในนโยบายไฟร์วอลล์ที่ใช้โปรไฟล์นี้",

  // -- AntiVirus -------------------------------------------------------------
  "AntiVirus scan": "การสแกนไวรัส",
  "Include mobile malware protection": "รวมการป้องกันมัลแวร์บนมือถือ",
  "Treat Windows executables in email attachments as viruses":
    "ถือว่าไฟล์ปฏิบัติการของ Windows ที่แนบมากับอีเมลเป็นไวรัส",
  "Send files to FortiSandbox for inspection": "ส่งไฟล์ไปตรวจสอบที่ FortiSandbox",
  "Block malicious URLs discovered by FortiSandbox":
    "บล็อก URL อันตรายที่ FortiSandbox ตรวจพบ",
  "Use FortiGuard outbreak prevention database": "ใช้ฐานข้อมูลป้องกันการระบาดของ FortiGuard",
  "Use external malware block list": "ใช้รายการบล็อกมัลแวร์จากภายนอก",
  "Use EMS threat feed": "ใช้ฟีดภัยคุกคามจาก EMS",
  "External IP Block Lists": "รายการบล็อก IP จากภายนอก",
  "Select external resources": "เลือกแหล่งข้อมูลภายนอก",
  "No scan options set for any of the inspected protocols.":
    "ยังไม่ได้ตั้งค่าตัวเลือกการสแกนให้โปรโตคอลที่ตรวจสอบเลยสักรายการ",
  "0 domains in botnet package": "มี 0 โดเมนในแพ็กเกจบ็อตเน็ต",
  "Botnet package update unavailable, AntiVirus subscription not found.":
    "อัปเดตแพ็กเกจบ็อตเน็ตไม่ได้ ไม่พบการสมัครใช้บริการแอนตี้ไวรัส",
  "Redirect botnet C&C requests to Block Portal":
    "เปลี่ยนเส้นทางคำขอ C&C ของบ็อตเน็ตไปยัง Block Portal",

  // -- Web Filter ------------------------------------------------------------
  "URL Filter": "ตัวกรอง URL",
  "Local Categories": "หมวดหมู่ภายในเครื่อง",
  "Set all categories": "ตั้งค่าทุกหมวดหมู่",
  "Choose an action to apply to every category":
    "เลือกการกระทำที่จะใช้กับทุกหมวดหมู่",
  "Select a category…": "เลือกหมวดหมู่…",
  "Loading FortiGuard categories…": "กำลังโหลดหมวดหมู่ของ FortiGuard…",
  "No categories returned by the device.": "อุปกรณ์ไม่ได้ส่งรายการหมวดหมู่กลับมา",
  "The device did not return its category list, so there is nothing to choose from.":
    "อุปกรณ์ไม่ได้ส่งรายการหมวดหมู่กลับมา จึงไม่มีอะไรให้เลือก",
  "Warning: This device is not licensed for the FortiGuard web filtering service.":
    "คำเตือน: อุปกรณ์นี้ไม่มีไลเซนส์สำหรับบริการกรองเว็บของ FortiGuard",
  "Allow websites when a rating error occurs":
    "อนุญาตเว็บไซต์เมื่อเกิดข้อผิดพลาดในการจัดเรต",
  "Block invalid URLs": "บล็อก URL ที่ไม่ถูกต้อง",
  "Rate URLs by domain and IP Address": "จัดเรต URL ตามโดเมนและ IP แอดเดรส",
  "Rating Options": "ตัวเลือกการจัดเรต",
  "Enforce 'Safe Search' on Google, Bing, YouTube":
    "บังคับใช้ 'Safe Search' บน Google, Bing และ YouTube",
  "Restrict YouTube Access": "จำกัดการเข้าถึง YouTube",
  "Content Filter": "ตัวกรองเนื้อหา",
  "Pattern Type": "ชนิดของรูปแบบ",
  Pattern: "รูปแบบ",
  "Traffic may be blocked if this option is enabled.":
    "ทราฟฟิกอาจถูกบล็อกหากเปิดใช้ตัวเลือกนี้",
  "Adult/Mature Content": "เนื้อหาสำหรับผู้ใหญ่",
  "Bandwidth Consuming": "ใช้แบนด์วิดท์สูง",
  "General Interest - Business": "ความสนใจทั่วไป - ธุรกิจ",
  "General Interest - Personal": "ความสนใจทั่วไป - ส่วนบุคคล",
  "Potentially Liable": "อาจมีความรับผิดทางกฎหมาย",
  "Security Risk": "ความเสี่ยงด้านความปลอดภัย",
  Unrated: "ยังไม่จัดเรต",

  // -- Web rating override ---------------------------------------------------
  "web rating override": "การแทนที่การจัดเรตเว็บ",
  "Web rating override deleted": "ลบการแทนที่การจัดเรตเว็บแล้ว",
  "Failed to delete the web rating override": "ลบการแทนที่การจัดเรตเว็บไม่สำเร็จ",
  "Loading web rating override…": "กำลังโหลดการแทนที่การจัดเรตเว็บ…",
  "Search web rating overrides…": "ค้นหาการแทนที่การจัดเรตเว็บ…",
  "Ask the device how FortiGuard rates this URL today":
    "ถามอุปกรณ์ว่าวันนี้ FortiGuard จัดเรต URL นี้ไว้อย่างไร",
  "Device rating for": "เรตของอุปกรณ์สำหรับ",
  "The device returned no rating for": "อุปกรณ์ไม่ได้ส่งเรตกลับมาสำหรับ",
  "Rating lookup failed": "ค้นหาเรตไม่สำเร็จ",
  "The override for": "การแทนที่สำหรับ",
  "Override to": "แทนที่เป็น",
  "— it has no active FortiGuard web filtering contract to look one up with.":
    "— อุปกรณ์ไม่มีสัญญาบริการกรองเว็บของ FortiGuard ที่ยังใช้งานได้สำหรับค้นหา",

  // -- DNS Filter ------------------------------------------------------------
  "Domain Filter": "ตัวกรองโดเมน",
  Domain: "โดเมน",
  "DNS Translation": "การแปลง DNS",
  "Original Destination": "ปลายทางเดิม",
  "Translated Destination": "ปลายทางหลังการแปลง",
  "Network Mask": "เน็ตมาสก์",
  "Log all DNS queries and responses": "บันทึกคำขอและคำตอบ DNS ทั้งหมด",
  "Allow DNS requests when a rating error occurs":
    "อนุญาตคำขอ DNS เมื่อเกิดข้อผิดพลาดในการจัดเรต",
  "Redirect to Block Portal": "เปลี่ยนเส้นทางไปยัง Block Portal",
  "Redirect Portal IP": "IP ของ Block Portal",
  "DNS lookups cannot be rated, so category actions below will not take effect.":
    "การค้นหา DNS ไม่สามารถจัดเรตได้ การกระทำระดับหมวดหมู่ด้านล่างจึงจะไม่มีผล",

  // -- Application Control ---------------------------------------------------
  "Application Category": "หมวดหมู่แอปพลิเคชัน",
  "Sub-Category": "หมวดหมู่ย่อย",
  Technology: "เทคโนโลยี",
  Behavior: "พฤติกรรม",
  Popularity: "ความนิยม",
  Risk: "ความเสี่ยง",
  Vendor: "ผู้ผลิต",
  Cloud: "คลาวด์",
  "Add All Results": "เพิ่มผลลัพธ์ทั้งหมด",
  "Application signature database not available on this device":
    "ไม่มีฐานข้อมูลลายเซ็นแอปพลิเคชันบนอุปกรณ์นี้",
  "Protocol and Vendor lists come from the live signature database (not available on this device).":
    "รายการโปรโตคอลและผู้ผลิตมาจากฐานข้อมูลลายเซ็นแบบสด (ไม่มีบนอุปกรณ์นี้)",
  "This form reads the same source the FortiGate GUI uses for its 2,414-app table (":
    "ฟอร์มนี้อ่านจากแหล่งเดียวกับที่ GUI ของ FortiGate ใช้สร้างตารางแอป 2,414 รายการ (",
  "), but this device's FortiGuard Application Control service returns no signatures (unlicensed / cloud unreachable), so there are none to pick — and this form never saves a made-up ID. Use a":
    ") แต่บริการ FortiGuard Application Control ของอุปกรณ์นี้ไม่ส่งลายเซ็นกลับมา (ไม่มีไลเซนส์ / ติดต่อคลาวด์ไม่ได้) จึงไม่มีอะไรให้เลือก — และฟอร์มนี้จะไม่บันทึก ID ที่ถูกกุขึ้นเด็ดขาด ให้ใช้",
  "override to match applications by category, risk, technology, behavior or popularity (no signature database required), or connect a device whose FortiGuard Application Control service is active to browse the full list.":
    "การแทนที่ เพื่อจับคู่แอปพลิเคชันตามหมวดหมู่ ความเสี่ยง เทคโนโลยี พฤติกรรม หรือความนิยม (ไม่ต้องใช้ฐานข้อมูลลายเซ็น) หรือเชื่อมต่ออุปกรณ์ที่บริการ FortiGuard Application Control ยังใช้งานได้เพื่อดูรายการทั้งหมด",

  // -- File Filter -----------------------------------------------------------
  "Match Files": "จับคู่ไฟล์",
  "File types": "ชนิดไฟล์",
  "No file types": "ไม่มีชนิดไฟล์",
  "Search file types": "ค้นหาชนิดไฟล์",
  "Select at least one file type": "เลือกชนิดไฟล์อย่างน้อยหนึ่งรายการ",
  "Only formats that can carry a password are matchable, so File types is limited to":
    "จับคู่ได้เฉพาะรูปแบบไฟล์ที่ใส่รหัสผ่านได้ ชนิดไฟล์จึงถูกจำกัดไว้ที่",
  "Traffic direction applies to HTTP, FTP, SSH and CIFS only — with just mail protocols selected the FortiGate always matches both directions.":
    "ทิศทางของทราฟฟิกมีผลกับ HTTP, FTP, SSH และ CIFS เท่านั้น — หากเลือกเฉพาะโปรโตคอลอีเมล FortiGate จะจับคู่ทั้งสองทิศทางเสมอ",

  // -- Override durations ----------------------------------------------------
  "Switch to Filter override": "สลับไปใช้การแทนที่ด้วยตัวกรอง",
  "Switch applies to": "การสลับมีผลกับ",
  "Switch Duration": "ระยะเวลาการสลับ",
  "minute(s)": "นาที",
  "hour(s)": "ชั่วโมง",
  "day(s)": "วัน",

  // -- Field hints -----------------------------------------------------------
  "e.g. custom-av-profile": "เช่น custom-av-profile",
  "e.g. corp-web-filter": "เช่น corp-web-filter",
  "e.g. custom-dns-filter": "เช่น custom-dns-filter",
  "e.g. corp-app-sensor": "เช่น corp-app-sensor",
  "e.g. block-executables": "เช่น block-executables",
  "e.g. block-risky-files": "เช่น block-risky-files",
  "e.g. example*": "เช่น example*",
  "e.g. *.facebook.com": "เช่น *.facebook.com",
  "e.g. www.example.com": "เช่น www.example.com",
  "e.g. 10.1.1.1": "เช่น 10.1.1.1",
  "e.g. 10.2.2.2": "เช่น 10.2.2.2",
  "e.g. 53": "เช่น 53",
  "Failed to change the status": "เปลี่ยนสถานะไม่สำเร็จ",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Add New Override": "เพิ่มการแทนที่ใหม่",
  "New Web Rating Override": "สร้างการแทนที่การจัดเรตเว็บใหม่",
  "Put a URL in the category you say it belongs to, whatever FortiGuard rates it.":
    "กำหนดหมวดของ URL ด้วยตัวเอง ไม่ว่า FortiGuard จะจัดเรตไว้เป็นหมวดใด",
  "Edit Override": "แก้ไขการแทนที่",
  "Enable this override": "เปิดใช้การแทนที่นี้",
  "Disable this override": "ปิดใช้การแทนที่นี้",
  "Lookup rating": "ค้นหาการจัดเรต",
  "Looking up…": "กำลังค้นหา…",
  "All applications": "แอปพลิเคชันทั้งหมด",
  "No applications": "ไม่มีแอปพลิเคชัน",
  "Application": "แอปพลิเคชัน",
  "AntiVirus profile": "โปรไฟล์แอนตี้ไวรัส",
  "Web Filter profile": "โปรไฟล์ตัวกรองเว็บ",
  "DNS Filter profile": "โปรไฟล์ตัวกรอง DNS",
  "File Filter profile": "โปรไฟล์ตัวกรองไฟล์",
  "Application Control list": "รายการควบคุมแอปพลิเคชัน",
  "SSL/SSH Inspection profile": "โปรไฟล์ตรวจสอบ SSL/SSH",
  "New AntiVirus Profile": "สร้างโปรไฟล์แอนตี้ไวรัสใหม่",
  "New Web Filter Profile": "สร้างโปรไฟล์ตัวกรองเว็บใหม่",
  "New DNS Filter Profile": "สร้างโปรไฟล์ตัวกรอง DNS ใหม่",
  "New File Filter Profile": "สร้างโปรไฟล์ตัวกรองไฟล์ใหม่",
  "New Application Sensor": "สร้างเซนเซอร์แอปพลิเคชันใหม่",
  "Both": "ทั้งสองทาง",
  "Incoming": "ขาเข้า",
  "Outgoing": "ขาออก",
  "Cloud Applications require deep inspection.": "แอปพลิเคชันบนคลาวด์ต้องใช้การตรวจสอบเชิงลึก",
  "Create New File Filter Rule": "สร้างกฎตัวกรองไฟล์ใหม่",
  "Edit File Filter Rule": "แก้ไขกฎตัวกรองไฟล์",
  "Custom Categories": "หมวดหมู่ที่กำหนดเอง",
  "Edit Default Network Service": "แก้ไขบริการเครือข่ายเริ่มต้น",
  "New Default Network Service": "เพิ่มบริการเครือข่ายเริ่มต้น",
  "Edit DNS Translation": "แก้ไขการแปลง DNS",
  "New DNS Translation": "เพิ่มการแปลง DNS",
  "Edit Domain Filter": "แก้ไขตัวกรองโดเมน",
  "New Domain Filter": "เพิ่มตัวกรองโดเมน",
  "Edit URL Filter": "แก้ไขตัวกรอง URL",
  "New URL Filter": "เพิ่มตัวกรอง URL",
  "Edit Web Content Filter": "แก้ไขตัวกรองเนื้อหาเว็บ",
  "New Web Content Filter": "เพิ่มตัวกรองเนื้อหาเว็บ",
  "Exempt": "ยกเว้น",
  "Regular Expression": "นิพจน์ทั่วไป",
  "Wildcard": "ไวลด์การ์ด",
  "Simple": "แบบง่าย",
  "Strict": "เข้มงวด",
  "Moderate": "ปานกลาง",
  "Cyrillic": "ซีริลลิก",
  "French": "ฝรั่งเศส",
  "Japanese": "ญี่ปุ่น",
  "Korean": "เกาหลี",
  "Spanish": "สเปน",
  "Thai": "ไทย",
  "Simplified Chinese": "จีนตัวย่อ",
  "Traditional Chinese": "จีนตัวเต็ม",
  "Western": "ตะวันตก",
  "FortiSandbox is not configured on this device. Configure a FortiSandbox connector (Security Fabric → Fabric Connectors) to enable this option.": "อุปกรณ์นี้ยังไม่ได้ตั้งค่า FortiSandbox ตั้งค่า FortiSandbox connector (Security Fabric → Fabric Connectors) ก่อนจึงจะเปิดตัวเลือกนี้ได้",
  "Requires an active FortiGuard AntiVirus subscription. This device's AntiVirus license is not active (expired or unlicensed).": "ต้องมีการสมัครใช้งาน FortiGuard AntiVirus ที่ยังไม่หมดอายุ ไลเซนส์แอนตี้ไวรัสของอุปกรณ์นี้ไม่ได้ใช้งานอยู่ (หมดอายุหรือไม่มีไลเซนส์)",
  "No user group — the device will reject this": "ยังไม่ได้เลือกกลุ่มผู้ใช้ — อุปกรณ์จะปฏิเสธรายการนี้",
  "This device has no user groups — create one first": "อุปกรณ์นี้ยังไม่มีกลุ่มผู้ใช้ — สร้างขึ้นก่อน",
  "This device has no external resources — add one under Security Fabric → External Connectors": "อุปกรณ์นี้ยังไม่มี External Resource — เพิ่มได้ที่ Security Fabric → External Connectors",
  "Use FortiGuard Default": "ใช้ค่าเริ่มต้นของ FortiGuard",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Details": "รายละเอียด",
  "Enforce Protocols": "บังคับใช้โปรโตคอล",
  "File Types": "ชนิดไฟล์",
  "Network Mask/Prefix": "เน็ตมาสก์ / พรีฟิกซ์",
  "Violation Action": "การจัดการเมื่อฝ่าฝืน",
  "Must be inspecting at least one protocol and enable AntiVirus scan to use this feature.": "ต้องตรวจสอบอย่างน้อยหนึ่งโปรโตคอลและเปิดการสแกนแอนตี้ไวรัสก่อนจึงจะใช้คุณสมบัตินี้ได้",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Application Control profile": "โปรไฟล์การควบคุมแอปพลิเคชัน",
  "Unknown Applications": "แอปพลิเคชันที่ไม่รู้จัก",
  "allow": "อนุญาต",
  "block": "บล็อก",
  "Block traffic from an application seen on a port other than its known default.": "บล็อกทราฟฟิกจากแอปพลิเคชันที่พบบนพอร์ตอื่นนอกเหนือจากพอร์ตมาตรฐานของมัน",
  "Inspect files packed inside archives (zip, rar, 7z…) against the rules below.": "ตรวจสอบไฟล์ที่อยู่ในอาร์ไคฟ์ (zip, rar, 7z…) ตามกฎด้านล่าง",
  "Rewrite the address in a DNS reply — the client resolves the original destination to the translated one.": "เขียนแอดเดรสในคำตอบ DNS ใหม่ — ไคลเอ็นต์จะแปลงปลายทางเดิมไปเป็นปลายทางที่แปลงแล้ว",
  "Use FortiGuard outbreak prevention database, external malware block list, or EMS threat feed to preempt outbreaks before AV signatures are created. Must be inspecting at least one protocol and enable AntiVirus scan to use this feature.": "ใช้ฐานข้อมูลป้องกันการระบาดของ FortiGuard, รายการบล็อกมัลแวร์ภายนอก หรือฟีดภัยคุกคามจาก EMS เพื่อสกัดการระบาดก่อนที่ลายเซ็นแอนตี้ไวรัสจะถูกสร้างขึ้น ต้องตรวจสอบอย่างน้อยหนึ่งโปรโตคอลและเปิดการสแกนแอนตี้ไวรัสก่อนจึงจะใช้คุณสมบัตินี้ได้",

  // -- Language names — shared by the Web Filter content list and the navbar switcher ---
  "English": "อังกฤษ",
  "Chinese": "จีน",

  // -- Profile list ------------------------------------------------------------
  "Built-in": "ในตัว",
  "FortiOS ships this profile and does not allow it to be changed. Create a new one instead.":
    "FortiOS ติดตั้งโปรไฟล์นี้มาให้และไม่อนุญาตให้แก้ไข ให้สร้างโปรไฟล์ใหม่แทน",
  "IPS sensor": "เซนเซอร์ IPS",

  // -- IPS sensor form -----------------------------------------------------------
  "New IPS Sensor": "สร้างเซนเซอร์ IPS ใหม่",
  "Loading sensor…": "กำลังโหลดเซนเซอร์…",
  "e.g. block-critical-attacks": "เช่น block-critical-attacks",
  "Scan outgoing connections to botnet sites": "สแกนการเชื่อมต่อขาออกไปยังเว็บไซต์บอตเน็ต",
  "Block malicious URLs": "บล็อก URL อันตราย",
  "Extended logging": "บันทึกล็อกแบบละเอียด",
  "IPS Signatures and Filters": "ลายเซ็นและตัวกรอง IPS",
  "Signature Database": "ฐานข้อมูลลายเซ็น",
  "signatures on this device": "ลายเซ็นบนอุปกรณ์นี้",
  "Not readable from this device — filter lists fall back to FortiOS defaults.":
    "อ่านจากอุปกรณ์นี้ไม่ได้ — รายการตัวกรองจะใช้ค่าเริ่มต้นของ FortiOS แทน",
  "This firewall did not return its IPS signature database, so the filter lists below are FortiOS's generic ones rather than this unit's. Filters still work; the signature picker will be empty. An expired IPS subscription is the usual cause.":
    "ไฟร์วอลล์นี้ไม่ส่งฐานข้อมูลลายเซ็น IPS กลับมา รายการตัวกรองด้านล่างจึงเป็นค่าทั่วไปของ FortiOS ไม่ใช่ของเครื่องนี้ ตัวกรองยังใช้งานได้ แต่ตัวเลือกลายเซ็นจะว่าง สาเหตุที่พบบ่อยคือ subscription ของ IPS หมดอายุ",
  "A sensor with no entries inspects nothing. Add at least one filter or signature entry before saving — otherwise a policy can show IPS as \"on\" while no traffic is examined.":
    "เซนเซอร์ที่ไม่มีรายการใดเลยจะไม่ตรวจสอบอะไร เพิ่มรายการตัวกรองหรือลายเซ็นอย่างน้อยหนึ่งรายการก่อนบันทึก — ไม่อย่างนั้นนโยบายอาจแสดงว่า IPS \"เปิด\" อยู่ทั้งที่ไม่มีทราฟฟิกใดถูกตรวจ",
  "New IPS Entry": "เพิ่มรายการ IPS",
  "Edit IPS Entry": "แก้ไขรายการ IPS",
  "signature": "ลายเซ็น",
  "Signatures": "ลายเซ็น",
  "Target": "เป้าหมาย",
  "OS / Application": "OS / แอปพลิเคชัน",
  "Packet Log": "บันทึกแพ็กเก็ต",
  "Match signatures by their attributes — this keeps working as FortiGuard adds new ones.":
    "จับคู่ลายเซ็นตามคุณสมบัติ — ยังใช้ได้ต่อไปเมื่อ FortiGuard เพิ่มลายเซ็นใหม่",
  "Pick exact signatures by name or CVE. Precise, but it will not cover signatures added later.":
    "เลือกลายเซ็นที่ต้องการตามชื่อหรือ CVE แม่นยำ แต่จะไม่ครอบคลุมลายเซ็นที่เพิ่มเข้ามาภายหลัง",
  "Nothing selected = every severity.": "ไม่เลือกเลย = ทุกระดับความรุนแรง",
  "Nothing selected = both directions.": "ไม่เลือกเลย = ทั้งสองทิศทาง",
  "Client": "ไคลเอนต์",
  "Search protocols…": "ค้นหาโปรโตคอล…",
  "Search operating systems…": "ค้นหาระบบปฏิบัติการ…",
  "Search applications…": "ค้นหาแอปพลิเคชัน…",
  "Search signatures by name, id or severity…": "ค้นหาลายเซ็นตามชื่อ, id หรือระดับความรุนแรง…",
  "none selected": "ยังไม่ได้เลือก",
  "This device did not return a signature database — pick signatures by CVE below, or use a filter entry instead.":
    "อุปกรณ์นี้ไม่ส่งฐานข้อมูลลายเซ็นกลับมา — เลือกลายเซ็นตาม CVE ด้านล่าง หรือใช้รายการตัวกรองแทน",
  "CVE IDs": "รหัส CVE",
  "Comma separated. Wildcards are allowed, e.g.": "คั่นด้วยจุลภาค ใช้ไวลด์การ์ดได้ เช่น",
  "Log matches": "บันทึกล็อกเมื่อตรงเงื่อนไข",
  "Packet capture": "จับแพ็กเก็ต",
  "Attacker": "ผู้โจมตี",
  "The source address is banned for every service, not just the one that tripped the signature. A false positive takes that host off the network entirely.":
    "แอดเดรสต้นทางจะถูกแบนจากทุกบริการ ไม่ใช่แค่บริการที่ทำให้ลายเซ็นทำงาน ถ้าเป็นการแจ้งเตือนผิดพลาด โฮสต์นั้นจะใช้เครือข่ายไม่ได้เลย",
  "Use whatever each matched signature recommends. This is what the built-in sensors do.":
    "ใช้การดำเนินการที่ลายเซ็นแต่ละตัวแนะนำ ซึ่งเป็นแบบที่เซนเซอร์ในตัวใช้",
  "Let the traffic through even when a signature matches. Logs still fire.":
    "ปล่อยทราฟฟิกผ่านแม้ลายเซ็นจะตรง แต่ยังบันทึกล็อกอยู่",
  "Drop the packet.": "ทิ้งแพ็กเก็ต",
  "Drop the packet and tear the session down with a TCP reset.": "ทิ้งแพ็กเก็ตและตัดเซสชันด้วย TCP reset",

  // -- SSL/SSH inspection form ---------------------------------------------------
  "New SSL/SSH Inspection Profile": "สร้างโปรไฟล์ตรวจสอบ SSL/SSH ใหม่",
  "e.g. outbound-deep-inspect": "เช่น outbound-deep-inspect",
  "Before you deploy": "ก่อนนำไปใช้งาน",
  "Deep inspection re-signs every certificate with the CA chosen here. Every device on the network must already trust that CA, or users see a warning on every HTTPS site. Export it from the FortiGate's own":
    "การตรวจสอบเชิงลึกจะเซ็นใบรับรองทุกใบใหม่ด้วย CA ที่เลือกไว้ที่นี่ ทุกอุปกรณ์ในเครือข่ายต้องเชื่อถือ CA นั้นอยู่แล้ว ไม่อย่างนั้นผู้ใช้จะเห็นคำเตือนในทุกเว็บ HTTPS ส่งออกได้จากหน้า",
  "and push it to your endpoints first.": "แล้วติดตั้งลงเครื่องปลายทางทั้งหมดก่อน",
  "This firewall runs": "ไฟร์วอลล์นี้ใช้การตรวจสอบแบบ",
  "inspection, so it does not have the proxy-only half of this profile — per-protocol ports and status, certificate handling outside the default block, exemptions, and the reputable-website allowlist. Those controls are greyed out below: the device would accept them and store nothing. Enable":
    "จึงไม่มีส่วนที่ใช้ได้เฉพาะโหมด proxy ของโปรไฟล์นี้ — พอร์ตและสถานะรายโปรโตคอล การจัดการใบรับรองนอกบล็อกค่าเริ่มต้น การยกเว้น และรายการเว็บไซต์ที่น่าเชื่อถือ ตัวควบคุมเหล่านั้นจึงเป็นสีเทาด้านล่าง เพราะอุปกรณ์จะรับค่าไว้แต่ไม่บันทึกอะไรเลย เปิด",
  "in": "ใน",
  "to use them.": "เพื่อใช้งาน",
  "Enable SSL inspection of": "เปิดการตรวจสอบ SSL สำหรับ",
  "Multiple Clients Connecting to Multiple Servers": "ไคลเอนต์หลายเครื่องเชื่อมต่อไปยังเซิร์ฟเวอร์หลายเครื่อง",
  "Protecting SSL Server": "ปกป้องเซิร์ฟเวอร์ SSL",
  "Outbound: your users reaching the internet. The firewall re-signs each site's certificate with the CA below.":
    "ขาออก: ผู้ใช้ของคุณออกอินเทอร์เน็ต ไฟร์วอลล์จะเซ็นใบรับรองของแต่ละเว็บไซต์ใหม่ด้วย CA ด้านล่าง",
  "Inbound: clients reaching a server you own. The firewall presents that server's own certificate.":
    "ขาเข้า: ไคลเอนต์เข้าถึงเซิร์ฟเวอร์ของคุณ ไฟร์วอลล์จะแสดงใบรับรองของเซิร์ฟเวอร์นั้นเอง",
  "CA certificate": "ใบรับรอง CA",
  "Untrusted CA certificate": "ใบรับรอง CA ที่ไม่น่าเชื่อถือ",
  "Server certificates": "ใบรับรองเซิร์ฟเวอร์",
  "No certificates on this device": "ไม่มีใบรับรองบนอุปกรณ์นี้",
  "Protocol Port Mapping": "การจับคู่พอร์ตกับโปรโตคอล",
  "Exempt from SSL Inspection": "ยกเว้นจากการตรวจสอบ SSL",
  "Exempt reputable websites": "ยกเว้นเว็บไซต์ที่น่าเชื่อถือ",
  "FortiGuard's own list of sites known to break under interception — banks, software updaters, OS telemetry.":
    "รายการของ FortiGuard เองสำหรับเว็บไซต์ที่ใช้งานไม่ได้เมื่อถูกดักตรวจ — ธนาคาร โปรแกรมอัปเดตซอฟต์แวร์ และ telemetry ของระบบปฏิบัติการ",
  "Not available on a flow-based FortiGate.": "ใช้ไม่ได้บน FortiGate ที่ตรวจสอบแบบ flow-based",
  "Block certificates on the FortiGuard blocklist": "บล็อกใบรับรองที่อยู่ในรายการบล็อกของ FortiGuard",
  "Per-site exemptions need proxy inspection. On this firewall, exclude traffic from inspection with a firewall policy that uses the":
    "การยกเว้นรายเว็บไซต์ต้องใช้การตรวจสอบแบบ proxy บนไฟร์วอลล์นี้ให้ยกเว้นทราฟฟิกจากการตรวจสอบด้วยนโยบายไฟร์วอลล์ที่ใช้โปรไฟล์",
  "profile instead.": "แทน",
  "Common Options": "ตัวเลือกทั่วไป",
  "Supported ALPN": "ALPN ที่รองรับ",
  "Inspect RPC over HTTPS": "ตรวจสอบ RPC ผ่าน HTTPS",
  "Inspect MAPI over HTTPS": "ตรวจสอบ MAPI ผ่าน HTTPS",
  "SSL anomalies": "ความผิดปกติของ SSL",
  "SSL negotiation": "การเจรจา SSL",
  "Server certificate details": "รายละเอียดใบรับรองเซิร์ฟเวอร์",
  "Handshake details": "รายละเอียด handshake",
  "Exempted sessions": "เซสชันที่ถูกยกเว้น",
  "This profile decrypts traffic. Attaching it to a policy without first distributing":
    "โปรไฟล์นี้ถอดรหัสทราฟฟิก ถ้าผูกกับนโยบายโดยยังไม่ได้แจกจ่าย",
  "the CA certificate": "ใบรับรอง CA",
  "to your endpoints will produce a certificate warning on every HTTPS site.":
    "ไปยังเครื่องปลายทาง จะเกิดคำเตือนใบรับรองในทุกเว็บ HTTPS",
  "Default (other ports)": "ค่าเริ่มต้น (พอร์ตอื่น)",
  "Ports": "พอร์ต",
  "no ports — inspects nothing": "ไม่มีพอร์ต — ไม่ตรวจสอบอะไรเลย",
  "TLS on any port no block below claims": "TLS บนพอร์ตใดก็ได้ที่ไม่มีบล็อกด้านล่างรับไว้",
  "Inspect all SSH ports": "ตรวจสอบ SSH ทุกพอร์ต",
  "Inspect SSH found on any port, not just the ones listed above.": "ตรวจสอบ SSH ที่พบบนพอร์ตใดก็ได้ ไม่ใช่แค่พอร์ตที่ระบุไว้ด้านบน",
  "Deep": "เชิงลึก",
  "Unsupported SSH version": "เวอร์ชัน SSH ที่ไม่รองรับ",
  "What to do with an SSH version this firewall cannot inspect.": "จะทำอย่างไรกับเวอร์ชัน SSH ที่ไฟร์วอลล์นี้ตรวจสอบไม่ได้",
  "Bypass": "ข้ามการตรวจ",
  "SSH algorithm": "อัลกอริทึม SSH",
  "high-encryption restricts the session to strong ciphers; older clients may fail to connect.":
    "high-encryption จำกัดเซสชันให้ใช้ cipher ที่แข็งแรงเท่านั้น ไคลเอนต์รุ่นเก่าอาจเชื่อมต่อไม่ได้",
  "Compatible": "เข้ากันได้",
  "High encryption": "เข้ารหัสระดับสูง",
  "SSH tunnel policy check": "ตรวจนโยบายของ SSH tunnel",
  "Ignore": "เพิกเฉย",
  "Inspect": "ตรวจสอบ",
  "Expired certificate": "ใบรับรองหมดอายุ",
  "A server certificate whose validity period has passed.": "ใบรับรองเซิร์ฟเวอร์ที่เลยช่วงเวลาที่ใช้ได้แล้ว",
  "Revoked certificate": "ใบรับรองที่ถูกเพิกถอน",
  "A certificate the issuing CA has withdrawn.": "ใบรับรองที่ CA ผู้ออกได้ถอนคืนแล้ว",
  "Untrusted certificate": "ใบรับรองที่ไม่น่าเชื่อถือ",
  "Signed by a CA this firewall does not trust. FortiOS allows these by default.":
    "เซ็นโดย CA ที่ไฟร์วอลล์นี้ไม่เชื่อถือ ค่าเริ่มต้นของ FortiOS คืออนุญาต",
  "Certificate validation failure": "การตรวจสอบใบรับรองล้มเหลว",
  "Certificate validation timeout": "การตรวจสอบใบรับรองหมดเวลา",
  "Client certificate": "ใบรับรองของไคลเอนต์",
  "What to do when the client presents a certificate of its own.": "จะทำอย่างไรเมื่อไคลเอนต์แสดงใบรับรองของตัวเอง",
  "SNI / server certificate check": "ตรวจ SNI / ใบรับรองเซิร์ฟเวอร์",
  "Strict requires the certificate to match the name the client asked for.": "Strict กำหนดให้ใบรับรองตรงกับชื่อที่ไคลเอนต์ร้องขอ",
  "Minimum TLS version": "เวอร์ชัน TLS ขั้นต่ำ",
  "Sessions negotiating below this are treated as unsupported.": "เซสชันที่เจรจาได้ต่ำกว่านี้จะถือว่าไม่รองรับ",
  "Unsupported TLS version": "เวอร์ชัน TLS ที่ไม่รองรับ",
  "Unsupported cipher": "cipher ที่ไม่รองรับ",
  "Failed handshake": "handshake ล้มเหลว",
  "Certificate probe failure": "การตรวจหาใบรับรองล้มเหลว",
  "Proxy after TCP handshake": "Proxy หลัง TCP handshake",
  "inspection reads only the certificate — enough for Web Filter to see the site name, but AntiVirus and Application Control still cannot see inside.":
    "คือการตรวจสอบเฉพาะใบรับรอง — พอให้ Web Filter เห็นชื่อเว็บไซต์ แต่ AntiVirus และ Application Control ยังมองไม่เห็นข้างใน",
  "inspection decrypts the session, which is what the other Security Profiles need — and what requires the CA above to be trusted by every endpoint.":
    "คือการถอดรหัสเซสชัน ซึ่งเป็นสิ่งที่ Security Profile อื่นต้องใช้ — และเป็นเหตุที่ทุกเครื่องปลายทางต้องเชื่อถือ CA ด้านบน",
  "Deep inspection breaks certificate pinning. Banking apps, software updaters and some mobile apps will fail until they are exempted below.":
    "การตรวจสอบเชิงลึกทำให้ certificate pinning ใช้ไม่ได้ แอปธนาคาร โปรแกรมอัปเดตซอฟต์แวร์ และแอปมือถือบางตัวจะใช้งานไม่ได้จนกว่าจะยกเว้นไว้ด้านล่าง",
  "IPv6 Address": "แอดเดรส IPv6",
  "IPv6 address": "แอดเดรส IPv6",
  "Regex": "Regex",
  "Value": "ค่า",
  "New Exemption": "เพิ่มการยกเว้น",
  "Edit Exemption": "แก้ไขการยกเว้น",
  "This device returned no FortiGuard categories — an inactive web-filtering subscription. Use an address or wildcard FQDN instead.":
    "อุปกรณ์นี้ไม่ส่งหมวดหมู่ FortiGuard กลับมา — subscription ของ web filtering ไม่ได้ใช้งานอยู่ ใช้แอดเดรสหรือ wildcard FQDN แทน",
  "Select an address object…": "เลือกออบเจกต์แอดเดรส…",
  "an IPv6 address object name": "ชื่อออบเจกต์แอดเดรส IPv6",
  "Select an FQDN object…": "เลือกออบเจกต์ FQDN…",
  "Only FQDN-type address objects appear here — the device rejects anything else in this slot.":
    "แสดงเฉพาะออบเจกต์แอดเดรสชนิด FQDN — อุปกรณ์จะปฏิเสธชนิดอื่นในช่องนี้",

  // -- The noun ProfileLoadGuard names when a profile could not be read --------------
  "Application sensor": "เซนเซอร์แอพพลิเคชัน",
  "SSL/SSH profile": "โปรไฟล์ SSL/SSH",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Content entry action": "การกระทำของรายการเนื้อหา",
  "Content entry status": "สถานะของรายการเนื้อหา",
  "Domain entry action": "การกระทำของรายการโดเมน",
  "Domain entry status": "สถานะของรายการโดเมน",
  "Domain entry type": "ชนิดของรายการโดเมน",
  "Exempt entry type": "ชนิดของรายการยกเว้น",
  "External IP block lists": "รายการบล็อก IP จากภายนอก",
  "External list status": "สถานะของรายการภายนอก",
  "FortiGuard category based filter": "ตัวกรองตามหมวดหมู่ FortiGuard",
  "Inspection mode": "โหมดการตรวจสอบ",
  "Match files": "เงื่อนไขจับคู่ไฟล์",
  "Override action": "การกระทำที่ใช้แทนที่",
  "Override type": "ชนิดของการแทนที่",
  "Rule action": "การกระทำของกฎ",
  "Signature action": "การกระทำของซิกเนเจอร์",
  "Signature filter type": "ชนิดตัวกรองซิกเนเจอร์",
  "Signature status": "สถานะซิกเนเจอร์",
  "URL entry action": "การกระทำของรายการ URL",
  "URL entry status": "สถานะของรายการ URL",
  "URL entry type": "ชนิดของรายการ URL",

  // The Security Profiles landing page: one caption per profile type, plus Web Rating Overrides.
  "Delete web rating override": "ลบการแทนที่เรตติ้งเว็บ",
  "No comment": "ไม่มีคำอธิบาย",
  "Profiles that allow, block or monitor web traffic by category and URL.":
    "โปรไฟล์ที่อนุญาต บล็อก หรือเฝ้าดูทราฟฟิกเว็บตามหมวดหมู่และ URL",
  "Profiles that block DNS lookups for botnet and category-based domains.":
    "โปรไฟล์ที่บล็อกการค้นหา DNS ของโดเมนบ็อตเน็ตและโดเมนตามหมวดหมู่",
  "Profiles that block or log files by type as they pass through the firewall.":
    "โปรไฟล์ที่บล็อกหรือบันทึกไฟล์ตามชนิดขณะวิ่งผ่านไฟร์วอลล์",
  "Profiles that decide how deeply encrypted traffic is inspected.":
    "โปรไฟล์ที่กำหนดว่าจะตรวจทราฟฟิกที่เข้ารหัสลึกแค่ไหน",
  "Profiles that scan traffic for malware as it crosses the firewall.":
    "โปรไฟล์ที่สแกนหามัลแวร์ในทราฟฟิกขณะวิ่งผ่านไฟร์วอลล์",
  "Sensors that identify and control traffic by the application generating it.":
    "เซนเซอร์ที่ระบุและควบคุมทราฟฟิกตามแอปพลิเคชันที่เป็นต้นทาง",
  "Sensors that match traffic against known exploit and attack signatures.":
    "เซนเซอร์ที่เทียบทราฟฟิกกับซิกเนเจอร์ของช่องโหว่และการโจมตีที่รู้จัก",
  "This web rating override will be permanently removed from": "การแทนที่เรตติ้งเว็บนี้จะถูกลบอย่างถาวรจาก",
};
