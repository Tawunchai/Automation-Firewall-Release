package services

import (
	"strings"
	"testing"
)

// The digest is the only thing that reaches the model, so what these pin is mostly about what it
// must NOT contain and must NOT claim.

func digestRow(over func(*FGTrafficLog)) FGTrafficLog {
	r := FGTrafficLog{
		Timestamp:  1788890109000,
		VDom:       "root",
		SrcIP:      "10.0.99.201",
		SrcIntf:    "root",
		DstIP:      "173.243.140.16",
		DstIntf:    "port1",
		DstHost:    "globalguardservice.fortinet.net",
		DstPort:    intp(443),
		DstCountry: "United States",
		ProtoName:  "TCP",
		Action:     "accept",
		Service:    "HTTPS",
		SentByte:   4000,
		RcvdByte:   9000,
		PolicyID:   intp(0),
		Policy:     &LogPolicyRef{Implicit: true, LocalIn: true, Action: "accept", Exists: true},
	}
	if over != nil {
		over(&r)
	}
	return r
}

func digestRows(n int, over func(int, *FGTrafficLog)) []FGTrafficLog {
	out := make([]FGTrafficLog, 0, n)
	for i := 0; i < n; i++ {
		r := digestRow(nil)
		r.Timestamp += int64(i) * 60000
		if over != nil {
			over(i, &r)
		}
		out = append(out, r)
	}
	return out
}

func TestSummariseTrafficLog_SplitsByDirection(t *testing.T) {
	// The single most useful thing to say about a local traffic log, and the one its table cannot
	// show: on the lab unit almost all of it is the firewall calling out, not anyone reaching in.
	rows := append(digestRows(3, nil),
		digestRow(func(r *FGTrafficLog) { r.SrcIntf = "port1"; r.DstIntf = "root" }), // inbound
		digestRow(func(r *FGTrafficLog) { r.SrcIntf = "root"; r.DstIntf = "root" }),  // loopback
	)
	d := SummariseTrafficLog(rows, "local")

	if d.LocalOut != 3 || d.Inbound != 1 || d.Loopback != 1 {
		t.Errorf("direction = out %d / in %d / loop %d, want 3/1/1", d.LocalOut, d.Inbound, d.Loopback)
	}
	if d.Rows != 5 {
		t.Errorf("rows = %d, want 5", d.Rows)
	}
}

func TestSummariseTrafficLog_CountsWithoutJudging(t *testing.T) {
	// The digest reports the actions the device wrote. It does not decide which of them count as
	// blocks — that interpretation lives in one place, the browser, and duplicating it here would
	// give the page two answers that drift.
	rows := digestRows(6, func(i int, r *FGTrafficLog) {
		if i%2 == 0 {
			r.Action = "server-rst"
		}
	})
	d := SummariseTrafficLog(rows, "local")

	if d.Actions["server-rst"] != 3 || d.Actions["accept"] != 3 {
		t.Errorf("actions = %v, want 3 each", d.Actions)
	}
	if strings.Contains(strings.ToLower(d.Text()), "blocked") {
		t.Error("the digest must not classify anything as blocked")
	}
}

func TestSummariseTrafficLog_KeepsAddressWithAResolvedName(t *testing.T) {
	// Two servers commonly answer to one name — globalguardservice.fortinet.net resolves to
	// several addresses on the lab unit. A digest listing the name alone would show it twice with
	// no way to tell the entries apart.
	rows := append(
		digestRows(4, nil),
		digestRow(func(r *FGTrafficLog) { r.DstIP = "173.243.129.16" }),
	)
	d := SummariseTrafficLog(rows, "local")

	if len(d.TopDestinations) != 2 {
		t.Fatalf("destinations = %+v, want two distinct addresses", d.TopDestinations)
	}
	if !strings.Contains(d.TopDestinations[0].Label, "173.243.140.16") {
		t.Errorf("label = %q, want the address alongside the name", d.TopDestinations[0].Label)
	}
}

func TestSummariseTrafficLog_DropsAPlaceForACountry(t *testing.T) {
	// "Reserved" is what FortiOS says about RFC1918 space. Ranking it would put a country that
	// does not exist at the top of the list.
	d := SummariseTrafficLog(digestRows(3, func(_ int, r *FGTrafficLog) { r.DstCountry = "Reserved" }), "local")
	if len(d.TopCountries) != 0 {
		t.Errorf("countries = %+v, want none", d.TopCountries)
	}
}

func TestDigestText_SaysNothingWasScoredRatherThanNothingWasFound(t *testing.T) {
	// The lab unit records no crlevel at all. "none" on its own would read to the model as "the
	// UTM engine scanned this and found nothing", which is a claim about scanning that never
	// happened. The sentence has to distinguish the two.
	text := SummariseTrafficLog(digestRows(3, nil), "local").Text()
	if !strings.Contains(text, "scored nothing") {
		t.Errorf("digest text does not distinguish unscored from clean:\n%s", text)
	}

	scored := SummariseTrafficLog(digestRows(2, func(_ int, r *FGTrafficLog) { r.CRLevel = "high" }), "local").Text()
	if !strings.Contains(scored, "high 2") {
		t.Errorf("a recorded threat level is missing from the digest:\n%s", scored)
	}
}

func TestDigestText_CarriesNoPerRowIdentity(t *testing.T) {
	// A traffic log names people. What leaves this process is counts, plus the few addresses that
	// ARE the answer — never a username, a MAC, or a session.
	rows := digestRows(3, func(_ int, r *FGTrafficLog) {
		r.User = "tawunchai"
		r.SrcMAC = "00:09:0f:09:00:00"
		r.SessionID = 19990
	})
	text := SummariseTrafficLog(rows, "local").Text()

	for _, secret := range []string{"tawunchai", "00:09:0f:09:00:00", "19990"} {
		if strings.Contains(text, secret) {
			t.Errorf("digest leaked %q:\n%s", secret, text)
		}
	}
}

func TestSummariseTrafficLog_EmptyLogInventsNothing(t *testing.T) {
	d := SummariseTrafficLog(nil, "local")
	if d.Rows != 0 || d.SpanMinutes != 0 || len(d.TopDestinations) != 0 {
		t.Errorf("empty digest = %+v, want zeroes", d)
	}
	if !strings.Contains(d.Text(), "no entries") {
		t.Errorf("text = %q, want it to say there were none", d.Text())
	}
}
