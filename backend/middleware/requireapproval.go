package middlewares

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
)

// RequireApproval routes a NON-ADMIN account's direct write to the three resource types that decide
// what a firewall allows through it — firewall policies, virtual IPs and security profiles, see
// services.RequiresApproval — into the Change Request queue instead of letting it land: it becomes a
// pending proposal, applied only once an admin reviews it. Everyone else is let straight through:
//
//   - ADMINS write directly. The queue is a way for an account that may NOT write to a device to
//     propose a change, not a second-signature requirement on admins, who are trusted to apply their
//     own changes. (A deliberate product decision — an admin never waits on another admin.) Their
//     writes are still recorded in the Change Ledger by the recorder below, so attribution is kept.
//   - READ-ONLY accounts are refused outright: a direct write is not a proposal, and read-only means
//     exactly that it may not change the device. (It may still raise a proposal through the ordinary
//     /change-requests endpoint.)
//   - Reads, and writes to any resource type NOT in services.RequiresApproval, pass untouched.
//
// Registered in routes.go between Authorizes() and ChangeRecorder(), so an intercepted (queued)
// request never reaches the ledger recorder or the handler — nothing was written, so there is
// nothing to record yet. It fires again, naturally, when the approved request is REPLAYED (see
// services.ApplyChangeRequest): that second pass carries the internal-apply header, is recognised
// below, and is let straight through to the real handler and the ledger.
func RequireApproval() gin.HandlerFunc {
	return func(c *gin.Context) {
		// A request already approved and replayed through this engine. It made this same decision
		// once, when it was first raised — see Authorizes() for why this header can be trusted.
		if services.TrustedInternalApply(c.Request.Header) {
			c.Next()
			return
		}

		target, deviceID, ok := resolveRequest(c)
		if !ok || !services.RequiresApproval(target.ResourceType) {
			c.Next()
			return
		}

		role := c.GetString("user_role")
		uidVal, _ := c.Get("user_id")
		uid := services.UserIDOf(uidVal)
		email := c.GetString("user_email")
		isAdmin := role == "admin"

		db := config.DB()
		if !services.UserCanAccessDevice(db, uid, isAdmin, deviceID) {
			c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
			c.Abort()
			return
		}

		// Admins change the firewall directly. The approval queue exists so that an account which may
		// NOT write to a device can still PROPOSE a change to it — it is not a second-signature
		// requirement placed on admins, who are trusted to apply their own changes. The write still
		// flows down the normal handler and is recorded in the Change Ledger by the recorder
		// registered right after this middleware, so "who changed what" is kept either way.
		//
		// (This is the deliberate product decision that an admin never waits on another admin. The
		// sole-admin self-approve special case this block used to carry is now subsumed: every admin,
		// sole or not, is let straight through.)
		if isAdmin {
			c.Next()
			return
		}

		// A read-only account may propose a change through the ordinary /change-requests endpoint
		// (raising one is open to anyone who can see the device, by design — see
		// controller/changerequest), but a direct write hitting this gate is not a proposal, it is
		// an attempt to change the device, and read-only means exactly that it may not.
		if role == "readonly" {
			c.JSON(http.StatusForbidden, gin.H{"error": "read-only account: cannot write to this device"})
			c.Abort()
			return
		}

		// A non-admin, non-readonly account's direct write becomes a proposal in the queue, applied
		// only once an admin reviews it through /change-requests/:id/review.
		body := drainRequestBody(c)
		req := &entity.ChangeRequest{
			NetworkDeviceID: deviceID,
			Title:           services.DescribeApprovalTitle(c.Request.Method, target),
			Reason:          services.AutoApprovalReason(c.Request.Method, c.Request.URL.Path),
			Method:          c.Request.Method,
			Path:            c.Request.URL.EscapedPath(),
			Body:            string(body),
			RequestedByID:   uid,
			RequestedBy:     email,
		}
		if err := services.CreateChangeRequest(db, req, 0); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			c.Abort()
			return
		}

		c.JSON(http.StatusAccepted, gin.H{
			"message":        "This change has been queued for an admin to review before it takes effect.",
			"pending":        true,
			"change_request": req,
		})
		c.Abort()
	}
}
