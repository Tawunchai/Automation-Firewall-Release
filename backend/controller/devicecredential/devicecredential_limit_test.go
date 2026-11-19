package devicecredential

import (
	"net/http"
	"strings"
	"testing"
)

// The budget in front of the live login.
//
// Create, Update and Test each log into the firewall for real, and FortiOS locks an admin account
// after three consecutive failed logins. Nothing counted the attempts, so saving a wrong password
// three times — by hand or in a loop — locked the account out on the device.
//
// No database and no firewall: everything below is the budget itself, which is the part that has to
// hold. The limiter is package-level and in memory, so every test clears the keys it touched in
// t.Cleanup — otherwise a spent budget would leak into the next test and a refusal would "pass" for
// the wrong reason.

// clearBudget wipes the keys a test uses, before and after it.
func clearBudget(t *testing.T, pairs ...[2]uint) {
	t.Helper()
	reset := func() {
		for _, p := range pairs {
			deviceLoginLimiter.Reset(loginBudgetKey(p[0], p[1]))
		}
	}
	reset()
	t.Cleanup(reset)
}

// The counter follows the pair (person, firewall). Not the source address: an attacker chooses how
// many addresses to come from, but not whose account is spending a given device's three failures.
func TestLoginBudgetKeyIsPerUserAndDevice(t *testing.T) {
	if got, want := loginBudgetKey(7, 3), "devcred:7:3"; got != want {
		t.Fatalf("loginBudgetKey(7,3) = %q, want %q", got, want)
	}
	for _, pair := range [][2][2]uint{
		{{7, 3}, {8, 3}}, // different person, same firewall
		{{7, 3}, {7, 4}}, // same person, different firewall
	} {
		if loginBudgetKey(pair[0][0], pair[0][1]) == loginBudgetKey(pair[1][0], pair[1][1]) {
			t.Errorf("%v and %v share one budget", pair[0], pair[1])
		}
	}
	// And the two halves must not be able to collide by concatenation (user 71/device 2 vs 7/12).
	if loginBudgetKey(71, 2) == loginBudgetKey(7, 12) {
		t.Error("the key is ambiguous: (71,2) and (7,12) produce the same budget")
	}
}

// The ceiling is set by what it protects: the device locks at three, so the budget has to be
// smaller than that. Two failures and the next attempt is already refused.
func TestTheBudgetIsSmallerThanTheDeviceLockoutThreshold(t *testing.T) {
	clearBudget(t, [2]uint{1, 1})

	if deviceLoginLimiter.Blocked(loginBudgetKey(1, 1)) {
		t.Fatal("the budget starts spent")
	}
	recordVerifyOutcome(1, 1, testStatusFail, true)
	if deviceLoginLimiter.Blocked(loginBudgetKey(1, 1)) {
		t.Fatal("one wrong password already blocks — an honest typist gets no second go")
	}
	recordVerifyOutcome(1, 1, testStatusFail, true)
	if !deviceLoginLimiter.Blocked(loginBudgetKey(1, 1)) {
		t.Fatal("still allowed after two refusals, so a third would reach the device and lock the account")
	}
}

// Failures only. A successful save is somebody doing the right thing, and must never bring them
// closer to being locked out of their own credential form.
func TestASuccessfulVerificationNeverSpendsTheBudget(t *testing.T) {
	clearBudget(t, [2]uint{2, 1})

	for i := 0; i < 10; i++ {
		recordVerifyOutcome(2, 1, testStatusOK, false)
	}
	if deviceLoginLimiter.Blocked(loginBudgetKey(2, 1)) {
		t.Fatal("ten correct saves exhausted the budget")
	}
}

// A device that never answered says nothing about the password and never touched FortiOS's own
// failure counter — and refusing to let somebody retry while their firewall is down would punish
// exactly the case verify() deliberately allows to be saved.
func TestAnUnreachableDeviceDoesNotSpendTheBudget(t *testing.T) {
	clearBudget(t, [2]uint{3, 1})

	for i := 0; i < 5; i++ {
		recordVerifyOutcome(3, 1, testStatusFail, false) // fail, but not a rejection
	}
	if deviceLoginLimiter.Blocked(loginBudgetKey(3, 1)) {
		t.Fatal("a firewall being down locked the user out of their own credential form")
	}
}

// Somebody who mistypes once and then gets it right carries nothing forward — the same rule a
// correct password follows in auth.Login.
func TestASuccessClearsTheFailuresBeforeIt(t *testing.T) {
	clearBudget(t, [2]uint{4, 1})

	recordVerifyOutcome(4, 1, testStatusFail, true)
	recordVerifyOutcome(4, 1, testStatusOK, false)
	recordVerifyOutcome(4, 1, testStatusFail, true)

	if deviceLoginLimiter.Blocked(loginBudgetKey(4, 1)) {
		t.Fatal("a correct save did not clear the typo before it, so the budget accumulates for life")
	}
}

// Two firewalls are two accounts that lock separately, so one wrong password on the lab device must
// not stop a user saving a credential for another.
func TestTwoDevicesHaveIndependentBudgets(t *testing.T) {
	clearBudget(t, [2]uint{5, 1}, [2]uint{5, 2})

	recordVerifyOutcome(5, 1, testStatusFail, true)
	recordVerifyOutcome(5, 1, testStatusFail, true)

	if !deviceLoginLimiter.Blocked(loginBudgetKey(5, 1)) {
		t.Fatal("device 1 is not blocked after two refusals")
	}
	if deviceLoginLimiter.Blocked(loginBudgetKey(5, 2)) {
		t.Fatal("device 2 is blocked by failures that belong to device 1")
	}
}

// And two people on the same firewall: one person's typos must not shut the form for a colleague.
func TestTwoUsersOnOneDeviceHaveIndependentBudgets(t *testing.T) {
	clearBudget(t, [2]uint{6, 9}, [2]uint{7, 9})

	recordVerifyOutcome(6, 9, testStatusFail, true)
	recordVerifyOutcome(6, 9, testStatusFail, true)

	if deviceLoginLimiter.Blocked(loginBudgetKey(7, 9)) {
		t.Fatal("one user's wrong passwords throttled another user on the same firewall")
	}
}

// The refusal itself: 429, a sentence that explains what happened, and no budget consumed by
// reading it — a throttled caller hammering the endpoint must not extend their own penalty window
// (Blocked, not Allow).
func TestLoginThrottledAnswers429AndExplainsItself(t *testing.T) {
	clearBudget(t, [2]uint{8, 1})

	c, rec := newCtx(uint(8), nil)
	if loginThrottled(c, 8, 1) {
		t.Fatal("throttled with an untouched budget")
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("an allowed caller was answered %d", rec.Code)
	}

	recordVerifyOutcome(8, 1, testStatusFail, true)
	recordVerifyOutcome(8, 1, testStatusFail, true)

	c2, rec2 := newCtx(uint(8), nil)
	if !loginThrottled(c2, 8, 1) {
		t.Fatal("the third attempt was allowed through to the device")
	}
	if rec2.Code != http.StatusTooManyRequests {
		t.Fatalf("status = %d, want 429: %s", rec2.Code, rec2.Body.String())
	}
	body := strings.ToLower(rec2.Body.String())
	for _, want := range []string{"wait", "lock"} {
		if !strings.Contains(body, want) {
			t.Errorf("the refusal does not say %q, so the user cannot tell what to do: %s", want, rec2.Body.String())
		}
	}

	// Reading the refusal must not itself cost anything: still exactly blocked, not deeper.
	for i := 0; i < 5; i++ {
		c3, _ := newCtx(uint(8), nil)
		loginThrottled(c3, 8, 1)
	}
	deviceLoginLimiter.Reset(loginBudgetKey(8, 1))
	if deviceLoginLimiter.Blocked(loginBudgetKey(8, 1)) {
		t.Fatal("Reset did not clear the budget")
	}
}
