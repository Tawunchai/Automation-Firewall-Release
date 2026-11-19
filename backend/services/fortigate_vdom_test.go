package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Multi-VDOM. The tests are about the threading, because that is where the damage would be: a VDOM
// that leaks between handles means one request reading another tenant's rule base.

func TestVDOMParam_DefaultsToRoot(t *testing.T) {
	f := &FortiClient{}
	if got := f.vdomParam("/api/v2/cmdb/firewall/policy"); got != "/api/v2/cmdb/firewall/policy?vdom=root" {
		t.Errorf("= %q", got)
	}
	if got := f.vdomParam("/api/v2/cmdb/firewall/policy?with_meta=1"); !strings.HasSuffix(got, "&vdom=root") {
		t.Errorf("= %q", got)
	}
}

func TestVDOMParam_UsesTheHandlesVDOM(t *testing.T) {
	f := (&FortiClient{}).WithVDOM("sales")
	if got := f.vdomParam("/api/v2/cmdb/firewall/policy"); got != "/api/v2/cmdb/firewall/policy?vdom=sales" {
		t.Errorf("= %q", got)
	}
}

// A path that already names a VDOM was built deliberately — the schema reads do this.
func TestVDOMParam_LeavesAnExplicitVDOMAlone(t *testing.T) {
	f := (&FortiClient{}).WithVDOM("sales")
	const p = "/api/v2/cmdb/firewall/policy?action=schema&vdom=root"
	if got := f.vdomParam(p); got != p {
		t.Errorf("= %q", got)
	}
}

// ⚠️ The property the whole design rests on. The session is SHARED by every request holding it out
// of the pool, so a VDOM stored on the session would let one request's choice of tenant change
// another's mid-flight. WithVDOM must return a new handle and leave the original alone.
func TestWithVDOM_DoesNotAffectTheOriginalHandle(t *testing.T) {
	root := &FortiClient{BaseURL: "https://fw", s: &fortiSession{}}
	sales := root.WithVDOM("sales")

	if root.VDOM() != "root" {
		t.Errorf("the original handle changed to %q", root.VDOM())
	}
	if sales.VDOM() != "sales" {
		t.Errorf("the copy targets %q", sales.VDOM())
	}
	// The session itself is shared, which is what makes a re-login through either handle count
	// for both.
	if root.s != sales.s {
		t.Error("WithVDOM copied the session — a re-login through one handle would not reach the other")
	}
}

// Two handles used concurrently must each keep their own VDOM.
func TestWithVDOM_ConcurrentHandlesDoNotBleed(t *testing.T) {
	base := &FortiClient{s: &fortiSession{}}
	names := []string{"root", "sales", "eng", "guest"}

	var wg sync.WaitGroup
	bad := make([]string, len(names))
	for i, n := range names {
		wg.Add(1)
		go func(i int, n string) {
			defer wg.Done()
			h := base.WithVDOM(n)
			for j := 0; j < 200; j++ {
				if !strings.HasSuffix(h.vdomParam("/x"), "vdom="+n) {
					bad[i] = n
					return
				}
			}
		}(i, n)
	}
	wg.Wait()
	for _, b := range bad {
		if b != "" {
			t.Fatalf("handle for %q saw another handle's VDOM", b)
		}
	}
}

// An empty name is "no opinion", and must not become "send no vdom at all" — which on a split unit
// means the MANAGEMENT VDOM, a different answer arrived at by accident.
func TestWithVDOM_EmptyIsANoOp(t *testing.T) {
	f := (&FortiClient{}).WithVDOM("sales").WithVDOM("")
	if f.VDOM() != "sales" {
		t.Errorf("an empty name cleared the VDOM to %q", f.VDOM())
	}
}

// ─── the list ────────────────────────────────────────────────────────────────

func TestGetVDOMs_SingleVDOMUnit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "system/global") {
			_, _ = w.Write([]byte(`{"results":{"management-vdom":"root","vdom-mode":"no-vdom"},"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"root","short-name":"root"}],"status":"success"}`))
	}))
	defer srv.Close()

	got, err := newTestClient(srv.URL, srv.Client()).GetVDOMs()
	if err != nil {
		t.Fatalf("GetVDOMs: %v", err)
	}
	if len(got) != 1 || got[0].Name != "root" {
		t.Fatalf("= %#v", got)
	}
	// One VDOM named root IS the honest answer, and MultiVDOM false is what tells the UI not to
	// draw a picker with one option on a unit that has no choice to make.
	if got[0].MultiVDOM {
		t.Error("a no-vdom unit was reported as split")
	}
	if !got[0].Management {
		t.Error("root was not marked as the management VDOM")
	}
}

func TestGetVDOMs_SplitUnit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "system/global") {
			_, _ = w.Write([]byte(`{"results":{"management-vdom":"root","vdom-mode":"multi-vdom"},"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"root","short-name":"root"},
			{"name":"sales","short-name":"sales"}],"status":"success"}`))
	}))
	defer srv.Close()

	got, _ := newTestClient(srv.URL, srv.Client()).GetVDOMs()
	if len(got) != 2 {
		t.Fatalf("= %#v", got)
	}
	if !got[0].MultiVDOM || !got[1].MultiVDOM {
		t.Error("a split unit was not reported as split")
	}
	if got[0].Management == got[1].Management {
		t.Error("exactly one VDOM should be the management one")
	}
}

// A firmware that adds a fourth mode word should make the picker APPEAR, not disappear.
func TestGetVDOMs_UnknownModeCountsAsSplit(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "system/global") {
			_, _ = w.Write([]byte(`{"results":{"management-vdom":"root","vdom-mode":"split-vdom"},"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"root"}],"status":"success"}`))
	}))
	defer srv.Close()

	got, _ := newTestClient(srv.URL, srv.Client()).GetVDOMs()
	if !got[0].MultiVDOM {
		t.Error("an unrecognised vdom-mode was read as single-VDOM")
	}
}

// A global read that fails must not stop the list: the VDOM table is still the truth about what
// exists, and the worst outcome is a picker that does not mark the management one.
func TestGetVDOMs_SurvivesAFailedGlobalRead(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "system/global") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":"error","http_status":500}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"root"},{"name":"sales"}],"status":"success"}`))
	}))
	defer srv.Close()

	got, err := newTestClient(srv.URL, srv.Client()).GetVDOMs()
	if err != nil || len(got) != 2 {
		t.Fatalf("err = %v, got %#v", err, got)
	}
}
