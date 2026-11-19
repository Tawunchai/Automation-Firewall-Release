package services

import (
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

// Who changed this firewall, from the firewall's own event log.
//
// The Change Ledger can only answer that question for writes this console made. Everything else —
// the CLI over a console cable, SSH, the FortiGate's own GUI, FortiManager — leaves no trace here,
// and Configuration Drift can only say THAT it happened, never who. The device does know: it logs
// every configuration change with the account, the way in, and the source address.
//
// ── THE LOG NAMESPACE, AND THE TWO LOG IDS ───────────────────────────────────
// Config changes are event/system rows in the third namespace (see fortigate_log.go for why
// /api/v2/log/ and not monitor or cmdb). Probed live on the lab FGT80E (FortiOS 7.2.10) by making
// a change of each kind and reading the log back; of the range 0100044544-0100044550 only two ever
// carry a row:
//
//	0100044547  "Object attribute configured"  an object in a table  (has cfgobj)
//	0100044546  "Attribute configured"         a settings table      (no cfgobj, e.g. log.setting)
//
// A row looks like this, verbatim from the device:
//
//	"user": "admin", "ui": "ssh(10.10.20.164)", "action": "Edit",
//	"cfgpath": "firewall.address", "cfgobj": "ZZ-cli-probe",
//	"cfgattr": "comment[made-by-rest->edited-over-ssh]",
//	"uuid": "8b54386a-b0bb-51f1-6627-98ed12956ea5"
//
// ⚠️ A REST WRITE IS LOGGED AS "GUI". The API and the web interface are one `ui` value to FortiOS,
// so this console's own writes are indistinguishable from somebody using the FortiGate's GUI — by
// `ui` alone. The source address is what separates them, and the Change Ledger is what actually
// accounts for our own writes. Never present "GUI" as "someone used the web interface".
//
// ⚠️ ATTRIBUTE CHANGES COALESCE. A create followed closely by an edit is ONE row, an `Add` whose
// cfgattr carries both (`comment[a]subnet[…]comment[a->b]`), and it is written when the device
// flushes rather than when the change happened — the probe saw an Add timestamped AFTER the Delete
// that followed it. So rows are not reliably ordered, and one row can cover several edits. Matching
// therefore uses the object's identity and a window, never an exact time.
//
// ⚠️ `filter=cfgpath=*a*` MATCHES NOTHING — 200 with total_lines 0, not an error. The two log ids
// are the only usable filter, and they are ORed by comma inside ONE parameter (the AND form is a
// repeated parameter — see buildLogPath).
//
// ── HOW FAR BACK IT REACHES ──────────────────────────────────────────────────
// This device has no log disk (`monitor/log/device/state` → disk.is_available false), so the only
// source is the memory buffer, which rolls. Measured on the lab: the unfiltered event log held two
// days, while a filtered read for these two ids reached back SEVEN — a filtered search covers older
// rolls, and configuration changes are rare enough to survive in them. Neither number is a
// guarantee. The window the read actually covered is returned alongside the events, so the caller
// can say "the log does not reach this change" instead of "nobody did it".

// Config-change log ids, both confirmed present on the device.
const (
	logIDObjectConfigured = "0100044547" // an object in a table; has cfgobj
	logIDAttrConfigured   = "0100044546" // a settings table; no cfgobj
)

// configEventRows is how many rows one attribution read asks for. The device caps a read at
// maxLogRows; config changes are rare, so this reaches much further back in time than the same
// number of traffic rows would.
const configEventRows = maxLogRows

// ConfigChangeEvent is one configuration change, as the firewall recorded it.
type ConfigChangeEvent struct {
	// At is `_metadata.timestamp` — epoch milliseconds, UTC, the device's own clock. A row the
	// device sent without a usable timestamp is kept, with a zero At.
	At time.Time `json:"at"`

	User string `json:"user"`
	// Via is the way in, as the device names it: "GUI" (which includes every REST call), "ssh",
	// "jsconsole", "console", "fortimanager"… Passed through; this package does not editorialise.
	Via string `json:"via"`
	// SourceIP is the address inside `ui`, when it had one. Empty for a local console, or for a
	// change the device made itself.
	SourceIP string `json:"source_ip,omitempty"`

	Action string `json:"action"` // Add | Edit | Delete
	Path   string `json:"path"`   // cfgpath, e.g. "firewall.address"
	Object string `json:"object"` // cfgobj — the mkey; empty on a settings table
	Attrs  string `json:"attrs"`  // cfgattr — "comment[old->new]" style, exactly as sent
	UUID   string `json:"uuid,omitempty"`
}

// ConfigEventPage is a read of the config-change log, with the span it actually covered.
type ConfigEventPage struct {
	Events []ConfigChangeEvent `json:"events"`
	// From and To bound what this read could see. A change outside them is not unattributed — it
	// is out of the log's reach, which is a different sentence on screen.
	From time.Time `json:"from"`
	To   time.Time `json:"to"`
	// Total is the device's `total_lines`: how many rows matched, which may exceed len(Events).
	Total int `json:"total"`
}

// rawConfigEvent is one row of the response.
type rawConfigEvent struct {
	User    string `json:"user"`
	UI      string `json:"ui"`
	Action  string `json:"action"`
	CfgPath string `json:"cfgpath"`
	CfgObj  string `json:"cfgobj"`
	CfgAttr string `json:"cfgattr"`
	UUID    string `json:"uuid"`
	Meta    struct {
		Timestamp int64 `json:"timestamp"`
	} `json:"_metadata"`
}

// ListConfigChangeEvents reads the device's configuration-change log, newest first.
func (f *FortiClient) ListConfigChangeEvents() (ConfigEventPage, error) {
	var page ConfigEventPage

	// OR inside ONE parameter: comma is the OR separator. A repeated `filter=` would AND the two
	// ids, and no row has two log ids, so that form matches nothing. The comma is left unescaped
	// for the same reason the filter syntax needs it — it is a separator, not data.
	path := fmt.Sprintf(
		"/api/v2/log/memory/event/system?start=0&rows=%d&filter=logid%%3D%%3D%s,logid%%3D%%3D%s",
		configEventRows, logIDObjectConfigured, logIDAttrConfigured)

	body, _, err := f.doRawGet(path, maxLogBody)
	if err != nil {
		return page, err
	}

	var env struct {
		Results    json.RawMessage `json:"results"`
		TotalLines int             `json:"total_lines"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		return page, fmt.Errorf("the device's config-change log could not be read: %w", err)
	}
	page.Total = env.TotalLines

	var rows []rawConfigEvent
	if len(env.Results) > 0 {
		if err := json.Unmarshal(env.Results, &rows); err != nil {
			return page, fmt.Errorf("the device's config-change log could not be read: %w", err)
		}
	}

	page.Events = make([]ConfigChangeEvent, 0, len(rows))
	for _, r := range rows {
		ev := ConfigChangeEvent{
			User: r.User, Action: r.Action, Path: r.CfgPath,
			Object: r.CfgObj, Attrs: r.CfgAttr, UUID: r.UUID,
		}
		ev.Via, ev.SourceIP = splitLogUI(r.UI)
		if r.Meta.Timestamp > 0 {
			ev.At = time.UnixMilli(r.Meta.Timestamp).UTC()
			if page.To.IsZero() || ev.At.After(page.To) {
				page.To = ev.At
			}
			if page.From.IsZero() || ev.At.Before(page.From) {
				page.From = ev.At
			}
		}
		page.Events = append(page.Events, ev)
	}
	return page, nil
}

// splitLogUI takes the device's `ui` field apart: "ssh(10.0.0.9)" → ("ssh", "10.0.0.9").
//
// Not every value has an address — "jsconsole", "console" and the device's own automation arrive
// bare — and a value this does not recognise is returned whole as the method rather than dropped.
// Losing "somebody changed it" because the shape was unfamiliar would be the worst outcome here.
func splitLogUI(ui string) (via, ip string) {
	ui = strings.TrimSpace(ui)
	if ui == "" {
		return "", ""
	}
	open := strings.Index(ui, "(")
	if open < 0 || !strings.HasSuffix(ui, ")") {
		return ui, ""
	}
	return strings.TrimSpace(ui[:open]), strings.TrimSpace(ui[open+1 : len(ui)-1])
}
