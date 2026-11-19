// Package devicecredential lets a person map their OWN firewall account to a device.
//
// Every route here is scoped to the CALLING user and nobody else — there is no admin view, no
// user_id parameter and no way to name someone else's row. That is not a simplification: a
// credential belongs to one person, and an endpoint that could read or rewrite another person's
// would turn the audit trail this feature creates into a way to act as them. The scoping is done in
// the WHERE clause of every query rather than by checking ownership after loading, so a row that is
// not the caller's is indistinguishable from one that does not exist (404).
//
// The password is never returned. Not on create, not on list, not on read-back — the only things
// that ever leave this package are the username, the device it maps to, and when it last worked.
package devicecredential

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"

	"network_automation/config"
	"network_automation/entity"
	middlewares "network_automation/middleware"
	"network_automation/services"
	"network_automation/services/platform"
)

// credentialView is the shape sent to the browser. Note what is absent.
type credentialView struct {
	ID              uint   `json:"id"`
	NetworkDeviceID uint   `json:"network_device_id"`
	DeviceName      string `json:"device_name"`
	DeviceIP        string `json:"device_ip"`
	DeviceVendor    string `json:"device_vendor"`
	Username        string `json:"username"`

	LastUsedAt     *time.Time `json:"last_used_at"`
	LastTestedAt   *time.Time `json:"last_tested_at"`
	LastTestStatus string     `json:"last_test_status"`
	LastTestError  string     `json:"last_test_error"`

	// UsedForAutomation says this is the account the device runs unattended work with — scheduled
	// backups, compliance checks and the alert sweep. One per device, nominated by its owner.
	UsedForAutomation bool `json:"used_for_automation"`
	// AutomationTakenBy names the person whose credential currently holds that job, when it is not
	// this one. Without it, a toggle that refuses to turn on has no explanation.
	AutomationTakenBy string `json:"automation_taken_by,omitempty"`

	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

func toView(c entity.DeviceCredential, d entity.NetworkDevice) credentialView {
	v := credentialView{
		ID:              c.ID,
		NetworkDeviceID: c.NetworkDeviceID,
		DeviceName:      d.Name,
		DeviceIP:        d.MgmtIP,
		DeviceVendor:    d.Vendor,
		Username:        c.Username,
		LastUsedAt:      c.LastUsedAt,
		LastTestedAt:    c.LastTestedAt,
		LastTestStatus:  c.LastTestStatus,
		LastTestError:   c.LastTestError,
		CreatedAt:       c.CreatedAt,
		UpdatedAt:       c.UpdatedAt,
	}
	v.UsedForAutomation = d.AutomationCredentialID != 0 && d.AutomationCredentialID == c.ID
	if d.AutomationCredentialID != 0 && !v.UsedForAutomation {
		v.AutomationTakenBy = automationOwnerName(d.AutomationCredentialID)
	}
	return v
}

// automationOwnerName is the display name of whoever owns a device's automation credential.
//
// Best-effort and display-only: a blank result just means the row has gone, and the toggle then
// reads as free rather than as blocked by a ghost.
func automationOwnerName(credentialID uint) string {
	db := config.DB()
	if db == nil {
		// "Best-effort" has to include this. Without the guard the function panics on a nil handle
		// — and it is called from toView, which builds a RESPONSE, so the failure would surface as
		// a 500 on a page that was only trying to show a name. Returning blank is exactly the
		// degraded answer the doc comment above promises.
		return ""
	}
	var cred entity.DeviceCredential
	if db.First(&cred, credentialID).Error != nil {
		return ""
	}
	var u entity.AppUser
	if db.First(&u, cred.AppUserID).Error != nil {
		return ""
	}
	if name := strings.TrimSpace(u.FirstName + " " + u.LastName); name != "" {
		return name
	}
	return u.Email
}

// callerID returns the signed-in user's id, or 0 with a 401 already written.
func callerID(c *gin.Context) (uint, bool) {
	v, _ := c.Get("user_id")
	id := services.UserIDOf(v)
	if id == 0 {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not signed in"})
		return 0, false
	}
	return id, true
}

// ── List ──────────────────────────────────────────────────────────────────────

// GET /me/device-credentials
func List(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	db := config.DB()

	var creds []entity.DeviceCredential
	if err := db.Where("app_user_id = ?", uid).Order("created_at DESC").Find(&creds).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read your device credentials"})
		return
	}

	// One query for the devices rather than a Preload per row — the list is short, and a join whose
	// only job is to label rows should not become N+1 as the inventory grows.
	devices := map[uint]entity.NetworkDevice{}
	if len(creds) > 0 {
		ids := make([]uint, 0, len(creds))
		for _, cr := range creds {
			ids = append(ids, cr.NetworkDeviceID)
		}
		var rows []entity.NetworkDevice
		db.Where("id IN ?", ids).Find(&rows)
		for _, d := range rows {
			devices[d.ID] = d
		}
	}

	out := make([]credentialView, 0, len(creds))
	for _, cr := range creds {
		out = append(out, toView(cr, devices[cr.NetworkDeviceID]))
	}
	c.JSON(http.StatusOK, out)
}

// ── The live-login budget ─────────────────────────────────────────────────────
//
// Create, Update and Test each log into the firewall FOR REAL through verify(). FortiOS locks an
// admin account after three consecutive failed logins (admin-lockout-threshold 3), so three wrong
// passwords saved in a row cost somebody that account on the device — their own, or the shared one
// every scheduled job uses — and nothing counted the attempts, so a script could do it deliberately.
//
// DiagLimiter (attached to these three routes in routes.go) is not this protection: it counts
// ATTEMPTS per SESSION, 10 a minute, and knows nothing about which firewall they were aimed at. Ten
// correct saves across ten devices trip it, while the two wrong passwords at ONE device that
// actually lock an account do not come close. So the budget that matters is keyed on
// (person, firewall) and counts only FAILURES.
//
// 2, not 5: the thing being protected locks at 3, so a budget of 3 or more would permit exactly
// what it exists to prevent. Two leaves FortiOS one attempt of headroom — the automation account
// and the console's own pooled sessions keep using that device — and still gives an honest typist a
// second go. 15 minutes matches the other failure-counting limiters (LoginAccountLimiter,
// TwoFactorAccountLimiter) and comfortably outlasts the device's own lockout-duration.
//
// Failures only, cleared on success: somebody who fat-fingers a password once and then saves it
// correctly carries nothing forward.
var deviceLoginLimiter = middlewares.NewRateLimiter(2, 15*time.Minute)

// loginBudgetKey counts against the pair (person, firewall) rather than the source address: an
// attacker chooses how many addresses to come from, but not whose account they are spending a
// particular firewall's three failures with.
func loginBudgetKey(uid, deviceID uint) string {
	return "devcred:" + strconv.FormatUint(uint64(uid), 10) + ":" + strconv.FormatUint(uint64(deviceID), 10)
}

// loginThrottled answers a caller who is out of budget, reporting whether it did.
//
// Checked BEFORE verify(), so a refusal here costs the firewall nothing at all — which is the whole
// point: the request that must not happen is the login, not the HTTP call. 429 with a sentence that
// explains itself, like twoFactorThrottled: the caller is signed in and holds a grant for this
// device, so there is nothing left for vague wording to protect, and somebody who has just mistyped
// a password twice is owed the reason their next attempt is refused.
func loginThrottled(c *gin.Context, uid, deviceID uint) bool {
	if !deviceLoginLimiter.Blocked(loginBudgetKey(uid, deviceID)) {
		return false
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"error": "this firewall has already rejected this account twice — wait 15 minutes before " +
			"trying again, or one more failed login will lock the account out on the device",
	})
	return true
}

// recordVerifyOutcome charges or clears the budget according to what the firewall just said.
//
// Only a REJECTION counts. A device that never answered says nothing about the password and never
// touched FortiOS's own failure counter, so refusing to let somebody retry while their firewall is
// down would punish precisely the case verify() deliberately allows to be saved.
func recordVerifyOutcome(uid, deviceID uint, status string, rejected bool) {
	key := loginBudgetKey(uid, deviceID)
	switch {
	case rejected:
		deviceLoginLimiter.RecordFailure(key)
	case status == testStatusOK:
		deviceLoginLimiter.Reset(key)
	}
}

// ── Create ────────────────────────────────────────────────────────────────────

type upsertInput struct {
	NetworkDeviceID uint   `json:"network_device_id"`
	Username        string `json:"username"`
	Password        string `json:"password"`
	// UseForAutomation nominates this account for the device's unattended work. nil = leave as is.
	UseForAutomation *bool `json:"use_for_automation"`
}

// POST /me/device-credentials
func Create(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}

	var in upsertInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	if in.NetworkDeviceID == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "choose a device"})
		return
	}
	if in.Username == "" || in.Password == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "device username and password are both required"})
		return
	}

	db := config.DB()
	var device entity.NetworkDevice
	if err := db.First(&device, in.NetworkDeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	// A credential for a device this person cannot reach is not merely useless — saving it would
	// have this server log into the firewall with their account to run the verification below, on a
	// device an admin has not granted them. 404 for the same reason as everywhere else: which
	// firewalls exist is not public.
	if !services.UserCanAccessDevice(db, uid, c.GetString("user_role") == "admin", device.ID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	var existing entity.DeviceCredential
	err := db.Where("app_user_id = ? AND network_device_id = ?", uid, in.NetworkDeviceID).First(&existing).Error
	if err == nil {
		c.JSON(http.StatusConflict, gin.H{
			"error": "you already have a credential for this device — edit that one instead",
		})
		return
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read your device credentials"})
		return
	}

	// Prove the account works BEFORE storing it. See verify() for why a wrong password is refused
	// while an unreachable device is not — and the budget above for why there is a limit on how many
	// times this may be asked of one firewall.
	if loginThrottled(c, uid, device.ID) {
		return
	}
	status, testErr, reject := verify(&device, in.Username, in.Password)
	recordVerifyOutcome(uid, device.ID, status, reject)
	if reject {
		c.JSON(http.StatusBadRequest, gin.H{"error": testErr})
		return
	}

	enc, encErr := platform.EncryptSecret(in.Password)
	if encErr != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not encrypt the password"})
		return
	}

	now := time.Now()
	cred := entity.DeviceCredential{
		AppUserID:       uid,
		NetworkDeviceID: in.NetworkDeviceID,
		Username:        in.Username,
		PasswordEnc:     enc,
		LastTestedAt:    &now,
		LastTestStatus:  status,
		LastTestError:   testErr,
	}
	if err := db.Create(&cred).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the credential"})
		return
	}

	if err := applyAutomationChoice(db, &device, cred, in.UseForAutomation); err != nil {
		// The credential itself saved, so this is not a failure of the request — say what did not
		// happen rather than implying nothing was stored.
		c.JSON(http.StatusCreated, gin.H{
			"data": toView(cred, device), "warning": err.Error(),
		})
		return
	}

	c.JSON(http.StatusCreated, toView(cred, device))
}

// ── Update ────────────────────────────────────────────────────────────────────

// PUT /me/device-credentials/:id
//
// The device is fixed at creation — changing which firewall a credential points at is a different
// mapping, not an edit of this one, and allowing it here would let a row silently move out from
// under the pooled session opened with it.
func Update(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	var in upsertInput
	if err := c.ShouldBindJSON(&in); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	in.Username = strings.TrimSpace(in.Username)

	db := config.DB()
	cred, device, found := load(c, db, uid, id)
	if !found {
		return
	}

	username := in.Username
	if username == "" {
		username = cred.Username
	}
	// An empty password means "leave it alone" — the browser never had the old one to send back, so
	// requiring it would make renaming the account impossible without retyping the secret.
	password := in.Password
	rotating := password != ""
	if !rotating {
		plain, err := platform.DecryptSecret(cred.PasswordEnc)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "the stored password could not be read back — enter it again",
			})
			return
		}
		password = plain
	}

	if loginThrottled(c, uid, device.ID) {
		return
	}
	status, testErr, reject := verify(&device, username, password)
	recordVerifyOutcome(uid, device.ID, status, reject)
	if reject {
		c.JSON(http.StatusBadRequest, gin.H{"error": testErr})
		return
	}

	now := time.Now()
	updates := map[string]any{
		"username":         username,
		"last_tested_at":   &now,
		"last_test_status": status,
		"last_test_error":  testErr,
	}
	if rotating {
		enc, encErr := platform.EncryptSecret(password)
		if encErr != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "could not encrypt the password"})
			return
		}
		updates["password_enc"] = enc
	}

	if err := db.Model(&entity.DeviceCredential{}).Where("id = ?", cred.ID).Updates(updates).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not save the credential"})
		return
	}

	// The pool caches a logged-in session per stored credential. After a rename or a password
	// change the cached one was opened with the OLD details, so it has to go — otherwise the
	// firewall would keep recording the previous name for up to the session TTL. One call now,
	// because the pool is keyed on this row's id rather than on whatever it is currently called.
	services.InvalidateDeviceSession(device.ID, device.MgmtIP, device.APIPort, cred.ID)

	cred.Username = username
	cred.LastTestedAt, cred.LastTestStatus, cred.LastTestError = &now, status, testErr

	if err := applyAutomationChoice(db, &device, cred, in.UseForAutomation); err != nil {
		c.JSON(http.StatusOK, gin.H{"data": toView(cred, device), "warning": err.Error()})
		return
	}
	c.JSON(http.StatusOK, toView(cred, device))
}

// ── Test ──────────────────────────────────────────────────────────────────────

// POST /me/device-credentials/:id/test
//
// The same check the save path runs, on demand. It exists because a credential rots silently: the
// account is renamed or expires on the firewall months later, and the first sign of it is a page
// that will not load.
func Test(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	cred, device, found := load(c, db, uid, id)
	if !found {
		return
	}

	password, err := platform.DecryptSecret(cred.PasswordEnc)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "the stored password could not be read back — enter it again"})
		return
	}

	// The button a user can hold down, so it needs the budget most of all.
	if loginThrottled(c, uid, device.ID) {
		return
	}
	status, testErr, reject := verify(&device, cred.Username, password)
	recordVerifyOutcome(uid, device.ID, status, reject)
	now := time.Now()
	db.Model(&entity.DeviceCredential{}).Where("id = ?", cred.ID).Updates(map[string]any{
		"last_tested_at":   &now,
		"last_test_status": status,
		"last_test_error":  testErr,
	})

	c.JSON(http.StatusOK, gin.H{
		"ok":     status == testStatusOK,
		"status": status,
		"error":  testErr,
	})
}

// ── Delete ────────────────────────────────────────────────────────────────────

// DELETE /me/device-credentials/:id
func Delete(c *gin.Context) {
	uid, ok := callerID(c)
	if !ok {
		return
	}
	id, ok := pathID(c)
	if !ok {
		return
	}

	db := config.DB()
	cred, device, found := load(c, db, uid, id)
	if !found {
		return
	}

	// ⚠️ HARD delete, deliberately.
	//
	// The unique index is on (app_user_id, network_device_id) and does NOT include deleted_at, so a
	// soft-deleted row keeps the pair reserved: the user would remove their credential and then be
	// unable to add one for that device again, with a 23505 the UI cannot explain. There is also
	// nothing here worth keeping — a row whose only content is a username and a ciphertext nobody
	// will decrypt again.
	if err := db.Unscoped().Delete(&entity.DeviceCredential{}, cred.ID).Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not remove the credential"})
		return
	}

	// Drop the session opened with it, or the firewall would go on recording this person's name for
	// requests that have already fallen back to the shared account.
	// If this row was the device's automation account, the device now has none — clear the pointer
	// rather than leaving it dangling. Scheduled work then reports "nobody has nominated an account"
	// instead of failing with a row that no longer exists.
	if device.AutomationCredentialID == cred.ID {
		db.Model(&entity.NetworkDevice{}).Where("id = ?", device.ID).
			Update("automation_credential_id", 0)
	}

	services.InvalidateDeviceSession(device.ID, device.MgmtIP, device.APIPort, cred.ID)
	services.ForgetDeviceCredentialTouch(cred.ID)

	c.JSON(http.StatusOK, gin.H{"message": "credential removed"})
}

// ── helpers ───────────────────────────────────────────────────────────────────

const (
	testStatusOK   = "ok"
	testStatusFail = "fail"
)

func pathID(c *gin.Context) (uint, bool) {
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid credential id"})
		return 0, false
	}
	return uint(id), true
}

// load fetches one of the CALLER's credentials plus its device.
//
// The app_user_id predicate is what makes another person's row a 404 rather than a 403: a 403 would
// confirm the row exists, and there is no reason to tell anyone which devices someone else has
// mapped.
func load(c *gin.Context, db *gorm.DB, uid, id uint) (entity.DeviceCredential, entity.NetworkDevice, bool) {
	var cred entity.DeviceCredential
	if err := db.Where("id = ? AND app_user_id = ?", id, uid).First(&cred).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "credential not found"})
		return cred, entity.NetworkDevice{}, false
	}
	var device entity.NetworkDevice
	if err := db.First(&device, cred.NetworkDeviceID).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the device this credential points at no longer exists"})
		return cred, device, false
	}
	return cred, device, true
}

// verify logs into the firewall with the given account and reports what happened.
//
// Returns (status, message, reject). `reject` is the interesting one:
//
//   - Wrong password → reject. Storing it would mean every page this person opens retries it, and
//     FortiOS locks an admin account after three consecutive failures — so an unusable credential
//     saved "for now" costs them the account, not just an error message.
//   - Device unreachable / timed out → NOT rejected. That says nothing about the credential, and
//     refusing to save while a firewall is down would be the wrong lesson to draw from it. The row
//     is saved carrying the failure, and the UI shows it as untested-and-failing.
func verify(device *entity.NetworkDevice, username, password string) (status, message string, reject bool) {
	err := services.VerifyDeviceLogin(device.ID, device.MgmtIP, device.APIPort, username, password)
	if err == nil {
		return testStatusOK, "", false
	}
	if services.IsDeviceAuthFailure(err) {
		return testStatusFail, "the firewall rejected this account: " + err.Error(), true
	}
	return testStatusFail, platform.TruncateUTF8(err.Error(), 500), false
}

// ── nominating an account for unattended work ────────────────────────────────

// applyAutomationChoice points the device at this credential, or releases it.
//
// One account per device, deliberately: "which account do the scheduled backups run as" has exactly
// one answer, and a list of candidates would only move the question. Taking the job from somebody
// else is allowed — the two people involved can see who holds it — but it is a real decision, so it
// is reported rather than done silently.
//
// The device stores a POINTER, never a copy of the password. That is what makes a password change by
// the owner take effect for the scheduler immediately, with no second copy to go stale.
func applyAutomationChoice(db *gorm.DB, device *entity.NetworkDevice, cred entity.DeviceCredential, want *bool) error {
	if want == nil {
		return nil // the caller did not express an opinion
	}

	if !*want {
		if device.AutomationCredentialID != cred.ID {
			return nil // it was not this one's job to give up
		}
		if err := db.Model(&entity.NetworkDevice{}).Where("id = ?", device.ID).
			Update("automation_credential_id", 0).Error; err != nil {
			return errors.New("could not release this device's scheduled work")
		}
		device.AutomationCredentialID = 0
		return nil
	}

	if cred.LastTestStatus == testStatusFail {
		return errors.New(
			"this account did not pass its last test, so it was not nominated for scheduled work — " +
				"fix it first, or unattended jobs would fail every time they ran")
	}

	if err := db.Model(&entity.NetworkDevice{}).Where("id = ?", device.ID).
		Update("automation_credential_id", cred.ID).Error; err != nil {
		return errors.New("could not nominate this account for scheduled work")
	}
	device.AutomationCredentialID = cred.ID

	// The scheduler's pooled session was opened with whatever account held the job before. Drop it
	// so the very next backup logs in as the new one instead of inheriting the old session.
	services.InvalidateDeviceSession(device.ID, device.MgmtIP, device.APIPort, 0)
	return nil
}
