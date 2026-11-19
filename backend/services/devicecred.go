package services

import (
	"errors"
	"fmt"
	"network_automation/services/platform"
	"strconv"
	"strings"
	"sync"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// การเลือกว่า "จะล็อกอินเข้าอุปกรณ์ด้วยบัญชีของใคร"
//
// ทั้งระบบเคยใช้บัญชีเดียว (credential ของกลางบน NetworkDevice) ทำให้ log ฝั่ง FortiGate บอกได้แค่
// "admin ทำ" ไฟล์นี้คือจุดเดียวที่ตัดสินใจว่า request หนึ่ง ๆ จะใช้บัญชีส่วนตัวของผู้ใช้ที่กดปุ่ม
// หรือบัญชีของกลาง — ทุก handler ที่คุยกับอุปกรณ์เรียกผ่านที่นี่ ไม่มีใครถอด PasswordEnc เองอีก
//
// ดู entity/device_credential.go สำหรับเหตุผลเชิงโดเมนของตาราง

// DeviceLogin คือบัญชีที่จะใช้ล็อกอินเข้าอุปกรณ์ สำหรับ request หนึ่ง ๆ
type DeviceLogin struct {
	Username string
	Password string

	// CredentialID = แถวใน device_credentials ที่ถูกเลือก (0 = บัญชี automation ของอุปกรณ์เอง)
	CredentialID uint

	// Personal บอกว่านี่คือบัญชีส่วนตัวของผู้ใช้ ไม่ใช่ของกลาง — ใช้ตอน log ฝั่งเราเอง
	Personal bool

	// Legacy marks the credential stored on the network_devices row itself.
	//
	// It matters because NO SCREEN WRITES THAT ROW ANY MORE. The Devices form stopped asking for a
	// firewall login when Profile ▸ Device Credentials replaced it, so a value there is whatever was
	// entered before that change and has never been tested since. On this deployment it is simply
	// wrong: SSH with it fails while the per-user credential for the same device works, which is why
	// no scheduled backup has ever succeeded here.
	//
	// Callers use it to say so. "login ไม่ผ่าน (ตรวจ username/password)" sends an operator to check
	// the device, when what they need to do is nominate an account for scheduled work.
	Legacy bool

	// scope แทนตัวตนของ credential ใบนี้ใน session pool เมื่อ CredentialID บอกไม่ได้
	// (ใบที่ยังไม่ถูกบันทึก — ปุ่ม "ทดสอบ") ว่างไว้ = ให้ PoolScope คำนวณเอง
	scope string
}

// PoolScope คือ "ตัวตน" ที่ session pool ใช้เป็นกุญแจ
//
// ⚠️ ต้องไม่ใช่ชื่อผู้ใช้ credential สองใบใช้ชื่อเดียวกันได้ (บัญชีส่วนตัวของคนหนึ่งมักชื่อ `admin`
// ซึ่งซ้ำกับบัญชี automation ของอุปกรณ์) พอ key ด้วยชื่อ ทั้งสองใบเลยใช้ session และ circuit breaker
// ก้อนเดียวกัน — รหัสผ่านเก่าของใบหนึ่งจึงล็อกทุกคนออกจากอุปกรณ์นั้น รวมถึง sweep แจ้งเตือนเบื้องหลัง
// ที่ไปรายงานว่าอุปกรณ์ที่ยังดีอยู่ "ติดต่อไม่ได้" ดู fortigate_sessionpool.sessionKey
func (l DeviceLogin) PoolScope() string {
	if l.scope != "" {
		return l.scope
	}
	return poolScopeFor(l.CredentialID)
}

// poolScopeFor แปลง id ของ credential เป็น scope ของ pool (0 = บัญชี automation ของอุปกรณ์)
func poolScopeFor(credentialID uint) string {
	if credentialID == 0 {
		return "automation"
	}
	return "cred:" + strconv.FormatUint(uint64(credentialID), 10)
}

// probeLogin คือ login ที่ได้ช่องใน pool เป็นของตัวเอง สำหรับเส้นทาง "ลองรหัสผ่านใบนี้ดู"
//
// ใบที่ยังไม่บันทึกยังไม่มี id การปล่อยให้ scope เป็น "automation" จะทำให้การกดทดสอบไปทับ session
// ของบัญชี automation จริง และรหัสผ่านที่พิมพ์ผิดจะไปเปิด breaker ให้งานเบื้องหลังทั้งหมด
func probeLogin(username, password string) DeviceLogin {
	return DeviceLogin{
		Username: username, Password: password,
		scope: "probe:" + username,
	}
}

// UserIDOf อ่าน id ของผู้ใช้ที่ล็อกอินอยู่ ออกจากค่าที่ middleware.Authorizes เก็บไว้ใน
// gin context ("user_id")
//
// อยู่ที่นี่แทนที่จะ type-assert ซ้ำในทุก controller เพราะการ assert พลาด (เช่นเผลอเทียบกับ int)
// จะไม่ error แต่จะได้ 0 เงียบ ๆ ซึ่งแปลว่า "ไม่มีผู้ใช้" → ตกกลับไปใช้ credential ของกลาง
// นั่นคือความผิดพลาดแบบเงียบที่สุดเท่าที่ฟีเจอร์นี้จะมีได้ จึงมีที่เดียวและมีเทสคุม
func UserIDOf(v any) uint {
	if id, ok := v.(uint); ok {
		return id
	}
	return 0
}

// ResolveDeviceLogin หาบัญชีที่ควรใช้คุยกับ device สำหรับผู้ใช้คอนโซล userID
//
// ลำดับ:
//  1. มีแถว device_credentials ของ (userID, device) → ใช้บัญชีนั้น
//  2. ไม่มี → ใช้ credential ของกลางบน NetworkDevice (พฤติกรรมเดิมทั้งหมด)
//
// userID = 0 (งานเบื้องหลัง: scheduler / worker callback) จะข้ามข้อ 1 ไปเลย งานที่ไม่มี "คน"
// อยู่เบื้องหลังต้องไม่ไปยืมบัญชีของใครมารัน มิฉะนั้น log บนอุปกรณ์จะโกหกหนักกว่าเดิม
//
// ⚠️ แถวส่วนตัวที่ถอดรหัสไม่ได้ = error ไม่ใช่การตกกลับไปใช้ของกลาง
// การเงียบ ๆ ตกกลับไปใช้ `admin` คือการทำลายสิ่งเดียวที่ฟีเจอร์นี้มีไว้รับประกัน — ผู้ใช้จะเชื่อว่า
// ตัวเองกำลังทำงานในนามตัวเอง ทั้งที่อุปกรณ์บันทึกว่าเป็น admin
func ResolveDeviceLogin(db *gorm.DB, userID uint, device *entity.NetworkDevice) (DeviceLogin, error) {
	if device == nil {
		return DeviceLogin{}, fmt.Errorf("no device given")
	}

	if db != nil && userID > 0 {
		var cred entity.DeviceCredential
		err := db.Where("app_user_id = ? AND network_device_id = ?", userID, device.ID).First(&cred).Error
		if err == nil {
			password, decErr := platform.DecryptSecret(cred.PasswordEnc)
			if decErr != nil {
				return DeviceLogin{}, fmt.Errorf(
					"your saved credential for this device could not be decrypted (%v) — open Profile ▸ Device Credentials and enter the password again", decErr)
			}
			return DeviceLogin{
				Username: cred.Username, Password: password,
				CredentialID: cred.ID, Personal: true,
			}, nil
		}
		if err != gorm.ErrRecordNotFound {
			return DeviceLogin{}, fmt.Errorf("could not read your device credentials: %w", err)
		}
	}

	return ResolveAutomationLogin(db, device)
}

// ErrNoDeviceLogin บอกว่า "ไม่มีบัญชีไหนเลยที่จะใช้เข้าอุปกรณ์ตัวนี้"
//
// แยกออกมาเป็น sentinel เพราะเป็นสถานะที่ผู้ใช้แก้เองได้ใน 30 วินาที (ไปผูกบัญชีที่
// Profile ▸ Device Credentials) — ต่างจาก "อุปกรณ์ล่ม" หรือ "รหัสผ่านผิด" โดยสิ้นเชิง และหน้าจอ
// ควรบอกให้ตรงว่าต้องทำอะไร ไม่ใช่ขึ้น "login failed" ลอย ๆ
var ErrNoDeviceLogin = errors.New("no account is set up for this device")

// ResolveAutomationLogin หาบัญชีสำหรับ "งานที่ไม่มีคนกด" — auto backup, compliance, sweep แจ้งเตือน
//
// ลำดับ:
//  1. อุปกรณ์ชี้ไปที่ credential ใบหนึ่ง (AutomationCredentialID) → ใช้ใบนั้น
//     ตั้งจาก Profile ▸ Device Credentials ("ใช้บัญชีนี้กับงานตามเวลา") — เก็บเป็น **ตัวชี้**
//     ไม่ใช่สำเนา เจ้าของเปลี่ยนรหัสผ่านเมื่อไหร่ งานเบื้องหลังตามไปเองทันที
//  2. อุปกรณ์ยังมี username/password ของตัวเองอยู่ → ใช้อันนั้น (ของเดิมก่อนอัปเกรด)
//     ฟอร์ม Devices ไม่ถามสองช่องนี้แล้ว แถวเก่าจึงยังทำงานต่อได้ แต่แถวใหม่จะไม่มี
//  3. ไม่มีอะไรเลย → ErrNoDeviceLogin
//
// การเลือกข้อ 1 คือการยอมรับอย่างตั้งใจว่างานเบื้องหลังจะถูกบันทึกในชื่อของคนคนหนึ่ง — ซึ่งตรงกว่า
// บัญชีกลางที่ไม่ใช่ของใครเลย ตราบใดที่ "ใครเป็นเจ้าของ" มองเห็นได้ในหน้าจอ
func ResolveAutomationLogin(db *gorm.DB, device *entity.NetworkDevice) (DeviceLogin, error) {
	if device == nil {
		return DeviceLogin{}, fmt.Errorf("no device given")
	}

	if db != nil && device.AutomationCredentialID != 0 {
		var cred entity.DeviceCredential
		err := db.First(&cred, device.AutomationCredentialID).Error
		if err == nil && cred.NetworkDeviceID == device.ID {
			password, decErr := platform.DecryptSecret(cred.PasswordEnc)
			if decErr != nil {
				return DeviceLogin{}, fmt.Errorf(
					"the account nominated for scheduled work on %q could not be decrypted (%v) — "+
						"its owner should re-enter it in Profile ▸ Device Credentials", device.Name, decErr)
			}
			return DeviceLogin{
				Username: cred.Username, Password: password,
				CredentialID: cred.ID, Personal: true,
			}, nil
		}
		// The row is gone, or points at another device. Fall through rather than fail: the legacy
		// account below may still work, and a dangling pointer is not a reason to stop backing up.
	}

	if strings.TrimSpace(device.Username) == "" || strings.TrimSpace(device.PasswordEnc) == "" {
		return DeviceLogin{}, fmt.Errorf(
			"%w: nobody has nominated an account for scheduled work on %q — open Profile ▸ Device "+
				"Credentials, add your firewall login for it and tick \"use for scheduled work\"",
			ErrNoDeviceLogin, device.Name)
	}

	password, err := platform.DecryptSecret(device.PasswordEnc)
	if err != nil {
		return DeviceLogin{}, fmt.Errorf("failed to decrypt device credentials: %w", err)
	}
	return DeviceLogin{Username: device.Username, Password: password, Legacy: true}, nil
}

// AutomationLoginIsLegacy reports whether scheduled work on this device would fall back to the
// credential stored on the device row — the one no screen maintains.
//
// Used to turn a worker's "authentication failed" into a message that names the actual cause.
func AutomationLoginIsLegacy(db *gorm.DB, device *entity.NetworkDevice) bool {
	login, err := ResolveAutomationLogin(db, device)
	return err == nil && login.Legacy
}

// ── "ใช้ล่าสุดเมื่อไหร่" ─────────────────────────────────────────────────────

// touchInterval คือความถี่สูงสุดที่ยอมให้เขียน last_used_at ของ credential หนึ่งใบ
//
// การเปิดหน้า Firewall Policy ยิง device-proxy หลาย request พร้อมกัน ถ้าเขียนทุกครั้งจะได้ UPDATE
// หลายครั้งต่อการกดหนึ่งครั้ง เพื่อความละเอียดระดับวินาทีที่ไม่มีใครต้องการ — หน้าจอแสดงผลเป็น
// "เมื่อกี้ / 3 ชั่วโมงที่แล้ว" อยู่แล้ว
const touchInterval = time.Minute

var (
	touchMu   sync.Mutex
	lastTouch = map[uint]time.Time{}
)

// TouchDeviceCredential บันทึกว่า credential ใบนี้เพิ่งถูกใช้ล็อกอินสำเร็จ
//
// เขียนแบบ best-effort และหน่วงตาม touchInterval — พลาดไปหนึ่งครั้งไม่มีผลอะไร ตัวเลขนี้ใช้ตอบว่า
// "ใบนี้ยังใช้อยู่ไหม" ไม่ใช่หลักฐานการเข้าถึง (หลักฐานคือ log บนอุปกรณ์เอง ซึ่งคือทั้งหมดที่
// ฟีเจอร์นี้ทำให้เกิดขึ้น)
func TouchDeviceCredential(db *gorm.DB, credentialID uint) {
	if db == nil || credentialID == 0 {
		return
	}

	now := time.Now()
	touchMu.Lock()
	if prev, ok := lastTouch[credentialID]; ok && now.Sub(prev) < touchInterval {
		touchMu.Unlock()
		return
	}
	lastTouch[credentialID] = now
	touchMu.Unlock()

	db.Model(&entity.DeviceCredential{}).
		Where("id = ?", credentialID).
		Update("last_used_at", now)
}

// ForgetDeviceCredentialTouch ล้างตัวหน่วงของ credential ใบหนึ่ง — เรียกตอนลบแถวทิ้ง เพื่อไม่ให้
// map โตขึ้นเรื่อย ๆ ตามจำนวน credential ที่เคยมีอยู่ในระบบ
func ForgetDeviceCredentialTouch(credentialID uint) {
	touchMu.Lock()
	delete(lastTouch, credentialID)
	touchMu.Unlock()
}

// IsDeviceAuthFailure แยก "รหัสผ่านผิด" ออกจาก "อุปกรณ์ติดต่อไม่ได้"
//
// สองอย่างนี้ต้องปฏิบัติต่างกันตอนบันทึก credential: รหัสผ่านผิดคือของที่ผู้ใช้แก้ได้เดี๋ยวนี้ และถ้า
// ปล่อยให้บันทึกไว้ มันจะถูกเอาไปลองใหม่ทุกครั้งที่เปิดหน้า จนบัญชีบนอุปกรณ์ถูกล็อก
// (admin-lockout-threshold 3) ส่วนอุปกรณ์ล่มไม่ใช่ความผิดของ credential และไม่ควรกันไม่ให้บันทึก
func IsDeviceAuthFailure(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "authentication failed") ||
		strings.Contains(msg, "wrong credentials") ||
		strings.Contains(msg, "http 401") ||
		strings.Contains(msg, "http 403")
}

// VerifyDeviceLogin ลองล็อกอินเข้าอุปกรณ์ด้วยบัญชีที่ให้มา แล้วบอกว่าใช้ได้จริงไหม
//
// ใช้ session pool ตัวเดียวกับ handler อื่น ๆ ด้วยเหตุผลเดียวกับที่ห้ามทุกที่เปิด session เอง:
// อุปกรณ์ล็อกบัญชีหลังล็อกอินพลาด 3 ครั้ง (admin-lockout-threshold) และ pool มี circuit breaker
// ที่หยุดให้ที่ 2 — ปุ่ม "ทดสอบ" ที่กดรัว ๆ ได้จึงต้องเดินผ่านตัวเบรกเดียวกันนั้น
//
// กุญแจของ pool รวมชื่อผู้ใช้ไว้ด้วย (ดู fortigate_sessionpool.go) การทดสอบบัญชีของคนหนึ่งจึงไม่ไปแตะ
// session ที่คนอื่นกำลังใช้อยู่
func VerifyDeviceLogin(deviceID uint, host string, port int, username, password string) error {
	// probeLogin, not the real credential's identity: a password being TESTED must not share a pool
	// slot — or a circuit breaker — with the account that is already working. A typo in the test box
	// would otherwise open the breaker for every background job on that device.
	fc, err := AcquireFortiClient(deviceID, host, port, probeLogin(username, password))
	if err != nil {
		return err
	}
	// ล็อกอินผ่านอย่างเดียวยังไม่พอ: FortiOS ตอบ "1" ให้บัญชีที่ล็อกอินได้แต่ไม่มีสิทธิ์เรียก REST
	// (admin profile ไม่ได้เปิด API access) ซึ่งจะไปพังตอนใช้งานจริงแทน — ยิงอ่านหนึ่งครั้งเพื่อ
	// พิสูจน์ว่าบัญชีนี้ทำงานได้จริงบนเส้นทางที่คอนโซลใช้
	if _, err := fc.GetHostname(); err != nil {
		return err
	}
	return nil
}
