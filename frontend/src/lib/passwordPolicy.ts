import type { PasswordPolicy } from "../api/passwordpolicy";

// Password Policy — กฎชุดเดียวสำหรับทุกหน้าจอที่รับรหัสผ่าน
//
// ทำไมต้องรวมไว้ที่เดียว: กฎรหัสผ่านถูกเขียนซ้ำอยู่ **สามที่** ที่ไม่ตรงกันเลย
//
//   1. /admin/password-policy  — ค่าจริงในฐานข้อมูล (min_length + uppercase/number/special)
//   2. หน้า Create User        — hardcode ไว้เอง: min 8 + uppercase + lowercase + special
//                                (มี "lowercase" ที่ policy ไม่มีให้ตั้งด้วยซ้ำ)
//   3. backend CreateUser      — ไม่ตรวจ policy เลย รับอะไรก็ได้
//
// ผลตอนตั้ง policy ไว้ min 8 อย่างเดียว (ค่าจริงบนระบบ): หน้าเว็บไม่ยอมให้สร้างผู้ใช้
// ด้วยรหัสที่ policy อนุญาต ส่วน API กลับยอมรับรหัสที่ policy ห้าม — ผิดคนละทางทั้งคู่
//
// ไฟล์นี้เป็นฟังก์ชันบริสุทธิ์ ไม่ผูกกับ i18n (คืน key ออกไปให้ component แปลเอง)
// จะได้เทสได้โดยไม่ต้องตั้ง i18n instance และ backend ก็เทียบตรรกะเดียวกันได้

/** ค่าเริ่มต้นที่ปลอดภัยระหว่างรอ /password-policy ตอบกลับ */
export const DEFAULT_POLICY: PasswordPolicy = {
  min_length: 8,
  require_uppercase: false,
  require_number: false,
  require_special: false,
  expiry_days: 0,
};

export type PolicyRuleKey = "minLength" | "uppercase" | "number" | "special";

export type PolicyRule = {
  key: PolicyRuleKey;
  /** i18n key ที่ component เอาไปแปล */
  i18nKey: string;
  /** ตัวเลขสำหรับ interpolation ของ minLength เท่านั้น */
  count?: number;
  /** รหัสผ่านที่ให้มาผ่านข้อนี้หรือยัง */
  ok: boolean;
};

/**
 * กฎทั้งหมดที่ "เปิดใช้อยู่" พร้อมสถานะผ่าน/ไม่ผ่านของรหัสผ่านที่ให้มา
 *
 * กฎที่ policy ปิดไว้จะ **ไม่ถูกคืนออกมาเลย** ไม่ใช่คืนมาแล้วติ๊กถูกให้ — เพราะรายการนี้
 * ถูกใช้เป็นทั้ง checklist บนหน้าจอและตัวตรวจ ถ้าโชว์ข้อที่ไม่ได้บังคับ ผู้ใช้จะเข้าใจว่า
 * ต้องทำตามทั้งที่ไม่ต้อง (ซึ่งคือพฤติกรรมเดิมของหน้า Create User)
 */
export function policyRules(password: string, policy: PasswordPolicy): PolicyRule[] {
  const rules: PolicyRule[] = [
    {
      key: "minLength",
      i18nKey: "passwordPolicy.minLengthRule",
      count: policy.min_length,
      ok: password.length >= policy.min_length,
    },
  ];
  if (policy.require_uppercase) {
    rules.push({ key: "uppercase", i18nKey: "passwordPolicy.hasUppercase", ok: /[A-Z]/.test(password) });
  }
  if (policy.require_number) {
    rules.push({ key: "number", i18nKey: "passwordPolicy.hasNumber", ok: /[0-9]/.test(password) });
  }
  if (policy.require_special) {
    // ตรงกับฝั่ง Go: อะไรก็ตามที่ไม่ใช่ตัวอักษรและไม่ใช่ตัวเลข นับเป็นอักขระพิเศษ
    rules.push({ key: "special", i18nKey: "passwordPolicy.hasSpecial", ok: /[^A-Za-z0-9]/.test(password) });
  }
  return rules;
}

/**
 * ข้อแรกที่ไม่ผ่าน — ใช้เป็นข้อความ error ตอนกดบันทึก (null = ผ่านหมด)
 *
 * ต้องมาจาก `policyRules` ชุดเดียวกับ checklist เสมอ ไม่ใช่เขียน if ซ้ำอีกรอบ
 * ไม่งั้น checklist จะขึ้นเขียวครบแต่กดบันทึกไม่ผ่าน (หรือกลับกัน)
 */
export function firstPolicyViolation(password: string, policy: PasswordPolicy): PolicyRule | null {
  return policyRules(password, policy).find((r) => !r.ok) ?? null;
}

/** รหัสผ่านนี้ผ่าน policy ทั้งหมดหรือยัง */
export function meetsPolicy(password: string, policy: PasswordPolicy): boolean {
  return firstPolicyViolation(password, policy) === null;
}

/**
 * บรรทัดสรุปกฎใต้ช่องรหัสผ่าน เช่น "Min 8 chars · uppercase · number"
 *
 * คืนเป็น i18n key list ให้ component ประกอบ — ข้อความบนหน้าจอเดิมเขียนตายตัวว่า
 * "Min 8 chars · uppercase · lowercase · special character" ซึ่งไม่ตรงกับ policy จริง
 * ที่ตั้งไว้แค่ min 8 (ดูรูปหน้า Create User)
 */
export function policyHintRules(policy: PasswordPolicy): PolicyRule[] {
  return policyRules("", policy);
}
