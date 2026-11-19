package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// System ▸ SNMP — the three CMDB tables behind one page (sysinfo, community, user).
//
// Why this section gets the strictest tests in the package: a community string is a shared
// password in all but name and a v3 user carries two real ones, so every write here is admin-only
// and every validation rule is a security rule rather than a convenience. Three of them in
// particular would be invisible from a status code alone:
//
//   - a community with no hosts answers EVERY manager that knows the string, from anywhere.
//     FortiOS accepts that silently; this console refuses it.
//   - an auth/priv password sent as "" would blank a working credential. The field is a pointer
//     precisely so "absent" and "empty" stay different, and only "absent" means keep.
//   - traps enabled with no notify host is a setting that does nothing and the device never says
//     so.

func strptr(s string) *string { return &s }

func boolptr(b bool) *bool { return &b }

// ── validation: the community ───────────────────────────────────────────────

func TestValidateSNMPCommunityRefusesTheWideOpenShapesFortiOSAccepts(t *testing.T) {
	host := snmpHostInput{IP: "10.10.20.5", HostType: "query"}

	cases := []struct {
		name     string
		in       snmpCommunityInput
		wantSays string // "" = must be accepted
	}{
		{name: "nameless", in: snmpCommunityInput{Hosts: []snmpHostInput{host}}, wantSays: "a community name is required"},
		{
			name:     "no hosts at all answers any address",
			in:       snmpCommunityInput{Name: "public"},
			wantSays: "at least one host is required",
		},
		{
			// A form row the user started and abandoned is not a host — but it must not COUNT as
			// one either, or the rule above is satisfied by whitespace.
			name:     "only blank host rows is still no hosts",
			in:       snmpCommunityInput{Name: "public", Hosts: []snmpHostInput{{IP: "  "}, {IP: ""}}},
			wantSays: "at least one host is required",
		},
		{
			name:     "a host type that is not one of the three",
			in:       snmpCommunityInput{Name: "public", Hosts: []snmpHostInput{{IP: "10.0.0.1", HostType: "broadcast"}}},
			wantSays: "host type must be any, query or trap",
		},
		{
			name:     "a port outside the 16-bit range",
			in:       snmpCommunityInput{Name: "public", Hosts: []snmpHostInput{host}, QueryV1Port: 70000},
			wantSays: "ports must be between 1 and 65535",
		},
		{
			name:     "an event name this build does not know",
			in:       snmpCommunityInput{Name: "public", Hosts: []snmpHostInput{host}, Events: []string{"ludicrous-speed"}},
			wantSays: "unknown SNMP event",
		},
		{
			// Port 0 means "the default" throughout FortiOS, so it is not out of range.
			name: "a real community, ports left at the device default",
			in:   snmpCommunityInput{Name: "public", Hosts: []snmpHostInput{host}, Events: []string{services.SNMPEventOptions[0]}},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateSNMPCommunity(tc.in)
			if tc.wantSays == "" {
				if got != "" {
					t.Fatalf("refused a valid community: %q", got)
				}
				return
			}
			if got == "" {
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			}
			if !strings.Contains(got, tc.wantSays) {
				t.Fatalf("refused with %q, which does not say %q", got, tc.wantSays)
			}
		})
	}
}

// The blank rows a form leaves behind must never reach the device, and a host with no type must
// arrive as "any" rather than as the empty string FortiOS would reject.
func TestSNMPInputToCommunityDropsBlankRowsAndDefaultsTheHostType(t *testing.T) {
	got := snmpInputToCommunity(snmpCommunityInput{
		Name:  "  public  ",
		Hosts: []snmpHostInput{{IP: " 10.0.0.1 "}, {IP: "   "}, {ID: 3, IP: "10.0.0.2", HostType: "trap"}},
	})

	if got.Name != "public" {
		t.Errorf("name = %q, want it trimmed", got.Name)
	}
	if len(got.Hosts) != 2 {
		t.Fatalf("hosts = %+v, want the blank row dropped", got.Hosts)
	}
	if got.Hosts[0].IP != "10.0.0.1" || got.Hosts[0].HostType != "any" {
		t.Errorf("host 0 = %+v, want the IP trimmed and the type defaulted to any", got.Hosts[0])
	}
	if got.Hosts[1].ID != 3 || got.Hosts[1].HostType != "trap" {
		t.Errorf("host 1 = %+v, want its own id and type kept", got.Hosts[1])
	}
	// Everything the form left unsaid is ON, because that is what the page shows for a new
	// community and a silently-disabled query would read as a broken device.
	if !got.Status || !got.QueryV1Status || !got.QueryV2cStatus || !got.TrapV1Status || !got.TrapV2cStatus {
		t.Errorf("an unspecified toggle came out off: %+v", got)
	}
}

// ── validation: the v3 user ─────────────────────────────────────────────────

func TestValidateSNMPUserKeepsAbsentAndEmptyPasswordsApart(t *testing.T) {
	base := func(mut func(*snmpUserInput)) snmpUserInput {
		in := snmpUserInput{
			Name: "monitor", SecurityLevel: "auth-priv",
			AuthProto: "sha256", AuthPwd: strptr("auth-secret"),
			PrivProto: "aes256", PrivPwd: strptr("priv-secret"),
			NotifyHosts: []string{"10.10.20.5"},
		}
		if mut != nil {
			mut(&in)
		}
		return in
	}

	cases := []struct {
		name     string
		in       snmpUserInput
		creating bool
		wantSays string
	}{
		{name: "a full auth-priv user", in: base(nil), creating: true},
		{name: "nameless", in: base(func(i *snmpUserInput) { i.Name = " " }), creating: true, wantSays: "a user name is required"},
		{
			name:     "a security level FortiOS has no word for",
			in:       base(func(i *snmpUserInput) { i.SecurityLevel = "auth-maybe" }),
			creating: true, wantSays: "security level must be",
		},
		{
			name:     "an authentication protocol this build does not know",
			in:       base(func(i *snmpUserInput) { i.AuthProto = "sha1024" }),
			creating: true, wantSays: "unsupported authentication protocol",
		},
		{
			name:     "a privacy protocol this build does not know",
			in:       base(func(i *snmpUserInput) { i.PrivProto = "rot13" }),
			creating: true, wantSays: "unsupported privacy protocol",
		},
		{
			name:     "creating at auth-priv with no auth password",
			in:       base(func(i *snmpUserInput) { i.AuthPwd = nil }),
			creating: true, wantSays: "an authentication password is required",
		},
		{
			name:     "creating at auth-priv with no privacy password",
			in:       base(func(i *snmpUserInput) { i.PrivPwd = nil }),
			creating: true, wantSays: "a privacy password is required",
		},
		{
			// THE pointer case: on an edit, absent means keep. This must be accepted, or the form
			// could never be saved again without retyping both secrets.
			name: "editing with both passwords absent keeps the stored ones",
			in:   base(func(i *snmpUserInput) { i.AuthPwd, i.PrivPwd = nil, nil }),
		},
		{
			// …and the other half: an explicit "" is a request to blank a working credential, and
			// is refused on an edit as firmly as on a create.
			name:     "editing with an empty auth password would blank it",
			in:       base(func(i *snmpUserInput) { i.AuthPwd = strptr("   ") }),
			wantSays: "cannot be set to empty",
		},
		{
			name:     "editing with an empty privacy password would blank it",
			in:       base(func(i *snmpUserInput) { i.PrivPwd = strptr("") }),
			wantSays: "cannot be set to empty",
		},
		{
			// no-auth-no-priv needs neither password, and must not be asked for one.
			name: "no-auth-no-priv needs no passwords at all",
			in: snmpUserInput{Name: "plain", SecurityLevel: "no-auth-no-priv",
				NotifyHosts: []string{"10.10.20.5"}},
			creating: true,
		},
		{
			// An empty level is the page's own default, not an error.
			name: "an unset level is treated as no-auth-no-priv",
			in:   snmpUserInput{Name: "plain", NotifyHosts: []string{"10.10.20.5"}}, creating: true,
		},
		{
			name:     "traps on with nowhere to send them",
			in:       snmpUserInput{Name: "plain", TrapStatus: boolptr(true)},
			creating: true, wantSays: "no notify host is set",
		},
		{
			// Blank rows again: a notify host list of whitespace is no notify host.
			name:     "notify hosts that are all blank is no notify host",
			in:       snmpUserInput{Name: "plain", NotifyHosts: []string{"  ", ""}},
			creating: true, wantSays: "no notify host is set",
		},
		{
			name:     "a port outside the 16-bit range",
			in:       snmpUserInput{Name: "plain", NotifyHosts: []string{"10.0.0.1"}, TrapRPort: -1},
			creating: true, wantSays: "ports must be between 1 and 65535",
		},
		{
			name:     "an event name this build does not know",
			in:       snmpUserInput{Name: "plain", NotifyHosts: []string{"10.0.0.1"}, Events: []string{"ludicrous-speed"}},
			creating: true, wantSays: "unknown SNMP event",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := validateSNMPUser(tc.in, tc.creating)
			if tc.wantSays == "" {
				if got != "" {
					t.Fatalf("refused a valid user: %q", got)
				}
				return
			}
			if got == "" {
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			}
			if !strings.Contains(got, tc.wantSays) {
				t.Fatalf("refused with %q, which does not say %q", got, tc.wantSays)
			}
		})
	}
}

// The password pointers have to survive the mapping as pointers. If this collapsed them to a
// string, "keep the stored one" would become "set it to empty" at the last step, after validation
// had already approved the request.
func TestSNMPInputToUserCarriesThePasswordPointersThrough(t *testing.T) {
	keep := snmpInputToUser(snmpUserInput{Name: " monitor ", SecurityLevel: "auth-priv"})
	if keep.AuthPwd != nil || keep.PrivPwd != nil {
		t.Errorf("an absent password became %v/%v, not nil — the device would be told to blank it",
			keep.AuthPwd, keep.PrivPwd)
	}
	if keep.Name != "monitor" {
		t.Errorf("name = %q, want it trimmed", keep.Name)
	}

	set := snmpInputToUser(snmpUserInput{Name: "monitor", AuthPwd: strptr("s3cret")})
	if set.AuthPwd == nil || *set.AuthPwd != "s3cret" {
		t.Errorf("a supplied password did not reach the device: %v", set.AuthPwd)
	}

	// An unset level is the page's default, and it must be spelled out for the device rather than
	// sent as "".
	if set.SecurityLevel != "no-auth-no-priv" {
		t.Errorf("security level = %q, want the default spelled out", set.SecurityLevel)
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

// Every SNMP write is admin-only, and the refusal has to come BEFORE the device is reached — a 403
// that still wrote the community would look identical from the status code.
func TestSNMPWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	community := `{"name":"public","hosts":[{"ip":"10.0.0.1"}]}`
	user := `{"name":"monitor","notify_hosts":["10.0.0.1"]}`

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		params  []param2
		handler gin.HandlerFunc
	}{
		{"sysinfo", http.MethodPatch, "snmp/sysinfo", `{"description":"x"}`, nil, DeviceUpdateSNMPSysInfo},
		{"community create", http.MethodPost, "snmp/communities", community, nil, DeviceCreateSNMPCommunity},
		{"community update", http.MethodPatch, "snmp/communities/1", community, []param2{{"id", "1"}}, DeviceUpdateSNMPCommunity},
		{"community delete", http.MethodDelete, "snmp/communities/1", "", []param2{{"id", "1"}}, DeviceDeleteSNMPCommunity},
		{"user create", http.MethodPost, "snmp/users", user, nil, DeviceCreateSNMPUser},
		{"user update", http.MethodPatch, "snmp/users/monitor", user, []param2{{"name", "monitor"}}, DeviceUpdateSNMPUser},
		{"user delete", http.MethodDelete, "snmp/users/monitor", "", []param2{{"name", "monitor"}}, DeviceDeleteSNMPUser},
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

// A bad id or a nameless user is the caller's mistake, and the device is never written to for it.
//
// These handlers open the session BEFORE reading the key out of the path (device_session.go's
// prologue comes first), so this needs a real device row — but the assertion is the same one: a
// 400, and nothing on the firewall.
func TestSNMPHandlersRefuseAnUnusableKey(t *testing.T) {
	device := handlerTestDevice(t)

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		params  []param2
		handler gin.HandlerFunc
	}{
		{"community id that is not a number", http.MethodPatch, "snmp/communities/abc",
			`{"name":"public","hosts":[{"ip":"10.0.0.1"}]}`, []param2{{"id", "abc"}}, DeviceUpdateSNMPCommunity},
		{"community delete with a bad id", http.MethodDelete, "snmp/communities/abc", "",
			[]param2{{"id", "abc"}}, DeviceDeleteSNMPCommunity},
		{"community read with a bad id", http.MethodGet, "snmp/communities/abc", "",
			[]param2{{"id", "abc"}}, DeviceGetSNMPCommunity},
		{"user update with no name", http.MethodPatch, "snmp/users/%20",
			`{"name":"monitor","notify_hosts":["10.0.0.1"]}`, []param2{{"name", "  "}}, DeviceUpdateSNMPUser},
		{"user delete with no name", http.MethodDelete, "snmp/users/%20", "",
			[]param2{{"name", " "}}, DeviceDeleteSNMPUser},
		{"user read with no name", http.MethodGet, "snmp/users/%20", "",
			[]param2{{"name", " "}}, DeviceGetSNMPUser},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := deviceJSONRequest(t, tc.method, tc.tail, device.ID, testAdminUserID, "admin",
				tc.body, params2(tc.params)...)
			tc.handler(c)

			coverWantStatus(t, rec, http.StatusBadRequest)
			coverUntouched(t, stub)
		})
	}
}

// A body that does not validate never becomes a write. The device is reached for the session but
// nothing is asked of it — which is the half a status code cannot show.
func TestSNMPWritesRefuseAnInvalidBody(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		handler gin.HandlerFunc
	}{
		{"a community with no hosts", http.MethodPost, "snmp/communities", `{"name":"public"}`, DeviceCreateSNMPCommunity},
		{"a user with traps on and nowhere to send them", http.MethodPost, "snmp/users", `{"name":"monitor"}`, DeviceCreateSNMPUser},
		{"malformed JSON is a 400, not a 500", http.MethodPost, "snmp/communities", `{"name":`, DeviceCreateSNMPCommunity},
		{"a trap threshold that is not a percentage", http.MethodPatch, "snmp/sysinfo", `{"trap_high_cpu_threshold":101}`, DeviceUpdateSNMPSysInfo},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := deviceJSONRequest(t, tc.method, tc.tail, device.ID, testAdminUserID, "admin", tc.body)
			tc.handler(c)
			coverWantStatus(t, rec, http.StatusBadRequest)
		})
	}
	coverUntouched(t, stub)
}

// ── the handlers, against a device that answers ─────────────────────────────

func TestSNMPCRUDWritesWhatTheFormSent(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		snmpSys:   &services.FGSNMPSysInfo{Status: true, Description: "edge"},
		snmpComms: []services.FGSNMPCommunity{{ID: 1, Name: "public"}},
		snmpUsers: []services.FGSNMPUser{{Name: "monitor"}},
	}
	withDeviceClient(t, stub, nil)

	t.Run("the agent reads and writes", func(t *testing.T) {
		c, rec := deviceRequest(t, http.MethodGet, "snmp/sysinfo", device.ID, testAdminUserID, "admin")
		DeviceGetSNMPSysInfo(c)
		coverWantStatus(t, rec, http.StatusOK)

		c, rec = deviceJSONRequest(t, http.MethodPatch, "snmp/sysinfo", device.ID, testAdminUserID, "admin",
			`{"status":true,"description":"edge firewall","trap_high_cpu_threshold":80}`)
		DeviceUpdateSNMPSysInfo(c)
		coverWantStatus(t, rec, http.StatusOK)
		if stub.gotSNMPSys.Description != "edge firewall" || stub.gotSNMPSys.TrapHighCPUThreshold != 80 {
			t.Fatalf("the agent write did not carry the form: %+v", stub.gotSNMPSys)
		}
	})

	t.Run("communities", func(t *testing.T) {
		c, rec := deviceRequest(t, http.MethodGet, "snmp/communities", device.ID, testAdminUserID, "admin")
		DeviceListSNMPCommunities(c)
		coverWantStatus(t, rec, http.StatusOK)

		c, rec = deviceJSONRequest(t, http.MethodGet, "snmp/communities/1", device.ID, testAdminUserID, "admin", "",
			param("id", "1"))
		DeviceGetSNMPCommunity(c)
		coverWantStatus(t, rec, http.StatusOK)

		c, rec = deviceJSONRequest(t, http.MethodPost, "snmp/communities", device.ID, testAdminUserID, "admin",
			`{"name":"readonly","hosts":[{"ip":"10.10.20.5","host_type":"query"}]}`)
		DeviceCreateSNMPCommunity(c)
		coverWantStatus(t, rec, http.StatusCreated)
		if !stub.saw("CreateSNMPCommunity readonly") {
			t.Fatalf("the community was not created: %v", stub.calls)
		}

		c, rec = deviceJSONRequest(t, http.MethodPatch, "snmp/communities/1", device.ID, testAdminUserID, "admin",
			`{"name":"readonly","hosts":[{"ip":"10.10.20.5"}],"status":false}`, param("id", "1"))
		DeviceUpdateSNMPCommunity(c)
		coverWantStatus(t, rec, http.StatusOK)
		if stub.gotSNMPComm.Status {
			t.Error("an explicit status:false was sent to the device as true")
		}

		c, rec = deviceJSONRequest(t, http.MethodDelete, "snmp/communities/1", device.ID, testAdminUserID, "admin", "",
			param("id", "1"))
		DeviceDeleteSNMPCommunity(c)
		coverWantStatus(t, rec, http.StatusOK)
		if !stub.saw("DeleteSNMPCommunity 1") {
			t.Fatalf("the delete did not name the community: %v", stub.calls)
		}
	})

	t.Run("users", func(t *testing.T) {
		c, rec := deviceRequest(t, http.MethodGet, "snmp/users", device.ID, testAdminUserID, "admin")
		DeviceListSNMPUsers(c)
		coverWantStatus(t, rec, http.StatusOK)

		c, rec = deviceJSONRequest(t, http.MethodGet, "snmp/users/monitor", device.ID, testAdminUserID, "admin", "",
			param("name", "monitor"))
		DeviceGetSNMPUser(c)
		coverWantStatus(t, rec, http.StatusOK)

		c, rec = deviceJSONRequest(t, http.MethodPost, "snmp/users", device.ID, testAdminUserID, "admin",
			`{"name":"nms","security_level":"auth-priv","auth_proto":"sha256","auth_pwd":"a-secret",
			  "priv_proto":"aes256","priv_pwd":"p-secret","notify_hosts":["10.10.20.5"]}`)
		DeviceCreateSNMPUser(c)
		coverWantStatus(t, rec, http.StatusCreated)
		if stub.gotSNMPUser.AuthPwd == nil || *stub.gotSNMPUser.AuthPwd != "a-secret" {
			t.Fatalf("the auth password did not reach the device: %+v", stub.gotSNMPUser)
		}

		// The edit the pointer exists for: no passwords in the body at all.
		c, rec = deviceJSONRequest(t, http.MethodPatch, "snmp/users/nms", device.ID, testAdminUserID, "admin",
			`{"name":"nms","security_level":"auth-priv","notify_hosts":["10.10.20.5"]}`, param("name", "nms"))
		DeviceUpdateSNMPUser(c)
		coverWantStatus(t, rec, http.StatusOK)
		if stub.gotSNMPUser.AuthPwd != nil || stub.gotSNMPUser.PrivPwd != nil {
			t.Fatalf("an edit that said nothing about the passwords sent values anyway: %+v", stub.gotSNMPUser)
		}

		c, rec = deviceJSONRequest(t, http.MethodDelete, "snmp/users/nms", device.ID, testAdminUserID, "admin", "",
			param("name", "nms"))
		DeviceDeleteSNMPUser(c)
		coverWantStatus(t, rec, http.StatusOK)
	})
}

// What the firewall said, passed through as a refusal rather than as "the firewall is down".
func TestSNMPWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{writeErr: tc.err}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost, "snmp/communities", device.ID, testAdminUserID, "admin",
				`{"name":"public","hosts":[{"ip":"10.10.20.5"}]}`)
			DeviceCreateSNMPCommunity(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}
}

// A device that cannot be read is not a device with no SNMP configured. The list handlers answer
// 502 rather than an empty array, which is the rule the whole front end's `{ strict: true }`
// depends on.
func TestSNMPListsSeparateAnUnreachableDeviceFromAnEmptyOne(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{readErr: errTransport{}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "snmp/communities", device.ID, testAdminUserID, "admin")
	DeviceListSNMPCommunities(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceRequest(t, http.MethodGet, "snmp/users", device.ID, testAdminUserID, "admin")
	DeviceListSNMPUsers(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceRequest(t, http.MethodGet, "snmp/sysinfo", device.ID, testAdminUserID, "admin")
	DeviceGetSNMPSysInfo(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
}

// One object that is not there is a 404, not a 502 — the caller asked for something specific and
// the device answered clearly.
func TestSNMPGetAnswers404ForOneTheDeviceDoesNotHave(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := deviceJSONRequest(t, http.MethodGet, "snmp/communities/9", device.ID, testAdminUserID, "admin", "",
		param("id", "9"))
	DeviceGetSNMPCommunity(c)
	coverWantStatus(t, rec, http.StatusNotFound)

	c, rec = deviceJSONRequest(t, http.MethodGet, "snmp/users/ghost", device.ID, testAdminUserID, "admin", "",
		param("name", "ghost"))
	DeviceGetSNMPUser(c)
	coverWantStatus(t, rec, http.StatusNotFound)
}
