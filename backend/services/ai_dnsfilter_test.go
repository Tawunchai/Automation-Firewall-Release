package services

import (
	"strings"
	"testing"
)

// sanitizeDNSFilterCommands is the last line of defence against the DNS filter's inverted trap:
// FortiOS answers HTTP 200 to `set action allow` on a category filter and stores "block" instead
// (verified live on 7.2.10). An absent entry IS "allow", so an allow entry must be deleted, not
// translated. These tests pin that, plus the surgery's precision — it must not touch anything else.

const dnsProfileWithAllow = `config dnsfilter profile
    edit "DNS-Test"
        set comment "hi"
        config ftgd-dns
            set options error-allow
            config filters
                edit 1
                    set category 1
                    set action block
                next
                edit 2
                    set category 2
                    set action allow
                next
                edit 3
                    set category 3
                    set action monitor
                next
            end
        end
    next
end`

func TestSanitizeDNSFilterCommands_DropsAllowEntries(t *testing.T) {
	out := strings.Join(sanitizeDNSFilterCommands([]string{dnsProfileWithAllow}), "\n")

	if strings.Contains(strings.ToLower(out), "set action allow") {
		t.Fatalf("an allow entry survived — the device would store it as block:\n%s", out)
	}
	// The whole edit…next goes, not just the action line: a category left with no action would be
	// monitored, which is not what "allow" means either.
	if strings.Contains(out, "set category 2") {
		t.Errorf("category 2's entry should be gone entirely (allow = no entry):\n%s", out)
	}
	// Its siblings must survive untouched.
	for _, keep := range []string{"set category 1", "set action block", "set category 3", "set action monitor"} {
		if !strings.Contains(out, keep) {
			t.Errorf("%q was removed but should have been kept:\n%s", keep, out)
		}
	}
	// The block structure must stay valid.
	if !strings.Contains(out, "config filters") || !strings.Contains(out, `edit "DNS-Test"`) {
		t.Errorf("profile structure damaged:\n%s", out)
	}
	if strings.Count(out, "next") != 3 { // 2 surviving entries + the profile's own next
		t.Errorf("next count = %d, want 3 (2 entries + profile):\n%s", strings.Count(out, "next"), out)
	}
}

func TestSanitizeDNSFilterCommands_LeavesCleanConfigIdentical(t *testing.T) {
	clean := []string{`config dnsfilter profile
    edit "DNS-Test"
        config ftgd-dns
            config filters
                edit 1
                    set category 1
                    set action block
                next
            end
        end
    next
end`}
	out := sanitizeDNSFilterCommands(clean)
	if len(out) != 1 || out[0] != clean[0] {
		t.Errorf("a clean profile must be returned byte-identical, got:\n%s", strings.Join(out, "\n"))
	}
}

// The word "allow" is legal in plenty of other places — the surgery must be precise.
func TestSanitizeDNSFilterCommands_DoesNotTouchOtherSections(t *testing.T) {
	cases := []struct {
		name string
		cli  string
	}{
		{
			// The Static Domain Filter table really does take action=allow — different table,
			// no trap. Dropping these would silently delete the user's allow-list.
			name: "domain-filter table allow entries",
			cli: `config dnsfilter domain-filter
    edit 1
        set name "DNS-Test"
        config entries
            edit 1
                set domain "intranet.local"
                set type simple
                set action allow
                set status enable
            next
        end
    next
end`,
		},
		{
			// A web filter's category filter takes a real "allow" — it is a different CMDB path.
			name: "webfilter ftgd-wf allow",
			cli: `config webfilter profile
    edit "WF"
        config ftgd-wf
            config filters
                edit 1
                    set category 1
                    set action allow
                next
            end
        end
    next
end`,
		},
		{
			name: "ftgd-dns options error-allow flag",
			cli: `config dnsfilter profile
    edit "DNS-Test"
        config ftgd-dns
            set options error-allow
        end
    next
end`,
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			out := sanitizeDNSFilterCommands([]string{c.cli})
			if len(out) != 1 || out[0] != c.cli {
				t.Errorf("must be untouched, got:\n%s", strings.Join(out, "\n"))
			}
		})
	}
}

// A dnsfilter profile alongside other sections: only the offending entry may change.
func TestSanitizeDNSFilterCommands_MixedSuggestion(t *testing.T) {
	addr := `config firewall address
    edit "LAN"
        set subnet 10.0.0.0 255.255.255.0
    next
end`
	policy := `config firewall policy
    edit 0
        set name "P1"
        set dnsfilter-profile "DNS-Test"
    next
end`
	out := strings.Join(sanitizeDNSFilterCommands([]string{addr, dnsProfileWithAllow, policy}), "\n")

	if strings.Contains(strings.ToLower(out), "set action allow") {
		t.Error("allow entry survived in a mixed suggestion")
	}
	for _, keep := range []string{`edit "LAN"`, "set subnet 10.0.0.0 255.255.255.0", `set name "P1"`, `set dnsfilter-profile "DNS-Test"`} {
		if !strings.Contains(out, keep) {
			t.Errorf("unrelated section damaged — %q is gone:\n%s", keep, out)
		}
	}
}

func TestSanitizeDNSFilterCommands_NoDNSFilterIsANoOp(t *testing.T) {
	in := []string{`config firewall policy
    edit 0
        set name "P1"
    next
end`}
	out := sanitizeDNSFilterCommands(in)
	if len(out) != 1 || out[0] != in[0] {
		t.Error("a suggestion with no dnsfilter profile must be returned unchanged")
	}
}

func TestSanitizeDNSFilterCommands_EmptyInput(t *testing.T) {
	if out := sanitizeDNSFilterCommands(nil); out != nil {
		t.Errorf("nil in → nil out, got %#v", out)
	}
	if out := sanitizeDNSFilterCommands([]string{}); len(out) != 0 {
		t.Errorf("empty in → empty out, got %#v", out)
	}
}

// Two profiles in one answer (e.g. one per department) — every allow entry goes, in both.
func TestSanitizeDNSFilterCommands_MultipleProfiles(t *testing.T) {
	cli := `config dnsfilter profile
    edit "DNS-A"
        config ftgd-dns
            config filters
                edit 1
                    set category 1
                    set action allow
                next
            end
        end
    next
    edit "DNS-B"
        config ftgd-dns
            config filters
                edit 1
                    set category 5
                    set action allow
                next
                edit 2
                    set category 6
                    set action block
                next
            end
        end
    next
end`
	out := strings.Join(sanitizeDNSFilterCommands([]string{cli}), "\n")
	if strings.Contains(strings.ToLower(out), "set action allow") {
		t.Errorf("an allow entry survived across multiple profiles:\n%s", out)
	}
	if !strings.Contains(out, `edit "DNS-A"`) || !strings.Contains(out, `edit "DNS-B"`) {
		t.Errorf("both profiles must survive:\n%s", out)
	}
	if !strings.Contains(out, "set category 6") {
		t.Errorf("DNS-B's block entry must survive:\n%s", out)
	}
}

// applyDeviceFacts must run this sanitizer even with no device snapshot: the trap is a property of
// FortiOS, not of what happens to be on this particular box, and an unreachable device is exactly
// when we can least afford to deploy an inverted rule.
func TestApplyDeviceFacts_SanitizesDNSFilterWithoutFacts(t *testing.T) {
	s := &ConfigSuggestion{Commands: []string{dnsProfileWithAllow}}
	applyDeviceFacts(s, nil)
	if strings.Contains(strings.ToLower(strings.Join(s.Commands, "\n")), "set action allow") {
		t.Error("allow entry survived when facts was nil")
	}
}

// The prompt is what actually teaches the model; these pin the parts a future edit must not lose.
func TestDNSFilterPromptRules(t *testing.T) {
	p := platformPrompts["fortinet"].CLIReference
	for _, want := range []string{
		"config dnsfilter domain-filter",
		"config dnsfilter profile",
		"set domain-filter-table",
		"NEVER \"allow\"",       // the trap
		"set dnsfilter-profile", // how it attaches to a policy
	} {
		if !strings.Contains(p, want) {
			t.Errorf("CLI reference no longer mentions %q — the model needs it", want)
		}
	}

	// The engine-choice rule must offer DNS Filter, or "block X at DNS" lands on the wrong engine.
	if !strings.Contains(objectReuseConditions, "DNS FILTER") {
		t.Error("objectReuseConditions rule 8 no longer offers the DNS Filter engine")
	}
	if !strings.Contains(objectReuseConditions, "THREE valid engines") {
		t.Error("rule 8 no longer says there are three engines")
	}
}
