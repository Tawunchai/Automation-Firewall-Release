package automationjob

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"network_automation/entity"

	"github.com/gin-gonic/gin"
)

// gin.TestMode is set by resetjob_test.go's init in this package.

// GET /backups/:id/content, GET /backups/:id/download and DELETE /backups/:id address a backup by
// a sequential id taken straight off the URL, and ConfigBackup.Content is the device's whole
// `show full-configuration` — IPsec pre-shared keys, SNMP communities, administrator password
// hashes. They used to read the row and hand it over without ever asking whether the caller holds
// a grant for the device it belongs to, while their sibling ListDeviceBackups always has. Any
// signed-in account could walk 1..N and collect the configuration of every firewall in the
// inventory, including ones it could not even list.
//
// These tests exercise the real guard (loadBackupForCaller → mayReachDevice →
// services.UserCanAccessDevice). Only the row is stubbed: config.DB() is a package-level handle
// with no test seam, which is why loadBackupWithDevice is a variable.
//
// The two roles stand for the two sides of the rule in services/deviceaccess.go: an admin reaches
// every device by definition (the granted case), and a non-admin with no grant row reaches none
// (the refused case). A non-admin WITH a grant needs a database to express and is covered by
// UserCanAccessDevice's own tests; what was broken here is that neither role was ever asked.

const (
	stubDeviceID   = 42
	stubDeviceName = "lab-fgt-80e"
	// Recognisable, and the kind of line a leaked backup actually contains.
	stubSecret = "set psksecret ENC 8aQ1pre-shared-key-material"
)

// withStubBackup points the row lookup at one fixed backup for the duration of a test.
func withStubBackup(t *testing.T, found bool) {
	t.Helper()
	original := loadBackupWithDevice
	loadBackupWithDevice = func(int) (*entity.ConfigBackup, *entity.NetworkDevice, bool) {
		if !found {
			return nil, nil, false
		}
		b := &entity.ConfigBackup{NetworkDeviceID: stubDeviceID, Content: stubSecret, Lines: 1}
		b.ID = 1
		d := &entity.NetworkDevice{Name: stubDeviceName}
		d.ID = stubDeviceID
		return b, d, true
	}
	t.Cleanup(func() { loadBackupWithDevice = original })
}

func backupCtx(method, role string) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(method, "/backups/1/content", nil)
	c.Params = gin.Params{{Key: "id", Value: "1"}}
	c.Set("user_id", uint(9))
	if role != "" {
		c.Set("user_role", role)
	}
	return c, rec
}

// A caller with no grant for the backup's device is refused — and refused with 404, so the id
// space cannot be probed for which ids exist.
func TestBackupReadHandlersRefuseACallerWithoutAGrant(t *testing.T) {
	cases := []struct {
		name    string
		method  string
		handler func(*gin.Context)
	}{
		{"content", http.MethodGet, GetBackupContent},
		{"download", http.MethodGet, DownloadBackup},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			withStubBackup(t, true)
			c, rec := backupCtx(tc.method, "user")

			tc.handler(c)

			if rec.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404 — a user with no grant for device %d must not reach "+
					"its backup, and 403 would confirm the backup exists", rec.Code, stubDeviceID)
			}
			if body := rec.Body.String(); strings.Contains(body, stubSecret) || strings.Contains(body, stubDeviceName) {
				t.Fatalf("the refusal leaked the backup: %s", body)
			}
		})
	}
}

// The same two handlers still work for somebody who may have the device.
func TestBackupReadHandlersServeAGrantedCaller(t *testing.T) {
	t.Run("content", func(t *testing.T) {
		withStubBackup(t, true)
		c, rec := backupCtx(http.MethodGet, "admin")

		GetBackupContent(c)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 for an admin", rec.Code)
		}
		if !strings.Contains(rec.Body.String(), stubSecret) {
			t.Fatalf("200 but the content is missing: %s", rec.Body.String())
		}
	})

	t.Run("download", func(t *testing.T) {
		withStubBackup(t, true)
		c, rec := backupCtx(http.MethodGet, "admin")

		DownloadBackup(c)

		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200 for an admin", rec.Code)
		}
		if got := rec.Header().Get("Content-Disposition"); !strings.Contains(got, stubDeviceName) {
			t.Fatalf("Content-Disposition = %q, want the device name in the filename", got)
		}
		if rec.Body.String() != stubSecret {
			t.Fatalf("body = %q, want the backup content", rec.Body.String())
		}
	})
}

// A backup id that does not exist must answer exactly like one the caller may not have — the two
// have to be indistinguishable or the 404 is only a different-looking 403.
func TestMissingBackupAndUngrantedBackupAnswerTheSame(t *testing.T) {
	withStubBackup(t, false)
	cAdmin, recAdmin := backupCtx(http.MethodGet, "admin")
	GetBackupContent(cAdmin)

	withStubBackup(t, true)
	cUser, recUser := backupCtx(http.MethodGet, "user")
	GetBackupContent(cUser)

	if recAdmin.Code != recUser.Code || recAdmin.Body.String() != recUser.Body.String() {
		t.Fatalf("missing backup answered %d %s, ungranted backup answered %d %s — they must match",
			recAdmin.Code, recAdmin.Body.String(), recUser.Code, recUser.Body.String())
	}
}

// DELETE is admin-only and has been since it was written; the role gate fires before anything else,
// so a non-admin never reaches the row at all.
//
// Its device check (the same loadBackupForCaller as above) cannot be exercised here: the only role
// that gets past the gate is admin, and an admin reaches every device by the rule. It is in place
// so the three by-id handlers share one way in rather than because it changes an answer today.
func TestDeleteBackupRefusesANonAdmin(t *testing.T) {
	for _, role := range []string{"user", "operator", ""} {
		name := role
		if name == "" {
			name = "no role at all"
		}
		t.Run(name, func(t *testing.T) {
			withStubBackup(t, true)
			c, rec := backupCtx(http.MethodDelete, role)

			DeleteBackup(c)

			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want 403 for %q", rec.Code, role)
			}
		})
	}
}
