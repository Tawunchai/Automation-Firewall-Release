package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Policy & Objects ▸ Addresses, through the handlers rather than past them.
//
// addrInputToFG is where a form's nine address types become the per-type field set FortiOS stores,
// and it is the only place in this package where the wrong branch produces an object the device
// accepts and nothing matches. The handlers around it are the permission gate and the error
// contract, both proven here against a stub rather than a firewall.

func TestAddrInputToFGSendsOnlyTheFieldsThatTypeHas(t *testing.T) {
	cases := []struct {
		name  string
		in    addressInput
		check func(t *testing.T, got services.FGAddress)
	}{
		{
			name: "an ipmask arrives as FortiOS's own 'ip mask', never as the CIDR the form typed",
			in:   addressInput{Name: "LAN", Type: "ipmask", Subnet: "10.0.0.0/24", AllowRouting: true},
			check: func(t *testing.T, got services.FGAddress) {
				if got.Subnet != "10.0.0.0 255.255.255.0" {
					t.Errorf("subnet = %q, want %q", got.Subnet, "10.0.0.0 255.255.255.0")
				}
				// allow-routing is an enable/disable STRING on the device, not a bool.
				if got.AllowRouting != "enable" {
					t.Errorf("allow_routing = %q, want \"enable\"", got.AllowRouting)
				}
			},
		},
		{
			name: "allow-routing off is sent as \"disable\", not left empty",
			in:   addressInput{Name: "LAN", Type: "ipmask", Subnet: "10.0.0.0/24"},
			check: func(t *testing.T, got services.FGAddress) {
				if got.AllowRouting != "disable" {
					t.Errorf("allow_routing = %q, want \"disable\"", got.AllowRouting)
				}
			},
		},
		{
			name: "a wildcard FQDN is stored as a plain fqdn object — there is no wildcard-fqdn type",
			in:   addressInput{Name: "star", Type: "wildcard-fqdn", Subnet: "*.example.com"},
			check: func(t *testing.T, got services.FGAddress) {
				if got.Type != "fqdn" {
					t.Errorf("type = %q, want \"fqdn\" — the device has no wildcard-fqdn table", got.Type)
				}
				if got.FQDN != "*.example.com" {
					t.Errorf("fqdn = %q, want %q", got.FQDN, "*.example.com")
				}
				if got.Subnet != "" {
					t.Errorf("subnet = %q, want empty — an FQDN address has no subnet", got.Subnet)
				}
			},
		},
		{
			name: "an iprange carries its two ends and no subnet",
			in:   addressInput{Name: "pool", Type: "iprange", StartIP: "10.0.0.10", EndIP: "10.0.0.20"},
			check: func(t *testing.T, got services.FGAddress) {
				if got.StartIP != "10.0.0.10" || got.EndIP != "10.0.0.20" {
					t.Errorf("range = %q..%q", got.StartIP, got.EndIP)
				}
				if got.Subnet != "" {
					t.Errorf("subnet = %q, want empty", got.Subnet)
				}
			},
		},
		{
			name: "an interface-subnet gets the mask form but NOT allow-routing",
			in:   addressInput{Name: "p1", Type: "interface-subnet", Subnet: "192.168.1.0/24", Interface: "port1", AllowRouting: true},
			check: func(t *testing.T, got services.FGAddress) {
				if got.Subnet != "192.168.1.0 255.255.255.0" {
					t.Errorf("subnet = %q", got.Subnet)
				}
				if got.AllowRouting != "" {
					t.Errorf("allow_routing = %q, want empty — the field does not apply to this type", got.AllowRouting)
				}
				if got.Interface != "port1" {
					t.Errorf("interface = %q, want port1", got.Interface)
				}
			},
		},
		{
			name: "geography carries the country code alone",
			in:   addressInput{Name: "TH", Type: "geography", Country: "TH", Subnet: "10.0.0.0/24"},
			check: func(t *testing.T, got services.FGAddress) {
				if got.Country != "TH" {
					t.Errorf("country = %q", got.Country)
				}
				if got.Subnet != "" {
					t.Errorf("subnet = %q, want empty for a geography address", got.Subnet)
				}
			},
		},
		{
			// Only the empty rows. A whitespace-only row is NOT trimmed away here on purpose:
			// validate_inputs.go leaves a MAC's contents to FortiOS, which refuses it with a code
			// the client surfaces — the console does not re-implement the device's own parser.
			name: "a mac address list drops the blank rows a form leaves behind",
			in:   addressInput{Name: "printers", Type: "mac", MacAddrs: []string{"00:11:22:33:44:55", ""}},
			check: func(t *testing.T, got services.FGAddress) {
				if len(got.MACAddrs) != 1 || got.MACAddrs[0].MAC != "00:11:22:33:44:55" {
					t.Errorf("mac list = %+v, want exactly the one real address", got.MACAddrs)
				}
			},
		},
		{
			name: "a dynamic address defaults to the GUI's Fabric Connector shape",
			in:   addressInput{Name: "aws", Type: "dynamic", SDN: "aws1"},
			check: func(t *testing.T, got services.FGAddress) {
				if got.SubType != "sdn" {
					t.Errorf("sub_type = %q, want \"sdn\" (the GUI default)", got.SubType)
				}
				if got.SDNAddrType != "private" {
					t.Errorf("sdn_addr_type = %q, want \"private\" (the GUI default)", got.SDNAddrType)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := addrInputToFG(tc.in)
			if err != nil {
				t.Fatalf("addrInputToFG: %v", err)
			}
			if got.Name != tc.in.Name {
				t.Errorf("name = %q, want %q", got.Name, tc.in.Name)
			}
			tc.check(t, got)
		})
	}
}

// Two inputs the mapper must refuse rather than send: a Fabric Connector address with no
// connector (the device answers -3 and names nothing), and a type this console does not know.
func TestAddrInputToFGRefusesWhatTheDeviceWouldOnlyAnswerWithACode(t *testing.T) {
	if _, err := addrInputToFG(addressInput{Name: "aws", Type: "dynamic"}); err == nil {
		t.Error("a Fabric Connector address with no SDN connector was accepted")
	}
	if _, err := addrInputToFG(addressInput{Name: "x", Type: "teapot"}); err == nil {
		t.Error("an unknown address type was accepted")
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

// The "user" role may read Policy & Objects and change nothing. The refusal is 403 and it happens
// before any query and before any login: requireAdminPO runs first in every write handler here.
func TestAddressWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"LAN","type":"ipmask","subnet":"10.0.0.0/24"}`

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		nameArg string
	}{
		{name: "create", method: http.MethodPost, tail: "addresses", body: body},
		{name: "update", method: http.MethodPatch, tail: "addresses/LAN", body: body, nameArg: "LAN"},
		{name: "delete", method: http.MethodDelete, tail: "addresses/LAN", nameArg: "LAN"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &stubClient{}
			withDeviceClient(t, stub, nil)

			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, param("name", tc.nameArg))
			switch tc.name {
			case "create":
				DeviceCreateAddress(c)
			case "update":
				DeviceUpdateAddress(c)
			case "delete":
				DeviceDeleteAddress(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			if len(stub.calls) != 0 {
				t.Fatalf("the handler reached the device anyway: %v", stub.calls)
			}
		})
	}
}

// ── the handlers, with a device behind them ─────────────────────────────────

func TestDeviceCreateAddressWritesWhatTheFormMeant(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testAdminUserID, "admin",
		`{"name":"LAN-10","type":"ipmask","subnet":"10.0.0.0/24"}`)
	DeviceCreateAddress(c)

	coverWantStatus(t, rec, http.StatusCreated)
	if !stub.didCall("CreateAddress LAN-10 ipmask 10.0.0.0 255.255.255.0") {
		t.Fatalf("the device was not asked to create that address: %v", stub.calls)
	}
}

// An operator may write device objects — that is the whole point of the role (Phase A4) — but only
// on a device they were granted. Both halves are asserted here because they are enforced in
// different places: the role in requireAdminPO, the grant in getDeviceInfo.
func TestDeviceCreateAddressLetsAGrantedOperatorThroughAndStopsAnUngrantedOne(t *testing.T) {
	device := handlerTestDevice(t)

	t.Run("no grant: 404, and the device is never reached", func(t *testing.T) {
		stub := &stubClient{}
		withDeviceClient(t, stub, nil)

		c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testPlainUserID, "operator",
			`{"name":"LAN-10","type":"ipmask","subnet":"10.0.0.0/24"}`)
		DeviceCreateAddress(c)

		coverWantStatus(t, rec, http.StatusNotFound)
		if len(stub.calls) != 0 {
			t.Fatalf("an operator with no grant still wrote to the firewall: %v", stub.calls)
		}
	})

	t.Run("granted: the write lands", func(t *testing.T) {
		grantDevice(t, device.ID)
		stub := &stubClient{}
		withDeviceClient(t, stub, nil)

		c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testPlainUserID, "operator",
			`{"name":"LAN-10","type":"ipmask","subnet":"10.0.0.0/24"}`)
		DeviceCreateAddress(c)

		coverWantStatus(t, rec, http.StatusCreated)
		if len(stub.calls) == 0 {
			t.Fatal("a granted operator's write never reached the device")
		}
	})
}

func TestDeviceAddressWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run("create: "+tc.name, func(t *testing.T) {
			withDeviceClient(t, &stubClient{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testAdminUserID, "admin",
				`{"name":"LAN-10","type":"ipmask","subnet":"10.0.0.0/24"}`)
			DeviceCreateAddress(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	// A DELETE addresses one object, so "not there" is 404 — the end state the caller wanted,
	// which is what makes an Apply's Fallback idempotent.
	t.Run("delete: gone is 404 and still carries the code", func(t *testing.T) {
		withDeviceClient(t, &stubClient{writeErr: &services.DeviceError{
			Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found",
		}}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "addresses/LAN-10", device.ID, testAdminUserID, "admin", "",
			param("name", "LAN-10"))
		DeviceDeleteAddress(c)

		coverWantStatus(t, rec, http.StatusNotFound)
		coverWantFortiOSCode(t, rec, services.FGErrNoSuchNode)
	})

	t.Run("delete: still referenced is 409", func(t *testing.T) {
		withDeviceClient(t, &stubClient{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "addresses/LAN-10", device.ID, testAdminUserID, "admin", "",
			param("name", "LAN-10"))
		DeviceDeleteAddress(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

func TestDeviceUpdateAndDeleteAddressNameTheObjectFromTheURL(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPatch, "addresses/LAN-10", device.ID, testAdminUserID, "admin",
		`{"name":"ignored","type":"ipmask","subnet":"10.0.0.0/24","comment":"edited"}`, param("name", "LAN-10"))
	DeviceUpdateAddress(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.didCall("UpdateAddress LAN-10 edited") {
		t.Fatalf("the edit did not address LAN-10: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "addresses/LAN-10", device.ID, testAdminUserID, "admin", "",
		param("name", "LAN-10"))
	DeviceDeleteAddress(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.didCall("DeleteAddress LAN-10") {
		t.Fatalf("the delete did not name LAN-10 as its mkey: %v", stub.calls)
	}
}

// A body the mapper refuses must not reach the firewall at all — the point of validating here
// rather than letting the device answer with a number.
func TestDeviceCreateAddressRefusesABadBodyBeforeLoggingIn(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &stubClient{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "addresses", device.ID, testAdminUserID, "admin",
		`{"name":"aws","type":"dynamic"}`)
	DeviceCreateAddress(c)

	coverWantStatus(t, rec, http.StatusBadRequest)
	if len(stub.calls) != 0 {
		t.Fatalf("an invalid body still reached the device: %v", stub.calls)
	}
}

// ── the list ────────────────────────────────────────────────────────────────

// What the page renders is not what the device stores: the subnet is rendered per type, the four
// names FortiOS ships are flagged as built-in so the UI can grey out Delete, and the reference
// count is counted from the policy table rather than trusted from q_ref.
func TestDeviceListAddressesRendersEachTypeAndCountsItsReferences(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{
		addresses: []services.FGAddress{
			{Name: "LAN-10", Type: "ipmask", Subnet: "10.0.0.0 255.255.255.0"},
			{Name: "site", Type: "fqdn", FQDN: "www.example.com"},
			{Name: "all", Type: "ipmask", Subnet: "0.0.0.0 0.0.0.0"},
			{Name: "macs", Type: "mac", MACAddrs: []services.FGMACAddr{{MAC: "00:11:22:33:44:55"}, {MAC: ""}}},
		},
		policies: []services.FGPolicy{
			{PolicyID: 1, SrcAddr: []services.FGName{{Name: "LAN-10"}}, DstAddr: []services.FGName{{Name: "site"}}},
			{PolicyID: 2, SrcAddr: []services.FGName{{Name: "LAN-10"}}},
		},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	DeviceListAddresses(c)
	coverWantStatus(t, rec, http.StatusOK)

	body := rec.Body.String()
	for _, want := range []string{
		`"subnet":"10.0.0.0/24"`,     // the mask form is rendered back as CIDR
		`"subnet":"www.example.com"`, // an FQDN's "subnet" column is its fqdn
		`"builtin":true`,             // "all" is one of the four the device ships
		`"mac_addrs":["00:11:22:33:44:55"]`,
	} {
		if !strings.Contains(body, want) {
			t.Errorf("the list does not carry %s:\n%s", want, body)
		}
	}
	if !strings.Contains(body, `"ref_count":2`) {
		t.Errorf("LAN-10 is named by two policies but no row reports ref_count 2:\n%s", body)
	}
}

// A policy table that cannot be read must not blank the address list: the reference counts are an
// extra column, not the answer. (The addresses themselves still have to arrive.)
func TestDeviceListAddressesStillAnswersWhenThePolicyTableCannotBeRead(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &stubClient{
		addresses:   []services.FGAddress{{Name: "LAN-10", Type: "ipmask", Subnet: "10.0.0.0 255.255.255.0"}},
		policiesErr: errTransport{},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "addresses", device.ID, testAdminUserID, "admin")
	DeviceListAddresses(c)

	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "LAN-10") {
		t.Fatalf("the addresses were lost with the reference counts:\n%s", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"ref_count":0`) {
		t.Errorf("an unreadable policy table should leave the count at 0, not omit the field:\n%s", rec.Body.String())
	}
}
