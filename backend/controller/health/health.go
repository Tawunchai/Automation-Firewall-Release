package health

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/config"
	"network_automation/services/platform"
)

// Liveness and readiness for the API container.
//
// What was here before: `GET /` returning the string "API RUNNING", written by the router before
// anything else is touched. It answers 200 while Postgres is down, while Redis is down, and while
// the process is mid-shutdown — so docker-compose had no healthcheck on the backend at all, nothing
// waited for it, and "the container is up" and "the console works" were unrelated facts.
//
// Two endpoints, because they answer different questions and a single one cannot:
//
//	/healthz   is the PROCESS alive and serving? Cheap, no dependencies, never fails while the
//	           server is accepting connections. This is what an orchestrator restarts on.
//	/readyz    can it actually do its job — reach the database and the queue? This is what a
//	           deploy waits for and what a load balancer routes on. A failing dependency here
//	           should take the instance out of rotation, NOT restart it: restarting the API does
//	           not fix Postgres, and a crash loop during a database blip is worse than a pause.
//
// Both are unauthenticated, because the thing calling them has no session — docker's HEALTHCHECK
// runs inside the container with curl. That constrains what they may say: a probe is a fine place
// to leak a hostname, a DSN or a version to anyone who can reach the port, so the body carries
// component names and the words ok/fail and nothing else. The error from a failed ping is logged
// where it belongs, on the server, not returned.

// probeTimeout bounds each dependency check. Short on purpose: a readiness probe that hangs is
// indistinguishable from one that failed, except that it also holds a connection while doing it.
const probeTimeout = 2 * time.Second

// Live answers "is this process up and serving HTTP".
//
// Deliberately touches nothing. A liveness probe that consults the database restarts the API when
// the DATABASE is unwell, which is the one reaction guaranteed not to help.
func Live(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

// Ready answers "can this process reach what it needs to serve a request".
//
// 503 when any dependency is unreachable, so the status code alone is actionable and a caller need
// not parse the body.
func Ready(c *gin.Context) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), probeTimeout)
	defer cancel()

	checks := gin.H{
		"database": pingDatabase(ctx),
		"redis":    pingRedis(ctx),
	}

	status := http.StatusOK
	for _, v := range checks {
		if v != "ok" {
			status = http.StatusServiceUnavailable
			break
		}
	}

	c.JSON(status, gin.H{
		"status": map[bool]string{true: "ok", false: "degraded"}[status == http.StatusOK],
		"checks": checks,
	})
}

// pingDatabase verifies the connection POOL, not just that a handle exists.
//
// `config.DB()` returns a non-nil *gorm.DB whether or not Postgres is reachable — the failure only
// surfaces on a query — so checking it for nil would report a healthy backend with a dead database.
func pingDatabase(ctx context.Context) string {
	gdb := config.DB()
	if gdb == nil {
		return "fail"
	}
	sqlDB, err := gdb.DB()
	if err != nil {
		return "fail"
	}
	if err := sqlDB.PingContext(ctx); err != nil {
		return "fail"
	}
	return "ok"
}

// pingRedis checks the queue the Python worker reads from.
//
// It is a dependency of readiness rather than of liveness: with Redis down the API still serves
// every device-proxy route, which is most of the console — but no backup, config push or
// compliance run can be enqueued, so it is not ready to take a deploy's traffic.
func pingRedis(ctx context.Context) string {
	rdb := platform.Redis()
	if rdb == nil {
		return "fail"
	}
	if err := rdb.Ping(ctx).Err(); err != nil {
		return "fail"
	}
	return "ok"
}
