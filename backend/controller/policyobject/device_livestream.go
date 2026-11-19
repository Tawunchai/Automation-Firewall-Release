package policyobject

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Push-based replacement for polling GET /policy/device/:deviceId/topology-live — see
// services/livehub.go for the sharing rule and fleet_livestream.go for the multi-device sibling.
//
// liveStreamInterval governs how often a TOPIC samples the firewall, not how often any one
// subscriber hears from it (a subscriber hears from it every time the topic does — see livehub.go).
// 3s matches Topology's own historical poll cadence; it is now a per-DEVICE cost instead of a
// per-VIEWER one, so keeping it this fresh no longer means N logins per tick for N open tabs.
const liveStreamInterval = 3 * time.Second

// keepaliveInterval/keepaliveFrame mirror controller/sse's own reasoning verbatim (a different
// package, so not literally shared code — see that file's long comment on WHY a stream needs this
// at all): a connection carrying no bytes for a long stretch is at the mercy of whatever sits in
// the path, and a comment frame costs the client nothing while keeping every hop seeing traffic.
const keepaliveInterval = 25 * time.Second

var keepaliveFrame = []byte(": keepalive\n\n")

// liveHubKey is the one place that decides what makes two subscribers share a topic — see
// services/livehub.go's doc comment for why it has to include the credential and the VDOM, not
// just the device id.
func liveHubKey(deviceID uint, credentialID uint, vdom string) string {
	return fmt.Sprintf("device:%d:cred:%d:vdom:%s", deviceID, credentialID, vdom)
}

// GET /policy/device/:deviceId/topology-live/stream
func DeviceStreamTopologyLive(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	key := liveHubKey(di.Device.ID, di.CredentialID(), requestVDOM(c))
	samples, unsubscribe, err := services.LiveTopologyHub.Subscribe(key, liveStreamInterval,
		func(ctx context.Context) (func() services.TopologyLive, error) {
			fc, err := buildClientOrErr(c, di)
			if err != nil {
				return nil, err
			}
			bound := fc.WithContext(ctx)
			return bound.GetTopologyLive, nil
		})
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": "FortiGate login failed: " + err.Error()})
		return
	}
	defer unsubscribe()

	c.Header("Content-Type", "text/event-stream")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")
	c.Writer.WriteHeader(http.StatusOK)
	c.Writer.Flush()

	ticker := time.NewTicker(keepaliveInterval)
	defer ticker.Stop()
	ctx := c.Request.Context()
	for {
		select {
		case live, open := <-samples:
			if !open {
				return // the topic was torn down out from under us (should not happen while we
				// hold a subscription open, but an unread channel left this safe rather than silent)
			}
			body, err := json.Marshal(live)
			if err != nil {
				continue
			}
			c.SSEvent("topology-live", string(body))
			c.Writer.Flush()

		case <-ticker.C:
			if _, err := c.Writer.Write(keepaliveFrame); err != nil {
				return
			}
			c.Writer.Flush()

		case <-ctx.Done():
			return
		}
	}
}
