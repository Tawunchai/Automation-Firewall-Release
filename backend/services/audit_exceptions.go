package services

import (
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// ── Accepted findings ────────────────────────────────────────────────────────
//
// An exception marks a finding as a decision somebody made, not as a problem that went away. The
// distinction runs through every function here:
//
//   - the finding is still returned, still counted in Total, and still shown on the page;
//   - it is EXCLUDED from the severity counts and from the standards coverage, because a risk that
//     has been formally accepted is no longer an open gap;
//   - the control it maps to becomes "accepted" rather than silently "evidenced", so a reader can
//     see that the clean status was bought with a signature rather than with a fix.
//
// Anything that made accepted findings vanish would be easier to build and would quietly destroy
// the report's value.

// MaxExceptionDays caps how long an acceptance can run before somebody has to look again.
// Deliberately short of a year: an annual review that starts on the day of the audit is not a
// review, and PCI DSS asks for network-control configurations to be revisited every six months.
const MaxExceptionDays = 180

// ExceptionKey identifies the one finding an exception covers.
type ExceptionKey struct {
	Check   string
	Subject string
}

// ActiveExceptions returns the exceptions in force for a device right now, keyed by finding.
func ActiveExceptions(db *gorm.DB, deviceID uint, now time.Time) (map[ExceptionKey]entity.AuditException, error) {
	out := map[ExceptionKey]entity.AuditException{}
	if db == nil || deviceID == 0 {
		return out, nil
	}
	var rows []entity.AuditException
	if err := db.Where("network_device_id = ? AND revoked_at IS NULL AND expires_at > ?", deviceID, now).
		Find(&rows).Error; err != nil {
		return out, err
	}
	for _, r := range rows {
		// Later rows win, which matters when somebody re-accepts a finding before the previous
		// acceptance lapses: the newest expiry is the one in force.
		k := ExceptionKey{r.Check, r.Subject}
		if prev, ok := out[k]; ok && prev.ExpiresAt.After(r.ExpiresAt) {
			continue
		}
		out[k] = r
	}
	return out, nil
}

// ApplyExceptions marks accepted findings on a finished report and recomputes everything that
// should no longer count them.
//
// It runs AFTER the scan rather than filtering during it, so the audit engine stays a pure function
// of the device's configuration and knows nothing about who signed what.
func ApplyExceptions(rep *AuditReport, active map[ExceptionKey]entity.AuditException) {
	if rep == nil || len(active) == 0 {
		return
	}

	open := make([]AuditFinding, 0, len(rep.Findings))
	counts := map[string]int{}
	accepted := 0

	for i := range rep.Findings {
		f := &rep.Findings[i]
		exc, ok := active[ExceptionKey{f.Check, f.Subject}]
		if !ok {
			counts[string(f.Severity)]++
			open = append(open, *f)
			continue
		}
		f.Accepted = &AcceptedRisk{
			Reason:     exc.Reason,
			ApprovedBy: exc.ApprovedBy,
			ApprovedAt: exc.ApprovedAt,
			ExpiresAt:  exc.ExpiresAt,
		}
		accepted++
	}

	rep.Counts = counts
	rep.AcceptedCount = accepted

	// Coverage is rebuilt from the OPEN findings only — that is the whole point of an acceptance —
	// but the controls involved are then marked, so "evidenced" never silently means "waived".
	rep.Standards = BuildStandardsCoverage(open, rep.UndecidedChecks)
	markAcceptedControls(rep, open)
}

// markAcceptedControls flags any control whose only remaining clean status is due to an acceptance.
func markAcceptedControls(rep *AuditReport, open []AuditFinding) {
	acceptedChecks := map[string]bool{}
	for _, f := range rep.Findings {
		if f.Accepted != nil {
			acceptedChecks[f.Check] = true
		}
	}
	if len(acceptedChecks) == 0 {
		return
	}
	// A check that STILL has open findings is already a gap; the acceptance changed nothing there.
	for _, f := range open {
		delete(acceptedChecks, f.Check)
	}

	for i := range rep.Standards {
		for j := range rep.Standards[i].Controls {
			c := &rep.Standards[i].Controls[j]
			// Only a control the acceptance actually CLEANED is marked. Everything else keeps the
			// status the rebuild gave it:
			//   gap / observation — findings from another check are still open, so the acceptance
			//                       changed nothing about how this control reads;
			//   indeterminate     — a check could not run, which no signature can fix;
			//   not-assessed      — nothing assesses it, so there was no finding to accept and
			//                       calling it "risk accepted" would invent a decision nobody made.
			if c.Status != ControlEvidenced {
				continue
			}
			for _, chk := range c.Checks {
				if acceptedChecks[chk] {
					c.Status = ControlAccepted
					rep.Standards[i].Evidenced--
					rep.Standards[i].Accepted++
					break
				}
			}
		}
	}
}
