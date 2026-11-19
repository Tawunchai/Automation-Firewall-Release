package user

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/asaskevich/govalidator"
	"github.com/gin-gonic/gin/binding"

	"network_automation/entity"
	"network_automation/services"
)

// สร้างผู้ใช้จากหน้า /admin/user
//
// ฟอร์มสร้างผู้ใช้เก็บแค่ 5 ช่อง: ชื่อ, นามสกุล, อีเมล, รหัสผ่าน, role
// แต่ทั้ง gin binding และ govalidator บังคับ phone_number / location / position เป็น required
// ผลคือ **กดปุ่ม Create User แล้วได้ 400 ทุกครั้ง สร้างผู้ใช้จากหน้าเว็บไม่สำเร็จเลยสักคน**
// (ยืนยันกับ backend ตัวจริง: "Key: 'CreateUserInput.PhoneNumber' ... failed on the 'required' tag")
//
// เทสสองชั้นนี้ตรึงทั้งสองด่านไว้ เพราะการปลดล็อกด่านเดียวยังพังอยู่ดี

// bindPayload จำลองสิ่งที่ ShouldBindJSON ทำกับ CreateUserInput
//
// ใช้ `binding.Validator` ของ gin เองไม่ใช่ validator.New() — ตัวหลังอ่าน tag ชื่อ `validate:`
// ส่วน gin ตั้งชื่อ tag เป็น `binding:` เทสที่ใช้ตัวผิดจะผ่านทุกเคสโดยไม่ตรวจอะไรเลย
func bindPayload(t *testing.T, body string) (CreateUserInput, error) {
	t.Helper()
	var in CreateUserInput
	if err := json.Unmarshal([]byte(body), &in); err != nil {
		t.Fatalf("json ไม่ถูกต้อง: %v", err)
	}
	return in, binding.Validator.ValidateStruct(&in)
}

// ── ด่านที่ 1: gin binding ────────────────────────────────────────────────────

func TestCreateUserInput_AcceptsWhatTheFormActuallySends(t *testing.T) {
	// payload นี้คือสิ่งที่ ModalCreateandUpdateUser ส่งจริง — ไม่มีสามช่องนั้น
	body := `{"email":"a@b.co","password":"Passw0rd!","first_name":"ตะวันฉาย","last_name":"บุราคร","profile":"","app_role_id":1}`
	if _, err := bindPayload(t, body); err != nil {
		t.Fatalf("binding ปฏิเสธ payload ของฟอร์มจริง: %v", err)
	}
}

func TestCreateUserInput_StillRequiresTheFieldsTheFormDoesCollect(t *testing.T) {
	cases := map[string]string{
		"ไม่มีอีเมล":     `{"password":"Passw0rd!","first_name":"a","last_name":"b","app_role_id":1}`,
		"อีเมลผิดรูปแบบ": `{"email":"not-an-email","password":"Passw0rd!","first_name":"a","last_name":"b","app_role_id":1}`,
		"ไม่มีรหัสผ่าน":  `{"email":"a@b.co","first_name":"a","last_name":"b","app_role_id":1}`,
		"ไม่มีชื่อ":      `{"email":"a@b.co","password":"Passw0rd!","last_name":"b","app_role_id":1}`,
		"ไม่มี role":     `{"email":"a@b.co","password":"Passw0rd!","first_name":"a","last_name":"b"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := bindPayload(t, body); err == nil {
				t.Error("binding ยอมรับ payload ที่ขาดช่องบังคับ")
			}
		})
	}
}

// ความยาวรหัสผ่านต้องมาจาก Password Policy ไม่ใช่ min=8 ที่ฝังใน binding tag
// ไม่งั้นตั้ง min_length เป็น 6 ที่ /admin/password-policy แล้วไม่มีผลจริง
// และ error ที่ผู้ใช้เห็นจะเป็นข้อความดิบของ validator ที่ไม่ตรงกับกฎบนหน้าจอ
func TestCreateUserInput_DoesNotHardcodeAPasswordLength(t *testing.T) {
	body := `{"email":"a@b.co","password":"abc123","first_name":"a","last_name":"b","app_role_id":1}`
	if _, err := bindPayload(t, body); err != nil {
		t.Errorf("binding บังคับความยาวรหัสผ่านเอง (%v) — ต้องปล่อยให้ policy ตัดสิน", err)
	}
}

// ── ด่านที่ 2: govalidator บน entity.AppUser ─────────────────────────────────

func appUser(over func(*entity.AppUser)) entity.AppUser {
	u := entity.AppUser{
		Email: "a@b.co", Password: "Passw0rd!", FirstName: "ตะวันฉาย", LastName: "บุราคร",
		AppRoleID: 1,
	}
	if over != nil {
		over(&u)
	}
	return u
}

func TestAppUser_ProfileFieldsAreOptional(t *testing.T) {
	// ด่านนี้เคยปฏิเสธผู้ใช้ที่ไม่มีเบอร์/ที่อยู่/ตำแหน่ง แม้ binding จะผ่านมาแล้ว
	if ok, err := govalidator.ValidateStruct(appUser(nil)); !ok {
		t.Fatalf("govalidator ปฏิเสธผู้ใช้ที่ไม่มีข้อมูลโปรไฟล์เสริม: %v", err)
	}
}

func TestAppUser_StillRequiresIdentityFields(t *testing.T) {
	cases := map[string]func(*entity.AppUser){
		"อีเมลว่าง":      func(u *entity.AppUser) { u.Email = "" },
		"อีเมลผิดรูปแบบ": func(u *entity.AppUser) { u.Email = "nope" },
		"รหัสผ่านว่าง":   func(u *entity.AppUser) { u.Password = "" },
		"ชื่อว่าง":       func(u *entity.AppUser) { u.FirstName = "" },
		"นามสกุลว่าง":    func(u *entity.AppUser) { u.LastName = "" },
		"ไม่มี role":     func(u *entity.AppUser) { u.AppRoleID = 0 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			if ok, _ := govalidator.ValidateStruct(appUser(mutate)); ok {
				t.Error("govalidator ยอมรับผู้ใช้ที่ขาดข้อมูลระบุตัวตน")
			}
		})
	}
}

// entity ต้องไม่ตรึงความยาวรหัสผ่านไว้เอง — ไม่งั้น policy ที่ตั้ง min_length < 8
// จะถูกด่านนี้ปฏิเสธก่อนถึง ValidatePasswordPolicy เสมอ
func TestAppUser_DoesNotHardcodeAPasswordLength(t *testing.T) {
	if ok, err := govalidator.ValidateStruct(appUser(func(u *entity.AppUser) { u.Password = "abc123" })); !ok {
		t.Errorf("entity บังคับความยาวรหัสผ่านเอง (%v) — Password Policy ต้องเป็นเจ้าของกฎคนเดียว", err)
	}
}

// ── กฎที่ CreateUser ต้องใช้ตัดสินรหัสผ่าน ────────────────────────────────────
//
// CreateUser ของเดิม **ไม่เคยเรียก ValidatePasswordPolicy เลย** ทั้งที่ UpdateUserByID และ
// UpdateUserIDByAdmin เรียกกันครบ ตั้ง policy ให้ต้องมีตัวพิมพ์ใหญ่แล้วสร้างบัญชีใหม่
// ด้วยรหัส "aaaaaaaa" ได้สบาย

func TestPasswordPolicy_IsTheOnlyGateOnANewPassword(t *testing.T) {
	strict := services.PasswordPolicy{
		MinLength: 10, RequireUppercase: true, RequireNumber: true, RequireSpecial: true,
	}
	if err := services.ValidatePasswordPolicy("aaaaaaaa", strict); err == nil {
		t.Error("policy เข้มแต่รับรหัสอ่อน")
	}
	if err := services.ValidatePasswordPolicy("Passw0rd!!", strict); err != nil {
		t.Errorf("policy ปฏิเสธรหัสที่ผ่านครบทุกข้อ: %v", err)
	}

	// policy หลวมกว่า 8 ต้องใช้ได้จริง — นี่คือกรณีที่ min=8 ที่ฝังไว้เคยบัง
	loose := services.PasswordPolicy{MinLength: 6}
	if err := services.ValidatePasswordPolicy("abc123", loose); err != nil {
		t.Errorf("policy ตั้ง min_length=6 แต่ยังถูกปฏิเสธ: %v", err)
	}
}

// ข้อความ error ต้องบอกกฎที่ตั้งไว้จริง ไม่ใช่ตัวเลขตายตัว
func TestPasswordPolicy_ErrorQuotesTheConfiguredLength(t *testing.T) {
	err := services.ValidatePasswordPolicy("abc", services.PasswordPolicy{MinLength: 12})
	if err == nil || !strings.Contains(err.Error(), "12") {
		t.Errorf("ValidatePasswordPolicy error = %v, ต้องอ้างถึง min_length ที่ตั้งไว้ (12)", err)
	}
}
