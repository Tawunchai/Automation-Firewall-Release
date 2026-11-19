package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// The conversions in fortigate_snmp.go are where a wrong assumption about FortiOS becomes a wrong
// SNMP agent, and none of them are visible from the page. These cover the four traps the file's
// own header calls out, plus the two the page depends on to render at all.

func TestSNMPEventOptions_MatchesTheDeviceCatalogue(t *testing.T) {
	// 42 on FortiOS 7.2.10, read from ?action=schema. The two the device's DEFAULT value leaves
	// out are the reason this list exists at all — a catalogue built from the default would be
	// missing exactly these, and the two checkboxes would never appear.
	if got := len(SNMPEventOptions); got != 42 {
		t.Fatalf("SNMPEventOptions has %d entries, want 42", got)
	}
	for _, missing := range []string{"fm-conf-change", "device-new"} {
		if !snmpEventSet[missing] {
			t.Errorf("%q is absent — the catalogue was built from the device's default, not its schema", missing)
		}
	}
	seen := map[string]bool{}
	for _, e := range SNMPEventOptions {
		if seen[e] {
			t.Errorf("duplicate event %q", e)
		}
		seen[e] = true
	}
}

func TestSNMPEvents_RoundTripThroughTheDeviceString(t *testing.T) {
	const stored = "cpu-high mem-low ips-signature dhcp"
	got := snmpEventsToSlice(stored)
	want := []string{"cpu-high", "mem-low", "ips-signature", "dhcp"}
	if len(got) != len(want) {
		t.Fatalf("snmpEventsToSlice(%q) = %v, want %v", stored, got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("snmpEventsToSlice(%q) = %v, want %v", stored, got, want)
		}
	}
	if back := snmpEventsToString(got); back != stored {
		t.Errorf("round trip changed the string: %q → %q", stored, back)
	}
}

func TestSNMPEventsToSlice_DropsWhatThisBuildDoesNotKnow(t *testing.T) {
	// A newer FortiOS can return an event this build has no label for. Carrying it into the form
	// would draw a checkbox with a raw CMDB name on it.
	got := snmpEventsToSlice("cpu-high some-future-event mem-low")
	if len(got) != 2 || got[0] != "cpu-high" || got[1] != "mem-low" {
		t.Errorf("snmpEventsToSlice kept an unknown event: %v", got)
	}
}

func TestSNMPEventsToString_IsStableRegardlessOfFormOrder(t *testing.T) {
	// The device stores what it is given. If the order followed the operator's click order, every
	// save would rewrite the field and the Change Ledger would show a diff on an untouched
	// setting.
	a := snmpEventsToString([]string{"dhcp", "cpu-high", "mem-low"})
	b := snmpEventsToString([]string{"mem-low", "dhcp", "cpu-high"})
	if a != b {
		t.Errorf("order of the input changed the output: %q vs %q", a, b)
	}
	if a != "cpu-high mem-low dhcp" {
		t.Errorf("events are not in catalogue order: %q", a)
	}
}

func TestSNMPEventsToString_DeduplicatesAndRejectsUnknown(t *testing.T) {
	got := snmpEventsToString([]string{"cpu-high", "cpu-high", "not-an-event"})
	if got != "cpu-high" {
		t.Errorf("snmpEventsToString = %q, want %q", got, "cpu-high")
	}
}

func TestSNMPHostIP_SplitsTheMaskTheGUINeverShows(t *testing.T) {
	// FortiOS stores "<addr> <mask>" in a field the GUI draws as one box.
	cases := []struct{ stored, shown string }{
		{"10.0.0.5 255.255.255.255", "10.0.0.5"},             // the /32 the GUI's single box produces
		{"10.0.0.0 255.255.255.0", "10.0.0.0/255.255.255.0"}, // a real subnet is NOT narrowed away
		{"10.0.0.5", "10.0.0.5"},                             // a build that stores the bare address
		{"", ""},
	}
	for _, c := range cases {
		if got := hostIPToAddr(c.stored); got != c.shown {
			t.Errorf("hostIPToAddr(%q) = %q, want %q", c.stored, got, c.shown)
		}
	}
}

func TestSNMPHostIP_AlwaysSendsAMask(t *testing.T) {
	// A bare address is accepted by some builds and silently widened by others, so one is never
	// sent.
	cases := []struct{ typed, sent string }{
		{"10.0.0.5", "10.0.0.5 255.255.255.255"},
		{"10.0.0.0/255.255.255.0", "10.0.0.0 255.255.255.0"},
		{"10.0.0.0 255.255.255.0", "10.0.0.0 255.255.255.0"},
		{"  ", ""},
	}
	for _, c := range cases {
		if got := addrToHostIP(c.typed); got != c.sent {
			t.Errorf("addrToHostIP(%q) = %q, want %q", c.typed, got, c.sent)
		}
	}
	// And the pair composes: what the form shows goes back as what the device stores.
	if got := addrToHostIP(hostIPToAddr("10.0.0.0 255.255.255.0")); got != "10.0.0.0 255.255.255.0" {
		t.Errorf("round trip lost the subnet: %q", got)
	}
}

func TestSNMPStatusFieldsAreStringsNotBooleans(t *testing.T) {
	// Every status on these three tables is the word "enable"/"disable". Posting a JSON boolean
	// is accepted with a 200 and then ignored.
	if snmpFlag(true) != "enable" || snmpFlag(false) != "disable" {
		t.Fatal("snmpFlag does not produce the device's own words")
	}
	for _, on := range []string{"enable", "ENABLE", " enable "} {
		if !snmpOn(on) {
			t.Errorf("snmpOn(%q) = false", on)
		}
	}
	for _, off := range []string{"disable", "", "anything-else"} {
		if snmpOn(off) {
			t.Errorf("snmpOn(%q) = true", off)
		}
	}
}

func TestSNMPUserPayload_NeverWritesBackTheEncryptedPlaceholder(t *testing.T) {
	// A read returns "ENC XXXX" for both passwords. A nil pointer is how the edit form says "the
	// operator left it blank", and the key must then be absent — writing the placeholder back
	// would set the password to the literal four characters.
	w := FGSNMPUserWrite{
		FGSNMPUser: FGSNMPUser{Name: "zabbix", SecurityLevel: "auth-priv", AuthProto: "sha256", PrivProto: "aes256"},
	}
	body := snmpUserPayload(w)
	if _, ok := body["auth-pwd"]; ok {
		t.Error("auth-pwd was sent although the operator typed nothing")
	}
	if _, ok := body["priv-pwd"]; ok {
		t.Error("priv-pwd was sent although the operator typed nothing")
	}

	pwd := "s3cret-auth"
	priv := "s3cret-priv"
	w.AuthPwd, w.PrivPwd = &pwd, &priv
	body = snmpUserPayload(w)
	if body["auth-pwd"] != pwd || body["priv-pwd"] != priv {
		t.Error("a typed password did not reach the payload")
	}
}

func TestSNMPUserPayload_OmitsProtocolsTheLevelDoesNotHave(t *testing.T) {
	// FortiOS rejects priv-proto outright on an auth-no-priv user (-8), so a level change must not
	// carry the field the new level has no room for.
	pwd := "x"
	body := snmpUserPayload(FGSNMPUserWrite{
		FGSNMPUser: FGSNMPUser{Name: "u", SecurityLevel: "auth-no-priv", AuthProto: "sha", PrivProto: "aes"},
		AuthPwd:    &pwd, PrivPwd: &pwd,
	})
	if _, ok := body["priv-proto"]; ok {
		t.Error("priv-proto was sent on an auth-no-priv user")
	}
	if _, ok := body["priv-pwd"]; ok {
		t.Error("priv-pwd was sent on an auth-no-priv user")
	}
	if body["auth-proto"] != "sha" {
		t.Error("auth-proto was dropped on a level that uses it")
	}

	body = snmpUserPayload(FGSNMPUserWrite{FGSNMPUser: FGSNMPUser{Name: "u", AuthProto: "sha", PrivProto: "aes"}})
	if _, ok := body["auth-proto"]; ok {
		t.Error("auth-proto was sent on a no-auth-no-priv user")
	}
	if body["security-level"] != "no-auth-no-priv" {
		t.Errorf("an empty security level did not default: %v", body["security-level"])
	}
}

func TestSNMPCommunityPayload_AlwaysCarriesTheNestedHostsTable(t *testing.T) {
	// The nested table is REPLACED by what the PUT carries. Leaving the key out on an edit that
	// removed the last host would leave that host in force on the device.
	body := snmpCommunityPayload(FGSNMPCommunity{Name: "public"})
	hosts, ok := body["hosts"].([]map[string]any)
	if !ok {
		t.Fatalf("hosts is %T, want a slice — the key must always be present", body["hosts"])
	}
	if len(hosts) != 0 {
		t.Errorf("hosts = %v, want empty", hosts)
	}

	body = snmpCommunityPayload(FGSNMPCommunity{
		Name:  "public",
		Hosts: []FGSNMPHost{{IP: "10.0.0.5"}, {IP: "   "}, {ID: 7, IP: "10.0.0.6", HostType: "trap"}},
	})
	hosts = body["hosts"].([]map[string]any)
	if len(hosts) != 2 {
		t.Fatalf("a blank row was treated as a host: %v", hosts)
	}
	if hosts[0]["id"] != 1 || hosts[0]["ip"] != "10.0.0.5 255.255.255.255" || hosts[0]["host-type"] != "any" {
		t.Errorf("new host row = %v", hosts[0])
	}
	// An existing row keeps the device's own id, so the write updates it rather than deleting and
	// re-inserting it.
	if hosts[1]["id"] != 7 || hosts[1]["host-type"] != "trap" {
		t.Errorf("existing host row lost its id or type: %v", hosts[1])
	}
}

func TestSNMPCommunityPayload_FallsBackToTheProtocolPorts(t *testing.T) {
	// FortiOS accepts port 0 and then answers nothing on that socket, which looks exactly like a
	// firewall rule problem.
	body := snmpCommunityPayload(FGSNMPCommunity{Name: "public", Hosts: []FGSNMPHost{{IP: "10.0.0.5"}}})
	for key, want := range map[string]int{
		"query-v1-port": 161, "query-v2c-port": 161,
		"trap-v1-lport": 162, "trap-v1-rport": 162,
		"trap-v2c-lport": 162, "trap-v2c-rport": 162,
	} {
		if body[key] != want {
			t.Errorf("%s = %v, want %d", key, body[key], want)
		}
	}
}

func TestSNMPSysInfoRaw_ParsesTheDeviceShape(t *testing.T) {
	// The exact field names and the enable/disable strings, as the lab FortiOS returns them.
	const payload = `[{"status":"enable","description":"core fw","contact-info":"noc@example.com",
	  "location":"Rack 4","trap-high-cpu-threshold":85,"trap-low-memory-threshold":80,
	  "trap-log-full-threshold":90}]`
	var raw []fgSNMPSysInfoRaw
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	s := raw[0].toGUI()
	if !s.Status || s.ContactInfo != "noc@example.com" || s.Location != "Rack 4" || s.TrapHighCPUThreshold != 85 {
		t.Errorf("toGUI = %+v", s)
	}
}

func TestSNMPUserRaw_ReportsThatASecretExistsWithoutCarryingIt(t *testing.T) {
	const payload = `[{"name":"zabbix_snmp","status":"enable","security-level":"auth-priv",
	  "auth-proto":"sha256","auth-pwd":"ENC XXXX","priv-proto":"aes256","priv-pwd":"ENC XXXX",
	  "notify-hosts":"192.168.156.160","queries":"enable","query-port":161,
	  "trap-status":"enable","trap-lport":162,"trap-rport":162,"events":"cpu-high mem-low"}]`
	var raw []fgSNMPUserRaw
	if err := json.Unmarshal([]byte(payload), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	u := raw[0].toGUI()
	if !u.HasAuthPwd || !u.HasPrivPwd {
		t.Error("the device said a password is set and the form was told otherwise")
	}
	// The placeholder itself must not survive into anything the page can render or post back.
	blob, _ := json.Marshal(u)
	if strings.Contains(string(blob), "ENC") {
		t.Errorf("the encrypted placeholder leaked into the API shape: %s", blob)
	}
	if len(u.NotifyHosts) != 1 || u.NotifyHosts[0] != "192.168.156.160" {
		t.Errorf("notify hosts = %v", u.NotifyHosts)
	}

	// A user with no secrets reads back empty, and that is a different answer from "ENC XXXX".
	var none []fgSNMPUserRaw
	_ = json.Unmarshal([]byte(`[{"name":"ro","security-level":"no-auth-no-priv","auth-pwd":"","priv-pwd":""}]`), &none)
	if n := none[0].toGUI(); n.HasAuthPwd || n.HasPrivPwd {
		t.Error("an empty password field was read as a stored secret")
	}
}
