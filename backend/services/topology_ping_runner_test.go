package services

import (
	"testing"
	"time"

	"network_automation/entity"
)

func ptrTime(t time.Time) *time.Time { return &t }

func TestTopologyDue(t *testing.T) {
	now := time.Date(2026, 11, 10, 12, 0, 0, 0, time.UTC)

	cases := []struct {
		name string
		dev  entity.TopologyDevice
		want bool
	}{
		{
			name: "never checked is due",
			dev:  entity.TopologyDevice{Enabled: true, PingIntervalSeconds: 60, LastCheckedAt: nil},
			want: true,
		},
		{
			name: "disabled is never due",
			dev:  entity.TopologyDevice{Enabled: false, PingIntervalSeconds: 60, LastCheckedAt: nil},
			want: false,
		},
		{
			name: "checked within interval is not due",
			dev: entity.TopologyDevice{
				Enabled: true, PingIntervalSeconds: 120,
				LastCheckedAt: ptrTime(now.Add(-30 * time.Second)),
			},
			want: false,
		},
		{
			name: "checked past interval is due",
			dev: entity.TopologyDevice{
				Enabled: true, PingIntervalSeconds: 60,
				LastCheckedAt: ptrTime(now.Add(-61 * time.Second)),
			},
			want: true,
		},
		{
			name: "interval below floor is clamped up, so a 5s interval still waits 30s",
			dev: entity.TopologyDevice{
				Enabled: true, PingIntervalSeconds: 5,
				LastCheckedAt: ptrTime(now.Add(-20 * time.Second)),
			},
			want: false,
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := topologyDue(tc.dev, now); got != tc.want {
				t.Fatalf("topologyDue = %v, want %v", got, tc.want)
			}
		})
	}
}

func TestSortTopologyByLastChecked(t *testing.T) {
	now := time.Now()
	list := []entity.TopologyDevice{
		{Name: "b", LastCheckedAt: ptrTime(now.Add(-10 * time.Second))},
		{Name: "a", LastCheckedAt: nil}, // never checked ⇒ first
		{Name: "c", LastCheckedAt: ptrTime(now.Add(-100 * time.Second))},
	}
	sortTopologyByLastChecked(list)
	order := []string{list[0].Name, list[1].Name, list[2].Name}
	want := []string{"a", "c", "b"}
	for i := range want {
		if order[i] != want[i] {
			t.Fatalf("order = %v, want %v", order, want)
		}
	}
}

// TestPingReachable pins the three states the map draws to the parser's own fields, so a change to
// ParsePingOutput that broke the health reading would fail here rather than silently paint a live
// device grey.
func TestPingReachable(t *testing.T) {
	up := ParsePingOutput("8.8.8.8", upPingOutput)
	if PingReachable(up) != entity.TopologyStatusUp {
		t.Fatalf("a reply should be up, got %q (received=%d)", PingReachable(up), up.Received)
	}
	if up.Received == 0 {
		t.Fatalf("parser found no replies in a successful ping")
	}

	down := ParsePingOutput("10.255.255.1", downPingOutput)
	if PingReachable(down) != entity.TopologyStatusDown {
		t.Fatalf("total loss should be down, got %q (allLost=%v)", PingReachable(down), down.AllLost)
	}

	// Nothing transmitted at all (a malformed/empty run) is unknown, not down.
	empty := ParsePingOutput("x", "")
	if PingReachable(empty) != entity.TopologyStatusUnknown {
		t.Fatalf("empty output should be unknown, got %q", PingReachable(empty))
	}
}

// Captured from the shape FortiOS 7.2.10 prints (see fortigate_diagexec.go's parser tests for the
// same format). A reachable host —
const upPingOutput = `PING 8.8.8.8 (8.8.8.8): 56 data bytes
64 bytes from 8.8.8.8: icmp_seq=0 ttl=117 time=1.2 ms
64 bytes from 8.8.8.8: icmp_seq=1 ttl=117 time=1.1 ms

--- 8.8.8.8 ping statistics ---
2 packets transmitted, 2 packets received, 0% packet loss
round-trip min/avg/max = 1.1/1.15/1.2 ms`

// — and a host the firewall could ping but that never answered.
const downPingOutput = `PING 10.255.255.1 (10.255.255.1): 56 data bytes

--- 10.255.255.1 ping statistics ---
2 packets transmitted, 0 packets received, 100% packet loss`
