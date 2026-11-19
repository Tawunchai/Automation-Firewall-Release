package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// Policy & Objects ▸ Traffic Shaping — two objects that only work together: a shaper is a limit,
// a shaping policy is which traffic gets it.
//
// Both halves have a rule FortiOS itself will not enforce, and both are the kind of mistake that
// is invisible afterwards because the device reports success:
//
//   - a shaper with maximum 0 is UNLIMITED on FortiOS. A form whose whole purpose is to impose a
//     ceiling, saved with a blank ceiling, becomes a shaper that shapes nothing.
//   - a shaping policy with no shaper in any direction matches traffic and does nothing to it.

func TestValidateShaperRefusesTheNumbersThatMakeItDoNothing(t *testing.T) {
	ok := shaperInput{Name: "branch-uplink", Maximum: 50_000, Guaranteed: 10_000}

	cases := []struct {
		name     string
		in       shaperInput
		wantSays string // "" = must be accepted
	}{
		{name: "a real shaper", in: ok},
		{name: "nameless", in: shaperInput{Maximum: 1}, wantSays: "name is required"},
		{
			name:     "a name longer than the table stores",
			in:       shaperInput{Name: strings.Repeat("x", 36), Maximum: 1},
			wantSays: "35 characters",
		},
		{
			name:     "a bandwidth unit FortiOS has no word for",
			in:       shaperInput{Name: "x", Maximum: 1, BandwidthUnit: "tbps"},
			wantSays: "kbps, mbps or gbps",
		},
		{
			name:     "a priority outside the three",
			in:       shaperInput{Name: "x", Maximum: 1, Priority: "urgent"},
			wantSays: "low, medium or high",
		},
		{
			name:     "negative bandwidth",
			in:       shaperInput{Name: "x", Maximum: 10, Guaranteed: -1},
			wantSays: "cannot be negative",
		},
		{
			// THE one. 0 is legal on the device and means no limit at all.
			name:     "a maximum of zero is unlimited, not zero",
			in:       shaperInput{Name: "x"},
			wantSays: "UNLIMITED",
		},
		{
			name:     "a floor above the ceiling",
			in:       shaperInput{Name: "x", Maximum: 1000, Guaranteed: 2000},
			wantSays: "higher than the maximum",
		},
		{
			name:     "DiffServ on with no code",
			in:       shaperInput{Name: "x", Maximum: 10, DiffServ: true},
			wantSays: "no code is set",
		},
		{
			name: "DiffServ on with a code",
			in:   shaperInput{Name: "x", Maximum: 10, DiffServ: true, DiffServCode: "101110"},
		},
		{
			// Equal floor and ceiling is a fixed rate, not a contradiction.
			name: "a guarantee equal to the maximum is a fixed rate",
			in:   shaperInput{Name: "x", Maximum: 10, Guaranteed: 10},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateShaper(tc.in)
			switch {
			case tc.wantSays == "" && got != "":
				t.Fatalf("refused a valid shaper: %q", got)
			case tc.wantSays != "" && got == "":
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			case tc.wantSays != "" && !strings.Contains(got, tc.wantSays):
				t.Fatalf("refused with %q, which does not say %q", got, tc.wantSays)
			}
		})
	}
}

func TestValidateShapingPolicyRefusesOneThatShapesNothing(t *testing.T) {
	full := shapingPolicyInput{
		Name: "voip", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
		Service: []string{"SIP"}, TrafficShaper: "voip-limit",
	}

	cases := []struct {
		name     string
		in       shapingPolicyInput
		wantSays string
	}{
		{name: "a real policy", in: full},
		{name: "nameless", in: shapingPolicyInput{}, wantSays: "name is required"},
		{
			name: "no destination",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"},
				Service: []string{"ALL"}, TrafficShaper: "s"},
			wantSays: "source and a destination",
		},
		{
			name: "no service",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
				TrafficShaper: "s"},
			wantSays: "at least one service",
		},
		{
			// THE one: matches traffic, shapes none of it, and the device stores it happily.
			name: "no shaper in any direction",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
				Service: []string{"ALL"}},
			wantSays: "shape none of it",
		},
		{
			name: "a reverse-only shaper still shapes something",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
				Service: []string{"ALL"}, TrafficShaperReverse: "down"},
		},
		{
			name: "a per-IP shaper alone is enough",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
				Service: []string{"ALL"}, PerIPShaper: "fair"},
		},
		{
			// Whitespace is not a shaper name.
			name: "a shaper name of spaces shapes nothing",
			in: shapingPolicyInput{Name: "x", SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
				Service: []string{"ALL"}, TrafficShaper: "   "},
			wantSays: "shape none of it",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateShapingPolicy(tc.in)
			switch {
			case tc.wantSays == "" && got != "":
				t.Fatalf("refused a valid shaping policy: %q", got)
			case tc.wantSays != "" && got == "":
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			case tc.wantSays != "" && !strings.Contains(got, tc.wantSays):
				t.Fatalf("refused with %q, which does not say %q", got, tc.wantSays)
			}
		})
	}
}

// A shaping policy that says nothing about its status is ENABLED. An off-by-default rule would be
// written to the device, reported as created, and silently shape nothing.
func TestShapingPolicyFromDefaultsToEnabledAndKeepsAnExplicitOff(t *testing.T) {
	if !shapingPolicyFrom(shapingPolicyInput{Name: "voip"}).Status {
		t.Error("a policy with no status came out disabled")
	}
	off := false
	if shapingPolicyFrom(shapingPolicyInput{Name: "voip", Status: &off}).Status {
		t.Error("an explicit status:false was sent to the device as enabled")
	}
	if got := shaperFrom(shaperInput{Name: "  branch  ", Maximum: 5}).Name; got != "branch" {
		t.Errorf("shaper name = %q, want it trimmed", got)
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestShapingWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	shaper := `{"name":"branch","maximum_bandwidth":1000}`
	policy := `{"name":"voip","srcaddr":["LAN"],"dstaddr":["all"],"service":["SIP"],"traffic_shaper":"branch"}`

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		params  []param2
		handler gin.HandlerFunc
	}{
		{"shaper create", http.MethodPost, "traffic-shapers", shaper, nil, DeviceCreateTrafficShaper},
		{"shaper update", http.MethodPatch, "traffic-shapers/branch", shaper, []param2{{"name", "branch"}}, DeviceUpdateTrafficShaper},
		{"shaper delete", http.MethodDelete, "traffic-shapers/branch", "", []param2{{"name", "branch"}}, DeviceDeleteTrafficShaper},
		{"policy create", http.MethodPost, "shaping-policies", policy, nil, DeviceCreateShapingPolicy},
		{"policy update", http.MethodPatch, "shaping-policies/1", policy, []param2{{"id", "1"}}, DeviceUpdateShapingPolicy},
		{"policy delete", http.MethodDelete, "shaping-policies/1", "", []param2{{"id", "1"}}, DeviceDeleteShapingPolicy},
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

func TestTrafficShaperCRUDWritesWhatTheFormSent(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{shapers: []services.FGTrafficShaper{{Name: "branch", Maximum: 1000}}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "traffic-shapers", device.ID, testAdminUserID, "admin")
	DeviceListTrafficShapers(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodGet, "traffic-shapers/branch", device.ID, testAdminUserID, "admin", "",
		param("name", "branch"))
	DeviceGetTrafficShaper(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodPost, "traffic-shapers", device.ID, testAdminUserID, "admin",
		`{"name":"voip-limit","maximum_bandwidth":2000,"guaranteed_bandwidth":500,"bandwidth_unit":"kbps","priority":"high"}`)
	DeviceCreateTrafficShaper(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if !stub.saw("CreateTrafficShaper voip-limit") {
		t.Fatalf("the shaper was not created: %v", stub.calls)
	}
	if stub.gotShaper.Priority != "high" || stub.gotShaper.Guaranteed != 500 {
		t.Fatalf("the form did not reach the device intact: %+v", stub.gotShaper)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "traffic-shapers/voip-limit", device.ID, testAdminUserID, "admin",
		`{"name":"voip-limit","maximum_bandwidth":4000}`, param("name", "voip-limit"))
	DeviceUpdateTrafficShaper(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodDelete, "traffic-shapers/voip-limit", device.ID, testAdminUserID, "admin", "",
		param("name", "voip-limit"))
	DeviceDeleteTrafficShaper(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteTrafficShaper voip-limit") {
		t.Fatalf("the delete did not name the shaper: %v", stub.calls)
	}
}

func TestShapingPolicyCRUDWritesWhatTheFormSent(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{shapePols: []services.FGShapingPolicy{{ID: 1, Name: "voip"}}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "shaping-policies", device.ID, testAdminUserID, "admin")
	DeviceListShapingPolicies(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodPost, "shaping-policies", device.ID, testAdminUserID, "admin",
		`{"name":"voip","srcaddr":["LAN"],"dstaddr":["all"],"service":["SIP"],"traffic_shaper":"voip-limit"}`)
	DeviceCreateShapingPolicy(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if !stub.gotShapePol.Status {
		t.Error("a policy created with no status reached the device disabled")
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "shaping-policies/1", device.ID, testAdminUserID, "admin",
		`{"name":"voip","srcaddr":["LAN"],"dstaddr":["all"],"service":["SIP"],"traffic_shaper":"voip-limit","status":false}`,
		param("id", "1"))
	DeviceUpdateShapingPolicy(c)
	coverWantStatus(t, rec, http.StatusOK)
	if stub.gotShapePol.Status {
		t.Error("an explicit status:false was sent to the device as enabled")
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "shaping-policies/1", device.ID, testAdminUserID, "admin", "",
		param("id", "1"))
	DeviceDeleteShapingPolicy(c)
	coverWantStatus(t, rec, http.StatusOK)
}

// An id that is not a number names no policy, so nothing is written for it.
func TestShapingPolicyWritesRefuseAnIdThatIsNotANumber(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPatch, "shaping-policies/abc", device.ID, testAdminUserID, "admin",
		`{"name":"voip","srcaddr":["LAN"],"dstaddr":["all"],"service":["SIP"],"traffic_shaper":"s"}`,
		param("id", "abc"))
	DeviceUpdateShapingPolicy(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = deviceJSONRequest(t, http.MethodDelete, "shaping-policies/abc", device.ID, testAdminUserID, "admin", "",
		param("id", "abc"))
	DeviceDeleteShapingPolicy(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	coverUntouched(t, stub)
}

// What the firewall said, as a refusal with its number — not as "the firewall is down".
func TestShapingWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{writeErr: tc.err}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost, "traffic-shapers", device.ID, testAdminUserID, "admin",
				`{"name":"branch","maximum_bandwidth":1000}`)
			DeviceCreateTrafficShaper(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}
}

// Unreadable is not empty: the lists answer 502 rather than [] when the device cannot be read.
func TestShapingListsSeparateAnUnreachableDeviceFromAnEmptyOne(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{readErr: errTransport{}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "traffic-shapers", device.ID, testAdminUserID, "admin")
	DeviceListTrafficShapers(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceRequest(t, http.MethodGet, "shaping-policies", device.ID, testAdminUserID, "admin")
	DeviceListShapingPolicies(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
}
