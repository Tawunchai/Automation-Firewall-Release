package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
)

// One FortiOS CMDB table, and the only way this package talks to one.
//
// ── Why this is a type and not five helper functions ────────────────────────
//
// The first rule in this repo's instructions is:
//
//	NEVER send DELETE to a CMDB collection URL — a delete must always name its mkey.
//
// DELETE /api/v2/cmdb/firewall/address answers 200 and empties the table. It has happened here
// once (every policy on the lab device), and what has guarded it since is a PreToolUse hook
// watching what gets typed into a terminal. Nothing in the product itself.
//
// cmdbTable.Delete takes the key as a parameter and refuses an empty one before a request exists,
// so a DELETE at a collection URL is not an expressible call. That is the whole point of the type:
// the rule stops depending on everyone remembering it.
//
// The second reason is the ~174 copies of this, one per table endpoint:
//
//	resp, err := f.do("GET", "/api/v2/cmdb/system/zone", nil)
//	if err != nil { return nil, err }
//	var raw []fgZoneRaw
//	if err := json.Unmarshal(resp.Results, &raw); err != nil {
//	    return nil, fmt.Errorf("failed to parse zones: %w", err)
//	}
//	out := make([]FGZone, 0, len(raw))
//	for _, r := range raw { out = append(out, r.toGUI()) }
//	return out, nil
//
// Raw is the shape FortiOS sends, GUI the shape this console shows. The per-domain mapping — which
// is where every schema trap lives, and the reason fortigate_<domain>.go files exist — stays in
// those files. Only the plumbing moves here.
type cmdbTable[Raw any, GUI any] struct {
	cmdbPath
	// gui maps one row from the device's shape to the console's. Usually Raw's own method, as a
	// method expression: fgZoneRaw.toGUI.
	gui func(Raw) GUI
}

// cmdbPath is a table addressed but not mapped: the URL, the noun, and the three writes.
//
// It is split out of cmdbTable for the tables this console writes without ever decoding — a BGP
// network row the hub-and-spoke wizard deletes by sequence number, a singleton it only PUTs. They
// need the mkey rule just as much as the mapped ones, and without this they would have had to name
// two type parameters they have no use for.
type cmdbPath struct {
	// path is the table, without the /api/v2/cmdb/ prefix: "system/zone", "firewall/address".
	path string
	// noun names one row in an error message: "zone", "address". Singular.
	noun string
}

func (t cmdbPath) collection() string { return "/api/v2/cmdb/" + t.path }

// object is the URL of ONE row. url.PathEscape, not concatenation: FortiOS mkeys carry slashes
// (an address named for its subnet, "10.0.0.0/8"), and a raw slash would address a different table
// altogether.
func (t cmdbPath) object(mkey string) string {
	return t.collection() + "/" + url.PathEscape(mkey)
}

// requireKey is the guard. Trimmed, because " " in a URL is a path that still resolves to the
// collection on some FortiOS builds.
func (t cmdbPath) requireKey(method, mkey string) error {
	if strings.TrimSpace(mkey) != "" {
		return nil
	}
	return fmt.Errorf(
		"refusing to %s %s with no key: that URL is the whole collection, not one %s — a DELETE there removes every %s on the firewall",
		method, t.path, t.noun, t.noun)
}

// Raws returns the table exactly as the device sent it.
//
// For the callers that need a field the GUI shape deliberately drops — a read-back check after a
// write, q_origin_key, or the reference counts that only come with ?with_meta=1.
func (t cmdbTable[Raw, GUI]) Raws(f *FortiClient, query ...string) ([]Raw, error) {
	return cmdbRaws[Raw](f, t.cmdbPath, query...)
}

// cmdbRaws is Raws for a table this package reads but does not map — the mapping-free half, as a
// function, because a cmdbTable would make such a caller name a GUI type it has no use for.
//
//	raw, err := cmdbRaws[fgInterfaceRaw](f, interfaceTable)
func cmdbRaws[Raw any](f *FortiClient, t cmdbPath, query ...string) ([]Raw, error) {
	path := t.collection()
	if len(query) > 0 && query[0] != "" {
		path += "?" + query[0]
	}
	resp, err := f.do("GET", path, nil)
	if err != nil {
		return nil, err
	}
	var raw []Raw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		// Not an empty list: "could not read this" and "there is nothing here" are the two
		// answers this console is most careful to keep apart, because a page that renders an
		// empty table tells the operator a firewall has no rules.
		return nil, fmt.Errorf("failed to parse the %s table: %w", t.noun, err)
	}
	return raw, nil
}

// List returns every row in the console's own shape.
func (t cmdbTable[Raw, GUI]) List(f *FortiClient, query ...string) ([]GUI, error) {
	raw, err := t.Raws(f, query...)
	if err != nil {
		return nil, err
	}
	out := make([]GUI, 0, len(raw))
	for _, r := range raw {
		out = append(out, t.gui(r))
	}
	return out, nil
}

// RawGet returns one row as the device sent it.
func (t cmdbTable[Raw, GUI]) RawGet(f *FortiClient, mkey string) (*Raw, error) {
	return cmdbRawGet[Raw](f, t.cmdbPath, mkey)
}

// cmdbRawGet is RawGet without a GUI type, for the same reason cmdbRaws exists.
func cmdbRawGet[Raw any](f *FortiClient, t cmdbPath, mkey string, query ...string) (*Raw, error) {
	if err := t.requireKey("GET", mkey); err != nil {
		return nil, err
	}
	path := t.object(mkey)
	if len(query) > 0 && query[0] != "" {
		path += "?" + query[0]
	}
	resp, err := f.do("GET", path, nil)
	if err != nil {
		return nil, err
	}
	var raw []Raw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse the %s %q: %w", t.noun, mkey, err)
	}
	if len(raw) == 0 {
		// Phrased so IsObjectGoneError recognises it, the same way the hand-written versions of
		// this line were: a caller distinguishing "deleted already" from "could not read" relies
		// on that, and respondDeviceError turns it into a 404.
		return nil, fmt.Errorf("%s %q not found", t.noun, mkey)
	}
	return &raw[0], nil
}

// Get returns one row in the console's shape.
func (t cmdbTable[Raw, GUI]) Get(f *FortiClient, mkey string) (*GUI, error) {
	raw, err := t.RawGet(f, mkey)
	if err != nil {
		return nil, err
	}
	g := t.gui(*raw)
	return &g, nil
}

// Create POSTs one new row. payload is the domain file's own wire shape — a map or a struct — so
// the field names and the "enable"/"disable" strings stay where the schema notes are.
func (t cmdbPath) Create(f *FortiClient, payload interface{}) error {
	_, err := f.do("POST", t.collection(), payload)
	return err
}

// Update PUTs onto one existing row. FortiOS merges a PUT body into the stored object, so a
// payload may carry only the fields that change.
//
// A SINGLETON table — log/setting, vpn/l2tp, system.snmp/sysinfo, router/bgp — has no mkey and is
// legitimately PUT at its collection URL. Those tables are not addressed through this type: there
// is no row to name, so there is nothing for the guard to check, and bending the type to allow an
// empty key here would reopen the hole it exists to close.
func (t cmdbPath) Update(f *FortiClient, mkey string, payload interface{}) error {
	if err := t.requireKey("PUT", mkey); err != nil {
		return err
	}
	_, err := f.do("PUT", t.object(mkey), payload)
	return err
}

// Delete removes ONE row, named by its mkey. See the type's comment for why the key is a
// parameter and an empty one is refused here rather than by a convention.
func (t cmdbPath) Delete(f *FortiClient, mkey string) error {
	if err := t.requireKey("DELETE", mkey); err != nil {
		return err
	}
	_, err := f.do("DELETE", t.object(mkey), nil)
	return err
}
