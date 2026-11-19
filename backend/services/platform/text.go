package platform

import "unicode/utf8"

// Capping a string at a byte budget without splitting a UTF-8 character. It is in platform rather
// than beside the FortiGate client it was written for because the property it guarantees is not a
// FortiGate concern: anything that stores a device's own words in Postgres needs it, and the
// Change Ledger recorder is the caller that proved it by losing rows without it.

// truncate caps s at max BYTES without ever splitting a UTF-8 character.
//
// The naive s[:max] is wrong the moment any multi-byte text reaches it, and both callers handle
// exactly that: a FortiGate error body (comments, object names and FortiGuard category labels are
// routinely Thai) and the live device inventory that goes into the AI prompt. Cutting mid-rune
// leaves a 1-2 byte fragment that is not valid UTF-8, which encoding/json rewrites to U+FFFD on
// the way out — so a truncated error reads as "…�" and a truncated prompt hands the model a
// corrupted last line.
//
// max is a byte budget, not a character count, because that is what the limits it enforces are
// about (an HTTP body, a prompt size). Backing off to the last rune boundary at or below max keeps
// the result within budget; it never grows it.
func truncate(s string, max int) string {
	if max <= 0 {
		return "…"
	}
	if len(s) <= max {
		return s
	}
	return s[:RuneSafeCut(s, max)] + "…"
}

// TruncateUTF8 is truncate, exported for callers outside this package.
//
// It exists because the Change Ledger recorder (middleware/changerecorder.go) needs exactly this
// guarantee and did not have it: it capped a device's error message with a plain s[:2000], and a
// FortiGate error is routinely Thai, so the cut landed mid-character and produced invalid UTF-8.
// Postgres rejects an invalid byte sequence outright, so the INSERT failed and the ledger row was
// dropped with only a log line — losing precisely the record of a change that had failed.
//
// The name is longer than the internal one on purpose: `platform.Truncate` says nothing about the
// property that matters, and this function is only worth reaching for because of that property.
func TruncateUTF8(s string, max int) string { return truncate(s, max) }

// RuneSafeCut returns the largest index i <= max at which s can be split without landing inside a
// multi-byte character. utf8.RuneStart reports whether a byte begins a rune, so walking back from
// max finds the boundary in at most 3 steps (the longest UTF-8 sequence is 4 bytes).
//
// It is separate from truncate because the AI prompt builder needs the same guarantee with its own
// suffix, and a second hand-rolled copy of this loop is exactly how the first one went wrong.
func RuneSafeCut(s string, max int) int {
	if max >= len(s) {
		return len(s)
	}
	i := max
	for i > 0 && !utf8.RuneStart(s[i]) {
		i--
	}
	return i
}
