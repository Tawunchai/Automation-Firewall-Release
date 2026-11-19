package services

import (
	"sync"
	"time"
)

// Per-device caches for the parts of a FortiGate's answer that do not change while you are looking
// at them.
//
// WHAT MAY BE CACHED, AND WHAT MUST NOT
// This is the whole design decision, and getting it wrong shows up as a picker that does not list
// the object the user just created — which would break the rule the entire app is built on ("reuse
// before create"). So the line is drawn at the SOURCE of the data, not at the endpoint:
//
//	cacheable  the FortiGuard category taxonomy and the antivirus file-type catalogue — these ship
//	           with the firmware and the GUI cannot change them; the licence table, which changes
//	           only when a contract is activated or expires
//	NOT cached  every list of objects a user can create: profiles, address objects, user groups,
//	           local categories, external resources, schedules, policies. Those stay live on every
//	           request, exactly as before.
//
// Nothing here changes what a caller receives — only how often the device is asked.
//
// A cache miss under concurrency can fetch twice (two goroutines miss, both fetch, both store).
// That is deliberate: these are idempotent GETs, the duplicate is at most one extra read on a cold
// cache, and the alternative (singleflight) would add a lock held across a network call. The
// pre-existing application-signature cache in fortigate_appcontrol.go behaves the same way.

const (
	// firmwareDataTTL covers data that only a firmware or FortiGuard package update can change.
	// Half an hour matches the application-signature cache that came before this.
	firmwareDataTTL = 30 * time.Minute

	// licenceTTL is short because a licence really can flip during a session — someone activates
	// a contract and expects the "not licensed" banner to go away without restarting the backend.
	licenceTTL = 5 * time.Minute
)

type ttlEntry[T any] struct {
	val T
	at  time.Time
}

// ttlCache is a small keyed cache with a fixed expiry. Keyed by FortiClient.BaseURL, so two
// devices never share an entry and a device's data disappears with its URL.
type ttlCache[T any] struct {
	mu      sync.RWMutex
	ttl     time.Duration
	entries map[string]ttlEntry[T]
}

func newTTLCache[T any](ttl time.Duration) *ttlCache[T] {
	return &ttlCache[T]{ttl: ttl, entries: map[string]ttlEntry[T]{}}
}

func (c *ttlCache[T]) get(key string) (T, bool) {
	c.mu.RLock()
	e, ok := c.entries[key]
	c.mu.RUnlock()
	if !ok || time.Since(e.at) > c.ttl {
		var zero T
		return zero, false
	}
	return e.val, true
}

func (c *ttlCache[T]) put(key string, v T) {
	c.mu.Lock()
	c.entries[key] = ttlEntry[T]{val: v, at: time.Now()}
	c.mu.Unlock()
}

func (c *ttlCache[T]) clear() {
	c.mu.Lock()
	c.entries = map[string]ttlEntry[T]{}
	c.mu.Unlock()
}

func (c *ttlCache[T]) len() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	n := 0
	for _, e := range c.entries {
		if time.Since(e.at) <= c.ttl {
			n++
		}
	}
	return n
}

// cachedSlice returns key's cached value or calls fetch and stores it.
//
// An EMPTY result is never stored. Every fetcher here returns nil both when the device has nothing
// and when the call failed, and caching a failure for half an hour would turn one unreachable
// moment into a form that stays broken long after the device came back.
//
// The stored slice is copied on the way out so a caller that appends to or reorders the result
// cannot corrupt what the next caller sees. None does today; this makes that safe by construction
// rather than by convention.
func cachedSlice[T any](c *ttlCache[[]T], key string, fetch func() []T) []T {
	if v, ok := c.get(key); ok {
		return append([]T(nil), v...)
	}
	v := fetch()
	if len(v) == 0 {
		return v
	}
	c.put(key, v)
	return append([]T(nil), v...)
}

// cachedMap is cachedSlice for a map. The copy matters more here: a map is a reference, so without
// it a caller writing one key would silently rewrite every later reader's answer.
func cachedMap[V any](c *ttlCache[map[string]V], key string, fetch func() map[string]V) map[string]V {
	copyOf := func(m map[string]V) map[string]V {
		out := make(map[string]V, len(m))
		for k, v := range m {
			out[k] = v
		}
		return out
	}
	if v, ok := c.get(key); ok {
		return copyOf(v)
	}
	v := fetch()
	if len(v) == 0 {
		return v
	}
	c.put(key, v)
	return copyOf(v)
}

// The caches themselves. One per kind of data, because the TTLs differ for good reasons.
var (
	// fgCategoryCache — /api/v2/monitor/webfilter/fortiguard-categories. ~90 rows, identical for
	// every profile form on the device, read by BOTH the Web Filter and the DNS Filter metadata.
	fgCategoryCache = newTTLCache[[]FGWebFilterCategory](firmwareDataTTL)

	// fgLicenceCache — /api/v2/monitor/license/status. Read by both metadata builders too.
	fgLicenceCache = newTTLCache[map[string]bool](licenceTTL)

	// fgFileTypeCache — /api/v2/cmdb/antivirus/filetype. The 56-entry catalogue behind the File
	// Filter rule drawer; it is firmware data despite living under cmdb.
	fgFileTypeCache = newTTLCache[[]string](firmwareDataTTL)
)

// invalidateDeviceMetadataCache drops every cached firmware/licence answer for all devices.
//
// Call it after a firmware upgrade or a licence change if you do not want to wait out the TTL —
// the counterpart to InvalidateAppSignatureCache, which does the same for the signature database.
func invalidateDeviceMetadataCache() {
	fgCategoryCache.clear()
	fgLicenceCache.clear()
	fgFileTypeCache.clear()
}
