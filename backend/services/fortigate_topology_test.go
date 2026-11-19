package services

import "testing"

// GetTopologyLive is the fast overlay Network ▸ Topology polls to animate a diagram the slow CMDB
// reads already drew — see fortigate_topology.go's doc comment for why it is a separate call. These
// tests pin the two things worth checking without a device: it reads both probes, and a tunnel
// probe failure does not also blank out the interface half.

func TestGetTopologyLive_ReadsInterfacesAndTunnels(t *testing.T) {
	resetSDWANRates()
	defer resetSDWANRates()

	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/system/interface": map[string]interface{}{
			"wan1": map[string]interface{}{"link": true, "speed": 1000.0, "rx_bytes": 1000, "tx_bytes": 500},
			"wan2": map[string]interface{}{"link": false, "speed": 0.0, "rx_bytes": 0, "tx_bytes": 0},
		},
		"GET /api/v2/monitor/vpn/ipsec": []interface{}{
			map[string]interface{}{"name": "hq-to-branch", "proxyid": []interface{}{
				map[string]interface{}{"status": "up"},
			}},
		},
	})
	defer done()

	live := fc.GetTopologyLive()

	if len(live.Interfaces) != 2 {
		t.Fatalf("expected 2 interfaces, got %d: %+v", len(live.Interfaces), live.Interfaces)
	}
	byName := map[string]TopologyLiveInterface{}
	for _, i := range live.Interfaces {
		byName[i.Name] = i
	}
	if !byName["wan1"].Link {
		t.Error("wan1 should report link up")
	}
	if byName["wan2"].Link {
		t.Error("wan2 should report link down")
	}
	// First poll ever for this fake client's BaseURL — no previous sample exists, so rate must be
	// the documented zero, never a guess.
	if byName["wan1"].RxBps != 0 || byName["wan1"].TxBps != 0 {
		t.Errorf("first poll must report zero rate, got rx=%v tx=%v", byName["wan1"].RxBps, byName["wan1"].TxBps)
	}
}

func TestGetTopologyLive_ReadsPolicyByteCounters(t *testing.T) {
	resetSDWANRates()
	defer resetSDWANRates()

	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/system/interface": map[string]interface{}{},
		"GET /api/v2/monitor/firewall/policy": []interface{}{
			map[string]interface{}{"policyid": 1.0, "bytes": 12345.0, "packets": 10.0, "active_sessions": 2.0},
			map[string]interface{}{"policyid": 2.0, "bytes": 0.0, "packets": 0.0, "active_sessions": 0.0},
		},
	})
	defer done()

	live := fc.GetTopologyLive()

	byID := map[int]TopologyLivePolicy{}
	for _, p := range live.Policies {
		byID[p.PolicyID] = p
	}
	if len(byID) != 2 {
		t.Fatalf("expected 2 policies, got %d: %+v", len(byID), live.Policies)
	}
	if byID[1].Bytes != 12345 {
		t.Errorf("policy 1 bytes = %d, want 12345", byID[1].Bytes)
	}
	if byID[2].Bytes != 0 {
		t.Errorf("policy 2 bytes = %d, want 0", byID[2].Bytes)
	}
}

func TestGetTopologyLive_ToleratesATunnelProbeFailure(t *testing.T) {
	resetSDWANRates()
	defer resetSDWANRates()

	// No "GET /api/v2/monitor/vpn/ipsec" entry — fakeFortiGate answers it with {}, which
	// GetVPNTunnelHealth cannot parse into its own shape; the interface half must still come back.
	fc, _, done := fakeFortiGate(t, map[string]interface{}{
		"GET /api/v2/monitor/system/interface": map[string]interface{}{
			"wan1": map[string]interface{}{"link": true, "speed": 1000.0, "rx_bytes": 1, "tx_bytes": 1},
		},
	})
	defer done()

	live := fc.GetTopologyLive()
	if len(live.Interfaces) != 1 {
		t.Fatalf("interface half must survive an unreadable tunnel probe, got %+v", live.Interfaces)
	}
}
