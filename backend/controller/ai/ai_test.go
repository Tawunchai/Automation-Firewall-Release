package ai

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

func init() { gin.SetMode(gin.TestMode) }

// controller/ai turns a sentence into FortiOS configuration, and the Apply that follows writes it to
// a live firewall. The package was at 0% coverage.
//
// validateGenerate is the shared front door for both the buffered and the streaming endpoint, and
// the order it runs its checks in is the thing worth holding:
//
//	 1. is the assistant configured at all      (no key → 503, nothing else runs)
//	 2. does the body parse, and is it bounded  (prompt/history caps → 400)
//	 3. does the device exist                   (database)
//	 4. may THIS caller reach that device       (UserCanAccessDevice → 404, never 403)
//
// Everything up to 3 is reachable with no database, and that is the point: a bound that moved below
// the device lookup would fail here by panicking on the nil connection instead of passing quietly.
// The caps are not cosmetic — each request past them is a paid API call, and the history is echoed
// back into the prompt, so an unbounded one is someone else's bill.

func aiCtx(body string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	r := httptest.NewRequest(http.MethodPost, "/ai/generate-config", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	c.Request = r
	c.Set("user_role", "admin")
	c.Set("user_id", uint(7))
	return c, rec
}

// With no ANTHROPIC_API_KEY the assistant is off, and saying so is the FIRST thing that happens —
// before the body is even parsed. t.Setenv restores the old value, so this does not leak into the
// tests below.
func TestNoAPIKeyIsAnsweredBeforeAnythingElse(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "")
	// Deliberately unparseable: if the key check did not come first, this would answer 400.
	c, rec := aiCtx(`{"device_id":`)
	if _, _, _, _, _, ok := validateGenerate(c); ok {
		t.Fatal("validateGenerate reported success with no API key configured")
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("answered %d, want 503 — and 400 would mean the body was parsed first", rec.Code)
	}
}

func TestBodyMustParseAndCarryBothRequiredFields(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-not-used")
	for name, body := range map[string]string{
		"malformed":     `{"device_id":`,
		"empty object":  `{}`,
		"no prompt":     `{"device_id":1}`,
		"blank prompt":  `{"device_id":1,"prompt":""}`,
		"no device":     `{"prompt":"block facebook"}`,
		"device zero":   `{"device_id":0,"prompt":"block facebook"}`,
		"prompt a list": `{"device_id":1,"prompt":["a"]}`,
	} {
		t.Run(name, func(t *testing.T) {
			c, rec := aiCtx(body)
			if _, _, _, _, _, ok := validateGenerate(c); ok {
				t.Fatalf("%s was accepted", name)
			}
			if rec.Code != http.StatusBadRequest {
				t.Fatalf("%s answered %d, want 400", name, rec.Code)
			}
		})
	}
}

// The three caps. Each is checked at its boundary AND one past it, because an off-by-one here is
// either a rejected legitimate prompt or an unbounded one, and neither shows up in normal use.
func TestPromptAndHistoryAreBounded(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-not-used")

	t.Run("prompt over the cap", func(t *testing.T) {
		c, rec := aiCtx(`{"device_id":1,"prompt":"` + strings.Repeat("a", maxPromptLen+1) + `"}`)
		if _, _, _, _, _, ok := validateGenerate(c); ok {
			t.Fatal("a prompt past the cap was accepted")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("answered %d, want 400", rec.Code)
		}
	})

	t.Run("history over the item cap", func(t *testing.T) {
		items := make([]string, maxHistoryItems+1)
		for i := range items {
			items[i] = `{"role":"user","content":"hi"}`
		}
		c, rec := aiCtx(`{"device_id":1,"prompt":"p","history":[` + strings.Join(items, ",") + `]}`)
		if _, _, _, _, _, ok := validateGenerate(c); ok {
			t.Fatal("a history past the item cap was accepted")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("answered %d, want 400", rec.Code)
		}
	})

	t.Run("one history message over the content cap", func(t *testing.T) {
		// Inside the item cap, so this can only be caught by the per-message check — the one that
		// is easiest to drop, because the list is already short.
		c, rec := aiCtx(`{"device_id":1,"prompt":"p","history":[{"role":"user","content":"` +
			strings.Repeat("b", maxHistoryContentLen+1) + `"}]}`)
		if _, _, _, _, _, ok := validateGenerate(c); ok {
			t.Fatal("an over-long history message was accepted")
		}
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("answered %d, want 400", rec.Code)
		}
	})
}

// A request that is exactly at every limit must get PAST the bounds and fail later, on the database
// — which in this binary is a panic. Recovering from it is the assertion: nothing was rejected as
// too long, so the caps are "greater than", not "greater than or equal".
func TestARequestExactlyAtTheLimitsIsNotRejectedAsTooLong(t *testing.T) {
	t.Setenv("ANTHROPIC_API_KEY", "test-key-not-used")

	items := make([]string, maxHistoryItems)
	for i := range items {
		items[i] = `{"role":"user","content":"` + strings.Repeat("c", maxHistoryContentLen) + `"}`
	}
	body := `{"device_id":1,"prompt":"` + strings.Repeat("a", maxPromptLen) +
		`","history":[` + strings.Join(items, ",") + `]}`

	c, rec := aiCtx(body)
	reachedDB := false
	func() {
		defer func() { reachedDB = recover() != nil }()
		_, _, _, _, _, _ = validateGenerate(c)
	}()

	if rec.Code == http.StatusBadRequest {
		t.Fatalf("a request exactly at the caps was rejected as too long: %s", rec.Body.String())
	}
	if !reachedDB {
		t.Fatalf("expected the device lookup to be reached; got status %d body %q", rec.Code, rec.Body.String())
	}
}
