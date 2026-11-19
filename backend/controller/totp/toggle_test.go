package totp

import (
	"encoding/json"
	"testing"
)

// PATCH /totp/toggle-enabled — ปุ่มต้องทำตามที่ตัวเองเขียนไว้
//
// อาการที่เจอกับของจริง: ผู้ใช้สแกน QR + ใส่โค้ดสำเร็จ (server ตั้ง is_verified=true,
// is_enabled=true ให้เรียบร้อย) แต่หน้าจอขึ้น "TOTP Disabled" เพราะ client ลืมอัปเดต
// is_enabled ของตัวเอง ผู้ใช้จึงกดปุ่ม "Enable TOTP" ตามที่เห็น — และ endpoint นี้
// (ซึ่ง "สลับค่า" อย่างเดียว) ก็พลิกของจริงจาก true เป็น **false**
//
// ผลลัพธ์: is_verified=t, is_enabled=f → auth.Login ข้าม TOTP ทั้งก้อน
// (เงื่อนไขคือ is_verified = true AND is_enabled = true) ผู้ใช้จึง "เปิด TOTP แล้ว
// แต่ตอน login ไม่มีให้ใส่ TOTP"
//
// ทางแก้: รับ {"enabled": bool} มาตั้งค่าตรง ๆ · ไม่ส่ง body ค่อยสลับแบบเดิม

// resolve จำลองการตัดสินใจใน ToggleEnabled: current คือค่าใน DB, body คือสิ่งที่ client ส่งมา
func resolve(t *testing.T, current bool, body string) bool {
	t.Helper()
	var in toggleEnabledInput
	if body != "" {
		if err := json.Unmarshal([]byte(body), &in); err != nil {
			t.Fatalf("json ไม่ถูกต้อง: %v", err)
		}
	}
	next := !current
	if in.Enabled != nil {
		next = *in.Enabled
	}
	return next
}

// ปุ่ม "Enable" ต้องเปิด ไม่ว่าค่าใน DB ตอนนั้นจะเป็นอะไร — นี่คือเคสที่พังของจริง:
// DB เป็น true อยู่แล้ว (เพิ่ง verify เสร็จ) แต่หน้าจอโชว์ผิดเลยกดปุ่ม Enable
func TestToggleEnabled_ExplicitEnableAlwaysEnables(t *testing.T) {
	for _, current := range []bool{true, false} {
		if got := resolve(t, current, `{"enabled":true}`); !got {
			t.Errorf("current=%v + {\"enabled\":true} = %v, want true", current, got)
		}
	}
}

func TestToggleEnabled_ExplicitDisableAlwaysDisables(t *testing.T) {
	for _, current := range []bool{true, false} {
		if got := resolve(t, current, `{"enabled":false}`); got {
			t.Errorf("current=%v + {\"enabled\":false} = %v, want false", current, got)
		}
	}
}

// ไม่ส่ง body = พฤติกรรมเดิม (สลับค่า) — ของเก่าที่เรียกอยู่ต้องไม่พัง
func TestToggleEnabled_NoBodyStillToggles(t *testing.T) {
	if got := resolve(t, true, ""); got {
		t.Error("body ว่าง + current=true ต้องได้ false")
	}
	if got := resolve(t, false, ""); !got {
		t.Error("body ว่าง + current=false ต้องได้ true")
	}
	// {} ก็ถือว่าไม่ได้ระบุ เพราะ Enabled เป็น pointer
	if got := resolve(t, true, `{}`); got {
		t.Error("body {} + current=true ต้องได้ false")
	}
}

// `false` ที่ส่งมาจริง ๆ ต้องไม่ถูกกลืนเป็น "ไม่ได้ระบุ" — เหตุผลที่ field เป็น *bool
// ไม่ใช่ bool ธรรมดา (ค่า zero ของ bool คือ false ซึ่งแยกจาก "ไม่ส่งมา" ไม่ได้)
func TestToggleEnabled_ExplicitFalseIsNotMistakenForUnset(t *testing.T) {
	var in toggleEnabledInput
	if err := json.Unmarshal([]byte(`{"enabled":false}`), &in); err != nil {
		t.Fatal(err)
	}
	if in.Enabled == nil {
		t.Fatal("enabled:false ถูกอ่านเป็น \"ไม่ได้ระบุ\" — จะกลายเป็นการสลับค่าแทนการปิด")
	}
	if *in.Enabled {
		t.Error("อ่าน enabled:false ได้เป็น true")
	}
}
