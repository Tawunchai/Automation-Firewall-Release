package services

import (
	"encoding/json"
	"io"
	"log"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sync"
	"testing"
	"time"
)

// GetVPNWizardMetadata used to make its five probes one after another, so it cost the SUM of five
// round trips — 1.11s against the lab FGT80E, the slowest call behind the VPN wizard. They are
// independent (no probe reads another's answer), so they now run together.
//
// That change is only safe if two things hold, and both are tested here:
//
//	1. the probes really do overlap — otherwise the refactor moved code and bought nothing
//	2. the assembled struct does not depend on which goroutine finished first
//
// The second is the one that could be silently wrong. Concurrency bugs of this shape do not fail
// loudly; they mislabel a field, and on this page a mislabelled field is a certificate picker
// listing CAs, or a Local Gateway prefilled from the wrong probe.

// vpnMetaFake answers the five VPN-metadata endpoints. Each body is settable so a test can pin
// exactly which probe produced which field.
type vpnMetaFake struct {
	certs     interface{}
	cas       interface{}
	lookup    interface{}
	groups    interface{}
	l2tp      interface{}
	failPaths map[string]bool // paths answered with a 500 instead

	// onRequest runs before the response is written, for the concurrency barrier.
	onRequest func(path string)
}

func (v *vpnMetaFake) body(path string) (interface{}, bool) {
	switch path {
	case "/api/v2/monitor/system/available-certificates":
		return v.certs, true
	case "/api/v2/cmdb/vpn.certificate/ca":
		return v.cas, true
	case "/api/v2/monitor/router/lookup":
		return v.lookup, true
	case "/api/v2/cmdb/user/group":
		return v.groups, true
	case "/api/v2/cmdb/vpn/l2tp":
		return v.l2tp, true
	}
	return nil, false
}

func newVPNMetaFake(t *testing.T, v *vpnMetaFake) *FortiClient {
	t.Helper()
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if v.onRequest != nil {
			v.onRequest(r.URL.Path)
		}
		if v.failPaths[r.URL.Path] {
			http.Error(w, "device says no", http.StatusInternalServerError)
			return
		}
		res, ok := v.body(r.URL.Path)
		if !ok {
			res = map[string]interface{}{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200, "results": res,
		})
	}))
	// Unstarted so the error log can be silenced BEFORE any connection exists — setting it on a
	// running server is a data race. Five concurrent probes per call means connections get torn
	// down mid-handshake at cleanup, and the resulting "use of closed network connection" lines are
	// noise that buries a real failure message in the test output.
	srv.Config.ErrorLog = log.New(io.Discard, "", 0)
	srv.StartTLS()
	t.Cleanup(srv.Close)
	return newTestClient(srv.URL, srv.Client())
}

// fullVPNMetaFake is a device with something in every field, so a test can tell the fields apart.
func fullVPNMetaFake() *vpnMetaFake {
	return &vpnMetaFake{
		certs: []map[string]interface{}{
			{"name": "Fortinet_Factory", "source": "factory"},
			{"name": "site-a-cert", "source": "user"},
			{"name": "", "source": "user"}, // unnamed rows are dropped
		},
		cas: []map[string]interface{}{
			{"name": "CA_Cert_1", "source": "factory"},
			{"name": "DigiCert_Global_Root_CA", "source": "bundle"}, // the 147-entry public bundle
			{"name": "corp-issuing-ca", "source": "user"},
		},
		lookup: map[string]interface{}{
			"success": true, "network": "0.0.0.0/0",
			"gateway": "10.0.99.254", "interface": "port1",
		},
		groups: []map[string]interface{}{
			{"name": "VPN-Users"}, {"name": "Guest-Group"}, {"name": ""},
		},
		l2tp: map[string]interface{}{
			"status": "enable", "sip": "10.10.20.1", "eip": "10.10.20.50", "usrgrp": "L2TP-Users",
		},
	}
}

// ── 1. the probes actually overlap ───────────────────────────────────────────

// Every probe blocks until all five are in flight at once. Run sequentially, the first request
// waits for four that will never be sent and the call never returns — so this fails on the old
// implementation by timing out, with a message saying how many probes made it.
//
// A barrier rather than a stopwatch: "concurrent code is faster" is a flaky assertion on a loaded
// CI box, while "five requests were open simultaneously" is a fact the handler can observe.
func TestGetVPNWizardMetadata_ProbesRunConcurrently(t *testing.T) {
	const probes = 5

	var (
		mu      sync.Mutex
		arrived int
		release = make(chan struct{})
		abort   = make(chan struct{})
	)

	fake := fullVPNMetaFake()
	fake.onRequest = func(string) {
		mu.Lock()
		arrived++
		if arrived == probes {
			close(release) // everyone is here — let them all answer
		}
		mu.Unlock()

		// `abort` is what keeps a FAILING run from hanging instead of reporting. On a sequential
		// implementation the barrier never opens, and httptest.Server.Close blocks on outstanding
		// requests — so an unbounded wait here would freeze the whole package in cleanup after the
		// deadline below had already decided the test failed.
		select {
		case <-release:
		case <-abort:
		}
	}

	fc := newVPNMetaFake(t, fake)
	// Registered after the server, so it runs BEFORE srv.Close (cleanups run last-added-first) and
	// the stuck handlers are released the moment the test ends.
	t.Cleanup(func() { close(abort) })

	done := make(chan FGVPNWizardMetadata, 1)
	go func() { done <- fc.GetVPNWizardMetadata() }()

	select {
	case meta := <-done:
		// The barrier could only have opened if all five were in flight together.
		if len(meta.Certificates) == 0 {
			t.Error("returned without reading certificates")
		}
	case <-time.After(5 * time.Second):
		mu.Lock()
		n := arrived
		mu.Unlock()
		t.Fatalf("the probes did not overlap: only %d of %d requests were in flight at once, so "+
			"they are still running one after another", n, probes)
	}
}

// The concurrency must not cost extra reads. One probe, one request — a retry loop or a duplicated
// closure would show up here as a count above five.
func TestGetVPNWizardMetadata_ReadsEachEndpointExactlyOnce(t *testing.T) {
	var mu sync.Mutex
	seen := map[string]int{}

	fake := fullVPNMetaFake()
	fake.onRequest = func(path string) {
		mu.Lock()
		seen[path]++
		mu.Unlock()
	}
	fc := newVPNMetaFake(t, fake)

	fc.GetVPNWizardMetadata()

	want := []string{
		"/api/v2/monitor/system/available-certificates",
		"/api/v2/cmdb/vpn.certificate/ca",
		"/api/v2/monitor/router/lookup",
		"/api/v2/cmdb/user/group",
		"/api/v2/cmdb/vpn/l2tp",
	}
	mu.Lock()
	defer mu.Unlock()
	for _, p := range want {
		if seen[p] != 1 {
			t.Errorf("%s was read %d times, want exactly 1", p, seen[p])
		}
	}
	if len(seen) != len(want) {
		t.Errorf("read %d distinct endpoints, want %d: %v", len(seen), len(want), seen)
	}
}

// ── 2. the assembled struct is right, whoever finishes first ─────────────────

// Every field comes from its own probe, and each one lands where it belongs. Written as one
// whole-struct comparison rather than field-by-field assertions because the failure this guards
// against is a field being filled from the WRONG probe — which a per-field check that only looks
// at the field it expects to change will happily miss.
//
// The CA-bundle filter it also exercises has its own dedicated test next to the IPsec code
// (TestGetVPNWizardMetadata_FiltersTheCABundle); here it is one field among seven, checked for
// where it landed rather than for what it contains.
func TestGetVPNWizardMetadata_AssemblesEveryFieldFromItsOwnProbe(t *testing.T) {
	fc := newVPNMetaFake(t, fullVPNMetaFake())

	got := fc.GetVPNWizardMetadata()

	want := FGVPNWizardMetadata{
		Certificates:   []string{"Fortinet_Factory", "site-a-cert"},
		CACertificates: []string{"CA_Cert_1", "corp-issuing-ca"}, // the bundle entry is filtered out
		DefaultGateway: "10.0.99.254",
		UserGroups:     []string{"VPN-Users", "Guest-Group"},
		L2TPEnabled:    true,
		L2TPRange:      "10.10.20.1-10.10.20.50",
		L2TPUserGroup:  "L2TP-Users",
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("metadata mismatch\n got: %+v\nwant: %+v", got, want)
	}
}

// Goroutine scheduling varies run to run, so the same input is assembled repeatedly. A field
// written by the wrong goroutine, or a slice appended to from two of them, shows up as an answer
// that changes between iterations.
func TestGetVPNWizardMetadata_IsStableAcrossRuns(t *testing.T) {
	fc := newVPNMetaFake(t, fullVPNMetaFake())

	first := fc.GetVPNWizardMetadata()
	for i := 0; i < 30; i++ {
		if got := fc.GetVPNWizardMetadata(); !reflect.DeepEqual(got, first) {
			t.Fatalf("run %d differed from the first — the result depends on goroutine ordering"+
				"\n got: %+v\nwant: %+v", i+2, got, first)
		}
	}
}

// ── 3. degradation is still per-probe ────────────────────────────────────────

// A failing probe must leave its own field empty and nothing else. The wizard is built to open with
// an empty picker; it is not built to fail the page because one read did not answer.
func TestGetVPNWizardMetadata_OneFailedProbeDoesNotTakeTheOthersDown(t *testing.T) {
	for _, tc := range []struct {
		name   string
		path   string
		assert func(t *testing.T, m FGVPNWizardMetadata)
	}{
		{"certificates", "/api/v2/monitor/system/available-certificates", func(t *testing.T, m FGVPNWizardMetadata) {
			if m.Certificates != nil {
				t.Errorf("Certificates = %v, want nil", m.Certificates)
			}
		}},
		{"peer CAs", "/api/v2/cmdb/vpn.certificate/ca", func(t *testing.T, m FGVPNWizardMetadata) {
			if m.CACertificates != nil {
				t.Errorf("CACertificates = %v, want nil", m.CACertificates)
			}
		}},
		{"router lookup", "/api/v2/monitor/router/lookup", func(t *testing.T, m FGVPNWizardMetadata) {
			if m.DefaultGateway != "" {
				t.Errorf("DefaultGateway = %q, want empty", m.DefaultGateway)
			}
		}},
		{"user groups", "/api/v2/cmdb/user/group", func(t *testing.T, m FGVPNWizardMetadata) {
			if m.UserGroups != nil {
				t.Errorf("UserGroups = %v, want nil", m.UserGroups)
			}
		}},
		{"L2TP singleton", "/api/v2/cmdb/vpn/l2tp", func(t *testing.T, m FGVPNWizardMetadata) {
			if m.L2TPEnabled || m.L2TPRange != "" || m.L2TPUserGroup != "" {
				t.Errorf("L2TP fields = %v/%q/%q, want the zero value",
					m.L2TPEnabled, m.L2TPRange, m.L2TPUserGroup)
			}
		}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fake := fullVPNMetaFake()
			fake.failPaths = map[string]bool{tc.path: true}
			fc := newVPNMetaFake(t, fake)

			got := fc.GetVPNWizardMetadata()

			tc.assert(t, got)

			// Everything else still has to arrive — that is the whole point of best-effort.
			if tc.path != "/api/v2/monitor/system/available-certificates" && len(got.Certificates) == 0 {
				t.Error("a failure in one probe emptied the certificate list too")
			}
			if tc.path != "/api/v2/cmdb/user/group" && len(got.UserGroups) == 0 {
				t.Error("a failure in one probe emptied the user groups too")
			}
		})
	}
}

// ── 4. the two answers that mean "nothing to prefill" ────────────────────────

// 0.0.0.0 is how the device reports a directly-connected network — it is not a gateway anyone can
// dial, so it must not be prefilled into Local Gateway as if it were one.
func TestGetVPNWizardMetadata_DirectlyConnectedGatewayIsNotOffered(t *testing.T) {
	fake := fullVPNMetaFake()
	fake.lookup = map[string]interface{}{
		"success": true, "network": "10.0.99.0/24", "gateway": "0.0.0.0", "interface": "port1",
	}
	fc := newVPNMetaFake(t, fake)

	if got := fc.GetVPNWizardMetadata().DefaultGateway; got != "" {
		t.Errorf("DefaultGateway = %q, want empty: 0.0.0.0 means directly connected, not a gateway", got)
	}
}

// A disabled singleton is the zero value, so the wizard shows no "this replaces X" warning. The
// range and group the device still holds from a previous configuration must not leak through.
func TestGetVPNWizardMetadata_DisabledL2TPReportsNothingToReplace(t *testing.T) {
	fake := fullVPNMetaFake()
	fake.l2tp = map[string]interface{}{
		"status": "disable", "sip": "10.10.20.1", "eip": "10.10.20.50", "usrgrp": "L2TP-Users",
	}
	fc := newVPNMetaFake(t, fake)

	got := fc.GetVPNWizardMetadata()
	if got.L2TPEnabled {
		t.Error("L2TPEnabled = true for a disabled singleton")
	}
	if got.L2TPRange != "" || got.L2TPUserGroup != "" {
		t.Errorf("stale range/group leaked through: %q / %q", got.L2TPRange, got.L2TPUserGroup)
	}
}
