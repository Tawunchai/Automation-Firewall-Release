package services

import (
	"crypto/tls"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"sync"
	"sync/atomic"
	"testing"
)

// What these tests defend, and why it is not visible any other way.
//
// Every FortiClient used to build its own zero-value http.Transport. Two of that type's defaults
// are wrong for this workload, and both are invisible: the code is correct either way, the tests
// pass either way, and the only symptom is that the console feels slow.
//
//	MaxIdleConnsPerHost = 2   A fan-out of 37 reads (the audit scan) keeps 2 connections and
//	                          throws 35 away, so the NEXT fan-out opens 35 fresh sockets and pays
//	                          35 TLS handshakes. Measured on the lab FGT80E: 2.30-3.29s for 37
//	                          parallel GETs, versus 0.32s once the pool was sized for the burst.
//	no ClientSessionCache     Every handshake that does happen is a full one. Measured: 2.44s of
//	                          full handshakes against 0.59s of resumed ones for the same 37 reads.
//
// The end-to-end effect through the backend, against the real device: the Audit page went from
// 3.29s to 1.07s, the policy form's profile call from 0.90s to 0.22s, the dashboard from 1.00s to
// 0.35s. None of that is asserted here — a test cannot own a firewall — so what is pinned instead
// is the CONFIGURATION and the BEHAVIOUR that produced it.

func TestFortiClientsShareOneConnectionPool(t *testing.T) {
	// Shared on purpose: two people working on the same firewall under their own credentials each
	// hold their own FortiClient out of the session pool, and they should warm ONE set of
	// connections between them, not two. A per-client transport also makes the socket count grow
	// with the number of stored credentials rather than with the number of devices.
	a := NewFortiClient("10.0.0.1", 443)
	b := NewFortiClient("10.0.0.2", 443)

	ta, ok := a.httpClient.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("client A transport is %T, want *http.Transport", a.httpClient.Transport)
	}
	tb, _ := b.httpClient.Transport.(*http.Transport)
	if ta != tb {
		t.Error("each client built its own transport — the connection pool and the TLS session cache are then per client, which is what made a warm fan-out re-handshake")
	}
	if ta != fgTransport {
		t.Error("clients are not using the package transport, so tuning it has no effect")
	}
}

func TestEachClientKeepsItsOwnCookieJar(t *testing.T) {
	// The other half of sharing a transport: the SESSION must not be shared. The cookie jar is
	// what carries the identity the firewall logs against a change, so two credentials sharing one
	// jar would file Bob's edits under Alice's name — the exact confusion per-user credentials
	// exist to remove.
	a := NewFortiClient("10.0.0.1", 443)
	b := NewFortiClient("10.0.0.1", 443)

	if a.httpClient.Jar == nil || b.httpClient.Jar == nil {
		t.Fatal("a client without a cookie jar cannot hold a FortiGate session")
	}
	if a.httpClient.Jar == b.httpClient.Jar {
		t.Error("two clients share one cookie jar — one login would overwrite the other's session")
	}
}

func TestTransportIsTunedForADeviceFanout(t *testing.T) {
	if fgTransport.MaxIdleConnsPerHost < maxDeviceFanout {
		t.Errorf("MaxIdleConnsPerHost = %d, want >= maxDeviceFanout (%d): a burst wider than the "+
			"pool returns its tail to be closed, and the next burst re-handshakes it",
			fgTransport.MaxIdleConnsPerHost, maxDeviceFanout)
	}
	if fgTransport.MaxIdleConns < fgTransport.MaxIdleConnsPerHost {
		t.Errorf("MaxIdleConns (%d) < MaxIdleConnsPerHost (%d) — the global cap silently overrides the per-host one",
			fgTransport.MaxIdleConns, fgTransport.MaxIdleConnsPerHost)
	}
	if fgTransport.IdleConnTimeout <= 0 {
		t.Error("IdleConnTimeout is unset: connections would be held indefinitely against the firewall")
	}
	if fgTransport.TLSClientConfig == nil || fgTransport.TLSClientConfig.ClientSessionCache == nil {
		t.Error("no ClientSessionCache — every handshake that has to happen is a full one, which is " +
			"the difference between 0.59s and 2.44s for one audit's worth of reads")
	}
	if fgTransport.TLSClientConfig != nil && !fgTransport.TLSClientConfig.InsecureSkipVerify {
		t.Error("certificate verification is on — FortiGates ship self-signed certificates and every call would fail")
	}
}

// connCountingServer is a TLS server that counts how many TCP connections it accepted.
type connCountingServer struct {
	srv   *httptest.Server
	conns int32
}

func newConnCountingServer(t *testing.T) *connCountingServer {
	t.Helper()
	c := &connCountingServer{}
	c.srv = httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprint(w, `{"status":"success","http_status":200,"results":{}}`)
	}))
	c.srv.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			atomic.AddInt32(&c.conns, 1)
		}
	}
	c.srv.StartTLS()
	t.Cleanup(c.srv.Close)
	return c
}

func (c *connCountingServer) count() int { return int(atomic.LoadInt32(&c.conns)) }

// clientFor points a FortiClient at the fake device, through a transport configured exactly like
// the real one but with its own idle pool, so the test is not affected by whatever else is warm.
func clientFor(t *testing.T, srv *httptest.Server, maxIdlePerHost int) *FortiClient {
	t.Helper()
	fc := NewFortiClient("127.0.0.1", 1)
	fc.BaseURL = srv.URL

	tr := fgTransport.Clone()
	tr.MaxIdleConnsPerHost = maxIdlePerHost
	tr.MaxIdleConns = maxIdlePerHost * 4
	tr.TLSClientConfig = &tls.Config{
		InsecureSkipVerify: true, //nolint:gosec // a test server's own certificate
		ClientSessionCache: tls.NewLRUClientSessionCache(64),
	}
	// Cleared so the TLSClientConfig above is the one that applies.
	//
	// Production dials through fgDialTLS, which builds its own config from fgTLSConfig in order to
	// check the device's pinned certificate (services/tlspin.go) — and would therefore ignore the
	// line above entirely, leaving these tests quietly configuring nothing. These cases are about
	// CONNECTION POOLING against an httptest server that has no pin and should have none, so they
	// take the plain TLS path. tlspin_test.go asserts that production does not.
	tr.DialTLSContext = nil
	// Only the transport is swapped: the cookie jar and the timeout stay exactly as
	// NewFortiClient built them, so the client under test is the production one in every respect
	// but which pool it draws connections from. (Login dereferences the jar — a helper that
	// rebuilt httpClient without one would be testing a client that cannot exist.)
	fc.httpClient.Transport = tr
	t.Cleanup(tr.CloseIdleConnections)
	return fc
}

func TestAWarmFanoutReusesConnectionsInsteadOfReHandshaking(t *testing.T) {
	// The regression this catches, stated as behaviour: repeat the same wide burst. A pool sized
	// for the burst opens its connections once and keeps reusing them, so the total stays near the
	// width of ONE burst however many times it is repeated. Go's default of 2 throws all but two
	// away each time, so the total climbs with every repeat — which is the 2.3s the audit page was
	// spending on handshakes.
	//
	// Counted over several bursts rather than asserted burst-by-burst on purpose. A connection is
	// returned to the idle pool by its own read loop, slightly AFTER the response body is closed,
	// so at the instant one burst ends a few of its connections have not been parked yet and the
	// next burst dials replacements for them. That is a scheduling artefact of the test, not
	// behaviour worth pinning; over several rounds it is noise on a number whose two possible
	// values are far apart.
	const (
		fanout = 20
		rounds = 5
	)

	burst := func(t *testing.T, fc *FortiClient) {
		t.Helper()
		var wg sync.WaitGroup
		for i := 0; i < fanout; i++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if _, err := fc.do("GET", "/api/v2/cmdb/system/global", nil); err != nil {
					t.Errorf("request failed: %v", err)
				}
			}()
		}
		wg.Wait()
	}

	total := func(t *testing.T, maxIdlePerHost int) int {
		t.Helper()
		dev := newConnCountingServer(t)
		fc := clientFor(t, dev.srv, maxIdlePerHost)
		for r := 0; r < rounds; r++ {
			burst(t, fc)
		}
		return dev.count()
	}

	sized := total(t, fanout+8)
	// Five rounds of 20 could cost 100 connections with no reuse at all. Anything under half of
	// one extra round's worth on top of the first means the pool is doing its job; the measured
	// value is ~20-30.
	if limit := fanout * 2; sized > limit {
		t.Errorf("%d rounds of %d requests opened %d connections with a pool sized for the burst; "+
			"want <= %d — the connections are not being reused", rounds, fanout, sized, limit)
	}

	// The contrast, so the number above is readable as something other than an arbitrary bound.
	// Not asserted: this is a fact about net/http's default, and a future Go could change it
	// without anything in this repo being wrong.
	def := total(t, 2)
	t.Logf("connections opened over %d rounds of %d: pool sized for the burst = %d, Go's default (2) = %d",
		rounds, fanout, sized, def)
}

func TestLogoutReturnsItsConnectionToThePool(t *testing.T) {
	// Logout used to call Do() and never touch the response. An unread, unclosed body pins its
	// connection out of the pool for good — and Logout is called from precisely the paths that
	// churn sessions (a credential edit, a device edit, pool invalidation), so the one call whose
	// job is to RELEASE a slot on the device was also losing a socket on ours.
	dev := newConnCountingServer(t)
	fc := clientFor(t, dev.srv, 8)

	if _, err := fc.do("GET", "/api/v2/cmdb/system/global", nil); err != nil {
		t.Fatalf("warm-up call failed: %v", err)
	}
	warm := dev.count()

	for i := 0; i < 5; i++ {
		fc.Logout()
	}

	if got := dev.count(); got != warm {
		t.Errorf("five logouts opened %d extra connection(s) — each one abandoned its body, so the "+
			"connection could not be reused", got-warm)
	}
}
