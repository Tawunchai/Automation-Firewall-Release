package auth

import (
	"context"
	"crypto/sha256"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"network_automation/config"
	"network_automation/entity"
	middlewares "network_automation/middleware"
	"network_automation/services"
	"network_automation/services/platform"
)

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum)
}

// createSession records the issued token so it can later be revoked.
//
// It runs SYNCHRONOUSLY and its error is fatal to the login. Authorizes() now rejects a token with
// no session row — that is what makes revocation actually revoke — so handing back a cookie whose
// row is still being written in a goroutine would race the client's very next request. A login
// that cannot be recorded is a login that cannot be revoked, so it is refused instead.
func createSession(userID uint, token, ip, userAgent string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	session := entity.UserSession{
		AppUserID: userID,
		TokenHash: hashToken(token),
		IPAddress: ip,
		UserAgent: userAgent,
		LastSeen:  time.Now(),
		IsRevoked: false,
	}
	// Upsert on token_hash, which carries a unique index. GenerateJWT now mints a random jti so
	// two tokens are never identical, but if one ever were, the row for that exact token IS this
	// session — so refresh it (and clear a stale revoked flag) rather than failing the login.
	err := config.DB().WithContext(ctx).Clauses(clause.OnConflict{
		Columns: []clause.Column{{Name: "token_hash"}},
		DoUpdates: clause.Assignments(map[string]interface{}{
			"app_user_id": userID,
			"ip_address":  ip,
			"user_agent":  userAgent,
			"last_seen":   time.Now(),
			"is_revoked":  false,
		}),
	}).Create(&session).Error
	if err != nil {
		log.Printf("[ERROR] createSession failed for user %d: %v", userID, err)
		return err
	}
	return nil
}

// issueSessionCookie sets the auth cookie only once the session row exists. Returns false when the
// caller has already written an error response.
func issueSessionCookie(c *gin.Context, userID uint, token string) bool {
	if err := createSession(userID, token, c.ClientIP(), c.GetHeader("User-Agent")); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start session"})
		return false
	}
	setAuthCookie(c, token)
	return true
}

// revokeSession marks one token's session row revoked, so Authorizes rejects it from the next
// request onward.
//
// It returns its error and its caller waits for it. It used to be started with `go` and its result
// dropped: Logout cleared the cookie, answered 200 and left the write in flight, so a failed
// update — or a shutdown a moment later — left a token that "logged out" working for the rest of
// its 24 hours. A browser is not the only thing that can hold that cookie, which is the whole
// reason the session table exists.
//
// createSession above was made synchronous for exactly this reason; this is the other half of it.
func revokeSession(token string) error {
	db := config.DB()
	h := hashToken(token)
	return db.Model(&entity.UserSession{}).
		Where("token_hash = ?", h).
		Update("is_revoked", true).Error
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

func isHTTPS(c *gin.Context) bool {
	if c.Request.TLS != nil {
		return true
	}
	if strings.EqualFold(c.GetHeader("X-Forwarded-Proto"), "https") {
		return true
	}
	return strings.HasPrefix(c.GetHeader("Origin"), "https://")
}

// cookieSameSite is Lax, always.
//
// It used to return None over HTTPS, and None is the one value that says "send this cookie on
// requests started by other sites" — which is the precondition for CSRF. Nothing here needed it:
//
//	· In the docker deployment nginx proxies /api, so the console and the API are one ORIGIN.
//	· In development the console is localhost:5173 and the API localhost:9000. Different ports are
//	  a different origin but the SAME SITE, and SameSite is a site rule — Lax sends the cookie.
//	· CORS_ALLOWED_ORIGINS names only that dev origin, so no cross-site caller is configured.
//
// What was holding CSRF off in the meantime was the CORS allow list, which is not a CSRF defence:
// it stops a page READING the response, and stops a preflighted request outright, but a request
// that needs no preflight is sent and acted on regardless. Every handler here binds JSON, which
// does trigger a preflight — so the hole was one form-encoded endpoint away from being real,
// rather than exploitable today. Lax closes it at the source instead of relying on that.
//
// Lax rather than Strict so that arriving from a link or a bookmark still lands signed in; the
// difference between them is top-level GET navigation, which changes nothing on this console.
//
// If this ever has to serve a console on a genuinely different site from its API — a tunnel that
// exposes them under two names, say — None plus a real CSRF token is the answer, not None alone.
func cookieSameSite(_ bool) http.SameSite {
	return http.SameSiteLaxMode
}

func setAuthCookie(c *gin.Context, token string) {
	secure := isHTTPS(c)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "auth_token",
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: cookieSameSite(secure),
		MaxAge:   86400,
	})
}

func clearAuthCookie(c *gin.Context) {
	secure := isHTTPS(c)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "auth_token",
		Value:    "",
		Path:     "/",
		HttpOnly: true,
		Secure:   secure,
		SameSite: cookieSameSite(secure),
		MaxAge:   -1,
		Expires:  time.Unix(0, 0),
	})
}

// ── Auth handlers ─────────────────────────────────────────────────────────────

type LoginInput struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

func Login(c *gin.Context) {
	var input LoginInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	db := config.DB()

	// Throttle per ACCOUNT, not only per address.
	//
	// LoginLimiter on the route counts attempts from one IP, which an attacker spreads across as
	// many addresses as they like while everyone in one office shares a single budget. This follows
	// the account being guessed at instead, so the protection cannot be diluted — and because it
	// counts only failures and is cleared on success, somebody who signs in correctly all day never
	// meets it.
	//
	// The same answer for a throttled account as for a wrong password, deliberately: "this account
	// is temporarily locked" would confirm the address exists.
	accountKey := "acct:" + strings.ToLower(strings.TrimSpace(input.Email))
	if middlewares.LoginAccountLimiter.Blocked(accountKey) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	var user entity.AppUser
	if err := db.Preload("AppRole").
		Where("LOWER(email) = LOWER(?)", input.Email).
		First(&user).Error; err != nil {
		middlewares.LoginAccountLimiter.RecordFailure(accountKey)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	if !platform.CheckPasswordHash(input.Password, user.Password) {
		middlewares.LoginAccountLimiter.RecordFailure(accountKey)
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid email or password"})
		return
	}

	// The password was right. Whatever typos preceded it are not evidence of an attack.
	middlewares.LoginAccountLimiter.Reset(accountKey)

	roleName := ""
	if user.AppRole != nil {
		roleName = user.AppRole.Role
	}

	// ── Maintenance mode gate (after credential check so admin can pass) ─────
	//
	// Deliberately here and not in a middleware: the answer depends on the role, and the role is
	// only known once the password has been checked. An admin must be able to sign in during
	// maintenance — they are the one who turns it off. See middleware/authorization.go.
	//
	// Read through services.MaintenanceStatus, the same short-lived cache middleware.Authorizes
	// uses, rather than querying system_configs directly. Two readers of one flag going to
	// different places is how they end up disagreeing.
	if roleName != "admin" {
		if state, err := services.MaintenanceStatus(db); err == nil && state.Enabled {
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "system is under maintenance"})
			return
		}
	}

	// ── 1. TOTP check (highest priority) ────────────────────────────────────
	var totpCfg entity.SystemConfig
	totpEnabled := false
	if db.Where("key = ?", "totp_global_enabled").First(&totpCfg).Error == nil {
		totpEnabled = totpCfg.Value == "true"
	}

	if totpEnabled {
		var userTOTP entity.UserTOTP
		if db.Where("app_user_id = ? AND is_verified = true AND is_enabled = true", user.ID).First(&userTOTP).Error == nil {
			pendingToken, err := platform.GenerateTwoFAPendingToken(user.ID, user.Email)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initiate TOTP"})
				return
			}
			c.JSON(http.StatusOK, gin.H{
				"requires_totp": true,
				"pending_token": pendingToken,
			})
			return
		}
	}

	// ── 2. Email OTP 2FA check (fallback when no TOTP) ────────────────────
	// ถามผ่าน gate ไม่ใช่อ่าน se.TwoFactorEnabled ตรง ๆ — สวิตช์ใหญ่ "Two-Step Verification"
	// ที่หน้า /admin/service ต้องปิด flow นี้ได้จริง ไม่ใช่แค่เทา checkbox บนหน้าจอ
	if platform.LoadOTPGate(db).LoginOTPActive() {
		code, err := platform.SaveOTP(db, user.Email)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to generate OTP"})
			return
		}
		go platform.SendOTPEmail(db, platform.OTPEmailParams{
			ToEmail:      user.Email,
			TemplateType: "otp_2fa",
			OTPCode:      code,
			Username:     user.FirstName,
		})
		pendingToken, err := platform.GenerateTwoFAPendingToken(user.ID, user.Email)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to initiate 2FA"})
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"requires_2fa":  true,
			"pending_token": pendingToken,
			"masked_email":  maskEmail(user.Email),
		})
		return
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

func maskEmail(email string) string {
	at := strings.Index(email, "@")
	if at <= 1 {
		return email
	}
	return string(email[0]) + "***" + email[at:]
}

// ── Verify 2FA ────────────────────────────────────────────────────────────────

type Verify2FAInput struct {
	PendingToken string `json:"pending_token" binding:"required"`
	OTP          string `json:"otp" binding:"required,len=6"`
}

func Verify2FA(c *gin.Context) {
	var input Verify2FAInput
	if err := c.ShouldBindJSON(&input); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request"})
		return
	}

	claims, err := platform.ParseTwoFAPendingToken(input.PendingToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid or expired session"})
		return
	}

	db := config.DB()

	var otpRecord entity.OTP
	if err := db.Where("email = ? AND code = ?", claims.Email, input.OTP).First(&otpRecord).Error; err != nil {
		db.Model(&entity.OTP{}).Where("email = ? AND verified = false", claims.Email).
			UpdateColumn("attempts", gorm.Expr("attempts + 1"))
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid OTP code"})
		return
	}
	if otpRecord.Verified {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OTP already used"})
		return
	}
	if time.Now().Unix() > otpRecord.ExpiresAt {
		c.JSON(http.StatusBadRequest, gin.H{"error": "OTP expired"})
		return
	}
	if otpRecord.Attempts >= platform.OTPMaxAttempts {
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many attempts, please login again"})
		return
	}

	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, claims.UserID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	tx := db.Begin()
	otpRecord.Verified = true
	if err := tx.Save(&otpRecord).Error; err != nil {
		tx.Rollback()
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to verify OTP"})
		return
	}
	if err := tx.Commit().Error; err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit"})
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

func Me(c *gin.Context) {
	userIDValue, exists := c.Get("user_id")
	if !exists {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}

	userID, ok := userIDValue.(uint)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid user id in context"})
		return
	}

	db := config.DB()

	var user entity.AppUser
	if err := db.Preload("AppRole").First(&user, userID).Error; err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user not found"})
		return
	}

	resp := services.MapUserResponse(user)

	policy := services.GetPasswordPolicy(db)
	if policy.ExpiryDays > 0 && user.PasswordChangedAt != nil && user.AuthProvider == "local" {
		daysSince := int(time.Since(*user.PasswordChangedAt).Hours() / 24)
		resp.PasswordExpired = daysSince >= policy.ExpiryDays
	}

	c.JSON(http.StatusOK, resp)
}

func Logout(c *gin.Context) {
	if tokenStr, err := c.Cookie("auth_token"); err == nil && tokenStr != "" {
		if claims, err := platform.ParseJWT(tokenStr); err == nil {
			// The activity log entry stays fire-and-forget: losing one line of history is a
			// cosmetic loss, and it must never be the reason a logout fails.
			go services.LogActivity(config.DB(), claims.UserID, "logout")
		}

		// The revocation is NOT fire-and-forget. Clearing the cookie only removes the token from
		// this browser; the row is what stops the token itself from working, and anything else
		// holding a copy keeps it for the rest of its 24 hours if this write does not land.
		//
		// So the response says what actually happened. "Logged out" has to mean logged out.
		if err := revokeSession(tokenStr); err != nil {
			log.Printf("[ERROR] logout could not revoke the session: %v", err)
			clearAuthCookie(c)
			c.JSON(http.StatusInternalServerError, gin.H{
				"error": "signed out of this browser, but the session could not be revoked on the server — please try again",
			})
			return
		}
	}

	clearAuthCookie(c)
	c.JSON(http.StatusOK, gin.H{"message": "logout success"})
}

// ── Email check ───────────────────────────────────────────────────────────────

type CheckEmailRequest struct {
	Email string `json:"email" binding:"required,email"`
}

// CheckUserEmail is step 1 of "I forgot my password" — the screen where somebody types their
// address before being shown the new-password form.
//
// It deliberately decides nothing and discloses nothing. It used to do both, and each was a hole:
//
//   - It answered `"exists": true` / 404 `"exists": false`, which is an unauthenticated oracle for
//     "does this person have an account here". SendOTP two handlers below already refuses to
//     answer that question ("if your email is registered, an OTP has been sent"), so this endpoint
//     was giving away the very thing its neighbour was protecting.
//
//   - Far worse, it returned a signed 10-minute password-reset token IN THE RESPONSE BODY, to
//     whoever asked. That token was the only thing POST /reset-password-direct verified, so naming
//     an address was the entire proof of ownership: two unauthenticated calls took over any
//     account, the admin's included, whenever email OTP happened to be switched off.
//
// Proof of ownership now comes from the OTP code delivered to the mailbox itself, which is the
// only channel that can actually establish it — see controller/otp. The token and the endpoint
// that trusted it are both gone, which leaves nothing here to decide: the same answer goes back
// for every input and the flow continues to SendOTP.
//
// Kept rather than deleted because it is still where the OTP rate limiter meets the first screen
// of the flow, and because a valid-looking address is worth rejecting before the user has typed a
// new password twice.
func CheckUserEmail(c *gin.Context) {
	var req CheckEmailRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid email"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"message": "if this address is registered, you can continue",
	})
}
