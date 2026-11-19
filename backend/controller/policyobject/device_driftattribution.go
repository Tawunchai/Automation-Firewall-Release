package policyobject

import (
	"net/http"
	"network_automation/services/drift"
	"strconv"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
)

// "Who made this change?" for the rows Configuration Drift cannot account for.
//
// Read-only, and deliberately SEPARATE from GET /drift/timeline. That endpoint reads this
// platform's own database and keeps working while the firewall is unreachable — which is most of
// its value, because a configuration changed behind your back is exactly the situation in which a
// device stops answering. Folding a live device read into it would trade that away for a column.
//
// So the page loads its history first and asks this afterwards. A failure here costs the names and
// nothing else: the history is already on screen.
//
// Open to any signed-in user who can see the device, like the rest of the drift page. It exposes
// the firewall's own administrator names and the addresses they connected from — which is what the
// FortiGate's event log shows anybody who can log into it — and it changes nothing.

// maxAttributionFindings bounds one join. The page asks about what it is showing, which is at most
// a page of rows; this is the ceiling for a caller that asks about a device with a long history.
const maxAttributionFindings = 500

// attributionResponse is what the page renders.
type attributionResponse struct {
	// Data is keyed by finding id, as a string, because that is what JSON object keys are.
	Data map[string]drift.DriftAttribution `json:"data"`

	// LogFrom and LogTo are the span the device's log actually covered on this read. The page
	// prints them so "we don't know" can be read as "the firewall no longer remembers" rather than
	// "nobody did it". Zero when the log held nothing.
	LogFrom *string `json:"log_from,omitempty"`
	LogTo   *string `json:"log_to,omitempty"`

	// Total is the device's own count of matching log rows, which may exceed what one read returns.
	Total int `json:"total"`
}

// GET /policy/device/:deviceId/drift-attribution
func DeviceGetDriftAttribution(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	findings, err := attributableFindings(di.Device.ID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not read the drift findings"})
		return
	}
	if len(findings) == 0 {
		c.JSON(http.StatusOK, attributionResponse{Data: map[string]drift.DriftAttribution{}})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	page, err := fc.ListConfigChangeEvents()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	out := attributionResponse{
		Data:  map[string]drift.DriftAttribution{},
		Total: page.Total,
	}
	for id, att := range drift.AttributeFindings(findings, page) {
		out.Data[strconv.FormatUint(uint64(id), 10)] = att
	}
	if !page.From.IsZero() {
		s := page.From.Format(timeLayoutRFC3339)
		out.LogFrom = &s
	}
	if !page.To.IsZero() {
		s := page.To.Format(timeLayoutRFC3339)
		out.LogTo = &s
	}
	c.JSON(http.StatusOK, out)
}

// timeLayoutRFC3339 is what the frontend's Date parser expects everywhere else on this page.
const timeLayoutRFC3339 = "2006-01-02T15:04:05Z07:00"

// attributableFindings loads the device's unaccounted-for findings with the window each sits in.
//
// Only unattributed ones: a finding the Change Ledger already explains has a name on it already,
// and asking the firewall who made a change we recorded ourselves would produce a second, worse
// answer to a question that is settled ("GUI", because REST logs as GUI — see fortigate_configevent).
//
// The window comes from the two backups its run compared, in two grouped reads rather than one per
// finding — the same shape as services.loadOutsideItems, which builds the list this annotates.
func attributableFindings(deviceID uint) ([]drift.AttributableFinding, error) {
	db := config.DB()

	var findings []entity.DriftFinding
	if err := db.Omit("detail").
		Where("network_device_id = ? AND attributed = ?", deviceID, false).
		Order("id DESC").Limit(maxAttributionFindings).
		Find(&findings).Error; err != nil {
		return nil, err
	}
	if len(findings) == 0 {
		return nil, nil
	}

	runIDs := make([]uint, 0, len(findings))
	for _, f := range findings {
		runIDs = append(runIDs, f.DriftRunID)
	}
	var runs []entity.DriftRun
	if err := db.Select("id, from_backup_id, to_backup_id").
		Where("id IN ?", runIDs).Find(&runs).Error; err != nil {
		return nil, err
	}
	runByID := make(map[uint]entity.DriftRun, len(runs))
	backupIDs := make([]uint, 0, 2*len(runs))
	for _, r := range runs {
		runByID[r.ID] = r
		backupIDs = append(backupIDs, r.FromBackupID, r.ToBackupID)
	}

	var backups []entity.ConfigBackup
	if err := db.Select("id, created_at").Where("id IN ?", backupIDs).Find(&backups).Error; err != nil {
		return nil, err
	}
	at := make(map[uint]entity.ConfigBackup, len(backups))
	for _, b := range backups {
		at[b.ID] = b
	}

	out := make([]drift.AttributableFinding, 0, len(findings))
	for _, f := range findings {
		item := drift.AttributableFinding{
			ID: f.ID, Table: f.Table, Key: f.ResourceKey, Action: f.Action,
		}
		run := runByID[f.DriftRunID]
		if b, ok := at[run.FromBackupID]; ok && run.FromBackupID > 0 {
			item.From = b.CreatedAt
		}
		if b, ok := at[run.ToBackupID]; ok {
			item.To = b.CreatedAt
		}
		out = append(out, item)
	}
	return out, nil
}
