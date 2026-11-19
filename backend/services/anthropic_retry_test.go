package services

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

// The retry has to be right in both directions: a transient failure must be retried, and a
// permanent one must not be. Getting the second half wrong is the expensive mistake — a loop over
// a 400 spends real money on an answer that cannot change.

func TestRetryableStatusCoversTheTransientOnes(t *testing.T) {
	for _, code := range []int{429, 500, 502, 503, 504, 529} {
		if !retryableStatus(code) {
			t.Errorf("HTTP %d should be retried — it is the API saying 'not now', not 'no'", code)
		}
	}
}

func TestRetryableStatusRefusesThePermanentOnes(t *testing.T) {
	// 400 malformed · 401 bad key · 403 no access · 404 unknown model · 413 too large ·
	// 422 unprocessable. Sending any of them again produces the same answer and another bill.
	for _, code := range []int{200, 400, 401, 403, 404, 413, 422} {
		if retryableStatus(code) {
			t.Errorf("HTTP %d must NOT be retried — the answer cannot change", code)
		}
	}
}

func TestRetryDelayHonoursRetryAfter(t *testing.T) {
	resp := &http.Response{Header: http.Header{"Retry-After": []string{"7"}}}
	if got := retryDelay(resp, 1); got != 7*time.Second {
		t.Errorf("Retry-After: 7 → waited %v, want 7s — the server knows when its limit clears and we are guessing", got)
	}
}

func TestRetryDelayCapsAnOverlongRetryAfter(t *testing.T) {
	resp := &http.Response{Header: http.Header{"Retry-After": []string{"3600"}}}
	if got := retryDelay(resp, 1); got != anthropicRetryCap {
		t.Errorf("Retry-After: 3600 → waited %v, want it capped at %v: nobody chose to park a request for an hour",
			got, anthropicRetryCap)
	}
}

func TestRetryDelayIgnoresAnUnparseableRetryAfter(t *testing.T) {
	// The HTTP-date form is legal and is not what Anthropic sends; reading it as a duration would
	// be worse than falling back to the backoff.
	resp := &http.Response{Header: http.Header{"Retry-After": []string{"Wed, 21 Oct 2026 07:28:00 GMT"}}}
	got := retryDelay(resp, 1)
	if got <= 0 || got >= anthropicRetryBase {
		t.Errorf("unparseable Retry-After → %v; expected the jittered backoff below %v", got, anthropicRetryBase)
	}
}

func TestRetryDelayGrowsAndStaysJittered(t *testing.T) {
	// Jitter is the reason several users failing in the same second do not all come back in the
	// same second. Sample enough to be sure it is not a constant.
	seen := map[time.Duration]bool{}
	for i := 0; i < 50; i++ {
		seen[retryDelay(nil, 1)] = true
	}
	if len(seen) < 5 {
		t.Errorf("attempt 1 produced %d distinct delays over 50 samples — the jitter is not working", len(seen))
	}

	// And the window moves up with the attempt number.
	var maxFirst, minSecond time.Duration = 0, time.Hour
	for i := 0; i < 200; i++ {
		if d := retryDelay(nil, 1); d > maxFirst {
			maxFirst = d
		}
		if d := retryDelay(nil, 2); d < minSecond {
			minSecond = d
		}
	}
	if minSecond < maxFirst {
		t.Errorf("attempt 2 can wait less (%v) than attempt 1 at its longest (%v) — the backoff does not back off",
			minSecond, maxFirst)
	}
}

// sendAnthropic against a real server, because the parts worth checking are the ones that are easy
// to get subtly wrong: that the body survives a retry, and that a success after a failure is
// returned rather than the failure.

func TestSendAnthropicRetriesAnOverloadedAPIAndKeepsTheBody(t *testing.T) {
	var calls atomic.Int32
	var bodies []string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		buf := make([]byte, 512)
		n, _ := r.Body.Read(buf)
		bodies = append(bodies, string(buf[:n]))

		if calls.Add(1) == 1 {
			w.WriteHeader(529) // overloaded
			_, _ = w.Write([]byte(`{"error":{"type":"overloaded_error"}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"ok":true}`))
	}))
	defer srv.Close()

	resp, err := sendAnthropic(srv.Client(), buildTo(srv.URL, `{"model":"x"}`), "test")
	if err != nil {
		t.Fatalf("sendAnthropic: %v", err)
	}
	defer drainAndClose(resp)

	if resp.StatusCode != http.StatusOK {
		t.Errorf("final status %d, want 200 — the retry's success should be what comes back", resp.StatusCode)
	}
	if got := calls.Load(); got != 2 {
		t.Errorf("sent %d times, want 2 (one 529 then one success)", got)
	}
	if len(bodies) != 2 || bodies[0] != bodies[1] {
		t.Errorf("the retry did not resend the same body: %q vs %q — a reused *http.Request would "+
			"retry with an empty one and turn a 529 into a 400", bodies[0], bodies[len(bodies)-1])
	}
}

func TestSendAnthropicDoesNotRetryABadRequest(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":{"type":"invalid_request_error"}}`))
	}))
	defer srv.Close()

	resp, err := sendAnthropic(srv.Client(), buildTo(srv.URL, `{}`), "test")
	if err != nil {
		t.Fatalf("sendAnthropic: %v", err)
	}
	defer drainAndClose(resp)

	if got := calls.Load(); got != 1 {
		t.Errorf("sent %d times for a 400 — a permanent error must be reported, not repeated", got)
	}
	if resp.StatusCode != http.StatusBadRequest {
		t.Errorf("status %d, want the 400 handed back so the caller can report it", resp.StatusCode)
	}
}

func TestSendAnthropicGivesUpAndReturnsTheRealResponse(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		calls.Add(1)
		w.Header().Set("Retry-After", "0") // no waiting in a unit test
		w.WriteHeader(529)
		_, _ = w.Write([]byte(`{"error":{"type":"overloaded_error","message":"Overloaded"}}`))
	}))
	defer srv.Close()

	resp, err := sendAnthropic(srv.Client(), buildTo(srv.URL, `{}`), "test")
	if err != nil {
		t.Fatalf("sendAnthropic returned an error instead of the response: %v", err)
	}
	defer drainAndClose(resp)

	if got := calls.Load(); int(got) != anthropicMaxAttempts {
		t.Errorf("sent %d times, want %d", got, anthropicMaxAttempts)
	}
	// The caller reports the device's own words. Swallowing the response here would leave it with
	// nothing to say beyond "it failed".
	if resp.StatusCode != 529 {
		t.Errorf("status %d, want 529 handed back after the last attempt", resp.StatusCode)
	}
}

func TestSendAnthropicRetriesAConnectionFailure(t *testing.T) {
	// A server that is not there at all: every attempt fails at the transport, and the caller gets
	// an error rather than a nil response it would dereference.
	resp, err := sendAnthropic(
		&http.Client{Timeout: time.Second},
		buildTo("http://127.0.0.1:1", `{}`),
		"test",
	)
	if err == nil {
		drainAndClose(resp)
		t.Fatal("want an error when every attempt fails at the transport")
	}
	if resp != nil {
		t.Error("want a nil response alongside the error — a caller that checks err first must not find a body")
	}
	if !strings.Contains(err.Error(), "test") {
		t.Errorf("error %q does not name what was being attempted", err)
	}
}

// buildTo returns a build func for sendAnthropic that posts `body` to `url`.
func buildTo(url, body string) func() (*http.Request, error) {
	return func() (*http.Request, error) {
		req, err := http.NewRequest(http.MethodPost, url, strings.NewReader(body))
		if err != nil {
			return nil, fmt.Errorf("build: %w", err)
		}
		req.Header.Set("Content-Type", "application/json")
		return req, nil
	}
}
