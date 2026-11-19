// OTP dialog — ตรรกะล้วน ๆ ของช่องกรอกโค้ด, นาฬิกาหมดอายุ และคูลดาวน์ปุ่มส่งใหม่
//
// แยกออกจาก component เพราะสามอย่างนี้ผูกกับ **ข้อจำกัดจริงของ backend** ไม่ใช่เรื่องความสวยงาม
// ถ้าตัวเลขตรงนี้เพี้ยนจากฝั่ง server ผู้ใช้จะเจอ error ที่ไม่มีคำอธิบาย:
//
//   · services.OTPExpiration = 5 นาที        → โค้ดหมดอายุเงียบ ๆ กรอกไปก็ได้ "OTP expired"
//   · services.OTPMaxAttempts = 5 ครั้ง       → กรอกผิดครบแล้วต้องขอโค้ดใหม่เท่านั้น
//   · middleware.OTPLimiter = 5 ครั้ง/10 นาที/IP → กด Resend รัว ๆ แล้วโดน 429 ปิดทางส่งใหม่
//     ไปอีก 10 นาที ทั้งที่ยังรีเซ็ตรหัสไม่เสร็จ — คูลดาวน์ที่ปุ่มคือสิ่งที่กันเรื่องนี้

export const OTP_LENGTH = 6;

/** ตรงกับ services.OTPExpiration (5 นาที) */
export const OTP_TTL_SECONDS = 5 * 60;

/**
 * คูลดาวน์ปุ่ม Resend
 *
 * งบจริงคือ 5 ครั้งต่อ 10 นาทีต่อ IP — 60 วินาทีต่อครั้งทำให้ใช้ได้ 5 ครั้งพอดีใน 5 นาที
 * ซึ่งยาวกว่าอายุโค้ดหนึ่งใบ คนที่ใช้งานปกติจึงไม่มีทางชนเพดาน
 */
export const RESEND_COOLDOWN_SECONDS = 60;

/** ตรงกับ services.OTPMaxAttempts */
export const OTP_MAX_ATTEMPTS = 5;

// ── การกรอกรหัส ───────────────────────────────────────────────────────────────
//
// ช่องกรอกเป็น **บล็อกแยกหนึ่งช่องต่อหนึ่งหลัก** ทุกฟังก์ชันในหมวดนี้จึงทำงานกับ array
// ของหลัก ไม่ใช่สตริงเดียว — และทุกตัวคืน `focus` มาด้วย เพราะการเลื่อนโฟกัสคือครึ่งหนึ่ง
// ของประสบการณ์การกรอก OTP ถ้าปล่อยให้ component คำนวณเอง มันจะเลื่อนผิดในเคสขอบ
// (ลบตอนช่องว่าง, วางกลางช่อง) ซึ่งเป็นเคสที่คนเจอบ่อยที่สุด

export type OtpDigits = string[];

export const emptyOtp = (): OtpDigits => Array(OTP_LENGTH).fill("");

/** ดึงเฉพาะตัวเลขออกจากข้อความ (ใช้ตอนวางจากคลิปบอร์ด) */
export function digitsOnly(text: string, max = OTP_LENGTH): string {
  return text.replace(/\D/g, "").slice(0, max);
}

export type InputResult = { next: OtpDigits; focus: number };

/**
 * พิมพ์ตัวเลขลงช่องหนึ่ง
 *
 * รับ "ตัวสุดท้าย" ของสิ่งที่พิมพ์ ไม่ใช่ตัวแรก — ช่องที่มีเลขอยู่แล้วแล้วผู้ใช้พิมพ์ทับ
 * ควรได้ตัวใหม่ ไม่ใช่ตัวเดิมค้างไว้
 */
export function typeDigit(otp: OtpDigits, index: number, raw: string): InputResult {
  const digit = raw.replace(/\D/g, "").slice(-1);
  const next = [...otp];
  next[index] = digit;
  return { next, focus: digit && index < OTP_LENGTH - 1 ? index + 1 : index };
}

/**
 * Backspace
 *
 * ช่องปัจจุบันมีเลข → ลบเลขนั้น อยู่ที่เดิม
 * ช่องว่างอยู่แล้ว → ถอยไปช่องก่อนหน้าแล้วลบของช่องนั้น
 * (ถ้าลบทั้งสองอย่างพร้อมกัน กด backspace หนึ่งครั้งจะหายไปสองตัว)
 */
export function pressBackspace(otp: OtpDigits, index: number): InputResult {
  const next = [...otp];
  if (next[index]) {
    next[index] = "";
    return { next, focus: index };
  }
  if (index > 0) {
    next[index - 1] = "";
    return { next, focus: index - 1 };
  }
  return { next, focus: 0 };
}

/**
 * วางโค้ดจากคลิปบอร์ด
 *
 * วางลงช่องไหนก็ได้ ให้เริ่มเติมจากช่องนั้น — คนมัก copy โค้ดจากอีเมลแล้ววางทั้งก้อน
 * แล้วโฟกัสไปที่ช่องถัดจากตัวสุดท้ายที่วางได้ (หรือช่องสุดท้ายถ้าเต็ม)
 */
export function pasteCode(otp: OtpDigits, index: number, text: string): InputResult {
  const digits = digitsOnly(text, OTP_LENGTH - index);
  if (!digits) return { next: otp, focus: index };
  const next = [...otp];
  digits.split("").forEach((d, i) => { next[index + i] = d; });
  return { next, focus: Math.min(index + digits.length, OTP_LENGTH - 1) };
}

/** โค้ดครบ 6 หลักหรือยัง */
export function isComplete(otp: OtpDigits): boolean {
  return otp.length === OTP_LENGTH && otp.every((d) => d !== "");
}

/**
 * ครบ 6 หลักแล้วส่งเองเลยหรือยัง (ไม่ต้องให้ผู้ใช้เอื้อมไปกดปุ่ม)
 *
 * `lastSubmitted` คือโค้ดชุดที่เพิ่งส่งไป — ตัวนี้คือสิ่งที่กัน **ลูปยิงซ้ำ** ซึ่งอันตราย
 * เป็นพิเศษกับ OTP: กรอกผิดหนึ่งครั้งแล้วยิงวนอีก 4 รอบ = ใช้ OTPMaxAttempts (5) หมดในพริบตา
 * แล้วผู้ใช้ต้องขอโค้ดใหม่ทั้งที่แค่พิมพ์ผิดหนึ่งตัว
 *
 * เคลียร์ `lastSubmitted` เมื่อผู้ใช้แก้ตัวเลขเท่านั้น — ห้ามเคลียร์ตอนคำขอจบ
 * เพราะตัวเลขยังเหมือนเดิม เงื่อนไขจะกลับมาจริงทันทีแล้ววนไม่จบ
 */
export function shouldAutoSubmit(
  otp: OtpDigits,
  lastSubmitted: string,
  opts: { submitting: boolean; expired: boolean },
): boolean {
  if (opts.submitting || opts.expired) return false;
  if (!isComplete(otp)) return false;
  return otp.join("") !== lastSubmitted;
}

// ── นาฬิกา ────────────────────────────────────────────────────────────────────

/** "4:32" — วินาทีเป็นเลขสองหลักเสมอ และไม่ติดลบ */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export type ExpiryState = "fresh" | "warning" | "expired";

/**
 * สถานะอายุโค้ด — เตือนเมื่อเหลือไม่ถึง 1 นาที
 *
 * ของเดิมไม่บอกอะไรเลยเรื่องอายุโค้ด ผู้ใช้ที่เปิดอีเมลช้าจะกรอกโค้ดที่หมดอายุแล้ว
 * แล้วได้ error "OTP expired" ซึ่งอ่านแล้วเหมือนกรอกผิด ทั้งที่ต้องกดขอใหม่
 */
export function expiryState(secondsLeft: number): ExpiryState {
  if (secondsLeft <= 0) return "expired";
  if (secondsLeft <= 60) return "warning";
  return "fresh";
}

/** กด Resend ได้หรือยัง */
export function canResend(cooldownLeft: number, sending: boolean): boolean {
  return cooldownLeft <= 0 && !sending;
}
