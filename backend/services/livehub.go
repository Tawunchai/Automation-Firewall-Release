package services

import (
	"context"
	"log"
	"runtime/debug"
	"sync"
	"time"
)

// LiveTopologyHub multiplexes live topology polling across subscribers, so N browser tabs
// watching the same device under the same credential and VDOM cost ONE login + ONE poll loop
// against the firewall, not N. See controller/policyobject/device_livestream.go and
// fleet_livestream.go for the two SSE endpoints built on this.
//
// ── Why keyed the way callers are told to key it (device + credential + VDOM) ────────────────
//
// Per-user device credentials (DeviceCredential) mean two different humans can reach the same
// FortiGate as two different accounts, and the firewall's own config-change log records whichever
// one actually logged in — collapsing that to one shared session would misattribute every poll to
// whoever happened to be first. VDOM matters for the same reason the rest of this proxy threads it
// everywhere: two tabs on the same device but different VDOMs are reading different tenants, and a
// shared poller bound to the first tab's VDOM would silently serve the wrong tenant to the second.
// This hub does not know about credentials or VDOMs itself — it takes an opaque string key and
// leaves what belongs in it to the caller, which already has that context.
//
// ── Why the first subscriber's login does not block every other topic ────────────────────────
//
// Subscribe only holds the hub's lock long enough to check the registry and to register a topic
// once one is ready — never while `build` (an synchronous FortiGate login) is running. A slow or
// hanging login on one device must never stall subscribe/unsubscribe on every other device's
// topic, which holding the lock across it would do.

// Build opens the one session a new topic's subscribers will share. ctx is the TOPIC's own
// lifetime, not any one subscriber's request: it outlives whichever subscriber happened to
// trigger it, and is cancelled only when the LAST subscriber on the key leaves.
type Build[T any] func(ctx context.Context) (poll func() T, err error)

type liveTopic[T any] struct {
	subscribers map[chan T]struct{}
	cancel      context.CancelFunc
}

// LiveHub is a generic pub-sub-with-a-shared-poller keyed by an opaque string. Instantiated once
// per payload type below (LiveTopologyHub) rather than exported generically, so callers see a
// concrete, typed API instead of having to spell out the type parameter at every call site.
type LiveHub[T any] struct {
	mu     sync.Mutex
	topics map[string]*liveTopic[T]
}

func NewLiveHub[T any]() *LiveHub[T] {
	return &LiveHub[T]{topics: map[string]*liveTopic[T]{}}
}

// LiveTopologyHub is the package-level singleton the two SSE handlers subscribe to — same
// singleton-package-variable shape as controller/sse's own Bus, for the same reason: there is
// exactly one process-wide set of live topics, not one per request.
var LiveTopologyHub = NewLiveHub[TopologyLive]()

// Subscribe joins key's topic, starting it via build if this is the first subscriber on it.
// Returns a channel of samples (buffered 1 — a subscriber that falls behind misses a stale
// reading, not a reason to block the topic for everyone else) and an unsubscribe func the caller
// MUST call exactly once, however the connection ends (including on its own request's context
// cancelling), or the topic and its goroutine leak.
func (h *LiveHub[T]) Subscribe(key string, interval time.Duration, build Build[T]) (<-chan T, func(), error) {
	for {
		h.mu.Lock()
		if t, ok := h.topics[key]; ok {
			ch := make(chan T, 1)
			t.subscribers[ch] = struct{}{}
			h.mu.Unlock()
			return ch, h.unsubscribe(key, ch), nil
		}
		h.mu.Unlock()

		// No topic yet. Log in OUTSIDE the lock — this is a network round trip, and holding the
		// lock across it would stall every other key's Subscribe/unsubscribe meanwhile.
		ctx, cancel := context.WithCancel(context.Background())
		poll, err := build(ctx)
		if err != nil {
			cancel()
			return nil, nil, err
		}

		h.mu.Lock()
		if _, raced := h.topics[key]; raced {
			// Someone else won the race while we were logging in. Discard our session (the
			// pooled FortiGate login itself is untouched — only this local poll closure and its
			// context are) and retry against the topic that now exists, rather than running two
			// pollers for the same key.
			h.mu.Unlock()
			cancel()
			continue
		}
		t := &liveTopic[T]{subscribers: map[chan T]struct{}{}, cancel: cancel}
		h.topics[key] = t
		ch := make(chan T, 1)
		t.subscribers[ch] = struct{}{}
		h.mu.Unlock()

		go h.run(ctx, t, interval, poll)
		return ch, h.unsubscribe(key, ch), nil
	}
}

// unsubscribe returns a func bound to this one (key, ch) pair, so a caller's deferred cleanup
// cannot accidentally remove a different subscriber's channel.
func (h *LiveHub[T]) unsubscribe(key string, ch chan T) func() {
	return func() {
		h.mu.Lock()
		defer h.mu.Unlock()
		t, ok := h.topics[key]
		if !ok {
			return
		}
		if _, present := t.subscribers[ch]; !present {
			return
		}
		delete(t.subscribers, ch)
		close(ch)
		if len(t.subscribers) == 0 {
			t.cancel()
			delete(h.topics, key)
		}
	}
}

func (h *LiveHub[T]) run(ctx context.Context, t *liveTopic[T], interval time.Duration, poll func() T) {
	// Recovery is PER PUBLISH, not per goroutine.
	//
	// poll() is a live FortiGate call — several reads joined into one sample — and anything it
	// touches can be nil on a device that answers half a question. A panic in here unwinds THIS
	// goroutine, not the SSE handler's, so neither Gin's recovery middleware nor the subscriber
	// ever sees it: the process dies and every in-flight HTTP request dies with it, for one
	// browser tab watching one firewall.
	//
	// Putting the `defer recover()` on the goroutine instead would stop the process dying and then
	// leave the topic silently dead — subscribers still attached, their channels never fed again,
	// the "live" page frozen on its last sample with nothing to say so, and no later subscriber
	// able to restart it because the topic is still registered. Recovering around one publish means
	// the bad sample is skipped and logged, and the next tick tries again.
	publish := func() {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("[livehub] poll panicked — this sample is dropped, the topic keeps running: %v\n%s",
					r, debug.Stack())
			}
		}()
		sample := poll()
		// Unlocked by defer, not by hand: it is registered AFTER the recover above, so on a panic
		// it runs first and the hub's lock is released before anything else — a recover that left
		// this mutex held would wedge Subscribe and unsubscribe for every device in the process.
		h.mu.Lock()
		defer h.mu.Unlock()
		for ch := range t.subscribers {
			select {
			case ch <- sample:
			default: // a slow subscriber drops this sample rather than blocking the topic
			}
		}
	}

	publish() // the first sample lands immediately, not after waiting a full interval
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			publish()
		}
	}
}
