package middlewares

import (
	"errors"
	"net/http"
	"testing"

	"gorm.io/gorm"
)

// The rule that makes logging out mean something.
//
// A JWT stays cryptographically valid until it expires, so nothing the server does can withdraw
// one — except this: every request looks up the token's row in user_sessions, and refuses if the
// row is revoked or gone. Logout flips the flag; a password reset flips every row for that user.
//
// This is worth its own test because the failure mode is silent and severe. An earlier version
// checked only the "row found and revoked" case and let the other two fall through, which meant a
// token whose row was MISSING — precisely the state after a hard revoke — kept working until it
// expired. Nothing errored. Logout appeared to succeed. The token just kept administering the
// firewall.

func TestSessionVerdictAllowsAHealthySession(t *testing.T) {
	if v := sessionVerdict(nil, false); !v.ok {
		t.Errorf("a found, un-revoked session was rejected: %+v", v)
	}
}

func TestSessionVerdictRejectsARevokedSession(t *testing.T) {
	v := sessionVerdict(nil, true)
	if v.ok {
		t.Fatal("a REVOKED session was allowed — logout would not actually log anyone out")
	}
	if v.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", v.status)
	}
}

// The regression case.
func TestSessionVerdictRejectsAMissingRow(t *testing.T) {
	v := sessionVerdict(gorm.ErrRecordNotFound, false)
	if v.ok {
		t.Fatal("a token with no session row was allowed — this is the state right after a revoke, " +
			"so allowing it makes revocation a no-op")
	}
	if v.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401", v.status)
	}
}

func TestSessionVerdictRejectsAMissingRowWhenWrapped(t *testing.T) {
	// GORM's error arrives wrapped in places; matching on identity rather than errors.Is would
	// send it to the 503 branch — still closed, but with the wrong status and a logged "error"
	// for something that is a normal revoked session.
	v := sessionVerdict(errors.Join(errors.New("query failed"), gorm.ErrRecordNotFound), false)
	if v.ok {
		t.Fatal("a wrapped record-not-found was allowed")
	}
	if v.status != http.StatusUnauthorized {
		t.Errorf("status = %d, want 401 — a wrapped ErrRecordNotFound is still a missing row", v.status)
	}
}

// The one that matters most: the database being unavailable must NOT open the door.
func TestSessionVerdictFailsClosedOnADatabaseError(t *testing.T) {
	v := sessionVerdict(errors.New("connection refused"), false)
	if v.ok {
		t.Fatal("a database failure was treated as a valid session — an outage would become an " +
			"authorisation bypass on a console that administers live firewalls")
	}
	if v.status != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want 503 so the client knows to retry rather than re-authenticate", v.status)
	}
}

func TestSessionVerdictNeverAllowsOnAnyError(t *testing.T) {
	// Whatever new error shape a driver or a wrapper introduces, the answer is never "allow".
	for _, err := range []error{
		errors.New("timeout"),
		errors.New("sql: database is closed"),
		gorm.ErrInvalidDB,
		gorm.ErrRecordNotFound,
	} {
		for _, revoked := range []bool{false, true} {
			if v := sessionVerdict(err, revoked); v.ok {
				t.Errorf("sessionVerdict(%v, revoked=%v) allowed the request", err, revoked)
			}
		}
	}
}

func TestSessionVerdictAlwaysExplainsItself(t *testing.T) {
	// The message reaches the client and decides what the UI does — re-login on a 401, retry on a
	// 503. An empty one leaves the user staring at a blank failure.
	for _, err := range []error{gorm.ErrRecordNotFound, errors.New("boom")} {
		if v := sessionVerdict(err, false); v.message == "" {
			t.Errorf("no message for %v", err)
		}
	}
	if v := sessionVerdict(nil, true); v.message == "" {
		t.Error("no message for a revoked session")
	}
}
