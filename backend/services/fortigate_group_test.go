package services

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

// The grouping objects' mapping, pinned to the CMDB schema read live off a FortiGate 7.2.10
// (FGT80E). Each test below is one thing the device does that a plausible payload gets wrong.

// ─── member shape ────────────────────────────────────────────────────────────

// The wire shape is [{"name": …}], not ["…"]. A flat string array is accepted with a 200 and
// stores nothing — the group ends up empty and every policy using it passes no traffic.
func TestToMembers_IsATableOfNamedObjects(t *testing.T) {
	got := toMembers([]string{"LAN", "DMZ"})
	if len(got) != 2 || got[0].Name != "LAN" || got[1].Name != "DMZ" {
		t.Fatalf("toMembers = %#v", got)
	}
	raw, _ := json.Marshal(got)
	if string(raw) != `[{"name":"LAN"},{"name":"DMZ"}]` {
		t.Errorf("wire shape = %s", raw)
	}
}

// An emptied group must serialise as `[]`, never be omitted. Omitting the key leaves the device's
// existing members in place, which reads to the operator as "my edit did not save".
func TestToMembers_EmptyIsAnEmptyArrayNotNull(t *testing.T) {
	raw, _ := json.Marshal(toMembers(nil))
	if string(raw) != "[]" {
		t.Errorf("empty member list = %s, want []", raw)
	}
}

func TestToMembers_DropsBlankNames(t *testing.T) {
	if got := toMembers([]string{"LAN", "", "DMZ"}); len(got) != 2 {
		t.Errorf("blank name survived: %#v", got)
	}
}

// ─── enable/disable strings ──────────────────────────────────────────────────

// These fields are STRINGS on FortiOS. A JSON boolean is accepted and stored as disable.
func TestOnOff_RendersStringsNotBooleans(t *testing.T) {
	if onOff(true) != "enable" || onOff(false) != "disable" {
		t.Fatalf("onOff = %q/%q", onOff(true), onOff(false))
	}
	p := addressGroupPayload(FGAddressGroup{Name: "g", AllowRouting: true, FabricObject: false})
	if _, isBool := p["allow-routing"].(bool); isBool {
		t.Error("allow-routing went out as a JSON boolean — the device stores that as disable")
	}
	if p["allow-routing"] != "enable" || p["fabric-object"] != "disable" {
		t.Errorf("flags = %v/%v", p["allow-routing"], p["fabric-object"])
	}
}

func TestIsOn_OnlyExactEnableCounts(t *testing.T) {
	for _, s := range []string{"disable", "", "Enable", "true", "1"} {
		if isOn(s) {
			t.Errorf("isOn(%q) = true", s)
		}
	}
	if !isOn("enable") {
		t.Error(`isOn("enable") = false`)
	}
}

// ─── address group payload ───────────────────────────────────────────────────

func TestAddressGroupPayload_DefaultsType(t *testing.T) {
	p := addressGroupPayload(FGAddressGroup{Name: "g", Members: []string{"LAN"}})
	if p["type"] != "default" {
		t.Errorf("type = %v, want default", p["type"])
	}
}

// exclude-member is echoed back only while exclude is ON. FortiOS keeps the list after exclude is
// switched off, so resending it would resurrect an exclusion the operator had just cleared.
func TestAddressGroupPayload_ExcludeMemberClearedWhenExcludeIsOff(t *testing.T) {
	on := addressGroupPayload(FGAddressGroup{
		Name: "g", Members: []string{"LAN"}, Exclude: true, ExcludeMembers: []string{"PRINTERS"},
	})
	if got, _ := on["exclude-member"].([]FGName); len(got) != 1 || got[0].Name != "PRINTERS" {
		t.Errorf("exclude on: exclude-member = %#v", on["exclude-member"])
	}

	off := addressGroupPayload(FGAddressGroup{
		Name: "g", Members: []string{"LAN"}, Exclude: false, ExcludeMembers: []string{"PRINTERS"},
	})
	if got, _ := off["exclude-member"].([]FGName); len(got) != 0 {
		t.Errorf("exclude off: exclude-member = %#v, want an empty table", off["exclude-member"])
	}
	if off["exclude"] != "disable" {
		t.Errorf("exclude = %v", off["exclude"])
	}
}

// ─── service group payload ───────────────────────────────────────────────────

func TestServiceGroupPayload(t *testing.T) {
	p := serviceGroupPayload(FGServiceGroup{Name: "web", Members: []string{"HTTP", "HTTPS"}, Proxy: true})
	if p["proxy"] != "enable" {
		t.Errorf("proxy = %v", p["proxy"])
	}
	m, _ := p["member"].([]FGName)
	if len(m) != 2 || m[0].Name != "HTTP" {
		t.Fatalf("member = %#v", p["member"])
	}
	// A service group has no type/exclude/allow-routing; sending them would be rejected.
	for _, k := range []string{"type", "exclude", "allow-routing"} {
		if _, ok := p[k]; ok {
			t.Errorf("service group payload carries %q, which firewall.service/group has no field for", k)
		}
	}
}

// ─── decoding a real GET ─────────────────────────────────────────────────────

// The body below is the shape a live FGT80E returned for firewall/addrgrp, q_origin_key and all.
func TestGetAddressGroupsFull_DecodesTheDeviceShape(t *testing.T) {
	const body = `{"results":[{
		"name":"G Suite","q_origin_key":"G Suite","type":"default","category":"default",
		"member":[{"name":"gmail.com","q_origin_key":"gmail.com"},{"name":"wildcard.google.com","q_origin_key":"wildcard.google.com"}],
		"comment":"","exclude":"disable","exclude-member":[],"color":0,
		"allow-routing":"disable","fabric-object":"disable"}],"status":"success"}`

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	defer srv.Close()

	groups, err := newTestClient(srv.URL, srv.Client()).GetAddressGroupsFull()
	if err != nil {
		t.Fatalf("GetAddressGroupsFull: %v", err)
	}
	if len(groups) != 1 {
		t.Fatalf("got %d groups", len(groups))
	}
	g := groups[0]
	if g.Name != "G Suite" {
		t.Errorf("name = %q", g.Name)
	}
	if len(g.Members) != 2 || g.Members[0] != "gmail.com" {
		t.Errorf("members = %#v — the [{name}] table was not flattened", g.Members)
	}
	if g.Exclude || g.AllowRouting || g.FabricObject {
		t.Errorf("a payload of disables decoded as true: %+v", g)
	}
	if g.ExcludeMembers == nil {
		t.Error("ExcludeMembers is nil — it should be an empty slice so the UI renders a list, not a crash")
	}
}

// ─── trap 4: the field the device accepts and discards ───────────────────────

// ⚠️ Found on the lab FGT80E, not in the schema. PUT {"allow-routing":"enable"} on a group whose
// members are plain ipmask addresses answers 200 and reads back "disable". A UI that trusted the
// 200 would show a toggle that silently turns itself off, so the write reads the field back.
func TestUpdateAddressGroup_ReportsADiscardedAllowRouting(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			// The device's answer: everything stored EXCEPT allow-routing.
			_, _ = w.Write([]byte(`{"results":[{"name":"g","type":"default",
				"member":[{"name":"LAN"}],"exclude":"disable","exclude-member":[],
				"allow-routing":"disable","fabric-object":"disable","comment":"","color":0}],"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	err := newTestClient(srv.URL, srv.Client()).
		UpdateAddressGroup("g", FGAddressGroup{Name: "g", Members: []string{"LAN"}, AllowRouting: true})

	if !errors.Is(err, ErrAllowRoutingDiscarded) {
		t.Fatalf("err = %v, want ErrAllowRoutingDiscarded — a 200 that dropped the field read as a clean save", err)
	}
}

func TestUpdateAddressGroup_SilentWhenTheFieldStuck(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			_, _ = w.Write([]byte(`{"results":[{"name":"g","member":[{"name":"LAN"}],
				"allow-routing":"enable"}],"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	if err := newTestClient(srv.URL, srv.Client()).
		UpdateAddressGroup("g", FGAddressGroup{Name: "g", Members: []string{"LAN"}, AllowRouting: true}); err != nil {
		t.Errorf("a save the device honoured was reported as a problem: %v", err)
	}
}

// The read-back is a CHECK, not a second source of truth. A firewall that saved the group and then
// could not be read again must not be reported as having discarded anything — that would invent a
// problem out of not knowing, which is the mistake this codebase keeps having to unmake.
func TestUpdateAddressGroup_UnreadableReadBackIsNotADiscard(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":"error","http_status":500}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	if err := newTestClient(srv.URL, srv.Client()).
		UpdateAddressGroup("g", FGAddressGroup{Name: "g", Members: []string{"LAN"}, AllowRouting: true}); err != nil {
		t.Errorf("an unreadable read-back was reported as a discarded field: %v", err)
	}
}

// A write that does not ask for allow-routing costs no extra read.
func TestUpdateAddressGroup_NoReadBackWhenNotAsked(t *testing.T) {
	gets := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			gets++
		}
		_, _ = w.Write([]byte(`{"status":"success"}`))
	}))
	defer srv.Close()

	_ = newTestClient(srv.URL, srv.Client()).
		UpdateAddressGroup("g", FGAddressGroup{Name: "g", Members: []string{"LAN"}})
	if gets != 0 {
		t.Errorf("%d read-backs for a write that never set allow-routing", gets)
	}
}
