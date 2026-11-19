package services

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// ── Actually making the change, and being able to take it back ───────────────
//
// Everything before this file stopped at "here is the command, you run it". That is the safe
// default and it stays the default: nothing here runs without an explicit confirmation naming
// exactly what will be written.
//
// WHY IT WRITES ATTRIBUTES, NOT CLI. The obvious implementation pushes the CLI text at the device
// over SSH. This one sends a CMDB PUT carrying only the attributes the fix names, because the whole
// evidence layer is already expressed that way (FixTarget: path, mkey, attribute, value) and
// because it buys three things a CLI replay cannot:
//
//	· the write is EXACT — nothing outside the named attributes is touched, so a fix for
//	  `logtraffic` cannot disturb the rest of a policy;
//	· it is REVERTIBLE — the object is snapshotted by (path, mkey) first and the existing change
//	  ledger replays that snapshot, which is machinery this project already trusts;
//	· it is ATTRIBUTABLE — every write lands in the ledger under the person who pressed the button.
//
// WHAT IT REFUSES TO DO. A fix whose value is a placeholder (`<management-subnet>`) is not applied
// until somebody supplies the value; the panel asks, with the model's suggested options beside the
// question. A step with no CLI is not applied at all — "take a configuration backup" is not a
// firewall write. And a step the device could not verify is applied only if the operator
// acknowledges it, because that is the case where the command may not do what it says.
//
// THE RISK THIS FILE CANNOT REMOVE. Some of these changes can cut the operator's own access to the
// firewall — restricting `trusthost1` from the wrong subnet is the obvious one. That is stated on
// the confirmation, it is what the model's risk paragraph is for, and it is why the revert path is
// built before the apply path rather than after.

// ApplyOption is one value the operator can pick for a question.
type ApplyOption struct {
	Value string `json:"value"`
	Label string `json:"label"`
	// Note says what choosing this one means. Written by the model, from device facts.
	Note string `json:"note,omitempty"`
}

// ApplyQuestion is a value this console will not invent.
//
// It exists because half the useful fixes are shaped "restrict this to <the thing only you know>".
// Guessing would be worse than not applying: a wrong management subnet locks an administrator out
// of a production firewall.
type ApplyQuestion struct {
	ID    string `json:"id"`
	Check string `json:"check"`
	Path  string `json:"path"`
	MKey  string `json:"mkey,omitempty"`
	Attr  string `json:"attr"`
	// Placeholder is the token in the CLI this answer replaces.
	Placeholder string `json:"placeholder"`
	// Prompt is the question in words. Written by the model where one is available, and falls back
	// to a plain one built here so a question is never asked without being asked in English.
	Prompt string `json:"prompt"`
	// Options are suggestions, not a closed list — the operator may type their own.
	Options []ApplyOption `json:"options,omitempty"`
	// Options came from the device's own configuration, where they did.
	FromDevice bool `json:"from_device,omitempty"`
}

// ApplyWrite is one CMDB object and the attributes that would be written to it.
//
// Grouped by object rather than by attribute: FortiOS takes one PUT per object, and a reader
// confirming a change wants to see "policy 5: these two settings", not two separate rows.
type ApplyWrite struct {
	Check string            `json:"check"`
	Path  string            `json:"path"`
	MKey  string            `json:"mkey,omitempty"`
	Attrs map[string]string `json:"attrs"`
	// Unanswered lists attributes still waiting on a question. A write with any is not applied.
	Unanswered []string `json:"unanswered,omitempty"`
	// Verified is the device's verdict for this step, carried so the confirmation can mark a write
	// the firmware did not confirm.
	Verified FixVerifyStatus `json:"verified,omitempty"`
}

// ApplyPlan is what would happen, computed before anything is written.
type ApplyPlan struct {
	ControlID string          `json:"control_id"`
	Writes    []ApplyWrite    `json:"writes"`
	Questions []ApplyQuestion `json:"questions"`
	// Skipped names steps that cannot be applied here, with the reason — a backup to take, a
	// firmware upgrade, a rule to move. Stated rather than silently dropped.
	Skipped []ApplySkip `json:"skipped"`
	// Ready is true when every write has its values and can be sent.
	Ready bool `json:"ready"`
}

type ApplySkip struct {
	Check  string `json:"check"`
	Reason string `json:"reason"`
}

// ApplyResult is one object's outcome.
type ApplyResult struct {
	Check string            `json:"check"`
	Path  string            `json:"path"`
	MKey  string            `json:"mkey,omitempty"`
	Attrs map[string]string `json:"attrs"`
	OK    bool              `json:"ok"`
	Error string            `json:"error,omitempty"`
	// ChangeID is the ledger row, and the handle a revert uses.
	ChangeID uint `json:"change_id,omitempty"`
}

// placeholderRe-free detection: a value is a placeholder when the CLI wrote it in angle brackets.
// The fix builders never emit one any other way — see setPair.target.
func isPlaceholderValue(v string) bool { return placeholder(strings.TrimSpace(v)) }

// questionID is stable across calls so an answer posted back can be matched to its question.
func questionID(check, path, mkey, attr string) string {
	return strings.Join([]string{check, path, mkey, attr}, "|")
}

// BuildApplyPlan works out what applying a remediation plan would write, and what it must ask first.
//
// answers maps question id → the operator's value. Passing none is how the panel gets the questions
// in the first place; passing them all is how it gets a plan that is Ready.
func BuildApplyPlan(plan RemediationPlan, answers map[string]string) ApplyPlan {
	// Initialised, not left nil. Go marshals a nil slice as JSON `null`, and a browser reading
	// `preview.questions.length` off null throws — which unmounts the React tree and white-screens
	// the whole console, not just this panel. Six of nine controls did exactly that.
	//
	// The fix belongs here rather than only in the reader: an API that sometimes says `null` and
	// sometimes `[]` for the same field is a trap for every consumer it will ever have.
	out := ApplyPlan{
		ControlID: plan.ControlID,
		Writes:    []ApplyWrite{},
		Questions: []ApplyQuestion{},
		Skipped:   []ApplySkip{},
	}

	// One write per (path, mkey), in the order the steps are listed.
	type key struct{ check, path, mkey string }
	index := map[key]int{}

	for _, step := range plan.Steps {
		if len(step.CLI) == 0 {
			out.Skipped = append(out.Skipped, ApplySkip{
				Check:  step.Check,
				Reason: "there is no command to run — " + firstSentence(step.Manual),
			})
			continue
		}
		var setTargets []FixTarget
		for _, t := range stepTargets(step) {
			if t.Op == FixSet {
				setTargets = append(setTargets, t)
			}
		}
		if len(setTargets) == 0 {
			// A delete or a move. Both are real changes and both are deliberately out of scope
			// here: deleting an object or reordering a rule base is a decision about intent, not a
			// setting somebody forgot, and it belongs on the page that owns those objects.
			out.Skipped = append(out.Skipped, ApplySkip{
				Check:  step.Check,
				Reason: "this one removes or reorders an object rather than changing a setting — do it from the page that owns it, so the surrounding rules are in view",
			})
			continue
		}

		for _, t := range setTargets {
			k := key{step.Check, t.Path, t.MKey}
			idx, seen := index[k]
			if !seen {
				out.Writes = append(out.Writes, ApplyWrite{
					Check: step.Check, Path: t.Path, MKey: t.MKey,
					Attrs: map[string]string{}, Verified: step.Verdict,
				})
				idx = len(out.Writes) - 1
				index[k] = idx
			}
			w := &out.Writes[idx]

			value := t.Value
			// A list target carries the raw text; a plain one carries the value. Either can hold a
			// placeholder, and either way the operator has to supply it.
			if value == "" || isPlaceholderValue(value) || strings.Contains(value, "<") {
				qid := questionID(step.Check, t.Path, t.MKey, t.Attr)
				if ans, ok := answers[qid]; ok && strings.TrimSpace(ans) != "" {
					value = strings.TrimSpace(ans)
				} else {
					w.Unanswered = append(w.Unanswered, t.Attr)
					out.Questions = append(out.Questions, ApplyQuestion{
						ID: qid, Check: step.Check, Path: t.Path, MKey: t.MKey, Attr: t.Attr,
						Placeholder: t.Value,
						Prompt:      defaultPrompt(t),
					})
					continue
				}
			}
			w.Attrs[t.Attr] = value
		}
	}

	out.Ready = len(out.Questions) == 0 && len(out.Writes) > 0
	for _, w := range out.Writes {
		if len(w.Attrs) == 0 {
			out.Ready = false
		}
	}
	return out
}

// stepTargets rebuilds the targets for a step from its verification rows.
//
// The plan that crosses the wire carries Verification (path + attr + value per line) but not the
// raw FixTargets, and adding a second copy of the same information to the payload is how two
// representations of one thing start disagreeing. The verdicts already name every attribute the
// step writes, which is exactly what an apply needs.
func stepTargets(step RemediationStep) []FixTarget {
	out := make([]FixTarget, 0, len(step.Verification))
	for _, v := range step.Verification {
		op := FixSet
		switch v.Status {
		case FixPathOnly:
			// A delete or a move: the verifier records no attribute for it.
			op = FixDelete
		}
		out = append(out, FixTarget{
			Path: v.Path, MKey: v.MKey, Op: op, Attr: v.Attr, Value: v.Value,
		})
	}
	return out
}

func defaultPrompt(t FixTarget) string {
	where := cliPath(t.Path)
	if t.MKey != "" {
		where += " " + t.MKey
	}
	return fmt.Sprintf("What should %s be set to on %s?", t.Attr, where)
}

func firstSentence(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.IndexAny(s, ".\n"); i > 0 {
		return s[:i+1]
	}
	return s
}

// ── Writing it ───────────────────────────────────────────────────────────────

// CoerceCMDBValue turns the CLI's text into what the CMDB API expects.
//
// FortiOS is strict about this in one direction: an integer attribute rejects "5" as a string on
// some tables. Everything else stays a string, because guessing more aggressively is how a hostname
// that happens to be all digits becomes a number.
func CoerceCMDBValue(v string) any {
	v = strings.Trim(strings.TrimSpace(v), `"`)
	if n, err := strconv.Atoi(v); err == nil && v != "" {
		return n
	}
	return v
}

// CoerceCMDBAttrValue is CoerceCMDBValue plus the one case it cannot see from the text alone: a
// table/datasource attribute (firewall.policy's `service`, a group's `member`, …) that a fix wrote
// as quoted, space-separated CLI text — `secureServiceFix` and `anyAnyFix` both build `service` this
// way (services/audit_fix.go's setRaw). FortiOS wants that one as [{"name":"SSH"},{"name":"HTTPS"}],
// never as the literal string a CLI fix produces, and it was found to accept the wrong shape with
// HTTP success while leaving the object unchanged — the apply reported "applied" for a write that
// never happened. See audit_fix_verify.go's attrKind: a table attribute is exactly the one whose
// schema entry carries no Type, which is what tells this function which shape to build without
// having to know this attribute by name.
//
// A space-separated FLAG attribute (`allowaccess`, built by allowAccessFix the same way) is not a
// table — its schema Type is "option" — and FortiOS already accepts that one as the plain string it
// is, so it falls through to CoerceCMDBValue unchanged.
func CoerceCMDBAttrValue(schema FGSchema, attr, raw string) any {
	a, ok := schema.Attrs[strings.ToLower(attr)]
	if !ok || a.Type != "" {
		return CoerceCMDBValue(raw)
	}
	var names []string
	for _, tok := range strings.Fields(raw) {
		if v := strings.Trim(tok, `"`); v != "" {
			names = append(names, v)
		}
	}
	return NamesToFGNames(names)
}

// MissingListMembers re-reads what a write actually produced on the device and names any
// table/datasource attribute whose intended members are not present afterwards.
//
// This is the backstop for the exact failure CoerceCMDBAttrValue fixes: FortiOS can answer a PUT
// with HTTP success and still not have applied a table-typed field, so a write's own "no error"
// is not sufficient evidence that it did what it said. `coerced` is the attrs map actually sent
// (post-CoerceCMDBAttrValue); only its []FGName-shaped values are checked — a plain string or
// integer attribute either matches what was sent or the PUT itself already failed.
func MissingListMembers(coerced map[string]any, after json.RawMessage) []string {
	if len(after) == 0 || len(coerced) == 0 {
		return nil
	}
	var obj map[string]json.RawMessage
	if json.Unmarshal(after, &obj) != nil {
		return nil
	}
	var out []string
	for attr, v := range coerced {
		intended, ok := v.([]FGName)
		if !ok || len(intended) == 0 {
			continue
		}
		var current []FGName
		if field, found := obj[attr]; found {
			_ = json.Unmarshal(field, &current)
		}
		present := map[string]bool{}
		for _, c := range current {
			present[strings.ToLower(c.Name)] = true
		}
		var missing []string
		for _, n := range intended {
			if !present[strings.ToLower(n.Name)] {
				missing = append(missing, n.Name)
			}
		}
		if len(missing) > 0 {
			out = append(out, fmt.Sprintf("%s still missing %s after the write", attr, strings.Join(missing, ", ")))
		}
	}
	sort.Strings(out)
	return out
}

// SortQuestions puts the questions in a stable order so the form does not reshuffle between calls.
func SortQuestions(qs []ApplyQuestion) {
	sort.SliceStable(qs, func(i, j int) bool { return qs[i].ID < qs[j].ID })
}

// ── Single-object tables ─────────────────────────────────────────────────────
//
// `system global`, `log setting`, `system ntp` and `log syslogd setting` are not collections. There
// is one of each, it has no mkey, and FortiOS takes a PUT on the table itself.
//
// That collides with two deliberate guards in the change ledger: SnapshotCMDBObject refuses a read
// with no mkey, and BuildRevertRequest refuses an update with no key. BOTH ARE RIGHT — for a
// collection, a keyless write is the mistake that once emptied a whole policy table on this
// project, and neither guard is being loosened here.
//
// So the distinction is made explicit instead. A path is single-object because it is on this list,
// not because an mkey happened to be missing: a future bug that drops a policy id must not be able
// to turn itself into a write across every policy.
//
// The cost of getting this wrong showed up live — the first apply set `fwpolicy-implicit-log` and
// then could not put it back, because nothing had snapshotted a table with no key.
var singleObjectTables = map[string]bool{
	cmdbGlobal: true,
	cmdbNTP:    true,
	cmdbLogSet: true,
	cmdbSyslog: true,
}

// IsSingleObjectTable reports whether a CMDB path holds exactly one object, keyed by nothing.
func IsSingleObjectTable(cmdbPath string) bool {
	return singleObjectTables[strings.Trim(strings.TrimSpace(cmdbPath), "/")]
}

// SnapshotCMDBTable captures a single-object table, so a write to one can be undone.
//
// Refuses anything not on the list above: a GET is harmless, but returning a collection here would
// hand the undo path a JSON array to PUT back, and what that does to a rule base is not something
// to find out.
func (f *FortiClient) SnapshotCMDBTable(cmdbPath string) (json.RawMessage, error) {
	if !IsSingleObjectTable(cmdbPath) {
		return nil, fmt.Errorf("%s is not a single-object table", cmdbPath)
	}
	resp, err := f.do("GET", LedgerPath(cmdbPath), nil)
	if err != nil {
		return nil, err
	}
	// FortiOS answers a single-object table with the object itself, not a one-element array. Both
	// shapes are handled: an array here would mean the path was mis-classified, and unwrapping is
	// safer than replaying a list.
	var arr []json.RawMessage
	if json.Unmarshal(resp.Results, &arr) == nil {
		if len(arr) == 0 {
			return nil, nil
		}
		return arr[0], nil
	}
	return resp.Results, nil
}

// RestoreCMDBTable puts a snapshotted single-object table back.
func (f *FortiClient) RestoreCMDBTable(cmdbPath string, before json.RawMessage) error {
	if !IsSingleObjectTable(cmdbPath) {
		return fmt.Errorf("%s is not a single-object table", cmdbPath)
	}
	if len(before) == 0 {
		return fmt.Errorf("no snapshot to put back")
	}
	var body map[string]any
	if err := json.Unmarshal(before, &body); err != nil {
		return fmt.Errorf("stored snapshot is not an object: %w", err)
	}
	resp, err := f.do("PUT", LedgerPath(cmdbPath), body)
	if err != nil {
		return err
	}
	if resp != nil && resp.Status != "" && !strings.EqualFold(resp.Status, "success") {
		return fmt.Errorf("%s", fgErrorText(resp))
	}
	return nil
}
