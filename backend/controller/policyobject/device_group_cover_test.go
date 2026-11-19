package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"network_automation/services"
)

// Policy & Objects ▸ Address Groups and Service Groups.
//
// The rule worth testing here is the one FortiOS does NOT have: a group with no members is valid
// to POST and matches nothing, so a policy that uses it silently passes no traffic. That is the
// worst failure available in this domain — the rule looks right in the table and does nothing —
// and validateGroup is the only thing standing between a blank form and it.

func TestValidateGroupRefusesTheGroupsThatWouldSilentlyMatchNothing(t *testing.T) {
	cases := []struct {
		name     string
		in       groupInput
		kind     string
		wantSays string // a fragment of the refusal, or "" when the input must be accepted
	}{
		{
			name:     "no members at all",
			in:       groupInput{Name: "web-servers"},
			kind:     "address",
			wantSays: "at least one member",
		},
		{
			name:     "the article follows the kind — \"an address group\", not \"a address group\"",
			in:       groupInput{Name: "web-servers"},
			kind:     "address",
			wantSays: "an address group",
		},
		{
			name:     "…and \"a service group\" for the consonant",
			in:       groupInput{Name: "web-ports"},
			kind:     "service",
			wantSays: "a service group",
		},
		{
			name:     "a nameless group",
			in:       groupInput{Members: []string{"srv1"}},
			kind:     "address",
			wantSays: "name is required",
		},
		{
			name:     "a name past the 79 characters FortiOS stores",
			in:       groupInput{Name: strings.Repeat("a", 80), Members: []string{"srv1"}},
			kind:     "address",
			wantSays: "too long",
		},
		{
			name:     "a blank member row left behind by the form",
			in:       groupInput{Name: "g", Members: []string{"srv1", "  "}},
			kind:     "address",
			wantSays: "member name is empty",
		},
		{
			name:     "a group that contains itself, in any case",
			in:       groupInput{Name: "g1", Members: []string{"G1"}},
			kind:     "address",
			wantSays: "cannot contain itself",
		},
		{
			name:     "exclude switched on with nothing excluded",
			in:       groupInput{Name: "g", Members: []string{"srv1"}, Exclude: true},
			kind:     "address",
			wantSays: "no excluded member",
		},
		{
			name: "a real group",
			in:   groupInput{Name: "web-servers", Members: []string{"srv1", "srv2"}},
			kind: "address",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateGroup(tc.in, tc.kind)
			if tc.wantSays == "" {
				if got != "" {
					t.Fatalf("a valid group was refused: %s", got)
				}
				return
			}
			if !strings.Contains(got, tc.wantSays) {
				t.Fatalf("refusal = %q, want it to mention %q", got, tc.wantSays)
			}
		})
	}
}

func TestGroupFromTrimsTheNameAndKeepsEachTypesOwnFields(t *testing.T) {
	ag := addrGroupFrom(groupInput{
		Name: "  web-servers  ", Type: "default", Members: []string{"srv1"},
		Exclude: true, ExcludeMembers: []string{"srv-old"}, AllowRouting: true,
		FabricObject: true, Comment: "c", Color: 7,
		Proxy: true, // service-group only: must not appear on an address group
	})
	if ag.Name != "web-servers" {
		t.Errorf("name = %q, want it trimmed", ag.Name)
	}
	if !ag.AllowRouting || !ag.Exclude || len(ag.ExcludeMembers) != 1 || !ag.FabricObject || ag.Color != 7 {
		t.Errorf("an address group lost one of its own fields: %+v", ag)
	}

	sg := svcGroupFrom(groupInput{
		Name: " web-ports ", Members: []string{"HTTP"}, Proxy: true, FabricObject: true, Color: 3,
		AllowRouting: true, // address-group only
	})
	if sg.Name != "web-ports" || !sg.Proxy || !sg.FabricObject || sg.Color != 3 {
		t.Errorf("a service group lost one of its own fields: %+v", sg)
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

func TestGroupWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"name":"web-servers","members":["srv1"]}`

	checks := []struct {
		name   string
		method string
		tail   string
		body   string
		mkey   string
		invoke string
	}{
		{"create address group", http.MethodPost, "address-groups", body, "", "create-ag"},
		{"update address group", http.MethodPatch, "address-groups/web-servers", body, "web-servers", "update-ag"},
		{"delete address group", http.MethodDelete, "address-groups/web-servers", "", "web-servers", "delete-ag"},
		{"create service group", http.MethodPost, "service-groups", body, "", "create-sg"},
		{"update service group", http.MethodPatch, "service-groups/web-ports", body, "web-ports", "update-sg"},
		{"delete service group", http.MethodDelete, "service-groups/web-ports", "", "web-ports", "delete-sg"},
	}

	for _, tc := range checks {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, param("name", tc.mkey))

			switch tc.invoke {
			case "create-ag":
				DeviceCreateAddressGroup(c)
			case "update-ag":
				DeviceUpdateAddressGroup(c)
			case "delete-ag":
				DeviceDeleteAddressGroup(c)
			case "create-sg":
				DeviceCreateServiceGroup(c)
			case "update-sg":
				DeviceUpdateServiceGroup(c)
			case "delete-sg":
				DeviceDeleteServiceGroup(c)
			}

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestDeviceAddressGroupCRUDSendsTheMembersTheFormChose(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "address-groups", device.ID, testAdminUserID, "admin",
		`{"name":"web-servers","members":["srv1","srv2"],"allow_routing":true,"comment":"dmz"}`)
	DeviceCreateAddressGroup(c)
	coverWantStatus(t, rec, http.StatusCreated)

	if got := stub.gotAddrGroup; len(got.Members) != 2 || got.Members[0] != "srv1" || !got.AllowRouting {
		t.Fatalf("the group the device was asked for is not the one the form described: %+v", got)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "address-groups/web-servers", device.ID, testAdminUserID, "admin",
		`{"name":"web-servers","members":["srv1"]}`, param("name", "web-servers"))
	DeviceUpdateAddressGroup(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateAddressGroup web-servers") {
		t.Fatalf("the edit did not address web-servers: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "address-groups/web-servers", device.ID, testAdminUserID, "admin", "",
		param("name", "web-servers"))
	DeviceDeleteAddressGroup(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteAddressGroup web-servers") {
		t.Fatalf("the delete did not name web-servers as its mkey: %v", stub.calls)
	}
}

// Trap 4 in services/fortigate_group.go: the device answers 200 and silently drops allow-routing.
// The group IS there, so this is neither a failure nor a clean success — and the handler has to say
// so, or the operator is left with a toggle that turned itself off.
func TestDeviceAddressGroupReportsTheSilentlyDiscardedToggleAsAWarning(t *testing.T) {
	device := handlerTestDevice(t)

	t.Run("create", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: services.ErrAllowRoutingDiscarded}, nil)
		c, rec := deviceJSONRequest(t, http.MethodPost, "address-groups", device.ID, testAdminUserID, "admin",
			`{"name":"web-servers","members":["srv1"],"allow_routing":true}`)
		DeviceCreateAddressGroup(c)

		coverWantStatus(t, rec, http.StatusCreated)
		if !strings.Contains(rec.Body.String(), "warning") {
			t.Fatalf("the group exists but the dropped toggle was not reported:\n%s", rec.Body.String())
		}
	})

	t.Run("update", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: services.ErrAllowRoutingDiscarded}, nil)
		c, rec := deviceJSONRequest(t, http.MethodPatch, "address-groups/web-servers", device.ID, testAdminUserID, "admin",
			`{"name":"web-servers","members":["srv1"],"allow_routing":true}`, param("name", "web-servers"))
		DeviceUpdateAddressGroup(c)

		coverWantStatus(t, rec, http.StatusOK)
		if !strings.Contains(rec.Body.String(), "warning") {
			t.Fatalf("the edit landed but the dropped toggle was not reported:\n%s", rec.Body.String())
		}
	})
}

func TestDeviceGroupWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run("address group: "+tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "address-groups", device.ID, testAdminUserID, "admin",
				`{"name":"web-servers","members":["srv1"]}`)
			DeviceCreateAddressGroup(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})

		t.Run("service group: "+tc.name, func(t *testing.T) {
			withDeviceClient(t, &coverStub{writeErr: tc.err}, nil)
			c, rec := deviceJSONRequest(t, http.MethodPost, "service-groups", device.ID, testAdminUserID, "admin",
				`{"name":"web-ports","members":["HTTP"]}`)
			DeviceCreateServiceGroup(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}

	// A group is the object a policy most often still points at, so -23 on the delete is the
	// refusal this page sees most.
	t.Run("delete: still referenced is 409 with the number", func(t *testing.T) {
		withDeviceClient(t, &coverStub{writeErr: coverDevErr(services.FGErrStillReferenced)}, nil)
		c, rec := deviceJSONRequest(t, http.MethodDelete, "address-groups/web-servers", device.ID, testAdminUserID, "admin", "",
			param("name", "web-servers"))
		DeviceDeleteAddressGroup(c)

		coverWantStatus(t, rec, http.StatusConflict)
		coverWantFortiOSCode(t, rec, services.FGErrStillReferenced)
	})
}

func TestDeviceServiceGroupCRUDSendsTheMembersTheFormChose(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodPost, "service-groups", device.ID, testAdminUserID, "admin",
		`{"name":"web-ports","members":["HTTP","HTTPS"],"proxy":true}`)
	DeviceCreateServiceGroup(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if got := stub.gotSvcGroup; len(got.Members) != 2 || !got.Proxy {
		t.Fatalf("the service group sent is not the one described: %+v", got)
	}

	c, rec = deviceJSONRequest(t, http.MethodPatch, "service-groups/web-ports", device.ID, testAdminUserID, "admin",
		`{"name":"web-ports","members":["HTTP"]}`, param("name", "web-ports"))
	DeviceUpdateServiceGroup(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodDelete, "service-groups/web-ports", device.ID, testAdminUserID, "admin", "",
		param("name", "web-ports"))
	DeviceDeleteServiceGroup(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteServiceGroup web-ports") {
		t.Fatalf("the delete did not name web-ports as its mkey: %v", stub.calls)
	}
}

// ── the reads ───────────────────────────────────────────────────────────────

func TestDeviceGroupListsServeWhatTheDeviceHolds(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{
		addrGroups: []services.FGAddressGroup{{Name: "web-servers", Members: []string{"srv1"}}},
		svcGroups:  []services.FGServiceGroup{{Name: "web-ports", Members: []string{"HTTP"}}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "address-groups", device.ID, testAdminUserID, "admin")
	DeviceListAddressGroups(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "web-servers") {
		t.Fatalf("the address groups did not arrive:\n%s", rec.Body.String())
	}

	c, rec = deviceRequest(t, http.MethodGet, "service-groups", device.ID, testAdminUserID, "admin")
	DeviceListServiceGroups(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !strings.Contains(rec.Body.String(), "web-ports") {
		t.Fatalf("the service groups did not arrive:\n%s", rec.Body.String())
	}
}

// A group list is open to any signed-in user — reading Policy & Objects is not admin-only, and
// gating a list quietly would turn the page into a 403 with no cause anyone could see.
func TestDeviceGroupListsAreOpenToAGrantedPlainUser(t *testing.T) {
	device := handlerTestDevice(t)
	grantDevice(t, device.ID)
	withDeviceClient(t, &coverStub{
		addrGroups: []services.FGAddressGroup{{Name: "web-servers"}},
	}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "address-groups", device.ID, testPlainUserID, "user")
	DeviceListAddressGroups(c)
	coverWantStatus(t, rec, http.StatusOK)
}

func TestDeviceGetGroupAnswers404ForAGroupTheDeviceDoesNotHave(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{addrGroups: []services.FGAddressGroup{{Name: "other"}}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "address-groups/web-servers", device.ID, testAdminUserID, "admin")
	c.Params = append(c.Params, param("name", "web-servers"))
	DeviceGetAddressGroup(c)

	coverWantStatus(t, rec, http.StatusNotFound)
}

func TestDeviceGroupListsReportAnUnreachableDeviceAsABadGateway(t *testing.T) {
	device := handlerTestDevice(t)
	withDeviceClient(t, &coverStub{readErr: errTransport{}}, nil)

	c, rec := deviceRequest(t, http.MethodGet, "address-groups", device.ID, testAdminUserID, "admin")
	DeviceListAddressGroups(c)

	coverWantStatus(t, rec, http.StatusBadGateway)
	coverWantNoFortiOSCode(t, rec)
}
