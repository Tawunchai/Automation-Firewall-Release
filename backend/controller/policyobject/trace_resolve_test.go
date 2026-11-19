package policyobject

import (
	"context"
	"errors"
	"net"
	"testing"
)

func withLookup(t *testing.T, fn func(ctx context.Context, host string) ([]net.IPAddr, error)) {
	t.Helper()
	orig := traceLookup
	traceLookup = fn
	t.Cleanup(func() { traceLookup = orig })
}

func TestResolveTraceDestination_AddressesPassThrough(t *testing.T) {
	withLookup(t, func(context.Context, string) ([]net.IPAddr, error) {
		t.Fatal("an address must not be looked up")
		return nil, nil
	})
	for _, in := range []string{"8.8.8.8", " 192.168.1.60 ", "2001:4860::8888"} {
		ip, host, all, err := resolveTraceDestination(context.Background(), in)
		if err != nil || host != "" || all != nil || net.ParseIP(ip) == nil {
			t.Errorf("%q → ip %q host %q all %v err %v", in, ip, host, all, err)
		}
	}
}

func TestResolveTraceDestination_ResolvesANamePreferringIPv4(t *testing.T) {
	withLookup(t, func(_ context.Context, host string) ([]net.IPAddr, error) {
		if host != "facebook.com" {
			t.Fatalf("looked up %q, want the name lower-cased without its trailing dot", host)
		}
		return []net.IPAddr{{IP: net.ParseIP("2a03:2880::1")}, {IP: net.ParseIP("157.240.1.35")}, {IP: net.ParseIP("157.240.1.36")}}, nil
	})
	ip, host, all, err := resolveTraceDestination(context.Background(), "Facebook.com.")
	if err != nil {
		t.Fatal(err)
	}
	if ip != "157.240.1.35" || host != "facebook.com" {
		t.Fatalf("ip %q host %q, want the first IPv4 answer", ip, host)
	}
	if len(all) != 3 || all[0] != "157.240.1.35" || all[2] != "2a03:2880::1" {
		t.Fatalf("all = %v, want every answer, IPv4 first", all)
	}
}

func TestResolveTraceDestination_RefusesWhatIsNotAHost(t *testing.T) {
	withLookup(t, func(context.Context, string) ([]net.IPAddr, error) { return nil, errors.New("no such host") })
	for _, in := range []string{"not a host", "localhost", "-bad.example.com", "a..b.com", "http://x.com/path", "no-such.example"} {
		if _, _, _, err := resolveTraceDestination(context.Background(), in); err == nil || !errors.Is(err, errTraceHost) {
			t.Errorf("%q: want a destination error, got %v", in, err)
		}
	}
}
