package automationjob

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// POST /devices/batch-backup must scope its device query to the caller's grants.
//
// It used to run `WHERE status = 'active'` with an optional id list and nothing else, so an empty
// body meant "every active firewall in the INVENTORY" rather than "every one I hold". One click
// logged into devices the caller cannot list, and wrote each one's running configuration into this
// platform's store — where /backups/:id/content then serves it. Its single-device sibling
// TriggerBackup has always checked, which is exactly how a rule like this goes missing: on the
// path that handles many at once.
//
// This is a source-level check rather than a call to BackupBatch, and that is a deliberate
// compromise. The scoping happens inside the SQL that GORM builds, so proving it holds needs a
// database; config.DB() is a package-level handle with no test seam and the one driver this module
// carries is Postgres. What CAN be pinned without a server is that the handler hands its query to
// the single function that owns the rule, services.ScopeDevicesToUser, whose own behaviour —
// admin unfiltered, grants filtered, unreadable grants matching nothing — is tested in
// services/deviceaccess*_test.go. The same reading-the-source approach guards the ~60 write
// handlers in controller/policyobject (authz_guard_test.go) for the same reason.
func TestBatchBackupScopesItsDeviceQueryToTheCaller(t *testing.T) {
	const path = "automationjob.go"

	file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}

	var fn *ast.FuncDecl
	for _, decl := range file.Decls {
		d, ok := decl.(*ast.FuncDecl)
		if ok && d.Recv == nil && d.Name.Name == "BackupBatch" && d.Body != nil {
			fn = d
			break
		}
	}
	if fn == nil {
		t.Fatalf("BackupBatch was not found in %s — if it was renamed or moved, rename it here too", path)
	}

	// Both halves have to be present: the scope call, and the device query it is meant to wrap.
	// A handler that stopped selecting devices but kept the call would pass a laxer check.
	scoped, queriesDevices := false, false
	ast.Inspect(fn.Body, func(n ast.Node) bool {
		switch node := n.(type) {
		case *ast.SelectorExpr:
			pkg, ok := node.X.(*ast.Ident)
			if ok && pkg.Name == "services" && node.Sel.Name == "ScopeDevicesToUser" {
				scoped = true
			}
		case *ast.BasicLit:
			if strings.Contains(node.Value, "status = ?") {
				queriesDevices = true
			}
		}
		return true
	})

	if !queriesDevices {
		t.Fatalf("BackupBatch no longer selects devices by status — this test is checking a shape " +
			"that has moved, and is no longer guarding anything")
	}
	if !scoped {
		t.Fatal("BackupBatch queries the device inventory but never calls services.ScopeDevicesToUser — " +
			"an empty device_ids body would back up every active firewall in the inventory, not just " +
			"the ones this caller was granted")
	}
}
