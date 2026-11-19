package services

import (
	"encoding/json"
	"strconv"
)

// Turning a log entry's `policyid` into something a person can act on.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────────
// "Why can't I get online?" and "why won't YouTube load?" are answered by ONE column: which rule
// claimed the packet. The log carries only a number, and a number is not an answer — `policyid: 8`
// means nothing until it reads `Block-FB-YT-172.16.100.123`, at which point the investigation is
// over.
//
// ── THE NUMBER ALONE IS AMBIGUOUS, AND DANGEROUSLY SO ────────────────────────
// `policyid: 0` is not "no policy". It means two completely different things depending on
// `policytype`, and confusing them sends someone to edit the wrong table:
//
//	policytype "policy"          id 0  → the IMPLICIT DENY at the bottom of the rule table.
//	                                     Nothing matched. This is the answer to "I can't get
//	                                     online" far more often than any other.
//	policytype "local-in-policy" id 0  → the implicit local-in policy: traffic to the FortiGate
//	                                     itself, on a service the interface allows by default.
//	                                     Nothing is wrong and there is no rule to look at.
//
// Both are real, both are id 0, and `policytype` is supposed to separate them.
//
// ⚠️ AND ON A REAL DEVICE, `policytype` IS OFTEN NOT THERE. Measured on the lab FGT80E
// (FortiOS 7.2.10, memory backend): all 200 entries in the Local Traffic log carry `policyid: 0`
// and NO `policytype` field at all. Defaulting an absent policytype to the forward implicit deny
// labelled every one of those rows "Implicit deny", in red, as blocked — including the NTP
// exchanges the firewall completed successfully, 76 bytes each way. A log that reports 200 blocked
// connections on a firewall that blocked none is worse than no policy column.
//
// So the LOG BEING READ decides when the field is missing. The forward table's implicit deny is
// not in the path of traffic addressed to the unit at all, so in the Local Traffic log id 0 can
// only be the local-in policy. An explicit `policytype` still wins over the inference.
//
// See LogPolicyRef.
//
// ── A POLICY THAT NO LONGER EXISTS ───────────────────────────────────────────
// A log entry outlives the rule that produced it. An id with no row in the table today is not an
// error to swallow: it says the rule was deleted or renumbered since, which is itself the
// explanation for "it worked yesterday". Missing is reported, never guessed at.

// LogPolicyRef is what the console can say about the rule a log entry names.
type LogPolicyRef struct {
	// Name is the rule's name, "" when it has none (FortiOS allows unnamed policies) or when the
	// id no longer resolves.
	Name string `json:"name,omitempty"`
	// Action is the rule's configured action — "accept" or "deny".
	//
	// Worth having beside the log's OWN action, because the two disagreeing is a diagnosis in
	// itself: a policy that says `accept` on a row logged `deny` means a security profile stopped
	// the traffic, not the rule. That is exactly the YouTube case — the rule permits it and a Web
	// Filter or Application Control sensor blocks it.
	Action string `json:"action,omitempty"`
	// Status is "enable" or "disable". A disabled rule cannot have matched, so seeing one here
	// means the id is stale.
	Status string `json:"status,omitempty"`
	// Exists is false when the id named no rule in the table. Reported rather than hidden: the
	// rule having been deleted since is a real answer to "it worked yesterday".
	Exists bool `json:"exists"`
	// Implicit marks the two rules that are not in the table at all — the implicit deny and the
	// implicit local-in policy. They have no row to look up and no page to edit.
	Implicit bool `json:"implicit,omitempty"`
	// LocalIn tells the two implicit rules apart, so the UI never has to re-derive it from a
	// `policytype` the device may not have sent. True = the implicit local-in policy (accepts),
	// false = the forward table's implicit deny (blocks).
	LocalIn bool `json:"local_in,omitempty"`
}

// rawPolicyRow is the slice of firewall/policy this needs. Requested with `format=` so the device
// sends four fields per rule instead of the whole 42 KB table.
type rawPolicyRow struct {
	PolicyID int             `json:"policyid"`
	Name     string          `json:"name"`
	Action   string          `json:"action"`
	Status   string          `json:"status"`
	Comments json.RawMessage `json:"comments"`
}

// policyFormat is the field list asked of the device. Keeping it narrow matters: the page fetches
// this alongside the log on every refresh, and the full policy table on a busy firewall is large
// enough to dominate the request.
const policyFormat = "policyid|name|action|status"

// GetLogPolicyRefs reads the rule table as a lookup for the log view.
//
// Returns an empty map rather than an error when the device will not answer: the policy NAME is an
// enrichment, and a log that renders with bare id numbers is far better than no log at all.
func (f *FortiClient) GetLogPolicyRefs() map[int]LogPolicyRef {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/policy?format="+policyFormat, nil)
	if err != nil {
		return map[int]LogPolicyRef{}
	}
	return parseLogPolicyRefs(resp.Results)
}

// parseLogPolicyRefs decodes a firewall/policy listing into the lookup. Separate from the request
// so it can be replayed in tests.
func parseLogPolicyRefs(results json.RawMessage) map[int]LogPolicyRef {
	out := map[int]LogPolicyRef{}
	var rows []rawPolicyRow
	if json.Unmarshal(results, &rows) != nil {
		return out
	}
	for _, r := range rows {
		out[r.PolicyID] = LogPolicyRef{
			Name:   r.Name,
			Action: r.Action,
			Status: r.Status,
			Exists: true,
		}
	}
	return out
}

// policyTypeLocalIn is the value FortiOS puts in `policytype` for traffic addressed to the unit.
const policyTypeLocalIn = "local-in-policy"

// ResolveLogPolicy attaches the rule behind one log entry.
//
// `id` is a pointer because FortiOS omits the field rather than sending zero on some rows, and 0
// is itself meaningful here — see the note at the top of this file. A nil id means the device did
// not say which rule matched, which is not the same as "no rule did".
// `subcategory` is the log this row came out of ("local", "forward", …). It settles id 0 when the
// device omits `policytype`, which on the lab unit it always does — see the note above.
func ResolveLogPolicy(id *int, policyType, subcategory string, table map[int]LogPolicyRef) *LogPolicyRef {
	if id == nil {
		return nil
	}

	// The two implicit rules have no row in any table, so a lookup would report them as deleted.
	if *id == 0 {
		return &LogPolicyRef{
			Implicit: true,
			Action:   implicitAction(policyType, subcategory),
			Exists:   true,
			LocalIn:  isLocalIn(policyType, subcategory),
		}
	}

	if ref, ok := table[*id]; ok {
		return &ref
	}
	// Named a rule that is not in the table: deleted or renumbered since the entry was written.
	return &LogPolicyRef{Exists: false}
}

// implicitAction is what the implicit rule at each id-0 does.
//
// The implicit DENY at the bottom of the forward table denies; the implicit LOCAL-IN policy
// accepts (it is how the GUI and SSH are reachable at all). Getting these the wrong way round
// labels every ordinary management connection as blocked, which is exactly what an absent
// `policytype` used to do here.
func implicitAction(policyType, subcategory string) string {
	if isLocalIn(policyType, subcategory) {
		return "accept"
	}
	return "deny"
}

// isLocalIn decides which of the two id-0 rules this is.
//
// The device's own word first. Failing that, the log it came from: traffic in the LOCAL log is by
// definition addressed to, or sent by, the FortiGate itself, and the forward table's implicit deny
// sits in a path those packets never take.
func isLocalIn(policyType, subcategory string) bool {
	if policyType != "" {
		return policyType == policyTypeLocalIn
	}
	return subcategory == logSubcategoryLocal
}

// PolicyLabel is the short text for the Policy column, for callers that want one string.
//
// The UI builds its own so that the words go through the translation dictionary, but the CSV
// export needs a flat value and this is it.
func PolicyLabel(id *int, policyType string, ref *LogPolicyRef) string {
	if id == nil {
		return ""
	}
	if ref != nil && ref.Implicit {
		// The resolved ref already knows which of the two it is — it was decided where the log
		// being read was known. policyType is the fallback for a ref built without it.
		if ref.LocalIn || policyType == policyTypeLocalIn {
			return "implicit local-in"
		}
		return "implicit deny"
	}
	label := "#" + strconv.Itoa(*id)
	if ref != nil && ref.Name != "" {
		label += " " + ref.Name
	}
	if ref != nil && !ref.Exists {
		label += " (deleted)"
	}
	return label
}
