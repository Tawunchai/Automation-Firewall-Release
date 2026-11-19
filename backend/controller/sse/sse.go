package sse

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
)

// EventBus manages all active SSE client connections.
type EventBus struct {
	mu      sync.RWMutex
	clients map[chan string]struct{}
}

// Bus is the global singleton event bus.
var Bus = &EventBus{
	clients: make(map[chan string]struct{}),
}

func (b *EventBus) subscribe() chan string {
	ch := make(chan string, 8)
	b.mu.Lock()
	b.clients[ch] = struct{}{}
	b.mu.Unlock()
	return ch
}

func (b *EventBus) unsubscribe(ch chan string) {
	b.mu.Lock()
	if _, exists := b.clients[ch]; exists {
		delete(b.clients, ch)
		close(ch)
	}
	b.mu.Unlock()
}

// Broadcast sends data to every connected SSE client.
// Slow or full-buffer clients are skipped to prevent blocking.
func (b *EventBus) Broadcast(data string) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for ch := range b.clients {
		select {
		case ch <- data:
		default:
		}
	}
}

// ConnectedCount returns the number of active SSE connections.
func (b *EventBus) ConnectedCount() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return len(b.clients)
}

// ── Keepalive ────────────────────────────────────────────────────────────────
//
// The stream sent ONE "ping" frame on connect and then nothing until an admin toggled maintenance
// mode — which in practice is never. A connection that carries no bytes for hours is at the mercy
// of whatever sits in the path:
//
//   - this project's own nginx is already configured for it (`proxy_buffering off`,
//     `proxy_read_timeout 3600s` in frontend/nginx/common.conf), but 3600s is still a ceiling;
//   - anything ELSE in the path is not: a corporate proxy, a load balancer or a NAT gateway on the
//     LAN will happily drop an idle connection after 30-60 seconds, and a stateful firewall
//     expires idle TCP flows on its own schedule.
//
// A dropped stream is not loud. EventSource reconnects silently, so the symptom is a maintenance
// banner that arrives late or not at all — the one message this channel exists to deliver.
//
// The fix is a comment frame. A line starting with ":" is valid SSE that the EventSource parser
// discards without dispatching an event, so it costs the client nothing and keeps every hop in the
// path seeing traffic. It also gives the server a way to NOTICE a dead peer: the write fails, and
// the handler returns instead of leaking a goroutine and a bus subscription.
var (
	// keepaliveInterval sits under the 30s that is the shortest idle timeout commonly found in
	// front of an app like this. A var, not a const, so tests can shrink it.
	keepaliveInterval = 25 * time.Second

	// keepaliveFrame is an SSE comment: no event, no data, nothing dispatched to the client.
	keepaliveFrame = []byte(": keepalive\n\n")
)

// Handler is the Gin HTTP handler for the SSE endpoint.
// Each client holds one persistent connection here.
func Handler(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	ch := Bus.subscribe()
	defer Bus.unsubscribe(ch)

	// Confirm connection to client.
	c.SSEvent("ping", "connected")
	c.Writer.Flush()

	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()

	ctx := c.Request.Context()
	for {
		select {
		case event, ok := <-ch:
			if !ok {
				return
			}
			c.SSEvent("system", event)
			c.Writer.Flush()

		case <-ticker.C:
			// A failed write means the peer is gone but the request context has not been
			// cancelled yet (a half-open connection). Returning here is what releases the bus
			// subscription; without it the entry would sit in the map broadcasting into a
			// channel nobody reads.
			if _, err := c.Writer.Write(keepaliveFrame); err != nil {
				return
			}
			c.Writer.Flush()

		case <-ctx.Done():
			return
		}
	}
}
