package services

import (
	"strings"
	"testing"
)

// WHICH INTERFACE IS "WAN"?
//
// The lab FGT80E answers that question two different ways, and until this marker existed the model
// had to guess which one the user meant:
//
//	port1 | External | lan | 10.0.99.201/22   <- holds the only default route
//	wan1  | WAN1     | wan | 172.200.200.1/30    role says wan, but no route points out of it
//
// A policy built on wan1 there carries no traffic at all, and one built on port1 looks wrong to
// anyone reading the role column. The interface list is also the block that sits BEFORE the prompt's
// inventory truncation while STATIC ROUTES sits after it, so "join the two lists yourself" was never
// a safe instruction. These tests pin the tag onto the interface row and pin the tie-break into the
// rules, because both are invisible failures: a wrong egress interface produces a policy the device
// accepts and the traffic never meets.

func ifaceFix() []FGSystemInterface {
	return []FGSystemInterface{
		{Name: "port1", Alias: "External", Role: "lan", IP: "10.0.99.201/22", Type: "physical"},
		{Name: "lan", Role: "lan", IP: "192.168.1.99/24", Type: "physical"},
		{Name: "wan1", Alias: "WAN1", Role: "wan", IP: "172.200.200.1/30", Type: "physical"},
		{Name: "tun-hq", Role: "wan", IP: "10.254.0.1/32", Type: "tunnel"},
	}
}

func defaultVia(dev string) FGStaticRoute {
	return FGStaticRoute{SeqNum: 2, DstType: "subnet", Dst: "0.0.0.0/0", Gateway: "10.0.99.1", Device: dev, Enabled: true}
}

func TestDefaultRouteIfaces(t *testing.T) {
	cases := []struct {
		name   string
		routes []FGStaticRoute
		want   []string
	}{
		{"the lab device: the way out is not the wan-role port", []FGStaticRoute{defaultVia("port1")}, []string{"port1"}},
		{"a specific subnet is not a way out", []FGStaticRoute{
			{DstType: "subnet", Dst: "10.20.0.0/16", Device: "lan", Enabled: true},
		}, nil},
		{"a disabled default route is not a way out", []FGStaticRoute{
			{DstType: "subnet", Dst: "0.0.0.0/0", Device: "wan1", Enabled: false},
		}, nil},
		{"a blackhole default route is not a way out", []FGStaticRoute{
			{DstType: "subnet", Dst: "0.0.0.0/0", Device: "wan2", Enabled: true, Blackhole: true},
		}, nil},
		{"dual WAN: both are ways out", []FGStaticRoute{
			defaultVia("port1"), defaultVia("wan1"),
		}, []string{"port1", "wan1"}},
		{"an internet-service route names no destination subnet", []FGStaticRoute{
			{DstType: "internet-service", InternetService: 65643, Device: "wan1", Enabled: true},
		}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := defaultRouteIfaces(c.routes)
			if len(got) != len(c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			for _, w := range c.want {
				if !got[w] {
					t.Errorf("%q missing from %v", w, got)
				}
			}
		})
	}
}

func TestInterfacesContextTagsTheWayOut(t *testing.T) {
	out := interfacesContext(ifaceFix(), defaultRouteIfaces([]FGStaticRoute{defaultVia("port1")}))

	var port1, wan1 string
	for _, line := range strings.Split(out, "\n") {
		switch {
		case strings.HasPrefix(line, "  - port1 "):
			port1 = line
		case strings.HasPrefix(line, "  - wan1 "):
			wan1 = line
		}
	}
	if port1 == "" || wan1 == "" {
		t.Fatalf("interface rows missing:\n%s", out)
	}
	if !strings.Contains(port1, "<- DEFAULT ROUTE") {
		t.Errorf("port1 holds the default route but is not tagged: %q", port1)
	}
	if strings.Contains(wan1, "<- DEFAULT ROUTE") {
		t.Errorf("wan1 holds no default route but is tagged: %q", wan1)
	}
	// The name is what goes in srcintf/dstintf; the alias must never be mistaken for it.
	if !strings.HasPrefix(port1, "  - port1 | External | lan |") {
		t.Errorf("name-first column order changed: %q", port1)
	}
	// A tunnel is not an egress choice for a firewall policy and was always excluded.
	if strings.Contains(out, "tun-hq") {
		t.Error("tunnel interfaces must stay out of the list")
	}
}

func TestInterfacesContextSaysWhenThereIsNoWayOut(t *testing.T) {
	out := interfacesContext(ifaceFix(), defaultRouteIfaces(nil))
	if strings.Contains(out, "<- DEFAULT ROUTE") {
		t.Error("nothing may be tagged when the device has no default route")
	}
	if !strings.Contains(out, "no enabled default route") {
		t.Errorf("the model must be told the tag is absent rather than left to infer from role:\n%s", out)
	}
	// Empty device: no header, no invented rows.
	if interfacesContext(nil, nil) != "" {
		t.Error("an unreadable interface list must contribute nothing")
	}
}

func TestStaticRoutesContextTakesTheRoutesItIsGiven(t *testing.T) {
	if staticRoutesContext(nil) != "" {
		t.Error("no routes must contribute no section")
	}
	out := staticRoutesContext([]FGStaticRoute{defaultVia("port1")})
	for _, want := range []string{"STATIC ROUTES", "0.0.0.0/0", "port1", "the default route"} {
		if !strings.Contains(out, want) {
			t.Errorf("routes section no longer mentions %q:\n%s", want, out)
		}
	}
}

// The tag is only half the fix: the rules have to say what to do when role and route disagree, and
// that the user naming an interface outranks both.
func TestEgressInterfacePromptRules(t *testing.T) {
	for _, want := range []string{
		"<- DEFAULT ROUTE",            // the model is pointed at the tag, not at the role field
		"THE USER'S OWN WORD WINS",    // "make it on wan1" means wan1, route or no route
		"AMBIGUOUS \"WAN\"",           // the tie-break exists
		"Never resolve this silently", // and the choice has to be stated in the answer
	} {
		if !strings.Contains(objectReuseConditions, want) {
			t.Errorf("interface-inference rules no longer mention %q", want)
		}
	}
}
