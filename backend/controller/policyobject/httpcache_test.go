package policyobject

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

// Conditional-GET tests.
//
// The failure mode this guards against is not a crash — it is the feature quietly doing nothing.
// An ETag that differs between two identical responses still produces a correct page; it just
// never matches, so every request re-downloads the full 291 KB and the only visible symptom is
// that nothing got faster. Likewise a matcher that rejects a valid If-None-Match. Both are tested
// here directly, because neither would show up as a broken screen.

func init() { gin.SetMode(gin.TestMode) }

// serveRevalidated drives writeRevalidatedJSON through a real gin router.
func serveRevalidated(t *testing.T, payload interface{}, ifNoneMatch string) *httptest.ResponseRecorder {
	t.Helper()
	r := gin.New()
	r.GET("/x", func(c *gin.Context) { writeRevalidatedJSON(c, payload) })

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if ifNoneMatch != "" {
		req.Header.Set("If-None-Match", ifNoneMatch)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

// ── the tag itself ───────────────────────────────────────────────────────────

// The whole scheme rests on this: ask twice, get the same tag. If the tag moved between two
// identical responses — a map iterated in random order, a timestamp folded into the payload — the
// client's If-None-Match would never match and every request would be a full download, with no
// error anywhere to say so.
func TestWriteRevalidatedJSON_SamePayloadProducesTheSameTag(t *testing.T) {
	payload := map[string]interface{}{
		"categories": []string{"Video/Audio", "Social.Media", "P2P"},
		"count":      2414,
		"nested":     map[string]int{"z": 26, "a": 1, "m": 13}, // key order must not leak through
	}

	first := serveRevalidated(t, payload, "").Header().Get("ETag")
	if first == "" {
		t.Fatal("no ETag on the response — the conditional GET can never engage")
	}
	for i := 0; i < 20; i++ {
		if got := serveRevalidated(t, payload, "").Header().Get("ETag"); got != first {
			t.Fatalf("run %d produced a different tag (%s vs %s) — every request would re-download",
				i+2, got, first)
		}
	}
}

// The converse: a changed payload must change the tag, or a client would keep a stale body after
// a firmware upgrade swapped the signature database.
func TestWriteRevalidatedJSON_ChangedPayloadChangesTheTag(t *testing.T) {
	before := serveRevalidated(t, map[string]int{"signatures": 2414}, "").Header().Get("ETag")
	after := serveRevalidated(t, map[string]int{"signatures": 2415}, "").Header().Get("ETag")

	if before == after {
		t.Errorf("one more signature left the tag unchanged (%s) — a client would keep the old body",
			before)
	}
}

// ── the round trip ───────────────────────────────────────────────────────────

func TestWriteRevalidatedJSON_FirstRequestGetsTheBody(t *testing.T) {
	w := serveRevalidated(t, map[string]string{"hello": "world"}, "")

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200", w.Code)
	}
	if body := w.Body.String(); body != `{"hello":"world"}` {
		t.Errorf("body = %q, want the marshalled payload", body)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json; charset=utf-8" {
		t.Errorf("Content-Type = %q", ct)
	}
	// no-cache, not max-age: the client must revalidate every time. The correctness of a 304 here
	// comes from the tag being a hash of the body we just built; letting a browser serve from its
	// own cache without asking would give up that guarantee.
	if cc := w.Header().Get("Cache-Control"); cc != "private, no-cache" {
		t.Errorf("Cache-Control = %q, want %q", cc, "private, no-cache")
	}
}

func TestWriteRevalidatedJSON_MatchingTagGets304WithNoBody(t *testing.T) {
	payload := map[string]string{"hello": "world"}
	tag := serveRevalidated(t, payload, "").Header().Get("ETag")

	w := serveRevalidated(t, payload, tag)

	if w.Code != http.StatusNotModified {
		t.Fatalf("status = %d, want 304", w.Code)
	}
	if n := w.Body.Len(); n != 0 {
		t.Errorf("304 carried %d bytes of body — the saving is the body, and 304 must not have one", n)
	}
	if got := w.Header().Get("ETag"); got != tag {
		t.Errorf("ETag = %q on the 304, want it echoed back as %q", got, tag)
	}
}

func TestWriteRevalidatedJSON_StaleTagGetsTheFreshBody(t *testing.T) {
	w := serveRevalidated(t, map[string]int{"signatures": 2414}, `"0123456789abcdef0123456789abcdef"`)

	if w.Code != http.StatusOK {
		t.Errorf("status = %d, want 200: a tag we never issued must not be honoured", w.Code)
	}
	if w.Body.Len() == 0 {
		t.Error("no body on a 200")
	}
}

// ── the matcher ──────────────────────────────────────────────────────────────

func TestEtagMatches(t *testing.T) {
	const tag = `"abc123"`

	for _, tc := range []struct {
		name        string
		ifNoneMatch string
		want        bool
	}{
		{"exact", `"abc123"`, true},
		{"absent", "", false},
		{"different", `"def456"`, false},
		{"any representation", "*", true},

		// A comma-separated list is legal, and a browser holding several cached variants sends one.
		{"first of a list", `"abc123", "def456"`, true},
		{"last of a list", `"def456", "abc123"`, true},
		{"none of a list", `"def456", "ghi789"`, false},

		// We never emit a weak tag, but an intermediary may mark ours weak. For a conditional GET
		// weak comparison is the correct semantics, and treating W/"abc123" as a miss would turn
		// every revalidation behind such a proxy back into a full download.
		{"weak prefix", `W/"abc123"`, true},
		{"weak inside a list", `"def456", W/"abc123"`, true},

		{"padded with spaces", `  "abc123"  `, true},
		{"unquoted value is not a tag", `abc123`, false},
		{"substring is not a match", `"abc"`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := etagMatches(tc.ifNoneMatch, tag); got != tc.want {
				t.Errorf("etagMatches(%q, %q) = %v, want %v", tc.ifNoneMatch, tag, got, tc.want)
			}
		})
	}
}

// The tag has to be a quoted string — an unquoted one is not a valid ETag and browsers will not
// echo it back, which would silently disable revalidation.
func TestEtagFor_IsAQuotedHexString(t *testing.T) {
	tag := etagFor([]byte("anything"))

	if len(tag) < 3 || tag[0] != '"' || tag[len(tag)-1] != '"' {
		t.Fatalf("ETag = %s, want a quoted string", tag)
	}
	inner := tag[1 : len(tag)-1]
	if len(inner) != 32 { // 16 bytes of SHA-256, hex-encoded
		t.Errorf("tag body is %d chars, want 32", len(inner))
	}
	for _, r := range inner {
		if !((r >= '0' && r <= '9') || (r >= 'a' && r <= 'f')) {
			t.Fatalf("non-hex character %q in %s", r, tag)
		}
	}
}
