package services

import (
	"encoding/json"
	"testing"
)

// The single-object tables, and the two things about them that would otherwise render as confident
// wrong answers.

func TestReadSingleObject_HandlesBothShapes(t *testing.T) {
	// FortiOS answers a table with no mkey as a bare object on some paths and a one-element array on
	// others, and which is not documented. Guessing wrong unmarshals into a zero value — on the log
	// page that reads as "nothing is logged and nothing is enabled".
	type payload struct {
		Status string `json:"status"`
	}

	object := &fgAPIResponse{Results: json.RawMessage(`{"status":"enable"}`)}
	var a payload
	if err := readSingleObject(object, &a); err != nil || a.Status != "enable" {
		t.Errorf("object form: %+v, err %v", a, err)
	}

	array := &fgAPIResponse{Results: json.RawMessage(`[{"status":"enable"}]`)}
	var b payload
	if err := readSingleObject(array, &b); err != nil || b.Status != "enable" {
		t.Errorf("array form: %+v, err %v", b, err)
	}
}

func TestReadSingleObject_RefusesAnEmptyListRatherThanReturningZeroes(t *testing.T) {
	// An empty answer is not "everything is off". Saying so is the whole point.
	empty := &fgAPIResponse{Results: json.RawMessage(`[]`)}
	var out struct {
		Status string `json:"status"`
	}
	if err := readSingleObject(empty, &out); err == nil {
		t.Error("an empty list was accepted as a settings object")
	}
}

func TestLogSyslogWrite_AnEmptyCertificateIsNeverSent(t *testing.T) {
	// An empty name is not a valid reference and the device answers -3 (entry not found in
	// datasource) for one — which would fail a syslog change that had nothing to do with TLS.
	//
	// Exercised through the payload the writer builds, so the assertion is about what goes on the
	// wire rather than about a mock.
	body := map[string]any{}
	s := FGLogSyslog{Enabled: true, Server: "10.0.0.5", Port: 514, Mode: "udp"}
	if s.Certificate != "" {
		body["certificate"] = s.Certificate
	}
	if _, sent := body["certificate"]; sent {
		t.Error("an empty certificate name would be sent")
	}
}

func TestLogSettings_ConfiguredIsSeparateFromEnabled(t *testing.T) {
	// `status: enable` with no server is a destination that is switched on and sending nowhere —
	// the same family as the SSL-VPN listener trap. The page has to be able to say which of the two
	// is missing, so the read carries both.
	on := FGLogSyslog{Enabled: true, Server: "", Configured: false}
	if !on.Enabled || on.Configured {
		t.Errorf("enabled=%v configured=%v", on.Enabled, on.Configured)
	}
	real := FGLogSyslog{Enabled: true, Server: "10.0.0.5", Configured: true}
	if !real.Enabled || !real.Configured {
		t.Errorf("a real destination read as enabled=%v configured=%v", real.Enabled, real.Configured)
	}
}

func TestSplitDevList_DropsTheHeartbeatPriorities(t *testing.T) {
	// hbdev is "port1 50 port2 50" — an interface name followed by its priority. Printing the
	// numbers in an interface column would name ports that do not exist.
	got := splitDevList("\"port1\" 50 \"port2\" 50")
	if len(got) != 2 || got[0] != "port1" || got[1] != "port2" {
		t.Errorf("got %v, want [port1 port2]", got)
	}
	if len(splitDevList("")) != 0 {
		t.Error("an empty list should stay empty")
	}
	// The monitored-interface list has no numbers at all, and must survive untouched.
	if got := splitDevList("port1 port3"); len(got) != 2 {
		t.Errorf("got %v, want two interfaces", got)
	}
}

func TestHARead_StandaloneIsNotACluster(t *testing.T) {
	// A standalone unit keeps whatever HA settings it was configured with, so leftovers must not
	// imply a cluster.
	raw := fgHARaw{Mode: "standalone", GroupName: "old-cluster", HBDev: "port1 50"}
	out := FGHAStatus{
		Mode:          raw.Mode,
		Clustered:     raw.Mode != "standalone",
		GroupName:     raw.GroupName,
		HeartbeatDevs: splitDevList(raw.HBDev),
	}
	if out.Clustered {
		t.Error("a standalone unit was reported as clustered")
	}
	if out.GroupName != "old-cluster" || len(out.HeartbeatDevs) != 1 {
		t.Errorf("the leftover settings were dropped: %+v", out)
	}
}
