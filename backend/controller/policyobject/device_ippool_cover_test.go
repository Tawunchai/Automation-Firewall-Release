package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Policy & Objects ▸ IP Pools.
//
// The check worth having in this domain is the fixed-port-range one. That pool type preserves the
// source port, so every internal address needs an external address of its own — and if the
// internal range is larger, the hosts past the end of the external range are simply not
// translated. FortiOS accepts the mismatch without a word, which is why it is refused here.

func TestIPPoolRangeHelpersCompareAddressesNumerically(t *testing.T) {
	// "10.0.0.9" vs "10.0.0.10" is the case a string comparison gets wrong.
	if !rangeOrdered("10.0.0.9", "10.0.0.10") {
		t.Error("rangeOrdered compared the two ends as text, not as addresses")
	}
	if rangeOrdered("10.0.0.10", "10.0.0.9") {
		t.Error("a range that ends before it starts was accepted")
	}
	if !rangeOrdered("10.0.0.5", "10.0.0.5") {
		t.Error("a one-address pool is legitimate and was refused")
	}
	if got := rangeSize("10.0.0.1", "10.0.0.10"); got != 10 {
		t.Errorf("rangeSize = %d, want 10 (inclusive)", got)
	}
	if got := rangeSize("10.0.0.1", "not-an-ip"); got != 0 {
		t.Errorf("rangeSize of a broken range = %d, want 0", got)
	}

	if !v4("10.0.0.1") {
		t.Error("v4 rejected an IPv4 address")
	}
	// FortiOS takes IPv4 only in these fields; an IPv6 string parses and the device then refuses
	// it with a bare code, so it has to be caught here where there is room to say why.
	if v4("2001:db8::1") {
		t.Error("v4 accepted an IPv6 address")
	}
}

func TestValidateIPPoolRefusesThePoolsThatWouldDropTraffic(t *testing.T) {
	cases := []struct {
		name     string
		in       ipPoolInput
		wantSays string
	}{
		{name: "nameless", in: ipPoolInput{StartIP: "203.0.113.1", EndIP: "203.0.113.9"}, wantSays: "name is required"},
		{
			name:     "a name past the 79 characters FortiOS stores",
			in:       ipPoolInput{Name: strings.Repeat("p", 80), StartIP: "203.0.113.1", EndIP: "203.0.113.9"},
			wantSays: "too long",
		},
		{
			name:     "a pool type that does not exist",
			in:       ipPoolInput{Name: "nat", Type: "teapot", StartIP: "203.0.113.1", EndIP: "203.0.113.9"},
			wantSays: "unknown pool type",
		},
		{
			name:     "an external range that is not two IPv4 addresses",
			in:       ipPoolInput{Name: "nat", StartIP: "203.0.113.1"},
			wantSays: "two IPv4 addresses",
		},
		{
			name:     "an external range that ends before it starts",
			in:       ipPoolInput{Name: "nat", StartIP: "203.0.113.9", EndIP: "203.0.113.1"},
			wantSays: "ends before it starts",
		},
		{
			name: "fixed-port-range with more internal addresses than external ones",
			in: ipPoolInput{
				Name: "nat", Type: "fixed-port-range",
				StartIP: "203.0.113.1", EndIP: "203.0.113.2",
				SourceStartIP: "10.0.0.1", SourceEndIP: "10.0.0.50",
			},
			wantSays: "would not be translated at all",
		},
		{
			name: "fixed-port-range with no internal range at all",
			in: ipPoolInput{
				Name: "nat", Type: "fixed-port-range",
				StartIP: "203.0.113.1", EndIP: "203.0.113.9",
			},
			wantSays: "needs an internal IP range",
		},
		{
			name: "port-block-allocation with no block size",
			in: ipPoolInput{
				Name: "nat", Type: "port-block-allocation",
				StartIP: "203.0.113.1", EndIP: "203.0.113.9", NumBlocksPerUser: 4,
			},
			wantSays: "needs a block size",
		},
		{
			name: "port-block-allocation asking for more ports than one address has",
			in: ipPoolInput{
				Name: "nat", Type: "port-block-allocation",
				StartIP: "203.0.113.1", EndIP: "203.0.113.9",
				BlockSize: 64512, NumBlocksPerUser: 2,
			},
			wantSays: "64,512 usable ports",
		},
		{
			name: "an ARP interface named while ARP reply is off",
			in: ipPoolInput{
				Name: "nat", StartIP: "203.0.113.1", EndIP: "203.0.113.9",
				ARPInterface: "port1", ARPReply: boolPtr(false),
			},
			wantSays: "only applies when ARP reply is on",
		},
		{
			name: "a fixed-port-range that does fit",
			in: ipPoolInput{
				Name: "nat", Type: "fixed-port-range",
				StartIP: "203.0.113.1", EndIP: "203.0.113.50",
				SourceStartIP: "10.0.0.1", SourceEndIP: "10.0.0.50",
			},
		},
		{name: "a plain overload pool", in: ipPoolInput{Name: "nat", StartIP: "203.0.113.1", EndIP: "203.0.113.9"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateIPPool(tc.in)
			if tc.wantSays == "" {
				if got != "" {
					t.Fatalf("a valid pool was refused: %s", got)
				}
				return
			}
			if !strings.Contains(got, tc.wantSays) {
				t.Fatalf("refusal = %q, want it to mention %q", got, tc.wantSays)
			}
		})
	}
}

// arp-reply defaults to ENABLE on the device, and a pool with it off is unreachable unless
// something else answers ARP for the range — so an absent field has to mean "leave it on".
func TestIPPoolFromDefaultsArpReplyOnAndTheTypeToOverload(t *testing.T) {
	got := ipPoolFrom(ipPoolInput{Name: " nat ", StartIP: " 203.0.113.1 ", EndIP: "203.0.113.9"})
	if !got.ARPReply {
		t.Error("an omitted arp_reply became disable — the pool would not answer ARP at all")
	}
	if got.Type != "overload" {
		t.Errorf("type = %q, want \"overload\" (the GUI default)", got.Type)
	}
	if got.Name != "nat" || got.StartIP != "203.0.113.1" {
		t.Errorf("the name/range were not trimmed: %+v", got)
	}

	off := ipPoolFrom(ipPoolInput{Name: "nat", ARPReply: boolPtr(false)})
	if off.ARPReply {
		t.Error("an explicit arp_reply:false was overridden by the default")
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestIPPoolWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"nat","start_ip":"203.0.113.1","end_ip":"203.0.113.9"}`

	checks := []struct {
		name   string
		method string
		tail   string
		body   string
		mkey   string
	}{
		{"create", http.MethodPost, "ip-pools", body, ""},
		{"update", http.MethodPatch, "ip-pools/nat", body, "nat"},
		{"delete", http.MethodDelete, "ip-pools/nat", "", "nat"},
	}

	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, param("name", tc.mkey))

			switch tc.name {
			case "create":
				DeviceCreateIPPool(c)
			case "update":
				DeviceUpdateIPPool(c)
			case "delete":
				DeviceDeleteIPPool(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestDeviceIPPoolCRUDSendsThePoolTheFormDescribed(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "ip-pools", device.ID, testAdminUserID, "admin",
		`{"name":"nat","type":"one-to-one","start_ip":"203.0.113.1","end_ip":"203.0.113.9"}`)
	DeviceCreateIPPool(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if got := stub.gotPool; got.Type != "one-to-one" || got.EndIP != "203.0.113.9" || !got.ARPReply {
		t.Fatalf("the pool the device was asked for is not the one described: %+v", got)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "ip-pools/nat", device.ID, testAdminUserID, "admin",
		`{"name":"nat","start_ip":"203.0.113.1","end_ip":"203.0.113.9"}`, param("name", "nat"))
	DeviceUpdateIPPool(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateIPPool nat") {
		t.Fatalf("the edit did not address nat: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "ip-pools/nat", device.ID, testAdminUserID, "admin", "",
		param("name", "nat"))
	DeviceDeleteIPPool(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteIPPool nat") {
		t.Fatalf("the delete did not name nat as its mkey: %v", stub.calls)
	}
}

func TestDeviceIPPoolWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "ip-pools", device.ID, testAdminUserID, "admin",
				`{"name":"nat","start_ip":"203.0.113.1","end_ip":"203.0.113.9"}`)
			DeviceCreateIPPool(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	// A pool a policy's NAT still points at.
	t.Run("delete: still referenced is 409 with the number", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "ip-pools/nat", device.ID, testAdminUserID, "admin", "",
			param("name", "nat"))
		DeviceDeleteIPPool(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

func TestDeviceCreateIPPoolRefusesTheUntranslatedRangeBeforeLoggingIn(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "ip-pools", device.ID, testAdminUserID, "admin",
		`{"name":"nat","type":"fixed-port-range","start_ip":"203.0.113.1","end_ip":"203.0.113.2",
		  "source_start_ip":"10.0.0.1","source_end_ip":"10.0.0.50"}`)
	DeviceCreateIPPool(c)

	coverWantStatus(t, rec, http.StatusBadRequest)
	coverUntouched(t, stub)
}

func TestDeviceIPPoolReadsServeWhatTheDeviceHolds(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{
		pools: []services.FGIPPool{{Name: "nat", Type: "overload", StartIP: "203.0.113.1", EndIP: "203.0.113.9"}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "ip-pools", device.ID, testAdminUserID, "admin")
	DeviceListIPPools(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "203.0.113.9") {
		t.Fatalf("the pools did not arrive:\n%s", rec.Body.String())
	}

	c, rec = deviceRequest(t, http.MethodGet, "ip-pools/nat", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "nat"))
	DeviceGetIPPool(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceRequest(t, http.MethodGet, "ip-pools/nope", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "nope"))
	DeviceGetIPPool(c)
	coverWantStatus(t, rec, http.StatusNotFound)
}

func TestDeviceListIPPoolsReportsAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{readErr: errTransport{}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "ip-pools", device.ID, testAdminUserID, "admin")
	DeviceListIPPools(c)

	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)
}

func boolPtr(b bool) *bool { return &b }
