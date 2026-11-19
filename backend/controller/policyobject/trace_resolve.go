package policyobject

import (
	"context"
	"errors"
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"
)

// A hostname as the trace destination: "why can't I reach facebook.com?" is how the question
// arrives, and making the operator look the address up first was a step the console can take.
//
// It is resolved HERE, by the console's own resolver — FortiOS 7.2.10 has no nslookup over REST
// (see the diagnostics notes). That is a different resolver from the firewall's, and for a name
// behind a CDN the two can legitimately answer with different addresses, so the page shows which
// address was traced instead of pretending the name itself was.

// errTraceHost marks a destination that is neither an address nor a name that resolves: the
// caller's input, so a 400 rather than a device failure.
var errTraceHost = errors.New("destination")

// hostnameRE is an RFC 1123 host name with at least one dot: labels of letters, digits and
// hyphens, none starting or ending with a hyphen.
var hostnameRE = regexp.MustCompile(`^(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(?:\.(?i:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?))+$`)

// traceLookup is the resolver, swappable in tests.
var traceLookup = func(ctx context.Context, host string) ([]net.IPAddr, error) {
	return net.DefaultResolver.LookupIPAddr(ctx, host)
}

// resolveTraceDestination returns the address to trace. An address passes through untouched; a
// host name is resolved, IPv4 first (the trace and the fix planner are IPv4), and every answer is
// returned so the page can say the name had more than one.
func resolveTraceDestination(ctx context.Context, dst string) (ip, host string, all []string, err error) {
	dst = strings.TrimSpace(dst)
	if dst == "" || net.ParseIP(dst) != nil {
		return dst, "", nil, nil
	}
	host = strings.TrimSuffix(strings.ToLower(dst), ".")
	if len(host) > 253 || !hostnameRE.MatchString(host) {
		return "", "", nil, fmt.Errorf("%w: %q is not a valid destination IP address or host name", errTraceHost, dst)
	}
	ctx, cancel := context.WithTimeout(ctx, 4*time.Second)
	defer cancel()
	addrs, lookErr := traceLookup(ctx, host)
	if lookErr != nil || len(addrs) == 0 {
		return "", "", nil, fmt.Errorf("%w: %s has no DNS answer from this console — enter its IP address instead", errTraceHost, host)
	}
	var v4, v6 []string
	for _, a := range addrs {
		if a.IP.To4() != nil {
			v4 = append(v4, a.IP.String())
		} else {
			v6 = append(v6, a.IP.String())
		}
	}
	all = append(v4, v6...)
	return all[0], host, all, nil
}
