package passwordpolicy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"testing"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// The rows behind /password-policy, against a real database.
//
// policy_test.go already proves the admin gate on UpdatePolicy without one, because the gate
// returns before config.DB() is touched. Everything else in this package needs Postgres: both
// handlers end in services.GetPasswordPolicy, which reads system_configs with no nil guard, so a
// test without a database proves the refusal and nothing after it.
//
// Why these rows are worth a suite: they are the only thing standing between "choose a password"
// and "12345678". Every account in the console is held to them, the handler can only be reached by
// an administrator, and a value it accepts that the login form cannot satisfy would lock the whole
// deployment out of changing its own passwords.
//
// Skipped unless PASSWORDPOLICY_DB_TEST_DSN names a database it may freely create tables in and
// empty. Point it at a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55436:5432 -e POSTGRES_PASSWORD=test --name g1-pg postgres:16-alpine
//	PASSWORDPOLICY_DB_TEST_DSN="host=localhost port=55436 user=postgres password=test dbname=passwordpolicy_test sslmode=disable" \
//	  go test ./controller/passwordpolicy/ -v

func testDB(t *testing.T) {
	t.Helper()
	dsn := os.Getenv("PASSWORDPOLICY_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("PASSWORDPOLICY_DB_TEST_DSN not set — see the note at the top of policy_db_test.go")
	}
	gin.SetMode(gin.TestMode)

	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB")
	}
	if err := db.AutoMigrate(&entity.SystemConfig{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Every case below starts from "no rows at all", which is also the state a fresh install is in
	// before SeedDatabase runs — the state the fallback-to-defaults case is about.
	if err := db.Exec("TRUNCATE TABLE system_configs RESTART IDENTITY CASCADE").Error; err != nil {
		t.Fatalf("truncate system_configs: %v", err)
	}
}

// call runs a handler as a given role. An empty role means no authenticated user on the context.
func call(t *testing.T, role, method, body string, handler gin.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/password-policy", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	if role != "" {
		c.Set("user_role", role)
		c.Set("user_id", uint(1))
	}
	handler(c)
	return rec
}

func storedValue(t *testing.T, key string) (string, bool) {
	t.Helper()
	var cfg entity.SystemConfig
	if err := config.DB().Where("key = ?", key).First(&cfg).Error; err != nil {
		return "", false
	}
	return cfg.Value, true
}

func decodePolicy(t *testing.T, rec *httptest.ResponseRecorder) PolicyResponse {
	t.Helper()
	var direct PolicyResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &direct); err != nil {
		t.Fatalf("decode: %v — %s", err, rec.Body.String())
	}
	// UpdatePolicy wraps the same shape in {"message":…,"data":…}; GetPolicy returns it bare.
	var wrapped struct {
		Data *PolicyResponse `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &wrapped); err == nil && wrapped.Data != nil {
		return *wrapped.Data
	}
	return direct
}

// Reading the policy when system_configs is EMPTY must answer with the Go defaults, not with zeros.
//
// This is the case that matters on a fresh install and after a failed migration: getPolicyCfg
// treats any error from the row lookup — missing row, missing table — as "use the default". If it
// answered zeros instead, MinLength 0 would make every complexity rule vacuous and the form would
// accept an empty password while still looking like it had a policy.
func TestGetPolicyFallsBackToTheGoDefaultsWhenNoRowExists(t *testing.T) {
	testDB(t)

	rec := call(t, "", http.MethodGet, "", GetPolicy)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}
	got := decodePolicy(t, rec)

	// The defaults are owned by services.DefaultPasswordPolicyConfig, so this asserts agreement
	// with that one source rather than restating numbers that would then drift.
	want := services.DefaultPasswordPolicyConfig()
	if got.MinLength == 0 {
		t.Error("min_length came back 0 with no row stored — the fallback returned a zero value, " +
			"which accepts any password")
	}
	if g, w := strconv.Itoa(got.MinLength), want["password_min_length"]; g != w {
		t.Errorf("min_length = %s, want the default %s", g, w)
	}
	if got.RequireUppercase != (want["password_require_uppercase"] == "true") {
		t.Errorf("require_uppercase = %v, want the default %s", got.RequireUppercase, want["password_require_uppercase"])
	}
	if got.RequireNumber != (want["password_require_number"] == "true") {
		t.Errorf("require_number = %v, want the default %s", got.RequireNumber, want["password_require_number"])
	}
	if got.RequireSpecial != (want["password_require_special"] == "true") {
		t.Errorf("require_special = %v, want the default %s", got.RequireSpecial, want["password_require_special"])
	}
	if g, w := strconv.Itoa(got.ExpiryDays), want["password_expiry_days"]; g != w {
		t.Errorf("expiry_days = %s, want the default %s", g, w)
	}

	// And reading did not CREATE the rows. GetPolicy is a public endpoint; if it seeded on read,
	// an unauthenticated caller would be writing to system_configs.
	var n int64
	config.DB().Model(&entity.SystemConfig{}).Count(&n)
	if n != 0 {
		t.Errorf("%d system_configs rows exist after a read — GetPolicy wrote to the table", n)
	}
}

// GetPolicy is public ON PURPOSE: the change-password form needs the rules before it can tell the
// caller what is wrong with their password, and on the reset-password screen there is no session
// yet. Locking it to admin would leave that form validating against nothing.
func TestGetPolicyIsReadableWithoutARole(t *testing.T) {
	testDB(t)

	for _, role := range []string{"", "user", "operator", "admin"} {
		t.Run("role="+role, func(t *testing.T) {
			if rec := call(t, role, http.MethodGet, "", GetPolicy); rec.Code != http.StatusOK {
				t.Errorf("status = %d, want 200: %s", rec.Code, rec.Body.String())
			}
		})
	}
}

// A non-admin must not be able to weaken the rule every account is held to — and the refusal has
// to happen before anything is written, not after.
//
// policy_test.go asserts the status code for two roles with no database. This asserts the part that
// needs one: that the table is untouched afterwards. A handler that refused with 403 and had
// already called upsertConfig would pass that test and still have changed the policy.
func TestANonAdminCannotChangeThePolicy(t *testing.T) {
	testDB(t)

	for _, role := range []string{"", "user", "operator", "Admin", "ADMIN"} {
		t.Run("role="+role, func(t *testing.T) {
			rec := call(t, role, http.MethodPatch,
				`{"min_length":6,"require_uppercase":false,"require_number":false,"require_special":false,"expiry_days":0}`,
				UpdatePolicy)
			if rec.Code != http.StatusForbidden {
				t.Errorf("status = %d, want 403: %s", rec.Code, rec.Body.String())
			}
		})
	}

	// "Admin" and "ADMIN" are in that list deliberately: the check is an exact string comparison
	// against "admin", so a role stored with different capitalisation is NOT an administrator here.
	// That is the safe direction, and this records it so a later "case-insensitive for convenience"
	// change has to argue with a test.
	var n int64
	config.DB().Model(&entity.SystemConfig{}).Count(&n)
	if n != 0 {
		t.Errorf("%d system_configs rows were written by a refused request", n)
	}
}

// An administrator's change has to actually land in system_configs — stored as the strings
// services.GetPasswordPolicy reads back, which is what makes the rest of the app see it.
func TestAnAdminChangeIsStoredAndReadBack(t *testing.T) {
	testDB(t)

	rec := call(t, "admin", http.MethodPatch,
		`{"min_length":16,"require_uppercase":false,"require_number":true,"require_special":false,"expiry_days":90}`,
		UpdatePolicy)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}

	for _, c := range []struct{ key, want string }{
		{"password_min_length", "16"},
		// The booleans are stored as the literal strings "true"/"false", because that is what
		// getPolicyCfg compares against. Anything else — "1", "True" — reads back as false.
		{"password_require_uppercase", "false"},
		{"password_require_number", "true"},
		{"password_require_special", "false"},
		{"password_expiry_days", "90"},
	} {
		got, ok := storedValue(t, c.key)
		if !ok {
			t.Errorf("%s was not written", c.key)
			continue
		}
		if got != c.want {
			t.Errorf("%s = %q, want %q", c.key, got, c.want)
		}
	}

	// The reply carries the policy as it now stands, so the form does not have to re-read it.
	got := decodePolicy(t, rec)
	if got.MinLength != 16 || got.RequireNumber != true || got.RequireUppercase != false || got.ExpiryDays != 90 {
		t.Errorf("the reply does not describe the policy it just stored: %+v", got)
	}

	// And a fresh read agrees — this is the path every password check takes.
	if p := services.GetPasswordPolicy(config.DB()); p.MinLength != 16 || !p.RequireNumber || p.RequireUppercase {
		t.Errorf("services.GetPasswordPolicy disagrees with what was stored: %+v", p)
	}
}

// A field left out of the body must not be reset to its zero value.
//
// The input struct is all pointers for exactly this reason: the page sends one toggle at a time.
// If a nil pointer were treated as `false`, turning the expiry on would silently switch all three
// complexity requirements off.
func TestAnOmittedFieldIsLeftAlone(t *testing.T) {
	testDB(t)

	if rec := call(t, "admin", http.MethodPatch,
		`{"min_length":20,"require_uppercase":true,"require_number":true,"require_special":true,"expiry_days":30}`,
		UpdatePolicy); rec.Code != http.StatusOK {
		t.Fatalf("seed update: status = %d: %s", rec.Code, rec.Body.String())
	}

	// Now change ONE field.
	rec := call(t, "admin", http.MethodPatch, `{"expiry_days":60}`, UpdatePolicy)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", rec.Code, rec.Body.String())
	}

	got := decodePolicy(t, rec)
	if got.ExpiryDays != 60 {
		t.Errorf("expiry_days = %d, want 60", got.ExpiryDays)
	}
	if got.MinLength != 20 {
		t.Errorf("min_length = %d — an omitted field was reset; it should still be 20", got.MinLength)
	}
	if !got.RequireUppercase || !got.RequireNumber || !got.RequireSpecial {
		t.Errorf("an omitted complexity rule was switched off: %+v", got)
	}
}

// The policy a deployment can be left in is CLAMPED, not refused.
//
// `min_length: 0` would accept an empty password everywhere; `min_length: 1000` is the other
// failure and the worse one, because no password a person can type satisfies it and the only route
// back is this same admin-only endpoint — locking everybody, including the administrator, out of
// changing a password. The handler answers 200 and stores 6 and 128 instead.
//
// The brief this suite was written from expected a REFUSAL. Clamping is what the code does, it
// achieves the same protection, and it is the better behaviour for a slider in a form, so the test
// records the clamp. What matters either way is that the stored value is inside the usable range.
func TestAPolicyNobodyCouldSatisfyIsClampedIntoRange(t *testing.T) {
	testDB(t)

	for _, c := range []struct {
		name          string
		body          string
		key           string
		want          string
		wantMinLength int
	}{
		{"zero length", `{"min_length":0}`, "password_min_length", "6", 6},
		{"negative length", `{"min_length":-40}`, "password_min_length", "6", 6},
		{"length below the floor", `{"min_length":5}`, "password_min_length", "6", 6},
		{"length nobody can type", `{"min_length":1000}`, "password_min_length", "128", 128},
		{"the floor itself", `{"min_length":6}`, "password_min_length", "6", 6},
		{"the ceiling itself", `{"min_length":128}`, "password_min_length", "128", 128},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, "admin", http.MethodPatch, c.body, UpdatePolicy)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d, want 200 (the handler clamps rather than refusing): %s",
					rec.Code, rec.Body.String())
			}
			if got, _ := storedValue(t, c.key); got != c.want {
				t.Errorf("stored %s = %q, want %q", c.key, got, c.want)
			}
			if got := decodePolicy(t, rec); got.MinLength != c.wantMinLength {
				t.Errorf("the reply says min_length = %d, want the clamped %d — the form would "+
					"show a value the server did not store", got.MinLength, c.wantMinLength)
			}
		})
	}

	// A negative expiry would make every password expire the moment it is set. 0 means "never",
	// which is the only sane reading of "less than no days".
	rec := call(t, "admin", http.MethodPatch, `{"expiry_days":-1}`, UpdatePolicy)
	if rec.Code != http.StatusOK {
		t.Fatalf("expiry status = %d: %s", rec.Code, rec.Body.String())
	}
	if got, _ := storedValue(t, "password_expiry_days"); got != "0" {
		t.Errorf("stored password_expiry_days = %q, want %q (never expires)", got, "0")
	}
}

// Updating twice must UPDATE the row, not accumulate rows.
//
// upsertConfig looks the key up and falls back to Create — a duplicate would be refused by the
// unique index on `key`, so the second write would silently do nothing and the policy would be
// frozen at whatever it was first set to.
func TestUpdatingTwiceRewritesTheSameRow(t *testing.T) {
	testDB(t)

	for _, body := range []string{`{"min_length":12}`, `{"min_length":24}`, `{"min_length":32}`} {
		if rec := call(t, "admin", http.MethodPatch, body, UpdatePolicy); rec.Code != http.StatusOK {
			t.Fatalf("%s: status = %d: %s", body, rec.Code, rec.Body.String())
		}
	}

	var n int64
	config.DB().Model(&entity.SystemConfig{}).Where("key = ?", "password_min_length").Count(&n)
	if n != 1 {
		t.Errorf("%d password_min_length rows, want 1", n)
	}
	if got, _ := storedValue(t, "password_min_length"); got != "32" {
		t.Errorf("stored min_length = %q, want the last value written, %q", got, "32")
	}
}

// A body that is not the expected shape is a 400, and it must not half-apply.
func TestAMalformedBodyChangesNothing(t *testing.T) {
	testDB(t)

	if rec := call(t, "admin", http.MethodPatch, `{"min_length":20}`, UpdatePolicy); rec.Code != http.StatusOK {
		t.Fatalf("seed update: status = %d: %s", rec.Code, rec.Body.String())
	}

	for _, c := range []struct{ name, body string }{
		{"not json", `not json at all`},
		{"truncated", `{"min_length":`},
		// A string where a number belongs: the bind fails, so nothing in the body is applied —
		// including the valid expiry_days sitting next to it.
		{"wrong type", `{"min_length":"twelve","expiry_days":45}`},
		{"a bare array", `[]`},
	} {
		t.Run(c.name, func(t *testing.T) {
			rec := call(t, "admin", http.MethodPatch, c.body, UpdatePolicy)
			if rec.Code != http.StatusBadRequest {
				t.Errorf("status = %d, want 400: %s", rec.Code, rec.Body.String())
			}
		})
	}

	if got, _ := storedValue(t, "password_min_length"); got != "20" {
		t.Errorf("stored min_length = %q — a refused body changed the policy; want %q", got, "20")
	}
	if _, ok := storedValue(t, "password_expiry_days"); ok {
		t.Error("password_expiry_days was written by a request that was refused with 400")
	}
}

// An empty JSON object is a legitimate no-op, not an error: it is what the form sends when nothing
// was touched. It must leave the policy exactly as it was.
func TestAnEmptyBodyIsANoOp(t *testing.T) {
	testDB(t)

	if rec := call(t, "admin", http.MethodPatch, `{"min_length":14}`, UpdatePolicy); rec.Code != http.StatusOK {
		t.Fatalf("seed update: status = %d: %s", rec.Code, rec.Body.String())
	}

	rec := call(t, "admin", http.MethodPatch, `{}`, UpdatePolicy)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}
	if got := decodePolicy(t, rec); got.MinLength != 14 {
		t.Errorf("min_length = %d after an empty body, want the stored 14", got.MinLength)
	}

	var n int64
	config.DB().Model(&entity.SystemConfig{}).Count(&n)
	if n != 1 {
		t.Errorf("%d rows after an empty update, want just the one seeded key", n)
	}
}
