package activitylog

import (
	"testing"
	"time"
)

// The Users page drew three numbers — "My Activities", the breakdown's Total, and the timeline's
// Period total — from /activity-logs, which is paginated. With no query parameters that endpoint
// returns the 50 most recent rows, so every one of those numbers was really "…within your last 50",
// and the breakdown panel labelled its answer "all time" while the timeline claimed 14 days it did
// not have. This endpoint counts in the database instead.
//
// The counting is SQL and is verified against the live database separately; what is testable here
// is the shaping around it, which is where the off-by-ones live.

func at(s string) time.Time {
	t, err := time.Parse(time.RFC3339, s)
	if err != nil {
		panic(err)
	}
	return t
}

// ── the window ───────────────────────────────────────────────────────────────

// The cutoff must be midnight of the first day, not "now minus N×24h" — otherwise a request at
// 14:30 silently drops everything that happened before 14:30 on the earliest day, and the chart's
// leftmost column is wrong by however far into the day the user happened to load the page.
func TestWindowStart_IsMidnightOfTheFirstDay(t *testing.T) {
	got := windowStart(at("2026-08-03T14:30:45Z"), 14)

	if want := at("2026-07-21T00:00:00Z"); !got.Equal(want) {
		t.Errorf("windowStart = %s, want %s", got.Format(time.RFC3339), want.Format(time.RFC3339))
	}
	if got.Hour() != 0 || got.Minute() != 0 || got.Second() != 0 {
		t.Errorf("windowStart = %s, want midnight", got.Format(time.RFC3339))
	}
}

// A 14-day window includes today, so it reaches back 13 days — not 14. Getting this wrong shows up
// as a chart that is one column too wide or too narrow, which nobody notices.
func TestWindowStart_IncludesToday(t *testing.T) {
	now := at("2026-08-03T09:00:00Z")
	for _, days := range []int{1, 7, 14, 30, 365} {
		start := windowStart(now, days)
		spanned := int(now.UTC().Truncate(24*time.Hour).Sub(start).Hours()/24) + 1
		if spanned != days {
			t.Errorf("days=%d spans %d calendar days", days, spanned)
		}
	}
}

// Two requests during the same day must describe the same window, or the chart shifts under the
// user between refreshes.
func TestWindowStart_IsStableWithinTheDay(t *testing.T) {
	morning := windowStart(at("2026-08-03T00:00:01Z"), 14)
	evening := windowStart(at("2026-08-03T23:59:59Z"), 14)
	if !morning.Equal(evening) {
		t.Errorf("window moved during the day: %s vs %s", morning, evening)
	}
}

// The request is answered in UTC whatever the server's local zone is, because the frontend derives
// its date keys from created_at the same way everywhere else in the app.
func TestWindowStart_IsUTC(t *testing.T) {
	bangkok, err := time.LoadLocation("Asia/Bangkok")
	if err != nil {
		t.Skipf("tz database unavailable: %v", err)
	}
	local := at("2026-08-03T02:00:00Z").In(bangkok) // 09:00 in Bangkok, still the 3rd in UTC
	if got, want := windowStart(local, 14), at("2026-07-21T00:00:00Z"); !got.Equal(want) {
		t.Errorf("windowStart(%s) = %s, want %s", local, got, want)
	}
}

// ── filling the gaps ─────────────────────────────────────────────────────────

// An area chart interpolates across a missing day, turning a quiet Tuesday into a slope. Every day
// in the window has to be present, zeros included.
func TestFillWindow_EmitsEveryDayIncludingEmptyOnes(t *testing.T) {
	start := at("2026-07-21T00:00:00Z")
	got := fillWindow(start, 14, map[string]int{"2026-07-25": 3, "2026-08-03": 9})

	if len(got) != 14 {
		t.Fatalf("got %d days, want 14", len(got))
	}
	if got[0].Date != "2026-07-21" || got[13].Date != "2026-08-03" {
		t.Errorf("window runs %s … %s, want 2026-07-21 … 2026-08-03", got[0].Date, got[13].Date)
	}

	zeros := 0
	for _, d := range got {
		if d.Count == 0 {
			zeros++
		}
	}
	if zeros != 12 {
		t.Errorf("got %d empty days, want 12", zeros)
	}
	if got[4].Count != 3 {
		t.Errorf("2026-07-25 = %d, want 3", got[4].Count)
	}
	if got[13].Count != 9 {
		t.Errorf("2026-08-03 = %d, want 9", got[13].Count)
	}
}

// Oldest first — the chart's x-axis is positional, so a reversed window would draw the fortnight
// backwards.
func TestFillWindow_IsChronological(t *testing.T) {
	got := fillWindow(at("2026-07-21T00:00:00Z"), 14, nil)
	for i := 1; i < len(got); i++ {
		if got[i-1].Date >= got[i].Date {
			t.Fatalf("day %d (%s) is not after day %d (%s)", i, got[i].Date, i-1, got[i-1].Date)
		}
	}
}

// The window crosses month and year boundaries; date arithmetic must follow the calendar rather
// than adding 86400 seconds at a time.
func TestFillWindow_CrossesMonthAndYearBoundaries(t *testing.T) {
	dates := func(days []DayCount) []string {
		out := make([]string, len(days))
		for i, d := range days {
			out[i] = d.Date
		}
		return out
	}

	july := dates(fillWindow(at("2026-07-29T00:00:00Z"), 5, nil))
	if want := []string{"2026-07-29", "2026-07-30", "2026-07-31", "2026-08-01", "2026-08-02"}; !equal(july, want) {
		t.Errorf("month boundary = %v, want %v", july, want)
	}

	newYear := dates(fillWindow(at("2025-12-30T00:00:00Z"), 4, nil))
	if want := []string{"2025-12-30", "2025-12-31", "2026-01-01", "2026-01-02"}; !equal(newYear, want) {
		t.Errorf("year boundary = %v, want %v", newYear, want)
	}

	// 2028 is a leap year.
	leap := dates(fillWindow(at("2028-02-27T00:00:00Z"), 4, nil))
	if want := []string{"2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01"}; !equal(leap, want) {
		t.Errorf("leap day = %v, want %v", leap, want)
	}
}

// A count for a day outside the window (a clock skew, a stale row) must be ignored rather than
// appended — the response length is a contract the chart's layout depends on.
func TestFillWindow_IgnoresCountsOutsideTheWindow(t *testing.T) {
	got := fillWindow(at("2026-07-21T00:00:00Z"), 14, map[string]int{
		"2026-07-20": 99, // one day before
		"2026-08-04": 99, // one day after
		"2026-07-21": 1,
	})
	if len(got) != 14 {
		t.Fatalf("got %d days, want exactly 14", len(got))
	}
	total := 0
	for _, d := range got {
		total += d.Count
	}
	if total != 1 {
		t.Errorf("total = %d, want 1 — out-of-window counts must not leak in", total)
	}
}

func TestFillWindow_HandlesNoCounts(t *testing.T) {
	got := fillWindow(at("2026-07-21T00:00:00Z"), 14, nil)
	if len(got) != 14 {
		t.Fatalf("got %d days, want 14 even with no data", len(got))
	}
	for _, d := range got {
		if d.Count != 0 {
			t.Errorf("%s = %d, want 0", d.Date, d.Count)
		}
	}
}

// ── the window parameter ─────────────────────────────────────────────────────

func TestParseWindowDays(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want int
	}{
		{"absent", "", defaultSummaryDays},
		{"the panel's default", "14", 14},
		{"a month", "30", 30},
		{"the maximum", "365", 365},
		{"one day", "1", 1},

		// A bad query string drives a chart, not a form. Falling back beats an error card.
		{"zero", "0", defaultSummaryDays},
		{"negative", "-5", defaultSummaryDays},
		{"over the maximum", "3650", defaultSummaryDays},
		{"not a number", "fortnight", defaultSummaryDays},
		{"injection attempt", "14; DROP TABLE activity_logs", defaultSummaryDays},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := parseWindowDays(c.in); got != c.want {
				t.Errorf("parseWindowDays(%q) = %d, want %d", c.in, got, c.want)
			}
		})
	}
}

// The window is bounded so one request cannot ask the database to bucket a decade, and so the
// response cannot grow without limit — the whole reason this endpoint exists.
func TestParseWindowDays_IsAlwaysBounded(t *testing.T) {
	for _, in := range []string{"", "1", "365", "999999", "-1", "abc", "1e9"} {
		got := parseWindowDays(in)
		if got < 1 || got > maxSummaryDays {
			t.Errorf("parseWindowDays(%q) = %d, outside [1, %d]", in, got, maxSummaryDays)
		}
	}
}

func equal(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
