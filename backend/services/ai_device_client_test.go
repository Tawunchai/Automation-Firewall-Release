package services

import (
	"network_automation/services/platform"
	"strings"
	"sync"
	"sync/atomic"
	"testing"

	"network_automation/entity"
)

// The AI Assistant reads the live device before every prompt (buildLiveDeviceContext). It used to
// do that on a PRIVATE client — NewFortiClient + Login + defer Logout — while every other path in
// the app took a pooled session. Two things went wrong with that, and both are asserted here:
//
//  1. it paid a login and a logout per prompt against a device the pool already had open;
//  2. it had no circuit breaker, so with wrong credentials the "Generate" button could drive the
//     device past admin-lockout-threshold 3 and lock the firewall's admin account for 60s.
//
// These drive the real deviceAPIClient against the fake FortiGate from fortigate_sessionpool_test.go, so
// the login/logout counts are exact rather than inferred.

// testLogin is the account the AI path now reaches the device with — the same shape
// services.ResolveDeviceLogin hands every other interactive caller. CredentialID 0 puts it in the
// device's own pool slot, which is what makes the "shares the pool with the device proxy" assertion
// below meaningful.
var testLogin = DeviceLogin{Username: "admin", Password: "P@ssw0rd"}

// testDevice builds a NetworkDevice whose PasswordEnc really decrypts, so the test exercises the
// decrypt → acquire chain rather than skipping past it.
func testDevice(t *testing.T, id uint, host string) *entity.NetworkDevice {
	t.Helper()
	// A key that is not on the leaked list, so EncryptSecret/DecryptSecret accept it.
	t.Setenv("CRED_ENC_KEY_VERSION", "1")
	t.Setenv("CRED_ENC_KEY", "9f2c4b1ea77d3568bb0c41d9e5a6f30c9f2c4b1ea77d3568bb0c41d9e5a6f30c")

	enc, err := platform.EncryptSecret("P@ssw0rd")
	if err != nil {
		t.Fatalf("EncryptSecret: %v", err)
	}
	d := &entity.NetworkDevice{
		Name: "FortiGate-lab", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: host, Port: 22, // Port is the SSH port — the REST client must NOT use it
		Username: "admin", PasswordEnc: enc,
	}
	d.ID = id
	return d
}

// The regression itself: the AI path must reuse the session the Policy & Objects pages already
// opened, not add a login and a logout of its own.
func TestDeviceAPIClient_SharesThePoolWithDeviceProxy(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	device := testDevice(t, 1, host)

	// A Policy & Objects page load — this is what controller/policyobject.buildClient does.
	if _, err := AcquireFortiClient(device.ID, host, port, DeviceLogin{Username: "admin", Password: "P@ssw0rd"}); err != nil {
		t.Fatalf("device-proxy acquire: %v", err)
	}

	// Now three AI prompts in a row against the same device.
	for i := 0; i < 3; i++ {
		fc, err := deviceAPIClient(device, testLogin, port)
		if err != nil {
			t.Fatalf("AI prompt %d: %v", i, err)
		}
		if _, err := fc.do("GET", "/api/v2/cmdb/firewall/address", nil); err != nil {
			t.Fatalf("AI prompt %d read: %v", i, err)
		}
	}

	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 — the AI path must reuse the pooled session, not open its own", got)
	}
	if got := atomic.LoadInt32(&fg.logouts); got != 0 {
		t.Errorf("logouts = %d, want 0 — the pooled session is shared and must outlive the prompt", got)
	}
	if got := PooledSessionCount(); got != 1 {
		t.Errorf("pooled sessions = %d, want 1 (one device, one session)", got)
	}
}

// Logging out would be worse than wasteful: the session is shared, so it would close the
// connection out from under whatever Policy & Objects request is in flight. Pin that the client
// handed back is the very same object the pool holds, which is what makes Logout unsafe.
func TestDeviceAPIClient_ReturnsThePooledClientItself(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	device := testDevice(t, 1, host)

	fromAI, err := deviceAPIClient(device, testLogin, port)
	if err != nil {
		t.Fatalf("AI acquire: %v", err)
	}
	fromProxy, err := AcquireFortiClient(device.ID, host, port, DeviceLogin{Username: "admin", Password: "P@ssw0rd"})
	if err != nil {
		t.Fatalf("proxy acquire: %v", err)
	}
	if fromAI != fromProxy {
		t.Error("the AI path and the device-proxy path got different clients — they are not sharing a session")
	}
}

// With bad credentials the old code hammered the device once per prompt. The breaker has to stop
// at 2 so the account still has headroom before FortiOS locks it at 3.
func TestDeviceAPIClient_StopsBeforeDeviceLockout(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	fg.rejectLogin.Store(true)
	device := testDevice(t, 1, host)

	// A frustrated user pressing "Generate" six times.
	for i := 0; i < 6; i++ {
		if _, err := deviceAPIClient(device, testLogin, port); err == nil {
			t.Fatalf("prompt %d unexpectedly got a client from a device refusing the login", i)
		}
	}

	const deviceLockoutThreshold = 3 // `admin-lockout-threshold 3` on the lab FGT80E
	got := int(atomic.LoadInt32(&fg.logins))
	if got >= deviceLockoutThreshold {
		t.Errorf("sent %d login attempts; the device locks the admin account at %d — six AI prompts must not do that",
			got, deviceLockoutThreshold)
	}
}

// Concurrency matters here specifically: buildLiveDeviceContext fans out ~15 reads across
// goroutines on the client it is handed. Acquiring must not race into several logins.
func TestDeviceAPIClient_ConcurrentPromptsLogInOnce(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)
	device := testDevice(t, 1, host)

	var wg sync.WaitGroup
	errs := make([]error, 8)
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			fc, err := deviceAPIClient(device, testLogin, port)
			if err != nil {
				errs[i] = err
				return
			}
			_, errs[i] = fc.do("GET", "/api/v2/cmdb/firewall/address", nil)
		}(i)
	}
	wg.Wait()

	for i, err := range errs {
		if err != nil {
			t.Fatalf("goroutine %d: %v", i, err)
		}
	}
	if got := atomic.LoadInt32(&fg.logins); got != 1 {
		t.Errorf("logins = %d, want 1 for 8 parallel prompts", got)
	}
}

// A device nobody has an account for must fail before any network call.
//
// The decryption itself moved upstream — deviceAPIClient is handed a resolved DeviceLogin now, and
// services.ResolveDeviceLogin is what turns an unreadable credential into an error. What is left to
// guard here is the same property one level down: an empty login is not a login attempt, so a
// misconfigured device cannot spend one of the three tries FortiOS allows before it locks an
// account.
func TestDeviceAPIClient_NoAccountDoesNotTouchTheDevice(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	device := testDevice(t, 1, host)

	_, err := deviceAPIClient(device, DeviceLogin{}, port)
	if err == nil {
		t.Fatal("expected an error when no account is set up for the device")
	}
	if !strings.Contains(err.Error(), "no account") {
		t.Errorf("error %q should say no account is set up", err)
	}
	if got := atomic.LoadInt32(&fg.logins); got != 0 {
		t.Errorf("logins = %d, want 0 — a missing account must not become a login attempt", got)
	}
}

// The pool key is (deviceID, host, port). If the AI path and the device-proxy path disagree about
// the port they silently open TWO sessions to the same firewall — the exact waste this change
// removed, back again and invisible. policyobject.defaultAPIPort is an alias of this constant;
// this pins the value both resolve to.
func TestDefaultAPIPort_IsTheFortiGateHTTPSPort(t *testing.T) {
	if DefaultAPIPort != 443 {
		t.Errorf("DefaultAPIPort = %d, want 443 (FortiGate REST API is HTTPS)", DefaultAPIPort)
	}
}

// The device's SSH port must never be mistaken for the REST port: NetworkDevice.Port is 22 by
// default and is what the netmiko worker dials, not the API.
func TestDeviceAPIClient_IgnoresTheSSHPort(t *testing.T) {
	resetPool(t)
	fg := newPoolFakeDevice(t)
	host, port := fg.hostPort(t)

	device := testDevice(t, 1, host)
	device.Port = 22 // SSH

	if _, err := deviceAPIClient(device, testLogin, port); err != nil {
		t.Fatalf("acquire should use the port it is given, not device.Port: %v", err)
	}
	if _, ok := fortiSessions.entries[sessionKey(1, host, port, poolScopeFor(0))]; !ok {
		t.Errorf("pool key uses the wrong port — entries: %v", keysOf(fortiSessions.entries))
	}
}

func keysOf(m map[string]*pooledSession) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
