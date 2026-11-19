package services

import (
	"testing"
)

// Verbatim from GET /api/v2/cmdb/firewall/policy?format=policyid|name|action|status on the lab
// unit. Note the ids are not contiguous and not in order — the table is what it is.
const policyTablePayload = `[
  {"policyid":2,"name":"Testing-Policy-Object","action":"accept","status":"enable"},
  {"policyid":6,"name":"Guest-WiFi-Access","action":"accept","status":"enable"},
  {"policyid":5,"name":"Test-DMZ-to-WAN","action":"accept","status":"enable"},
  {"policyid":1,"name":"default","action":"accept","status":"enable"},
  {"policyid":7,"name":"Host-10100-to-Internet","action":"accept","status":"enable"},
  {"policyid":8,"name":"Block-FB-YT-172.16.100.123","action":"accept","status":"enable"},
  {"policyid":4,"name":"Web-Server","action":"accept","status":"enable"}
]`

func policyTable(t *testing.T) map[int]LogPolicyRef {
	t.Helper()
	table := parseLogPolicyRefs([]byte(policyTablePayload))
	if len(table) != 7 {
		t.Fatalf("parsed %d policies, want 7", len(table))
	}
	return table
}

func intp(v int) *int { return &v }

func TestParseLogPolicyRefs(t *testing.T) {
	table := policyTable(t)

	ref, ok := table[8]
	if !ok {
		t.Fatal("policy 8 missing")
	}
	// The whole point of the column: 8 means nothing, "Block-FB-YT-172.16.100.123" ends the
	// investigation.
	if ref.Name != "Block-FB-YT-172.16.100.123" {
		t.Errorf("name = %q", ref.Name)
	}
	if ref.Action != "accept" || ref.Status != "enable" || !ref.Exists {
		t.Errorf("ref = %+v", ref)
	}
}

func TestParseLogPolicyRefs_SurvivesRubbish(t *testing.T) {
	// The name is an enrichment; a policy table that will not decode must leave the log readable
	// with bare id numbers rather than failing the request.
	if got := parseLogPolicyRefs([]byte(`{"not":"an array"}`)); len(got) != 0 {
		t.Errorf("got %v, want an empty map", got)
	}
}

// ⚠️ THE ONE THAT MATTERS. policyid 0 means two different things, and only `policytype` tells them
// apart. Confusing them sends someone to edit the wrong table — or, worse, reports every ordinary
// management connection as blocked.
func TestResolveLogPolicy_ZeroIsTwoDifferentImplicitRules(t *testing.T) {
	table := policyTable(t)

	// Forward traffic, id 0 → the implicit deny at the bottom of the rule table. Nothing matched.
	// This is the answer to "I can't get online" more often than any other.
	fwd := ResolveLogPolicy(intp(0), "policy", "forward", table)
	if fwd == nil || !fwd.Implicit {
		t.Fatalf("forward id 0 = %+v, want the implicit rule", fwd)
	}
	if fwd.Action != "deny" {
		t.Errorf("implicit forward action = %q, want deny", fwd.Action)
	}

	// Local traffic, id 0 → the implicit local-in policy, which ACCEPTS. It is how the GUI and SSH
	// are reachable at all; calling it a deny would paint every admin session red.
	local := ResolveLogPolicy(intp(0), policyTypeLocalIn, "local", table)
	if local == nil || !local.Implicit {
		t.Fatalf("local id 0 = %+v, want the implicit rule", local)
	}
	if local.Action != "accept" {
		t.Errorf("implicit local-in action = %q, want accept", local.Action)
	}
	if !local.LocalIn {
		t.Error("the local-in ref should say so, so the UI never has to re-derive it")
	}
}

// The device does not always send `policytype`, and on the lab FGT80E it never does: all 200 rows
// in the Local Traffic log arrive with policyid 0 and no policytype at all. Defaulting that to the
// forward implicit deny painted every one of them red as "blocked", NTP exchanges the firewall
// completed included. The log being read is what settles it.
func TestResolveLogPolicy_MissingPolicyTypeIsSettledByTheLog(t *testing.T) {
	table := policyTable(t)

	local := ResolveLogPolicy(intp(0), "", "local", table)
	if local == nil || !local.Implicit {
		t.Fatalf("local id 0 = %+v, want the implicit rule", local)
	}
	if local.Action != "accept" {
		t.Errorf("id 0 in the LOCAL log = %q, want accept \u2014 the forward implicit deny is not in "+
			"the path of traffic addressed to the unit", local.Action)
	}
	if !local.LocalIn {
		t.Error("id 0 in the local log is the local-in policy")
	}

	// The forward log keeps the old answer, which was right there all along.
	fwd := ResolveLogPolicy(intp(0), "", "forward", table)
	if fwd == nil || fwd.Action != "deny" || fwd.LocalIn {
		t.Errorf("id 0 in the FORWARD log = %+v, want the implicit deny", fwd)
	}
}

// An explicit policytype is the device's own word and outranks the inference \u2014 including the case
// where the two disagree, which is the only way to tell the inference is not being applied blindly.
func TestResolveLogPolicy_ExplicitPolicyTypeWinsOverTheLog(t *testing.T) {
	table := policyTable(t)

	ref := ResolveLogPolicy(intp(0), "policy", "local", table)
	if ref == nil || ref.Action != "deny" || ref.LocalIn {
		t.Errorf("policytype policy in the local log = %+v, want the implicit deny", ref)
	}
}

func TestResolveLogPolicy_NamedRule(t *testing.T) {
	table := policyTable(t)
	ref := ResolveLogPolicy(intp(8), "policy", "forward", table)
	if ref == nil || ref.Name != "Block-FB-YT-172.16.100.123" {
		t.Fatalf("ref = %+v", ref)
	}
	if ref.Implicit {
		t.Error("a real rule must not be marked implicit")
	}
}

func TestResolveLogPolicy_DeletedRuleIsReportedNotGuessed(t *testing.T) {
	// A log entry outlives the rule that produced it. An id with no row today says the rule was
	// deleted or renumbered since — which is itself the answer to "it worked yesterday", so it is
	// reported rather than silently rendered as a bare number.
	ref := ResolveLogPolicy(intp(99), "policy", "forward", policyTable(t))
	if ref == nil {
		t.Fatal("a missing rule must still resolve to something")
	}
	if ref.Exists {
		t.Error("exists = true for an id that is not in the table")
	}
	if ref.Name != "" {
		t.Errorf("name = %q, want empty — nothing is known about it", ref.Name)
	}
}

func TestResolveLogPolicy_NilIdIsNotPolicyZero(t *testing.T) {
	// "The device did not say which rule matched" is not the same as "no rule did". Collapsing
	// them would invent an implicit deny on a row that never claimed one.
	if ref := ResolveLogPolicy(nil, "policy", "forward", policyTable(t)); ref != nil {
		t.Errorf("ref = %+v, want nil", ref)
	}
}

func TestResolveLogPolicy_WorksWithNoTableAtAll(t *testing.T) {
	// The policy read is allowed to fail; the log must still render.
	ref := ResolveLogPolicy(intp(8), "policy", "forward", nil)
	if ref == nil || ref.Exists {
		t.Fatalf("ref = %+v, want a not-found reference", ref)
	}
	if impl := ResolveLogPolicy(intp(0), "policy", "forward", nil); impl == nil || !impl.Implicit {
		t.Errorf("the implicit rule must resolve without a table, got %+v", impl)
	}
}

func TestPolicyLabel(t *testing.T) {
	table := policyTable(t)

	cases := []struct {
		id         *int
		policyType string
		want       string
	}{
		{intp(8), "policy", "#8 Block-FB-YT-172.16.100.123"},
		{intp(0), "policy", "implicit deny"},
		{intp(0), policyTypeLocalIn, "implicit local-in"},
		{intp(99), "policy", "#99 (deleted)"},
		{nil, "policy", ""},
	}
	for _, c := range cases {
		got := PolicyLabel(c.id, c.policyType, ResolveLogPolicy(c.id, c.policyType, "forward", table))
		if got != c.want {
			t.Errorf("PolicyLabel(%v, %q) = %q, want %q", c.id, c.policyType, got, c.want)
		}
	}
}

// ── The row carries the resolved rule ────────────────────────────────────────

func TestParseTrafficLog_AttachesTheResolvedPolicy(t *testing.T) {
	page := parseLog2(t, trafficLogPayload, localQuery(LogWindowAll), policyTable(t))

	for _, row := range page.Rows {
		if row.Policy == nil {
			t.Fatal("policy not attached")
		}
		// Every row in the fixture is local-in with policyid 0.
		if !row.Policy.Implicit || row.Policy.Action != "accept" {
			t.Errorf("policy = %+v, want the implicit local-in rule", row.Policy)
		}
	}
}
