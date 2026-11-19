package services

import (
	"encoding/json"
	"fmt"
	"strings"
)

// Multi-VDOM.
//
// ── What was wrong ───────────────────────────────────────────────────────────
//
// Every device call in this codebase appended `?vdom=root`, hard-coded, in doOnce. On a firewall
// split into VDOMs that is not a default — it is a decision, made silently, to read and write one
// particular tenant. A customer who divides one FortiGate between three departments could point
// this console at it, see the root VDOM's policy table, and never learn that the other two exist.
//
// ── How it is threaded ───────────────────────────────────────────────────────
//
// Exactly like the request context: a per-HANDLE field, set by a shallow copy, sharing the one
// underlying session. That shape is already proven here (see WithContext) and it is the only shape
// that is safe — a VDOM stored on the shared *fortiSession would mean one request's choice of
// tenant silently changing another's mid-flight, on a pooled session that several requests hold at
// once.
//
//	fc.WithVDOM("sales").GetPolicies()   reads the sales VDOM
//	fc.GetPolicies()                     reads root, exactly as before
//
// ── Why the default stays "root" ─────────────────────────────────────────────
//
// Not because root is special, but because every existing caller passes no VDOM and must keep
// behaving identically. A default of "" would send no vdom parameter at all, which on a VDOM-
// enabled unit means "the management VDOM" — a different answer than the one those callers have
// been getting, arrived at by accident.

// FGVDOM is one virtual domain.
type FGVDOM struct {
	Name string `json:"name"`
	// ShortName is what the device's own GUI puts in its VDOM menu when the name is long.
	ShortName string `json:"short_name"`
	// Management is true for the VDOM that owns the unit's global settings — the one whose
	// administrators can change things that affect every other VDOM.
	Management bool `json:"management"`
	// Enabled reports whether the unit is in multi-VDOM mode at all. Carried on every row so a
	// caller that only reads one still knows which world it is in.
	MultiVDOM bool `json:"multi_vdom"`
}

// WithVDOM returns a handle onto the same device session whose requests target `vdom`.
//
// Shallow copy, like WithContext, and for the same reason: BaseURL and httpClient are immutable
// and the mutable half is the shared *fortiSession, so a re-login through one handle is seen by
// every other. Only the VDOM differs.
//
// An empty name returns the handle unchanged rather than clearing the VDOM — "no opinion" from a
// caller must not become "the management VDOM", which is what sending no parameter means.
func (f *FortiClient) WithVDOM(vdom string) *FortiClient {
	if vdom == "" || vdom == f.vdom {
		return f
	}
	cp := *f
	cp.vdom = vdom
	return &cp
}

// VDOM reports which virtual domain this handle targets.
func (f *FortiClient) VDOM() string {
	if f.vdom == "" {
		return "root"
	}
	return f.vdom
}

// GetVDOMs lists the unit's virtual domains.
//
// A single-VDOM firewall answers with exactly one row named "root", which is the honest answer:
// there IS one VDOM and everything lives in it. The UI uses MultiVDOM to decide whether to show a
// picker at all — a selector with one option on a unit that has no VDOMs is clutter that implies
// a choice nobody has.
func (f *FortiClient) GetVDOMs() ([]FGVDOM, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/vdom", nil)
	if err != nil {
		return nil, err
	}
	var raw []struct {
		Name      string `json:"name"`
		ShortName string `json:"short-name"`
	}
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse VDOM list: %w", err)
	}

	// Which VDOM manages the unit, and whether multi-VDOM is on at all. Both live on
	// system/global. A failed read is not fatal: the VDOM list is still the truth about what
	// exists, and the worst outcome is a picker that does not mark the management one.
	mgmt, multi := f.vdomMode()

	out := make([]FGVDOM, 0, len(raw))
	for _, r := range raw {
		out = append(out, FGVDOM{
			Name:       r.Name,
			ShortName:  r.ShortName,
			Management: r.Name == mgmt,
			MultiVDOM:  multi,
		})
	}
	return out, nil
}

// vdomMode reads the management VDOM's name and whether the unit is split at all.
func (f *FortiClient) vdomMode() (management string, multi bool) {
	resp, err := f.do("GET", "/api/v2/cmdb/system/global", nil)
	if err != nil {
		return "root", false
	}
	var g struct {
		ManagementVDOM string `json:"management-vdom"`
		VDOMMode       string `json:"vdom-mode"`
	}
	// system/global is a single-object table and answers with an OBJECT, like vpn.ssl/settings.
	if json.Unmarshal(resp.Results, &g) != nil {
		var many []struct {
			ManagementVDOM string `json:"management-vdom"`
			VDOMMode       string `json:"vdom-mode"`
		}
		if json.Unmarshal(resp.Results, &many) != nil || len(many) == 0 {
			return "root", false
		}
		g.ManagementVDOM, g.VDOMMode = many[0].ManagementVDOM, many[0].VDOMMode
	}
	if g.ManagementVDOM == "" {
		g.ManagementVDOM = "root"
	}
	// FortiOS 7.2 reports "no-vdom" / "multi-vdom" / "split-vdom". Anything that is not the
	// single-domain value counts as split — a firmware that adds a fourth word should make the
	// picker appear, not disappear.
	return g.ManagementVDOM, g.VDOMMode != "" && g.VDOMMode != "no-vdom"
}

// vdomParam is what doOnce appends. Kept here beside WithVDOM so the default and the threading are
// one decision in one file.
func (f *FortiClient) vdomParam(apiPath string) string {
	// A path that already names a VDOM has been built deliberately — the schema reads do this —
	// and must not be second-guessed.
	if strings.Contains(apiPath, "vdom=") {
		return apiPath
	}
	sep := "?"
	if strings.Contains(apiPath, "?") {
		sep = "&"
	}
	return apiPath + sep + "vdom=" + f.VDOM()
}
