package services

import (
	"sync/atomic"
	"time"
)

// The app's own health, as opposed to a device's — nothing here reaches a FortiGate.
//
// Before this, the only way to learn the backend was slow or erroring was somebody noticing and
// saying so. These are in-memory counters, not a time series: they answer "is this process healthy
// right now", which is what an operator checks at 2am, not "what did last Tuesday look like" — that
// is a job for a real metrics backend if this deployment ever needs one, and intentionally not
// built here (see the Engineering Lead's position in the Phase A roadmap: add log/slog and the
// counters an operator would actually reach for, not a dependency on an external TSDB).
//
// atomic.Int64 rather than a mutex: RecordRequest runs on every single request, including the
// hot device-proxy paths, so it must never block on a lock another request holds.
var (
	totalRequests  atomic.Int64
	status2xx      atomic.Int64
	status4xx      atomic.Int64
	status5xx      atomic.Int64
	totalLatencyNs atomic.Int64

	// startedAt is set once, at import time, which is near enough to process start for an uptime
	// figure nobody needs to the second.
	startedAt = time.Now()
)

// RecordRequest is called once per request by middleware.RequestLogger.
func RecordRequest(status int, dur time.Duration) {
	totalRequests.Add(1)
	totalLatencyNs.Add(dur.Nanoseconds())
	switch {
	case status >= 500:
		status5xx.Add(1)
	case status >= 400:
		status4xx.Add(1)
	default:
		status2xx.Add(1)
	}
}

// AppMetricsReport is the JSON shape served to an admin — see controller/health.AppMetrics.
type AppMetricsReport struct {
	UptimeSeconds    int64   `json:"uptime_seconds"`
	TotalRequests    int64   `json:"total_requests"`
	Status2xx        int64   `json:"status_2xx"`
	Status4xx        int64   `json:"status_4xx"`
	Status5xx        int64   `json:"status_5xx"`
	AvgLatencyMillis float64 `json:"avg_latency_ms"`
	// ErrorRatePercent is 5xx responses as a share of all requests since boot — the one number
	// worth alarming on, because a rising average latency can still be "fine", a rising 5xx rate
	// never is.
	ErrorRatePercent float64 `json:"error_rate_percent"`
	OpenSessions     int     `json:"open_forti_sessions"`
}

// AppMetricsSnapshot reads the counters without resetting them — they are cumulative since the
// process started, like /healthz and /readyz already are "since boot" rather than windowed.
func AppMetricsSnapshot() AppMetricsReport {
	total := totalRequests.Load()
	report := AppMetricsReport{
		UptimeSeconds: int64(time.Since(startedAt).Seconds()),
		TotalRequests: total,
		Status2xx:     status2xx.Load(),
		Status4xx:     status4xx.Load(),
		Status5xx:     status5xx.Load(),
		OpenSessions:  PooledSessionCount(),
	}
	if total > 0 {
		report.AvgLatencyMillis = float64(totalLatencyNs.Load()) / float64(total) / float64(time.Millisecond)
		report.ErrorRatePercent = float64(report.Status5xx) / float64(total) * 100
	}
	return report
}
