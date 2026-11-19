// Package services - AI Assistant: converts plain-language requests into FortiOS CLI commands
// using the Anthropic Claude API (FortiGate / FortiOS only).
package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"regexp"
	"strings"
	"time"

	"network_automation/entity"
)

// anthropicAPIURL is a var, not a const, for one reason: the streaming completion rules in
// ai_stream.go can only be proved against a server that replays recorded SSE frames — including the
// ones that stop halfway — and there is no other seam to point the client at one.
// Production never writes it.
var anthropicAPIURL = "https://api.anthropic.com/v1/messages"

const (
	anthropicVersion      = "2023-06-01"
	proposeConfigTool     = "propose_device_config"
	maxQueryCommandsForAI = 10

	// maxConfigOutputTokens caps the config proposal. A full "policy + addresses + services +
	// AntiVirus + Web Filter + Application Control" answer measured ~3,100 output tokens against
	// the old 4,096 ceiling — only 25% of headroom before FortiOS CLI got truncated mid-block.
	// Streaming removes the HTTP-timeout reason to keep it low, so give it real room.
	maxConfigOutputTokens = 8192
	// maxAnalysisOutputTokens covers the short diagnose/explain answers.
	maxAnalysisOutputTokens = 4096
)

type platformPrompt struct {
	VendorName       string
	QueryHelp        string
	ConfigHelp       string
	DangerHelp       string
	CLIReference     string
	WorkflowPatterns string
	BestPractices    string
}

// FortiGate / FortiOS only
var platformPrompts = map[string]platformPrompt{
	"fortinet": {
		VendorName: "FortiGate firewall (FortiOS)",
		// `diagnose ...` is deliberately NOT advertised as a whole. `diagnose` is not a read-only
		// verb on FortiOS — it is the prefix of the entire diagnostic subsystem, including
		// `sys session clear`, `sys session filter` (global state the next operator inherits),
		// `debug application … -1`, `vpn ike restart` and `firewall iprope clear`. The query
		// endpoint accepts only the ten read-only sub-commands in
		// controller/configdeploy.allowedDiagnosePatterns, so teaching the model a wider verb just
		// produces answers the backend answers 400 to. The ten are spelled out in §17 of
		// fortinetCLIReference, and TestPromptTeachesOnlyAllowedDiagnoseCommands keeps the two in step.
		QueryHelp:  "show ..., get ..., execute ping <host>, execute traceroute <host>, and ONLY the read-only `diagnose` sub-commands listed in §17",
		ConfigHelp: "Use config/edit/next/end blocks. Use 'edit 0' for new objects (FortiOS auto-assigns ID).",
		DangerHelp: "execute reboot, execute factoryreset, execute formatlogdisk, execute restore, execute format, delete vdom",

		// The three long texts live in ai_prompt_fortinet.go, unchanged.
		CLIReference:     fortinetCLIReference,
		WorkflowPatterns: fortinetWorkflowPatterns,
		BestPractices:    fortinetBestPractices,
	},
}

// ChatMessage is one conversation turn ("user" | "assistant"). This is the INPUT history type that
// flows from the controller into the service; its Content is always plain text.
type ChatMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// ImageInput is one image attached to the CURRENT user turn. Data is standard base64 with NO
// "data:" prefix; MediaType is one of the four types Anthropic accepts (validated in the controller
// before it reaches here). Images apply only to the current prompt, never to history.
type ImageInput struct {
	MediaType string
	Data      string
}

// ConfigSuggestion is the AI result: proposed commands + explanation + optional warning.
// Mode "config" = change config (applied over the REST device-proxy, or /config-deploys as fallback).
// Mode "query"  = read-only show commands (run via /config-deploys/query).
type ConfigSuggestion struct {
	Commands    []string `json:"commands"`
	Explanation string   `json:"explanation"`
	Warning     string   `json:"warning,omitempty"`
	Mode        string   `json:"mode,omitempty"`
	// Impact is the model's own answer to "what does applying this change?", as three named
	// fields rather than as three bullets inside the explanation prose. See ConfigImpact.
	Impact *ConfigImpact `json:"impact,omitempty"`
}

// ConfigImpact is the impact analysis as a STRUCTURE.
//
// ── Why it stopped being prose ───────────────────────────────────────────────
//
// The prompt asked for a section headed "ผลกระทบ (Impact)" at the end of the explanation, and the
// Apply confirmation dialog found it again with a regex over the model's free text
// (applyImpact.ts, extractImpactBullets). That worked whenever the model wrote the heading exactly
// as asked, which is not a promise anything in the protocol makes: a translated heading, a bold
// markdown variant, a missing blank line, an extra sentence between the heading and the bullets —
// each of them silently emptied the most load-bearing part of the dialog, and the dialog has no
// way to tell "the model said nothing about impact" from "the model said it in a shape we cannot
// read".
//
// As tool fields it is the API's job: `strict: true` means a config-mode answer either carries all
// three or the request fails loudly. The regex is kept as a fallback for an answer that has no
// impact object (an older cached conversation, or a model that fills only the explanation).
type ConfigImpact struct {
	// Subnets affected, as network+mask / CIDR strings ("192.168.10.0/24").
	Subnets []string `json:"subnets"`
	// Which hosts, users or zones this changes things for ("every host on the office LAN").
	Affected []string `json:"affected"`
	// Where the policy has to sit, and what would shadow it. One line, naming the existing policy
	// it must sit above or below — FortiGate matches top-to-bottom and first match wins, so this
	// is the field that decides whether the rule works at all.
	Placement string `json:"placement"`
}

// Anthropic API wire types

// GenerateDeviceConfig converts a plain-language request into FortiOS CLI commands via Claude.
// buildLiveDeviceContext logs into the target FortiGate and returns a compact snapshot of
// the objects the AI must reason about before proposing config — interfaces, address
// objects, services, AntiVirus profiles, and existing policy names. Best-effort: any
// failure (device unreachable, bad creds) returns "" so generation still proceeds.
// It also returns deviceFacts — the live signature database and what each existing application
// sensor already blocks — so the caller can check the model's output against the device instead of
// trusting it (validate signature ids; drop a proposal that re-states a profile already in place).
type appListCoverage struct {
	apps map[int]bool // signature ids this sensor actually blocks
	cats map[int]bool // categories it actually blocks
}

// inventoryBudget caps the free-form device object inventory (interfaces, addresses, services,
// profile and policy names) inside the live context. Everything appended after it — signature ids,
// coverage, schedules, routes, datasource catalogues — is exempt on purpose: those are values the
// model has to quote verbatim, so a device with hundreds of addresses must not crowd them out.
const inventoryBudget = 3800

type deviceFacts struct {
	appMeta     AppControlMetadata
	appCoverage map[string]appListCoverage // sensor name → what it blocks today
	wfCoverage  map[string]map[string]bool // web-filter profile name → URLs it blocks today
	dnsCoverage map[string]map[string]bool // dns-filter profile name → domains it blocks today
	// wfTableIDs holds the webfilter table ids that are ALREADY on the device, by kind
	// ("urlfilter" / "content"). A table id is an mkey the author picks, so a proposal that names
	// a live one is editing something that exists rather than creating something new — see
	// warnOnLiveTableIDs.
	wfTableIDs map[string][]int
}

// deviceAPIClient returns the SHARED pooled REST client for a device, opened with the login the
// caller resolved — the same session every device-proxy handler uses for that account.
//
// The login is a parameter rather than being read off the device because the AI Assistant now
// reaches the firewall as the PERSON who typed the prompt (their row in device_credentials), the
// same as every other interactive path. It used to use the device's own shared account, so the
// firewall's event log recorded `admin` for objects a named user had asked the model to create.
//
// It exists as its own function because the AI Assistant used to open a PRIVATE one instead
// (NewFortiClient + Login + defer Logout), which was wrong in two ways that only showed up against
// the real device:
//
//   - cost — a login and a logout are two extra HTTPS round trips (~0.14s for the login alone on
//     the lab FGT80E) added to EVERY AI prompt, for a session thrown away seconds later, while the
//     pool already held a warm one for the same device;
//   - safety — the private client had no circuit breaker. The pool stops after 2 consecutive login
//     failures because FortiOS locks an admin account at 3 (admin-lockout-threshold), so with
//     wrong or rotated credentials a user pressing "Generate" three times locked the firewall's
//     admin account for 60s. AcquireFortiClient refuses the third attempt instead of making it.
//
// port is a parameter rather than a hard-coded DefaultAPIPort so tests can point it at a stub;
// production callers pass DefaultAPIPort, which is what policyobject's handlers resolve to as
// well, so both share ONE pool entry instead of opening a session each.
//
// The returned client is shared and outlives the call: callers must never Logout on it.

// staticSystemPrompt is the half of the system prompt that is IDENTICAL on every request — the
// role, the rules, the FortiOS CLI reference, the best practices. It is ~10,000 tokens, and it is
// deliberately rendered FIRST and on its own content block so Anthropic's prompt cache can serve
// it: caching is a PREFIX match, so anything placed before a volatile section is cacheable and
// everything after it is not. The volatile half (device identity + LIVE DEVICE CONTEXT, which
// changes with the device AND with the prompt's matched app signatures) is a separate block that
// comes last. Do not interpolate anything request-specific in here — a single changed byte
// invalidates the cache for every user.
func staticSystemPrompt(info platformPrompt) string {
	return fmt.Sprintf(
		"You are an expert AI assistant — senior FortiGate network engineer AND general-purpose helpful assistant.\n"+
			"TASK: Help the user with ANY question. For FortiGate tasks, call tool %q.\n\n"+

			// ── The tool contract ────────────────────────────────────────────────────────────
			// This paragraph is load-bearing. The request used to carry tool_choice
			// {type:"tool"}, which MADE the model call the tool; current models answer that with
			// a 400, so the request now sends {type:"auto"} and these sentences are what takes
			// its place. Everything downstream — the chat renderer, the wizards, applyViaREST —
			// reads the tool's fields, so an answer written as prose is an answer the product
			// cannot use. Stated in the cached block so it costs nothing per request.
			"=== HOW TO ANSWER (ALWAYS) ===\n"+
			"EVERY answer goes through the tool call. Call %[1]q exactly once per reply, and put the whole\n"+
			"answer in its fields — mode, commands, explanation. Do NOT write the answer as ordinary text\n"+
			"outside the tool: the interface that shows your reply reads the tool's fields and nothing else,\n"+
			"so prose outside it is invisible to the user.\n"+
			"This holds for every kind of message, including greetings, opinions, refusals to guess, and\n"+
			"questions back to the user — for those, use mode=\"query\", commands=[], and put the sentence in\n"+
			"explanation.\n\n"+

			// ── What the product can carry out ──────────────────────────────────────────────
			// Generated from consoleRESTSections (ai_capabilities.go), which a test holds equal to
			// the frontend's REST_SECTIONS. Placed this high because it changes what the model
			// proposes, not merely how it words it: everything below teaches FortiOS, and FortiOS
			// is much larger than this console's Apply path.
			"%s\n"+

			"=== LANGUAGE (CRITICAL) ===\n"+
			"Detect the user's language from each message and ALWAYS reply in the SAME language.\n"+
			"Thai message → Thai explanation (ภาษาไทยทั้งหมด).\n"+
			"English message → English explanation.\n"+
			"Mixed → use the dominant language. Code/CLI stays in English.\n\n"+

			"=== HANDLE ANY QUESTION ===\n"+
			"You MUST answer every question the user asks — FortiGate or not.\n"+
			"General questions (networking theory, explanations, non-FortiGate, greetings, examples, comparisons):\n"+
			"  → mode=\"query\", commands=[] (empty), explanation = full helpful answer.\n"+
			"  → Examples of general questions: 'สวัสดี', 'อธิบาย SD-WAN', 'IKEv1 vs IKEv2', \n"+
			"    'ขอตัวอย่าง policy', 'difference between NAT and VPN', 'ช่วยสรุป firewall คืออะไร'\n"+
			"NEVER refuse. NEVER say 'I can only help with FortiGate'. Always provide value.\n\n"+

			"=== EXAMPLE REQUESTS ===\n"+
			"When user says 'ขอตัวอย่าง N ...' or 'give me N examples of ...':\n"+
			"  → For CLI examples: mode=\"config\", commands[] = actual working CLI, explanation describes each.\n"+
			"  → For concept examples: mode=\"query\", commands=[], explanation = clear examples in text.\n"+
			"  → Limit to 2-3 examples max to stay within response size.\n\n"+

			"=== MODE SELECTION ===\n"+
			"mode=\"query\"  → read-only: %s\n"+
			"mode=\"config\" → create / edit / delete / set / enable / disable / any config change\n\n"+
			"Thai config keywords: สร้าง เพิ่ม แก้ไข ลบ ตั้งค่า เปลี่ยน กำหนด ปิด เปิด อนุญาต บล็อก\n"+
			"Thai query keywords:  ดู แสดง ตรวจสอบ เช็ค รายการ สถานะ ping traceroute วิเคราะห์\n\n"+

			"=== INCOMPLETE CONFIG REQUEST ===\n"+
			"When user wants to configure but parameters are MISSING:\n"+
			"  → mode=\"config\", commands=[], explanation asks for EACH missing field (concise list).\n"+
			"  → Policy requires: srcintf, dstintf, srcaddr, dstaddr, service, action.\n"+
			"  → VPN requires: remote-gw, psksecret, local subnet, remote subnet.\n"+
			"  → VIP requires: extip, mappedip (port only if port-forwarding).\n\n"+

			"=== EXPLANATION LENGTH — HARD BUDGET (the user WAITS for every character you write) ===\n"+
			"The explanation is a SUMMARY, not documentation. In config mode: MAX 900 characters, written as\n"+
			"short bullets — never prose paragraphs. Structure it exactly like this:\n"+
			"  · one line: what is being created / updated (object NAMES only)\n"+
			"  · one or two lines: which existing object you REUSED or UPDATED and why (omit if nothing reused)\n"+
			"The impact analysis does NOT go in the explanation — it goes in the tool's own `impact` field\n"+
			"(see IMPACT ANALYSIS below). Do not also repeat it here as a headed section: the interface shows\n"+
			"the field, so a duplicate in the prose is read twice by the user and counts against this budget.\n"+
			"NEVER: restate the CLI, explain what each individual 'set' line does, list every blocked domain or\n"+
			"signature id, add headings/sections beyond the above, add next-steps, add disclaimers, or repeat the\n"+
			"user's request back to them. The user can already read the CLI and the wizard — they need the gist.\n"+
			"query mode / general questions: answer properly but stay under 250 words.\n"+
			"Commands array: only essential commands, no duplicates.\n\n"+

			"=== OBJECT REUSE & POLICY CONDITIONS (MANDATORY before any create/edit) ===\n"+
			"%s\n\n"+

			"=== MULTI-STEP WORKFLOWS ===\n"+
			"For complex configs, generate ALL required steps together:\n"+
			"%s\n\n"+

			"=== FORTIOS CLI REFERENCE ===\n"+
			"%s\n\n"+

			"=== SECURITY BEST PRACTICES ===\n"+
			"%s\n\n"+

			"=== BLOCKED COMMANDS — NEVER PROPOSE ===\n"+
			"%s\n\n"+

			"=== OUTPUT FORMAT ===\n"+
			"config commands: complete config/edit/next/end blocks. Use 'edit 0' for new objects.\n"+
			"query commands: max %d read-only commands.\n"+
			"explanation: REQUIRED, in the user's language (Thai if the user wrote Thai), and real content the\n"+
			"user can act on — NEVER a stub like \"placeholder\"/\"see commands\". Obey the HARD BUDGET above.",
		proposeConfigTool, capabilityContract(), info.QueryHelp,
		objectReuseConditions,
		info.WorkflowPatterns, info.CLIReference, info.BestPractices, info.DangerHelp,
		maxQueryCommandsForAI,
	)
}

// deviceSystemPrompt is the VOLATILE half of the system prompt: which device we are talking to and
// the snapshot of what is actually on it. It changes per device and per request (the Application
// Control section only carries the signature ids the prompt actually refers to), so it is rendered
// LAST, after the cache breakpoint — everything before it stays cacheable.
func deviceSystemPrompt(device *entity.NetworkDevice, info platformPrompt, liveContext string) string {
	return fmt.Sprintf(
		"=== TARGET DEVICE ===\n"+
			"%q (vendor=%s, mgmt_ip=%s) — %s\n\n"+
			"=== LIVE DEVICE CONTEXT (fetched from the device just now — trust this over assumptions) ===\n"+
			"%s",
		device.Name, device.Vendor, device.MgmtIP, info.VendorName, liveContext)
}

// buildConfigPrompt assembles the two system blocks + the message list for one AI request, and
// returns the deviceFacts the caller needs to validate the model's output against the device.
//
// images are attached to the CURRENT user turn only (never to history). When none are supplied the
// user message carries a plain string Content, byte-for-byte what we have always sent, so the common
// path and the prompt cache are unaffected.
func buildConfigPrompt(device *entity.NetworkDevice, login DeviceLogin, prompt string, history []ChatMessage, images []ImageInput) (
	[]anthropicSystemBlock, []anthropicMessage, *deviceFacts, error,
) {
	info, ok := platformPrompts[device.Platform]
	if !ok {
		return nil, nil, nil, fmt.Errorf("unsupported vendor/platform=%q - only \"fortinet\" is supported", device.Platform)
	}

	// Fetch a live snapshot of the device's objects so the AI can reuse existing addresses/
	// services, avoid duplicate policy names, and infer interfaces. Best-effort — a fetch
	// failure just leaves the model to apply the conditions from best judgement.
	liveContext, facts := buildLiveDeviceContext(device, login, prompt)
	if strings.TrimSpace(liveContext) == "" {
		liveContext = "(device not reachable right now — apply the conditions above using best judgement; " +
			"ask the user to confirm existing object names before applying.)"
	}
	// SIZE ONLY — never the body.
	//
	// This line used to print the whole live context at info level on every request: every address
	// object and subnet, every user and group, the LDAP/RADIUS servers with their hosts and bind
	// DNs, FortiToken serials. That is an inventory of the customer's network written to the
	// container log on each prompt, kept as long as the logs are kept and shipped wherever they are
	// shipped. The length is what the line was useful for anyway — it is how you see the context
	// collapse to nothing when the device stops answering.
	log.Printf("[ai] live device context: %d chars", len(liveContext))

	// Block 1 is byte-identical on every request → cache_control makes Anthropic serve it from its
	// prompt cache (~10k tokens: ~90% cheaper and no re-processing). Block 2 is the volatile
	// device snapshot and must come after the breakpoint.
	system := []anthropicSystemBlock{
		{Type: "text", Text: staticSystemPrompt(info), CacheControl: &anthropicCacheControl{Type: "ephemeral"}},
		// A SECOND breakpoint, after the device snapshot.
		//
		// A request may carry up to four, and this one had been using one of them. The snapshot is
		// ~1-4k tokens of live inventory and it is the same bytes for every prompt about the same
		// device within the cache's five-minute window — which is exactly how this assistant is
		// used, several questions in a row about one firewall. Without a breakpoint here, the
		// cached prefix stopped at the static prompt and this block was re-read, and paid for, on
		// every message.
		//
		// It sits AFTER the volatile content it covers, which is how breakpoints work: each one
		// marks the end of a cacheable prefix. Everything after it — the conversation — stays
		// uncached by design, because it changes every turn.
		{Type: "text", Text: deviceSystemPrompt(device, info, liveContext), CacheControl: &anthropicCacheControl{Type: "ephemeral"}},
	}

	messages := make([]anthropicMessage, 0, len(history)+1)
	for _, h := range history {
		messages = append(messages, anthropicMessage{Role: h.Role, Content: h.Content})
	}
	messages = append(messages, anthropicMessage{Role: "user", Content: userTurnContent(prompt, images)})
	// A THIRD breakpoint, at the end of the history.
	//
	// The transcript is the biggest thing in a long conversation — up to twenty turns of ~6,000
	// tokens — and every turn of it was re-read at full price on each new message, even though
	// everything except the newest turn is byte-identical to the last request. Marking the last
	// HISTORY turn (not the new user message, which is new by definition) makes the whole
	// transcript a cached prefix: the request then pays full price only for what the user just
	// typed.
	//
	// Silently a no-op on the first message of a conversation, which has no history — correct, as
	// there is nothing to reuse yet. cache_read_input_tokens in the usage log is how to see this
	// working; if it stays 0 across a conversation, something before this point is changing
	// per request.
	markLastHistoryTurnCacheable(messages, len(history))

	return system, messages, facts, nil
}

// userTurnContent builds the Content for the current user turn. With no images it returns the plain
// prompt string — the identical wire shape to every previous request, which keeps the common path
// and prompt caching unchanged. With images it returns an array of content blocks: the image blocks
// FIRST (Anthropic's recommended order), then the text block.
func userTurnContent(prompt string, images []ImageInput) any {
	if len(images) == 0 {
		return prompt
	}
	blocks := make([]any, 0, len(images)+1)
	for _, img := range images {
		blocks = append(blocks, map[string]any{
			"type": "image",
			"source": map[string]any{
				"type":       "base64",
				"media_type": img.MediaType,
				"data":       img.Data,
			},
		})
	}
	blocks = append(blocks, map[string]any{"type": "text", "text": prompt})
	return blocks
}

// applyDeviceFacts is the deterministic clean-up of the model's "set application" lines and of
// profiles it re-stated needlessly. The model does occasionally slip a signature NAME into the
// numeric id list, repeat an id, or list only the base app of a family it was asked to block —
// none of which should reach the device (a name is invalid CLI; a partial family means the site
// still works). Fixed here rather than hoping the prompt holds.
//
// This runs on the FINAL response only — the streamed preview a user watches is never deployed;
// the sanitised commands returned here are what the wizards and the deploy path use.
func applyDeviceFacts(suggestion *ConfigSuggestion, facts *deviceFacts) {
	if suggestion == nil {
		return
	}
	// Needs no device snapshot — the allow→block trap is a property of FortiOS itself, so this one
	// runs even when the live context failed to load and facts is nil.
	suggestion.Commands = sanitizeDNSFilterCommands(suggestion.Commands)
	// Likewise: an example secret copied out of the prompt is wrong regardless of what is on the
	// device, and this is the last place to catch it before the CLI is shown as something to
	// apply. See ai_secret_guard.go.
	var regenerated []string
	suggestion.Commands, regenerated = replaceExampleSecrets(suggestion.Commands)
	suggestion.Explanation = noteGeneratedSecrets(suggestion.Explanation, regenerated)
	if facts == nil {
		return
	}
	suggestion.Explanation = warnOnLiveTableIDs(suggestion.Commands, suggestion.Explanation, facts.wfTableIDs)
	suggestion.Commands = sanitizeAppSignatureCommands(suggestion.Commands, facts.appMeta)
	suggestion.Commands = dropRedundantAppLists(suggestion.Commands, facts)
	suggestion.Commands = dropRedundantWebFilters(suggestion.Commands, facts)
}

// sanitizeDNSFilterCommands deletes any ftgd-dns category filter entry the model marked
// "allow".
//
// ⚠️ WHY THIS EXISTS. FortiOS accepts `set action allow` on a dnsfilter category filter with HTTP
// 200 "success" and then stores "block" — it blocks exactly the category the model meant to allow
// (verified live on 7.2.10: both the REST read-back and `show dnsfilter profile` come back as
// block). An ABSENT entry is what "allow" means, so deleting the entry is precisely the model's
// intent, expressed in the only way the device understands.
//
// The prompt forbids emitting these lines, but a prompt is not a guarantee, and this particular
// failure is both silent and INVERTED — the user would be told a category was allowed while the
// firewall blocked it. So it is enforced here too, on the CLI the chat shows AND on the CLI the
// SSH fallback would deploy verbatim. (The structured REST path drops them independently, in
// dnsFilterProfilePayload.)
func sanitizeDNSFilterCommands(commands []string) []string {
	if len(commands) == 0 {
		return commands
	}
	text := strings.Join(commands, "\n")
	if !strings.Contains(strings.ToLower(text), "dnsfilter profile") {
		return commands
	}

	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))

	var stack []string // open `config <section>` names, innermost last
	var editBuf []string
	inEntry := false
	dropped := 0

	// The entries we police are `config dnsfilter profile` → … → `config ftgd-dns` → `config filters`.
	inCategoryFilters := func() bool {
		n := len(stack)
		if n < 3 || stack[n-1] != "filters" || stack[n-2] != "ftgd-dns" {
			return false
		}
		for _, s := range stack {
			if s == "dnsfilter profile" {
				return true
			}
		}
		return false
	}

	for _, line := range lines {
		t := strings.ToLower(strings.TrimSpace(line))

		// Buffering one `edit … next` entry inside the category filters block.
		if inEntry {
			editBuf = append(editBuf, line)
			if t == "next" {
				if allowRe.MatchString(strings.Join(editBuf, "\n")) {
					dropped++ // allow == no entry; drop the whole edit…next
				} else {
					out = append(out, editBuf...)
				}
				inEntry, editBuf = false, nil
			}
			continue
		}

		switch {
		case strings.HasPrefix(t, "config "):
			stack = append(stack, strings.TrimSpace(t[len("config "):]))
		case t == "end":
			if len(stack) > 0 {
				stack = stack[:len(stack)-1]
			}
		case strings.HasPrefix(t, "edit ") && inCategoryFilters():
			inEntry, editBuf = true, []string{line}
			continue
		}
		out = append(out, line)
	}
	// An unterminated entry (truncated CLI) is kept as-is rather than silently swallowed.
	out = append(out, editBuf...)

	if dropped == 0 {
		return commands
	}
	log.Printf("[ai] dnsfilter: dropped %d category filter entr%s with action=allow "+
		"(FortiOS stores those as block — an absent entry is what allow means)",
		dropped, map[bool]string{true: "y", false: "ies"}[dropped == 1])
	return out
}

// allowRe matches an `set action allow` line inside a category filter entry.
var allowRe = regexp.MustCompile(`(?im)^\s*set\s+action\s+allow\s*$`)

// dropRedundantWebFilters removes a proposed web-filter profile (and the urlfilter table feeding it)
// when every URL it would block is ALREADY blocked by the profile of that name on the device — the
// web-filter twin of dropRedundantAppLists, for the same reason: when an existing profile already
// does the job the model is told to recommend reuse and emit nothing, but it re-states the config
// anyway, which shows the user an Apply button that changes nothing.

// proposeConfigToolDef is the forced tool the model must answer with.
//
// Kept as a function rather than a literal at each call site: tools render BEFORE the system
// blocks, so two call sites that built the definition slightly differently would send different
// prompt-cache prefixes and neither would hit the other's entry. That mattered most when a
// buffered path ran beside the streamed one; the buffered path is gone and the rule still holds
// for the tests, which marshal this definition and compare it against itself.
func proposeConfigToolDef() anthropicTool {
	return anthropicTool{
		Name:                proposeConfigTool,
		Strict:              true,
		Description:         "Propose FortiOS CLI commands for the target FortiGate device with explanation",
		EagerInputStreaming: true, // see the field's comment — without it the stream stalls ~18s
		InputSchema: strictInputSchema(map[string]any{
			"type": "object",
			"properties": map[string]any{
				"mode": map[string]any{
					"type":        "string",
					"enum":        []string{"config", "query"},
					"description": "query=read-only commands, config=change configuration",
				},
				"commands": map[string]any{
					"type":        "array",
					"items":       map[string]any{"type": "string"},
					"description": "FortiOS CLI commands in order. Empty array if no commands can be generated.",
				},
				"explanation": map[string]any{
					"type":        "string",
					"description": "Explanation in the user's language, obeying the HARD BUDGET in the system prompt",
				},
				"warning": map[string]any{
					"type":        "string",
					"description": "Warning if commands risk disconnecting the device (optional, config mode only)",
				},
				// The impact analysis as fields rather than as a headed section inside the
				// explanation — see ConfigImpact for why. Optional at the schema level because
				// query-mode answers have no impact to state; the system prompt makes it
				// mandatory for mode="config", which is the only mode that can be applied.
				"impact": map[string]any{
					"type":        "object",
					"description": "REQUIRED for mode=\"config\": what applying this changes. Omit entirely for mode=\"query\".",
					"properties": map[string]any{
						"subnets": map[string]any{
							"type":        "array",
							"items":       map[string]any{"type": "string"},
							"description": "Subnets affected, as CIDR or network+mask (e.g. \"192.168.10.0/24\"). Empty array if none.",
						},
						"affected": map[string]any{
							"type":        "array",
							"items":       map[string]any{"type": "string"},
							"description": "Which hosts, users, zones or interfaces this changes things for, one short phrase each.",
						},
						"placement": map[string]any{
							"type": "string",
							"description": "One line: where the policy must sit in the top-to-bottom table and which existing " +
								"policy would shadow it. For a multi-policy answer, which sibling sits above which and why. " +
								"\"-\" when the answer creates no policy.",
						},
					},
					"required": []string{"subnets", "affected", "placement"},
				},
			},
			"required": []string{"mode", "commands", "explanation"},
		}),
	}
}

// callAnthropicTool sends a request to Anthropic API forcing a tool_use response.
func callAnthropicTool(ctx context.Context, apiKey string, system []anthropicSystemBlock, messages []anthropicMessage, tool anthropicTool, maxTokens int) (json.RawMessage, error) {
	reqBody := anthropicRequest{
		Model: anthropicModel(), MaxTokens: maxTokens, System: system,
		Messages: messages, Tools: []anthropicTool{tool},
		ToolChoice:   toolChoiceAuto(),
		OutputConfig: &anthropicOutputConfig{Effort: anthropicEffort()},
		Fallbacks:    anthropicFallbacks,
	}
	body, err := json.Marshal(reqBody)
	if err != nil {
		return nil, err
	}
	started := time.Now()
	client := anthropicHTTPClient()
	resp, err := sendAnthropic(client, anthropicPost(ctx, apiKey, body, anthropicBetaHeader(nil)), tool.Name)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	var parsed anthropicResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("failed to parse AI response: %w", err)
	}
	if parsed.Error != nil {
		return nil, fmt.Errorf("anthropic error (%s): %s", parsed.Error.Type, parsed.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("anthropic HTTP %d: %s", resp.StatusCode, string(respBody))
	}
	parsed.Usage.log(tool.Name, time.Since(started))
	// stop_reason = max_tokens → the answer was cut off mid-write, so the tool call is incomplete.
	//
	// This used to look for a partial tool_use block and return its Input anyway. The input of a
	// tool call the model never finished writing is not a shorter answer — it is the first half of
	// one, and this result is what the wizards deploy. A FortiOS config block that stops after
	// `set srcaddr` is a different rule from the one the user asked for, not a safe subset of it.
	// The streaming path refuses the same case (ai_stream.go) for the same reason.
	if parsed.StopReason == "max_tokens" {
		return nil, errors.New("AI response was truncated (max_tokens reached) — try a shorter/simpler request")
	}
	// A safety classifier declined. HTTP 200, no tool call — indistinguishable from the model
	// ignoring its instructions unless stop_reason is read, which is why this used to surface as
	// "AI did not call the expected tool — please retry", advice that could never work.
	if parsed.StopReason == "refusal" {
		return nil, refusalError(parsed.StopDetails)
	}
	for _, block := range parsed.Content {
		if block.Type == "tool_use" && block.Name == tool.Name {
			return block.Input, nil
		}
	}
	// tool_choice is "auto" now, so "no tool call" can also mean the model answered in words —
	// a question back, or a reason it will not guess. Those words beat a generic retry message.
	return nil, noToolCallError(textOfResponse(parsed.Content))
}

// DiagnoseJobFailure analyzes why an automation job failed.

const diagnoseJobTool = "diagnose_job_failure"

// DiagnosisResult is the AI analysis of a failed AutomationJob.
type DiagnosisResult struct {
	Summary      string `json:"summary"`
	LikelyCause  string `json:"likely_cause"`
	SuggestedFix string `json:"suggested_fix"`
	Severity     string `json:"severity"` // low | medium | high
}

func DiagnoseJobFailure(ctx context.Context, job *entity.AutomationJob, device *entity.NetworkDevice) (*DiagnosisResult, error) {
	apiKey := AnthropicAPIKey()
	if apiKey == "" {
		return nil, errors.New("ANTHROPIC_API_KEY is not configured")
	}
	deviceName := "(device not found)"
	platform := "unknown"
	if device != nil {
		deviceName = fmt.Sprintf("%s (%s)", device.Name, device.MgmtIP)
		platform = device.Platform
	}
	resultText := job.Result
	if resultText == "" {
		resultText = "(no error message)"
	}
	systemPrompt := fmt.Sprintf(
		"You are a network automation expert. Analyze this failed FortiGate job and respond in English.\n"+
			"Job type: %q | Device: %s (platform=%s) | Status: %s\nError: %s\n"+
			"Call tool %q with summary, likely_cause, suggested_fix, severity.",
		job.Type, deviceName, platform, job.Status, resultText, diagnoseJobTool,
	)
	tool := anthropicTool{
		Name:        diagnoseJobTool,
		Strict:      true,
		Description: "Analyze cause of a failed automation job with fix recommendations",
		InputSchema: strictInputSchema(map[string]any{
			"type": "object",
			"properties": map[string]any{
				"summary":       map[string]any{"type": "string", "description": "Brief summary of what happened"},
				"likely_cause":  map[string]any{"type": "string", "description": "Most likely cause of failure"},
				"suggested_fix": map[string]any{"type": "string", "description": "Step-by-step fix recommendations"},
				"severity":      map[string]any{"type": "string", "enum": []string{"low", "medium", "high"}, "description": "Severity level"},
			},
			"required": []string{"summary", "likely_cause", "suggested_fix", "severity"},
		}),
	}
	messages := []anthropicMessage{{Role: "user", Content: "Analyze this job failure and recommend a fix"}}
	input, err := callAnthropicTool(ctx, apiKey, plainSystem(systemPrompt), messages, tool, maxAnalysisOutputTokens)
	if err != nil {
		return nil, err
	}
	var result DiagnosisResult
	if err := json.Unmarshal(input, &result); err != nil {
		return nil, fmt.Errorf("failed to decode AI diagnosis: %w", err)
	}
	return &result, nil
}
