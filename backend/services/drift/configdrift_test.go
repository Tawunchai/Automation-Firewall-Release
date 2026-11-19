package drift

import (
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

const driftBefore = `config firewall address
    edit "web-servers"
        set subnet 10.0.0.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set name "allow-web"
        set action accept
    next
end`

// Three things happened: an address was edited, a brand-new address appeared, and a policy's
// action was flipped.
const driftAfter = `config firewall address
    edit "web-servers"
        set subnet 10.0.9.0 255.255.255.0
    next
    edit "sneaky-backdoor"
        set subnet 203.0.113.0 255.255.255.0
    next
end
config firewall policy
    edit 1
        set name "allow-web"
        set action deny
    next
end`

func ledgerRow(path, key, action, who string, at time.Time) entity.ChangeRecord {
	r := entity.ChangeRecord{
		CMDBPath:    path,
		ResourceKey: key,
		Action:      action,
		Status:      entity.ChangeStatusApplied,
		UserEmail:   who,
	}
	r.CreatedAt = at
	return r
}

func findChange(t *testing.T, rep DriftReport, key string) DriftChange {
	t.Helper()
	for _, c := range rep.Changes {
		if c.Key == key {
			return c
		}
	}
	t.Fatalf("no change reported for %q; got %d changes", key, len(rep.Changes))
	return DriftChange{}
}

// With no ledger coverage at all, everything is drift. That is the correct answer, not a bug:
// the console cannot account for any of it.
func TestAnalyseConfigDrift_NoLedgerMeansAllDrift(t *testing.T) {
	rep := AnalyseConfigDrift(driftBefore, driftAfter, nil)

	if len(rep.Changes) != 3 {
		t.Fatalf("changes = %d, want 3 (web-servers, sneaky-backdoor, policy 1): %+v", len(rep.Changes), rep.Changes)
	}
	if rep.Drift != 3 || rep.Attributed != 0 {
		t.Errorf("drift=%d attributed=%d, want 3/0", rep.Drift, rep.Attributed)
	}
	if !rep.HasDrift() {
		t.Error("HasDrift() false with three unattributed changes")
	}
}

// The point of the whole feature: our own changes are subtracted, and what is left is the
// unaccounted-for one.
func TestAnalyseConfigDrift_SubtractsWhatTheConsoleDid(t *testing.T) {
	now := time.Now()
	records := []entity.ChangeRecord{
		ledgerRow("/api/v2/cmdb/firewall/address", "web-servers", "update", "alice@got.co.th", now),
		ledgerRow("/api/v2/cmdb/firewall/policy", "1", "update", "bob@got.co.th", now),
	}

	rep := AnalyseConfigDrift(driftBefore, driftAfter, records)

	if rep.Attributed != 2 || rep.Drift != 1 {
		t.Fatalf("attributed=%d drift=%d, want 2/1: %+v", rep.Attributed, rep.Drift, rep.Changes)
	}

	sneaky := findChange(t, rep, "sneaky-backdoor")
	if sneaky.Attributed {
		t.Error("the change nobody made through the console was attributed")
	}
	if sneaky.Action != DriftActionCreated {
		t.Errorf("sneaky-backdoor action = %q, want created", sneaky.Action)
	}

	web := findChange(t, rep, "web-servers")
	if !web.Attributed {
		t.Error("a change alice made through the console was reported as drift")
	}
	if web.AttributedTo == "" {
		t.Error("attributed change does not name who did it")
	}

	// Drift sorts first — the reason anyone opened the page.
	if rep.Changes[0].Attributed {
		t.Error("attributed changes sorted above the drift finding")
	}
}

// The CLI writes `config firewall address`; the ledger stores `/api/v2/cmdb/firewall/address`.
// If those two notations do not meet, nothing is ever attributed and every backup screams.
func TestCanonicalCMDBPath_JoinsTheTwoNotations(t *testing.T) {
	cases := []struct{ in, want string }{
		{"firewall address", "firewall/address"},
		{"/api/v2/cmdb/firewall/address", "firewall/address"},
		{"firewall/address", "firewall/address"},
		{"/api/v2/cmdb/firewall.schedule/recurring", "firewall/schedule/recurring"},
		{"firewall schedule recurring", "firewall/schedule/recurring"},
		{"/api/v2/cmdb/ips/sensor", "ips/sensor"},
		{"ips sensor", "ips/sensor"},
		{"/api/v2/cmdb/firewall/ssl-ssh-profile", "firewall/ssl-ssh-profile"},
		{"firewall ssl-ssh-profile", "firewall/ssl-ssh-profile"},
		{"", ""},
	}
	for _, tc := range cases {
		if got := canonicalCMDBPath(tc.in); got != tc.want {
			t.Errorf("canonicalCMDBPath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// A ledger row for a DIFFERENT object in the same table must not excuse this one — that would be
// the feature quietly excusing the very thing it exists to catch.
func TestAnalyseConfigDrift_AnotherObjectDoesNotExcuseThisOne(t *testing.T) {
	records := []entity.ChangeRecord{
		ledgerRow("/api/v2/cmdb/firewall/address", "some-other-address", "create", "alice@got.co.th", time.Now()),
	}
	rep := AnalyseConfigDrift(driftBefore, driftAfter, records)

	if c := findChange(t, rep, "sneaky-backdoor"); c.Attributed {
		t.Error("a ledger row naming a different address attributed the drift finding")
	}
	if c := findChange(t, rep, "web-servers"); c.Attributed {
		t.Error("a ledger row naming a different address attributed web-servers")
	}
}

// A write that FAILED did not change the device, so it must not absorb a real finding.
func TestAnalyseConfigDrift_FailedLedgerRowsAttributeNothing(t *testing.T) {
	failed := ledgerRow("/api/v2/cmdb/firewall/address", "sneaky-backdoor", "create", "alice@got.co.th", time.Now())
	failed.Status = entity.ChangeStatusFailed

	rep := AnalyseConfigDrift(driftBefore, driftAfter, []entity.ChangeRecord{failed})
	if c := findChange(t, rep, "sneaky-backdoor"); c.Attributed {
		t.Error("a FAILED ledger row was allowed to account for a change that is on the device")
	}
}

// A keyless ledger row (a reorder, a bulk write) covers its table — deliberately, because a false
// drift alarm is what gets an alerting feature turned off.
func TestAnalyseConfigDrift_KeylessLedgerRowCoversItsTable(t *testing.T) {
	records := []entity.ChangeRecord{
		ledgerRow("/api/v2/cmdb/firewall/policy", "", "update", "bob@got.co.th", time.Now()),
	}
	rep := AnalyseConfigDrift(driftBefore, driftAfter, records)

	if c := findChange(t, rep, "1"); !c.Attributed {
		t.Error("a keyless ledger row did not cover the policy change in its own table")
	}
	// …but it must not leak into a different table.
	if c := findChange(t, rep, "sneaky-backdoor"); c.Attributed {
		t.Error("a keyless firewall/policy row attributed a firewall/address change")
	}
}

func TestAnalyseConfigDrift_IdenticalConfigsAreClean(t *testing.T) {
	rep := AnalyseConfigDrift(driftBefore, driftBefore, nil)
	if len(rep.Changes) != 0 || rep.HasDrift() {
		t.Errorf("identical configs produced %d changes", len(rep.Changes))
	}
	if rep.Summary() != "no configuration change" {
		t.Errorf("Summary() = %q", rep.Summary())
	}
}

// Deletions have to be detected too — an object disappearing is the change most worth catching.
func TestAnalyseConfigDrift_DetectsDeletion(t *testing.T) {
	rep := AnalyseConfigDrift(driftAfter, driftBefore, nil)
	c := findChange(t, rep, "sneaky-backdoor")
	if c.Action != DriftActionDeleted {
		t.Errorf("action = %q, want deleted", c.Action)
	}
}

// Lines the device rewrites by itself must never raise an alert — one nightly false alarm is
// enough for people to stop reading them.
func TestAnalyseConfigDrift_IgnoresSelfWritingLines(t *testing.T) {
	before := "config ips sensor\n    edit \"default\"\n        set last-modified 111111\n    next\nend"
	after := "config ips sensor\n    edit \"default\"\n        set last-modified 999999\n    next\nend"

	rep := AnalyseConfigDrift(before, after, nil)
	if rep.HasDrift() {
		t.Errorf("a self-updating timestamp raised drift: %+v", rep.Changes)
	}
}

func TestLedgerWindowFor_PadsBothEnds(t *testing.T) {
	prev := time.Date(2026, 9, 1, 2, 0, 0, 0, time.UTC)
	curr := prev.Add(24 * time.Hour)
	from, to := LedgerWindowFor(prev, curr)

	if !from.Before(prev) || !to.After(curr) {
		t.Errorf("window [%v, %v] does not enclose [%v, %v]", from, to, prev, curr)
	}
	if prev.Sub(from) != DriftLedgerWindow || to.Sub(curr) != DriftLedgerWindow {
		t.Error("window padding is not symmetric")
	}
}

// ── The false-positive that nearly made the feature useless ─────────────────
//
// First live run: 29 findings for two real changes. The other 27 were all re-encrypted secrets.
// FortiOS re-salts every stored secret on every export, so two exports of an UNCHANGED
// configuration disagree on every ENC blob and every certificate body.

func TestIsEncryptedSecretLine(t *testing.T) {
	noise := []string{
		`    set password ENC ToNI5aRPHBfyuFxsnUQ9cbne3o3aCf9zdK7CBQJqN84JZlnMyTjmeXBLPGLszS==`,
		`        set passwd1 ENC 5VOirS0gxx8nv2cnT4C3HC1hjSkiNMPLh9+cQLZbxjczyGXYABm4u2UDK9==`,
		`    set auth-password-l1 ENC oesqUerovchecwHqAbrF57uIGTzJisDaGANu7BiaMDYCfgpryP9LqUpX==`,
		`    set proxy-password ENC vn1GP+K7cAZY+gvsXeZ7q7GQNen73X1+O9wzfZpFM0ppN0s0NkZurTh/Jn==`,
		`    set ppk-secret ENC gHsAjD0fKogqGOAGnECLQX1E/zcv43h8WB/7B61C1PusXhZ6zUTGivQhKb==`,
		// The base64 body of a certificate or key — a continuation line, no keyword.
		`MIIFHDBOBgkqhkiG9w0BBQ0wQTApBgkqhkiG9w0BBQwwHAQIhlI7WgIjKngCAggA`,
		`        MAwGCCqGSIb3DQIJBQAwFAYIKoZIhvcNAwcECOO7eziDCLdzBIIEyApD7DUBoToe`,
	}
	for _, l := range noise {
		if !isEncryptedSecretLine(l) {
			t.Errorf("not recognised as an unComparable secret: %q", l)
		}
	}

	real := []string{
		`    set subnet 203.0.113.0 255.255.255.0`,
		`        set comment "added over SSH"`,
		`    edit "sneaky-backdoor"`,
		`    next`,
		`end`,
		`config firewall address`,
		// A password field WITHOUT the ENC marker is a plaintext change and must be reported.
		`    set password mySecret123`,
		// Short unkeyworded fragments are left alone rather than swallowed.
		`    someshortthing`,
	}
	for _, l := range real {
		if isEncryptedSecretLine(l) {
			t.Errorf("a real configuration line was dropped as a secret: %q", l)
		}
	}
}

// Two exports of a configuration nobody touched must be CLEAN, even though every ENC blob differs.
func TestAnalyseConfigDrift_ReEncryptedSecretsAreNotDrift(t *testing.T) {
	before := `config vpn certificate local
    edit "Fortinet_CA_SSL"
        set password ENC AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
        set certificate "-----BEGIN CERTIFICATE-----
MIIFHDBOBgkqhkiG9w0BBQ0wQTApBgkqhkiG9w0BBQwwHAQIhlI7WgIjKngCAggA
-----END CERTIFICATE-----"
    next
end`
	after := `config vpn certificate local
    edit "Fortinet_CA_SSL"
        set password ENC BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
        set certificate "-----BEGIN CERTIFICATE-----
MAwGCCqGSIb3DQIJBQAwFAYIKoZIhvcNAwcECOO7eziDCLdzBIIEyApD7DUBoToe
-----END CERTIFICATE-----"
    next
end`

	rep := AnalyseConfigDrift(before, after, nil)
	if rep.HasDrift() {
		t.Errorf("re-encrypted secrets reported as drift — the feature would alert every night:\n%+v", rep.Changes)
	}
	if rep.SecretsChanged == 0 {
		t.Error("secrets were dropped silently; the run must disclose that it could not compare them")
	}
	if !strings.Contains(rep.Summary(), "cannot be compared") {
		t.Errorf("summary hides the blind spot: %q", rep.Summary())
	}
}

// The blind spot must not swallow a real change that happens to sit next to a secret.
func TestAnalyseConfigDrift_RealChangeBesideASecretIsStillReported(t *testing.T) {
	before := `config system admin
    edit "admin"
        set password ENC AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
        set trusthost1 10.0.0.0 255.255.255.0
    next
end`
	after := `config system admin
    edit "admin"
        set password ENC BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB
        set trusthost1 0.0.0.0 0.0.0.0
    next
end`

	rep := AnalyseConfigDrift(before, after, nil)
	if !rep.HasDrift() {
		t.Fatal("a trusted-host widened to the whole internet was not reported")
	}
	c := findChange(t, rep, "admin")
	joined := strings.Join(append(c.Added, c.Removed...), "\n")
	if !strings.Contains(joined, "trusthost1") {
		t.Errorf("finding does not contain the real change: %q", joined)
	}
	if strings.Contains(joined, "ENC") {
		t.Errorf("finding still carries the uncomparable ENC line: %q", joined)
	}
}

// The tail of a base64 blob is short by definition. Missing that left one false positive on the
// live run — the last twelve characters of a certificate.
func TestIsEncryptedSecretLine_ShortBase64TailWithPadding(t *testing.T) {
	tails := []string{
		`40H/kAtMGhQ=`,
		`        pKFL9FSSGQ0=`,
		`    abcd="`,
	}
	for _, l := range tails {
		if !isEncryptedSecretLine(l) {
			t.Errorf("blob tail not recognised: %q", l)
		}
	}
	// …but a short line with no padding and no keyword is still left alone.
	if isEncryptedSecretLine("    someshortthing") {
		t.Error("an unpadded short fragment was swallowed")
	}
}
