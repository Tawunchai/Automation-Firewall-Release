package services

import (
	"sync"
	"time"
)

// ── Not paying twice for the same answer ─────────────────────────────────────
//
// The advice is a function of three things: which device, which control, and what the firewall's
// configuration currently is. None of them changes when somebody closes the panel and opens it
// again, or opens the same control tomorrow morning to show a colleague — and each of those was a
// fresh model call, at 20-30 seconds and a couple of thousand tokens apiece.
//
// So it is keyed on the CONFIGURATION FINGERPRINT, not on a clock. That distinction is the whole
// design: a time-based cache would keep serving stale advice after somebody fixes a policy, and
// would expire perfectly good advice on a firewall nobody has touched in a month. The fingerprint
// already exists (audit_governance.go computes it per scan to detect changes made outside this
// console), and it moves exactly when the answer should stop being reused.
//
// A HIT IS DECLARED, NOT HIDDEN. The response says the advice was reused and when it was first
// produced. A reader who is shown a model's opinion has a right to know whether it was formed
// against the firewall as it is now — which, given the key, it was.
//
// IN MEMORY, BOUNDED, PROCESS-LOCAL. It is an optimisation, not a record: a restart loses it and
// the next click simply pays for one call. Nothing here is allowed to become a source of truth.

const (
	// adviceCacheMax bounds the map. A deployment watches a handful of devices and fourteen
	// controls; this is roomy and still cannot grow without limit.
	adviceCacheMax = 200
	// adviceCacheTTL is a backstop, not the invalidation mechanism — the fingerprint is. It exists
	// so a fingerprint that somehow never moves cannot pin an answer forever.
	adviceCacheTTL = 24 * time.Hour
)

type adviceKey struct {
	deviceID    uint
	controlID   string
	fingerprint string
}

type adviceEntry struct {
	advice RemediationAdvice
	at     time.Time
}

var adviceCache = struct {
	mu sync.Mutex
	m  map[adviceKey]adviceEntry
}{m: map[adviceKey]adviceEntry{}}

// CachedAdvice returns advice already produced for this exact device, control and configuration.
//
// An empty fingerprint is a miss, always: the scan could not identify the configuration, so there
// is nothing to prove the firewall has not moved since, and reusing an answer would be a guess.
func CachedAdvice(deviceID uint, controlID, fingerprint string) (*RemediationAdvice, time.Time, bool) {
	if fingerprint == "" {
		return nil, time.Time{}, false
	}
	key := adviceKey{deviceID, controlID, fingerprint}

	adviceCache.mu.Lock()
	defer adviceCache.mu.Unlock()

	e, ok := adviceCache.m[key]
	if !ok {
		return nil, time.Time{}, false
	}
	if time.Since(e.at) > adviceCacheTTL {
		delete(adviceCache.m, key)
		return nil, time.Time{}, false
	}
	advice := e.advice
	return &advice, e.at, true
}

// StoreAdvice remembers an answer against the configuration it was produced for.
func StoreAdvice(deviceID uint, controlID, fingerprint string, advice RemediationAdvice) {
	if fingerprint == "" {
		return
	}
	adviceCache.mu.Lock()
	defer adviceCache.mu.Unlock()

	// Bounded by eviction of the oldest. A strict LRU would need a second structure for a map that
	// holds a few hundred entries at most; this keeps the cost of the cache proportional to what it
	// saves.
	if len(adviceCache.m) >= adviceCacheMax {
		var oldestKey adviceKey
		var oldest time.Time
		for k, v := range adviceCache.m {
			if oldest.IsZero() || v.at.Before(oldest) {
				oldestKey, oldest = k, v.at
			}
		}
		delete(adviceCache.m, oldestKey)
	}
	adviceCache.m[adviceKey{deviceID, controlID, fingerprint}] = adviceEntry{advice: advice, at: time.Now().UTC()}
}

// resetAdviceCache exists for the tests. Nothing in the running product clears the cache: the
// fingerprint does that by moving.
func resetAdviceCache() {
	adviceCache.mu.Lock()
	defer adviceCache.mu.Unlock()
	adviceCache.m = map[adviceKey]adviceEntry{}
}
