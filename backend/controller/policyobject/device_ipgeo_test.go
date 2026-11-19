package policyobject

import (
	"strings"
	"testing"
)

func TestParseIPBatch_CleansTrimsAndDedups(t *testing.T) {
	got := parseIPBatch(" 8.8.8.8 , 1.1.1.1,8.8.8.8 ,, not-an-ip ,192.168.1.1", 64)
	want := []string{"8.8.8.8", "1.1.1.1", "192.168.1.1"}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v (order preserved, first-seen wins)", got, want)
		}
	}
}

func TestParseIPBatch_Caps(t *testing.T) {
	// 100 distinct addresses, asked to cap at 3.
	var b strings.Builder
	for i := 0; i < 100; i++ {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString("10.0.0.")
		b.WriteByte(byte('0' + i%10)) // not all distinct, but enough are
	}
	if got := parseIPBatch("1.2.3.4,5.6.7.8,9.10.11.12,13.14.15.16", 3); len(got) != 3 {
		t.Fatalf("cap=3 returned %d entries: %v", len(got), got)
	}
	if got := parseIPBatch("", 64); len(got) != 0 {
		t.Fatalf("empty query returned %v, want nothing", got)
	}
	if got := parseIPBatch("garbage, also garbage", 64); len(got) != 0 {
		t.Fatalf("no valid IPs returned %v, want nothing", got)
	}
}
