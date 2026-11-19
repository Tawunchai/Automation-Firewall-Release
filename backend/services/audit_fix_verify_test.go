package services

import (
	"errors"
	"strings"
	"testing"
)

// The verifier's whole value is that it can say "no". So the tests are mostly about the cases the
// lab firewall cannot be made to produce on demand — a renamed attribute, a value the build does
// not accept, a device that will not answer — because those are exactly the ones that would
// otherwise be discovered by a customer running a command that silently does nothing.

type fakeSchema struct {
	schemas map[string]FGSchema
	err     map[string]error
	calls   int
}

func (f *fakeSchema) GetCMDBSchema(path string) (FGSchema, error) {
	f.calls++
	if err, ok := f.err[path]; ok {
		return FGSchema{}, err
	}
	s, ok := f.schemas[path]
	if !ok {
		return FGSchema{}, errors.New("no such path")
	}
	return s, nil
}

// The lab FortiGate 80E's real answers, as read from it with ?action=schema.
func labSchema() *fakeSchema {
	return &fakeSchema{schemas: map[string]FGSchema{
		cmdbPolicy: {Path: "firewall", Name: "policy", MKey: "policyid", Attrs: map[string]FGSchemaAttr{
			"logtraffic":      {Name: "logtraffic", Type: "option", Options: []string{"all", "utm", "disable"}},
			"utm-status":      {Name: "utm-status", Type: "option", Options: []string{"enable", "disable"}},
			"av-profile":      {Name: "av-profile", Type: "string"},
			"dstaddr":         {Name: "dstaddr", Type: ""},
			"service":         {Name: "service", Type: ""},
			"ssl-ssh-profile": {Name: "ssl-ssh-profile", Type: "string"},
		}},
		cmdbInterface: {Path: "system", Name: "interface", MKey: "name", Attrs: map[string]FGSchemaAttr{
			"allowaccess": {Name: "allowaccess", Type: "option", Options: []string{"ping", "https", "ssh", "snmp", "http", "telnet"}},
			"src-check":   {Name: "src-check", Type: "option", Options: []string{"enable", "disable"}},
		}},
		cmdbGlobal: {Path: "system", Name: "global", Attrs: map[string]FGSchemaAttr{
			"admintimeout": {Name: "admintimeout", Type: "integer"},
		}},
		cmdbSyslog: {Path: "log.syslogd", Name: "setting", Attrs: map[string]FGSchemaAttr{
			"status": {Name: "status", Type: "option", Options: []string{"enable", "disable"}},
			"server": {Name: "server", Type: "string"},
		}},
	}}
}

func verifyOne(t *testing.T, dev SchemaReader, targets []FixTarget) FixVerification {
	t.Helper()
	got := VerifyFixTargets(dev, targets)
	if len(got) != 1 {
		t.Fatalf("want one verdict, got %d: %+v", len(got), got)
	}
	return got[0]
}

func TestVerifiedWhenTheDeviceAcceptsTheValue(t *testing.T) {
	_, targets := logTrafficFix(3)
	v := verifyOne(t, labSchema(), targets)
	if v.Status != FixVerified {
		t.Errorf("set logtraffic all: got %q — %s", v.Status, v.Detail)
	}
	if len(v.Options) == 0 {
		t.Error("a verified option should still carry what the device published")
	}
}

func TestAttributeOnlyWhenTheValueIsNotEnumerable(t *testing.T) {
	// av-profile is a string: the device cannot say whether "default" exists, only that the
	// attribute does. Claiming more would be the tool inventing certainty.
	_, targets := avProfileFix(3)
	v := verifyOne(t, labSchema(), targets)
	if v.Status != FixAttrOnly {
		t.Errorf("set av-profile: got %q — %s", v.Status, v.Detail)
	}
}

func TestAPlaceholderIsNeverReportedAsRejected(t *testing.T) {
	// "<collector-ip>" is the operator's to fill in. A verifier that checks it produces a red badge
	// on a command that is perfectly correct.
	_, targets := syslogFix()
	got := VerifyFixTargets(labSchema(), targets)
	for _, v := range got {
		if v.Status == FixValueUnlisted {
			t.Errorf("%s %s was reported as rejected: %s", v.Attr, v.Value, v.Detail)
		}
	}
}

func TestAnUnknownAttributeIsReportedLoudly(t *testing.T) {
	// The regression this exists for: Fortinet renames or removes an attribute in a later build,
	// and our fix becomes a command that fails or, worse, appears to succeed.
	dev := labSchema()
	delete(dev.schemas[cmdbPolicy].Attrs, "logtraffic")

	_, targets := logTrafficFix(3)
	v := verifyOne(t, dev, targets)
	if v.Status != FixAttrUnknown {
		t.Fatalf("got %q, want %q", v.Status, FixAttrUnknown)
	}
	if !strings.Contains(v.Detail, "logtraffic") {
		t.Errorf("the reason must name the attribute: %q", v.Detail)
	}
}

func TestAValueTheBuildDoesNotAcceptIsReported(t *testing.T) {
	dev := labSchema()
	v := verifyOne(t, dev, []FixTarget{
		{Path: cmdbPolicy, Op: FixSet, Attr: "logtraffic", Value: "everything"},
	})
	if v.Status != FixValueUnlisted {
		t.Fatalf("got %q, want %q", v.Status, FixValueUnlisted)
	}
	// And it must say what the device DOES accept, or the reader has a rejection and no way forward.
	if len(v.Options) == 0 {
		t.Error("no options listed beside the rejection")
	}
}

func TestEveryValueInAListIsChecked(t *testing.T) {
	// allowaccess is where one wrong word locks an administrator out, so the list is checked token
	// by token rather than as one string.
	dev := labSchema()
	ok := verifyOne(t, dev, []FixTarget{
		{Path: cmdbInterface, Op: FixSet, Attr: "allowaccess", Value: "ping https ssh", List: true},
	})
	if ok.Status != FixVerified {
		t.Errorf("a list of accepted values: got %q — %s", ok.Status, ok.Detail)
	}

	bad := verifyOne(t, dev, []FixTarget{
		{Path: cmdbInterface, Op: FixSet, Attr: "allowaccess", Value: "ping https radius-acct", List: true},
	})
	if bad.Status != FixValueUnlisted {
		t.Errorf("one bad token in a list: got %q — %s", bad.Status, bad.Detail)
	}
	if !strings.Contains(bad.Detail, "radius-acct") {
		t.Errorf("the reason must name the offending value: %q", bad.Detail)
	}
}

func TestADeleteVerifiesThePathAndClaimsNothingElse(t *testing.T) {
	_, targets := fixDelete(cmdbPolicy, "7")
	v := verifyOne(t, labSchema(), targets)
	if v.Status != FixPathOnly {
		t.Errorf("got %q, want %q", v.Status, FixPathOnly)
	}
	if v.Attr != "" {
		t.Errorf("a delete names no attribute, got %q", v.Attr)
	}
}

func TestAnUnreadableSchemaIsSaidOutLoud(t *testing.T) {
	// Failing open here would make an unverified command look identical to a verified one, which is
	// worse than showing no badge at all.
	dev := labSchema()
	dev.err = map[string]error{cmdbPolicy: errors.New("HTTP 403")}

	_, targets := logTrafficFix(3)
	v := verifyOne(t, dev, targets)
	if v.Status != FixUnreadable {
		t.Fatalf("got %q, want %q", v.Status, FixUnreadable)
	}
	if !strings.Contains(v.Detail, "403") {
		t.Errorf("the device's own reason should survive: %q", v.Detail)
	}
}

func TestEachObjectGetsItsOwnVerdict(t *testing.T) {
	// One verdict per OBJECT, not one per attribute name. It used to collapse all three into one,
	// which read fine as a badge and became wrong the moment these verdicts turned into the list of
	// what an apply writes — three policies need three writes. The UI collapses them for display;
	// the data does not, because the data is what gets sent to the firewall.
	_, one := logTrafficFix(1)
	_, two := logTrafficFix(2)
	_, three := logTrafficFix(3)
	got := VerifyFixTargets(labSchema(), append(append(one, two...), three...))
	if len(got) != 3 {
		t.Fatalf("want one verdict per policy, got %d", len(got))
	}
	keys := map[string]bool{}
	for _, v := range got {
		keys[v.MKey] = true
	}
	for _, want := range []string{"1", "2", "3"} {
		if !keys[want] {
			t.Errorf("no verdict carries policy %s: %+v", want, got)
		}
	}
}

func TestTheSameObjectIsAskedAboutOnce(t *testing.T) {
	// Asking the device twice about the same attribute on the same object is a wasted round trip.
	_, a := logTrafficFix(7)
	_, b := logTrafficFix(7)
	if got := VerifyFixTargets(labSchema(), append(a, b...)); len(got) != 1 {
		t.Errorf("want one verdict for one object, got %d", len(got))
	}
}

func TestTheWorstVerdictWins(t *testing.T) {
	// A step where one attribute is unknown must never show a "verified" badge because the other
	// three were fine.
	worst := SummariseVerification([]FixVerification{
		{Status: FixVerified}, {Status: FixAttrOnly}, {Status: FixAttrUnknown}, {Status: FixVerified},
	})
	if worst != FixAttrUnknown {
		t.Errorf("got %q, want %q", worst, FixAttrUnknown)
	}
	if SummariseVerification(nil) != "" {
		t.Error("no verdicts should summarise to no badge, not to a pass")
	}
}

func TestNoDeviceMeansNoVerdictRatherThanAPass(t *testing.T) {
	_, targets := logTrafficFix(3)
	if got := VerifyFixTargets(nil, targets); got != nil {
		t.Errorf("without a device there is nothing to verify, got %+v", got)
	}
}

// ── The fix builders themselves ──

func TestFixCLIAndTargetsCannotDisagree(t *testing.T) {
	// The reason the builders return both: an attribute in the CLI with no target is an attribute
	// nothing checks, and a target with no CLI is a claim about a command nobody runs.
	cli, targets := noInspectionFix(4)
	for _, tg := range targets {
		found := false
		for _, line := range cli {
			if strings.Contains(line, "set "+tg.Attr+" ") {
				found = true
			}
		}
		if !found {
			t.Errorf("target %q has no line in the CLI: %v", tg.Attr, cli)
		}
	}
	sets := 0
	for _, line := range cli {
		if strings.Contains(line, "set ") {
			sets++
		}
	}
	if sets != len(targets) {
		t.Errorf("%d set lines but %d targets", sets, len(targets))
	}
}

func TestCLIPathRendersTheWayTheCLIWritesIt(t *testing.T) {
	// The CMDB path and the CLI path are different strings, and every fix depends on the difference.
	for cmdb, want := range map[string]string{
		"firewall/policy":         "firewall policy",
		"firewall.service/custom": "firewall service custom",
		"log.syslogd/setting":     "log syslogd setting",
		"system/global":           "system global",
	} {
		if got := cliPath(cmdb); got != want {
			t.Errorf("cliPath(%q) = %q, want %q", cmdb, got, want)
		}
	}
}

func TestEveryFixPathHasVendorDocumentation(t *testing.T) {
	// A command with no schema verdict AND no vendor link is back to "trust us".
	docs := map[string]bool{}
	for _, p := range vendorDocPaths() {
		docs[p] = true
	}
	for _, cmdb := range []string{
		cmdbPolicy, cmdbAddress, cmdbService, cmdbInterface,
		cmdbAdmin, cmdbGlobal, cmdbNTP, cmdbLogSet, cmdbSyslog,
	} {
		if !docs[cmdb] {
			t.Errorf("%s has no entry in vendorDocs — add Fortinet's page for it, and CHECK the URL renders that command", cmdb)
		}
	}
}

func TestVendorDocsAreDeduplicatedAndDescribed(t *testing.T) {
	_, a := logTrafficFix(1)
	_, b := avProfileFix(2)
	_, c := ntpFix()
	got := VendorDocsFor(append(append(a, b...), c...))
	if len(got) != 2 {
		t.Fatalf("two distinct tables should give two links, got %d: %+v", len(got), got)
	}
	for _, d := range got {
		if d.URL == "" || d.Publisher != "Fortinet" || d.Release == "" || d.Command == "" {
			t.Errorf("incomplete vendor doc: %+v", d)
		}
	}
}
