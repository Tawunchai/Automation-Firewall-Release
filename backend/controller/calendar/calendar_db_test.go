package calendar

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"network_automation/config"
	"network_automation/entity"

	"github.com/gin-gonic/gin"
)

// The Apps > Calendar endpoints, against a real database. The package had NO tests at all.
//
// What makes this package worth covering is not the feature — it is a notes calendar — but the
// shape of it: four handlers, each taking an `id` straight off the URL, each belonging to one
// person. That is the exact shape of the IDOR this repo already shipped once in controller/user.
// Every case below that mentions "someone else's event" is there because of that incident.
//
// Skipped unless CALENDAR_DB_TEST_DSN names a database it may freely create tables in and empty.
// Point it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55436:5432 -e POSTGRES_PASSWORD=test --name g1-pg postgres:16-alpine
//	CALENDAR_DB_TEST_DSN="host=localhost port=55436 user=postgres password=test dbname=calendar_test sslmode=disable" \
//	  go test ./controller/calendar/ -v

type fixture struct {
	alice   uint // owns the two seeded events
	bob     uint // owns none
	morning uint // alice's, earlier
	evening uint // alice's, later
}

func testDB(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("CALENDAR_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("CALENDAR_DB_TEST_DSN not set — see the note at the top of calendar_db_test.go")
	}
	gin.SetMode(gin.TestMode)

	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB")
	}
	if err := db.AutoMigrate(&entity.AppRole{}, &entity.AppUser{}, &entity.CalendarEvent{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Children first: calendar_events holds a foreign key into app_users.
	for _, table := range []string{"calendar_events", "app_users", "app_roles"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	role := entity.AppRole{Role: "user"}
	if err := db.Create(&role).Error; err != nil {
		t.Fatalf("seed role: %v", err)
	}
	// AppUserID is `not null` with an index and a real foreign key, so the owners have to exist
	// before their events do.
	users := []entity.AppUser{
		{Email: "alice@example.test", Password: "x", FirstName: "Alice", LastName: "A", AppRoleID: role.ID},
		{Email: "bob@example.test", Password: "x", FirstName: "Bob", LastName: "B", AppRoleID: role.ID},
	}
	if err := db.Create(&users).Error; err != nil {
		t.Fatalf("seed users: %v", err)
	}

	day := time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	events := []entity.CalendarEvent{
		{
			Title: "Evening change window", StartDate: day.Add(20 * time.Hour),
			EndDate: day.Add(22 * time.Hour), Category: "office", Color: "#111111",
			AppUserID: users[0].ID,
		},
		{
			Title: "Morning standup", StartDate: day.Add(9 * time.Hour),
			EndDate: day.Add(9*time.Hour + 15*time.Minute), Category: "calendar", Color: "#222222",
			AppUserID: users[0].ID,
		},
	}
	if err := db.Create(&events).Error; err != nil {
		t.Fatalf("seed events: %v", err)
	}

	return &fixture{alice: users[0].ID, bob: users[1].ID, morning: events[1].ID, evening: events[0].ID}
}

// call runs a handler as a given user. userID 0 means no authenticated user on the context, which
// is what a route reached without the auth middleware looks like.
func call(t *testing.T, userID uint, handler gin.HandlerFunc, method, body, idParam string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/calendar/events", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if userID != 0 {
		c.Set("user_id", userID)
	}
	if idParam != "" {
		c.Params = gin.Params{{Key: "id", Value: idParam}}
	}
	handler(c)
	return rec
}

func decodeList(t *testing.T, rec *httptest.ResponseRecorder) []EventResponse {
	t.Helper()
	var body struct {
		Data []EventResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v — %s", err, rec.Body.String())
	}
	return body.Data
}

func decodeOne(t *testing.T, rec *httptest.ResponseRecorder) EventResponse {
	t.Helper()
	var body struct {
		Data EventResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v — %s", err, rec.Body.String())
	}
	return body.Data
}

func countEvents(t *testing.T, ownerID uint) int64 {
	t.Helper()
	var n int64
	config.DB().Model(&entity.CalendarEvent{}).Where("app_user_id = ?", ownerID).Count(&n)
	return n
}

// No user on the context is 401 on all four handlers — and it is answered BEFORE the body is read
// or the id is parsed, so an unauthenticated request cannot reach the database at all.
func TestEveryHandlerRefusesAnUnauthenticatedCaller(t *testing.T) {
	fx := testDB(t)
	id := strconv.FormatUint(uint64(fx.morning), 10)

	for _, c := range []struct {
		name    string
		handler gin.HandlerFunc
		method  string
		body    string
		id      string
	}{
		{"list", ListEvents, http.MethodGet, "", ""},
		{"create", CreateEvent, http.MethodPost, `{"title":"x","start_date":"2026-11-18","end_date":"2026-11-18","category":"other"}`, ""},
		{"update", UpdateEvent, http.MethodPut, `{"title":"x","start_date":"2026-11-18","end_date":"2026-11-18","category":"other"}`, id},
		{"delete", DeleteEvent, http.MethodDelete, "", id},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, 0, c.handler, c.method, c.body, c.id)
			if rec.Code != http.StatusUnauthorized {
				t.Errorf("status = %d, want 401: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// Nothing was created and nothing was removed by any of them.
	if n := countEvents(t, fx.alice); n != 2 {
		t.Errorf("alice has %d events after four unauthenticated calls, want the seeded 2", n)
	}
}

// user_id arriving as anything but a uint — the type the auth middleware sets — is also 401.
//
// This is a cheap case with an expensive failure: getUserID returns (0, false) on a type mismatch,
// and had it returned (0, true) instead, every handler would have run scoped to app_user_id = 0,
// which matches no row — a silent empty calendar rather than a refusal.
func TestAUserIDOfTheWrongTypeIsNotAUser(t *testing.T) {
	testDB(t)

	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/calendar/events", nil)
	c.Set("user_id", "1") // a string, not a uint
	ListEvents(c)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401: %s", rec.Code, rec.Body.String())
	}
}

// The list is one person's calendar, ordered the way a calendar is read.
func TestListReturnsOnlyTheCallersOwnEventsEarliestFirst(t *testing.T) {
	fx := testDB(t)

	rec := call(t, fx.alice, ListEvents, http.MethodGet, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := decodeList(t, rec)
	if len(got) != 2 {
		t.Fatalf("%d events, want 2: %s", len(got), rec.Body.String())
	}
	// Seeded deliberately out of order: the evening event was inserted first, so a handler that
	// returned insertion order would pass a length check and still show the day backwards.
	if got[0].Title != "Morning standup" || got[1].Title != "Evening change window" {
		t.Errorf("events are not ordered by start_date: %q then %q", got[0].Title, got[1].Title)
	}
	// RFC3339 both ways — the browser parses these strings directly.
	if _, err := time.Parse(time.RFC3339, got[0].StartDate); err != nil {
		t.Errorf("start_date %q is not RFC3339: %v", got[0].StartDate, err)
	}

	// Bob owns nothing, and must be told that as an empty list rather than shown Alice's day.
	rec = call(t, fx.bob, ListEvents, http.MethodGet, "", "")
	if rec.Code != http.StatusOK {
		t.Fatalf("bob: status = %d: %s", rec.Code, rec.Body.String())
	}
	if got := decodeList(t, rec); len(got) != 0 {
		t.Errorf("bob sees %d events, want 0 — the list is not scoped to the caller", len(got))
	}
	// And an empty calendar is `[]`, not `null`: the page maps over this without a guard.
	if !strings.Contains(rec.Body.String(), "[]") {
		t.Errorf("an empty calendar serialised as %s, want an empty array", rec.Body.String())
	}
}

// An event is created owned by the CALLER. Nothing in the request body can say otherwise — the
// body has no owner field at all, which is the design, and this records it.
func TestCreateStoresTheEventAgainstTheCaller(t *testing.T) {
	fx := testDB(t)

	rec := call(t, fx.bob, CreateEvent, http.MethodPost,
		`{"title":"Firmware upgrade","description":"80E","start_date":"2026-12-01T22:00:00Z",`+
			`"end_date":"2026-12-02T02:00:00Z","all_day":false,"category":"office","color":"#ABCDEF",`+
			`"app_user_id":1,"AppUserID":1}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201: %s", rec.Code, rec.Body.String())
	}
	got := decodeOne(t, rec)
	if got.ID == 0 {
		t.Error("the reply has no id, so the page cannot edit what it just created")
	}
	if got.Title != "Firmware upgrade" || got.Color != "#ABCDEF" || got.Category != "office" {
		t.Errorf("the reply does not describe what was asked for: %+v", got)
	}

	var stored entity.CalendarEvent
	if err := config.DB().First(&stored, got.ID).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	// The two owner-shaped keys in the body above are ignored: EventRequest has no such field,
	// so they cannot move an event into someone else's calendar.
	if stored.AppUserID != fx.bob {
		t.Errorf("stored owner = %d, want the caller %d — the body chose the owner", stored.AppUserID, fx.bob)
	}
	if n := countEvents(t, fx.alice); n != 2 {
		t.Errorf("alice's calendar changed to %d events when bob created one", n)
	}
}

// A create with no colour gets the default rather than an empty string, because the page paints
// the event with whatever comes back and an empty colour renders as an invisible block.
func TestCreateFillsInTheDefaultColour(t *testing.T) {
	fx := testDB(t)

	rec := call(t, fx.bob, CreateEvent, http.MethodPost,
		`{"title":"No colour","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`, "")
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if got := decodeOne(t, rec); got.Color != "#7C3AED" {
		t.Errorf("color = %q, want the default #7C3AED", got.Color)
	}
}

// The four date formats the handler accepts, and the ones it must not.
//
// A bare "2006-01-02" is the format the date picker sends for an all-day event; RFC3339 is what it
// sends otherwise. Accepting a format the picker does not send is harmless; REJECTING one it does
// send makes the form unusable, which is why all four are pinned here.
func TestTheAcceptedDateFormats(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct {
		name  string
		start string
		want  int
	}{
		{"a date only", "2026-12-01", http.StatusCreated},
		{"RFC3339 with a zone", "2026-12-01T22:00:00+07:00", http.StatusCreated},
		{"RFC3339 in UTC", "2026-12-01T22:00:00Z", http.StatusCreated},
		{"no zone at all", "2026-12-01T22:00:00", http.StatusCreated},
		{"a day/month/year", "01/12/2026", http.StatusBadRequest},
		{"words", "next tuesday", http.StatusBadRequest},
		{"a unix timestamp", "1796000000", http.StatusBadRequest},
		{"the 31st of February", "2026-02-31", http.StatusBadRequest},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, fx.bob, CreateEvent, http.MethodPost,
				`{"title":"t","start_date":"`+c.start+`","end_date":"2026-12-01","category":"other"}`, "")
			if rec.Code != c.want {
				t.Errorf("start_date %q: status = %d, want %d: %s", c.start, rec.Code, c.want, rec.Body.String())
			}
		})
	}
}

// What the create form must supply, and what the entity's own validator rejects on top of it.
func TestCreateRefusesAnIncompleteOrInvalidEvent(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct{ name, body string }{
		{"no title", `{"start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`},
		{"an empty title", `{"title":"","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`},
		{"no start", `{"title":"t","end_date":"2026-12-01","category":"other"}`},
		{"no end", `{"title":"t","start_date":"2026-12-01","category":"other"}`},
		{"no category", `{"title":"t","start_date":"2026-12-01","end_date":"2026-12-01"}`},
		// The category list lives on the entity as a govalidator `in(...)` rule, so an unknown one
		// is caught after binding rather than by it. Both paths have to answer 400.
		{"a category nobody renders", `{"title":"t","start_date":"2026-12-01","end_date":"2026-12-01","category":"maintenance"}`},
		{"not json", `{`},
		{"a bare string", `"event"`},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, fx.bob, CreateEvent, http.MethodPost, c.body, "")
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}

	if n := countEvents(t, fx.bob); n != 0 {
		t.Errorf("%d events were created by requests that were all refused", n)
	}
}

// Updating and deleting SOMEONE ELSE'S event is 404, not 403 and not 200.
//
// This is the case the whole file exists for. The id comes off the URL, and the only thing standing
// between Bob and Alice's calendar is `AND app_user_id = ?` in both lookups. 404 rather than 403 is
// also correct here: 403 would confirm that the id exists, which is a thing Bob should not learn.
func TestOneUserCannotTouchAnothersEvent(t *testing.T) {
	fx := testDB(t)
	id := strconv.FormatUint(uint64(fx.morning), 10)

	rec := call(t, fx.bob, UpdateEvent, http.MethodPut,
		`{"title":"hijacked","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`, id)
	if rec.Code != http.StatusNotFound {
		t.Errorf("update: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}

	if rec := call(t, fx.bob, DeleteEvent, http.MethodDelete, "", id); rec.Code != http.StatusNotFound {
		t.Errorf("delete: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}

	// Alice's event is untouched, by title and by count — a 404 that had already written would
	// pass the status assertions above.
	var stored entity.CalendarEvent
	if err := config.DB().First(&stored, fx.morning).Error; err != nil {
		t.Fatalf("alice's event is gone: %v", err)
	}
	if stored.Title != "Morning standup" {
		t.Errorf("alice's event is now titled %q — the refused update was applied", stored.Title)
	}
	if n := countEvents(t, fx.alice); n != 2 {
		t.Errorf("alice has %d events, want 2", n)
	}
}

// The owner's own update replaces the fields it names and leaves the colour alone when it is empty.
func TestTheOwnerCanUpdateTheirEvent(t *testing.T) {
	fx := testDB(t)
	id := strconv.FormatUint(uint64(fx.morning), 10)

	rec := call(t, fx.alice, UpdateEvent, http.MethodPut,
		`{"title":"Standup (moved)","description":"now at ten","start_date":"2026-11-18T10:00:00Z",`+
			`"end_date":"2026-11-18T10:15:00Z","all_day":false,"category":"calendar"}`, id)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := decodeOne(t, rec)
	if got.Title != "Standup (moved)" || got.Description != "now at ten" {
		t.Errorf("the reply does not show the update: %+v", got)
	}
	// An omitted colour keeps the stored one. The request above sends none, and the page relies on
	// this: its edit dialog does not always include the swatch.
	if got.Color != "#222222" {
		t.Errorf("color = %q — an empty colour in the body cleared the stored one; want #222222", got.Color)
	}

	var stored entity.CalendarEvent
	if err := config.DB().First(&stored, fx.morning).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	if !stored.StartDate.UTC().Equal(time.Date(2026, 11, 18, 10, 0, 0, 0, time.UTC)) {
		t.Errorf("stored start = %s, want 10:00Z", stored.StartDate.UTC())
	}
	// The update must not move the event to whoever sent it, now or ever: Save() writes every
	// column, so an owner field reset to the caller would be invisible in the reply.
	if stored.AppUserID != fx.alice {
		t.Errorf("stored owner = %d, want %d", stored.AppUserID, fx.alice)
	}
}

// An update whose BODY is bad must not have already moved the event.
//
// UpdateEvent loads the row, then binds, then parses the dates. The order matters: the row is in
// memory before the body is known to be valid, and a Save() placed above those checks would write
// a half-built event. Each case below is a different point in that sequence.
func TestARefusedUpdateLeavesTheEventAsItWas(t *testing.T) {
	fx := testDB(t)
	id := strconv.FormatUint(uint64(fx.morning), 10)

	for _, c := range []struct {
		name string
		body string
		want int
	}{
		{"not json", `{`, http.StatusBadRequest},
		{"no title", `{"start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`, http.StatusBadRequest},
		{"a bad start date", `{"title":"t","start_date":"tuesday","end_date":"2026-12-01","category":"other"}`, http.StatusBadRequest},
		{"a bad end date", `{"title":"t","start_date":"2026-12-01","end_date":"tuesday","category":"other"}`, http.StatusBadRequest},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, fx.alice, UpdateEvent, http.MethodPut, c.body, id)
			if rec.Code != c.want {
				t.Errorf("status = %d, want %d: %s", rec.Code, c.want, rec.Body.String())
			}
		})
	}

	var stored entity.CalendarEvent
	if err := config.DB().First(&stored, fx.morning).Error; err != nil {
		t.Fatalf("read back: %v", err)
	}
	if stored.Title != "Morning standup" || stored.Color != "#222222" {
		t.Errorf("a refused update changed the event: %+v", stored)
	}
}

// An id that is not a number is 400; a number nobody owns is 404. Both handlers, because they
// parse it separately.
func TestAnIdThatIsNotAnEventIsRefused(t *testing.T) {
	testDB(t)
	body := `{"title":"t","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`

	for _, c := range []struct {
		name string
		id   string
		want int
	}{
		{"not a number", "abc", http.StatusBadRequest},
		{"empty", "", http.StatusBadRequest},
		{"a sql fragment", "1 OR 1=1", http.StatusBadRequest},
		{"an id nobody has", "999999", http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			// id "" would normally mean "no param at all"; set it explicitly so the handler sees
			// an empty string, which is what a route like /events/ delivers.
			rec := httptest.NewRecorder()
			ctx, _ := gin.CreateTestContext(rec)
			ctx.Request = httptest.NewRequest(http.MethodPut, "/calendar/events/x", strings.NewReader(body))
			ctx.Request.Header.Set("Content-Type", "application/json")
			ctx.Set("user_id", uint(1))
			ctx.Params = gin.Params{{Key: "id", Value: c.id}}
			UpdateEvent(ctx)
			if rec.Code != c.want {
				t.Errorf("update id=%q: status = %d, want %d: %s", c.id, rec.Code, c.want, rec.Body.String())
			}

			rec2 := httptest.NewRecorder()
			ctx2, _ := gin.CreateTestContext(rec2)
			ctx2.Request = httptest.NewRequest(http.MethodDelete, "/calendar/events/x", nil)
			ctx2.Set("user_id", uint(1))
			ctx2.Params = gin.Params{{Key: "id", Value: c.id}}
			DeleteEvent(ctx2)
			if rec2.Code != c.want {
				t.Errorf("delete id=%q: status = %d, want %d: %s", c.id, rec2.Code, c.want, rec2.Body.String())
			}
		})
	}
}

// Deleting removes the event from the owner's calendar and cannot be done twice.
//
// It is a SOFT delete (the entity embeds gorm.Model), which is why the second attempt is a 404
// rather than a 200 doing nothing: the row is still there, and only the default scope hides it.
func TestTheOwnerCanDeleteTheirEventOnce(t *testing.T) {
	fx := testDB(t)
	id := strconv.FormatUint(uint64(fx.evening), 10)

	rec := call(t, fx.alice, DeleteEvent, http.MethodDelete, "", id)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	if n := countEvents(t, fx.alice); n != 1 {
		t.Errorf("alice has %d events after one delete, want 1", n)
	}
	// Gone from the list, which is the only place the page looks.
	for _, e := range decodeList(t, call(t, fx.alice, ListEvents, http.MethodGet, "", "")) {
		if e.ID == fx.evening {
			t.Error("the deleted event is still in the list")
		}
	}
	// A second delete is 404, not a second 200.
	if rec := call(t, fx.alice, DeleteEvent, http.MethodDelete, "", id); rec.Code != http.StatusNotFound {
		t.Errorf("second delete: status = %d, want 404: %s", rec.Code, rec.Body.String())
	}
}

// A database that cannot answer is reported as a 500, not a panic.
//
// All four handlers have an error branch on their query that nothing else in this file reaches,
// and an unhandled error here would take the whole process down rather than one request: these
// handlers run on the same gin engine as every device-proxy route.
//
// The table is dropped to produce the failure and re-created afterwards, so the suite's own
// fixtures survive for whatever runs next in this package.
func TestADatabaseErrorIsAnswered(t *testing.T) {
	fx := testDB(t)
	db := config.DB()
	id := strconv.FormatUint(uint64(fx.morning), 10)

	if err := db.Migrator().DropTable(&entity.CalendarEvent{}); err != nil {
		t.Fatalf("drop calendar_events: %v", err)
	}
	t.Cleanup(func() {
		if err := db.AutoMigrate(&entity.CalendarEvent{}); err != nil {
			t.Fatalf("restore calendar_events: %v", err)
		}
	})

	for _, c := range []struct {
		name    string
		handler gin.HandlerFunc
		method  string
		body    string
		id      string
		want    int
	}{
		{"list", ListEvents, http.MethodGet, "", "", http.StatusInternalServerError},
		{"create", CreateEvent, http.MethodPost,
			`{"title":"t","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`, "",
			http.StatusInternalServerError},
		// Update and delete read the row first, so a missing table is indistinguishable from a
		// missing event there — 404 is the honest answer, and the point is that it is AN answer.
		{"update", UpdateEvent, http.MethodPut,
			`{"title":"t","start_date":"2026-12-01","end_date":"2026-12-01","category":"other"}`, id,
			http.StatusNotFound},
		{"delete", DeleteEvent, http.MethodDelete, "", id, http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("the handler panicked instead of answering: %v", r)
				}
			}()
			rec := call(t, fx.alice, c.handler, c.method, c.body, c.id)
			if rec.Code != c.want {
				t.Errorf("status = %d, want %d: %s", rec.Code, c.want, rec.Body.String())
			}
		})
	}
}
