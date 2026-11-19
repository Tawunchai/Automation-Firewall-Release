package terminal

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// The interactive terminal endpoint: one WebSocket, one live shell on the device.
//
// This replaces the batch pipeline for interactive use. That path — POST a row, LPUSH to Redis, the
// Python worker opens a fresh SSH connection per command, POST the result back, browser polls every
// 800 ms — measured 4.58 s for `get system status` on the lab FortiGate, and could not hold session
// state between commands even in principle. Config Deploy's batch mode still uses it, correctly:
// pushing a script to many devices is a job, and jobs want a queue. Typing at a prompt is not a job.
//
// The socket is deliberately thin. Bytes the browser sends go to the device; bytes the device sends
// go to the browser. No prompt detection, no command parsing, no output assembly — those are what
// made the old path drop output whose prompt pattern did not match, and a terminal has no need for
// any of them.

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	// The comment that used to sit here said the session cookie enforced same-origin. It does
	// not: a WebSocket upgrade is not subject to the same-origin policy and is not preflighted, so
	// ANY page the user has open could upgrade to this endpoint and the browser would attach the
	// cookie for it. The only thing standing in the way was SameSite=Lax, decided in a third file.
	// This is a live SSH shell on a firewall — it is worth a check of its own.
	//
	// services.CheckWebsocketOrigin keeps the dev server (:5173 → :9000) working and still allows
	// same-host production traffic through nginx; it reads the same allow-list as the CORS
	// middleware, so the two can no longer disagree, and it logs what it refused — a refusal
	// reaches the browser as a bare 403 that the UI can only show as "it did not connect".
	CheckOrigin: platform.CheckWebsocketOrigin,
}

const (
	// writeWait bounds a single frame write so one stuck client cannot hold a goroutine forever.
	writeWait = 10 * time.Second
	// pongWait / pingPeriod detect a browser that vanished without closing — a laptop lid, a lost
	// wifi link. Without it the device session would stay open until the idle reaper got it.
	pongWait   = 60 * time.Second
	pingPeriod = 25 * time.Second
	// maxMessage caps a single input frame. Terminal input is keystrokes and pasted config; a
	// megabyte of it is not a thing anyone types.
	maxMessage = 64 * 1024
)

// wsMessage is the envelope the browser and the server exchange.
//
// Typed rather than raw bytes so the connection can carry things that are not terminal data —
// notably the "ready"/"error" handshake, which is what lets the UI tell "connecting" from
// "connected" from "the device refused us", instead of guessing from an empty screen.
type wsMessage struct {
	Type string `json:"type"`           // data | ready | error | resize
	Data string `json:"data,omitempty"` // terminal bytes, or a human-readable reason
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

// Shell upgrades to a WebSocket and bridges it to a live device shell.
//
// GET /terminal/:deviceId/shell?proto=telnet|ssh
func Shell(c *gin.Context) {
	// Authorisation happens BEFORE the upgrade: after it, an HTTP status can no longer be sent and
	// the browser would see an opaque socket close instead of "admin access required".
	role, _ := c.Get("user_role")
	if role != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return
	}

	id, err := strconv.Atoi(c.Param("deviceId"))
	if err != nil || id <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid device id"})
		return
	}

	proto, err := services.ParseProto(c.Query("proto"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	var device entity.NetworkDevice
	if err := config.DB().First(&device, id).Error; err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "device not found"})
		return
	}
	// A shell IS the firewall's own CLI, so this is the strongest case in the console for the
	// session to carry the operator's real name: everything typed here lands in the device's event
	// log under whichever account opened it. Falls back to the shared credential when this user has
	// not mapped their own (Profile ▸ Device Credentials).
	uid, _ := c.Get("user_id")
	login, err := services.ResolveDeviceLogin(config.DB(), services.UserIDOf(uid), &device)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// The device row's port is the SSH port (that is what the inventory form asks for), so it only
	// applies when the caller asked for SSH. Telnet takes its own, overridable per request.
	port := proto.DefaultPort()
	if proto == services.ProtoSSH && device.Port > 0 {
		port = device.Port
	}
	if q := c.Query("port"); q != "" {
		if p, err := strconv.Atoi(q); err == nil && p > 0 && p < 65536 {
			port = p
		}
	}

	ws, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		// Upgrade already wrote a response.
		return
	}
	defer ws.Close()

	// Dial AFTER the upgrade so a slow or failed connect is reported on the socket, where the UI
	// can print it into the terminal, rather than as an HTTP error the browser swallows.
	sess, err := services.OpenSession(proto, device.MgmtIP, port, login.Username, login.Password)
	if err != nil {
		log.Printf("[terminal] device %d (%s://%s:%d) as %q: %v", id, proto, device.MgmtIP, port, login.Username, err)
		writeJSON(ws, wsMessage{Type: "error", Data: err.Error()})
		return
	}
	defer sess.Close()

	log.Printf("[terminal] device %d opened %s session to %s (user %v, device account %q, personal=%v)",
		id, proto, sess.Device, c.GetString("user_email"), login.Username, login.Personal)
	services.TouchDeviceCredential(config.DB(), login.CredentialID)
	writeJSON(ws, wsMessage{Type: "ready", Data: sess.Device})

	// One goroutine per direction. The browser→device direction owns the connection's lifetime:
	// when it returns (socket closed, or a read error), the deferred Close tears the device session
	// down, which closes Out and ends the other goroutine.
	done := make(chan struct{})
	go pumpToBrowser(ws, sess, done)

	ws.SetReadLimit(maxMessage)
	_ = ws.SetReadDeadline(time.Now().Add(pongWait))
	ws.SetPongHandler(func(string) error {
		return ws.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, raw, err := ws.ReadMessage()
		if err != nil {
			break
		}
		var msg wsMessage
		if err := json.Unmarshal(raw, &msg); err != nil {
			continue
		}
		switch msg.Type {
		case "data":
			// Verbatim, including Tab / "?" / Ctrl+C — the control characters are the point.
			if err := sess.Write([]byte(msg.Data)); err != nil {
				writeJSON(ws, wsMessage{Type: "error", Data: err.Error()})
				close(done)
				return
			}
		case "resize":
			// Accepted and ignored: FortiOS wraps to the width it was given at PTY request time and
			// re-requesting is not worth a reconnect. Handling the message keeps the browser from
			// treating it as an error.
		}
	}
	close(done)
}

// pumpToBrowser forwards device output and keeps the socket alive.
func pumpToBrowser(ws *websocket.Conn, sess *services.Session, done <-chan struct{}) {
	ping := time.NewTicker(pingPeriod)
	defer ping.Stop()

	for {
		select {
		case chunk, ok := <-sess.Out:
			if !ok {
				// The device closed. Say so, so the UI can print it rather than going quiet.
				writeJSON(ws, wsMessage{Type: "error", Data: "session closed by device"})
				_ = ws.WriteControl(websocket.CloseMessage,
					websocket.FormatCloseMessage(websocket.CloseNormalClosure, "device closed"),
					time.Now().Add(writeWait))
				return
			}
			// Device output is not guaranteed to be valid UTF-8 mid-chunk (a multi-byte character
			// can straddle a read), and JSON demands valid UTF-8 — so the chunk goes over as a
			// binary frame and the browser decodes with a streaming TextDecoder.
			_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := ws.WriteMessage(websocket.BinaryMessage, chunk); err != nil {
				return
			}
		case <-ping.C:
			_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
			if err := ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		case <-done:
			return
		}
	}
}

func writeJSON(ws *websocket.Conn, m wsMessage) {
	_ = ws.SetWriteDeadline(time.Now().Add(writeWait))
	_ = ws.WriteJSON(m)
}
