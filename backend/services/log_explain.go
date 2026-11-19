package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
)

// Asking the model to read a traffic log.
//
// ── WHAT IT IS FOR, GIVEN THE PAGE ALREADY COMPUTES FINDINGS ─────────────────
// The console's own checks (frontend insight.ts) are exact and they are the ones an operator
// should trust: they are counts with the workings on show and a link to the rows behind each. What
// they cannot do is answer a question nobody wrote a check for — "why does FortiGuard keep
// resetting us", "is this normal for a unit this size", "what would you look at first".
//
// So this is deliberately the SMALLER half of the feature. It reads the digest and nothing else,
// and it is told to say so when the digest cannot settle the question. It never proposes
// configuration changes: the log says what happened, not what should be true, and a model that
// answers "add a rule" from a page of counts is guessing at a firewall it cannot see.
//
// ── WHAT LEAVES THIS PROCESS ─────────────────────────────────────────────────
// The digest, which is counts plus the handful of addresses that ARE the answer. No per-row data,
// no usernames, no MACs. See log_digest.go.

const explainTrafficLogTool = "explain_traffic_log"

// LogExplanation is the shape the page renders.
type LogExplanation struct {
	// Headline is one sentence: what this log is, in the plainest terms available.
	Headline string `json:"headline"`
	// Reading is the short paragraph that interprets the counts.
	Reading string `json:"reading"`
	// Checks are the things worth looking at next, most useful first. May be empty.
	Checks []string `json:"checks"`
	// Unknown is what the digest could NOT settle. Empty when nothing important was missing.
	Unknown string `json:"unknown,omitempty"`
}

// ExplainTrafficLog reads a digest and answers a question about it.
//
// `question` is optional; empty means "tell me what this log is".
func ExplainTrafficLog(ctx context.Context, deviceName, subcategory, sourceLabel string, d LogDigest, question string) (*LogExplanation, error) {
	apiKey := AnthropicAPIKey()
	if apiKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not configured")
	}
	if d.Rows == 0 {
		return nil, errors.New("there are no entries to read")
	}

	whichLog := "traffic addressed TO the firewall itself, and traffic the firewall originated"
	if subcategory != logSubcategoryLocal {
		whichLog = "traffic passing THROUGH the firewall between its interfaces"
	}

	systemPrompt := fmt.Sprintf(
		"You are a senior firewall engineer reading a FortiGate traffic log with a colleague.\n\n"+
			"THE ONLY THING YOU CAN SEE is the digest below: counts over the entries the console "+
			"just read from device %q, the %s log, stored in %s. That log holds %s.\n\n"+
			"DIGEST\n%s\n"+
			"RULES, IN ORDER OF IMPORTANCE:\n"+
			"1. Say nothing the digest does not support. You cannot see individual entries, the "+
			"device's configuration, its rules, or any other period. If the question needs one of "+
			"those, say so in `unknown` and answer what you can.\n"+
			"2. These counts are a SAMPLE. A memory log is a ring buffer and a read is capped, so "+
			"never state a rate, a trend, or 'this always happens'.\n"+
			"3. Do not propose configuration changes. A log records what happened; it is not "+
			"evidence for what the rules should be. Name what to LOOK AT instead.\n"+
			"4. local-out traffic is not matched against the policy table at all, so no rule "+
			"permitted or denied it. Never describe it as allowed by a policy.\n"+
			"5. server-rst means the far end closed the connection, not that the firewall blocked "+
			"it. client-rst means the local end did. Neither is a block.\n"+
			"6. Be short. `headline` is one sentence. `reading` is at most four. Each check is one "+
			"line naming a specific thing to open or run. Plain English, no marketing.\n"+
			"7. If nothing in the digest deserves attention, say that plainly and return no checks. "+
			"Do not manufacture concerns to fill the field.\n\n"+
			"Call tool %q.",
		deviceName, subcategory, sourceLabel, whichLog, d.Text(), explainTrafficLogTool,
	)

	ask := question
	if ask == "" {
		ask = "What is this log telling me, and is any of it worth my attention?"
	}

	tool := anthropicTool{
		Name:        explainTrafficLogTool,
		Strict:      true,
		Description: "Explain what a FortiGate traffic log digest shows",
		InputSchema: strictInputSchema(map[string]any{
			"type": "object",
			"properties": map[string]any{
				"headline": map[string]any{
					"type": "string", "description": "One sentence: what this log is.",
				},
				"reading": map[string]any{
					"type": "string", "description": "At most four sentences interpreting the counts.",
				},
				"checks": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "Specific things to look at next, most useful first. Empty if nothing warrants it.",
				},
				"unknown": map[string]any{
					"type": "string", "description": "What the digest could not settle. Empty if nothing important.",
				},
			},
			"required": []string{"headline", "reading", "checks"},
		}),
	}

	messages := []anthropicMessage{{Role: "user", Content: ask}}
	input, err := callAnthropicTool(ctx, apiKey, plainSystem(systemPrompt), messages, tool, maxAnalysisOutputTokens)
	if err != nil {
		return nil, err
	}
	var out LogExplanation
	if err := json.Unmarshal(input, &out); err != nil {
		return nil, fmt.Errorf("failed to decode the AI reading: %w", err)
	}
	return &out, nil
}
