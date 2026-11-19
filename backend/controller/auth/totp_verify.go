package auth

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	middlewares "network_automation/middleware"
	"network_automation/services"
	"network_automation/services/platform"
)

// ── Throttling the second factor ──────────────────────────────────────────────
//
// These two endpoints are the second half of a sign-in, and until 2026-11-13 they were the only
// half nothing counted. /auth/login charges LoginAccountLimiter on a FAILURE and clears it on
// success, which is right for a password but leaves this door open: somebody who already has the
// password gets a clean budget every time, can mint a fresh pending token whenever one expires, and
// may then spray six-digit codes at it. GeneralLimiter allowed 120 a minute per address, and an
// attacker chooses how many addresses to come from.
//
// So the counter lives on the ACCOUNT the pending token names, which no number of source addresses
// can spread out — the same reasoning, and the same Blocked/RecordFailure/Reset shape, as
// LoginAccountLimiter in auth.go. Both endpoints share one budget, because an attacker alternating
// between a TOTP code and a recovery code must not get two.
func twoFactorKey(userID uint) string { return "2fa:" + strconv.FormatUint(uint64(userID), 10) }

// twoFactorThrottled answers a caller who is out of budget, reporting whether it did.
//
// 429 and a plain explanation rather than auth.Login's deliberately indistinguishable "invalid
// email or password": the caller already holds a pending token for this account, so they have
// proved the account exists and the password is right. There is nothing left for the wording to
// disclose, and a real person whose phone clock has drifted deserves to be told why their next four
// attempts will not work either.
func twoFactorThrottled(c *gin.Context, userID uint) bool {
	if !middlewares.TwoFactorAccountLimiter.Blocked(twoFactorKey(userID)) {
		return false
	}
	c.JSON(http.StatusTooManyRequests, gin.H{
		"error": "too many incorrect verification codes — try again in 15 minutes",
	})
	return true
}

// ── Replaying one code ────────────────────────────────────────────────────────
//
// A TOTP code is valid for its 30-second step and the library accepts one step either side, so the
// same six digits work for roughly 90 seconds. RFC 6238 §5.2 is explicit that a verifier must
// accept each one only once; services.ValidateTOTP keeps no record, so a code read over a
// shoulder, left in a screenshot or captured from a phishing page could be presented again by
// somebody else for the rest of its window.
//
// The guard used to live here, as a package-level map of digest → expiry. It is now
// UserTOTP.LastTOTPStep, claimed by services.AcceptTOTPCode, for three reasons the map could not
// give:
//
//   - it survives a restart, so a bounce no longer opens a 90-second replay window;
//   - every backend replica shares one record, where each process kept its own map;
//   - the enrolment-confirm endpoint (controller/totp.SetupVerify) checks codes too and had no
//     guard at all, so a code spent there could be replayed at THIS endpoint. Both now claim out
//     of the same column.
//
// It also records the step rather than the digits, which makes it monotonic: a code from an
// EARLIER step cannot be presented after a later one has been accepted, which the map allowed.

type VerifyTOTPInput struct {
	PendingToken string `json:"pending_token" binding:"required"`
	Code         string `json:"code" binding:"required,len=6"`
}

// POST /auth/verify-totp
func VerifyTOTP(c *gin.Context) {
	var input VerifyTOTPInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	claims, err := platform.ParseTwoFAPendingToken(input.PendingToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session — please log in again"})
		return
	}

	if twoFactorThrottled(c, claims.UserID) {
		return
	}

	db := config.DB()

	var userTOTP entity.UserTOTP
	if err := db.Where("app_user_id = ? AND is_verified = true", claims.UserID).
		First(&userTOTP).Error; err != nil {
		// Not a guess, so it does not spend the account's budget — there is no code that would
		// have worked, and charging it would let anyone with a pending token lock the owner out.
		c.JSON(http.StatusBadRequest, gin.H{"error": "TOTP not configured for this account"})
		return
	}

	// Validates the code and spends its time step in one go. A code that is arithmetically right
	// but already used inside its window is refused, and that counts as a failure: a replay is
	// somebody presenting a code they were not the first to hold. The wording is identical to a
	// wrong code's — "already used" would confirm to whoever captured it that they had the right
	// digits.
	accepted, err := platform.AcceptTOTPCode(db, &userTOTP, input.Code, time.Now())
	if err != nil {
		// The seed could not be decrypted, or the step could not be written. Not a guess, so it
		// does not spend the account's budget — and emphatically not a sign-in: accepting a code
		// whose step was not recorded would hand out a session with no replay protection.
		c.JSON(http.StatusInternalServerError, gin.H{
			"error": "the second factor could not be checked — contact an administrator",
		})
		return
	}
	if !accepted {
		middlewares.TwoFactorAccountLimiter.RecordFailure(twoFactorKey(claims.UserID))
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid code — check your authenticator app"})
		return
	}

	// A correct, unused code clears the record of whatever preceded it — the same rule as a correct
	// password in auth.Login. Somebody who fat-fingers two digits every morning is not an attack.
	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(claims.UserID))

	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	roleName := ""
	if user.AppRole != nil {
		roleName = user.AppRole.Role
	}

	token, err := platform.GenerateJWT(user.ID, user.Email, roleName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	if !issueSessionCookie(c, user.ID, token) {
		return
	}
	go services.LogActivity(db, user.ID, "login")

	c.JSON(http.StatusOK, gin.H{
		"message": "login success",
		"user": gin.H{
			"id":         user.ID,
			"email":      user.Email,
			"first_name": user.FirstName,
			"last_name":  user.LastName,
			"role":       roleName,
		},
	})
}

// POST /auth/verify-backup-code
// Validates a single-use recovery code instead of a TOTP code.
type VerifyBackupCodeInput struct {
	PendingToken string `json:"pending_token" binding:"required"`
	BackupCode   string `json:"backup_code" binding:"required"`
}

func VerifyBackupCode(c *gin.Context) {
	var input VerifyBackupCodeInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	claims, err := platform.ParseTwoFAPendingToken(input.PendingToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session — please log in again"})
		return
	}

	// Same budget as the TOTP endpoint, on purpose: a recovery code is longer than six digits, but
	// an attacker who can alternate between two un-counted endpoints has no limit at all.
	if twoFactorThrottled(c, claims.UserID) {
		return
	}

	db := config.DB()

	// Normalize input: strip hyphens/spaces and uppercase
	normalized := strings.ToUpper(strings.ReplaceAll(strings.ReplaceAll(input.BackupCode, "-", ""), " ", ""))

	var codes []entity.UserBackupCode
	if err := db.Where("app_user_id = ? AND used_at IS NULL", claims.UserID).Find(&codes).Error; err != nil || len(codes) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no backup codes available — please contact admin"})
		return
	}

	var matched *entity.UserBackupCode
	for i := range codes {
		if platform.CheckPasswordHash(normalized, codes[i].CodeHash) {
			matched = &codes[i]
			break
		}
	}

	if matched == nil {
		middlewares.TwoFactorAccountLimiter.RecordFailure(twoFactorKey(claims.UserID))
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid backup code"})
		return
	}

	middlewares.TwoFactorAccountLimiter.Reset(twoFactorKey(claims.UserID))

	// Burn the code — single use only. This is the backup codes' own replay guard: a used row is
	// excluded by the query above, so unlike a TOTP code there is no window in which it works twice.
	now := time.Now()
	db.Model(matched).Update("used_at", &now)

	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	roleName := ""
	if user.AppRole != nil {
		roleName = user.AppRole.Role
	}

	token, err := platform.GenerateJWT(user.ID, user.Email, roleName)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate token"})
		return
	}

	if !issueSessionCookie(c, user.ID, token) {
		return
	}
	go services.LogActivity(db, user.ID, "login_via_backup_code")

	c.JSON(http.StatusOK, gin.H{
		"message": "login success",
		"user": gin.H{
			"id":         user.ID,
			"email":      user.Email,
			"first_name": user.FirstName,
			"last_name":  user.LastName,
			"role":       roleName,
		},
	})
}
