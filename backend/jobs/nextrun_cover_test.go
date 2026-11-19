package jobs

import (
	"testing"
	"time"
)

// NextRun is the whole scheduler clock: every automatic backup on this platform happens because
// NextRun said so. It had no test at all, and the two things most worth pinning about it are not
// "does cron work" — robfig/cron is tested upstream — but the two DECISIONS this file makes:
//
//  1. the parser is FIVE fields (minute hour dom month dow) and nothing else. A spec a user pastes
//     from a tutorial that has six fields, or a `@daily` descriptor from crontab(5), is a parse
//     ERROR here, not a silently different schedule. Accepting six fields would reinterpret every
//     existing 5-field spec on the next save — "0 2 * * *" would become "at second 0 of minute 2
//     of every hour", i.e. hourly instead of nightly — so the refusal is the safe answer and has
//     to stay a refusal.
//  2. the next run is STRICTLY after `from`. Called at exactly 02:00:00 for a 02:00 schedule, it
//     must answer tomorrow. If it answered "now", a caller that stores the answer and then loops
//     "is it time yet" would run the job again immediately, every time.
//
// No database and no Redis: this is arithmetic.

// baseTime is a fixed, explicit UTC instant. Any local zone would make the expectations depend on
// the machine the test runs on, and cron computes in the location of the time it is given.
var baseTime = time.Date(2026, time.November, 17, 2, 0, 0, 0, time.UTC)

func TestNextRunFindsTheNextOccurrence(t *testing.T) {
	cases := []struct {
		name string
		spec string
		from time.Time
		want time.Time
	}{
		{
			name: "every five minutes, mid-interval",
			spec: "*/5 * * * *",
			from: time.Date(2026, time.November, 17, 2, 3, 30, 0, time.UTC),
			want: time.Date(2026, time.November, 17, 2, 5, 0, 0, time.UTC),
		},
		{
			name: "nightly, from earlier the same day",
			spec: "0 2 * * *",
			from: time.Date(2026, time.November, 17, 1, 59, 0, 0, time.UTC),
			want: time.Date(2026, time.November, 17, 2, 0, 0, 0, time.UTC),
		},
		{
			// The strictly-after rule. 02:00:00 is a match for "0 2 * * *", and the answer must
			// still be the NEXT one.
			name: "nightly, standing exactly on the trigger",
			spec: "0 2 * * *",
			from: baseTime,
			want: time.Date(2026, time.November, 18, 2, 0, 0, 0, time.UTC),
		},
		{
			// 2026-11-17 is a Tuesday; the next Sunday is the 22nd.
			name: "weekly by day-of-week name position",
			spec: "30 3 * * 0",
			from: baseTime,
			want: time.Date(2026, time.November, 22, 3, 30, 0, 0, time.UTC),
		},
		{
			name: "monthly by day-of-month, rolling into the next month",
			spec: "0 4 1 * *",
			from: baseTime,
			want: time.Date(2026, time.December, 1, 4, 0, 0, 0, time.UTC),
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NextRun(tc.spec, tc.from)
			if err != nil {
				t.Fatalf("NextRun(%q) returned an error: %v", tc.spec, err)
			}
			if got == nil {
				t.Fatalf("NextRun(%q) returned a nil time and a nil error", tc.spec)
			}
			if !got.Equal(tc.want) {
				t.Errorf("NextRun(%q, %s) = %s, want %s",
					tc.spec, tc.from.Format(time.RFC3339), got.Format(time.RFC3339),
					tc.want.Format(time.RFC3339))
			}
		})
	}
}

// The error path, which is the one a user reaches: the spec comes off a form.
//
// Each of these must be a refused spec with a nil time, never a schedule that happens to parse as
// something else. The two interesting ones are the six-field spec and the descriptor, because both
// are valid crontab syntax elsewhere and both would mean a DIFFERENT schedule here.
func TestNextRunRefusesASpecItDoesNotUnderstand(t *testing.T) {
	cases := []struct {
		name, spec string
	}{
		{"empty", ""},
		{"only whitespace", "   "},
		{"too few fields", "0 2 * *"},
		{"six fields — the seconds dialect", "0 0 2 * * *"},
		{"a crontab descriptor", "@daily"},
		{"@every, the robfig extension", "@every 1h30m"},
		{"a minute out of range", "99 2 * * *"},
		{"an hour out of range", "0 24 * * *"},
		{"not a cron spec at all", "every night please"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := NextRun(tc.spec, baseTime)
			if err == nil {
				var when string
				if got != nil {
					when = got.Format(time.RFC3339)
				}
				t.Fatalf("NextRun(%q) was accepted and scheduled %s — this spec must be refused, "+
					"because a spec that parses as something OTHER than what the author meant is "+
					"a backup that runs at the wrong time, silently", tc.spec, when)
			}
			if got != nil {
				t.Errorf("NextRun(%q) returned both an error (%v) and a time (%s); the time must "+
					"be nil so a caller cannot store it", tc.spec, err, got.Format(time.RFC3339))
			}
		})
	}
}

// The result must be a usable pointer, not an alias of something the caller can change under it.
func TestNextRunReturnsAnIndependentTime(t *testing.T) {
	first, err := NextRun("0 2 * * *", baseTime)
	if err != nil {
		t.Fatalf("NextRun: %v", err)
	}
	second, err := NextRun("0 2 * * *", baseTime)
	if err != nil {
		t.Fatalf("NextRun: %v", err)
	}
	if first == second {
		t.Fatal("two calls returned the SAME pointer — one caller's stored next-run time would " +
			"change when another asked")
	}
	if !first.Equal(*second) {
		t.Errorf("two calls with the same arguments disagreed: %s vs %s",
			first.Format(time.RFC3339), second.Format(time.RFC3339))
	}
}
