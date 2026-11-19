package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/url"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var fileFilterProfileTable = cmdbPath{path: "file-filter/profile", noun: "file filter profile"}

// File Filter profile (file-filter/profile) — form mapping, rule validation and the file-type
// catalogue behind the rule drawer.
//
// Split out of fortigate.go verbatim.

// ── File Filter Profile (create/update) ───────────────────────────────────────
//
// FileFilterProfileForm is our GUI-shaped view of a FortiGate file-filter/profile object,
// mirroring the FortiOS "New File Filter Profile" page: profile-level Name / Comments /
// Scan archive contents, plus a list of Rules. Each rule mirrors the "Create New File Filter
// Rule" drawer (Name, Comments, Protocols, Traffic direction, Password-protected only, File
// types, Action). CMDB path /api/v2/cmdb/file-filter/profile (mkey=name). Verified live
// against 10.0.99.201 (FGT80E v7.2.10).
type FileFilterRule struct {
	Name              string   `json:"name"`
	Comment           string   `json:"comment"`
	Protocols         []string `json:"protocols"`          // http ftp smtp imap pop3 mapi cifs ssh (multi-flag)
	Direction         string   `json:"direction"`          // incoming | outgoing | any
	PasswordProtected bool     `json:"password_protected"` // true → CMDB "yes", false → "any"
	FileTypes         []string `json:"file_types"`         // antivirus.filetype names (required, ≥1)
	Action            string   `json:"action"`             // GUI "monitor" (CMDB log-only) | "block"
}

type FileFilterProfileForm struct {
	Name                string           `json:"name"`
	Comment             string           `json:"comment"`
	ScanArchiveContents bool             `json:"scan_archive_contents"`
	Rules               []FileFilterRule `json:"rules"`
}

// defaultFileFilterProtocols is what FortiOS itself stores when a rule is sent with an empty
// protocol (verified live), so our fallback matches the device instead of guessing.
const defaultFileFilterProtocols = "http ftp smtp imap pop3 cifs"

// fileFilterDirectionProtocols are the only protocols the rule's Traffic direction applies to.
// Straight from the CMDB schema's help text: "Traffic direction (HTTP, FTP, SSH, CIFS only)."
var fileFilterDirectionProtocols = map[string]bool{
	"http": true, "ftp": true, "ssh": true, "cifs": true,
}

// fileFilterDirectionApplies reports whether a rule's Traffic setting means anything.
//
// ⚠️ Verified live on FortiOS 7.2.10: a rule whose protocols are only mail ones
// (smtp/imap/pop3/mapi) has its direction SILENTLY FORCED to "any" — the device answers 200
// "success" and stores "any" whatever we sent. One direction-capable protocol in the mix
// (e.g. "http smtp") is enough for the direction to stick.
func fileFilterDirectionApplies(protocols []string) bool {
	for _, p := range protocols {
		if fileFilterDirectionProtocols[strings.ToLower(strings.TrimSpace(p))] {
			return true
		}
	}
	return false
}

// normalizeFileFilterDirection maps the form's direction to what the device will actually
// store, so a saved rule reads back the way the user left it.
func normalizeFileFilterDirection(direction string, protocols []string) string {
	dir := strings.ToLower(strings.TrimSpace(direction))
	if dir != "incoming" && dir != "outgoing" {
		return "any"
	}
	// An empty protocol list becomes the device default (which includes http/ftp), so the
	// direction still applies.
	if len(protocols) > 0 && !fileFilterDirectionApplies(protocols) {
		return "any"
	}
	return dir
}

// fileFilterProfilePayload builds the nested file-filter/profile CMDB body from our form.
// feature-set is fixed to "flow" (the FortiOS default and what the GUI page uses). Rules
// without a name or with no file types are skipped — the device rejects the latter with
// "-61 file-type must be set".
func fileFilterProfilePayload(form FileFilterProfileForm) map[string]interface{} {
	rules := make([]map[string]interface{}, 0, len(form.Rules))
	for _, r := range form.Rules {
		if strings.TrimSpace(r.Name) == "" || len(r.FileTypes) == 0 {
			continue
		}
		fts := make([]map[string]interface{}, 0, len(r.FileTypes))
		for _, ft := range r.FileTypes {
			fts = append(fts, map[string]interface{}{"name": ft})
		}
		action := "log-only" // GUI "Monitor"
		if strings.EqualFold(r.Action, "block") {
			action = "block"
		}
		dir := normalizeFileFilterDirection(r.Direction, r.Protocols)
		pw := "any"
		if r.PasswordProtected {
			pw = "yes"
		}
		protocol := strings.Join(r.Protocols, " ")
		if strings.TrimSpace(protocol) == "" {
			protocol = defaultFileFilterProtocols
		}
		rules = append(rules, map[string]interface{}{
			"name":               r.Name,
			"comment":            r.Comment,
			"protocol":           protocol,
			"action":             action,
			"direction":          dir,
			"password-protected": pw,
			"file-type":          fts,
		})
	}
	return map[string]interface{}{
		"name":                  form.Name,
		"comment":               form.Comment,
		"feature-set":           "flow",
		"scan-archive-contents": FGBoolToString(form.ScanArchiveContents),
		"rules":                 rules,
	}
}

// fgToFileFilterProfileForm parses one file-filter/profile CMDB object into our form.
func fgToFileFilterProfileForm(raw json.RawMessage) FileFilterProfileForm {
	var obj struct {
		Name                string `json:"name"`
		Comment             string `json:"comment"`
		ScanArchiveContents string `json:"scan-archive-contents"`
		Rules               []struct {
			Name              string `json:"name"`
			Comment           string `json:"comment"`
			Protocol          string `json:"protocol"`
			Action            string `json:"action"`
			Direction         string `json:"direction"`
			PasswordProtected string `json:"password-protected"`
			FileType          []struct {
				Name string `json:"name"`
			} `json:"file-type"`
		} `json:"rules"`
	}
	if json.Unmarshal(raw, &obj) != nil {
		return FileFilterProfileForm{}
	}
	form := FileFilterProfileForm{
		Name:                obj.Name,
		Comment:             obj.Comment,
		ScanArchiveContents: FGStringToBool(obj.ScanArchiveContents),
	}
	for _, r := range obj.Rules {
		fts := make([]string, 0, len(r.FileType))
		for _, ft := range r.FileType {
			fts = append(fts, ft.Name)
		}
		action := "monitor"
		if strings.EqualFold(r.Action, "block") {
			action = "block"
		}
		form.Rules = append(form.Rules, FileFilterRule{
			Name:              r.Name,
			Comment:           r.Comment,
			Protocols:         strings.Fields(r.Protocol),
			Direction:         defaultStr(r.Direction, "any"),
			PasswordProtected: strings.EqualFold(r.PasswordProtected, "yes"),
			FileTypes:         fts,
			Action:            action,
		})
	}
	return form
}

// GetFileFilterProfile fetches a single file-filter/profile object by name for the edit form.
func (f *FortiClient) GetFileFilterProfile(name string) (FileFilterProfileForm, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/file-filter/profile/"+url.PathEscape(name), nil)
	if err != nil {
		return FileFilterProfileForm{}, err
	}
	var items []json.RawMessage
	if err := json.Unmarshal(resp.Results, &items); err != nil || len(items) == 0 {
		return FileFilterProfileForm{}, fmt.Errorf("file filter profile %q not found", name)
	}
	form := fgToFileFilterProfileForm(items[0])
	log.Printf("[fortigate] GET file-filter/profile/%s parsed=%+v", name, form)
	return form, nil
}

// CreateFileFilterProfile creates a new file-filter/profile object on the device.
func (f *FortiClient) CreateFileFilterProfile(form FileFilterProfileForm) error {
	payload := fileFilterProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] POST file-filter/profile payload=%s", b)
	}
	return fileFilterProfileTable.Create(f, payload)
}

// UpdateFileFilterProfile overwrites an existing file-filter/profile object by name.
func (f *FortiClient) UpdateFileFilterProfile(name string, form FileFilterProfileForm) error {
	payload := fileFilterProfilePayload(form)
	if b, err := json.Marshal(payload); err == nil {
		log.Printf("[fortigate] PUT file-filter/profile/%s payload=%s", name, b)
	}
	return fileFilterProfileTable.Update(f, name, payload)
}

// ── File Filter metadata (file-type catalogue + protocol options) ─────────────
//
// FileFilterMetadata is what the "New File Filter Profile" page needs beyond the profile
// itself: the file-type catalogue for the rule drawer's "Select Entries" list, and the
// protocol option set. Protocols mirror the GUI's flow-mode list (CIFS/FTP/HTTP/IMAP/POP3/SMTP).
type FileFilterMetadata struct {
	FileTypes []string `json:"file_types"`
	Protocols []string `json:"protocols"`
	// The subset of FileTypes a rule may use once "Password-protected only" is on.
	PasswordProtectedFileTypes []string `json:"password_protected_file_types"`
}

// fileFilterPasswordProtectedTypes are the ONLY file types a rule with password-protected=yes
// accepts — the formats that can actually carry a password.
//
// ⚠️ The CMDB schema does NOT express this: file-type just says datasource
// antivirus.filetype.name (all 56 types). The constraint is enforced at runtime instead —
// verified live on FortiOS 7.2.10 by trying every one of the 56 types with
// password-protected=yes: these 6 succeeded, the other 50 came back
// "-3 entry not found in datasource" (and an UPDATE that flips the toggle while a
// non-archive type is still selected fails with "-61 check operator error").
var fileFilterPasswordProtectedTypes = []string{"7z", "msoffice", "msofficex", "pdf", "rar", "zip"}

var fileFilterPasswordProtectedSet = func() map[string]bool {
	m := make(map[string]bool, len(fileFilterPasswordProtectedTypes))
	for _, t := range fileFilterPasswordProtectedTypes {
		m[t] = true
	}
	return m
}()

// passwordProtectedFileTypes returns the allowed list (copy — callers must not mutate it).
func passwordProtectedFileTypes() []string {
	return append([]string(nil), fileFilterPasswordProtectedTypes...)
}

// invalidPasswordProtectedFileTypes returns the selected types the device would reject while
// "Password-protected only" is on, so the caller can name them instead of surfacing a bare -3.
func invalidPasswordProtectedFileTypes(fileTypes []string) []string {
	var bad []string
	for _, t := range fileTypes {
		if !fileFilterPasswordProtectedSet[strings.ToLower(strings.TrimSpace(t))] {
			bad = append(bad, t)
		}
	}
	return bad
}

// ValidateFileFilterForm catches the rule constraints the device enforces at runtime but the
// schema doesn't describe, so the form gets an actionable message instead of a FortiOS code.
//
// The profile name is NOT checked here: create validates it separately and update takes it from
// the URL, where the body may legitimately omit it.
func ValidateFileFilterForm(form FileFilterProfileForm) error {
	for _, r := range form.Rules {
		if strings.TrimSpace(r.Name) == "" {
			return fmt.Errorf("every rule needs a name")
		}
		// The device rejects a rule with no file types: "-61 file-type must be set".
		if len(r.FileTypes) == 0 {
			return fmt.Errorf("rule %q needs at least one file type", r.Name)
		}
		if r.PasswordProtected {
			if bad := invalidPasswordProtectedFileTypes(r.FileTypes); len(bad) > 0 {
				return fmt.Errorf(
					"rule %q has \"Password-protected only\" on, which the FortiGate allows only for %s — remove %s",
					r.Name,
					strings.Join(fileFilterPasswordProtectedTypes, ", "),
					strings.Join(bad, ", "),
				)
			}
		}
	}
	return nil
}

// fileFilterFallbackTypes is the antivirus.filetype catalogue as of FortiOS 7.2 — used only
// if the live datasource is unreachable (verified live = these 56 names).
var fileFilterFallbackTypes = []string{
	".net", "7z", "activemime", "arj", "aspack", "avi", "base64", "bat", "binhex", "bmp",
	"bzip", "bzip2", "cab", "chm", "class", "cod", "crx", "dmg", "elf", "exe", "flac", "fsg",
	"gif", "gzip", "hlp", "hta", "html", "iso", "jad", "javascript", "jpeg", "lzh", "mach-o",
	"mime", "mov", "mp3", "mpeg", "msi", "msoffice", "msofficex", "pdf", "petite", "png", "rar",
	"rm", "sis", "tar", "tiff", "torrent", "upx", "uue", "wav", "wma", "xar", "xz", "zip",
}

// GetFileFilterMetadata returns the file-type catalogue (live from antivirus/filetype, the
// same datasource the CMDB file-type field points at) plus the GUI protocol option set.
func (f *FortiClient) GetFileFilterMetadata() FileFilterMetadata {
	meta := FileFilterMetadata{
		// GUI flow-mode protocol list (screenshot order: CIFS, FTP, HTTP, IMAP, POP3, SMTP).
		Protocols:                  []string{"cifs", "ftp", "http", "imap", "pop3", "smtp"},
		PasswordProtectedFileTypes: passwordProtectedFileTypes(),
	}
	// The catalogue ships with the firmware — it lives under cmdb but nothing in the GUI or this
	// app can add to it — so it is cached per device rather than re-read on every form open.
	meta.FileTypes = cachedSlice(fgFileTypeCache, f.BaseURL, f.fetchAntivirusFileTypes)
	if len(meta.FileTypes) == 0 {
		meta.FileTypes = fileFilterFallbackTypes
	}
	return meta
}

func (f *FortiClient) fetchAntivirusFileTypes() []string {
	resp, err := f.do("GET", "/api/v2/cmdb/antivirus/filetype?fields=name", nil)
	if err != nil {
		return nil
	}
	var rows []struct {
		Name string `json:"name"`
	}
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	out := make([]string, 0, len(rows))
	for _, r := range rows {
		if r.Name != "" {
			out = append(out, r.Name)
		}
	}
	return out
}
