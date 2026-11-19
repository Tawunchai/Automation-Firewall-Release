package policyobject

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/services"
)

// History of what the firewall itself does not keep.
//
// This is the one device route that never touches the device. Everything it returns was sampled by
// the scheduler and stored (services/metrics.go), which is the point: a chart over a week cannot be
// answered by asking a FortiGate, because a FortiGate remembers twenty-four hours of CPU and
// nothing else at all.
//
// It still goes through getDeviceInfo. The samples are a record of one customer's firewall — its
// tunnel names, its policy ids, when its links were bad — so the same per-user access rule applies
// as to reading the live configuration, and 404 rather than 403 for the same reason.

// maxHistoryWindow caps how far back one request may ask.
//
// Slightly more than the 90-day retention, so a caller asking for "the last quarter" is answered
// with what exists rather than refused for being one day over.
const maxHistoryWindow = 100 * 24 * time.Hour

// GET /policy/device/:deviceId/metrics
//
//	?kind=cpu_pct&kind=mem_pct   which measurements (repeatable; omit for all)
//	?subject=wan1                which things (repeatable; omit for all)
//	?from=RFC3339&to=RFC3339     the window (defaults to the last 24 hours)
//	?limit=500                   points per series
func DeviceMetricHistory(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	q := services.MetricQuery{
		DeviceID: di.Device.ID,
		Kinds:    c.QueryArray("kind"),
		Subjects: c.QueryArray("subject"),
	}

	var err error
	if raw := c.Query("from"); raw != "" {
		if q.From, err = time.Parse(time.RFC3339, raw); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "from must be an RFC3339 timestamp"})
			return
		}
	}
	if raw := c.Query("to"); raw != "" {
		if q.To, err = time.Parse(time.RFC3339, raw); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to must be an RFC3339 timestamp"})
			return
		}
	}
	if raw := c.Query("limit"); raw != "" {
		n, convErr := strconv.Atoi(raw)
		if convErr != nil || n <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive integer"})
			return
		}
		q.Limit = n
	}

	if !q.From.IsZero() && !q.To.IsZero() {
		if q.To.Before(q.From) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to is before from"})
			return
		}
		if q.To.Sub(q.From) > maxHistoryWindow {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "that window is longer than the samples are kept — the history goes back " +
					strconv.Itoa(int(services.MetricSampleRetention.Hours()/24)) + " days",
			})
			return
		}
	}

	for _, k := range q.Kinds {
		if !services.IsKnownMetricKind(k) {
			c.JSON(http.StatusBadRequest, gin.H{
				"error": "unknown metric kind " + strconv.Quote(k) + " — known kinds: " +
					strings.Join(services.MetricKinds(), ", "),
			})
			return
		}
	}

	series, err := services.ReadMetricSeries(config.DB(), q)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// `series: []` and not `null`, so a chart that has not been sampled yet renders "no data" from
	// an empty list instead of throwing on a null. And `sampled_every_seconds`, because a reader
	// that does not know the spacing cannot tell a gap from a flat line.
	c.JSON(http.StatusOK, gin.H{
		"series":                series,
		"sampled_every_seconds": int(services.MetricSampleInterval.Seconds()),
		"retention_days":        int(services.MetricSampleRetention.Hours() / 24),
	})
}
