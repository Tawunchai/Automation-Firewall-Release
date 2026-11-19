package services

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// cmdbTable, the plumbing every CMDB table in this package shares.
//
// The reason it exists is not line count. It is the rule at the top of this repo's instructions:
//
//	NEVER send DELETE to a CMDB collection URL — a delete must always name its mkey.
//
// A DELETE to /api/v2/cmdb/firewall/address deletes EVERY address on the firewall. That has
// happened here once already (every policy on the lab device, gone), and what guards it today is a
// PreToolUse hook watching what Claude types — nothing in the product. cmdbTable.Delete takes the
// key as a parameter and refuses an empty one before any request is built, so the collection URL
// is not something this code CAN express.

// The table under test: two fields in, a GUI shape out.
type cmdbTestRaw struct {
	Name  string `json:"name"`
	State string `json:"status"`
}

type cmdbTestGUI struct {
	Name string
	On   bool
}

func (r cmdbTestRaw) toGUI() cmdbTestGUI {
	return cmdbTestGUI{Name: r.Name, On: r.State == "enable"}
}

var cmdbTestTable = cmdbTable[cmdbTestRaw, cmdbTestGUI]{
	cmdbPath: cmdbPath{path: "firewall/thing", noun: "thing"},
	gui:      cmdbTestRaw.toGUI,
}

// recorder answers like a FortiGate and remembers what was asked of it.
type cmdbRecorder struct {
	method string
	path   string
	calls  int
	wire   string // the path as it arrived on the wire, still escaped
	body   string
	reply  string
}

func (rec *cmdbRecorder) server(t *testing.T) *FortiClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.calls++
		rec.method = r.Method
		rec.path = r.URL.Path
		rec.wire = r.URL.EscapedPath()
		if r.Body != nil {
			b := make([]byte, 4096)
			n, _ := r.Body.Read(b)
			rec.body = string(b[:n])
		}
		w.Header().Set("Content-Type", "application/json")
		reply := rec.reply
		if reply == "" {
			reply = `{"status":"success"}`
		}
		_, _ = w.Write([]byte(reply))
	}))
	t.Cleanup(srv.Close)
	return newTestClient(srv.URL, srv.Client())
}

// ── the rule ────────────────────────────────────────────────────────────────

// An empty key is the collection URL. It is refused here, before a request exists.
func TestCMDBTableDeleteRefusesAnEmptyKey(t *testing.T) {
	for _, key := range []string{"", " ", "\t", "\n "} {
		rec := &cmdbRecorder{}
		f := rec.server(t)

		err := cmdbTestTable.Delete(f, key)

		if err == nil {
			t.Fatalf("Delete(%q) returned no error — that is a DELETE at the collection URL", key)
		}
		if rec.calls != 0 {
			t.Fatalf("Delete(%q) reached the device (%s %s)", key, rec.method, rec.path)
		}
		if !strings.Contains(err.Error(), "firewall/thing") {
			t.Errorf("the refusal does not say which table: %v", err)
		}
	}
}

// A real key deletes exactly that one object, at a path that names it.
func TestCMDBTableDeleteNamesTheObject(t *testing.T) {
	rec := &cmdbRecorder{}
	f := rec.server(t)

	if err := cmdbTestTable.Delete(f, "LAN-10.0.0.0"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if rec.method != http.MethodDelete {
		t.Fatalf("method = %s", rec.method)
	}
	if rec.path != "/api/v2/cmdb/firewall/thing/LAN-10.0.0.0" {
		t.Fatalf("path = %s", rec.path)
	}
}

// A key with a slash in it still addresses ONE object. FortiOS mkeys do carry slashes (a
// subnet-shaped name, "10.0.0.0/8"), and an unescaped one would turn the path into a different
// table — see the gin-rawpath note in this repo's memory for the mirror image on the way in.
func TestCMDBTableDeleteEscapesTheKey(t *testing.T) {
	rec := &cmdbRecorder{}
	f := rec.server(t)

	if err := cmdbTestTable.Delete(f, "10.0.0.0/8"); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	// The escaped form is what reached the wire, so the device sees ONE mkey. (net/http hands
	// the handler a DECODED r.URL.Path, which is why this reads EscapedPath — the same
	// distinction that made an mkey with a slash 404 on the way in; see the gin-rawpath memory.)
	if rec.wire != "/api/v2/cmdb/firewall/thing/10.0.0.0%2F8" {
		t.Fatalf("wire path = %s, want the key escaped", rec.wire)
	}
	if rec.path != "/api/v2/cmdb/firewall/thing/10.0.0.0/8" {
		t.Fatalf("the device decoded a different mkey: %s", rec.path)
	}
}

// ── the plumbing ────────────────────────────────────────────────────────────

func TestCMDBTableListMapsEveryRow(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"results":[{"name":"a","status":"enable"},{"name":"b","status":"disable"}],"status":"success"}`}
	f := rec.server(t)

	got, err := cmdbTestTable.List(f)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(got) != 2 || got[0].Name != "a" || !got[0].On || got[1].On {
		t.Fatalf("List = %#v", got)
	}
	if rec.path != "/api/v2/cmdb/firewall/thing" {
		t.Fatalf("path = %s", rec.path)
	}
}

// An empty table is an empty slice, never nil: a nil would render in the console as "could not
// read" on pages that tell those two apart.
func TestCMDBTableListOfNothingIsNotNil(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"results":[],"status":"success"}`}
	got, err := cmdbTestTable.List(rec.server(t))
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if got == nil {
		t.Fatal("List returned nil for an empty table")
	}
	if len(got) != 0 {
		t.Fatalf("List = %#v", got)
	}
}

// A body that is not what the schema says must be an error, not an empty list — "could not read"
// and "there is nothing there" are the two answers this console is most careful to keep apart.
func TestCMDBTableListReportsAnUnreadableAnswer(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"results":{"name":"not-a-list"},"status":"success"}`}
	if _, err := cmdbTestTable.List(rec.server(t)); err == nil {
		t.Fatal("an unparseable answer read as an empty table")
	} else if !strings.Contains(err.Error(), "thing") {
		t.Errorf("the parse error does not name the table: %v", err)
	}
}

func TestCMDBTableGetReturnsTheOneRow(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"results":[{"name":"a","status":"enable"}],"status":"success"}`}
	f := rec.server(t)

	got, err := cmdbTestTable.Get(f, "a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got == nil || got.Name != "a" || !got.On {
		t.Fatalf("Get = %#v", got)
	}
	if rec.path != "/api/v2/cmdb/firewall/thing/a" {
		t.Fatalf("path = %s", rec.path)
	}
}

// The device answering with an empty list for a named object means it is not there. That must be
// an error a caller can recognise, not a zero value that looks like a real object.
func TestCMDBTableGetOfSomethingMissingIsAnError(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"results":[],"status":"success"}`}
	if _, err := cmdbTestTable.Get(rec.server(t), "nope"); err == nil {
		t.Fatal("a missing object came back without an error")
	} else if !IsObjectGoneError(err) {
		t.Errorf("err = %v — a caller cannot tell this is 'not there'", err)
	}
}

func TestCMDBTableGetRefusesAnEmptyKey(t *testing.T) {
	rec := &cmdbRecorder{}
	if _, err := cmdbTestTable.Get(rec.server(t), ""); err == nil {
		t.Fatal("Get with no key read the whole collection as one object")
	}
	if rec.calls != 0 {
		t.Fatalf("Get with no key reached the device: %s %s", rec.method, rec.path)
	}
}

func TestCMDBTableCreatePostsToTheCollection(t *testing.T) {
	rec := &cmdbRecorder{}
	f := rec.server(t)

	if err := cmdbTestTable.Create(f, map[string]interface{}{"name": "a"}); err != nil {
		t.Fatalf("Create: %v", err)
	}
	if rec.method != http.MethodPost || rec.path != "/api/v2/cmdb/firewall/thing" {
		t.Fatalf("%s %s", rec.method, rec.path)
	}
	if !strings.Contains(rec.body, `"name":"a"`) {
		t.Fatalf("body = %s", rec.body)
	}
}

func TestCMDBTableUpdatePutsToTheOneObject(t *testing.T) {
	rec := &cmdbRecorder{}
	f := rec.server(t)

	if err := cmdbTestTable.Update(f, "a", map[string]interface{}{"status": "enable"}); err != nil {
		t.Fatalf("Update: %v", err)
	}
	if rec.method != http.MethodPut || rec.path != "/api/v2/cmdb/firewall/thing/a" {
		t.Fatalf("%s %s", rec.method, rec.path)
	}
}

// An Update with no key would PUT at the collection URL. FortiOS answers that with a refusal
// rather than a mass edit, but it is the same mistake as the delete and it is refused the same way.
func TestCMDBTableUpdateRefusesAnEmptyKey(t *testing.T) {
	rec := &cmdbRecorder{}
	if err := cmdbTestTable.Update(rec.server(t), "", map[string]interface{}{"status": "enable"}); err == nil {
		t.Fatal("Update with no key was allowed")
	}
	if rec.calls != 0 {
		t.Fatalf("Update with no key reached the device: %s %s", rec.method, rec.path)
	}
}

// The device's own refusal is passed through as the typed error the whole console compares
// numerically — the generic must not flatten it into a sentence.
func TestCMDBTableKeepsTheDeviceErrorTyped(t *testing.T) {
	rec := &cmdbRecorder{reply: `{"http_status":500,"status":"error","error":-5,"cli_error":"duplicate entry"}`}
	err := cmdbTestTable.Create(rec.server(t), map[string]interface{}{"name": "a"})
	if err == nil {
		t.Fatal("a -5 from the device came back as success")
	}
	code, ok := DeviceErrorCode(err)
	if !ok || code != FGErrDuplicate {
		t.Fatalf("DeviceErrorCode = %d, %v — want -5", code, ok)
	}
}
