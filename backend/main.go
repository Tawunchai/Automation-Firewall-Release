package main

import (
	"context"
	"log"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"network_automation/config"
	middlewares "network_automation/middleware"
	"network_automation/routes"
	"network_automation/scheduler"
	"network_automation/services"
	"network_automation/services/platform"
)

// setupStructuredLogging points the standard library's own slog at stdout as JSON, so every
// slog.Info/Warn/Error call anywhere in the process — starting with middleware.RequestLogger's one
// line per request — is a parseable record instead of free text, with no logging library pulled in
// to get it (the stdlib has carried log/slog since Go 1.21). The plain `log` package above is left
// exactly as it was: migrating ~40-odd log.Printf call sites to attach structured fields is its own
// piece of work, and not needed for the one thing Phase A asked for — a line an operator can grep
// or ship to a collector when the backend gets slow or starts erroring, which this already is.
//
// LOG_LEVEL defaults to info; debug is for a local session that wants every request logged at the
// "ok" level too (RequestLogger already logs 4xx/5xx at warn/error regardless of this setting).
func setupStructuredLogging() {
	level := slog.LevelInfo
	switch strings.ToLower(os.Getenv("LOG_LEVEL")) {
	case "debug":
		level = slog.LevelDebug
	case "warn", "warning":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))
}

const maxBodyBytes int64 = 10 << 20 // 10 MB (รองรับ JSON + upload รูปสูงสุด 5MB)

func main() {
	// โหลด .env จาก root directory (หนึ่งระดับเหนือ backend/)
	if err := godotenv.Load("../.env"); err != nil {
		log.Println("[INFO] .env file not found, using system environment variables")
	}

	setupStructuredLogging()

	// Fail before the first byte is served if the secrets that protect stored device credentials
	// and the worker callback channel are missing or still set to a published placeholder. Both
	// used to fall back to a hard-coded default, which meant a real firewall's admin password sat
	// in the database under a key printed in docker-compose.yml.
	if err := platform.ValidateCredKeyConfig(); err != nil {
		log.Fatalf("[FATAL] %v", err)
	}
	if err := platform.ValidateWorkerSecret(); err != nil {
		log.Fatalf("[FATAL] %v", err)
	}

	config.ConnectDB()
	config.SetupDatabase()
	config.SeedDatabase()

	// Give the SSH host-key checker its store, before anything can open a session.
	//
	// Every SSH connection this console makes — the uptime probe, the Config Deploy terminal, the
	// ping/traceroute diagnostics — verifies the firewall's host key against the one it presented
	// the first time (services/sshhostkey.go). Until this line runs those connections REFUSE rather
	// than fall back to accepting any key, so a boot-order mistake here fails loudly instead of
	// quietly restoring the hole.
	platform.SetHostKeyStore(config.DB())

	// And the HTTPS certificate checker its store, before the first REST call.
	//
	// Same rule, port 443: the device's certificate is pinned on first sight and compared on every
	// connection afterwards (services/tlspin.go). This one differs in what happens if the line is
	// missing — the connection is accepted with a loud log rather than refused — because every page
	// of this console reads the firewall over that transport, including the pages an administrator
	// would use to work out why nothing loads.
	platform.SetTLSPinStore(config.DB())

	// Say at boot which devices cannot run unattended work, instead of leaving it to be discovered
	// by a backup failing at three in the morning with a message that blames the firewall.
	//
	// On this deployment every scheduled backup had failed since the feature shipped and nothing
	// said so anywhere: config_backups was empty, the Devices page looked normal, and the job
	// results pointed at the wrong thing. See services/automation_readiness.go.
	if pending := services.DevicesNeedingAutomationAccount(config.DB()); len(pending) > 0 {
		for _, d := range pending {
			log.Printf("⚠️  %s: %s", d.Name, services.DeviceAutomationReadiness(&d).Warning)
		}
	}

	// scheduler: สั่ง backup อัตโนมัติตามเวลาที่ตั้งไว้ต่ออุปกรณ์
	scheduler.Start()

	// บอกตั้งแต่ boot ว่า AI Assistant จะใช้โมเดลไหน — ไม่ต้องรอให้มีคนส่ง prompt ก่อนถึงจะรู้
	services.LogAIModel()

	port := os.Getenv("PORT")
	if port == "" {
		port = "9000"
	}

	r := gin.Default()

	// Match routes on the RAW path, so an object name containing a slash survives as ONE segment.
	//
	// FortiOS mkeys are user-chosen strings and several of them legitimately contain "/": a web
	// rating override is keyed by the URL it re-rates ("example.com/news/tech"), and address and
	// profile names are free text. By default gin matches on the already-decoded URL.Path, so a
	// key sent as "example.com%2Fnews" arrives as "example.com/news" and splits into two segments —
	// the route with one :param no longer matches and the request 404s. That made every by-key
	// GET / PUT / DELETE unreachable for exactly the objects whose keys are URLs.
	//
	// UseRawPath makes the router match the escaped form (so %2F is not a separator);
	// UnescapePathValues keeps c.Param() returning the decoded value, so handlers are unchanged.
	// Paths carrying no escapes are matched exactly as before — RawPath is empty for those and gin
	// falls back to Path.
	r.UseRawPath = true
	r.UnescapePathValues = true

	// Decide whose X-Forwarded-For we are willing to believe, BEFORE any middleware reads
	// c.ClientIP(). gin.Default() trusts every proxy, which means the header is really just a
	// client-supplied string — and two things depend on it:
	//
	//   · middleware.RateLimiter keys its buckets on it, so LoginLimiter (10 attempts / 15 min,
	//     the brute-force defence on /auth/login) and AILimiter (the cap on paid Anthropic calls)
	//     were both bypassable by sending a different X-Forwarded-For on each request;
	//   · auth.createSession records it as the session's origin, so the Sessions page would show
	//     whatever the client claimed.
	//
	// See trustedProxies for how the list is chosen; an unparseable entry is fatal rather than
	// silently ignored, because a typo here reopens both holes without any visible symptom.
	proxies := trustedProxies()
	if err := r.SetTrustedProxies(proxies); err != nil {
		log.Fatalf("[FATAL] TRUSTED_PROXIES: %v", err)
	}
	if len(proxies) == 0 {
		log.Println("[INFO] TRUSTED_PROXIES not set — X-Forwarded-For is ignored, client IP = the connecting address")
	} else {
		log.Printf("[INFO] trusting X-Forwarded-For from: %s", strings.Join(proxies, ", "))
	}

	r.Use(corsMiddleware())
	r.Use(bodyLimitMiddleware(maxBodyBytes))
	r.Use(middlewares.GeneralLimiter.Middleware())
	// One structured line per request, including the unauthenticated ones (/healthz, /auth/login)
	// the per-route middleware in routes.Setup never sees — see middleware/requestlog.go.
	r.Use(middlewares.RequestLogger())

	routes.Setup(r)

	// An approved change request is applied by REPLAYING it through this same engine, so the write
	// goes down the identical path as a direct one — same validation, same per-user device-access
	// check, same Change Ledger row. Handed over here, after the routes exist, because an engine
	// with no routes would serve every replay a 404 and record it as a device refusal.
	services.SetChangeRequestReplayer(r)

	// ── HTTP server พร้อม timeout (production-ready) ──────────────────────────
	// WriteTimeout = 0 เพราะมี SSE (/events) ที่เป็น connection แบบ long-lived
	// ReadHeaderTimeout ป้องกัน slowloris attack
	srv := &http.Server{
		Addr:              ":" + port,
		Handler:           r,
		ReadTimeout:       30 * time.Second,
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
		MaxHeaderBytes:    1 << 20, // 1 MB
	}

	// รัน server ใน goroutine เพื่อให้ main รอสัญญาณปิดได้
	go func() {
		log.Printf("✅ Server starting on port %s\n", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ Failed to run server: %v", err)
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────────────
	// รอ SIGINT / SIGTERM (เช่น docker stop) แล้วปิด server อย่างนุ่มนวล
	// ให้ request ที่ค้างอยู่ทำงานจนเสร็จภายใน 15 วินาที
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("⏳ Shutting down server...")

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	// Stop the scheduler FIRST, and before draining HTTP: it is the only thing that starts new
	// work on its own, so letting it enqueue another backup while the server is closing down
	// would leave a job queued that nothing is left to report on. It shares the 15s budget with
	// the HTTP drain because both must finish inside the same window docker gives us.
	scheduler.Stop(ctx)

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatalf("❌ Server forced to shutdown: %v", err)
	}
	log.Println("✅ Server exited cleanly")
}

// trustedProxies reads TRUSTED_PROXIES — a comma-separated list of IPs or CIDRs that sit in FRONT
// of this server and are allowed to set X-Forwarded-For.
//
// The default is DENY: with nothing configured, Gin ignores the header entirely and the client IP
// is the address that actually connected. That is the safe end of the trade-off, and it is correct
// for `go run` and for anyone hitting :9000 directly.
//
// It has to be configured for the docker deployment, where nginx is the only thing that talks to
// the backend: without it every user shares nginx's container IP, so one person's login attempts
// would spend everyone's rate-limit budget and the Sessions page would show the proxy for every
// login. docker-compose.yml pins nginx to a static address on appnet and passes exactly that /32 —
// the narrowest list that works, so publishing 9000 on the host does not hand the same trust to
// anything else on the bridge.
//
// Returning nil (not an empty slice) matters: gin.SetTrustedProxies(nil) is what disables the
// header, while a non-nil empty slice is a valid-but-empty allow list that behaves the same way
// only by accident.
func trustedProxies() []string {
	raw := os.Getenv("TRUSTED_PROXIES")
	if strings.TrimSpace(raw) == "" {
		return nil
	}
	var out []string
	for _, p := range strings.Split(raw, ",") {
		if t := strings.TrimSpace(p); t != "" {
			out = append(out, t)
		}
	}
	return out
}

func bodyLimitMiddleware(maxBytes int64) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, maxBytes)
		c.Next()
	}
}

func corsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.Request.Header.Get("Origin")

		// One list, read from one place: the two WebSocket upgraders (controller/terminal and
		// controller/diagstream) answer the same question with the same function, so an origin
		// added here cannot be missing there.
		if platform.AllowedBrowserOrigins()[origin] {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
		}
		c.Writer.Header().Set("Vary", "Origin")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		// If-None-Match is here for the conditional GETs (controller/policyobject/httpcache.go).
		// It is not a CORS-safelisted request header, so without it the browser silently drops the
		// revalidation header in dev — where the console runs cross-origin on :5173 — and every
		// request re-downloads the full 291 KB body while looking like it worked.
		c.Writer.Header().Set("Access-Control-Allow-Headers",
			"Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, If-None-Match, X-Requested-With, ngrok-skip-browser-warning",
		)
		// ETag is likewise not readable on a cross-origin response unless it is exposed. The browser
		// cache uses it either way; exposing it keeps it available to any client that revalidates by
		// hand rather than through the cache.
		c.Writer.Header().Set("Access-Control-Expose-Headers", "ETag")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE, PATCH")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}
