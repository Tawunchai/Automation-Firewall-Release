package policyobject

import (
	"go/ast"
	"sort"
	"testing"
)

// The handlers an OPERATOR must not reach, and the reason each one is not ordinary device config.
//
// requireAdminPO lets the "operator" role write to a firewall — that is what the role is for, and
// ~60 handlers in this package rely on it. The three families below are the exceptions, and each
// is an exception because allowing it would hand over something this console cannot take back:
//
//	admin accounts   an operator who can create a super_admin on the unit can then sign in to the
//	                 FortiGate directly, where the approval queue, the change ledger and the device
//	                 grants do not apply. Every control Phase 2 adds is bypassed by one POST.
//	auth servers     LDAP/RADIUS/Exchange each carry a bind credential and name the directory the
//	                 firewall trusts; repointing one turns "authenticate against AD" into
//	                 "authenticate against me".
//	traffic log      names internal addresses, the people behind them and where they went. It is
//	                 data about users who are not party to any of this, and unlike a bad policy it
//	                 cannot be undone by reverting a change.
//
// This test exists because the difference is invisible at the call site: `requireAdminPO(c)` and
// `requireAdminStrict(c)` read identically in a diff, and relaxing one of these back to the
// lenient gate would restore the escalation silently while every other guard in the package stayed
// green. Reading the source is what catches that — the same approach, and the same reasoning, as
// TestEveryDeviceWriteHandlerIsAdminGated next door.
var adminOnlyHandlers = map[string]string{
	// System ▸ Administrators (device_sysadmin.go) — the escalation path itself.
	"DeviceListAdminUsers":  "lists the accounts that can administer the unit, from where, and which have no second factor",
	"DeviceCreateAdminUser": "can create a super_admin on the firewall, outside this console entirely",
	"DeviceUpdateAdminUser": "can raise an existing account's access profile, or clear its trusted hosts",
	"DeviceDeleteAdminUser": "can remove the accounts an admin would use to undo any of the above",

	// User & Authentication ▸ LDAP / RADIUS / Exchange (device_authserver.go).
	//
	// The READS are here too, and that was a gap rather than a decision: Phase 2 gated every write
	// in this family and left every read open, which was found by running the queue's own check
	// against the lab device — an operator got 200 on all three lists. What a read returns is the
	// host, the port, the bind DN and the base DN: the shape of the directory and an account that
	// can read it. Not the password, and not the point.
	"DeviceListLDAPServers":         "names the directory the firewall trusts, its host and the account it binds as",
	"DeviceGetLDAPServer":           "the same, for one server, shaped for the edit form",
	"DeviceGetLDAPServerOptions":    "the CA certificates and Exchange connectors an LDAP server can be pointed at",
	"DeviceListRADIUSServers":       "names the RADIUS hosts and the NAS identity the firewall presents",
	"DeviceGetRADIUSServer":         "the same, for one server",
	"DeviceListExchangeConnectors":  "names the Exchange server, its domain and the service account",
	"DeviceCreateLDAPServer":        "points the firewall at a directory, with a bind credential",
	"DeviceUpdateLDAPServer":        "same, on a server the firewall already trusts",
	"DeviceDeleteLDAPServer":        "removes the directory the unit authenticates against",
	"DeviceCreateRADIUSServer":      "same as LDAP, with a shared secret instead of a bind DN",
	"DeviceUpdateRADIUSServer":      "same",
	"DeviceDeleteRADIUSServer":      "same",
	"DeviceTestRADIUSServer":        "sends the stored secret to whichever host the caller names",
	"DeviceCreateExchangeConnector": "an auth source holding a service account's credential",
	"DeviceDeleteExchangeConnector": "same",

	// Log & Report ▸ Local Traffic (device_log.go). All of these delegate to readTrafficLog.
	"DeviceGetTrafficLog":      "personal data: who went where, from which internal address",
	"DeviceDownloadTrafficLog": "the same rows, as a file that leaves the console",
	"DeviceGetLogSources":      "says which log backends the unit keeps, for the same page",
}

func TestAdminOnlyHandlersRefuseAnOperator(t *testing.T) {
	pkg := parsePackage(t)

	names := make([]string, 0, len(adminOnlyHandlers))
	for name := range adminOnlyHandlers {
		names = append(names, name)
	}
	sort.Strings(names)

	for _, name := range names {
		entry, ok := pkg.funcs[name]
		if !ok {
			t.Errorf("%s is listed as admin-only (%s) but no longer exists in this package — if it "+
				"was renamed or moved, say so here, because a list naming nothing guards nothing",
				name, adminOnlyHandlers[name])
			continue
		}
		if !pkg.reachesStrictGate(name) {
			t.Errorf("%s (%s) must refuse an operator — %s — but it reaches only requireAdminPO, "+
				"which admits the operator role (authz.go). Use requireAdminStrict.",
				name, entry.file, adminOnlyHandlers[name])
		}
	}

	// The lenient gate must still exist and still be the majority: if requireAdminPO ever
	// disappeared, every handler here would "pass" this test while the operator role quietly lost
	// or gained everything at once.
	if _, ok := pkg.funcs["requireAdminPO"]; !ok {
		t.Fatal("requireAdminPO is gone — this test compares two gates and can no longer tell them apart")
	}
	if _, ok := pkg.funcs["requireAdminStrict"]; !ok {
		t.Fatal("requireAdminStrict is gone — the admin-only handlers above have nothing to call")
	}
	t.Logf("checked %d handlers that must refuse an operator", len(adminOnlyHandlers))
}

// reachesStrictGate is reachesAdminGate's narrower twin: only requireAdminStrict counts.
func (p *parsedPackage) reachesStrictGate(name string) bool {
	return p.reachesGate(name, "requireAdminStrict", map[string]bool{})
}

func (p *parsedPackage) reachesGate(name, gate string, visited map[string]bool) bool {
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
		if id.Name == gate || p.reachesGate(id.Name, gate, visited) {
			found = true
			return false
		}
		return true
	})
	return found
}
