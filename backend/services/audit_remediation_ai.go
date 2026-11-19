package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

// ── The AI's half of a remediation plan, and only that half ──────────────────
//
// WHAT THE MODEL IS NOT ASKED. It is not asked what is wrong with the firewall — the audit engine
// computed that. It is not asked which control the finding speaks to — the catalogue decided that.
// It is not asked what the fix is — FortiOS CLI for each finding comes out of the engine, and a
// model inventing `set` lines for a live firewall is the single worst thing this feature could do.
// It is not asked whether anything is compliant.
//
// WHAT IT IS ASKED. The part that is genuinely a language problem and that nothing here can
// compute: given these steps, in what order should they be run in a change window, what could break
// while running them, how do you back out, and what do you check afterwards to know it worked. That
// is judgement over facts already established, which is the only shape of question worth spending a
// model call on.
//
// AND IT IS GIVEN THE FACTS TO STAND ON. The prompt carries the evidence layer with it: for every
// command, what the device's own ?action=schema said about the attribute, the exact value set that
// firmware accepts, and Fortinet's page for the table. That is not decoration on the prompt — it is
// what stops the model reasoning from memory about a FortiOS build it has never seen. A model told
// "this device accepts logtraffic ∈ {all, utm, disable}" cannot suggest verifying with a value that
// does not exist, and a model told "logtraffic is NOT in this firmware" is expected to say so
// rather than plan around it.
//
// Which facts it was given travel back with the answer (RemediationAdvice.Grounding), so the page
// can show what the advice rests on instead of asking a reader to take it on trust.
//
// The answer is labelled as the model's wherever it renders. A reader who mistakes a suggestion
// about a production firewall for a computed fact is the failure this file is arranged to prevent,
// which is why the plan and the advice are two separate types, two separate requests, and two
// visually separate blocks on the page.

const auditRemediationTool = "plan_audit_remediation"

// RemediationAdvice is the model's answer. Every field is prose for a human — none of it is
// executed, parsed for commands, or allowed to change the computed plan.
type RemediationAdvice struct {
	// Order is the steps' check slugs in the sequence the model recommends, with a reason each.
	Order []RemediationOrderItem `json:"order"`
	// Risk is what could break while the change is being made.
	Risk string `json:"risk"`
	// Rollback is how to get back if it does.
	Rollback string `json:"rollback"`
	// Verify is what to look at afterwards to know the change did what was intended.
	Verify string `json:"verify"`
	// Window is whether this needs a maintenance window, and why.
	Window string `json:"window"`
	// Benefit is what improves once this is done — the only field that is not a warning. A plan
	// that only ever says what could go wrong is a plan nobody signs off.
	Benefit string `json:"benefit"`
	// Answers are the model's suggestions for the values this console will not invent (a management
	// subnet, a destination address). They are OPTIONS on a form, never applied on their own: the
	// operator picks one or types their own, and nothing is written until they do.
	Answers []AdviceAnswer `json:"answers,omitempty"`

	// Grounding is what the model was given as fact, filled in by this file rather than by the
	// model. It is shown on the page so "the AI said so" can be read as "the AI said so, having
	// been told these verified things" — or, when it is empty, so a reader knows it was not.
	Grounding []string `json:"grounding,omitempty"`
	// Unverified names the steps whose command the device did NOT confirm. The model is told to
	// treat them as suspect; the page repeats it, because this is the one case where following the
	// advice could waste a change window.
	Unverified []string `json:"unverified,omitempty"`
}

type RemediationOrderItem struct {
	Check  string `json:"check"`
	Reason string `json:"reason"`
}

// AdviceAnswer is the model's take on one question the apply cannot answer for itself.
type AdviceAnswer struct {
	// QuestionID matches ApplyQuestion.ID, so a suggestion lands on the right field.
	QuestionID string `json:"question_id"`
	// Prompt is the question rewritten for a person, replacing the plain one built from the schema.
	Prompt  string         `json:"prompt"`
	Options []AdviceOption `json:"options,omitempty"`
}

type AdviceOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
	// Note is what choosing this one means — the consequence, not a restatement of the value.
	Note string `json:"note,omitempty"`
}

// AuditRemediationAdvice asks the model to sequence and risk-assess a computed plan, and to suggest
// values for the questions the apply cannot answer for itself.
//
// The plan is passed as facts; the model may not invent commands, and even if it did, nothing reads
// them — only the prose fields and the suggested values are decoded, and a suggested value is a
// form option, not a write.
//
// `facts` is this firewall's own configuration, in one line each, so the suggested values are drawn
// from the device rather than from something plausible-sounding. It is built by the caller because
// what is useful differs by question: interface subnets for a management network, address object
// names for a policy destination.
func AuditRemediationAdvice(ctx context.Context, deviceName string, plan RemediationPlan, questions []ApplyQuestion, facts []string) (*RemediationAdvice, error) {
	apiKey := AnthropicAPIKey()
	if apiKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not configured")
	}
	if len(plan.Steps) == 0 {
		return nil, errors.New("this control has no remediation steps to sequence")
	}

	var b strings.Builder
	// Collected while the prompt is built, so what is sent and what is reported as sent are the
	// same list rather than two lists that agree today.
	var grounding, unverified []string

	fmt.Fprintf(&b, "Device: %s\n", deviceName)
	fmt.Fprintf(&b, "Control: %s %s (currently %s)\n", plan.ControlID, plan.ControlTitle, plan.Status)
	if plan.Blocked != "" {
		fmt.Fprintf(&b, "Even after every step below, this control does not close: %s\n", plan.Blocked)
	}
	b.WriteString("Steps already computed by the audit engine:\n")
	for i, s := range plan.Steps {
		fmt.Fprintf(&b, "%d. [%s] %s — severity %s, %d finding(s)%s\n",
			i+1, s.Check, s.Title, s.Severity, s.Findings,
			map[bool]string{true: ", advisory only", false: ""}[s.Advisory])
		if s.Why != "" {
			fmt.Fprintf(&b, "   why it matters: %s\n", s.Why)
		}
		if len(s.Subjects) > 0 {
			fmt.Fprintf(&b, "   applies to: %s\n", strings.Join(s.Subjects, ", "))
		}
		if len(s.CLI) > 0 {
			fmt.Fprintf(&b, "   CLI:\n%s\n", indentLines(s.CLI))
		}
		if s.Manual != "" {
			fmt.Fprintf(&b, "   no CLI — manual: %s\n", s.Manual)
		}
		for _, v := range s.Verification {
			switch v.Status {
			case FixVerified:
				line := fmt.Sprintf("   VERIFIED by the device: %s accepts %q", v.Attr, v.Value)
				if len(v.Options) > 0 {
					line += fmt.Sprintf(" (this firmware accepts only: %s)", strings.Join(v.Options, ", "))
				}
				fmt.Fprintln(&b, line)
				grounding = append(grounding, fmt.Sprintf("%s: %s accepts %q", s.Check, v.Attr, v.Value))
			case FixAttrOnly:
				fmt.Fprintf(&b, "   VERIFIED by the device: the attribute %s exists; its value is not one the schema enumerates, so it is the operator's choice\n", v.Attr)
				grounding = append(grounding, fmt.Sprintf("%s: attribute %s exists on this firmware", s.Check, v.Attr))
			case FixPathOnly:
				fmt.Fprintf(&b, "   VERIFIED by the device: the %s table exists\n", cliPath(v.Path))
				grounding = append(grounding, fmt.Sprintf("%s: the %s table exists", s.Check, cliPath(v.Path)))
			case FixAttrUnknown, FixValueUnlisted, FixUnreadable:
				fmt.Fprintf(&b, "   NOT VERIFIED (%s): %s\n", v.Status, v.Detail)
				unverified = append(unverified, s.Check)
			}
		}
		for _, d := range s.Docs {
			fmt.Fprintf(&b, "   vendor documentation: %s — %s\n", d.Command, d.URL)
		}
	}
	if len(questions) > 0 {
		b.WriteString("\nValues this console will NOT invent, and must ask for:\n")
		for _, q := range questions {
			fmt.Fprintf(&b, "- id=%s: %s on %s %s (the CLI has the placeholder %q)\n",
				q.ID, q.Attr, cliPath(q.Path), q.MKey, q.Placeholder)
		}
	}
	if len(facts) > 0 {
		b.WriteString("\nThis device's own configuration, for suggesting values:\n")
		for _, f := range facts {
			fmt.Fprintf(&b, "- %s\n", f)
		}
	}
	if plan.SchemaSource != nil {
		fmt.Fprintf(&b, "\nEvery VERIFIED line above came from %s on %s (%s), read with %s.\n",
			plan.SchemaSource.Device, plan.SchemaSource.Firmware,
			orNone(plan.SchemaSource.Serial), plan.SchemaSource.Method)
	}

	systemPrompt := "You are a senior network engineer planning a change window on a production " +
		"FortiGate firewall. The findings, the CLI and the control mapping below were computed by " +
		"the tool and are given to you as facts.\n\n" +
		"Your job is ONLY to plan the execution: the order to run the steps in, what could break " +
		"while running them, how to back out, what to verify afterwards, and whether this needs a " +
		"maintenance window.\n\n" +
		"Rules you must follow:\n" +
		"- Do NOT invent, alter or repeat FortiOS commands. The CLI is already decided.\n" +
		"- Do NOT say anything is compliant or non-compliant with any standard.\n" +
		"- Order must reference only the check slugs listed, each exactly once.\n" +
		"- Use ONLY the facts given. Lines marked VERIFIED were read from this device's own schema " +
		"just now; where a value set is listed, those are the only values that firmware accepts, so " +
		"never suggest one outside it. Do not rely on your own memory of FortiOS defaults.\n" +
		"- If a step is marked NOT VERIFIED, say so plainly in `risk` and tell the operator to " +
		"confirm that command before running it. Do not quietly plan around it.\n" +
		"- Be specific about this firewall's own risk: administrative access changes can lock you " +
		"out, and inspection or logging changes can affect throughput.\n" +
		// The brevity rule below cost exactly this sentence on its first outing, and it is the one
		// the verification layer exists to produce: the device confirmed the attribute but said its
		// value is not enumerable, which means FortiOS will accept a WRONG value silently. Losing
		// that turned a specific warning into a generic one, so it is now required rather than
		// left to compete for space.
		"- When a step's value was verified only as an attribute (the schema does not enumerate its " +
		"values), `risk` must say that this firewall will accept a wrong value without complaining, " +
		"so a mistake shows up as a broken device rather than as an error message.\n" +
		"- Answer in English, in plain sentences an operator can follow at 2am.\n" +
		// Output tokens cost several times what input tokens do, and a wall of prose is also the
		// thing that makes this panel unreadable. Both problems have the same fix — but `risk` gets
		// one more sentence than the rest, because it is the field where somebody gets hurt.
		"- For every question id listed, return an `answers` entry: the question rewritten plainly, " +
		"and two or three candidate values DRAWN FROM THE DEVICE FACTS given below. Never invent an " +
		"address or subnet that is not in those facts. Each option's note says what choosing it " +
		"means for who can reach what.\n" +
		"- `benefit` says what is concretely better once this is done. One or two sentences.\n" +
		"- BE BRIEF. At most three sentences for risk and two each for rollback, verify, window and " +
		"benefit; one sentence per ordered step and per option note. Say the specific thing and " +
		"stop.\n\n" +
		"Call tool " + auditRemediationTool + ".\n\n" + b.String()

	tool := anthropicTool{
		Name:        auditRemediationTool,
		Strict:      true,
		Description: "Sequence and risk-assess an already-computed firewall remediation plan",
		InputSchema: strictInputSchema(map[string]any{
			"type": "object",
			"properties": map[string]any{
				"order": map[string]any{
					"type":        "array",
					"description": "The computed steps in the order they should be run",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"check":  map[string]any{"type": "string", "description": "The check slug, exactly as given"},
							"reason": map[string]any{"type": "string", "description": "Why it goes in this position"},
						},
						"required": []string{"check", "reason"},
					},
				},
				"risk":     map[string]any{"type": "string", "description": "What could break while the change is being made"},
				"rollback": map[string]any{"type": "string", "description": "How to get back if it does"},
				"verify":   map[string]any{"type": "string", "description": "What to check afterwards to know it worked"},
				"window":   map[string]any{"type": "string", "description": "Whether this needs a maintenance window, and why"},
				"benefit":  map[string]any{"type": "string", "description": "What is better once this is done, in concrete terms"},
				"answers": map[string]any{
					"type":        "array",
					"description": "One entry per question id given, with suggested values",
					"items": map[string]any{
						"type": "object",
						"properties": map[string]any{
							"question_id": map[string]any{"type": "string", "description": "Exactly the id given"},
							"prompt":      map[string]any{"type": "string", "description": "The question, rewritten for a person"},
							"options": map[string]any{
								"type": "array",
								"items": map[string]any{
									"type": "object",
									"properties": map[string]any{
										"value": map[string]any{"type": "string", "description": "The literal value to write"},
										"label": map[string]any{"type": "string", "description": "Short name for it"},
										"note":  map[string]any{"type": "string", "description": "What choosing this one means"},
									},
									"required": []string{"value", "label"},
								},
							},
						},
						"required": []string{"question_id", "prompt"},
					},
				},
			},
			"required": []string{"order", "risk", "rollback", "verify", "window", "benefit"},
		}),
	}

	messages := []anthropicMessage{{Role: "user", Content: "Plan the execution of this remediation"}}
	input, err := callAnthropicTool(ctx, apiKey, plainSystem(systemPrompt), messages, tool, maxAnalysisOutputTokens)
	if err != nil {
		return nil, err
	}
	var advice RemediationAdvice
	if err := json.Unmarshal(input, &advice); err != nil {
		return nil, fmt.Errorf("failed to decode AI remediation advice: %w", err)
	}

	// The model is told to reference only the given slugs. Trusting that is how a UI ends up
	// rendering a step nobody computed, so the answer is filtered against the plan rather than
	// rendered as it arrives.
	known := map[string]bool{}
	for _, s := range plan.Steps {
		known[s.Check] = true
	}
	seen := map[string]bool{}
	kept := advice.Order[:0]
	for _, item := range advice.Order {
		if known[item.Check] && !seen[item.Check] {
			seen[item.Check] = true
			kept = append(kept, item)
		}
	}
	advice.Order = kept

	// The same filter as the order, for the same reason: a suggested value landing on a field
	// nobody asked about would be a form control this console never computed.
	valid := map[string]bool{}
	for _, q := range questions {
		valid[q.ID] = true
	}
	answers := advice.Answers[:0]
	for _, a := range advice.Answers {
		if valid[a.QuestionID] {
			answers = append(answers, a)
		}
	}
	advice.Answers = answers

	advice.Grounding = grounding
	advice.Unverified = dedupe(unverified)
	return &advice, nil
}

func dedupe(in []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range in {
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

func orNone(s string) string {
	if s == "" {
		return "serial not reported"
	}
	return s
}

func indentLines(cli []string) string {
	var b strings.Builder
	for _, l := range cli {
		b.WriteString("     ")
		b.WriteString(l)
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}
