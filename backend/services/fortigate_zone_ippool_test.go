package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── Zones ────────────────────────────────────────────────────────────────────

// The trap this test exists for. system/zone's member table is keyed `interface-name`, not `name`
// like every other member table in this codebase, because that is its declared mkey. A payload
// built with the usual {"name": …} shape is accepted with a 200 and stores an EMPTY zone — so the
// zone appears in the list, a policy can reference it, and it matches nothing.
func TestZonePayload_MemberKeyIsInterfaceName(t *testing.T) {
	p := zonePayload(FGZone{Name: "inside", Interfaces: []string{"internal1", "internal2"}})

	raw, err := json.Marshal(p["interface"])
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	const want = `[{"interface-name":"internal1"},{"interface-name":"internal2"}]`
	if string(raw) != want {
		t.Errorf("interface = %s\nwant      %s", raw, want)
	}
}

// intrazone deny is FortiOS's default and the safe half: traffic between two ports in the same
// zone still needs a policy. Anything this code is unsure about becomes deny, never allow.
func TestZonePayload_IntrazoneDefaultsToDeny(t *testing.T) {
	for _, in := range []string{"", "deny", "nonsense", "DENY"} {
		if got := zonePayload(FGZone{Name: "z", Intrazone: in})["intrazone"]; got != "deny" {
			t.Errorf("intrazone %q → %v, want deny", in, got)
		}
	}
	if got := zonePayload(FGZone{Name: "z", Intrazone: "allow"})["intrazone"]; got != "allow" {
		t.Errorf("explicit allow → %v", got)
	}
}

func TestGetZones_FlattensTheMemberTable(t *testing.T) {
	const body = `{"results":[{"name":"inside","interface":[{"interface-name":"internal1"},
		{"interface-name":"internal2"}],"intrazone":"deny","description":"LAN side"}],"status":"success"}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	zones, err := newTestClient(srv.URL, srv.Client()).GetZones()
	if err != nil {
		t.Fatalf("GetZones: %v", err)
	}
	if len(zones) != 1 || len(zones[0].Interfaces) != 2 || zones[0].Interfaces[1] != "internal2" {
		t.Fatalf("zones = %#v", zones)
	}
}

// ── IP pools ─────────────────────────────────────────────────────────────────

// The comment field on firewall/ippool is `comments`, plural — unlike firewall/address and
// firewall/addrgrp next door. The singular is accepted and silently dropped.
func TestIPPoolPayload_UsesCommentsPlural(t *testing.T) {
	p := ipPoolPayload(FGIPPool{Name: "p", Comments: "branch NAT"})
	if p["comments"] != "branch NAT" {
		t.Errorf("comments = %v", p["comments"])
	}
	if _, ok := p["comment"]; ok {
		t.Error("payload carries the singular `comment`, which firewall/ippool has no field for")
	}
}

func TestIPPoolPayload_DefaultsToOverload(t *testing.T) {
	if got := ipPoolPayload(FGIPPool{Name: "p"})["type"]; got != "overload" {
		t.Errorf("type = %v", got)
	}
}

// Switching type does not clear the previous type's fields on the device, so the payload always
// states them — a source range left behind on an `overload` pool would otherwise still be there.
func TestIPPoolPayload_ZeroesTheOtherTypesFields(t *testing.T) {
	p := ipPoolPayload(FGIPPool{
		Name: "p", Type: "overload", StartIP: "203.0.113.10", EndIP: "203.0.113.20",
		SourceStartIP: "10.0.0.1", SourceEndIP: "10.0.0.99",
	})
	if p["source-startip"] != "0.0.0.0" || p["source-endip"] != "0.0.0.0" {
		t.Errorf("an overload pool kept a source range: %v-%v", p["source-startip"], p["source-endip"])
	}

	fixed := ipPoolPayload(FGIPPool{
		Name: "p", Type: "fixed-port-range", StartIP: "203.0.113.10", EndIP: "203.0.113.20",
		SourceStartIP: "10.0.0.1", SourceEndIP: "10.0.0.11",
	})
	if fixed["source-startip"] != "10.0.0.1" {
		t.Errorf("fixed-port-range lost its source range: %v", fixed["source-startip"])
	}
}

// arp-intf only travels with arp-reply on: FortiOS refuses an interface name it cannot pair with
// an enabled ARP reply, and the refusal is a bare code.
func TestIPPoolPayload_ARPInterfaceNeedsARPReply(t *testing.T) {
	off := ipPoolPayload(FGIPPool{Name: "p", ARPReply: false, ARPInterface: "wan1"})
	if _, ok := off["arp-intf"]; ok {
		t.Error("arp-intf was sent with arp-reply off")
	}
	if off["arp-reply"] != "disable" {
		t.Errorf("arp-reply = %v", off["arp-reply"])
	}
	on := ipPoolPayload(FGIPPool{Name: "p", ARPReply: true, ARPInterface: "wan1"})
	if on["arp-intf"] != "wan1" {
		t.Errorf("arp-intf = %v", on["arp-intf"])
	}
}

// A read must not surface another type's leftovers as if the operator had set them.
func TestIPPoolToGUI_HidesFieldsTheTypeDoesNotOwn(t *testing.T) {
	raw := fgIPPoolRaw{
		Name: "p", Type: "overload", StartIP: "203.0.113.10", EndIP: "203.0.113.20",
		SourceStartIP: "10.0.0.1", SourceEndIP: "10.0.0.99", BlockSize: 128, NumBlocksPerUser: 8,
		ARPReply: "enable",
	}
	g := raw.toGUI()
	if g.SourceStartIP != "" || g.BlockSize != 0 || g.NumBlocksPerUser != 0 {
		t.Errorf("overload pool surfaced other types' fields: %+v", g)
	}
	if !g.ARPReply {
		t.Error("arp-reply enable decoded as false")
	}

	pba := fgIPPoolRaw{Name: "p", Type: "port-block-allocation", BlockSize: 128, NumBlocksPerUser: 8}.toGUI()
	if pba.BlockSize != 128 || pba.NumBlocksPerUser != 8 {
		t.Errorf("port-block-allocation lost its own fields: %+v", pba)
	}
}
