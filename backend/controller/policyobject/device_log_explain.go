package policyobject

import (
	"net/http"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// GET /policy/device/:deviceId/logs/traffic/:subcategory/explain?source=&window=&search=&q=
//
// The AI's reading of the same entries the page is showing.
//
// ── IT RE-READS THE LOG RATHER THAN TRUSTING THE BROWSER ─────────────────────
// The page has already computed its own summary and could have posted it here, which would have
// been one fewer device call. It does not, and the reason is not distrust of the browser: it is
// that the numbers in the answer have to come from somewhere the answer can be checked against.
// The client sends the QUESTION — which log, which backend, which period, which search — and the
// server reads the device itself, so the digest the model sees is one this endpoint produced and
// can be reproduced by asking again.
//
// ── ADMIN ONLY, AND ONE READ PER CALL ────────────────────────────────────────
// readTrafficLog already enforces the admin gate that the rest of this file's routes use — a
// traffic log names people. This adds no new access; it adds a second reader of the same data.
func DeviceExplainTrafficLog(c *gin.Context) {
	out, ok := readTrafficLog(c)
	if !ok {
		return // readTrafficLog has already answered
	}

	rows := out.Page.Rows
	if len(rows) == 0 {
		// Not an error. An empty log is a real answer and the page already explains WHY it is
		// empty far better than a model could — it reads the two gates off the device.
		c.JSON(http.StatusOK, gin.H{
			"entries": 0,
			"reading": nil,
			"note":    "There are no entries to read.",
		})
		return
	}

	di, _ := getDeviceInfo(c)
	deviceName := "this FortiGate"
	if di != nil && di.Device.Name != "" {
		deviceName = di.Device.Name
	}
	digest := services.SummariseTrafficLog(rows, out.Subcategory)

	sourceLabel := out.Page.Source
	for _, s := range out.Sources {
		if s.Key == out.Page.Source && s.Label != "" {
			sourceLabel = s.Label
			break
		}
	}

	reading, err := services.ExplainTrafficLog(c.Request.Context(),
		deviceName, out.Subcategory, sourceLabel, digest, c.Query("q"),
	)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		// What the model actually saw, so the page can say "read 200 entries" rather than leaving
		// the reader to assume it saw the whole log.
		"entries": digest.Rows,
		"source":  sourceLabel,
		"reading": reading,
	})
}
