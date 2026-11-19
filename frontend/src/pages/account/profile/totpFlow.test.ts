import { describe, expect, it } from "vitest";
import {
  cancelTarget, initialTotpStep, shouldFetchQrOnOpen, totpBadge, totpChallengesLogin,
} from "./totpFlow";

// TOTP dialog — เปิดมาแล้วต้องเจอหน้าไหน
//
// ผู้ใช้กดปุ่ม "Set Up TOTP" ที่หน้า My Profile มาแล้ว ของเดิมยังเปิดมาเจอหน้า
// "Not Set Up" + ปุ่ม "Set Up Authenticator App" ให้กดซ้ำอีกหนึ่งครั้ง — เป็นการถาม
// คำถามเดิมสองรอบ เทสชุดนี้ตรึงไว้ว่าคนที่ยังไม่เคยตั้ง TOTP ต้องเข้าหน้า QR ทันที

describe("initialTotpStep", () => {
  // ข้อที่ผู้ใช้ขอ: ไม่ต้องกด Set Up
  it("never set up goes straight to the QR screen", () => {
    expect(initialTotpStep(false, true)).toBe("scanning");
  });

  // คนที่ตั้งไว้แล้วเข้ามาเพื่อ "ปิด / เปิดใหม่ / ลบ" — หน้า idle คือเมนูของจริง
  // ไม่ใช่ปุ่มผ่านทาง ถ้าลากเขาไปหน้า QR เลยจะกลายเป็นการเสนอให้ตั้งใหม่ทับของเดิม
  it("already set up opens the manage menu, not a fresh QR", () => {
    expect(initialTotpStep(true, true)).toBe("idle");
  });

  // สวิตช์ TOTP ระดับระบบปิดอยู่ → ห้ามยิง setup-init เพราะจะสร้าง record ที่ใช้ไม่ได้
  // ทิ้งไว้ หน้า idle เป็นหน้าเดียวที่อธิบายได้ว่าทำไมตั้งไม่ได้
  it("TOTP disabled system-wide stays on idle so it can explain why", () => {
    expect(initialTotpStep(false, false)).toBe("idle");
    expect(initialTotpStep(true, false)).toBe("idle");
  });
});

describe("shouldFetchQrOnOpen", () => {
  it("calls setup-init only when it really is opening the QR screen", () => {
    expect(shouldFetchQrOnOpen(false, true)).toBe(true);
  });

  it("does not call it when the user is already set up, or TOTP is off system-wide", () => {
    expect(shouldFetchQrOnOpen(true, true)).toBe(false);
    expect(shouldFetchQrOnOpen(false, false)).toBe(false);
  });
});

describe("cancelTarget", () => {
  // คนที่ยังไม่เคยตั้ง ไม่มี "หน้าก่อนหน้า" ให้กลับแล้ว — ส่งกลับ idle จะไปโผล่หน้า
  // Not Set Up ที่เพิ่งถูกตัดออกจากทางเดิน แล้วปุ่มในนั้นก็วนกลับมาที่เดิม
  it("Cancel closes the dialog for someone who has never set it up", () => {
    expect(cancelTarget(false)).toBe("close");
  });

  it("Cancel returns an existing user to their manage menu", () => {
    expect(cancelTarget(true)).toBe("idle");
  });
});

// ── ป้ายสถานะบนหัวโปรไฟล์ ────────────────────────────────────────────────────
//
// อาการที่ผู้ใช้เจอ: ตั้ง TOTP เสร็จแล้ว แต่ปุ่มขึ้น "TOTP Disabled" (สีเหลือง) และ
// login ก็ไม่ถาม TOTP — สถานะจริงในฐานข้อมูลคือ is_verified=t, is_enabled=f
//
// ต้นเหตุ: handleTotpVerify ตั้งแค่ verified แล้วลืมตั้ง isEnabled (ทั้งที่ server ตั้งให้
// ทั้งคู่) ปุ่มจึงขึ้น "Disabled" ทันทีหลังสแกน QR เสร็จ ผู้ใช้กด "Enable TOTP" ตามที่เห็น
// แล้ว endpoint ที่ "สลับค่า" ก็พลิกของจริงจาก true เป็น false

describe("totpBadge", () => {
  // ข้อที่ผู้ใช้ขอ: เปิด TOTP แล้วต้องเป็นเครื่องหมายถูกสีเขียว
  it("set up and enabled is active — the green tick", () => {
    expect(totpBadge(true, true, true)).toBe("active");
  });

  // "paused" ต้องมาจากการที่ผู้ใช้กดปิดเองเท่านั้น
  it("set up but switched off by the user is paused", () => {
    expect(totpBadge(true, false, true)).toBe("paused");
  });

  it("never set up is setup, not paused", () => {
    expect(totpBadge(false, false, true)).toBe("setup");
    expect(totpBadge(false, false, true)).not.toBe("paused");
  });

  // ระบบปิด TOTP ไว้ = ต่อให้ผู้ใช้ตั้งครบ มันก็ไม่ถูกใช้ตอน login อยู่ดี
  it("TOTP disabled system-wide overrides every other case", () => {
    for (const verified of [true, false]) {
      for (const enabled of [true, false]) {
        expect(totpBadge(verified, enabled, false)).toBe("unavailable");
      }
    }
  });

  // ปุ่มสีเขียวต้องไม่ขึ้นเว้นแต่ TOTP จะทำงานจริงตอน login
  it("shows active only when sign-in really will ask for a TOTP", () => {
    for (const verified of [true, false]) {
      for (const enabled of [true, false]) {
        for (const global of [true, false]) {
          const isActive = totpBadge(verified, enabled, global) === "active";
          expect(isActive, `${verified}/${enabled}/${global}`)
            .toBe(totpChallengesLogin(verified, enabled, global));
        }
      }
    }
  });
});

describe("totpChallengesLogin", () => {
  // ตรงกับเงื่อนไขใน auth.Login: global_enabled AND is_verified AND is_enabled
  it("requires all three conditions", () => {
    expect(totpChallengesLogin(true, true, true)).toBe(true);
    expect(totpChallengesLogin(false, true, true)).toBe(false);
    expect(totpChallengesLogin(true, false, true)).toBe(false);
    expect(totpChallengesLogin(true, true, false)).toBe(false);
  });

  // นี่คือสภาพที่ผู้ใช้เจอจริง: ตั้งแล้ว ระบบเปิด แต่ is_enabled ถูกพลิกเป็น false
  // → login ไม่ถาม TOTP ป้ายบนหน้าจอต้องบอกความจริงข้อนี้ ไม่ใช่ขึ้นเขียว
  it("with is_enabled=false sign-in does not ask, so the badge must not be green", () => {
    expect(totpChallengesLogin(true, false, true)).toBe(false);
    expect(totpBadge(true, false, true)).not.toBe("active");
  });
});
