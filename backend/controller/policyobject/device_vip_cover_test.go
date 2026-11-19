package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Policy & Objects ▸ Virtual IPs.
//
// A VIP is one of the three object types this console will not let an operator write without a
// second pair of eyes (services.RequiresApproval), so the gate and the refusal matter more here
// than the happy path. The body is bound straight onto services.FGVirtualIP and adjudicated by
// services.ValidateVirtualIP — which is where the fqdn/-8 trap lives: an FQDN VIP maps one address
// NAME to another and must not carry extip at all.

func TestVirtualIPWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"web-vip","type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.10"}`

	checks := []struct {
		name   string
		method string
		tail   string
		body   string
		mkey   string
	}{
		{"create", http.MethodPost, "virtual-ips", body, ""},
		{"update", http.MethodPatch, "virtual-ips/web-vip", body, "web-vip"},
		{"delete", http.MethodDelete, "virtual-ips/web-vip", "", "web-vip"},
	}

	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, param("name", tc.mkey))

			switch tc.name {
			case "create":
				DeviceCreateVirtualIP(c)
			case "update":
				DeviceUpdateVirtualIP(c)
			case "delete":
				DeviceDeleteVirtualIP(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

func TestDeviceCreateVirtualIPSendsTheMappingTheFormDescribed(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "virtual-ips", device.ID, testAdminUserID, "admin",
		`{"name":"web-vip","type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.10",
		  "port_forward":true,"protocol":"tcp","ext_port":"443","mapped_port":"8443"}`)
	DeviceCreateVirtualIP(c)

	coverWantStatus(t, rec, http.StatusCreated)
	got := stub.gotVIP
	if got.ExtIP != "203.0.113.10" || got.MappedIP != "10.0.0.10" {
		t.Fatalf("the mapping sent is not the one described: %+v", got)
	}
	if !got.PortForward || got.ExtPort != "443" || got.MappedPort != "8443" {
		t.Fatalf("the port forward was lost: %+v", got)
	}
	// The response names the object, because the Apply path uses it to reference the VIP it just
	// created without re-reading the table.
	if !strings.Contains(rec.Body.String(), "web-vip") {
		t.Errorf("the created VIP is not named in the answer:\n%s", rec.Body.String())
	}
}

// Four bodies the device would answer with a bare code, refused here with a sentence and without
// a login.
func TestDeviceCreateVirtualIPRefusesWhatTheDeviceWouldOnlyAnswerWithACode(t *testing.T) {
	device := handlerTestDevice(t)

	cases := map[string]string{
		"a nameless VIP":                   `{"type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.10"}`,
		"static-nat with no external IP":   `{"name":"v","type":"static-nat","mapped_ip":"10.0.0.10"}`,
		"static-nat with no mapped IP":     `{"name":"v","type":"static-nat","ext_ip":"203.0.113.10"}`,
		"an external IP that is not an IP": `{"name":"v","type":"static-nat","ext_ip":"not-an-ip","mapped_ip":"10.0.0.10"}`,
		// The -8 trap: an FQDN VIP maps address NAMES, and both halves are required.
		"fqdn with no external address":  `{"name":"v","type":"fqdn","mapped_addr":"inside"}`,
		"a VIP type that does not exist": `{"name":"v","type":"teapot"}`,
		"port forwarding with no ports":  `{"name":"v","type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.10","port_forward":true,"protocol":"tcp"}`,
	}

	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost, "virtual-ips", device.ID, testAdminUserID, "admin", body)
			DeviceCreateVirtualIP(c)

			coverWantStatus(t, rec, http.StatusBadRequest)
			coverUntouched(t, stub)
		})
	}
}

// The object being edited is the one in the URL. The edit form does not have to resend the name,
// and if it does not, validation must not then refuse the request for having no name.
func TestDeviceUpdateVirtualIPTakesTheNameFromTheURLWhenTheBodyOmitsIt(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPatch, "virtual-ips/web-vip", device.ID, testAdminUserID, "admin",
		`{"type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.11"}`, param("name", "web-vip"))
	DeviceUpdateVirtualIP(c)

	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateVirtualIP web-vip") {
		t.Fatalf("the edit did not address web-vip: %v", stub.calls)
	}
	if stub.gotVIP.Name != "web-vip" {
		t.Errorf("the payload's name = %q, want it filled in from the URL", stub.gotVIP.Name)
	}
}

func TestDeviceVirtualIPWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)
	body := `{"name":"web-vip","type":"static-nat","ext_ip":"203.0.113.10","mapped_ip":"10.0.0.10"}`

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "virtual-ips", device.ID, testAdminUserID, "admin", body)
			DeviceCreateVirtualIP(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	// A VIP a policy still names as its destination.
	t.Run("delete: still referenced is 409 with the number", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "virtual-ips/web-vip", device.ID, testAdminUserID, "admin", "",
			param("name", "web-vip"))
		DeviceDeleteVirtualIP(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

func TestDeviceVirtualIPReadsServeWhatTheDeviceHolds(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{
		vips: []services.FGVirtualIP{{Name: "web-vip", Type: "static-nat", ExtIP: "203.0.113.10", MappedIP: "10.0.0.10"}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "virtual-ips", device.ID, testAdminUserID, "admin")
	DeviceListVirtualIPs(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "203.0.113.10") {
		t.Fatalf("the virtual IPs did not arrive:\n%s", rec.Body.String())
	}

	c, rec = deviceRequest(t, http.MethodGet, "virtual-ips/web-vip", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "web-vip"))
	DeviceGetVirtualIP(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceRequest(t, http.MethodGet, "virtual-ips/nope", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "nope"))
	DeviceGetVirtualIP(c)
	coverWantStatus(t, rec, http.StatusNotFound)
}

// The VIP list goes through respondDeviceError, so a device that never answered is 502 and carries
// no code, while a refusal the device DID make keeps its number.
func TestDeviceListVirtualIPsSeparatesAnUnreachableDeviceFromARefusal(t *testing.T) {
	device := handlerTestDevice(t)

	withDeviceClient(t, &coverStub{readErr: errTransport{}}, nil)
	c, rec := deviceRequest(t, http.MethodGet, "virtual-ips", device.ID, testAdminUserID, "admin")
	DeviceListVirtualIPs(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)

	withDeviceClient(t, &coverStub{readErr: coverDevErr(-37)}, nil)
	c, rec = deviceRequest(t, http.MethodGet, "virtual-ips", device.ID, testAdminUserID, "admin")
	DeviceListVirtualIPs(c)
	coverWantStatus(t, rec, http.StatusBadRequest)
	coverWantFortiOSCode(t, rec, -37)
}
