package middlewares

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum)
}

// sessionVerdict decides what a session-row lookup means for a request.
//
// Extracted from Authorizes so the rule can be tested without a database, because the three
// outcomes are easy to collapse into two by accident and only one of them is safe to get wrong.
// The original code checked only the first and let the other two through — so a token whose row
// was missing, exactly the state after a revoke, stayed valid until it expired.
//
//	row found, not revoked  → allow
//	row found, revoked      → 401. "Log out" has to mean the token stops working.
//	no row                  → 401. Every token-issuing path writes its row BEFORE returning the
//	                          cookie (auth.issueSessionCookie), so a missing row is a deleted
//	                          session, never a pending one.
//	lookup failed           → 503, NOT allow. A database problem must never be an authorisation
//	                          bypass; failing closed costs availability, failing open costs the
//	                          firewall.
type verdict struct {
	ok      bool
	status  int
	message string
}

func sessionVerdict(lookupErr error, isRevoked bool) verdict {
	switch {
	case lookupErr == nil:
		if isRevoked {
			return verdict{false, http.StatusUnauthorized, "session revoked"}
		}
		return verdict{ok: true}
	case errors.Is(lookupErr, gorm.ErrRecordNotFound):
		return verdict{false, http.StatusUnauthorized, "session no longer exists"}
	default:
		return verdict{false, http.StatusServiceUnavailable, "cannot verify session, try again"}
	}
}

// There is deliberately no MaintenanceGuard middleware.
//
// One used to sit here, documented as the gate on /auth/login, and it was never registered on any
// route — grep found exactly one reference, its own declaration. Meanwhile maintenance mode WAS
// enforced, by a query inside auth.Login. So the behaviour was right and the explanation was in a
// dead function, which is the arrangement most likely to end with somebody fixing the wrong copy.
//
// The live check also has to stay where it is: it runs AFTER the password is verified, because the
// role decides the outcome — an admin signs in during maintenance, which is how the mode gets
// switched off again. A middleware, running before anyone is identified, cannot make that call.
//
// Non-admins are turned away below, once Authorizes has the role from the token.

func Authorizes() gin.HandlerFunc {
	return func(c *gin.Context) {
		// ── An approved change request, being replayed ────────────────────────
		//
		// services.ApplyChangeRequest serves an approved request against this same engine so the
		// write goes down the identical path as a direct one — same validation, same per-user
		// device-access check, same Change Ledger row. A synthesised request carries no cookie, so
		// this is where it identifies itself.
		//
		// It is not a back door. The header's value is a 32-byte crypto/rand secret generated at
		// boot that never leaves the process: an outside caller cannot produce it, and neither can
		// a compromised browser. The alternative — minting a real JWT for the approver — would put
		// credential-forging code in a file whose job is to replay a request.
		if services.TrustedInternalApply(c.Request.Header) {
			id, convErr := strconv.ParseUint(c.GetHeader(services.InternalApplyUserID), 10, 64)
			if convErr != nil {
				c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized: malformed internal apply"})
				c.Abort()
				return
			}
			c.Set("user_id", uint(id))
			c.Set("user_email", c.GetHeader(services.InternalApplyEmail))
			c.Set("user_role", c.GetHeader(services.InternalApplyRole))
			// Maintenance mode is deliberately NOT checked here. A replay is the console acting on
			// a decision a human already made, inside the window they chose — which is frequently
			// a maintenance window.
			c.Next()
			return
		}

		tokenString, err := c.Cookie("auth_token")
		if err != nil || tokenString == "" {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized: missing auth cookie",
			})
			c.Abort()
			return
		}

		claims, err := platform.ParseJWT(tokenString)
		if err != nil {
			c.JSON(http.StatusUnauthorized, gin.H{
				"error": "unauthorized: invalid or expired token",
			})
			c.Abort()
			return
		}

		// ── Session revocation check ──────────────────────────────────────────
		// Three outcomes, kept distinct on purpose. The old code only rejected the FIRST one and
		// let the other two through, so a token whose session row was missing — the exact state
		// after a hard revoke or a DB blip — sailed past the check and stayed valid until it
		// expired. "Revoke this session" has to mean the token stops working.
		db := config.DB()
		tokenHash := hashToken(tokenString)

		var session entity.UserSession
		sessionErr := db.Where("token_hash = ?", tokenHash).First(&session).Error
		if v := sessionVerdict(sessionErr, session.IsRevoked); !v.ok {
			if v.status == http.StatusServiceUnavailable {
				log.Printf("[ERROR] session lookup failed: %v", sessionErr)
			}
			c.JSON(v.status, gin.H{"error": v.message})
			c.Abort()
			return
		}

		c.Set("user_id", claims.UserID)
		c.Set("user_email", claims.Email)
		c.Set("user_role", claims.Role)

		// ── Maintenance mode check ────────────────────────────────────────────
		// Admins bypass entirely. Non-admins are blocked only after the grace
		// period (60 s) that starts when the admin toggles maintenance on.
		//
		// This used to be TWO more queries on every single non-admin request — one for the flag,
		// one for the grace timestamp — for a value that changes when an admin clicks a button.
		// services.MaintenanceStatus answers from a short-lived cache that Toggle invalidates, so
		// the common path costs nothing while a flip still takes effect on the next request.
		if claims.Role != "admin" {
			state, cfgErr := services.MaintenanceStatus(db)
			// A config read that fails must not lock every user out — fail open, exactly as
			// before. Only a successful read can block a request.
			if cfgErr == nil && state.Blocking(time.Now()) {
				c.JSON(http.StatusServiceUnavailable, gin.H{"error": "system is under maintenance"})
				c.Abort()
				return
			}
		}

		c.Next()
	}
}
