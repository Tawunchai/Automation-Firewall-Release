package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// The metadata caches are the one change in this batch that can be WRONG rather than merely slow:
// caching a list a user can add to would show them a picker missing the object they just created,
// which breaks the rule the whole app is built on ("reuse before create").
//
// So these tests are split in two, and the second half matters more than the first:
//
//	1. the firmware data really is cached (the speed-up happens)
//	2. everything a user can change is NOT cached (nothing goes stale)

func resetMetadataCaches(t *testing.T) {
	t.Helper()
	invalidateDeviceMetadataCache()
	t.Cleanup(invalidateDeviceMetadataCache)
}

// metaFakeDevice answers the metadata endpoints and counts each one separately, so a test can say
// exactly which reads reached the device.
type metaFakeDevice struct {
	categories, licence, localCat, userGroups, profiles, external, fileTypes int32
}

func newMetaFake(t *testing.T) (*FortiClient, *metaFakeDevice) {
	t.Helper()
	f := &metaFakeDevice{}
	counters := map[string]*int32{
		"/api/v2/monitor/webfilter/fortiguard-categories": &f.categories,
		"/api/v2/monitor/license/status":                  &f.licence,
		"/api/v2/cmdb/webfilter/ftgd-local-cat":           &f.localCat,
		"/api/v2/cmdb/user/group":                         &f.userGroups,
		"/api/v2/cmdb/webfilter/profile":                  &f.profiles,
		"/api/v2/cmdb/system/external-resource":           &f.external,
		"/api/v2/cmdb/antivirus/filetype":                 &f.fileTypes,
	}
	bodies := map[string]interface{}{
		"GET /api/v2/monitor/webfilter/fortiguard-categories": []map[string]interface{}{
			{"id": 1, "name": "Drug Abuse", "group": "Potentially Liable", "group_id": 1},
			{"id": 2, "name": "Hacking", "group": "Potentially Liable", "group_id": 1},
		},
		"GET /api/v2/monitor/license/status": map[string]interface{}{
			"web_filtering": map[string]interface{}{"status": "licensed"},
			"botnet_domain": map[string]interface{}{"status": "expired"},
		},
		"GET /api/v2/cmdb/webfilter/ftgd-local-cat": []map[string]interface{}{{"id": 140, "desc": "Company-Blocked"}},
		"GET /api/v2/cmdb/user/group":               []map[string]interface{}{{"name": "Guest-Group"}},
		"GET /api/v2/cmdb/webfilter/profile":        []map[string]interface{}{{"name": "default"}, {"name": "strict"}},
		"GET /api/v2/cmdb/system/external-resource": []map[string]interface{}{{"name": "feed-a", "type": "address"}},
		"GET /api/v2/cmdb/antivirus/filetype":       []map[string]interface{}{{"name": "7z"}, {"name": "pdf"}, {"name": "zip"}},
	}

	fc, done := fakeFortiGateCounting(t, bodies, counters)
	t.Cleanup(done)
	return fc, f
}

// fakeFortiGateCounting is fakeFortiGate plus a per-path hit counter, which is the only way to
// assert "this endpoint was NOT called again".
func fakeFortiGateCounting(t *testing.T, bodies map[string]interface{}, counters map[string]*int32) (*FortiClient, func()) {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if c, ok := counters[r.URL.Path]; ok {
			atomic.AddInt32(c, 1)
		}
		res, ok := bodies[r.Method+" "+r.URL.Path]
		if !ok {
			res = map[string]interface{}{}
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200, "results": res,
		})
	}))
	fc := newTestClient(srv.URL, srv.Client())
	return fc, srv.Close
}

// fakeFortiGateDynamic lets a test change what the device answers between calls — the only way to
// prove a list is NOT cached.
func fakeFortiGateDynamic(t *testing.T, answer func(method, path string) interface{}) (*FortiClient, *[]fgCall, func()) {
	t.Helper()
	calls := &[]fgCall{}
	var mu sync.Mutex
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		*calls = append(*calls, fgCall{Method: r.Method, Path: r.URL.RequestURI()})
		mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{ //nolint:errcheck
			"status": "success", "http_status": 200, "results": answer(r.Method, r.URL.Path),
		})
	}))
	fc := newTestClient(srv.URL, srv.Client())
	return fc, calls, srv.Close
}

// ── 1. the firmware data is cached ───────────────────────────────────────────

// The FortiGuard taxonomy ships with the firmware. Opening the Web Filter form five times must not
// download it five times.
func TestMetadataCache_CategoriesFetchedOnce(t *testing.T) {
	resetMetadataCaches(t)
	fc, fake := newMetaFake(t)

	for i := 0; i < 5; i++ {
		if got := fc.GetWebFilterMetadata(""); len(got.Categories) == 0 {
			t.Fatalf("call %d returned no categories", i)
		}
	}

	if got := atomic.LoadInt32(&fake.categories); got != 1 {
		t.Errorf("category reads = %d, want 1 — this is firmware data", got)
	}
}

// Web Filter and DNS Filter read the SAME taxonomy and the SAME licence table. Opening one form
// after the other should cost nothing the second time.
func TestMetadataCache_SharedBetweenWebAndDNSFilterForms(t *testing.T) {
	resetMetadataCaches(t)
	fc, fake := newMetaFake(t)

	fc.GetWebFilterMetadata("")
	fc.GetDNSFilterMetadata()

	if got := atomic.LoadInt32(&fake.categories); got != 1 {
		t.Errorf("category reads = %d across both forms, want 1", got)
	}
	if got := atomic.LoadInt32(&fake.licence); got != 1 {
		t.Errorf("licence reads = %d across both forms, want 1", got)
	}
}

func TestMetadataCache_FileTypeCatalogueFetchedOnce(t *testing.T) {
	resetMetadataCaches(t)
	fc, fake := newMetaFake(t)

	for i := 0; i < 3; i++ {
		if got := fc.GetFileFilterMetadata(); len(got.FileTypes) != 3 {
			t.Fatalf("call %d returned %d file types, want 3", i, len(got.FileTypes))
		}
	}
	if got := atomic.LoadInt32(&fake.fileTypes); got != 1 {
		t.Errorf("file-type reads = %d, want 1", got)
	}
}

// ── 2. nothing a user can change is cached ───────────────────────────────────

// This is the test that protects "reuse before create". Every list below is something the user can
// add to from inside this very app; if any of them were cached, the picker would not show the
// object they just made.
func TestMetadataCache_UserEditableListsStayLive(t *testing.T) {
	resetMetadataCaches(t)
	fc, fake := newMetaFake(t)

	const opens = 4
	for i := 0; i < opens; i++ {
		fc.GetWebFilterMetadata("")
		fc.GetDNSFilterMetadata()
	}

	live := []struct {
		name  string
		count *int32
		want  int32
	}{
		{"local categories (webfilter/ftgd-local-cat)", &fake.localCat, opens},
		{"user groups (user/group)", &fake.userGroups, opens},
		{"other web filter profiles (webfilter/profile)", &fake.profiles, opens},
		{"external resources (system/external-resource)", &fake.external, opens},
	}
	for _, l := range live {
		if got := atomic.LoadInt32(l.count); got != l.want {
			t.Errorf("%s read %d times over %d form opens, want %d — a user can create these, so they must NOT be cached",
				l.name, got, opens, l.want)
		}
	}
}

// A profile created a moment ago must appear in the next form's picker. Same guarantee as above,
// stated as the user-visible behaviour rather than as a call count.
func TestMetadataCache_NewlyCreatedProfileAppearsImmediately(t *testing.T) {
	resetMetadataCaches(t)

	profiles := []map[string]interface{}{{"name": "default"}}
	var mu = make(chan struct{}, 1)
	mu <- struct{}{}

	fc, _, done := fakeFortiGateDynamic(t, func(method, path string) interface{} {
		switch path {
		case "/api/v2/cmdb/webfilter/profile":
			<-mu
			out := append([]map[string]interface{}(nil), profiles...)
			mu <- struct{}{}
			return out
		case "/api/v2/monitor/webfilter/fortiguard-categories":
			return []map[string]interface{}{{"id": 1, "name": "Drug Abuse"}}
		}
		return map[string]interface{}{}
	})
	defer done()

	if got := fc.GetWebFilterMetadata("").Profiles; len(got) != 1 {
		t.Fatalf("first open listed %v, want 1 profile", got)
	}

	// The user creates one.
	<-mu
	profiles = append(profiles, map[string]interface{}{"name": "brand-new"})
	mu <- struct{}{}

	got := fc.GetWebFilterMetadata("").Profiles
	if len(got) != 2 || !contains(got, "brand-new") {
		t.Errorf("second open listed %v — a profile created between opens must show up", got)
	}
}

// ── the cache mechanics ──────────────────────────────────────────────────────

// A failed read must not be cached: one unreachable moment would otherwise leave the form empty
// for the whole TTL, long after the device came back.
func TestMetadataCache_DoesNotCacheAnEmptyAnswer(t *testing.T) {
	resetMetadataCaches(t)

	var attempts int32
	empty := true
	fc, _, done := fakeFortiGateDynamic(t, func(method, path string) interface{} {
		if path == "/api/v2/monitor/webfilter/fortiguard-categories" {
			atomic.AddInt32(&attempts, 1)
			if empty {
				return []map[string]interface{}{} // the device answered, with nothing
			}
			return []map[string]interface{}{{"id": 1, "name": "Drug Abuse"}}
		}
		return map[string]interface{}{}
	})
	defer done()

	if got := fc.fortiguardCategories(); len(got) != 0 {
		t.Fatalf("expected no categories on the first read, got %d", len(got))
	}
	empty = false
	if got := fc.fortiguardCategories(); len(got) != 1 {
		t.Errorf("second read returned %d categories — an empty answer was cached", len(got))
	}
	if got := atomic.LoadInt32(&attempts); got != 2 {
		t.Errorf("device was asked %d times, want 2 — an empty answer must be retried", got)
	}
}

// The caller gets a copy. Without this, a caller that sorted or appended to the result would
// silently rewrite what every later form open receives.
func TestMetadataCache_ReturnsACopy(t *testing.T) {
	resetMetadataCaches(t)
	fc, _ := newMetaFake(t)

	first := fc.fortiguardCategories()
	if len(first) < 2 {
		t.Fatalf("need at least 2 categories to mutate, got %d", len(first))
	}
	first[0].Name = "MUTATED"
	first = append(first, FGWebFilterCategory{ID: 999, Name: "injected"})
	_ = first

	second := fc.fortiguardCategories()
	if second[0].Name == "MUTATED" {
		t.Error("mutating the returned slice changed the cached value")
	}
	if len(second) != 2 {
		t.Errorf("cached slice grew to %d entries after a caller appended to its copy", len(second))
	}
}

// Same for the licence map, where the risk is worse: a map is a reference, so one write would be
// visible to every later reader.
func TestMetadataCache_LicenceMapIsCopied(t *testing.T) {
	resetMetadataCaches(t)
	fc, _ := newMetaFake(t)

	first := fc.licenseStatuses()
	if !first["web_filtering"] {
		t.Fatalf("expected web_filtering licensed in the fixture, got %v", first)
	}
	first["web_filtering"] = false
	first["injected"] = true

	second := fc.licenseStatuses()
	if !second["web_filtering"] {
		t.Error("mutating the returned map changed the cached licence state")
	}
	if second["injected"] {
		t.Error("a key added by one caller leaked into the cache")
	}
}

// Two devices must never share an entry — one firewall's categories are not another's.
func TestMetadataCache_IsPerDevice(t *testing.T) {
	resetMetadataCaches(t)
	fcA, fakeA := newMetaFake(t)
	fcB, fakeB := newMetaFake(t)

	fcA.fortiguardCategories()
	fcA.fortiguardCategories()
	fcB.fortiguardCategories()

	if got := atomic.LoadInt32(&fakeA.categories); got != 1 {
		t.Errorf("device A read %d times, want 1", got)
	}
	if got := atomic.LoadInt32(&fakeB.categories); got != 1 {
		t.Errorf("device B read %d times, want 1 — it must not reuse A's entry", got)
	}
}

func TestMetadataCache_InvalidateForcesARefetch(t *testing.T) {
	resetMetadataCaches(t)
	fc, fake := newMetaFake(t)

	fc.fortiguardCategories()
	invalidateDeviceMetadataCache()
	fc.fortiguardCategories()

	if got := atomic.LoadInt32(&fake.categories); got != 2 {
		t.Errorf("category reads = %d, want 2 — invalidation must force a fresh read after a firmware upgrade", got)
	}
}

func TestMetadataCache_ExpiresWithTTL(t *testing.T) {
	c := newTTLCache[[]string](40 * time.Millisecond)
	c.put("dev", []string{"a"})

	if _, ok := c.get("dev"); !ok {
		t.Fatal("entry missing immediately after put")
	}
	time.Sleep(60 * time.Millisecond)
	if _, ok := c.get("dev"); ok {
		t.Error("entry survived past its TTL")
	}
	if n := c.len(); n != 0 {
		t.Errorf("len() = %d, want 0 — expired entries must not be counted", n)
	}
}

// The TTLs encode a judgement and it should not drift by accident: firmware data is allowed to be
// stale for a long time, a licence is not.
func TestMetadataCache_TTLsMatchTheirRisk(t *testing.T) {
	if licenceTTL >= firmwareDataTTL {
		t.Errorf("licenceTTL (%s) must be shorter than firmwareDataTTL (%s) — a contract can be activated mid-session",
			licenceTTL, firmwareDataTTL)
	}
	if firmwareDataTTL > time.Hour {
		t.Errorf("firmwareDataTTL = %s; longer than an hour makes a firmware upgrade invisible for too long", firmwareDataTTL)
	}
}

func contains(list []string, want string) bool {
	for _, s := range list {
		if strings.EqualFold(s, want) {
			return true
		}
	}
	return false
}
