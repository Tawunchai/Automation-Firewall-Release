package notify

import (
	"errors"
	"fmt"
	"log"
	"network_automation/services"
	"network_automation/services/drift"
	"network_automation/services/platform"
	"sort"
	"strings"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Notify Management — the part that talks to things.
//
// notify.go decides whether an alert is warranted; this file gets the readings it decides from, and
// sends what comes out. Split that way because the deciding is the half worth testing exhaustively
// and the half a test cannot drive through a live FortiGate.
//
// ── One probe per device, not one per rule ───────────────────────────────────
// A sweep groups rules by device and reads the device ONCE. Six rules on one firewall are six
// evaluations of one snapshot, not six rounds of REST calls. That is not only faster: FortiOS locks
// an admin account after three consecutive failed logins, so the number of times per minute this
// platform touches a device is a safety property, not a performance one. The session pool
// (AcquireFortiClient) and its circuit breaker are what keep a dead device from being hammered.

// notifyUsageInterval is the sampling window asked of monitor/system/resource/usage. The shortest
// one FortiOS keeps, because an alert wants the current reading, not a smoothed hour.
const notifyUsageInterval = "1-min"

// NotifyPollInterval is how often the sweep runs, and therefore what a rule's "sustained for N
// polls" is counted in.
//
// It is exported because the rule form has to say "2 polls (120 s)" — a sustain setting whose unit
// is invisible is a setting nobody can choose correctly. It matches the scheduler's own tick, which
// is what actually drives it; scheduler_test pins the two together so this cannot quietly become a
// lie.
const NotifyPollInterval = 60 * time.Second

// NotifySweepResult is what one pass did, for the log line and the tests.
type NotifySweepResult struct {
	Devices    int
	Rules      int
	Fired      int
	Resolved   int
	Suppressed int
}

// ProbeDeviceForNotify reads everything the rule kinds need, in one pass.
//
// Never returns an error: a device that cannot be reached IS the answer to one of the rule kinds,
// and pushing that up as an error would make the caller decide what it means. Individual endpoints
// that fail leave their Have* flag false, so a rule watching that number goes quiet instead of
// reading a missing value as zero.
func ProbeDeviceForNotify(db *gorm.DB, device entity.NetworkDevice, needs notifyNeeds) NotifyProbe {
	p := NotifyProbe{}

	// Drift is read from our own tables and is filled in FIRST, before any of the early returns
	// below. Every other signal here needs the firewall to answer; this one needs the last backup
	// we already took, so a device that is unreachable — or that nobody has given us credentials
	// for — must still be able to report that its configuration was changed behind our back.
	if needs.drift {
		if run, ok := drift.LatestDriftRun(db, device.ID); ok {
			p.HaveDrift = true
			p.StandingDriftCount = float64(drift.StandingOutsideChangeCount(db, device.ID))
			p.DriftDetail = run.Summary
		}
	}

	// The device's nominated automation account (Profile ▸ Device Credentials → "use for scheduled
	// work"). A sweep has no person behind it, so it cannot borrow whoever happens to be signed in;
	// it uses the one account somebody explicitly put forward for unattended work on this device.
	// Same rule as auto-backup and compliance.
	login, err := services.ResolveAutomationLogin(db, &device)
	if err != nil {
		// Not reachable, and not a fault of the firewall: nobody has given this platform a way in.
		// Reported as an error on the probe rather than as an outage, so a device-unreachable rule
		// does not page somebody about a configuration gap they would fix in the console.
		p.Error = platform.TruncateUTF8(err.Error(), 300)
		return p
	}

	fc, err := services.AcquireFortiClient(device.ID, device.MgmtIP, device.APIPort, login)
	if err != nil {
		if errors.Is(err, services.ErrLoginPaused) {
			// The circuit breaker is open: THIS PLATFORM has stopped trying, and the device has
			// said nothing. Reporting that as an outage is a false alarm about our own back-off —
			// and it is self-sustaining, because the breaker stays open for a minute and every
			// sweep inside that window would repeat it. Setting neither Reachable nor Error leaves
			// every rule silent for this tick, which is the honest answer: we do not know.
			p.Skipped = true
			return p
		}
		p.Error = platform.TruncateUTF8(err.Error(), 300)
		return p
	}
	p.Reachable = true

	if needs.interfaces {
		if ifaces, err := fc.GetSystemInterfaces(); err == nil {
			for _, i := range ifaces {
				// LinkUp is nil for an interface the monitor endpoint said nothing about — a
				// tunnel, a loopback, a VLAN on a down parent. Unknown is not down, and reporting
				// it as down would page somebody at every boot.
				if i.LinkUp == nil {
					continue
				}
				p.Interfaces = append(p.Interfaces, NotifyInterfaceState{
					Name: i.Name, Alias: i.Alias, Up: *i.LinkUp, Speed: i.Speed,
				})
			}
			sort.Slice(p.Interfaces, func(a, b int) bool { return p.Interfaces[a].Name < p.Interfaces[b].Name })
		}
	}

	if needs.resources {
		if usage, err := fc.GetResourceUsage(notifyUsageInterval); err == nil {
			p.HaveCPU, p.CPUPercent = true, usage.CPU.Current
			p.HaveMemory, p.MemoryPercent = true, usage.Memory.Current
			p.HaveSessions, p.Sessions = true, usage.Sessions.Current
			// Disk is absent on a device with no log disk (log_disk_status "not_available"), where
			// resource/usage answers a flat zero. Treating that as "0% used" would leave a
			// disk-usage rule permanently, misleadingly healthy.
			if usage.Disk.Current > 0 {
				p.HaveDisk, p.DiskPercent = true, usage.Disk.Current
			}
		}
	}

	if needs.licenses {
		if lic, err := fc.GetLicenseOverview(); err == nil {
			now := time.Now().Unix()
			add := func(rows []services.FGLicenseRow) {
				for _, row := range rows {
					if row.Expires <= 0 {
						continue // a perpetual or unlicensed entitlement has no expiry to warn about
					}
					p.Licenses = append(p.Licenses, NotifyLicenseState{
						Key: row.Key, Label: row.Label, Status: row.Status,
						DaysLeft: float64(row.Expires-now) / 86400.0,
					})
				}
			}
			add(lic.Primary)
			add(lic.Secondary)
		}
	}

	return p
}

// notifyNeeds records which parts of a device a set of rules actually requires, so a sweep with
// only CPU rules never fetches the licence table.
type notifyNeeds struct {
	interfaces bool
	resources  bool
	licenses   bool
	drift      bool
}

func needsFor(rules []entity.NotifyRule) notifyNeeds {
	var n notifyNeeds
	for _, r := range rules {
		switch r.Kind {
		case entity.NotifyKindInterfaceLink:
			n.interfaces = true
		case entity.NotifyKindLicenseExpiry:
			n.licenses = true
		case entity.NotifyKindCPUPeak, entity.NotifyKindMemoryPeak,
			entity.NotifyKindSessionSpike, entity.NotifyKindDiskUsage:
			n.resources = true
		case entity.NotifyKindConfigDrift:
			n.drift = true
		}
	}
	return n
}

// RunNotifySweep polls every device that has an enabled rule against it and delivers what changed.
func RunNotifySweep(db *gorm.DB, now time.Time) NotifySweepResult {
	var res NotifySweepResult
	if db == nil {
		return res
	}

	var rules []entity.NotifyRule
	if err := db.Preload("Recipients").Where("enabled = ?", true).Find(&rules).Error; err != nil {
		log.Printf("[notify] could not read rules: %v", err)
		return res
	}
	if len(rules) == 0 {
		return res
	}

	var devices []entity.NetworkDevice
	if err := db.Where("status = ?", "active").Order("id ASC").Find(&devices).Error; err != nil {
		log.Printf("[notify] could not read devices: %v", err)
		return res
	}

	channels := loadNotifyChannels(db)

	for _, device := range devices {
		applicable := make([]entity.NotifyRule, 0, len(rules))
		for _, r := range rules {
			if r.NetworkDeviceID == 0 || r.NetworkDeviceID == device.ID {
				applicable = append(applicable, r)
			}
		}
		if len(applicable) == 0 {
			continue
		}

		res.Devices++
		res.Rules += len(applicable)
		probe := ProbeDeviceForNotify(db, device, needsFor(applicable))

		for _, rule := range applicable {
			fired, resolved, suppressed := applyNotifyRule(db, rule, device, probe, channels, now)
			res.Fired += fired
			res.Resolved += resolved
			res.Suppressed += suppressed
		}
	}

	return res
}

// applyNotifyRule evaluates one rule against one probe, persists the state and sends what fires.
func applyNotifyRule(
	db *gorm.DB,
	rule entity.NotifyRule,
	device entity.NetworkDevice,
	probe NotifyProbe,
	channels map[uint]entity.NotifyChannel,
	now time.Time,
) (fired, resolved, suppressed int) {
	signals := EvaluateNotifyRule(rule, probe)
	if len(signals) == 0 {
		return // nothing to say, and — importantly — nothing to forget
	}

	deviceLabel := fmt.Sprintf("%s (%s)", device.Name, device.MgmtIP)
	cooldown := time.Duration(rule.CooldownMinutes) * time.Minute

	for _, sig := range signals {
		subject := sig.Subject
		if subject == "" {
			subject = WholeDeviceSubject
		}

		var st entity.NotifyRuleState
		err := db.Where("notify_rule_id = ? AND network_device_id = ? AND subject = ?",
			rule.ID, device.ID, subject).First(&st).Error
		if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
			log.Printf("[notify] state read failed for rule %d/%s: %v", rule.ID, subject, err)
			continue
		}
		fresh := errors.Is(err, gorm.ErrRecordNotFound)
		if fresh {
			st = entity.NotifyRuleState{NotifyRuleID: rule.ID, NetworkDeviceID: device.ID, Subject: subject}
		}

		next, tr := NextNotifyState(st, sig, rule.SustainedPolls, cooldown, rule.NotifyOnResolve, now)

		if fresh {
			if err := db.Create(&next).Error; err != nil {
				log.Printf("[notify] state create failed for rule %d/%s: %v", rule.ID, subject, err)
				continue
			}
		} else {
			next.ID = st.ID
			if err := db.Model(&entity.NotifyRuleState{}).Where("id = ?", st.ID).Updates(map[string]any{
				"firing":        next.Firing,
				"streak":        next.Streak,
				"clear_streak":  next.ClearStreak,
				"last_value":    next.LastValue,
				"last_detail":   next.LastDetail,
				"last_fired_at": next.LastFiredAt,
				"last_seen_at":  next.LastSeenAt,
			}).Error; err != nil {
				log.Printf("[notify] state update failed for rule %d/%s: %v", rule.ID, subject, err)
				continue
			}
		}

		if tr.Suppressed {
			suppressed++
		}
		switch {
		case tr.Fire:
			emitNotifyEvent(db, rule, device, deviceLabel, sig, entity.NotifyStateFiring, channels, now)
			fired++
		case tr.Resolve:
			emitNotifyEvent(db, rule, device, deviceLabel, sig, entity.NotifyStateResolved, channels, now)
			resolved++
		}
	}
	return fired, resolved, suppressed
}

// emitNotifyEvent renders one alert, delivers it, and records both in the history.
//
// The row is written whatever happens to the delivery. An alert that fired but could not be sent is
// the single most important thing the history has to be able to show — the alternative is a page
// that looks quiet for the same reason a broken smoke detector does.
func emitNotifyEvent(
	db *gorm.DB,
	rule entity.NotifyRule,
	device entity.NetworkDevice,
	deviceLabel string,
	sig NotifySignal,
	state string,
	channels map[uint]entity.NotifyChannel,
	now time.Time,
) entity.NotifyEvent {
	msg := RenderNotifyMessage(rule, deviceLabel, sig, state, now)

	targets := ResolveNotifyTargets(rule.Recipients, channels)
	delivered, failed, detail := deliverNotify(db, targets, msg)

	ev := entity.NotifyEvent{
		NotifyRuleID:    rule.ID,
		RuleName:        rule.Name,
		Kind:            rule.Kind,
		NetworkDeviceID: device.ID,
		DeviceName:      deviceLabel,
		Subject:         sig.Label,
		Severity:        rule.Severity,
		State:           state,
		Title:           msg.Title,
		Message:         msg.Text,
		Value:           sig.Value,
		Delivered:       delivered,
		Failed:          failed,
		DeliveryStatus:  SummariseDelivery(len(targets), failed),
		DeliveryDetail:  platform.TruncateUTF8(detail, 2000),
	}
	if err := db.Create(&ev).Error; err != nil {
		log.Printf("[notify] could not record event for rule %d: %v", rule.ID, err)
	}
	return ev
}

// deliverNotify sends one message to every target and reports what happened to each.
func deliverNotify(db *gorm.DB, targets []NotifyTarget, msg NotifyMessage) (delivered, failed int, detail string) {
	if len(targets) == 0 {
		return 0, 0, "no enabled recipient is attached to this rule"
	}

	var notes []string
	for _, t := range targets {
		var err error
		switch t.ChannelType {
		case entity.NotifyChannelLINE:
			if t.Token == "" {
				err = errors.New("the LINE channel has no usable access token")
			} else {
				err = platform.SendLinePush(t.Token, t.Addr, msg.Text)
			}
		case entity.NotifyChannelEmail:
			err = platform.SendMail(db, platform.MailMessage{
				To:       []string{t.Addr},
				Subject:  msg.Title,
				HTMLBody: platform.MailHTML(msg.Title, "", msg.Lines, "Sent by the FortiGate automation console — Notify Management"),
			})
		default:
			err = fmt.Errorf("unknown channel type %q", t.ChannelType)
		}

		if err != nil {
			failed++
			notes = append(notes, fmt.Sprintf("%s (%s): %s", t.Name, t.ChannelType, err.Error()))
			continue
		}
		delivered++
		notes = append(notes, fmt.Sprintf("%s (%s): sent", t.Name, t.ChannelType))
	}
	return delivered, failed, strings.Join(notes, "\n")
}

// loadNotifyChannels reads every channel once per sweep, keyed by id.
func loadNotifyChannels(db *gorm.DB) map[uint]entity.NotifyChannel {
	out := map[uint]entity.NotifyChannel{}
	var rows []entity.NotifyChannel
	if err := db.Find(&rows).Error; err != nil {
		log.Printf("[notify] could not read channels: %v", err)
		return out
	}
	for _, ch := range rows {
		out[ch.ID] = ch
	}
	return out
}

// LoadNotifyChannelMap is loadNotifyChannels for callers outside this file (the test-send handler).
func LoadNotifyChannelMap(db *gorm.DB) map[uint]entity.NotifyChannel {
	return loadNotifyChannels(db)
}

// SendNotifyToRecipient delivers arbitrary text to one recipient. Used by the "send a test message"
// buttons, which exist because the alternative way to learn a token is wrong is to not be told
// about an outage.
func SendNotifyToRecipient(db *gorm.DB, ch entity.NotifyChannel, r entity.NotifyRecipient, title string, lines []string) error {
	switch ch.Type {
	case entity.NotifyChannelLINE:
		token, err := platform.DecryptSecret(ch.SecretEnc)
		if err != nil || strings.TrimSpace(token) == "" {
			return errors.New("this LINE channel has no usable access token")
		}
		return platform.SendLinePush(token, r.Target, title+"\n"+strings.Join(lines, "\n"))
	case entity.NotifyChannelEmail:
		return platform.SendMail(db, platform.MailMessage{
			To:       []string{r.Target},
			Subject:  title,
			HTMLBody: platform.MailHTML(title, "", lines, "Sent by the FortiGate automation console — Notify Management"),
		})
	}
	return fmt.Errorf("unknown channel type %q", ch.Type)
}

// PurgeNotifyStateForRule drops a rule's memory.
//
// Called when a rule is edited in a way that changes what it means (its kind, its threshold, the
// device it watches). Without it, raising a CPU threshold from 70% to 95% would leave the rule
// still marked as firing and the next healthy poll would announce a recovery from an alert that no
// longer exists.
func PurgeNotifyStateForRule(db *gorm.DB, ruleID uint) {
	if db == nil || ruleID == 0 {
		return
	}
	db.Unscoped().Where("notify_rule_id = ?", ruleID).Delete(&entity.NotifyRuleState{})
}
