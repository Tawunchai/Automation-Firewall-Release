package middlewares

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Change-recorder tests.
//
// Everything here is the part of the ledger that runs before any database or device is involved:
// deciding whether a request is auditable, and finding the key of the object it touched. Getting
// the key wrong is what turns a revert into either a no-op or — for a create — a refusal, so it is
// pinned against the exact response shapes the device-proxy handlers actually return.

func init() { gin.SetMode(gin.TestMode) }

// runResolve drives resolveRequest through a real gin router so :deviceId is populated the same
// way it is in production. A hand-built context would not exercise the param binding at all.
func runResolve(t *testing.T, method, path string) (services.ChangeTarget, uint, bool) {
	t.Helper()

	var (
		target   services.ChangeTarget
		deviceID uint
		ok       bool
	)
	r := gin.New()
	handler := func(c *gin.Context) {
		target, deviceID, ok = resolveRequest(c)
		c.Status(http.StatusOK)
	}
	for _, m := range []string{"GET", "POST", "PUT", "PATCH", "DELETE"} {
		r.Handle(m, "/policy/device/:deviceId/*rest", handler)
	}

	req := httptest.NewRequest(method, path, nil)
	r.ServeHTTP(httptest.NewRecorder(), req)
	return target, deviceID, ok
}

func TestResolveRequest_AuditsDeviceWrites(t *testing.T) {
	target, deviceID, ok := runResolve(t, "PATCH", "/policy/device/1/firewall-policies/12")

	if !ok {
		t.Fatalf("a policy update was not recognised as auditable")
	}
	if deviceID != 1 {
		t.Errorf("device id = %d, want 1", deviceID)
	}
	if target.CMDBPath != "/api/v2/cmdb/firewall/policy" || target.MKey != "12" {
		t.Errorf("target = %+v, want the policy table keyed by 12", target)
	}
	if target.Action != services.ChangeActionUpdate {
		t.Errorf("action = %q, want update", target.Action)
	}
}

// The ledger records changes, not page loads. A GET slipping through would bury the real changes.
func TestResolveRequest_IgnoresReads(t *testing.T) {
	if _, _, ok := runResolve(t, "GET", "/policy/device/1/firewall-policies"); ok {
		t.Errorf("a GET was recorded as a change")
	}
}

// Routes outside the device proxy never reach a firewall — auditing them here would be wrong and
// would also try to snapshot a CMDB object that does not exist.
func TestResolveRequest_IgnoresNonDeviceRoutes(t *testing.T) {
	r := gin.New()
	var ok bool
	r.POST("/create-users", func(c *gin.Context) {
		_, _, ok = resolveRequest(c)
		c.Status(http.StatusOK)
	})
	r.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest("POST", "/create-users", nil))

	if ok {
		t.Errorf("an app-level route was recorded as a device change")
	}
}

// ── mkey extraction ──────────────────────────────────────────────────────────

// A policy create sends no policyid and gets one back from the device; the response is the only
// place the key exists. Without it the revert has nothing to delete and is refused.
func TestExtractMKey_PolicyCreateReadsTheKeyFromTheResponse(t *testing.T) {
	resp := []byte(`{"message":"policy created on device","data":{"policyid":37,"name":"LAN-to-WAN"}}`)
	req := []byte(`{"name":"LAN-to-WAN","srcintf":"lan"}`)

	if got := extractMKey(resp, req); got != "37" {
		t.Errorf("mkey = %q, want 37 — the device-assigned policy id, not the name", got)
	}
}

// An address create answers with a bare message, so the name in the request body is the only key.
func TestExtractMKey_NameKeyedCreateFallsBackToTheRequestBody(t *testing.T) {
	resp := []byte(`{"message":"address created on device"}`)
	req := []byte(`{"name":"Guest-Wi-Fi","type":"subnet"}`)

	if got := extractMKey(resp, req); got != "Guest-Wi-Fi" {
		t.Errorf("mkey = %q, want Guest-Wi-Fi", got)
	}
}

// Static routes are keyed by seq-num, which the device assigns.
func TestExtractMKey_StaticRouteUsesSeqNum(t *testing.T) {
	if got := extractMKey([]byte(`{"data":{"seq-num":4}}`), nil); got != "4" {
		t.Errorf("mkey = %q, want 4", got)
	}
}

func TestExtractMKey_NoKeyAnywhereReturnsEmpty(t *testing.T) {
	if got := extractMKey([]byte(`{"message":"ok"}`), []byte(`{"comment":"none"}`)); got != "" {
		t.Errorf("mkey = %q, want empty", got)
	}
	if got := extractMKey(nil, nil); got != "" {
		t.Errorf("mkey from nothing = %q, want empty", got)
	}
	if got := extractMKey([]byte(`not json`), []byte(`also not json`)); got != "" {
		t.Errorf("mkey from garbage = %q, want empty", got)
	}
}

// A zero policyid is FortiOS's implicit-deny id and is never a real created object; treating it as
// a key would aim a revert at a rule that cannot be deleted.
func TestExtractMKey_ZeroIsNotAKey(t *testing.T) {
	if got := extractMKey([]byte(`{"data":{"policyid":0}}`), []byte(`{"name":"Real-Name"}`)); got != "Real-Name" {
		t.Errorf("mkey = %q, want the request-body name — policyid 0 is not a key", got)
	}
}

// ── schedule table from the body ─────────────────────────────────────────────

// FortiOS splits schedules across three tables, so a create's table is only knowable from its body.
// Guessing wrong would aim the revert at the wrong table entirely.
func TestSchedulePathFromBody(t *testing.T) {
	cases := map[string]string{
		`{"type":"recurring"}`: "/api/v2/cmdb/firewall.schedule/recurring",
		`{"type":"onetime"}`:   "/api/v2/cmdb/firewall.schedule/onetime",
		`{"type":"GROUP"}`:     "/api/v2/cmdb/firewall.schedule/group",
		`{"type":"nonsense"}`:  "",
		`{}`:                   "",
		`not json`:             "",
	}
	for body, want := range cases {
		if got := schedulePathFromBody([]byte(body)); got != want {
			t.Errorf("schedulePathFromBody(%s) = %q, want %q", body, got, want)
		}
	}
}

// ── error text ───────────────────────────────────────────────────────────────

func TestErrorTextFrom(t *testing.T) {
	if got := errorTextFrom([]byte(`{"error":"FortiGate error: -5"}`)); got != "FortiGate error: -5" {
		t.Errorf("got %q", got)
	}
	if got := errorTextFrom([]byte(`{"message":"boom"}`)); got != "boom" {
		t.Errorf("got %q", got)
	}
	if got := errorTextFrom([]byte(`plain text failure`)); got != "plain text failure" {
		t.Errorf("non-JSON body should pass through, got %q", got)
	}
}

// A device error must never be able to write an unbounded blob into the ledger table.
func TestTruncateLedgerText(t *testing.T) {
	long := strings.Repeat("x", 5000)
	got := truncateLedgerText(long)

	if len([]rune(got)) > 2001 {
		t.Errorf("length = %d, want the 2000-char cap plus an ellipsis", len([]rune(got)))
	}
	if !strings.HasSuffix(got, "…") {
		t.Errorf("truncated text should be marked as truncated")
	}
	if short := truncateLedgerText("fine"); short != "fine" {
		t.Errorf("short text was altered: %q", short)
	}
}

// A device error long enough to be truncated must still be valid UTF-8 afterwards.
//
// This is the case the test above misses, and it missed it for a specific reason: it truncates
// strings.Repeat("x", 5000), which is pure ASCII, so every byte offset is also a character
// boundary and a plain s[:2000] can never split anything. Real FortiGate error text is not ASCII —
// comments, object names and FortiGuard category labels on this device are routinely Thai, and a
// Thai character is 3 bytes, so the 2000-byte cut lands mid-character about two times in three.
//
// What that costs is not cosmetic. Postgres rejects an invalid byte sequence for the whole INSERT
// ("invalid byte sequence for encoding UTF8"), so writeRecord's db.Create fails and the ledger row
// is dropped with nothing but a log line. The rows lost are the ones recording a change that
// FAILED — those are the ones carrying a long device error, and the ones an incident review needs.
func TestTruncateLedgerText_NeverSplitsAMultiByteCharacter(t *testing.T) {
	// ~12.8 KB of Thai, well past the 2000-byte cap.
	long := strings.Repeat("ไม่สามารถบันทึกค่าได้ ", 200)

	if !utf8.ValidString(long) {
		t.Fatal("test input is not valid UTF-8 — fix the test, not the code")
	}

	got := truncateLedgerText(long)

	if !utf8.ValidString(got) {
		t.Errorf("truncation produced invalid UTF-8: Postgres rejects this and the ledger row is "+
			"silently lost. tail bytes = % x", []byte(got[max(0, len(got)-8):]))
	}
	if len(got) > 2000+len("…") {
		t.Errorf("length = %d bytes, want at most the 2000-byte cap plus an ellipsis", len(got))
	}
	if !strings.HasSuffix(got, "…") {
		t.Error("truncated text should be marked as truncated")
	}
}

// Every offset near the cap has to be safe, not just the one this device happened to produce.
//
// Whether a plain byte cut splits a character depends on where the multi-byte runs fall relative to
// the budget, so a single fixed input can pass by luck. Sweeping the boundary makes that luck
// impossible: with 3-byte characters, one of every three lengths lands mid-character.
func TestTruncateLedgerText_ValidAtEveryBoundaryOffset(t *testing.T) {
	for pad := 0; pad < 6; pad++ {
		// Shift the multi-byte run across the 2000-byte boundary one byte at a time.
		in := strings.Repeat("a", pad) + strings.Repeat("ไทย", 1000)

		got := truncateLedgerText(in)

		if !utf8.ValidString(got) {
			t.Errorf("pad=%d: truncation produced invalid UTF-8", pad)
		}
		if len(got) > 2000+len("…") {
			t.Errorf("pad=%d: length = %d bytes, over budget", pad, len(got))
		}
	}
}

// ── response capture ─────────────────────────────────────────────────────────

// The recorder tees the response; the client must still receive it byte for byte.
func TestResponseRecorder_PassesTheBodyThroughUnchanged(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	rec := &responseRecorder{ResponseWriter: c.Writer, body: &bytes.Buffer{}}

	if _, err := rec.WriteString(`{"data":{"policyid":9}}`); err != nil {
		t.Fatalf("WriteString: %v", err)
	}

	if got := w.Body.String(); got != `{"data":{"policyid":9}}` {
		t.Errorf("client received %q", got)
	}
	if got := rec.body.String(); got != `{"data":{"policyid":9}}` {
		t.Errorf("recorder captured %q", got)
	}
}

// A large list response must not be buffered whole just so the ledger can look for a key in the
// first few bytes.
func TestResponseRecorder_CapsWhatItBuffers(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	rec := &responseRecorder{ResponseWriter: c.Writer, body: &bytes.Buffer{}}

	payload := bytes.Repeat([]byte("a"), 200*1024)
	if _, err := rec.Write(payload); err != nil {
		t.Fatalf("Write: %v", err)
	}

	if w.Body.Len() != len(payload) {
		t.Errorf("client received %d bytes, want the full %d", w.Body.Len(), len(payload))
	}
	if rec.body.Len() >= len(payload) {
		t.Errorf("recorder buffered %d bytes — the cap did not apply", rec.body.Len())
	}
}

// The middleware reads the request body to find the object name; the handler must still be able to
// bind it afterwards.
func TestDrainRequestBody_PutsTheBodyBack(t *testing.T) {
	r := gin.New()
	var seenByMiddleware, seenByHandler string
	r.POST("/x", func(c *gin.Context) {
		seenByMiddleware = string(drainRequestBody(c))
		var body struct {
			Name string `json:"name"`
		}
		_ = c.ShouldBindJSON(&body)
		seenByHandler = body.Name
		c.Status(http.StatusOK)
	})

	req := httptest.NewRequest("POST", "/x", strings.NewReader(`{"name":"LAN"}`))
	r.ServeHTTP(httptest.NewRecorder(), req)

	if seenByMiddleware != `{"name":"LAN"}` {
		t.Errorf("middleware saw %q", seenByMiddleware)
	}
	if seenByHandler != "LAN" {
		t.Errorf("handler saw %q after the body was drained — the body was not restored", seenByHandler)
	}
}
