package services

import (
	"strings"
	"testing"
	"unicode/utf8"

	"network_automation/services/platform"
)

// The Thai fixture, kept here rather than shared: the same 13-rune / 39-byte string also drives
// services/platform/text_test.go, and a test fixture that two packages reach for is a third place
// to keep in step.
const thaiSample = "สาขาเชียงใหม่"

// The prompt builder uses platform.RuneSafeCut directly with its own suffix. Pin the same guarantee there,
// because that call site is the one whose corruption is silent — a truncated object name still
// looks like a name, and the model quotes it back at a device that has no such object.
func TestInventoryTruncation_IsRuneSafe(t *testing.T) {
	// A device inventory line as buildLiveDeviceContext assembles it, repeated past the budget.
	line := "  - " + thaiSample + "-LAN | ipmask 10.0.0.0/24\n"
	inventory := strings.Repeat(line, 400)
	if len(inventory) <= inventoryBudget {
		t.Fatalf("test premise is wrong: sample is %d bytes, under the %d budget", len(inventory), inventoryBudget)
	}

	out := inventory[:platform.RuneSafeCut(inventory, inventoryBudget)] + "\n… (truncated)"

	if !utf8.ValidString(out) {
		t.Error("truncated device inventory is not valid UTF-8 — the model would receive U+FFFD")
	}
	if len(out) > inventoryBudget+len("\n… (truncated)") {
		t.Errorf("truncated inventory is %d bytes, over the %d budget", len(out), inventoryBudget)
	}
}
