// Package workercred serves the one endpoint the Python worker uses to obtain a device credential.
//
// It exists because the credential used to be PUSHED to the worker inside the Redis job message,
// in clear, into an append-only file that keeps it forever (see services/jobcredential.go). Now
// the job message carries a single-use token and the worker comes here to exchange it, once,
// immediately before it opens the SSH session.
//
// Two authentications, both required:
//
//	X-Worker-Secret   proves the caller is the worker (the same header every other /internal/
//	                  callback uses, compared in constant time by services.WorkerAuthOK)
//	the token         proves WHICH job is asking, and is spent on first use
//
// Neither alone is enough: the shared secret is long-lived and names no job, and the token names a
// job but is carried through Redis. Together they say "the worker, for this job, once".
package workercred

import (
	"errors"
	"net/http"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"

	"github.com/gin-gonic/gin"
)

type redeemInput struct {
	Token string `json:"token"`
}

// Seams, for the same reason controller/automationjob's loadBackupWithDevice is one: the two
// refusals worth pinning — a caller without the worker secret, and a token that is spent, expired
// or invented — must be exercisable without a Redis and without a Postgres, or they will not be
// exercised at all.
var (
	redeemJobCredential = services.RedeemJobCredential
	lookupDevice        = func(id uint) (entity.NetworkDevice, error) {
		var d entity.NetworkDevice
		err := config.DB().First(&d, id).Error
		return d, err
	}
	resolveLogin = func(claim services.JobCredentialClaim, device *entity.NetworkDevice) (services.DeviceLogin, error) {
		if claim.UserID == 0 {
			return services.ResolveAutomationLogin(config.DB(), device)
		}
		return services.ResolveDeviceLogin(config.DB(), claim.UserID, device)
	}
)

// Redeem exchanges a job credential token for the device login that job needs.
//
// POST /internal/job-credentials
//
// The reply is deliberately minimal — host, port and platform are already in the job message, so
// the only thing added here is the username and password.
func Redeem(c *gin.Context) {
	if !platform.WorkerAuthOK(c.GetHeader("X-Worker-Secret")) {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid worker secret"})
		return
	}

	var inp redeemInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a token is required"})
		return
	}

	claim, err := redeemJobCredential(inp.Token)
	if err != nil {
		// 404 for unknown, expired and already-spent alike. The worker cannot act differently on
		// any of them — it fails the job and says why — and telling the three apart would turn
		// this into an oracle for which tokens have been issued.
		if errors.Is(err, services.ErrNoSuchJobCredential) {
			c.JSON(http.StatusNotFound, gin.H{
				"error": "this credential token is not valid — it has expired, was already used, " +
					"or the job it belonged to is gone",
			})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the credential token"})
		return
	}

	device, err := lookupDevice(claim.DeviceID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "the device this job names no longer exists"})
		return
	}

	// Resolved HERE, not when the job was queued: a password rotated in between is the one the
	// worker will use. The old payload carried whatever was current at enqueue time, and three
	// failed logins lock a FortiOS admin account.
	//
	// UserID zero means the device's own automation account, which is what a scheduled backup runs
	// as — there is no session to borrow by the time the worker picks the job up.
	login, err := resolveLogin(claim, &device)
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"username": login.Username,
		"password": login.Password,
	})
}
