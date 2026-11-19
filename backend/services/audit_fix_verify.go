package services

import (
	"sort"
	"strings"
)

// ── Checking our own fix against the firewall it is for ──────────────────────
//
// THE QUESTION THIS ANSWERS. "Who says `set logtraffic all` is the right command?" Until now the
// answer was "we do", which on a page whose entire argument is *never assert what you cannot back*
// was the one soft spot left. The standard behind the finding is cited. The control mapping is
// labelled as an interpretation. The projection is computed. And then the part the customer
// actually types into a production firewall rested on nothing.
//
// A STANDARD CANNOT FIX THIS, and it is worth being clear why. ISO/IEC 27001 says information
// should be logged; NIST SP 800-53 AU-2 says which events; neither will ever say `logtraffic`,
// because both are deliberately vendor-neutral. Waiting for a standards body to publish FortiOS
// commands is waiting forever. The authority for a vendor command is the vendor.
//
// SO WE ASK THE VENDOR'S OWN PRODUCT. FortiOS publishes its attribute table over the API:
// `?action=schema` returns, for the build the device is actually running, every settable attribute
// and — for an option-typed one — the exact set of values it accepts. Checking a fix against that
// is stronger than checking it against documentation, because documentation describes a release and
// this describes THIS DEVICE.
//
// WHAT A VERDICT MEANS, AND WHAT IT DOES NOT. "Verified" means the firewall confirms the attribute
// exists and accepts the value. It does not mean the change is a good idea, that it is safe to make
// now, or that it satisfies any control — those are the other three layers' jobs, and conflating
// them would be a worse overstatement than the one this fixes.
//
// FAILING OPEN IS NOT AN OPTION HERE. If the schema cannot be read the verdict says so, plainly,
// rather than quietly omitting the badge and letting an unverified command look identical to a
// verified one.

// FixVerifyStatus is one attribute's verdict.
type FixVerifyStatus string

const (
	// FixVerified — the device confirms the attribute AND the value.
	FixVerified FixVerifyStatus = "verified"
	// FixAttrOnly — the attribute exists, but its value is not one the schema enumerates: a string,
	// an integer, an IP, an object name from a datasource, or a placeholder for the operator to
	// fill in. The command is well-formed; only the value is beyond checking here.
	FixAttrOnly FixVerifyStatus = "attribute-only"
	// FixPathOnly — a delete or a move. There is no attribute to check; what is confirmed is that
	// the table exists on this device.
	FixPathOnly FixVerifyStatus = "path-only"
	// FixAttrUnknown — the running firmware has no such attribute. Loud on purpose: the fix would
	// fail, or worse, appear to succeed.
	FixAttrUnknown FixVerifyStatus = "attribute-unknown"
	// FixValueUnlisted — the attribute is an option type and the value is not among the options the
	// device published.
	FixValueUnlisted FixVerifyStatus = "value-unlisted"
	// FixUnreadable — the schema could not be read. Not a pass and not a failure.
	FixUnreadable FixVerifyStatus = "unreadable"
)

// FixVerification is one line of the fix, and what the device said about it.
type FixVerification struct {
	Path string `json:"path"`
	// MKey is the object the line writes to, carried through so an apply can rebuild what to write
	// from the verdicts rather than the payload shipping two copies of the same thing.
	MKey   string          `json:"mkey,omitempty"`
	Attr   string          `json:"attr,omitempty"`
	Value  string          `json:"value,omitempty"`
	Status FixVerifyStatus `json:"status"`
	Detail string          `json:"detail"`
	// Options is what the device DOES accept, when the value was not among them. It turns a
	// rejection into something the reader can act on.
	Options []string `json:"options,omitempty"`
}

// SchemaSource identifies the device and firmware a verdict came from. A verification with no
// provenance is the same kind of unsourced claim this whole layer exists to remove.
type SchemaSource struct {
	Device   string `json:"device"`
	Serial   string `json:"serial,omitempty"`
	Firmware string `json:"firmware,omitempty"`
	Method   string `json:"method"`
}

// SchemaReader is the one thing the verifier needs from a device. An interface rather than
// *FortiClient so the logic is testable without a firewall — which matters, because the
// interesting cases (a renamed attribute, a value the build does not accept) cannot be produced on
// demand against the lab device.
type SchemaReader interface {
	GetCMDBSchema(path string) (FGSchema, error)
}

// VerifyFixTargets asks the device about every attribute a fix writes.
//
// Order follows the targets; duplicates are collapsed, because a plan that touches `logtraffic` on
// eleven policies asks the same question eleven times and a reader needs the answer once.
func VerifyFixTargets(dev SchemaReader, targets []FixTarget) []FixVerification {
	if dev == nil || len(targets) == 0 {
		return nil
	}
	var out []FixVerification
	seen := map[string]bool{}

	for _, t := range targets {
		// The object is part of the key. Without it one policy's verdict stood in for every other
		// policy's, which was harmless while the verdicts were only a badge — and wrong the moment
		// they became the list of what an apply writes.
		key := t.Path + "\x00" + t.MKey + "\x00" + t.Attr + "\x00" + t.Value
		if seen[key] {
			continue
		}
		seen[key] = true

		schema, err := dev.GetCMDBSchema(t.Path)
		if err != nil {
			out = append(out, FixVerification{
				Path: t.Path, MKey: t.MKey, Attr: t.Attr, Value: t.Value, Status: FixUnreadable,
				Detail: "this device did not answer for " + t.Path +
					", so the command could not be checked against its firmware: " + err.Error(),
			})
			continue
		}

		if t.Op != FixSet {
			out = append(out, FixVerification{
				Path: t.Path, MKey: t.MKey, Status: FixPathOnly,
				Detail: "the " + cliPath(t.Path) + " table exists on this device. A " + string(t.Op) +
					" writes no attribute, so there is nothing further to check against the schema.",
			})
			continue
		}

		if !schema.Has(t.Attr) {
			out = append(out, FixVerification{
				Path: t.Path, MKey: t.MKey, Attr: t.Attr, Value: t.Value, Status: FixAttrUnknown,
				Detail: "the firmware on this device publishes no attribute called " + t.Attr +
					" under " + cliPath(t.Path) + ". The command would not do what it says.",
			})
			continue
		}

		v := verifyValue(schema, t)
		v.Path, v.MKey, v.Attr, v.Value = t.Path, t.MKey, t.Attr, t.Value
		out = append(out, v)
	}
	return out
}

// verifyValue decides what can be said about the value, given the attribute exists.
func verifyValue(schema FGSchema, t FixTarget) FixVerification {
	values := []string{t.Value}
	if t.List {
		values = strings.Fields(t.Value)
	}

	var unlisted []string
	checked := 0
	for _, raw := range values {
		val := strings.Trim(raw, `"`)
		if val == "" || placeholder(val) {
			continue
		}
		ok, answerable := schema.Accepts(t.Attr, val)
		if !answerable {
			// Not an option type, so the value set is not enumerable and nothing here can judge it.
			// Reporting a problem would be inventing one.
			continue
		}
		checked++
		if !ok {
			unlisted = append(unlisted, val)
		}
	}

	attr := schema.Attrs[strings.ToLower(t.Attr)]
	options := append([]string(nil), attr.Options...)
	sort.Strings(options)

	switch {
	case len(unlisted) > 0:
		return FixVerification{
			Status: FixValueUnlisted, Options: options,
			Detail: "this device accepts " + t.Attr + ", but not " + strings.Join(unlisted, ", ") +
				". The values it published are listed beside this.",
		}
	case checked > 0:
		return FixVerification{
			Status: FixVerified, Options: options,
			Detail: "this device's own schema confirms " + t.Attr + " under " + cliPath(t.Path) +
				" and accepts this value.",
		}
	default:
		return FixVerification{
			Status: FixAttrOnly,
			Detail: "this device's own schema confirms " + t.Attr + " under " + cliPath(t.Path) +
				". Its value is a " + attrKind(attr) + ", which the schema does not enumerate, so the value itself is yours to choose.",
		}
	}
}

func attrKind(a FGSchemaAttr) string {
	switch a.Type {
	case "":
		return "table"
	case "integer":
		return "number"
	case "ipv4-classnet", "ipv4-address":
		return "network address"
	default:
		return a.Type
	}
}

// SummariseVerification reduces a step's verdicts to the one line a badge shows.
//
// Worst wins, on the same principle as control status: a step where one attribute is unknown must
// not read as verified because the other three were.
func SummariseVerification(vs []FixVerification) FixVerifyStatus {
	if len(vs) == 0 {
		return ""
	}
	rank := map[FixVerifyStatus]int{
		FixAttrUnknown: 5, FixValueUnlisted: 4, FixUnreadable: 3,
		FixPathOnly: 2, FixAttrOnly: 1, FixVerified: 0,
	}
	worst := FixVerified
	for _, v := range vs {
		if rank[v.Status] > rank[worst] {
			worst = v.Status
		}
	}
	return worst
}
