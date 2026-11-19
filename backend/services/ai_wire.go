package services

// The Anthropic wire contract: the exact shape of what this console sends to the Messages API and
// what it expects back, plus the small helpers that keep the two honest.
//
// Split out of ai.go, which holds the FortiOS reasoning — the prompt, the device snapshot, the
// validation of what the model proposes. This file holds none of that: it is the protocol, and it
// is where to look when the API changes rather than when the product does. The split happened
// because ai.go crossed the repo's file-size ceiling (backend/test/layout_budget_test.go), and
// this was the part of it that was about something else.

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"
)

type anthropicTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"input_schema"`

	// EagerInputStreaming = fine-grained tool streaming.
	//
	// By DEFAULT Anthropic buffers a tool call's input JSON so that every fragment it streams is
	// syntactically valid. For a short tool call that costs nothing. For ours — a ~7 KB document
	// holding the whole FortiOS config — it means the API emits `{"mode": "config"` and then goes
	// SILENT for ~18 seconds before releasing the rest in one burst (measured, repeatedly, and
	// reproduced outside this codebase with the exact same request body). Streaming the answer is
	// pointless if the first 18 seconds of it arrive at once.
	//
	// This flag turns that buffering off: fragments are sent as the model writes them. The price
	// is that a fragment may be half-written JSON — which is exactly what repairPartialJSON in
	// ai_stream.go exists to read. Worst inter-fragment gap drops from ~18s to ~0.6s.
	EagerInputStreaming bool `json:"eager_input_streaming,omitempty"`

	// Strict makes the API guarantee that tool_use.input validates against InputSchema exactly:
	// no missing required field, no extra one, no wrong type.
	//
	// It is a field on the TOOL, not on tool_choice — and it requires the schema to carry
	// "additionalProperties": false together with "required" (strictInputSchema enforces that here
	// rather than letting the API reject the request).
	//
	// This is the half of the forced-tool_choice replacement that does the real work. The other
	// half (type:"auto" + a prompt line) decides WHETHER the tool is called; this decides whether
	// what comes back can be trusted. It matters more here than in most integrations, because
	// EagerInputStreaming above switches OFF the server-side validation of tool input — before
	// this field, nothing on either side guaranteed `commands` was a list of strings, and what
	// `commands` holds is what gets deployed to a firewall.
	Strict bool `json:"strict,omitempty"`
}

// strictInputSchema returns schema with the keys `strict: true` requires, so a tool definition
// cannot be marked strict and then rejected by the API for a schema that does not qualify.
//
// RECURSIVE, because `additionalProperties: false` is required of EVERY object in the schema, not
// just the root. The audit-remediation tool is three levels deep (order[] → answers[] →
// options[]), so a root-only version of this would have passed review and 400'd that one request
// in production — the one that runs least often and is therefore noticed last.
//
// It copies rather than mutating: these schemas are built by functions that are called per
// request, and a shared map that grows a key on first use is the kind of thing that works until
// two requests race.
func strictInputSchema(schema map[string]any) map[string]any {
	out := make(map[string]any, len(schema)+1)
	for k, v := range schema {
		switch k {
		case "properties":
			// Each value here is itself a schema — recurse into every one.
			if props, ok := v.(map[string]any); ok {
				cp := make(map[string]any, len(props))
				for name, sub := range props {
					cp[name] = strictSubSchema(sub)
				}
				out[k] = cp
				continue
			}
		case "items":
			// An array's element schema.
			out[k] = strictSubSchema(v)
			continue
		}
		out[k] = v
	}
	if t, _ := out["type"].(string); t == "object" {
		out["additionalProperties"] = false
	}
	return out
}

// strictSubSchema applies strictInputSchema to a nested schema, leaving anything that is not a
// schema map (a bare string, a list) exactly as it was.
func strictSubSchema(v any) any {
	if m, ok := v.(map[string]any); ok {
		return strictInputSchema(m)
	}
	return v
}

// anthropicToolChoice says how the model may use the tools.
//
// This used to be {type:"tool", name:…} — a FORCED call. Every model from Opus 5.5 / Sonnet 5.5 /
// Fable 5.1 onward answers a forced tool_choice with a 400 ("tool_choice: type \"tool\" and
// \"any\" are not supported for this model"), on count_tokens and Batches too. So the forced call
// was not a preference: it was the single line pinning this product to a previous model
// generation, and it would have taken the AI Assistant down on the next model bump.
//
// What replaces it is three things together, because "auto" alone would be weaker than what we
// had:
//   - type:"auto" here,
//   - strict:true + additionalProperties:false on the tool (anthropicTool.Strict), which is what
//     now guarantees the arguments match the schema — and matters MORE than it used to, because
//     eager_input_streaming turns off the server's own validation of tool input,
//   - a line in the static system prompt naming the tool and saying to answer through it
//     (toolContractPrompt), since nothing in the protocol compels it any more.
//
// Name is omitempty so the "auto" form serialises as {"type":"auto"} with no stray null.
type anthropicToolChoice struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
}

// toolChoiceAuto is the only tool_choice this client sends. See anthropicToolChoice.
func toolChoiceAuto() anthropicToolChoice { return anthropicToolChoice{Type: "auto"} }

// anthropicOutputConfig carries the knobs that live under "output_config" rather than at the top
// level — effort today, structured output formats later.
//
// effort is thinking depth and overall token spend. Not sending it means the model's default,
// which on the current Sonnet is "high": the model thinks, and bills, before the first delta —
// time this product's own TTFT measurement cannot see, because TTFT starts at the first delta.
// "medium" is the setting for an assistant that drafts firewall config from a short request.
type anthropicOutputConfig struct {
	Effort string `json:"effort,omitempty"` // low | medium | high | xhigh | max
}

// anthropicCacheControl marks a system block as cacheable. Anthropic caches the request PREFIX up
// to the marked block (render order: tools → system → messages), so only content that is
// byte-identical across requests may sit before the marker.
type anthropicCacheControl struct {
	Type string `json:"type"` // "ephemeral" — 5-minute TTL
}

type anthropicSystemBlock struct {
	Type         string                 `json:"type"` // "text"
	Text         string                 `json:"text"`
	CacheControl *anthropicCacheControl `json:"cache_control,omitempty"`
}

func plainSystem(s string) []anthropicSystemBlock {
	return []anthropicSystemBlock{{Type: "text", Text: s}}
}

// anthropicMessage is one OUTGOING message in the Anthropic request. Content is deliberately `any`
// so a turn can carry either a plain string (the common path — byte-identical to what we have always
// sent) or an array of content blocks (image blocks + a text block, for a turn with attachments).
// This is distinct from ChatMessage, which is the string-only INPUT history type.
type anthropicMessage struct {
	Role    string `json:"role"`
	Content any    `json:"content"`
}

type anthropicRequest struct {
	Model        string                 `json:"model"`
	MaxTokens    int                    `json:"max_tokens"`
	System       []anthropicSystemBlock `json:"system"`
	Messages     []anthropicMessage     `json:"messages"`
	Tools        []anthropicTool        `json:"tools"`
	ToolChoice   anthropicToolChoice    `json:"tool_choice"`
	OutputConfig *anthropicOutputConfig `json:"output_config,omitempty"`
	// Fallbacks asks the API to re-run a request that a safety classifier declined on another
	// model, instead of handing us a refusal. "default" routes by refusal category, so there is no
	// model list here to go stale. It needs the anthropic-beta header set alongside it
	// (anthropicFallbackBeta) — the body field alone is ignored.
	//
	// Why this product wants it: the classifiers that decline are tuned for things like malware
	// and intrusion, and this console's ordinary vocabulary is "block", "deny", "exploit",
	// "attack surface", "port scan". A false decline here is a firewall engineer being told no by
	// their own tool. The refusal path is still handled (see anthropicStopDetails) for when the
	// fallback does not produce an answer either.
	Fallbacks string `json:"fallbacks,omitempty"`
	Stream    bool   `json:"stream,omitempty"`
}

type anthropicContentBlock struct {
	Type string `json:"type"`
	Name string `json:"name,omitempty"`
	// Text carries a "text" block. With a FORCED tool_choice there was never one to read; with
	// "auto" the model can answer in prose — a clarifying question, or a reason it will not guess —
	// and that text is more useful to the reader than "AI did not call the expected tool".
	Text  string          `json:"text,omitempty"`
	Input json.RawMessage `json:"input,omitempty"`
}

// anthropicUsage reports what the request actually cost. cache_read_input_tokens > 0 proves the
// prompt cache is working; if it stays 0 across repeated requests something upstream of the
// breakpoint is changing per request (see staticSystemPrompt).
type anthropicUsage struct {
	InputTokens              int `json:"input_tokens"`
	OutputTokens             int `json:"output_tokens"`
	CacheCreationInputTokens int `json:"cache_creation_input_tokens"`
	CacheReadInputTokens     int `json:"cache_read_input_tokens"`
}

func (u anthropicUsage) log(tag string, elapsed time.Duration) {
	log.Printf("[ai] %s done in %.1fs — in=%d out=%d cache_write=%d cache_read=%d",
		tag, elapsed.Seconds(), u.InputTokens, u.OutputTokens,
		u.CacheCreationInputTokens, u.CacheReadInputTokens)
}

// anthropicStopDetails explains a stop_reason of "refusal" — a safety classifier declined the
// request. The API answers HTTP 200, so nothing about the transport says anything went wrong.
//
// It is populated ONLY for "refusal" and is null for every other stop_reason, so every read of it
// has to be guarded.
type anthropicStopDetails struct {
	Type        string `json:"type"`                  // "refusal"
	Category    string `json:"category,omitempty"`    // open set: cyber, bio, frontier_llm, …
	Explanation string `json:"explanation,omitempty"` // may be empty
}

type anthropicResponse struct {
	Content []anthropicContentBlock `json:"content"`
	// "end_turn" | "tool_use" | "max_tokens" | "refusal" | "pause_turn"
	StopReason  string                `json:"stop_reason,omitempty"`
	StopDetails *anthropicStopDetails `json:"stop_details,omitempty"`
	Usage       anthropicUsage        `json:"usage"`
	Error       *struct {
		Type    string `json:"type"`
		Message string `json:"message"`
	} `json:"error,omitempty"`
}

// refusalError turns a declined request into something the person reading the chat can act on.
//
// Before this, a refusal arrived as HTTP 200 with no tool call, fell through to "AI did not call
// the expected tool — please retry", and retrying did the same thing forever: the one failure mode
// where the suggested fix is guaranteed not to work. The category is included because on this
// product it is usually the explanation — a firewall console's normal words (block, deny, exploit,
// attack surface, port scan) are the vocabulary the `cyber` classifier watches.
func refusalError(details *anthropicStopDetails) error {
	category := ""
	if details != nil {
		category = strings.TrimSpace(details.Category)
	}
	if details != nil && strings.TrimSpace(details.Explanation) != "" {
		if category != "" {
			return fmt.Errorf("the AI declined this request (%s): %s — rephrase it as the configuration change you want, "+
				"without describing an attack", category, strings.TrimSpace(details.Explanation))
		}
		return fmt.Errorf("the AI declined this request: %s", strings.TrimSpace(details.Explanation))
	}
	if category != "" {
		return fmt.Errorf("the AI declined this request (category %q) — rephrase it as the configuration change you want, "+
			"without describing an attack. Retrying the same wording will not help", category)
	}
	return errors.New("the AI declined this request — rephrase it as the configuration change you want. " +
		"Retrying the same wording will not help")
}

// textOfResponse joins the plain-text blocks of a response.
//
// With tool_choice "auto" the model MAY answer in prose instead of calling the tool — a question
// back, or a refusal to guess. That used to be invisible: the loop looked only for a tool_use
// block and ended at "AI did not call the expected tool — please retry". The model's actual words
// are better than that sentence, so they are what the user gets.
func textOfResponse(blocks []anthropicContentBlock) string {
	var b strings.Builder
	for _, block := range blocks {
		if block.Type == "text" && strings.TrimSpace(block.Text) != "" {
			if b.Len() > 0 {
				b.WriteString("\n\n")
			}
			b.WriteString(strings.TrimSpace(block.Text))
		}
	}
	return b.String()
}

// noToolCallError is what both paths return when the model answered without calling the tool.
func noToolCallError(text string) error {
	if t := strings.TrimSpace(text); t != "" {
		return fmt.Errorf("the AI answered without proposing config: %s", t)
	}
	return errors.New("AI did not call the expected tool — please retry")
}

// markLastHistoryTurnCacheable turns the conversation history into a cacheable prefix.
//
// ── Why every history turn is rewritten, not just the marked one ─────────────
//
// A cache_control marker ends a prefix; what gets reused is the bytes BEFORE it, and they have to
// be byte-identical to the previous request's. A message whose Content is a plain string and the
// same message as a one-element content array are not the same bytes — so converting only the
// turn being marked would move that difference backwards through the transcript on every message
// (turn N-1 is an array this request, a string the next) and the prefix would diverge at the
// oldest changed turn. The cache would then miss on exactly the long conversations it exists for,
// while every log line still said the breakpoint was set.
//
// So all history turns take the same shape, always, and only the position of the marker moves.
// Deploying this resets the cache once, which is the cost of it being correct afterwards.
//
// The CURRENT user turn is deliberately not touched: it is new by definition, and it may already
// be a block array carrying images.
func markLastHistoryTurnCacheable(messages []anthropicMessage, historyLen int) {
	if historyLen <= 0 || historyLen > len(messages) {
		return
	}
	for i := 0; i < historyLen; i++ {
		text, ok := messages[i].Content.(string)
		if !ok {
			// Already structured (nothing produces this today) — left exactly as it is rather
			// than guessing at its shape.
			continue
		}
		block := map[string]any{"type": "text", "text": text}
		if i == historyLen-1 {
			block["cache_control"] = map[string]any{"type": "ephemeral"}
		}
		messages[i].Content = []any{block}
	}
}
