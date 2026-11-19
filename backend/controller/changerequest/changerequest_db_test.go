package changerequest

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// The HTTP shape of the change queue, against a real database.
//
// review_authz_test.go already proves the admin gate on Review with no database, because
// requireAdmin returns before anything else. Everything the feature is FOR needs one: who may
// raise, who may see, what a second Approve does, and what happens to a request that is approved
// and then applied.
//
// The state machine itself lives in services/changerequest.go and is unit-tested there. These
// cases are about the controller's side of it — the status codes a page branches on, and the
// transitions it is allowed to drive:
//
//	409  somebody already reviewed it / it expired / it is not pending
//	403  an approval from a non-admin, or a withdrawal by someone else
//	207  approved, and the DEVICE refused the write — not a failed approval
//	502  approved, and the write could not be attempted at all
//
// Skipped unless CHANGEREQUEST_DB_TEST_DSN names a database it may freely create tables in and
// empty. Point it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55436:5432 -e POSTGRES_PASSWORD=test --name g1-pg postgres:16-alpine
//	CHANGEREQUEST_DB_TEST_DSN="host=localhost port=55436 user=postgres password=test dbname=changerequest_test sslmode=disable" \
//	  go test ./controller/changerequest/ -v

const (
	// A path the queue accepts: a write under the device proxy that resolves to a CMDB coordinate.
	okPath = "/policy/device/1/addresses"
	// The same shape against the device nobody in the fixture may see.
	otherDevicePath = "/policy/device/2/addresses"
)

type fixture struct {
	admin    uint // may review; sees every device
	other    uint // a second admin, so an approval can come from someone who did not raise it
	raiser   uint // a plain user, granted device 1 only
	stranger uint // a plain user with no device access at all
	device1  uint
	device2  uint
}

func testDB(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("CHANGEREQUEST_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("CHANGEREQUEST_DB_TEST_DSN not set — see the note at the top of changerequest_db_test.go")
	}
	gin.SetMode(gin.TestMode)

	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB")
	}
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.NetworkDevice{},
		&entity.UserDeviceAccess{}, &entity.ChangeRequest{}, &entity.ChangeRecord{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, table := range []string{
		"change_requests", "change_records", "user_device_accesses",
		"network_devices", "app_users", "app_roles",
	} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	role := entity.AppRole{Role: "user"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("seed role: %v", err)
	}
	users := []entity.AppUser{
		{Email: "admin@example.test", Password: "x", FirstName: "Ada", LastName: "A", AppRoleID: role.ID},
		{Email: "admin2@example.test", Password: "x", FirstName: "Bea", LastName: "B", AppRoleID: role.ID},
		{Email: "raiser@example.test", Password: "x", FirstName: "Cam", LastName: "C", AppRoleID: role.ID},
		{Email: "stranger@example.test", Password: "x", FirstName: "Dee", LastName: "D", AppRoleID: role.ID},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	// The device ids have to be 1 and 2, because the PATHS above name them: a change request's
	// device is parsed out of its path, not sent alongside it.
	devices := []entity.NetworkDevice{
		{Name: "lab-80E", Vendor: "fortinet", Platform: "fortinet", MgmtIP: "10.10.20.90"},
		{Name: "other-fgt", Vendor: "fortinet", Platform: "fortinet", MgmtIP: "10.10.20.91"},
	}
	if err := db.Create(&devices).Error; err != nil {
		t.Fatalf("seed devices: %v", err)
	}
	if devices[0].ID != 1 || devices[1].ID != 2 {
		t.Fatalf("the fixture needs device ids 1 and 2, got %d and %d", devices[0].ID, devices[1].ID)
	}
	if err := db.Create(&entity.UserDeviceAccess{
		AppUserID: users[2].ID, NetworkDeviceID: devices[0].ID, GrantedByID: users[0].ID,
	}).Error; err != nil {
		t.Fatalf("seed device access: %v", err)
	}

	return &fixture{
		admin: users[0].ID, other: users[1].ID, raiser: users[2].ID, stranger: users[3].ID,
		device1: devices[0].ID, device2: devices[1].ID,
	}
}

type caller struct {
	id    uint
	email string
	role  string
}

func (c caller) apply(ctx *gin.Context) {
	if c.id != 0 {
		ctx.Set("user_id", c.id)
	}
	if c.email != "" {
		ctx.Set("user_email", c.email)
	}
	if c.role != "" {
		ctx.Set("user_role", c.role)
	}
}

func admin(fx *fixture) caller  { return caller{fx.admin, "admin@example.test", "admin"} }
func admin2(fx *fixture) caller { return caller{fx.other, "admin2@example.test", "admin"} }
func raiser(fx *fixture) caller { return caller{fx.raiser, "raiser@example.test", "user"} }

func call(t *testing.T, who caller, handler gin.HandlerFunc, method, url, body string, params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, url, strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	who.apply(c)
	c.Params = params
	handler(c)
	return rec
}

func idParams(id uint) gin.Params {
	return gin.Params{{Key: "id", Value: strconv.FormatUint(uint64(id), 10)}}
}

// raise stores a pending request through the real handler and returns it.
func raise(t *testing.T, who caller, path, reason string) entity.ChangeRequest {
	t.Helper()
	body, _ := json.Marshal(map[string]any{
		"title":  "please add the printer",
		"reason": reason,
		"method": http.MethodPost,
		"path":   path,
		"body":   `{"name":"printer","subnet":"10.1.1.5/32"}`,
	})
	rec := call(t, who, Create, http.MethodPost, "/change-requests", string(body), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("raise: status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	var out entity.ChangeRequest
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode raised request: %v — %s", err, rec.Body.String())
	}
	return out
}

func reload(t *testing.T, id uint) entity.ChangeRequest {
	t.Helper()
	var r entity.ChangeRequest
	if err := config.DB().First(&r, id).Error; err != nil {
		t.Fatalf("reload %d: %v", id, err)
	}
	return r
}

// stubReplayer stands in for the gin engine the applier replays through, so an approval can be
// carried all the way to "applied" with no firewall and no router.
//
// It records what it was asked to do, which is the part worth asserting: the replay must carry the
// request's own method, path and body, and must arrive as the APPROVER rather than the requester.
type stubReplayer struct {
	mu     sync.Mutex
	status int
	body   string
	calls  []*http.Request
	bodies []string
}

func (s *stubReplayer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	defer s.mu.Unlock()
	body := ""
	if r.Body != nil {
		raw, _ := io.ReadAll(r.Body)
		body = string(raw)
	}
	s.calls = append(s.calls, r)
	s.bodies = append(s.bodies, body)
	w.WriteHeader(s.status)
	_, _ = w.Write([]byte(s.body))
}

func (s *stubReplayer) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

// withReplayer installs a stub for the duration of one test and puts it back afterwards. The
// replayer is a package variable in services, so leaving one behind would change the next test.
func withReplayer(t *testing.T, status int, body string) *stubReplayer {
	t.Helper()
	s := &stubReplayer{status: status, body: body}
	services.SetChangeRequestReplayer(s)
	t.Cleanup(func() { services.SetChangeRequestReplayer(nil) })
	return s
}

// ── Raising ──────────────────────────────────────────────────────────────────

// Raising is open to a plain user ON PURPOSE: a change request is how somebody who may not write
// to a firewall proposes a change to it. Gating the raise behind admin would make the queue a
// thing admins use to talk to each other.
func TestAPlainUserMayRaiseARequestForADeviceTheyCanSee(t *testing.T) {
	fx := testDB(t)

	r := raise(t, raiser(fx), okPath, "the printer cannot be reached from the office vlan")
	if r.ID == 0 {
		t.Fatal("the reply carries no id")
	}
	if r.Status != entity.CRStatusPending {
		t.Errorf("status = %q, want %q", r.Status, entity.CRStatusPending)
	}
	if r.NetworkDeviceID != fx.device1 {
		t.Errorf("device = %d, want %d — the device is parsed out of the path", r.NetworkDeviceID, fx.device1)
	}
	if r.RequestedByID != fx.raiser || r.RequestedBy != "raiser@example.test" {
		t.Errorf("requester = %d/%q, want %d/raiser@example.test", r.RequestedByID, r.RequestedBy, fx.raiser)
	}

	// The stored title is the SYSTEM's description of the write, not the requester's words. That
	// is the confused-deputy fix: the line a reviewer reads before opening anything has to
	// describe what will happen, and the requester's own wording moves into the reason, labelled.
	if strings.Contains(r.Title, "please add the printer") {
		t.Errorf("title = %q — it is still the requester's wording", r.Title)
	}
	if !strings.Contains(r.Reason, "please add the printer") {
		t.Errorf("the requester's own title was dropped rather than moved into the reason: %q", r.Reason)
	}

	// An unreviewed request has to stop being applicable on its own.
	if r.ExpiresAt.IsZero() {
		t.Error("expires_at is zero — the request would sit in the queue forever")
	}
	if d := r.ExpiresAt.Sub(r.RequestedAt); d > services.DefaultRequestTTL+time.Minute {
		t.Errorf("ttl = %s, want at most the %s default", d, services.DefaultRequestTTL)
	}
}

// A ttl longer than the default is capped rather than honoured: the cap is what stops the queue
// becoming a pile of approvals nobody dares grant.
func TestAnOverlongExpiryIsCappedAtTheDefault(t *testing.T) {
	fx := testDB(t)

	body, _ := json.Marshal(map[string]any{
		"reason": "a long-lived proposal", "method": http.MethodPost, "path": okPath,
		"expires_in_hours": 24 * 365,
	})
	rec := call(t, raiser(fx), Create, http.MethodPost, "/change-requests", string(body), nil)
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var r entity.ChangeRequest
	_ = json.Unmarshal(rec.Body.Bytes(), &r)
	if d := r.ExpiresAt.Sub(r.RequestedAt); d > services.DefaultRequestTTL+time.Minute {
		t.Errorf("ttl = %s, want it capped to %s", d, services.DefaultRequestTTL)
	}
}

// Raising a request against a device the caller cannot see is 404, not 403.
//
// Without this check the queue would be a way to describe a firewall you cannot reach and then
// have somebody else write to it on your behalf. 404 rather than 403 because the existence of
// device 2 is itself not the stranger's business.
func TestARequestForADeviceTheCallerCannotSeeIs404(t *testing.T) {
	fx := testDB(t)

	body, _ := json.Marshal(map[string]any{
		"reason": "a device I cannot reach", "method": http.MethodPost, "path": otherDevicePath,
	})
	rec := call(t, raiser(fx), Create, http.MethodPost, "/change-requests", string(body), nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("granted user, other device: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}

	// And the user with no grants at all cannot raise against device 1 either.
	body2, _ := json.Marshal(map[string]any{
		"reason": "no grants at all", "method": http.MethodPost, "path": okPath,
	})
	rec = call(t, caller{fx.stranger, "stranger@example.test", "user"}, Create,
		http.MethodPost, "/change-requests", string(body2), nil)
	if rec.Code != http.StatusNotFound {
		t.Errorf("ungranted user: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}

	var n int64
	config.DB().Model(&entity.ChangeRequest{}).Count(&n)
	if n != 0 {
		t.Errorf("%d requests were stored by calls that were refused", n)
	}
}

// A privileged resource is 403, not 400.
//
// These are the writes an approver must not be able to be talked into making on someone's behalf:
// an LDAP or RADIUS server names the directory the firewall trusts and carries the credential it
// binds with. 400 would read as "try again with better input"; this is a refusal.
func TestAPrivilegedResourceIsRefusedWith403(t *testing.T) {
	fx := testDB(t)

	for _, seg := range []string{"ldap-servers", "radius-servers", "exchange-connectors"} {
		t.Run(seg, func(t *testing.T) {
			body, _ := json.Marshal(map[string]any{
				"reason": "point auth at my server", "method": http.MethodPost,
				"path": "/policy/device/1/" + seg,
			})
			rec := call(t, raiser(fx), Create, http.MethodPost, "/change-requests", string(body), nil)
			if rec.Code != http.StatusForbidden {
				t.Errorf("status = %d, want 403: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// Everything else a proposal can be wrong about is a 400.
func TestAProposalThatCannotBeQueuedIs400(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct{ name, body string }{
		{"no reason", `{"method":"POST","path":"` + okPath + `"}`},
		{"a blank reason", `{"reason":"   ","method":"POST","path":"` + okPath + `"}`},
		// A GET is not a change. The queue carries writes.
		{"a read", `{"reason":"r","method":"GET","path":"` + okPath + `"}`},
		{"not a device route", `{"reason":"r","method":"POST","path":"/users/1/devices"}`},
		// admin-users does not resolve to a CMDB coordinate at all, so it cannot be queued —
		// the firewall's own administrator accounts are refused one step before the privileged
		// list.
		{"the device's own admins", `{"reason":"r","method":"POST","path":"/policy/device/1/admin-users"}`},
		{"a query string", `{"reason":"r","method":"POST","path":"` + okPath + `?vdom=root"}`},
		{"device 0", `{"reason":"r","method":"POST","path":"/policy/device/0/addresses"}`},
		{"a body that is not json", `{"reason":"r","method":"POST","path":"` + okPath + `","body":"name=printer"}`},
		{"not json at all", `{`},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, raiser(fx), Create, http.MethodPost, "/change-requests", c.body, nil)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// ── Reading ──────────────────────────────────────────────────────────────────

// The queue a non-admin sees is scoped to the devices they may reach. A request against a firewall
// you cannot see would leak the fact that it exists.
func TestTheListAndTheDetailAreScopedToTheCaller(t *testing.T) {
	fx := testDB(t)

	mine := raise(t, raiser(fx), okPath, "mine")
	// Raised by an admin against the device the plain users cannot see.
	theirs := raise(t, admin(fx), otherDevicePath, "not for the raiser")

	rec := call(t, raiser(fx), List, http.MethodGet, "/change-requests", "", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	var list []entity.ChangeRequest
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatalf("decode: %v — %s", err, rec.Body.String())
	}
	if len(list) != 1 || list[0].ID != mine.ID {
		t.Fatalf("the raiser sees %d requests, want only their own device's: %s", len(list), rec.Body.String())
	}

	// A user with no grants at all sees an empty list, and it serialises as an array.
	rec = call(t, caller{fx.stranger, "stranger@example.test", "user"}, List,
		http.MethodGet, "/change-requests", "", nil)
	if rec.Code != http.StatusOK || strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Errorf("a user with no device access got %d %s, want 200 []", rec.Code, rec.Body.String())
	}

	// An admin sees both.
	rec = call(t, admin(fx), List, http.MethodGet, "/change-requests", "", nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 2 {
		t.Errorf("admin sees %d requests, want 2", len(list))
	}

	// The detail route is scoped the same way, and also with 404 rather than 403.
	if rec := call(t, raiser(fx), Get, http.MethodGet, "/change-requests/x", "", idParams(theirs.ID)); rec.Code != http.StatusNotFound {
		t.Errorf("detail of another device's request: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
	if rec := call(t, raiser(fx), Get, http.MethodGet, "/change-requests/x", "", idParams(mine.ID)); rec.Code != http.StatusOK {
		t.Errorf("detail of their own request: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if rec := call(t, admin(fx), Get, http.MethodGet, "/change-requests/x", "", idParams(theirs.ID)); rec.Code != http.StatusOK {
		t.Errorf("admin detail: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	for _, id := range []string{"abc", "", "9999"} {
		want := http.StatusBadRequest
		if id == "9999" {
			want = http.StatusNotFound
		}
		if rec := call(t, admin(fx), Get, http.MethodGet, "/change-requests/x", "",
			gin.Params{{Key: "id", Value: id}}); rec.Code != want {
			t.Errorf("id %q: status = %d, want %d", id, rec.Code, want)
		}
	}
}

// ?status= and ?mine=true are the two filters the page uses.
func TestTheListFilters(t *testing.T) {
	fx := testDB(t)

	mine := raise(t, raiser(fx), okPath, "mine")
	adminsOwn := raise(t, admin(fx), okPath, "the admin's own")

	// Reject one so there is something that is not pending.
	if rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":false,"note":"no"}`, idParams(adminsOwn.ID)); rec.Code != http.StatusOK {
		t.Fatalf("reject: status = %d: %s", rec.Code, rec.Body.String())
	}

	var list []entity.ChangeRequest
	rec := call(t, admin(fx), List, http.MethodGet, "/change-requests?status=pending", "", nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].ID != mine.ID {
		t.Errorf("?status=pending returned %d rows, want just the pending one: %s", len(list), rec.Body.String())
	}

	rec = call(t, admin(fx), List, http.MethodGet, "/change-requests?mine=true", "", nil)
	_ = json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 || list[0].ID != adminsOwn.ID {
		t.Errorf("?mine=true returned %d rows, want the admin's own: %s", len(list), rec.Body.String())
	}
}

// ── Reviewing ────────────────────────────────────────────────────────────────

// Approving one's own request is 409, whoever you are. This is the rule the whole feature exists
// for, and it is enforced on the transition rather than in the UI.
func TestAnAdminCannotApproveTheirOwnRequest(t *testing.T) {
	fx := testDB(t)
	own := raise(t, admin(fx), okPath, "my own proposal")

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(own.ID))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if r := reload(t, own.ID); r.Status != entity.CRStatusPending {
		t.Errorf("status = %q after a refused self-approval, want it still pending", r.Status)
	}

	// REJECTING one's own request is allowed — it is withdrawing by another name.
	rec = call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":false,"note":"thought better of it"}`, idParams(own.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("self-rejection: status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if r := reload(t, own.ID); r.Status != entity.CRStatusRejected {
		t.Errorf("status = %q, want %q", r.Status, entity.CRStatusRejected)
	}
}

// A request leaves `pending` exactly once. The second reviewer is told so — they do not overwrite
// the first decision, and an approval does not follow a rejection.
func TestASecondReviewIs409(t *testing.T) {
	fx := testDB(t)
	r := raise(t, raiser(fx), okPath, "reviewed twice")

	if rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":false,"note":"first decision"}`, idParams(r.ID)); rec.Code != http.StatusOK {
		t.Fatalf("first review: status = %d: %s", rec.Code, rec.Body.String())
	}

	for _, c := range []struct{ name, body string }{
		{"approve after reject", `{"approve":true}`},
		{"reject again", `{"approve":false,"note":"second decision"}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, admin2(fx), Review, http.MethodPost, "/change-requests/x/review",
				c.body, idParams(r.ID))
			if rec.Code != http.StatusConflict {
				t.Errorf("status = %d, want 409: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// The first decision stands, note and reviewer included.
	got := reload(t, r.ID)
	if got.Status != entity.CRStatusRejected {
		t.Errorf("status = %q, want it still %q", got.Status, entity.CRStatusRejected)
	}
	if got.ReviewNote != "first decision" || got.ReviewedByID != fx.admin {
		t.Errorf("the second review overwrote the first: note=%q by=%d", got.ReviewNote, got.ReviewedByID)
	}
}

// An expired request cannot be approved — a proposal written against last month's firewall is a
// proposal about a different firewall — and the attempt marks it expired rather than leaving it to
// be offered again tomorrow.
func TestAnExpiredRequestCannotBeApprovedAndIsMarkedExpired(t *testing.T) {
	fx := testDB(t)
	r := raise(t, raiser(fx), okPath, "stale")

	if err := config.DB().Model(&entity.ChangeRequest{}).Where("id = ?", r.ID).
		Update("expires_at", time.Now().Add(-time.Hour)).Error; err != nil {
		t.Fatalf("age the request: %v", err)
	}

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(r.ID))
	if rec.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if got := reload(t, r.ID); got.Status != entity.CRStatusExpired {
		t.Errorf("status = %q, want %q — it would be offered again tomorrow", got.Status, entity.CRStatusExpired)
	}
}

// An approval with no window applies at once: the replay carries the request's own method, path
// and body, and runs as the APPROVER.
//
// The identity matters twice. The firewall's event log should name whoever decided this happens,
// and the access check inside the replayed handler then runs against the approver — so a request
// cannot launder a write past a device the requester may not touch.
func TestApprovingAppliesTheRequestAsTheApprover(t *testing.T) {
	fx := testDB(t)
	stub := withReplayer(t, http.StatusOK, `{"status":"success"}`)
	r := raise(t, raiser(fx), okPath, "apply me")

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true,"note":"looks right"}`, idParams(r.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if stub.count() != 1 {
		t.Fatalf("the replayer was called %d times, want exactly 1", stub.count())
	}
	sent := stub.calls[0]
	if sent.Method != http.MethodPost || sent.URL.Path != okPath {
		t.Errorf("replayed %s %s, want POST %s", sent.Method, sent.URL.Path, okPath)
	}
	if !strings.Contains(stub.bodies[0], `"printer"`) {
		t.Errorf("the replay lost the request body: %q", stub.bodies[0])
	}
	if got := sent.Header.Get(services.InternalApplyEmail); got != "admin@example.test" {
		t.Errorf("replayed as %q, want the approver admin@example.test", got)
	}
	if got := sent.Header.Get(services.InternalApplyRole); got != "admin" {
		t.Errorf("replayed with role %q, want admin", got)
	}

	got := reload(t, r.ID)
	if got.Status != entity.CRStatusApplied {
		t.Errorf("status = %q, want %q", got.Status, entity.CRStatusApplied)
	}
	if got.AppliedAt == nil {
		t.Error("applied_at is nil on an applied request")
	}
	if got.ReviewedByID != fx.admin || got.ReviewedBy != "admin@example.test" || got.ReviewedAt == nil {
		t.Errorf("the approval trail is incomplete: %+v", got)
	}
	// Denormalised on purpose: an approval trail that can be erased by deleting the approver's
	// account is not a trail.
	if got.ReviewNote != "looks right" {
		t.Errorf("review_note = %q", got.ReviewNote)
	}
}

// Approved, and the device refused the write: 207, not 4xx.
//
// The review DID happen and is recorded. Answering 4xx here would read as "your approval failed"
// and the operator would press it again — which, on a write that may have half-landed, is how one
// proposed change becomes two rules.
func TestADeviceRefusalIs207AndTheRequestIsMarkedFailed(t *testing.T) {
	fx := testDB(t)
	withReplayer(t, http.StatusBadRequest, `{"error":"-5 duplicate name"}`)
	r := raise(t, raiser(fx), okPath, "the device will say no")

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(r.ID))
	if rec.Code != http.StatusMultiStatus {
		t.Fatalf("status = %d, want 207: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "-5 duplicate name") {
		t.Errorf("the device's own refusal is not in the reply: %s", rec.Body.String())
	}

	got := reload(t, r.ID)
	if got.Status != entity.CRStatusFailed {
		t.Errorf("status = %q, want %q", got.Status, entity.CRStatusFailed)
	}
	if got.ErrorText == "" {
		t.Error("error_text is empty, so nothing on the page can say why it failed")
	}
	// Terminal: a failed write to a live firewall is a thing a person has to look at, so it is
	// not retried and cannot be reviewed again.
	rec = call(t, admin2(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(r.ID))
	if rec.Code != http.StatusConflict {
		t.Errorf("re-reviewing a failed request: status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
}

// The write could not be attempted at all — no replayer wired up — is 502, and says the approval
// stands.
func TestAnApplyThatCannotBeAttemptedIs502(t *testing.T) {
	fx := testDB(t)
	services.SetChangeRequestReplayer(nil)
	r := raise(t, raiser(fx), okPath, "nothing to replay through")

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(r.ID))
	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "approved") {
		t.Errorf("the reply does not say the approval stands: %s", rec.Body.String())
	}
	// Left `approved`, not `failed`: nothing was sent, so the scheduler's sweep can still pick it
	// up once the replayer is there.
	if got := reload(t, r.ID); got.Status != entity.CRStatusApproved {
		t.Errorf("status = %q, want %q", got.Status, entity.CRStatusApproved)
	}
}

// A maintenance window means the SCHEDULER applies it, not this request — whether the window came
// with the proposal or with the approval.
func TestAWindowDefersTheApply(t *testing.T) {
	fx := testDB(t)
	later := time.Now().Add(6 * time.Hour).UTC().Format(time.RFC3339)

	t.Run("a window set at review time", func(t *testing.T) {
		stub := withReplayer(t, http.StatusOK, "{}")
		r := raise(t, raiser(fx), okPath, "window at review")

		rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
			`{"approve":true,"scheduled_for":"`+later+`"}`, idParams(r.ID))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		if stub.count() != 0 {
			t.Errorf("the write was replayed %d times although a window was set", stub.count())
		}
		got := reload(t, r.ID)
		if got.Status != entity.CRStatusApproved {
			t.Errorf("status = %q, want %q", got.Status, entity.CRStatusApproved)
		}
		if got.ScheduledFor == nil {
			t.Error("scheduled_for was not stored, so the sweep has no window to wait for")
		}
	})

	t.Run("a window set when the request was raised", func(t *testing.T) {
		stub := withReplayer(t, http.StatusOK, "{}")
		body, _ := json.Marshal(map[string]any{
			"reason": "window at raise", "method": http.MethodPost, "path": okPath,
			"scheduled_for": later,
		})
		rec := call(t, raiser(fx), Create, http.MethodPost, "/change-requests", string(body), nil)
		if rec.Code != http.StatusCreated {
			t.Fatalf("raise: status = %d: %s", rec.Code, rec.Body.String())
		}
		var r entity.ChangeRequest
		_ = json.Unmarshal(rec.Body.Bytes(), &r)

		rec = call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
			`{"approve":true}`, idParams(r.ID))
		if rec.Code != http.StatusOK {
			t.Fatalf("review: status = %d: %s", rec.Code, rec.Body.String())
		}
		if stub.count() != 0 {
			t.Errorf("the write was replayed %d times although the proposal carried a window", stub.count())
		}
		if got := reload(t, r.ID); got.Status != entity.CRStatusApproved {
			t.Errorf("status = %q, want %q", got.Status, entity.CRStatusApproved)
		}
	})

	t.Run("a window already in the past applies at once", func(t *testing.T) {
		stub := withReplayer(t, http.StatusOK, "{}")
		r := raise(t, raiser(fx), okPath, "a window that has passed")
		past := time.Now().Add(-time.Hour).UTC().Format(time.RFC3339)

		rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
			`{"approve":true,"scheduled_for":"`+past+`"}`, idParams(r.ID))
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
		}
		if stub.count() != 1 {
			t.Errorf("replayed %d times, want 1 — a window in the past is not a window", stub.count())
		}
	})
}

// A rejection never reaches the device, and keeps the reviewer's note.
func TestARejectionNeverTouchesTheDevice(t *testing.T) {
	fx := testDB(t)
	stub := withReplayer(t, http.StatusOK, "{}")
	r := raise(t, raiser(fx), okPath, "will be rejected")

	rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":false,"note":"this opens the firewall"}`, idParams(r.ID))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if stub.count() != 0 {
		t.Errorf("a rejected request was replayed %d times", stub.count())
	}
	got := reload(t, r.ID)
	if got.Status != entity.CRStatusRejected || got.ReviewNote != "this opens the firewall" {
		t.Errorf("rejection not recorded: status=%q note=%q", got.Status, got.ReviewNote)
	}
	if got.AppliedAt != nil {
		t.Error("applied_at is set on a rejected request")
	}
}

// The review endpoint's own input checks, with the admin gate already passed.
func TestReviewRefusesABadIdOrBody(t *testing.T) {
	fx := testDB(t)
	withReplayer(t, http.StatusOK, "{}")
	r := raise(t, raiser(fx), okPath, "well formed")

	for _, c := range []struct {
		name string
		id   string
		body string
		want int
	}{
		{"a non-numeric id", "abc", `{"approve":true}`, http.StatusBadRequest},
		{"no id", "", `{"approve":true}`, http.StatusBadRequest},
		{"a body that is not json", strconv.FormatUint(uint64(r.ID), 10), `{`, http.StatusBadRequest},
		// A request nobody has is a 404, the same answer Get and Withdraw give for that id. This
		// used to be a 500 — the service's First() failure is not one of the three conflicts, so
		// it fell through to the default — and a reviewer was told the server had broken.
		{"an id nobody has", "999999", `{"approve":true}`, http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
				c.body, gin.Params{{Key: "id", Value: c.id}})
			if rec.Code != c.want {
				t.Errorf("status = %d, want %d: %s", rec.Code, c.want, rec.Body.String())
			}
		})
	}

	if got := reload(t, r.ID); got.Status != entity.CRStatusPending {
		t.Errorf("status = %q — a refused review changed the request", got.Status)
	}
}

// ── Withdrawing ──────────────────────────────────────────────────────────────

// Only the requester may withdraw, and only while it is still pending.
//
// Once a reviewer has approved it, withdrawing is a change of mind the reviewer should see — so it
// goes through a new request rather than a quiet retraction.
func TestOnlyTheRequesterMayWithdrawAndOnlyWhilePending(t *testing.T) {
	fx := testDB(t)
	r := raise(t, raiser(fx), okPath, "mine to withdraw")

	// Not even an admin — this is not an authorisation level, it is whose proposal it is.
	if rec := call(t, admin(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(r.ID)); rec.Code != http.StatusForbidden {
		t.Errorf("admin withdrawing someone else's request: status = %d, want 403: %s", rec.Code, rec.Body.String())
	}
	if got := reload(t, r.ID); got.Status != entity.CRStatusPending {
		t.Fatalf("status = %q after a refused withdrawal", got.Status)
	}

	if rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(r.ID)); rec.Code != http.StatusOK {
		t.Fatalf("the requester's own withdrawal: status = %d: %s", rec.Code, rec.Body.String())
	}
	if got := reload(t, r.ID); got.Status != entity.CRStatusWithdrawn {
		t.Errorf("status = %q, want %q", got.Status, entity.CRStatusWithdrawn)
	}

	// A second withdrawal is 409: it is no longer pending.
	if rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(r.ID)); rec.Code != http.StatusConflict {
		t.Errorf("second withdrawal: status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
}

// An approved request can no longer be withdrawn, and a withdrawn one can no longer be approved —
// both terminals hold from both directions.
func TestAnApprovedRequestCannotBeWithdrawn(t *testing.T) {
	fx := testDB(t)
	stub := withReplayer(t, http.StatusOK, "{}")
	r := raise(t, raiser(fx), okPath, "approved then withdrawn")
	later := time.Now().Add(6 * time.Hour).UTC().Format(time.RFC3339)

	// A window keeps it in `approved` rather than running to `applied`, which is the state the
	// requester might plausibly still try to withdraw from.
	if rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true,"scheduled_for":"`+later+`"}`, idParams(r.ID)); rec.Code != http.StatusOK {
		t.Fatalf("approve: status = %d: %s", rec.Code, rec.Body.String())
	}

	if rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(r.ID)); rec.Code != http.StatusConflict {
		t.Errorf("withdrawing an approved request: status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if got := reload(t, r.ID); got.Status != entity.CRStatusApproved {
		t.Errorf("status = %q, want it still %q", got.Status, entity.CRStatusApproved)
	}

	// The other direction: a withdrawn request cannot then be approved.
	w := raise(t, raiser(fx), okPath, "withdrawn then approved")
	if rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(w.ID)); rec.Code != http.StatusOK {
		t.Fatalf("withdraw: status = %d: %s", rec.Code, rec.Body.String())
	}
	before := stub.count()
	if rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(w.ID)); rec.Code != http.StatusConflict {
		t.Errorf("approving a withdrawn request: status = %d, want 409: %s", rec.Code, rec.Body.String())
	}
	if stub.count() != before {
		t.Error("a withdrawn request was replayed to the device")
	}
}

// Withdraw's own input checks.
func TestWithdrawRefusesABadId(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct {
		name string
		id   string
		want int
	}{
		{"a non-numeric id", "abc", http.StatusBadRequest},
		{"no id", "", http.StatusBadRequest},
		{"an id nobody has", "999999", http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
				gin.Params{{Key: "id", Value: c.id}})
			if rec.Code != c.want {
				t.Errorf("status = %d, want %d: %s", rec.Code, c.want, rec.Body.String())
			}
		})
	}
}

// A database fault is a 500 on both doors, and a missing row is a 404 — the distinction both
// handlers used to blur in opposite directions. Review sent every First() failure to 500, so an id
// nobody had read as a broken server; Withdraw sent every failure to 404, so a broken database read
// as "your request is gone". The table is dropped here to produce a failure that is neither a
// conflict nor a missing row, which is the only honest way to reach the default branch; testDB()
// re-runs AutoMigrate, so the next test gets the table back.
func TestADatabaseFaultIsNotAMissingRequest(t *testing.T) {
	fx := testDB(t)
	r := raise(t, raiser(fx), okPath, "a request that outlives its table")

	if err := config.DB().Migrator().DropTable(&entity.ChangeRequest{}); err != nil {
		t.Fatalf("drop change_requests: %v", err)
	}
	t.Cleanup(func() {
		if err := config.DB().AutoMigrate(&entity.ChangeRequest{}); err != nil {
			t.Fatalf("restore change_requests: %v", err)
		}
	})

	if rec := call(t, admin(fx), Review, http.MethodPost, "/change-requests/x/review",
		`{"approve":true}`, idParams(r.ID)); rec.Code != http.StatusInternalServerError {
		t.Errorf("review with no table: status = %d, want 500: %s", rec.Code, rec.Body.String())
	}
	if rec := call(t, raiser(fx), Withdraw, http.MethodPost, "/change-requests/x/withdraw", "",
		idParams(r.ID)); rec.Code != http.StatusInternalServerError {
		t.Errorf("withdraw with no table: status = %d, want 500: %s", rec.Code, rec.Body.String())
	}
}
