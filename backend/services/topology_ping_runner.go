package services

import (
	"log"
	"network_automation/services/platform"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Topology ping sweep — the unattended half of the Topology map's pinned devices.
//
// Once a minute the scheduler calls RunTopologyPingSweep. It finds every enabled pinned device whose
// own interval has elapsed, groups them by the FIREWALL that has to do the pinging, resolves that
// firewall's automation account ONCE, and pings each due target through it — recording up / down /
// unknown back onto the row the 3D scene reads.
//
// ── Why it is shaped like the notify sweep ────────────────────────────────────
// A firewall locks an admin account after three consecutive failed logins, so the number of SSH
// sessions this platform opens to a device per minute is a safety property. The per-device diag gate
// (fortigate_diagexec.go) already serialises one diagnostic at a time per firewall and trips a
// breaker after two failures; this sweep stays inside that by resolving one login per firewall and
// pinging through the same gate, and by capping how many targets it will service in a single tick so
// a long list of dead hosts cannot make one sweep run into the next.

const (
	// topologyHealthCount is the repeat-count for a health ping. Two packets is enough to tell "it
	// answered" from "it did not" without the ten-packet cost of the interactive page, and it keeps a
	// single dropped packet from flipping a healthy device to down.
	topologyHealthCount = 2

	// topologySweepCap bounds one tick's work. Due devices are serviced oldest-check-first, so a set
	// larger than the cap simply rotates through over several ticks rather than overrunning one.
	topologySweepCap = 25
)

// TopologyPingSweepResult is what one pass did, for the scheduler's log line and the tests.
type TopologyPingSweepResult struct {
	Due     int
	Checked int
	Up      int
	Down    int
	Unknown int
}

// topologyDue reports whether a device's scheduled ping has come round.
//
// Pure, so the "is it time yet" rule — never checked ⇒ due; otherwise due once the interval has
// elapsed since the last check — is unit-testable without a database or a clock.
func topologyDue(d entity.TopologyDevice, now time.Time) bool {
	if !d.Enabled {
		return false
	}
	if d.LastCheckedAt == nil {
		return true
	}
	interval := d.PingIntervalSeconds
	if interval < entity.MinPingInterval {
		interval = entity.MinPingInterval
	}
	return !now.Before(d.LastCheckedAt.Add(time.Duration(interval) * time.Second))
}

// RunTopologyPingSweep pings every pinned device that is due and records the outcome.
//
// Never returns an error: a firewall that cannot be reached, or a device that does not reply, IS the
// answer — it is written onto the row (unknown / down) rather than pushed up as a sweep failure.
func RunTopologyPingSweep(db *gorm.DB, now time.Time) TopologyPingSweepResult {
	var res TopologyPingSweepResult
	if db == nil {
		return res
	}

	var all []entity.TopologyDevice
	if err := db.Where("enabled = ?", true).Find(&all).Error; err != nil {
		log.Printf("[topology-ping] could not list devices: %v", err)
		return res
	}

	// The due set, oldest check first so a backlog rotates fairly and a capped sweep never starves
	// the same tail.
	due := make([]entity.TopologyDevice, 0, len(all))
	for _, d := range all {
		if topologyDue(d, now) {
			due = append(due, d)
		}
	}
	res.Due = len(due)
	sortTopologyByLastChecked(due)
	if len(due) > topologySweepCap {
		due = due[:topologySweepCap]
	}
	if len(due) == 0 {
		return res
	}

	// One automation login per firewall, reused for every target on it: resolve() memoises by device
	// id, so a sweep over twenty targets on one box resolves its login once. A login the pool/breaker
	// has already given up on is left alone by the breaker itself — PingOnce returns ErrLoginPaused
	// without attempting one — which is what keeps a tick from hammering a firewall that is down.
	type fw struct {
		device entity.NetworkDevice
		target DiagTarget
		ok     bool
		err    string
	}
	firewalls := map[uint]*fw{}
	resolve := func(id uint) *fw {
		if f, ok := firewalls[id]; ok {
			return f
		}
		f := &fw{}
		firewalls[id] = f
		var device entity.NetworkDevice
		if err := db.First(&device, id).Error; err != nil {
			f.err = "firewall not found"
			return f
		}
		login, err := ResolveAutomationLogin(db, &device)
		if err != nil {
			f.err = platform.TruncateUTF8(err.Error(), 300)
			return f
		}
		f.device = device
		f.target = DiagTarget{
			DeviceID: device.ID,
			Host:     device.MgmtIP,
			Port:     device.Port,
			Username: login.Username,
			Password: login.Password,
		}
		f.ok = true
		return f
	}

	for _, d := range due {
		f := resolve(d.DeviceID)
		checkedAt := time.Now()
		status := entity.TopologyStatusUnknown
		var latency *float64
		var loss *int
		lastErr := ""

		if !f.ok {
			lastErr = f.err
		} else {
			result, err := PingOnce(f.target, d.IPAddress, PingOptions{Count: topologyHealthCount})
			if err != nil {
				// The firewall could not run the ping (SSH down, breaker open, bad credentials). That
				// is unknown, not "the target is down" — the map must not report a device as failed
				// because we lost our own way in.
				lastErr = platform.TruncateUTF8(err.Error(), 300)
			} else {
				status = PingReachable(result)
				l := result.LossPercent
				loss = &l
				if result.Received > 0 {
					avg := result.AvgMs
					latency = &avg
				}
			}
		}

		res.Checked++
		switch status {
		case entity.TopologyStatusUp:
			res.Up++
		case entity.TopologyStatusDown:
			res.Down++
		default:
			res.Unknown++
		}

		// Write exactly the columns the reading owns, by primary key, so a concurrent edit to the
		// device's name/interval from the controller is never clobbered by the sweep.
		updates := map[string]any{
			"last_status":       status,
			"last_checked_at":   checkedAt,
			"last_latency_ms":   latency,
			"last_loss_percent": loss,
			"last_error":        lastErr,
		}
		if err := db.Model(&entity.TopologyDevice{}).
			Where("id = ?", d.ID).Updates(updates).Error; err != nil {
			log.Printf("[topology-ping] device %d (%s): could not store result: %v", d.ID, d.Name, err)
		}
	}

	return res
}

// sortTopologyByLastChecked orders never-checked rows first, then oldest check first. A tiny
// insertion sort — the slice is capped small and this avoids pulling in sort for one call site.
func sortTopologyByLastChecked(list []entity.TopologyDevice) {
	key := func(d entity.TopologyDevice) int64 {
		if d.LastCheckedAt == nil {
			return 0
		}
		return d.LastCheckedAt.UnixNano()
	}
	for i := 1; i < len(list); i++ {
		j := i
		for j > 0 && key(list[j]) < key(list[j-1]) {
			list[j], list[j-1] = list[j-1], list[j]
			j--
		}
	}
}
