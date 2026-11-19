package services

import (
	"testing"
	"time"
)

// The cache saves a 25-second model call and a couple of thousand tokens on every repeat view. What
// it must never do is save one after the firewall has moved — the whole reason it is keyed on the
// configuration fingerprint rather than on a clock.

func advice(risk string) RemediationAdvice { return RemediationAdvice{Risk: risk} }

func TestAdviceIsReusedForTheSameConfiguration(t *testing.T) {
	resetAdviceCache()
	StoreAdvice(1, "A.8.15", "fp-aaa", advice("first"))

	got, at, ok := CachedAdvice(1, "A.8.15", "fp-aaa")
	if !ok {
		t.Fatal("the same device, control and configuration should hit")
	}
	if got.Risk != "first" {
		t.Errorf("got %q", got.Risk)
	}
	if time.Since(at) > time.Minute {
		t.Errorf("the timestamp should be when it was produced, got %v", at)
	}
}

func TestAdviceIsNotReusedAfterTheFirewallChanges(t *testing.T) {
	// The failure this prevents: somebody fixes a policy, reopens the panel, and is shown advice
	// formed against the configuration they just changed.
	resetAdviceCache()
	StoreAdvice(1, "A.8.15", "fp-aaa", advice("before the change"))

	if _, _, ok := CachedAdvice(1, "A.8.15", "fp-bbb"); ok {
		t.Error("a different configuration fingerprint must miss")
	}
}

func TestAdviceIsNotSharedAcrossDevicesOrControls(t *testing.T) {
	resetAdviceCache()
	StoreAdvice(1, "A.8.15", "fp-aaa", advice("device one"))

	if _, _, ok := CachedAdvice(2, "A.8.15", "fp-aaa"); ok {
		t.Error("another device must miss, however similar its configuration")
	}
	if _, _, ok := CachedAdvice(1, "A.8.2", "fp-aaa"); ok {
		t.Error("another control must miss")
	}
}

func TestAnUnidentifiedConfigurationIsNeverCached(t *testing.T) {
	// No fingerprint means the scan could not identify the configuration, so nothing proves the
	// firewall has not moved since. Reusing an answer would be a guess.
	resetAdviceCache()
	StoreAdvice(1, "A.8.15", "", advice("unanchored"))

	if _, _, ok := CachedAdvice(1, "A.8.15", ""); ok {
		t.Error("an empty fingerprint must always miss")
	}
}

func TestTheCacheIsBounded(t *testing.T) {
	resetAdviceCache()
	for i := 0; i < adviceCacheMax+25; i++ {
		StoreAdvice(uint(i), "A.8.15", "fp", advice("x"))
	}
	adviceCache.mu.Lock()
	n := len(adviceCache.m)
	adviceCache.mu.Unlock()
	if n > adviceCacheMax {
		t.Errorf("cache grew to %d entries, cap is %d", n, adviceCacheMax)
	}
}
