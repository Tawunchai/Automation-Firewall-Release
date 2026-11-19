package services

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"sync"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

// Keeping the numbers a firewall does not keep.
//
// The kinds below are the whole vocabulary. Each says what its Value means, because the table
// stores a bare float and a reader that guesses the unit draws a wrong chart with no error.

const (
	// MetricSLALatency, MetricSLAJitter: milliseconds. MetricSLALoss: percent.
	// Subject is the SD-WAN member's interface name, prefixed with the health check it belongs to
	// ("ISP-Health/wan1") — the same interface can participate in several checks with different
	// servers, and merging them would average two unrelated probes.
	MetricSLALatency = "sla_latency_ms"
	MetricSLAJitter  = "sla_jitter_ms"
	MetricSLALoss    = "sla_loss_pct"

	// MetricTunnelUp: 1 when every phase 2 selector has an SA, 0 when none does, 0.5 when some do.
	// Subject is the phase 1 name. A fraction rather than a bool because "half the selectors are
	// down" is the state an operator most needs to see and a boolean erases it.
	MetricTunnelUp = "tunnel_up"

	// MetricCPU, MetricMemory: percent. MetricSessions: a count. Subject is "".
	// FortiOS keeps 24 hours of these itself; this is what makes a week or a quarter possible.
	MetricCPU      = "cpu_pct"
	MetricMemory   = "mem_pct"
	MetricSessions = "sessions"

	// MetricIfRxBytes, MetricIfTxBytes: the device's CUMULATIVE byte counters, in bytes, per
	// interface. Subject is the interface name.
	//
	// Stored as the device reports them rather than as a rate, for the same reason the policy hit
	// counter is: a rate needs two readings and a spacing, and a stored rate would be a number this
	// console computed that nothing on the device can be checked against. The reader divides
	// consecutive samples by the interval — and a NEGATIVE difference means the counter reset
	// (the interface bounced, the device rebooted), which is dropped rather than charted as a spike.
	MetricIfRxBytes = "if_rx_bytes"
	MetricIfTxBytes = "if_tx_bytes"

	// MetricPolicyHits: the device's CUMULATIVE hit counter for one policy, not a rate. Subject is
	// the policy id as a string. Stored raw because the counter resets when the device reboots, and
	// a reader that can see the raw series can tell a reset from a quiet hour; one handed a
	// pre-computed delta cannot.
	MetricPolicyHits = "policy_hits"
)

// MetricSampleInterval is how often a device is asked.
//
// Not every tick. The scheduler's 60-second loop already reaches these firewalls for backups and
// for the alert sweep, and this console runs against units that lock an admin account after three
// failed logins — the reason the notify sweep rides the same tick instead of keeping its own timer.
// Five minutes is enough resolution to see an SLA breach or a tunnel flap while adding one round of
// reads per device per five minutes.
const MetricSampleInterval = 5 * time.Minute

// maxPoliciesSampled bounds the one kind whose row count scales with the CONFIGURATION rather than
// with the device count.
//
// Ten policies on the lab unit is nothing; a real edge firewall has hundreds, and at 288 samples a
// day each that is the difference between thousands of rows a day and hundreds of thousands. The
// busiest policies are the ones anybody charts, so the sampler takes those and stops.
const maxPoliciesSampled = 50

// maxInterfacesSampled bounds the other kind that scales with the configuration.
//
// A lab unit has twenty ports; a device with a VLAN per customer has hundreds, and each one costs
// two rows a sweep. The busiest are the ones anybody charts, so the sampler takes those and stops.
const maxInterfacesSampled = 40

// MetricSweepResult is what one pass wrote, for the scheduler's log line.
type MetricSweepResult struct {
	Devices int
	Samples int
	Errors  int
}

// sampleDeviceMetrics reads one device and returns the rows to store. It writes nothing, so it can
// be tested without a database and called from anywhere that already holds a client.
//
// Deliberately forgiving: a firewall that answers three of the four reads still contributes three.
// The alternative — one failure discards the sweep — means a device with SD-WAN switched off (which
// is every device in the lab) would never record its CPU either.
func sampleDeviceMetrics(fc *FortiClient, deviceID uint, now time.Time) ([]entity.MetricSample, []error) {
	var (
		mu   sync.Mutex
		out  []entity.MetricSample
		errs []error
	)
	add := func(kind, subject string, v float64) {
		mu.Lock()
		out = append(out, entity.MetricSample{
			NetworkDeviceID: deviceID, Kind: kind, Subject: subject, At: now.UTC(), Value: v,
		})
		mu.Unlock()
	}
	fail := func(what string, err error) {
		mu.Lock()
		errs = append(errs, fmt.Errorf("%s: %w", what, err))
		mu.Unlock()
	}

	var wg sync.WaitGroup
	wg.Add(5)

	// ── device resources ──
	go func() {
		defer wg.Done()
		// The finest interval the device offers, because this samples every five minutes and a
		// coarser one would hand back a figure already averaged over an hour.
		u, err := fc.GetResourceUsage("1-min")
		if err != nil {
			fail("resource usage", err)
			return
		}
		if v, ok := latestOf(u.CPU); ok {
			add(MetricCPU, "", v)
		}
		if v, ok := latestOf(u.Memory); ok {
			add(MetricMemory, "", v)
		}
		if v, ok := latestOf(u.Sessions); ok {
			add(MetricSessions, "", v)
		}
	}()

	// ── tunnels ──
	go func() {
		defer wg.Done()
		report, err := fc.GetVPNTunnelHealth()
		if err != nil {
			fail("vpn health", err)
			return
		}
		for _, t := range report.Tunnels {
			add(MetricTunnelUp, t.Name, tunnelUpValue(t))
		}
	}()

	// ── SD-WAN performance SLAs ──
	go func() {
		defer wg.Done()
		checks, err := fc.GetSDWANHealthChecks()
		if err != nil {
			// An SD-WAN that is switched off is not an error worth counting: the device answers,
			// it just has nothing to say. Only a genuine failure is reported.
			if !isSDWANAbsent(err) {
				fail("sdwan health", err)
			}
			return
		}
		for _, c := range checks {
			for _, live := range c.Live {
				subject := c.Name + "/" + live.Interface
				if live.Latency != nil {
					add(MetricSLALatency, subject, *live.Latency)
				}
				if live.Jitter != nil {
					add(MetricSLAJitter, subject, *live.Jitter)
				}
				if live.PacketLoss != nil {
					add(MetricSLALoss, subject, *live.PacketLoss)
				}
			}
		}
	}()

	// ── interface counters ──
	go func() {
		defer wg.Done()
		stats := fc.interfaceStats()
		if len(stats) == 0 {
			// Best-effort, and silent: interfaceStats swallows its error because the SD-WAN page
			// treats these as an extra. A device with no interfaces is not a thing, so an empty map
			// here means the read failed — but it is the same failure the rest of the console
			// already tolerates, and counting it would make every sweep on such a device "an error".
			return
		}
		for _, st := range topInterfacesByVolume(stats, maxInterfacesSampled) {
			add(MetricIfRxBytes, st.name, float64(st.RxBytes))
			add(MetricIfTxBytes, st.name, float64(st.TxBytes))
		}
	}()

	// ── policy hit counters ──
	go func() {
		defer wg.Done()
		// staleDays only affects the report's own verdict field, which this does not read.
		report, err := fc.GetPolicyUsage(90)
		if err != nil {
			fail("policy stats", err)
			return
		}
		// The device refused monitor/firewall/policy: every policy then reports zero hits, and
		// storing that would draw a chart showing traffic stopping. Record nothing instead.
		if !report.CountersAvailable {
			return
		}
		for _, p := range topPoliciesByHits(report.Policies, maxPoliciesSampled) {
			add(MetricPolicyHits, strconv.Itoa(p.PolicyID), float64(p.HitCount))
		}
	}()

	wg.Wait()

	// Stable order so a test can compare, and so a log line reads the same way twice.
	sort.Slice(out, func(i, j int) bool {
		if out[i].Kind != out[j].Kind {
			return out[i].Kind < out[j].Kind
		}
		return out[i].Subject < out[j].Subject
	})
	return out, errs
}

// tunnelUpValue turns a tunnel's health into a number: 1 up, 0 down, 0.5 partial.
//
// A tunnel with no phase 2 at all is DOWN rather than absent. It exists in the configuration and it
// is carrying nothing, which is the thing an operator wants to see on a chart — recording nothing
// would draw a gap that reads as "not monitored".
func tunnelUpValue(t FGTunnelHealth) float64 {
	switch t.Health {
	case TunnelHealthUp:
		return 1
	case TunnelHealthPartial:
		return 0.5
	default:
		return 0
	}
}

// latestOf takes the most recent point of a monitor-API series.
//
// FortiOS returns these newest-first and ParseResourceUsage already reverses them, so the newest is
// the LAST element. Worth stating because the raw device order is the opposite and taking index 0
// here would have stored a reading up to twenty-four hours old, every five minutes, producing a
// chart that was flat and wrong rather than obviously broken.
//
// Current is the fallback when a device sends no history at all.
func latestOf(s FGUsageSeries) (float64, bool) {
	if len(s.Points) > 0 {
		return s.Points[len(s.Points)-1].V, true
	}
	return s.Current, s.Current != 0
}

// isSDWANAbsent reports whether the error is just "this device has no SD-WAN configured".
func isSDWANAbsent(err error) bool {
	var de *DeviceError
	if errors.As(err, &de) {
		// -3 is FortiOS's "entry not found in datasource" — the table is not there at all.
		return de.Code == -3 || de.HTTPStatus == 404
	}
	return false
}

// namedInterfaceStats is one interface's counters with the name the map keyed them by.
type namedInterfaceStats struct {
	name string
	fgInterfaceStats
}

// topInterfacesByVolume returns the n busiest interfaces, and drops the ones with nothing to say.
//
// An interface with no link that has never carried a byte is a port with nothing plugged into it —
// this lab device has sixteen of them. Storing two flat zero series each, every five minutes,
// would fill the biggest table in the schema with the fact that a socket is empty.
//
// A port that is down but HAS carried traffic is kept: that is a link that went away, which is
// exactly what someone would come to this chart to see.
func topInterfacesByVolume(stats map[string]fgInterfaceStats, n int) []namedInterfaceStats {
	out := make([]namedInterfaceStats, 0, len(stats))
	for name, st := range stats {
		if !st.Link && st.RxBytes == 0 && st.TxBytes == 0 {
			continue
		}
		out = append(out, namedInterfaceStats{name: name, fgInterfaceStats: st})
	}
	sort.Slice(out, func(i, j int) bool {
		vi := out[i].RxBytes + out[i].TxBytes
		vj := out[j].RxBytes + out[j].TxBytes
		if vi != vj {
			return vi > vj
		}
		// A stable tie-break, so two sweeps of an idle device do not sample different interfaces.
		return out[i].name < out[j].name
	})
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// topPoliciesByHits returns the n busiest policies. See maxPoliciesSampled for why there is a cap.
func topPoliciesByHits(stats []FGPolicyUsage, n int) []FGPolicyUsage {
	out := make([]FGPolicyUsage, 0, len(stats))
	for _, p := range stats {
		// policyid 0 is the implicit deny; it is not a rule anybody wrote and it is filtered out of
		// every other view for the same reason.
		if p.PolicyID > 0 {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].HitCount > out[j].HitCount })
	if len(out) > n {
		out = out[:n]
	}
	return out
}

// storeMetricSamples writes a batch. Chunked because a device with fifty policies plus tunnels
// produces enough rows that one statement starts to matter, and Postgres has a parameter limit.
func storeMetricSamples(db *gorm.DB, rows []entity.MetricSample) error {
	if db == nil || len(rows) == 0 {
		return nil
	}
	return db.CreateInBatches(rows, 200).Error
}

// ── Reading it back ──────────────────────────────────────────────────────────

// MetricPoint is one point on a chart.
type MetricPoint struct {
	At    time.Time `json:"at"`
	Value float64   `json:"value"`
}

// MetricSeries is everything a chart needs for one line.
type MetricSeries struct {
	Kind    string        `json:"kind"`
	Subject string        `json:"subject"`
	Points  []MetricPoint `json:"points"`
}

// MetricQuery is what a caller asks for. Kinds and Subjects are both optional filters; From/To
// bound the window.
type MetricQuery struct {
	DeviceID uint
	Kinds    []string
	Subjects []string
	From     time.Time
	To       time.Time
	// Limit caps the points returned PER SERIES. A quarter of five-minute samples is 26,000 points
	// for a chart a few hundred pixels wide, so the reader thins them rather than shipping all of
	// it — see thin().
	Limit int
}

// MaxMetricPoints is the default per-series cap. Chosen to be more than any chart width and small
// enough that a year of one series is a response measured in tens of kilobytes.
const MaxMetricPoints = 1000

// ReadMetricSeries returns one series per (kind, subject) present in the window.
func ReadMetricSeries(db *gorm.DB, q MetricQuery) ([]MetricSeries, error) {
	if db == nil {
		return nil, errors.New("no database")
	}
	if q.DeviceID == 0 {
		return nil, errors.New("device id is required")
	}
	if q.To.IsZero() {
		q.To = time.Now().UTC()
	}
	if q.From.IsZero() {
		q.From = q.To.Add(-24 * time.Hour)
	}
	if q.Limit <= 0 || q.Limit > MaxMetricPoints {
		q.Limit = MaxMetricPoints
	}

	tx := db.Model(&entity.MetricSample{}).
		Where("network_device_id = ? AND at >= ? AND at <= ?", q.DeviceID, q.From.UTC(), q.To.UTC())
	if len(q.Kinds) > 0 {
		tx = tx.Where("kind IN ?", q.Kinds)
	}
	if len(q.Subjects) > 0 {
		tx = tx.Where("subject IN ?", q.Subjects)
	}

	var rows []entity.MetricSample
	if err := tx.Order("kind asc, subject asc, at asc").Find(&rows).Error; err != nil {
		return nil, err
	}

	type key struct{ kind, subject string }
	order := []key{}
	grouped := map[key][]MetricPoint{}
	for _, r := range rows {
		k := key{r.Kind, r.Subject}
		if _, seen := grouped[k]; !seen {
			order = append(order, k)
		}
		grouped[k] = append(grouped[k], MetricPoint{At: r.At.UTC(), Value: r.Value})
	}

	out := make([]MetricSeries, 0, len(order))
	for _, k := range order {
		out = append(out, MetricSeries{Kind: k.kind, Subject: k.subject, Points: thin(grouped[k], q.Limit)})
	}
	return out, nil
}

// thin reduces a series to at most n points by taking every kth.
//
// Not an average. These are gauges — a latency, a session count, a tunnel's state — and averaging
// an SLA breach with the calm either side of it is how a spike disappears from the chart that
// exists to show spikes. Sampling keeps the real readings and loses some of them, which is honest
// about what it did; the FIRST and LAST points are always kept so the window's ends line up with
// what the caller asked for.
func thin(pts []MetricPoint, n int) []MetricPoint {
	if n <= 0 || len(pts) <= n {
		return pts
	}
	// n == 1 cannot keep both ends. It keeps the NEWEST, because a single point standing for a
	// window is read as "where this ended up". Special-cased rather than left to the arithmetic
	// below, which divides by n-1 and produced +Inf, then a NaN index, then a panic — found by
	// TestThinKeepsBothEndsAndNeverGrows before any caller could ask for it.
	if n == 1 {
		return []MetricPoint{pts[len(pts)-1]}
	}
	step := float64(len(pts)-1) / float64(n-1)
	out := make([]MetricPoint, 0, n)
	for i := 0; i < n; i++ {
		out = append(out, pts[int(float64(i)*step)])
	}
	out[len(out)-1] = pts[len(pts)-1]
	return out
}

// ── The sweep ────────────────────────────────────────────────────────────────

// RunMetricSweep samples every device the console can reach and stores what came back.
//
// Like the notify sweep, a device that will not answer is this function's own problem: it is
// counted and the sweep moves on. Nothing here may fail the scheduler tick that also drives backups.
func RunMetricSweep(ctx context.Context, db *gorm.DB, now time.Time) MetricSweepResult {
	var res MetricSweepResult
	if db == nil {
		return res
	}

	var devices []entity.NetworkDevice
	if err := db.Find(&devices).Error; err != nil {
		res.Errors++
		return res
	}

	for _, d := range devices {
		select {
		case <-ctx.Done():
			return res
		default:
		}

		// Scheduled work has no signed-in user, so it uses whichever credential the device row
		// carries — the same resolution path as the backup sweep.
		login, err := ResolveDeviceLogin(db, 0, &d)
		if err != nil {
			res.Errors++
			continue
		}
		fc, err := AcquireFortiClient(d.ID, d.MgmtIP, d.APIPort, login)
		if err != nil {
			res.Errors++
			continue
		}

		rows, errs := sampleDeviceMetrics(fc.WithContext(ctx), d.ID, now)
		res.Errors += len(errs)
		if len(rows) == 0 {
			continue
		}
		if err := storeMetricSamples(db, rows); err != nil {
			res.Errors++
			continue
		}
		res.Devices++
		res.Samples += len(rows)
	}
	return res
}

// ── The vocabulary, as data ──────────────────────────────────────────────────

// metricKinds is every kind this console samples. Listed once, here, so the API can reject a
// misspelled one with the list instead of returning an empty chart that looks like "no data".
var metricKinds = []string{
	MetricCPU, MetricMemory, MetricSessions,
	MetricTunnelUp,
	MetricSLALatency, MetricSLAJitter, MetricSLALoss,
	MetricPolicyHits,
	MetricIfRxBytes, MetricIfTxBytes,
}

// MetricKinds returns the known kinds, for an error message or a picker.
func MetricKinds() []string { return append([]string(nil), metricKinds...) }

// IsKnownMetricKind reports whether k is one this console records.
func IsKnownMetricKind(k string) bool {
	for _, known := range metricKinds {
		if known == k {
			return true
		}
	}
	return false
}
