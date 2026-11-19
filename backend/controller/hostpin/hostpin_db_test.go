package hostpin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"
	"time"

	"network_automation/config"
	"network_automation/entity"

	"github.com/gin-gonic/gin"
)

// Listing and clearing the identities this console has pinned.
//
// Why these are worth tests at all: clearing a pin is the one action in this system that tells it
// to trust something new about a firewall. It has to be admin-only, it has to be a HARD delete,
// and it must not offer to "update" a pin to whatever the device is showing — that last one would
// turn both pinning checks into decoration by a route that looks helpful.
//
// Skipped unless HOSTPIN_DB_TEST_DSN names a database it may freely write to and empty. Point it at
// a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55438:5432 -e POSTGRES_PASSWORD=test --name hostpin-pg postgres:16-alpine
//	HOSTPIN_DB_TEST_DSN="host=localhost port=55438 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./controller/hostpin/ -v

type fixture struct {
	sshID uint
	tlsID uint
}

func testDB(t *testing.T) *fixture {
	t.Helper()
	dsn := os.Getenv("HOSTPIN_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("HOSTPIN_DB_TEST_DSN not set — see the note at the top of hostpin_db_test.go")
	}
	gin.SetMode(gin.TestMode)

	t.Setenv("DATABASE_URL", dsn)
	config.ConnectDB()
	db := config.DB()
	if db == nil {
		t.Fatal("config.DB() is nil after ConnectDB")
	}
	if err := db.AutoMigrate(&entity.SSHHostKey{}, &entity.DeviceTLSPin{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	for _, table := range []string{"ssh_host_keys", "device_tls_pins"} {
		if err := db.Exec("TRUNCATE TABLE " + table + " RESTART IDENTITY CASCADE").Error; err != nil {
			t.Fatalf("truncate %s: %v", table, err)
		}
	}

	now := time.Now()
	ssh := entity.SSHHostKey{
		Host: "10.10.20.90:22", KeyType: "ssh-ed25519",
		Fingerprint: "SHA256:3xeq9NF7B+widM/aNiiqcaA3gupfZgh3IxPY0FCFOUs",
		FirstSeenAt: now, LastSeenAt: now,
	}
	pin := entity.DeviceTLSPin{
		Host: "10.10.20.90:443", Fingerprint: "8718db4d8722aa703f1f8a00cd0231fd9c781af9cc5db622dae3d870923037a7",
		Subject: "FortiGate", Issuer: "FortiGate", NotAfter: now.Add(time.Hour),
		FirstSeenAt: now, LastSeenAt: now,
	}
	if err := db.Create(&ssh).Error; err != nil {
		t.Fatalf("seed ssh pin: %v", err)
	}
	if err := db.Create(&pin).Error; err != nil {
		t.Fatalf("seed tls pin: %v", err)
	}
	return &fixture{sshID: ssh.ID, tlsID: pin.ID}
}

// call runs a handler as a given role, with the route params the router would have bound.
func call(t *testing.T, role string, handler gin.HandlerFunc, method, path string,
	params gin.Params) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, path, nil)
	if role != "" {
		c.Set("user_role", role)
		c.Set("user_id", uint(1))
	}
	c.Params = params
	handler(c)
	return rec
}

// An operator who could clear a pin could clear it, stand in the firewall's place on the network,
// and be pinned instead of the firewall. That is the whole attack these tables exist to stop, so
// both handlers are admin-only — and the refusal must come before anything is read or deleted.
func TestOnlyAnAdminCanSeeOrClearPins(t *testing.T) {
	fx := testDB(t)

	for _, role := range []string{"", "user", "operator", "Admin"} {
		t.Run("role="+role, func(t *testing.T) {
			if w := call(t, role, List, http.MethodGet, "/host-pins", nil); w.Code != http.StatusForbidden {
				t.Errorf("List status = %d, want 403", w.Code)
			}
			w := call(t, role, Delete, http.MethodDelete, "/host-pins/tls/1",
				gin.Params{{Key: "kind", Value: "tls"}, {Key: "id", Value: strconv.FormatUint(uint64(fx.tlsID), 10)}})
			if w.Code != http.StatusForbidden {
				t.Errorf("Delete status = %d, want 403", w.Code)
			}
		})
	}

	// And nothing was deleted by any of those attempts.
	var n int64
	config.DB().Model(&entity.DeviceTLSPin{}).Count(&n)
	if n != 1 {
		t.Errorf("%d TLS pins remain, want the seeded 1", n)
	}
}

// One call answers the question an administrator actually has, which is about a DEVICE: both
// protocols, so "what does this console believe 10.10.20.90 is?" does not need two requests.
func TestListReturnsBothKindsOfPin(t *testing.T) {
	testDB(t)

	w := call(t, "admin", List, http.MethodGet, "/host-pins", nil)
	if w.Code != http.StatusOK {
		t.Fatalf("status = %d: %s", w.Code, w.Body.String())
	}
	var body struct {
		SSH []entity.SSHHostKey   `json:"ssh_host_keys"`
		TLS []entity.DeviceTLSPin `json:"tls_certificates"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v — %s", err, w.Body.String())
	}
	if len(body.SSH) != 1 || len(body.TLS) != 1 {
		t.Fatalf("got %d ssh and %d tls pins, want 1 of each", len(body.SSH), len(body.TLS))
	}
	// The fingerprint has to be in the reply: comparing it with the device's own console is the
	// entire point of showing this page to a person.
	if body.SSH[0].Fingerprint == "" || body.TLS[0].Fingerprint == "" {
		t.Error("a pin came back without its fingerprint")
	}
	if body.TLS[0].Subject != "FortiGate" || body.TLS[0].NotAfter.IsZero() {
		t.Error("the certificate's subject and expiry are missing, so a legitimate change cannot " +
			"be told from an interception")
	}
}

// The clear has to be a HARD delete.
//
// A soft-deleted row stays invisible to both checks (they read under GORM's default scope) while
// still occupying the unique index, so the next connection would fail to INSERT the new identity
// rather than remembering it: the clear would appear to succeed and the device would stay
// unreachable, now for a reason nothing explains.
func TestClearingAPinRemovesTheRowOutright(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct {
		kind  string
		id    uint
		count func() int64
	}{
		{"ssh", fx.sshID, func() int64 {
			var n int64
			config.DB().Unscoped().Model(&entity.SSHHostKey{}).Count(&n)
			return n
		}},
		{"tls", fx.tlsID, func() int64 {
			var n int64
			config.DB().Unscoped().Model(&entity.DeviceTLSPin{}).Count(&n)
			return n
		}},
	} {
		t.Run(c.kind, func(t *testing.T) {
			w := call(t, "admin", Delete, http.MethodDelete, "/host-pins/"+c.kind+"/1",
				gin.Params{{Key: "kind", Value: c.kind}, {Key: "id", Value: strconv.FormatUint(uint64(c.id), 10)}})
			if w.Code != http.StatusOK {
				t.Fatalf("status = %d: %s", w.Code, w.Body.String())
			}
			// Unscoped: a soft delete would leave the row and this count would still be 1.
			if n := c.count(); n != 0 {
				t.Errorf("%d rows remain after the clear — it was a soft delete, and the unique "+
					"index is still occupied", n)
			}
			// The reply names what was cleared, so the action is legible in a log or a toast.
			var body map[string]any
			_ = json.Unmarshal(w.Body.Bytes(), &body)
			if body["host"] != "10.10.20.90:"+map[string]string{"ssh": "22", "tls": "443"}[c.kind] {
				t.Errorf("the reply does not name the host it cleared: %v", body)
			}
		})
	}
}

func TestClearingRefusesNonsense(t *testing.T) {
	fx := testDB(t)

	for _, c := range []struct {
		name, kind, id string
		want           int
	}{
		{"an unknown kind", "smtp", strconv.FormatUint(uint64(fx.tlsID), 10), http.StatusBadRequest},
		{"no kind", "", strconv.FormatUint(uint64(fx.tlsID), 10), http.StatusBadRequest},
		{"a non-numeric id", "tls", "abc", http.StatusBadRequest},
		{"a zero id", "tls", "0", http.StatusBadRequest},
		{"an id that does not exist", "tls", "9999", http.StatusNotFound},
		{"the right id but the wrong kind", "ssh", strconv.FormatUint(uint64(fx.tlsID)+1000, 10), http.StatusNotFound},
	} {
		t.Run(c.name, func(t *testing.T) {
			w := call(t, "admin", Delete, http.MethodDelete, "/host-pins/x/y",
				gin.Params{{Key: "kind", Value: c.kind}, {Key: "id", Value: c.id}})
			if w.Code != c.want {
				t.Errorf("status = %d, want %d: %s", w.Code, c.want, w.Body.String())
			}
		})
	}

	// Nothing was removed by any of them.
	var ssh, tlsPins int64
	config.DB().Unscoped().Model(&entity.SSHHostKey{}).Count(&ssh)
	config.DB().Unscoped().Model(&entity.DeviceTLSPin{}).Count(&tlsPins)
	if ssh != 1 || tlsPins != 1 {
		t.Errorf("%d ssh / %d tls pins remain, want 1 each", ssh, tlsPins)
	}
}
