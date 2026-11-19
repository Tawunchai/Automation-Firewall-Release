package policyobject

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// Every handler in this package that WRITES to a firewall must call requireAdminPO.
//
// This is checked by reading the source rather than by exercising each handler, because the thing
// worth protecting is a property of the whole package, not of any one function: there are ~60
// write handlers across seven files, they are added regularly, and a new one that forgets the
// guard does not fail — it works, for everyone, including a "user" role that should not be able to
// touch the rule base. There is no failing test to notice, no error in the log, and the only
// symptom is a permission that was never enforced.
//
// An audit found all of them correct on 2026-08-06. This is what keeps that true for the next one.

// A handler that changes the device, or reaches it for something a plain read is not.
//
// Read handlers (DeviceList*, DeviceGet*) are exempt: reading Policy & Objects is open to any
// signed-in user by design.
//
// Apply/Undo joined with the Troubleshooting fix endpoints (DeviceApplyTraceFix, DeviceUndoTraceFix),
// which write to the rule base without a verb from the older list in their names.
// Clone/Bulk joined with the Firewall Policy selection actions (DeviceClonePolicy,
// DeviceBulkPolicyStatus, DeviceBulkDeletePolicies). Those three are the reason this regex is
// worth re-reading whenever a handler is added: all three rewrite the live rule base, none of
// them starts with a verb the older list knew, and every one of them would have been silently
// exempt from this test while still LOOKING like it was covered by it.
//
// Simulate/Check/Lookup/Download/Explain joined on 2026-11-13, after a review pointed out that four
// handlers nobody had thought about — DeviceSimulateTraceFix, DeviceCheckNetworkSettings,
// DeviceGetTrafficLog and DeviceLookupWebRating — matched no verb here at all. Widening the regex
// does not decide anything by itself; it only forces each of them to be ANSWERED, either by the
// gate in its body or by a line in openByDesign below. Two of them turned out to be genuinely
// ungated and are recorded there, named, rather than passing unnoticed.
var writeHandler = regexp.MustCompile(`^Device(Create|Update|Delete|Toggle|Move|Control|Test|Revert|Apply|Undo|Clone|Bulk|Simulate|Check|Lookup|Download|Explain)`)

// alsoGuarded: handlers whose names begin with a read verb but which must be gated anyway.
//
// The regex cannot reach these — widening it to `Get` would sweep in sixty open reads — so they are
// named. Each one answers the device for data about PEOPLE rather than about configuration, which
// is the line the Local Traffic page is gated on (see routes.go).
var alsoGuarded = map[string]string{
	"DeviceGetTrafficLog": "a traffic log names internal addresses, users and their devices",
	"DeviceGetLogSources": "same page; says which log backends the unit keeps",
}

// openByDesign: handlers the rules above catch that are deliberately NOT admin-gated.
//
// An exception has to be written down with its reason, in the same spirit as gatedListsByDesign at
// the bottom of this file. Two of these are not blessings — they are findings from the 2026-11-13
// authorisation pass, recorded here so the guard can go green without anyone quietly fixing a file
// they do not own. They are reported, not resolved.
var openByDesign = map[string]string{
	"DeviceCheckNetworkSettings": "four monitor/CMDB GETs, no SSH; open like Troubleshoot and Audit " +
		"(documented at the top of device_diagnostics.go)",
	"DeviceLookupIPInfo": "rDNS + address kind computed on this box from reads the caller may " +
		"already make; the Trace Route hop strip is open to any signed-in user",
	"DeviceLookupIPGeo": "the batch sibling of ip-info; offline GeoLite2 lookup, no device I/O at all",

	"DeviceSimulateTraceFix": "FINDING (2026-11-13, not fixed here — device_troubleshoot_fix.go " +
		"belongs to another change): the what-if preview behind Troubleshooting ▸ Fix it is open " +
		"while DeviceApplyTraceFix and DeviceUndoTraceFix beside it are admin-only. It writes " +
		"nothing, but it reads the whole rule base and reports how to get traffic through the " +
		"firewall, which is more than the open reads next to it give away",
	"DeviceLookupWebRating": "FINDING (2026-11-13, not fixed here — device_webrating.go belongs to " +
		"another change): the Security Profiles ▸ Web Rating Overrides page is admin-only in the " +
		"sidebar and every other handler in device_webrating.go is gated, but the FortiGuard lookup " +
		"itself is not, so a non-admin can spend the unit's rating queries",
}

func TestEveryDeviceWriteHandlerIsAdminGated(t *testing.T) {
	pkg := parsePackage(t)
	checked := 0
	answered := map[string]bool{}

	for _, fn := range pkg.order {
		name := fn.decl.Name.Name
		if !writeHandler.MatchString(name) {
			if _, named := alsoGuarded[name]; !named {
				continue
			}
		}
		checked++

		gated := pkg.reachesAdminGate(name)
		why, exempt := openByDesign[name]

		if exempt {
			answered[name] = true
			if gated {
				t.Errorf("%s (%s) is listed in openByDesign (%s) but DOES call requireAdminPO — "+
					"delete the exception, or the next reader will trust the wrong half of it",
					name, fn.file, why)
				continue
			}
			t.Logf("open by design: %s (%s) — %s", name, fn.file, why)
			continue
		}

		if !gated {
			t.Errorf("%s (%s) changes a firewall or reaches it for privileged data but never "+
				"calls requireAdminPO, directly or through a helper — any signed-in user could "+
				"invoke it. If that is deliberate, add it to openByDesign with the reason.",
				name, fn.file)
		}
	}

	// An exception is a ratchet, not a permanent pass: one that names a handler which no longer
	// exists, or which the rules above stopped matching, is an exception nobody is reading.
	for name, why := range openByDesign {
		if !answered[name] {
			t.Errorf("%s is listed in openByDesign (%s) but the guard never reached it — it was "+
				"renamed, deleted, or no longer matches %q", name, why, writeHandler)
		}
	}

	// A guard that silently stops matching anything is worse than no guard, because it reports
	// success. If the naming convention changes, this number goes to zero and the test says so.
	if checked < 30 {
		t.Fatalf("only %d write handlers matched %q — the naming convention probably changed and "+
			"this test is no longer checking what it claims to", checked, writeHandler)
	}
	t.Logf("checked %d device write handlers", checked)
}

// ── Reading the package ───────────────────────────────────────────────────────

type pkgFunc struct {
	decl *ast.FuncDecl
	file string
}

type parsedPackage struct {
	funcs map[string]pkgFunc
	order []pkgFunc
}

// parsePackage reads every non-test file in this directory once.
//
// It keeps ALL package-level functions, not only the handlers, because the gate is not always in
// the handler: DeviceGetTrafficLog, DeviceDownloadTrafficLog and DeviceExplainTrafficLog each
// delegate to readTrafficLog, which calls requireAdminPO and answers the request itself. A check
// that only inspected the handler body would have called all three ungated — a false alarm that
// teaches the next person to add an exemption instead of a gate.
func parsePackage(t *testing.T) *parsedPackage {
	t.Helper()

	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	sort.Strings(files)

	pkg := &parsedPackage{funcs: map[string]pkgFunc{}}
	fset := token.NewFileSet()
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Body == nil {
				continue
			}
			entry := pkgFunc{decl: fn, file: path}
			pkg.funcs[fn.Name.Name] = entry
			pkg.order = append(pkg.order, entry)
		}
	}
	if len(pkg.funcs) == 0 {
		t.Fatal("no package-level functions parsed — is this test still in controller/policyobject?")
	}
	return pkg
}

// reachesAdminGate reports whether calling fn reaches EITHER admin gate — requireAdminPO or the
// stricter requireAdminStrict — following calls to functions declared in this package.
//
// Both count here on purpose: this test asks "is anything checked at all", and strict is a
// superset of lenient. WHICH of the two a handler must use is a different question, and
// TestAdminOnlyHandlersRefuseAnOperator below is where it is answered.
//
// Depth is bounded by the visited set, so a cycle terminates. Only unqualified calls are followed:
// a gate in another package would not be requireAdminPO, and a method on a value cannot be resolved
// from the syntax tree alone.
func (p *parsedPackage) reachesAdminGate(name string) bool {
	return p.reaches(name, map[string]bool{})
}

func (p *parsedPackage) reaches(name string, visited map[string]bool) bool {
	if visited[name] {
		return false
	}
	visited[name] = true

	entry, ok := p.funcs[name]
	if !ok {
		return false
	}

	found := false
	ast.Inspect(entry.decl.Body, func(n ast.Node) bool {
		if found {
			return false
		}
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		id, ok := call.Fun.(*ast.Ident)
		if !ok {
			return true
		}
		if id.Name == "requireAdminPO" || id.Name == "requireAdminStrict" || p.reaches(id.Name, visited) {
			found = true
			return false
		}
		return true
	})
	return found
}

// mustBeGated names, one by one, the handlers whose admin gate must never be removed.
//
// ── Why this list exists at all, next to the regex above ─────────────────────
//
// The regex decides by NAME. These are the handlers the name cannot decide: they read rather than
// write, so nothing in what they are called says they are privileged, and the reason each one is
// gated lives in a page's design rather than in a verb.
//
// ── Why it had to be rewritten ───────────────────────────────────────────────
//
// It was `map[string]bool{}` — empty — scoped to device_diagnostics.go, under a comment saying it
// protected the SSH diagnostics. It iterated nothing and passed unconditionally. The SSH POST
// endpoints it was written for (ping, traceroute, the session table, the support bundle) were
// deleted when Session Monitor's live tab went; whoever removed the last entry left the loop, the
// comment and the test name behind, and the result was a guard that reported success about code
// that no longer existed while the handlers that DID need it grew up elsewhere.
//
// So it now names what is actually true today, across packages, and it fails if the list ever
// empties out again.
var mustBeGated = map[string]string{
	// Log & Report ▸ Local Traffic. A traffic log names internal addresses, users and the devices
	// they carry — data about people, not configuration, which is the whole reason this page is the
	// one read in the console that is admin-only. All three delegate their gate to readTrafficLog.
	"DeviceGetTrafficLog":      "device_log.go",
	"DeviceDownloadTrafficLog": "device_log.go",
	"DeviceGetLogSources":      "device_log.go",
	"DeviceExplainTrafficLog":  "device_log_explain.go",

	// The firewall's own administrator accounts — see gatedListsByDesign below for the reasoning.
	// Listed here as well so that a rename cannot drop it out of both guards at once.
	"DeviceListAdminUsers": "device_sysadmin.go",

	// The app's two SSH features, in their own packages. Ping and traceroute no longer have POST
	// endpoints here: they stream over a WebSocket (controller/diagstream), and the Config Deploy
	// terminal (controller/terminal) is the other. Both gate on the role directly instead of
	// calling requireAdminPO, because neither is in this package — which is exactly why they are
	// worth asserting from one place: an SSH session is a login against a unit that locks its admin
	// account after three failures, and both hand over a live prompt on the firewall.
	"Stream": "../diagstream/diagstream.go",
	"Shell":  "../terminal/terminal.go",
}

func TestHandlersThatMustStayAdminGated(t *testing.T) {
	pkg := parsePackage(t)

	names := make([]string, 0, len(mustBeGated))
	for name := range mustBeGated {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		path := mustBeGated[name]

		// Inside this package the gate may sit one call deep (readTrafficLog), so resolve through
		// the package. Elsewhere, read the one file and look at the handler itself.
		if entry, ok := pkg.funcs[name]; ok {
			if filepath.ToSlash(entry.file) != path {
				t.Errorf("%s has moved from %s to %s — update mustBeGated", name, path, entry.file)
			}
			if !pkg.reachesAdminGate(name) {
				t.Errorf("%s (%s) must stay admin-gated but no longer reaches requireAdminPO, "+
					"directly or through a helper", name, path)
			}
			continue
		}

		fn, ok := handlerIn(t, path, name)
		if !ok {
			t.Errorf("%s was not found in %s — if it was renamed or moved, say so here too",
				name, path)
			continue
		}
		if !gatesOnAdminRole(fn) {
			t.Errorf("%s (%s) must stay admin-gated but its body no longer refuses a caller whose "+
				"user_role is not admin", name, path)
		}
	}

	// The failure this test was found in: an empty list is not a passing test, it is no test. Four
	// is the smallest number that still covers both halves — the Local Traffic family and the two
	// SSH entry points.
	if len(mustBeGated) < 4 {
		t.Fatalf("mustBeGated holds %d entries — a guard that names nothing reports success about "+
			"nothing, which is how this test spent its last release", len(mustBeGated))
	}
	t.Logf("checked %d handlers that must stay admin-gated", len(mustBeGated))
}

// handlerIn finds one top-level function in a file outside this package.
func handlerIn(t *testing.T, path, name string) (*ast.FuncDecl, bool) {
	t.Helper()

	src, err := os.ReadFile(path)
	if err != nil {
		t.Errorf("read %s: %v", path, err)
		return nil, false
	}
	file, err := parser.ParseFile(token.NewFileSet(), path, src, 0)
	if err != nil {
		t.Errorf("parse %s: %v", path, err)
		return nil, false
	}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if ok && fn.Recv == nil && fn.Body != nil && fn.Name.Name == name {
			return fn, true
		}
	}
	return nil, false
}

// gatesOnAdminRole reports whether a handler outside this package refuses non-admins itself —
// the `role, _ := c.Get("user_role"); if role != "admin"` shape that diagstream and terminal use
// because they have no requireAdminPO of their own.
//
// Both literals are required. Either alone turns up in comments and in unrelated strings; together,
// in one function body, they are the check.
func gatesOnAdminRole(fn *ast.FuncDecl) bool {
	wantRole, wantAdmin := false, false
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		lit, ok := n.(*ast.BasicLit)
		if !ok || lit.Kind != token.STRING {
			return true
		}
		switch lit.Value {
		case `"user_role"`:
			wantRole = true
		case `"admin"`:
			wantAdmin = true
		}
		return true
	})
	return wantRole && wantAdmin
}

// gatedListsByDesign are the list endpoints that ARE admin-only, on purpose.
//
// The rule below exists to stop a list being gated QUIETLY, which turns a page into a 403 with no
// obvious cause. An exception therefore has to be written down here, with the reason, and it has to
// come with a menu entry hidden for the same role — a gated endpoint behind a visible link is the
// failure this guard is named after.
//
// Both directions are checked: a handler listed here that STOPS being gated also fails, so an
// exception cannot quietly become a hole.
var gatedListsByDesign = map[string]string{
	// The firewall's own administrator accounts: who can reach the device, from which addresses,
	// and which of them have no second factor. Reading a policy table tells you what the firewall
	// does; reading this tells you how to take it over. The sidebar hides Administrators for
	// non-admins and the route is only registered in the admin tree.
	"DeviceListAdminUsers": "names who can administer the firewall and from where",

	// The remote authentication sources, for the same reason one step removed: each entry names
	// the host the firewall trusts to say who someone is, the port, and the account it binds as.
	// Reading it is reconnaissance of the directory, and repointing one — which the writes beside
	// these have been admin-only since Phase 2 — turns "authenticate against AD" into
	// "authenticate against me".
	//
	// Gated on 2026-11-16 after running the live check an operator was supposed to fail: the
	// writes refused and all three LISTS answered 200. The sidebar already hides the whole
	// User & Authentication section for non-admins, so no page loses rows it used to show.
	"DeviceListLDAPServers":        "names the directory the firewall trusts and the account it binds as",
	"DeviceListRADIUSServers":      "names the RADIUS hosts and the NAS identity the firewall presents",
	"DeviceListExchangeConnectors": "names the Exchange server, its domain and the service account",
}

// TestReadHandlersAreNotAdminGated is the other half: reading Policy & Objects is deliberately open
// to any signed-in user, and quietly gating a list endpoint would make whole pages 403 for the
// "user" role with no obvious cause.
func TestListHandlersStayReadableByNonAdmins(t *testing.T) {
	files, _ := filepath.Glob("*.go")
	fset := token.NewFileSet()
	listHandler := regexp.MustCompile(`^DeviceList`)
	gatedSeen := map[string]bool{}

	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, _ := os.ReadFile(path)
		file, err := parser.ParseFile(fset, path, src, 0)
		if err != nil {
			continue
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Body == nil || !listHandler.MatchString(fn.Name.Name) {
				continue
			}
			gated := false
			ast.Inspect(fn.Body, func(n ast.Node) bool {
				// Either gate counts as "gated" here. The question this test asks is whether a
				// LIST endpoint refuses ordinary users at all; requireAdminStrict refuses strictly
				// more of them than requireAdminPO does.
				if id, ok := n.(*ast.Ident); ok &&
					(id.Name == "requireAdminPO" || id.Name == "requireAdminStrict") {
					gated = true
					return false
				}
				return true
			})
			if _, allowed := gatedListsByDesign[fn.Name.Name]; allowed {
				gatedSeen[fn.Name.Name] = gated
				continue
			}
			if gated {
				t.Errorf("%s (%s) is a list endpoint but is admin-gated — non-admin users "+
					"would get a 403 and an empty page. If that is deliberate, add it to "+
					"gatedListsByDesign with the reason, and hide its menu entry for the same role.",
					fn.Name.Name, path)
			}
		}
	}

	// The exceptions are a ratchet, not a permanent pass: one that stops being gated is a hole that
	// opened without anybody deciding to open it.
	for name, why := range gatedListsByDesign {
		seen, found := gatedSeen[name]
		if !found {
			t.Errorf("%s is listed in gatedListsByDesign (%s) but no such handler exists — "+
				"if it was renamed, rename it here too", name, why)
			continue
		}
		if !seen {
			t.Errorf("%s is listed in gatedListsByDesign (%s) but no longer calls either admin gate",
				name, why)
		}
	}
}
