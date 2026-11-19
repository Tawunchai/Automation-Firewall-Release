package policyobject

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/entity"
	"network_automation/services"
)

// ── the stub ────────────────────────────────────────────────────────────────

// stubClient answers for a firewall in a test.
//
// It embeds deviceClient instead of implementing it, which is the whole reason a ~270-method seam
// is practical to test against: a test writes ONLY the methods its handler actually calls, and
// everything else is inherited from the nil embedded interface. A handler that reaches for a
// method the test said nothing about panics with that method's name in the trace — far better than
// a zero value that lets the assertion pass for the wrong reason.
type stubClient struct {
	deviceClient

	addresses    []services.FGAddress
	addressesErr error
	policies     []services.FGPolicy
	policiesErr  error

	svcs    []services.FGService
	svcsErr error

	// ifaces answers the CMDB list; availIfaces answers the monitor endpoint a handler prefers.
	// availIfacesErr is what makes the fallback between them testable.
	ifaces         []services.FGInterface
	ifacesErr      error
	availIfaces    []services.FGInterface
	availIfacesErr error

	sdnConns    []services.FGSDNConnector
	sdnConnsErr error

	hostname    string
	hostnameErr error
	status      services.FGSystemStatus
	statusErr   error

	profiles    []services.FGSecurityProfile
	profilesErr error

	// calls records every call a handler made that CHANGES something, or that it chose out of a
	// set of sibling methods, in order, as "<Method> <arg> <arg>".
	//
	// A status code cannot see which method a handler picked, and that is exactly the mistake the
	// security-profile create/update switches are shaped to make: seven categories choosing one of
	// seven client methods by a string label. A branch that fell through, or a label with a typo,
	// leaves the right-looking 201 and the wrong row on the firewall. Recording the name is what
	// turns "it answered 201" into "it wrote THAT object".
	calls []string

	// writeErr is what every recorded write answers with — one field rather than one per method,
	// so a device-refusal case is a single line in a table.
	writeErr error
}

// record notes a call and answers with whatever the test told the device to say. Empty parts are
// dropped, so a method with no mkey records just its name.
func (s *stubClient) record(parts ...string) error {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			kept = append(kept, p)
		}
	}
	s.calls = append(s.calls, strings.Join(kept, " "))
	return s.writeErr
}

func (s *stubClient) didCall(want string) bool {
	for _, got := range s.calls {
		if got == want {
			return true
		}
	}
	return false
}

// ── reads ───────────────────────────────────────────────────────────────────

func (s *stubClient) GetAddresses() ([]services.FGAddress, error) {
	return s.addresses, s.addressesErr
}

func (s *stubClient) GetPolicies() ([]services.FGPolicy, error) {
	return s.policies, s.policiesErr
}

func (s *stubClient) GetServices() ([]services.FGService, error) {
	return s.svcs, s.svcsErr
}

func (s *stubClient) GetInterfaces() ([]services.FGInterface, error) {
	s.calls = append(s.calls, "GetInterfaces")
	return s.ifaces, s.ifacesErr
}

func (s *stubClient) GetAvailableInterfaces() ([]services.FGInterface, error) {
	s.calls = append(s.calls, "GetAvailableInterfaces")
	return s.availIfaces, s.availIfacesErr
}

func (s *stubClient) GetSDNConnectors() ([]services.FGSDNConnector, error) {
	return s.sdnConns, s.sdnConnsErr
}

func (s *stubClient) GetHostname() (string, error) { return s.hostname, s.hostnameErr }

func (s *stubClient) GetSystemStatus() (services.FGSystemStatus, error) {
	return s.status, s.statusErr
}

func (s *stubClient) GetSecurityProfiles(category string) ([]services.FGSecurityProfile, error) {
	s.calls = append(s.calls, "GetSecurityProfiles "+category)
	return s.profiles, s.profilesErr
}

// ── writes: policies ────────────────────────────────────────────────────────

func (s *stubClient) CreatePolicy(p services.FGPolicy) (*services.FGPolicy, error) {
	if err := s.record("CreatePolicy", p.Name); err != nil {
		return nil, err
	}
	created := p
	created.PolicyID = 101
	return &created, nil
}

func (s *stubClient) TogglePolicyStatus(policyID int, enable bool) error {
	return s.record("TogglePolicyStatus", strconv.Itoa(policyID), strconv.FormatBool(enable))
}

func (s *stubClient) MovePolicy(policyID int, position string, refID int) error {
	return s.record("MovePolicy", strconv.Itoa(policyID), position, strconv.Itoa(refID))
}

func (s *stubClient) DeletePolicy(policyID int) error {
	return s.record("DeletePolicy", strconv.Itoa(policyID))
}

// ── writes: addresses and services ──────────────────────────────────────────

func (s *stubClient) CreateAddress(a services.FGAddress) error {
	return s.record("CreateAddress", a.Name, a.Type, a.Subnet)
}

func (s *stubClient) UpdateAddress(name string, a services.FGAddress) error {
	return s.record("UpdateAddress", name, a.Comment)
}

func (s *stubClient) DeleteAddress(name string) error {
	return s.record("DeleteAddress", name)
}

func (s *stubClient) CreateService(sv services.FGService) error {
	return s.record("CreateService", sv.Name, sv.Protocol, sv.TCPPortRange)
}

func (s *stubClient) UpdateService(name string, sv services.FGService) error {
	return s.record("UpdateService", name, sv.Protocol)
}

func (s *stubClient) DeleteService(name string) error {
	return s.record("DeleteService", name)
}

// ── writes: security profiles ───────────────────────────────────────────────
//
// Seven categories, seven client methods, chosen by a string label in one switch. Recording the
// method NAME is the only way a test can tell "it answered 201" from "it wrote the right kind of
// profile" — a label with a typo or a copy-pasted branch produces the same 201 and the wrong
// object on the firewall.

func (s *stubClient) CreateAVProfile(f services.AVProfileForm) error {
	return s.record("CreateAVProfile", f.Name)
}

func (s *stubClient) CreateWebFilterProfile(f services.WebFilterProfileForm) error {
	return s.record("CreateWebFilterProfile", f.Name)
}

func (s *stubClient) CreateDNSFilterProfile(f services.DNSFilterProfileForm) error {
	return s.record("CreateDNSFilterProfile", f.Name)
}

func (s *stubClient) CreateAppControlProfile(f services.AppControlProfileForm) error {
	return s.record("CreateAppControlProfile", f.Name)
}

func (s *stubClient) CreateFileFilterProfile(f services.FileFilterProfileForm) error {
	return s.record("CreateFileFilterProfile", f.Name)
}

func (s *stubClient) CreateSSLSSHProfile(f services.SSLSSHProfileForm) error {
	return s.record("CreateSSLSSHProfile", f.Name)
}

func (s *stubClient) CreateIPSSensor(f services.IPSSensorForm) error {
	return s.record("CreateIPSSensor", f.Name)
}

// withDeviceClient points the seam at one stub for the duration of a test, and puts it back
// afterwards. Every test that stubs the device must go through here: a test that reassigned
// acquireDeviceClient and forgot to restore it would leave every later test in the package talking
// to its stub, and they would pass without exercising anything.
func withDeviceClient(t *testing.T, fc deviceClient, err error) {
	t.Helper()
	prev := acquireDeviceClient
	acquireDeviceClient = func(c *gin.Context, di *deviceInfo) (deviceClient, error) {
		if err != nil {
			return nil, err
		}
		return fc, nil
	}
	t.Cleanup(func() { acquireDeviceClient = prev })
}

// testContext is a request with a recorder behind it, for the handler halves that do not need a
// database — buildClient and respondDeviceError both work purely off the context.
func testContext(method, target string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, target, nil)
	return c, rec
}

func sharedLogin() *deviceInfo {
	return &deviceInfo{
		Device: entity.NetworkDevice{Name: "FortiGate-80E", MgmtIP: "10.10.20.90", APIPort: 443},
		Login:  services.DeviceLogin{Username: "admin", Password: "x"},
	}
}

func personalLogin() *deviceInfo {
	di := sharedLogin()
	di.Login.Personal = true
	di.Login.CredentialID = 7
	return di
}

// ── the seam itself ─────────────────────────────────────────────────────────

func TestBuildClientReturnsWhateverTheSeamProduced(t *testing.T) {
	want := &stubClient{addresses: []services.FGAddress{{Name: "LAN"}}}
	withDeviceClient(t, want, nil)

	c, rec := testContext(http.MethodGet, "/policy/device/1/addresses")
	got, ok := buildClient(c, sharedLogin())

	if !ok {
		t.Fatalf("buildClient refused a session the seam granted; it wrote %d: %s", rec.Code, rec.Body.String())
	}
	if got != deviceClient(want) {
		t.Fatalf("buildClient handed back a different client than the seam produced")
	}
}

// The message on a failed PERSONAL login is not cosmetic: every retry spends one of the three
// attempts FortiOS allows before it locks that account, so the sentence has to send the user to
// their own stored credential rather than to the firewall.
func TestBuildClientNamesTheUsersOwnAccountWhenTheirLoginFails(t *testing.T) {
	withDeviceClient(t, nil, &services.DeviceError{Code: -1, HTTPStatus: 401, Text: "authentication failed"})

	c, rec := testContext(http.MethodGet, "/policy/device/1/addresses")
	if _, ok := buildClient(c, personalLogin()); ok {
		t.Fatal("buildClient reported success on a login the seam refused")
	}
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadGateway)
	}

	body := rec.Body.String()
	for _, must := range []string{"admin", "Profile", "Device Credentials"} {
		if !strings.Contains(body, must) {
			t.Errorf("the refusal does not mention %q, so it does not say whose account to go and fix:\n%s", must, body)
		}
	}
}

// A shared device account is nobody's to fix from their profile, so that sentence must NOT appear —
// it would send the user to a page that cannot help them.
func TestBuildClientReportsAFailedSharedLoginWithoutTheProfileAdvice(t *testing.T) {
	withDeviceClient(t, nil, &services.DeviceError{Code: -1, HTTPStatus: 401, Text: "authentication failed"})

	c, rec := testContext(http.MethodGet, "/policy/device/1/addresses")
	if _, ok := buildClient(c, sharedLogin()); ok {
		t.Fatal("buildClient reported success on a login the seam refused")
	}
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadGateway)
	}
	if body := rec.Body.String(); strings.Contains(body, "Device Credentials") {
		t.Errorf("a shared-account failure points the user at their own profile, which cannot fix it:\n%s", body)
	}
}

// ── the error contract ──────────────────────────────────────────────────────

// What the firewall said, as an HTTP status and a NUMBER the client can compare.
//
// This is the contract fortiosError.ts depends on, and it has no text fallback by design: if a
// branch here stopped emitting fortios_code, Apply would silently lose its idempotency and Fallback
// would stop recognising "already gone". The substring trap this replaced is why "-5" must never be
// matched as text — see services/fortigate_error.go.
func TestRespondDeviceErrorMapsWhatTheFirewallSaid(t *testing.T) {
	cases := []struct {
		name     string
		method   string
		err      error
		want     int
		wantCode interface{} // nil = the body must carry no fortios_code at all
	}{
		{
			name:     "a name already taken is the caller's input, not a broken gateway",
			method:   http.MethodPost,
			err:      &services.DeviceError{Code: services.FGErrDuplicate, HTTPStatus: 500, Text: "duplicate entry"},
			want:     http.StatusConflict,
			wantCode: float64(services.FGErrDuplicate),
		},
		{
			name:     "still referenced is a conflict the user can go and resolve",
			method:   http.MethodDelete,
			err:      &services.DeviceError{Code: services.FGErrStillReferenced, HTTPStatus: 500, Text: "resource in use"},
			want:     http.StatusConflict,
			wantCode: float64(services.FGErrStillReferenced),
		},
		{
			name:     "gone, on a request that addressed one object",
			method:   http.MethodDelete,
			err:      &services.DeviceError{Code: -3, HTTPStatus: 404, Text: "entry not found"},
			want:     http.StatusNotFound,
			wantCode: float64(-3),
		},
		{
			name: "the same code on a CREATE is a body to fix, never 'already gone'",
			// A POST addresses no object, so -3 means a name IN THE BODY did not resolve. 404 here
			// would read to the client as the end state a delete wanted.
			method:   http.MethodPost,
			err:      &services.DeviceError{Code: -3, HTTPStatus: 500, Text: "entry not found"},
			want:     http.StatusBadRequest,
			wantCode: float64(-3),
		},
		{
			name:     "any other device code is still the request's problem",
			method:   http.MethodPut,
			err:      &services.DeviceError{Code: -651, HTTPStatus: 500, Text: "reserved name"},
			want:     http.StatusBadRequest,
			wantCode: float64(-651),
		},
		{
			name:     "nothing answered at all is the one case 502 is right for",
			method:   http.MethodGet,
			err:      errTransport{},
			want:     http.StatusBadGateway,
			wantCode: nil,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := testContext(tc.method, "/policy/device/1/addresses")
			if !respondDeviceError(c, tc.err, "address") {
				t.Fatal("respondDeviceError reported that it wrote nothing for a non-nil error")
			}
			if rec.Code != tc.want {
				t.Fatalf("status = %d, want %d (body: %s)", rec.Code, tc.want, rec.Body.String())
			}

			var body map[string]interface{}
			if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
				t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
			}
			got, present := body["fortios_code"]
			switch {
			case tc.wantCode == nil && present:
				t.Errorf("a transport failure carried fortios_code %v; the client would read it as a refusal the firewall never made", got)
			case tc.wantCode != nil && !present:
				t.Errorf("no fortios_code in the body — fortiosError.ts has no text fallback, so this refusal becomes unrecognisable:\n%s", rec.Body.String())
			case tc.wantCode != nil && got != tc.wantCode:
				t.Errorf("fortios_code = %v, want %v", got, tc.wantCode)
			}
			if _, hasErr := body["error"]; !hasErr {
				t.Errorf("no error sentence in the body: %s", rec.Body.String())
			}
		})
	}
}

func TestRespondDeviceErrorWritesNothingWhenThereIsNoError(t *testing.T) {
	c, rec := testContext(http.MethodGet, "/policy/device/1/addresses")
	if respondDeviceError(c, nil, "address") {
		t.Fatal("respondDeviceError claims to have answered a nil error")
	}
	if rec.Code != http.StatusOK || rec.Body.Len() != 0 {
		t.Fatalf("it wrote something anyway: %d %s", rec.Code, rec.Body.String())
	}
}

// errTransport stands for the failures that are NOT the firewall answering: unreachable, TLS,
// timeout, a cancelled request. It carries no code and no http_status, which is exactly what
// separates it from a *services.DeviceError.
type errTransport struct{}

func (errTransport) Error() string {
	return `Post "https://10.10.20.90:443/logincheck": dial tcp 10.10.20.90:443: i/o timeout`
}

// ── the VDOM guard ──────────────────────────────────────────────────────────

// ?vdom= lands in a URL query on the device, so a name carrying & or ? would let a caller append
// parameters to every CMDB call this console makes. A bad name is DROPPED rather than sanitised:
// a silently altered tenant name would read from a VDOM the operator did not ask for.
//
// Each value is URL-encoded on the way in, which is the only way a name containing & or a space
// arrives as ONE query value — unencoded, the net/url parser splits it long before this function
// sees it, and the test would be proving something else.
func TestRequestVDOMTakesOnlyRealVDOMNames(t *testing.T) {
	cases := map[string]string{
		"":                      "",
		"root":                  "root",
		"Customer_A":            "Customer_A",
		"branch-1":              "branch-1",
		"root&access_token=x":   "",
		"root?x=1":              "",
		"root/../admin":         "",
		"root vdom":             "",
		strings.Repeat("v", 31): strings.Repeat("v", 31),
		strings.Repeat("v", 32): "",
	}

	for in, want := range cases {
		c, _ := testContext(http.MethodGet, "/policy/device/1/addresses?vdom="+url.QueryEscape(in))
		if got := requestVDOM(c); got != want {
			t.Errorf("requestVDOM(%q) = %q, want %q", in, got, want)
		}
	}
}
