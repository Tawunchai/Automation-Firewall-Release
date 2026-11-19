package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// What a half-arrived answer must NOT be allowed to become.
//
// streamAnthropicTool used to hand a truncated stream to repairPartialJSON and return the result as
// the authoritative tool call. repairPartialJSON closes whatever containers are still open, so a
// body that stopped halfway through `commands` came back as perfectly valid, perfectly short JSON
// — and the AI Assistant's wizards then offered to write THAT to a live firewall. The half of a
// FortiOS config block that did arrive is not a safe subset of the whole: `config firewall policy /
// edit 0 / set srcaddr …` with no matching `set dstaddr`, `set action`, `next` or `end` is a
// different rule, or an unfinished edit, not a smaller version of the one the user asked for.
//
// Nothing upstream catches it either, which is the reason this needs a test rather than a careful
// reading. A dropped connection ends bufio.Scanner CLEANLY: sc.Err() is nil, the HTTP status was
// 200, no `error` event arrived, and every signal the function has says success. The only positive
// evidence of completion in the protocol is the `message_stop` event plus a `stop_reason`, and
// those are exactly what the cases below withhold one at a time.
//
// This is also the only reason `anthropicAPIURL` in ai.go is a var rather than a const: these rules
// can only be proved against a server that replays recorded SSE frames, including the ones that
// stop halfway, and anthropicPost builds its request against that variable. Nothing in production
// writes it.
func TestStreamRefusesAnAnswerThatNeverFinished(t *testing.T) {
	// The frames a complete, well-formed answer is made of. Each case below edits this sequence.
	const (
		start      = `{"type":"message_start","message":{"usage":{"input_tokens":12}}}`
		blockStart = `{"type":"content_block_start","content_block":{"type":"tool_use","name":"propose_device_config"}}`
		blockStop  = `{"type":"content_block_stop"}`
		stop       = `{"type":"message_stop"}`
	)
	// Split across two deltas on purpose: a tool call arrives as arbitrary slices of JSON text, so
	// a test that sent it in one frame would not exercise the buffer at all.
	delta := func(s string) string {
		b, _ := json.Marshal(s)
		return `{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":` + string(b) + `}}`
	}
	messageDelta := func(reason string) string {
		return `{"type":"message_delta","delta":{"stop_reason":"` + reason + `"},"usage":{"output_tokens":96}}`
	}

	const firstHalf = `{"mode":"config","commands":["config firewall policy","edit 0","set srcaddr \"LAN\""`
	const secondHalf = `,"set dstaddr \"all\"","set action accept","next","end"],"explanation":"done"}`

	complete := []string{
		start, blockStart, delta(firstHalf), delta(secondHalf), blockStop,
		messageDelta("tool_use"), stop,
	}

	cases := []struct {
		name    string
		frames  []string
		wantErr string // a distinctive fragment of the expected error; "" means success
		// wantCommands is checked only on the success case.
		wantCommands int
	}{
		{
			name:         "a complete stream is accepted",
			frames:       complete,
			wantCommands: 7,
		},
		{
			// The case that mattered. The connection dies after the first delta: no
			// content_block_stop, no message_delta, no message_stop. The buffer holds a policy
			// with a source and no destination and no `end`.
			name:    "the connection drops mid-answer",
			frames:  []string{start, blockStart, delta(firstHalf)},
			wantErr: "ended before the model finished",
		},
		{
			// Subtler, and the one a reader is most likely to miss: every frame arrives, the JSON
			// is complete and valid, and only message_stop is missing. The old code returned this
			// happily. There is no way to know the model was done, so it must still be refused.
			name:    "everything arrives except message_stop",
			frames:  []string{start, blockStart, delta(firstHalf), delta(secondHalf), blockStop, messageDelta("tool_use")},
			wantErr: "ended before the model finished",
		},
		{
			// The model ran out of room. It stopped cleanly, so message_stop IS present — which is
			// precisely why sawStop alone is not enough and stop_reason is checked as well.
			name:    "max_tokens is a truncated answer, not a short one",
			frames:  []string{start, blockStart, delta(firstHalf), blockStop, messageDelta("max_tokens"), stop},
			wantErr: "truncated",
		},
		{
			name:    "message_stop with no stop_reason at all",
			frames:  []string{start, blockStart, delta(firstHalf), delta(secondHalf), blockStop, stop},
			wantErr: "without saying why it stopped",
		},
		{
			// "refusal" used to live in this slot as the example of an unknown stop reason. It is
			// not unknown any more — a safety classifier declining is a real outcome with its own
			// message, and the cases below pin that. Something genuinely unrecognised still has
			// to be refused rather than guessed at, so this case keeps its job with a reason the
			// code has never heard of.
			name:    "a stop_reason this code does not accept",
			frames:  []string{start, blockStart, delta(firstHalf), delta(secondHalf), blockStop, messageDelta("something_new"), stop},
			wantErr: "stopped early",
		},
		{
			// A declined request arrives as HTTP 200 with a complete, well-formed stream and no
			// tool call. Before stop_reason was read it came back as "AI did not call the expected
			// tool — please retry": the one failure mode where the advice is guaranteed useless.
			name:    "the request was declined, with a category",
			frames:  []string{start, `{"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"}},"usage":{"output_tokens":12}}`, stop},
			wantErr: "cyber",
		},
		{
			name:    "the request was declined, and the reason says what to do instead",
			frames:  []string{start, `{"type":"message_delta","delta":{"stop_reason":"refusal","stop_details":{"type":"refusal"}},"usage":{"output_tokens":12}}`, stop},
			wantErr: "Retrying the same wording will not help",
		},
		{
			// tool_choice is "auto", so the model MAY answer in prose. The user should see what it
			// said, not a generic retry line.
			name: "the model answered in words instead of calling the tool",
			frames: []string{
				start,
				`{"type":"content_block_start","content_block":{"type":"text"}}`,
				`{"type":"content_block_delta","delta":{"type":"text_delta","text":"Which interface should this apply to?"}}`,
				`{"type":"content_block_stop"}`,
				messageDelta("end_turn"), stop,
			},
			wantErr: "Which interface should this apply to?",
		},
		{
			// A finished stream whose payload is still not JSON. The repair path is gone, so this
			// is an error rather than a guess — repairPartialJSON stays display-only.
			name:    "finished, but the tool input is malformed",
			frames:  []string{start, blockStart, delta(`{"mode":"config",,,`), blockStop, messageDelta("tool_use"), stop},
			wantErr: "malformed tool call",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := replayStream(t, tc.frames)

			if tc.wantErr == "" {
				if err != nil {
					t.Fatalf("a complete stream was refused: %v", err)
				}
				var got struct {
					Commands []string `json:"commands"`
				}
				if err := json.Unmarshal(raw, &got); err != nil {
					t.Fatalf("the returned tool input is not valid JSON: %v\n%s", err, raw)
				}
				if len(got.Commands) != tc.wantCommands {
					t.Errorf("got %d commands, want %d — the stream was accepted but assembled wrong:\n%s",
						len(got.Commands), tc.wantCommands, raw)
				}
				return
			}

			if err == nil {
				t.Fatalf("this stream was ACCEPTED and would have been offered for deployment:\n%s", raw)
			}
			if !strings.Contains(err.Error(), tc.wantErr) {
				t.Errorf("refused for the wrong reason\n got: %v\nwant it to mention: %q", err, tc.wantErr)
			}
			if raw != nil {
				t.Errorf("refused but still returned %d bytes of tool input; callers must get nothing to deploy", len(raw))
			}
		})
	}
}

// replayStream serves `frames` as an SSE body and runs streamAnthropicTool against it.
//
// It points anthropicAPIURL at the test server and restores it with t.Cleanup. The subtests do not
// run in parallel, for that reason.
func replayStream(t *testing.T, frames []string) (json.RawMessage, error) {
	t.Helper()

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		for _, f := range frames {
			// The real stream sends an `event:` line too; the reader skips anything that is not a
			// `data:` line, so the frames alone are a faithful enough replay.
			if _, err := w.Write([]byte("data: " + f + "\n\n")); err != nil {
				return
			}
		}
		// Returning here closes the body cleanly, with no trailing frames — which is exactly the
		// "the connection dropped and nothing said so" shape the cases above rely on.
	}))
	t.Cleanup(srv.Close)

	original := anthropicAPIURL
	anthropicAPIURL = srv.URL
	t.Cleanup(func() { anthropicAPIURL = original })

	tool := anthropicTool{
		Name:        proposeConfigTool,
		InputSchema: map[string]any{"type": "object"},
	}
	// A key is required by the function, not by the test server: streamAnthropicTool is reached
	// only with one, and sending a placeholder keeps the request shaped like the real thing.
	return streamAnthropicTool(context.Background(), "test-key", nil, nil, tool, 256, nil)
}
