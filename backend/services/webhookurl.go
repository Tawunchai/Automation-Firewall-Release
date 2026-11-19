package services

import (
	"errors"
	"fmt"
	"net"
	"net/url"
	"strings"
)

// Where an admin-configured webhook is allowed to point.
//
// The SIEM export takes a URL from an admin and this server fetches it. That is a request made
// from INSIDE the network, by a process holding this app's secrets — i.e. server-side request
// forgery, with an admin as the one supplying the URL.
//
// ── Why this does not block private addresses ────────────────────────────────
//
// The usual SSRF advice is "refuse anything that resolves to a private range". It is wrong here:
// this is an on-premises console and a SIEM collector on 10.x or 192.168.x is the NORMAL case —
// the product would be refusing its own supported deployment. The admin who sets this URL can
// already open an SSH session to a firewall from the Config Deploy terminal, so reaching a host
// on the LAN is not an escalation.
//
// What IS an escalation is reaching an address that answers differently BECAUSE the request came
// from this process:
//
//   - 169.254.169.254 and the rest of link-local: the cloud instance metadata service. On a hosted
//     deployment it hands out the VM's identity credentials to anything that asks from the host.
//     No SIEM lives there.
//   - the loopback range: this server's own unauthenticated internal surface, reachable with no
//     cookie and no worker secret because the request originates locally.
//
// Neither is a plausible destination for a log forwarder, so refusing them costs nothing real.
//
// ── Why it is checked at BOTH ends ───────────────────────────────────────────
//
// Once when the setting is saved, so an admin is told immediately, and again in the sender, where
// the hostname is resolved. A name checked at save time can point at a different address by the
// time it is used (DNS rebinding), and the stored value also predates this check.

// ErrWebhookBlocked is returned for a URL this server will not fetch.
var ErrWebhookBlocked = errors.New("this webhook address cannot be used")

// ValidateWebhookURLShape checks everything that can be judged from the URL alone: the scheme, the
// presence of a host, and — when the host is written as a literal address — whether that address
// is one this server refuses.
//
// This is the check the SETTING uses. It deliberately does NOT resolve names: a collector that is
// briefly unresolvable from the backend is a perfectly good collector, and refusing to SAVE its
// address because DNS was slow would be a worse bug than the one this file closes.
func ValidateWebhookURLShape(raw string) error {
	_, _, err := parseWebhookURL(raw)
	return err
}

// parseWebhookURL does the name-free half and returns the host for the caller to resolve.
func parseWebhookURL(raw string) (*url.URL, string, error) {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return nil, "", fmt.Errorf("%w: it is not a URL", ErrWebhookBlocked)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		// file://, gopher:// and friends are the classic way to turn a fetch into a read.
		return nil, "", fmt.Errorf("%w: only http and https are supported", ErrWebhookBlocked)
	}
	host := u.Hostname()
	if host == "" {
		return nil, "", fmt.Errorf("%w: it names no host", ErrWebhookBlocked)
	}
	if ip := net.ParseIP(host); ip != nil {
		if why := blockedWebhookIP(ip); why != "" {
			return nil, "", fmt.Errorf("%w: %s is %s", ErrWebhookBlocked, ip, why)
		}
	}
	return u, host, nil
}

// ValidateWebhookURL is the full check: the shape, plus every address the host resolves to.
//
// resolve is injectable so the rule can be tested without DNS. Pass nil for the real resolver.
func ValidateWebhookURL(raw string, resolve func(string) ([]net.IP, error)) error {
	u, host, err := parseWebhookURL(raw)
	if err != nil {
		return err
	}
	_ = u
	// A literal address was already judged above and must not get a lookup: a resolver that fails
	// on a literal would otherwise let it through.
	if ip := net.ParseIP(host); ip != nil {
		return nil
	}
	if resolve == nil {
		resolve = func(h string) ([]net.IP, error) { return net.LookupIP(h) }
	}

	ips, err := resolve(host)
	if err != nil {
		return fmt.Errorf("%w: %s does not resolve", ErrWebhookBlocked, host)
	}
	if len(ips) == 0 {
		return fmt.Errorf("%w: %s resolves to no address", ErrWebhookBlocked, host)
	}

	for _, ip := range ips {
		if why := blockedWebhookIP(ip); why != "" {
			return fmt.Errorf("%w: %s resolves to %s, which is %s", ErrWebhookBlocked, host, ip, why)
		}
	}
	return nil
}

// blockedWebhookIP names why an address is refused, or "" if it is allowed.
func blockedWebhookIP(ip net.IP) string {
	switch {
	case ip.IsLoopback():
		return "this server itself — its internal endpoints answer a local caller without a session"
	case ip.IsLinkLocalUnicast(), ip.IsLinkLocalMulticast():
		// Covers 169.254.0.0/16 and fe80::/10, so the cloud metadata service is included.
		return "link-local: on a hosted deployment this is the instance metadata service, which " +
			"hands out the machine's own credentials"
	case ip.IsUnspecified():
		return "the unspecified address"
	case ip.IsInterfaceLocalMulticast(), ip.IsMulticast():
		return "a multicast address, which is not a webhook receiver"
	}
	return ""
}
