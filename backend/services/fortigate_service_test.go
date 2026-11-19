package services

import (
	"encoding/json"
	"testing"
)

// The firewall.service/custom UPDATE payload, pinned to what a live FortiGate 7.2.10 (FGT80E)
// actually honours. The two traps this covers, both found by probing the real device:
//
//   - An empty string does NOT clear a field. PUT {"udp-portrange":""} answers 200 with
//     revision_changed:false and keeps the old ports — so an `omitempty` string field can never
//     erase anything. Only JSON null clears (revision_changed:true).
//   - The port-range keys are not inert on other protocols. On a protocol=IP service, sending
//     tcp/udp/sctp-portrange:null ALSO resets protocol-number to 0. So the key set has to be
//     scoped to the service's protocol, not just the values.

func svc(over func(*FGService)) FGService {
	s := FGService{
		Name: "Web", Protocol: "TCP/UDP/SCTP",
		TCPPortRange: "8080", UDPPortRange: "5353",
		Comment: "hi", Color: 12,
	}
	if over != nil {
		over(&s)
	}
	return s
}

// hasNull reports whether key is present AND marshals to JSON null — the distinction that matters,
// since a missing key and a null key behave completely differently on the device.
func hasNull(t *testing.T, p map[string]interface{}, key string) bool {
	t.Helper()
	v, present := p[key]
	if !present {
		t.Errorf("key %q is absent from the payload; it must be present as null to clear", key)
		return false
	}
	return v == nil
}

// ─── clearing ────────────────────────────────────────────────────────────────

func TestServiceUpdate_ClearedPortRangeBecomesNull(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) { s.UDPPortRange = "" }))

	if !hasNull(t, p, "udp-portrange") {
		t.Errorf("udp-portrange = %#v, want nil (JSON null) so the device erases it", p["udp-portrange"])
	}
	if p["tcp-portrange"] != "8080" {
		t.Errorf("tcp-portrange = %#v, want it left alone", p["tcp-portrange"])
	}
}

func TestServiceUpdate_ClearedFieldsAllBecomeNull(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) {
		s.TCPPortRange, s.UDPPortRange, s.SCTPPortRange = "", "", ""
		s.Comment, s.FQDN, s.IPRange = "", "", ""
	}))

	for _, k := range []string{
		"tcp-portrange", "udp-portrange", "sctp-portrange", "comment", "fqdn", "iprange", "category",
	} {
		if !hasNull(t, p, k) {
			t.Errorf("%s = %#v, want nil (JSON null)", k, p[k])
		}
	}
}

// Whitespace-only input is a cleared field, not a value.
func TestServiceUpdate_BlankIsTreatedAsCleared(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) { s.UDPPortRange = "   " }))
	if !hasNull(t, p, "udp-portrange") {
		t.Errorf("udp-portrange = %#v, want nil", p["udp-portrange"])
	}
}

// Colour 0 is "no colour" — a real value the user can pick, so it must survive as 0 rather than
// being dropped the way an omitempty int would be.
func TestServiceUpdate_ColorZeroIsSent(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) { s.Color = 0 }))
	if v, present := p["color"]; !present || v != 0 {
		t.Errorf("color = %#v (present=%v), want 0 to be sent explicitly", v, present)
	}
}

// "Uncategorized" reaches the client as an empty Category slice; that must clear the field.
func TestServiceUpdate_EmptyCategoryClears(t *testing.T) {
	p := toServiceUpdate(svc(nil))
	if !hasNull(t, p, "category") {
		t.Errorf("category = %#v, want nil", p["category"])
	}

	withCat := toServiceUpdate(svc(func(s *FGService) { s.Category = []FGName{{Name: "General"}} }))
	if withCat["category"] != "General" {
		t.Errorf("category = %#v, want %q", withCat["category"], "General")
	}
}

// ─── protocol scoping (the protocol-number clobber) ──────────────────────────

func TestServiceUpdate_IPProtocolOmitsPortRanges(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) {
		s.Protocol, s.ProtocolNum = "IP", 47
		s.TCPPortRange, s.UDPPortRange = "", ""
	}))

	// Presence alone is the bug: null here resets protocol-number to 0 on the device.
	for _, k := range []string{"tcp-portrange", "udp-portrange", "sctp-portrange", "fqdn", "iprange"} {
		if _, present := p[k]; present {
			t.Errorf("%s must not appear on a protocol=IP service (it resets protocol-number)", k)
		}
	}
	if p["protocol-number"] != 47 {
		t.Errorf("protocol-number = %#v, want 47", p["protocol-number"])
	}
}

func TestServiceUpdate_ICMPOmitsPortRanges(t *testing.T) {
	typ, code := 8, 0
	for _, proto := range []string{"ICMP", "ICMP6"} {
		p := toServiceUpdate(svc(func(s *FGService) {
			s.Protocol, s.ICMPType, s.ICMPCode = proto, &typ, &code
			s.TCPPortRange, s.UDPPortRange = "", ""
		}))

		for _, k := range []string{"tcp-portrange", "udp-portrange", "sctp-portrange"} {
			if _, present := p[k]; present {
				t.Errorf("%s: %s must not appear on an ICMP service", proto, k)
			}
		}
		if p["icmptype"] != 8 || p["icmpcode"] != 0 {
			t.Errorf("%s: icmptype/icmpcode = %#v/%#v, want 8/0", proto, p["icmptype"], p["icmpcode"])
		}
	}
}

func TestServiceUpdate_ICMPUnsetNumbersBecomeNull(t *testing.T) {
	p := toServiceUpdate(svc(func(s *FGService) { s.Protocol = "ICMP" }))
	for _, k := range []string{"icmptype", "icmpcode"} {
		if !hasNull(t, p, k) {
			t.Errorf("%s = %#v, want nil", k, p[k])
		}
	}
}

// ─── the wire format ─────────────────────────────────────────────────────────

// The whole fix rests on nil reaching the device as literal null, so assert the encoded bytes
// rather than trusting the map.
func TestServiceUpdate_NilMarshalsAsJSONNull(t *testing.T) {
	b, err := json.Marshal(toServiceUpdate(svc(func(s *FGService) { s.UDPPortRange = "" })))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var back map[string]json.RawMessage
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if got := string(back["udp-portrange"]); got != "null" {
		t.Errorf("encoded udp-portrange = %s, want null", got)
	}
}

// ─── create must not regress ─────────────────────────────────────────────────

// CREATE keeps the omitempty struct: on a POST there is no previous value to erase, and sending
// null for irrelevant keys is exactly the behaviour that breaks protocol=IP.
func TestServiceCreate_StillOmitsEmptyFields(t *testing.T) {
	b, err := json.Marshal(toServiceWrite(svc(func(s *FGService) {
		s.Protocol, s.ProtocolNum = "IP", 47
		s.TCPPortRange, s.UDPPortRange, s.Comment = "", "", ""
	})))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var back map[string]json.RawMessage
	if err := json.Unmarshal(b, &back); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, k := range []string{"tcp-portrange", "udp-portrange", "comment"} {
		if _, present := back[k]; present {
			t.Errorf("create payload carries %q; it should stay omitted", k)
		}
	}
	if string(back["protocol-number"]) != "47" {
		t.Errorf("protocol-number = %s, want 47", back["protocol-number"])
	}
}
