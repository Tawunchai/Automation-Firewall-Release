package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// Network ▸ Static Routes. See services/fortigate_route.go for the three destination dialects
// (subnet, internet-service, blackhole) the one form has to speak.
//
// What makes this worth testing without a device: the form sends CIDR because that is what people
// write, FortiOS stores "ip mask", and the blackhole route arrives as two different shapes from
// two different controls on the same page. A route that reaches the device in the wrong dialect is
// accepted and then simply never matches.

func TestValidateRouteHoldsEachDestinationDialectToItsOwnRule(t *testing.T) {
	isvc := func(n int) *int { return &n }

	cases := []struct {
		name     string
		in       routeInput
		wantSays string // "" = must be accepted
	}{
		{
			name: "a plain subnet route",
			in:   routeInput{Dst: "10.20.0.0/16", Gateway: "10.10.20.1", Device: "port1"},
		},
		{
			name:     "a subnet route with no destination",
			in:       routeInput{Gateway: "10.10.20.1", Device: "port1"},
			wantSays: "destination subnet is required",
		},
		{
			// A named address or group is a destination too — the advanced control on the form.
			name: "a named address is a destination",
			in:   routeInput{DstAddr: "BRANCH-NETS", Gateway: "10.10.20.1"},
		},
		{
			name:     "a subnet route with no gateway",
			in:       routeInput{Dst: "10.20.0.0/16", Device: "port1"},
			wantSays: "gateway address is required",
		},
		{
			// A blackhole route discards the traffic, so there is nothing for a gateway to mean.
			name: "a blackhole route needs no gateway",
			in:   routeInput{Dst: "10.20.0.0/16", Blackhole: true},
		},
		{
			// The same route as the page's OTHER control sends it: the pseudo-interface by name.
			name: "the blackhole pseudo-interface needs no gateway either",
			in:   routeInput{Dst: "10.20.0.0/16", Device: "Blackhole"},
		},
		{
			name: "an internet-service route",
			in:   routeInput{DstType: "internet-service", InternetService: isvc(65536), Gateway: "10.10.20.1"},
		},
		{
			name:     "an internet-service route with nothing selected",
			in:       routeInput{DstType: "internet-service", Gateway: "10.10.20.1"},
			wantSays: "an Internet Service must be selected",
		},
		{
			name:     "an internet-service route with id 0",
			in:       routeInput{DstType: "internet-service", InternetService: isvc(0), Gateway: "10.10.20.1"},
			wantSays: "an Internet Service must be selected",
		},
		{
			// An internet-service route is never a blackhole, so the gateway is always required —
			// including when the form left the blackhole flag on from a previous selection.
			name:     "an internet-service route still needs a gateway",
			in:       routeInput{DstType: "internet-service", InternetService: isvc(65536), Blackhole: true},
			wantSays: "gateway address is required",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateRoute(tc.in)
			switch {
			case tc.wantSays == "" && got != "":
				t.Fatalf("refused a valid route: %q", got)
			case tc.wantSays != "" && got == "":
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			case tc.wantSays != "" && !strings.Contains(got, tc.wantSays):
				t.Fatalf("refused with %q, which does not say %q", got, tc.wantSays)
			}
		})
	}
}

// The mapping is where the two dialects meet. Each of these would reach the device looking valid
// and then route nothing.
func TestRouteInputToWriteSpeaksTheDevicesDialect(t *testing.T) {
	t.Run("CIDR becomes the ip-mask pair FortiOS stores", func(t *testing.T) {
		got := routeInputToWrite(routeInput{Dst: "10.20.0.0/16", Gateway: "10.10.20.1", Device: "port1"})
		if !strings.Contains(got.Dst, " ") {
			t.Fatalf("dst = %q, want the \"ip mask\" pair the device stores", got.Dst)
		}
		if got.Dst != services.CIDRToFGSubnet("10.20.0.0/16") {
			t.Fatalf("dst = %q, want %q", got.Dst, services.CIDRToFGSubnet("10.20.0.0/16"))
		}
	})

	t.Run("an empty destination stays empty rather than becoming a default subnet", func(t *testing.T) {
		if got := routeInputToWrite(routeInput{DstAddr: "BRANCH"}).Dst; got != "" {
			t.Fatalf("dst = %q, want it left empty — a named destination has no subnet", got)
		}
	})

	t.Run("the blackhole pseudo-interface is a flag, not an interface name", func(t *testing.T) {
		// The device has no interface called "blackhole". Sending the name would be a route out
		// of an interface that does not exist.
		got := routeInputToWrite(routeInput{Dst: "10.20.0.0/16", Device: "Blackhole"})
		if !got.Blackhole {
			t.Error("the pseudo-interface did not set the blackhole flag")
		}
		if got.Device != "" {
			t.Errorf("device = %q, want it cleared — there is no such interface", got.Device)
		}
	})

	t.Run("a real interface is kept", func(t *testing.T) {
		got := routeInputToWrite(routeInput{Dst: "10.20.0.0/16", Device: "port1", Gateway: "10.10.20.1"})
		if got.Device != "port1" || got.Blackhole {
			t.Errorf("got %+v, want port1 and no blackhole", got)
		}
	})

	t.Run("status is enable unless the form said otherwise", func(t *testing.T) {
		off := false
		if routeInputToWrite(routeInput{Dst: "x"}).Status != "enable" {
			t.Error("a route with no enabled flag was written disabled")
		}
		if got := routeInputToWrite(routeInput{Dst: "x", Enabled: &off}).Status; got != "disable" {
			t.Errorf("status = %q, want disable", got)
		}
	})

	t.Run("an unset destination type defaults to subnet", func(t *testing.T) {
		if got := routeInputToWrite(routeInput{Dst: "10.0.0.0/8"}).DstType; got != "subnet" {
			t.Errorf("dst_type = %q, want subnet", got)
		}
	})
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestStaticRouteWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"dst":"10.20.0.0/16","gateway":"10.10.20.1","device":"port1"}`

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		params  []param2
		handler gin.HandlerFunc
	}{
		{"create", http.MethodPost, "static-routes", body, nil, DeviceCreateStaticRoute},
		{"update", http.MethodPatch, "static-routes/3", body, []param2{{"seq", "3"}}, DeviceUpdateStaticRoute},
		{"delete", http.MethodDelete, "static-routes/3", "", []param2{{"seq", "3"}}, DeviceDeleteStaticRoute},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, params2(tc.params)...)
			tc.handler(c)

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestStaticRouteCRUDAddressesTheRightRoute(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		routes:     []services.FGStaticRoute{{SeqNum: 3, Dst: "10.20.0.0 255.255.0.0"}},
		intServs:   []services.FGInternetService{{ID: 65536, Name: "Google-Web"}},
		routeIntfs: []services.FGInterface{{Name: "port1"}},
	}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "static-routes", device.ID, testAdminUserID, "admin")
	DeviceListStaticRoutes(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodGet, "static-routes/3", device.ID, testAdminUserID, "admin", "",
		param("seq", "3"))
	DeviceGetStaticRoute(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodPost, "static-routes", device.ID, testAdminUserID, "admin",
		`{"dst":"10.30.0.0/16","gateway":"10.10.20.1","device":"port1","distance":10}`)
	DeviceCreateStaticRoute(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if stub.gotRoute.Dst != services.CIDRToFGSubnet("10.30.0.0/16") {
		t.Fatalf("the route reached the device as %q, not in its own dialect", stub.gotRoute.Dst)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "static-routes/3", device.ID, testAdminUserID, "admin",
		`{"dst":"10.30.0.0/16","gateway":"10.10.20.2","device":"port1"}`, param("seq", "3"))
	DeviceUpdateStaticRoute(c)
	coverWantStatus(t, rec, http.StatusOK)
	if stub.gotRouteSeq != 3 {
		t.Fatalf("the update addressed route %d, not 3", stub.gotRouteSeq)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "static-routes/3", device.ID, testAdminUserID, "admin", "",
		param("seq", "3"))
	DeviceDeleteStaticRoute(c)
	coverWantStatus(t, rec, http.StatusOK)
	if stub.gotRouteSeq != 3 {
		t.Fatalf("the delete addressed route %d, not 3", stub.gotRouteSeq)
	}

	// The two datasources the form's pickers read.
	c, rec = deviceRequest(t, http.MethodGet, "internet-services", device.ID, testAdminUserID, "admin")
	DeviceListInternetServices(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceRequest(t, http.MethodGet, "route-interfaces", device.ID, testAdminUserID, "admin")
	DeviceListRouteInterfaces(c)
	coverWantStatus(t, rec, http.StatusOK)
}

// A sequence number that is not a number names no route, so nothing is written for it.
func TestStaticRouteHandlersRefuseASeqThatIsNotANumber(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	for _, tc := range []struct {
		name    string
		method  string
		body    string
		handler gin.HandlerFunc
	}{
		{"read", http.MethodGet, "", DeviceGetStaticRoute},
		{"update", http.MethodPatch, `{"dst":"10.0.0.0/8","gateway":"10.10.20.1"}`, DeviceUpdateStaticRoute},
		{"delete", http.MethodDelete, "", DeviceDeleteStaticRoute},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := deviceJSONRequest(t, tc.method, "static-routes/abc", device.ID, testAdminUserID, "admin",
				tc.body, param("seq", "abc"))
			tc.handler(c)
			coverWantStatus(t, rec, http.StatusBadRequest)
		})
	}
	coverUntouched(t, stub)
}

// What the firewall said, as a refusal with its number.
func TestStaticRouteWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{writeErr: tc.err}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost, "static-routes", device.ID, testAdminUserID, "admin",
				`{"dst":"10.30.0.0/16","gateway":"10.10.20.1","device":"port1"}`)
			DeviceCreateStaticRoute(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}
}

// Unreadable is not empty.
func TestStaticRouteListsSeparateAnUnreachableDeviceFromAnEmptyOne(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{readErr: errTransport{}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "static-routes", device.ID, testAdminUserID, "admin")
	DeviceListStaticRoutes(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceRequest(t, http.MethodGet, "internet-services", device.ID, testAdminUserID, "admin")
	DeviceListInternetServices(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceRequest(t, http.MethodGet, "route-interfaces", device.ID, testAdminUserID, "admin")
	DeviceListRouteInterfaces(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
}
