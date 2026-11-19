// Package services — streaming half of the AI Assistant.
//
// WHY THIS EXISTS
// A full "policy + addresses + services + AntiVirus + Web Filter + Application Control" answer is
// ~3,100 output tokens. The model emits ~60 tokens/s, so the answer takes ~50s to write — and with
// a plain request/response call the user stares at a spinner for all 50 of them before a single
// character appears. Streaming does not make the model faster; it makes the wait *visible*: the
// first text lands in ~2-3s and the explanation and CLI fill in as they are written.
//
// WHAT IS SAFE TO SHOW vs WHAT IS SAFE TO DEPLOY
// The streamed text is a PREVIEW ONLY. The model's tool call is validated and repaired after the
// stream completes (applyDeviceFacts: invented signature ids dropped, families completed, redundant
// profiles removed). The wizards and the deploy path use the FINAL ConfigSuggestion this file
// returns — never the preview. So streaming cannot change what reaches the FortiGate.
package services

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"network_automation/services/platform"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"network_automation/entity"
)

// AIStreamDelta carries the text that appeared since the previous delta. Both fields are
// incremental — append them to what you already have, never replace.
type AIStreamDelta struct {
	Explanation string // new characters of the explanation
	CLI         string // new characters of the joined CLI commands
}

// anthropicStreamEvent is one `data:` line of Anthropic's SSE stream. Only the fields this file
// acts on are modelled; the rest of each event is ignored.
type anthropicStreamEvent struct {
	Type         string `json:"type"`
	ContentBlock *struct {
		Type string `json:"type"`
		Name string `json:"name"`
	} `json:"content_block,omitempty"`
	Delta *struct {
		Type        string `json:"type"`
		PartialJSON string `json:"partial_json"`
		// Text is a "text_delta" — the model answering in prose. With a forced tool_choice this
		// never happened; with "auto" it is how a clarifying question or a refusal arrives, and
		// without reading it the user would get "AI did not call the expected tool" while the
		// model's actual words were on the wire.
		Text        string                `json:"text"`
		StopReason  string                `json:"stop_reason"`
		StopDetails *anthropicStopDetails `json:"stop_details,omitempty"`
	} `json:"delta,omitempty"`
	Message *struct {
		Usage anthropicUsage `json:"usage"`
	} `json:"message,omitempty"`
	Usage *anthropicUsage `json:"usage,omitempty"`
	Error *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// GenerateDeviceConfigStream is GenerateDeviceConfig with progress. onDelta is called (from this
// goroutine) every time the model produces more text; the returned ConfigSuggestion is the
// authoritative, validated result — exactly what the non-streaming path would have returned.
func GenerateDeviceConfigStream(
	ctx context.Context,
	device *entity.NetworkDevice,
	login DeviceLogin,
	prompt string,
	history []ChatMessage,
	images []ImageInput,
	onDelta func(AIStreamDelta),
) (*ConfigSuggestion, error) {
	apiKey := AnthropicAPIKey()
	if apiKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not configured")
	}
	system, messages, facts, err := buildConfigPrompt(device, login, prompt, history, images)
	if err != nil {
		return nil, err
	}

	raw, err := streamAnthropicTool(ctx, apiKey, system, messages, proposeConfigToolDef(), maxConfigOutputTokens, onDelta)
	if err != nil {
		return nil, err
	}

	var suggestion ConfigSuggestion
	if err := json.Unmarshal(raw, &suggestion); err != nil {
		return nil, fmt.Errorf("failed to decode AI commands: %w", err)
	}
	// Same validation the non-streaming path runs — this, not the preview, is what gets deployed.
	applyDeviceFacts(&suggestion, facts)
	return &suggestion, nil
}

// streamAnthropicTool runs a forced-tool request with "stream": true and returns the tool's
// complete input JSON. While the stream runs it reports the text produced so far through onDelta.
func streamAnthropicTool(
	ctx context.Context,
	apiKey string,
	system []anthropicSystemBlock,
	messages []anthropicMessage,
	tool anthropicTool,
	maxTokens int,
	onDelta func(AIStreamDelta),
) (json.RawMessage, error) {
	reqBody := anthropicRequest{
		Model: anthropicModel(), MaxTokens: maxTokens, System: system,
		Messages: messages, Tools: []anthropicTool{tool},
		ToolChoice:   toolChoiceAuto(),
		OutputConfig: &anthropicOutputConfig{Effort: anthropicEffort()},
		Fallbacks:    anthropicFallbacks,
		Stream:       true,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	// Retries happen before the first byte of the stream is read, so a retried request can never
	// re-emit text the browser has already been shown. See sendAnthropic.
	//
	// Accept-Encoding: identity because Go's transport otherwise asks for gzip and decompresses for
	// you — free on a normal response, but on an SSE stream it puts a compression buffer between the
	// model and us, so events arrive in bursts instead of as they are produced.
	// A watchdog, not a wall clock.
	//
	// The client used to carry Timeout: 180s, which bounds the WHOLE exchange — so an answer that
	// was still streaming correctly at 180 seconds was cut off mid-config-block, and the UI showed
	// the half that had arrived. What actually needs catching is a stream that STOPS producing:
	// a dropped proxy, a stalled connection. So the request gets a cancellable context, and every
	// event received resets an idle timer; only silence longer than anthropicStreamIdleTimeout
	// cancels it. A long answer can now take as long as it takes.
	streamCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	idle := newIdleGuard(cancel, anthropicStreamIdleTimeout)
	defer idle.stop()

	build := anthropicPost(streamCtx, apiKey, body, anthropicBetaHeader(map[string]string{
		"Accept":          "text/event-stream",
		"Accept-Encoding": "identity",
	}))

	started := time.Now()
	client := anthropicHTTPClient()
	resp, err := sendAnthropic(client, build, tool.Name+" (stream)")
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		// An error response is plain JSON, not a stream.
		var e anthropicResponse
		raw := make([]byte, 2048)
		n, _ := resp.Body.Read(raw)
		if json.Unmarshal(raw[:n], &e) == nil && e.Error != nil {
			return nil, fmt.Errorf("anthropic error (%s): %s", e.Error.Type, e.Error.Message)
		}
		return nil, fmt.Errorf("anthropic HTTP %d: %s", resp.StatusCode, platform.TruncateUTF8(string(raw[:n]), 200))
	}

	var (
		buf        strings.Builder // accumulated tool-input JSON (grows to ~12 KB)
		answerText strings.Builder // prose the model wrote instead of calling the tool
		usage      anthropicUsage
		stopReason string
		// stopDetails explains a "refusal" and is nil for every other stop reason.
		stopDetails *anthropicStopDetails
		sentExp     int // characters of the explanation already handed to onDelta
		sentCLI     int
		inToolUse   bool
		// sawStop records the `message_stop` event, which is the ONLY thing in the protocol that
		// says the model finished. Without it a stream that simply ended — a proxy dropping an idle
		// connection, a half-second of network, an EOF — is indistinguishable from a complete one:
		// the scanner stops, sc.Err() is nil, and the buffer holds a truncated prefix.
		sawStop bool
		ttft    time.Duration // time to first token — the number the user actually feels
	)

	flush := func() {
		_, commands, explanation := parsePartialToolInput(buf.String())
		cli := strings.Join(commands, "\n")
		var d AIStreamDelta
		if len(explanation) > sentExp {
			d.Explanation = explanation[sentExp:]
			sentExp = len(explanation)
		}
		if len(cli) > sentCLI {
			d.CLI = cli[sentCLI:]
			sentCLI = len(cli)
		}
		if (d.Explanation != "" || d.CLI != "") && onDelta != nil {
			onDelta(d)
		}
	}

	sc := bufio.NewScanner(resp.Body)
	sc.Buffer(make([]byte, 0, 64*1024), 1024*1024)
	for sc.Scan() {
		idle.tick(anthropicStreamIdleTimeout)
		line := sc.Text()
		if !strings.HasPrefix(line, "data:") {
			continue // "event:" lines and blank separators carry no payload we need
		}
		payload := strings.TrimSpace(strings.TrimPrefix(line, "data:"))
		if payload == "" {
			continue
		}
		var ev anthropicStreamEvent
		if json.Unmarshal([]byte(payload), &ev) != nil {
			continue
		}

		switch ev.Type {
		case "message_start":
			if ev.Message != nil {
				usage = ev.Message.Usage // input + cache_read land here
			}
		case "content_block_start":
			inToolUse = ev.ContentBlock != nil &&
				ev.ContentBlock.Type == "tool_use" && ev.ContentBlock.Name == tool.Name
		case "content_block_delta":
			// A text block: the model is answering in prose rather than calling the tool. Kept so
			// the failure at the end of this function can quote it.
			if ev.Delta != nil && ev.Delta.Type == "text_delta" && ev.Delta.Text != "" {
				answerText.WriteString(ev.Delta.Text)
			}
			if inToolUse && ev.Delta != nil && ev.Delta.Type == "input_json_delta" {
				if ttft == 0 {
					ttft = time.Since(started)
				}
				buf.WriteString(ev.Delta.PartialJSON)
				flush()
			}
		case "content_block_stop":
			inToolUse = false
		case "message_delta":
			if ev.Delta != nil && ev.Delta.StopReason != "" {
				stopReason = ev.Delta.StopReason
				stopDetails = ev.Delta.StopDetails
			}
			if ev.Usage != nil {
				usage.OutputTokens = ev.Usage.OutputTokens
			}
		case "message_stop":
			sawStop = true
		case "error":
			if ev.Error != nil {
				return nil, fmt.Errorf("anthropic error (%s): %s", ev.Error.Type, ev.Error.Message)
			}
		}
	}
	if err := sc.Err(); err != nil {
		switch {
		case idle.timedOut():
			return nil, fmt.Errorf("the AI stopped sending for %s — the connection dropped mid-answer; please retry",
				anthropicStreamIdleTimeout)
		case ctx.Err() != nil:
			// The CALLER's context, not the derived one: this is the user closing the tab or
			// pressing cancel, which is not an error to report as a failure.
			return nil, fmt.Errorf("the request was cancelled: %w", ctx.Err())
		}
		return nil, fmt.Errorf("AI stream interrupted: %w", err)
	}

	usage.log(tool.Name+" (stream)", time.Since(started))
	// TTFT is the number the user feels — if it drifts up towards the total, the stream is being
	// buffered somewhere and the UI is back to showing a spinner.
	log.Printf("[ai] stream: first token after %.1fs, then %d tokens over %.1fs",
		ttft.Seconds(), usage.OutputTokens, (time.Since(started) - ttft).Seconds())
	flush() // emit whatever the last delta added

	// A refusal is answered with HTTP 200 and no tool call, so it has to be read here or it looks
	// exactly like the model ignoring its instructions.
	if stopReason == "refusal" {
		return nil, refusalError(stopDetails)
	}

	raw := buf.String()
	if strings.TrimSpace(raw) == "" {
		return nil, noToolCallError(answerText.String())
	}

	// ── The stream has to have FINISHED before any of it may be deployed ─────────────────────
	//
	// This used to hand a truncated answer to repairPartialJSON and return the result as
	// authoritative. repairPartialJSON closes whatever containers are still open, so a body that
	// stopped halfway through `commands` came back as a perfectly valid, perfectly short tool call
	// — and the wizards then offered to write THAT to the firewall. The half of a FortiOS config
	// block that did arrive is not a safe subset of the whole: `config firewall policy / edit 0 /
	// set srcaddr …` without the matching `set dstaddr`/`set action`/`next`/`end` is a different
	// rule, or an unfinished edit, not a smaller version of the one the user asked for.
	//
	// Nothing upstream catches it either: a dropped connection ends bufio.Scanner cleanly, so
	// sc.Err() is nil and every other signal says success. So the two positive proofs of
	// completion are required here, and repair stays what this file's header says it is —
	// display-only, for the text streamed to the screen while the answer is still being written.
	if !sawStop {
		return nil, fmt.Errorf("AI stream ended before the model finished (no message_stop after %d output token(s)) — the connection dropped mid-answer; please retry",
			usage.OutputTokens)
	}
	switch stopReason {
	case "tool_use", "end_turn":
		// The model stopped because it was done.
	case "max_tokens":
		return nil, errors.New("AI response was truncated (max_tokens reached) — try a shorter/simpler request")
	case "":
		return nil, errors.New("AI stream finished without saying why it stopped — please retry")
	default:
		return nil, fmt.Errorf("AI stopped early (stop_reason %q) — please retry", stopReason)
	}
	if !json.Valid([]byte(raw)) {
		return nil, errors.New("AI returned a malformed tool call — please retry")
	}
	return json.RawMessage(raw), nil
}

// ── Partial JSON ──────────────────────────────────────────────────────────────
//
// Anthropic streams a forced tool call as `input_json_delta` fragments — arbitrary slices of the
// JSON text, which means the buffer is almost never valid JSON on its own:
//
//	{"mode":"config","commands":["config firewall addr
//
// To show progress we have to read the fields out of that. repairPartialJSON closes whatever is
// still open (a string, an array, the object) so the buffer parses, and parsePartialToolInput then
// reads the fields normally. This is display-only — the authoritative parse happens after the
// stream, on the complete JSON.

type partialToolInput struct {
	Mode        string   `json:"mode"`
	Commands    []string `json:"commands"`
	Explanation string   `json:"explanation"`
}

func parsePartialToolInput(buf string) (mode string, commands []string, explanation string) {
	if strings.TrimSpace(buf) == "" {
		return "", nil, ""
	}
	var p partialToolInput
	if json.Unmarshal([]byte(repairPartialJSON(buf)), &p) != nil {
		return "", nil, ""
	}
	return p.Mode, p.Commands, p.Explanation
}

// repairPartialJSON turns an in-progress JSON document into a parseable one by discarding the
// half-written token at the end and closing every container that is still open.
func repairPartialJSON(s string) string {
	var stack []byte // pending closers, innermost last
	inStr, esc := false, false

	for i := 0; i < len(s); i++ {
		c := s[i]
		if esc {
			esc = false
			continue
		}
		if inStr {
			switch c {
			case '\\':
				esc = true
			case '"':
				inStr = false
			}
			continue
		}
		switch c {
		case '"':
			inStr = true
		case '{':
			stack = append(stack, '}')
		case '[':
			stack = append(stack, ']')
		case '}', ']':
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		}
	}

	out := s
	if esc {
		out = out[:len(out)-1] // trailing lone backslash — the escape's payload hasn't arrived
	}
	if inStr {
		out = trimIncompleteEscape(out)
		// A fragment boundary can fall inside a multi-byte rune (Thai is 3 bytes each), which
		// would make the whole document invalid UTF-8. Drop the incomplete tail.
		for len(out) > 0 && !utf8.ValidString(out) {
			out = out[:len(out)-1]
		}
		out += `"`
	}
	// Always run the dangling-token trim — including after closing an open string, because that
	// string may itself be a half-typed KEY (`…"commands":[…],"expl`) or even an empty one
	// (`…],"`), both of which leave a value-less key in the object once the quote is closed.
	innermost := byte(0)
	if len(stack) > 0 {
		innermost = stack[len(stack)-1]
	}
	out = trimDanglingTokens(out, innermost)

	for i := len(stack) - 1; i >= 0; i-- {
		out += string(stack[i])
	}
	return out
}

// trimIncompleteEscape drops a `\uXXXX` escape whose hex digits have not all arrived yet.
func trimIncompleteEscape(s string) string {
	for i := len(s) - 1; i >= 0 && i >= len(s)-6; i-- {
		if s[i] != '\\' {
			continue
		}
		// Count the backslashes before this one — an even count means this one is a real escape.
		b := 0
		for j := i - 1; j >= 0 && s[j] == '\\'; j-- {
			b++
		}
		if b%2 != 0 {
			continue // this backslash is itself escaped
		}
		if i+1 < len(s) && s[i+1] == 'u' && len(s)-(i+2) < 4 {
			return s[:i] // \u with fewer than 4 hex digits so far
		}
		break
	}
	return s
}

// trimDanglingTokens removes the half-written tail of an in-progress document: a trailing `,`, a
// `"key":` whose value has not arrived, or a bare `"key"` whose colon has not arrived. `innermost`
// is the closer of the container the tail sits in ('}' object, ']' array, 0 top level) — it is what
// tells a dangling KEY apart from a finished array ELEMENT, which must be kept.
//
// Without the key case, the buffer `{"mode":"config","commands":["a"],"explanation"` repairs to
// `{...,"explanation"}` — invalid — so the whole parse fails and the commands already streamed
// vanish from the UI for one frame. That flicker is what this handles.
func trimDanglingTokens(s string, innermost byte) string {
	for {
		s = strings.TrimRight(s, " \t\r\n")
		if s == "" {
			return s
		}
		switch s[len(s)-1] {
		case ',':
			s = s[:len(s)-1]
		case ':':
			s = strings.TrimRight(s[:len(s)-1], " \t\r\n")
			s = trimTrailingString(s) // drop the orphaned key too
		case '"':
			if innermost != '}' {
				return s // a completed element inside an array — keep it
			}
			before := strings.TrimRight(trimTrailingString(s), " \t\r\n")
			if before == "" {
				return s
			}
			// Preceded by '{' or ',' → the string is a KEY still waiting for its ':' → drop it.
			// Preceded by ':' → it is a finished VALUE → keep it.
			if c := before[len(before)-1]; c == '{' || c == ',' {
				s = before
				continue
			}
			return s
		default:
			return s
		}
	}
}

// trimTrailingString removes the complete JSON string literal at the end of s (used to delete a key
// whose value never arrived).
func trimTrailingString(s string) string {
	if s == "" || s[len(s)-1] != '"' {
		return s
	}
	for i := len(s) - 2; i >= 0; i-- {
		if s[i] != '"' {
			continue
		}
		b := 0
		for j := i - 1; j >= 0 && s[j] == '\\'; j-- {
			b++
		}
		if b%2 == 0 {
			return s[:i] // unescaped quote = the opening one
		}
	}
	return s
}

// ── The idle guard ────────────────────────────────────────────────────────────
//
// anthropicStreamIdleTimeout is how long the stream may say NOTHING before we give up on it.
//
// This is the replacement for http.Client.Timeout, and it measures the right thing. A timeout on
// the whole exchange cannot tell a model that is still writing from a connection that has died —
// it cuts off both at the same mark, and the one it hurts is the long, correct answer. Silence
// between events can tell them apart: the API sends events continuously while it works, including
// `ping`s, so two minutes of nothing is a broken connection, not a thoughtful model.
const anthropicStreamIdleTimeout = 120 * time.Second

// idleGuard cancels a request when no event has arrived for d.
//
// It exists because an SSE body cannot carry a per-read deadline through net/http's client API —
// there is no SetReadDeadline on a response body. Cancelling the request context has the same
// effect from the reader's point of view (the next read fails), and it also releases the
// connection, which a bare deadline would not.
type idleGuard struct {
	timer   *time.Timer
	mu      sync.Mutex
	fired   bool
	stopped bool
}

func newIdleGuard(cancel context.CancelFunc, d time.Duration) *idleGuard {
	g := &idleGuard{}
	g.timer = time.AfterFunc(d, func() {
		g.mu.Lock()
		g.fired = true
		g.mu.Unlock()
		cancel()
	})
	return g
}

// tick restarts the clock. Called for every line read off the stream, including the ones this file
// ignores: a `ping` or an `event:` line is still proof the connection is alive.
func (g *idleGuard) tick(d time.Duration) {
	g.mu.Lock()
	defer g.mu.Unlock()
	if g.stopped || g.fired {
		return
	}
	g.timer.Reset(d)
}

func (g *idleGuard) stop() {
	g.mu.Lock()
	defer g.mu.Unlock()
	g.stopped = true
	g.timer.Stop()
}

// timedOut reports whether it was THIS guard that cancelled the request, so the error can say
// "stopped sending" rather than the indistinguishable "context canceled" that a user pressing
// cancel also produces.
func (g *idleGuard) timedOut() bool {
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.fired
}
