package services

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// middleware.Authorizes runs on every authenticated request and used to issue TWO extra queries
// per non-admin caller — the maintenance flag and its grace timestamp — for a value that changes
// when an admin clicks a button. These tests pin the cache that replaced them: it must be fast on
// the common path, exact the moment the flag flips, and must never turn a database blip into a
// lockout.

// withStubbedMaintenanceLoad swaps the database read and guarantees a clean cache on both sides,
// so tests cannot leak state into each other through the package-level cache.
func withStubbedMaintenanceLoad(t *testing.T, load func(*gorm.DB) (MaintenanceState, error)) {
	t.Helper()
	original := loadMaintenanceState
	loadMaintenanceState = load
	InvalidateMaintenanceCache()
	t.Cleanup(func() {
		loadMaintenanceState = original
		InvalidateMaintenanceCache()
	})
}

// ── Row parsing ──────────────────────────────────────────────────────────────

func TestStateFromRows(t *testing.T) {
	row := func(k, v string) entity.SystemConfig { return entity.SystemConfig{Key: k, Value: v} }

	cases := []struct {
		name string
		rows []entity.SystemConfig
		want MaintenanceState
		why  string
	}{
		{"no rows at all", nil, MaintenanceState{},
			"maintenance mode has never been switched on"},
		{"disabled", []entity.SystemConfig{row(MaintenanceKey, "false")}, MaintenanceState{},
			"the flag is off"},
		{"enabled with grace",
			[]entity.SystemConfig{row(MaintenanceKey, "true"), row(MaintenanceActiveAtKey, "1700000000")},
			MaintenanceState{Enabled: true, ActiveAt: 1700000000},
			"both rows present is the normal enabled state"},
		{"enabled, grace row missing",
			[]entity.SystemConfig{row(MaintenanceKey, "true")},
			MaintenanceState{Enabled: true, ActiveAt: 0},
			"no grace timestamp must mean block now, not block never"},
		{"enabled, grace row unparseable",
			[]entity.SystemConfig{row(MaintenanceKey, "true"), row(MaintenanceActiveAtKey, "not-a-number")},
			MaintenanceState{Enabled: true, ActiveAt: 0},
			"a corrupt timestamp must fail towards blocking, not towards an open gate"},
		{"rows in either order",
			[]entity.SystemConfig{row(MaintenanceActiveAtKey, "42"), row(MaintenanceKey, "true")},
			MaintenanceState{Enabled: true, ActiveAt: 42},
			"a single query returns rows in no guaranteed order"},
		{"only anything-but-true counts as enabled",
			[]entity.SystemConfig{row(MaintenanceKey, "TRUE")}, MaintenanceState{},
			"the writer only ever stores lowercase \"true\"; anything else is off"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := stateFromRows(c.rows); got != c.want {
				t.Errorf("stateFromRows = %+v, want %+v — %s", got, c.want, c.why)
			}
		})
	}
}

// ── The blocking decision ────────────────────────────────────────────────────

func TestMaintenanceState_Blocking(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	cases := []struct {
		name  string
		state MaintenanceState
		want  bool
		why   string
	}{
		{"off", MaintenanceState{}, false, "nothing to block"},
		{"on, inside grace period",
			MaintenanceState{Enabled: true, ActiveAt: now.Unix() + 30}, false,
			"people already working get 60s to finish"},
		{"on, grace expired",
			MaintenanceState{Enabled: true, ActiveAt: now.Unix() - 1}, true,
			"after the grace period non-admins are refused"},
		{"on, grace boundary",
			MaintenanceState{Enabled: true, ActiveAt: now.Unix()}, true,
			"the instant the grace period ends, blocking starts"},
		{"on, no grace recorded",
			MaintenanceState{Enabled: true, ActiveAt: 0}, true,
			"a missing timestamp must not read as an infinite grace period"},
		{"off but grace in the future",
			MaintenanceState{Enabled: false, ActiveAt: now.Unix() + 999}, false,
			"a stale timestamp must never block while the flag is off"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.state.Blocking(now); got != c.want {
				t.Errorf("Blocking = %v, want %v — %s", got, c.want, c.why)
			}
		})
	}
}

func TestMaintenanceState_GraceSecondsRemaining(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)

	cases := []struct {
		name  string
		state MaintenanceState
		want  int
	}{
		{"off", MaintenanceState{ActiveAt: now.Unix() + 30}, 0},
		{"30s left", MaintenanceState{Enabled: true, ActiveAt: now.Unix() + 30}, 30},
		{"expired", MaintenanceState{Enabled: true, ActiveAt: now.Unix() - 10}, 0},
		{"exactly now", MaintenanceState{Enabled: true, ActiveAt: now.Unix()}, 0},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := c.state.GraceSecondsRemaining(now); got != c.want {
				t.Errorf("GraceSecondsRemaining = %d, want %d", got, c.want)
			}
		})
	}
}

// ── Cache behaviour ──────────────────────────────────────────────────────────

func TestMaintenanceStatus_CachesTheRead(t *testing.T) {
	var loads int32
	withStubbedMaintenanceLoad(t, func(*gorm.DB) (MaintenanceState, error) {
		atomic.AddInt32(&loads, 1)
		return MaintenanceState{Enabled: true, ActiveAt: 99}, nil
	})

	for i := 0; i < 25; i++ {
		state, err := MaintenanceStatus(nil)
		if err != nil {
			t.Fatalf("call %d: %v", i, err)
		}
		if !state.Enabled || state.ActiveAt != 99 {
			t.Fatalf("call %d returned %+v", i, state)
		}
	}

	if got := atomic.LoadInt32(&loads); got != 1 {
		t.Errorf("%d database reads for 25 requests — the whole point is that this is 1", got)
	}
}

// A flip must take effect on the NEXT request, not after the TTL. Toggle calls this.
func TestInvalidateMaintenanceCache_TakesEffectImmediately(t *testing.T) {
	var enabled atomic.Bool
	var loads int32
	withStubbedMaintenanceLoad(t, func(*gorm.DB) (MaintenanceState, error) {
		atomic.AddInt32(&loads, 1)
		return MaintenanceState{Enabled: enabled.Load()}, nil
	})

	if state, _ := MaintenanceStatus(nil); state.Enabled {
		t.Fatal("started enabled")
	}

	enabled.Store(true) // an admin flips the switch…
	if state, _ := MaintenanceStatus(nil); state.Enabled {
		t.Fatal("the cache was bypassed — this test would not prove anything")
	}

	InvalidateMaintenanceCache() // …and Toggle invalidates
	state, err := MaintenanceStatus(nil)
	if err != nil {
		t.Fatal(err)
	}
	if !state.Enabled {
		t.Error("maintenance mode did not take effect after invalidation — an admin would have " +
			"to wait out the TTL before the system was actually closed")
	}
	if got := atomic.LoadInt32(&loads); got != 2 {
		t.Errorf("%d reads, want 2 (one cold, one after invalidation)", got)
	}
}

// The TTL is the backstop for a change made outside Toggle — a second backend instance, or a
// hand-edited row. It must be well under the 60-second grace period.
func TestMaintenanceCacheTTL_IsShorterThanTheGracePeriod(t *testing.T) {
	const gracePeriod = 60 * time.Second
	if maintenanceCacheTTL >= gracePeriod {
		t.Errorf("maintenanceCacheTTL = %v; it must stay well under the %v grace period, or a "+
			"stale read could outlive the window in which nobody is blocked yet",
			maintenanceCacheTTL, gracePeriod)
	}
}

func TestMaintenanceStatus_RefreshesAfterTTL(t *testing.T) {
	var loads int32
	withStubbedMaintenanceLoad(t, func(*gorm.DB) (MaintenanceState, error) {
		atomic.AddInt32(&loads, 1)
		return MaintenanceState{}, nil
	})

	MaintenanceStatus(nil)

	// Age the cache past its TTL rather than sleeping for it.
	maintenanceCache.mu.Lock()
	maintenanceCache.loadedAt = maintenanceCache.loadedAt.Add(-2 * maintenanceCacheTTL)
	maintenanceCache.mu.Unlock()

	MaintenanceStatus(nil)

	if got := atomic.LoadInt32(&loads); got != 2 {
		t.Errorf("%d reads, want 2 — the cache must expire, or a change made outside Toggle "+
			"would never be picked up", got)
	}
}

// A database error must reach the caller so the middleware can fail OPEN, and must NOT be cached
// — caching it would stretch one blip into a full TTL of degraded behaviour.
func TestMaintenanceStatus_ErrorsAreReturnedAndNotCached(t *testing.T) {
	dbDown := errors.New("dial tcp: connection refused")
	var loads int32
	fail := true
	withStubbedMaintenanceLoad(t, func(*gorm.DB) (MaintenanceState, error) {
		atomic.AddInt32(&loads, 1)
		if fail {
			return MaintenanceState{}, dbDown
		}
		return MaintenanceState{Enabled: true}, nil
	})

	state, err := MaintenanceStatus(nil)
	if !errors.Is(err, dbDown) {
		t.Fatalf("error = %v, want the database error surfaced so the caller can fail open", err)
	}
	if state.Enabled {
		t.Error("a failed read returned Enabled=true — that would lock everyone out on a DB blip")
	}

	// Second call must retry rather than serve a cached failure.
	MaintenanceStatus(nil)
	if got := atomic.LoadInt32(&loads); got != 2 {
		t.Errorf("%d reads — a failure must not be cached", got)
	}

	fail = false
	if state, err := MaintenanceStatus(nil); err != nil || !state.Enabled {
		t.Errorf("recovery read = %+v, %v — the cache must recover once the DB is back", state, err)
	}
}

// Five parallel requests on a cold cache (what opening the Firewall Policy page produces) must
// collapse into ONE read, not five.
func TestMaintenanceStatus_ConcurrentCallersCollapseToOneRead(t *testing.T) {
	var loads int32
	withStubbedMaintenanceLoad(t, func(*gorm.DB) (MaintenanceState, error) {
		atomic.AddInt32(&loads, 1)
		time.Sleep(20 * time.Millisecond) // a real query is not instant
		return MaintenanceState{Enabled: true, ActiveAt: 7}, nil
	})

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if state, err := MaintenanceStatus(nil); err != nil || state.ActiveAt != 7 {
				t.Errorf("concurrent call got %+v, %v", state, err)
			}
		}()
	}
	wg.Wait()

	if got := atomic.LoadInt32(&loads); got != 1 {
		t.Errorf("%d reads for 20 concurrent callers — they must share one", got)
	}
}
