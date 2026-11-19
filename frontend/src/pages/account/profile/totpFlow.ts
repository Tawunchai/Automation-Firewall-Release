export type TotpStep = "idle" | "scanning" | "disabling" | "enabling" | "removing";

// TOTP dialog — จะเปิดมาที่หน้าไหน
//
// ของเดิมเปิดมาที่ "idle" เสมอ ผู้ใช้ที่ยังไม่เคยตั้ง TOTP จึงเจอหน้า "Not Set Up" +
// ปุ่ม "Set Up Authenticator App" แล้วต้องกดอีกหนึ่งครั้ง ทั้งที่เขากดปุ่ม "Set Up TOTP"
// มาแล้ว — เป็นการถามคำถามเดิมซ้ำสองรอบ
//
// ตอนนี้: ยังไม่เคยตั้ง → เข้า "scanning" (ดึง QR) ทันที · ตั้งไว้แล้ว → "idle"
// เพราะหน้านั้นคือเมนู enable/disable/remove ซึ่งเป็นทางเลือกจริง ไม่ใช่ปุ่มผ่านทาง

/**
 * หน้าที่ dialog ต้องเปิดมาเจอ
 *
 * `globalEnabled` = สวิตช์ TOTP ระดับระบบที่ /admin/service — ถ้าปิดอยู่ ห้ามยิง
 * setup-init เพราะเซิร์ฟเวอร์จะสร้าง record ที่ใช้ไม่ได้ทิ้งไว้ ให้ค้างที่ "idle"
 * ซึ่งเป็นหน้าเดียวที่อธิบายได้ว่าทำไมถึงตั้งไม่ได้
 */
export function initialTotpStep(verified: boolean, globalEnabled: boolean): TotpStep {
  if (!globalEnabled) return "idle";
  return verified ? "idle" : "scanning";
}

/** ต้องยิง InitTOTPSetup ตอนเปิด dialog ไหม */
export function shouldFetchQrOnOpen(verified: boolean, globalEnabled: boolean): boolean {
  return initialTotpStep(verified, globalEnabled) === "scanning";
}

/**
 * กด Cancel ในหน้า scanning แล้วไปไหน
 *
 * ผู้ใช้ที่ยังไม่เคยตั้ง TOTP ไม่มี "หน้าก่อนหน้า" ให้กลับไปแล้ว — ถ้าส่งกลับไป "idle"
 * เขาจะไปโผล่หน้า "Not Set Up" + ปุ่ม Set Up ซึ่งคือหน้าที่เพิ่งถูกตัดออกจากทางเดิน
 * (กดปุ่มนั้นก็วนกลับมาที่เดิม) ดังนั้นให้ปิด dialog ไปเลย
 * ส่วนคนที่ตั้งไว้แล้วและเข้ามาตั้งใหม่ ยังมีเมนูของตัวเองให้กลับไป
 */
export function cancelTarget(verified: boolean): "close" | "idle" {
  return verified ? "idle" : "close";
}

// ── ป้ายสถานะ TOTP บนหัวหน้า My Profile ──────────────────────────────────────

export type TotpBadge =
  | "active"      // ตั้งค่าแล้วและเปิดใช้อยู่ → เครื่องหมายถูกสีเขียว
  | "paused"      // ตั้งค่าไว้แล้วแต่ผู้ใช้กดปิดเอง (secret ยังอยู่)
  | "setup"       // ยังไม่เคยตั้ง
  | "unavailable"; // ระบบปิด TOTP ไว้ที่ /admin/service

/**
 * สถานะที่ปุ่มบนหัวโปรไฟล์ต้องแสดง
 *
 * "paused" ต้องขึ้นเฉพาะตอนผู้ใช้ **ตั้งใจปิดเอง** เท่านั้น ห้ามเป็นผลข้างเคียงของสถานะ
 * ที่ฝั่ง client ถืออยู่ไม่ตรงกับความจริง — ของเดิม `handleTotpVerify` ตั้งแค่ verified
 * แล้วลืมตั้ง isEnabled (ทั้งที่ server ตั้งให้ทั้งคู่) ปุ่มจึงขึ้น "TOTP Disabled"
 * ทันทีที่สแกน QR เสร็จ ผู้ใช้กด "Enable" ตามที่เห็น แล้วมันไปสลับค่าจริงเป็นปิด
 *
 * ลำดับ: ระบบปิด > ยังไม่ตั้ง > ตั้งแล้วแต่ปิดอยู่ > ใช้งานอยู่
 * (ระบบปิดมาก่อน เพราะต่อให้ผู้ใช้ตั้งไว้ครบ TOTP ก็ไม่ถูกใช้ตอน login อยู่ดี)
 */
export function totpBadge(verified: boolean, isEnabled: boolean, globalEnabled: boolean): TotpBadge {
  if (!globalEnabled) return "unavailable";
  if (!verified) return "setup";
  return isEnabled ? "active" : "paused";
}

/** TOTP ตัวนี้จะถูกใช้ตอน login จริงไหม — ตรงกับเงื่อนไขฝั่ง Go เป๊ะ ๆ */
export function totpChallengesLogin(verified: boolean, isEnabled: boolean, globalEnabled: boolean): boolean {
  // auth.Login: totp_global_enabled == "true" AND is_verified = true AND is_enabled = true
  return globalEnabled && verified && isEnabled;
}
