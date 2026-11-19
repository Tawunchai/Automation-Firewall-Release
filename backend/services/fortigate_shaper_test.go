package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Traffic shaping. The tests are about the two halves only working together, and about the field
// whose default silently divides your bandwidth by the number of policies using it.

func TestTrafficShaperPayload_Defaults(t *testing.T) {
	p := trafficShaperPayload(FGTrafficShaper{Name: "s", Maximum: 1000})
	if p["bandwidth-unit"] != "kbps" || p["priority"] != "high" {
		t.Errorf("defaults = %v / %v", p["bandwidth-unit"], p["priority"])
	}
}

// ⚠️ per-policy is one enable/disable string and the difference is a factor of however many
// policies use the shaper: OFF means one 10 Mbps shaper on three policies is 10 Mbps TOTAL.
func TestTrafficShaperPayload_PerPolicyIsAString(t *testing.T) {
	on := trafficShaperPayload(FGTrafficShaper{Name: "s", Maximum: 1, PerPolicy: true})
	off := trafficShaperPayload(FGTrafficShaper{Name: "s", Maximum: 1, PerPolicy: false})
	if on["per-policy"] != "enable" || off["per-policy"] != "disable" {
		t.Errorf("per-policy = %v / %v", on["per-policy"], off["per-policy"])
	}
	if _, isBool := on["per-policy"].(bool); isBool {
		t.Error("per-policy went out as a JSON boolean — the device stores that as disable")
	}
}

// diffservcode is only meaningful with diffserv on, and FortiOS refuses a malformed code.
func TestTrafficShaperPayload_DiffServCodeOnlyWithDiffServ(t *testing.T) {
	off := trafficShaperPayload(FGTrafficShaper{Name: "s", Maximum: 1, DiffServCode: "000000"})
	if _, ok := off["diffservcode"]; ok {
		t.Error("a DSCP code was sent with DiffServ off")
	}
	on := trafficShaperPayload(FGTrafficShaper{Name: "s", Maximum: 1, DiffServ: true, DiffServCode: "000000"})
	if on["diffservcode"] != "000000" {
		t.Errorf("diffservcode = %v", on["diffservcode"])
	}
}

// ⚠️ A failed policy read must not turn every shaper into "used by 0" — that reads as "nothing
// uses these, delete them". -1 is how the list says it does not know.
func TestGetTrafficShapers_UnknownUsageIsNotZero(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "shaping-policy") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = w.Write([]byte(`{"status":"error","http_status":500}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"s","maximum-bandwidth":1000,
			"bandwidth-unit":"kbps","priority":"high","per-policy":"disable"}],"status":"success"}`))
	}))
	defer srv.Close()

	got, err := newTestClient(srv.URL, srv.Client()).GetTrafficShapers()
	if err != nil {
		t.Fatalf("GetTrafficShapers: %v", err)
	}
	if len(got) != 1 || got[0].UsedBy != -1 {
		t.Errorf("used_by = %d, want -1 when the policy table could not be read", got[0].UsedBy)
	}
}

func TestGetTrafficShapers_CountsBothDirectionsOnce(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.Path, "shaping-policy") {
			// One policy using the same shaper in both directions, and one using it forward only.
			_, _ = w.Write([]byte(`{"results":[
				{"id":1,"name":"a","traffic-shaper":"s","traffic-shaper-reverse":"s"},
				{"id":2,"name":"b","traffic-shaper":"s","traffic-shaper-reverse":""}],"status":"success"}`))
			return
		}
		_, _ = w.Write([]byte(`{"results":[{"name":"s","maximum-bandwidth":1000}],"status":"success"}`))
	}))
	defer srv.Close()

	got, _ := newTestClient(srv.URL, srv.Client()).GetTrafficShapers()
	// Two policies use it; the one naming it twice counts once, because it is one policy.
	if got[0].UsedBy != 2 {
		t.Errorf("used_by = %d, want 2", got[0].UsedBy)
	}
}

func TestShapingPolicyPayload_SendsEveryShaperSlot(t *testing.T) {
	p := shapingPolicyPayload(FGShapingPolicy{
		Name: "p", Status: true, SrcAddr: []string{"LAN"}, DstAddr: []string{"all"},
		Service: []string{"HTTPS"}, TrafficShaper: "s",
	})
	// The empty ones are sent deliberately: on an edit that is how a slot is CLEARED, and a
	// missing key would leave yesterday's shaper attached.
	for _, k := range []string{"traffic-shaper", "traffic-shaper-reverse", "per-ip-shaper"} {
		if _, ok := p[k]; !ok {
			t.Errorf("%q was omitted — an edit could then never clear it", k)
		}
	}
	if p["status"] != "enable" || p["ip-version"] != "4" {
		t.Errorf("status/ip-version = %v / %v", p["status"], p["ip-version"])
	}
}
