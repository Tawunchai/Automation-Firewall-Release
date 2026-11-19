package platform

import (
	"encoding/json"
	"strings"
	"testing"
	"unicode/utf8"
)

// truncate caps a byte budget, and it used to do it with a plain s[:max]. That is correct only for
// ASCII. Both of its callers routinely carry multi-byte text:
//
//   - doOnce wraps a FortiGate error body, and object names, comments and FortiGuard category
//     labels on this project's devices are Thai;
//   - buildLiveDeviceContext cuts the device object inventory that goes into the AI prompt, whose
//     whole purpose is names the model must quote back verbatim.
//
// Splitting a rune leaves a 1-3 byte fragment that is not valid UTF-8. Nothing panics — which is
// why it went unnoticed — but encoding/json rewrites the fragment to U+FFFD, so the error reads as
// "…�" and the model is handed a corrupted final line.
//
// A Thai character is 3 bytes in UTF-8, so any budget not divisible by 3 lands mid-rune. The cases
// below walk every offset around a boundary so the off-by-one cannot hide.

// thaiSample is 10 Thai characters = 30 bytes. Real text from the device: an address object named
// after a branch office.
const thaiSample = "สาขาเชียงใหม่" // note: 13 runes, 39 bytes

func TestTruncate_NeverSplitsARune(t *testing.T) {
	inputs := map[string]string{
		"thai":            strings.Repeat("ก", 40), // 3 bytes per rune
		"thai words":      strings.Repeat(thaiSample, 4),
		"emoji":           strings.Repeat("🔥", 20), // 4 bytes per rune
		"mixed":           "port1 " + thaiSample + " 10.0.0.0/24 🔥 ok",
		"ascii":           strings.Repeat("a", 40),
		"combining marks": strings.Repeat("é", 30), // 2 bytes per rune
	}

	for name, in := range inputs {
		t.Run(name, func(t *testing.T) {
			// Every budget from 0 to just past the input — the boundary is somewhere in here for
			// each encoding width, and this way we do not have to guess where.
			for max := 0; max <= len(in)+2; max++ {
				got := TruncateUTF8(in, max)

				if !utf8.ValidString(got) {
					t.Fatalf("TruncateUTF8(%s, %d) produced invalid UTF-8: %q", name, max, got)
				}
				// The budget is a cap, not a target: the ellipsis is added on top, exactly as the
				// original did, so only the truncated PREFIX is bounded by max.
				if body := strings.TrimSuffix(got, "…"); len(body) > max && max > 0 {
					t.Errorf("TruncateUTF8(%s, %d) kept %d bytes, over budget", name, max, len(body))
				}
			}
		})
	}
}

// A short string must come back completely untouched — no ellipsis, no copy of the old behaviour
// changing. This is the path almost every real error body takes.
func TestTruncate_ShortInputIsUnchanged(t *testing.T) {
	for _, s := range []string{"", "ok", thaiSample, strings.Repeat("ก", 66)} {
		if got := TruncateUTF8(s, 200); got != s {
			t.Errorf("TruncateUTF8(%q, 200) = %q, want it unchanged", s, got)
		}
	}
	// Exactly at the budget is still "fits".
	if got := TruncateUTF8("abcde", 5); got != "abcde" {
		t.Errorf("TruncateUTF8 at exactly the budget = %q, want %q", got, "abcde")
	}
}

// The regression in its original shape: the old implementation on Thai input at a budget that is
// not a multiple of the rune width. Kept as an explicit case so the failure mode is documented
// rather than only implied by the sweep above.
func TestTruncate_ThaiAtAwkwardBudget(t *testing.T) {
	in := strings.Repeat("ก", 10) // 30 bytes, 3 bytes per rune

	// 20 is not a multiple of 3, so the naive cut lands inside the 7th character.
	naive := in[:20]
	if utf8.ValidString(naive) {
		t.Fatal("test premise is wrong: in[:20] should be invalid UTF-8")
	}

	got := TruncateUTF8(in, 20)
	if !utf8.ValidString(got) {
		t.Fatalf("TruncateUTF8 = %q, still invalid UTF-8", got)
	}
	if want := strings.Repeat("ก", 6) + "…"; got != want {
		t.Errorf("TruncateUTF8(30 bytes of Thai, 20) = %q, want %q (6 whole characters = 18 bytes)", got, want)
	}
}

// What the bug actually looked like downstream. json.Marshal is not optional here: every error
// from doOnce leaves the process through c.JSON, and the AI prompt is marshalled into the
// Anthropic request body.
func TestTruncate_SurvivesJSONRoundTrip(t *testing.T) {
	in := strings.Repeat("ก", 10)

	var naive, fixed string
	mustJSON := func(s string) string {
		b, err := json.Marshal(s)
		if err != nil {
			t.Fatalf("marshal: %v", err)
		}
		var out string
		if err := json.Unmarshal(b, &out); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		return out
	}
	naive = mustJSON(in[:20]) // the old behaviour
	fixed = mustJSON(TruncateUTF8(in, 20))

	if !strings.ContainsRune(naive, '�') {
		t.Fatal("test premise is wrong: the naive cut should come back with a replacement char")
	}
	if strings.ContainsRune(fixed, '�') {
		t.Errorf("TruncateUTF8 output still corrupts through JSON: %q", fixed)
	}
}

func TestRuneSafeCut(t *testing.T) {
	cases := []struct {
		name string
		s    string
		max  int
		want int
	}{
		{"ascii is exact", "abcdef", 3, 3},
		{"budget past the end", "abc", 99, 3},
		{"zero", "abc", 0, 0},
		{"thai on a boundary", "กขค", 3, 3},        // one whole character
		{"thai one byte over", "กขค", 4, 3},        // back off to the boundary
		{"thai two bytes over", "กขค", 5, 3},       //
		{"thai on the next boundary", "กขค", 6, 6}, // two whole characters
		{"emoji one byte in", "🔥ok", 1, 0},         // nothing fits
		{"emoji whole", "🔥ok", 4, 4},
		{"emoji then ascii", "🔥ok", 5, 5},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := RuneSafeCut(c.s, c.max)
			if got != c.want {
				t.Errorf("RuneSafeCut(%q, %d) = %d, want %d", c.s, c.max, got, c.want)
			}
			if got > c.max && c.max <= len(c.s) {
				t.Errorf("runeSafeCut returned %d, over the budget %d", got, c.max)
			}
			if !utf8.ValidString(c.s[:got]) {
				t.Errorf("RuneSafeCut(%q, %d) cut at %d, which is mid-rune", c.s, c.max, got)
			}
		})
	}
}
