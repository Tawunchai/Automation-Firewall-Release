package notify

import (
	"fmt"
	"network_automation/services/platform"
	"sort"
	"strconv"
	"strings"
	"time"

	"network_automation/entity"
)

// Notify Management — the part that decides WHETHER to say something.
//
// Everything in this file is pure: it takes a snapshot of a device and the stored memory of the last
// snapshot, and returns what changed. No database, no HTTP, no clock of its own. That is deliberate
// — the alerting rules are the half of this feature that has to be right, and the half that is
// impossible to exercise against a live firewall on demand (you cannot ask a lab FortiGate to peg
// its CPU for three minutes at 11pm on a Tuesday). notify_poll.go supplies the snapshot;
// notify_delivery.go sends the result.

// ── the catalogue ────────────────────────────────────────────────────────────

// NotifyKindInfo describes one rule kind to the UI: what it watches, and what its threshold means.
type NotifyKindInfo struct {
	Kind  string `json:"kind"`
	Title string `json:"title"`
	// Family groups the picker. Two families ship: link/reachability and resource thresholds.
	Family      string `json:"family"`
	Description string `json:"description"`

	// HasThreshold is false for the two kinds that watch a STATE rather than a number — a port is
	// up or it is not, and there is no threshold to set. The form hides the field for those rather
	// than showing one that does nothing.
	HasThreshold     bool    `json:"has_threshold"`
	ThresholdUnit    string  `json:"threshold_unit,omitempty"`
	ThresholdDefault float64 `json:"threshold_default,omitempty"`
	ThresholdMin     float64 `json:"threshold_min,omitempty"`
	ThresholdMax     float64 `json:"threshold_max,omitempty"`

	// HasSubjects marks the kinds that produce one signal per thing on the device, so the rule can
	// be narrowed to named subjects (ports).
	HasSubjects     bool   `json:"has_subjects"`
	SubjectLabel    string `json:"subject_label,omitempty"`
	DefaultSeverity string `json:"default_severity"`
}

// NotifyKinds is the whole catalogue, in menu order: the link/reachability family first, because
// "a port went down" is the alert people come here to set up.
var NotifyKinds = []NotifyKindInfo{
	{
		Kind: entity.NotifyKindInterfaceLink, Title: "Port Up / Down", Family: "link",
		Description: "A physical or logical interface loses link, or gets it back. Read from the device's own runtime interface state, not from the administrative up/down setting.",
		HasSubjects: true, SubjectLabel: "Ports (blank = every port the device reports a link for)",
		DefaultSeverity: entity.NotifySeverityCritical,
	},
	{
		Kind: entity.NotifyKindDeviceUnreachable, Title: "Device Unreachable", Family: "link",
		Description:     "The firewall stops answering its REST API — powered off, off the network, or refusing the credential the platform holds for it.",
		DefaultSeverity: entity.NotifySeverityCritical,
	},
	{
		Kind: entity.NotifyKindLicenseExpiry, Title: "Licence Expiring", Family: "link",
		Description:  "A FortiGuard entitlement (AntiVirus, Web Filtering, IPS …) is within the given number of days of running out.",
		HasThreshold: true, ThresholdUnit: "days left", ThresholdDefault: 30, ThresholdMin: 1, ThresholdMax: 365,
		HasSubjects: true, SubjectLabel: "Entitlements (blank = all of them)",
		DefaultSeverity: entity.NotifySeverityWarning,
	},
	{
		Kind: entity.NotifyKindCPUPeak, Title: "CPU Peak", Family: "resource",
		Description:  "System-wide CPU at or above the threshold. Pair it with a sustain count so a one-second spike during a backup does not page anyone.",
		HasThreshold: true, ThresholdUnit: "%", ThresholdDefault: 85, ThresholdMin: 1, ThresholdMax: 100,
		DefaultSeverity: entity.NotifySeverityWarning,
	},
	{
		Kind: entity.NotifyKindMemoryPeak, Title: "Memory Peak", Family: "resource",
		Description:  "Memory use at or above the threshold. FortiOS enters conserve mode in the high 80s, so a rule below that is an early warning rather than an incident.",
		HasThreshold: true, ThresholdUnit: "%", ThresholdDefault: 80, ThresholdMin: 1, ThresholdMax: 100,
		DefaultSeverity: entity.NotifySeverityWarning,
	},
	{
		Kind: entity.NotifyKindSessionSpike, Title: "Session Spike", Family: "resource",
		Description:  "Concurrent sessions at or above the threshold — the shape a scan, a worm or a runaway client makes.",
		HasThreshold: true, ThresholdUnit: "sessions", ThresholdDefault: 20000, ThresholdMin: 1, ThresholdMax: 10000000,
		DefaultSeverity: entity.NotifySeverityWarning,
	},
	{
		Kind: entity.NotifyKindDiskUsage, Title: "Disk Usage", Family: "resource",
		Description:  "Log disk at or above the threshold. A full log disk stops the device recording anything, which is discovered far too late by definition.",
		HasThreshold: true, ThresholdUnit: "%", ThresholdDefault: 90, ThresholdMin: 1, ThresholdMax: 100,
		DefaultSeverity: entity.NotifySeverityWarning,
	},
	{
		Kind: entity.NotifyKindConfigDrift, Title: "Configuration Drift", Family: "change",
		Description: "The last backup showed configuration changes that the Change Ledger cannot account for — " +
			"somebody edited this firewall outside this console. Read from the platform's own records, so it still " +
			"reports while the device is unreachable. A change undone from the console stops counting.",
		HasThreshold: true, ThresholdUnit: "outside changes still in place", ThresholdDefault: 1, ThresholdMin: 1, ThresholdMax: 1000,
		DefaultSeverity: entity.NotifySeverityCritical,
	},
}

// NotifyKindByName looks a kind up in the catalogue.
func NotifyKindByName(kind string) (NotifyKindInfo, bool) {
	for _, k := range NotifyKinds {
		if k.Kind == kind {
			return k, true
		}
	}
	return NotifyKindInfo{}, false
}

// isValidNotifyKind reports whether kind is one this platform can actually poll for.
func isValidNotifyKind(kind string) bool {
	_, ok := NotifyKindByName(kind)
	return ok
}

// IsValidNotifySeverity reports whether s is one of the three the UI colours.
func IsValidNotifySeverity(s string) bool {
	switch s {
	case entity.NotifySeverityInfo, entity.NotifySeverityWarning, entity.NotifySeverityCritical:
		return true
	}
	return false
}

// ── the snapshot ─────────────────────────────────────────────────────────────

// NotifyInterfaceState is one port's runtime link state.
type NotifyInterfaceState struct {
	Name  string
	Alias string
	Up    bool
	Speed float64
}

// NotifyLicenseState is one entitlement and how long it has left.
type NotifyLicenseState struct {
	Key      string
	Label    string
	Status   string
	DaysLeft float64
}

// NotifyProbe is everything one poll of one device produced.
//
// Reachable false is a first-class result, not an error: it is what the device-unreachable rule
// fires on, and it is also the reason every threshold rule must go quiet rather than reporting 0%
// CPU for a firewall that is switched off.
//
// Skipped is the THIRD state, and it is not the same as unreachable. It means the platform did not
// ask — the session pool's circuit breaker was open, so no packet reached the firewall and nothing
// is known about it either way. See ProbeDeviceForNotify.
type NotifyProbe struct {
	Reachable bool
	Skipped   bool
	Error     string

	// Available marks which numbers the device actually answered with. A monitor endpoint that
	// times out must not be read as "0", which would fire a disk-usage rule inverted and silence a
	// CPU one.
	HaveCPU      bool
	HaveMemory   bool
	HaveDisk     bool
	HaveSessions bool

	CPUPercent    float64
	MemoryPercent float64
	DiskPercent   float64
	Sessions      float64

	Interfaces []NotifyInterfaceState
	Licenses   []NotifyLicenseState

	// Drift comes from this platform's own tables, not from the firewall, so it is filled in
	// whether or not the device answered — see the note in EvaluateNotifyRule.
	HaveDrift          bool
	StandingDriftCount float64
	DriftDetail        string
}

// NotifySignal is one thing a rule found, for one subject.
//
// Subject is "" for the whole-device kinds; the state table uses "-" for those so the unique index
// has something to hold (an empty string works in Postgres, but reads as a bug when someone looks
// at the row).
type NotifySignal struct {
	Subject   string
	Label     string // human name for the subject: a port alias, an entitlement's label
	Breaching bool
	Value     float64
	Detail    string
}

// WholeDeviceSubject is the state-table subject for a rule that watches the device rather than a
// part of it.
const WholeDeviceSubject = "-"

// ParseNotifySubjects splits a rule's Subjects field.
func ParseNotifySubjects(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		if s := strings.TrimSpace(part); s != "" {
			out = append(out, s)
		}
	}
	return out
}

// matchesSubject reports whether name is in the (case-insensitive) wanted list, or the list is
// empty, which means "all of them".
func matchesSubject(wanted []string, name string) bool {
	if len(wanted) == 0 {
		return true
	}
	for _, w := range wanted {
		if strings.EqualFold(w, name) {
			return true
		}
	}
	return false
}

// EvaluateNotifyRule turns one probe into the signals a rule cares about.
//
// Returns nil — not an empty non-nil slice, and never a fabricated healthy signal — when the device
// could not answer the thing this rule watches. That distinction is the whole point: a rule with no
// signal leaves its stored state alone, so a firewall that is unreachable for an hour does not have
// its CPU alert "resolve" on the strength of no data.
func EvaluateNotifyRule(rule entity.NotifyRule, p NotifyProbe) []NotifySignal {
	// The platform did not ask, so nothing is known — including whether the device is up. Every
	// rule, the unreachable one most of all, has to stay silent.
	if p.Skipped {
		return nil
	}

	// Config drift is answered from our own database and is deliberately evaluated BEFORE the
	// reachability gate below. A finding recorded last night is just as true while the firewall is
	// down — and an outage is exactly when somebody wants to know that its configuration was
	// changed by a hand this console cannot name.
	if rule.Kind == entity.NotifyKindConfigDrift {
		if !p.HaveDrift {
			return nil
		}
		want := rule.Threshold
		if want < 1 {
			want = 1
		}
		return []NotifySignal{{
			Subject:   WholeDeviceSubject,
			Label:     "configuration",
			Breaching: p.StandingDriftCount >= want,
			Value:     p.StandingDriftCount,
			Detail:    platform.TruncateUTF8(p.DriftDetail, 300),
		}}
	}

	// Unreachable is the one condition every other kind has to stand down for.
	if !p.Reachable {
		if rule.Kind == entity.NotifyKindDeviceUnreachable {
			detail := p.Error
			if strings.TrimSpace(detail) == "" {
				detail = "the device did not answer"
			}
			return []NotifySignal{{
				Subject: WholeDeviceSubject, Label: "device", Breaching: true, Detail: platform.TruncateUTF8(detail, 300),
			}}
		}
		return nil
	}

	switch rule.Kind {
	case entity.NotifyKindDeviceUnreachable:
		return []NotifySignal{{Subject: WholeDeviceSubject, Label: "device", Breaching: false}}

	case entity.NotifyKindInterfaceLink:
		wanted := ParseNotifySubjects(rule.Subjects)
		out := []NotifySignal{}
		for _, i := range p.Interfaces {
			if !matchesSubject(wanted, i.Name) {
				continue
			}
			label := i.Name
			if i.Alias != "" && !strings.EqualFold(i.Alias, i.Name) {
				label = fmt.Sprintf("%s (%s)", i.Name, i.Alias)
			}
			detail := "link is down"
			if i.Up {
				detail = "link is up"
				if i.Speed > 0 {
					detail = fmt.Sprintf("link is up at %s", speedText(i.Speed))
				}
			}
			out = append(out, NotifySignal{
				Subject: i.Name, Label: label, Breaching: !i.Up, Value: i.Speed, Detail: detail,
			})
		}
		return out

	case entity.NotifyKindLicenseExpiry:
		wanted := ParseNotifySubjects(rule.Subjects)
		out := []NotifySignal{}
		for _, l := range p.Licenses {
			if !matchesSubject(wanted, l.Key) && !matchesSubject(wanted, l.Label) {
				continue
			}
			out = append(out, NotifySignal{
				Subject:   l.Key,
				Label:     l.Label,
				Breaching: l.DaysLeft <= rule.Threshold,
				Value:     l.DaysLeft,
				Detail:    licenceDetail(l),
			})
		}
		return out

	case entity.NotifyKindCPUPeak:
		return thresholdSignal(p.HaveCPU, p.CPUPercent, rule.Threshold, "CPU", "%")
	case entity.NotifyKindMemoryPeak:
		return thresholdSignal(p.HaveMemory, p.MemoryPercent, rule.Threshold, "memory", "%")
	case entity.NotifyKindDiskUsage:
		return thresholdSignal(p.HaveDisk, p.DiskPercent, rule.Threshold, "log disk", "%")
	case entity.NotifyKindSessionSpike:
		return thresholdSignal(p.HaveSessions, p.Sessions, rule.Threshold, "sessions", "")
	}
	return nil
}

// thresholdSignal is the shared body of the four numeric kinds.
//
// `have` false returns nil rather than a zero reading — see the note on EvaluateNotifyRule.
func thresholdSignal(have bool, value, threshold float64, label, unit string) []NotifySignal {
	if !have {
		return nil
	}
	return []NotifySignal{{
		Subject:   WholeDeviceSubject,
		Label:     label,
		Breaching: value >= threshold,
		Value:     value,
		Detail:    fmt.Sprintf("%s is at %s (threshold %s)", label, formatNotifyValue(value, unit), formatNotifyValue(threshold, unit)),
	}}
}

func licenceDetail(l NotifyLicenseState) string {
	switch {
	case l.DaysLeft < 0:
		return fmt.Sprintf("%s expired %s ago", l.Label, dayText(-l.DaysLeft))
	case l.DaysLeft < 1:
		return l.Label + " expires today"
	default:
		return fmt.Sprintf("%s expires in %s", l.Label, dayText(l.DaysLeft))
	}
}

func dayText(d float64) string {
	n := int(d)
	if n == 1 {
		return "1 day"
	}
	return strconv.Itoa(n) + " days"
}

func speedText(mbps float64) string {
	if mbps >= 1000 {
		return trimFloat(mbps/1000) + " Gbps"
	}
	return trimFloat(mbps) + " Mbps"
}

// formatNotifyValue prints a reading the way the alert text should read it.
func formatNotifyValue(v float64, unit string) string {
	switch unit {
	case "%":
		return trimFloat(v) + "%"
	case "":
		return trimFloat(v)
	default:
		return trimFloat(v) + " " + unit
	}
}

// trimFloat drops a trailing ".0" — "85%" rather than "85.0%".
func trimFloat(v float64) string {
	s := strconv.FormatFloat(v, 'f', 1, 64)
	return strings.TrimSuffix(s, ".0")
}

// ── the state machine ────────────────────────────────────────────────────────

// NotifyTransition is what one poll decided about one subject.
type NotifyTransition struct {
	Fire    bool // announce that it is broken
	Resolve bool // announce that it recovered
	// Suppressed is set when a breach WOULD have fired but the cooldown swallowed it. Not an alert,
	// but the poller logs it, so "why did I not get paged" has an answer.
	Suppressed bool
}

// NextNotifyState folds one signal into the stored state and says what to announce.
//
// The rules, in the order they are applied:
//
//  1. A breach has to survive `sustained` consecutive polls before it fires. Below that the streak
//     just grows. This is the setting that separates a spike from a problem.
//  2. Once firing, a repeat fires again only after the cooldown — a firewall that has been down
//     all weekend is worth one message an hour, not one a minute.
//  3. Recovery is symmetric with (1): the healthy readings have to survive `sustained` polls too,
//     so a flapping port does not alternate "down"/"up" messages every tick.
//  4. Resolve is never rate-limited. Being told it came back is not spam, and swallowing it would
//     leave the last thing anyone heard being "it is broken".
func NextNotifyState(
	st entity.NotifyRuleState,
	sig NotifySignal,
	sustained int,
	cooldown time.Duration,
	notifyOnResolve bool,
	now time.Time,
) (entity.NotifyRuleState, NotifyTransition) {
	if sustained < 1 {
		sustained = 1
	}

	out := st
	out.LastValue = sig.Value
	out.LastDetail = sig.Detail
	seen := now
	out.LastSeenAt = &seen

	var tr NotifyTransition

	if sig.Breaching {
		out.ClearStreak = 0
		out.Streak = st.Streak + 1

		if out.Streak < sustained {
			return out, tr // still making its mind up
		}

		if !st.Firing {
			out.Firing = true
			fired := now
			out.LastFiredAt = &fired
			tr.Fire = true
			return out, tr
		}

		// Already firing: a re-announcement, gated by the cooldown.
		if cooldown <= 0 || st.LastFiredAt == nil || !now.Before(st.LastFiredAt.Add(cooldown)) {
			fired := now
			out.LastFiredAt = &fired
			tr.Fire = true
		} else {
			tr.Suppressed = true
		}
		return out, tr
	}

	// Healthy reading.
	out.Streak = 0
	out.ClearStreak = st.ClearStreak + 1

	if st.Firing && out.ClearStreak >= sustained {
		out.Firing = false
		out.LastFiredAt = nil
		tr.Resolve = notifyOnResolve
	}
	return out, tr
}

// ── the message ──────────────────────────────────────────────────────────────

// NotifyMessage is the rendered alert, in the two shapes it is delivered in.
type NotifyMessage struct {
	Title string
	// Text is what LINE receives — plain, no markup, and short enough to be legible in a phone's
	// notification preview.
	Text string
	// Lines are the body paragraphs of the email version.
	Lines []string
}

// severityMark is the one glyph an alert leads with. LINE renders no formatting at all, so the
// severity has to be visible in the first character or it is not visible in a notification preview.
func severityMark(severity, state string) string {
	if state == entity.NotifyStateResolved {
		return "✅"
	}
	switch severity {
	case entity.NotifySeverityCritical:
		return "🔴"
	case entity.NotifySeverityInfo:
		return "ℹ️"
	default:
		return "🟠"
	}
}

// RenderNotifyMessage writes the alert.
//
// Both channels get the same facts in the same order — device, what happened, when — because an
// operator reading the LINE message on a phone and the email on a laptop must not have to reconcile
// two accounts of the same event.
func RenderNotifyMessage(rule entity.NotifyRule, deviceName string, sig NotifySignal, state string, now time.Time) NotifyMessage {
	kind, _ := NotifyKindByName(rule.Kind)
	kindTitle := kind.Title
	if kindTitle == "" {
		kindTitle = rule.Kind
	}

	what := kindTitle
	if sig.Label != "" && sig.Label != "device" {
		what = kindTitle + " · " + sig.Label
	}

	verb := "RESOLVED"
	if state == entity.NotifyStateFiring {
		verb = strings.ToUpper(rule.Severity)
		if verb == "" {
			verb = "ALERT"
		}
	}

	title := fmt.Sprintf("[%s] %s — %s", verb, deviceName, what)

	detail := sig.Detail
	if state == entity.NotifyStateResolved && strings.TrimSpace(detail) == "" {
		detail = "back to normal"
	}

	lines := []string{
		"Device: " + deviceName,
		"Check: " + kindTitle,
	}
	if sig.Label != "" && sig.Label != "device" {
		lines = append(lines, "Subject: "+sig.Label)
	}
	if strings.TrimSpace(detail) != "" {
		lines = append(lines, "Detail: "+detail)
	}
	lines = append(lines,
		"Rule: "+rule.Name,
		"Time: "+now.Format("2006-01-02 15:04:05 MST"),
	)

	var text strings.Builder
	fmt.Fprintf(&text, "%s %s\n", severityMark(rule.Severity, state), title)
	for _, l := range lines {
		text.WriteString(l)
		text.WriteString("\n")
	}

	return NotifyMessage{
		Title: title,
		Text:  strings.TrimRight(text.String(), "\n"),
		Lines: lines,
	}
}

// ── recipient fan-out ────────────────────────────────────────────────────────

// NotifyTarget is one resolved place to send to.
type NotifyTarget struct {
	RecipientID uint
	ChannelID   uint
	ChannelType string
	// Token is the LINE channel access token, already decrypted. Empty for an email target.
	Token string
	Name  string
	Addr  string
}

// ResolveNotifyTargets flattens a rule's recipients into the list the sender walks.
//
// Disabled recipients and recipients on a disabled channel are dropped here rather than at send
// time, so "why did this not go out" is answerable from one function. Sorting by channel then name
// keeps the delivery detail on an event row stable between two identical alerts.
func ResolveNotifyTargets(recipients []entity.NotifyRecipient, channels map[uint]entity.NotifyChannel) []NotifyTarget {
	out := []NotifyTarget{}
	for _, r := range recipients {
		if !r.Enabled {
			continue
		}
		ch, ok := channels[r.NotifyChannelID]
		if !ok || !ch.Enabled {
			continue
		}
		t := NotifyTarget{
			RecipientID: r.ID,
			ChannelID:   ch.ID,
			ChannelType: ch.Type,
			Name:        r.Name,
			Addr:        r.Target,
		}
		if ch.Type == entity.NotifyChannelLINE {
			// A channel with no token cannot deliver; decryption failure is reported by the caller
			// as a per-target failure rather than dropping the recipient silently.
			if plain, err := platform.DecryptSecret(ch.SecretEnc); err == nil {
				t.Token = plain
			}
		}
		out = append(out, t)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].ChannelID != out[j].ChannelID {
			return out[i].ChannelID < out[j].ChannelID
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// SummariseDelivery folds per-target outcomes into the status stored on the event row.
func SummariseDelivery(total, failed int) string {
	switch {
	case total == 0:
		return entity.NotifyDeliveryNoRecipients
	case failed == 0:
		return entity.NotifyDeliverySent
	case failed >= total:
		return entity.NotifyDeliveryFailed
	default:
		return entity.NotifyDeliveryPartial
	}
}
