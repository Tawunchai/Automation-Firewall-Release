import { describe, expect, it } from "vitest";
import type { PasswordPolicy } from "../api/passwordpolicy";
import {
  DEFAULT_POLICY, firstPolicyViolation, meetsPolicy, policyHintRules, policyRules,
} from "./passwordPolicy";

// Password Policy — เทสของกฎรหัสผ่านชุดเดียวของทั้งแอป
//
// ก่อนหน้านี้กฎถูกเขียนไว้สามที่ที่ไม่ตรงกัน:
//   /admin/password-policy (ค่าจริง) · หน้า Create User (hardcode) · backend CreateUser (ไม่ตรวจเลย)
// ผลตอน policy จริงตั้งไว้ min 8 อย่างเดียว: หน้าเว็บไม่ยอมให้ตั้งรหัสที่ policy อนุญาต
// ส่วน API กลับยอมรับรหัสที่ policy ห้าม เทสชุดนี้ตรึงไว้ว่ามีกฎเดียว และมาจาก policy เท่านั้น

const policy = (over: Partial<PasswordPolicy> = {}): PasswordPolicy => ({ ...DEFAULT_POLICY, ...over });

describe("policyRules", () => {
  // นี่คือ policy จริงบนระบบตอนนี้ — หน้า Create User เดิมบังคับ uppercase/lowercase/special
  // เพิ่มมาเองทั้งที่ policy ไม่ได้สั่ง
  it("a policy setting only min_length yields exactly one rule", () => {
    const rules = policyRules("abcdefgh", policy());
    expect(rules).toHaveLength(1);
    expect(rules[0].key).toBe("minLength");
    expect(rules[0].ok).toBe(true);
  });

  // กฎที่ปิดไว้ต้องหายไปเลย ไม่ใช่โผล่มาแล้วติ๊กถูกให้ — ไม่งั้นผู้ใช้เข้าใจว่าต้องทำตาม
  it("a rule the policy disables is never shown", () => {
    const keys = policyRules("abc", policy({ require_uppercase: true })).map((r) => r.key);
    expect(keys).toContain("uppercase");
    expect(keys).not.toContain("number");
    expect(keys).not.toContain("special");
  });

  it("enabling everything yields every rule", () => {
    const rules = policyRules("", policy({
      require_uppercase: true, require_number: true, require_special: true,
    }));
    expect(rules.map((r) => r.key)).toEqual(["minLength", "uppercase", "number", "special"]);
  });

  it("checks each rule correctly", () => {
    const p = policy({ min_length: 4, require_uppercase: true, require_number: true, require_special: true });
    const byKey = Object.fromEntries(policyRules("Ab1!", p).map((r) => [r.key, r.ok]));
    expect(byKey).toEqual({ minLength: true, uppercase: true, number: true, special: true });

    const weak = Object.fromEntries(policyRules("abc", p).map((r) => [r.key, r.ok]));
    expect(weak).toEqual({ minLength: false, uppercase: false, number: false, special: false });
  });

  // min_length มาจาก policy ไม่ใช่เลข 8 ที่ฝังไว้ — ตั้ง 6 ที่หน้า policy แล้วต้องมีผลจริง
  it("min_length comes from the policy, not from a hard-coded number", () => {
    expect(policyRules("abcdef", policy({ min_length: 6 }))[0].ok).toBe(true);
    expect(policyRules("abcdef", policy({ min_length: 12 }))[0].ok).toBe(false);
  });

  it("passes min_length to i18n as a count", () => {
    expect(policyRules("", policy({ min_length: 10 }))[0].count).toBe(10);
  });

  // ตรงกับฝั่ง Go (unicode.IsLetter/IsDigit): อะไรที่ไม่ใช่ตัวอักษรและไม่ใช่ตัวเลข = อักขระพิเศษ
  it("the special-character set matches Go's ValidatePasswordPolicy", () => {
    const p = policy({ min_length: 1, require_special: true });
    for (const ch of ["!", "@", "#", "_", "-", " ", "."]) {
      expect(meetsPolicy(`a${ch}`, p), ch).toBe(true);
    }
    expect(meetsPolicy("abc123", p)).toBe(false);
  });
});

describe("firstPolicyViolation", () => {
  it("returns null when every rule passes", () => {
    expect(firstPolicyViolation("abcdefgh", policy())).toBeNull();
  });

  it("returns the first rule that fails", () => {
    const bad = firstPolicyViolation("ab", policy({ require_uppercase: true }));
    expect(bad?.key).toBe("minLength");
  });

  // checklist กับตัวตรวจตอนกดบันทึกต้องเป็นชุดเดียวกัน ไม่งั้นจะเกิดสภาพ
  // "ติ๊กเขียวครบแต่กดสร้างไม่ผ่าน" ซึ่งไม่มีทางแก้จากหน้าจอ
  it("always agrees with policyRules", () => {
    const p = policy({ min_length: 6, require_number: true });
    for (const pwd of ["", "a", "abcdef", "abcde1", "abcdef1"]) {
      const rules = policyRules(pwd, p);
      const allOk = rules.every((r) => r.ok);
      expect(firstPolicyViolation(pwd, p) === null, pwd).toBe(allOk);
      expect(meetsPolicy(pwd, p), pwd).toBe(allOk);
    }
  });
});

describe("policyHintRules", () => {
  // บรรทัดใต้ช่องรหัสผ่านต้องบอกกฎจริง — ของเดิมเขียนตายว่า
  // "Min 8 chars · uppercase · lowercase · special character" ทั้งที่ policy ตั้งไว้แค่ min 8
  // และ "lowercase" ไม่มีให้ตั้งที่หน้า Password Policy ด้วยซ้ำ
  it("shows only the rules that are actually enforced", () => {
    expect(policyHintRules(policy()).map((r) => r.key)).toEqual(["minLength"]);
    expect(policyHintRules(policy({ require_number: true })).map((r) => r.key))
      .toEqual(["minLength", "number"]);
  });

  it("with nothing typed, every required rule is still unmet", () => {
    const rules = policyHintRules(policy({ require_uppercase: true }));
    expect(rules.every((r) => !r.ok)).toBe(true);
  });
});

describe("DEFAULT_POLICY", () => {
  // ใช้ตอนอ่าน /password-policy ไม่สำเร็จ — ต้องเป็นค่าที่ไม่หลวมกว่าค่าเริ่มต้นของ backend
  // (services.GetPasswordPolicy default min 8, ที่เหลือ false)
  it("matches the backend defaults", () => {
    expect(DEFAULT_POLICY).toEqual({
      min_length: 8,
      require_uppercase: false,
      require_number: false,
      require_special: false,
      expiry_days: 0,
    });
  });
});
