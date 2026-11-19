package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

// requireAdminPO gates every write that reaches a real firewall.
//
// Reading Policy & Objects is open to any signed-in user; changing them is not, UNLESS the caller
// holds the "operator" role (Phase A4) — the one role below admin that may edit device config at
// all. Before Phase A4 this checked "admin" alone, which meant the "user" role could not write a
// single device object despite nothing calling it that: there was no middle tier, only admin and
// read-only-in-practice. Centralising the check here is what makes adding operator a one-line
// change instead of ~96: every write handler in this package calls this one function.
//
// "readonly" is deliberately NOT allowed through here even though it is not "admin" either — see
// getDeviceInfo's own check for why that role is refused earlier, with its own clearer error, and
// never reaches this far.
//
// The three resource types a security review flagged as the ones a mistake is most costly on —
// firewall policies, virtual IPs, security profiles — still cannot be written by an operator
// without a second pair of eyes: middleware.RequireApproval queues those regardless of what this
// function allows, which is what makes "operator can edit config" compatible with "but cannot
// approve their own change" (see services.RequiresApproval).
//
// The role comes from the JWT, stamped on the context by middleware.Authorizes, so the check costs
// no query. It lives in its own file because it is shared by every device-proxy handler in this
// package — it used to sit in address.go, alongside a stack of DB-backed CRUD handlers that nothing
// called, so deleting that dead code would have taken the authorisation check for the LIVE
// endpoints with it. A shared guard belongs somewhere its name says what it is.
func requireAdminPO(c *gin.Context) bool {
	role, _ := c.Get("user_role")
	if role != "admin" && role != "operator" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}

// requireAdminStrict gates the handful of device resources an OPERATOR must not reach either.
//
// requireAdminPO above lets "operator" write device config, which is the whole point of that role.
// Three kinds of object are not device config in that sense, and letting an operator at them hands
// over the console's own authority rather than the firewall's rule base:
//
//   - System ▸ Administrators. `POST {"accprofile":"super_admin"}` creates an account on the
//     FortiGate itself. The operator then signs in to the device DIRECTLY, where this console's
//     approval queue, its change ledger and its device grants do not exist — every control Phase 2
//     is building is bypassed by one request. middleware.RequireApproval does not catch it either:
//     it queues firewall policies, virtual IPs and security profiles, and an admin account is none
//     of those (services.RequiresApproval).
//   - LDAP, RADIUS and Exchange servers. Each carries a bind credential for a directory that is
//     usually the organisation's real one, and pointing the firewall at a server the operator runs
//     turns "authenticate against AD" into "authenticate against the operator".
//   - The traffic log. It names internal addresses, the people behind them and the sites they
//     reached — personal data about users who are not party to any of this, and the one thing on
//     the unit that cannot be made safe by a review step afterwards.
//
// Separate from requireAdminPO rather than a parameter on it, because the authz guard test reads
// this package's source and has to be able to tell the two apart by name: a handler that quietly
// moved from strict to lenient would otherwise still look "gated".
func requireAdminStrict(c *gin.Context) bool {
	if role, _ := c.Get("user_role"); role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return false
	}
	return true
}
