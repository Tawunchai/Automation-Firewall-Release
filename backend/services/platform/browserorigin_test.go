package platform

import (
	"net/http"
	"testing"
)

// What this guard is actually for: a page the user is visiting opening a WebSocket to this app and
// riding their cookie into an SSH shell on a firewall. Each case below is one of the shapes that
// reaches.
func TestBrowserOriginAllowed(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://console.example.com, http://10.10.20.5:5173")

	cases := []struct {
		name   string
		origin string
		host   string
		want   bool
	}{
		{"no origin — a CLI, a test or a health check, never the attack this stops", "", "api.example.com", true},
		{"same host, same scheme — production through nginx", "https://10.10.20.5", "10.10.20.5", true},
		{"same host with a port — the dev backend addressed directly", "http://localhost:9000", "localhost:9000", true},
		{"same host, other scheme — the deployment switches HTTP/HTTPS", "http://10.10.20.5", "10.10.20.5", true},
		{"allow-listed origin — the Vite dev server", "http://10.10.20.5:5173", "10.10.20.5:9000", true},
		{"allow-listed origin — the configured console", "https://console.example.com", "api.example.com", true},
		{"the built-in dev default", "http://localhost:5173", "localhost:9000", true},

		{"a random site the user is browsing", "https://evil.example", "10.10.20.5", false},
		{"a lookalike host", "https://10.10.20.50", "10.10.20.5", false},
		{"the allow-listed name on a different port", "https://console.example.com:8443", "api.example.com", false},
		{"a sandboxed iframe or a file:// page", "null", "10.10.20.5", false},
		{"nonsense", "::not a url::", "10.10.20.5", false},
	}
	for _, c := range cases {
		if got := browserOriginAllowed(c.origin, c.host); got != c.want {
			t.Errorf("%s: browserOriginAllowed(%q, %q) = %v, want %v", c.name, c.origin, c.host, got, c.want)
		}
	}
}

// The allow-list must not be a hard-coded constant that ignores the deployment's configuration —
// that was how the WebSocket upgraders ended up with `return true` in the first place.
func TestAllowedBrowserOriginsReadsTheEnvironment(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "https://a.example , , https://b.example")
	got := AllowedBrowserOrigins()

	for _, want := range []string{"https://a.example", "https://b.example", "http://localhost:5173"} {
		if !got[want] {
			t.Errorf("%q is not allowed; list = %v", want, got)
		}
	}
	if got[""] {
		t.Error("an empty entry became an allowed origin — a trailing comma would open everything")
	}
}

// The shape that shipped broken: nginx forwards `Host $host`, which has NO port, so the Host the
// backend sees cannot be compared with an Origin that always has one. X-Forwarded-Host is what
// closes the gap, and these cases are the real traffic from the lab LAN.
func TestBrowserRequestHostPrefersTheForwardedAuthority(t *testing.T) {
	cases := []struct {
		name    string
		host    string
		fwd     string
		want    string
		allowed bool // browserOriginAllowed with Origin "http://10.10.20.5:5173"
	}{
		{"through nginx — $host dropped the port, X-Forwarded-Host kept it", "10.10.20.5", "10.10.20.5:5173", "10.10.20.5:5173", true},
		{"no proxy at all — a direct curl or `go run`", "10.10.20.5:5173", "", "10.10.20.5:5173", true},
		{"a proxy chain appends; the browser's authority is first", "backend:9000", "10.10.20.5:5173, inner.proxy", "10.10.20.5:5173", true},
		{"whitespace only — treated as absent", "10.10.20.5:5173", "   ", "10.10.20.5:5173", true},
		{"the bare host alone still does not match a ported origin", "10.10.20.5", "", "10.10.20.5", false},
		{"a forwarded authority that is NOT where the page is", "10.10.20.5", "other.host:5173", "other.host:5173", false},
	}
	for _, c := range cases {
		r, err := http.NewRequest(http.MethodGet, "http://example.invalid/terminal/1/shell", nil)
		if err != nil {
			t.Fatal(err)
		}
		r.Host = c.host
		if c.fwd != "" {
			r.Header.Set("X-Forwarded-Host", c.fwd)
		}
		if got := browserRequestHost(r); got != c.want {
			t.Errorf("%s: browserRequestHost() = %q, want %q", c.name, got, c.want)
		}
		if got := browserOriginAllowed("http://10.10.20.5:5173", browserRequestHost(r)); got != c.allowed {
			t.Errorf("%s: the LAN console origin was allowed = %v, want %v", c.name, got, c.allowed)
		}
	}
}

// Both upgraders hand their CheckOrigin straight to this, so these are the cases the Config Deploy
// terminal and the diagnostics stream answer.
func TestCheckWebsocketOrigin(t *testing.T) {
	t.Setenv("CORS_ALLOWED_ORIGINS", "")

	cases := []struct {
		name   string
		origin string
		host   string
		fwd    string
		want   bool
	}{
		{"the LAN console through nginx — the case that was refused", "http://10.10.20.5:5173", "10.10.20.5", "10.10.20.5:5173", true},
		{"the same over HTTPS on its published port", "https://10.10.20.5:5443", "10.10.20.5", "10.10.20.5:5443", true},
		{"the Vite dev server, which the allow-list covers", "http://localhost:5173", "localhost:9000", "", true},
		{"the Vite dev server by LAN IP, which only xfwd covers", "http://10.10.20.5:5173", "localhost:9000", "10.10.20.5:5173", true},
		{"no Origin — a CLI or the smoke suite", "", "10.10.20.5", "10.10.20.5:5173", true},

		{"a page on another site riding the cookie", "https://evil.example", "10.10.20.5", "10.10.20.5:5173", false},
		{"the right host on the wrong port — another app on the same box", "http://10.10.20.5:8080", "10.10.20.5", "10.10.20.5:5173", false},
		{"a forged X-Forwarded-Host that does not match the Origin either", "https://evil.example", "10.10.20.5", "evil.example.attacker", false},
	}
	for _, c := range cases {
		r, err := http.NewRequest(http.MethodGet, "http://example.invalid/diag-stream/1/ping", nil)
		if err != nil {
			t.Fatal(err)
		}
		r.Host = c.host
		if c.origin != "" {
			r.Header.Set("Origin", c.origin)
		}
		if c.fwd != "" {
			r.Header.Set("X-Forwarded-Host", c.fwd)
		}
		if got := CheckWebsocketOrigin(r); got != c.want {
			t.Errorf("%s: CheckWebsocketOrigin(Origin %q, Host %q, X-Forwarded-Host %q) = %v, want %v",
				c.name, c.origin, c.host, c.fwd, got, c.want)
		}
	}
}
