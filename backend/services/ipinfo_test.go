package services

import (
	"net"
	"testing"
)

func TestClassifyIP(t *testing.T) {
	cases := []struct {
		ip   string
		kind string
	}{
		{"8.8.8.8", "public"},
		{"180.183.12.52", "public"},
		{"10.10.20.1", "private"},
		{"192.168.1.50", "private"},
		{"172.16.5.4", "private"},
		{"172.32.0.1", "public"}, // just outside 172.16/12
		{"100.64.0.1", "cgnat"},
		{"100.127.255.254", "cgnat"},
		{"127.0.0.1", "loopback"},
		{"169.254.1.1", "link-local"},
		{"239.1.1.1", "multicast"}, // admin-scoped multicast (224.0.0.1 is link-local multicast)
		{"0.0.0.0", "unspecified"},
	}
	for _, tc := range cases {
		got := ClassifyIP(net.ParseIP(tc.ip)).Kind
		if got != tc.kind {
			t.Errorf("ClassifyIP(%s) = %q, want %q", tc.ip, got, tc.kind)
		}
	}
}

func TestClassifyIPNilIsUnknown(t *testing.T) {
	if got := ClassifyIP(net.ParseIP("not-an-ip")).Kind; got != "unknown" {
		t.Errorf("ClassifyIP(invalid) = %q, want unknown", got)
	}
}
