package policyobject

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// Conditional GET for the big read-only payloads.
//
// The Application Control form's metadata is 291 KB — the device's full 2,414-signature database —
// and the browser re-downloaded all of it every time the form opened. The server side of that was
// already solved: the signature list is cached per device for 30 minutes, so a warm request costs
// 22ms instead of 1.2s. What was left is the transfer itself, which no server-side cache can help
// with and which is paid by whoever is furthest from the console.
//
// So the payload gets an ETag and the handler answers 304 when the caller already has that exact
// bytes. Two properties make this safe to apply without thinking hard about invalidation:
//
//   - The tag is a hash of the response body that was just built, not a guess about freshness. If
//     the device's answer changes — a firmware upgrade, a new signature package — the hash changes
//     with it and the client gets a full 200. There is no window where a stale body is served.
//   - `Cache-Control: no-cache` asks the browser to revalidate every time rather than serving from
//     its own cache blind. That keeps the correctness above: we would rather spend a cheap
//     round-trip than hand back a body nobody re-checked.
//
// The browser does the client half on its own — a 304 is turned back into the cached 200 before
// axios ever sees it — so no frontend change is needed. The one thing that IS needed is CORS: in
// dev the console runs cross-origin (5173 → 9000), where `If-None-Match` is not a safelisted
// request header and `ETag` is not a readable response header unless the server says so. Both are
// declared in main.go's corsMiddleware.

// etagFor computes the validator for a response body.
//
// SHA-256 truncated to 16 bytes: long enough that two different payloads colliding is not a thing
// that happens, short enough to keep the header small. A collision here would serve a stale body,
// so this is not the place to economise further.
func etagFor(body []byte) string {
	sum := sha256.Sum256(body)
	return `"` + hex.EncodeToString(sum[:16]) + `"`
}

// etagMatches reports whether the client's If-None-Match covers tag.
//
// The header is a comma-separated list, and `*` means "any representation I might have". Entries
// may carry the weak prefix W/, which compares equal for a conditional GET — we never emit a weak
// tag, but a proxy in the middle may add the prefix, and treating that as a miss would silently
// turn every revalidation back into a full download.
func etagMatches(ifNoneMatch, tag string) bool {
	ifNoneMatch = strings.TrimSpace(ifNoneMatch)
	if ifNoneMatch == "" {
		return false
	}
	if ifNoneMatch == "*" {
		return true
	}
	for _, candidate := range strings.Split(ifNoneMatch, ",") {
		if strings.TrimPrefix(strings.TrimSpace(candidate), "W/") == tag {
			return true
		}
	}
	return false
}

// writeRevalidatedJSON sends v as JSON with an ETag, or 304 when the caller already holds it.
//
// The body is marshalled here rather than through c.JSON because the tag has to be computed from
// the exact bytes that go on the wire: hashing the Go value and letting gin encode it separately
// would tie correctness to two encoders agreeing forever.
func writeRevalidatedJSON(c *gin.Context, v interface{}) {
	body, err := json.Marshal(v)
	if err != nil {
		// The device answered; we could not encode it. That is ours, not the firewall's.
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to encode device response"})
		return
	}

	tag := etagFor(body)
	c.Header("ETag", tag)
	c.Header("Cache-Control", "private, no-cache")

	if etagMatches(c.GetHeader("If-None-Match"), tag) {
		// 304 carries no body by definition — gin's Status writes headers only.
		c.Status(http.StatusNotModified)
		return
	}

	c.Data(http.StatusOK, "application/json; charset=utf-8", body)
}
