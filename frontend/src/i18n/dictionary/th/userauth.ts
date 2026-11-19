/**
 * Thai — User & Authentication: User Definition, User Groups, LDAP and RADIUS servers, and the
 * Exchange connector.
 *
 * LDAP's own vocabulary (Distinguished Name, Common Name Identifier, Bind Type, and the sample DNs)
 * is kept close to the English because it has to match what the directory administrator sees on the
 * other side — a `cn=` is a `cn=` in every language, and the sample strings are literal.
 *
 * The dial-code country names are a separate short list from ./countries.ts; they are the entries
 * the SMS field offers, and they are translated the same way.
 */
import type { Dict } from "../merge";

export const userauth: Dict = {
  // -- Users -----------------------------------------------------------------
  Username: "ชื่อผู้ใช้",
  "User ID": "รหัสผู้ใช้",
  "User Type": "ชนิดผู้ใช้",
  "User Account Status": "สถานะบัญชีผู้ใช้",
  "Users/Groups Creation Wizard": "ตัวช่วยสร้างผู้ใช้/กลุ่ม",
  "Loading user…": "กำลังโหลดผู้ใช้…",
  "Loading user group…": "กำลังโหลดกลุ่มผู้ใช้…",
  "Failed to create user": "สร้างผู้ใช้ไม่สำเร็จ",
  "Failed to update user": "อัปเดตผู้ใช้ไม่สำเร็จ",
  "Failed to create user group": "สร้างกลุ่มผู้ใช้ไม่สำเร็จ",
  "Failed to update user group": "อัปเดตกลุ่มผู้ใช้ไม่สำเร็จ",
  "User not found — go back to the list.": "ไม่พบผู้ใช้ — กลับไปที่รายการ",
  "User group not found — go back to the list.": "ไม่พบกลุ่มผู้ใช้ — กลับไปที่รายการ",
  "Enter both a username and a password": "กรอกทั้งชื่อผู้ใช้และรหัสผ่าน",
  "Leave blank to keep the stored password — the FortiGate never returns it.":
    "เว้นว่างไว้เพื่อคงรหัสผ่านเดิม — FortiGate จะไม่ส่งรหัสผ่านกลับมาเลย",
  "Leave blank to keep the stored secret — the FortiGate never returns it.":
    "เว้นว่างไว้เพื่อคงค่า secret เดิม — FortiGate จะไม่ส่งค่านี้กลับมาเลย",
  "Create the first": "สร้างรายการแรก",
  "Stored as username": "เก็บไว้เป็นชื่อผู้ใช้",
  "is available — the remote types need a RADIUS/TACACS+/LDAP server object, and FSSO/FortiNAC users aren't stored on this device.":
    "ใช้ได้ — ชนิดที่เป็นรีโมตต้องมีอ็อบเจกต์เซิร์ฟเวอร์ RADIUS/TACACS+/LDAP และผู้ใช้ FSSO/FortiNAC ไม่ได้ถูกเก็บไว้บนอุปกรณ์นี้",
  Only: "เฉพาะ",

  // -- Groups ----------------------------------------------------------------
  "New User Group": "กลุ่มผู้ใช้ใหม่",
  "Remote Groups": "กลุ่มจากเซิร์ฟเวอร์ภายนอก",
  "Add Remote Group": "เพิ่มกลุ่มจากเซิร์ฟเวอร์ภายนอก",
  "— remote server —": "— เซิร์ฟเวอร์ภายนอก —",
  "Include in every user group": "รวมไว้ในทุกกลุ่มผู้ใช้",
  "Select Entries": "เลือกรายการ",
  Browse: "เรียกดู",
  "Name of the RADIUS user group this group represents":
    "ชื่อกลุ่มผู้ใช้ RADIUS ที่กลุ่มนี้เป็นตัวแทน",
  "RADIUS Attribute Value": "ค่าแอตทริบิวต์ของ RADIUS",
  "Changing the type clears the settings that don't apply to the new type (members are dropped).":
    "การเปลี่ยนชนิดจะล้างการตั้งค่าที่ใช้กับชนิดใหม่ไม่ได้ทิ้งไป (สมาชิกจะถูกลบออก)",
  "Each remote server used here is added to Members automatically — the FortiGate rejects the whole group otherwise (error -518).":
    "เซิร์ฟเวอร์ภายนอกทุกตัวที่ใช้ที่นี่จะถูกเพิ่มเข้าไปในสมาชิกโดยอัตโนมัติ — มิฉะนั้น FortiGate จะปฏิเสธทั้งกลุ่ม (error -518)",
  "No Firewall/FSSO groups on this device — guest and RSSO groups can't take members.":
    "อุปกรณ์นี้ไม่มีกลุ่ม Firewall/FSSO — กลุ่มแบบ guest และ RSSO รับสมาชิกไม่ได้",
  "No FSSO groups on this device — configure an FSSO agent first (User & Authentication > Single Sign-On).":
    "อุปกรณ์นี้ไม่มีกลุ่ม FSSO — ตั้งค่าเอเจนต์ FSSO ก่อน (ผู้ใช้และการยืนยันตัวตน > Single Sign-On)",
  "No remote authentication servers on this device — add one under User & Authentication > LDAP Servers or RADIUS Servers first.":
    "อุปกรณ์นี้ไม่มีเซิร์ฟเวอร์ยืนยันตัวตนภายนอก — เพิ่มสักตัวที่ ผู้ใช้และการยืนยันตัวตน > เซิร์ฟเวอร์ LDAP หรือเซิร์ฟเวอร์ RADIUS ก่อน",

  // -- Guest accounts --------------------------------------------------------
  "Batch Guest Account Creation": "การสร้างบัญชีผู้มาเยือนเป็นชุด",
  "Guest Details": "รายละเอียดผู้มาเยือน",
  "Maximum Accounts": "จำนวนบัญชีสูงสุด",
  Expiration: "การหมดอายุ",
  "Start Countdown": "เริ่มนับถอยหลัง",
  Sponsor: "ผู้รับรอง",
  Company: "บริษัท",
  "Auto Generated": "สร้างอัตโนมัติ",
  "Batch creation generates accounts automatically: the FortiGate forces":
    "การสร้างเป็นชุดจะสร้างบัญชีให้อัตโนมัติ โดย FortiGate จะบังคับให้เป็น",
  "and ignores the Guest Details below. Expiration and Maximum Accounts still apply.":
    "และจะไม่สนใจรายละเอียดผู้มาเยือนด้านล่าง ส่วนการหมดอายุและจำนวนบัญชีสูงสุดยังมีผลอยู่",

  // -- Two-factor / tokens ---------------------------------------------------
  "Two-factor Authentication": "การยืนยันตัวตนสองชั้น",
  Token: "โทเคน",
  "Enable Email": "เปิดใช้อีเมล",
  "Enable SMS": "เปิดใช้ SMS",
  "Enable Name": "เปิดใช้ชื่อ",
  SMS: "SMS",
  "SMS Server": "เซิร์ฟเวอร์ SMS",
  "— select an SMS server —": "— เลือกเซิร์ฟเวอร์ SMS —",
  "Email Address": "ที่อยู่อีเมล",
  "Phone Number": "หมายเลขโทรศัพท์",
  "Country Dial Code": "รหัสประเทศสำหรับโทรออก",
  "This FortiGate has no FortiToken Cloud subscription":
    "FortiGate เครื่องนี้ไม่มีการสมัครใช้บริการ FortiToken Cloud",
  "FortiToken Cloud offers scalable and centrally-managed two factor authentication. A":
    "FortiToken Cloud ให้บริการยืนยันตัวตนสองชั้นที่ขยายขนาดได้และจัดการจากศูนย์กลาง โดยมี",
  "trial subscription": "การสมัครใช้แบบทดลอง",
  "is available free of charge.": "ให้ใช้ได้ฟรี",
  "for a token that already exists on the device.": "สำหรับโทเคนที่มีอยู่บนอุปกรณ์แล้ว",
  "until one is activated. Use": "จนกว่าจะมีการเปิดใช้งาน ใช้",
  "— saving will return": "— การบันทึกจะคืนค่า",
  "No FortiTokens on this device — add one under User & Authentication > FortiTokens first.":
    "อุปกรณ์นี้ไม่มี FortiToken — เพิ่มสักตัวที่ ผู้ใช้และการยืนยันตัวตน > FortiTokens ก่อน",
  "No custom SMS servers on this device — add one under System > SMS Server, or use FortiGuard.":
    "อุปกรณ์นี้ไม่มีเซิร์ฟเวอร์ SMS ที่กำหนดเอง — เพิ่มสักตัวที่ ระบบ > เซิร์ฟเวอร์ SMS หรือใช้ FortiGuard",
  "Get the app": "ดาวน์โหลดแอป",
  "Manage your devices on iOS or Android. iOS users can also manage FortiToken Cloud subscriptions.":
    "จัดการอุปกรณ์ของคุณบน iOS หรือ Android ผู้ใช้ iOS ยังจัดการการสมัครใช้ FortiToken Cloud ได้ด้วย",

  // -- LDAP ------------------------------------------------------------------
  "New LDAP Server": "เซิร์ฟเวอร์ LDAP ใหม่",
  "Loading LDAP server…": "กำลังโหลดเซิร์ฟเวอร์ LDAP…",
  "LDAP server not found — go back to the list.": "ไม่พบเซิร์ฟเวอร์ LDAP — กลับไปที่รายการ",
  "Failed to create LDAP server": "สร้างเซิร์ฟเวอร์ LDAP ไม่สำเร็จ",
  "Failed to update LDAP server": "อัปเดตเซิร์ฟเวอร์ LDAP ไม่สำเร็จ",
  "Bind Type": "ชนิดการ Bind",
  "Server IP/Name": "IP/ชื่อเซิร์ฟเวอร์",
  "Server Port": "พอร์ตเซิร์ฟเวอร์",
  "Server identity check": "การตรวจสอบตัวตนของเซิร์ฟเวอร์",
  "Secure Connection": "การเชื่อมต่อแบบปลอดภัย",
  Certificate: "ใบรับรอง",
  Plain: "แบบธรรมดา",
  "FortiOS 7.2.10 exposes no LDAP test endpoint, so these are disabled. RADIUS servers do have one — see User & Authentication > RADIUS Servers.":
    "FortiOS 7.2.10 ไม่มีปลายทาง API สำหรับทดสอบ LDAP ปุ่มเหล่านี้จึงถูกปิดไว้ ส่วนเซิร์ฟเวอร์ RADIUS มีให้ใช้ — ดูที่ ผู้ใช้และการยืนยันตัวตน > เซิร์ฟเวอร์ RADIUS",

  // -- RADIUS ----------------------------------------------------------------
  "New RADIUS Server": "เซิร์ฟเวอร์ RADIUS ใหม่",
  "Loading RADIUS server…": "กำลังโหลดเซิร์ฟเวอร์ RADIUS…",
  "RADIUS server not found — go back to the list.":
    "ไม่พบเซิร์ฟเวอร์ RADIUS — กลับไปที่รายการ",
  "Failed to create RADIUS server": "สร้างเซิร์ฟเวอร์ RADIUS ไม่สำเร็จ",
  "Failed to update RADIUS server": "อัปเดตเซิร์ฟเวอร์ RADIUS ไม่สำเร็จ",
  "Authentication method": "วิธียืนยันตัวตน",
  "Authentication Type": "ชนิดการยืนยันตัวตน",
  Secret: "Secret",
  "Override server IP address": "แทนที่ IP แอดเดรสของเซิร์ฟเวอร์",
  "Auto-discover KDC": "ค้นหา KDC อัตโนมัติ",
  Test: "ทดสอบ",
  "Testing…": "กำลังทดสอบ…",
  "Test Connectivity": "ทดสอบการเชื่อมต่อ",
  "Test User Credentials": "ทดสอบข้อมูลรับรองของผู้ใช้",

  // -- Exchange connector ----------------------------------------------------
  "Exchange account": "บัญชี Exchange",
  "Exchange server": "เซิร์ฟเวอร์ Exchange",
  "Exchange Server Connector": "ตัวเชื่อมต่อเซิร์ฟเวอร์ Exchange",
  "New External Connector": "ตัวเชื่อมต่อภายนอกใหม่",
  "Connector Settings": "การตั้งค่าตัวเชื่อมต่อ",
  "Failed to create Exchange connector": "สร้างตัวเชื่อมต่อ Exchange ไม่สำเร็จ",
  ", domain": ", โดเมน",
  ", server": ", เซิร์ฟเวอร์",

  // -- Small controls --------------------------------------------------------
  "< Back": "< ย้อนกลับ",
  Submit: "ส่ง",
  Yes: "ใช่",
  No: "ไม่",

  // -- SMS dial-code countries ----------------------------------------------
  "United States / Canada": "สหรัฐอเมริกา / แคนาดา",
  "Russia / Kazakhstan": "รัสเซีย / คาซัคสถาน",
  "South Korea": "เกาหลีใต้",
  Macau: "มาเก๊า",
  "International Freephone": "หมายเลขโทรฟรีระหว่างประเทศ",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Administrators reach every device": "ผู้ดูแลระบบเข้าถึงได้ทุกอุปกรณ์",
  "After First Login": "หลังเข้าสู่ระบบครั้งแรก",
  "Anonymous": "ไม่ระบุตัวตน",
  "Default": "ค่าเริ่มต้น",
  "Edit this user to change which devices they can work on": "แก้ไขผู้ใช้รายนี้เพื่อเปลี่ยนอุปกรณ์ที่เขาทำงานด้วยได้",
  "events logged": "เหตุการณ์ที่บันทึกไว้",
  "Firewall": "ไฟร์วอลล์",
  "FortiNAC User": "ผู้ใช้ FortiNAC",
  "No activity recorded yet.": "ยังไม่มีการบันทึกกิจกรรม",
  "No results found.": "ไม่พบผลลัพธ์",
  "Not supported yet — this app builds Local Users only": "ยังไม่รองรับ — แอปนี้สร้างได้เฉพาะผู้ใช้ในเครื่อง",
  "On Account Creation": "เมื่อสร้างบัญชี",
  "registered accounts": "บัญชีที่ลงทะเบียนไว้",
  "Regular": "แบบปกติ",
  "Remote LDAP User": "ผู้ใช้ LDAP ระยะไกล",
  "Remote RADIUS User": "ผู้ใช้ RADIUS ระยะไกล",
  "Remote TACACS+ User": "ผู้ใช้ TACACS+ ระยะไกล",
  "Required": "จำเป็น",
  "Test failed": "การทดสอบล้มเหลว",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "All Groups": "ทุกกลุ่ม",
  "Auth Method": "วิธียืนยันตัวตน",
  "Connection": "การเชื่อมต่อ",
  "Device access": "สิทธิ์เข้าถึงอุปกรณ์",
  "Group Name": "ชื่อกลุ่ม",
  "Group Type": "ประเภทกลุ่ม",
  "Groups": "กลุ่ม",
  "Primary Server": "เซิร์ฟเวอร์หลัก",
  "Secondary Server": "เซิร์ฟเวอร์สำรอง",
  "Ref.": "อ้างอิง",
  "Clearing this field will not remove the server — the FortiGate's REST API cannot unset a secondary RADIUS host. Change it to a different address here, or remove it from the CLI with `config user radius / edit <name> / unset secondary-server`.": "การล้างช่องนี้จะไม่ลบเซิร์ฟเวอร์ออก — REST API ของ FortiGate ยกเลิกโฮสต์ RADIUS สำรองไม่ได้ ให้เปลี่ยนเป็นแอดเดรสอื่นที่นี่ หรือลบผ่าน CLI ด้วย `config user radius / edit <name> / unset secondary-server`",
  "FortiOS 7.2.10 has no LDAP test endpoint — monitor/user/ldap/query, /test-connect and /test-user-credentials all return 404 on this device.": "FortiOS 7.2.10 ไม่มีปลายทางสำหรับทดสอบ LDAP — monitor/user/ldap/query, /test-connect และ /test-user-credentials คืนค่า 404 ทั้งหมดบนอุปกรณ์นี้",
  "Save the RADIUS server first — the FortiGate tests a stored server by name.": "บันทึกเซิร์ฟเวอร์ RADIUS ก่อน — FortiGate ทดสอบเซิร์ฟเวอร์ที่บันทึกไว้โดยอ้างจากชื่อ",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "IP/Name": "IP / ชื่อ",
  "Server IP/Name is required": "ต้องระบุ IP หรือชื่อเซิร์ฟเวอร์",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Admin": "ผู้ดูแลระบบ",
  "Login": "การเข้าสู่ระบบ",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Add to a user group": "เพิ่มเข้ากลุ่มผู้ใช้",
  "Ask for a company": "ถามชื่อบริษัท",
  "Ask for a mobile number": "ถามเบอร์มือถือ",
  "Ask for a name": "ถามชื่อ",
  "Ask for a password": "ถามรหัสผ่าน",
  "Ask for a sponsor": "ถามผู้รับรอง",
  "Ask for an email address": "ถามอีเมล",
  "Batch guest account creation": "สร้างบัญชีผู้มาเยือนครั้งละหลายบัญชี",
  "Limit the number of accounts": "จำกัดจำนวนบัญชี",
  "Secure connection": "การเชื่อมต่อแบบเข้ารหัส",
  "Send the code by SMS": "ส่งรหัสทาง SMS",
  "Two-factor authentication": "การยืนยันตัวตนสองปัจจัย",
  "Use a certificate": "ใช้ใบรับรอง",
  "Use an Exchange server": "ใช้เซิร์ฟเวอร์ Exchange",

  "AAA servers this firewall can hand authentication off to.":
    "เซิร์ฟเวอร์ AAA ที่ไฟร์วอลล์นี้ส่งต่อการยืนยันตัวตนไปให้ได้",
  "Directory servers this firewall can check for authentication.":
    "เซิร์ฟเวอร์ไดเรกทอรีที่ไฟร์วอลล์นี้ใช้ตรวจสอบการยืนยันตัวตนได้",
  "FIREWALL AUTOMATION": "ระบบอัตโนมัติสำหรับไฟร์วอลล์",
  "Local and remote accounts that can authenticate through this firewall.":
    "บัญชีในเครื่องและบัญชีจากภายนอกที่ยืนยันตัวตนผ่านไฟร์วอลล์นี้ได้",
  "Named groups of users, referenced from firewall policy and authentication rules.":
    "กลุ่มผู้ใช้ที่ตั้งชื่อไว้ อ้างถึงได้จากนโยบายไฟร์วอลล์และกฎการยืนยันตัวตน",
};
