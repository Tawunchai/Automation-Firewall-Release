/**
 * Thai — the interpolated sentences of the AI Assistant.
 *
 * This is the largest pattern set in the app, because almost everything the impact analysis says is
 * a sentence built around a name the model chose or a value read back from the firewall. Two
 * conventions hold throughout:
 *
 *   - The quoted name inside a hole is the object's mkey. It stays verbatim, in its own quotes, so
 *     it can be matched against `show` output.
 *   - `Failed to {} X` takes an English verb ("create" / "update") from the call site. Thai puts the
 *     verb first, so these are phrased as `{}X ไม่สำเร็จ` — the verb lands where Thai wants it and
 *     the sentence still reads as one clause.
 */
import type { Dict } from "../merge";

export const aiPatterns: Dict = {
  // -- Chat and wizards ------------------------------------------------------
  "Ask {} anything… (Enter to send, Shift+Enter for a new line)":
    "ถาม {} ได้ทุกเรื่อง… (Enter เพื่อส่ง, Shift+Enter เพื่อขึ้นบรรทัดใหม่)",
  "Something went wrong: {}": "เกิดข้อผิดพลาด: {}",
  "Note: {}": "หมายเหตุ: {}",
  "Command: {}": "คำสั่ง: {}",
  "CLI commands: {}": "คำสั่ง CLI: {}",
  "Config deploy {}": "การปรับใช้คอนฟิก {}",
  "Address Wizard{}": "ตัวช่วยสร้างแอดเดรส{}",
  "Service Wizard{}": "ตัวช่วยสร้างเซอร์วิส{}",
  "Schedule Wizard{}": "ตัวช่วยสร้างตารางเวลา{}",
  "User Wizard{}": "ตัวช่วยสร้างผู้ใช้{}",
  "User Group Wizard{}": "ตัวช่วยสร้างกลุ่มผู้ใช้{}",
  "LDAP Server Wizard{}": "ตัวช่วยสร้างเซิร์ฟเวอร์ LDAP{}",
  "RADIUS Server Wizard{}": "ตัวช่วยสร้างเซิร์ฟเวอร์ RADIUS{}",
  "SD-WAN Wizard ({})": "ตัวช่วยสร้าง SD-WAN ({})",
  "Apply ALL ({})": "ปรับใช้ทั้งหมด ({})",
  "+{} more": "+ อีก {} รายการ",
  "Position {} of {}": "ตำแหน่งที่ {} จาก {}",
  "EDIT #{}": "แก้ไข #{}",
  "(unnamed #{})": "(ไม่มีชื่อ #{})",
  "Type {}": "ชนิด {}",
  "Country {}": "ประเทศ {}",
  "Source: {}": "ต้นทาง: {}",
  "Ports: {}": "พอร์ต: {}",
  "SSL: {}": "SSL: {}",
  "Protocols scanned: {}": "โปรโตคอลที่สแกน: {}",
  "Accepted on interface: {}": "รับเข้าที่อินเทอร์เฟซ: {}",
  "NPE {} rule": "กฎ NPE {}",
  "Every {}, {}": "ทุก {}, {}",
  "Once, {} {} → {} {}": "ครั้งเดียว, {} {} → {} {}",
  "A group of {} schedules ({})": "กลุ่มของตารางเวลา {} รายการ ({})",
  "during {} only": "เฉพาะช่วง {} เท่านั้น",
  "only during {}": "เฉพาะช่วง {} เท่านั้น",
  "· auth {}": "· การยืนยันตัวตน {}",
  "· email {}": "· อีเมล {}",
  "· two-factor: {}": "· สองชั้น: {}",
  "· secondary {}": "· สำรอง {}",
  "· {} member(s) ({}{})": "· สมาชิก {} ราย ({}{})",
  "Primary server {}": "เซิร์ฟเวอร์หลัก {}",
  "Server {}:{} · {} bind": "เซิร์ฟเวอร์ {}:{} · bind แบบ {}",
  "User Group · {}": "กลุ่มผู้ใช้ · {}",
  "Users → groups ({} → {})": "ผู้ใช้ → กลุ่ม ({} → {})",
  "Users / authentication servers ({})": "ผู้ใช้ / เซิร์ฟเวอร์ยืนยันตัวตน ({})",
  "users on {}": "ผู้ใช้บน {}",
  "~{} hosts": "ประมาณ {} โฮสต์",
  "out of {}": "จากทั้งหมด {}",

  // -- What Apply would do ---------------------------------------------------
  'Creates a new policy "{}" on the device': 'สร้างนโยบายใหม่ "{}" บนอุปกรณ์',
  'Edits the existing policy "{}" on the device': 'แก้ไขนโยบาย "{}" ที่มีอยู่บนอุปกรณ์',
  'Creates a new {} "{}" on the device': 'สร้าง{}ใหม่ "{}" บนอุปกรณ์',
  'Overwrites the existing {} "{}" on the device — the previous values of the edited fields are lost':
    'เขียนทับ{} "{}" ที่มีอยู่บนอุปกรณ์ — ค่าเดิมของช่องที่แก้ไขจะหายไป',
  'Checked: policy "{}" already exists on the device, so this apply edits it':
    'ตรวจแล้ว: นโยบาย "{}" มีอยู่บนอุปกรณ์แล้ว การปรับใช้ครั้งนี้จึงเป็นการแก้ไข',
  'Checked: policy "{}" is not on the device, so this apply creates it':
    'ตรวจแล้ว: ไม่มีนโยบาย "{}" บนอุปกรณ์ การปรับใช้ครั้งนี้จึงเป็นการสร้างใหม่',
  "Checked: a {} with this name already exists on the device, so this apply overwrites rather than creates":
    "ตรวจแล้ว: มี{}ชื่อนี้อยู่บนอุปกรณ์แล้ว การปรับใช้ครั้งนี้จึงเป็นการเขียนทับ ไม่ใช่การสร้างใหม่",
  "Checked: no {} with this name is on the device, so this apply creates a new one":
    "ตรวจแล้ว: ไม่มี{}ชื่อนี้บนอุปกรณ์ การปรับใช้ครั้งนี้จึงเป็นการสร้างใหม่",
  'This edits an existing object rather than creating one — every policy that references {} "{}" picks up the new values the moment you apply':
    'นี่คือการแก้ไขอ็อบเจกต์ที่มีอยู่แล้ว ไม่ใช่การสร้างใหม่ — ทุกนโยบายที่อ้างอิง{} "{}" จะได้ค่าใหม่ทันทีที่คุณปรับใช้',
  "Creates the {} object(s) this policy references first":
    "สร้างอ็อบเจกต์ {} รายการที่นโยบายนี้อ้างอิงถึงก่อน",
  "Creates {} security profile(s) — a profile no policy references inspects nothing":
    "สร้างโปรไฟล์ความปลอดภัย {} รายการ — โปรไฟล์ที่ไม่มีนโยบายใดอ้างอิงจะไม่ตรวจสอบอะไรเลย",
  'Creates IPsec tunnel "{}" ({}) with its phase 1 / phase 2 and the addresses, policies and routes it needs':
    'สร้างอุโมงค์ IPsec "{}" ({}) พร้อมเฟส 1 / เฟส 2 และแอดเดรส นโยบาย และเส้นทางที่จำเป็น',
  "Adds {} user account(s) and {} group(s) —": "เพิ่มบัญชีผู้ใช้ {} บัญชี และกลุ่ม {} กลุ่ม —",
  "Interacts with {} existing {}": "มีปฏิสัมพันธ์กับ{}ที่มีอยู่แล้ว {} รายการ",
  "Applied {} object{} to the device": "ปรับใช้อ็อบเจกต์ {} รายการ{}ลงอุปกรณ์แล้ว",
  "({}), then the policy itself": "({}) แล้วจึงเป็นตัวนโยบายเอง",
  "This config contains a section with no REST endpoint ({}),":
    "คอนฟิกนี้มีส่วนที่ไม่มีปลายทาง REST รองรับ ({}),",
  'Create {} "{}" Success': 'สร้าง{} "{}" สำเร็จ',
  'Update {} "{}" Success': 'อัปเดต{} "{}" สำเร็จ',
  'Create Exchange Connector "{}" Success': 'สร้างตัวเชื่อมต่อ Exchange "{}" สำเร็จ',

  // -- SD-WAN apply ----------------------------------------------------------
  "Builds {} SD-WAN object(s) on {}, in the order they depend on each other: zones → members → performance SLAs → rules":
    "สร้างอ็อบเจกต์ SD-WAN {} รายการบน {} ตามลำดับการพึ่งพากัน: โซน → สมาชิก → SLA ประสิทธิภาพ → กฎ",
  "Created {} SD-WAN object(s) on {}": "สร้างอ็อบเจกต์ SD-WAN {} รายการบน {} แล้ว",
  "All {} {} are on the device.": "{} {} ทั้งหมดมีอยู่บนอุปกรณ์แล้ว",
  "Adds {} to SD-WAN — once SD-WAN is on,": "เพิ่ม {} เข้า SD-WAN — เมื่อเปิดใช้ SD-WAN แล้ว",
  "Adds {} to SD-WAN — the firewall assigns each a sequence number, and the SLAs and rules below are pointed at those numbers, not at the ones in the proposal":
    "เพิ่ม {} เข้า SD-WAN — ไฟร์วอลล์จะกำหนดหมายเลขลำดับให้แต่ละรายการ และ SLA กับกฎด้านล่างจะชี้ไปที่หมายเลขเหล่านั้น ไม่ใช่หมายเลขในข้อเสนอ",
  "Adds {} SD-WAN rule(s), which are first-match top to bottom like firewall policies":
    "เพิ่มกฎ SD-WAN {} ข้อ ซึ่งทำงานแบบกฎแรกที่ตรงเป็นผู้ชนะจากบนลงล่าง เหมือนนโยบายไฟร์วอลล์",
  'Member "{}" names no SD-WAN zone.': 'สมาชิก "{}" ไม่ได้ระบุโซน SD-WAN',
  'Member "{}" is in zone "{}", which this proposal does not create and the device does not have.':
    'สมาชิก "{}" อยู่ในโซน "{}" ซึ่งข้อเสนอนี้ไม่ได้สร้าง และอุปกรณ์ก็ไม่มี',
  'Rule "{}" names no outgoing member or zone this proposal creates, so it would never steer anything.':
    'กฎ "{}" ไม่ได้ระบุสมาชิกขาออกหรือโซนที่ข้อเสนอนี้สร้างขึ้น จึงจะไม่กำหนดทิศทางอะไรเลย',
  'Rule "{}" uses the Best-quality strategy but names no measured SLA.':
    'กฎ "{}" ใช้กลยุทธ์คุณภาพดีที่สุด แต่ไม่ได้ระบุ SLA ที่ใช้วัด',
  'Rule "{}" uses the {} strategy but names no required SLA target.':
    'กฎ "{}" ใช้กลยุทธ์ {} แต่ไม่ได้ระบุเป้าหมาย SLA ที่ต้องผ่าน',
  '"{}" cannot become an SD-WAN member while firewall':
    '"{}" เป็นสมาชิก SD-WAN ไม่ได้ ตราบใดที่ยังมีนโยบายไฟร์วอลล์',

  // -- Missing prerequisites -------------------------------------------------
  'Address "{}" doesn\'t exist on the device and has no definition to create it. Open the Address Wizard for it first, or pick an existing address.':
    'ไม่มีแอดเดรส "{}" บนอุปกรณ์ และไม่มีนิยามให้สร้าง เปิดตัวช่วยสร้างแอดเดรสสำหรับรายการนี้ก่อน หรือเลือกแอดเดรสที่มีอยู่แล้ว',
  'Service "{}" doesn\'t exist on the device and has no definition to create it. Open the Service Wizard for it first, or pick an existing service.':
    'ไม่มีเซอร์วิส "{}" บนอุปกรณ์ และไม่มีนิยามให้สร้าง เปิดตัวช่วยสร้างเซอร์วิสสำหรับรายการนี้ก่อน หรือเลือกเซอร์วิสที่มีอยู่แล้ว',
  'Schedule "{}" doesn\'t exist on the device and has no definition to create it. Open the Schedule Wizard for it first, or pick an existing schedule.':
    'ไม่มีตารางเวลา "{}" บนอุปกรณ์ และไม่มีนิยามให้สร้าง เปิดตัวช่วยสร้างตารางเวลาสำหรับรายการนี้ก่อน หรือเลือกตารางเวลาที่มีอยู่แล้ว',
  'The name "{}" is already taken on the device (type {}) — FortiGate shares one name space across all schedule types':
    'ชื่อ "{}" ถูกใช้ไปแล้วบนอุปกรณ์ (ชนิด {}) — FortiGate ใช้เนมสเปซเดียวร่วมกันทุกชนิดของตารางเวลา',
  'This address is bound to interface "{}" — it only works in a policy whose source or destination interface is the same one':
    'แอดเดรสนี้ผูกอยู่กับอินเทอร์เฟซ "{}" — ใช้ได้เฉพาะในนโยบายที่อินเทอร์เฟซต้นทางหรือปลายทางเป็นตัวเดียวกันเท่านั้น',
  "Could not evaluate {} (FQDN / geography / not readable from the device) —":
    "ประเมิน {} ไม่ได้ (FQDN / ภูมิศาสตร์ / อ่านจากอุปกรณ์ไม่ได้) —",

  // -- Policy shadowing ------------------------------------------------------
  'Placement: above policy "{}" — FortiGate matches top to bottom (first match wins)':
    'ตำแหน่ง: เหนือนโยบาย "{}" — FortiGate จับคู่จากบนลงล่าง (กฎแรกที่ตรงเป็นผู้ชนะ)',
  '"{}" (position {}) matches this traffic first —': '"{}" (ตำแหน่งที่ {}) ตรงกับทราฟฟิกนี้ก่อน —',
  'the new policy would never be reached (first match wins); move it above "{}" for it to take effect':
    'นโยบายใหม่จะไม่มีวันถูกไปถึง (กฎแรกที่ตรงเป็นผู้ชนะ); ย้ายไปไว้เหนือ "{}" เพื่อให้มีผล',
  "the new policy fully covers this one and does the opposite ({} vs {}) —":
    "นโยบายใหม่ครอบคลุมข้อนี้ทั้งหมดและทำตรงกันข้าม ({} เทียบกับ {}) —",
  "this policy already covers the same traffic and does the same thing ({}) — the new one adds nothing":
    "นโยบายข้อนี้ครอบคลุมทราฟฟิกเดียวกันและทำสิ่งเดียวกันอยู่แล้ว ({}) — ข้อใหม่จึงไม่ได้เพิ่มอะไร",
  "this policy sits above it and {} all of the same traffic —":
    "นโยบายข้อนี้อยู่เหนือกว่า และ{}ทราฟฟิกชุดเดียวกันทั้งหมด —",
  "traffic partly overlaps and the actions differ ({} vs {}) — order decides which one wins":
    "ทราฟฟิกทับซ้อนกันบางส่วนและการกระทำต่างกัน ({} เทียบกับ {}) — ลำดับเป็นตัวตัดสินว่าข้อใดชนะ",
  "so which rule shadows which cannot be confirmed ({} vs {})":
    "จึงยืนยันไม่ได้ว่ากฎข้อใดบังข้อใด ({} เทียบกับ {})",
  'Policy "{}" allows every source, destination and service — it is wide open':
    'นโยบาย "{}" อนุญาตทุกต้นทาง ทุกปลายทาง และทุกเซอร์วิส — เปิดกว้างทั้งหมด',
  'Policy "{}" has no security profile attached — traffic passes without being scanned':
    'นโยบาย "{}" ไม่ได้แนบโปรไฟล์ความปลอดภัยไว้ — ทราฟฟิกจะผ่านไปโดยไม่ถูกสแกน',
  "before \"{}\"": 'ก่อน "{}"',
  "Top of {}": "บนสุดของ {}",
  "Bottom of {}": "ล่างสุดของ {}",

  // -- Traffic descriptions --------------------------------------------------
  "Traffic to {} leaves through {}": "ทราฟฟิกไปยัง {} ออกทาง {}",
  "Traffic to {} will leave through {} instead": "ทราฟฟิกไปยัง {} จะออกทาง {} แทน",
  "All traffic to {} is dropped (blackhole)": "ทราฟฟิกทั้งหมดไปยัง {} ถูกทิ้ง (blackhole)",
  "Drops all traffic to {} (blackhole route)":
    "ทิ้งทราฟฟิกทั้งหมดที่ไปยัง {} (เส้นทางแบบ blackhole)",
  "Allowed by {} —": "อนุญาตโดย {} —",
  "IP of interface {}": "IP ของอินเทอร์เฟซ {}",
  "IP pool {}{}": "IP pool {}{}",
  "IP protocol {}": "โปรโตคอล IP {}",
  "· NAT on — the source is rewritten to the IP of {}":
    "· เปิด NAT — ต้นทางถูกเขียนใหม่เป็น IP ของ {}",
  "({}) on service {}{}{}": "({}) บนเซอร์วิส {}{}{}",
  "Internet Service #{}": "อินเทอร์เน็ตเซอร์วิส #{}",
  "Internet Service {}": "อินเทอร์เน็ตเซอร์วิส {}",
  "Static Route → {}": "เส้นทางสแตติก → {}",
  "via gateway {}": "ผ่านเกตเวย์ {}",
  "via {} ({})": "ผ่าน {} ({})",
  "distance {} · priority {}": "ระยะทาง {} · ลำดับความสำคัญ {}",
  "bound to {}": "ผูกกับ {}",
  "(bound to interface {})": "(ผูกกับอินเทอร์เฟซ {})",
  "— behind interface {}": "— อยู่หลังอินเทอร์เฟซ {}",

  // -- Per-profile summaries -------------------------------------------------
  "AntiVirus — {}": "แอนตี้ไวรัส — {}",
  "Web Filter — {}": "กรองเว็บ — {}",
  "DNS Filter — {}": "กรอง DNS — {}",
  "Application Control — {}": "ควบคุมแอปพลิเคชัน — {}",
  "File Filter — {}": "กรองไฟล์ — {}",
  "Virtual IP — {}": "เวอร์ชวล IP — {}",
  "IPsec VPN — {}": "VPN IPsec — {}",
  "Hub-and-Spoke (FortiGate {}) — created by the AI Assistant":
    "ฮับแอนด์สโป๊ก (FortiGate {}) — สร้างโดยผู้ช่วย AI",
  "Remote Access ({}) — created by the AI Assistant":
    "การเข้าถึงระยะไกล ({}) — สร้างโดยผู้ช่วย AI",

  // -- Failures --------------------------------------------------------------
  "Failed to {} policy": "{}นโยบายไม่สำเร็จ",
  "Failed to {} address": "{}แอดเดรสไม่สำเร็จ",
  "Failed to {} service": "{}เซอร์วิสไม่สำเร็จ",
  "Failed to {} schedule": "{}ตารางเวลาไม่สำเร็จ",
  "Failed to {} route": "{}เส้นทางไม่สำเร็จ",
  "Failed to {} virtual IP": "{}เวอร์ชวล IP ไม่สำเร็จ",
  "Failed to {} user": "{}ผู้ใช้ไม่สำเร็จ",
  "Failed to {} user group": "{}กลุ่มผู้ใช้ไม่สำเร็จ",
  "Failed to {} LDAP server": "{}เซิร์ฟเวอร์ LDAP ไม่สำเร็จ",
  "Failed to {} RADIUS server": "{}เซิร์ฟเวอร์ RADIUS ไม่สำเร็จ",
  "Failed to {} AntiVirus profile": "{}โปรไฟล์แอนตี้ไวรัสไม่สำเร็จ",
  "Failed to {} Web Filter profile": "{}โปรไฟล์กรองเว็บไม่สำเร็จ",
  "Failed to {} DNS Filter profile": "{}โปรไฟล์กรอง DNS ไม่สำเร็จ",
  "Failed to {} Application Control list": "{}รายการควบคุมแอปพลิเคชันไม่สำเร็จ",
  "Failed to {} File Filter profile": "{}โปรไฟล์กรองไฟล์ไม่สำเร็จ",

  // -- Fallback --------------------------------------------------------------
  "Fallback ({})": "ย้อนคืน ({})",
  'Fallback: {} "{}"': 'ย้อนคืน: {} "{}"',
  'Fallback: {} "{}" — previous values restored': 'ย้อนคืน: {} "{}" — คืนค่าเดิมแล้ว',
  'Fallback failed for {} "{}" — {}': 'ย้อนคืน{} "{}" ไม่สำเร็จ — {}',
  "Fallback success — {}": "ย้อนคืนสำเร็จ — {}",
  "Fallback incomplete — {} object(s) are still on the device":
    "ย้อนคืนไม่ครบ — ยังมีอ็อบเจกต์ {} รายการอยู่บนอุปกรณ์",
  "Removed {} object(s) from the firewall": "ลบอ็อบเจกต์ {} รายการออกจากไฟร์วอลล์แล้ว",
  "Restored {} object(s)": "คืนค่าอ็อบเจกต์ {} รายการแล้ว",
  '"{}" is still referenced by another object on the device, so FortiGate refuses to delete it':
    '"{}" ยังถูกอ้างอิงโดยอ็อบเจกต์อื่นบนอุปกรณ์ FortiGate จึงปฏิเสธที่จะลบ',

  // -- Simulate ----------------------------------------------------------------------
  "~{} addresses": "~{} แอดเดรส",
  "~{} addresses · on {}": "~{} แอดเดรส · บน {}",
  "unrestricted · on {}": "ไม่จำกัด · บน {}",
  "any source · on {}": "ทุกต้นทาง · บน {}",
  "Above “{}”": "เหนือ “{}”",
  "Walk the rule table again from \"{}\"": "ไล่ตารางกฎอีกครั้งจาก \"{}\"",
  "Place it above \"{}\", which currently claims this traffic first": "วางไว้เหนือ \"{}\" ซึ่งตอนนี้รับทราฟฟิกนี้ไปก่อน",
  "“{}” already matches this traffic and sits above it. FortiOS stops at the first match, so the firewall would behave exactly as it does now.":
    "“{}” ตรงกับทราฟฟิกนี้อยู่แล้วและอยู่ด้านบน FortiOS หยุดที่กฎแรกที่ตรง ไฟร์วอลล์จึงทำงานเหมือนตอนนี้ทุกประการ",
  "\"{}\" already matches this traffic and sits above it, so the new rule can never run.":
    "\"{}\" ตรงกับทราฟฟิกนี้อยู่แล้วและอยู่ด้านบน กฎใหม่จึงไม่มีวันถูกใช้",
  ", and {}": " และ {}",
  "And it is now inspected by {}.": "และตอนนี้ถูกตรวจสอบโดย {}",
  "AntiVirus: {}": "AntiVirus: {}",
  "Web Filter: {}": "Web Filter: {}",
  "DNS Filter: {}": "DNS Filter: {}",
  "App Control: {}": "App Control: {}",
  "IPS: {}": "IPS: {}",
  "File Filter: {}": "File Filter: {}",
  "\"{}\" (#{}) carries less than it did": "\"{}\" (#{}) รับทราฟฟิกน้อยลงกว่าเดิม",
  "Everything it matches is already claimed by \"{}\" one row above, so it can never run again.":
    "ทุกอย่างที่กฎนี้ตรงถูก \"{}\" ที่อยู่เหนือขึ้นไปหนึ่งแถวรับไปหมดแล้ว จึงไม่มีวันถูกใช้อีก",
  "Flow {} could not be evaluated": "ประเมินโฟลว์ {} ไม่ได้",
  "It still matches {} → {} on {}, minus the part \"{}\" now claims one row above. Worth checking that what it keeps is still what it was written for.":
    "กฎนี้ยังตรงกับ {} → {} บน {} ยกเว้นส่วนที่ \"{}\" ซึ่งอยู่เหนือขึ้นไปหนึ่งแถวรับไปแล้ว ควรตรวจว่าส่วนที่เหลือยังตรงกับจุดประสงค์เดิมของกฎ",
  "Out of {}. Anything on that network that still needs to get out needs a rule ABOVE this one, created in the same change.":
    "ออกทาง {} อะไรก็ตามในเครือข่ายนั้นที่ยังต้องออกไปได้ ต้องมีกฎที่อยู่เหนือกฎนี้ สร้างไว้ในการเปลี่ยนแปลงเดียวกัน",
  "Still matches, but the part it shares with \"{}\" now stops one row higher.":
    "ยังตรงอยู่ แต่ส่วนที่ใช้ร่วมกับ \"{}\" จะหยุดเร็วขึ้นหนึ่งแถว",
  "Taken from \"{}\" — a rule below the new one on the same interface pair":
    "นำมาจาก \"{}\" — กฎที่อยู่ใต้กฎใหม่บนคู่อินเทอร์เฟซเดียวกัน",
  "Tested top to bottom. {} of the {} policies never share this interface pair and are folded into the grey bands.":
    "ทดสอบจากบนลงล่าง นโยบาย {} จาก {} ตัวไม่ได้อยู่บนคู่อินเทอร์เฟซนี้ จึงถูกพับรวมไว้ในแถบสีเทา",
  "The walk stopped at \"{}\" because {} cannot be reduced to an address range — an FQDN, a geography object, or a name the device did not answer for. No conclusion is drawn about it either way.":
    "การไล่หยุดที่ \"{}\" เพราะ {} แปลงเป็นช่วงแอดเดรสไม่ได้ — อาจเป็น FQDN อ็อบเจกต์ geography หรือชื่อที่อุปกรณ์ไม่ได้ตอบกลับ จึงไม่สรุปผลใดๆ เกี่ยวกับกฎนั้น",
  "\"{}\" (#{}) was permitting it on this path and can no longer be reached. Nothing on the device reports this; the traffic simply starts failing.":
    "\"{}\" (#{}) เคยอนุญาตทราฟฟิกนี้บนเส้นทางนี้ และจะไม่มีวันถูกใช้อีก อุปกรณ์จะไม่รายงานเรื่องนี้ ทราฟฟิกจะเริ่มใช้ไม่ได้เฉยๆ",

  // -- The AI Chat Clear control -------------------------------------------------
  "Clearing leaves the {} objects this conversation put on the firewall exactly where they are, and removes the Fallback buttons that would have taken them back off — you would have to delete them by hand.": "การล้างจะไม่แตะอ็อบเจกต์ {} รายการที่บทสนทนานี้สร้างไว้บนไฟร์วอลล์ แต่จะทำให้ปุ่ม Fallback ที่ใช้ถอนมันออกหายไปด้วย — คุณจะต้องไปลบเองด้วยมือ",

  "Another service the new rule {}": "บริการอื่นที่กฎใหม่ {}",
  "Only {} more image{} could be added (max {})": "เพิ่มรูปได้อีกเพียง {} รูป{} (สูงสุด {})",
  "SD-WAN member \"{}\" is not on the device": "ไม่มีสมาชิก SD-WAN \"{}\" อยู่บนอุปกรณ์",
  "Up to {} images per message": "สูงสุด {} รูปต่อหนึ่งข้อความ",
  "VPN Wizard · {}": "ตัวช่วยสร้าง VPN · {}",
  "You can attach up to {} images per message": "คุณแนบรูปได้สูงสุด {} รูปต่อหนึ่งข้อความ",
  "any source · {} sample flow{}": "ทุกต้นทาง · {} โฟลว์ตัวอย่าง{}",
  "static route \"{}\" is not in the device's route table":
    "ไม่มีเส้นทางแบบกำหนดเอง \"{}\" อยู่ในตารางเส้นทางของอุปกรณ์",
  "the {} network": "เครือข่าย {}",
};
