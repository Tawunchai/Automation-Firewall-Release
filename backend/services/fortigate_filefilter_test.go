package services

import (
	"encoding/json"
	"strings"
	"testing"
)

// Pinned to behaviour VERIFIED against the lab FortiGate (80E, FortiOS 7.2.10):
//   GUI "Monitor"  == CMDB "log-only"
//   GUI "Both"     == CMDB "any"
//   rule with no file-type  ⇒ -61 "file-type must be set"
//   rule with empty protocol ⇒ device stores "http ftp smtp imap pop3 cifs"
//   direction on a mail-only rule ⇒ silently forced to "any" (200 OK)

func ffRule(over func(*FileFilterRule)) FileFilterRule {
	r := FileFilterRule{
		Name: "r1", Comment: "c",
		Protocols: []string{"http", "ftp"},
		Direction: "outgoing", PasswordProtected: false,
		FileTypes: []string{"exe"}, Action: "block",
	}
	if over != nil {
		over(&r)
	}
	return r
}

func firstRule(t *testing.T, p map[string]interface{}) map[string]interface{} {
	t.Helper()
	rules, ok := p["rules"].([]map[string]interface{})
	if !ok || len(rules) == 0 {
		t.Fatalf("no rules in payload: %#v", p["rules"])
	}
	return rules[0]
}

func TestFileFilterProfilePayload_Profile(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff1", Comment: "hello", ScanArchiveContents: true,
	})
	if p["name"] != "ff1" || p["comment"] != "hello" {
		t.Errorf("name/comment = %v/%v", p["name"], p["comment"])
	}
	if p["scan-archive-contents"] != "enable" {
		t.Errorf("scan-archive-contents = %v, want enable", p["scan-archive-contents"])
	}
	// The GUI page builds flow-mode profiles; the field isn't in the form so it must be pinned.
	if p["feature-set"] != "flow" {
		t.Errorf("feature-set = %v, want flow", p["feature-set"])
	}
	// A profile with no rules is legal on the device (verified).
	if rules, ok := p["rules"].([]map[string]interface{}); !ok || len(rules) != 0 {
		t.Errorf("rules = %#v, want an empty slice", p["rules"])
	}
}

func TestFileFilterProfilePayload_ScanArchiveOff(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{Name: "ff1"})
	if p["scan-archive-contents"] != "disable" {
		t.Errorf("scan-archive-contents = %v, want disable", p["scan-archive-contents"])
	}
}

// GUI "Monitor" is CMDB "log-only" — the mapping that silently breaks the rule if inverted.
func TestFileFilterProfilePayload_ActionMonitorIsLogOnly(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) { r.Action = "monitor" })},
	})
	if got := firstRule(t, p)["action"]; got != "log-only" {
		t.Errorf("action = %v, want log-only", got)
	}

	p2 := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) { r.Action = "BLOCK" })},
	})
	if got := firstRule(t, p2)["action"]; got != "block" {
		t.Errorf("action = %v, want block", got)
	}

	// Anything unrecognised falls back to the safe, non-blocking action.
	p3 := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) { r.Action = "" })},
	})
	if got := firstRule(t, p3)["action"]; got != "log-only" {
		t.Errorf("action = %v, want log-only", got)
	}
}

func TestFileFilterProfilePayload_RuleFields(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) {
			r.PasswordProtected = true
			r.FileTypes = []string{"zip", "7z"}
		})},
	})
	r := firstRule(t, p)
	if r["name"] != "r1" || r["comment"] != "c" {
		t.Errorf("name/comment = %v/%v", r["name"], r["comment"])
	}
	if r["protocol"] != "http ftp" {
		t.Errorf("protocol = %v, want the space-joined flag string", r["protocol"])
	}
	if r["password-protected"] != "yes" {
		t.Errorf("password-protected = %v, want yes", r["password-protected"])
	}
	fts, ok := r["file-type"].([]map[string]interface{})
	if !ok || len(fts) != 2 || fts[0]["name"] != "zip" || fts[1]["name"] != "7z" {
		t.Errorf("file-type = %#v, want a [{name}] member table", r["file-type"])
	}
}

func TestFileFilterProfilePayload_PasswordProtectedOffIsAny(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{ffRule(nil)}})
	if got := firstRule(t, p)["password-protected"]; got != "any" {
		t.Errorf("password-protected = %v, want any", got)
	}
}

// The device rejects a rule with no file types (-61) and one with no name, so they never ship.
func TestFileFilterProfilePayload_SkipsInvalidRules(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
		ffRule(func(r *FileFilterRule) { r.Name = "  " }),     // no name
		ffRule(func(r *FileFilterRule) { r.FileTypes = nil }), // -61 file-type must be set
		ffRule(func(r *FileFilterRule) { r.Name = "keep" }),   // fine
	}})
	rules := p["rules"].([]map[string]interface{})
	if len(rules) != 1 || rules[0]["name"] != "keep" {
		t.Errorf("rules = %#v, want only the valid one", rules)
	}
}

// An empty protocol list becomes what the device itself defaults to (verified live).
func TestFileFilterProfilePayload_EmptyProtocolFallsBackToDeviceDefault(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) { r.Protocols = nil })},
	})
	if got := firstRule(t, p)["protocol"]; got != defaultFileFilterProtocols {
		t.Errorf("protocol = %v, want %q", got, defaultFileFilterProtocols)
	}
}

// ⚠️ THE DIRECTION GOTCHA. Schema: "Traffic direction (HTTP, FTP, SSH, CIFS only)." Verified
// live: a mail-only rule has its direction forced to "any" while the device answers 200 OK.
func TestFileFilterDirectionApplies(t *testing.T) {
	on := [][]string{
		{"http"}, {"ftp"}, {"ssh"}, {"cifs"},
		{"http", "smtp"}, // one direction-capable protocol is enough
		{"SMTP", "HTTP"}, // case-insensitive
		{" ftp "},        // padded
	}
	for _, ps := range on {
		if !fileFilterDirectionApplies(ps) {
			t.Errorf("fileFilterDirectionApplies(%v) = false, want true", ps)
		}
	}
	off := [][]string{
		{}, {"smtp"}, {"imap"}, {"pop3"}, {"mapi"},
		{"smtp", "imap", "pop3"}, // mail only ⇒ the device forces "any"
	}
	for _, ps := range off {
		if fileFilterDirectionApplies(ps) {
			t.Errorf("fileFilterDirectionApplies(%v) = true, want false", ps)
		}
	}
}

func TestNormalizeFileFilterDirection(t *testing.T) {
	cases := []struct {
		name      string
		dir       string
		protocols []string
		want      string
	}{
		{"outgoing sticks on http", "outgoing", []string{"http"}, "outgoing"},
		{"incoming sticks on cifs", "incoming", []string{"cifs"}, "incoming"},
		{"sticks when mixed with mail", "outgoing", []string{"http", "smtp"}, "outgoing"},
		// The device would force these to "any" anyway — say so up front.
		{"mail-only forces any", "outgoing", []string{"smtp"}, "any"},
		{"mail-only incoming forces any", "incoming", []string{"smtp", "imap", "pop3"}, "any"},
		{"explicit any stays any", "any", []string{"http"}, "any"},
		{"garbage becomes any", "sideways", []string{"http"}, "any"},
		{"blank becomes any", "", []string{"http"}, "any"},
		// Empty protocols ⇒ the device default (http ftp …) applies, so direction still counts.
		{"empty protocols keep the direction", "outgoing", nil, "outgoing"},
		{"case-insensitive", "OUTGOING", []string{"HTTP"}, "outgoing"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := normalizeFileFilterDirection(c.dir, c.protocols); got != c.want {
				t.Errorf("normalizeFileFilterDirection(%q,%v) = %q, want %q", c.dir, c.protocols, got, c.want)
			}
		})
	}
}

func TestFileFilterProfilePayload_MailOnlyRuleDropsDirection(t *testing.T) {
	p := fileFilterProfilePayload(FileFilterProfileForm{
		Name: "ff", Rules: []FileFilterRule{ffRule(func(r *FileFilterRule) {
			r.Protocols = []string{"smtp"}
			r.Direction = "outgoing"
		})},
	})
	if got := firstRule(t, p)["direction"]; got != "any" {
		t.Errorf("direction = %v, want any — the device forces it for a mail-only rule", got)
	}
}

// ⚠️ THE PASSWORD-PROTECTED GOTCHA. The schema says file-type's datasource is
// antivirus.filetype.name (all 56 types), but with password-protected=yes the device narrows it
// at runtime to the formats that can carry a password. Verified live by trying all 56: these 6
// pass, the other 50 return "-3 entry not found in datasource".
func TestInvalidPasswordProtectedFileTypes(t *testing.T) {
	// Every allowed type is accepted.
	for _, ok := range []string{"7z", "msoffice", "msofficex", "pdf", "rar", "zip"} {
		if bad := invalidPasswordProtectedFileTypes([]string{ok}); len(bad) != 0 {
			t.Errorf("%q reported invalid, want allowed", ok)
		}
	}
	// A representative sample of the 50 that fail on the device.
	for _, no := range []string{"exe", "bat", "elf", "gif", "tar", "gzip", "iso", "msi"} {
		if bad := invalidPasswordProtectedFileTypes([]string{no}); len(bad) != 1 || bad[0] != no {
			t.Errorf("%q reported valid, want rejected", no)
		}
	}
	// Mixed: only the offenders come back, so the message can name them.
	bad := invalidPasswordProtectedFileTypes([]string{"zip", "exe", "7z", "bat"})
	if len(bad) != 2 || bad[0] != "exe" || bad[1] != "bat" {
		t.Errorf("bad = %v, want [exe bat]", bad)
	}
	if got := invalidPasswordProtectedFileTypes([]string{"ZIP", " pdf "}); len(got) != 0 {
		t.Errorf("case/padding should not matter, got %v", got)
	}
	if got := invalidPasswordProtectedFileTypes(nil); len(got) != 0 {
		t.Errorf("empty list = %v, want none", got)
	}
}

func TestFileFilterPasswordProtectedTypes_IsACopy(t *testing.T) {
	got := passwordProtectedFileTypes()
	if len(got) != 6 {
		t.Fatalf("got %d types, want the 6 verified live", len(got))
	}
	got[0] = "hacked"
	if passwordProtectedFileTypes()[0] == "hacked" {
		t.Error("callers must not be able to mutate the package's list")
	}
}

func TestValidateFileFilterForm(t *testing.T) {
	cases := []struct {
		name    string
		form    FileFilterProfileForm
		wantSub string // "" = expect no error
	}{
		{"no rules is fine", FileFilterProfileForm{Name: "ff"}, ""},
		{"plain rule", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{ffRule(nil)}}, ""},
		{"password-protected with archives", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.PasswordProtected = true; r.FileTypes = []string{"zip", "7z"} }),
		}}, ""},
		{"rule needs a name", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.Name = "  " }),
		}}, "needs a name"},
		// The device answers -61 here.
		{"rule needs a file type", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.FileTypes = nil }),
		}}, "at least one file type"},
		// The device answers -3 here; the message must name the offender.
		{"password-protected with exe", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.PasswordProtected = true; r.FileTypes = []string{"exe"} }),
		}}, "remove exe"},
		{"password-protected mixed", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.PasswordProtected = true; r.FileTypes = []string{"zip", "exe"} }),
		}}, "remove exe"},
		// The same types are fine as long as the toggle is off.
		{"exe without the toggle", FileFilterProfileForm{Name: "ff", Rules: []FileFilterRule{
			ffRule(func(r *FileFilterRule) { r.PasswordProtected = false; r.FileTypes = []string{"exe"} }),
		}}, ""},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateFileFilterForm(tc.form)
			if tc.wantSub == "" {
				if err != nil {
					t.Errorf("unexpected error: %v", err)
				}
				return
			}
			if err == nil {
				t.Fatalf("expected an error containing %q, got nil", tc.wantSub)
			}
			if !strings.Contains(err.Error(), tc.wantSub) {
				t.Errorf("error = %q, want it to contain %q", err.Error(), tc.wantSub)
			}
		})
	}
}

// The profile name is checked by the handlers (create) or taken from the URL (update), so the
// validator must not reject a body that legitimately omits it.
func TestValidateFileFilterForm_IgnoresProfileName(t *testing.T) {
	if err := ValidateFileFilterForm(FileFilterProfileForm{Rules: []FileFilterRule{ffRule(nil)}}); err != nil {
		t.Errorf("unexpected error for a nameless body: %v", err)
	}
}

func TestFgToFileFilterProfileForm(t *testing.T) {
	raw := json.RawMessage(`{
      "name":"ff1","comment":"hello","scan-archive-contents":"enable",
      "rules":[
        {"name":"r1","comment":"c1","protocol":"http ftp","action":"log-only","direction":"incoming",
         "password-protected":"yes","file-type":[{"name":"zip"},{"name":"7z"}]},
        {"name":"r2","comment":"","protocol":"smtp","action":"block","direction":"any",
         "password-protected":"any","file-type":[{"name":"exe"}]}
      ]}`)

	form := fgToFileFilterProfileForm(raw)
	if form.Name != "ff1" || form.Comment != "hello" || !form.ScanArchiveContents {
		t.Fatalf("profile = %+v", form)
	}
	if len(form.Rules) != 2 {
		t.Fatalf("rules = %d, want 2", len(form.Rules))
	}

	r1 := form.Rules[0]
	// log-only must read back as the GUI's "Monitor".
	if r1.Action != "monitor" {
		t.Errorf("rule1 action = %q, want monitor", r1.Action)
	}
	if len(r1.Protocols) != 2 || r1.Protocols[0] != "http" || r1.Protocols[1] != "ftp" {
		t.Errorf("rule1 protocols = %v, want the flag string split", r1.Protocols)
	}
	if r1.Direction != "incoming" || !r1.PasswordProtected {
		t.Errorf("rule1 direction/pw = %q/%v", r1.Direction, r1.PasswordProtected)
	}
	if len(r1.FileTypes) != 2 || r1.FileTypes[0] != "zip" {
		t.Errorf("rule1 file types = %v", r1.FileTypes)
	}

	r2 := form.Rules[1]
	if r2.Action != "block" || r2.Direction != "any" || r2.PasswordProtected {
		t.Errorf("rule2 = %+v", r2)
	}
}

func TestFgToFileFilterProfileForm_Defaults(t *testing.T) {
	form := fgToFileFilterProfileForm(json.RawMessage(`{
      "name":"ff","scan-archive-contents":"disable",
      "rules":[{"name":"r","protocol":"","action":"","direction":"","password-protected":"","file-type":[]}]}`))
	if form.ScanArchiveContents {
		t.Error("scan-archive-contents should be false for \"disable\"")
	}
	r := form.Rules[0]
	if r.Direction != "any" {
		t.Errorf("direction = %q, want any", r.Direction)
	}
	if r.Action != "monitor" {
		t.Errorf("action = %q, want monitor", r.Action)
	}
	if len(r.Protocols) != 0 {
		t.Errorf("protocols = %v, want empty", r.Protocols)
	}
}

func TestFgToFileFilterProfileForm_BadJSON(t *testing.T) {
	if got := fgToFileFilterProfileForm(json.RawMessage(`not json`)); got.Name != "" || len(got.Rules) != 0 {
		t.Errorf("bad JSON should yield the zero form, got %+v", got)
	}
}

// device → form → payload must not drift.
func TestFileFilterRoundTrip(t *testing.T) {
	raw := json.RawMessage(`{
      "name":"ff1","comment":"hello","scan-archive-contents":"enable",
      "rules":[{"name":"r1","comment":"c1","protocol":"http ftp","action":"log-only","direction":"incoming",
                "password-protected":"yes","file-type":[{"name":"zip"}]}]}`)

	p := fileFilterProfilePayload(fgToFileFilterProfileForm(raw))
	if p["name"] != "ff1" || p["scan-archive-contents"] != "enable" {
		t.Errorf("profile drifted: %v", p)
	}
	r := firstRule(t, p)
	want := map[string]interface{}{
		"name": "r1", "comment": "c1", "protocol": "http ftp",
		"action": "log-only", "direction": "incoming", "password-protected": "yes",
	}
	for k, v := range want {
		if r[k] != v {
			t.Errorf("rule %s = %v, want %v", k, r[k], v)
		}
	}
}
