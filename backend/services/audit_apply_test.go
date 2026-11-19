package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// This is the file that writes to a production firewall, so the tests are about what it REFUSES to
// do at least as much as what it does. Every one of them describes a way somebody's network breaks.

// step builds a remediation step the way BuildRemediationPlan does — the verdicts ARE the record of
// what would be written, which is what BuildApplyPlan reads.
func step(check string, cli []string, verdict FixVerifyStatus, vs ...FixVerification) RemediationStep {
	return RemediationStep{Check: check, CLI: cli, Verdict: verdict, Verification: vs}
}

func verified(path, mkey, attr, value string) FixVerification {
	return FixVerification{Path: path, MKey: mkey, Attr: attr, Value: value, Status: FixVerified}
}

func TestApplyPlanGroupsAttributesByObject(t *testing.T) {
	// FortiOS takes one PUT per object, and a reader confirming a change wants "policy 5: these two
	// settings", not two rows that happen to share a number.
	p := RemediationPlan{ControlID: "A.8.7", Steps: []RemediationStep{
		step("policy-no-inspection", []string{"config"}, FixVerified,
			verified(cmdbPolicy, "5", "utm-status", "enable"),
			verified(cmdbPolicy, "5", "av-profile", "default")),
	}}
	got := BuildApplyPlan(p, nil)
	if len(got.Writes) != 1 {
		t.Fatalf("want one write, got %d: %+v", len(got.Writes), got.Writes)
	}
	if len(got.Writes[0].Attrs) != 2 || got.Writes[0].MKey != "5" {
		t.Errorf("got %+v", got.Writes[0])
	}
	if !got.Ready {
		t.Error("a plan with no placeholders should be ready")
	}
}

func TestDifferentObjectsBecomeDifferentWrites(t *testing.T) {
	p := RemediationPlan{ControlID: "A.8.15", Steps: []RemediationStep{
		step("policy-no-logging", []string{"config"}, FixVerified,
			verified(cmdbPolicy, "1", "logtraffic", "all"),
			verified(cmdbPolicy, "2", "logtraffic", "all")),
	}}
	if got := BuildApplyPlan(p, nil); len(got.Writes) != 2 {
		t.Fatalf("two policies need two writes, got %d", len(got.Writes))
	}
}

func TestAPlaceholderBecomesAQuestionAndBlocksTheApply(t *testing.T) {
	// The one that matters most. Guessing a management subnet locks an administrator out of a
	// production firewall, so the plan is NOT ready until somebody supplies the value.
	p := RemediationPlan{ControlID: "A.8.2", Steps: []RemediationStep{
		step("admin-unrestricted", []string{"config"}, FixAttrOnly,
			FixVerification{Path: cmdbAdmin, MKey: "admin", Attr: "trusthost1",
				Value: "<management-subnet> <mask>", Status: FixAttrOnly}),
	}}
	got := BuildApplyPlan(p, nil)
	if got.Ready {
		t.Fatal("a plan with an unanswered placeholder must never be ready")
	}
	if len(got.Questions) != 1 {
		t.Fatalf("want one question, got %d", len(got.Questions))
	}
	q := got.Questions[0]
	if q.Attr != "trusthost1" || q.MKey != "admin" {
		t.Errorf("the question must name what it is about: %+v", q)
	}
	if !strings.Contains(q.Prompt, "trusthost1") {
		t.Errorf("the question should be asked in words: %q", q.Prompt)
	}

	// And answering it releases the write, with the operator's value.
	answered := BuildApplyPlan(p, map[string]string{q.ID: "10.0.99.0 255.255.255.0"})
	if !answered.Ready {
		t.Fatalf("answering should make it ready: %+v", answered)
	}
	if answered.Writes[0].Attrs["trusthost1"] != "10.0.99.0 255.255.255.0" {
		t.Errorf("got %+v", answered.Writes[0].Attrs)
	}
}

func TestStepsWithNothingToRunAreSkippedWithAReason(t *testing.T) {
	// "Take a configuration backup" is not a firewall write. Dropping it silently would leave a
	// reader thinking the plan covered it.
	p := RemediationPlan{ControlID: "A.8.9", Steps: []RemediationStep{
		{Check: "config-no-baseline", Manual: "Take a configuration backup. It lives in this console."},
	}}
	got := BuildApplyPlan(p, nil)
	if len(got.Writes) != 0 {
		t.Errorf("nothing should be written: %+v", got.Writes)
	}
	if len(got.Skipped) != 1 || got.Skipped[0].Check != "config-no-baseline" {
		t.Fatalf("want it skipped with a reason, got %+v", got.Skipped)
	}
	if !strings.Contains(got.Skipped[0].Reason, "backup") {
		t.Errorf("the reason should say what to do instead: %q", got.Skipped[0].Reason)
	}
}

func TestDeletesAndMovesAreNotAppliedFromHere(t *testing.T) {
	// Removing an object or reordering a rule base is a decision about intent, not a setting
	// somebody forgot — and getting the order wrong changes what the firewall permits.
	p := RemediationPlan{ControlID: "A.8.9", Steps: []RemediationStep{
		step("policy-shadowed", []string{"config"}, FixPathOnly,
			FixVerification{Path: cmdbPolicy, MKey: "7", Status: FixPathOnly}),
	}}
	got := BuildApplyPlan(p, nil)
	if len(got.Writes) != 0 {
		t.Errorf("a move must not be applied here: %+v", got.Writes)
	}
	if len(got.Skipped) != 1 {
		t.Fatalf("it should be skipped with a reason, got %+v", got.Skipped)
	}
}

func TestIntegersReachTheAPIAsIntegers(t *testing.T) {
	// FortiOS rejects "5" as a string on some integer attributes, and the failure is a 4xx nobody
	// can read. Everything else stays a string — guessing harder is how a hostname of all digits
	// becomes a number.
	if v := CoerceCMDBValue("5"); v != 5 {
		t.Errorf(`CoerceCMDBValue("5") = %#v, want 5`, v)
	}
	if v := CoerceCMDBValue(`"default"`); v != "default" {
		t.Errorf("quotes should be stripped, got %#v", v)
	}
	if v := CoerceCMDBValue("enable"); v != "enable" {
		t.Errorf("got %#v", v)
	}
	if v := CoerceCMDBValue("10.0.99.0 255.255.255.0"); v != "10.0.99.0 255.255.255.0" {
		t.Errorf("got %#v", v)
	}
}

func TestQuestionIdentityIsStableAcrossCalls(t *testing.T) {
	// The answer is posted back against this id. If it moved between the question and the answer,
	// the operator's value would be dropped and the placeholder written to the firewall.
	p := RemediationPlan{ControlID: "A.8.2", Steps: []RemediationStep{
		step("admin-unrestricted", []string{"config"}, FixAttrOnly,
			FixVerification{Path: cmdbAdmin, MKey: "admin", Attr: "trusthost1",
				Value: "<management-subnet>", Status: FixAttrOnly}),
	}}
	a := BuildApplyPlan(p, nil).Questions[0].ID
	b := BuildApplyPlan(p, nil).Questions[0].ID
	if a != b {
		t.Errorf("question id moved between calls: %q vs %q", a, b)
	}
}

// The hole this closes was found by applying to the real firewall and then being unable to put one
// of the four changes back. `log setting` has no mkey, the ledger's snapshot helper correctly
// refuses a keyless read, and nothing had noticed that those two facts together meant a write with
// no way home.
func TestSingleObjectTablesAreNamedNotInferred(t *testing.T) {
	for _, p := range []string{cmdbGlobal, cmdbNTP, cmdbLogSet, cmdbSyslog} {
		if !IsSingleObjectTable(p) {
			t.Errorf("%s holds exactly one object and must be snapshotted by its own path", p)
		}
	}
	// A collection must never be treated as one, whatever an mkey happens to be. This is the guard
	// that keeps a lost policy id from becoming a write across every policy.
	for _, p := range []string{cmdbPolicy, cmdbAddress, cmdbService, cmdbInterface, cmdbAdmin} {
		if IsSingleObjectTable(p) {
			t.Errorf("%s is a collection — treating it as a single object would write across the table", p)
		}
	}
	if IsSingleObjectTable("firewall/policy/") != IsSingleObjectTable("firewall/policy") {
		t.Error("a trailing slash must not change the answer")
	}
}

// Every keyless write the fix builders can emit has to be on that list, or it is a change that
// cannot be undone.
func TestEveryKeylessWriteCanBeSnapshotted(t *testing.T) {
	builders := map[string]func() ([]string, []FixTarget){
		"adminTimeoutFix": adminTimeoutFix,
		"lockoutFix":      lockoutFix,
		"ntpFix":          ntpFix,
		"implicitLogFix":  implicitLogFix,
		"syslogFix":       syslogFix,
	}
	for name, build := range builders {
		_, targets := build()
		for _, tg := range targets {
			if tg.MKey == "" && !IsSingleObjectTable(tg.Path) {
				t.Errorf("%s writes %s with no key and it is not a known single-object table — applying it would leave no way back",
					name, tg.Path)
			}
		}
	}
}

// A nil slice marshals as JSON `null`, and a browser reading `.length` off null throws — which
// unmounted the whole console, not just the panel. Six of the nine controls did that before this
// was pinned.
func TestListFieldsAreNeverNull(t *testing.T) {
	// The case that broke: a control with writes but no questions and nothing skipped.
	p := RemediationPlan{ControlID: "A.8.15", Steps: []RemediationStep{
		step("policy-no-logging", []string{"config"}, FixVerified,
			verified(cmdbPolicy, "1", "logtraffic", "all")),
	}}
	body, err := json.Marshal(BuildApplyPlan(p, nil))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(body, &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, field := range []string{"writes", "questions", "skipped"} {
		v, present := raw[field]
		if !present {
			t.Errorf("%q is missing from the payload — a reader cannot tell that from an empty list", field)
			continue
		}
		if string(v) == "null" {
			t.Errorf("%q serialised as null; it must be [] so a reader can take its length", field)
		}
	}

	// And an entirely empty plan, which is the other way to get a nil slice.
	body, _ = json.Marshal(BuildApplyPlan(RemediationPlan{ControlID: "A.8.17"}, nil))
	if strings.Contains(string(body), "null") {
		t.Errorf("an empty plan still serialises a null somewhere: %s", body)
	}
}

// ── Table-attribute coercion: the bug a live apply found ─────────────────────
//
// secureServiceFix and anyAnyFix both write firewall.policy's `service` as quoted CLI text —
// `"SSH" "HTTPS"` — because that is what the fix CLI reads as. FortiOS's CMDB API wants that
// attribute as [{"name":"SSH"},{"name":"HTTPS"}], and was found, live, to accept the bare string
// with HTTP success while leaving the policy's actual service list untouched. These tests pin the
// fix: CoerceCMDBAttrValue must build the array shape for a table attribute (one whose schema entry
// carries no Type — see audit_fix_verify.go's attrKind) and must leave everything else exactly as
// CoerceCMDBValue already did.

func testSchema(attrs map[string]FGSchemaAttr) FGSchema {
	return FGSchema{Path: "firewall/policy", Attrs: attrs}
}

func TestCoerceCMDBAttrValue_TableAttributeBecomesANameArray(t *testing.T) {
	schema := testSchema(map[string]FGSchemaAttr{
		"service": {Name: "service", Type: ""}, // table/datasource: no Type, per attrKind
	})
	got := CoerceCMDBAttrValue(schema, "service", `"SSH" "HTTPS"`)
	names, ok := got.([]FGName)
	if !ok {
		t.Fatalf("expected []FGName, got %T (%v)", got, got)
	}
	if len(names) != 2 || names[0].Name != "SSH" || names[1].Name != "HTTPS" {
		t.Errorf("expected [SSH HTTPS], got %v", names)
	}
}

func TestCoerceCMDBAttrValue_SingleTableMemberStillBecomesAOneElementArray(t *testing.T) {
	schema := testSchema(map[string]FGSchemaAttr{"service": {Name: "service", Type: ""}})
	got := CoerceCMDBAttrValue(schema, "service", `"HTTPS"`)
	names, ok := got.([]FGName)
	if !ok || len(names) != 1 || names[0].Name != "HTTPS" {
		t.Errorf("expected a single-element []FGName{HTTPS}, got %T (%v)", got, got)
	}
}

func TestCoerceCMDBAttrValue_OptionFlagsStayAPlainString(t *testing.T) {
	// allowaccess is a multi-select OPTION field, not a table — FortiOS already accepts it as the
	// space-separated string allowAccessFix writes, and converting it into a name array would break
	// a fix that already worked.
	schema := testSchema(map[string]FGSchemaAttr{
		"allowaccess": {Name: "allowaccess", Type: "option", Options: []string{"ping", "https", "ssh"}},
	})
	got := CoerceCMDBAttrValue(schema, "allowaccess", "ping https ssh")
	if got != "ping https ssh" {
		t.Errorf("expected the option string to pass through unchanged, got %T (%v)", got, got)
	}
}

func TestCoerceCMDBAttrValue_UnknownOrScalarAttributeFallsBackToPlainCoercion(t *testing.T) {
	schema := testSchema(map[string]FGSchemaAttr{"logtraffic": {Name: "logtraffic", Type: "option"}})
	if got := CoerceCMDBAttrValue(schema, "logtraffic", "all"); got != "all" {
		t.Errorf("expected the scalar value unchanged, got %T (%v)", got, got)
	}
	// An attribute the schema does not know about must not panic or invent a shape.
	if got := CoerceCMDBAttrValue(schema, "no-such-attr", "42"); got != 42 {
		t.Errorf("expected CoerceCMDBValue's own numeric fallback, got %T (%v)", got, got)
	}
}

// ── The backstop: did the table write actually land? ──────────────────────────

func TestMissingListMembers_FlagsAMemberTheDeviceNeverGot(t *testing.T) {
	coerced := map[string]any{"service": NamesToFGNames([]string{"SSH", "HTTPS"})}
	after := json.RawMessage(`{"service":[{"name":"SSH"}]}`) // HTTPS never landed
	missing := MissingListMembers(coerced, after)
	if len(missing) != 1 || !strings.Contains(missing[0], "HTTPS") {
		t.Errorf("expected a report naming HTTPS as missing, got %v", missing)
	}
}

func TestMissingListMembers_SilentNoOpIsCaught(t *testing.T) {
	// This is the exact shape of the live bug: the device kept the old service list entirely.
	coerced := map[string]any{"service": NamesToFGNames([]string{"SSH", "HTTPS"})}
	after := json.RawMessage(`{"service":[{"name":"TELNET"}]}`)
	missing := MissingListMembers(coerced, after)
	if len(missing) != 1 || !strings.Contains(missing[0], "SSH") || !strings.Contains(missing[0], "HTTPS") {
		t.Errorf("expected both SSH and HTTPS reported missing, got %v", missing)
	}
}

func TestMissingListMembers_PassesWhenEverythingLanded(t *testing.T) {
	coerced := map[string]any{"service": NamesToFGNames([]string{"SSH", "HTTPS"})}
	after := json.RawMessage(`{"service":[{"name":"SSH"},{"name":"HTTPS"}]}`)
	if missing := MissingListMembers(coerced, after); len(missing) != 0 {
		t.Errorf("expected no missing members, got %v", missing)
	}
}

func TestMissingListMembers_IgnoresScalarAttributes(t *testing.T) {
	// A plain string/option attribute is not this function's job — UpdateCMDBAttrs's own error
	// already covers it, and re-checking it here would risk a false failure on an attribute whose
	// read-back format legitimately differs from what was sent (case, whitespace, …).
	coerced := map[string]any{"logtraffic": "all"}
	after := json.RawMessage(`{"logtraffic":"disable"}`)
	if missing := MissingListMembers(coerced, after); len(missing) != 0 {
		t.Errorf("a scalar attribute must never be checked here, got %v", missing)
	}
}
