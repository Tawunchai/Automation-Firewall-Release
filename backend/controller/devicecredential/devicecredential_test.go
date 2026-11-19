package devicecredential

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/entity"
)

func init() { gin.SetMode(gin.TestMode) }

// These routes hold each person's own firewall login — the password the console authenticates to
// the device with, so the firewall's event log names them instead of a shared `admin`.
//
// They are open to every signed-in user by design, which means the property protecting them is not
// a role check but SCOPING: every query is filtered to the caller. The package was at 0% coverage,
// so nothing checked that a request with no identity is refused, and nothing checked that the
// password never leaves the building in a response.
//
// No database is used. Everything below is either a pure function or a path that returns before the
// first query — which is also why these tests are worth having: a handler that started querying
// before establishing who is asking would panic here rather than pass.

func newCtx(userID any, params gin.Params) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, "/", nil)
	if userID != nil {
		c.Set("user_id", userID)
	}
	c.Params = params
	return c, rec
}

// Every handler in the package. Listed by hand so a new route has to be added here too.
var handlers = map[string]gin.HandlerFunc{
	"List":   List,
	"Create": Create,
	"Update": Update,
	"Test":   Test,
	"Delete": Delete,
}

func TestEveryHandlerRefusesARequestWithNoIdentity(t *testing.T) {
	for name, h := range handlers {
		t.Run(name, func(t *testing.T) {
			c, rec := newCtx(nil, gin.Params{{Key: "id", Value: "1"}})
			h(c)

			if rec.Code != http.StatusUnauthorized {
				t.Fatalf("%s answered %d without a signed-in user, want 401 — these rows are keyed "+
					"by caller, so a handler that proceeds without one has no scope to apply", name, rec.Code)
			}
			if !strings.Contains(rec.Body.String(), "not signed in") {
				t.Errorf("%s: body %q does not say why", name, rec.Body.String())
			}
		})
	}
}

// user_id arrives from the JWT via gin's context, which types it as `any`. A shape callerID does not
// understand must read as "nobody", never as user 0 quietly matching somebody's rows.
func TestCallerIDRejectsEveryUnusableShape(t *testing.T) {
	for _, v := range []any{nil, uint(0), 0, "", "abc", []uint{1}, struct{}{}, false} {
		c, rec := newCtx(v, nil)
		if v == nil {
			c, rec = newCtx(nil, nil)
		}
		if id, ok := callerID(c); ok {
			t.Errorf("callerID accepted %#v as user %d", v, id)
		} else if rec.Code != http.StatusUnauthorized {
			t.Errorf("callerID(%#v) answered %d, want 401", v, rec.Code)
		}
	}

	c, _ := newCtx(uint(9), nil)
	if id, ok := callerID(c); !ok || id != 9 {
		t.Errorf("callerID = %d, %v; want 9, true", id, ok)
	}
}

func TestPathIDRejectsAnythingButAPositiveInteger(t *testing.T) {
	for _, raw := range []string{"0", "-1", "abc", "", "1.5", "1;DROP TABLE", "0x2"} {
		c, rec := newCtx(uint(1), gin.Params{{Key: "id", Value: raw}})
		if _, ok := pathID(c); ok {
			t.Errorf("pathID accepted %q", raw)
		}
		if rec.Code != http.StatusBadRequest {
			t.Errorf("pathID(%q) answered %d, want 400", raw, rec.Code)
		}
	}

	c, _ := newCtx(uint(1), gin.Params{{Key: "id", Value: "7"}})
	if got, ok := pathID(c); !ok || got != 7 {
		t.Errorf("pathID = %d, %v; want 7, true", got, ok)
	}
}

// The response shape. The stored password is encrypted at rest and must not appear in a response at
// all — not even blanked, because a field that exists is a field something will one day populate.
func TestTheViewNeverCarriesThePassword(t *testing.T) {
	cred := entity.DeviceCredential{
		NetworkDeviceID: 3,
		AppUserID:       9,
		Username:        "ntits",
		PasswordEnc:     "v3:CIPHERTEXT-THAT-MUST-NOT-TRAVEL",
		LastTestStatus:  "ok",
	}
	cred.ID = 11
	device := entity.NetworkDevice{Name: "FortiGate-80E", MgmtIP: "10.0.99.201", Vendor: "fortinet"}
	device.ID = 3

	v := toView(cred, device)

	if v.Username != "ntits" || v.DeviceName != "FortiGate-80E" {
		t.Fatalf("view lost its identifying fields: %+v", v)
	}

	// Reflect over the struct rather than naming fields: this has to keep holding as the view grows.
	body, err := marshalView(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	for _, leak := range []string{"CIPHERTEXT-THAT-MUST-NOT-TRAVEL", "PasswordEnc", "password_enc", "password"} {
		if strings.Contains(body, leak) {
			t.Errorf("the credential view serialises %q:\n%s", leak, body)
		}
	}
}

// Whether a device's automation account is THIS credential, and who holds it otherwise, is the bit
// of state behind a toggle that sometimes refuses to turn on — so the mapping is worth pinning.
func TestAutomationFlagReflectsWhoHoldsTheDevice(t *testing.T) {
	cred := entity.DeviceCredential{NetworkDeviceID: 3, AppUserID: 9, Username: "ntits"}
	cred.ID = 11
	device := entity.NetworkDevice{Name: "fgt", MgmtIP: "10.0.0.1"}
	device.ID = 3

	// Nobody holds it.
	device.AutomationCredentialID = 0
	if v := toView(cred, device); v.UsedForAutomation || v.AutomationTakenBy != "" {
		t.Errorf("no automation credential set, but view says used=%v takenBy=%q", v.UsedForAutomation, v.AutomationTakenBy)
	}

	// This credential holds it.
	device.AutomationCredentialID = 11
	if v := toView(cred, device); !v.UsedForAutomation || v.AutomationTakenBy != "" {
		t.Errorf("this credential holds it, but view says used=%v takenBy=%q", v.UsedForAutomation, v.AutomationTakenBy)
	}

	// Somebody else holds it. The name is looked up from the database, which is absent here, so the
	// assertion is the flag — best-effort by design (see automationOwnerName).
	device.AutomationCredentialID = 99
	if v := toView(cred, device); v.UsedForAutomation {
		t.Error("another credential holds the device, but the view claims this one does")
	}
}

func TestLastUsedAndTestedSurviveTheView(t *testing.T) {
	at := time.Date(2026, 9, 14, 10, 0, 0, 0, time.UTC)
	cred := entity.DeviceCredential{Username: "u", LastUsedAt: &at, LastTestedAt: &at, LastTestStatus: "fail", LastTestError: "bad password"}
	v := toView(cred, entity.NetworkDevice{})

	if v.LastUsedAt == nil || !v.LastUsedAt.Equal(at) {
		t.Error("last_used_at did not survive the mapping")
	}
	if v.LastTestStatus != "fail" || v.LastTestError != "bad password" {
		t.Error("the failure the UI shows as untested-and-failing did not survive the mapping")
	}
}

// marshalView serialises the view exactly as the handler would, so the leak check above reads the
// bytes that would actually reach a browser rather than a struct dump.
func marshalView(v credentialView) (string, error) {
	b, err := json.Marshal(v)
	return string(b), err
}
