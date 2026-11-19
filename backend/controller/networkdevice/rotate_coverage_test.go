package networkdevice

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The rotation sweep has to cover EVERY table holding an encrypted secret, and the failure mode
// when it does not is the worst kind: /admin/rotate-cred-key reports rotated=N failed=0, the
// operator follows the documented procedure and deletes the superseded key, and the columns the
// sweep never visited become permanently unreadable. Nothing looked like it failed at any point.
//
// That already happened once — the sweep walked network_devices alone while device_credentials
// (every person's own firewall account) and notify_channels (the LINE bot token) held ciphertext
// under the same key.
//
// So this test does not check the three tables we happen to know about; it derives the list from
// the entity package and fails when the two disagree. Adding a fourth encrypted column is exactly
// the moment somebody forgets, and it is the moment this fails.

// encFieldSuffix is the naming convention every encrypted column already follows:
// NetworkDevice.PasswordEnc, DeviceCredential.PasswordEnc, NotifyChannel.SecretEnc.
const encFieldSuffix = "Enc"

// entitiesWithEncryptedSecret returns the entity struct names carrying a `…Enc string` field.
func entitiesWithEncryptedSecret(t *testing.T) []string {
	t.Helper()

	files, err := filepath.Glob(filepath.Join("..", "..", "entity", "*.go"))
	if err != nil || len(files) == 0 {
		t.Fatalf("could not read the entity package (glob err=%v, files=%d)", err, len(files))
	}

	var found []string
	fset := token.NewFileSet()
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		file, err := parser.ParseFile(fset, path, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		ast.Inspect(file, func(n ast.Node) bool {
			ts, ok := n.(*ast.TypeSpec)
			if !ok {
				return true
			}
			st, ok := ts.Type.(*ast.StructType)
			if !ok {
				return true
			}
			for _, f := range st.Fields.List {
				ident, ok := f.Type.(*ast.Ident)
				if !ok || ident.Name != "string" {
					continue
				}
				for _, name := range f.Names {
					if strings.HasSuffix(name.Name, encFieldSuffix) {
						found = append(found, ts.Name.Name)
						return false
					}
				}
			}
			return false
		})
	}
	sort.Strings(found)
	return found
}

func TestRotationCoversEveryEncryptedColumn(t *testing.T) {
	// The mapping from an entity to the table the sweep addresses. It is spelled out rather than
	// derived from GORM's pluraliser because the point of the test is to make a human write the
	// table name down next to the entity — which is the step that was skipped.
	entityToTable := map[string]string{
		"NetworkDevice":    "network_devices",
		"DeviceCredential": "device_credentials",
		"NotifyChannel":    "notify_channels",
		"SendEmail":        "send_emails",
	}

	swept := make(map[string]bool, len(credRotationTargets))
	for _, target := range credRotationTargets {
		swept[target.table] = true
	}

	for _, entityName := range entitiesWithEncryptedSecret(t) {
		table, known := entityToTable[entityName]
		if !known {
			t.Errorf("entity %s holds an encrypted secret but this test does not know its table.\n"+
				"Add it to entityToTable AND to credRotationTargets — a column the sweep never visits "+
				"becomes unreadable the moment the old key is removed.", entityName)
			continue
		}
		if !swept[table] {
			t.Errorf("entity %s (table %s) holds an encrypted secret that /admin/rotate-cred-key "+
				"never re-encrypts.\nAdd it to credRotationTargets in networkdevice.go — otherwise the "+
				"rotation reports success and the operator deletes a key those rows still need.",
				entityName, table)
		}
	}
}

func TestRotationTargetsAreWellFormed(t *testing.T) {
	seen := map[string]bool{}
	for _, target := range credRotationTargets {
		if target.table == "" || target.column == "" {
			t.Fatalf("credRotationTargets holds an incomplete entry: %+v", target)
		}
		key := target.table + "." + target.column
		if seen[key] {
			// A duplicate would re-encrypt the same rows twice in one sweep. The second pass sees
			// them already on the current version and counts them as skipped, so the report would
			// under-state what was rotated for no reason.
			t.Errorf("credRotationTargets lists %s twice", key)
		}
		seen[key] = true
	}
}
