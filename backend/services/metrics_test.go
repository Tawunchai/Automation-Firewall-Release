package services

import (
	"testing"
	"time"
)

// The parts of the metric sampler that can be wrong without anything failing.
//
// A sampler that stores the wrong number does not error, does not log and does not fail a build. It
// draws a chart, and the chart is believed. So the two functions that decide WHICH number gets
// stored are pinned here, along with the thinning that decides which of them a reader sees.

// The bug this exists to prevent, and which the first draft had.
//
// monitor/system/resource/usage returns its history newest-FIRST; ParseResourceUsage reverses it so
// the series reads oldest-first, which is what a chart wants. The sampler takes the newest point,
// so it must take the LAST element. Taking index 0 — the obvious reading of the device's own order —
// stores a value up to twenty-four hours old, every five minutes, and the resulting chart is flat
// and plausible rather than obviously broken.
func TestLatestOfTakesTheNewestPointNotTheOldest(t *testing.T) {
	s := FGUsageSeries{
		Current: 99, // deliberately not the answer: history wins when there is history
		Points: []FGUsagePoint{
			{T: 1000, V: 11}, // oldest
			{T: 2000, V: 22},
			{T: 3000, V: 33}, // newest
		},
	}
	v, ok := latestOf(s)
	if !ok {
		t.Fatal("a series with points reported nothing")
	}
	if v != 33 {
		t.Errorf("latestOf = %v, want 33 (the newest). 11 means it read the series backwards", v)
	}
}

func TestLatestOfFallsBackToCurrentWhenThereIsNoHistory(t *testing.T) {
	v, ok := latestOf(FGUsageSeries{Current: 42})
	if !ok || v != 42 {
		t.Errorf("latestOf = (%v, %v), want (42, true)", v, ok)
	}
	// A device that sends neither is not reporting zero — it is not reporting. Storing 0 would draw
	// a CPU chart dropping to the floor whenever the read failed.
	if _, ok := latestOf(FGUsageSeries{}); ok {
		t.Error("an empty series reported a value; a failed read must not become a zero reading")
	}
}

func TestTunnelUpValueKeepsPartialDistinct(t *testing.T) {
	for _, tc := range []struct {
		health string
		want   float64
	}{
		{TunnelHealthUp, 1},
		{TunnelHealthPartial, 0.5},
		{TunnelHealthDown, 0},
		// A tunnel configured with no phase 2 is carrying nothing. That is DOWN, not "no data" —
		// recording nothing would draw a gap, and a gap reads as "not monitored".
		{TunnelHealthNoP2, 0},
		{"", 0},
	} {
		if got := tunnelUpValue(FGTunnelHealth{Health: tc.health}); got != tc.want {
			t.Errorf("health %q = %v, want %v", tc.health, got, tc.want)
		}
	}
}

func TestTopPoliciesByHitsDropsTheImplicitDenyAndCaps(t *testing.T) {
	stats := []FGPolicyUsage{
		{PolicyID: 0, HitCount: 999999}, // implicit deny — never a rule anybody wrote
		{PolicyID: 3, HitCount: 10},
		{PolicyID: 1, HitCount: 500},
		{PolicyID: 2, HitCount: 100},
	}
	got := topPoliciesByHits(stats, 2)
	if len(got) != 2 {
		t.Fatalf("got %d policies, want the cap of 2", len(got))
	}
	if got[0].PolicyID != 1 || got[1].PolicyID != 2 {
		t.Errorf("got policies %d,%d — want the two busiest (1,2), with policyid 0 excluded",
			got[0].PolicyID, got[1].PolicyID)
	}
	for _, p := range got {
		if p.PolicyID == 0 {
			t.Fatal("policyid 0 was sampled; it is the implicit deny and is filtered everywhere else")
		}
	}
}

// Thinning must not move the window. A chart labelled "last 7 days" whose last point is six hours
// short of now is wrong in the way nobody checks.
func TestThinKeepsBothEndsAndNeverGrows(t *testing.T) {
	base := time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)
	pts := make([]MetricPoint, 1000)
	for i := range pts {
		pts[i] = MetricPoint{At: base.Add(time.Duration(i) * time.Minute), Value: float64(i)}
	}

	for _, n := range []int{2, 7, 100, 999, 1000, 5000} {
		got := thin(pts, n)
		if len(got) > n && n < len(pts) {
			t.Errorf("thin(%d) returned %d points", n, len(got))
		}
		if got[0] != pts[0] {
			t.Errorf("thin(%d) lost the first point", n)
		}
		if got[len(got)-1] != pts[len(pts)-1] {
			t.Errorf("thin(%d) lost the last point — the window's end moved", n)
		}
	}
}

// n == 1 is the one case that cannot keep both ends. It keeps the newest: a single point standing
// for a window is read as "where this ended up", not "where it started".
//
// This case also used to panic. step is (len-1)/(n-1), which is a division by zero at n == 1, and
// the resulting NaN index crashed rather than returning anything — so the limit=1 nobody would type
// by hand but any generated query might was a 500.
func TestThinWithASinglePointKeepsTheNewest(t *testing.T) {
	pts := []MetricPoint{{Value: 1}, {Value: 2}, {Value: 3}}
	got := thin(pts, 1)
	if len(got) != 1 {
		t.Fatalf("thin(1) returned %d points", len(got))
	}
	if got[0].Value != 3 {
		t.Errorf("thin(1) = %v, want the newest (3)", got[0].Value)
	}
}

func TestThinLeavesASmallSeriesAlone(t *testing.T) {
	pts := []MetricPoint{{Value: 1}, {Value: 2}, {Value: 3}}
	if got := thin(pts, 1000); len(got) != 3 {
		t.Errorf("thin shortened a series that was already under the cap: %d points", len(got))
	}
}

// Thinning SAMPLES, it does not average. These are gauges, and averaging an SLA breach with the
// calm either side is how a spike vanishes from the chart that exists to show spikes.
func TestThinReturnsRealReadings(t *testing.T) {
	pts := make([]MetricPoint, 100)
	for i := range pts {
		pts[i] = MetricPoint{Value: float64(i)}
	}
	seen := map[float64]bool{}
	for _, p := range pts {
		seen[p.Value] = true
	}
	for _, p := range thin(pts, 10) {
		if !seen[p.Value] {
			t.Fatalf("thin invented the value %v; it must only drop points, never blend them", p.Value)
		}
	}
}

func TestMetricKindsAreAllKnown(t *testing.T) {
	// The API rejects an unknown kind by listing these, so a kind missing from the list is a
	// measurement nobody can query even though it is being stored.
	for _, k := range []string{
		MetricCPU, MetricMemory, MetricSessions, MetricTunnelUp,
		MetricSLALatency, MetricSLAJitter, MetricSLALoss, MetricPolicyHits,
	} {
		if !IsKnownMetricKind(k) {
			t.Errorf("%q is sampled but not in MetricKinds()", k)
		}
	}
	if IsKnownMetricKind("cpu") || IsKnownMetricKind("") {
		t.Error("IsKnownMetricKind accepted something that is not a kind")
	}
}

// An empty port is not a measurement.
//
// This lab device has sixteen ports with nothing plugged into them. Recording two flat zero series
// for each of them, every five minutes, writes ~9,000 rows a day into the biggest table in the
// schema to say that a socket is empty — while a port that is DOWN but has carried traffic is the
// most interesting thing on the chart, and must survive.
func TestTopInterfacesByVolumeDropsEmptyPortsButKeepsFallenOnes(t *testing.T) {
	got := topInterfacesByVolume(map[string]fgInterfaceStats{
		"port1":  {Link: true, RxBytes: 900, TxBytes: 100},
		"port9":  {Link: false},                          // nothing ever plugged in
		"port10": {Link: false, RxBytes: 50, TxBytes: 5}, // a link that went away
		"wan1":   {Link: true, RxBytes: 5_000, TxBytes: 5_000},
	}, 10)

	names := make([]string, len(got))
	for i, s := range got {
		names[i] = s.name
	}
	want := []string{"wan1", "port1", "port10"}
	if len(names) != len(want) {
		t.Fatalf("interfaces = %v, want %v", names, want)
	}
	for i := range want {
		if names[i] != want[i] {
			t.Fatalf("interfaces = %v, want %v (busiest first)", names, want)
		}
	}
}

func TestTopInterfacesByVolumeCapsAndBreaksTiesStably(t *testing.T) {
	stats := map[string]fgInterfaceStats{}
	for _, n := range []string{"a", "b", "c", "d"} {
		stats[n] = fgInterfaceStats{Link: true} // all idle: every one ties on volume
	}
	first := topInterfacesByVolume(stats, 2)
	second := topInterfacesByVolume(stats, 2)
	if len(first) != 2 {
		t.Fatalf("cap ignored: got %d", len(first))
	}
	// Map iteration order is random in Go. Without the name tie-break, an idle device would sample
	// a different pair of interfaces every five minutes and no series would ever be complete.
	if first[0].name != second[0].name || first[1].name != second[1].name {
		t.Errorf("two sweeps picked different interfaces: %v then %v", first, second)
	}
	if first[0].name != "a" || first[1].name != "b" {
		t.Errorf("tie-break = %v, %v; want a, b", first[0].name, first[1].name)
	}
}
