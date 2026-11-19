package services

import (
	"encoding/json"
	"testing"
)

// Policy lifecycle tests.
//
// The payload below is a trimmed copy of what the lab FGT80E (FortiOS 7.2.10) actually answers on
// GET /api/v2/monitor/firewall/policy, including the two shapes that matter:
//
//   - policyid 0 (the implicit deny) with no uuid and no timestamps
//   - policyid 2 with NO last_used / first_used / hit_count keys at all — the device omits them
//     for a rule that has never matched, rather than sending zeros
const policyStatsPayload = `[
  {"policyid":0,"active_sessions":0,"bytes":0,"packets":0},
  {"policyid":1,"uuid":"8530aa0e-7b78-51f1-f75c-1ff308ce16d0","active_sessions":3,"bytes":40,"packets":1,
   "last_used":1785747212,"first_used":1785747212,"hit_count":1,
   "1_week_ipv4":{"hit_count":[0,0,0,0,0,0,0,1],"bytes":[0,0,0,0,0,0,0,40],"packets":[0,0,0,0,0,0,0,1]}},
  {"policyid":2,"uuid":"85626c56-7b78-51f1-280a-2b59a46ea587","active_sessions":0,"bytes":0,"packets":0},
  {"policyid":3,"uuid":"c0789c9e-80e7-51f1-3249-a6414f6482c2","active_sessions":0,"bytes":900,"packets":9,
   "last_used":1777800000,"first_used":1770000000,"hit_count":9},
  {"policyid":4,"uuid":"a0789c9e-80e7-51f1-3249-a6414f6482c2","active_sessions":0,"bytes":10,"packets":1,
   "last_used":1784900000,"first_used":1780000000,"hit_count":4}
]`

// deviceNow is the epoch the fake device reports; every expectation below is measured from it.
// 1785816500 is the real value the lab device returned while policy 1 showed last_used=1785747212.
const deviceNow int64 = 1785816500

// policyUsageFixture wires the captured monitor payload and a matching CMDB policy table into the
// shared fake FortiGate, then runs the real GetPolicyUsage against it.
func policyUsageFixture(t *testing.T, staleDays int, policies []map[string]interface{}) FGPolicyUsageReport {
	t.Helper()

	var statRows []interface{}
	if err := json.Unmarshal([]byte(policyStatsPayload), &statRows); err != nil {
		t.Fatalf("fixture payload is not valid JSON: %v", err)
	}

	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/firewall/policy":    policies,
		"GET /api/v2/monitor/firewall/policy": statRows,
		"GET /api/v2/monitor/system/time":     map[string]interface{}{"time": deviceNow},
	})
	defer done()

	report, err := fc.GetPolicyUsage(staleDays)
	if err != nil {
		t.Fatalf("GetPolicyUsage: %v", err)
	}
	return report
}

// defaultPolicyTable is the CMDB side of the join: five enabled rules plus one disabled one.
func defaultPolicyTable() []map[string]interface{} {
	return []map[string]interface{}{
		{"policyid": 1, "name": "LAN-to-WAN", "action": "accept", "status": "enable"},
		{"policyid": 2, "name": "Never-Matched", "action": "accept", "status": "enable"},
		{"policyid": 3, "name": "Ancient", "action": "accept", "status": "enable"},
		{"policyid": 4, "name": "Quiet-But-Alive", "action": "accept", "status": "enable"},
		{"policyid": 5, "name": "Parked", "action": "deny", "status": "disable"},
	}
}

func findUsage(t *testing.T, r FGPolicyUsageReport, id int) FGPolicyUsage {
	t.Helper()
	for _, p := range r.Policies {
		if p.PolicyID == id {
			return p
		}
	}
	t.Fatalf("policy %d missing from the report", id)
	return FGPolicyUsage{}
}

// The whole feature rests on this: FortiOS omits last_used for a rule that never matched, so a
// naive int64 would decode it as epoch 0 and report a 56-year-old policy instead of "never used".
func TestGetPolicyUsage_MissingTimestampsMeanNeverUsed(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	p := findUsage(t, r, 2)
	if p.State != PolicyStateNeverUsed {
		t.Errorf("state = %q, want %q", p.State, PolicyStateNeverUsed)
	}
	if p.LastUsed != 0 {
		t.Errorf("last_used = %d, want 0 (the device sent no such field)", p.LastUsed)
	}
	if p.IdleDays != -1 {
		t.Errorf("idle_days = %d, want -1 — there is no last match to measure from", p.IdleDays)
	}
	if p.Advice != PolicyAdviceRemove {
		t.Errorf("advice = %q, want %q", p.Advice, PolicyAdviceRemove)
	}
}

// A rule matched within the last week is live, not a cleanup candidate.
func TestGetPolicyUsage_RecentHitIsActive(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	p := findUsage(t, r, 1)
	if p.State != PolicyStateActive {
		t.Errorf("state = %q, want %q", p.State, PolicyStateActive)
	}
	if p.IdleDays != 0 {
		t.Errorf("idle_days = %d, want 0 (hit ~19 hours before the device clock)", p.IdleDays)
	}
	if p.Advice != PolicyAdviceNone {
		t.Errorf("advice = %q, want empty", p.Advice)
	}
	if p.HitCount != 1 || p.Bytes != 40 || p.ActiveSessions != 3 {
		t.Errorf("counters = hits %d bytes %d sessions %d, want 1/40/3", p.HitCount, p.Bytes, p.ActiveSessions)
	}
}

// last_used 1777800000 is ~93 days before the device clock — over the 90-day bar.
func TestGetPolicyUsage_OldHitIsStale(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	p := findUsage(t, r, 3)
	if p.State != PolicyStateStale {
		t.Errorf("state = %q, want %q (idle %d days vs threshold %d)", p.State, PolicyStateStale, p.IdleDays, r.StaleDays)
	}
	if p.IdleDays < DefaultStalePolicyDays {
		t.Errorf("idle_days = %d, want >= %d", p.IdleDays, DefaultStalePolicyDays)
	}
	if p.Advice != PolicyAdviceRemove {
		t.Errorf("advice = %q, want %q", p.Advice, PolicyAdviceRemove)
	}
}

// Between the 7-day active window and the 90-day stale bar: worth a look, not a removal.
func TestGetPolicyUsage_BetweenWindowsIsIdle(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	p := findUsage(t, r, 4)
	if p.State != PolicyStateIdle {
		t.Errorf("state = %q, want %q (idle %d days)", p.State, PolicyStateIdle, p.IdleDays)
	}
	if p.Advice != PolicyAdviceReview {
		t.Errorf("advice = %q, want %q", p.Advice, PolicyAdviceReview)
	}
}

// A disabled rule has zero hits *because* it is disabled. Reporting that as "stale, remove it"
// would invite deleting a rule someone parked on purpose.
func TestGetPolicyUsage_DisabledIsNeverReportedStale(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	p := findUsage(t, r, 5)
	if p.State != PolicyStateDisabled {
		t.Errorf("state = %q, want %q", p.State, PolicyStateDisabled)
	}
	if p.Advice != PolicyAdviceReview {
		t.Errorf("advice = %q, want %q — a parked rule is a question, not a deletion", p.Advice, PolicyAdviceReview)
	}
}

// policyid 0 is the implicit deny: it is not in the CMDB table and cannot be deleted, so it must
// not appear as an unused rule.
func TestGetPolicyUsage_ImplicitDenyIsDropped(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	for _, p := range r.Policies {
		if p.PolicyID == 0 {
			t.Fatalf("policyid 0 (implicit deny) leaked into the report")
		}
	}
}

// The threshold is a knob, not a constant — a stricter audit uses 30 days.
func TestGetPolicyUsage_StaleThresholdIsHonoured(t *testing.T) {
	r := policyUsageFixture(t, 5, defaultPolicyTable())

	if r.StaleDays != 5 {
		t.Fatalf("stale_days = %d, want 5", r.StaleDays)
	}
	if p := findUsage(t, r, 4); p.State != PolicyStateStale {
		t.Errorf("policy 4 state = %q at a 5-day threshold, want %q", p.State, PolicyStateStale)
	}
}

func TestGetPolicyUsage_ZeroThresholdFallsBackToDefault(t *testing.T) {
	r := policyUsageFixture(t, 0, defaultPolicyTable())

	if r.StaleDays != DefaultStalePolicyDays {
		t.Errorf("stale_days = %d, want the %d-day default", r.StaleDays, DefaultStalePolicyDays)
	}
}

// The cleanup backlog belongs at the top of the table.
func TestGetPolicyUsage_WorstStatesSortFirst(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	if len(r.Policies) != 5 {
		t.Fatalf("policy count = %d, want 5", len(r.Policies))
	}
	if r.Policies[0].State != PolicyStateNeverUsed {
		t.Errorf("first row is %q, want never-used at the top", r.Policies[0].State)
	}
	if r.Policies[len(r.Policies)-1].State != PolicyStateActive {
		t.Errorf("last row is %q, want the active rule at the bottom", r.Policies[len(r.Policies)-1].State)
	}
}

func TestGetPolicyUsage_SummaryCountsEveryState(t *testing.T) {
	r := policyUsageFixture(t, DefaultStalePolicyDays, defaultPolicyTable())

	want := FGPolicyUsageSummary{Total: 5, Active: 1, Idle: 1, Stale: 1, NeverUsed: 1, Disabled: 1, Removable: 2}
	if r.Summary != want {
		t.Errorf("summary = %+v, want %+v", r.Summary, want)
	}
}

// The device sends IPv4 and IPv6 histograms separately; a dual-stack rule would look half as busy
// if only one were charted.
func TestMergeWeekHits_SumsBothAddressFamilies(t *testing.T) {
	v4 := &fgPolicyWeekBuckets{HitCount: []int64{1, 2, 3}}
	v6 := &fgPolicyWeekBuckets{HitCount: []int64{10, 20}}

	got := mergeWeekHits(v4, v6)
	want := []int64{11, 22, 3}
	if len(got) != len(want) {
		t.Fatalf("length = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("bucket %d = %d, want %d", i, got[i], want[i])
		}
	}
}

func TestMergeWeekHits_NoHistoryReturnsNil(t *testing.T) {
	if got := mergeWeekHits(nil, nil); got != nil {
		t.Errorf("mergeWeekHits(nil, nil) = %v, want nil", got)
	}
	if got := mergeWeekHits(&fgPolicyWeekBuckets{}, nil); got != nil {
		t.Errorf("empty buckets should produce no sparkline, got %v", got)
	}
}

// A device clock that lags its own counters must not produce a negative age — that would sort a
// busy rule above the dead ones.
func TestIdleDaysSince_ClampsFutureTimestamps(t *testing.T) {
	if got := idleDaysSince(1000, 5000); got != 0 {
		t.Errorf("idleDaysSince(past-clock) = %d, want 0", got)
	}
	if got := idleDaysSince(deviceNow, 0); got != -1 {
		t.Errorf("idleDaysSince(never used) = %d, want -1", got)
	}
	if got := idleDaysSince(86400*10, 86400*3); got != 7 {
		t.Errorf("idleDaysSince = %d, want 7 whole days", got)
	}
}

// If the counters endpoint is unreachable every policy would decode as never-used. Claiming the
// entire rule base is dead is worse than saying nothing.
func TestGetPolicyUsage_WithoutCountersNothingIsCalledDead(t *testing.T) {
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/cmdb/firewall/policy": defaultPolicyTable(),
		// monitor/firewall/policy answers with an object, not an array — decode fails, exactly as
		// it would on a device that does not serve the endpoint.
		"GET /api/v2/monitor/firewall/policy": map[string]interface{}{},
		"GET /api/v2/monitor/system/time":     map[string]interface{}{"time": deviceNow},
	})
	defer done()

	r, err := fc.GetPolicyUsage(DefaultStalePolicyDays)
	if err != nil {
		t.Fatalf("GetPolicyUsage: %v", err)
	}
	if r.CountersAvailable {
		t.Errorf("counters_available = true, want false")
	}
	if r.Summary.Removable != 0 {
		t.Errorf("removable = %d, want 0 — no counters means no verdict", r.Summary.Removable)
	}
	for _, p := range r.Policies {
		if p.State == PolicyStateNeverUsed || p.State == PolicyStateStale {
			t.Errorf("policy %d reported %q with no counters available", p.PolicyID, p.State)
		}
	}
}

// classifyPolicyUsage is the part an operator will argue with; pin each branch directly.
func TestClassifyPolicyUsage_Branches(t *testing.T) {
	cases := []struct {
		name       string
		in         FGPolicyUsage
		available  bool
		wantState  string
		wantAdvice string
	}{
		{"disabled beats everything", FGPolicyUsage{Status: "disable", LastUsed: 0, IdleDays: -1}, true, PolicyStateDisabled, PolicyAdviceReview},
		{"disabled case-insensitive", FGPolicyUsage{Status: "DISABLE"}, true, PolicyStateDisabled, PolicyAdviceReview},
		{"never used", FGPolicyUsage{Status: "enable", LastUsed: 0, IdleDays: -1}, true, PolicyStateNeverUsed, PolicyAdviceRemove},
		{"exactly at the stale bar", FGPolicyUsage{Status: "enable", LastUsed: 1, IdleDays: 90}, true, PolicyStateStale, PolicyAdviceRemove},
		{"one day inside the bar", FGPolicyUsage{Status: "enable", LastUsed: 1, IdleDays: 89}, true, PolicyStateIdle, PolicyAdviceReview},
		{"exactly at the active window", FGPolicyUsage{Status: "enable", LastUsed: 1, IdleDays: 7}, true, PolicyStateIdle, PolicyAdviceReview},
		{"inside the active window", FGPolicyUsage{Status: "enable", LastUsed: 1, IdleDays: 6}, true, PolicyStateActive, PolicyAdviceNone},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.in
			classifyPolicyUsage(&got, tc.available, DefaultStalePolicyDays)
			if got.State != tc.wantState || got.Advice != tc.wantAdvice {
				t.Errorf("got %q/%q, want %q/%q", got.State, got.Advice, tc.wantState, tc.wantAdvice)
			}
		})
	}
}
