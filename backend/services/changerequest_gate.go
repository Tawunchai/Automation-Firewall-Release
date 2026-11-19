package services

import (
	"fmt"
	"strings"
)

// The mandatory half of the Change Request queue.
//
// services/changerequest.go and changerequest_apply.go built a queue that worked only when
// somebody chose to use it: every direct write under /policy/device/… still landed the moment a
// caller with device access pressed Save, which left the queue a second, optional way to change a
// firewall rather than the only one. middleware.RequireApproval is what closes that gap — this file
// holds the rules it enforces, kept out of the HTTP layer for the same reason the rest of the
// queue's rules are.

// RequiresApproval reports whether a resource type may only be written through the queue.
//
// Deliberately narrow. A firewall policy decides what traffic the box allows, a virtual IP decides
// what reaches it from outside, and a security profile decides what inspects what gets through —
// get any of the three wrong and the mistake is live on a production firewall. Gating the other
// ~150 device routes (addresses, schedules, static routes, DHCP, SD-WAN, …) as well would turn
// every small edit into an approval request, and a queue nobody can read without wading through
// routine changes is a queue people stop reading.
func RequiresApproval(resourceType string) bool {
	switch resourceType {
	case "firewall-policy", "virtual-ip":
		return true
	}
	return strings.HasPrefix(resourceType, "security-profile:")
}

// There used to be two more rules here: IsSoleAdmin, and an autoSelfApprove that applied a gated
// write on behalf of the one admin who raised it, because with no second admin the queue would
// otherwise hold every such write forever. Both are gone. middleware.RequireApproval now lets
// EVERY admin straight through — sole or not — so the special case has nothing left to be special
// about, and keeping an unreachable self-approval path around an approval gate is the kind of code
// somebody later wires back up by accident. The ChangeRequest.SelfApproved column stays: rows
// written while that path was live still carry it, and the queue still shows them honestly.

// DescribeApprovalTitle is the queue's summary line for a request RequireApproval raised on a
// caller's behalf — the caller never typed a title, so one is derived from what the request does.
func DescribeApprovalTitle(method string, t ChangeTarget) string {
	verb := map[string]string{
		"POST": "Create", "PUT": "Update", "PATCH": "Update", "DELETE": "Delete",
	}[strings.ToUpper(method)]
	if verb == "" {
		verb = "Change"
	}
	if t.MKey != "" {
		return fmt.Sprintf("%s %s %q", verb, t.ResourceType, t.MKey)
	}
	return fmt.Sprintf("%s %s", verb, t.ResourceType)
}

// AutoApprovalReason fills the request's required Reason when RequireApproval raised it, since
// nobody was prompted for one. It is honest about that rather than inventing a human justification
// the requester never gave — a multi-admin reviewer still sees who, what, and the live before/after
// diff; a page that lets the requester explain why belongs to a later pass of this feature.
func AutoApprovalReason(method, path string) string {
	return fmt.Sprintf(
		"Submitted automatically: this resource type requires approval under the mandatory change-control policy (%s %s).",
		strings.ToUpper(method), path,
	)
}
