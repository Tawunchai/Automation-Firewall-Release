package topologydevice

import (
	"testing"

	"network_automation/entity"
)

func TestNormalise(t *testing.T) {
	t.Run("rejects an empty name", func(t *testing.T) {
		if _, _, _, _, _, _, err := normalise(deviceRequest{IPAddress: "10.0.0.1"}); err == "" {
			t.Fatal("expected an error for a missing name")
		}
	})

	t.Run("rejects a non-IP address", func(t *testing.T) {
		if _, _, _, _, _, _, err := normalise(deviceRequest{Name: "sw1", IPAddress: "not-an-ip"}); err == "" {
			t.Fatal("expected an error for a hostname — the value is pinged on a live CLI")
		}
	})

	t.Run("rejects an unknown kind", func(t *testing.T) {
		req := deviceRequest{Name: "sw1", IPAddress: "10.0.0.1", Kind: "toaster"}
		if _, _, _, _, _, _, err := normalise(req); err == "" {
			t.Fatal("expected an error for an unknown kind")
		}
	})

	t.Run("defaults kind, interval and firewall", func(t *testing.T) {
		req := deviceRequest{Name: "sw1", IPAddress: "192.168.1.2"}
		_, _, _, kind, interval, deviceID, err := normalise(req)
		if err != "" {
			t.Fatalf("unexpected error: %s", err)
		}
		if kind != "other" {
			t.Fatalf("kind default = %q, want other", kind)
		}
		if interval != 60 {
			t.Fatalf("interval default = %d, want 60", interval)
		}
		if deviceID != 1 {
			t.Fatalf("device default = %d, want 1", deviceID)
		}
	})

	t.Run("clamps a too-small interval up to the floor", func(t *testing.T) {
		req := deviceRequest{Name: "sw1", IPAddress: "10.0.0.1", PingIntervalSeconds: 3}
		_, _, _, _, interval, _, err := normalise(req)
		if err != "" {
			t.Fatalf("unexpected error: %s", err)
		}
		if interval != entity.MinPingInterval {
			t.Fatalf("interval = %d, want floor %d", interval, entity.MinPingInterval)
		}
	})

	t.Run("accepts a valid IPv6 address and every known kind", func(t *testing.T) {
		for _, k := range entity.TopologyDeviceKinds {
			req := deviceRequest{Name: "n", IPAddress: "2001:db8::1", Kind: k}
			if _, _, _, gotKind, _, _, err := normalise(req); err != "" || gotKind != k {
				t.Fatalf("kind %q: err=%q gotKind=%q", k, err, gotKind)
			}
		}
	})
}
