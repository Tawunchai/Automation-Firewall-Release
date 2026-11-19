package networkdevice

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"network_automation/entity"

	"github.com/gin-gonic/gin"
)

// /devices is readable by ANY authenticated user, so what it discloses matters.
//
// A device no longer HAS a login of its own — the Devices form stopped asking for one, and people
// reach a firewall with the account they map to it in Profile ▸ Device Credentials. What is left to
// redact is who runs the unattended work on it, which is an administrative fact.
//
// mgmt_ip deliberately stays visible: the device picker, Config Deploy and the AI Assistant all
// render it, so hiding it would break those pages for the operator role without protecting a
// secret. No password is in this struct in any form.

func ctxWithRole(role string) *gin.Context {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	if role != "" {
		c.Set("user_role", role)
	}
	return c
}

func sampleDevice() entity.NetworkDevice {
	return entity.NetworkDevice{
		Name: "FortiGate-80E", Vendor: "fortinet", Platform: "fortinet",
		MgmtIP: "10.0.99.201", Port: 22, Site: "HQ", Role: "firewall",
		Status: "active", Username: "admin", PasswordEnc: "v2:ZW5jcnlwdGVk",
	}
}

// marshalFor renders the response exactly as the endpoint would, so absent-vs-empty is tested on
// the wire rather than on the struct.
func marshalFor(t *testing.T, role string) map[string]interface{} {
	t.Helper()
	b, err := json.Marshal(toResponseFor(ctxWithRole(role), sampleDevice()))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var out map[string]interface{}
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	return out
}

// The field is gone entirely, for every role. The device form no longer collects a login, so a
// `username` on this payload could only be a leftover shared account nobody rotates.
func TestDeviceResponse_NeverCarriesADeviceUsername(t *testing.T) {
	for _, role := range []string{"admin", "user", "", "viewer"} {
		got := marshalFor(t, role)
		if _, present := got["username"]; present {
			t.Errorf("role %q received username=%v; a device has no login of its own any more",
				role, got["username"])
		}
		if _, present := got["password"]; present {
			t.Errorf("role %q received a password field", role)
		}
	}
}

// Who runs the scheduled work is told to admins only — it names a person's account.
func TestDeviceResponse_AutomationAccountIsAdminOnly(t *testing.T) {
	admin := marshalFor(t, "admin")
	if admin["automation_account"] != "admin" {
		t.Errorf("admin got automation_account=%v, want the legacy stored account", admin["automation_account"])
	}

	for _, role := range []string{"user", "", "viewer"} {
		got := marshalFor(t, role)
		if got["automation_account"] != "" {
			t.Errorf("role %q was told the automation account (%v)", role, got["automation_account"])
		}
	}
}

// Redaction must not gut the payload the UI depends on.
func TestDeviceResponse_NonAdminKeepsTheFieldsTheUIUses(t *testing.T) {
	got := marshalFor(t, "user")

	for k, want := range map[string]interface{}{
		"name":     "FortiGate-80E",
		"mgmt_ip":  "10.0.99.201", // device picker / Config Deploy / AI Assistant all show this
		"vendor":   "fortinet",
		"platform": "fortinet",
		"site":     "HQ",
		"status":   "active",
	} {
		if got[k] != want {
			t.Errorf("%s = %v, want %v", k, got[k], want)
		}
	}
	if got["port"] != float64(22) {
		t.Errorf("port = %v, want 22", got["port"])
	}
}

// The encrypted password has no JSON tag at all — assert it can never appear, for either role.
func TestDeviceResponse_NeverCarriesThePassword(t *testing.T) {
	for _, role := range []string{"admin", "user"} {
		b, err := json.Marshal(toResponseFor(ctxWithRole(role), sampleDevice()))
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		for _, forbidden := range []string{"password", "PasswordEnc", "v2:ZW5jcnlwdGVk"} {
			if contains(string(b), forbidden) {
				t.Errorf("role %q: response contains %q: %s", role, forbidden, b)
			}
		}
	}
}

func contains(haystack, needle string) bool {
	return len(needle) > 0 && len(haystack) >= len(needle) &&
		func() bool {
			for i := 0; i+len(needle) <= len(haystack); i++ {
				if haystack[i:i+len(needle)] == needle {
					return true
				}
			}
			return false
		}()
}
