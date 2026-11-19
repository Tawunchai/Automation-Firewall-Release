package services

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// A fast, deterministic interval for tests — real topics poll every few seconds, but nothing here
// needs to wait that long to prove the behavior.
const testInterval = 5 * time.Millisecond

func TestLiveHub_SharesOneBuildAcrossSeveralSubscribersOnTheSameKey(t *testing.T) {
	h := NewLiveHub[int]()
	var builds int32

	build := func(ctx context.Context) (func() int, error) {
		atomic.AddInt32(&builds, 1)
		return func() int { return 1 }, nil
	}

	ch1, unsub1, err := h.Subscribe("device:1", testInterval, build)
	if err != nil {
		t.Fatalf("first subscribe: %v", err)
	}
	ch2, unsub2, err := h.Subscribe("device:1", testInterval, build)
	if err != nil {
		t.Fatalf("second subscribe: %v", err)
	}
	defer unsub1()
	defer unsub2()

	<-ch1
	<-ch2

	if got := atomic.LoadInt32(&builds); got != 1 {
		t.Errorf("builds = %d, want 1 — two subscribers on the same key must share one session", got)
	}
}

func TestLiveHub_DifferentKeysGetTheirOwnTopic(t *testing.T) {
	h := NewLiveHub[int]()
	var builds int32
	build := func(ctx context.Context) (func() int, error) {
		atomic.AddInt32(&builds, 1)
		return func() int { return 1 }, nil
	}

	_, unsub1, _ := h.Subscribe("device:1", testInterval, build)
	_, unsub2, _ := h.Subscribe("device:2", testInterval, build)
	defer unsub1()
	defer unsub2()

	if got := atomic.LoadInt32(&builds); got != 2 {
		t.Errorf("builds = %d, want 2 — unrelated keys must not share a topic", got)
	}
}

// A second subscriber on the same key JOINS the poll that is already running — it does not start
// one of its own. That is the whole point of the hub: two browsers watching one firewall cost one
// session on it, not two (live-proved, see the sse-push note in services/livehub.go).
//
// The assertion is the build count rather than the values the two channels receive. It used to be
// "both channels get the same first sample", which is not a property this code has: publish does a
// non-blocking send and a subscriber that is not reading when a sample arrives DROPS it (run()
// below). The two channels therefore agree only when the timing happens to suit, and under a full
// `go test ./...` on a loaded machine it sometimes does not — the failure was "first sample
// differed between subscribers: 1 vs 2", a subscriber that had simply joined one tick later.
func TestLiveHub_ASecondSubscriberJoinsTheSamePollRatherThanStartingAnother(t *testing.T) {
	h := NewLiveHub[int]()
	var builds atomic.Int32
	var n atomic.Int32
	build := func(ctx context.Context) (func() int, error) {
		builds.Add(1)
		return func() int { return int(n.Add(1)) }, nil
	}

	ch1, unsub1, _ := h.Subscribe("k", testInterval, build)
	ch2, unsub2, _ := h.Subscribe("k", testInterval, build)
	defer unsub1()
	defer unsub2()

	if got := builds.Load(); got != 1 {
		t.Fatalf("builds = %d, want 1 — the second subscriber started a poll of its own, which is "+
			"a second session on the same firewall", got)
	}

	// …and both of them are fed by it. A subscriber that joined the topic but is never sent
	// anything would satisfy the count above and still show an empty page.
	for name, ch := range map[string]<-chan int{"first": ch1, "second": ch2} {
		select {
		case v := <-ch:
			if v == 0 {
				t.Errorf("%s subscriber received the zero value rather than a sample", name)
			}
		case <-time.After(2 * time.Second):
			t.Errorf("%s subscriber received nothing from the shared poll", name)
		}
	}
}

func TestLiveHub_UnsubscribeClosesTheChannel(t *testing.T) {
	h := NewLiveHub[int]()
	build := func(ctx context.Context) (func() int, error) { return func() int { return 1 }, nil }

	ch, unsub, _ := h.Subscribe("k", testInterval, build)
	<-ch
	unsub()

	if _, ok := <-ch; ok {
		t.Error("channel was still open after unsubscribe")
	}
}

func TestLiveHub_LastUnsubscribeCancelsTheTopicsContext(t *testing.T) {
	h := NewLiveHub[int]()
	cancelled := make(chan struct{})
	build := func(ctx context.Context) (func() int, error) {
		go func() {
			<-ctx.Done()
			close(cancelled)
		}()
		return func() int { return 1 }, nil
	}

	ch1, unsub1, _ := h.Subscribe("k", testInterval, build)
	ch2, unsub2, _ := h.Subscribe("k", testInterval, build)
	<-ch1
	<-ch2

	unsub1()
	select {
	case <-cancelled:
		t.Fatal("topic context cancelled after only ONE of two subscribers left")
	case <-time.After(20 * time.Millisecond):
	}

	unsub2()
	select {
	case <-cancelled:
	case <-time.After(200 * time.Millisecond):
		t.Fatal("topic context was never cancelled after the LAST subscriber left")
	}
}

func TestLiveHub_RestartsTheTopicAfterEveryoneLeftAndSomeoneNewArrives(t *testing.T) {
	h := NewLiveHub[int]()
	var builds int32
	build := func(ctx context.Context) (func() int, error) {
		atomic.AddInt32(&builds, 1)
		return func() int { return 1 }, nil
	}

	ch1, unsub1, _ := h.Subscribe("k", testInterval, build)
	<-ch1
	unsub1()

	ch2, unsub2, _ := h.Subscribe("k", testInterval, build)
	defer unsub2()
	<-ch2

	if got := atomic.LoadInt32(&builds); got != 2 {
		t.Errorf("builds = %d, want 2 — a key with no subscribers left must build fresh for the next one", got)
	}
}

func TestLiveHub_ABuildFailureReachesTheCaller(t *testing.T) {
	h := NewLiveHub[int]()
	build := func(ctx context.Context) (func() int, error) {
		return nil, errLoginFailed
	}

	_, _, err := h.Subscribe("k", testInterval, build)
	if err != errLoginFailed {
		t.Errorf("err = %v, want the build error to pass straight through", err)
	}
}

func TestLiveHub_ConcurrentSubscribeAndUnsubscribeDoesNotRace(t *testing.T) {
	h := NewLiveHub[int]()
	build := func(ctx context.Context) (func() int, error) { return func() int { return 1 }, nil }

	var wg sync.WaitGroup
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ch, unsub, err := h.Subscribe("shared-key", testInterval, build)
			if err != nil {
				return
			}
			<-ch
			unsub()
		}()
	}
	wg.Wait()
	// Run with `go test -race` to make this test mean anything; a clean exit here is the point.
}

var errLoginFailed = &loginError{"FortiGate login failed"}

type loginError struct{ msg string }

func (e *loginError) Error() string { return e.msg }
