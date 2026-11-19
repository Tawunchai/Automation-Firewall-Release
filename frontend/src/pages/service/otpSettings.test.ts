import { describe, expect, it } from "vitest";
import type { SecurityConfigResponse } from "../../api/auth";
import {
  applyMasterToggle, applyTriggerToggle, flowsLostByDisabling,
  lockedHint, masterSummary, triggerRow,
} from "./otpSettings";

// Two-Step Verification — เทสของกฎสวิตช์ใหญ่ฝั่งหน้าจอ
//
// ต้องให้ผลตรงกับ `services.EffectiveOTPFlows` ฝั่ง Go ทุกกรณี ถ้าสองฝั่งไม่ตรงกัน
// หน้าจอจะบอกอย่างหนึ่งแต่ server ทำอีกอย่าง ซึ่งบนหน้าตั้งค่าความปลอดภัยคือ
// ความผิดพลาดที่แย่ที่สุด — ผู้ใช้ตัดสินใจจากสิ่งที่เห็น

const cfg = (over: Partial<SecurityConfigResponse> = {}): SecurityConfigResponse => {
  const base = { two_step: true, login_2fa: false, reset_otp: true, ...over };
  return {
    ...base,
    // ค่า effective คำนวณแบบเดียวกับ backend เว้นแต่เทสจะกำหนดมาเอง
    login_2fa_effective: over.login_2fa_effective ?? (base.two_step && base.login_2fa),
    reset_otp_effective: over.reset_otp_effective ?? (base.two_step && base.reset_otp),
  };
};

describe("triggerRow", () => {
  // ข้อที่ผู้ใช้ขอมาตรง ๆ: ต้องกดสวิตช์ใหญ่ก่อน ถึงจะกด OTP Trigger Settings ได้
  it("locks every trigger row while the master switch is off", () => {
    const c = cfg({ two_step: false, login_2fa: true, reset_otp: true });
    expect(triggerRow(c, "login").locked).toBe(true);
    expect(triggerRow(c, "reset").locked).toBe(true);
  });

  it("unlocks them once the master switch is on", () => {
    const c = cfg({ two_step: true });
    expect(triggerRow(c, "login").locked).toBe(false);
    expect(triggerRow(c, "reset").locked).toBe(false);
  });

  // สภาพที่เห็นบนหน้าจอจริงก่อนแก้: หัวข้อบอก "disabled" แต่แถว Reset Password OTP
  // ขึ้นป้าย ON — ป้าย ON บน flow ที่ไม่ทำงานคือการบอกว่าระบบกำลังส่ง OTP ทั้งที่ไม่ส่ง
  it("a ticked trigger under a master switch that is off reads PAUSED, not ON", () => {
    const row = triggerRow(cfg({ two_step: false, reset_otp: true }), "reset");
    expect(row.checked).toBe(true);   // ค่าที่ตั้งไว้ยังอยู่
    expect(row.active).toBe(false);   // แต่ไม่ทำงาน
    expect(row.badge).toBe("PAUSED");
    expect(row.badge).not.toBe("ON");
  });

  it("ticked with the master switch on reads ON", () => {
    expect(triggerRow(cfg({ two_step: true, reset_otp: true }), "reset").badge).toBe("ON");
  });

  it("unticked carries no badge", () => {
    expect(triggerRow(cfg({ two_step: true, login_2fa: false }), "login").badge).toBeNull();
  });
});

describe("lockedHint", () => {
  it("says why it is locked", () => {
    expect(lockedHint(cfg({ two_step: false }))).toContain("Two-Step Verification");
  });

  it("shows no message when nothing is locked", () => {
    expect(lockedHint(cfg({ two_step: true }))).toBeNull();
  });
});

describe("masterSummary", () => {
  it("states plainly that off means off for everything", () => {
    expect(masterSummary(cfg({ two_step: false, reset_otp: true }))).toContain("Off");
  });

  it("lists only the flows that are really in effect", () => {
    const s = masterSummary(cfg({ two_step: true, login_2fa: true, reset_otp: true }));
    expect(s).toContain("Login");
    expect(s).toContain("Reset Password");
  });

  // เปิดสวิตช์ใหญ่แต่ไม่ติ๊กอะไรเลย = ไม่มี OTP ที่ไหน ต้องไม่อ่านเหมือน "ปลอดภัยแล้ว"
  it("says so when it is on but no flow was chosen", () => {
    const s = masterSummary(cfg({ two_step: true, login_2fa: false, reset_otp: false }));
    expect(s).toContain("no flow has been set");
  });
});

describe("flowsLostByDisabling", () => {
  // ปิดสวิตช์ใหญ่คือการปิดความปลอดภัยของทั้งระบบ ต้องบอกก่อนว่าอะไรจะหยุด
  it("lists the flows that would stop working", () => {
    const lost = flowsLostByDisabling(cfg({ two_step: true, login_2fa: true, reset_otp: true }));
    expect(lost).toHaveLength(2);
  });

  // ไม่มีอะไรทำงานอยู่ = ไม่ต้องขึ้นกล่องยืนยัน ไม่งั้นคนจะชินกับการกดผ่าน
  it("does not warn when there is nothing to lose", () => {
    expect(flowsLostByDisabling(cfg({ two_step: true, login_2fa: false, reset_otp: false }))).toEqual([]);
    expect(flowsLostByDisabling(cfg({ two_step: false, reset_otp: true }))).toEqual([]);
  });
});

describe("applyMasterToggle", () => {
  // ค่าที่ผู้ใช้ติ๊กไว้ห้ามหาย — ปิดชั่วคราวแล้วเปิดกลับต้องได้ของเดิมคืน
  // (พฤติกรรมเดียวกับ backend ที่เก็บ key รายตัวไว้ไม่แตะ)
  it("turning it off and back on restores the previous triggers", () => {
    const on = cfg({ two_step: true, login_2fa: true, reset_otp: true });
    const off = applyMasterToggle(on, false);
    expect(off.login_2fa).toBe(true);
    expect(off.reset_otp).toBe(true);
    expect(off.login_2fa_effective).toBe(false);
    expect(off.reset_otp_effective).toBe(false);

    const back = applyMasterToggle(off, true);
    expect(back.login_2fa_effective).toBe(true);
    expect(back.reset_otp_effective).toBe(true);
  });
});

describe("applyTriggerToggle", () => {
  it("ticking a trigger while the master switch is on takes effect at once", () => {
    const next = applyTriggerToggle(cfg({ two_step: true, login_2fa: false }), "login", true);
    expect(next.login_2fa_effective).toBe(true);
  });

  // ต่อให้ค่าถูกเปลี่ยนได้ (เช่นยิง API ตรง) ค่า effective ต้องยังถูกสวิตช์ใหญ่กดไว้
  it("ticking a trigger while the master switch is off must not enable the flow", () => {
    const next = applyTriggerToggle(cfg({ two_step: false, login_2fa: false }), "login", true);
    expect(next.login_2fa).toBe(true);
    expect(next.login_2fa_effective).toBe(false);
  });

  it("leaves the other triggers alone", () => {
    const next = applyTriggerToggle(cfg({ two_step: true, reset_otp: true }), "login", true);
    expect(next.reset_otp).toBe(true);
    expect(next.reset_otp_effective).toBe(true);
  });
});

// ── ตรงกับฝั่ง Go ─────────────────────────────────────────────────────────────
// มิเรอร์ของ services.EffectiveOTPFlows — ถ้าฝั่งใดฝั่งหนึ่งถูกแก้ เทสนี้จะตกก่อน
describe("matches Go's EffectiveOTPFlows", () => {
  it("master switch off disables every flow, in every combination", () => {
    for (const login of [true, false]) {
      for (const reset of [true, false]) {
        const c = applyMasterToggle(cfg({ two_step: true, login_2fa: login, reset_otp: reset }), false);
        expect(c.login_2fa_effective, `login=${login}`).toBe(false);
        expect(c.reset_otp_effective, `reset=${reset}`).toBe(false);
      }
    }
  });

  it("master switch on passes each individual value straight through", () => {
    for (const login of [true, false]) {
      for (const reset of [true, false]) {
        const c = applyMasterToggle(cfg({ two_step: false, login_2fa: login, reset_otp: reset }), true);
        expect(c.login_2fa_effective).toBe(login);
        expect(c.reset_otp_effective).toBe(reset);
      }
    }
  });
});
