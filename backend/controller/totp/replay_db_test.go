package totp

import (
	"net/http"
	"strings"
	"testing"
	"time"

	otplib "github.com/pquerna/otp/totp"
	"network_automation/services/platform"
)

// Spending a TOTP code exactly once, on the ENROLMENT path.
//
// A code is valid for its own 30-second step and one step either side, so the same six digits work
// for about 90 seconds. The sign-in endpoint has refused a repeat since 2026-11-13; this endpoint
// never did, so a code used to confirm an enrolment could be presented again here — or, worse,
// replayed at the sign-in endpoint, because the two kept no shared record of what had been spent.
//
// Both now claim out of UserTOTP.LastTOTPStep, which is what these tests look at.
//
// Skipped unless TOTP_DB_TEST_DSN is set — the container is in the header of totp_db_test.go.

func TestSetupVerifyRecordsTheStepItSpent(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	secret := enrolledSecret(t, db, userID)

	now := time.Now()
	code, err := otplib.GenerateCode(secret, now)
	if err != nil {
		t.Fatalf("generate a code: %v", err)
	}

	c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+code+`"}`)
	SetupVerify(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200: %s", rec.Code, rec.Body.String())
	}

	// The step must be PERSISTED, not held in the process: a restart used to reopen the whole
	// window, and two backend replicas each kept their own idea of what had been used.
	row := storedTOTP(t, db, userID)
	want := platform.TOTPStepAt(now)
	if row.LastTOTPStep != want {
		t.Fatalf("stored last_totp_step = %d, want %d — the code was accepted without being spent",
			row.LastTOTPStep, want)
	}
}

// RFC 6238 §5.2: a verifier accepts each code once. The second presentation is refused, and it is
// refused in the same words as a wrong code — "already used" would confirm to whoever captured the
// digits that they were the right ones.
func TestSetupVerifyRefusesTheSameCodeASecondTime(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	code := currentCode(t, enrolledSecret(t, db, userID))

	c1, rec1 := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+code+`"}`)
	SetupVerify(c1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("the first use answered %d, want 200: %s", rec1.Code, rec1.Body.String())
	}

	c2, rec2 := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+code+`"}`)
	SetupVerify(c2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("the SAME code was accepted twice (status %d) — it stays replayable for its whole "+
			"~90s window: %s", rec2.Code, rec2.Body.String())
	}
	if body := strings.ToLower(rec2.Body.String()); strings.Contains(body, "already") || strings.Contains(body, "used") {
		t.Errorf("the refusal admits the digits were right: %s", body)
	}
}

// Monotonic, not merely "not this one". Once a step has been spent, a code from an EARLIER step —
// still inside the skew, so still arithmetically valid — must not work either. A record keyed on
// the digits allowed exactly that.
func TestSetupVerifyRefusesACodeFromAnEarlierStep(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	secret := enrolledSecret(t, db, userID)

	now := time.Now()
	previous, err := otplib.GenerateCode(secret, now.Add(-30*time.Second))
	if err != nil {
		t.Fatalf("generate the previous step's code: %v", err)
	}
	current, err := otplib.GenerateCode(secret, now)
	if err != nil {
		t.Fatalf("generate this step's code: %v", err)
	}
	if previous == current {
		t.Skip("the two steps produced the same digits — nothing to tell apart")
	}

	c1, rec1 := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+current+`"}`)
	SetupVerify(c1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("the current code answered %d, want 200: %s", rec1.Code, rec1.Body.String())
	}

	c2, rec2 := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+previous+`"}`)
	SetupVerify(c2)
	if rec2.Code != http.StatusBadRequest {
		t.Fatalf("a code from the previous step was accepted after a later one (status %d): %s",
			rec2.Code, rec2.Body.String())
	}
}

// A wrong code must not move the record. Otherwise five fat-fingered attempts could push the
// stored step forward and lock a user out of their own authenticator.
func TestAWrongCodeDoesNotSpendAnything(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)

	for _, code := range []string{"000000", "123456", "999999"} {
		c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user", `{"code":"`+code+`"}`)
		SetupVerify(c)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("code %q answered %d, want 400: %s", code, rec.Code, rec.Body.String())
		}
	}
	if step := storedTOTP(t, db, userID).LastTOTPStep; step != 0 {
		t.Fatalf("a refused code advanced last_totp_step to %d", step)
	}

	// And the real code still works afterwards.
	c, rec := as(http.MethodPost, "/totp/setup-verify", userID, "user",
		`{"code":"`+currentCode(t, enrolledSecret(t, db, userID))+`"}`)
	SetupVerify(c)
	if rec.Code != http.StatusOK {
		t.Fatalf("the real code answered %d after three wrong ones: %s", rec.Code, rec.Body.String())
	}
}

// Enrolling again clears the record with the row. The new seed's steps are the same NUMBERS as the
// old seed's, so a step left behind from a previous enrolment would refuse the first code of the
// new one — which is the screen that says "invalid code" immediately after showing you the QR.
func TestReEnrollingStartsWithNothingSpent(t *testing.T) {
	db, userID := totpTestDB(t)

	c0, _ := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c0)
	cv, recv := as(http.MethodPost, "/totp/setup-verify", userID, "user",
		`{"code":"`+currentCode(t, enrolledSecret(t, db, userID))+`"}`)
	SetupVerify(cv)
	if recv.Code != http.StatusOK {
		t.Fatalf("first enrolment = %d: %s", recv.Code, recv.Body.String())
	}

	c1, rec1 := as(http.MethodPost, "/totp/setup-init", userID, "user", "")
	SetupInit(c1)
	if rec1.Code != http.StatusOK {
		t.Fatalf("second setup-init = %d: %s", rec1.Code, rec1.Body.String())
	}
	if step := storedTOTP(t, db, userID).LastTOTPStep; step != 0 {
		t.Fatalf("a fresh enrolment starts with last_totp_step = %d, want 0", step)
	}

	c2, rec2 := as(http.MethodPost, "/totp/setup-verify", userID, "user",
		`{"code":"`+currentCode(t, enrolledSecret(t, db, userID))+`"}`)
	SetupVerify(c2)
	if rec2.Code != http.StatusOK {
		t.Fatalf("the first code of a re-enrolment answered %d, want 200: %s", rec2.Code, rec2.Body.String())
	}
}
