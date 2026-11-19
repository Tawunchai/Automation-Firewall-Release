package services

import (
	"encoding/json"
	"testing"
)

// What the DHCP mapping has to get right, and what goes wrong on the device when it does not.

func TestDHCPRead_0000MeansUnset(t *testing.T) {
	// The device returns 0.0.0.0 for every address field nobody set. Rendering it literally would
	// put a Default Gateway of 0.0.0.0 on the screen — an answer that looks real and is not.
	raw := fgDHCPServerRaw{
		Status:         "enable",
		Interface:      "lan",
		Netmask:        "255.255.255.0",
		DefaultGateway: "0.0.0.0",
		DNSServer1:     "0.0.0.0",
		DNSServer2:     "8.8.8.8",
		DNSServer3:     "0.0.0.0",
		DNSServer4:     "1.1.1.1",
	}
	got := raw.toGUI()
	if got.DefaultGateway != "" {
		t.Errorf("default gateway 0.0.0.0 should read as unset, got %q", got.DefaultGateway)
	}
	if got.Netmask != "255.255.255.0" {
		t.Errorf("a real netmask must survive, got %q", got.Netmask)
	}
	// The gaps close up: slots 1 and 3 are unset, so the list is the two real servers in order.
	if len(got.DNSServers) != 2 || got.DNSServers[0] != "8.8.8.8" || got.DNSServers[1] != "1.1.1.1" {
		t.Errorf("DNS servers should compact to the set ones in order, got %v", got.DNSServers)
	}
}

func TestDHCPWrite_RemovingADNSServerClearsItsSlot(t *testing.T) {
	// The bug this pins: send only the servers you still want and leave the rest out, and
	// dns-server2 keeps the address that was removed — the edit reports success and the client
	// still gets the old resolver.
	body := dhcpServerPayload(FGDHCPServer{
		Interface:  "lan",
		Netmask:    "255.255.255.0",
		DNSService: "specify",
		DNSServers: []string{"9.9.9.9"},
	})
	if body["dns-server1"] != "9.9.9.9" {
		t.Errorf("dns-server1 = %v, want 9.9.9.9", body["dns-server1"])
	}
	for _, k := range []string{"dns-server2", "dns-server3", "dns-server4"} {
		if body[k] != "0.0.0.0" {
			t.Errorf("%s = %v, want 0.0.0.0 — an unfilled slot must be CLEARED, not left alone", k, body[k])
		}
	}
}

func TestDHCPWrite_LeavingSpecifyModeClearsTheAddresses(t *testing.T) {
	// A server on `default` is not using dns-server1..4. Leaving addresses behind there stores
	// settings nothing reads, which is what makes a later edit look like it did nothing.
	body := dhcpServerPayload(FGDHCPServer{
		Interface:  "lan",
		Netmask:    "255.255.255.0",
		DNSService: "default",
		DNSServers: []string{"9.9.9.9", "8.8.8.8"},
	})
	if body["dns-service"] != "default" {
		t.Fatalf("dns-service = %v", body["dns-service"])
	}
	for _, k := range []string{"dns-server1", "dns-server2", "dns-server3", "dns-server4"} {
		if body[k] != "0.0.0.0" {
			t.Errorf("%s = %v, want 0.0.0.0 outside specify mode", k, body[k])
		}
	}
}

func TestDHCPWrite_EmptyGatewayIsSentAsAClear(t *testing.T) {
	// Omitting the key keeps whatever the device already had, so an operator who empties the box
	// would see the old gateway again after saving.
	body := dhcpServerPayload(FGDHCPServer{Interface: "lan", Netmask: "255.255.255.0"})
	if body["default-gateway"] != "0.0.0.0" {
		t.Errorf("default-gateway = %v, want 0.0.0.0 so the field is cleared", body["default-gateway"])
	}
}

func TestDHCPWrite_RangeIDsSurviveAnEdit(t *testing.T) {
	// The device keys range rows by id. Dropping the id on an untouched row renumbers the table,
	// which shows up as every range having "changed" in the Change Ledger.
	body := dhcpServerPayload(FGDHCPServer{
		Interface: "lan",
		Netmask:   "255.255.255.0",
		IPRanges:  []FGDHCPRange{{ID: 4, StartIP: "10.0.0.10", EndIP: "10.0.0.20"}},
	})
	rows, _ := body["ip-range"].([]map[string]any)
	if len(rows) != 1 || rows[0]["id"] != 4 {
		t.Errorf("ip-range = %v, want the id carried through", body["ip-range"])
	}
}

func TestDHCPWrite_IncompleteRangesAreDropped(t *testing.T) {
	// A half-filled row in the form is not a range. Sending it makes FortiOS reject the whole
	// server, so the one bad row would take the good ones with it.
	body := dhcpServerPayload(FGDHCPServer{
		Interface: "lan",
		Netmask:   "255.255.255.0",
		IPRanges: []FGDHCPRange{
			{StartIP: "10.0.0.10", EndIP: "10.0.0.20"},
			{StartIP: "10.0.0.30"}, // no end
		},
	})
	rows, _ := body["ip-range"].([]map[string]any)
	if len(rows) != 1 {
		t.Errorf("want only the complete range, got %d rows", len(rows))
	}
}

func TestDHCPWrite_ABlockedMACHasNoReservedAddress(t *testing.T) {
	// action=block is the MAC deny list, not a reservation — the table stores 0.0.0.0 for it.
	body := dhcpServerPayload(FGDHCPServer{
		Interface: "lan",
		Netmask:   "255.255.255.0",
		Reservations: []FGDHCPReservation{
			{MAC: "00:11:22:33:44:55", IP: "10.0.0.9", Action: "block"},
			{MAC: "AA:BB:CC:DD:EE:FF", IP: "10.0.0.8", Action: "reserved"},
		},
	})
	rows, _ := body["reserved-address"].([]map[string]any)
	if len(rows) != 2 {
		t.Fatalf("want 2 reservations, got %d", len(rows))
	}
	if rows[0]["ip"] != "0.0.0.0" {
		t.Errorf("a blocked MAC should carry no address, got %v", rows[0]["ip"])
	}
	// FortiOS stores MACs lower-case; sending upper-case creates a row that never matches.
	if rows[1]["mac"] != "aa:bb:cc:dd:ee:ff" {
		t.Errorf("MAC should be normalised to lower case, got %v", rows[1]["mac"])
	}
}

func TestDHCPWrite_EmptyTablesSerialiseAsLists(t *testing.T) {
	// nil would marshal to `null`, which FortiOS does not read as "empty this table" — the rows
	// stay. This is how an operator deletes the last exclude range.
	body := dhcpServerPayload(FGDHCPServer{Interface: "lan", Netmask: "255.255.255.0"})
	b, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(b, &m); err != nil {
		t.Fatal(err)
	}
	for _, k := range []string{"ip-range", "exclude-range", "reserved-address"} {
		if string(m[k]) != "[]" {
			t.Errorf("%s serialised as %s, want []", k, m[k])
		}
	}
}
