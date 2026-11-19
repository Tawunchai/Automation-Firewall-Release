package policyobject

import (
	"encoding/csv"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Log & Report ▸ Local Traffic — the device's own log, read live.
//
//	GET /policy/device/:deviceId/logs/sources                     which backends this unit keeps
//	GET /policy/device/:deviceId/logs/traffic/:subcategory        one page of rows
//	GET /policy/device/:deviceId/logs/traffic/:subcategory/export the same rows as a CSV file
//
// ── ADMIN ONLY, AND NOT FOR THE USUAL REASON ─────────────────────────────────
// Most of this package gates writes and leaves reads open, because reading a policy tells you what
// the firewall enforces. A traffic log is different in kind: it is a list of who talked to what and
// when, naming internal addresses, usernames and the devices behind them. That is surveillance
// data about people, not configuration, so the READ is gated here too — matching the sidebar,
// which only shows this page to an admin (components/structure/sidebar/data.tsx).
//
// ── ONE REQUEST, NOT THREE ───────────────────────────────────────────────────
// The page needs the rows, the list of log backends for its source picker, and — only when the
// result is empty — the reason it is empty. Three endpoints would mean three round trips to a
// firewall on every refresh, so this returns them together and skips the ones it does not need:
//
//	sources   always      1 monitor call; also decides WHICH backend is read (PickLogSource)
//	rows      always      1 log call
//	gates     when empty  2 CMDB calls, and only then, because they explain nothing otherwise

// defaultLogPageRows is what the table asks for when the caller does not say. The device's own
// default is 400, which is more than any screen shows and slower to fetch on the FortiGate Cloud
// backend; 200 fills the viewport several times over and still leaves room to scroll.
const defaultLogPageRows = 200

// logResponse is what the page consumes.
type logResponse struct {
	Page    services.FGTrafficLogPage `json:"page"`
	Sources []services.FGLogSource    `json:"sources"`

	// Gates is present only when the result is empty, because that is the only time it is an
	// answer to anything. A non-empty log needs no excuse.
	Gates *services.FGLogGates `json:"gates,omitempty"`

	// AppliedFilters is what was actually sent to the device, so the UI can show a person the
	// real query rather than only what they typed. The filter language is not obvious, and seeing
	// `srcip==10.0.0.1,dstip==10.0.0.1` is how someone learns it.
	AppliedFilters []string `json:"applied_filters,omitempty"`

	// Subcategory echoes which traffic log this is, so a page reading `local` cannot render rows
	// from `forward` because a stale request landed late.
	Subcategory string `json:"subcategory"`
}

// logQueryFrom validates the request's query string into a device query.
//
// Every value is checked against a whitelist before it reaches a device URL: `source` and
// `subcategory` become PATH SEGMENTS, so an unchecked one would let a caller reach any endpoint on
// the firewall through this proxy.
func logQueryFrom(c *gin.Context, sources []services.FGLogSource) (services.TrafficLogQuery, bool) {
	var q services.TrafficLogQuery

	// The export route is a child path (…/:subcategory/export) rather than a ".csv" suffix on the
	// parameter: gin matches a wildcard segment whole, so ":subcategory" would capture "local.csv"
	// and the two routes could not coexist.
	sub := c.Param("subcategory")
	if !services.IsValidLogSubcategory(sub) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("unknown traffic log %q — expected local, forward, sniffer or multicast", sub),
		})
		return q, false
	}
	q.Subcategory = sub

	// An unavailable source falls back rather than failing: the picker is built from the same
	// list, so the only way to ask for one the device lacks is a stale tab or a hand-typed URL,
	// and showing the default log beats an error page in both cases.
	q.Source = services.PickLogSource(sources, c.Query("source"))
	if q.Source == "" {
		c.JSON(http.StatusBadGateway, gin.H{"error": "this device reports no log storage at all"})
		return q, false
	}

	asked := services.LogWindow(c.DefaultQuery("window", string(services.LogWindow1Hour)))
	if !services.IsValidLogWindow(asked) {
		c.JSON(http.StatusBadRequest, gin.H{
			"error": fmt.Sprintf("unknown time period %q — expected 1h, 24h or 7d", asked),
		})
		return q, false
	}
	// The BACKEND decides whether a period applies at all: memory is a ring buffer, so filtering it
	// by time hides entries that are still in it and shows an empty table over a full buffer. A
	// period asked for against memory collapses to "everything" rather than emptying the result —
	// the page may simply be carrying a selection from when another source was picked.
	q.Window = services.ResolveLogWindow(q.Source, asked)

	// Reverse DNS for the addresses, which is what puts "(globalgip.fortinet.net)" beside
	// 173.243.140.16 the way the device's own log view does. Sent as its own parameter; see
	// services.logExtraReverse for why it cannot share one with another extra.
	q.Extras = []string{services.LogExtraReverse}

	if v := c.Query("start"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "start must be a non-negative whole number"})
			return q, false
		}
		q.Start = n
	}

	q.Rows = defaultLogPageRows
	if v := c.Query("rows"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "rows must be a positive whole number"})
			return q, false
		}
		q.Rows = n
	}

	// A search that cannot be turned into a filter is a 400 naming the bad term. It must never be
	// forwarded as-is: the device accepts a nonsense filter and answers "no results", which would
	// read on screen as a firewall that saw no traffic. See services.BuildSearchFilter.
	//
	// Both halves of the search come from this one parse: the strings sent to the device, and the
	// terms this process applies to whatever comes back. The device honours a single-field term
	// but ignores the comma-OR form a free-text search becomes — accepting it, reporting it as
	// applied, and returning every row — so the second half is what makes those searches real.
	// See services/fortigate_logmatch.go for the measurements.
	terms, err := services.BuildLogSearch(c.Query("search"))
	if err != nil {
		var se *services.LogSearchError
		if errors.As(err, &se) {
			c.JSON(http.StatusBadRequest, gin.H{"error": se.Error(), "search_error": true})
			return q, false
		}
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "search_error": true})
		return q, false
	}
	q.Terms = terms
	q.Filters = make([]string, 0, len(terms))
	for _, t := range terms {
		q.Filters = append(q.Filters, t.Filter)
	}

	return q, true
}

// readTrafficLog does the work both handlers share: authorise, pick a source, read, and explain an
// empty answer. It writes its own error responses and returns ok=false when it has.
func readTrafficLog(c *gin.Context) (logResponse, bool) {
	var out logResponse

	if !requireAdminStrict(c) {
		return out, false
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return out, false
	}

	sources, err := fc.GetLogSources()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not ask the device which logs it keeps: " + err.Error()})
		return out, false
	}
	out.Sources = sources

	q, ok := logQueryFrom(c, sources)
	if !ok {
		return out, false
	}
	out.Subcategory = q.Subcategory
	out.AppliedFilters = q.Filters

	// The rule table, so a `policyid` in the log can be shown as the rule it names. One extra
	// device call, and the whole point of the Policy column: "why can't I get online" is answered
	// by WHICH rule claimed the packet, and a bare number answers nothing.
	//
	// Never fatal — GetLogPolicyRefs returns an empty map on failure, and a log with bare id
	// numbers is far better than no log.
	policies := fc.GetLogPolicyRefs()

	page, err := fc.GetTrafficLog(q, policies)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not read the log from the device: " + err.Error()})
		return out, false
	}
	out.Page = page

	// Only when the DEVICE returned nothing — `page.Total`, not `page.Returned`.
	//
	// Returned is what survived the time window here in Go, and using it was a real bug: the memory
	// buffer held 34 entries, a 1-hour window dropped all of them for being an hour old, and the
	// page then accused the device of discarding local traffic while that traffic sat in the very
	// buffer it had just read. The gates explain "the firewall wrote nothing down"; they have
	// nothing to say about "you are looking at the wrong hour".
	//
	// Still local-only: `local-in-allow` and the per-backend `local-traffic` filter say nothing
	// about why a FORWARD traffic log is empty.
	if page.Total == 0 && q.Subcategory == "local" {
		gates := fc.GetLogGates(q.Source)
		out.Gates = &gates
	}

	return out, true
}

// DeviceGetTrafficLog serves one page of the traffic log.
//
// GET /policy/device/:deviceId/logs/traffic/:subcategory?source=&window=&search=&start=&rows=
func DeviceGetTrafficLog(c *gin.Context) {
	out, ok := readTrafficLog(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, out)
}

// DeviceGetLogSources serves just the source picker, for a page that wants it before it has
// decided what to read.
//
// GET /policy/device/:deviceId/logs/sources
func DeviceGetLogSources(c *gin.Context) {
	if !requireAdminStrict(c) {
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	sources, err := fc.GetLogSources()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "could not ask the device which logs it keeps: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"sources": sources, "default": services.PickLogSource(sources, "")})
}

// csvColumns is the export's shape: the table's own columns first, then the fields someone
// analysing the export needs and the screen has no room for.
var csvColumns = []string{
	"date", "time", "tz", "action", "level",
	"srcip", "srcport", "srcintf", "srccountry", "srcname", "srcmac", "devtype",
	"dstip", "dstport", "dstintf", "dstcountry",
	"proto", "service", "app", "appcat", "policyid", "policy", "policytype",
	"duration", "sentbyte", "rcvdbyte", "sentpkt", "rcvdpkt",
	"sessionid", "logid", "vd", "crlevel", "archive",
}

// DeviceDownloadTrafficLog serves the same query as a CSV file — the download button on the page.
//
// GET /policy/device/:deviceId/logs/traffic/:subcategory.csv?…
//
// The file is built from the SAME query the table ran, so what lands on disk is what was on
// screen. Anything else invites the export and the page to disagree about what a filter meant.
func DeviceDownloadTrafficLog(c *gin.Context) {
	out, ok := readTrafficLog(c)
	if !ok {
		return
	}

	filename := fmt.Sprintf("%s-traffic-%s-%s.csv",
		out.Subcategory, out.Page.Source, time.Now().UTC().Format("20060102-150405"))

	c.Header("Content-Type", "text/csv; charset=utf-8")
	c.Header("Content-Disposition", `attachment; filename="`+filename+`"`)

	// A BOM, because these are opened in Excel more often than anywhere else and Excel reads a
	// UTF-8 CSV as the local codepage without one — which mangles any non-ASCII hostname or
	// FortiGuard category in the export.
	c.Writer.Write([]byte{0xEF, 0xBB, 0xBF})

	w := csv.NewWriter(c.Writer)
	defer w.Flush()

	if err := w.Write(csvColumns); err != nil {
		return
	}
	for _, row := range out.Page.Rows {
		if err := w.Write(csvRow(row)); err != nil {
			return
		}
	}
}

// csvRow renders one row in csvColumns order, reading from Raw so that the export carries exactly
// what the device said. An absent field becomes an empty cell — never a zero, which for a port or
// a policy id would be a value the firewall never logged.
func csvRow(row services.FGTrafficLog) []string {
	rec := make([]string, 0, len(csvColumns))
	for _, col := range csvColumns {
		switch col {
		case "archive":
			rec = append(rec, strconv.FormatBool(row.Archive))
		case "proto":
			// The name rather than the number, because a spreadsheet column of 6s and 17s is
			// unreadable and the number is still in the raw log.
			rec = append(rec, row.ProtoName)
		case "policy":
			// The resolved RULE beside its bare id. "#8 Block-FB-YT-172.16.100.123" is the answer
			// somebody exports this file to find; "8" on its own is not.
			rec = append(rec, services.PolicyLabel(row.PolicyID, row.PolicyType, row.Policy))
		default:
			rec = append(rec, row.Raw[col])
		}
	}
	return rec
}
