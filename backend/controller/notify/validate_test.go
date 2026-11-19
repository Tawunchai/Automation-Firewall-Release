package notify

import (
	"network_automation/services/notify"
	"strings"
	"testing"

	"network_automation/entity"
)

// Recipient validation and rule clamping.
//
// Both are the last line before a rule is stored, and both guard mistakes that show no symptom
// until an alert fails to arrive: a display name typed where LINE wants a userId, and a threshold
// or sustain count that quietly puts an alert an hour away from being sent.

func TestValidateRecipientTarget_Email(t *testing.T) {
	if err := ValidateRecipientTarget(entity.NotifyChannelEmail, "ops@example.com"); err != nil {
		t.Errorf("a valid address was rejected: %v", err)
	}
	for _, bad := range []string{"", "   ", "not-an-address", "ops@", "@example.com"} {
		if err := ValidateRecipientTarget(entity.NotifyChannelEmail, bad); err == nil {
			t.Errorf("%q was accepted as an email address", bad)
		}
	}
}

// This is the mistake worth catching: pasting the group's display name, or the channel SECRET,
// into the destination field. Both look plausible and both fail at 3am.
func TestValidateRecipientTarget_LINE(t *testing.T) {
	if err := ValidateRecipientTarget(entity.NotifyChannelLINE, "U0123456789abcdef0123456789abcdef"); err != nil {
		t.Errorf("a valid userId was rejected: %v", err)
	}
	for _, bad := range []string{"", "NOC Team", "ops@example.com", "U123"} {
		err := ValidateRecipientTarget(entity.NotifyChannelLINE, bad)
		if err == nil {
			t.Fatalf("%q was accepted as a LINE destination", bad)
		}
		if bad != "" && !strings.Contains(err.Error(), "userId") {
			t.Errorf("the error for %q does not say what a LINE destination looks like: %v", bad, err)
		}
	}
}

func TestValidateRecipientTarget_UnknownChannelType(t *testing.T) {
	if err := ValidateRecipientTarget("telegram", "whatever"); err == nil {
		t.Errorf("an unknown channel type was accepted")
	}
}

// ── rule clamping ────────────────────────────────────────────────────────────

func kind(t *testing.T, name string) notify.NotifyKindInfo {
	t.Helper()
	k, ok := notify.NotifyKindByName(name)
	if !ok {
		t.Fatalf("%q is not in the catalogue", name)
	}
	return k
}

func TestNormaliseRule_ClampsNonsenseNumbers(t *testing.T) {
	cpu := kind(t, entity.NotifyKindCPUPeak)

	r := entity.NotifyRule{Kind: cpu.Kind, SustainedPolls: 0, CooldownMinutes: -5, Threshold: 400}
	normaliseRule(&r, cpu)

	if r.SustainedPolls != 1 {
		t.Errorf("sustained_polls = %d, want 1 — zero would mean 'fire before the first poll'", r.SustainedPolls)
	}
	if r.CooldownMinutes != 0 {
		t.Errorf("cooldown = %d, want 0", r.CooldownMinutes)
	}
	if r.Threshold != cpu.ThresholdMax {
		t.Errorf("threshold = %v, want it clamped to %v", r.Threshold, cpu.ThresholdMax)
	}

	// The other end: an hour of sustain and a day of cooldown are the ceilings, because past them
	// a rule is indistinguishable from a broken one.
	r = entity.NotifyRule{Kind: cpu.Kind, SustainedPolls: 9999, CooldownMinutes: 99999, Threshold: 85}
	normaliseRule(&r, cpu)
	if r.SustainedPolls != 60 || r.CooldownMinutes != 1440 {
		t.Errorf("sustained=%d cooldown=%d, want 60 / 1440", r.SustainedPolls, r.CooldownMinutes)
	}
}

// A zero threshold means "the form did not send one", so it falls back to the catalogue default
// rather than to 0 — which for a CPU rule would fire permanently.
func TestNormaliseRule_MissingThresholdTakesTheDefault(t *testing.T) {
	cpu := kind(t, entity.NotifyKindCPUPeak)

	r := entity.NotifyRule{Kind: cpu.Kind, SustainedPolls: 2}
	normaliseRule(&r, cpu)

	if r.Threshold != cpu.ThresholdDefault {
		t.Errorf("threshold = %v, want the catalogue default %v", r.Threshold, cpu.ThresholdDefault)
	}
}

// A state-watching kind has no threshold and no subject list to keep. Storing leftovers would leave
// a port rule silently narrowed to a port name typed while a different kind was selected.
func TestNormaliseRule_DropsFieldsTheKindDoesNotUse(t *testing.T) {
	unreachable := kind(t, entity.NotifyKindDeviceUnreachable)

	r := entity.NotifyRule{Kind: unreachable.Kind, Threshold: 85, Subjects: "port1", SustainedPolls: 2}
	normaliseRule(&r, unreachable)

	if r.Threshold != 0 {
		t.Errorf("threshold %v survived on a kind with no threshold", r.Threshold)
	}
	if r.Subjects != "" {
		t.Errorf("subjects %q survived on a whole-device kind", r.Subjects)
	}
}

func TestNormaliseRule_FixesAnUnknownSeverity(t *testing.T) {
	link := kind(t, entity.NotifyKindInterfaceLink)

	r := entity.NotifyRule{Kind: link.Kind, Severity: "catastrophic", SustainedPolls: 1}
	normaliseRule(&r, link)

	if r.Severity != link.DefaultSeverity {
		t.Errorf("severity = %q, want the kind's default %q", r.Severity, link.DefaultSeverity)
	}
}
