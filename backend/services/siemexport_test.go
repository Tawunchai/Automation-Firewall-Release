package services

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"network_automation/entity"
)

func TestBuildSIEMEvent_CarriesTheLedgerRowFields(t *testing.T) {
	now := time.Now()
	rec := entity.ChangeRecord{
		NetworkDeviceID: 7,
		UserEmail:       "alice@example.com",
		Action:          "update",
		ResourceType:    "firewall-policy",
		ResourceKey:     "12",
		Method:          "PATCH",
		Path:            "/policy/device/7/firewall-policies/12",
		Status:          "applied",
	}
	rec.CreatedAt = now

	event := BuildSIEMEvent(rec, "Branch-HQ")

	if event.EventType != "fortigate_console.change" {
		t.Errorf("EventType = %q, want the fixed event type", event.EventType)
	}
	if event.DeviceID != 7 || event.DeviceName != "Branch-HQ" {
		t.Errorf("device fields = %d/%q, want 7/Branch-HQ", event.DeviceID, event.DeviceName)
	}
	if event.UserEmail != "alice@example.com" || event.Action != "update" ||
		event.ResourceType != "firewall-policy" || event.ResourceKey != "12" ||
		event.Method != "PATCH" || event.Path != rec.Path || event.Status != "applied" {
		t.Errorf("event did not carry the ledger row through unchanged: %+v", event)
	}
	if !event.Timestamp.Equal(now) {
		t.Errorf("Timestamp = %v, want %v", event.Timestamp, now)
	}
}

func TestBuildSIEMEvent_CarriesAFailedWriteToo(t *testing.T) {
	// A rejected change attempt is itself a security-relevant fact — see the doc comment on
	// SIEMEvent.Status.
	rec := entity.ChangeRecord{Status: "failed", ErrorText: "FortiGate error: object in use"}
	event := BuildSIEMEvent(rec, "x")
	if event.Status != "failed" || event.ErrorText != "FortiGate error: object in use" {
		t.Errorf("a failed write was not carried through: %+v", event)
	}
}

// allowLoopbackWebhook lets a test POST to an httptest server.
//
// SendSIEMEvent refuses loopback on purpose (services/webhookurl.go: this server's own internal
// endpoints answer a local caller without a session), and httptest has nowhere else to bind. The
// destination rule is tested directly in webhookurl_test.go; these tests are about the POST.
func allowLoopbackWebhook(t *testing.T) {
	t.Helper()
	old := webhookDestinationCheck
	webhookDestinationCheck = func(string) error { return nil }
	t.Cleanup(func() { webhookDestinationCheck = old })
}

func TestSendSIEMEvent_PostsJSONAndSucceedsOn2xx(t *testing.T) {
	allowLoopbackWebhook(t)
	var gotBody []byte
	var gotContentType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentType = r.Header.Get("Content-Type")
		gotBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	event := SIEMEvent{EventType: "fortigate_console.change", ResourceKey: "web-01"}
	if err := SendSIEMEvent(srv.URL, event); err != nil {
		t.Fatalf("SendSIEMEvent returned an error against a 200 server: %v", err)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotContentType)
	}
	var decoded SIEMEvent
	if err := json.Unmarshal(gotBody, &decoded); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if decoded.ResourceKey != "web-01" {
		t.Errorf("decoded.ResourceKey = %q, want web-01 — the body sent was not the event given", decoded.ResourceKey)
	}
}

func TestSendSIEMEvent_FailsOnNon2xx(t *testing.T) {
	allowLoopbackWebhook(t)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	if err := SendSIEMEvent(srv.URL, SIEMEvent{}); err == nil {
		t.Error("SendSIEMEvent returned nil for a 500 response, want an error")
	}
}

func TestExportChangeRecordAsync_NoopWhenDisabled(t *testing.T) {
	allowLoopbackWebhook(t)
	// No database, no webhook configured — must not panic or attempt a send.
	ExportChangeRecordAsync(nil, entity.ChangeRecord{})
}
