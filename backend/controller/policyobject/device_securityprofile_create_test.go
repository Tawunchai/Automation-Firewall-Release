package policyobject

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// DeviceCreateSecurityProfile is one handler standing in for seven features.
//
// It reads a category out of the path and picks, from a switch, which form to bind and which of
// seven client methods to call. That shape fails quietly: a branch that binds the Web Filter form
// and calls the AntiVirus method still answers 201, and the only visible symptom is a profile of
// the wrong kind on a firewall nobody is watching. A status code cannot catch it; the stub records
// which method was called, which can.
//
// Needs Postgres for the device row and the access check — see the header of
// device_handler_db_test.go for the one-line container.

// profileCase is one category and the client method it must reach.
type profileCase struct {
	category string
	body     string
	wantCall string
}

// Each body is the smallest one its own validator accepts: several categories validate before the
// device is ever reached (DNS filter, file filter, SSL/SSH, IPS), and a body that fails validation
// would prove only that validation ran.
var profileCases = []profileCase{
	{"antivirus", `{"name":"AV-test"}`, "CreateAVProfile AV-test"},
	{"webfilter", `{"name":"WF-test"}`, "CreateWebFilterProfile WF-test"},
	{"dnsfilter", `{"name":"DNS-test"}`, "CreateDNSFilterProfile DNS-test"},
	{"application-control", `{"name":"APP-test"}`, "CreateAppControlProfile APP-test"},
	{"file-filter", `{"name":"FF-test"}`, "CreateFileFilterProfile FF-test"},
	{"ssl-ssh-inspection", `{"name":"SSL-test"}`, "CreateSSLSSHProfile SSL-test"},
	{"ips", `{"name":"IPS-test","entries":[{"filters":[{"severity":["high"]}],"action":"block","status":"enable"}]}`,
		"CreateIPSSensor IPS-test"},
}

func TestCreateSecurityProfileCallsTheMethodForItsOwnCategory(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range profileCases {
		t.Run(tc.category, func(t *testing.T) {
			stub := &stubClient{}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost,
				"security-profiles/"+tc.category, device.ID, testAdminUserID, "admin", tc.body,
				gin.Param{Key: "category", Value: tc.category})
			DeviceCreateSecurityProfile(c)

			if rec.Code != http.StatusCreated {
				t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
			}
			if !stub.didCall(tc.wantCall) {
				t.Fatalf("the %s branch did not call %q — it called %v",
					tc.category, tc.wantCall, stub.calls)
			}
			if len(stub.calls) != 1 {
				t.Errorf("one create should be one call on the device, got %v", stub.calls)
			}
		})
	}
}

// Every category must refuse a nameless profile before it reaches the firewall. FortiOS would
// answer with a code of its own, but a profile with no name is the caller's to fix and the device
// never needs to be asked.
func TestCreateSecurityProfileRefusesANamelessProfileWithoutTouchingTheDevice(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range profileCases {
		t.Run(tc.category, func(t *testing.T) {
			stub := &stubClient{}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost,
				"security-profiles/"+tc.category, device.ID, testAdminUserID, "admin", `{"name":"  "}`,
				gin.Param{Key: "category", Value: tc.category})
			DeviceCreateSecurityProfile(c)

			if rec.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
			if len(stub.calls) != 0 {
				t.Fatalf("the device was called for a profile with no name: %v", stub.calls)
			}
		})
	}
}

// A category this handler does not implement must say so, and must not fall through to some other
// category's branch — which is what an unguarded switch with a default would do.
func TestCreateSecurityProfileRefusesAnUnknownCategory(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost,
		"security-profiles/not-a-category", device.ID, testAdminUserID, "admin", `{"name":"X"}`,
		gin.Param{Key: "category", Value: "not-a-category"})
	DeviceCreateSecurityProfile(c)

	if rec.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want 501: %s", rec.Code, rec.Body.String())
	}
	if len(stub.calls) != 0 {
		t.Fatalf("an unknown category still reached the device: %v", stub.calls)
	}
}

// What the firewall said, through this handler: a name already taken is 409 carrying the code as a
// number, not a 502 that reads as "the firewall is broken".
func TestCreateSecurityProfilePassesTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{writeErr: &services.DeviceError{
		Code: services.FGErrDuplicate, HTTPStatus: 500, Text: "duplicate entry",
	}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost,
		"security-profiles/antivirus", device.ID, testAdminUserID, "admin", `{"name":"AV-test"}`,
		gin.Param{Key: "category", Value: "antivirus"})
	DeviceCreateSecurityProfile(c)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v", err)
	}
	if got := body["fortios_code"]; got != float64(services.FGErrDuplicate) {
		t.Fatalf("fortios_code = %v, want %d", got, services.FGErrDuplicate)
	}
}

// A device that never answered is the only case 502 belongs to, and it must not carry a device code.
func TestCreateSecurityProfileReportsAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{writeErr: errTransport{}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost,
		"security-profiles/antivirus", device.ID, testAdminUserID, "admin", `{"name":"AV-test"}`,
		gin.Param{Key: "category", Value: "antivirus"})
	DeviceCreateSecurityProfile(c)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	if strings.Contains(rec.Body.String(), "fortios_code") {
		t.Fatalf("a transport failure carried a device code: %s", rec.Body.String())
	}
}
