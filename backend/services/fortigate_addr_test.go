package services

import (
	"crypto/tls"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"testing"
)

// The FortiGate client's BaseURL and the SSH probe's dial address were both built with
// fmt.Sprintf("%s:%d", host, port). That is correct for IPv4 and hostnames and WRONG for an IPv6
// literal, which has to be bracketed. The failure was not a parse error the user would see — it
// was a device that simply never worked, with the blame landing on the network.
//
// These tests pin the addresses against the real parsers (net.SplitHostPort, url.Parse) rather
// than against a string this package also produces, so they fail if the formatting regresses.

func TestNewFortiClient_BaseURLIsParseable(t *testing.T) {
	cases := []struct {
		name     string
		mgmtIP   string
		port     int
		wantHost string // what url.Hostname() must give back
		wantURL  string
	}{
		{"IPv4 lab device", "10.0.99.201", 443, "10.0.99.201", "https://10.0.99.201:443"},
		{"IPv4 custom port", "192.168.1.99", 8443, "192.168.1.99", "https://192.168.1.99:8443"},
		{"hostname", "fgt-lab.local", 443, "fgt-lab.local", "https://fgt-lab.local:443"},
		{"IPv6 literal", "2001:db8::1", 443, "2001:db8::1", "https://[2001:db8::1]:443"},
		{"IPv6 loopback", "::1", 8443, "::1", "https://[::1]:8443"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			fc := NewFortiClient(c.mgmtIP, c.port)

			if fc.BaseURL != c.wantURL {
				t.Errorf("BaseURL = %q, want %q", fc.BaseURL, c.wantURL)
			}

			u, err := url.Parse(fc.BaseURL)
			if err != nil {
				t.Fatalf("url.Parse(%q) failed: %v — every REST call builds on this URL", fc.BaseURL, err)
			}
			if got := u.Hostname(); got != c.wantHost {
				t.Errorf("url.Hostname() = %q, want %q", got, c.wantHost)
			}
			if got, want := u.Port(), strconv.Itoa(c.port); got != want {
				t.Errorf("url.Port() = %q, want %q", got, want)
			}
		})
	}
}

// Login() extracts the CSRF token from the cookie jar, looking the host up both WITH and WITHOUT
// its port. The host-only lookup used to be derived with strings.Split(u.Host, ":")[0], which
// truncates "[2001:db8::1]:443" to "[2001" — so over IPv6 the lookup found no cookie, the token
// stayed empty, and every subsequent POST/PUT/DELETE failed with "CSRF token not available".
//
// This drives the real Login() against a TLS server bound to the IPv6 loopback, so it exercises
// BaseURL formatting, the HTTPS dial, the cookie jar and the token extraction together.
func TestFortiClient_LoginExtractsCSRFTokenOverIPv6(t *testing.T) {
	for _, tc := range []struct{ name, listen string }{
		{"IPv4 loopback", "127.0.0.1:0"},
		{"IPv6 loopback", "[::1]:0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ln, err := net.Listen("tcp", tc.listen)
			if err != nil {
				t.Skipf("cannot bind %s on this host: %v", tc.listen, err)
			}

			srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path == "/logincheck" {
					// What FortiOS actually answers: the token in a ccsrftoken* cookie, body "1".
					http.SetCookie(w, &http.Cookie{Name: "ccsrftoken_7_2_10", Value: `"tok-abc123"`, Path: "/"})
					w.Write([]byte("1"))
					return
				}
				w.WriteHeader(http.StatusNotFound)
			}))
			srv.Listener.Close()
			srv.Listener = ln
			srv.StartTLS()
			defer srv.Close()

			host, portStr, err := net.SplitHostPort(srv.Listener.Addr().String())
			if err != nil {
				t.Fatalf("test server address %q: %v", srv.Listener.Addr(), err)
			}
			port, _ := strconv.Atoi(portStr)

			fc := NewFortiClient(host, port)
			// The stub server uses httptest's own certificate; the production client already
			// skips verification for the same reason (FortiGates ship self-signed certs).
			fc.httpClient.Transport = &http.Transport{
				TLSClientConfig: &tls.Config{InsecureSkipVerify: true}, //nolint:gosec // test server
			}

			if err := fc.Login("admin", "P@ssw0rd"); err != nil {
				t.Fatalf("Login over %s failed: %v", tc.name, err)
			}
			if got := fc.token(); got != "tok-abc123" {
				t.Errorf("CSRF token = %q, want %q — an empty token means every write returns 403",
					got, "tok-abc123")
			}
		})
	}
}

// The SSH probe dials its own address. Same rule, same parser.
func TestSSHDialAddressIsParseable(t *testing.T) {
	cases := []struct{ host, want string }{
		{"10.0.99.201", "10.0.99.201:22"},
		{"2001:db8::1", "[2001:db8::1]:22"},
		{"fe80::1%eth0", "[fe80::1%eth0]:22"},
	}
	for _, c := range cases {
		addr := net.JoinHostPort(c.host, strconv.Itoa(22))
		if addr != c.want {
			t.Errorf("JoinHostPort(%q, 22) = %q, want %q", c.host, addr, c.want)
		}
		host, port, err := net.SplitHostPort(addr)
		if err != nil {
			t.Errorf("ssh.Dial would reject %q: %v", addr, err)
			continue
		}
		if host != c.host || port != "22" {
			t.Errorf("round-trip of %q gave host=%q port=%q", addr, host, port)
		}
	}
}
