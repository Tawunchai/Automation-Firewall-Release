package unit

import (
	"testing"

	"github.com/asaskevich/govalidator"
	. "github.com/onsi/gomega"

	"network_automation/entity"
)

func TestValidAppUserInput(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}

func TestInvalidAppUserEmailRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("Email is required"))
}

func TestInvalidAppUserEmailFormat(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin-example.com",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("Email is invalid"))
}

func TestInvalidAppUserPasswordRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("Password is required"))
}

func TestInvalidAppUserFirstNameRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "12345678",
		FirstName:   "",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("FirstName is required"))
}

func TestInvalidAppUserLastNameRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("LastName is required"))
}

// Profile is the user's avatar image URL — genuinely optional (the create API never required it,
// and it is uploaded separately, defaulting to empty). It must therefore validate when blank;
// requiring it used to make every user without an avatar impossible to edit.
func TestAppUserProfileIsOptional(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}

func TestInvalidAppUserAppRoleIDRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "admin@got.co.th",
		Password:    "12345678",
		FirstName:   "Tawunchai",
		LastName:    "Burakhon",
		Profile:     "https://example.com/profile.jpg",
		PhoneNumber: "0999999999",
		Location:    "Nakhon Ratchasima",
		Position:    "Administrator",
		AppRoleID:   0,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
	g.Expect(err.Error()).To(Equal("AppRoleID is required"))
}

func TestInvalidAppUserMultipleFieldsRequired(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:       "",
		Password:    "",
		FirstName:   "",
		LastName:    "",
		Profile:     "",
		PhoneNumber: "",
		Location:    "",
		Position:    "",
		AppRoleID:   0,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeFalse())
	g.Expect(err).ToNot(BeNil())
}

// ── ช่องโปรไฟล์เสริม ──────────────────────────────────────────────────────────
//
// เดิมมีเทสสี่ตัวตรงนี้ที่ตรึงว่า PhoneNumber / Location / Position เป็น required
// และรหัสผ่านต้องยาว ≥ 8 ที่ระดับ entity — ทั้งสี่ถูกแทนที่ด้วยสองตัวข้างล่าง เพราะกฎเปลี่ยนไป
// **ในทางที่ตั้งใจ** ไม่ใช่เพราะเทสพัง:
//
//   · ฟอร์มสร้างผู้ใช้ที่ /admin/user เก็บแค่ ชื่อ/นามสกุล/อีเมล/รหัสผ่าน/role
//     การบังคับสามช่องนั้นทำให้กด Create User แล้วได้ 400 ทุกครั้ง — สร้างผู้ใช้ไม่ได้เลย
//   · ความยาวรหัสผ่านย้ายไปเป็นของ Password Policy (/admin/password-policy) เพียงผู้เดียว
//     ถ้า entity ตรึง 8 ไว้ด้วย การตั้ง min_length = 6 จะไม่มีผลจริง

func TestAppUserProfileFieldsAreOptional(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:     "admin@got.co.th",
		Password:  "12345678",
		FirstName: "Tawunchai",
		LastName:  "Burakhon",
		AppRoleID: 1,
		// PhoneNumber / Location / Position เว้นว่างไว้ตั้งใจ — เติมทีหลังที่หน้า Edit
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}

func TestAppUserDoesNotEnforceAPasswordLength(t *testing.T) {
	g := NewGomegaWithT(t)

	user := entity.AppUser{
		Email:     "admin@got.co.th",
		Password:  "abc123", // สั้นกว่า 8 — ต้องผ่านด่านนี้ แล้วให้ Password Policy เป็นคนตัดสิน
		FirstName: "Tawunchai",
		LastName:  "Burakhon",
		AppRoleID: 1,
	}

	ok, err := govalidator.ValidateStruct(user)
	g.Expect(ok).To(BeTrue())
	g.Expect(err).To(BeNil())
}
