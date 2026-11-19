package notify

import (
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"network_automation/entity"
)

// The notify sweep against a real Postgres.
//
// notify_test.go covers the pure rules — EvaluateNotifyRule and NextNotifyState — which is where
// the thinking is. This covers what a pure test cannot: that one poll of a device turns into the
// right ROWS. Three of those are load-bearing and invisible without a server:
//
//   - a rule's state is keyed by (rule, device, SUBJECT). An interface rule produces one signal per
//     port, so a shared key would let port2 going down reset port1's streak and silence it.
//   - the history row is written whether the delivery worked or not. An alert that fired and could
//     not be sent is the single most important thing the history has to show, and a page that looks
//     quiet for that reason looks exactly like a page that is quiet.
//   - the sweep reads only ENABLED rules and only ACTIVE devices, so a disabled rule must do
//     nothing at all — no probe, no state row, no event.
//
// Skipped unless NOTIFY_DB_TEST_DSN names a database it may freely write to and empty. Point it at
// a throwaway container, never at the console's own:
//
//	docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=test --name notify-pg postgres:16-alpine
//	NOTIFY_DB_TEST_DSN="host=localhost port=55432 user=postgres password=test dbname=postgres sslmode=disable" \
//	  go test ./services/ -run Notify -v

func notifyTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	dsn := os.Getenv("NOTIFY_DB_TEST_DSN")
	if dsn == "" {
		t.Skip("NOTIFY_DB_TEST_DSN not set — see the note at the top of notify_runner_db_test.go")
	}
	db, err := gorm.Open(postgres.Open(dsn), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	if err := db.AutoMigrate(
		&entity.AppRole{}, &entity.AppUser{}, &entity.NetworkDevice{},
		&entity.NotifyChannel{}, &entity.NotifyRule{}, &entity.NotifyRecipient{},
		&entity.NotifyRuleState{}, &entity.NotifyEvent{},
	); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// Children first: the rows carry foreign keys into the rule and the device.
	for _, m := range []any{
		&entity.NotifyEvent{}, &entity.NotifyRuleState{}, &entity.NotifyRecipient{},
		&entity.NotifyRule{}, &entity.NotifyChannel{}, &entity.NetworkDevice{},
	} {
		if err := db.Unscoped().Where("1 = 1").Delete(m).Error; err != nil {
			t.Fatalf("clear: %v", err)
		}
	}
	return db
}

func notifyDevice(t *testing.T, db *gorm.DB, status string) entity.NetworkDevice {
	t.Helper()
	d := entity.NetworkDevice{Name: "lab-80e", MgmtIP: "10.10.20.90", Port: 22, Status: status}
	if err := db.Create(&d).Error; err != nil {
		t.Fatalf("create device: %v", err)
	}
	return d
}

// ─── what the sweep looks at ─────────────────────────────────────────────────

// A disabled rule must cost nothing: no state row, no event, and the device not even counted.
// Otherwise "turn this alert off" means "keep polling the firewall for it".
func TestNotifySweep_IgnoresDisabledRules(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "active")

	rule := entity.NotifyRule{
		Name: "cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: dev.ID,
		Enabled: false, Threshold: 1, SustainedPolls: 1,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	res := RunNotifySweep(db, time.Now())
	if res.Rules != 0 || res.Devices != 0 || res.Fired != 0 {
		t.Errorf("a disabled rule was swept: %+v", res)
	}
	var states int64
	db.Model(&entity.NotifyRuleState{}).Count(&states)
	if states != 0 {
		t.Errorf("a disabled rule left %d state row(s)", states)
	}
}

// An inactive device is not polled either — the inventory's status is the switch for "do not touch
// this box", and an alerting sweep is a touch.
func TestNotifySweep_SkipsInactiveDevices(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "maintenance")

	rule := entity.NotifyRule{
		Name: "cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: dev.ID,
		Enabled: true, Threshold: 1, SustainedPolls: 1,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	if res := RunNotifySweep(db, time.Now()); res.Devices != 0 {
		t.Errorf("a device in maintenance was polled: %+v", res)
	}
}

// A rule with NetworkDeviceID 0 means "every device". It has to reach a device it was not written
// for, or a fleet-wide alert silently covers nothing.
func TestNotifySweep_AFleetRuleAppliesToEveryActiveDevice(t *testing.T) {
	db := notifyTestDB(t)
	notifyDevice(t, db, "active")
	notifyDevice(t, db, "active")
	notifyDevice(t, db, "inactive")

	rule := entity.NotifyRule{
		Name: "fleet cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: 0,
		Enabled: true, Threshold: 1, SustainedPolls: 1,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	res := RunNotifySweep(db, time.Now())
	if res.Devices != 2 {
		t.Errorf("a fleet rule reached %d device(s), want the 2 active ones: %+v", res.Devices, res)
	}
	if res.Rules != 2 {
		t.Errorf("rule applications = %d, want one per active device", res.Rules)
	}
}

func TestNotifySweep_IsSafeWithNoDatabase(t *testing.T) {
	if res := RunNotifySweep(nil, time.Now()); res.Devices != 0 || res.Fired != 0 {
		t.Errorf("a nil database produced work: %+v", res)
	}
}

// ─── the state key ───────────────────────────────────────────────────────────

// Two subjects under one rule must own separate state. If they shared it, port2 flapping would
// reset port1's streak and the alert for port1 would never reach its sustained threshold — a
// silent failure to warn, which is the worst kind an alerting system has.
func TestApplyNotifyRule_KeepsStatePerSubject(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "active")

	rule := entity.NotifyRule{
		Name: "link", Kind: entity.NotifyKindInterfaceLink, NetworkDeviceID: dev.ID,
		Enabled: true, SustainedPolls: 1, NotifyOnResolve: true,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	probe := NotifyProbe{
		Reachable: true,
		Interfaces: []NotifyInterfaceState{
			{Name: "port1", Up: false},
			{Name: "port2", Up: false},
		},
	}
	now := time.Now()
	fired, _, _ := applyNotifyRule(db, rule, dev, probe, map[uint]entity.NotifyChannel{}, now)
	if fired != 2 {
		t.Fatalf("two down ports fired %d alert(s), want 2", fired)
	}

	var states []entity.NotifyRuleState
	if err := db.Where("notify_rule_id = ?", rule.ID).Order("subject ASC").Find(&states).Error; err != nil {
		t.Fatalf("read states: %v", err)
	}
	if len(states) != 2 {
		t.Fatalf("got %d state row(s) for two subjects, want 2 — they are sharing a key", len(states))
	}
	if states[0].Subject == states[1].Subject {
		t.Errorf("both state rows carry subject %q", states[0].Subject)
	}
	for _, st := range states {
		if !st.Firing {
			t.Errorf("subject %q is not recorded as firing", st.Subject)
		}
	}
}

// The same signal arriving again must not fire again while the cooldown holds — and it must still
// be COUNTED, so the sweep's own numbers say "we suppressed this" rather than "nothing happened".
func TestApplyNotifyRule_SuppressesARepeatWithinTheCooldown(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "active")

	rule := entity.NotifyRule{
		Name: "cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: dev.ID,
		Enabled: true, Threshold: 50, SustainedPolls: 1, CooldownMinutes: 60,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	probe := NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 90}
	now := time.Now()
	channels := map[uint]entity.NotifyChannel{}

	if fired, _, _ := applyNotifyRule(db, rule, dev, probe, channels, now); fired != 1 {
		t.Fatalf("the first breach fired %d times, want 1", fired)
	}
	fired, _, suppressed := applyNotifyRule(db, rule, dev, probe, channels, now.Add(5*time.Minute))
	if fired != 0 {
		t.Errorf("a repeat inside the 60-minute cooldown fired again")
	}
	if suppressed != 1 {
		t.Errorf("the suppressed repeat was not counted (suppressed = %d)", suppressed)
	}

	var events int64
	db.Model(&entity.NotifyEvent{}).Count(&events)
	if events != 1 {
		t.Errorf("%d history row(s) for one alert plus one suppressed repeat, want 1", events)
	}
}

// ─── the history row ─────────────────────────────────────────────────────────

// A rule with no recipients cannot deliver anything. The event must still be recorded, because
// "fired but went nowhere" is exactly what an operator needs to be able to see.
func TestEmitNotifyEvent_RecordsAnUndeliverableAlert(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "active")

	rule := entity.NotifyRule{
		Name: "cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: dev.ID,
		Enabled: true, Threshold: 50, SustainedPolls: 1,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}

	probe := NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 95}
	if fired, _, _ := applyNotifyRule(db, rule, dev, probe, map[uint]entity.NotifyChannel{}, time.Now()); fired != 1 {
		t.Fatalf("the breach did not fire")
	}

	var ev entity.NotifyEvent
	if err := db.First(&ev).Error; err != nil {
		t.Fatalf("no history row was written for an alert that could not be delivered: %v", err)
	}
	if ev.NotifyRuleID != rule.ID || ev.NetworkDeviceID != dev.ID {
		t.Errorf("the history row does not identify the rule and device: %+v", ev)
	}
	if ev.State != entity.NotifyStateFiring {
		t.Errorf("state = %q, want %q", ev.State, entity.NotifyStateFiring)
	}
	if ev.Delivered != 0 {
		t.Errorf("delivered = %d with no recipients configured", ev.Delivered)
	}
}

// Deleting a rule must take its per-subject state with it, or re-creating a rule with the same id
// inherits a stale streak and either fires immediately or stays silent through a real outage.
func TestPurgeNotifyStateForRule_LeavesNothingBehind(t *testing.T) {
	db := notifyTestDB(t)
	dev := notifyDevice(t, db, "active")

	rule := entity.NotifyRule{
		Name: "cpu", Kind: entity.NotifyKindCPUPeak, NetworkDeviceID: dev.ID,
		Enabled: true, Threshold: 10, SustainedPolls: 1,
	}
	if err := db.Create(&rule).Error; err != nil {
		t.Fatalf("create rule: %v", err)
	}
	applyNotifyRule(db, rule, dev, NotifyProbe{Reachable: true, HaveCPU: true, CPUPercent: 99},
		map[uint]entity.NotifyChannel{}, time.Now())

	var before int64
	db.Model(&entity.NotifyRuleState{}).Where("notify_rule_id = ?", rule.ID).Count(&before)
	if before == 0 {
		t.Fatal("no state to purge — the fixture did not fire")
	}

	PurgeNotifyStateForRule(db, rule.ID)

	var after int64
	db.Model(&entity.NotifyRuleState{}).Where("notify_rule_id = ?", rule.ID).Count(&after)
	if after != 0 {
		t.Errorf("%d state row(s) survived the purge", after)
	}
}

// ─── what the sweep asks the device for ──────────────────────────────────────

// needsFor is what keeps the sweep from reading tables nobody asked about: a device with only a CPU
// rule must not have its licence table or its interface list fetched. It is pure, so it is tested
// here rather than through a probe.
func TestNeedsFor_AsksOnlyForWhatTheRulesUse(t *testing.T) {
	cases := []struct {
		name string
		kind string
		want notifyNeeds
	}{
		{"cpu", entity.NotifyKindCPUPeak, notifyNeeds{resources: true}},
		{"memory", entity.NotifyKindMemoryPeak, notifyNeeds{resources: true}},
		{"sessions", entity.NotifyKindSessionSpike, notifyNeeds{resources: true}},
		{"disk", entity.NotifyKindDiskUsage, notifyNeeds{resources: true}},
		{"link", entity.NotifyKindInterfaceLink, notifyNeeds{interfaces: true}},
		{"licence", entity.NotifyKindLicenseExpiry, notifyNeeds{licenses: true}},
		{"drift", entity.NotifyKindConfigDrift, notifyNeeds{drift: true}},
	}
	for _, c := range cases {
		if got := needsFor([]entity.NotifyRule{{Kind: c.kind}}); got != c.want {
			t.Errorf("%s: needs %+v, want %+v", c.name, got, c.want)
		}
	}

	if got := needsFor(nil); got != (notifyNeeds{}) {
		t.Errorf("no rules should need no reads, got %+v", got)
	}

	all := needsFor([]entity.NotifyRule{
		{Kind: entity.NotifyKindCPUPeak},
		{Kind: entity.NotifyKindInterfaceLink},
		{Kind: entity.NotifyKindLicenseExpiry},
		{Kind: entity.NotifyKindConfigDrift},
	})
	if all != (notifyNeeds{interfaces: true, resources: true, licenses: true, drift: true}) {
		t.Errorf("a mixed rule set needs %+v", all)
	}

	// An unreachable device must not be probed for anything on the strength of an unknown kind.
	if got := needsFor([]entity.NotifyRule{{Kind: "something-we-do-not-ship"}}); got != (notifyNeeds{}) {
		t.Errorf("an unknown rule kind asked for reads: %+v", got)
	}
}
