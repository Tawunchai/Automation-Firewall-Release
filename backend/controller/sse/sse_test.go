package sse

import (
	"bufio"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

// This package had no tests. It carries one message that matters — "maintenance mode is on, you
// are about to be logged out" — over a connection that stays open for hours, so the parts worth
// pinning are: the bus does not block or leak, and the stream keeps itself alive.

func init() { gin.SetMode(gin.TestMode) }

// withShortKeepalive shrinks the interval so the keepalive path runs in milliseconds.
func withShortKeepalive(t *testing.T, d time.Duration) {
	t.Helper()
	original := keepaliveInterval
	keepaliveInterval = d
	t.Cleanup(func() { keepaliveInterval = original })
}

// newTestBus gives each test its own bus so the package-level singleton is never shared.
func newTestBus() *EventBus { return &EventBus{clients: make(map[chan string]struct{})} }

// ── Keepalive frame format ───────────────────────────────────────────────────

func TestKeepaliveFrame_IsAnSSECommentTheClientIgnores(t *testing.T) {
	s := string(keepaliveFrame)

	if !strings.HasPrefix(s, ":") {
		t.Errorf("keepalive frame %q must start with ':' — that is what makes it a comment the "+
			"EventSource parser discards instead of dispatching", s)
	}
	if !strings.HasSuffix(s, "\n\n") {
		t.Errorf("keepalive frame %q must end with a blank line, or the parser buffers it "+
			"waiting for the rest of the frame", s)
	}
	// A comment must not look like a field, or the client would dispatch it as a message.
	for _, field := range []string{"data:", "event:", "id:", "retry:"} {
		for _, line := range strings.Split(strings.TrimSuffix(s, "\n\n"), "\n") {
			if strings.HasPrefix(line, field) {
				t.Errorf("keepalive frame contains an SSE field %q — it must carry no payload", field)
			}
		}
	}
}

func TestKeepaliveInterval_IsUnderCommonProxyIdleTimeouts(t *testing.T) {
	// 30s is the shortest idle timeout commonly found in front of an app like this. The interval
	// has to be under it with room to spare, or the connection dies between beats.
	if keepaliveInterval >= 30*time.Second {
		t.Errorf("keepaliveInterval = %v; it must stay below the 30s idle timeout common in "+
			"proxies and NAT gateways", keepaliveInterval)
	}
	if keepaliveInterval < time.Second {
		t.Errorf("keepaliveInterval = %v — that is chatter, not a keepalive", keepaliveInterval)
	}
}

// ── The stream ───────────────────────────────────────────────────────────────

// startStream runs Handler against a real HTTP server and returns a reader over the response body.
func startStream(t *testing.T) (*bufio.Reader, func()) {
	t.Helper()
	r := gin.New()
	r.GET("/events", Handler)
	srv := httptest.NewServer(r)

	req, err := http.NewRequest(http.MethodGet, srv.URL+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("status = %d, want 200", resp.StatusCode)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Errorf("Content-Type = %q, want text/event-stream", ct)
	}
	if resp.Header.Get("X-Accel-Buffering") != "no" {
		t.Error("X-Accel-Buffering must be 'no', or nginx buffers the stream and nothing arrives " +
			"until the connection closes")
	}

	return bufio.NewReader(resp.Body), func() { resp.Body.Close(); srv.Close() }
}

// readFrame reads up to a blank line — one SSE frame.
func readFrame(t *testing.T, br *bufio.Reader) string {
	t.Helper()
	var sb strings.Builder
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			t.Fatalf("reading frame: %v (got %q so far)", err, sb.String())
		}
		if line == "\n" {
			return sb.String()
		}
		sb.WriteString(line)
	}
}

func TestHandler_SendsAPingOnConnect(t *testing.T) {
	withShortKeepalive(t, time.Hour) // out of the way
	br, stop := startStream(t)
	defer stop()

	frame := readFrame(t, br)
	if !strings.Contains(frame, "ping") || !strings.Contains(frame, "connected") {
		t.Errorf("first frame = %q, want the ping/connected handshake", frame)
	}
}

// THE FIX: an otherwise-silent stream must still put bytes on the wire.
func TestHandler_SendsKeepalivesWhileIdle(t *testing.T) {
	withShortKeepalive(t, 30*time.Millisecond)
	br, stop := startStream(t)
	defer stop()

	readFrame(t, br) // the ping

	for i := 0; i < 3; i++ {
		frame := readFrame(t, br)
		if !strings.HasPrefix(frame, ":") {
			t.Fatalf("idle frame %d = %q, want a keepalive comment — without it the connection "+
				"is dropped by any proxy with an idle timeout", i, frame)
		}
	}
}

func TestHandler_DeliversBroadcasts(t *testing.T) {
	withShortKeepalive(t, time.Hour)
	br, stop := startStream(t)
	defer stop()

	readFrame(t, br) // the ping

	// Wait for the subscription to land before broadcasting into it.
	deadline := time.Now().Add(2 * time.Second)
	for Bus.ConnectedCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	Bus.Broadcast("maintenance:on")

	frame := readFrame(t, br)
	if !strings.Contains(frame, "system") || !strings.Contains(frame, "maintenance:on") {
		t.Errorf("frame = %q, want the system/maintenance:on event", frame)
	}
}

// Keepalives must not disturb the real events interleaved with them.
func TestHandler_KeepalivesDoNotSwallowEvents(t *testing.T) {
	withShortKeepalive(t, 20*time.Millisecond)
	br, stop := startStream(t)
	defer stop()

	readFrame(t, br)

	deadline := time.Now().Add(2 * time.Second)
	for Bus.ConnectedCount() == 0 && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	time.Sleep(60 * time.Millisecond) // let a few keepalives go out first
	Bus.Broadcast("maintenance:off")

	for i := 0; i < 12; i++ {
		frame := readFrame(t, br)
		if strings.Contains(frame, "maintenance:off") {
			return
		}
		if !strings.HasPrefix(frame, ":") {
			t.Fatalf("unexpected frame while waiting for the event: %q", frame)
		}
	}
	t.Fatal("the broadcast never arrived among the keepalives")
}

func TestHandler_UnsubscribesWhenTheClientDisconnects(t *testing.T) {
	withShortKeepalive(t, time.Hour)
	before := Bus.ConnectedCount()

	br, stop := startStream(t)
	readFrame(t, br)

	deadline := time.Now().Add(2 * time.Second)
	for Bus.ConnectedCount() <= before && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if Bus.ConnectedCount() != before+1 {
		t.Fatalf("connected = %d, want %d after one client attached", Bus.ConnectedCount(), before+1)
	}

	stop() // client goes away

	deadline = time.Now().Add(2 * time.Second)
	for Bus.ConnectedCount() > before && time.Now().Before(deadline) {
		time.Sleep(2 * time.Millisecond)
	}
	if Bus.ConnectedCount() != before {
		t.Errorf("connected = %d after disconnect, want %d — the subscription leaked",
			Bus.ConnectedCount(), before)
	}
}

// ── The bus ──────────────────────────────────────────────────────────────────

func TestBus_BroadcastReachesEverySubscriber(t *testing.T) {
	b := newTestBus()
	a, c := b.subscribe(), b.subscribe()

	b.Broadcast("hello")

	for i, ch := range []chan string{a, c} {
		select {
		case got := <-ch:
			if got != "hello" {
				t.Errorf("subscriber %d got %q", i, got)
			}
		case <-time.After(time.Second):
			t.Errorf("subscriber %d never received the broadcast", i)
		}
	}
}

// A client that has stopped reading must not be able to stall the broadcaster — an admin toggling
// maintenance mode would otherwise block on one stuck browser tab.
func TestBus_BroadcastSkipsAFullSubscriber(t *testing.T) {
	b := newTestBus()
	slow := b.subscribe()
	fast := b.subscribe()

	for i := 0; i < 50; i++ { // far past the channel's buffer of 8
		b.Broadcast("flood")
	}

	select {
	case <-fast:
	case <-time.After(time.Second):
		t.Error("a full subscriber blocked delivery to a healthy one")
	}
	_ = slow
}

func TestBus_UnsubscribeIsIdempotentAndClosesTheChannel(t *testing.T) {
	b := newTestBus()
	ch := b.subscribe()

	b.unsubscribe(ch)
	if _, open := <-ch; open {
		t.Error("unsubscribe must close the channel so the handler's receive returns")
	}
	// A second unsubscribe must not panic on a double close.
	b.unsubscribe(ch)

	if n := b.ConnectedCount(); n != 0 {
		t.Errorf("ConnectedCount = %d after unsubscribe, want 0", n)
	}
}

func TestBus_ConcurrentSubscribeBroadcastUnsubscribe(t *testing.T) {
	b := newTestBus()
	var wg sync.WaitGroup

	for i := 0; i < 25; i++ {
		wg.Add(2)
		go func() {
			defer wg.Done()
			ch := b.subscribe()
			time.Sleep(time.Millisecond)
			b.unsubscribe(ch)
		}()
		go func() {
			defer wg.Done()
			b.Broadcast("churn")
		}()
	}
	wg.Wait()

	if n := b.ConnectedCount(); n != 0 {
		t.Errorf("ConnectedCount = %d after all clients left, want 0", n)
	}
}
