package services

import (
	"errors"
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

// The confused deputy, and the two things that close it.
//
// A change request is replayed with the APPROVER's rights. Everything an approver decides on,
// therefore, has to come from the request itself rather than from the person who raised it:
//
//  1. the TITLE — the one line in the queue — is derived from what the request will do, not typed
//     by the requester (TestTitleDescribesTheWriteNotTheRequester);
//  2. the PATH may not name the handful of objects whose write hands over the console's own
//     authority rather than the firewall's rule base (TestQueueRefusesPrivilegedResources).
//
// Both are in services, not in the HTTP layer, because the queue has two entrances — the
// /change-requests endpoint and middleware.RequireApproval, which raises a request on a non-admin's
// behalf — and a rule enforced at one entrance is not a rule.

func TestTitleDescribesTheWriteNotTheRequester(t *testing.T) {
	now := time.Now()

	// The attack, written out: a benign title on a policy create.
	r := proposal(func(x *entity.ChangeRequest) {
		x.Title = "Add the office printer's address"
		x.Reason = "ticket NET-412"
		x.Method = "POST"
		x.Path = "/policy/device/1/firewall-policies"
	})
	if err := PrepareChangeRequest(r, 0, now); err != nil {
		t.Fatalf("prepare: %v", err)
	}

	if strings.Contains(r.Title, "printer") {
		t.Errorf("the requester's wording survived into the title: %q — an approver reading the "+
			"queue would be told this request adds an address, when it writes a firewall policy", r.Title)
	}
	if !strings.Contains(strings.ToLower(r.Title), "firewall-policy") {
		t.Errorf("title = %q, want it to name what the write actually touches", r.Title)
	}

	// Their wording is not thrown away — it is relabelled as theirs.
	if !strings.Contains(r.Reason, "printer") {
		t.Errorf("the requester's own title was lost; reason = %q", r.Reason)
	}
	if !strings.Contains(r.Reason, "ticket NET-412") {
		t.Errorf("the reason itself was lost; reason = %q", r.Reason)
	}
}

// RequireApproval fills the title in already, with the same function. Re-deriving it must not then
// staple that derived title into the reason as though a human had typed it.
func TestADerivedTitleIsNotCopiedIntoTheReason(t *testing.T) {
	r := proposal(func(x *entity.ChangeRequest) {
		x.Method = "POST"
		x.Path = "/policy/device/1/firewall-policies"
		x.Reason = AutoApprovalReason("POST", "/policy/device/1/firewall-policies")
	})
	target, ok := ResolveChangeTarget(r.Method, "firewall-policies")
	if !ok {
		t.Fatal("firewall-policies no longer resolves to a change target")
	}
	r.Title = DescribeApprovalTitle(r.Method, target)

	if err := PrepareChangeRequest(r, 0, time.Now()); err != nil {
		t.Fatalf("prepare: %v", err)
	}
	if strings.Contains(r.Reason, "Requester's own title") {
		t.Errorf("a machine-written title was folded into the reason: %q", r.Reason)
	}
}

func TestQueueRefusesPrivilegedResources(t *testing.T) {
	cases := []struct{ method, path string }{
		{"POST", "/policy/device/1/ldap-servers"},
		{"PUT", "/policy/device/1/ldap-servers/Corp-AD"},
		{"DELETE", "/policy/device/1/ldap-servers/Corp-AD"},
		{"POST", "/policy/device/1/radius-servers"},
		{"PUT", "/policy/device/1/radius-servers/Corp-RADIUS"},
		{"POST", "/policy/device/1/exchange-connectors"},
		{"DELETE", "/policy/device/1/exchange-connectors/EX1"},
	}
	for _, c := range cases {
		_, _, err := resolveRequestTarget(c.method, c.path)
		if !errors.Is(err, ErrPrivilegedPath) {
			t.Errorf("%s %s → %v, want ErrPrivilegedPath — approving one of these points the "+
				"firewall's authentication at a server the requester chose", c.method, c.path, err)
		}
	}
}

// The firewall's own admin accounts are refused by a different mechanism: they are not a CMDB
// coordinate this console knows, so they cannot be classified, diffed or reverted — and a queue
// entry nobody can show a diff for is an approver pressing Approve on a URL.
//
// Pinned separately because that reason is indirect: adding "admin-users" to deviceProxySegment
// one day for the Change Ledger's benefit would silently make it queueable again.
func TestAdminUsersCannotBeQueued(t *testing.T) {
	for _, c := range []struct{ method, path string }{
		{"POST", "/policy/device/1/admin-users"},
		{"PUT", "/policy/device/1/admin-users/backdoor"},
		{"DELETE", "/policy/device/1/admin-users/admin"},
	} {
		if _, _, err := resolveRequestTarget(c.method, c.path); err == nil {
			t.Errorf("%s %s was accepted into the queue — approving it creates an account ON the "+
				"firewall, where this console's grants, ledger and queue do not reach",
				c.method, c.path)
		}
	}
}

// An exception list that names something which no longer exists is an exception nobody is reading.
func TestPrivilegedResourcesNameRealResourceTypes(t *testing.T) {
	known := map[string]bool{}
	for _, seg := range deviceProxySegment {
		known[seg.resourceType] = true
	}
	for name, why := range privilegedResources {
		if !known[name] {
			t.Errorf("privilegedResources names %q (%s) but no route resolves to that resource "+
				"type any more — the refusal is now guarding nothing", name, why)
		}
	}
	if len(privilegedResources) == 0 {
		t.Fatal("privilegedResources is empty — the queue would accept every device write again")
	}
}

// The ordinary case must keep working: the queue is only useful if the writes it exists for go in.
func TestTheWritesTheQueueExistsForAreStillAccepted(t *testing.T) {
	for _, c := range []struct{ method, path string }{
		{"POST", "/policy/device/1/firewall-policies"},
		{"PATCH", "/policy/device/1/firewall-policies/12"},
		{"DELETE", "/policy/device/1/firewall-policies/12"},
		{"POST", "/policy/device/1/virtual-ips"},
		{"PUT", "/policy/device/1/security-profiles/antivirus/Corp-AV"},
		{"POST", "/policy/device/1/addresses"},
		{"PATCH", "/policy/device/1/static-routes/3"},
		{"POST", "/policy/device/1/sdwan/zones"},
	} {
		if _, _, err := resolveRequestTarget(c.method, c.path); err != nil {
			t.Errorf("%s %s was refused: %v", c.method, c.path, err)
		}
	}
}

// Every resource type RequiresApproval gates must be one the queue can actually carry. If those
// two lists ever disagree, a non-admin's write is intercepted at 202 "queued for review" and then
// refused by the queue — the write is lost and the user is told it is waiting.
func TestEveryGatedResourceCanEnterTheQueue(t *testing.T) {
	paths := map[string]string{
		"firewall-policy":            "/policy/device/1/firewall-policies",
		"virtual-ip":                 "/policy/device/1/virtual-ips",
		"security-profile:antivirus": "/policy/device/1/security-profiles/antivirus",
	}
	for resourceType, path := range paths {
		if !RequiresApproval(resourceType) {
			t.Errorf("%s is no longer gated by RequiresApproval — this test is checking a rule "+
				"that moved; update it with the gate", resourceType)
			continue
		}
		if _, _, err := resolveRequestTarget("POST", path); err != nil {
			t.Errorf("%s (%s) is gated by RequiresApproval but the queue refuses it: %v — a "+
				"non-admin's write would be intercepted and then dropped", resourceType, path, err)
		}
	}
}
