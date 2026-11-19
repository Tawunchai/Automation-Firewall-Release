package drift

import (
	"fmt"
	"network_automation/services"
	"regexp"
	"sort"
	"strings"
	"time"

	"network_automation/entity"
)

// Configuration drift: what changed on a firewall that this console did not do.
//
// ── The idea ─────────────────────────────────────────────────────────────────
//
// The platform already knows both halves of the answer and has never subtracted them:
//
//	backup(now) − backup(previous)          = everything that changed on the device
//	                − the Change Ledger     = everything WE changed, with who and when
//	                = DRIFT                   somebody edited this firewall outside the console
//
// The ledger (entity.ChangeRecord) records every write the device-proxy layer makes, with the
// CMDB path and mkey it touched. The backups record the device's own state. Joining them turns
// "the config changed" — which is not actionable, because config always changes — into "these
// three objects changed and nobody here did it", which is.
//
// ── Why the join is at OBJECT level, not line level ─────────────────────────
//
// A ledger row says "user X updated firewall/address / web-servers at 14:02". It does not say
// which of the eleven lines inside that object moved. So the diff is grouped by the object each
// changed line belongs to (see AddressChangedLines) and matched per object. That is also the
// granularity a person reads: nobody wants a list of lines, they want a list of things.
//
// ── What this deliberately does NOT claim ───────────────────────────────────
//
// An unattributed change is not proof of wrongdoing. It means the console cannot account for it,
// which covers: a legitimate CLI change by an admin who prefers the CLI, a FortiManager push, an
// automatic FortiGuard update writing to the config, and a genuine unauthorised edit. The report
// says "not made through this console" and never "unauthorised" — the operator decides which.

// ── Noise: lines that differ between two exports of an UNCHANGED config ─────
//
// ⚠️ This is the finding that decided whether the feature was usable at all.
//
// The first live run against the lab FGT80E reported 29 drift findings for two real changes. The
// other 27 were all the same shape:
//
//	- set password ENC ToNI5aRPHBfyuFxsnUQ9cbne3o3aCf9zdK7CBQJqN84JZlnMyTjmeXBLP…
//	+ set password ENC 7RtX381hTdLy/+G/OzVb4cFbu2ZtjDNl05oe2/8rtV9ZZOM5Uz+Ms4d+Rb…
//
// on `vpn certificate local`, `system ha`, `system fortiguard`, `user local`, `firewall ssh
// local-key` and so on. **FortiOS re-encrypts every stored secret on every export.** The plaintext
// behind those two blobs is identical; the ciphertext is not, because the wrapping is salted.
// Nothing changed on the firewall — twenty-seven alerts, every single night, for ever.
//
// An alerting feature that cries wolf nightly is worse than no feature: people mute it, and then
// the one real finding goes unread too. So these are excluded.
//
// The cost is a real blind spot: a password that genuinely CHANGED looks exactly the same as one
// that was merely re-wrapped, because the comparison only ever sees ciphertext. That is not
// hidden — the run counts them and says so (DriftReport.SecretsChanged), so the page can state
// plainly that N secret-bearing lines differ and cannot be compared, rather than quietly
// pretending the configuration matched.

// driftNoisePrefixes are lines a FortiGate rewrites on its own with no operator involved.
var driftNoisePrefixes = []string{
	"set last-modified", // ips / application entries stamp this themselves
	"set conf_file_ver",
}

// encSecretRe matches `set <field> ENC <blob>` — FortiOS's marker for a stored secret. The blob is
// re-salted on every export, so two exports of the same configuration never agree on it.
var encSecretRe = regexp.MustCompile(`^\s*set\s+\S+\s+ENC\s+\S`)

// configKeywordRe matches the start of a real configuration statement. Anything inside a config
// file that does NOT start with one of these is a continuation line of a multi-line value — in
// practice the base64 body of a certificate or private key, which is re-wrapped exactly like the
// ENC blobs above.
var configKeywordRe = regexp.MustCompile(`^\s*(config|edit|set|unset|next|end|append|select|unselect|purge|delete|rename|move|clone|#)\b`)

// isEncryptedSecretLine reports a line whose content is ciphertext this platform cannot compare.
func isEncryptedSecretLine(line string) bool {
	if encSecretRe.MatchString(line) {
		return true
	}
	t := strings.TrimSpace(line)
	if t == "" || configKeywordRe.MatchString(line) {
		return false
	}
	// A continuation line: no keyword, and made only of base64 characters.
	//
	// The length floor keeps a stray short fragment of something else from being swallowed — but
	// the LAST line of a blob is short by definition, and `= ` padding only ever appears at the end
	// of a base64 stream, so a padded line is a blob tail at any length. Missing that left exactly
	// one false positive on the live run: `40H/kAtMGhQ=`, twelve characters, the tail of a
	// certificate under vpn certificate local / Fortinet_SSL_RSA1024.
	if len(t) < 24 && !strings.HasSuffix(strings.TrimSuffix(t, `"`), "=") {
		return false
	}
	for _, r := range t {
		if !(r >= 'A' && r <= 'Z') && !(r >= 'a' && r <= 'z') && !(r >= '0' && r <= '9') &&
			r != '+' && r != '/' && r != '=' && r != '"' {
			return false
		}
	}
	return true
}

func isDriftNoise(line string) bool {
	t := strings.TrimSpace(line)
	for _, p := range driftNoisePrefixes {
		if strings.HasPrefix(t, p) {
			return true
		}
	}
	return false
}

// ── Report ───────────────────────────────────────────────────────────────────

// Drift change actions.
const (
	DriftActionCreated  = "created"
	DriftActionDeleted  = "deleted"
	DriftActionModified = "modified"
)

// DriftChange is one object that differs between two backups.
type DriftChange struct {
	// Table is the CLI path ("firewall address"); CMDBPath is the canonical REST spelling
	// ("firewall/address") used to join against the ledger.
	Table    string `json:"table"`
	CMDBPath string `json:"cmdb_path"`
	Key      string `json:"key"`
	Action   string `json:"action"`

	Added   []string `json:"added"`
	Removed []string `json:"removed"`

	// Attributed is true when a ledger row accounts for this object in the window between the two
	// backups. AttributedTo names the person, so a reviewer can see at a glance which half of the
	// list is "us".
	Attributed   bool   `json:"attributed"`
	AttributedTo string `json:"attributed_to,omitempty"`
}

// Detail renders the change as a small diff for storage and display.
func (c DriftChange) Detail() string {
	var sb strings.Builder
	for _, l := range c.Removed {
		sb.WriteString("- ")
		sb.WriteString(strings.TrimSpace(l))
		sb.WriteString("\n")
	}
	for _, l := range c.Added {
		sb.WriteString("+ ")
		sb.WriteString(strings.TrimSpace(l))
		sb.WriteString("\n")
	}
	return strings.TrimSuffix(sb.String(), "\n")
}

// DriftReport is the outcome of comparing two backups.
type DriftReport struct {
	LinesAdded   int           `json:"lines_added"`
	LinesRemoved int           `json:"lines_removed"`
	Changes      []DriftChange `json:"changes"`
	// Attributed and Drift partition Changes. Drift is the number the alert is about.
	Attributed int `json:"attributed"`
	Drift      int `json:"drift"`

	// SecretsChanged counts lines holding an encrypted value that differ between the two exports.
	// They are NOT findings — see the note on isEncryptedSecretLine — but they are reported,
	// because "we cannot tell whether these changed" is a different statement from "these did not
	// change", and only one of them is true.
	SecretsChanged int `json:"secrets_changed"`
}

// HasDrift reports whether anything went unaccounted for.
func (r DriftReport) HasDrift() bool { return r.Drift > 0 }

// Summary is the one-line version for a notification or a list row.
func (r DriftReport) Summary() string {
	secrets := ""
	if r.SecretsChanged > 0 {
		secrets = fmt.Sprintf(" · %d encrypted value(s) differ and cannot be compared", r.SecretsChanged)
	}
	switch {
	case r.Drift == 0 && r.Attributed == 0:
		return "no configuration change" + secrets
	case r.Drift == 0:
		return fmt.Sprintf("%d change(s), all accounted for by this console", r.Attributed) + secrets
	case r.Attributed == 0:
		return fmt.Sprintf("%d change(s) NOT made through this console", r.Drift) + secrets
	default:
		return fmt.Sprintf("%d change(s) not made through this console (%d others accounted for)",
			r.Drift, r.Attributed) + secrets
	}
}

// ── Path normalisation ───────────────────────────────────────────────────────

// canonicalCMDBPath reduces the two notations for the same table to one comparable form.
//
// The diff speaks CLI, where a table is written with spaces:      config firewall address
// The ledger speaks REST, where it is a path with a dotted head:  /api/v2/cmdb/firewall/address
//
//	/api/v2/cmdb/firewall.schedule/recurring
//
// Splitting on the union of separators makes them the same token list, which is the only reason
// the join in AnalyseConfigDrift works at all.
func canonicalCMDBPath(s string) string {
	s = strings.TrimSpace(strings.ToLower(s))
	s = strings.TrimPrefix(s, "/api/v2/cmdb/")
	s = strings.Trim(s, "/")
	fields := strings.FieldsFunc(s, func(r rune) bool {
		return r == '/' || r == '.' || r == ' ' || r == '\t'
	})
	return strings.Join(fields, "/")
}

// ── Analysis ─────────────────────────────────────────────────────────────────

// AnalyseConfigDrift compares two configuration files and subtracts the changes this console
// made, leaving the ones it cannot account for.
//
// records should be the ledger rows for this device between the two backups. Passing none is
// valid and means "attribute nothing" — every change is then reported as drift, which is the
// correct answer when the ledger has no coverage of that window.
func AnalyseConfigDrift(before, after string, records []entity.ChangeRecord) DriftReport {
	ops := services.DiffConfigs(before, after)
	added, removed := services.CountConfigChanges(ops)
	report := DriftReport{LinesAdded: added, LinesRemoved: removed, Changes: []DriftChange{}}

	// Group the changed lines by the object they belong to.
	type bucket struct {
		table, cmdbPath, key string
		added, removed       []string
		sawEditAdded         bool
		sawEditRemoved       bool
	}
	order := []string{}
	groups := map[string]*bucket{}

	for _, l := range services.AddressChangedLines(ops) {
		if isDriftNoise(l.Line) {
			continue
		}
		if isEncryptedSecretLine(l.Line) {
			// Counted, not reported. Both halves of a re-encrypted pair land here, so the count is
			// halved to read as "lines", not "diff rows".
			report.SecretsChanged++
			continue
		}
		addr := l.Address
		if addr.IsZero() {
			// A line outside any config block — only the file header, which is already filtered.
			continue
		}
		id := addr.CMDBPath + "\x00" + addr.Key
		g, ok := groups[id]
		if !ok {
			g = &bucket{table: addr.Table, cmdbPath: canonicalCMDBPath(addr.CMDBPath), key: addr.Key}
			groups[id] = g
			order = append(order, id)
		}
		isEdit := services.IsCMDBEditLine(l.Line)
		if l.Kind == "+" {
			g.added = append(g.added, l.Line)
			g.sawEditAdded = g.sawEditAdded || isEdit
		} else {
			g.removed = append(g.removed, l.Line)
			g.sawEditRemoved = g.sawEditRemoved || isEdit
		}
	}

	// An object whose `edit` line is only on one side was created or deleted outright; anything
	// else is an edit to an object that existed before and after.
	for _, id := range order {
		g := groups[id]
		action := DriftActionModified
		switch {
		case g.sawEditAdded && !g.sawEditRemoved:
			action = DriftActionCreated
		case g.sawEditRemoved && !g.sawEditAdded:
			action = DriftActionDeleted
		}
		report.Changes = append(report.Changes, DriftChange{
			Table: g.table, CMDBPath: g.cmdbPath, Key: g.key, Action: action,
			Added: g.added, Removed: g.removed,
		})
	}

	report.SecretsChanged = (report.SecretsChanged + 1) / 2

	attributeChanges(report.Changes, records)

	for i := range report.Changes {
		if report.Changes[i].Attributed {
			report.Attributed++
		} else {
			report.Drift++
		}
	}

	// Drift first, then by table — the list is read top-down and the unaccounted-for rows are the
	// reason anybody opened it.
	sort.SliceStable(report.Changes, func(i, j int) bool {
		a, b := report.Changes[i], report.Changes[j]
		if a.Attributed != b.Attributed {
			return !a.Attributed
		}
		if a.Table != b.Table {
			return a.Table < b.Table
		}
		return a.Key < b.Key
	})

	return report
}

// attributeChanges marks the objects a ledger row accounts for.
//
// Matching is (table, mkey) and, failing that, (table) alone: some writes land on a table without
// naming a row — an ordering change, a bulk operation — and the ledger records the table with an
// empty key. Falling back to a table match keeps those from being reported as drift, at the cost
// of possibly excusing a second change to the same table in the same window. That trade is
// deliberate: a false "drift" alarm is the thing that gets an alerting feature switched off.
func attributeChanges(changes []DriftChange, records []entity.ChangeRecord) {
	if len(records) == 0 || len(changes) == 0 {
		return
	}

	byKey := map[string][]entity.ChangeRecord{}
	byTable := map[string][]entity.ChangeRecord{}
	for _, r := range records {
		// Only APPLIED writes account for anything. A failed write did not change the device, so
		// letting it absorb a real drift finding would hide exactly the case that matters.
		if r.Status != "" && r.Status != entity.ChangeStatusApplied {
			continue
		}
		path := canonicalCMDBPath(r.CMDBPath)
		if path == "" {
			continue
		}
		byTable[path] = append(byTable[path], r)
		if k := strings.TrimSpace(r.ResourceKey); k != "" {
			byKey[path+"\x00"+strings.ToLower(k)] = append(byKey[path+"\x00"+strings.ToLower(k)], r)
		}
	}

	for i := range changes {
		c := &changes[i]
		if rs := byKey[c.CMDBPath+"\x00"+strings.ToLower(c.Key)]; len(rs) > 0 {
			c.Attributed = true
			c.AttributedTo = describeChangeRecords(rs)
			continue
		}
		// Table-level fallback, but only for rows the ledger left keyless — a keyed row that
		// named a DIFFERENT object must not excuse this one.
		var keyless []entity.ChangeRecord
		for _, r := range byTable[c.CMDBPath] {
			if strings.TrimSpace(r.ResourceKey) == "" {
				keyless = append(keyless, r)
			}
		}
		if len(keyless) > 0 {
			c.Attributed = true
			c.AttributedTo = describeChangeRecords(keyless)
		}
	}
}

// describeChangeRecords names who is responsible, most recent first.
func describeChangeRecords(rs []entity.ChangeRecord) string {
	sort.Slice(rs, func(i, j int) bool { return rs[i].CreatedAt.After(rs[j].CreatedAt) })
	seen := map[string]bool{}
	parts := make([]string, 0, 2)
	for _, r := range rs {
		who := strings.TrimSpace(r.UserEmail)
		if who == "" {
			who = "an internal job"
		}
		label := fmt.Sprintf("%s (%s %s)", who, r.Action, r.CreatedAt.Format("15:04 02 Jan"))
		if seen[label] {
			continue
		}
		seen[label] = true
		parts = append(parts, label)
		if len(parts) == 2 {
			break
		}
	}
	if len(rs) > len(parts) {
		parts = append(parts, fmt.Sprintf("+%d more", len(rs)-len(parts)))
	}
	return strings.Join(parts, ", ")
}

// ── Ledger window ────────────────────────────────────────────────────────────

// DriftLedgerWindow widens the interval between two backups before the ledger is queried.
//
// A change made a second before a backup started may not be in that backup, and the backup's
// timestamp is when the WORKER reported it, not when the SSH session read the config. Both
// directions of that slack would otherwise turn one of our own changes into a drift finding, so
// the window is padded generously — the cost of over-attributing by a few minutes is far lower
// than the cost of a false alarm.
const DriftLedgerWindow = 15 * time.Minute

// LedgerWindowFor returns the time range to pull ChangeRecords for.
func LedgerWindowFor(prevTaken, currTaken time.Time) (from, to time.Time) {
	return prevTaken.Add(-DriftLedgerWindow), currTaken.Add(DriftLedgerWindow)
}
