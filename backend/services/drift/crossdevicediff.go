package drift

import (
	"errors"
	"fmt"
	"network_automation/services/platform"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// Cross-device configuration diff — "are these two firewalls consistent?"
//
// Same-device drift (configdrift.go) answers "what changed on THIS firewall that the console did
// not do", by diffing two backups of ONE device and subtracting the Change Ledger. This answers a
// different question an organisation with more than one firewall actually asks: two branches are
// supposed to run the same baseline — do they?
//
// It deliberately reuses AnalyseConfigDrift rather than writing a second comparator. The structural
// per-object grouping and the re-encrypted-secret noise filter (see the long note at the top of
// configdrift.go — FortiOS re-salts every stored secret on every export) apply exactly as much to
// two DIFFERENT devices' exports as to the same device twice, and a second diff engine is a second
// place for that noise filter to need re-discovering.
//
// There is no Change Ledger to join against here — two different devices share no change history —
// so `records` is always nil and every object that differs is reported, full stop. The caller does
// not read report.Attributed/Drift in this mode; OnlyInA/OnlyInB/Differs below is the breakdown that
// means something for a comparison between two devices.
//
// The comparison reads each device's LATEST STORED BACKUP, not a live SSH pull. That makes it
// instant and keeps this feature from opening a third SSH session alongside Config Deploy and the
// diagnostics tools — the trade is that it is only as fresh as the last backup, which is why the
// result carries each side's backup timestamp for the page to show plainly.

// ErrNoBackupYet is returned when a device has never been backed up, so there is nothing to read.
var ErrNoBackupYet = errors.New("this device has no configuration backup yet — run one first")

// ErrDeviceNotFound is returned when one of the two device ids does not exist. Wrapped with the id
// it names, so the controller can still answer 404 — the id this talks about is not a secret from
// an admin, who already enumerated it via GET /devices to pick it in the first place.
var ErrDeviceNotFound = errors.New("device not found")

// CrossDeviceDiffSide identifies which backup one half of the comparison came from.
type CrossDeviceDiffSide struct {
	DeviceID   uint      `json:"device_id"`
	DeviceName string    `json:"device_name"`
	BackupID   uint      `json:"backup_id"`
	BackupAt   time.Time `json:"backup_at"`
}

// CrossDeviceDiffResult is the comparison the page renders.
type CrossDeviceDiffResult struct {
	A       CrossDeviceDiffSide `json:"a"`
	B       CrossDeviceDiffSide `json:"b"`
	Changes []DriftChange       `json:"changes"`

	// A per-object object existing on B but not A, A but not B, or on both but differing —
	// DriftChange's Action, counted, so the page's summary line does not have to loop the list.
	OnlyInA int `json:"only_in_a"`
	OnlyInB int `json:"only_in_b"`
	Differs int `json:"differs"`

	// SecretsChanged — see configdrift.go: every ENC-wrapped value differs between any two exports
	// whether or not the plaintext does, so these are counted and never shown as a finding.
	SecretsChanged int `json:"secrets_changed"`
}

func latestBackup(db *gorm.DB, deviceID uint) (entity.ConfigBackup, error) {
	var b entity.ConfigBackup
	if err := db.Where("network_device_id = ?", deviceID).Order("id DESC").First(&b).Error; err != nil {
		return entity.ConfigBackup{}, ErrNoBackupYet
	}
	return b, nil
}

// countByAction partitions a cross-device diff's changes into the three questions the page's
// summary line answers. Pure and separate from CompareDevices so it is tested without a database —
// see the note at the top of services/changerequest_test.go for why this codebase tests the rule
// rather than the round trip wherever the rule can be pulled out.
func countByAction(changes []DriftChange) (onlyInA, onlyInB, differs int) {
	for _, c := range changes {
		switch c.Action {
		case DriftActionCreated:
			onlyInB++
		case DriftActionDeleted:
			onlyInA++
		default:
			differs++
		}
	}
	return onlyInA, onlyInB, differs
}

// CompareDevices diffs the latest backups of two devices, object by object.
func CompareDevices(db *gorm.DB, deviceAID, deviceBID uint) (*CrossDeviceDiffResult, error) {
	if deviceAID == deviceBID {
		return nil, errors.New("pick two different devices to compare")
	}
	if db == nil {
		return nil, errors.New("no database")
	}

	var devA, devB entity.NetworkDevice
	if err := db.First(&devA, deviceAID).Error; err != nil {
		return nil, fmt.Errorf("device %d: %w", deviceAID, ErrDeviceNotFound)
	}
	if err := db.First(&devB, deviceBID).Error; err != nil {
		return nil, fmt.Errorf("device %d: %w", deviceBID, ErrDeviceNotFound)
	}

	backupA, err := latestBackup(db, deviceAID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", devA.Name, err)
	}
	backupB, err := latestBackup(db, deviceBID)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", devB.Name, err)
	}

	// Stored configurations are encrypted at rest (entity.ConfigBackup). A failure to decrypt is
	// returned, not swallowed: AnalyseConfigDrift against an empty side would report every object
	// on the other device as a difference, which reads as a real finding.
	contentA, err := platform.BackupContent(backupA)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", devA.Name, err)
	}
	contentB, err := platform.BackupContent(backupB)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", devB.Name, err)
	}

	report := AnalyseConfigDrift(contentA, contentB, nil)

	result := &CrossDeviceDiffResult{
		A:              CrossDeviceDiffSide{DeviceID: devA.ID, DeviceName: devA.Name, BackupID: backupA.ID, BackupAt: backupA.CreatedAt},
		B:              CrossDeviceDiffSide{DeviceID: devB.ID, DeviceName: devB.Name, BackupID: backupB.ID, BackupAt: backupB.CreatedAt},
		Changes:        report.Changes,
		SecretsChanged: report.SecretsChanged,
	}
	result.OnlyInA, result.OnlyInB, result.Differs = countByAction(report.Changes)
	return result, nil
}
