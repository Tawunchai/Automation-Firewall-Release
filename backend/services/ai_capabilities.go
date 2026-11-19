package services

// What this console can actually DO with a proposal — stated to the model, generated from the one
// list that decides it.
//
// ── The problem this solves ──────────────────────────────────────────────────
//
// The FortiOS reference in the system prompt teaches far more of the operating system than this
// console can carry out. The model was being taught `system interface` / VLANs, DHCP servers,
// BGP/OSPF, SSL-VPN, HA, log settings, `system global`, IPS sensors — and answering confidently
// about all of them. What the user then got was an Apply button with no wizard behind it, falling
// through to the SSH pipeline, which ships the model's raw text to a live firewall with no
// validator and no undo. The model was right about FortiOS and wrong about the product.
//
// So the prompt now says which is which, in three tiers, and says it in the CACHED block (it costs
// nothing per request). The tiers are not hand-written prose: tier 1 is rendered from
// consoleRESTSections below, which is asserted equal to the frontend's REST_SECTIONS set by
// TestCapabilityContractMatchesFrontendRESTSections. That is the point of doing it this way — the
// prompt and the applier cannot drift apart silently, which is exactly how this gap opened.

import (
	"sort"
	"strings"
)

// consoleRESTSections are the `config <section>` headers the Apply path builds OBJECT BY OBJECT
// over the REST device-proxy: validated by the same code the wizards use, recorded in the Change
// Ledger, and removable afterwards with the chat's Fallback button.
//
// ⚠️ This must stay equal to REST_SECTIONS in frontend/src/pages/ai-assistant/applyViaREST.ts.
// A Go test parses that file and compares the two sets, so adding an endpoint on one side without
// the other fails the build rather than quietly teaching the model something untrue.
//
// Values are the header exactly as it appears after `config ` in normalised CLI — which is why
// both the dotted and the spaced schedule spellings are here: FortiOS answers to both and the
// frontend's normaliser does not rewrite them.
var consoleRESTSections = []string{
	"antivirus profile",
	"application list",
	"dnsfilter domain-filter",
	"dnsfilter profile",
	"file-filter profile",
	"firewall address",
	"firewall policy",
	"firewall schedule group",
	"firewall schedule onetime",
	"firewall schedule recurring",
	"firewall service custom",
	"firewall vip",
	"firewall.schedule group",
	"firewall.schedule onetime",
	"firewall.schedule recurring",
	"router static",
	"system sdwan",
	"user group",
	"user ldap",
	"user local",
	"user radius",
	"webfilter profile",
	"webfilter urlfilter",
}

// restSectionsForPrompt is the tier-1 list as the prompt shows it: deduplicated of spelling twins
// (the model only ever writes the spaced form) and sorted, because this text sits inside the
// prompt-cached block and a map iteration order would invalidate the cache on every boot.
func restSectionsForPrompt() []string {
	skip := map[string]bool{
		// Dotted twins of the three schedule headers — accepted on the way in, never written out.
		"firewall.schedule group":     true,
		"firewall.schedule onetime":   true,
		"firewall.schedule recurring": true,
		// Built as part of their profile, never on their own (see the REST_SECTIONS comment in
		// applyViaREST.ts): listing them as standalone capabilities would invite the model to
		// propose a bare table whose id it had to guess.
		"webfilter urlfilter":     true,
		"dnsfilter domain-filter": true,
	}
	out := make([]string, 0, len(consoleRESTSections))
	for _, s := range consoleRESTSections {
		if !skip[s] {
			out = append(out, s)
		}
	}
	sort.Strings(out)
	return out
}

// capabilityContract is the block that opens the static system prompt.
//
// It is written in the second person and in terms of CONSEQUENCE, not permission: "this is built
// object by object and can be undone" vs "this is shipped as raw text to a live firewall". A rule
// phrased as a prohibition invites the model to work around it; a rule phrased as what happens to
// the user makes the right choice the obvious one.
func capabilityContract() string {
	var b strings.Builder
	b.WriteString("=== WHAT THIS CONSOLE CAN DO WITH YOUR ANSWER (read before proposing config) ===\n")
	b.WriteString("Your CLI is not pasted into a terminal. It takes one of two paths, and which one decides\n")
	b.WriteString("whether the user gets validation, a wizard and a one-click undo:\n\n")

	b.WriteString("TIER 1 — BUILT OBJECT BY OBJECT (preferred; a wizard opens, the Change Ledger records it,\n")
	b.WriteString("the chat's Fallback button can remove it again). Every top-level section of your answer must\n")
	b.WriteString("be one of these for it to take this path:\n")
	for _, s := range restSectionsForPrompt() {
		b.WriteString("  · config " + s + "\n")
	}
	b.WriteString("  · a COMPLETE IPsec VPN (phase1 + phase2 + its addresses/policies/routes, or an ADVPN\n")
	b.WriteString("    hub-and-spoke set): built as one tunnel object. Partial tunnel edits are NOT tier 1.\n")
	b.WriteString("  · the two tables that travel INSIDE a profile — a Web Filter's urlfilter table and a DNS\n")
	b.WriteString("    Filter's domain-filter table. Emit them with their profile, never on their own.\n\n")

	b.WriteString("TIER 2 — SHIPPED AS ONE RAW CLI BLOCK OVER SSH. Everything else that is valid FortiOS:\n")
	b.WriteString("system interface / VLANs, DHCP servers, BGP/OSPF/policy routes, SSL-VPN, HA, log settings,\n")
	b.WriteString("system global, IPS sensors, SSL/SSH inspection profiles, zones, certificates, local-in and\n")
	b.WriteString("DoS policies, and any delete/unset/purge of anything at all.\n")
	b.WriteString("What that means for the person reading your answer: NO field validation, NO wizard, NO\n")
	b.WriteString("Fallback undo — your text runs on a production firewall as written. So when the answer must\n")
	b.WriteString("be tier 2:\n")
	b.WriteString("  · keep the block as SHORT as the task allows, and emit nothing speculative;\n")
	b.WriteString("  · say in ONE line of the explanation that it is applied as a raw CLI block over SSH and\n")
	b.WriteString("    cannot be undone with Fallback, so they should read it before applying;\n")
	b.WriteString("  · NEVER mix tier 1 and tier 2 sections in one answer — one unknown section sends the\n")
	b.WriteString("    WHOLE proposal down the SSH path, including the parts that had a wizard. If the user\n")
	b.WriteString("    needs both, say so and propose the tier-1 part on its own first.\n\n")

	b.WriteString("TIER 3 — THIS CONSOLE WILL NOT WRITE IT. Do not propose config for these; answer the\n")
	b.WriteString("question and say where it has to be done instead (the FortiGate's own GUI/CLI):\n")
	b.WriteString("  · Network ▸ Interfaces is READ-ONLY here on purpose — never propose creating, editing or\n")
	b.WriteString("    deleting a `config system interface` entry as the ANSWER to a request. (A VLAN or\n")
	b.WriteString("    tunnel interface that is part of a complete VPN is the one exception — tier 1.)\n")
	b.WriteString("  · `execute` anything that reboots, formats, restores or factory-resets the unit.\n")
	b.WriteString("  · multi-VDOM administration, firmware upgrades, and licence activation.\n\n")

	b.WriteString("None of this changes what is TRUE about FortiOS — answer questions about any of it freely\n")
	b.WriteString("in mode=\"query\". It changes only what you should PROPOSE as config to be applied.\n")
	return b.String()
}
