package services

import "testing"

// A valid Hub (Individual spoke type) request — the base other tests mutate.
func hubIndividual() FGHubSpokeWrite {
	return FGHubSpokeWrite{
		Name:           "HubTest",
		Role:           "hub",
		Interface:      "port1",
		AuthMethod:     "psk",
		PSK:            "P@ssw0rd",
		TunnelIP:       "10.10.1.1",
		RemoteIP:       "10.10.1.2/24",
		LocalAS:        "65400",
		LocalInterface: "lan",
		LocalSubnets:   []string{"10.0.96.0/22"},
		SpokeType:      "individual",
		SpokeTunnelIPs: []string{"10.10.1.3"},
	}
}

func hubRange() FGHubSpokeWrite {
	w := hubIndividual()
	w.SpokeType = "range"
	w.SpokeTunnelIPs = nil
	w.SpokeRangePrefix = "10.10.1.0/24"
	return w
}

func spoke() FGHubSpokeWrite {
	return FGHubSpokeWrite{
		Name:           "SpokeTest",
		Role:           "spoke",
		Interface:      "port1",
		AuthMethod:     "psk",
		PSK:            "P@ssw0rd",
		TunnelIP:       "10.10.1.3",
		RemoteIP:       "10.10.1.1/24",
		LocalAS:        "65400",
		LocalInterface: "lan",
		LocalSubnets:   []string{"192.168.50.0/24"},
		RemoteGW:       "203.0.113.10",
	}
}

func TestHubSpokeObjectNamesFor(t *testing.T) {
	n := HubSpokeObjectNamesFor("HubTest")
	cases := map[string]string{
		n.Phase1:            "HubTest",
		n.Phase2:            "HubTest",
		n.TunnelInterface:   "HubTest",
		n.LocalAddress:      "HubTest_local",
		n.PolicySpoke2Hub:   "vpn_HubTest_spoke2hub",
		n.PolicySpoke2Spoke: "vpn_HubTest_spoke2spoke",
		n.NeighborGroup:     "HubTest",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("object name = %q, want %q", got, want)
		}
	}
}

func TestHubSpokePhase1_Hub(t *testing.T) {
	p := hubSpokePhase1Payload(hubIndividual())
	want := map[string]interface{}{
		"type":                  "dynamic",
		"interface":             "port1",
		"ike-version":           "2",
		"add-route":             "disable",
		"auto-discovery-sender": "enable",
		"net-device":            "disable",
		"dpd":                   "on-idle",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("hub phase1[%q] = %v, want %v", k, p[k], v)
		}
	}
	if p["psksecret"] != "P@ssw0rd" {
		t.Errorf("hub phase1 psksecret = %v, want P@ssw0rd", p["psksecret"])
	}
	if _, ok := p["auto-discovery-receiver"]; ok {
		t.Error("hub phase1 must not set auto-discovery-receiver")
	}
	if _, ok := p["remote-gw"]; ok {
		t.Error("hub phase1 (dialup) must not carry a remote-gw")
	}
}

func TestHubSpokePhase1_Spoke(t *testing.T) {
	p := hubSpokePhase1Payload(spoke())
	want := map[string]interface{}{
		"type":                    "static",
		"remote-gw":               "203.0.113.10",
		"add-route":               "disable",
		"auto-discovery-receiver": "enable",
		"net-device":              "enable",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("spoke phase1[%q] = %v, want %v", k, p[k], v)
		}
	}
	if _, ok := p["auto-discovery-sender"]; ok {
		t.Error("spoke phase1 must not set auto-discovery-sender")
	}
}

func TestHubSpokePhase2(t *testing.T) {
	hub := hubSpokePhase2Payload(hubIndividual())
	if hub["phase1name"] != "HubTest" || hub["name"] != "HubTest" {
		t.Errorf("hub phase2 name/phase1name wrong: %v", hub)
	}
	if _, ok := hub["auto-negotiate"]; ok {
		t.Error("hub phase2 must not auto-negotiate")
	}
	sp := hubSpokePhase2Payload(spoke())
	if sp["auto-negotiate"] != "enable" {
		t.Errorf("spoke phase2 auto-negotiate = %v, want enable", sp["auto-negotiate"])
	}
}

func TestHubSpokeTunnelIPPayload(t *testing.T) {
	p := hubSpokeTunnelIPPayload(hubIndividual())
	if p["ip"] != "10.10.1.1 255.255.255.255" {
		t.Errorf("ip = %v, want 10.10.1.1 255.255.255.255", p["ip"])
	}
	if p["remote-ip"] != "10.10.1.2 255.255.255.0" {
		t.Errorf("remote-ip = %v, want 10.10.1.2 255.255.255.0", p["remote-ip"])
	}
	if p["allowaccess"] != "ping" {
		t.Errorf("allowaccess = %v, want ping", p["allowaccess"])
	}
}

func TestBGPPayloads(t *testing.T) {
	nb := bgpNeighborPayload("10.10.1.3", "65400")
	if nb["ip"] != "10.10.1.3" || nb["remote-as"] != "65400" {
		t.Errorf("neighbor payload wrong: %v", nb)
	}
	ng := bgpNeighborGroupPayload("HubTest", "HubTest", "65400")
	if ng["name"] != "HubTest" || ng["interface"] != "HubTest" || ng["remote-as"] != "65400" {
		t.Errorf("neighbor-group payload wrong: %v", ng)
	}
	nr := bgpNeighborRangePayload(1, "10.10.1.0/24", "HubTest")
	if nr["id"] != 1 || nr["prefix"] != "10.10.1.0 255.255.255.0" || nr["neighbor-group"] != "HubTest" {
		t.Errorf("neighbor-range payload wrong: %v", nr)
	}
	net := bgpNetworkPayload(2, "10.0.96.0/22")
	if net["id"] != 2 || net["prefix"] != "10.0.96.0 255.255.252.0" {
		t.Errorf("network payload wrong: %v", net)
	}
}

func TestRemoteIPHost(t *testing.T) {
	if got := (FGHubSpokeWrite{RemoteIP: "10.10.1.1/24"}).RemoteIPHost(); got != "10.10.1.1" {
		t.Errorf("RemoteIPHost = %q, want 10.10.1.1", got)
	}
	if got := (FGHubSpokeWrite{RemoteIP: "10.10.1.1"}).RemoteIPHost(); got != "10.10.1.1" {
		t.Errorf("RemoteIPHost (bare) = %q, want 10.10.1.1", got)
	}
}

func TestValidateHubSpoke_Valid(t *testing.T) {
	for name, w := range map[string]FGHubSpokeWrite{
		"hub-individual": hubIndividual(),
		"hub-range":      hubRange(),
		"spoke":          spoke(),
	} {
		if err := ValidateHubSpoke(w); err != nil {
			t.Errorf("%s should be valid, got: %v", name, err)
		}
	}
}

func TestValidateHubSpoke_Rejects(t *testing.T) {
	cases := map[string]func(*FGHubSpokeWrite){
		"empty name":           func(w *FGHubSpokeWrite) { w.Name = "" },
		"no interface":         func(w *FGHubSpokeWrite) { w.Interface = "" },
		"no PSK on create":     func(w *FGHubSpokeWrite) { w.PSK = "" },
		"bad tunnel IP":        func(w *FGHubSpokeWrite) { w.TunnelIP = "nope" },
		"bad remote IP":        func(w *FGHubSpokeWrite) { w.RemoteIP = "10.10.1.2" + "/x" },
		"bad AS":               func(w *FGHubSpokeWrite) { w.LocalAS = "0" },
		"no local subnet":      func(w *FGHubSpokeWrite) { w.LocalSubnets = nil },
		"bad local subnet":     func(w *FGHubSpokeWrite) { w.LocalSubnets = []string{"10.0.0.0"} },
		"individual no spokes": func(w *FGHubSpokeWrite) { w.SpokeTunnelIPs = nil },
		"individual bad spoke": func(w *FGHubSpokeWrite) { w.SpokeTunnelIPs = []string{"999.1.1.1"} },
		"bad spoke type":       func(w *FGHubSpokeWrite) { w.SpokeType = "mesh" },
	}
	for name, mut := range cases {
		w := hubIndividual()
		mut(&w)
		if err := ValidateHubSpoke(w); err == nil {
			t.Errorf("%s should be rejected, got nil", name)
		}
	}
}

func TestValidateHubSpoke_RangeRejects(t *testing.T) {
	w := hubRange()
	w.SpokeRangePrefix = "10.10.1.0" // not a CIDR
	if err := ValidateHubSpoke(w); err == nil {
		t.Error("range with a non-CIDR prefix should be rejected")
	}
}

func TestValidateHubSpoke_SpokeRejects(t *testing.T) {
	w := spoke()
	w.RemoteGW = ""
	if err := ValidateHubSpoke(w); err == nil {
		t.Error("spoke without a hub gateway should be rejected")
	}
}

func TestValidateHubSpoke_BlankPSKOnEditIsOK(t *testing.T) {
	w := hubIndividual()
	w.PSK = ""
	w.Editing = true
	if err := ValidateHubSpoke(w); err != nil {
		t.Errorf("blank PSK on edit should be allowed, got: %v", err)
	}
}
