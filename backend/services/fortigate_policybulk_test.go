package services

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// Clone and bulk actions. Each test is one property the rule base depends on, not a happy path.

// recorder captures what was sent to the fake device, in order.
type recorder struct {
	mu   sync.Mutex
	hits []string // "METHOD path?query"
	body []string
}

func (r *recorder) add(req *http.Request) {
	b, _ := io.ReadAll(req.Body)
	r.mu.Lock()
	defer r.mu.Unlock()
	line := req.Method + " " + req.URL.Path
	if req.URL.RawQuery != "" {
		line += "?" + req.URL.RawQuery
	}
	r.hits = append(r.hits, line)
	r.body = append(r.body, string(b))
}

// ─── clone ───────────────────────────────────────────────────────────────────

// ⚠️ The property that matters most: a clone lands DISABLED.
//
// It is inserted into a first-match table. An enabled copy starts deciding traffic the moment it
// exists — before anyone has edited the one field they cloned it to change.
func TestClonePolicy_CopyIsDisabledAndCarriesNoPolicyID(t *testing.T) {
	rec := &recorder{}
	var posted FGPolicy

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.add(r)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/firewall/policy/5"):
			_, _ = w.Write([]byte(`{"results":[{"policyid":5,"name":"lan-to-wan","status":"enable",
				"action":"accept","nat":"enable","srcintf":[{"name":"internal1"}],
				"dstintf":[{"name":"wan1"}],"srcaddr":[{"name":"LAN"}],"dstaddr":[{"name":"all"}],
				"service":[{"name":"HTTPS"}],"schedule":"always","logtraffic":"all",
				"av-profile":"default","utm-status":"enable"}],"status":"success"}`))
		case r.Method == "POST":
			_ = json.Unmarshal([]byte(rec.body[len(rec.body)-1]), &posted)
			_, _ = w.Write([]byte(`{"mkey":9,"status":"success"}`))
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/firewall/policy/9"):
			_, _ = w.Write([]byte(`{"results":[{"policyid":9,"name":"lan-to-wan-copy","status":"disable"}],"status":"success"}`))
		default: // the move
			_, _ = w.Write([]byte(`{"status":"success"}`))
		}
	}))
	defer srv.Close()

	created, err := newTestClient(srv.URL, srv.Client()).ClonePolicy(5, "lan-to-wan-copy")
	if err != nil {
		t.Fatalf("ClonePolicy: %v", err)
	}
	if posted.Status != "disable" {
		t.Errorf("the copy was created with status %q — a clone must land disabled", posted.Status)
	}
	if posted.PolicyID != 0 {
		t.Errorf("policyid %d went out on the POST — sending the source's id overwrites the rule "+
			"it was meant to copy", posted.PolicyID)
	}
	if posted.Name != "lan-to-wan-copy" {
		t.Errorf("name = %q", posted.Name)
	}
	// Everything else is carried over, including fields no form in this console exposes.
	if posted.AVProfile != "default" || posted.UTMStatus != "enable" || posted.Schedule != "always" {
		t.Errorf("the copy lost fields from the original: %+v", posted)
	}
	if created == nil || created.PolicyID != 9 {
		t.Errorf("created = %+v", created)
	}
}

// The copy goes directly AFTER the original: anywhere else changes its meaning, because in a
// first-match table everything between the two now decides first.
func TestClonePolicy_MovesTheCopyBelowTheOriginal(t *testing.T) {
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.add(r)
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/firewall/policy/5"):
			_, _ = w.Write([]byte(`{"results":[{"policyid":5,"name":"src"}],"status":"success"}`))
		case r.Method == "POST":
			_, _ = w.Write([]byte(`{"mkey":9,"status":"success"}`))
		default:
			_, _ = w.Write([]byte(`{"results":[{"policyid":9,"name":"copy"}],"status":"success"}`))
		}
	}))
	defer srv.Close()

	if _, err := newTestClient(srv.URL, srv.Client()).ClonePolicy(5, "copy"); err != nil {
		t.Fatalf("ClonePolicy: %v", err)
	}
	found := false
	for _, h := range rec.hits {
		if strings.Contains(h, "action=move") && strings.Contains(h, "after=5") {
			found = true
		}
	}
	if !found {
		t.Errorf("no `action=move&after=5` was issued; calls were %v", rec.hits)
	}
}

// A move that fails is not a failed clone — the copy exists, and the caller has to be told where
// it ended up rather than being left thinking nothing happened.
func TestClonePolicy_FailedMoveStillReturnsTheCopy(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == "GET" && strings.HasSuffix(r.URL.Path, "/firewall/policy/5"):
			_, _ = w.Write([]byte(`{"results":[{"policyid":5,"name":"src"}],"status":"success"}`))
		case r.Method == "POST":
			_, _ = w.Write([]byte(`{"mkey":9,"status":"success"}`))
		case r.Method == "PUT": // the move
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"status":"error","http_status":400,"error":-8}`))
		default:
			_, _ = w.Write([]byte(`{"results":[{"policyid":9,"name":"copy"}],"status":"success"}`))
		}
	}))
	defer srv.Close()

	created, err := newTestClient(srv.URL, srv.Client()).ClonePolicy(5, "copy")
	if created == nil {
		t.Fatal("the copy exists on the device but nil was returned — the caller cannot tell the " +
			"operator that there is now an unplaced rule")
	}
	if err == nil {
		t.Error("a failed move was reported as a clean clone")
	}
}

// ─── bulk ────────────────────────────────────────────────────────────────────

// A partial failure is reported per policy, and the run does not stop at the first one. Rolling
// back would mean issuing more writes to a live firewall to undo writes that worked.
func TestBulkPolicyStatus_ReportsEachPolicySeparately(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.HasSuffix(r.URL.Path, "/2") {
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"status":"error","http_status":400,"error":-3}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	got := newTestClient(srv.URL, srv.Client()).BulkPolicyStatus([]int{1, 2, 3}, false)
	if len(got) != 3 {
		t.Fatalf("got %d results, want one per policy: %#v", len(got), got)
	}
	if !got[0].OK || got[1].OK || !got[2].OK {
		t.Errorf("results = %#v — policy 2 should be the only failure, and 3 must still be attempted", got)
	}
	if got[1].Error == "" {
		t.Error("the failing policy carries no error text")
	}
}

// Deleting bottom-up keeps the rows still to be deleted at the sequence positions the operator
// was looking at, so a partial failure leaves a table that still matches the screen.
func TestBulkDeletePolicies_DeletesHighestIDFirst(t *testing.T) {
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.add(r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	newTestClient(srv.URL, srv.Client()).BulkDeletePolicies([]int{3, 11, 7})

	var order []string
	for _, h := range rec.hits {
		path := strings.SplitN(h, "?", 2)[0] // do() appends ?vdom=root
		parts := strings.Split(path, "/")
		order = append(order, parts[len(parts)-1])
	}
	if len(order) != 3 || order[0] != "11" || order[1] != "7" || order[2] != "3" {
		t.Errorf("delete order = %v, want 11, 7, 3", order)
	}
}

// Every delete names an mkey. A DELETE at the collection URL empties the whole table, and this is
// the only place in the codebase that issues deletes in a loop.
func TestBulkDeletePolicies_NeverHitsTheCollectionURL(t *testing.T) {
	rec := &recorder{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.add(r)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	newTestClient(srv.URL, srv.Client()).BulkDeletePolicies([]int{1, 2})

	for _, h := range rec.hits {
		if strings.HasSuffix(h, "/api/v2/cmdb/firewall/policy") {
			t.Fatalf("a DELETE went to the collection URL (%s) — that empties the policy table", h)
		}
	}
	if len(rec.hits) != 2 {
		t.Errorf("issued %d calls for 2 policies: %v", len(rec.hits), rec.hits)
	}
}
