package platform

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// LINE Messaging API — push only.
//
// One endpoint, one message type. The console sends text to a user, group or room that has already
// added the bot; it does not receive webhooks, reply, or push anything richer. That is the whole
// surface an alert needs, and every extra capability here would be another thing to secure on a box
// whose job is firewall management.
//
// ── Why an alert can carry a link but not a file ─────────────────────────────
// The Messaging API has no "attach this PDF" message type. A report delivered over LINE is therefore
// a text message containing a link to a file this server publishes for a short while — see
// report_delivery.go, which is where the trade-off that creates is written down.

const (
	linePushURL = "https://api.line.me/v2/bot/message/push"

	// LINE hard-caps a text message at 5,000 CHARACTERS — runes, not bytes, which matters because
	// a Thai device name costs three bytes per character — and rejects the whole request past it.
	// Truncating locally turns "the alert never arrived" into "the alert arrived slightly short",
	// which is strictly better during the outage the alert is reporting.
	lineMaxTextLength = 4900

	lineTimeout = 12 * time.Second
)

// lineHTTPClient is package-level so pushes reuse connections; LINE is TLS and the handshake costs
// more than the request.
var lineHTTPClient = &http.Client{Timeout: lineTimeout}

// lineEndpoint is overridden by tests to point at an httptest server.
var lineEndpoint = linePushURL

type linePushBody struct {
	To       string            `json:"to"`
	Messages []lineTextMessage `json:"messages"`
}

type lineTextMessage struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// buildLinePushBody renders the request LINE expects.
//
// Split out so the truncation and the payload shape can be tested without a network call — a
// message one character over the cap is rejected with a 400 whose body says only "invalid property",
// which is not a diagnosis anyone would reach on their own.
func buildLinePushBody(to, text string) ([]byte, error) {
	to = strings.TrimSpace(to)
	if to == "" {
		return nil, errors.New("no LINE recipient id given")
	}
	if strings.TrimSpace(text) == "" {
		return nil, errors.New("refusing to send an empty LINE message")
	}
	return json.Marshal(linePushBody{
		To:       to,
		Messages: []lineTextMessage{{Type: "text", Text: capRunes(text, lineMaxTextLength)}},
	})
}

// capRunes trims to at most max characters, counting runes.
//
// Deliberately not services.TruncateUTF8: that one caps BYTES and appends an ellipsis, so a Thai
// message would be cut at a third of LINE's real allowance and the added character could push the
// result back over a byte budget. Cutting on a rune index cannot split a character either way.
func capRunes(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max-1]) + "…"
}

// SendLinePush delivers one text message with the given channel access token.
func SendLinePush(token, to, text string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return errors.New("this LINE channel has no access token configured")
	}

	body, err := buildLinePushBody(to, text)
	if err != nil {
		return err
	}

	req, err := http.NewRequest(http.MethodPost, lineEndpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)

	resp, err := lineHTTPClient.Do(req)
	if err != nil {
		return fmt.Errorf("could not reach the LINE API: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return nil
	}

	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	return fmt.Errorf("LINE rejected the message (%d): %s", resp.StatusCode, lineErrorText(raw))
}

// lineErrorText pulls the human half out of a LINE error body.
//
// LINE answers `{"message":"...","details":[{"message":"...","property":"..."}]}`, and the outer
// message alone is usually "The request body has 1 error(s)" — true, and useless. The detail is
// what says which field.
func lineErrorText(raw []byte) string {
	var parsed struct {
		Message string `json:"message"`
		Details []struct {
			Message  string `json:"message"`
			Property string `json:"property"`
		} `json:"details"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil || parsed.Message == "" {
		return TruncateUTF8(strings.TrimSpace(string(raw)), 300)
	}
	out := parsed.Message
	for _, d := range parsed.Details {
		part := strings.TrimSpace(d.Message)
		if d.Property != "" {
			part = d.Property + ": " + part
		}
		if part != "" {
			out += " — " + part
		}
	}
	return TruncateUTF8(out, 300)
}

// LooksLikeLineTarget reports whether id has the shape of a LINE userId / groupId / roomId.
//
// LINE ids are a single letter followed by 32 hex characters: U… for a user, C… for a group, R… for
// a room. Checking the shape catches the overwhelmingly common mistake — pasting the display name,
// or the channel secret, into the recipient field — before the first alert of the night fails
// silently. It is deliberately a warning-grade check used at input validation, not a gate on
// sending: LINE, not this app, is the authority on what its ids look like.
func LooksLikeLineTarget(id string) bool {
	id = strings.TrimSpace(id)
	if len(id) != 33 {
		return false
	}
	switch id[0] {
	case 'U', 'C', 'R':
	default:
		return false
	}
	for _, r := range id[1:] {
		if (r < '0' || r > '9') && (r < 'a' || r > 'f') && (r < 'A' || r > 'F') {
			return false
		}
	}
	return true
}
