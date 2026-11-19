package services

import (
	"errors"
	"net"
	"testing"
)

// An admin types this URL and THIS SERVER fetches it. The question is not "is it a URL" but
// "where does it point, and does that address answer differently because WE are the ones asking".

func TestWebhookDestinationsThatAreRefused(t *testing.T) {
	resolve := func(host string) ([]net.IP, error) {
		switch host {
		case "metadata.attacker.example":
			// DNS rebinding: a name the admin was shown, pointing where it should not.
			return []net.IP{net.ParseIP("169.254.169.254")}, nil
		case "localhost.attacker.example":
			return []net.IP{net.ParseIP("127.0.0.1")}, nil
		case "split.attacker.example":
			// One good answer and one bad one must still be refused.
			return []net.IP{net.ParseIP("203.0.113.9"), net.ParseIP("169.254.169.254")}, nil
		case "localhost":
			// What the real resolver answers, which is the whole reason the name is refused.
			return []net.IP{net.ParseIP("127.0.0.1")}, nil
		case "nowhere.example":
			return nil, errors.New("NXDOMAIN")
		}
		return []net.IP{net.ParseIP("203.0.113.10")}, nil
	}

	refused := []struct{ name, url string }{
		{"the cloud metadata service, as a literal", "http://169.254.169.254/latest/meta-data/"},
		{"link-local v6", "http://[fe80::1]/ingest"},
		{"this server itself", "http://127.0.0.1:9000/internal/jobs/1/result"},
		{"this server itself, by name", "http://localhost:9000/x"},
		{"a name that resolves to metadata", "https://metadata.attacker.example/x"},
		{"a name that resolves to loopback", "https://localhost.attacker.example/x"},
		{"a name with one bad answer among good ones", "https://split.attacker.example/x"},
		{"a scheme that reads files", "file:///etc/passwd"},
		{"a scheme that is not a fetch at all", "javascript:alert(1)"},
		{"no host", "https:///ingest"},
		{"not a URL", "not a url"},
		{"nothing", ""},
		{"a name that does not resolve", "https://nowhere.example/x"},
	}
	for _, c := range refused {
		if err := ValidateWebhookURL(c.url, resolve); err == nil {
			t.Errorf("%s: %q was accepted", c.name, c.url)
		} else if !errors.Is(err, ErrWebhookBlocked) {
			t.Errorf("%s: %q gave %v, want ErrWebhookBlocked", c.name, c.url, err)
		}
	}
}

// The deployment this product ships into runs its collector on the LAN. If "SSRF protection" meant
// "no private addresses", the feature would refuse its own supported setup — and the admin setting
// it can already open an SSH session to a firewall from the Config Deploy terminal.
func TestAPrivateLANCollectorIsStillAllowed(t *testing.T) {
	resolve := func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("10.10.20.7")}, nil }

	for _, u := range []string{
		"http://10.0.0.5:8080/ingest",
		"http://192.168.1.50:514/siem",
		"https://172.16.4.4/collector",
		"https://siem.corp.local/ingest",
		"https://hooks.example.com/siem",
	} {
		if err := ValidateWebhookURL(u, resolve); err != nil {
			t.Errorf("%q was refused: %v — an on-premises collector is the normal case here", u, err)
		}
	}
}

// The SETTING must be judgeable without DNS: a collector that is briefly unresolvable is still a
// collector, and refusing to save its address because a lookup was slow would be a worse bug than
// the one this closes.
func TestTheShapeCheckDoesNotNeedDNS(t *testing.T) {
	if err := ValidateWebhookURLShape("https://a-name-that-does-not-exist.invalid/ingest"); err != nil {
		t.Errorf("a name that does not resolve was refused at save time: %v", err)
	}
	// ...but a literal address that is refused anyway must still be caught at save time, where the
	// admin is looking at the form and can be told.
	if err := ValidateWebhookURLShape("http://169.254.169.254/latest/meta-data/"); err == nil {
		t.Error("the metadata address was accepted by the shape check")
	}
	if err := ValidateWebhookURLShape("ftp://example.com/x"); err == nil {
		t.Error("a non-HTTP scheme was accepted by the shape check")
	}
}
