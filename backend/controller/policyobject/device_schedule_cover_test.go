package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// Policy & Objects ▸ Schedules — three FortiOS tables (recurring / onetime / group) behind one
// page, so a handler's first job is to know which table it is addressing.
//
// Two rules are worth more than the rest: the two built-in schedules ("always", "none") cannot be
// renamed over, edited or deleted — the device refuses it and a policy referencing one would break
// — and a time has to be in the exact shape its table stores, because FortiOS answers a malformed
// one with a CLI parser error nobody can act on.

func TestValidateScheduleEnforcesWhatEachTableStores(t *testing.T) {
	cases := []struct {
		name     string
		in       scheduleInput
		wantSays string // "" = must be accepted
		check    func(t *testing.T, got services.FGScheduleFull)
	}{
		{name: "nameless", in: scheduleInput{Type: "recurring"}, wantSays: "name is required"},
		{
			name:     "a type that is not one of the three tables",
			in:       scheduleInput{Name: "s", Type: "fortnightly"},
			wantSays: "recurring, onetime, or group",
		},
		{
			name:     "a colour outside the 33 FortiOS has",
			in:       scheduleInput{Name: "s", Type: "recurring", Color: 33, Day: []string{"monday"}},
			wantSays: "color must be 0-32",
		},
		{
			name:     "recurring with no day selected",
			in:       scheduleInput{Name: "s", Type: "recurring"},
			wantSays: "at least one day",
		},
		{
			name:     "a weekday that does not exist",
			in:       scheduleInput{Name: "s", Type: "recurring", Day: []string{"funday"}},
			wantSays: "invalid weekday",
		},
		{
			name:     "a clock time that is not hh:mm",
			in:       scheduleInput{Name: "s", Type: "recurring", Day: []string{"monday"}, Start: "9am", End: "17:00"},
			wantSays: "hh:mm",
		},
		{
			name:     "an hour past 23",
			in:       scheduleInput{Name: "s", Type: "recurring", Day: []string{"monday"}, Start: "24:00", End: "17:00"},
			wantSays: "hh:mm",
		},
		{
			name: "recurring, all day: both ends default to 00:00 and the days are lower-cased",
			in:   scheduleInput{Name: "office", Type: "recurring", Day: []string{"Monday", "FRIDAY"}},
			check: func(t *testing.T, got services.FGScheduleFull) {
				if got.Start != "00:00" || got.End != "00:00" {
					t.Errorf("all-day became %q..%q, want 00:00..00:00", got.Start, got.End)
				}
				if got.Day[0] != "monday" || got.Day[1] != "friday" {
					t.Errorf("days = %v, want them lower-cased the way the device stores them", got.Day)
				}
			},
		},
		{
			name:     "onetime with a date that is not 'hh:mm yyyy/mm/dd'",
			in:       scheduleInput{Name: "s", Type: "onetime", Start: "2026/01/01", End: "00:00 2026/01/02"},
			wantSays: "hh:mm yyyy/mm/dd",
		},
		{
			name: "onetime with a pre-expiration warning outside 0-100 days",
			in: scheduleInput{
				Name: "s", Type: "onetime",
				Start: "08:00 2026/01/01", End: "17:00 2026/01/02", ExpirationDays: 101,
			},
			wantSays: "0-100",
		},
		{
			name: "a real onetime window",
			in: scheduleInput{
				Name: "cutover", Type: "onetime",
				Start: "08:00 2026/01/01", End: "17:00 2026/01/02", ExpirationDays: 3,
			},
			check: func(t *testing.T, got services.FGScheduleFull) {
				if got.Start != "08:00 2026/01/01" || got.ExpirationDays != 3 {
					t.Errorf("the one-time window was altered: %+v", got)
				}
				// A onetime schedule has no weekdays; sending any would be refused by the device.
				if len(got.Day) != 0 {
					t.Errorf("day = %v, want none on a one-time schedule", got.Day)
				}
			},
		},
		{
			name:     "an empty schedule group",
			in:       scheduleInput{Name: "g", Type: "group"},
			wantSays: "at least one member",
		},
		{
			name: "a real schedule group",
			in:   scheduleInput{Name: "g", Type: "group", Member: []string{"office"}},
			check: func(t *testing.T, got services.FGScheduleFull) {
				if len(got.Member) != 1 || got.Member[0] != "office" {
					t.Errorf("members = %v", got.Member)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateSchedule(tc.in)
			if tc.wantSays != "" {
				if err == nil {
					t.Fatalf("an invalid schedule was accepted: %+v", got)
				}
				if !strings.Contains(err.Error(), tc.wantSays) {
					t.Fatalf("refusal = %q, want it to mention %q", err.Error(), tc.wantSays)
				}
				return
			}
			if err != nil {
				t.Fatalf("a valid schedule was refused: %v", err)
			}
			if tc.check != nil {
				tc.check(t, got)
			}
		})
	}
}

// ── the gate, and the built-ins ─────────────────────────────────────────────

func TestScheduleWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"office","type":"recurring","day":["monday"]}`

	checks := []struct {
		name   string
		method string
		tail   string
		body   string
		params []param2
	}{
		{"create", http.MethodPost, "schedules", body, nil},
		{"update", http.MethodPut, "schedules/recurring/office", body, []param2{{"type", "recurring"}, {"name", "office"}}},
		{"delete", http.MethodDelete, "schedules/recurring/office", "", []param2{{"type", "recurring"}, {"name", "office"}}},
	}

	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, params2(tc.params)...)

			switch tc.name {
			case "create":
				DeviceCreateSchedule(c)
			case "update":
				DeviceUpdateSchedule(c)
			case "delete":
				DeviceDeleteSchedule(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// "always" and "none" are the device's own. An admin is refused too — this is not the role gate,
// it is the object: a policy referencing one of them would break, and the device refuses the write
// anyway.
func TestBuiltinSchedulesCannotBeCreatedOverEditedOrDeletedEvenByAnAdmin(t *testing.T) {
	t.Run("create with a reserved name is 400", func(t *testing.T) {
		stub := &coverStub{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodPost, "schedules", "admin",
			`{"name":"always","type":"recurring","day":["monday"]}`)
		DeviceCreateSchedule(c)

		coverWantStatus(t, rec, http.StatusBadRequest)
		coverUntouched(t, stub)
	})

	t.Run("editing one is 403", func(t *testing.T) {
		stub := &coverStub{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodPut, "schedules/recurring/always", "admin",
			`{"name":"always","type":"recurring","day":["monday"]}`,
			param("type", "recurring"), param("name", "always"))
		DeviceUpdateSchedule(c)

		coverWantStatus(t, rec, http.StatusForbidden)
		coverUntouched(t, stub)
	})

	t.Run("deleting one is 403", func(t *testing.T) {
		stub := &coverStub{}
		withDeviceClient(t, stub, nil)
		c, rec := roleRequest(http.MethodDelete, "schedules/recurring/always", "admin", "",
			param("type", "recurring"), param("name", "always"))
		DeviceDeleteSchedule(c)

		coverWantStatus(t, rec, http.StatusForbidden)
		coverUntouched(t, stub)
	})
}

// A type that names no table is refused before a session is opened — the three CMDB paths are a
// closed set, and guessing would address whichever table a typo resembles.
func TestScheduleHandlersRefuseATypeThatNamesNoTable(t *testing.T) {
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := roleRequest(http.MethodDelete, "schedules/fortnightly/x", "admin", "",
		param("type", "fortnightly"), param("name", "x"))
	DeviceDeleteSchedule(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = roleRequest(http.MethodGet, "schedules/fortnightly/x", "admin", "",
		param("type", "fortnightly"), param("name", "x"))
	DeviceGetSchedule(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	coverUntouched(t, stub)
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestDeviceScheduleCRUDAddressesTheRightTable(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "schedules", device.ID, testAdminUserID, "admin",
		`{"name":"office","type":"recurring","day":["Monday"],"start":"08:00","end":"17:00"}`)
	DeviceCreateSchedule(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if !stub.saw("CreateSchedule recurring office") {
		t.Fatalf("the recurring table was not the one written to: %v", stub.calls)
	}

	// The edit form cannot change a schedule's type — the type lives in the URL because it names a
	// different table — so a body claiming another type must not move the object.
	c, rec = deviceJSONRequest(t, http.MethodPut, "schedules/recurring/office", device.ID, testAdminUserID, "admin",
		`{"name":"office","type":"group","member":["x"],"day":["monday"]}`,
		param("type", "recurring"), param("name", "office"))
	DeviceUpdateSchedule(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateSchedule recurring office") {
		t.Fatalf("the edit left the recurring table: %v", stub.calls)
	}
	if stub.gotSchedule.Type != "recurring" {
		t.Errorf("the payload's type = %q, want it pinned to the URL's table", stub.gotSchedule.Type)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "schedules/recurring/office", device.ID, testAdminUserID, "admin", "",
		param("type", "recurring"), param("name", "office"))
	DeviceDeleteSchedule(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteSchedule recurring office") {
		t.Fatalf("the delete did not name the table and mkey: %v", stub.calls)
	}
}

func TestDeviceScheduleWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "schedules", device.ID, testAdminUserID, "admin",
				`{"name":"office","type":"recurring","day":["monday"]}`)
			DeviceCreateSchedule(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	t.Run("delete: a policy still uses the schedule", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "schedules/recurring/office", device.ID, testAdminUserID, "admin", "",
			param("type", "recurring"), param("name", "office"))
		DeviceDeleteSchedule(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

// The list carries a built-in flag so the UI can grey out Edit and Delete on the two schedules
// nothing may change — which is the same rule the handlers above enforce server-side.
func TestDeviceListSchedulesFlagsTheBuiltInsTheUICannotEdit(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{
		schedules: []services.FGScheduleFull{
			{Name: "always", Type: "recurring"},
			{Name: "office", Type: "recurring", Day: []string{"monday"}},
		},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "schedules", device.ID, testAdminUserID, "admin")
	DeviceListSchedules(c)
	coverWantStatus(t, rec, http.StatusOK)

	body := rec.Body.String()
	if !strings.Contains(body, `"builtin":true`) || !strings.Contains(body, `"builtin":false`) {
		t.Fatalf("the list does not separate the built-ins from the operator's own:\n%s", body)
	}
}

func TestDeviceGetScheduleAnswers404ForOneTheDeviceDoesNotHave(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{schedules: []services.FGScheduleFull{{Name: "office"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "schedules/recurring/nope", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("type", "recurring"), param("name", "nope"))
	DeviceGetSchedule(c)

	coverWantStatus(t, rec, http.StatusNotFound)
}

func TestDeviceListSchedulesSeparatesAnUnreachableDeviceFromARefusal(t *testing.T) {
	device := handlerTestDevice(t)

	withDeviceClient(t, &coverStub{readErr: errTransport{}}, nil)
	c, rec := deviceRequest(t, http.MethodGet, "schedules", device.ID, testAdminUserID, "admin")
	DeviceListSchedules(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)

	withDeviceClient(t, &coverStub{readErr: coverDevErr(-37)}, nil)
	c, rec = deviceRequest(t, http.MethodGet, "schedules", device.ID, testAdminUserID, "admin")
	DeviceListSchedules(c)
	coverWantStatus(t, rec, http.StatusBadRequest)
	coverWantFortiOSCode(t, rec, -37)
}

// ── a two-parameter route's params, as a table ──────────────────────────────

type param2 struct{ key, value string }

func params2(in []param2) []gin.Param {
	out := make([]gin.Param, 0, len(in))
	for _, p := range in {
		out = append(out, param(p.key, p.value))
	}
	return out
}
