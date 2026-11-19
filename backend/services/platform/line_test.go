package platform

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The LINE push client.
//
// Small surface, and every part of it has bitten somebody: a message one character over the cap is
// rejected with a 400 whose body says only "invalid property"; a display name pasted into the
// recipient field looks fine until the first real alert; and an error body that is reported as its
// outer message alone says "The request body has 1 error(s)" and nothing about which field.

func TestBuildLinePushBody_ShapeIsWhatLINEExpects(t *testing.T) {
	raw, err := buildLinePushBody("U0123456789abcdef0123456789abcdef", "port1 is down")
	if err != nil {
		t.Fatalf("buildLinePushBody: %v", err)
	}

	var got struct {
		To       string `json:"to"`
		Messages []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("the body is not valid JSON: %v", err)
	}
	if got.To != "U0123456789abcdef0123456789abcdef" {
		t.Errorf("to = %q", got.To)
	}
	if len(got.Messages) != 1 || got.Messages[0].Type != "text" || got.Messages[0].Text != "port1 is down" {
		t.Errorf("messages = %+v", got.Messages)
	}
}

// LINE rejects the whole request past 5,000 characters. Truncating locally turns "the alert never
// arrived" into "the alert arrived slightly short", which is strictly better during an outage.
func TestBuildLinePushBody_TruncatesRatherThanBeingRejected(t *testing.T) {
	raw, err := buildLinePushBody("U1", strings.Repeat("ก", 6000))
	if err != nil {
		t.Fatalf("buildLinePushBody: %v", err)
	}
	var got struct {
		Messages []struct {
			Text string `json:"text"`
		} `json:"messages"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	text := got.Messages[0].Text
	// LINE counts characters, not bytes. A byte-based cap would trim a Thai message to a third of
	// what LINE actually allows.
	if n := len([]rune(text)); n > lineMaxTextLength {
		t.Errorf("text is %d characters, over the %d cap", n, lineMaxTextLength)
	}
	if n := len([]rune(text)); n < lineMaxTextLength-1 {
		t.Errorf("text was trimmed to %d characters — far short of the %d LINE allows",
			n, lineMaxTextLength)
	}
	// Multi-byte truncation must not split a Thai character in half — that is a mojibake bug this
	// codebase has already paid for once.
	if strings.Contains(text, "�") {
		t.Errorf("truncation split a multi-byte character")
	}
}

func TestBuildLinePushBody_RefusesNothingToSend(t *testing.T) {
	if _, err := buildLinePushBody("", "hello"); err == nil {
		t.Errorf("accepted an empty recipient")
	}
	if _, err := buildLinePushBody("U1", "   "); err == nil {
		t.Errorf("accepted an empty message")
	}
}

func TestSendLinePush_PostsWithTheBearerToken(t *testing.T) {
	var gotAuth, gotBody, gotType string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotType = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{}`))
	}))
	defer srv.Close()

	restore := lineEndpoint
	lineEndpoint = srv.URL
	defer func() { lineEndpoint = restore }()

	if err := SendLinePush("secret-token", "U1", "hello"); err != nil {
		t.Fatalf("SendLinePush: %v", err)
	}
	if gotAuth != "Bearer secret-token" {
		t.Errorf("Authorization = %q", gotAuth)
	}
	if gotType != "application/json" {
		t.Errorf("Content-Type = %q", gotType)
	}
	if !strings.Contains(gotBody, `"hello"`) {
		t.Errorf("body = %q", gotBody)
	}
}

func TestSendLinePush_ReportsTheDetailNotJustTheStatus(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"message":"The request body has 1 error(s)","details":[{"message":"May not be empty","property":"messages[0].text"}]}`))
	}))
	defer srv.Close()

	restore := lineEndpoint
	lineEndpoint = srv.URL
	defer func() { lineEndpoint = restore }()

	err := SendLinePush("t", "U1", "hello")
	if err == nil {
		t.Fatal("a 400 was reported as success")
	}
	if !strings.Contains(err.Error(), "messages[0].text") {
		t.Errorf("the useful half of the error was dropped: %v", err)
	}
}

func TestSendLinePush_WithoutATokenFailsBeforeTheNetwork(t *testing.T) {
	if err := SendLinePush("  ", "U1", "hello"); err == nil {
		t.Errorf("a channel with no token was allowed to send")
	}
}

func TestLineErrorText_FallsBackToTheRawBody(t *testing.T) {
	if got := lineErrorText([]byte("<html>502 Bad Gateway</html>")); !strings.Contains(got, "502") {
		t.Errorf("a non-JSON body was lost: %q", got)
	}
}

func TestLooksLikeLineTarget(t *testing.T) {
	valid := []string{
		"U0123456789abcdef0123456789abcdef",
		"Cabcdef0123456789abcdef0123456789",
		"R0123456789ABCDEF0123456789ABCDEF",
	}
	for _, id := range valid {
		if !LooksLikeLineTarget(id) {
			t.Errorf("%q was rejected", id)
		}
	}

	invalid := []string{
		"",
		"Ops Team",                           // the display name — the mistake this catches
		"U0123",                              // too short
		"X0123456789abcdef0123456789abcdef",  // wrong prefix
		"U0123456789abcdef0123456789abcdefg", // too long
		"U0123456789abcdef0123456789abcdeZ",  // not hex
		"ops@example.com",                    // an email address in the LINE field
	}
	for _, id := range invalid {
		if LooksLikeLineTarget(id) {
			t.Errorf("%q was accepted", id)
		}
	}
}
