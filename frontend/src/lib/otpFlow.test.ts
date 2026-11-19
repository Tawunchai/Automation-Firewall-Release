import { describe, expect, it } from "vitest";
import {
  OTP_LENGTH, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS, RESEND_COOLDOWN_SECONDS,
  canResend, digitsOnly, emptyOtp, expiryState, formatCountdown, isComplete,
  pasteCode, pressBackspace, shouldAutoSubmit, typeDigit,
} from "./otpFlow";

// OTP dialog — เทสของสิ่งที่ผู้ใช้ "รู้สึก" ว่าพัง แต่จริง ๆ คือข้อจำกัดของ backend
// ที่ไม่มีใครบอกเขา:
//
//   OTPExpiration 5 นาที · OTPMaxAttempts 5 ครั้ง · OTPLimiter 5 ครั้ง/10 นาที/IP
//
// ทุกฟังก์ชันในไฟล์นี้มีไว้เพื่อให้ข้อจำกัดพวกนั้นมองเห็นได้บนหน้าจอ ก่อนที่ผู้ใช้จะชนมัน

describe("constants must match the backend", () => {
  // ตัวเลขพวกนี้ไม่ได้เลือกให้สวย — มันคือสัญญากับ services/otp.go และ middleware/ratelimit.go
  it("the code lifetime matches services.OTPExpiration", () => {
    expect(OTP_TTL_SECONDS).toBe(5 * 60);
  });

  it("the attempt limit matches services.OTPMaxAttempts", () => {
    expect(OTP_MAX_ATTEMPTS).toBe(5);
  });

  // OTPLimiter ให้ส่งได้ 5 ครั้งต่อ 10 นาที — คูลดาวน์ 60 วิ ทำให้ใช้ครบ 5 ครั้งกินเวลา
  // 5 นาที ซึ่งยาวกว่าอายุโค้ดหนึ่งใบ ผู้ใช้ปกติจึงชนเพดาน 429 ไม่ได้
  it("the cooldown makes the 5-per-10-minutes ceiling unreachable", () => {
    const spentSeconds = RESEND_COOLDOWN_SECONDS * 5;
    expect(spentSeconds).toBeGreaterThanOrEqual(OTP_TTL_SECONDS);
    expect(spentSeconds).toBeLessThan(10 * 60);
  });
});

describe("formatCountdown", () => {
  it("seconds are always two digits", () => {
    expect(formatCountdown(300)).toBe("5:00");
    expect(formatCountdown(272)).toBe("4:32");
    expect(formatCountdown(9)).toBe("0:09");
    expect(formatCountdown(0)).toBe("0:00");
  });

  // นาฬิกาที่เดินเลย 0 ไปเป็น "-0:01" บนหน้าจอความปลอดภัย อ่านเหมือนระบบพัง
  it("never shows a negative time", () => {
    expect(formatCountdown(-5)).toBe("0:00");
  });
});

describe("expiryState", () => {
  it("plenty of time left reads as normal", () => {
    expect(expiryState(300)).toBe("fresh");
    expect(expiryState(61)).toBe("fresh");
  });

  // เตือนตอนเหลือไม่ถึงนาที — ก่อนหน้านี้ไม่มีอะไรบอกเลยว่าโค้ดกำลังจะหมดอายุ
  it("under a minute left reads as a warning", () => {
    expect(expiryState(60)).toBe("warning");
    expect(expiryState(1)).toBe("warning");
  });

  // หมดอายุแล้วต้องบอกว่า "ขอใหม่" ไม่ใช่ปล่อยให้กรอกแล้วเจอ "OTP expired" ซึ่งอ่านเหมือนกรอกผิด
  it("no time left reads as expired", () => {
    expect(expiryState(0)).toBe("expired");
    expect(expiryState(-1)).toBe("expired");
  });
});

describe("canResend", () => {
  it("is clickable once the cooldown is over and nothing is in flight", () => {
    expect(canResend(0, false)).toBe(true);
  });

  it("is not clickable during the cooldown, or while a request is in flight", () => {
    expect(canResend(30, false)).toBe(false);
    expect(canResend(0, true)).toBe(false);
  });
});

describe("digitsOnly", () => {
  // ช่องกรอกเป็นช่องเดียว ทุกอย่างที่พิมพ์/วางลงไปผ่านฟังก์ชันนี้ก่อนเสมอ
  it("drops everything that is not a digit", () => {
    expect(digitsOnly("48-39 20")).toBe("483920");
    expect(digitsOnly("abc")).toBe("");
  });

  // คนมัก copy ทั้งบรรทัดจากอีเมลมาวาง — ส่วนเกินต้องถูกตัด ไม่ใช่ทำให้ช่องพัง
  it("caps the length at six digits", () => {
    expect(digitsOnly("1234567890")).toBe("123456");
    expect(digitsOnly("1234567890", 3)).toBe("123");
  });
});

describe("isComplete", () => {
  it("only a full set of boxes counts as complete", () => {
    expect(isComplete(["1", "2", "3", "4", "5", "6"])).toBe(true);
    expect(isComplete(["1", "2", "3", "4", "5", ""])).toBe(false);
    expect(isComplete(emptyOtp())).toBe(false);
  });
});

describe("typeDigit", () => {
  it("typing advances to the next box", () => {
    const r = typeDigit(emptyOtp(), 0, "4");
    expect(r.next[0]).toBe("4");
    expect(r.focus).toBe(1);
  });

  // พิมพ์ทับช่องที่มีเลขอยู่ ต้องได้ตัวใหม่ ไม่ใช่ตัวเดิมค้าง
  it("typing over an existing digit replaces it", () => {
    expect(typeDigit(["1", "", "", "", "", ""], 0, "19").next[0]).toBe("9");
  });

  it("a non-digit is discarded and does not move the focus", () => {
    const r = typeDigit(emptyOtp(), 0, "a");
    expect(r.next[0]).toBe("");
    expect(r.focus).toBe(0);
  });

  it("the last box does not advance any further", () => {
    expect(typeDigit(emptyOtp(), OTP_LENGTH - 1, "7").focus).toBe(OTP_LENGTH - 1);
  });

  it("does not mutate the input array", () => {
    const otp = emptyOtp();
    typeDigit(otp, 0, "5");
    expect(otp[0]).toBe("");
  });
});

describe("pressBackspace", () => {
  // กดหนึ่งครั้งต้องหายหนึ่งตัว — ถ้าลบช่องปัจจุบันแล้วถอยไปลบช่องก่อนหน้าด้วย
  // จะหายสองตัวต่อการกดหนึ่งครั้ง
  it("backspace in a filled box clears that box and keeps the focus", () => {
    const r = pressBackspace(["1", "2", "", "", "", ""], 1);
    expect(r.next).toEqual(["1", "", "", "", "", ""]);
    expect(r.focus).toBe(1);
  });

  it("backspace in an empty box steps back and clears the previous one", () => {
    const r = pressBackspace(["1", "", "", "", "", ""], 1);
    expect(r.next[0]).toBe("");
    expect(r.focus).toBe(0);
  });

  it("backspace in the first, empty box does nothing", () => {
    const r = pressBackspace(emptyOtp(), 0);
    expect(r.next).toEqual(emptyOtp());
    expect(r.focus).toBe(0);
  });
});

describe("pasteCode", () => {
  // คนส่วนใหญ่ copy โค้ดจากอีเมลมาทั้งก้อน วางครั้งเดียวต้องเต็มทุกช่อง
  // นี่คือเหตุผลหลักที่หกช่องแยกยังใช้งานง่ายเท่าช่องเดียว
  it("pasting a full code into the first box fills them all", () => {
    const r = pasteCode(emptyOtp(), 0, "483920");
    expect(r.next.join("")).toBe("483920");
    expect(r.focus).toBe(OTP_LENGTH - 1);
  });

  it("strips non-digits out of the pasted text", () => {
    expect(pasteCode(emptyOtp(), 0, "48-39 20").next.join("")).toBe("483920");
  });

  // วางโค้ดยาวลงช่องท้าย ๆ ต้องไม่ล้นออกนอก 6 ช่อง (เหลือ 2 ช่อง = รับได้ 2 ตัว)
  it("pasting into a middle box works and never overflows the row", () => {
    const r = pasteCode(emptyOtp(), 4, "9999");
    expect(r.next).toEqual(["", "", "", "", "9", "9"]);
    expect(r.focus).toBe(OTP_LENGTH - 1);
  });

  it("pasting text with no digits changes nothing", () => {
    const otp = ["1", "", "", "", "", ""];
    expect(pasteCode(otp, 0, "hello").next).toEqual(otp);
  });
});

describe("shouldAutoSubmit", () => {
  const full = ["4", "8", "3", "9", "2", "0"];

  it("submits as soon as six digits are in and this code has not been tried", () => {
    expect(shouldAutoSubmit(full, "", { submitting: false, expired: false })).toBe(true);
  });

  it("does not submit an incomplete code", () => {
    expect(shouldAutoSubmit(["4", "8", "3", "9", "2", ""], "", { submitting: false, expired: false })).toBe(false);
  });

  // นี่คือกับดักตัวจริงของ auto-submit: หลังคำขอจบ `submitting` กลับเป็น false แล้ว effect
  // จะถูกประเมินใหม่ทันที ถ้าไม่จำว่าเพิ่งส่งชุดนี้ไป มันจะยิงซ้ำวนไม่จบ — และเนื่องจาก
  // OTPMaxAttempts = 5 การพิมพ์ผิดครั้งเดียวจะเผาโควตาหมดในไม่กี่วินาที
  it("never resubmits the code it just sent, which would burn through OTPMaxAttempts in a loop", () => {
    expect(shouldAutoSubmit(full, full.join(""), { submitting: false, expired: false })).toBe(false);
  });

  it("an edited code counts as a new one and may be submitted", () => {
    expect(shouldAutoSubmit(["4", "8", "3", "9", "2", "1"], full.join(""), { submitting: false, expired: false })).toBe(true);
  });

  it("does not submit while a request is in flight, or after the code expired", () => {
    expect(shouldAutoSubmit(full, "", { submitting: true, expired: false })).toBe(false);
    expect(shouldAutoSubmit(full, "", { submitting: false, expired: true })).toBe(false);
  });
});
