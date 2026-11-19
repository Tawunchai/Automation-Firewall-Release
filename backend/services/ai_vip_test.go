package services

import (
	"strings"
	"testing"
)

// The prompt is what actually teaches the model to build a VIP; these pin the parts a future edit
// must not lose. (There is no numeric mapping to unit-test here — a VIP is created through the
// structured REST path, whose payload is covered by fortigate_vip_test.go.)
func TestVIPPromptRules(t *testing.T) {
	p := platformPrompts["fortinet"].CLIReference
	for _, want := range []string{
		"config firewall vip",          // the object
		"set extip",                    // external side
		"set mappedip",                 // internal side
		"set portforward",              // port forward
		`set dstaddr "Web-Server-VIP"`, // ⚠️ the crux: a VIP is referenced in the policy DESTINATION
		"set nat disable",              // never source-NAT an inbound VIP policy
	} {
		if !strings.Contains(p, want) {
			t.Errorf("VIP CLI reference no longer mentions %q — the model needs it", want)
		}
	}

	// The -34 duplicate-extip constraint must stay in the reuse guidance, or the model makes twins.
	if !strings.Contains(p, "-34") {
		t.Error("VIP rules no longer warn about the duplicate-extip -34 error")
	}
}
