package platform

import "testing"

// สวิตช์ใหญ่ Two-Step Verification
//
// หน้า /admin/service มีสวิตช์ใหญ่อยู่บนสุด แล้วมี OTP Trigger Settings อยู่ล่าง
// เทสชุดนี้ตรึงกฎเดียวไว้: **สวิตช์ใหญ่ปิด = ไม่มี email OTP หลุดออกจาก flow ไหนเลย**
// ถ้าสวิตช์นั้นเป็นแค่การเทาปุ่มบนหน้าจอ มันคือคำโกหกที่อันตรายที่สุดบนหน้าตั้งค่า
// ความปลอดภัย — ผู้ใช้เชื่อว่าปิดแล้ว แต่ระบบยังส่ง OTP อยู่
//
// สภาพก่อนแก้ (เห็นจากหน้าจอจริง): หัวข้อเขียน "Email OTP verification is disabled"
// แต่แถว Reset Password OTP ติด ON และยังส่ง OTP จริง เพราะสวิตช์ใหญ่ผูกกับ login_2fa
// ตัวเดียว ไม่ได้คุมอะไรเลย

func TestEffectiveOTPFlows_MasterOffKillsEverything(t *testing.T) {
	// ทุกการผสมของ trigger รายตัว เมื่อสวิตช์ใหญ่ปิด ต้องได้ false ทั้งคู่เสมอ
	for _, tc := range []struct{ login, reset bool }{
		{false, false}, {true, false}, {false, true}, {true, true},
	} {
		login, reset := effectiveOTPFlows(false, tc.login, tc.reset)
		if login || reset {
			t.Errorf("effectiveOTPFlows(false, %v, %v) = (%v, %v) — สวิตช์ใหญ่ปิดแล้วต้องปิดหมด",
				tc.login, tc.reset, login, reset)
		}
	}
}

func TestEffectiveOTPFlows_MasterOnPassesTriggersThrough(t *testing.T) {
	cases := []struct {
		login, reset         bool
		wantLogin, wantReset bool
	}{
		{true, true, true, true},
		{true, false, true, false},
		{false, true, false, true},
		{false, false, false, false},
	}
	for _, tc := range cases {
		login, reset := effectiveOTPFlows(true, tc.login, tc.reset)
		if login != tc.wantLogin || reset != tc.wantReset {
			t.Errorf("effectiveOTPFlows(true, %v, %v) = (%v, %v), want (%v, %v)",
				tc.login, tc.reset, login, reset, tc.wantLogin, tc.wantReset)
		}
	}
}

// สวิตช์ใหญ่ห้าม "ล้าง" ค่ารายตัว — ปิดแล้วเปิดกลับต้องได้ค่าเดิมคืน ไม่งั้นผู้ใช้ที่
// ปิดชั่วคราวเพื่อแก้ปัญหา จะกลับมาเจอ trigger ที่ถูกรีเซ็ตหมดโดยไม่รู้ตัว
func TestOTPGate_MasterDoesNotDestroyStoredTriggers(t *testing.T) {
	g := OTPGate{TwoStep: false, LoginOTP: true, ResetOTP: true}
	if g.LoginOTPActive() || g.ResetOTPActive() {
		t.Fatal("สวิตช์ใหญ่ปิดแล้วยัง active อยู่")
	}
	g.TwoStep = true
	if !g.LoginOTPActive() || !g.ResetOTPActive() {
		t.Error("เปิดสวิตช์ใหญ่กลับมาแล้วต้องได้ค่า trigger เดิมคืน")
	}
}

// สวิตช์ใหญ่กับการรีเซ็ตรหัสผ่าน — กฎใหม่
//
// เทสสองตัวที่เคยอยู่ตรงนี้ตรึงกฎเดิมไว้ว่า "ทางรีเซ็ตสองทางต้องเปิดสลับกันเสมอ":
//
//	SendOTP             เปิดเมื่อ  ResetOTPActive() == true    (ส่ง OTP ไปอีเมล)
//	ResetPasswordDirect เปิดเมื่อ  ResetOTPActive() == false   (ตั้งรหัสใหม่ตรง ๆ)
//
// กฎนั้นมาจากความกังวลที่ถูกต้อง — ปิดสวิตช์ใหญ่แล้วต้องไม่มีใครติดอยู่ข้างนอกระบบ — แต่ทาง
// สำรองที่มันเลือกใช้คือทางที่ **ไม่ตรวจอะไรเลย**: reset token ที่ ResetPasswordDirect เชื่อถือ
// ถูกแจกโดย /check-user-email ให้ใครก็ได้ที่ยิงเข้ามาโดยไม่ต้องล็อกอิน เท่ากับว่าแค่รู้อีเมล
// ก็ตั้งรหัสผ่านใหม่ให้บัญชีนั้นได้ รวมถึงบัญชี admin
//
// ทางสำรองที่ถูกต้องมีอยู่ในระบบอยู่แล้ว: PATCH /admin/users/:id ให้ admin ตั้งรหัสให้ผู้ใช้ได้
// กฎจึงเปลี่ยนเป็น — รีเซ็ตด้วยตัวเองได้เมื่อ OTP เปิดเท่านั้น นอกนั้นเป็นงานของ admin
//
// เทสด้านล่างตรึงกฎใหม่นี้ไว้ และจะ fail ทันทีถ้ามีใครเปิดทางรีเซ็ตแบบไม่ต้องพิสูจน์ตัวตนกลับมา

// TestOTPGate_SelfServiceResetRequiresOTP — มีทางรีเซ็ตด้วยตัวเองทางเดียว และมันผูกกับ OTP เสมอ
//
// อ่านค่าจาก ResetOTPActive() ตัวเดียวกับที่ SendOTP ใช้ ครบทุกการผสมของสวิตช์ทั้งสาม เพื่อกัน
// ไม่ให้เกิดสภาพ "OTP ปิดอยู่ แต่ยังมีทางตั้งรหัสใหม่ได้โดยไม่ต้องยืนยันอะไร" ขึ้นมาอีก
func TestOTPGate_SelfServiceResetRequiresOTP(t *testing.T) {
	for _, twoStep := range []bool{true, false} {
		for _, login := range []bool{true, false} {
			for _, reset := range []bool{true, false} {
				g := OTPGate{TwoStep: twoStep, LoginOTP: login, ResetOTP: reset}

				// เงื่อนไขเดียวกับที่ SendOTP ใช้ตัดสิน — คือทางรีเซ็ตด้วยตัวเองทางเดียวที่เหลือ
				selfServiceOpen := g.ResetOTPActive()

				// สวิตช์ใหญ่ปิด = ห้ามมีทางรีเซ็ตด้วยตัวเองเลย ไม่ว่า reset_otp_enabled จะติ๊กไว้หรือไม่
				if !twoStep && selfServiceOpen {
					t.Fatalf("two_step=false reset=%v: สวิตช์ใหญ่ปิดแล้วแต่ยังรีเซ็ตเองได้", reset)
				}
				// สวิตช์ใหญ่เปิด = ทางรีเซ็ตต้องเปิด/ปิดตาม reset_otp_enabled เป๊ะ ๆ ไม่มีทางลัดอื่น
				if twoStep && selfServiceOpen != reset {
					t.Fatalf("two_step=true reset=%v: ทางรีเซ็ตควรเป็น %v แต่ได้ %v",
						reset, reset, selfServiceOpen)
				}
			}
		}
	}
}

// ปิดสวิตช์ใหญ่ = ไม่มี OTP ทางอีเมลหลุดออกไปจาก flow ไหนเลย และไม่มีทางรีเซ็ตแบบไม่ตรวจสอบ
// มาแทนที่ — คนที่ล็อกตัวเองออกต้องให้ admin ตั้งรหัสให้ (PATCH /admin/users/:id)
func TestOTPGate_MasterOffLeavesResetToAdminOnly(t *testing.T) {
	g := OTPGate{TwoStep: false, LoginOTP: true, ResetOTP: true}
	if g.ResetOTPActive() {
		t.Fatal("reset OTP ยัง active ทั้งที่สวิตช์ใหญ่ปิด — ระบบจะยังส่ง OTP ออกไป")
	}
	if g.LoginOTPActive() {
		t.Fatal("login OTP ยัง active ทั้งที่สวิตช์ใหญ่ปิด")
	}
}
