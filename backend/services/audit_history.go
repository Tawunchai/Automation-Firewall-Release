package services

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// ── Audit history ────────────────────────────────────────────────────────────
//
// Turns a stream of identical scans into a trend worth looking at.
//
// The Audit page rescans on every device selection, so the naive "insert a row per scan" would
// produce dozens of identical rows a day and a chart that says nothing. A run is therefore stored
// only when the finding set actually CHANGED, or when the last stored run is old enough that
// "nothing has changed since" is itself a fact worth recording.
//
// That second rule matters more than it looks: without it, a firewall nobody touches for six months
// would have exactly one data point, and the chart would be unable to distinguish "still clean" from
// "not scanned since March".

// auditHeartbeat is how long a run may go unrecorded while nothing changes.
const auditHeartbeat = 12 * time.Hour

// auditFingerprint hashes what the scan found — not when it ran, and not how long it took.
//
// It covers the check, the subject and the severity of every finding, sorted, so the same problems
// on the same objects hash the same however the scan happened to order them. Adding the scan time
// here would defeat the whole mechanism: every run would look new.
//
// The DEVICE's configuration fingerprint is in here too, and that is not the same kind of thing as
// the scan time. It moves only when the customer's configuration actually moves, and it has to be
// stored when it does — otherwise a change that alters no finding (a renamed object, an edited
// comment, a schedule swapped for an equivalent one) is never recorded, the stored revision goes
// stale, and change-unrecorded reports the same unattributed change on every scan from then on
// with no way for anyone to clear it. "The configuration moved and the findings did not" is a fact
// worth a row of its own.
func auditFingerprint(rep AuditReport) string {
	lines := make([]string, 0, len(rep.Findings)+len(rep.UndecidedChecks)+1)
	if rep.ConfigFingerprint != "" {
		lines = append(lines, "config|"+rep.ConfigFingerprint)
	}
	for _, f := range rep.Findings {
		lines = append(lines, fmt.Sprintf("%s|%s|%s", f.Check, f.Severity, f.Subject))
	}
	// An undecidable check changes what the report CLAIMS even when the findings are identical, so
	// it belongs in the fingerprint.
	for _, c := range rep.UndecidedChecks {
		lines = append(lines, "undecided|"+c)
	}
	sort.Strings(lines)

	h := sha256.New()
	for _, l := range lines {
		h.Write([]byte(l))
		h.Write([]byte{'\n'})
	}
	return hex.EncodeToString(h.Sum(nil))
}

// auditStandardsSummary is the per-framework breakdown stored alongside the totals.
type auditStandardsSummary struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	Version       string `json:"version"`
	Gaps          int    `json:"gaps"`
	Indeterminate int    `json:"indeterminate"`
	Evidenced     int    `json:"evidenced"`
	Observations  int    `json:"observations"`
	NotAssessed   int    `json:"not_assessed"`
	InScope       int    `json:"in_scope"`
}

// RecordAuditRun stores a scan if it is worth storing, and reports whether it did.
//
// Never returns an error to the caller's request path: a trend point that could not be written is
// not a reason to fail the scan the user actually asked for. Failures are swallowed deliberately —
// the audit endpoint has to keep working on a database that is read-only or full.
func RecordAuditRun(db *gorm.DB, deviceID uint, userID uint, userEmail string, serial, firmware string, rep AuditReport) bool {
	if db == nil || deviceID == 0 {
		return false
	}

	fp := auditFingerprint(rep)

	var last entity.AuditRun
	err := db.Where("network_device_id = ?", deviceID).Order("scanned_at DESC").First(&last).Error
	switch {
	case err == nil:
		// Same findings AND recent enough — nothing to add.
		if last.Fingerprint == fp && time.Since(last.ScannedAt) < auditHeartbeat {
			return false
		}
	case err != gorm.ErrRecordNotFound:
		return false
	}

	summaries := make([]auditStandardsSummary, 0, len(rep.Standards))
	var gaps, indet, evid, obs, notAssessed, inScope int
	for _, fw := range rep.Standards {
		gaps += fw.Gaps
		indet += fw.Indeterminate
		evid += fw.Evidenced
		obs += fw.Observations
		notAssessed += fw.NotAssessed
		inScope += len(fw.Controls)
		summaries = append(summaries, auditStandardsSummary{
			ID: fw.ID, Name: fw.Name, Version: fw.Version,
			Gaps: fw.Gaps, Indeterminate: fw.Indeterminate, Evidenced: fw.Evidenced,
			Observations: fw.Observations, NotAssessed: fw.NotAssessed, InScope: len(fw.Controls),
		})
	}
	blob, _ := json.Marshal(summaries)

	run := entity.AuditRun{
		NetworkDeviceID: deviceID,
		AppUserID:       userID,
		UserEmail:       userEmail,
		ScannedAt:       rep.ScannedAt,
		High:            rep.Counts["high"],
		Medium:          rep.Counts["medium"],
		Low:             rep.Counts["low"],
		Total:           len(rep.Findings),
		Gaps:            gaps,
		Indeterminate:   indet,
		Evidenced:       evid,
		Observations:    obs,
		NotAssessed:     notAssessed,
		InScope:         inScope,
		Standards:       string(blob),
		// Stored so a trend that crosses a catalogue revision can be read as one. Version and
		// status are two different facts; conflating them is what made this column useless before.
		CatalogueVersion: CatalogueVersion,
		CatalogueStatus:  CatalogueStatusValue(),
		DeviceSerial:     serial,
		DeviceFirmware:   firmware,
		ConfigRevision:   rep.ConfigFingerprint,
		Fingerprint:      fp,
	}
	return db.Create(&run).Error == nil
}

// AuditTrendPoint is one stored run, shaped for a chart.
type AuditTrendPoint struct {
	ScannedAt     time.Time `json:"scanned_at"`
	High          int       `json:"high"`
	Medium        int       `json:"medium"`
	Low           int       `json:"low"`
	Total         int       `json:"total"`
	Gaps          int       `json:"gaps"`
	Indeterminate int       `json:"indeterminate"`
	Evidenced     int       `json:"evidenced"`
	Observations  int       `json:"observations"`
	NotAssessed   int       `json:"not_assessed"`
	InScope       int       `json:"in_scope"`
	// CatalogueVersion travels with every point so a chart can mark where OUR interpretation
	// changed. Without it a revision of the mapping looks exactly like the firewall regressing.
	CatalogueVersion string                  `json:"catalogue_version,omitempty"`
	Frameworks       []auditStandardsSummary `json:"frameworks,omitempty"`
	UserEmail        string                  `json:"user_email,omitempty"`
	DeviceSerial     string                  `json:"device_serial,omitempty"`
}

// AuditTrend returns the stored runs for a device, oldest first so a chart can plot them directly.
func AuditTrend(db *gorm.DB, deviceID uint, limit int) ([]AuditTrendPoint, error) {
	if limit <= 0 || limit > 500 {
		limit = 120
	}
	var rows []entity.AuditRun
	// Newest-first in SQL so the LIMIT keeps the most RECENT runs, then reversed for the chart —
	// ordering ascending here would cap the history at the oldest N and freeze the graph.
	if err := db.Where("network_device_id = ?", deviceID).
		Order("scanned_at DESC").Limit(limit).Find(&rows).Error; err != nil {
		return nil, err
	}

	out := make([]AuditTrendPoint, 0, len(rows))
	for i := len(rows) - 1; i >= 0; i-- {
		r := rows[i]
		p := AuditTrendPoint{
			ScannedAt: r.ScannedAt, High: r.High, Medium: r.Medium, Low: r.Low, Total: r.Total,
			Gaps: r.Gaps, Indeterminate: r.Indeterminate, Evidenced: r.Evidenced,
			Observations: r.Observations, NotAssessed: r.NotAssessed, InScope: r.InScope,
			CatalogueVersion: r.CatalogueVersion,
			UserEmail:        r.UserEmail, DeviceSerial: r.DeviceSerial,
		}
		if r.Standards != "" {
			_ = json.Unmarshal([]byte(r.Standards), &p.Frameworks)
		}
		out = append(out, p)
	}
	return out, nil
}

// ── Retention ────────────────────────────────────────────────────────────────
//
// The history table only ever grew. On a fleet under active change that is a row per device per
// change plus one per device every twelve hours — small per row, unbounded over years, and the
// kind of table nobody notices until a restore takes an afternoon.
//
// Two rules, because "delete anything older than N" alone would quietly destroy the thing the
// table exists for:
//
//  1. Nothing inside the retention window is touched.
//  2. Outside it, the OLDEST run for each device survives regardless of age. That row is the
//     baseline a trend is measured from — "we started at 34 findings" is the sentence the whole
//     feature exists to support, and it is the first row a naive purge would delete.

// AuditRunRetention is how far back the full history is kept. Two years covers the two annual
// audits a customer is likely to be asked about, plus the review in between.
const AuditRunRetention = 730 * 24 * time.Hour

// auditRunsToPurge decides which stored runs may go.
//
// Split out from the delete so the RULE can be tested without a database — the two guarantees it
// makes are the whole point of the feature and neither is obvious from a SQL statement:
//
//	· nothing inside the retention window is touched;
//	· the OLDEST run for each device survives regardless of age, because that row is the baseline
//	  every trend is measured from. "We started at 34 findings" is the sentence this table exists
//	  to support, and it is the first row a plain "delete anything older than N" would remove.
func auditRunsToPurge(rows []entity.AuditRun, now time.Time, retention time.Duration) []uint {
	cutoff := now.Add(-retention)

	baseline := map[uint]entity.AuditRun{}
	for _, r := range rows {
		cur, seen := baseline[r.NetworkDeviceID]
		if !seen || r.ScannedAt.Before(cur.ScannedAt) {
			baseline[r.NetworkDeviceID] = r
		}
	}

	var ids []uint
	for _, r := range rows {
		if !r.ScannedAt.Before(cutoff) {
			continue
		}
		if baseline[r.NetworkDeviceID].ID == r.ID {
			continue
		}
		ids = append(ids, r.ID)
	}
	return ids
}

// PurgeOldAuditRuns deletes stored scans past their retention and returns how many went.
func PurgeOldAuditRuns(db *gorm.DB, now time.Time) int {
	if db == nil {
		return 0
	}

	// Only the three columns the decision needs, so the sweep does not pull whole rows — Standards
	// is a JSON blob per run and there is no reason to read it in order to delete it.
	var rows []entity.AuditRun
	if err := db.Select("id", "network_device_id", "scanned_at").Find(&rows).Error; err != nil {
		return 0
	}

	ids := auditRunsToPurge(rows, now, AuditEvidenceRetention)
	if len(ids) == 0 {
		return 0
	}

	// Hard delete: a soft-deleted row still occupies the table this function exists to bound, and
	// nothing reads audit runs through Unscoped.
	res := db.Unscoped().Delete(&entity.AuditRun{}, ids)
	if res.Error != nil {
		return 0
	}
	return int(res.RowsAffected)
}
