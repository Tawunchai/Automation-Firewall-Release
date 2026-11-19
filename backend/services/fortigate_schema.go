package services

import (
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync"
)

// ── The device's own answer to "does this setting exist?" ────────────────────
//
// Every fix this console offers is FortiOS CLI that somebody here wrote. That is not wrong — a
// standard never publishes vendor commands, and it never will — but until now it rested on nothing
// a reader could check. "Trust us" is the one thing this whole audit feature is built not to say.
//
// FortiOS answers the question itself. `GET /api/v2/cmdb/<path>?action=schema&vdom=root` returns
// the attribute table for the RUNNING FIRMWARE: every settable field, its type, and for an option
// field the exact set of values it accepts. So a fix can be checked against the device it is for,
// on the build it is running, rather than against documentation that may describe another release.
//
// That is stronger evidence than a documentation link, and it catches a class of bug nothing else
// here would: an attribute Fortinet removes or renames in a later build turns our fix into a
// command that silently fails, and this turns that into a visible "not in this device's schema".
//
// CACHED PER CLIENT. A remediation plan asks about a handful of paths and several steps can share
// one; the schema for a path does not change while a session is open.

// FGSchemaAttr is one settable attribute, as the device describes it.
type FGSchemaAttr struct {
	Name string
	Type string
	// Options is the accepted value set for an option-typed attribute, empty for the rest.
	Options []string
}

// FGSchema is one CMDB path's attribute table.
type FGSchema struct {
	Path  string
	Name  string
	MKey  string
	Attrs map[string]FGSchemaAttr
}

// Has reports whether the device accepts this attribute at all.
func (s FGSchema) Has(attr string) bool {
	_, ok := s.Attrs[strings.ToLower(attr)]
	return ok
}

// Accepts reports whether an option-typed attribute accepts `value`.
//
// The second return is false when the question is not answerable — the attribute is not an option
// type, or the device listed no options — and a caller must not turn that into "rejected". A
// string, an integer or an IP has no enumerable value set, and reporting "unknown value" for
// `set server <collector-ip>` would be this tool inventing a problem.
func (s FGSchema) Accepts(attr, value string) (ok bool, answerable bool) {
	a, found := s.Attrs[strings.ToLower(attr)]
	if !found || len(a.Options) == 0 {
		return false, false
	}
	for _, opt := range a.Options {
		if strings.EqualFold(opt, value) {
			return true, true
		}
	}
	return false, true
}

// fgSchemaResult is the shape FortiOS returns. Confirmed against the lab FortiGate 80E on
// FortiOS 7.2.10 rather than assumed — `children` is a MAP keyed by attribute name, and an option
// attribute carries `options` as a list of objects with their own `name`.
type fgSchemaResult struct {
	Name     string                   `json:"name"`
	Path     string                   `json:"path"`
	MKey     string                   `json:"mkey"`
	Children map[string]fgSchemaChild `json:"children"`
}

type fgSchemaChild struct {
	Name    string `json:"name"`
	Type    string `json:"type"`
	Options []struct {
		Name string `json:"name"`
	} `json:"options"`
}

// schemaCache is per-client: a FortiClient is one session against one device, and the schema is a
// property of that device's firmware.
type schemaCache struct {
	mu     sync.Mutex
	byPath map[string]FGSchema
}

// GetCMDBSchema reads the attribute table for a CMDB path ("firewall/policy", "system/global").
func (f *FortiClient) GetCMDBSchema(path string) (FGSchema, error) {
	path = strings.Trim(strings.TrimSpace(path), "/")
	if path == "" {
		return FGSchema{}, fmt.Errorf("no CMDB path given")
	}

	f.sess().schema.mu.Lock()
	if f.sess().schema.byPath == nil {
		f.sess().schema.byPath = map[string]FGSchema{}
	}
	if cached, ok := f.sess().schema.byPath[path]; ok {
		f.sess().schema.mu.Unlock()
		return cached, nil
	}
	f.sess().schema.mu.Unlock()

	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/%s?action=schema&vdom=root", path), nil)
	if err != nil {
		return FGSchema{}, err
	}
	var raw fgSchemaResult
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return FGSchema{}, fmt.Errorf("could not read the schema for %s: %w", path, err)
	}

	out := FGSchema{Path: raw.Path, Name: raw.Name, MKey: raw.MKey, Attrs: map[string]FGSchemaAttr{}}
	for key, child := range raw.Children {
		name := child.Name
		if name == "" {
			name = key
		}
		attr := FGSchemaAttr{Name: name, Type: child.Type}
		for _, o := range child.Options {
			if o.Name != "" {
				attr.Options = append(attr.Options, o.Name)
			}
		}
		out.Attrs[strings.ToLower(name)] = attr
	}

	f.sess().schema.mu.Lock()
	f.sess().schema.byPath[path] = out
	f.sess().schema.mu.Unlock()
	return out, nil
}

// UpdateCMDBAttrs writes exactly the named attributes on one object, and nothing else.
//
// The narrowest possible write, on purpose. FortiOS merges a PUT body into the existing object, so
// sending only `{"logtraffic":"all"}` changes that one setting and leaves the rest of the policy —
// its addresses, its services, its profiles — untouched. Sending a whole object read-modify-write
// style is how a fix for one attribute silently reverts somebody else's edit made in between.
//
// mkey is empty for a single-object table (system global, log setting): FortiOS takes the PUT on
// the table itself.
func (f *FortiClient) UpdateCMDBAttrs(cmdbPath, mkey string, attrs map[string]any) error {
	if len(attrs) == 0 {
		return fmt.Errorf("no attributes to write")
	}
	path := "/api/v2/cmdb/" + strings.Trim(strings.TrimSpace(cmdbPath), "/")
	if mkey != "" {
		path += "/" + url.PathEscape(mkey)
	}
	resp, err := f.do("PUT", path, attrs)
	if err != nil {
		return err
	}
	if resp != nil && resp.Status != "" && !strings.EqualFold(resp.Status, "success") {
		return fmt.Errorf("%s", fgErrorText(resp))
	}
	return nil
}

// LedgerPath renders a CMDB path the way the change ledger stores it, so a write made here can be
// snapshotted and reverted by the machinery that already exists for every other device write.
func LedgerPath(cmdbPath string) string {
	return "/api/v2/cmdb/" + strings.Trim(strings.TrimSpace(cmdbPath), "/")
}
