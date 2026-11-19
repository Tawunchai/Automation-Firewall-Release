package middlewares

import (
	"log/slog"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// RequestLogger is the answer to "if the backend got slow or started erroring right now, how would
// we know" — nothing before this emitted one structured line per request. gin.Default()'s own
// logger writes a fixed-format text line to stdout that nothing downstream can filter, aggregate or
// alert on; this writes the same facts as JSON through log/slog (the standard library's own
// structured logger — see main.go for why no external dependency was pulled in for this), and feeds
// services.RecordRequest so /admin/system-metrics has a running total without re-parsing logs.
//
// Registered globally in main.go, ahead of routes.Setup, so it sees every request including the
// unauthenticated ones (/healthz, /auth/login) that the per-route middleware below never touches.
func RequestLogger() gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		path := c.Request.URL.Path
		if c.Request.URL.RawQuery != "" {
			path = path + "?" + c.Request.URL.RawQuery
		}

		c.Next()

		dur := time.Since(start)
		status := c.Writer.Status()
		services.RecordRequest(status, dur)

		attrs := []any{
			"method", c.Request.Method,
			"path", path,
			"status", status,
			"duration_ms", float64(dur.Microseconds()) / 1000,
			"remote_ip", c.ClientIP(),
		}
		if uid, ok := c.Get("user_id"); ok {
			attrs = append(attrs, "user_id", uid)
		}
		if deviceID := c.Param("deviceId"); deviceID != "" {
			attrs = append(attrs, "device_id", deviceID)
		}

		switch {
		case status >= 500:
			// A server error after c.Next() already has its own log line from whatever returned
			// it, where one exists; this is the one line guaranteed to exist for EVERY 5xx, with
			// the fields an on-call person filters on first — method, path, status.
			slog.Error("request", attrs...)
		case status >= 400:
			slog.Warn("request", attrs...)
		default:
			slog.Info("request", attrs...)
		}
	}
}
