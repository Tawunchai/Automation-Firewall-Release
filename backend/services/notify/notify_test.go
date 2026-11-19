package notify

import (
	"strings"
	"testing"
	"time"

	"network_automation/entity"
)

// Notify Management — the decision logic.
//
// These are the tests that matter most in the feature, because the thing they guard cannot be
// reproduced on demand against a real firewall: you cannot ask a lab FortiGate to peg its CPU for
// three minutes, drop a port for one poll and bring it back, and then do it again with a different
// cooldown. Everything here is the pure half (notify.go), driven with a fabricated clock.

func ruleFor(kind string, threshold float64) entity.NotifyRule {
	return entity.NotifyRule{
		Name: "test", Kind: kind, Enabled: true, Threshold: threshold,
		SustainedPolls: 2, CooldownMinutes: 30, NotifyOnResolve: true,
		Severity: entity.NotifySeverityWarning,
	}
}

// ── the catalogue ────────────────────────────────────────────────────────────

func TestNotifyKinds_AreSelfConsistent(t *testing.T) {
	seen := map[string]bool{}
	for _, k := range NotifyKinds {
		if seen[k.Kind] {
			t.Errorf("duplicate kind %q", k.Kind)
		}
		seen[k.Kind] = true

		if k.Title == "" || k.Description == "" {
			t.Errorf("%q has no title or description — the picker would render a blank card", k.Kind)
		}
		if !IsValidNotifySeverity(k.DefaultSeverity) {
			t.Errorf("%q defaults to severity %q, which the UI cannot colour", k.Kind, k.DefaultSeverity)
		}
		if k.HasThreshold {
			if k.ThresholdUnit == "" {
				t.Errorf("%q takes a threshold with no unit — the form would ask for a bare number", k.Kind)
			}
			if k.ThresholdDefault < k.ThresholdMin || k.ThresholdDefault > k.ThresholdMax {
				t.Errorf("%q default %v sits outside its own [%v, %v] range",
					k.Kind, k.ThresholdDefault, k.ThresholdMin, k.ThresholdMax)
			}
		}
	}
	if !isValidNotifyKind(entity.NotifyKindCPUPeak) || isValidNotifyKind("everything-alert") {
		t.Errorf("isValidNotifyKind does not agree with the catalogue")
	}
}

// ── evaluation ───────────────────────────────────────────────────────────────

func TestEvaluateNotifyRule_CPUThreshold(t *testing.T) {
	rule := ruleFor(entity.NotifyKindCPUPeak, 85)

	over := EvaluateNotifyRule(rule, NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 91})
	if len(over) != 1 || !over[0].Breaching {
		t.Fatalf("91%% against an 85%% threshold did not breach: %+v", over)
	}
	if !strings.Contains(over[0].Detail, "91%") || !strings.Contains(over[0].Detail, "85%") {
		t.Errorf("the detail should quote both the reading and the threshold: %q", over[0].Detail)
	}

	// The comparison is >=, so a reading exactly ON the threshold fires. "Alert at 85%" that stays
	// silent at 85% is the kind of off-by-one nobody discovers until it matters.
	at := EvaluateNotifyRule(rule, NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 85})
	if len(at) != 1 || !at[0].Breaching {
		t.Errorf("a reading exactly at the threshold must breach")
	}

	under := EvaluateNotifyRule(rule, NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 84.9})
	if len(under) != 1 || under[0].Breaching {
		t.Errorf("84.9%% against an 85%% threshold must not breach")
	}
}

// The single most dangerous shape in the whole feature: a device that did not answer must produce
// NO signal, not a healthy one. A healthy signal would clear a live alert on the strength of no
// data — the firewall would go down and its CPU alert would report "resolved".
func TestEvaluateNotifyRule_MissingReadingIsSilentNotHealthy(t *testing.T) {
	for _, kind := range []string{
		entity.NotifyKindCPUPeak, entity.NotifyKindMemoryPeak,
		entity.NotifyKindDiskUsage, entity.NotifyKindSessionSpike,
	} {
		t.Run(kind, func(t *testing.T) {
			// Reachable, but the monitor endpoint answered nothing for this metric.
			got := EvaluateNotifyRule(ruleFor(kind, 50), NotifyProbe{Reachable: true})
			if len(got) != 0 {
				t.Errorf("a missing reading produced %d signal(s), want none: %+v", len(got), got)
			}
		})
	}
}

// Same rule, from the other direction: when the device is unreachable, every threshold rule stands
// down and only the unreachable rule speaks.
func TestEvaluateNotifyRule_UnreachableSilencesEverythingElse(t *testing.T) {
	probe := NotifyProbe{Reachable: false, Error: "connection refused"}

	if got := EvaluateNotifyRule(ruleFor(entity.NotifyKindCPUPeak, 85), probe); len(got) != 0 {
		t.Errorf("a CPU rule spoke about an unreachable device: %+v", got)
	}
	if got := EvaluateNotifyRule(ruleFor(entity.NotifyKindInterfaceLink, 0), probe); len(got) != 0 {
		t.Errorf("a port rule spoke about an unreachable device: %+v", got)
	}

	got := EvaluateNotifyRule(ruleFor(entity.NotifyKindDeviceUnreachable, 0), probe)
	if len(got) != 1 || !got[0].Breaching {
		t.Fatalf("the unreachable rule did not fire: %+v", got)
	}
	if !strings.Contains(got[0].Detail, "connection refused") {
		t.Errorf("the reason the device could not be reached was dropped: %q", got[0].Detail)
	}
}

func TestEvaluateNotifyRule_InterfaceLink(t *testing.T) {
	probe := NotifyProbe{Reachable: true, Interfaces: []NotifyInterfaceState{
		{Name: "port1", Alias: "WAN", Up: true, Speed: 1000},
		{Name: "port2", Up: false},
		{Name: "port3", Up: true, Speed: 100},
	}}

	all := EvaluateNotifyRule(ruleFor(entity.NotifyKindInterfaceLink, 0), probe)
	if len(all) != 3 {
		t.Fatalf("got %d signals for 3 ports", len(all))
	}
	breaching := map[string]bool{}
	for _, s := range all {
		breaching[s.Subject] = s.Breaching
	}
	if breaching["port1"] || !breaching["port2"] || breaching["port3"] {
		t.Errorf("wrong ports flagged: %+v", breaching)
	}
	if all[0].Label != "port1 (WAN)" {
		t.Errorf("the alias should appear in the label: %q", all[0].Label)
	}

	// Narrowed to named ports.
	rule := ruleFor(entity.NotifyKindInterfaceLink, 0)
	rule.Subjects = "port2, PORT3"
	narrowed := EvaluateNotifyRule(rule, probe)
	if len(narrowed) != 2 {
		t.Fatalf("subject filter returned %d signals, want 2", len(narrowed))
	}
	for _, s := range narrowed {
		if s.Subject == "port1" {
			t.Errorf("port1 was not in the subject list but was evaluated")
		}
	}
}

func TestEvaluateNotifyRule_LicenceExpiry(t *testing.T) {
	rule := ruleFor(entity.NotifyKindLicenseExpiry, 30)
	got := EvaluateNotifyRule(rule, NotifyProbe{Reachable: true, Licenses: []NotifyLicenseState{
		{Key: "antivirus", Label: "AntiVirus", DaysLeft: 12},
		{Key: "ips", Label: "Intrusion Prevention", DaysLeft: 200},
		{Key: "web_filtering", Label: "Web Filtering", DaysLeft: -3},
	}})
	if len(got) != 3 {
		t.Fatalf("got %d signals, want 3", len(got))
	}
	if !got[0].Breaching || got[1].Breaching || !got[2].Breaching {
		t.Errorf("wrong entitlements flagged: %+v", got)
	}
	// An expired licence must not read as "expires in -3 days" in a message somebody forwards.
	if !strings.Contains(got[2].Detail, "expired") {
		t.Errorf("an already-expired entitlement reads as %q", got[2].Detail)
	}
}

// ── the state machine ────────────────────────────────────────────────────────

var t0 = time.Date(2026, 8, 17, 10, 0, 0, 0, time.UTC)

func TestNextNotifyState_SustainedPollsHoldTheAlertBack(t *testing.T) {
	st := entity.NotifyRuleState{}
	sig := NotifySignal{Subject: WholeDeviceSubject, Breaching: true, Value: 92}

	st, tr := NextNotifyState(st, sig, 3, 30*time.Minute, true, t0)
	if tr.Fire {
		t.Fatalf("fired on the first of three required polls")
	}
	st, tr = NextNotifyState(st, sig, 3, 30*time.Minute, true, t0.Add(time.Minute))
	if tr.Fire {
		t.Fatalf("fired on the second of three required polls")
	}
	st, tr = NextNotifyState(st, sig, 3, 30*time.Minute, true, t0.Add(2*time.Minute))
	if !tr.Fire {
		t.Fatalf("did not fire on the third poll")
	}
	if !st.Firing || st.Streak != 3 {
		t.Errorf("state after firing = firing:%v streak:%d", st.Firing, st.Streak)
	}
}

// A spike that clears before the sustain count is reached must leave no trace — no alert, and no
// half-armed state that fires on an unrelated breach an hour later.
func TestNextNotifyState_ASpikeThatClearsNeverFires(t *testing.T) {
	st := entity.NotifyRuleState{}
	st, tr := NextNotifyState(st, NotifySignal{Breaching: true, Value: 99}, 3, 0, true, t0)
	if tr.Fire {
		t.Fatalf("fired on the first poll")
	}
	st, tr = NextNotifyState(st, NotifySignal{Breaching: false, Value: 12}, 3, 0, true, t0.Add(time.Minute))
	if tr.Fire || tr.Resolve {
		t.Errorf("a spike that cleared announced something: %+v", tr)
	}
	if st.Streak != 0 {
		t.Errorf("the breach streak survived a healthy poll: %d", st.Streak)
	}
	if st.Firing {
		t.Errorf("state is firing after an alert that never fired")
	}
}

func TestNextNotifyState_CooldownSuppressesRepeats(t *testing.T) {
	sig := NotifySignal{Breaching: true, Value: 99}
	st := entity.NotifyRuleState{}

	st, tr := NextNotifyState(st, sig, 1, 30*time.Minute, true, t0)
	if !tr.Fire {
		t.Fatalf("sustained=1 did not fire immediately")
	}

	st, tr = NextNotifyState(st, sig, 1, 30*time.Minute, true, t0.Add(5*time.Minute))
	if tr.Fire {
		t.Errorf("re-fired 5 minutes into a 30-minute cooldown")
	}
	if !tr.Suppressed {
		t.Errorf("a swallowed repeat must be reported as suppressed, not as nothing happening")
	}

	_, tr = NextNotifyState(st, sig, 1, 30*time.Minute, true, t0.Add(31*time.Minute))
	if !tr.Fire {
		t.Errorf("did not re-fire once the cooldown had passed")
	}
}

func TestNextNotifyState_ResolveIsSymmetricAndNeverRateLimited(t *testing.T) {
	st := entity.NotifyRuleState{}
	firing := NotifySignal{Breaching: true, Value: 99}
	clear := NotifySignal{Breaching: false, Value: 10}

	st, _ = NextNotifyState(st, firing, 2, time.Hour, true, t0)
	st, tr := NextNotifyState(st, firing, 2, time.Hour, true, t0.Add(time.Minute))
	if !tr.Fire {
		t.Fatalf("did not fire after two breaching polls")
	}

	// One healthy poll is not a recovery when the rule needs two.
	st, tr = NextNotifyState(st, clear, 2, time.Hour, true, t0.Add(2*time.Minute))
	if tr.Resolve {
		t.Errorf("resolved after a single healthy poll on a sustained=2 rule")
	}
	if !st.Firing {
		t.Errorf("stopped firing before the recovery was sustained")
	}

	// The second one is — and the hour-long cooldown must not swallow it.
	st, tr = NextNotifyState(st, clear, 2, time.Hour, true, t0.Add(3*time.Minute))
	if !tr.Resolve {
		t.Fatalf("did not resolve after the recovery was sustained")
	}
	if st.Firing || st.LastFiredAt != nil {
		t.Errorf("state still looks like an open alert after resolving")
	}
}

func TestNextNotifyState_ResolveCanBeTurnedOff(t *testing.T) {
	st := entity.NotifyRuleState{}
	st, _ = NextNotifyState(st, NotifySignal{Breaching: true}, 1, 0, false, t0)
	st, tr := NextNotifyState(st, NotifySignal{Breaching: false}, 1, 0, false, t0.Add(time.Minute))

	if tr.Resolve {
		t.Errorf("announced a recovery on a rule with notify_on_resolve off")
	}
	// The STATE still has to clear, or the alert could never fire a second time.
	if st.Firing {
		t.Errorf("the alert stayed armed — it could never fire again")
	}
}

// A rule with a nonsense sustain count must still work. 0 would otherwise mean "fire before the
// first poll", which is not a thing.
func TestNextNotifyState_ZeroSustainBehavesAsOne(t *testing.T) {
	_, tr := NextNotifyState(entity.NotifyRuleState{}, NotifySignal{Breaching: true}, 0, 0, true, t0)
	if !tr.Fire {
		t.Errorf("sustained=0 did not fire on the first breach")
	}
}

// ── the message ──────────────────────────────────────────────────────────────

func TestRenderNotifyMessage_CarriesEveryFactInBothForms(t *testing.T) {
	rule := ruleFor(entity.NotifyKindInterfaceLink, 0)
	rule.Name = "WAN link watch"
	rule.Severity = entity.NotifySeverityCritical
	sig := NotifySignal{Subject: "port1", Label: "port1 (WAN)", Breaching: true, Detail: "link is down"}

	msg := RenderNotifyMessage(rule, "FGT-LAB (10.0.99.201)", sig, entity.NotifyStateFiring, t0)

	for _, want := range []string{"CRITICAL", "FGT-LAB (10.0.99.201)", "port1 (WAN)"} {
		if !strings.Contains(msg.Title, want) {
			t.Errorf("title %q is missing %q", msg.Title, want)
		}
	}
	// LINE and email must carry the same facts, or two people reading the same alert on different
	// devices have to reconcile two accounts of it.
	for _, want := range []string{"FGT-LAB (10.0.99.201)", "Port Up / Down", "port1 (WAN)", "link is down", "WAN link watch"} {
		if !strings.Contains(msg.Text, want) {
			t.Errorf("LINE text is missing %q:\n%s", want, msg.Text)
		}
		found := false
		for _, l := range msg.Lines {
			if strings.Contains(l, want) {
				found = true
			}
		}
		if !found {
			t.Errorf("email lines are missing %q: %v", want, msg.Lines)
		}
	}
}

func TestRenderNotifyMessage_ResolvedReadsAsRecovery(t *testing.T) {
	rule := ruleFor(entity.NotifyKindCPUPeak, 85)
	msg := RenderNotifyMessage(rule, "FGT", NotifySignal{Label: "CPU", Detail: "CPU is at 12% (threshold 85%)"},
		entity.NotifyStateResolved, t0)

	if !strings.Contains(msg.Title, "RESOLVED") {
		t.Errorf("a recovery is titled %q", msg.Title)
	}
	if strings.Contains(msg.Title, "WARNING") {
		t.Errorf("a recovery is still wearing its severity: %q", msg.Title)
	}
	if !strings.HasPrefix(msg.Text, "✅") {
		t.Errorf("a recovery must be distinguishable from the first character: %q", msg.Text[:6])
	}
}

// ── fan-out ──────────────────────────────────────────────────────────────────

func TestResolveNotifyTargets_DropsWhatCannotDeliver(t *testing.T) {
	channels := map[uint]entity.NotifyChannel{
		1: {Base: entity.Base{ID: 1}, Type: entity.NotifyChannelEmail, Enabled: true},
		2: {Base: entity.Base{ID: 2}, Type: entity.NotifyChannelLINE, Enabled: false},
	}
	recipients := []entity.NotifyRecipient{
		{Base: entity.Base{ID: 10}, NotifyChannelID: 1, Name: "ops", Target: "ops@example.com", Enabled: true},
		{Base: entity.Base{ID: 11}, NotifyChannelID: 1, Name: "off", Target: "off@example.com", Enabled: false},
		{Base: entity.Base{ID: 12}, NotifyChannelID: 2, Name: "line", Target: "U1", Enabled: true},
		{Base: entity.Base{ID: 13}, NotifyChannelID: 9, Name: "orphan", Target: "x@y.z", Enabled: true},
	}

	got := ResolveNotifyTargets(recipients, channels)

	if len(got) != 1 {
		t.Fatalf("got %d targets, want only the enabled one on an enabled channel: %+v", len(got), got)
	}
	if got[0].Name != "ops" {
		t.Errorf("wrong target survived: %+v", got[0])
	}
}

func TestSummariseDelivery(t *testing.T) {
	cases := []struct {
		total, failed int
		want          string
	}{
		{0, 0, entity.NotifyDeliveryNoRecipients},
		{3, 0, entity.NotifyDeliverySent},
		{3, 1, entity.NotifyDeliveryPartial},
		{3, 3, entity.NotifyDeliveryFailed},
	}
	for _, tc := range cases {
		if got := SummariseDelivery(tc.total, tc.failed); got != tc.want {
			t.Errorf("SummariseDelivery(%d, %d) = %q, want %q", tc.total, tc.failed, got, tc.want)
		}
	}
}

func TestParseNotifySubjects(t *testing.T) {
	got := ParseNotifySubjects("  port1 , ,port2,  ")
	if len(got) != 2 || got[0] != "port1" || got[1] != "port2" {
		t.Errorf("got %v, want [port1 port2]", got)
	}
	if got := ParseNotifySubjects(""); len(got) != 0 || got == nil {
		t.Errorf("an empty subject list must be an empty slice, got %v", got)
	}
}

func TestFormatNotifyValue_DropsTheTrailingZero(t *testing.T) {
	cases := map[string]string{
		formatNotifyValue(85, "%"):         "85%",
		formatNotifyValue(85.5, "%"):       "85.5%",
		formatNotifyValue(20000, ""):       "20000",
		formatNotifyValue(30, "days left"): "30 days left",
	}
	for got, want := range cases {
		if got != want {
			t.Errorf("got %q, want %q", got, want)
		}
	}
}

// ── the third state: "we did not ask" ────────────────────────────────────────

// A probe that was SKIPPED is not the same as one that found the device down.
//
// This shipped as a real false alarm and was caught against the live lab firewall: a burst of
// manual sweeps exhausted the device's login attempts, the session pool's circuit breaker opened to
// protect the admin account, and the sweep reported the healthy firewall as "Device Unreachable" —
// an outage alert about the monitoring system's own back-off. Worse, it was self-sustaining: the
// breaker stays open for a minute, so every sweep inside that window repeated it.
func TestEvaluateNotifyRule_ASkippedProbeSaysNothingAtAll(t *testing.T) {
	skipped := NotifyProbe{Skipped: true}

	for _, kind := range []string{
		entity.NotifyKindDeviceUnreachable, entity.NotifyKindInterfaceLink,
		entity.NotifyKindCPUPeak, entity.NotifyKindLicenseExpiry,
	} {
		t.Run(kind, func(t *testing.T) {
			if got := EvaluateNotifyRule(ruleFor(kind, 50), skipped); len(got) != 0 {
				t.Errorf("a skipped probe produced %d signal(s): %+v", len(got), got)
			}
		})
	}
}

// And the inverse, so the fix cannot be over-applied: a genuinely unreachable device must still
// fire. Silencing both would turn the outage alert off entirely.
func TestEvaluateNotifyRule_SkippedIsNotUnreachable(t *testing.T) {
	down := NotifyProbe{Reachable: false, Error: "dial tcp: i/o timeout"}

	got := EvaluateNotifyRule(ruleFor(entity.NotifyKindDeviceUnreachable, 0), down)

	if len(got) != 1 || !got[0].Breaching {
		t.Fatalf("a real outage stopped firing: %+v", got)
	}
}
