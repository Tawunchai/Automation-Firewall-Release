package policyobject

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Diagnostics — the request/response half of the Diagnostics section.
//
//	GET  /policy/device/:id/diag/network-settings   REST only, open to any signed-in user
//
// Ping and traceroute are NOT here. They happen over time — FortiOS prints ping replies one per
// second and traceroute hops as they resolve — so they are streamed over a WebSocket instead
// (controller/diagstream). They had POST endpoints here first; those were deleted rather than left
// beside the stream, because an endpoint nothing calls is an untested path that quietly drifts.
//
// ── Why the split in authorisation ───────────────────────────────────────────
//
// The line is not "reads vs writes", it is "does this open an SSH session to the firewall". The
// console already draws it that way: the Config Deploy terminal is the app's other SSH feature and
// is admin-only, while every computed, REST-backed read (Troubleshoot, Audit, Rule Lifecycle) is
// open to all.
//
// An SSH diagnostic is not the free read it looks like:
//
//   - Each one is a login, and the device locks an admin account after three failures.
//   - `execute ping-options` and `diagnose sys session filter` are GLOBAL CLI state, so a ping is
//     a brief write to something another administrator can be looking at. Both are reset
//     afterwards (see the service), but the mutation is real while it runs.
//   - The session table lists internal addresses and NAT mappings, and the support bundle contains
//     the running configuration.
//
// Check Network Settings touches none of that — it is four monitor/CMDB GETs — so it stays open.

// ── 1. Check Network Settings ─────────────────────────────────────────────────

// GET /policy/device/:deviceId/diag/network-settings
//
// Read-only and REST-only. Every section degrades independently — an unlicensed or unsupported
// read lands in `errors` and leaves the rest of the panel intact, so one missing feature never
// blanks the page.
func DeviceCheckNetworkSettings(c *gin.Context) {
	di, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	out := fc.GetNetworkSettings()

	// Every single section failing means the device is not answering at all, which is a failed
	// request rather than a page of empty panels.
	if len(out.Errors) == 5 {
		c.JSON(http.StatusBadGateway, gin.H{
			"error": "could not read anything from the device: " + firstError(out.Errors),
		})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"device":     di.Device.Name,
		"settings":   out,
		"fetched_at": time.Now().Unix(),
	})
}

// firstError returns one representative message from the section map, for the "nothing worked"
// case. Map order is random, and that is fine here: when all five failed they failed for the same
// reason.
func firstError(errs map[string]string) string {
	for _, v := range errs {
		return v
	}
	return "unknown error"
}

// The live session list (POST /diag/sessions) was removed on request, with the Session Monitor
// page's live tab: the page is Troubleshooting now, and answers "why can't A reach B?" from the
// policy table rather than the session table. services.ListSessions and its parser stay, tested,
// for anything that needs the session table again.
