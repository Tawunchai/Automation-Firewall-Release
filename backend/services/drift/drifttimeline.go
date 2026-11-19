package drift

import (
	"network_automation/services"
	"strings"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// One timeline of every change to a firewall — the Configuration Drift page's main list.
//
// The page used to show two lists side by side, the Change Ledger ("what this console did") and the
// drift findings ("what changed that it did not do"), and a reader had to understand how the two
// related before either made sense. They are one history seen from two sources, so they are served
// as one list, newest first, each entry saying where it came from and what can be done about it:
//
//	console  a Change Ledger row: who, when, before/after. Undo = the exact inverse, as recorded.
//	outside  an UNATTRIBUTED drift finding: an object that differed between two backups with no
//	         ledger row to explain it. Attributed findings are not listed — the ledger row they
//	         matched already is, with more detail than the finding has.
//
// ── Fallback, by what kind of change it was ──────────────────────────────────
//
//	console change              → Undo: replay the recorded before-state (services.LedgerRevertability)
//	outside, object CREATED     → Undo: delete that object by its mkey (OutsideUndoPlan)
//	outside, object EDITED or   → Restore the backup taken before it — the whole configuration,
//	         DELETED               with a preview, and the firewall reboots
//
// The third case has no per-object undo on purpose. The console never held the previous version as
// an object, only as lines inside a backup file, and replaying config-file lines over the CLI is the
// thing this codebase already learned not to do (see controller/configdeploy.Rollback): multi-line
// values split, `ENC` secrets re-import out of context, and a failure half way leaves the object in
// neither state. A whole-file restore is atomic on the device; that is the fallback offered.

// Timeline filters.
const (
	TimelineAll     = "all"
	TimelineConsole = "console"
	TimelineOutside = "outside"
	TimelineFailed  = "failed" // console writes the device refused
)

// ValidTimelineFilter reports whether f is one of the filters above.
func ValidTimelineFilter(f string) bool {
	switch f {
	case TimelineAll, TimelineConsole, TimelineOutside, TimelineFailed:
		return true
	}
	return false
}

// Fallback kinds, as the UI explains them.
const (
	FallbackUndo    = "undo"    // one click, this change only
	FallbackRestore = "restore" // restore the backup taken before it (whole configuration, reboot)
	FallbackNone    = "none"    // nothing to take back (failed, already undone, …) — UndoNote says why
)

// TimelineItem is one change, from either source.
type TimelineItem struct {
	Kind       string    `json:"kind"` // "console" | "outside"
	ID         uint      `json:"id"`   // change_records.id or drift_findings.id, by Kind
	At         time.Time `json:"at"`
	DeviceID   uint      `json:"device_id"`
	DeviceName string    `json:"device_name,omitempty"`

	Action string `json:"action"` // create | update | delete
	Table  string `json:"table"`  // FortiOS table as the CLI writes it, "firewall address"
	Key    string `json:"key"`

	// Fallback is what the Undo/Restore control does for this row; UndoNote explains when it is
	// "none", or qualifies it when it is not.
	Fallback string `json:"fallback"`
	UndoNote string `json:"undo_note,omitempty"`

	// ── console ──
	Via        string     `json:"via,omitempty"` // the console feature that made it, "address", "audit-remediation:…"
	User       string     `json:"user,omitempty"`
	Status     string     `json:"status,omitempty"` // applied | failed | reverted
	ErrorText  string     `json:"error_text,omitempty"`
	RevertedAt *time.Time `json:"reverted_at,omitempty"`
	RevertedBy string     `json:"reverted_by,omitempty"`
	RevertOfID *uint      `json:"revert_of_id,omitempty"`
	HasBefore  bool       `json:"has_before,omitempty"`
	HasAfter   bool       `json:"has_after,omitempty"`

	// ── outside ──
	RunID uint `json:"run_id,omitempty"`
	// The change happened some time in (WindowFrom, WindowTo]: after the earlier backup and before
	// the one that revealed it. The console cannot narrow it further, and says so.
	WindowFrom *time.Time `json:"window_from,omitempty"`
	WindowTo   *time.Time `json:"window_to,omitempty"`
	// UndoChangeID is the ledger row that took this change back, when one did. Its presence is the
	// only thing that closes an outside change now: there is no longer a way to sign one off by
	// hand, so a row without it is still standing on the firewall.
	UndoChangeID    *uint `json:"undo_change_id,omitempty"`
	RestoreBackupID uint  `json:"restore_backup_id,omitempty"`
}

// TimelineCounts are the filter chips' numbers. Not windowed: the list is the whole history.
type TimelineCounts struct {
	All     int64 `json:"all"`
	Console int64 `json:"console"`
	Outside int64 `json:"outside"`
	Failed  int64 `json:"failed"`
}

// Timeline is one page of the list.
type Timeline struct {
	Items  []TimelineItem `json:"data"`
	Total  int64          `json:"total"`
	Counts TimelineCounts `json:"counts"`
	Limit  int            `json:"limit"`
	Offset int            `json:"offset"`
}

// TimelineQuery is what the caller asked for, already validated.
type TimelineQuery struct {
	UserID   uint
	IsAdmin  bool
	DeviceID uint // 0 = every device the caller may see
	Filter   string
	Limit    int
	Offset   int
}

type timelineKey struct {
	Kind      string
	ID        uint
	CreatedAt time.Time
}

// BuildTimeline pages through both sources as ONE ordered list.
//
// The ordering is done by the database over a UNION ALL of (kind, id, created_at) — the two tables'
// narrowest columns — so LIMIT/OFFSET mean the same thing they would on a single table, whatever
// the mix. Only the page's rows are then loaded in full, one query per source. Merging two
// separately paged lists in Go instead would either skip entries at page boundaries or need to read
// offset+limit rows from BOTH tables for every page.
func BuildTimeline(db *gorm.DB, q TimelineQuery) (Timeline, error) {
	out := Timeline{Items: []TimelineItem{}, Limit: q.Limit, Offset: q.Offset}

	scope := services.DeviceScopeFor(db, q.UserID, q.IsAdmin)
	narrow := func(tx *gorm.DB) *gorm.DB {
		tx = services.ApplyDeviceScope(tx, "network_device_id", scope)
		if q.DeviceID > 0 {
			tx = tx.Where("network_device_id = ?", q.DeviceID)
		}
		return tx
	}

	counts, err := timelineCounts(db, narrow)
	if err != nil {
		return out, err
	}
	out.Counts = counts

	ledger := narrow(db.Model(&entity.ChangeRecord{})).Select("'console' AS kind, id, created_at")
	outside := narrow(db.Model(&entity.DriftFinding{})).Select("'outside' AS kind, id, created_at").
		Where("attributed = ?", false)

	var parts []*gorm.DB
	switch q.Filter {
	case TimelineConsole:
		parts = []*gorm.DB{ledger}
		out.Total = counts.Console
	case TimelineFailed:
		parts = []*gorm.DB{ledger.Where("status = ?", entity.ChangeStatusFailed)}
		out.Total = counts.Failed
	case TimelineOutside:
		parts = []*gorm.DB{outside}
		out.Total = counts.Outside
	default:
		parts = []*gorm.DB{ledger, outside}
		out.Total = counts.All
	}
	if out.Total == 0 {
		return out, nil
	}

	placeholders := make([]string, len(parts))
	args := make([]interface{}, 0, len(parts)+2)
	for i, p := range parts {
		placeholders[i] = "?"
		args = append(args, p)
	}
	args = append(args, q.Limit, q.Offset)

	var keys []timelineKey
	if err := db.Raw(
		"SELECT kind, id, created_at FROM ("+strings.Join(placeholders, " UNION ALL ")+") AS t "+
			"ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?", args...,
	).Scan(&keys).Error; err != nil {
		return out, err
	}

	var consoleIDs, outsideIDs []uint
	for _, k := range keys {
		if k.Kind == "console" {
			consoleIDs = append(consoleIDs, k.ID)
		} else {
			outsideIDs = append(outsideIDs, k.ID)
		}
	}

	consoleItems, err := loadConsoleItems(db, consoleIDs)
	if err != nil {
		return out, err
	}
	outsideItems, err := loadOutsideItems(db, outsideIDs)
	if err != nil {
		return out, err
	}

	names := deviceNamesFor(db, consoleItems, outsideItems)
	for _, k := range keys {
		var it TimelineItem
		var ok bool
		if k.Kind == "console" {
			it, ok = consoleItems[k.ID]
		} else {
			it, ok = outsideItems[k.ID]
		}
		if !ok {
			continue // deleted between the two reads — the next load will not list it either
		}
		it.DeviceName = names[it.DeviceID]
		out.Items = append(out.Items, it)
	}
	return out, nil
}

// timelineCounts answers every chip in two grouped reads.
func timelineCounts(db *gorm.DB, narrow func(*gorm.DB) *gorm.DB) (TimelineCounts, error) {
	var c TimelineCounts
	var ledger struct{ Total, Failed int64 }
	if err := narrow(db.Model(&entity.ChangeRecord{})).
		Select("COUNT(*) AS total, COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS failed",
			entity.ChangeStatusFailed).
		Scan(&ledger).Error; err != nil {
		return c, err
	}
	var outside int64
	if err := narrow(db.Model(&entity.DriftFinding{})).
		Where("attributed = ?", false).
		Count(&outside).Error; err != nil {
		return c, err
	}
	c.Console, c.Failed = ledger.Total, ledger.Failed
	c.Outside = outside
	c.All = c.Console + c.Outside
	return c, nil
}

// ledgerLeanColumns is every change_records column except the before/after bodies, plus whether
// each exists. The timeline never ships snapshots; a row's bodies come from GET /change-ledger/:id
// when it is opened.
const ledgerLeanColumns = `id, created_at, updated_at, network_device_id, app_user_id, user_email,
	action, resource_type, cmdb_path, resource_key, method, path, status, error_text,
	reverted_at, reverted_by, revert_of_id,
	COALESCE("before", '') <> '' AS has_before,
	COALESCE("after", '') <> '' AS has_after`

type ledgerLeanRow struct {
	entity.ChangeRecord
	HasBefore bool
	HasAfter  bool
}

func loadConsoleItems(db *gorm.DB, ids []uint) (map[uint]TimelineItem, error) {
	out := make(map[uint]TimelineItem, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	var rows []ledgerLeanRow
	if err := db.Model(&entity.ChangeRecord{}).Select(ledgerLeanColumns).
		Where("id IN ?", ids).Scan(&rows).Error; err != nil {
		return out, err
	}
	for _, r := range rows {
		out[r.ID] = consoleItem(r.ChangeRecord, r.HasBefore, r.HasAfter)
	}
	return out, nil
}

// consoleItem shapes one ledger row. Pure.
func consoleItem(r entity.ChangeRecord, hasBefore, hasAfter bool) TimelineItem {
	it := TimelineItem{
		Kind: "console", ID: r.ID, At: r.CreatedAt, DeviceID: r.NetworkDeviceID,
		Action: r.Action, Table: tableLabel(r.CMDBPath), Key: r.ResourceKey,
		Via: r.ResourceType, User: r.UserEmail, Status: r.Status, ErrorText: r.ErrorText,
		RevertedAt: r.RevertedAt, RevertedBy: r.RevertedBy, RevertOfID: r.RevertOfID,
		HasBefore: hasBefore, HasAfter: hasAfter,
	}
	if ok, why := LedgerRevertability(r, hasBefore); ok {
		it.Fallback = FallbackUndo
	} else {
		it.Fallback, it.UndoNote = FallbackNone, why
	}
	return it
}

func loadOutsideItems(db *gorm.DB, ids []uint) (map[uint]TimelineItem, error) {
	out := make(map[uint]TimelineItem, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	// Omit the diff body: a certificate finding carries kilobytes of it, and the list shows none.
	var findings []entity.DriftFinding
	if err := db.Omit("detail").Where("id IN ?", ids).Find(&findings).Error; err != nil {
		return out, err
	}

	runIDs := make([]uint, 0, len(findings))
	for _, f := range findings {
		runIDs = append(runIDs, f.DriftRunID)
	}
	var runs []entity.DriftRun
	if err := db.Where("id IN ?", uniqueUints(runIDs)).Find(&runs).Error; err != nil {
		return out, err
	}
	runByID := make(map[uint]entity.DriftRun, len(runs))
	backupIDs := make([]uint, 0, 2*len(runs))
	for _, r := range runs {
		runByID[r.ID] = r
		backupIDs = append(backupIDs, r.FromBackupID, r.ToBackupID)
	}
	var backups []entity.ConfigBackup
	if err := db.Select("id, created_at").Where("id IN ?", uniqueUints(backupIDs)).Find(&backups).Error; err != nil {
		return out, err
	}
	takenAt := make(map[uint]time.Time, len(backups))
	for _, b := range backups {
		takenAt[b.ID] = b.CreatedAt
	}

	for _, f := range findings {
		out[f.ID] = outsideItem(f, runByID[f.DriftRunID], takenAt)
	}
	return out, nil
}

// outsideItem shapes one unattributed finding. Pure.
func outsideItem(f entity.DriftFinding, run entity.DriftRun, takenAt map[uint]time.Time) TimelineItem {
	it := TimelineItem{
		Kind: "outside", ID: f.ID, At: f.CreatedAt, DeviceID: f.NetworkDeviceID,
		Action: driftActionToLedger(f.Action), Table: f.Table, Key: f.ResourceKey,
		RunID: f.DriftRunID, UndoChangeID: f.UndoChangeID,
	}
	if t, ok := takenAt[run.FromBackupID]; ok && run.FromBackupID > 0 {
		it.WindowFrom = &t
	}
	if t, ok := takenAt[run.ToBackupID]; ok {
		it.WindowTo = &t
	}

	switch plan := OutsideUndoPlan(f); {
	case plan.Path != "":
		it.Fallback = FallbackUndo
		it.UndoNote = "deletes this object from the firewall; refused if something still uses it"
	case f.UndoChangeID != nil:
		it.Fallback, it.UndoNote = FallbackNone, plan.Reason
	case run.FromBackupID > 0:
		it.Fallback = FallbackRestore
		it.RestoreBackupID = run.FromBackupID
		it.UndoNote = plan.Reason
	default:
		it.Fallback, it.UndoNote = FallbackNone, plan.Reason
	}
	return it
}

// OutsideUndo is the answer to "can this outside change be undone object by object".
type OutsideUndo struct {
	// Path is the REST collection the object lives in ("/api/v2/cmdb/firewall/address"), set only
	// when a per-object undo is safe. The DELETE goes to Path + "/" + key — never to Path alone.
	Path string
	// Reason says why not, when Path is empty.
	Reason string
}

// OutsideUndoPlan decides whether an unattributed drift finding can be undone on its own.
//
// Only one case qualifies: an object that was CREATED outside the console, in a top-level table,
// with a key. Its inverse is exact — delete that object by that key — and needs nothing the backup
// cannot vouch for. Everything else gets a reason instead of a button.
func OutsideUndoPlan(f entity.DriftFinding) OutsideUndo {
	switch {
	case f.Attributed:
		return OutsideUndo{Reason: "made through this console — undo it from its Change Ledger entry"}
	case f.UndoChangeID != nil:
		return OutsideUndo{Reason: "already undone from this console"}
	case f.Action == DriftActionModified:
		return OutsideUndo{Reason: "an edit made outside the console cannot be undone object by object — " +
			"restore the backup taken before it"}
	case f.Action == DriftActionDeleted:
		return OutsideUndo{Reason: "an object deleted outside the console cannot be recreated object by object — " +
			"restore the backup taken before it"}
	case f.Action != DriftActionCreated:
		return OutsideUndo{Reason: "unknown kind of change"}
	case strings.TrimSpace(f.ResourceKey) == "":
		return OutsideUndo{Reason: "the object has no key, and a delete without one would clear the whole table"}
	}

	path, ok := cLITableRESTPath(f.Table)
	if !ok {
		return OutsideUndo{Reason: "the FortiOS table could not be worked out from the backup"}
	}
	// A nested table ("system sdwan health-check") is a child list inside another object, and its
	// key is the child's. Deleting it by that key against the outer table would aim at the wrong
	// thing entirely, so nested changes are restore-only.
	if canonicalCMDBPath(f.Table) != f.CMDBPath {
		return OutsideUndo{Reason: "this is part of a larger object (" + f.Table + ") — " +
			"restore the backup taken before it"}
	}
	return OutsideUndo{Path: "/api/v2/cmdb/" + path}
}

// cLITableRESTPath turns a top-level CLI table into its REST path: every word but the last joins
// with ".", then "/" and the last word.
//
//	firewall address              → firewall/address
//	vpn ipsec phase1-interface    → vpn.ipsec/phase1-interface
//	firewall schedule recurring   → firewall.schedule/recurring
//
// Verified against the lab FGT80E's own REST tree (firewall.ssh/local-key, vpn.certificate/local,
// system.autoupdate/tunneling, firewall.service/custom all answer 200 there). A single word is not a
// table and is refused.
func cLITableRESTPath(table string) (string, bool) {
	words := strings.Fields(strings.ToLower(table))
	if len(words) < 2 {
		return "", false
	}
	for _, w := range words {
		for _, r := range w {
			if !(r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '-' || r == '_') {
				return "", false // never let an odd token reach a URL
			}
		}
	}
	return strings.Join(words[:len(words)-1], ".") + "/" + words[len(words)-1], true
}

// driftActionToLedger speaks the ledger's verbs for both sources, so the list reads one way.
func driftActionToLedger(a string) string {
	switch a {
	case DriftActionCreated:
		return entity.ChangeActionCreate
	case DriftActionDeleted:
		return entity.ChangeActionDelete
	default:
		return entity.ChangeActionUpdate
	}
}

// tableLabel renders a ledger CMDB path the way the CLI and the drift findings name a table.
func tableLabel(cmdbPath string) string {
	return strings.ReplaceAll(canonicalCMDBPath(cmdbPath), "/", " ")
}

func deviceNamesFor(db *gorm.DB, a, b map[uint]TimelineItem) map[uint]string {
	ids := make([]uint, 0, 4)
	for _, m := range []map[uint]TimelineItem{a, b} {
		for _, it := range m {
			ids = append(ids, it.DeviceID)
		}
	}
	out := map[uint]string{}
	ids = uniqueUints(ids)
	if len(ids) == 0 {
		return out
	}
	var devices []entity.NetworkDevice
	db.Select("id, name").Where("id IN ?", ids).Find(&devices)
	for _, d := range devices {
		out[d.ID] = d.Name
	}
	return out
}

func uniqueUints(in []uint) []uint {
	seen := make(map[uint]bool, len(in))
	out := make([]uint, 0, len(in))
	for _, v := range in {
		if v != 0 && !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out
}

// ── Revert rules, shared with the Change Ledger ──────────────────────────────

// LedgerRevertability decides whether a console change can be undone, and says why not.
//
// Every "no" is a case where undoing would either do nothing or do something wrong, so each one
// carries a message rather than a greyed-out control. hasBefore stands in for `r.Before != ""`:
// callers that read the row without its snapshot bodies pass the presence flag instead.
func LedgerRevertability(r entity.ChangeRecord, hasBefore bool) (bool, string) {
	switch {
	case r.Status == entity.ChangeStatusReverted:
		return false, "already reverted"
	case r.Status == entity.ChangeStatusFailed:
		return false, "the change never applied, so there is nothing to undo"
	case r.RevertOfID != nil:
		return false, "this entry is itself a revert — undo it from the original change"
	case r.CMDBPath == "":
		return false, "no FortiOS table was recorded for this change"
	case r.ResourceType == services.LedgerTypeFixPlaceNew:
		return false, "this placed a policy the same fix created — undo that fix to remove both"
	}

	// A move is undone by moving the policy back, not by replaying a body (changeledger_move.go).
	// A move row written the new way has no Before; one that has a Before was recorded before the
	// console kept positions, and replaying its body would report an undo that moves nothing.
	if services.IsPolicyMoveRecord(r) {
		switch {
		case hasBefore:
			return false, "this move was recorded before the console kept the policy's previous position — move it back on the Firewall Policy page"
		case r.ResourceKey == "":
			return false, "no object key was recorded"
		}
		return true, ""
	}

	switch r.Action {
	case entity.ChangeActionCreate:
		if r.ResourceKey == "" {
			// Deleting without a key would clear the whole table. Never offer that.
			return false, "the created object's key was not captured"
		}
	case entity.ChangeActionUpdate:
		if !hasBefore {
			return false, "no snapshot of the previous state was captured"
		}
		if r.ResourceKey == "" {
			return false, "no object key was recorded"
		}
	case entity.ChangeActionDelete:
		if !hasBefore {
			return false, "no snapshot of the deleted object was captured"
		}
	default:
		return false, "unsupported change type"
	}
	return true, ""
}
