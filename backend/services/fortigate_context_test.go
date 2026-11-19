package services

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

// Cancellation reaching the firewall.
//
// Every device call used to run under context.Background(). A browser that navigated away, or gave
// up after the frontend's 20-second timeout, left the backend finishing work nobody would read —
// and on this console that is rarely one call: /audit fans out to 37 requests and the AI's live
// device context fires sixteen at once, each holding a session out of a small pool.
//
// controller/policyobject.buildClient binds the request's context to the session for all ~137
// device routes in one line. These tests cover the half that makes that safe: the handle carries a
// context, the SESSION behind it is still shared, and a cancelled context actually stops the call.

func TestWithContextCancelsAnInFlightRequest(t *testing.T) {
	release := make(chan struct{})
	var served atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		served.Add(1)
		select {
		case <-release: // the test lets it finish
		case <-r.Context().Done(): // or the client gave up first
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()
	defer close(release)

	fc := newTestClient(srv.URL, srv.Client())

	ctx, cancel := context.WithCancel(context.Background())
	bound := fc.WithContext(ctx)

	errCh := make(chan error, 1)
	go func() {
		_, err := bound.do("GET", "/api/v2/cmdb/firewall/policy", nil)
		errCh <- err
	}()

	// Wait until the server is actually holding the request, so the cancel lands mid-flight rather
	// than before the transport has dialled.
	deadline := time.After(5 * time.Second)
	for served.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("the request never reached the server")
		default:
		}
	}
	cancel()

	select {
	case err := <-errCh:
		if err == nil {
			t.Fatal("the call succeeded after its context was cancelled — cancellation is not reaching the device")
		}
		if !errors.Is(err, context.Canceled) {
			t.Errorf("error %v does not wrap context.Canceled; the caller cannot tell a cancelled "+
				"request from a firewall that refused", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("cancelling the context did not end the call")
	}
}

func TestWithoutAContextTheCallStillWorks(t *testing.T) {
	// The scheduler, the notify sweep and the AI background job have no request behind them and
	// build clients with no context at all. Those must keep working, which means the nil case has
	// to fall back to Background rather than to a nil context (which panics inside net/http).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(`{"status":"success","results":[]}`))
	}))
	defer srv.Close()

	fc := newTestClient(srv.URL, srv.Client())
	if _, err := fc.do("GET", "/api/v2/cmdb/firewall/policy", nil); err != nil {
		t.Fatalf("a client with no context should still work: %v", err)
	}
}

func TestWithContextSharesTheSessionRatherThanCopyingIt(t *testing.T) {
	// The property the whole design rests on. If WithContext duplicated the session, a re-login on
	// one request would be invisible to every other request on the same pooled device — each would
	// carry its own stale CSRF token, and writes would start failing in a way that looks like the
	// firewall rejecting them.
	fc := newTestClient("https://example.invalid", http.DefaultClient)
	bound := fc.WithContext(context.Background())

	if fc.sess() != bound.sess() {
		t.Fatal("WithContext forked the session — a re-login through one handle would not be seen by the others")
	}

	// A token set through either handle is visible from both.
	fc.sess().mu.Lock()
	fc.sess().csrfToken = "rotated"
	fc.sess().mu.Unlock()
	if bound.token() != "rotated" {
		t.Errorf("the bound handle reads %q, want the session's rotated token", bound.token())
	}
}

func TestWithContextIsANoOpWithoutOne(t *testing.T) {
	fc := newTestClient("https://example.invalid", http.DefaultClient)
	// A nil context is exactly what is under test: WithContext must hand the client straight back
	// rather than bind it to nothing. SA1012 is right in general and wrong here.
	//lint:ignore SA1012 the nil context is the case under test
	if got := fc.WithContext(nil); got != fc {
		t.Error("WithContext(nil) should hand back the same client rather than a handle bound to nothing")
	}
	var nilClient *FortiClient
	if got := nilClient.WithContext(context.Background()); got != nil {
		t.Error("WithContext on a nil client should stay nil rather than panic")
	}
}
