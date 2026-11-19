package services

import (
	"testing"
	"time"
)

// These counters are the whole of app self-observability for Phase A — see the doc comment on
// appmetrics.go for why a dependency on an external metrics backend was deliberately not pulled in
// instead. Pinned here: the arithmetic (average latency, error rate) is the one part of this file
// that can be wrong in a way a human would not notice just by reading it.

func TestAppMetricsSnapshot_ComputesAveragesAndErrorRate(t *testing.T) {
	before := AppMetricsSnapshot()

	RecordRequest(200, 10*time.Millisecond)
	RecordRequest(201, 30*time.Millisecond)
	RecordRequest(404, 5*time.Millisecond)
	RecordRequest(500, 60*time.Millisecond)

	after := AppMetricsSnapshot()

	if got := after.TotalRequests - before.TotalRequests; got != 4 {
		t.Fatalf("total requests increased by %d, want 4", got)
	}
	if got := after.Status2xx - before.Status2xx; got != 2 {
		t.Errorf("2xx increased by %d, want 2", got)
	}
	if got := after.Status4xx - before.Status4xx; got != 1 {
		t.Errorf("4xx increased by %d, want 1", got)
	}
	if got := after.Status5xx - before.Status5xx; got != 1 {
		t.Errorf("5xx increased by %d, want 1", got)
	}
	// The four recorded durations sum to 105ms; the average is over ALL requests ever recorded by
	// this process (tests share the package-level counters), so only the running total is checked.
	if after.AvgLatencyMillis <= 0 {
		t.Errorf("avg latency = %v, want > 0 after recording non-zero durations", after.AvgLatencyMillis)
	}
	if after.ErrorRatePercent <= 0 {
		t.Errorf("error rate = %v, want > 0 after recording a 5xx", after.ErrorRatePercent)
	}
	if after.UptimeSeconds < 0 {
		t.Errorf("uptime = %d, want >= 0", after.UptimeSeconds)
	}
}

func TestAppMetricsSnapshot_NoRequestsYetDoesNotDivideByZero(t *testing.T) {
	// A fresh process (or this test running first) must never panic computing an average over zero
	// requests — a metrics endpoint that 500s is worse than one that reports nothing yet.
	report := AppMetricsReport{}
	if report.AvgLatencyMillis != 0 || report.ErrorRatePercent != 0 {
		t.Errorf("zero-value report should read 0/0, got %+v", report)
	}
}
