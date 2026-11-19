/**
 * Thai — Profile ▸ Device Credentials, the account activity analytics, and the OTP trigger settings.
 *
 * The Device Credentials copy exists to explain one non-obvious rule: a firewall in this console
 * has no login of its own, so each person links their own FortiGate administrator account and the
 * device records THEIR name against every change. That is the thread the Thai has to keep — บัญชี
 * ของคุณเอง throughout, never a vague "บัญชี".
 */
import type { Dict } from "../merge";

export const account: Dict = {
  // -- Device credentials ----------------------------------------------------
  "Device Credentials": "ข้อมูลรับรองอุปกรณ์",
  "Link an account": "ผูกบัญชี",
  "No firewall account linked yet": "ยังไม่ได้ผูกบัญชีไฟร์วอลล์",
  "No devices left to link": "ไม่เหลืออุปกรณ์ให้ผูกแล้ว",
  "Username on the firewall": "ชื่อผู้ใช้บนไฟร์วอลล์",
  "Your own FortiGate administrator account — not the email you sign in to this console with.":
    "บัญชีผู้ดูแลระบบ FortiGate ของคุณเอง — ไม่ใช่อีเมลที่คุณใช้เข้าสู่ระบบคอนโซลนี้",
  "Who the firewall will record": "ไฟร์วอลล์จะบันทึกชื่อใคร",
  "Currently held by": "ปัจจุบันถือครองโดย",
  "Credential updated": "อัปเดตข้อมูลรับรองแล้ว",
  "Credential removed": "ลบข้อมูลรับรองแล้ว",
  "Could not load your credentials": "โหลดข้อมูลรับรองของคุณไม่สำเร็จ",
  "Linked — the firewall will record your name from now on":
    "ผูกแล้ว — จากนี้ไปไฟร์วอลล์จะบันทึกชื่อของคุณ",
  "Sign in to the firewall to check this account":
    "เข้าสู่ระบบไฟร์วอลล์เพื่อตรวจสอบบัญชีนี้",
  "Signed in successfully.": "เข้าสู่ระบบสำเร็จ",
  "Signed out of account.": "ออกจากระบบบัญชีแล้ว",
  "Sign-in failed": "เข้าสู่ระบบไม่สำเร็จ",
  "You have no account on": "คุณไม่มีบัญชีบน",
  "you can reach — link one to open": "ที่คุณเข้าถึงได้ — ผูกสักบัญชีเพื่อเปิดใช้งาน",
  "· last checked": "· ตรวจสอบล่าสุด",
  "· locked to this credential": "· ล็อกไว้กับข้อมูลรับรองนี้",
  "Last used": "ใช้ล่าสุด",
  Verified: "ยืนยันแล้ว",
  "Not verified": "ยังไม่ได้ยืนยัน",
  Check: "ตรวจสอบ",
  Remove: "ลบ",
  Add: "เพิ่ม",
  Preview: "ดูตัวอย่าง",
  "e.g. tawunchai": "เช่น tawunchai",
  "A device carries no login of its own — you reach a firewall with your own account on it. Link one and its pages open, with the device recording your name against every change.":
    "อุปกรณ์ไม่มีล็อกอินของตัวเอง — คุณเข้าถึงไฟร์วอลล์ด้วยบัญชีของคุณเองบนเครื่องนั้น เมื่อผูกบัญชีแล้วหน้าต่าง ๆ ของอุปกรณ์จะเปิดได้ และอุปกรณ์จะบันทึกชื่อของคุณไว้กับทุกการเปลี่ยนแปลง",
  "Applies to policy and object changes, security profiles, VPN, reports, the SSH diagnostics and the Config Deploy shell — a device has no login of its own, so this is how its pages open at all.":
    "มีผลกับการเปลี่ยนแปลงนโยบายและอ็อบเจกต์ โปรไฟล์ความปลอดภัย VPN รายงาน การวินิจฉัยผ่าน SSH และเชลล์ปรับใช้คอนฟิก — อุปกรณ์ไม่มีล็อกอินของตัวเอง นี่จึงเป็นวิธีเดียวที่หน้าต่าง ๆ ของอุปกรณ์จะเปิดได้",
  "Every change you make here": "ทุกการเปลี่ยนแปลงที่คุณทำที่นี่",
  "recorded in its event log": "ถูกบันทึกไว้ในบันทึกเหตุการณ์ของอุปกรณ์",
  "Encrypted with AES-256-GCM before it is stored, and never sent back to the browser.":
    "เข้ารหัสด้วย AES-256-GCM ก่อนจัดเก็บ และจะไม่ถูกส่งกลับมายังเบราว์เซอร์เลย",
  "Saving signs in to the firewall once to check the account. A password the device rejects is not stored — it would be retried on every page you open, and FortiOS locks an administrator account after three failed attempts.":
    "การบันทึกจะเข้าสู่ระบบไฟร์วอลล์หนึ่งครั้งเพื่อตรวจสอบบัญชี รหัสผ่านที่อุปกรณ์ปฏิเสธจะไม่ถูกจัดเก็บ — เพราะระบบจะลองใหม่ทุกครั้งที่คุณเปิดหน้าใด ๆ และ FortiOS จะล็อกบัญชีผู้ดูแลระบบหลังจากพยายามล้มเหลวสามครั้ง",
  "Use this account for scheduled work on this device":
    "ใช้บัญชีนี้สำหรับงานตามกำหนดการบนอุปกรณ์นี้",
  "runs scheduled work": "ทำงานตามกำหนดการ",
  "— ticking this takes it over.": "— การติ๊กช่องนี้จะเป็นการรับหน้าที่นั้นมาแทน",
  "Scheduled backups, compliance checks and Notify alerts on this device run as this account":
    "การสำรองข้อมูลตามกำหนดการ การตรวจสอบมาตรฐาน และการแจ้งเตือนบนอุปกรณ์นี้จะทำงานในนามบัญชีนี้",
  "Automatic backups, compliance checks and Notify alerts have nobody signed in behind them, so they run as one nominated account. Without one, this device's schedules cannot run at all.":
    "การสำรองข้อมูลอัตโนมัติ การตรวจสอบมาตรฐาน และการแจ้งเตือนไม่มีใครล็อกอินอยู่เบื้องหลัง จึงต้องทำงานในนามบัญชีที่ระบุไว้หนึ่งบัญชี หากไม่มีบัญชีดังกล่าว งานตามกำหนดการของอุปกรณ์นี้จะทำงานไม่ได้เลย",

  // -- Profile photo and details --------------------------------------------
  "Profile photo updated!": "อัปเดตรูปโปรไฟล์แล้ว!",
  "Failed to save profile photo.": "บันทึกรูปโปรไฟล์ไม่สำเร็จ",
  "Please select an image file.": "โปรดเลือกไฟล์รูปภาพ",
  "Upload failed. Please try again.": "อัปโหลดไม่สำเร็จ โปรดลองอีกครั้ง",
  "JPG, PNG or WEBP · max": "JPG, PNG หรือ WEBP · ไม่เกิน",
  "Please enter first name": "โปรดกรอกชื่อ",
  "Please enter last name": "โปรดกรอกนามสกุล",
  "Update failed": "อัปเดตไม่สำเร็จ",
  "User ID not found": "ไม่พบรหัสผู้ใช้",
  "Password Changed": "เปลี่ยนรหัสผ่านแล้ว",
  "Password changed successfully": "เปลี่ยนรหัสผ่านสำเร็จ",
  "Password updated.": "อัปเดตรหัสผ่านแล้ว",

  // -- OTP triggers ----------------------------------------------------------
  "OTP Trigger Settings": "การตั้งค่าเงื่อนไขการใช้ OTP",
  "Select which flows require OTP verification":
    "เลือกว่าขั้นตอนใดบ้างที่ต้องยืนยันด้วย OTP",
  "Login OTP": "OTP ตอนเข้าสู่ระบบ",
  "Reset Password OTP": "OTP ตอนตั้งรหัสผ่านใหม่",
  "OTP sent to your email": "ส่ง OTP ไปยังอีเมลของคุณแล้ว",
  "TOTP QR Code": "คิวอาร์โค้ด TOTP",
  "Turn off": "ปิด",
  "Turn off Two-Step Verification?": "ปิดการยืนยันตัวตนสองขั้นตอนหรือไม่?",
  "Maximum Security": "ความปลอดภัยสูงสุด",
  "Strong Access": "การเข้าถึงที่แข็งแรง",
  "SENDER EMAIL": "อีเมลผู้ส่ง",
  "APP PASSWORD": "รหัสผ่านแอป",

  // -- Activity analytics ----------------------------------------------------
  "My Activities": "กิจกรรมของฉัน",
  "My events — last": "เหตุการณ์ของฉัน — ล่าสุด",
  "System Activity": "กิจกรรมของระบบ",
  "Activity Timeline": "ไทม์ไลน์กิจกรรม",
  "Action Breakdown": "การแยกตามการกระทำ",
  "All Users · Activity Feed": "ผู้ใช้ทั้งหมด · ฟีดกิจกรรม",
  "Role Distribution": "การกระจายตามบทบาท",
  "Breakdown by account role": "แยกตามบทบาทของบัญชี",
  "Total Users": "ผู้ใช้ทั้งหมด",
  Admins: "ผู้ดูแลระบบ",
  "Regular Users": "ผู้ใช้ทั่วไป",
  "Logged In": "เข้าสู่ระบบ",
  "Logged Out": "ออกจากระบบ",
  "Login / Logout — all time": "เข้าสู่ระบบ / ออกจากระบบ — ตลอดเวลา",
  Rejected: "ถูกปฏิเสธ",
  "Peak day": "วันที่สูงสุด",
  "Period total": "รวมทั้งช่วง",
  "No activity recorded": "ไม่มีการบันทึกกิจกรรม",
  "No events recorded": "ไม่มีการบันทึกเหตุการณ์",
  "No data": "ไม่มีข้อมูล",
  "Search user, action...": "ค้นหาผู้ใช้ การกระทำ...",
  "Select all": "เลือกทั้งหมด",
  "The end time must be after the start time": "เวลาสิ้นสุดต้องอยู่หลังเวลาเริ่มต้น",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "Add a recipient first": "เพิ่มผู้รับก่อน",
  "Attach a recipient first": "แนบผู้รับก่อน",
  "all clear": "ปกติทั้งหมด",
  "all delivered": "ส่งครบทุกรายการแล้ว",
  "needs attention": "ต้องดูแล",
  "Channel added": "เพิ่มช่องทางแล้ว",
  "Channel updated": "อัปเดตช่องทางแล้ว",
  "New email channel": "ช่องทางอีเมลใหม่",
  "New LINE channel": "ช่องทาง LINE ใหม่",
  "Checking with the firewall…": "กำลังตรวจสอบกับไฟร์วอลล์…",
  "Check now": "ตรวจเดี๋ยวนี้",
  "Could not change the channel": "เปลี่ยนช่องทางไม่สำเร็จ",
  "Could not change the recipient": "เปลี่ยนผู้รับไม่สำเร็จ",
  "Could not change the rule": "เปลี่ยนกฎไม่สำเร็จ",
  "Could not clear the history": "ล้างประวัติไม่สำเร็จ",
  "Could not delete the rule": "ลบกฎไม่สำเร็จ",
  "Could not remove the channel": "ลบช่องทางไม่สำเร็จ",
  "Could not remove the recipient": "ลบผู้รับไม่สำเร็จ",
  "Could not save the channel": "บันทึกช่องทางไม่สำเร็จ",
  "Could not save the recipient": "บันทึกผู้รับไม่สำเร็จ",
  "Could not save the rule": "บันทึกกฎไม่สำเร็จ",
  "Create rule": "สร้างกฎ",
  "Save rule": "บันทึกกฎ",
  "Save changes": "บันทึกการเปลี่ยนแปลง",
  "Disable": "ปิดใช้งาน",
  "Enable": "เปิดใช้งาน",
  "On": "เปิด",
  "ON": "เปิดอยู่",
  "PAUSED": "หยุดชั่วคราว",
  "Edit firewall account": "แก้ไขบัญชีไฟร์วอลล์",
  "Link account": "ผูกบัญชี",
  "Link your account to a device": "ผูกบัญชีของคุณกับอุปกรณ์",
  "Link your firewall account": "ผูกบัญชีไฟร์วอลล์ของคุณ",
  "Every device already has your account linked": "ทุกอุปกรณ์ผูกบัญชีของคุณไว้แล้ว",
  "You will not be able to open this device's pages until you link an account for it again.": "คุณจะเปิดหน้าต่าง ๆ ของอุปกรณ์นี้ไม่ได้จนกว่าจะผูกบัญชีให้อีกครั้ง",
  "Email alerts": "การแจ้งเตือนทางอีเมล",
  "LINE alerts": "การแจ้งเตือนทาง LINE",
  "email not configured": "ยังไม่ได้ตั้งค่าอีเมล",
  "every check": "ทุกการตรวจ",
  "every device": "ทุกอุปกรณ์",
  "one device": "อุปกรณ์เดียว",
  "this device": "อุปกรณ์นี้",
  "the firewall": "ไฟร์วอลล์",
  "its pages": "หน้าต่าง ๆ ของอุปกรณ์นั้น",
  "their pages": "หน้าต่าง ๆ ของอุปกรณ์เหล่านั้น",
  "Hide password": "ซ่อนรหัสผ่าน",
  "Show password": "แสดงรหัสผ่าน",
  "Leave blank to keep the current password": "เว้นว่างไว้เพื่อใช้รหัสผ่านเดิม",
  "Leave blank to keep the stored token": "เว้นว่างไว้เพื่อใช้โทเคนที่บันทึกไว้",
  "LINE destination id": "รหัสปลายทางของ LINE",
  "Long-lived Messaging API token": "โทเคน Messaging API แบบอายุยาว",
  "Network team": "ทีมเครือข่าย",
  "NOC group": "กลุ่ม NOC",
  "· says when it recovers": "· แจ้งเมื่อกลับมาปกติ",
  "· silent on recovery": "· ไม่แจ้งเมื่อกลับมาปกติ",
  "Send a real test message": "ส่งข้อความทดสอบจริง",
  "Send this rule's own message as a test": "ส่งข้อความของกฎนี้เป็นการทดสอบ",
  "The test could not be sent": "ส่งการทดสอบไม่สำเร็จ",
  "The test message could not be sent": "ส่งข้อความทดสอบไม่สำเร็จ",
  "The check could not be run": "รันการตรวจไม่สำเร็จ",
  "Subjects": "หัวข้อ",
  "Turn on Two-Step Verification above before choosing which flows need an OTP": "เปิดการยืนยันสองขั้นตอนด้านบนก่อน แล้วจึงเลือกว่าขั้นตอนใดต้องใช้ OTP",
  "Turn on Two-Step Verification above first": "เปิดการยืนยันสองขั้นตอนด้านบนก่อน",
  "Unknown User": "ผู้ใช้ที่ไม่รู้จัก",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "This is also the account this device's scheduled backups, compliance checks and alerts run as. Removing it leaves them with no way in until somebody nominates another.": "บัญชีนี้ยังเป็นบัญชีที่ใช้รันการสำรองข้อมูลตามกำหนดเวลา การตรวจสอบมาตรฐาน และการแจ้งเตือนของอุปกรณ์นี้ด้วย หากลบออก งานเหล่านั้นจะไม่มีทางเข้าถึงอุปกรณ์จนกว่าจะมีคนกำหนดบัญชีใหม่",

  // -- Runtime sweep: strings the extractor could not see statically ---------
  "enabled of total": "ที่เปิดใช้จากทั้งหมด",
  "Require OTP on every login": "ต้องใช้ OTP ทุกครั้งที่เข้าสู่ระบบ",
  "Require OTP when resetting password": "ต้องใช้ OTP เมื่อรีเซ็ตรหัสผ่าน",

  // -- Notify rule catalogue — served by backend/services/notify.go, so the extractor never sees it ---
  "Port Up / Down": "พอร์ตขึ้น / ลง",
  "A physical or logical interface loses link, or gets it back. Read from the device's own runtime interface state, not from the administrative up/down setting.": "อินเทอร์เฟซกายภาพหรือเชิงตรรกะเสียลิงก์ หรือกลับมาเชื่อมต่อได้ อ่านจากสถานะอินเทอร์เฟซขณะทำงานจริงของอุปกรณ์ ไม่ใช่จากการตั้งค่าเปิด/ปิดของผู้ดูแล",
  "Ports (blank = every port the device reports a link for)": "พอร์ต (เว้นว่าง = ทุกพอร์ตที่อุปกรณ์รายงานว่ามีลิงก์)",
  "Device Unreachable": "ติดต่ออุปกรณ์ไม่ได้",
  "The firewall stops answering its REST API — powered off, off the network, or refusing the credential the platform holds for it.": "ไฟร์วอลล์หยุดตอบ REST API — ปิดเครื่อง หลุดจากเครือข่าย หรือปฏิเสธข้อมูลรับรองที่ระบบเก็บไว้สำหรับเครื่องนั้น",
  "Licence Expiring": "ไลเซนส์ใกล้หมดอายุ",
  "A FortiGuard entitlement (AntiVirus, Web Filtering, IPS …) is within the given number of days of running out.": "สิทธิ์การใช้งาน FortiGuard (AntiVirus, Web Filtering, IPS …) เหลือเวลาไม่ถึงจำนวนวันที่กำหนดก่อนหมดอายุ",
  "days left": "วันที่เหลือ",
  "Entitlements (blank = all of them)": "สิทธิ์การใช้งาน (เว้นว่าง = ทั้งหมด)",
  "CPU Peak": "CPU พุ่งสูง",
  "System-wide CPU at or above the threshold. Pair it with a sustain count so a one-second spike during a backup does not page anyone.": "CPU รวมทั้งระบบถึงหรือเกินเกณฑ์ ใช้ร่วมกับจำนวนครั้งที่ต้องคงอยู่ เพื่อไม่ให้การพุ่งขึ้นวินาทีเดียวระหว่างสำรองข้อมูลไปปลุกใคร",
  "Memory Peak": "หน่วยความจำพุ่งสูง",
  "Memory use at or above the threshold. FortiOS enters conserve mode in the high 80s, so a rule below that is an early warning rather than an incident.": "การใช้หน่วยความจำถึงหรือเกินเกณฑ์ FortiOS จะเข้าสู่โหมดประหยัดเมื่อเกิน 80 กว่า ๆ ดังนั้นกฎที่ตั้งต่ำกว่านั้นถือเป็นการเตือนล่วงหน้า ไม่ใช่เหตุการณ์ผิดปกติ",
  "Session Spike": "เซสชันพุ่งสูง",
  "Concurrent sessions at or above the threshold — the shape a scan, a worm or a runaway client makes.": "เซสชันที่ทำงานพร้อมกันถึงหรือเกินเกณฑ์ — รูปแบบที่เกิดจากการสแกน เวิร์ม หรือไคลเอ็นต์ที่ทำงานผิดปกติ",
  "Disk Usage": "การใช้พื้นที่ดิสก์",
  "Log disk at or above the threshold. A full log disk stops the device recording anything, which is discovered far too late by definition.": "ดิสก์เก็บบันทึกถึงหรือเกินเกณฑ์ ดิสก์ที่เต็มจะทำให้อุปกรณ์หยุดบันทึกทุกอย่าง ซึ่งโดยธรรมชาติแล้วจะรู้ตัวก็สายเกินไป",

  // -- Label helpers and validation messages, reached by the return-statement rule in the extractor ---
  "Off — every flow that uses an emailed OTP is disabled": "ปิด — ทุกขั้นตอนที่ใช้ OTP ทางอีเมลถูกปิดใช้งาน",
  "On — but no flow has been set to use an OTP yet": "เปิด — แต่ยังไม่ได้ตั้งให้ขั้นตอนใดใช้ OTP",
  "every recipient is disabled — this alert would reach nobody": "ผู้รับทุกรายถูกปิดใช้งาน — การแจ้งเตือนนี้จะไม่ถึงใครเลย",
  "no recipient — this alert would reach nobody": "ไม่มีผู้รับ — การแจ้งเตือนนี้จะไม่ถึงใครเลย",
  "no recipients": "ไม่มีผู้รับ",
  "the LINE channel has no access token": "ช่องทาง LINE ยังไม่มี access token",
  "fires on the first check": "แจ้งเตือนตั้งแต่การตรวจครั้งแรก",
  "repeats every check": "แจ้งซ้ำทุกครั้งที่ตรวจ",
  "Password reset by email is turned off. Ask an administrator to set a new password for you.":
    "การรีเซ็ตรหัสผ่านทางอีเมลถูกปิดอยู่ ให้ผู้ดูแลระบบตั้งรหัสผ่านใหม่ให้",

  // -- Phase 7: the stored history, and labels the extractor had not yet seen ----
  "Authenticator app (TOTP)": "แอปยืนยันตัวตน (TOTP)",
  "Maintenance mode": "โหมดบำรุงรักษา",
  "Two-step verification for every account": "การยืนยันสองขั้นตอนสำหรับทุกบัญชี",

  // Profile page, its Device Credentials card, and the Notify channel editor reached from it.
  "Channel not found — go back to the list.": "ไม่พบช่องทางนี้ — กลับไปที่รายการ",
  "Loading channel…": "กำลังโหลดช่องทาง…",
  "Removing…": "กำลังนำออก…",
  "SIEM Export": "ส่งออกไปยัง SIEM",
  "This device's backups, checks and alerts run as this account — they'll stop until you link another.":
    "งานสำรองข้อมูล การตรวจสอบ และการแจ้งเตือนของอุปกรณ์นี้ทำงานด้วยบัญชีนี้ — จะหยุดทำงานจนกว่าจะผูกบัญชีใหม่",
  "This event will be permanently removed from your calendar.": "กิจกรรมนี้จะถูกลบออกจากปฏิทินของคุณอย่างถาวร",
  "You'll lose access to this device's pages until you link an account again.":
    "คุณจะเข้าหน้าต่าง ๆ ของอุปกรณ์นี้ไม่ได้จนกว่าจะผูกบัญชีอีกครั้ง",
};
