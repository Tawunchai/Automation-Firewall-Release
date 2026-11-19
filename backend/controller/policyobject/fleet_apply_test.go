package policyobject

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

// The validation that runs before any device is touched — no database needed, since these all
// refuse before resolveDeviceInfoByID is ever called.

func postJSON(t *testing.T, handler gin.HandlerFunc, body string) *httptest.ResponseRecorder {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodPost, "/fleet/preview", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	handler(c)
	return rec
}

func TestFleetPreview_RefusesAnIneligibleResourceType(t *testing.T) {
	rec := postJSON(t, FleetPreview, `{"resource_type":"firewall-policy","name":"x","body":{},"device_ids":[1]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a resource type Fleet Apply does not support", rec.Code)
	}
}

func TestFleetPreview_RefusesNoDevices(t *testing.T) {
	rec := postJSON(t, FleetPreview, `{"resource_type":"address","name":"x","body":{},"device_ids":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when no device was picked", rec.Code)
	}
}

func TestFleetPreview_RefusesMalformedJSON(t *testing.T) {
	rec := postJSON(t, FleetPreview, `{not json`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for malformed JSON", rec.Code)
	}
}

func TestFleetApply_RefusesAnIneligibleResourceType(t *testing.T) {
	rec := postJSON(t, FleetApply, `{"resource_type":"virtual-ip","name":"x","body":{},"device_ids":[1]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 for a resource type Fleet Apply does not support", rec.Code)
	}
}

func TestFleetApply_RefusesNoDevices(t *testing.T) {
	rec := postJSON(t, FleetApply, `{"resource_type":"service","name":"x","body":{},"device_ids":[]}`)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400 when no device was picked", rec.Code)
	}
}

// Found live: a replayed create was rejected with "name is required" because the request's
// top-level Name (the preview's lookup key) was never folded into the body the create/update
// endpoints actually read it from — every one of the five fleet-eligible types has `name` as a body
// field, same as every other field on the object.
func TestMergedFleetBody_AddsNameWithoutMutatingTheOriginal(t *testing.T) {
	original := map[string]any{"subnet": "10.0.0.1 255.255.255.255", "comment": "x"}
	merged := mergedFleetBody("web-01", original)

	if merged["name"] != "web-01" {
		t.Errorf("merged[\"name\"] = %v, want \"web-01\"", merged["name"])
	}
	if merged["subnet"] != original["subnet"] || merged["comment"] != original["comment"] {
		t.Errorf("merged lost the original fields: %+v", merged)
	}
	if _, ok := original["name"]; ok {
		t.Error("mergedFleetBody mutated the caller's map — a later use of in.Body would see a name it never set")
	}
}

func TestMergedFleetBody_OverwritesAnyNameAlreadyInTheBody(t *testing.T) {
	// The top-level Name is the one the preview checked existence against; a stale or mismatched
	// name inside Body must never win.
	merged := mergedFleetBody("correct-name", map[string]any{"name": "stale-name"})
	if merged["name"] != "correct-name" {
		t.Errorf("merged[\"name\"] = %v, want the top-level name to win", merged["name"])
	}
}
