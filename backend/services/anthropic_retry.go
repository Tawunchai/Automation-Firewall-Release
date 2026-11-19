package services

import (
	"bytes"
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"strconv"
	"sync"
	"time"
)

// Retrying the Anthropic call.
//
// Neither request path had any. A 429 (rate limit) or a 529 (overloaded) — both of which are the
// API saying "not now" rather than "no" — travelled straight back to the user as a failed AI
// request, and the whole wizard had to be re-driven by hand. Those two are transient by
// construction: 529 in particular means the service is busy, and the documented response to it is
// to wait and send the same request again.
//
// What is NOT retried matters as much. A 400 is a malformed request, a 401 a bad key, a 404 a
// model id that does not exist: sending any of them again produces the same answer, more slowly,
// and on a paid API a retry loop over a permanent error is a way to spend money on nothing.
//
// Placement: this wraps the HTTP exchange only, so it runs BEFORE either caller has read a body or
// emitted a streaming delta. That is what makes it safe for the streaming path too — a retry there
// would double-send text to the browser if it could happen after the first delta, and it cannot.

const (
	// anthropicMaxAttempts is the total number of sends, not the number of retries.
	//
	// Three, because the failures this exists for are short: an overloaded API recovers in seconds
	// and a rate limit clears on its own schedule, which the server tells us. More attempts would
	// mostly add latency to requests that were going to fail anyway, on top of a call that already
	// takes tens of seconds when it works.
	anthropicMaxAttempts = 3

	// anthropicRetryBase is the first backoff. It doubles per attempt: 2s, then 4s.
	anthropicRetryBase = 2 * time.Second

	// anthropicRetryCap bounds a Retry-After the server sends us. The header is trusted, but not
	// unboundedly — a long one would park a user's request behind a wait nobody chose, and the
	// honest outcome then is to fail and let them decide.
	anthropicRetryCap = 20 * time.Second
)

// retryableStatus reports whether sending the identical request again could plausibly succeed.
//
// 529 is Anthropic's "overloaded" and is not in net/http's constant list, which is why it appears
// here as a number rather than an http.Status* name.
func retryableStatus(code int) bool {
	switch code {
	case http.StatusTooManyRequests, // 429 — rate limited; Retry-After usually present
		http.StatusInternalServerError, // 500
		http.StatusBadGateway,          // 502
		http.StatusServiceUnavailable,  // 503
		http.StatusGatewayTimeout,      // 504
		529:                            // overloaded
		return true
	}
	return false
}

// retryDelay decides how long to wait before attempt n (1-based, so n=1 is the wait after the
// FIRST failure).
//
// The server's Retry-After wins when it sends one, because it knows when the limit clears and we
// are guessing. Otherwise: exponential backoff with jitter. The jitter is not decoration — without
// it, several users whose requests fail in the same second all come back in the same second, which
// is how a brief overload becomes a sustained one.
func retryDelay(resp *http.Response, attempt int) time.Duration {
	if resp != nil {
		if v := resp.Header.Get("Retry-After"); v != "" {
			// Seconds is the form Anthropic sends. The HTTP-date form is legal but is not used
			// here, and guessing at it would risk parsing a date as a duration.
			if secs, err := strconv.Atoi(v); err == nil && secs >= 0 {
				d := time.Duration(secs) * time.Second
				if d > anthropicRetryCap {
					return anthropicRetryCap
				}
				return d
			}
		}
	}

	backoff := anthropicRetryBase << (attempt - 1) // 2s, 4s, 8s…
	if backoff > anthropicRetryCap {
		backoff = anthropicRetryCap
	}
	// Full jitter over [backoff/2, backoff).
	half := backoff / 2
	return half + time.Duration(rand.Int64N(int64(half)+1))
}

// anthropicPost returns a build func for sendAnthropic: a POST of `body` carrying the three
// headers every Anthropic request needs, plus whatever `extra` the caller adds.
//
// It exists as a function rather than a closure at each call site because it is built ONCE PER
// ATTEMPT — a request body is a reader and the first send consumes it, so a retry that reused the
// request would send an empty one and turn a 529 into a 400.
func anthropicPost(ctx context.Context, apiKey string, body []byte, extra map[string]string) func() (*http.Request, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	return func() (*http.Request, error) {
		// WithContext, not http.NewRequest.
		//
		// Without it the request had no cancellation at all: when the user pressed the button that
		// abandons an answer, or simply closed the tab, the HTTP call carried on to completion and
		// was billed in full — plus, on the config path, the seventeen device reads that build the
		// live context. The context comes from the gin request, so "the browser went away" and
		// "stop this" are the same signal and both reach the API.
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, anthropicAPIURL, bytes.NewReader(body))
		if err != nil {
			return nil, err
		}
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("x-api-key", apiKey)
		req.Header.Set("anthropic-version", anthropicVersion)
		for k, v := range extra {
			req.Header.Set(k, v)
		}
		return req, nil
	}
}

// sendAnthropic performs one Anthropic HTTP request, retrying the transient failures.
//
// `build` makes a fresh *http.Request for each attempt: a request body is a reader and is consumed
// by the first send, so reusing one request would retry with an empty body — a 400 that looks
// nothing like the 529 that caused it.
//
// On success the response is returned with its body UNREAD, exactly as http.Client.Do would, so
// the callers keep owning how they consume it (one reads it whole, the other streams it).
func sendAnthropic(client *http.Client, build func() (*http.Request, error), what string) (*http.Response, error) {
	var lastErr error

	for attempt := 1; attempt <= anthropicMaxAttempts; attempt++ {
		req, err := build()
		if err != nil {
			return nil, err
		}

		resp, err := client.Do(req)
		if err != nil {
			// The caller gave up — the user pressed cancel, or the browser went away. That is not
			// a transient failure, and retrying it means two more attempts and ~6 seconds of
			// backoff spent on an answer nobody is waiting for, after which the error reported is
			// the retry's rather than the cancellation.
			if ctxErr := req.Context().Err(); ctxErr != nil {
				return nil, fmt.Errorf("%s: %w", what, ctxErr)
			}
			// A connection-level failure: DNS, a dropped socket, a timeout. Worth another go, on
			// the same terms as a 5xx.
			lastErr = err
			if attempt == anthropicMaxAttempts {
				break
			}
			wait := retryDelay(nil, attempt)
			log.Printf("[ai] %s: %v — retrying in %s (attempt %d/%d)", what, err, wait.Round(time.Millisecond), attempt+1, anthropicMaxAttempts)
			if err := sleepOrCancel(req.Context(), wait); err != nil {
				return nil, fmt.Errorf("%s: %w", what, err)
			}
			continue
		}

		if !retryableStatus(resp.StatusCode) {
			return resp, nil // success, or a failure that retrying cannot fix
		}

		if attempt == anthropicMaxAttempts {
			return resp, nil // out of attempts — hand the caller the real response to report
		}

		wait := retryDelay(resp, attempt)
		log.Printf("[ai] %s: HTTP %d — retrying in %s (attempt %d/%d)",
			what, resp.StatusCode, wait.Round(time.Millisecond), attempt+1, anthropicMaxAttempts)
		// The body of a response we are discarding still has to be drained and closed, or the
		// connection cannot go back to the pool — and the next attempt then pays for a fresh TLS
		// handshake to an API we have just been told is busy.
		drainAndClose(resp)
		if err := sleepOrCancel(req.Context(), wait); err != nil {
			return nil, fmt.Errorf("%s: %w", what, err)
		}
	}

	return nil, fmt.Errorf("%s: %w", what, lastErr)
}

// drainAndClose empties a response body so its connection can be reused, then closes it.
//
// Capped rather than io.Copy to io.Discard without limit: an error body is small, and a large one
// is not worth reading just to be polite about a connection.
func drainAndClose(resp *http.Response) {
	if resp == nil || resp.Body == nil {
		return
	}
	var sink bytes.Buffer
	_, _ = sink.ReadFrom(http.MaxBytesReader(nil, resp.Body, 8<<10))
	_ = resp.Body.Close()
}

// anthropicFallbackBeta opts into server-side refusal fallbacks. The body field (anthropicRequest
// .Fallbacks) is ignored without this header.
const anthropicFallbackBeta = "server-side-fallback-2026-07-01"

// anthropicFallbacks is the value sent in the request body. "default" lets the API route a
// declined request by refusal category, so there is no second model id here to go stale when the
// pinned model moves.
const anthropicFallbacks = "default"

// anthropicBetaHeader adds the beta opt-in to a caller's extra headers without the caller having
// to remember it, and without mutating the map it was handed.
func anthropicBetaHeader(extra map[string]string) map[string]string {
	out := make(map[string]string, len(extra)+1)
	for k, v := range extra {
		out[k] = v
	}
	out["anthropic-beta"] = anthropicFallbackBeta
	return out
}

// anthropicHTTPClient is the client both request paths use.
//
// ── Why there is no Client.Timeout ───────────────────────────────────────────
//
// It used to be `&http.Client{Timeout: 180 * time.Second}`, which reads like a safety net and is
// not one. http.Client.Timeout covers the WHOLE exchange, the reading of the body included — so
// it is a deadline on how long the model may take to finish answering. A long FortiOS proposal
// that is still streaming correctly at 180 seconds was cut off mid-sentence, and on the streaming
// path that is a half-written config block arriving at the browser as though it were the answer.
// The deadline that was meant to catch a hung connection was instead a cap on legitimate work.
//
// What replaces it does the job the timeout was reaching for, without the part that was wrong:
//
//   - ResponseHeaderTimeout: the server has this long to START answering. A connection that hangs
//     before the first byte of the response is the failure a timeout should catch, and this
//     catches exactly that, whatever the body does afterwards.
//   - DialContext / TLSHandshakeTimeout: the connection-level failures, bounded separately.
//   - the request CONTEXT: how a caller says "stop". Cancellation now comes from the user, not
//     from a clock that cannot tell a slow answer from a stuck one. The streaming reader applies
//     its own idle deadline between events (see ai_stream.go).
//
// One client, reused, so connections are pooled across requests rather than re-dialled per call.
var anthropicHTTPClientOnce sync.Once
var anthropicHTTPClientShared *http.Client

func anthropicHTTPClient() *http.Client {
	anthropicHTTPClientOnce.Do(func() {
		transport := http.DefaultTransport.(*http.Transport).Clone()
		transport.ResponseHeaderTimeout = anthropicResponseHeaderTimeout
		transport.TLSHandshakeTimeout = 15 * time.Second
		transport.ExpectContinueTimeout = 5 * time.Second
		anthropicHTTPClientShared = &http.Client{Transport: transport}
	})
	return anthropicHTTPClientShared
}

// anthropicResponseHeaderTimeout bounds the wait for the response HEADERS only.
//
// Generous on purpose: with thinking enabled the model may reason for a while before the first
// byte, and on the non-streaming path the headers do not arrive until the whole answer is ready.
// This is a stuck-connection guard, not a work budget.
const anthropicResponseHeaderTimeout = 180 * time.Second

// sleepOrCancel waits for d, or returns as soon as the caller's context is done.
//
// A plain time.Sleep here would hold a cancelled request for the whole backoff — up to eight
// seconds of a user who has already pressed cancel waiting for the UI to admit it.
func sleepOrCancel(ctx context.Context, d time.Duration) error {
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-t.C:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}
