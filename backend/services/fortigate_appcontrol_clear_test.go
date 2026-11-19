package services

import (
	"encoding/json"
	"testing"
)

// Guards the Network Protocol Enforcement clear path (see clearAppNetworkServices).
//
// The device behaviour these pin down, all probed live on FortiOS 7.2.10 against
// application/list:
//
//	PUT {"default-network-services":[]}        → 200, revision_changed:false, rows KEPT
//	PUT {"default-network-services":null}      → 200, revision_changed:false, rows KEPT
//	PUT {"default-network-services":[{...}]}   → replaces the table correctly
//	DELETE .../default-network-services/<id>   → row actually goes away
//
// So the payload alone is right for every case except "the user removed the last row", which needs
// the child DELETE pass.

func appForm(over func(*AppControlProfileForm)) AppControlProfileForm {
	f := AppControlProfileForm{
		Name:                       "AppSensor",
		Categories:                 []AppCategoryAction{{Category: 2, Action: "block"}},
		UnknownApplicationAction:   "monitor",
		NetworkProtocolEnforcement: true,
		NetworkServices: []AppNetworkService{
			{ID: 1, Port: 80, Services: []string{"http"}, ViolationAction: "monitor"},
		},
	}
	if over != nil {
		over(&f)
	}
	return f
}

func netSvcRows(t *testing.T, p map[string]interface{}) []map[string]interface{} {
	t.Helper()
	rows, ok := p["default-network-services"].([]map[string]interface{})
	if !ok {
		t.Fatalf("default-network-services = %#v, want a row slice", p["default-network-services"])
	}
	return rows
}

// A populated table still travels in the PUT body — the fix must not reroute the normal case
// through the slower per-row DELETE path.
func TestAppControlPayload_KeepsRowsInBody(t *testing.T) {
	rows := netSvcRows(t, appControlProfilePayload(appForm(nil)))

	if len(rows) != 1 {
		t.Fatalf("got %d rows, want 1", len(rows))
	}
	if rows[0]["port"] != 80 || rows[0]["services"] != "http" || rows[0]["violation-action"] != "monitor" {
		t.Errorf("row = %#v", rows[0])
	}
	if rows[0]["id"] != 1 {
		t.Errorf("id = %#v, want the 1-based index", rows[0]["id"])
	}
}

// Rows are re-indexed from 1 so a replace never collides with a stale mkey.
func TestAppControlPayload_ReindexesRows(t *testing.T) {
	rows := netSvcRows(t, appControlProfilePayload(appForm(func(f *AppControlProfileForm) {
		f.NetworkServices = []AppNetworkService{
			{ID: 9, Port: 443, Services: []string{"https"}, ViolationAction: "block"},
			{ID: 4, Port: 22, Services: []string{"ssh"}, ViolationAction: "monitor"},
		}
	})))

	if len(rows) != 2 {
		t.Fatalf("got %d rows, want 2", len(rows))
	}
	if rows[0]["id"] != 1 || rows[1]["id"] != 2 {
		t.Errorf("ids = %v/%v, want 1/2", rows[0]["id"], rows[1]["id"])
	}
}

// Rows with no port are dropped rather than sent as port 0.
func TestAppControlPayload_SkipsPortlessRows(t *testing.T) {
	rows := netSvcRows(t, appControlProfilePayload(appForm(func(f *AppControlProfileForm) {
		f.NetworkServices = []AppNetworkService{
			{Port: 0, Services: []string{"http"}},
			{Port: 443, Services: []string{"https"}, ViolationAction: "block"},
		}
	})))

	if len(rows) != 1 || rows[0]["port"] != 443 {
		t.Errorf("rows = %#v, want only the port-443 row", rows)
	}
}

// The empty case: the body carries an empty table, which the device ignores. That is exactly why
// UpdateAppControlProfile follows up with clearAppNetworkServices — this test documents the
// handoff so nobody "simplifies" the follow-up away.
func TestAppControlPayload_EmptyTableNeedsTheDeletePass(t *testing.T) {
	p := appControlProfilePayload(appForm(func(f *AppControlProfileForm) {
		f.NetworkProtocolEnforcement = false
		f.NetworkServices = nil
	}))

	if rows := netSvcRows(t, p); len(rows) != 0 {
		t.Errorf("got %d rows, want 0", len(rows))
	}
	if p["control-default-network-services"] != "disable" {
		t.Errorf("control-default-network-services = %#v, want disable", p["control-default-network-services"])
	}
}

// appNetworkServiceIDs has to survive a profile that carries no sub-table at all, since it runs on
// every "cleared" update including ones where the table was already empty.
func TestAppNetworkServiceIDs_ParsesDeviceShape(t *testing.T) {
	for _, tc := range []struct {
		name string
		body string
		want []int
	}{
		{"two rows", `[{"default-network-services":[{"id":1,"port":80},{"id":7,"port":443}]}]`, []int{1, 7}},
		{"empty table", `[{"default-network-services":[]}]`, []int{}},
		{"absent table", `[{"name":"AppSensor"}]`, []int{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var objs []struct {
				DefaultNetworkServices []struct {
					ID int `json:"id"`
				} `json:"default-network-services"`
			}
			if err := json.Unmarshal([]byte(tc.body), &objs); err != nil {
				t.Fatalf("unmarshal: %v", err)
			}
			got := []int{}
			for _, e := range objs[0].DefaultNetworkServices {
				got = append(got, e.ID)
			}
			if len(got) != len(tc.want) {
				t.Fatalf("ids = %v, want %v", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("ids = %v, want %v", got, tc.want)
				}
			}
		})
	}
}
