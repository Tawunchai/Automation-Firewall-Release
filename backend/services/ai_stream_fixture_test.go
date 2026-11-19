package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"unicode/utf8"
)

// The streamed PREVIEW, frame by frame.
//
// ai_stream_completion_test.go proves what a half-arrived answer must not be allowed to BECOME —
// the authoritative result. This file is about the other half of the same function: the text handed
// to the browser while the answer is still being written. Those deltas are rendered straight into
// the chat, so a fragment that is not valid UTF-8, or one that re-sends text already shown, is
// visible to the user in a way no error path reports.
//
// Everything here replays recorded SSE frames against a local server (the reason anthropicAPIURL is
// a var). A tool call arrives as ARBITRARY slices of the JSON text, so the fixtures deliberately
// cut in the places that hurt: inside a Thai character, inside a key name, inside an escape.

// streamFrames is the frame vocabulary a real tool-call stream is made of.
type streamFrames struct{}

func (streamFrames) start() string {
	return `{"type":"message_start","message":{"usage":{"input_tokens":12}}}`
}
func (streamFrames) blockStart() string {
	return `{"type":"content_block_start","content_block":{"type":"tool_use","name":"propose_device_config"}}`
}
func (streamFrames) blockStop() string { return `{"type":"content_block_stop"}` }
func (streamFrames) stop() string      { return `{"type":"message_stop"}` }
func (streamFrames) delta(s string) string {
	b, _ := json.Marshal(s)
	return `{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":` + string(b) + `}}`
}
func (streamFrames) messageDelta(reason string) string {
	return `{"type":"message_delta","delta":{"stop_reason":"` + reason + `"},"usage":{"output_tokens":96}}`
}

// replayStreamWithDeltas is replayStream plus the preview callback: it returns the final tool JSON
// and every delta the function emitted, in order.
func replayStreamWithDeltas(t *testing.T, frames []string) (json.RawMessage, []AIStreamDelta, error) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for _, f := range frames {
			if _, err := w.Write([]byte("data: " + f + "\n\n")); err != nil {
				return
			}
			if fl, ok := w.(http.Flusher); ok {
				fl.Flush() // one frame per read, so the deltas are not coalesced by the transport
			}
		}
	}))
	t.Cleanup(srv.Close)

	original := anthropicAPIURL
	anthropicAPIURL = srv.URL
	t.Cleanup(func() { anthropicAPIURL = original })

	var deltas []AIStreamDelta
	tool := anthropicTool{Name: proposeConfigTool, InputSchema: map[string]any{"type": "object"}}
	raw, err := streamAnthropicTool(context.Background(), "test-key", nil, nil, tool, 256,
		func(d AIStreamDelta) { deltas = append(deltas, d) })
	return raw, deltas, err
}

// A Thai character is three bytes, and the accumulated buffer gets parsed after EVERY frame —
// which means it is parsed at byte offsets that fall inside a rune.
//
// This is not hypothetical: Thai is the product's main language, so most explanations are made
// entirely of three-byte runes and a cut inside one is the common case, not the edge. Go's json
// package replaces an invalid byte sequence with U+FFFD rather than failing, so without the trim in
// repairPartialJSON the preview would show a "" and then replace it with the real character on
// the next frame, in every single Thai answer.
//
// Exercised against repairPartialJSON/parsePartialToolInput directly, at every byte offset,
// because that is where the guard lives and no stream fixture can cover all three offsets inside
// every rune as exhaustively.
func TestPartialParseOfThaiIsNeverInvalidUTF8(t *testing.T) {
	const thai = "สร้าง policy อนุญาต LAN ออกอินเทอร์เน็ต"
	full := `{"mode":"config","commands":["config firewall policy","end"],"explanation":` +
		mustJSON(thai) + `}`

	for cut := 0; cut <= len(full); cut++ {
		repaired := repairPartialJSON(full[:cut])
		if !utf8.ValidString(repaired) {
			t.Fatalf("cut at %d: repaired buffer is not valid UTF-8:\n%q", cut, repaired)
		}
		_, _, explanation := parsePartialToolInput(full[:cut])
		if strings.ContainsRune(explanation, '�') {
			t.Fatalf("cut at %d: the preview carries U+FFFD — a rune was cut and parsed anyway: %q",
				cut, explanation)
		}
		// Monotonic as well as valid: the preview must always be a PREFIX of the real explanation.
		// A fragment that is valid UTF-8 but wrong (half a rune resolved to a different character)
		// would be shown to the user and then silently contradicted.
		if explanation != "" && !strings.HasPrefix(thai, explanation) {
			t.Fatalf("cut at %d: the preview is not a prefix of the explanation: %q", cut, explanation)
		}
	}

	// The whole document, once it has all arrived, is exact.
	_, _, done := parsePartialToolInput(full)
	if done != thai {
		t.Errorf("the complete buffer did not parse back:\n got %q\nwant %q", done, thai)
	}
}

// The wire form the API actually uses for a non-ASCII explanation can be `\uXXXX` escapes, and a
// fragment boundary falls inside one of those too — six characters the repair must drop rather
// than close a string around.
func TestStreamedDeltasSurviveASplitUnicodeEscape(t *testing.T) {
	f := streamFrames{}
	// "ผล" written as escapes, split mid-escape across three frames.
	parts := []string{
		`{"mode":"config","commands":["end"],"explanation":"\u0e1`,
		`c\u0e`,
		`25 ok"}`,
	}
	frames := []string{f.start(), f.blockStart()}
	for _, p := range parts {
		frames = append(frames, f.delta(p))
	}
	frames = append(frames, f.blockStop(), f.messageDelta("tool_use"), f.stop())

	raw, deltas, err := replayStreamWithDeltas(t, frames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	var assembled strings.Builder
	for i, d := range deltas {
		if !utf8.ValidString(d.Explanation) || strings.ContainsRune(d.Explanation, '�') {
			t.Fatalf("delta %d is not clean text: %q", i, d.Explanation)
		}
		assembled.WriteString(d.Explanation)
	}
	if assembled.String() != "ผล ok" {
		t.Errorf("assembled explanation = %q, want %q", assembled.String(), "ผล ok")
	}
	var got struct {
		Explanation string `json:"explanation"`
	}
	if err := json.Unmarshal(raw, &got); err != nil {
		t.Fatalf("the final tool JSON does not parse: %v -- %s", err, raw)
	}
	if got.Explanation != "ผล ok" {
		t.Errorf("the final JSON lost the escaped characters: %q", got.Explanation)
	}
}

// The deltas are INCREMENTAL by contract ("append, never replace"). A frame that re-sent text the
// browser already has would duplicate it in the bubble, and the only way to see that is to add
// them up.
func TestStreamedDeltasOnlyEverAppend(t *testing.T) {
	f := streamFrames{}
	// Cut in the three places that break a naive repair: inside a key name, right after a comma,
	// and inside a backslash escape.
	parts := []string{
		`{"mode":"config","comm`,
		`ands":["config firewall address","edit \"LAN`,
		`-Net\"","end"],"expl`,
		`anation":"two command`,
		`s"}`,
	}
	frames := []string{f.start(), f.blockStart()}
	for _, p := range parts {
		frames = append(frames, f.delta(p))
	}
	frames = append(frames, f.blockStop(), f.messageDelta("tool_use"), f.stop())

	raw, deltas, err := replayStreamWithDeltas(t, frames)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	var exp, cli strings.Builder
	for _, d := range deltas {
		exp.WriteString(d.Explanation)
		cli.WriteString(d.CLI)
	}
	if exp.String() != "two commands" {
		t.Errorf("assembled explanation = %q, want %q", exp.String(), "two commands")
	}
	// The CLI preview is the commands joined by newlines, and it must grow monotonically: the
	// half-written `edit "LAN` must not be shown and then contradicted.
	want := "config firewall address\nedit \"LAN-Net\"\nend"
	if cli.String() != want {
		t.Errorf("assembled CLI = %q, want %q", cli.String(), want)
	}
	if !strings.Contains(string(raw), `"explanation":"two commands"`) {
		t.Errorf("final JSON lost the explanation:\n%s", raw)
	}
}

// The `impact` field is a nested OBJECT in the tool input, and the preview parser repairs partial
// JSON by closing whatever containers are open. A nested object is the first thing in this schema
// that is two levels deep, so this checks the repair really tracks a stack rather than assuming one
// level — and that a cut inside `impact` does not throw away the explanation already streamed.
func TestPartialParseSurvivesTheNestedImpactObject(t *testing.T) {
	const prefix = `{"mode":"config","commands":["config firewall policy","end"],` +
		`"explanation":"ok","impact":{"subnets":["192.168.10.0/24"],"affected":["the office LAN"`

	for _, cut := range []int{
		strings.Index(prefix, `"impact"`),        // just before the object opens
		strings.Index(prefix, `{"subnets"`) + 10, // inside its first key
		len(prefix) - 1,                          // inside the nested array
		len(prefix),                              // everything so far
	} {
		mode, commands, explanation := parsePartialToolInput(prefix[:cut])
		if mode != "config" {
			t.Errorf("cut at %d lost the mode (got %q)", cut, mode)
		}
		if len(commands) != 2 {
			t.Errorf("cut at %d lost the commands (got %v)", cut, commands)
		}
		if explanation != "ok" {
			t.Errorf("cut at %d lost the explanation (got %q)", cut, explanation)
		}
	}

	// And the whole thing, closed properly, still carries the impact through to the suggestion.
	full := prefix + `]},"warning":""}`
	var s ConfigSuggestion
	if err := json.Unmarshal([]byte(full), &s); err != nil {
		t.Fatalf("the complete tool input does not parse: %v", err)
	}
	if s.Impact == nil || len(s.Impact.Affected) != 1 {
		t.Errorf("impact did not survive: %+v", s.Impact)
	}
}

// An empty stream — the server accepted the request and sent nothing at all. It must be an error,
// not an empty proposal, and it must not panic on the way there.
func TestAnEmptyStreamIsAnError(t *testing.T) {
	_, deltas, err := replayStreamWithDeltas(t, nil)
	if err == nil {
		t.Fatal("a stream with no frames must be refused")
	}
	if len(deltas) != 0 {
		t.Errorf("nothing was sent, so nothing may be previewed: %v", deltas)
	}
}

func mustJSON(s string) string {
	b, err := json.Marshal(s)
	if err != nil {
		panic(err)
	}
	return string(b)
}
