package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// The "New Virtual IP" mapping, pinned to what a live FortiGate 7.2.10 (FGT80E) accepted and read
// back. The traps that cost real probing time:
//   · type=fqdn uses extaddr[{name}]/mapped-addr and MUST NOT carry extip → "-8 Extip is invalid"
//   · when Services are set the device derives extport itself and stores 0 (the GUI hides the field)
//   · mappedip is a member table [{range}], not a scalar

func vip(over func(*FGVirtualIP)) FGVirtualIP {
	v := FGVirtualIP{
		Name: "Web_VIP", Type: "static-nat", Interface: "port1",
		ExtIP: "203.0.113.10", MappedIP: "192.168.1.10",
		PortForward: true, Protocol: "tcp", PortMappingType: "1-to-1",
		ExtPort: "8080", MappedPort: "80",
	}
	if over != nil {
		over(&v)
	}
	return v
}

// ─── payload: static NAT ─────────────────────────────────────────────────────

func TestVIPPayload_StaticNAT(t *testing.T) {
	p := vipPayload(vip(nil))
	if p["type"] != "static-nat" || p["extip"] != "203.0.113.10" || p["extintf"] != "port1" {
		t.Errorf("base fields = %v/%v/%v", p["type"], p["extip"], p["extintf"])
	}
	mip, ok := p["mappedip"].([]map[string]interface{})
	if !ok || len(mip) != 1 || mip[0]["range"] != "192.168.1.10" {
		t.Fatalf("mappedip = %#v, want a one-entry [{range}] table", p["mappedip"])
	}
	if p["portforward"] != "enable" || p["protocol"] != "tcp" || p["portmapping-type"] != "1-to-1" {
		t.Errorf("port-forward fields = %v/%v/%v", p["portforward"], p["protocol"], p["portmapping-type"])
	}
	if p["extport"] != "8080" || p["mappedport"] != "80" {
		t.Errorf("ports = %v/%v", p["extport"], p["mappedport"])
	}
	if _, ok := p["extaddr"]; ok {
		t.Error("extaddr must not be sent for a static-nat VIP")
	}
}

func TestVIPPayload_NoPortForward(t *testing.T) {
	p := vipPayload(vip(func(v *FGVirtualIP) { v.PortForward = false }))
	if p["portforward"] != "disable" {
		t.Errorf("portforward = %v, want disable", p["portforward"])
	}
	if _, ok := p["extport"]; ok {
		t.Error("extport must not be sent when port forwarding is off")
	}
}

// ⚠️ Services drive the port → the device stores extport=0, so we must NOT send our own.
func TestVIPPayload_ServicesSuppressExtPort(t *testing.T) {
	p := vipPayload(vip(func(v *FGVirtualIP) { v.Services = []string{"HTTP"} }))
	if _, ok := p["extport"]; ok {
		t.Errorf("extport was sent alongside a Service — the device would ignore it (stores 0): %v", p["extport"])
	}
	// The mapped side still needs its port.
	if p["mappedport"] != "80" {
		t.Errorf("mappedport = %v, want it kept", p["mappedport"])
	}
	svc, ok := p["service"].([]map[string]interface{})
	if !ok || len(svc) != 1 || svc[0]["name"] != "HTTP" {
		t.Errorf("service = %#v", p["service"])
	}
}

// icmp has no ports.
func TestVIPPayload_ICMPHasNoPorts(t *testing.T) {
	p := vipPayload(vip(func(v *FGVirtualIP) { v.Protocol = "icmp" }))
	if _, ok := p["extport"]; ok {
		t.Error("extport must not be sent for icmp")
	}
}

// ─── payload: FQDN ───────────────────────────────────────────────────────────

func TestVIPPayload_FQDN(t *testing.T) {
	p := vipPayload(vip(func(v *FGVirtualIP) {
		v.Type = "fqdn"
		v.ExtAddr = "wildcard.google.com"
		v.MappedAddr = "gmail.com"
		v.ExtIP = "203.0.113.10" // a stale value from a Static-NAT choice earlier
	}))
	if p["type"] != "fqdn" {
		t.Fatalf("type = %v", p["type"])
	}
	// The whole point: no extip / no mappedip on an fqdn VIP (that is the -8 trap).
	if _, ok := p["extip"]; ok {
		t.Errorf("extip was sent on an fqdn VIP — the device rejects that with -8: %v", p["extip"])
	}
	if _, ok := p["mappedip"]; ok {
		t.Error("mappedip must not be sent on an fqdn VIP")
	}
	ext, ok := p["extaddr"].([]map[string]interface{})
	if !ok || len(ext) != 1 || ext[0]["name"] != "wildcard.google.com" {
		t.Fatalf("extaddr = %#v", p["extaddr"])
	}
	if p["mapped-addr"] != "gmail.com" {
		t.Errorf("mapped-addr = %v", p["mapped-addr"])
	}
	// Port forwarding is a static-nat feature — never emitted for fqdn.
	if p["portforward"] != "disable" {
		t.Errorf("portforward = %v, want disable for fqdn", p["portforward"])
	}
}

func TestVIPPayload_OptionalFilters(t *testing.T) {
	p := vipPayload(vip(func(v *FGVirtualIP) {
		v.SourceFilter = []string{"10.0.0.0/8", " ", "192.168.0.0/16"}
	}))
	sf, ok := p["src-filter"].([]map[string]interface{})
	if !ok || len(sf) != 2 || sf[0]["range"] != "10.0.0.0/8" || sf[1]["range"] != "192.168.0.0/16" {
		t.Errorf("src-filter = %#v, want the 2 non-blank ranges", p["src-filter"])
	}
}

// ─── parse + round-trip ──────────────────────────────────────────────────────

func TestFgToVirtualIP(t *testing.T) {
	// The exact shape the device returned for the lab's Web_Server_VIP.
	raw := json.RawMessage(`{
		"name":"Web_Server_VIP","type":"static-nat","extintf":"port1",
		"extip":"203.150.100.10","mappedip":[{"range":"192.168.1.100"}],
		"portforward":"enable","protocol":"tcp","extport":"8080","mappedport":"80",
		"portmapping-type":"1-to-1","src-filter":[{"range":"10.0.0.0/8"}],
		"service":[{"name":"HTTP"}],"q_ref":1
	}`)
	v := fgToVirtualIP(raw)
	if v.Name != "Web_Server_VIP" || v.Type != "static-nat" || v.Interface != "port1" {
		t.Errorf("identity = %+v", v)
	}
	if v.ExtIP != "203.150.100.10" || v.MappedIP != "192.168.1.100" {
		t.Errorf("ips = %q/%q", v.ExtIP, v.MappedIP)
	}
	if !v.PortForward || v.ExtPort != "8080" || v.MappedPort != "80" {
		t.Errorf("port forward = %v/%q/%q", v.PortForward, v.ExtPort, v.MappedPort)
	}
	if len(v.SourceFilter) != 1 || v.SourceFilter[0] != "10.0.0.0/8" {
		t.Errorf("source filter = %#v", v.SourceFilter)
	}
	if len(v.Services) != 1 || v.Services[0] != "HTTP" {
		t.Errorf("services = %#v", v.Services)
	}
	if v.RefCount != 1 {
		t.Errorf("ref = %d", v.RefCount)
	}
}

func TestFgToVirtualIP_FQDN(t *testing.T) {
	raw := json.RawMessage(`{"name":"F","type":"fqdn","extintf":"any",
		"extaddr":[{"name":"wildcard.google.com"}],"mapped-addr":"gmail.com"}`)
	v := fgToVirtualIP(raw)
	if v.Type != "fqdn" || v.ExtAddr != "wildcard.google.com" || v.MappedAddr != "gmail.com" {
		t.Errorf("fqdn parse = %+v", v)
	}
	// Empty slices, never nil — the frontend binds them as arrays.
	if v.SourceFilter == nil || v.Services == nil {
		t.Error("list fields must be non-nil")
	}
}

func TestVIPRoundTrip(t *testing.T) {
	orig := vip(func(v *FGVirtualIP) {
		v.ExtIP = "203.0.113.10-203.0.113.20"
		v.MappedIP = "192.168.1.10"
		v.PortMappingType = "m-to-n"
		v.ExtPort = "8000-8010"
		v.MappedPort = "9000-9010"
		v.SourceFilter = []string{"10.0.0.0/8"}
	})
	b, _ := json.Marshal(vipPayload(orig))
	back := fgToVirtualIP(b)
	if back.ExtIP != orig.ExtIP || back.MappedIP != orig.MappedIP ||
		back.PortMappingType != orig.PortMappingType || back.ExtPort != orig.ExtPort ||
		back.MappedPort != orig.MappedPort {
		t.Errorf("drift:\n orig=%+v\n back=%+v", orig, back)
	}
}

// ─── validation ──────────────────────────────────────────────────────────────

func TestValidateVirtualIP(t *testing.T) {
	cases := []struct {
		name    string
		v       FGVirtualIP
		wantErr string
	}{
		{"valid static-nat", vip(nil), ""},
		{"no name", vip(func(v *FGVirtualIP) { v.Name = "" }), "name is required"},
		{"bad type", vip(func(v *FGVirtualIP) { v.Type = "load-balance" }), "invalid VIP type"},
		{"static needs extip", vip(func(v *FGVirtualIP) { v.ExtIP = "" }), "external IP address/range is required"},
		{"bad extip", vip(func(v *FGVirtualIP) { v.ExtIP = "nope" }), "not a valid IP or range"},
		{"extip range ok", vip(func(v *FGVirtualIP) { v.ExtIP = "203.0.113.10-203.0.113.20" }), ""},
		{"static needs mappedip", vip(func(v *FGVirtualIP) { v.MappedIP = "" }), "mapped IPv4 address/range is required"},
		{"fqdn needs extaddr", vip(func(v *FGVirtualIP) {
			v.Type = "fqdn"
			v.ExtIP = ""
			v.MappedIP = ""
			v.MappedAddr = "gmail.com"
		}), "external FQDN address is required"},
		{"fqdn needs mapped-addr", vip(func(v *FGVirtualIP) {
			v.Type = "fqdn"
			v.ExtIP = ""
			v.MappedIP = ""
			v.ExtAddr = "wildcard.google.com"
		}), "mapped FQDN address is required"},
		{"fqdn complete", vip(func(v *FGVirtualIP) {
			v.Type = "fqdn"
			v.ExtIP = ""
			v.MappedIP = ""
			v.ExtAddr = "wildcard.google.com"
			v.MappedAddr = "gmail.com"
		}), ""},
		{"port forward needs ports", vip(func(v *FGVirtualIP) { v.ExtPort = ""; v.MappedPort = "" }), "external service port is required"},
		{"services replace extport requirement", vip(func(v *FGVirtualIP) {
			v.ExtPort = ""
			v.Services = []string{"HTTP"}
		}), ""},
		{"bad protocol", vip(func(v *FGVirtualIP) { v.Protocol = "gopher" }), "invalid protocol"},
		{"bad port mapping type", vip(func(v *FGVirtualIP) { v.PortMappingType = "x" }), "invalid port mapping type"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			err := ValidateVirtualIP(c.v)
			if c.wantErr == "" {
				if err != nil {
					t.Fatalf("want no error, got %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.wantErr) {
				t.Fatalf("error = %v, want it to mention %q", err, c.wantErr)
			}
		})
	}
}

func TestIsIPOrRange(t *testing.T) {
	for _, ok := range []string{"203.0.113.10", "10.0.0.1-10.0.0.9", " 192.168.1.1 "} {
		if !isIPOrRange(ok) {
			t.Errorf("isIPOrRange(%q) = false", ok)
		}
	}
	for _, bad := range []string{"", "nope", "203.0.113.10/24", "10.0.0.1-", "1.2.3.4-5.6.7.8-9.9.9.9"} {
		if isIPOrRange(bad) {
			t.Errorf("isIPOrRange(%q) = true", bad)
		}
	}
}
