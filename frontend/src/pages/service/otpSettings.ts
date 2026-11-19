import type { SecurityConfigResponse } from "../../api/auth";

// Two-Step Verification — กฎของสวิตช์ใหญ่กับ OTP Trigger Settings
//
// แยกออกมาจาก component เพราะนี่คือ **กฎความปลอดภัย** ไม่ใช่แค่การจัดหน้า และมันต้อง
// ตรงกับ `services.EffectiveOTPFlows` ฝั่ง Go เป๊ะ ๆ ถ้าสองฝั่งไม่ตรงกัน หน้าจอจะบอก
// อย่างหนึ่งแต่ server ทำอีกอย่าง — ซึ่งบนหน้าตั้งค่าความปลอดภัยคือความผิดที่แย่ที่สุด
//
// สภาพก่อนแก้ (เห็นบนหน้าจอจริง): สวิตช์ใหญ่ปิด หัวข้อเขียนว่า "Email OTP verification
// is disabled" แต่ Reset Password OTP ยังติด ON และ **ยังส่ง OTP จริง** เพราะสวิตช์ใหญ่
// ผูกอยู่กับ login_2fa ตัวเดียว ไม่ได้คุมอะไรเลย

export type TriggerKey = "login" | "reset";

/** สถานะที่ trigger row หนึ่งแถวต้องแสดง */
export type RowState = {
  /** ค่าที่ผู้ใช้ติ๊กไว้ — ยังโชว์ตามเดิมแม้สวิตช์ใหญ่ปิด เพื่อไม่ให้ค่าที่ตั้งไว้ดูเหมือนหายไป */
  checked: boolean;
  /** ห้ามกด */
  locked: boolean;
  /** flow นี้ทำงานอยู่จริงไหม ณ ตอนนี้ */
  active: boolean;
  /** ป้ายมุมขวา — null = ไม่ต้องแสดงป้าย */
  badge: "ON" | "PAUSED" | null;
};

/**
 * เปิดสวิตช์ใหญ่ก่อน ถึงจะแตะ trigger ได้
 *
 * ตัว `locked` นี้เป็นแค่ด่านบนหน้าจอ — ฝั่ง server ปฏิเสธ PATCH ด้วย 409 อยู่แล้ว
 * ทั้งสองด่านต้องมี: ถ้ามีแค่หน้าจอ ใครยิง API ตรงก็ข้ามได้; ถ้ามีแค่ server ผู้ใช้จะกด
 * แล้วเจอ error โดยไม่รู้ว่าทำไม
 */
export function triggerRow(cfg: SecurityConfigResponse, key: TriggerKey): RowState {
  const checked = key === "login" ? cfg.login_2fa : cfg.reset_otp;
  const active = key === "login" ? cfg.login_2fa_effective : cfg.reset_otp_effective;
  return {
    checked,
    locked: !cfg.two_step,
    active,
    // ติ๊กไว้แต่สวิตช์ใหญ่ปิด = "PAUSED" ไม่ใช่ "ON" — ป้าย ON บน flow ที่ไม่ทำงาน
    // คือคำโกหกที่ทำให้คนคิดว่าระบบกำลังส่ง OTP อยู่
    badge: checked ? (active ? "ON" : "PAUSED") : null,
  };
}

/** คำอธิบายใต้หัวข้อสวิตช์ใหญ่ */
export function masterSummary(cfg: SecurityConfigResponse): string {
  if (!cfg.two_step) return "Off — every flow that uses an emailed OTP is disabled";
  const on: string[] = [];
  if (cfg.login_2fa_effective) on.push("Login");
  if (cfg.reset_otp_effective) on.push("Reset Password");
  if (on.length === 0) return "On — but no flow has been set to use an OTP yet";
  return `On — OTP is used for: ${on.join(", ")}`;
}

/** ข้อความบอกเหตุผลตอน trigger ถูกล็อก (null = ไม่ได้ล็อก) */
export function lockedHint(cfg: SecurityConfigResponse): string | null {
  return cfg.two_step ? null : "Turn on Two-Step Verification above before choosing which flows need an OTP";
}

/**
 * ปิดสวิตช์ใหญ่ = flow อะไรจะหยุดทำงานบ้าง (ใช้เตือนก่อนกดปิด)
 *
 * คืน [] เมื่อไม่มีอะไรกำลังทำงาน — จะได้ไม่ขึ้นกล่องยืนยันให้เปล่า ๆ จนคนชินกับการกดผ่าน
 */
export function flowsLostByDisabling(cfg: SecurityConfigResponse): string[] {
  if (!cfg.two_step) return [];
  const lost: string[] = [];
  if (cfg.login_2fa_effective) lost.push("OTP at sign-in");
  if (cfg.reset_otp_effective) lost.push("OTP when resetting a password");
  return lost;
}

/**
 * ปรับ config ในหน่วยความจำหลังสลับสวิตช์ใหญ่ โดยไม่ต้องรอ refetch
 *
 * ค่ารายตัว (login_2fa / reset_otp) **ห้ามถูกล้าง** — ผู้ใช้ปิดสวิตช์ใหญ่ชั่วคราวแล้วเปิดกลับ
 * ต้องได้ค่าที่เคยติ๊กไว้คืนมาเหมือนเดิม ซึ่งเป็นพฤติกรรมเดียวกับฝั่ง server
 */
export function applyMasterToggle(cfg: SecurityConfigResponse, twoStep: boolean): SecurityConfigResponse {
  return {
    ...cfg,
    two_step: twoStep,
    login_2fa_effective: twoStep && cfg.login_2fa,
    reset_otp_effective: twoStep && cfg.reset_otp,
  };
}

/** ปรับ config ในหน่วยความจำหลังสลับ trigger ตัวหนึ่ง */
export function applyTriggerToggle(
  cfg: SecurityConfigResponse, key: TriggerKey, value: boolean,
): SecurityConfigResponse {
  const next = key === "login"
    ? { ...cfg, login_2fa: value }
    : { ...cfg, reset_otp: value };
  return {
    ...next,
    login_2fa_effective: next.two_step && next.login_2fa,
    reset_otp_effective: next.two_step && next.reset_otp,
  };
}
