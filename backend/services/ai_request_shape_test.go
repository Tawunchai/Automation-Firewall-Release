package services

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// What this file is for: the request BODY is the contract with the API, and most of what is in it
// was put there for a reason that cannot be seen from the code reading the response. A forced
// tool_choice pinned this product to a previous model generation while everything compiled and
// every test passed. `strict` is what replaces the server-side validation that
// eager_input_streaming switches off. A second cache breakpoint is the difference between paying
// for the device inventory once and paying for it on every message.
//
// So these tests capture the bytes that would have gone to Anthropic, and assert on those.

// captureRequest runs fn against a stub API that records the request body and answers with one
// minimal tool call, and returns the decoded body.
func captureRequest(t *testing.T, fn func(ctx context.Context) error) map[string]any {
	t.Helper()

	var got map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if err := json.Unmarshal(body, &got); err != nil {
			t.Errorf("request body is not JSON: %v", err)
		}
		if r.Header.Get("anthropic-beta") != anthropicFallbackBeta {
			t.Errorf("anthropic-beta = %q, want %q — the fallbacks field in the body is ignored without it",
				r.Header.Get("anthropic-beta"), anthropicFallbackBeta)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"content":[{"type":"tool_use","name":"` + proposeConfigTool +
			`","input":{"mode":"query","commands":[],"explanation":"ok"}}],"stop_reason":"tool_use","usage":{}}`))
	}))
	t.Cleanup(srv.Close)

	original := anthropicAPIURL
	anthropicAPIURL = srv.URL
	t.Cleanup(func() { anthropicAPIURL = original })

	if err := fn(context.Background()); err != nil {
		t.Fatalf("the call failed before the body could be checked: %v", err)
	}
	if got == nil {
		t.Fatal("no request reached the stub API")
	}
	return got
}

func proposeOnce(ctx context.Context) error {
	_, err := callAnthropicTool(ctx, "test-key", plainSystem("sys"),
		[]anthropicMessage{{Role: "user", Content: "hello"}}, proposeConfigToolDef(), 256)
	return err
}

func TestRequestNeverForcesTheToolCall(t *testing.T) {
	body := captureRequest(t, proposeOnce)

	choice, ok := body["tool_choice"].(map[string]any)
	if !ok {
		t.Fatalf("tool_choice is missing from the request: %v", body["tool_choice"])
	}
	// {"type":"tool"} and {"type":"any"} are both a 400 on every model from Opus 5.5 / Sonnet 5.5
	// onward. This assertion is what stands between that and the next model bump.
	if choice["type"] != "auto" {
		t.Errorf("tool_choice.type = %v, want \"auto\" — a forced tool_choice is a 400 on current models", choice["type"])
	}
	if _, present := choice["name"]; present {
		t.Errorf("tool_choice carries a name (%v); the auto form must serialise as {\"type\":\"auto\"} alone", choice["name"])
	}
}

func TestRequestMarksItsToolStrict(t *testing.T) {
	body := captureRequest(t, proposeOnce)

	tools, ok := body["tools"].([]any)
	if !ok || len(tools) != 1 {
		t.Fatalf("tools = %v, want exactly one", body["tools"])
	}
	tool, ok := tools[0].(map[string]any)
	if !ok {
		t.Fatalf("the tool is not an object: %v", tools[0])
	}
	if tool["strict"] != true {
		t.Error("the tool is not strict — with eager_input_streaming on, nothing else validates " +
			"what the model puts in `commands`, and `commands` is what gets written to a firewall")
	}
	schema, ok := tool["input_schema"].(map[string]any)
	if !ok {
		t.Fatalf("input_schema is missing: %v", tool["input_schema"])
	}
	if schema["additionalProperties"] != false {
		t.Error("input_schema has no additionalProperties:false — the API rejects a strict tool without it")
	}
	if _, ok := schema["required"].([]any); !ok {
		t.Errorf("input_schema has no required list: %v", schema["required"])
	}
}

// The audit-remediation tool is three objects deep. additionalProperties is required on EVERY
// object in a strict schema, so a root-only helper would 400 exactly that request — the one that
// runs least often and would therefore be found last.
func TestStrictSchemaReachesNestedObjects(t *testing.T) {
	schema := strictInputSchema(map[string]any{
		"type": "object",
		"properties": map[string]any{
			"order": map[string]any{
				"type": "array",
				"items": map[string]any{
					"type":       "object",
					"properties": map[string]any{"check": map[string]any{"type": "string"}},
					"required":   []string{"check"},
				},
			},
			"risk": map[string]any{"type": "string"},
		},
		"required": []string{"order"},
	})

	if schema["additionalProperties"] != false {
		t.Fatal("the root object was not marked")
	}
	items := schema["properties"].(map[string]any)["order"].(map[string]any)["items"].(map[string]any)
	if items["additionalProperties"] != false {
		t.Error("an object nested inside an array was not marked")
	}
	// A string property is not an object and must NOT grow the key — "this string has no
	// additional properties" is not a schema the API accepts.
	risk := schema["properties"].(map[string]any)["risk"].(map[string]any)
	if _, present := risk["additionalProperties"]; present {
		t.Error("a string property was given additionalProperties")
	}
}

// strictInputSchema runs per request over literals the callers rebuild each time; mutating in
// place is the kind of thing that works until two requests overlap.
func TestStrictSchemaDoesNotMutateTheInput(t *testing.T) {
	in := map[string]any{"type": "object", "properties": map[string]any{}}
	_ = strictInputSchema(in)
	if _, present := in["additionalProperties"]; present {
		t.Error("the input schema was modified in place")
	}
}

func TestRequestAsksForAnEffortAndAFallback(t *testing.T) {
	body := captureRequest(t, proposeOnce)

	oc, ok := body["output_config"].(map[string]any)
	if !ok {
		t.Fatal("output_config is missing — without it the model runs at its own default effort, " +
			"which is spent before the first delta and is invisible to the TTFT number")
	}
	if oc["effort"] != defaultAnthropicEffort {
		t.Errorf("output_config.effort = %v, want %q", oc["effort"], defaultAnthropicEffort)
	}
	if body["fallbacks"] != anthropicFallbacks {
		t.Errorf("fallbacks = %v, want %q", body["fallbacks"], anthropicFallbacks)
	}
}

func TestEffortIsConfigurableAndRefusesNonsense(t *testing.T) {
	t.Setenv("ANTHROPIC_EFFORT", "xhigh")
	if got := anthropicEffort(); got != "xhigh" {
		t.Errorf("ANTHROPIC_EFFORT=xhigh gave %q", got)
	}
	t.Setenv("ANTHROPIC_EFFORT", "  HIGH  ")
	if got := anthropicEffort(); got != "high" {
		t.Errorf("a padded, upper-case value gave %q", got)
	}
	// An unknown value must not travel to the API: it would 400 the whole request, and the user
	// would see a failed proposal instead of a configuration mistake.
	t.Setenv("ANTHROPIC_EFFORT", "turbo")
	if got := anthropicEffort(); got != defaultAnthropicEffort {
		t.Errorf("ANTHROPIC_EFFORT=turbo gave %q, want the default %q", got, defaultAnthropicEffort)
	}
	t.Setenv("ANTHROPIC_EFFORT", "")
	if got := anthropicEffort(); got != defaultAnthropicEffort {
		t.Errorf("unset gave %q", got)
	}
}

// "max" is in the API's enum and is the one value this console will not send.
//
// Measured three times on 2026-11-18 against the real streamed request: at that depth the model's
// thinking consumes the entire maxConfigOutputTokens budget before it reaches its tool call, the
// response comes back with no tool use at all, and the user is told "AI did not call the expected
// tool — please retry" after about 57 seconds. A retry does the same. So honouring the setting
// means every proposal fails; refusing it means the assistant works and one log line says why.
//
// If maxConfigOutputTokens is ever raised enough for max to finish, this is the test that should
// fail and be deleted — which is the point of asserting it here rather than only in a comment.
func TestEffortMaxIsRefusedBecauseItCannotFinish(t *testing.T) {
	for _, v := range []string{"max", "MAX", "  max  "} {
		t.Setenv("ANTHROPIC_EFFORT", v)
		if got := anthropicEffort(); got != defaultAnthropicEffort {
			t.Errorf("ANTHROPIC_EFFORT=%q gave %q, want the default %q — sending max makes every "+
				"proposal fail after ~57s", v, got, defaultAnthropicEffort)
		}
	}
	// The refusal is only worth anything while the budget is still the one it was measured against.
	if maxConfigOutputTokens != 8192 {
		t.Errorf("maxConfigOutputTokens is %d, not the 8192 the max-effort failure was measured "+
			"against — re-run the sweep before trusting this refusal", maxConfigOutputTokens)
	}
}

// Tools render BEFORE the system blocks, so if the streaming and non-streaming paths sent even
// slightly different tool JSON they would have different cache prefixes and neither would ever hit
// the other's entry.
func TestTheToolDefinitionIsStable(t *testing.T) {
	a, err := json.Marshal(proposeConfigToolDef())
	if err != nil {
		t.Fatal(err)
	}
	b, err := json.Marshal(proposeConfigToolDef())
	if err != nil {
		t.Fatal(err)
	}
	if string(a) != string(b) {
		t.Errorf("two calls produced different tool JSON:\n%s\n%s", a, b)
	}
	if !strings.Contains(string(a), `"eager_input_streaming":true`) {
		t.Error("eager_input_streaming is not set — the stream stalls ~18s without it")
	}
}

// A refusal is HTTP 200 with no tool call. Before stop_reason was read it surfaced as
// "AI did not call the expected tool — please retry": advice that could never work.
func TestRefusalIsReportedAsARefusal(t *testing.T) {
	stubAnthropic(t, `{"content":[],"stop_reason":"refusal",`+
		`"stop_details":{"type":"refusal","category":"cyber","explanation":"declined"},"usage":{}}`)

	_, err := proposeRaw()
	if err == nil {
		t.Fatal("a refusal was treated as success")
	}
	for _, want := range []string{"declined", "cyber"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the refusal message does not mention %q: %v", want, err)
		}
	}
	if strings.Contains(err.Error(), "please retry") {
		t.Errorf("the refusal message still advises a retry, which cannot help: %v", err)
	}
}

// With tool_choice "auto" the model may answer in prose — a question back, or a reason it will not
// guess. Those words are more use to the reader than a generic retry line.
func TestProseAnswerIsSurfacedToTheUser(t *testing.T) {
	stubAnthropic(t, `{"content":[{"type":"text","text":"Which interface?"}],`+
		`"stop_reason":"end_turn","usage":{}}`)

	_, err := proposeRaw()
	if err == nil {
		t.Fatal("a prose answer was treated as a config proposal")
	}
	if !strings.Contains(err.Error(), "Which interface?") {
		t.Errorf("the model's own words were dropped: %v", err)
	}
}

// stubAnthropic points the client at a server that always answers with body.
func stubAnthropic(t *testing.T, body string) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	original := anthropicAPIURL
	anthropicAPIURL = srv.URL
	t.Cleanup(func() { anthropicAPIURL = original })
}

func proposeRaw() (json.RawMessage, error) {
	return callAnthropicTool(context.Background(), "test-key", plainSystem("sys"),
		[]anthropicMessage{{Role: "user", Content: "hi"}}, proposeConfigToolDef(), 256)
}

// Cancellation has to reach the HTTP request, or pressing cancel leaves the call running — and
// billing — with nobody waiting for the answer.
func TestACancelledContextStopsTheRequest(t *testing.T) {
	reached := make(chan struct{})
	release := make(chan struct{})
	// The handler must be released explicitly, and the release must happen BEFORE srv.Close:
	// httptest's Close waits for outstanding handlers, and a handler parked on r.Context().Done()
	// alone can sit there long after the client has gone, because the server only notices a
	// disconnected peer when it next touches the connection. `defer` rather than t.Cleanup for
	// exactly that ordering — deferred calls run before any cleanup, and t.Cleanup is LIFO, so a
	// cleanup registered here would run AFTER srv.Close and the test would hang instead of fail.
	defer close(release)
	srv := httptest.NewServer(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		close(reached)
		select {
		case <-r.Context().Done(): // the client gave up — what this test is about
		case <-release: // the test is over
		}
	}))
	t.Cleanup(srv.Close)
	original := anthropicAPIURL
	anthropicAPIURL = srv.URL
	t.Cleanup(func() { anthropicAPIURL = original })

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := callAnthropicTool(ctx, "test-key", plainSystem("sys"),
			[]anthropicMessage{{Role: "user", Content: "hi"}}, proposeConfigToolDef(), 256)
		done <- err
	}()

	<-reached
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("cancelling the context did not stop the request")
		}
		// And it must come back AT the cancellation, not after the retry ladder: a cancelled
		// request that still sleeps through 2s + 4s of backoff is a UI that ignores the button
		// for six seconds and then reports the wrong error.
		if !strings.Contains(err.Error(), "context canceled") {
			t.Errorf("cancelling produced the wrong error (a retry probably swallowed it): %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the call did not return within 2s of cancelling — it is retrying a request nobody is waiting for")
	}
}

// ── Cache breakpoints ────────────────────────────────────────────────────────

func TestHistoryIsMarkedCacheableAndKeepsItsShape(t *testing.T) {
	messages := []anthropicMessage{
		{Role: "user", Content: "first"},
		{Role: "assistant", Content: "answer"},
		{Role: "user", Content: "the new question"},
	}
	markLastHistoryTurnCacheable(messages, 2)

	// Every history turn takes the SAME shape, whether or not it carries the marker: if only the
	// marked one were converted, the difference would move backwards through the transcript on
	// each message and the prefix would stop matching — a cache that misses on exactly the long
	// conversations it exists for.
	for i := 0; i < 2; i++ {
		blocks, ok := messages[i].Content.([]any)
		if !ok || len(blocks) != 1 {
			t.Fatalf("history turn %d was not converted to a block array: %#v", i, messages[i].Content)
		}
		block := blocks[0].(map[string]any)
		if block["type"] != "text" {
			t.Errorf("turn %d is not a text block: %v", i, block["type"])
		}
		_, marked := block["cache_control"]
		if want := i == 1; marked != want {
			t.Errorf("turn %d cache_control present = %v, want %v (only the LAST history turn is marked)", i, marked, want)
		}
	}

	// The current user turn is new by definition and may already carry images.
	if _, converted := messages[2].Content.([]any); converted {
		t.Error("the current user turn was rewritten; it must be left exactly as the caller built it")
	}
}

func TestMarkingHistoryIsSafeWhenThereIsNone(t *testing.T) {
	messages := []anthropicMessage{{Role: "user", Content: "only message"}}
	markLastHistoryTurnCacheable(messages, 0)
	if messages[0].Content != "only message" {
		t.Errorf("the first message of a conversation was altered: %#v", messages[0].Content)
	}
	// Out of range rather than panicking: historyLen comes from a different slice than messages.
	markLastHistoryTurnCacheable(messages, 5)
}
