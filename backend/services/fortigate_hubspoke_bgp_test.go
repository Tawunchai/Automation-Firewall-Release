package services

import (
	"net"
	"strings"
	"testing"
)

// The BGP reconcile (ConfigureHubSpokeBGP) replaced an add-only loop that used to POST every peer
// and swallow the -5 duplicate. On an edit that meant "peer already exists" → skip → remote-as
// never moved, so changing the Local AS left the process on 65402 while its neighbors still said
// 65401 and the session could never come up.
//
// The reconcile itself is device I/O, so what is unit-testable here is the two things that decide
// whether it is CORRECT and SAFE: the payload it writes, and the overlay scoping that stops it from
// deleting a peer belonging to a different tunnel sharing the same BGP process.

func hs(over func(*FGHubSpokeWrite)) FGHubSpokeWrite {
	w := FGHubSpokeWrite{
		Name: "HUB", Role: "hub", Interface: "port1",
		TunnelIP: "10.210.1.1", RemoteIP: "10.210.1.2/24",
		LocalAS: "65400", LocalInterface: "lan",
		LocalSubnets: []string{"192.168.1.0/24"},
		SpokeType:    "individual", SpokeTunnelIPs: []string{"10.210.1.2", "10.210.1.3"},
	}
	if over != nil {
		over(&w)
	}
	return w
}

// ─── payload ─────────────────────────────────────────────────────────────────

// remote-as must track the form's Local AS — this is the value the old code never updated.
func TestBGPNeighborPayload_CarriesLocalAS(t *testing.T) {
	p := bgpNeighborPayload("10.210.1.2", "65402")

	if p["ip"] != "10.210.1.2" {
		t.Errorf("ip = %#v", p["ip"])
	}
	if p["remote-as"] != "65402" {
		t.Errorf("remote-as = %#v, want the edited AS", p["remote-as"])
	}
	if p["vdom"] != "root" {
		t.Errorf("vdom = %#v", p["vdom"])
	}
}

func TestBGPNeighborGroupPayload_CarriesLocalAS(t *testing.T) {
	p := bgpNeighborGroupPayload("HUB", "HUB", "65402")
	if p["remote-as"] != "65402" || p["interface"] != "HUB" || p["name"] != "HUB" {
		t.Errorf("payload = %#v", p)
	}
}

// ─── overlay scoping (the blast radius of the delete pass) ───────────────────

// deleteOverlayNeighbors only touches peers inside the tunnel's own overlay. Everything else on the
// box — another tunnel's peers, an unrelated eBGP session — must be out of scope.
func TestOverlayScope_OnlyCoversThisTunnelsPeers(t *testing.T) {
	overlay := parseOverlayCIDR(hs(nil).RemoteIP)
	if overlay == nil {
		t.Fatal("overlay did not parse")
	}

	for _, tc := range []struct {
		ip     string
		inside bool
		why    string
	}{
		{"10.210.1.2", true, "this tunnel's spoke"},
		{"10.210.1.3", true, "this tunnel's other spoke"},
		{"10.210.1.254", true, "same overlay /24"},
		{"10.211.1.2", false, "a DIFFERENT tunnel's overlay"},
		{"192.168.1.10", false, "a LAN peer"},
		{"203.0.113.5", false, "an external eBGP peer"},
	} {
		got := overlay.Contains(net.ParseIP(tc.ip))
		if got != tc.inside {
			t.Errorf("%s (%s): in-overlay = %v, want %v", tc.ip, tc.why, got, tc.inside)
		}
	}
}

// The spoke form gives the hub's IP as "host/mask"; both the peer address and the overlay come out
// of that one field, so pin the split.
func TestSpokeOverlay_DerivesPeerAndScope(t *testing.T) {
	w := hs(func(w *FGHubSpokeWrite) {
		w.Role, w.TunnelIP, w.RemoteIP = "spoke", "10.211.1.2", "10.211.1.1/24"
		w.SpokeType, w.SpokeTunnelIPs = "", nil
	})

	if peer := w.RemoteIPHost(); peer != "10.211.1.1" {
		t.Errorf("peer = %q, want the hub tunnel IP without the mask", peer)
	}
	overlay := parseOverlayCIDR(w.RemoteIP)
	if overlay == nil || !overlay.Contains(net.ParseIP("10.211.1.1")) {
		t.Errorf("overlay %v must contain the hub peer", overlay)
	}
	if overlay.Contains(net.ParseIP("10.210.1.1")) {
		t.Errorf("overlay %v must not reach into another tunnel's range", overlay)
	}
}

// A malformed / missing Remote IP yields no overlay, and deleteOverlayNeighbors must then delete
// NOTHING rather than fall back to an unscoped sweep.
func TestOverlayScope_AbsentWhenRemoteIPUnusable(t *testing.T) {
	for _, v := range []string{"", "   ", "not-an-ip", "10.210.1.2"} {
		if got := parseOverlayCIDR(v); got != nil && v != "10.210.1.2" {
			t.Errorf("parseOverlayCIDR(%q) = %v, want nil", v, got)
		}
	}
	// A bare host with no mask is not a subnet either.
	if got := parseOverlayCIDR("10.210.1.2"); got != nil {
		t.Errorf("parseOverlayCIDR(bare host) = %v, want nil", got)
	}
}

// ─── which shape the role asks for ───────────────────────────────────────────

func TestHubSpokeRole_SelectsNeighborShape(t *testing.T) {
	rangeMode := func(w FGHubSpokeWrite) bool {
		return w.isHub() && strings.EqualFold(strings.TrimSpace(w.SpokeType), "range")
	}

	if rangeMode(hs(nil)) {
		t.Error("individual hub must not take the neighbor-group path")
	}
	if !rangeMode(hs(func(w *FGHubSpokeWrite) { w.SpokeType = "Range" })) {
		t.Error("range hub must take the neighbor-group path (case-insensitively)")
	}
	if rangeMode(hs(func(w *FGHubSpokeWrite) { w.Role, w.SpokeType = "spoke", "range" })) {
		t.Error("a spoke always peers with one hub — never the neighbor-group path")
	}
}
