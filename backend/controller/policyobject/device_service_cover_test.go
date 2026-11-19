package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Policy & Objects ▸ Services.
//
// The whole domain turns on two renames the device insists on and the GUI hides: ICMPv6 is spelled
// ICMP6 in the CMDB, and "Uncategorized" is this console's word for a service with no category
// rather than a category called that. Everything else here is the gate and the error contract.

func TestSvcInputToFGRenamesWhatTheDeviceSpellsDifferently(t *testing.T) {
	t.Run("ICMPv6 is ICMP6 on the device", func(t *testing.T) {
		got := svcInputToFG(serviceInput{Name: "ping6", Protocol: "ICMPv6"})
		if got.Protocol != "ICMP6" {
			t.Fatalf("protocol = %q, want \"ICMP6\" — the CMDB has no ICMPv6", got.Protocol)
		}
	})

	t.Run("Uncategorized is not a category to send", func(t *testing.T) {
		got := svcInputToFG(serviceInput{Name: "x", Protocol: "TCP", Category: "Uncategorized"})
		if len(got.Category) != 0 {
			t.Fatalf("category = %+v, want none — \"Uncategorized\" is the UI's word for absent", got.Category)
		}
	})

	t.Run("a real category travels as one named member", func(t *testing.T) {
		got := svcInputToFG(serviceInput{Name: "x", Protocol: "TCP", Category: "Web Access"})
		if len(got.Category) != 1 || got.Category[0].Name != "Web Access" {
			t.Fatalf("category = %+v, want exactly Web Access", got.Category)
		}
	})

	t.Run("the three optional numbers are only sent when the form gave them", func(t *testing.T) {
		bare := svcInputToFG(serviceInput{Name: "x", Protocol: "ICMP"})
		if bare.ICMPType != nil || bare.ICMPCode != nil || bare.ProtocolNum != 0 {
			t.Fatalf("an omitted icmp type/code or ip protocol was invented: %+v", bare)
		}

		typ, code, proto := 8, 0, 47
		got := svcInputToFG(serviceInput{
			Name: "x", Protocol: "ICMP", ICMPType: &typ, ICMPCode: &code, IPProto: &proto,
		})
		if got.ICMPType == nil || *got.ICMPType != 8 {
			t.Errorf("icmp type = %v, want 8", got.ICMPType)
		}
		// Code 0 is a real ICMP code and must survive as a pointer rather than be read as absent.
		if got.ICMPCode == nil || *got.ICMPCode != 0 {
			t.Errorf("icmp code = %v, want 0 — zero is a code, not a missing field", got.ICMPCode)
		}
		if got.ProtocolNum != 47 {
			t.Errorf("ip protocol = %d, want 47", got.ProtocolNum)
		}
	})

	t.Run("the port ranges pass through as the device's three strings", func(t *testing.T) {
		got := svcInputToFG(serviceInput{
			Name: "web", Protocol: "TCP/UDP/SCTP",
			TCPPorts: "80 443", UDPPorts: "53", SCTPPorts: "9000-9100",
			FQDN: "*.example.com", IPRange: "10.0.0.1-10.0.0.9",
		})
		if got.TCPPortRange != "80 443" || got.UDPPortRange != "53" || got.SCTPPortRange != "9000-9100" {
			t.Errorf("port ranges = %q / %q / %q", got.TCPPortRange, got.UDPPortRange, got.SCTPPortRange)
		}
		if got.FQDN != "*.example.com" || got.IPRange != "10.0.0.1-10.0.0.9" {
			t.Errorf("the fqdn/iprange restriction was dropped: %+v", got)
		}
	})
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestServiceWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"HTTP-8080","protocol":"TCP","tcp_ports":"8080"}`

	t.Run("create", func(t *testing.T) {
		stub := &stubClient{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodPost, "services", "user", body)
		DeviceCreateService(c)
		coverWantStatus(t, rec, http.StatusForbidden)
		if len(stub.calls) != 0 {
			t.Fatalf("the handler reached the device anyway: %v", stub.calls)
		}
	})

	t.Run("update", func(t *testing.T) {
		stub := &stubClient{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodPatch, "services/HTTP-8080", "user", body, param("name", "HTTP-8080"))
		DeviceUpdateService(c)
		coverWantStatus(t, rec, http.StatusForbidden)
		if len(stub.calls) != 0 {
			t.Fatalf("the handler reached the device anyway: %v", stub.calls)
		}
	})

	t.Run("delete", func(t *testing.T) {
		stub := &stubClient{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodDelete, "services/HTTP-8080", "user", "", param("name", "HTTP-8080"))
		DeviceDeleteService(c)
		coverWantStatus(t, rec, http.StatusForbidden)
		if len(stub.calls) != 0 {
			t.Fatalf("the handler reached the device anyway: %v", stub.calls)
		}
	})
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestDeviceServiceCRUDAddressesTheObjectInTheURL(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "services", device.ID, testAdminUserID, "admin",
		`{"name":"HTTP-8080","protocol":"TCP","tcp_ports":"8080"}`)
	DeviceCreateService(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if !stub.didCall("CreateService HTTP-8080 TCP 8080") {
		t.Fatalf("the device was not asked to create that service: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "services/HTTP-8080", device.ID, testAdminUserID, "admin",
		`{"name":"HTTP-8080","protocol":"UDP","udp_ports":"8080"}`, param("name", "HTTP-8080"))
	DeviceUpdateService(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.didCall("UpdateService HTTP-8080 UDP") {
		t.Fatalf("the edit did not address HTTP-8080: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "services/HTTP-8080", device.ID, testAdminUserID, "admin", "",
		param("name", "HTTP-8080"))
	DeviceDeleteService(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.didCall("DeleteService HTTP-8080") {
		t.Fatalf("the delete did not name HTTP-8080 as its mkey: %v", stub.calls)
	}
}

func TestDeviceServiceWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			withDeviceClient(t, &stubClient{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "services", device.ID, testAdminUserID, "admin",
				`{"name":"HTTP-8080","protocol":"TCP","tcp_ports":"8080"}`)
			DeviceCreateService(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}
}

// A port range the device would refuse with a number is refused here with a sentence, before a
// login is attempted.
func TestDeviceCreateServiceRefusesABadPortRangeBeforeLoggingIn(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "services", device.ID, testAdminUserID, "admin",
		`{"name":"HTTP-8080","protocol":"TCP","tcp_ports":"not-a-port"}`)
	DeviceCreateService(c)

	coverWantStatus(t, rec, http.StatusBadRequest)
	if len(stub.calls) != 0 {
		t.Fatalf("an invalid body still reached the device: %v", stub.calls)
	}
}

// ── the list ────────────────────────────────────────────────────────────────

func TestDeviceListServicesRendersTheDevicesSpellingBackAsTheGUIs(t *testing.T) {
	device := handlerTestDevice(t)
	icmpType := 8
	withDeviceClient(t, &stubClient{
		svcs: []services.FGService{
			{Name: "HTTP", Protocol: "TCP", TCPPortRange: "80", Category: []services.FGName{{Name: "Web Access"}}},
			{Name: "PING6", Protocol: "ICMP6", ICMPType: &icmpType},
			{Name: "FQDN-only", Protocol: "TCP", TCPPortRange: "443", IPRange: "10.0.0.1-10.0.0.9"},
		},
		policies: []services.FGPolicy{
			{PolicyID: 1, Service: []services.FGName{{Name: "HTTP"}}},
			{PolicyID: 2, Service: []services.FGName{{Name: "HTTP"}}},
		},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "services", device.ID, testAdminUserID, "admin")
	DeviceListServices(c)
	coverWantStatus(t, rec, http.StatusOK)

	body := rec.Body.String()
	for _, want := range []string{
		`"protocol":"ICMPv6"`, // ICMP6 is rendered as the GUI spells it
		`"category":"Web Access"`,
		`"category":"Uncategorized"`,    // a service with no category gets the UI's word for it
		`"ip_fqdn":"10.0.0.1-10.0.0.9"`, // the iprange restriction stands in for a missing fqdn
		`"ref_count":2`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the list does not carry %s:\n%s", want, body)
		}
	}
	// A service with no ICMP type must report -1 rather than 0, because 0 is echo-reply.
	if !strings.Contains(body, `"icmp_type":-1`) {
		t.Errorf("an absent ICMP type was reported as a real one (0 is echo-reply):\n%s", body)
	}
	if !strings.Contains(body, `"icmp_type":8`) {
		t.Errorf("the ICMP type the device holds was lost:\n%s", body)
	}
}

func TestDeviceListServicesReportsAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{svcsErr: errTransport{}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "services", device.ID, testAdminUserID, "admin")
	DeviceListServices(c)

	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)
}
