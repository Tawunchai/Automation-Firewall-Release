package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Network ▸ Zones — the one writable corner of a page that is otherwise read-only, because a zone
// is a grouping the operator invents rather than a property of the hardware.
//
// Same silent no-op as an empty address group: FortiOS stores a zone with no interfaces and a
// policy naming it then matches nothing. validateZone is what refuses it.

func TestValidateZoneRefusesTheZonesThatWouldMatchNothingOrNotApply(t *testing.T) {
	cases := []struct {
		name     string
		in       zoneInput
		wantSays string
	}{
		{
			name:     "no interfaces — the silent no-op",
			in:       zoneInput{Name: "trust"},
			wantSays: "at least one interface",
		},
		{name: "nameless", in: zoneInput{Interfaces: []string{"port1"}}, wantSays: "name is required"},
		{
			// 35, not the 79 an address gets: system/zone's own schema limit.
			name:     "a name past the 35 characters system/zone stores",
			in:       zoneInput{Name: strings.Repeat("z", 36), Interfaces: []string{"port1"}},
			wantSays: "35 characters",
		},
		{
			name:     "intra-zone traffic set to something that is neither allow nor deny",
			in:       zoneInput{Name: "trust", Intrazone: "maybe", Interfaces: []string{"port1"}},
			wantSays: "allow or deny",
		},
		{
			name:     "a blank interface row",
			in:       zoneInput{Name: "trust", Interfaces: []string{"port1", " "}},
			wantSays: "interface name is empty",
		},
		{
			name:     "the same port twice, in different case",
			in:       zoneInput{Name: "trust", Interfaces: []string{"port1", "PORT1"}},
			wantSays: "listed twice",
		},
		{name: "a real zone", in: zoneInput{Name: "trust", Intrazone: "deny", Interfaces: []string{"port1", "port2"}}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateZone(tc.in)
			if tc.wantSays == "" {
				if got != "" {
					t.Fatalf("a valid zone was refused: %s", got)
				}
				return
			}
			if !strings.Contains(got, tc.wantSays) {
				t.Fatalf("refusal = %q, want it to mention %q", got, tc.wantSays)
			}
		})
	}
}

func TestZoneFromTrimsTheNameAndCarriesTheRest(t *testing.T) {
	got := zoneFrom(zoneInput{Name: "  trust  ", Interfaces: []string{"port1"}, Intrazone: "deny", Description: "d"})
	if got.Name != "trust" {
		t.Errorf("name = %q, want it trimmed", got.Name)
	}
	if got.Intrazone != "deny" || got.Description != "d" || len(got.Interfaces) != 1 {
		t.Errorf("a zone field was lost: %+v", got)
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestZoneWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"trust","interfaces":["port1"]}`

	checks := []struct {
		name   string
		method string
		tail   string
		body   string
		mkey   string
		invoke string
	}{
		{"create", http.MethodPost, "zones", body, "", "create"},
		{"update", http.MethodPatch, "zones/trust", body, "trust", "update"},
		{"delete", http.MethodDelete, "zones/trust", "", "trust", "delete"},
	}

	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, param("name", tc.mkey))

			switch tc.invoke {
			case "create":
				DeviceCreateZone(c)
			case "update":
				DeviceUpdateZone(c)
			case "delete":
				DeviceDeleteZone(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestDeviceZoneCRUDSendsTheInterfacesTheFormChose(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "zones", device.ID, testAdminUserID, "admin",
		`{"name":"trust","interfaces":["port1","port2"],"intrazone":"deny"}`)
	DeviceCreateZone(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if got := stub.gotZone; len(got.Interfaces) != 2 || got.Intrazone != "deny" {
		t.Fatalf("the zone the device was asked for is not the one described: %+v", got)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "zones/trust", device.ID, testAdminUserID, "admin",
		`{"name":"trust","interfaces":["port1"]}`, param("name", "trust"))
	DeviceUpdateZone(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateZone trust") {
		t.Fatalf("the edit did not address trust: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "zones/trust", device.ID, testAdminUserID, "admin", "",
		param("name", "trust"))
	DeviceDeleteZone(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteZone trust") {
		t.Fatalf("the delete did not name trust as its mkey: %v", stub.calls)
	}
}

// The device's own refusal is passed through whole here, because it is the only thing that can say
// WHICH interface is already in a zone (-5 on the member, not on the zone name).
func TestDeviceZoneWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run("create: "+tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "zones", device.ID, testAdminUserID, "admin",
				`{"name":"trust","interfaces":["port1"]}`)
			DeviceCreateZone(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	t.Run("delete: a policy still names the zone", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "zones/trust", device.ID, testAdminUserID, "admin", "",
			param("name", "trust"))
		DeviceDeleteZone(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

func TestDeviceCreateZoneRefusesAnEmptyZoneBeforeLoggingIn(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "zones", device.ID, testAdminUserID, "admin",
		`{"name":"trust","interfaces":[]}`)
	DeviceCreateZone(c)

	coverWantStatus(t, rec, http.StatusBadRequest)
	coverUntouched(t, stub)
}

func TestDeviceZoneReadsServeWhatTheDeviceHolds(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{
		zones: []services.FGZone{{Name: "trust", Interfaces: []string{"port1"}, Intrazone: "deny"}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "zones", device.ID, testAdminUserID, "admin")
	DeviceListZones(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "trust") {
		t.Fatalf("the zones did not arrive:\n%s", rec.Body.String())
	}

	c, rec = deviceRequest(t, http.MethodGet, "zones/trust", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "trust"))
	DeviceGetZone(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceRequest(t, http.MethodGet, "zones/nope", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "nope"))
	DeviceGetZone(c)
	coverWantStatus(t, rec, http.StatusNotFound)
}

func TestDeviceListZonesReportsAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{readErr: errTransport{}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "zones", device.ID, testAdminUserID, "admin")
	DeviceListZones(c)

	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)
}
