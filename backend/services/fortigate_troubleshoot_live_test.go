package services

import (
	"os"
	"testing"
)

// Live check against the lab FortiGate. Skipped unless FGT_LIVE_HOST is set, so `go test ./...`
// stays hermetic on a machine that cannot reach the device:
//
//	FGT_LIVE_HOST=10.0.99.201 FGT_LIVE_USER=admin FGT_LIVE_PASS='…' go test ./services/ -run Live -v
//
// It exists because the unit tests above use a FIXTURE of the device's tables. A fixture cannot
// notice that the real firewall grew a policy, or that a FortiOS upgrade changed how a field comes
// back. This one talks to the actual box, and the assertion is the box's own answer: the policy id
// this trace picks must be the one `diagnose firewall iprope lookup` reports.
func liveClient(t *testing.T) *FortiClient {
	t.Helper()
	host := os.Getenv("FGT_LIVE_HOST")
	if host == "" {
		t.Skip("FGT_LIVE_HOST not set — skipping live device test")
	}
	fc := NewFortiClient(host, 443)
	if err := fc.Login(os.Getenv("FGT_LIVE_USER"), os.Getenv("FGT_LIVE_PASS")); err != nil {
		t.Fatalf("login to %s failed: %v", host, err)
	}
	return fc
}

func TestLiveTracePolicyPath(t *testing.T) {
	fc := liveClient(t)

	res, err := fc.TracePolicyPath(FGTraceQuery{
		SrcIP: "192.168.1.50", DstIP: "8.8.8.8", Protocol: 6, DstPort: 443,
	})
	if err != nil {
		t.Fatalf("trace failed: %v", err)
	}

	t.Logf("verdict=%s ingress=%s(%s) egress=%s", res.Verdict, res.Ingress, res.IngressVia, res.Egress)
	t.Logf("summary: %s", res.Summary)
	for _, v := range res.Evaluated {
		t.Logf("  #%d %-26s matched=%v %s", v.PolicyID, v.Name, v.Matched, v.Reason)
	}
	for _, n := range res.Notes {
		t.Logf("  note: %s", n)
	}

	if res.Egress != "port1" {
		t.Errorf("egress = %q, want port1 (the device's default route)", res.Egress)
	}
	if res.Ingress != "lan" {
		t.Errorf("ingress = %q, want lan", res.Ingress)
	}
	if res.Verdict != "allowed" {
		t.Fatalf("verdict = %q, want allowed", res.Verdict)
	}
	// The oracle: `diagnose firewall iprope lookup 192.168.1.50 1024 8.8.8.8 443 6 lan` → policy 1.
	if res.Matched == nil || res.Matched.PolicyID != 1 {
		t.Fatalf("matched policy = %v, want 1 (the device's own iprope answer)", res.Matched)
	}
}

func TestLiveTraceUnroutableDestination(t *testing.T) {
	fc := liveClient(t)
	// 192.0.2.0/24 is TEST-NET-1 and the lab has a default route, so this still routes out port1 —
	// what is asserted here is that a trace to an address with no specific route does not error.
	res, err := fc.TracePolicyPath(FGTraceQuery{SrcIP: "192.168.1.50", DstIP: "192.0.2.10", Protocol: 1})
	if err != nil {
		t.Fatalf("ICMP trace failed: %v", err)
	}
	t.Logf("ICMP verdict=%s summary=%s", res.Verdict, res.Summary)
	if res.Verdict == "" {
		t.Error("a trace must always produce a verdict")
	}
}

func TestLiveGetPolicyStats(t *testing.T) {
	fc := liveClient(t)
	stats := fc.GetPolicyStats()
	if len(stats) == 0 {
		t.Fatal("monitor/firewall/policy returned no rows — the counters column would be blank")
	}
	for id, s := range stats {
		t.Logf("policy %d: %d bytes, %d packets, %d sessions", id, s.Bytes, s.Packets, s.ActiveSessions)
	}
}

func TestLiveRunAudit(t *testing.T) {
	fc := liveClient(t)
	rep, err := fc.RunAudit()
	if err != nil {
		t.Fatalf("audit failed: %v", err)
	}
	t.Logf("scanned %d policies (%d disabled), %d addresses, %d services",
		rep.Stats.Policies, rep.Stats.PoliciesDisabled, rep.Stats.Addresses, rep.Stats.Services)
	t.Logf("counts: high=%d medium=%d low=%d", rep.Counts["high"], rep.Counts["medium"], rep.Counts["low"])
	for _, f := range rep.Findings {
		t.Logf("[%s] %-22s %s — %s", f.Severity, f.Check, f.Subject, f.Title)
		t.Logf("        %s", f.Detail)
	}
	for _, n := range rep.Notes {
		t.Logf("note: %s", n)
	}
	if rep.Stats.Policies == 0 {
		t.Fatal("the audit read no policies at all")
	}
}
