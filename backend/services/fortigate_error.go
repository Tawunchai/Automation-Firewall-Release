package services

import (
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// What the firewall said no with, kept as a NUMBER instead of as a phrase to search for.
//
// ── The bug this replaces ────────────────────────────────────────────────────
//
// Several flows have to tell one refusal apart from another, because the whole point is that some
// refusals are the outcome we wanted:
//
//	"that name already exists"  → the object is there, carry on (a re-run of a wizard)
//	"there is no such object"   → the delete has already happened, carry on
//
// Every one of those tests was written against the error TEXT, looking for the substring "-5" or
// "-3". A FortiOS code is not a substring — it is a number in a sentence, and `strings.Contains(e,
// "-5")` is true of all of these:
//
//	error code -5     the duplicate this was meant to catch
//	error code -56    "unknown FortiGuard category" (the Web Rating Override page's own error)
//	error code -50 … -59, -500 … -599
//	-518 object set operator error, discard the setting   ← a real user-group failure, documented
//	                                                        in ai.go, swallowed as "already exists"
//
// and `Contains(e, "-3")` is likewise true of -30 … -39 and -300 … -399. Nor is the device text
// safe to scan: a cli_error quotes the administrator's own input back, so an object named `site-5`
// or a port range written `1-5` puts the substring in the message with no error code near it.
//
// The consequence is the worst shape a bug can take here. A create that genuinely failed was read
// as "already exists", so the wizard reported success and moved on to build the policies that
// reference the object that was never made. Nothing was logged, because as far as the code was
// concerned nothing went wrong.
//
// ── What this does instead ───────────────────────────────────────────────────
//
// doOnce now returns *DeviceError, which carries the code the device actually sent, and the tests
// compare numbers. The message is unchanged — Error() renders exactly the string the old
// fmt.Errorf produced — so every log line, API response and existing text-based check reads the
// same as before.

// DeviceError is a refusal that came FROM the firewall: it answered, and its answer was no.
//
// It is distinct from a transport failure (unreachable, TLS, timeout), which stays an ordinary
// error, because the two need opposite handling: a device that says "-5" has told us something
// actionable about the object, while a device that never answered has told us nothing about it.
type DeviceError struct {
	// Code is the FortiOS error code, always negative when present. Zero means the device
	// signalled failure without one — a 404 on a by-key path is the common case.
	Code int
	// HTTPStatus is the envelope's http_status, which on 7.2.10 matches the status line.
	HTTPStatus int
	// Text is the human half: the CLI parser error when there is one, else the message, else
	// "error code N". Already collapsed to a single line by fgErrorText.
	Text string
}

func (e *DeviceError) Error() string {
	return fmt.Sprintf("FortiGate API error: %s (HTTP %d)", e.Text, e.HTTPStatus)
}

// deviceErrCodeRe recovers a code from an error that is only a string by now.
//
// The fallback exists because not every path preserves the typed error — an error crossing a
// package boundary as text, or one built somewhere other than doOnce — and a matcher that silently
// stopped working for those would reintroduce the same class of bug from the other side. The
// pattern is anchored on the words fgErrorText writes, not on a bare number, so "-518" in a
// device message cannot be read as "-5".
var deviceErrCodeRe = regexp.MustCompile(`error code (-?\d+)\b`)

// DeviceErrorCode returns the FortiOS code behind an error, and whether there was one.
func DeviceErrorCode(err error) (int, bool) {
	if err == nil {
		return 0, false
	}
	var de *DeviceError
	if errors.As(err, &de) {
		return de.Code, de.Code != 0
	}
	if m := deviceErrCodeRe.FindStringSubmatch(err.Error()); m != nil {
		if n, convErr := strconv.Atoi(m[1]); convErr == nil {
			return n, true
		}
	}
	return 0, false
}

// DeviceErrorHTTPStatus returns the HTTP status the device answered with, when it answered.
func DeviceErrorHTTPStatus(err error) (int, bool) {
	var de *DeviceError
	if errors.As(err, &de) && de.HTTPStatus != 0 {
		return de.HTTPStatus, true
	}
	return 0, false
}

// FortiOS codes this platform has to act on. Named rather than written inline, because a bare -5
// in a condition is exactly what made the old tests unreadable enough to be wrong.
const (
	// FGErrDuplicate — an object with that mkey already exists. Names share one space per table
	// (and, for user groups, across all four group types).
	FGErrDuplicate = -5
	// FGErrNotInDatasource — a referenced name does not resolve. The device says the same thing
	// whether the object is missing or merely not valid in this context (an address bound to
	// another interface), which is why fgErrorText spells both out.
	FGErrNotInDatasource = -3
	// FGErrNoSuchNode — the addressed node does not exist. Seen on by-key operations against an
	// object that has already been removed.
	FGErrNoSuchNode = -15
	// FGErrStillReferenced — the object cannot be deleted because something else points at it (a
	// user group, an admin profile, a policy). The fix is always "remove the reference first", so
	// the pages that can delete say that instead of printing the number.
	FGErrStillReferenced = -23
)

// IsDuplicateObjectError reports "that object is already there".
//
// Every idempotent create in this codebase depends on it: a wizard re-run, a half-finished apply
// being resumed, the AI Assistant's prerequisite pass. Treating any OTHER failure as this one
// means building on top of something that was never created.
func IsDuplicateObjectError(err error) bool {
	if err == nil {
		return false
	}
	if code, ok := DeviceErrorCode(err); ok {
		return code == FGErrDuplicate
	}
	// No code to go on. The device sometimes phrases it instead, and these two phrases cannot be
	// produced by a number the way "-5" could.
	e := strings.ToLower(err.Error())
	return strings.Contains(e, "duplicate") || strings.Contains(e, "already exist")
}

// IsObjectGoneError reports "there is nothing there to act on" — which, for a delete, is the end
// state that was wanted rather than a failure.
//
// The text checks are kept alongside the codes and are not redundant: a -3 arrives with "entry not
// found in datasource" and a by-key 404 arrives with no code at all, so the two halves cover
// different answers. What is gone is the substring match on the NUMBER, which is what let -30 …
// -39 through as "already deleted" and turned a failed delete into a silent success.
func IsObjectGoneError(err error) bool {
	if err == nil {
		return false
	}
	if code, ok := DeviceErrorCode(err); ok {
		if code == FGErrNotInDatasource || code == FGErrNoSuchNode {
			return true
		}
	}
	if status, ok := DeviceErrorHTTPStatus(err); ok && status == 404 {
		return true
	}
	e := strings.ToLower(err.Error())
	return strings.Contains(e, "not found") ||
		strings.Contains(e, "does not exist") ||
		strings.Contains(e, "http 404")
}
