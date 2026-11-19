package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A live full-system check found that FortiOS can answer a validation failure on
// POST firewall/ssl-ssh-profile (e.g. -651 "Must set at least one port or enable ssl inspect-all")
// while having created the object anyway, with none of the requested settings. The caller is told
// "create failed", and a retry under the same name then fails again with "already exists" — for an
// object the caller has no idea is there. CreateSSLSSHProfile now checks for exactly that and
// deletes the orphan before returning the original error. These tests pin that with a small custom
// mock (fakeFortiGate's shared helper always answers "success", so a dedicated server is needed
// here to make the POST fail on purpose).

// sslOrphanServer answers POST with a device-style failure, GET for `name` with `getBody`, and
// records every request's method+path.
func sslOrphanServer(t *testing.T, getBody string) (*FortiClient, *[]string, func()) {
	t.Helper()
	var calls []string
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.Method+" "+r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		switch r.Method {
		case http.MethodPost:
			json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
				"status": "error", "http_status": 500, "error": -651,
				"cli_error": "Must set at least one port or enable ssl inspect-all",
			})
		case http.MethodGet:
			w.Write([]byte(getBody)) //nolint:errcheck
		case http.MethodDelete:
			json.NewEncoder(w).Encode(map[string]interface{}{"status": "success", "http_status": 200}) //nolint:errcheck
		}
	}))
	fc := newTestClient(srv.URL, srv.Client())
	return fc, &calls, srv.Close
}

func TestCreateSSLSSHProfile_CleansUpAnOrphanLeftByAFailedCreate(t *testing.T) {
	// The device answers the failed POST's follow-up GET with the object anyway — the orphan.
	getBody := `{"status":"success","http_status":200,"results":[{"name":"clduat_orphan"}]}`
	fc, calls, done := sslOrphanServer(t, getBody)
	defer done()

	err := fc.CreateSSLSSHProfile(SSLSSHProfileForm{Name: "clduat_orphan"})
	if err == nil {
		t.Fatal("expected the original create error to be returned")
	}

	var sawGet, sawDelete bool
	for _, c := range *calls {
		if strings.HasPrefix(c, "GET ") {
			sawGet = true
		}
		if strings.HasPrefix(c, "DELETE ") {
			sawDelete = true
		}
	}
	if !sawGet {
		t.Error("expected a follow-up GET to check whether the device created the object anyway")
	}
	if !sawDelete {
		t.Error("expected the orphan to be deleted once the GET confirmed it exists")
	}
}

func TestCreateSSLSSHProfile_NoCleanupWhenTheCreateWasGenuinelyRejected(t *testing.T) {
	// The ordinary case: the device really did refuse the create, so the follow-up GET finds
	// nothing — no DELETE should ever be sent for an object that was never there.
	getBody := `{"status":"success","http_status":200,"results":[]}`
	fc, calls, done := sslOrphanServer(t, getBody)
	defer done()

	err := fc.CreateSSLSSHProfile(SSLSSHProfileForm{Name: "clduat_notcreated"})
	if err == nil {
		t.Fatal("expected the create error to be returned")
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "DELETE ") {
			t.Fatalf("no DELETE should be sent when the object was never created, calls = %v", *calls)
		}
	}
}
