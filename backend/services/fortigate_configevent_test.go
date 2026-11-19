package services

import "testing"

func TestSplitLogUI(t *testing.T) {
	cases := []struct{ in, via, ip string }{
		{"ssh(10.10.20.164)", "ssh", "10.10.20.164"},
		{"GUI(10.113.111.10)", "GUI", "10.113.111.10"},
		{"jsconsole", "jsconsole", ""},
		{"", "", ""},
		// Unrecognised shapes are kept whole rather than dropped: losing "somebody changed it"
		// because the format was unfamiliar is the worst outcome available here.
		{"ha(", "ha(", ""},
		{"ndc(fe80::1%port1)", "ndc", "fe80::1%port1"},
	}
	for _, tc := range cases {
		via, ip := splitLogUI(tc.in)
		if via != tc.via || ip != tc.ip {
			t.Errorf("splitLogUI(%q) = (%q, %q), want (%q, %q)", tc.in, via, ip, tc.via, tc.ip)
		}
	}
}
