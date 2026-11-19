package platform

import "testing"

// The host-key rule, pinned without a network or a database.
//
// Three outcomes, and the one that must never be reached by accident is "a key that changed is
// accepted". Every SSH connection this console makes carries a firewall's administrator password,
// so the difference between refusing and accepting a changed key is the difference between an
// intercepted connection failing and it succeeding with the credential in hand.
func TestHostKeyDecision(t *testing.T) {
	const seen = "SHA256:abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG"
	const other = "SHA256:ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ"

	cases := []struct {
		name      string
		stored    string
		presented string
		want      hostKeyVerdict
		why       string
	}{
		{
			name: "never connected before", stored: "", presented: seen, want: hostKeyPin,
			why: "trust on first use: nobody can verify the first key, so remember it",
		},
		{
			name: "same device as last time", stored: seen, presented: seen, want: hostKeyMatch,
			why: "the ordinary case, every connection after the first",
		},
		{
			name: "the key changed", stored: seen, presented: other, want: hostKeyChange,
			why: "an interception and a re-keyed firewall look identical; both must stop the connection",
		},
		{
			name: "an empty key from the device is still a change", stored: seen, presented: "",
			want: hostKeyChange,
			why:  "the pin is compared against what arrived, not the other way round — an empty presented value must never read as 'no pin yet'",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := hostKeyDecision(tc.stored, tc.presented); got != tc.want {
				t.Errorf("decision = %v, want %v — %s", got, tc.want, tc.why)
			}
		})
	}
}

// There is no "accept and re-pin" path, deliberately.
//
// The tempting shortcut when a firmware upgrade regenerates a key is to accept the new one and
// update the row. That makes the check decorative: an attacker who can present a key once can
// present it repeatedly, and the console would pin theirs on the first attempt and then happily
// verify against it forever.
func TestHostKeyChangeIsNeverSilentlyAccepted(t *testing.T) {
	stored := "SHA256:original"
	for i := 0; i < 5; i++ {
		if got := hostKeyDecision(stored, "SHA256:attacker"); got != hostKeyChange {
			t.Fatalf("attempt %d: a changed key was not refused (%v)", i+1, got)
		}
	}
}

// With no store wired, the callback must refuse rather than wave the connection through. A
// boot-order mistake in main.go should be a loud failure, not a silent return to accepting any key.
func TestHostKeyCallbackRefusesWithoutAStore(t *testing.T) {
	saved := hostKeyStore()
	SetHostKeyStore(nil)
	defer SetHostKeyStore(saved)

	err := VerifyOrPinHostKey("FortiGate-80E")("10.0.99.201:22", nil, nil)
	if err == nil {
		t.Fatal("the callback accepted a connection with no host-key store configured")
	}
}
