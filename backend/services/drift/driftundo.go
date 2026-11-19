package drift

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// ErrOutsideObjectInUse is returned when FortiOS refuses the delete because something still points
// at the object (a policy using an address, a group holding a user).
var ErrOutsideObjectInUse = errors.New("the firewall refused: something still uses this object")

// OutsideUndoResult is what UndoOutsideCreate did.
type OutsideUndoResult struct {
	// Change is the ledger row written for the delete. Nil when nothing was written — the object
	// was already gone, so there was no write to record.
	Change *entity.ChangeRecord
	// AlreadyGone is true when the object had been removed before the undo ran.
	AlreadyGone bool
}

// UndoOutsideCreate deletes an object that was created outside the console and records it.
//
// Three reads of the same answer, on purpose:
//  1. OutsideUndoPlan must name a collection — refused otherwise, before anything touches the device.
//  2. The object is READ by key first. That proves the path points at a real object of that name
//     (a wrong path would 404 here rather than delete something), and captures the snapshot that
//     makes the undo reversible.
//  3. The DELETE goes through BuildRevertRequest, which refuses a keyless path — the guard that
//     keeps a DELETE off a collection URL — so this path cannot become the table-wiping kind.
func UndoOutsideCreate(db *gorm.DB, fc *services.FortiClient, f entity.DriftFinding, actor entity.ChangeRecord) (OutsideUndoResult, error) {
	var res OutsideUndoResult
	plan := OutsideUndoPlan(f)
	if plan.Path == "" {
		return res, fmt.Errorf("this change cannot be undone on its own: %s", plan.Reason)
	}

	snapshot, err := fc.GetCMDBObject(plan.Path, f.ResourceKey)
	if err != nil {
		if errors.Is(err, services.ErrOutsideObjectGone) || services.IsObjectGoneError(err) {
			res.AlreadyGone = true
			return res, markFindingUndone(db, f.ID, nil, actor.UserEmail,
				"Already gone from the firewall when Undo was pressed — nothing to delete")
		}
		return res, fmt.Errorf("could not read the object before deleting it: %w", err)
	}

	rec := actor
	rec.NetworkDeviceID = f.NetworkDeviceID
	rec.Action = entity.ChangeActionDelete
	rec.ResourceType = describeOutsideUndo(f.Table)
	rec.CMDBPath = plan.Path
	rec.ResourceKey = f.ResourceKey
	rec.Method = "DELETE"
	rec.Before = string(services.StripCMDBMeta(snapshot))
	rec.Status = entity.ChangeStatusApplied

	delErr := fc.ExecuteRevert(entity.ChangeActionCreate, plan.Path, f.ResourceKey, nil)
	if delErr != nil {
		if services.IsObjectGoneError(delErr) {
			res.AlreadyGone = true
			return res, markFindingUndone(db, f.ID, nil, actor.UserEmail,
				"Already gone from the firewall when Undo was pressed — nothing to delete")
		}
		rec.Status = entity.ChangeStatusFailed
		rec.ErrorText = platform.TruncateUTF8(delErr.Error(), 1000)
	}
	// Recorded whether it worked or not: a refused write to a firewall is still an event, and the
	// ledger is where people look for one.
	if err := db.Create(&rec).Error; err != nil {
		return res, fmt.Errorf("the object was handled on the firewall but the change could not be recorded: %w", err)
	}
	res.Change = &rec

	if delErr != nil {
		if isInUseError(delErr) {
			return res, ErrOutsideObjectInUse
		}
		return res, delErr
	}
	return res, markFindingUndone(db, f.ID, &rec.ID, actor.UserEmail, "Undone — deleted from the firewall")
}

// isInUseError matches FortiOS refusing a delete because the object is referenced. The device's
// wording is "The entry is used by other N entry" — "in use" never appears — so the code is checked
// first and the phrase second.
func isInUseError(err error) bool {
	if code, ok := services.DeviceErrorCode(err); ok && code == services.FGErrStillReferenced {
		return true
	}
	return strings.Contains(strings.ToLower(err.Error()), "used by")
}

// markFindingUndone closes a finding: who took it back and why, and (when a delete was written) the
// ledger row that did it.
//
// `acknowledged` is the column that says "this no longer stands". It is now written HERE and nowhere
// else — the hand sign-off that used to set it is gone — so it means "undone", not "somebody looked
// at it". Undoing a create that turns out to be already gone from the firewall also closes the
// finding: there is nothing left to take back.
func markFindingUndone(db *gorm.DB, findingID uint, changeID *uint, by, note string) error {
	now := time.Now()
	updates := map[string]any{
		"acknowledged":     true,
		"acknowledged_by":  by,
		"acknowledged_at":  &now,
		"acknowledge_note": note,
	}
	if changeID != nil {
		updates["undo_change_id"] = *changeID
	}
	return db.Model(&entity.DriftFinding{}).Where("id = ?", findingID).Updates(updates).Error
}

// describeOutsideUndo is the ledger's resource_type for an undo made from the timeline, so the
// ledger says where the write came from.
func describeOutsideUndo(table string) string {
	return fmt.Sprintf("drift-undo:%s", strings.ReplaceAll(strings.TrimSpace(table), " ", "-"))
}
