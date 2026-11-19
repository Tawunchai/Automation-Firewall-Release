/**
 * Thai — Log Settings, HA Status and Administrators.
 *
 * The device's own configuration, as opposed to the traffic through it. Two renderings carry
 * weight and were chosen rather than transliterated:
 *
 *   "From any address"   เข้าได้จากทุกที่ — an admin account with no trusted host is reachable from
 *                        anywhere. Thai must not let that read as "ยังไม่ได้ตั้งค่า".
 *   "Read-only"          อ่านได้อย่างเดียว for an access profile, NOT ห้ามแก้ — it is a permission
 *                        level, not a lock somebody applied.
 */

import type { Dict } from "../merge";

export const system: Dict = {
  "Log Settings": "ตั้งค่าบันทึก",
  "log setting": "การตั้งค่าบันทึก",
  "Where the logs go": "บันทึกถูกส่งไปที่ไหน",
  "What gets logged": "อะไรบ้างที่ถูกบันทึก",
  "Which events produce a log line at all": "เหตุการณ์ไหนที่ทำให้เกิดบรรทัดบันทึกจริง ๆ",
  "Nowhere — no log destination is both switched on and configured.":
    "ไม่ไปไหนเลย — ไม่มีปลายทางไหนที่ทั้งเปิดอยู่และตั้งค่าครบ",
  "Logging may well be configured — this is 'unreadable', not 'off'":
    "อาจตั้งค่าบันทึกไว้อยู่จริง — นี่คือ 'อ่านไม่ได้' ไม่ใช่ 'ปิดอยู่'",
  "Each section saves on its own. On the device they are five separate settings tables, and one of them refusing a change should not undo the others.":
    "แต่ละส่วนบันทึกแยกกัน · บนอุปกรณ์มันคือตารางตั้งค่าห้าตารางแยกจากกัน ถ้าตารางหนึ่งปฏิเสธ ไม่ควรทำให้ส่วนอื่นเสียไปด้วย",
  "is switched on with no server address, so it is sending nothing.":
    "เปิดอยู่แต่ไม่ได้ใส่ที่อยู่เซิร์ฟเวอร์ จึงไม่ได้ส่งอะไรเลย",
  "What this firewall records, and where it puts it": "สิ่งที่ firewall นี้บันทึก และเก็บไว้ที่ไหน",
  "Available": "พร้อมใช้งาน",
  "Not available": "ไม่พร้อมใช้งาน",
  "Needs a server": "ต้องใส่เซิร์ฟเวอร์",
  "Memory buffer": "บัฟเฟอร์หน่วยความจำ",
  "Cleared on reboot — every unit has one": "ถูกล้างเมื่อรีบูต — ทุกเครื่องมี",
  "Log to memory": "บันทึกลงหน่วยความจำ",
  "Local disk": "ดิสก์ในเครื่อง",
  "Survives a reboot": "อยู่รอดหลังรีบูต",
  "This model has no log disk": "รุ่นนี้ไม่มีดิสก์สำหรับบันทึก",
  "no disk": "ไม่มีดิสก์",
  "Log to disk": "บันทึกลงดิสก์",
  "Keep logs for (days)": "เก็บบันทึกไว้ (วัน)",
  "A collector somewhere else — the usual way logs outlive the firewall":
    "ตัวเก็บบันทึกที่อื่น — วิธีปกติที่ทำให้บันทึกอยู่ได้นานกว่าตัว firewall",
  "Send logs to syslog": "ส่งบันทึกไปยัง syslog",
  "Fortinet's own log collector": "ตัวเก็บบันทึกของ Fortinet เอง",
  "Send logs to FortiAnalyzer": "ส่งบันทึกไปยัง FortiAnalyzer",
  "Reliable transport": "ส่งแบบรับประกันการถึง",
  "How often": "ความถี่",
  "Real time": "เรียลไทม์",
  "Every minute": "ทุกนาที",
  "Every 5 minutes": "ทุก 5 นาที",
  "Store and upload": "เก็บไว้แล้วส่งเป็นชุด",
  "Transport": "การส่งข้อมูล",
  "UDP loses entries silently under load.": "UDP ทำบันทึกหายเงียบ ๆ เมื่อโหลดสูง",
  "Format": "รูปแบบ",
  "The port must be between 0 and 65535.": "พอร์ตต้องอยู่ระหว่าง 0 ถึง 65535",
  "A syslog destination needs a server address — switched on without one it sends nothing.":
    "ปลายทาง syslog ต้องมีที่อยู่เซิร์ฟเวอร์ — เปิดไว้เฉย ๆ โดยไม่ใส่ จะไม่ส่งอะไรเลย",
  "A FortiAnalyzer destination needs a server address.":
    "ปลายทาง FortiAnalyzer ต้องมีที่อยู่เซิร์ฟเวอร์",
  "The maximum log file size cannot be negative.": "ขนาดไฟล์บันทึกสูงสุดติดลบไม่ได้",
  "The maximum log age cannot be negative.": "อายุบันทึกสูงสุดติดลบไม่ได้",
  "Log traffic denied by the implicit rule": "บันทึกทราฟฟิกที่ถูกปฏิเสธด้วยกฎ implicit",
  "The single most important one. Without it, everything the last rule refuses is invisible.":
    "ข้อที่สำคัญที่สุด · ถ้าไม่เปิด ทุกอย่างที่กฎสุดท้ายปฏิเสธจะมองไม่เห็นเลย",
  "Log accepted traffic to the firewall itself": "บันทึกทราฟฟิกที่ถูกอนุญาตให้ถึงตัว firewall",
  "Administrative logins, VPN connections, routing protocols.":
    "การล็อกอินของผู้ดูแล การเชื่อมต่อ VPN และโปรโตคอลเราต์ติ้ง",
  "Log denied traffic to the firewall": "บันทึกทราฟฟิกที่ถูกปฏิเสธไม่ให้ถึง firewall",
  "What a local-in policy refused. Empty without this even when rules are blocking.":
    "สิ่งที่ local-in policy ปฏิเสธ · ถ้าไม่เปิดจะว่างเปล่าแม้กฎกำลังบล็อกอยู่",
  "Log denied broadcasts to the firewall": "บันทึก broadcast ที่ถูกปฏิเสธไม่ให้ถึง firewall",
  "Noisy on a busy segment — usually left off.": "ในเซกเมนต์ที่คึกคักจะรกมาก — ปกติปิดไว้",
  "Log traffic the firewall itself sends": "บันทึกทราฟฟิกที่ firewall ส่งออกเอง",
  "Its own DNS, NTP, FortiGuard and update traffic.":
    "ทราฟฟิก DNS, NTP, FortiGuard และการอัปเดตของตัวมันเอง",
  "Log invalid packets": "บันทึกแพ็กเก็ตที่ไม่ถูกต้อง",
  "Malformed or out-of-state packets the kernel drops before any policy sees them.":
    "แพ็กเก็ตผิดรูปหรือหลุด state ที่เคอร์เนลทิ้งก่อนที่ policy ใดจะเห็น",
  "Resolve addresses to host names": "แปลง IP เป็นชื่อโฮสต์",
  "Readable, and it makes the firewall do a lookup for every line it writes.":
    "อ่านง่ายขึ้น แต่ firewall ต้อง lookup ทุกบรรทัดที่เขียน",
  "Show service names instead of port numbers": "แสดงชื่อเซอร์วิสแทนหมายเลขพอร์ต",
  "443 becomes HTTPS.": "443 จะกลายเป็น HTTPS",
  "Include the policy comment in each entry": "ใส่คำอธิบายของ policy ในทุกรายการ",
  "Puts the rule's own description next to what it matched.":
    "วางคำอธิบายของกฎไว้ข้างสิ่งที่กฎนั้นจับได้",
  "Brief traffic format": "รูปแบบทราฟฟิกแบบย่อ",
  "Fewer fields per line. Smaller logs, less to investigate with.":
    "ฟิลด์ต่อบรรทัดน้อยลง · บันทึกเล็กลง แต่ข้อมูลไว้สืบสวนก็น้อยลงด้วย",
  "Anonymise user names": "ปิดบังชื่อผู้ใช้",
  "Replaces the user in each entry with a hash.": "แทนชื่อผู้ใช้ในแต่ละรายการด้วยค่าแฮช",
  "System": "ระบบ",
  "HA Status": "สถานะ HA",
  "HA setting": "การตั้งค่า HA",
  "Whether this unit is on its own or part of a cluster, and how healthy that cluster is":
    "เครื่องนี้อยู่ตัวเดียวหรือเป็นส่วนหนึ่งของคลัสเตอร์ และคลัสเตอร์นั้นแข็งแรงแค่ไหน",
  "Clustered": "อยู่ในคลัสเตอร์",
  "Standalone": "แยกเดี่ยว",
  "This is 'unreadable', not 'standalone'": "นี่คือ 'อ่านไม่ได้' ไม่ใช่ 'standalone'",
  "the device did not answer": "อุปกรณ์ไม่ตอบ",
  "Standalone — this unit is on its own": "Standalone — เครื่องนี้อยู่ตัวเดียว",
  "Active-passive — one unit carries the traffic, the other waits":
    "Active-passive — เครื่องหนึ่งรับทราฟฟิก อีกเครื่องรอสำรอง",
  "Active-active — both units carry traffic": "Active-active — ทั้งสองเครื่องรับทราฟฟิก",
  "This unit is standalone, but it still holds HA settings. They survive being taken out of a cluster and are not doing anything.":
    "เครื่องนี้เป็น standalone แต่ยังเก็บค่า HA ไว้อยู่ · ค่าพวกนี้ค้างอยู่หลังถูกถอดออกจากคลัสเตอร์ และไม่ได้ทำงานอะไร",
  "Group name": "ชื่อกลุ่ม",
  "Group ID": "รหัสกลุ่ม",
  "priority": "ลำดับความสำคัญ",
  "Higher wins the election, unless override is off":
    "ค่าสูงกว่าชนะการเลือกตั้ง เว้นแต่ override จะปิดอยู่",
  "Heartbeat interfaces": "อินเทอร์เฟซ heartbeat",
  "How the members find each other": "ช่องทางที่สมาชิกใช้หากัน",
  "Monitored interfaces": "อินเทอร์เฟซที่เฝ้าดู",
  "Losing one of these triggers a failover": "ถ้าตัวใดตัวหนึ่งล่ม จะเกิด failover",
  "Config sync": "ซิงก์คอนฟิก",
  "Changes on the primary reach the secondary": "การเปลี่ยนแปลงบนเครื่องหลักจะถูกส่งไปเครื่องรอง",
  "Session pickup": "รับช่วงเซสชัน",
  "Without it, live connections drop on a failover":
    "ถ้าไม่เปิด การเชื่อมต่อที่กำลังใช้งานจะหลุดตอน failover",
  "Heartbeat encryption": "เข้ารหัส heartbeat",
  "Heartbeat authentication": "ยืนยันตัวตน heartbeat",
  "Heartbeat interval": "ช่วงเวลา heartbeat",
  "Uninterruptible upgrade": "อัปเกรดโดยไม่สะดุด",
  "Upgrade one member at a time": "อัปเกรดทีละเครื่อง",
  "Standalone — there are no other members to report": "Standalone — ไม่มีสมาชิกอื่นให้รายงาน",
  "this unit": "เครื่องนี้",
  "unnamed member": "สมาชิกที่ไม่มีชื่อ",
  "Administrators": "ผู้ดูแลอุปกรณ์",
  "administrator": "ผู้ดูแล",
  "New administrator": "ผู้ดูแลใหม่",
  "Accounts certainly exist — this is 'unreadable', not 'none'":
    "ยังไงก็ต้องมีบัญชีอยู่ — นี่คือ 'อ่านไม่ได้' ไม่ใช่ 'ไม่มี'",
  "One leaked password is then enough to own this firewall.":
    "แค่รหัสผ่านรั่วอันเดียวก็พอที่จะยึด firewall นี้ได้",
  "full control": "ควบคุมได้ทั้งหมด",
  "remote auth": "ยืนยันตัวตนจากภายนอก",
  "the only full administrator": "ผู้ดูแลเต็มสิทธิ์คนเดียวที่เหลือ",
  "From any address": "เข้าได้จากทุกที่",
  "No second factor": "ไม่มีปัจจัยที่สอง",
  "· SSH key set": "· ตั้งคีย์ SSH ไว้",
  "Access profiles": "โปรไฟล์สิทธิ์",
  "Access profile": "โปรไฟล์สิทธิ์",
  "What each profile allows. Edited on the device — a half-built editor here would produce profiles whose real permissions differ from what the form showed.":
    "แต่ละโปรไฟล์อนุญาตอะไรบ้าง · แก้ไขบนอุปกรณ์ — ถ้าทำตัวแก้ไขครึ่ง ๆ กลาง ๆ ไว้ที่นี่ จะได้โปรไฟล์ที่สิทธิ์จริงไม่ตรงกับที่ฟอร์มแสดง",
  "Full control of the device": "ควบคุมอุปกรณ์ได้ทั้งหมด",
  "Read-only": "อ่านได้อย่างเดียว",
  "Unknown profile": "ไม่รู้จักโปรไฟล์นี้",
  "Account name": "ชื่อบัญชี",
  "Choose…": "เลือก…",
  "Authenticate against a remote server instead of a local password":
    "ยืนยันตัวตนกับเซิร์ฟเวอร์ภายนอกแทนรหัสผ่านในเครื่อง",
  "Remote group": "กลุ่มภายนอก",
  "Leave the password unchanged": "ไม่เปลี่ยนรหัสผ่าน",
  "The firewall never returns a password, so leaving this alone is the only way to keep it.":
    "firewall ไม่เคยคืนค่ารหัสผ่านกลับมา การไม่แตะช่องนี้จึงเป็นวิธีเดียวที่จะเก็บรหัสเดิมไว้",
  "Trusted hosts": "โฮสต์ที่เชื่อถือ",
  "One subnet per line, up to ten. Empty means the account can log in from any address — which is the FortiOS default, not a gap in the configuration.":
    "บรรทัดละหนึ่งซับเน็ต ได้สูงสุดสิบ · เว้นว่าง = บัญชีนี้ล็อกอินได้จากทุกที่ ซึ่งเป็นค่าเริ่มต้นของ FortiOS ไม่ใช่การตั้งค่าที่ตกหล่น",
  "Second factor": "ปัจจัยที่สอง",
  "Give the account a name.": "ตั้งชื่อให้บัญชี",
  "Choose an access profile — it is what the account is allowed to do.":
    "เลือกโปรไฟล์สิทธิ์ — มันคือสิ่งที่บัญชีนี้ทำได้",
  "A new local account needs a password.": "บัญชีในเครื่องที่สร้างใหม่ต้องมีรหัสผ่าน",
  "Enter the new password, or leave the password unchanged.":
    "ใส่รหัสผ่านใหม่ หรือเลือกไม่เปลี่ยนรหัสผ่าน",
  "A remotely authenticated account needs the remote group it belongs to.":
    "บัญชีที่ยืนยันตัวตนจากภายนอกต้องระบุกลุ่มภายนอกที่สังกัด",
  "The firewall applies this immediately. If the address you are connected from is not in that list, this account stops working for you the moment it is saved — including for undoing it.":
    "firewall บังคับใช้ทันที · ถ้าที่อยู่ที่คุณต่อมาไม่อยู่ในรายการนั้น บัญชีนี้จะใช้ไม่ได้ทันทีที่บันทึก — รวมถึงใช้เพื่อย้อนกลับด้วย",
  "This is the only account that can fully administer the firewall":
    "นี่คือบัญชีเดียวที่ดูแล firewall ได้เต็มสิทธิ์",

  // Administrators (accounts on the FortiGate itself), HA Status and the access-profile list.
  // HA state words stay short: they sit in tiles beside a number.
  "Heartbeat": "ฮาร์ตบีต",
  "Log in to the device itself, over HTTPS or SSH — not this console's own users (Security ▸ Users).":
    "ใช้เข้าสู่ตัวอุปกรณ์โดยตรงผ่าน HTTPS หรือ SSH — ไม่ใช่ผู้ใช้ของคอนโซลนี้ (Security ▸ Users)",
  "No administrator accounts on this device.": "อุปกรณ์นี้ไม่มีบัญชีผู้ดูแลระบบ",
  "Not synced": "ยังไม่ซิงก์",
  "RAM": "แรม",
  "Reachable from any address with no second factor": "เข้าถึงได้จากทุกแอดเดรสโดยไม่มีการยืนยันตัวตนขั้นที่สอง",
  "SSH key set": "ตั้งคีย์ SSH แล้ว",
  "Synced": "ซิงก์แล้ว",
  "This administrator could not be found on the device": "ไม่พบผู้ดูแลระบบรายนี้บนอุปกรณ์",
  "What each profile allows. Edited on the device.": "แต่ละโปรไฟล์อนุญาตอะไรบ้าง แก้ไขบนตัวอุปกรณ์",
  "exposed": "เปิดกว้าง",
  "member list unreadable": "อ่านรายชื่อสมาชิกไม่ได้",
  "only full admin": "มีแต่แอดมินเต็มสิทธิ์",
  "override off": "ปิดการแทนที่",
  "override on": "เปิดการแทนที่",
  "reporting in": "รายงานเข้ามา",
  "session pickup off": "ปิดการรับช่วงเซสชัน",
  "session pickup on": "เปิดการรับช่วงเซสชัน",
  "this unit only": "เครื่องนี้เท่านั้น",

  // Device Identities / host pins
  "Device Identities":
    "ตัวตนของอุปกรณ์",
  "host key":
    "โฮสต์คีย์",
  "The SSH host keys and HTTPS certificates this console pinned on first contact":
    "โฮสต์คีย์ SSH และใบรับรอง HTTPS ที่คอนโซลนี้ปักไว้ตอนติดต่อครั้งแรก",
  "The first time this console reaches a firewall it remembers the identity that answered, and compares every connection afterwards against it. A connection that does not match is refused before any password is sent.":
    "ครั้งแรกที่คอนโซลนี้ติดต่อไฟร์วอลล์ จะจำตัวตนที่ตอบกลับมา แล้วเทียบการเชื่อมต่อทุกครั้งหลังจากนั้นกับตัวตนนั้น การเชื่อมต่อที่ไม่ตรงกันจะถูกปฏิเสธก่อนที่จะส่งรหัสผ่านออกไป",
  "A refusal means one of two things, and they are indistinguishable from here: somebody is answering in place of the firewall, or the firewall legitimately changed — a firmware upgrade that regenerated its host key, a replaced or expired certificate.":
    "การปฏิเสธหมายถึงอย่างใดอย่างหนึ่งจากสองอย่าง และจากที่นี่แยกไม่ออกว่าเป็นอันไหน: มีใครตอบแทนไฟร์วอลล์ หรือไฟร์วอลล์เปลี่ยนไปจริง ๆ — อัปเกรดเฟิร์มแวร์แล้วสร้างโฮสต์คีย์ใหม่ หรือใบรับรองถูกเปลี่ยนหรือหมดอายุ",
  "Compare the fingerprint below with the one on the device’s own console before clearing anything.":
    "เทียบลายนิ้วมือด้านล่างกับค่าที่อยู่บนคอนโซลของอุปกรณ์เองก่อนล้างอะไรทั้งนั้น",
  "One firewall can hold several rows. A FortiGate answers with a different SSH key depending on which algorithm the client asks for, so two SSH rows for one address is normal, not two machines.":
    "ไฟร์วอลล์เครื่องเดียวมีได้หลายแถว FortiGate ตอบด้วยโฮสต์คีย์ SSH ต่างกันตามอัลกอริทึมที่ไคลเอนต์ขอมา ดังนั้นสองแถว SSH ของที่อยู่เดียวเป็นเรื่องปกติ ไม่ใช่สองเครื่อง",
  "pinned identities":
    "ตัวตนที่ปักไว้",
  "Could not read the pinned identities":
    "อ่านตัวตนที่ปักไว้ไม่ได้",
  "Nothing is shown rather than an empty list: this page must never suggest a firewall is unpinned when it simply could not be read.":
    "ไม่แสดงอะไรเลยดีกว่าแสดงรายการว่าง หน้านี้ต้องไม่ทำให้เข้าใจว่าไฟร์วอลล์ยังไม่ถูกปัก เมื่อความจริงคืออ่านข้อมูลไม่ได้",
  "SSH host keys":
    "โฮสต์คีย์ SSH",
  "Port 22 — the backup, config push, terminal and diagnostics paths":
    "พอร์ต 22 — เส้นทางสำรองข้อมูล ส่งคอนฟิก เทอร์มินัล และวินิจฉัย",
  "HTTPS certificates":
    "ใบรับรอง HTTPS",
  "Port 443 — every page of this console reads the firewall over it":
    "พอร์ต 443 — ทุกหน้าของคอนโซลนี้อ่านไฟร์วอลล์ผ่านพอร์ตนี้",
  "Clear pinned identity":
    "ล้างตัวตนที่ปักไว้",
  "Forget the HTTPS certificate this console pinned for this device.":
    "ลืมใบรับรอง HTTPS ที่คอนโซลนี้ปักไว้สำหรับอุปกรณ์นี้",
  "What this console has been checking against:":
    "สิ่งที่คอนโซลนี้ใช้เทียบอยู่:",
  "The next connection to":
    "การเชื่อมต่อครั้งถัดไปไปยัง",
  "will pin whatever answers it":
    "จะปักตัวตนของอะไรก็ตามที่ตอบมา",
  ", without comparing it to anything. Do this only once you have read the new fingerprint on the device’s own console and it is the one you expect.":
    " โดยไม่เทียบกับอะไรเลย ทำสิ่งนี้เมื่ออ่านลายนิ้วมือใหม่บนคอนโซลของอุปกรณ์เองแล้ว และเป็นค่าที่คุณคาดไว้เท่านั้น",
  "expired":
    "หมดอายุ",
  "First seen":
    "พบครั้งแรก",
  "Clear pin":
    "ล้างการปัก",
};
