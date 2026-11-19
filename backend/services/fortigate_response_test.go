package services

import (
	"crypto/tls"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// How a FortiGate answer is judged to have succeeded or failed.
//
// This is the single decision every one of the ~200 device calls in this codebase inherits, and it
// is the one place where getting it wrong is INVISIBLE: a failure read as a success does not throw,
// does not log, and does not colour anything red. It renders an empty table. "This firewall has no
// addresses" and "this firewall refused to tell me its addresses" look identical on screen, and
// only one of them is safe to act on.
//
// The three signals in a response used to be ANDed — status, the envelope's http_status, and the
// real status line all had to disagree with success before anything was reported. On the lab unit
// (FortiOS 7.2.10) they always do agree, verified live against a missing object, an unknown table,
// an invalid field value, a missing mkey and a nonexistent monitor path: every one came back with a
// non-200 status line AND an error envelope. So the AND was right for this firmware by luck rather
// than by design, and anything in the path that normalises the status line — a reverse proxy, a
// load balancer, a different firmware — would have turned a refusal into an empty list.

// jsonDevice serves one canned response.
func jsonDevice(t *testing.T, httpStatus int, body string) *FortiClient {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		fmt.Fprint(w, body)
	}))
	t.Cleanup(srv.Close)

	fc := NewFortiClient("127.0.0.1", 1)
	fc.BaseURL = srv.URL
	tr := fgTransport.Clone()
	tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	// Transport only — the cookie jar NewFortiClient created has to survive, because Login reads
	// the CSRF token out of it.
	fc.httpClient.Transport = tr
	t.Cleanup(tr.CloseIdleConnections)
	return fc
}

func TestDeviceErrorIsReportedEvenOnA200StatusLine(t *testing.T) {
	// The shape this exists for. Everything about the body says the device refused; only the
	// status line says 200. Before, this returned (response, nil) and the caller decoded an empty
	// `results` into an empty list.
	fc := jsonDevice(t, http.StatusOK, `{
		"http_method":"GET",
		"status":"error",
		"http_status":500,
		"error":-8,
		"cli_error":"__convert_cmdb_value: invalid ip address not-an-ip.\n",
		"results":[]
	}`)

	resp, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
	if err == nil {
		t.Fatalf("a device that said status=error was treated as success (results=%s)", resp.Results)
	}
	// The CLI parser error is the half a person can act on; the numeric code is not.
	if !strings.Contains(err.Error(), "invalid ip address") {
		t.Errorf("error text = %q, want the device's own cli_error in it", err)
	}
}

func TestSuccessIsStillSuccess(t *testing.T) {
	// The change must not turn working reads into errors — this is the ordinary answer to every
	// list endpoint in the console.
	fc := jsonDevice(t, http.StatusOK, `{"status":"success","http_status":200,"results":[{"name":"all"}]}`)

	resp, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
	if err != nil {
		t.Fatalf("a successful read was rejected: %v", err)
	}
	if !strings.Contains(string(resp.Results), "all") {
		t.Errorf("results = %s, want the device's rows passed through untouched", resp.Results)
	}
}

func TestAResponseWithNoStatusFieldIsNotAFailure(t *testing.T) {
	// Not every monitor endpoint sends `status`. Absent must read as "nothing said", never as
	// failure, or a working call becomes an error the moment it is pointed at one of them. This is
	// the same rule ParseTrafficLog applies to the log API's envelope.
	fc := jsonDevice(t, http.StatusOK, `{"http_method":"GET","results":{"model":"FGT80E"}}`)

	if _, err := fc.do("GET", "/api/v2/monitor/system/status", nil); err != nil {
		t.Errorf("a response without a status field was treated as an error: %v", err)
	}
}

func TestErrorStatusIsMatchedRegardlessOfCase(t *testing.T) {
	fc := jsonDevice(t, http.StatusOK, `{"status":"Error","http_status":500,"error":-3}`)

	if _, err := fc.do("GET", "/api/v2/cmdb/firewall/policy", nil); err == nil {
		t.Error(`status "Error" was not recognised — the comparison must not depend on the device's capitalisation`)
	}
}

func TestANonJSONBodyIsNotMistakenForAnAnswer(t *testing.T) {
	// FortiOS serves the HTML login page instead of JSON when the session is gone, and a trusted-
	// host block answers 403 the same way. Both have to become errors with something a person can
	// act on, because "the body did not parse" on its own tells nobody anything.
	for _, tc := range []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{"session expired", http.StatusUnauthorized, "<html><body>login</body></html>", "401"},
		{"trusted host block", http.StatusForbidden, "<html><body>denied</body></html>", "403"},
		{"garbage", http.StatusOK, "not json at all", "unexpected response"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fc := jsonDevice(t, tc.status, tc.body)
			_, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
			if err == nil {
				t.Fatal("a non-JSON body was accepted as a successful response")
			}
			if !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %q, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestA401StillTriggersTheSingleReplay(t *testing.T) {
	// The stricter status check sits on the same path as the re-authenticate-and-replay, so this
	// pins that they did not collide: a session that expired must still be renewed once and the
	// call replayed, rather than the new check turning it into a hard error.
	var calls int
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/logincheck" {
			fmt.Fprint(w, "1")
			return
		}
		calls++
		w.Header().Set("Content-Type", "application/json")
		if calls == 1 {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprint(w, `{"status":"error","http_status":401}`)
			return
		}
		fmt.Fprint(w, `{"status":"success","http_status":200,"results":[]}`)
	}))
	t.Cleanup(srv.Close)

	fc := NewFortiClient("127.0.0.1", 1)
	fc.BaseURL = srv.URL
	tr := fgTransport.Clone()
	tr.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	fc.httpClient.Transport = tr
	t.Cleanup(tr.CloseIdleConnections)
	fc.EnableReauth("admin", "pw")

	if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
		t.Fatalf("an expired session was not renewed and replayed: %v", err)
	}
	if calls != 2 {
		t.Errorf("device calls = %d, want 2 (the 401 and the replay) — exactly once, never a loop", calls)
	}
}
