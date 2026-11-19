package services

import (
	"log"
	"os"
	"strings"
	"sync"
)

// Which model answers, and the key it answers with.
//
// Lifted out of ai.go, which is the project's largest file at ~3,700 lines and is tracked in
// backend/test/layout-budget.json as needing a split. This is a self-contained piece of it: two
// environment variables and the reasoning about what the request shape depends on, read by every
// AI path in the console and coupled to none of them.

// AnthropicAPIKey returns the API key from env; empty = AI assistant disabled.
func AnthropicAPIKey() string { return os.Getenv("ANTHROPIC_API_KEY") }

// defaultAnthropicModel is the model used when ANTHROPIC_MODEL is unset. It is a LAST RESORT, not
// the intended configuration: which model answers is a product decision, and leaving it implicit
// means a redeploy can change it without anyone noticing. Pin it in .env.
//
// claude-sonnet-5-5 is the current model of the Sonnet line this console has always run on: same
// $2/$10 per million input/output tokens as claude-sonnet-5, with cheaper cache reads ($0.10),
// the same 1M context and the same tokenizer. Staying in the Sonnet line is deliberate — the
// vendor's default is Opus 5.5 ($4/$20), and which one answers is the owner's cost decision, one
// ANTHROPIC_MODEL line away in either direction.
//
// What made this bump possible is in anthropicToolChoice: Sonnet 5.5 answers a FORCED tool_choice
// with a 400, and this client sent one on every request. The forced call — not the model string —
// was what pinned the product to the previous generation.
//
// Two other things on this model, both handled here rather than discovered in production:
// thinking cannot be disabled (`{type:"disabled"}` is a 400), so depth is controlled through
// output_config.effort, whose default on this model is "high"; and a safety classifier can
// decline with stop_reason "refusal" — see anthropicFallbacks and refusalError.
const defaultAnthropicModel = "claude-sonnet-5-5"

// anthropicEffort is thinking depth, sent as output_config.effort.
//
// Nothing was sent before, which means the model's own default — "high" on this family. For an
// assistant that turns one sentence into a FortiOS config block, that is thinking (and billing)
// above what the task needs, and it lands entirely BEFORE the first delta: invisible to the TTFT
// number this product tracks, and visible to the user only as a longer pause.
//
// "medium" is the default here rather than "low" because the work is not retrieval — it is
// reading a live device inventory and deciding what to reuse, what to create and where in a
// first-match-wins policy list a rule has to sit. ANTHROPIC_EFFORT overrides it per deployment
// (low | medium | high | xhigh); an unrecognised value is refused rather than passed through,
// because the API would 400 the whole request and the log line is a better place to learn that
// than a failed proposal.
//
// "max" is refused for a different reason, and it is the reason measured below: the API accepts it
// and then every real proposal fails. It is listed in the API's own enum, so it is named in its own
// case with its own line — "max is not one of low|medium|high|xhigh" would send the next reader
// looking for a typo.
func anthropicEffort() string {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ANTHROPIC_EFFORT")))
	switch v {
	case "low", "medium", "high", "xhigh":
		return v
	case "":
		return defaultAnthropicEffort
	case maxEffortRefused:
		logEffortOnce.Do(func() {
			log.Printf("[ai] ANTHROPIC_EFFORT=max cannot complete a proposal on this request shape — "+
				"thinking consumes the whole %d-token output budget before the model reaches its tool "+
				"call, so the request fails after ~57s with \"AI did not call the expected tool\". "+
				"Using %q, which was the FASTEST of the five when measured. Raise "+
				"maxConfigOutputTokens if max is really wanted.",
				maxConfigOutputTokens, defaultAnthropicEffort)
		})
		return defaultAnthropicEffort
	default:
		logEffortOnce.Do(func() {
			log.Printf("[ai] ANTHROPIC_EFFORT=%q is not one of low|medium|high|xhigh — using %q",
				v, defaultAnthropicEffort)
		})
		return defaultAnthropicEffort
	}
}

// maxEffortRefused is the one value of the API's enum this console will not send. Named rather than
// inlined so the test and the log line cannot drift from the switch.
const maxEffortRefused = "max"

const defaultAnthropicEffort = "medium"

// ── Measured, 2026-11-18, on the lab 80E with live device context ────────────
//
// Three independent sweeps of the real streamed request (GenerateDeviceConfigStream, one prompt:
// "Block access to tiktok.com for the staff LAN during working hours", which proposes 79 CLI
// commands). TTFT is the time to the first delta the user sees.
//
//	effort   TTFT                 total                verdict
//	low      7.7 / 9.0 / 11.9s    13.2 / 15.6 / 18.3s  fine
//	medium   5.8 / 5.8 / 5.9s     11.8 / 12.3 / 14.0s  fine, and the fastest of the five
//	high     6.5 / 8.3 / 7.5s     13.0 / 14.3 / 15.1s  fine
//	xhigh    12.3 / 16.3 / 13.0s  19.7 / 23.6 / 20.1s  ~2x the TTFT for no change in the output
//	max      -                    56.8 / 58.6 / 58.3s  FAILED all three times
//
// So "medium" is not a compromise: it is at least as fast as every other setting and produced the
// same 79 commands with the same impact analysis. low is not faster — below medium the model spends
// the time it saved thinking on writing a longer explanation.
//
// ⚠️ ANTHROPIC_EFFORT=max IS UNUSABLE FOR THIS PRODUCT'S MAIN JOB, and nothing refuses it.
// Thinking is charged against max_tokens, and at this depth it consumes the whole
// maxConfigOutputTokens budget (8,192 — the log line reads out=8192 every time) before the model
// reaches its tool call. The request then fails after ~57 seconds with "AI did not call the
// expected tool — please retry", and a retry fails the same way. It is not a token-count fluke of
// one prompt: it reproduced three times. A SMALL proposal still works (a single address object:
// 6.5s TTFT, 582 output tokens), which is why this is worth stating rather than just capping —
// the setting is not broken, it is incompatible with the output budget on real work.
//
// Left as it is deliberately: fixing it is a choice between refusing "max" here and raising
// maxConfigOutputTokens for it, and that is a cost decision, not a cleanup.

var logEffortOnce sync.Once

// logModelOnce keeps the line to one per process — anthropicModel() runs on every request.
var logModelOnce sync.Once

// LogAIModel prints which model the assistant will use. main() calls it at startup so the answer is
// in the logs from the first line, not only after somebody happens to send a prompt.
func LogAIModel() { _ = anthropicModel() }

func anthropicModel() string {
	m := strings.TrimSpace(os.Getenv("ANTHROPIC_MODEL"))
	logModelOnce.Do(func() {
		if m == "" {
			log.Printf("[ai] ANTHROPIC_MODEL is not set — falling back to %q. "+
				"Pin it in .env so a redeploy cannot change models silently.", defaultAnthropicModel)
			return
		}
		log.Printf("[ai] using model %q (from ANTHROPIC_MODEL)", m)
	})
	if m == "" {
		return defaultAnthropicModel
	}
	return m
}
