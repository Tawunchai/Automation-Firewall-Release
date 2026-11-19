// Package diagstream carries a live diagnostic over one WebSocket.
//
// Ping and traceroute are the two Diagnostics tools that HAPPEN over time rather than returning an
// answer, and FortiOS prints them that way: measured on the lab FGT80E, `execute ping` emits its
// replies exactly 1.000s apart and `execute traceroute` prints each hop as it resolves, over a run
// that reached 31 seconds. The request/response endpoints in policyobject still exist and still
// work — but through them a traceroute is half a minute of frozen page followed by everything at
// once, which throws away information the device was giving away for free.
//
// A socket rather than SSE, matching the Config Deploy terminal: the console already has the nginx
// upgrade path, the browser plumbing and the operational habits for WebSockets, and this endpoint
// also needs the client→server direction to carry a "stop" the SSE shape cannot.
package diagstream

import (
	"log"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  2048,
	WriteBufferSize: 4096,
	// Same check as the terminal's, for the same reason — see the long note there. A diagnostics
	// stream runs ping, traceroute and the rest against a firewall this console can log in to, so
	// "any page may open one with the user's cookie" was not an acceptable default here either.
	CheckOrigin: platform.CheckWebsocketOrigin,
}

const (
	writeWait  = 10 * time.Second
	pongWait   = 120 * time.Second
	pingPeriod = 30 * time.Second

	// eventBuffer decouples the SSH reader from the socket writer. The reader must never block —
	// the device keeps printing regardless — and a run emits at most a few hundred events, so this
	// is generous enough that the writer is never the bottleneck.
	eventBuffer = 256
)

// wsEvent is what the browser receives.
//
// `ready` and `done`/`error` bracket the run so the UI can tell "connecting" from "running" from
// "finished" rather than inferring it from silence. Everything between is a services.DiagEvent.
type wsEvent struct {
	Type string `json:"type"` // ready | line | reply | hop | ping_done | trace_done | error | done

	// Line has no omitempty on purpose. The device prints BLANK lines — one before the
	// "--- statistics ---" block, one after — and omitting them sends `undefined` to the browser,
	// where the raw console then silently drops them and renders output the firewall never
	// produced. A raw view that quietly reflows is not a raw view.
	Line       string                       `json:"line"`
	Reply      *services.FGPingReply        `json:"reply,omitempty"`
	Hop        *services.FGTracerouteHop    `json:"hop,omitempty"`
	Ping       *services.FGPingResult       `json:"ping,omitempty"`
	Trace      *services.FGTracerouteResult `json:"trace,omitempty"`
	ResolvedIP string                       `json:"resolved_ip,omitempty"`

	Message string `json:"message,omitempty"`
}

// Stream runs one diagnostic and streams it.
//
// GET /diag-stream/:deviceId/:tool?target=…&count=…&size=…&source=…
// tool = ping | traceroute
func Stream(c *gin.Context) {
	// Everything that can fail with an HTTP status is checked BEFORE the upgrade — afterwards the
	// browser would only see an opaque socket close instead of the reason.
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	tool := c.Param("tool")
	if tool != "ping" && tool != "traceroute" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown diagnostic: " + tool})
		return
	}

	id, err := strconv.Atoi(c.Param("deviceId"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device id"})
		return
	}

	target, err := services.ValidateDiagTarget(c.Query("target"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var device entity.NetworkDevice
	if err := config.DB().First(&device, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}

	// Ping and traceroute run as a LOGIN on the firewall, and this is the half of the console where
	// that matters most: the device's event log records who opened the SSH session. If this user has
	// mapped their own account to this device (Profile ▸ Device Credentials) the run happens under
	// their name; otherwise it falls back to the shared credential, exactly as before.
	uid, _ := c.Get("user_id")
	login, err := services.ResolveDeviceLogin(config.DB(), services.UserIDOf(uid), &device)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// `source` serves both tools, but they reach the device by different commands
	// (`execute ping-options source` vs `execute traceroute-options source`), so each gets its own
	// option struct rather than one shared bag that only half applies.
	pingOpts := services.PingOptions{
		Count:    atoiOr(c.Query("count"), 0),
		Size:     atoiOr(c.Query("size"), 0),
		SourceIP: c.Query("source"),
	}
	traceOpts := services.TracerouteOptions{SourceIP: c.Query("source")}

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return // Upgrade already wrote a response
	}
	defer ws.Close()

	dt := services.DiagTarget{
		DeviceID: device.ID,
		Host:     device.MgmtIP,
		Port:     device.Port,
		Username: login.Username,
		Password: login.Password,
	}

	log.Printf("[diagstream] device %d: %s %s (user %v, device account %q, personal=%v)",
		id, tool, target, c.GetString("user_email"), login.Username, login.Personal)
	services.TouchDeviceCredential(config.DB(), login.CredentialID)
	run(ws, dt, tool, target, pingOpts, traceOpts)
}

// run owns the socket for the length of one diagnostic.
//
// Exactly ONE goroutine writes to the WebSocket — this one. Gorilla's connection is not safe for
// concurrent writes, and there are three things that want to write (device events, keepalive pings,
// the final status), so they are funnelled through a select here rather than each writing directly.
func run(
	ws *websocket.Conn, dt services.DiagTarget, tool, target string,
	pingOpts services.PingOptions, traceOpts services.TracerouteOptions,
) {
	// cancel is closed when the browser goes away or asks to stop. It reaches all the way down to
	// the SSH client, so a 100-second traceroute is actually abandoned rather than left holding the
	// device's diagnostic lock.
	cancel := make(chan struct{})
	var once sync.Once
	stop := func() { once.Do(func() { close(cancel) }) }
	defer stop()

	// `events` is never closed. The producer is the SSH reader and the consumer is the writer loop
	// below; closing it from the third goroutine (the socket reader) would race a send and panic,
	// so the reader signals through clientGone instead and the buffer is simply abandoned.
	events := make(chan services.DiagEvent, eventBuffer)
	clientGone := make(chan struct{})

	// The read loop exists even though the browser's only message is "stop": without a read in
	// flight the server never notices a closed socket or a missed pong, and a client that vanished
	// mid-traceroute would keep the device busy to the end.
	go func() {
		defer close(clientGone)
		ws.SetReadLimit(1024)
		_ = ws.SetReadDeadline(time.Now().Add(pongWait))
		ws.SetPongHandler(func(string) error {
			return ws.SetReadDeadline(time.Now().Add(pongWait))
		})
		for {
			_, msg, err := ws.ReadMessage()
			if err != nil || string(msg) == "stop" {
				return
			}
		}
	}()

	// emit must never block: the device keeps printing whatever this does, and back-pressure here
	// becomes back-pressure on the SSH channel.
	emit := func(e services.DiagEvent) {
		select {
		case events <- e:
		case <-cancel:
		}
	}

	done := make(chan error, 1)
	go func() {
		var err error
		switch tool {
		case "ping":
			err = services.PingStream(dt, target, pingOpts, cancel, emit)
		case "traceroute":
			err = services.TracerouteStream(dt, target, traceOpts, cancel, emit)
		}
		done <- err
	}()

	writeJSON(ws, wsEvent{Type: "ready"})

	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()

	for {
		select {
		case ev := <-events:
			if !writeJSON(ws, toWS(ev)) {
				stop()
				<-done
				return
			}

		case err := <-done:
			// By the time this fires the producer has returned, so everything it ever emitted is
			// already sitting in the buffer. Drain it before the closing status — otherwise the
			// final hop and the summary lose a race with "done" and never reach the screen.
			for {
				select {
				case ev := <-events:
					writeJSON(ws, toWS(ev))
					continue
				default:
				}
				break
			}
			if err != nil && !services.IsDiagCancelled(err) {
				writeJSON(ws, wsEvent{Type: "error", Message: err.Error()})
			} else {
				writeJSON(ws, wsEvent{Type: "done"})
			}
			// Close properly rather than just returning. Dropping the connection makes the client
			// report an ERROR on a run that succeeded — the browser cannot tell "the server
			// finished" from "the server died" without the close frame.
			_ = ws.WriteControl(websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseNormalClosure, "finished"),
				time.Now().Add(writeWait))
			return

		case <-clientGone:
			stop()
			<-done
			return

		case <-ping.C:
			_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				stop()
				<-done
				return
			}
		}
	}
}

func toWS(e services.DiagEvent) wsEvent {
	return wsEvent{
		Type: e.Type, Line: e.Line, Reply: e.Reply, Hop: e.Hop,
		Ping: e.Ping, Trace: e.Trace, ResolvedIP: e.ResolvedIP,
	}
}

func writeJSON(ws *websocket.Conn, m wsEvent) bool {
	_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
	return ws.WriteJSON(m) == nil
}

func atoiOr(s string, fallback int) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	return fallback
}
