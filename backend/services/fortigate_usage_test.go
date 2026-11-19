package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The usage scanner, and in particular the three ways it is allowed to be wrong.
//
// It answers "what uses this object", and the answer arms a delete button. So the tests that
// matter are not the ones proving it finds a reference — they are the ones proving it refuses to
// claim a clean result it cannot back up.

// ─── field shapes ────────────────────────────────────────────────────────────

func TestFieldNames_HandlesAllThreeWireShapes(t *testing.T) {
	cases := []struct {
		name      string
		value     any
		memberKey string
		want      []string
	}{
		{"member table", []any{map[string]any{"name": "LAN"}, map[string]any{"name": "DMZ"}}, "", []string{"LAN", "DMZ"}},
		{"zone member table", []any{map[string]any{"interface-name": "port1"}}, "interface-name", []string{"port1"}},
		{"bare string", "port1", "", []string{"port1"}},
		{"empty string", "", "", nil},
		{"wrong key", []any{map[string]any{"name": "LAN"}}, "interface-name", []string{}},
		{"number", float64(3), "", nil},
		{"nil", nil, "", nil},
	}
	for _, tc := range cases {
		got := fieldNames(tc.value, tc.memberKey)
		if len(got) != len(tc.want) {
			t.Errorf("%s: got %#v, want %#v", tc.name, got, tc.want)
			continue
		}
		for i := range got {
			if got[i] != tc.want[i] {
				t.Errorf("%s: got %#v, want %#v", tc.name, got, tc.want)
				break
			}
		}
	}
}

// policyid comes back as a JSON number and has to render as an id, not as "3.000000" or "".
func TestRowKey_RendersNumericMKeys(t *testing.T) {
	if got := rowKey(map[string]any{"policyid": float64(12)}, "policyid"); got != "12" {
		t.Errorf("numeric mkey = %q", got)
	}
	if got := rowKey(map[string]any{"name": "LAN"}, "name"); got != "LAN" {
		t.Errorf("string mkey = %q", got)
	}
	if got := rowKey(map[string]any{}, "name"); got != "" {
		t.Errorf("missing mkey = %q", got)
	}
}

// ─── the scan ────────────────────────────────────────────────────────────────

// usageServer fakes the CMDB paths the scanner reads. `bodies` maps a path fragment to its
// results array; anything not listed answers 500, which is how "unreadable table" is exercised.
func usageServer(t *testing.T, qRef int, bodies map[string]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if strings.Contains(r.URL.RawQuery, "with_meta=1") {
			if qRef < 0 {
				w.WriteHeader(http.StatusInternalServerError)
				_, _ = w.Write([]byte(`{"status":"error"}`))
				return
			}
			_, _ = fmt.Fprintf(w, `{"results":[{"name":"x","q_ref":%d}],"status":"success"}`, qRef)
			return
		}
		for frag, body := range bodies {
			if strings.Contains(r.URL.Path, frag) {
				_, _ = fmt.Fprintf(w, `{"results":%s,"status":"success"}`, body)
				return
			}
		}
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"status":"error","http_status":500}`))
	}))
}

// Every table the address scan reads, all empty — the only shape in which a delete may be armed.
func addressTablesEmpty() map[string]string {
	return map[string]string{
		"firewall/policy":            `[]`,
		"firewall/addrgrp":           `[]`,
		"firewall/vip":               `[]`,
		"router/static":              `[]`,
		"vpn.ipsec/phase2-interface": `[]`,
	}
}

func TestFindUsage_FindsAPolicyReference(t *testing.T) {
	tables := addressTablesEmpty()
	tables["firewall/policy"] = `[{"policyid":3,"name":"lan-to-wan",
		"srcaddr":[{"name":"LAN-subnet"}],"dstaddr":[{"name":"all"}]}]`

	srv := usageServer(t, 1, tables)
	defer srv.Close()

	rep, err := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN-subnet")
	if err != nil {
		t.Fatalf("FindUsage: %v", err)
	}
	if rep.Found != 1 {
		t.Fatalf("found %d refs: %#v", rep.Found, rep.Refs)
	}
	r := rep.Refs[0]
	if r.Label != "Firewall Policy" || r.Key != "3" || r.Name != "lan-to-wan" || r.FieldLabel != "Source" {
		t.Errorf("ref = %+v", r)
	}
	if rep.SafeToDelete {
		t.Error("SafeToDelete is true while a policy still names the object")
	}
	if !rep.Complete {
		t.Errorf("scan should be complete: found 1, device says %d", rep.DeviceCount)
	}
}

// Matching is case-insensitive: FortiOS treats object names that way, so a scan that did not
// would report "nothing uses this" about an object a policy names in a different case.
func TestFindUsage_IsCaseInsensitive(t *testing.T) {
	tables := addressTablesEmpty()
	tables["firewall/policy"] = `[{"policyid":1,"name":"p","srcaddr":[{"name":"Lan-Subnet"}]}]`
	srv := usageServer(t, 1, tables)
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "lan-subnet")
	if rep.Found != 1 {
		t.Errorf("case-different name was not matched: %#v", rep.Refs)
	}
}

// ⚠️ The check that makes the delete button usable at all.
//
// One policy naming an address in BOTH srcaddr and dstaddr is two rows to us and ONE reference to
// FortiOS. Comparing raw hits against q_ref would read 2 > 1 as an over-count; comparing DISTINCT
// referrers reads it correctly.
func TestFindUsage_CountsDistinctReferrersNotHits(t *testing.T) {
	tables := addressTablesEmpty()
	tables["firewall/policy"] = `[{"policyid":7,"name":"hairpin",
		"srcaddr":[{"name":"LAN"}],"dstaddr":[{"name":"LAN"}]}]`
	srv := usageServer(t, 1, tables)
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	if rep.Found != 2 {
		t.Errorf("both fields should be listed: %#v", rep.Refs)
	}
	if !rep.Complete {
		t.Error("two hits on one policy were read as more references than the device counts")
	}
}

// ⚠️ The scan says so when it could not read a table, and never arms a delete on a partial read.
func TestFindUsage_UnreadableTableIsNeverSafeToDelete(t *testing.T) {
	tables := addressTablesEmpty()
	delete(tables, "firewall/vip") // → 500

	srv := usageServer(t, 0, tables)
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	if rep.Found != 0 {
		t.Fatalf("found %d", rep.Found)
	}
	if rep.Complete || rep.SafeToDelete {
		t.Error("a scan with an unreadable table reported itself complete — an empty result from a " +
			"table that never answered is not evidence that nothing uses the object")
	}
	if len(rep.Unreadable) != 1 || rep.Unreadable[0] != "Virtual IP" {
		t.Errorf("Unreadable = %#v, should name the table", rep.Unreadable)
	}
}

// ⚠️ And when the device's own count is higher than what we found, the scan admits the gap rather
// than presenting its list as exhaustive.
func TestFindUsage_DeviceCountHigherThanFoundIsIncomplete(t *testing.T) {
	srv := usageServer(t, 4, addressTablesEmpty()) // device says 4, we can see none
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	if rep.Complete || rep.SafeToDelete {
		t.Errorf("device counts 4 references and the scan found 0, yet Complete=%v SafeToDelete=%v",
			rep.Complete, rep.SafeToDelete)
	}
	if rep.DeviceCount != 4 {
		t.Errorf("DeviceCount = %d", rep.DeviceCount)
	}
}

// An unreadable q_ref is -1, which is not zero and must not read as "unused".
func TestFindUsage_UnknownDeviceCountIsNotSafeToDelete(t *testing.T) {
	srv := usageServer(t, -1, addressTablesEmpty())
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	if rep.DeviceCount != -1 {
		t.Errorf("DeviceCount = %d, want -1 for 'could not read'", rep.DeviceCount)
	}
	if rep.Complete || rep.SafeToDelete {
		t.Error("no reference count from the device, yet the object was declared safe to delete")
	}
}

// The clean case: every table read, nothing found, the device agrees.
func TestFindUsage_TrulyUnusedIsSafeToDelete(t *testing.T) {
	srv := usageServer(t, 0, addressTablesEmpty())
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	if !rep.Complete || !rep.SafeToDelete || rep.Found != 0 {
		t.Errorf("clean scan = %+v", rep)
	}
}

// The zone scan has to use the interface-name member key, or it silently finds nothing.
func TestFindUsage_ZoneMembershipUsesInterfaceNameKey(t *testing.T) {
	tables := map[string]string{
		"firewall/policy":  `[]`,
		"system/zone":      `[{"name":"inside","interface":[{"interface-name":"internal1"}]}]`,
		"router/static":    `[]`,
		"firewall/vip":     `[]`,
		"firewall/ippool":  `[]`,
		"firewall/address": `[]`,
	}
	srv := usageServer(t, 1, tables)
	defer srv.Close()

	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("interface", "internal1")
	if rep.Found != 1 || rep.Refs[0].Label != "Zone" {
		t.Fatalf("zone membership was not found: %#v", rep.Refs)
	}
}

func TestFindUsage_RejectsUnknownKind(t *testing.T) {
	srv := usageServer(t, 0, nil)
	defer srv.Close()
	if _, err := newTestClient(srv.URL, srv.Client()).FindUsage("nonsense", "x"); err == nil {
		t.Error("an unknown kind was accepted")
	}
}

// Refs serialise as a list, never null — the UI renders the array directly.
func TestFindUsage_RefsIsNeverNull(t *testing.T) {
	srv := usageServer(t, 0, addressTablesEmpty())
	defer srv.Close()
	rep, _ := newTestClient(srv.URL, srv.Client()).FindUsage("address", "LAN")
	raw, _ := json.Marshal(rep)
	if strings.Contains(string(raw), `"refs":null`) {
		t.Errorf("refs serialised as null: %s", raw)
	}
}
