package config

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeedAccountPasswordPrefersTheEnvironment(t *testing.T) {
	t.Setenv("SEED_TEST_PASSWORD", "  chosen-by-the-operator  ")

	pw, fromEnv := seedAccountPassword("SEED_TEST_PASSWORD", "the-default")
	if !fromEnv {
		t.Error("fromEnv = false although the variable is set")
	}
	if pw != "chosen-by-the-operator" {
		t.Errorf("password = %q, want the configured value with surrounding space trimmed", pw)
	}
}

// With the variable unset the seed uses a fixed, published default rather than a random value.
// That is the owner's decision (2026-11-18) and it is what makes a fresh install loggable-into
// without reading a container log — so the thing worth testing is that it is DELIBERATE: the
// fallback is returned verbatim, and the caller is told it was not configured, which is what
// turns the loud warning on at boot.
func TestSeedAccountPasswordFallsBackToTheDefault(t *testing.T) {
	t.Setenv("SEED_TEST_PASSWORD", "")

	pw, fromEnv := seedAccountPassword("SEED_TEST_PASSWORD", "the-default")
	if fromEnv {
		t.Error("fromEnv = true with the variable unset — the boot log would not warn")
	}
	if pw != "the-default" {
		t.Errorf("password = %q, want the fallback", pw)
	}

	// A blank variable is not a configured password: it would seed an account with no password
	// at all, which logs in with an empty string.
	t.Setenv("SEED_TEST_PASSWORD", "   ")
	if pw, fromEnv := seedAccountPassword("SEED_TEST_PASSWORD", "the-default"); fromEnv || pw != "the-default" {
		t.Errorf("whitespace-only variable gave (%q, %v), want the fallback", pw, fromEnv)
	}
}

// The default is in the source, so it is public. The one property it must keep is that it is a
// password the policy this same seed installs will not reject outright on sight — and the one it
// must NOT have is being silently empty.
func TestDefaultSeedAdminPasswordIsNotEmpty(t *testing.T) {
	if strings.TrimSpace(defaultSeedAdminPassword) == "" {
		t.Fatal("defaultSeedAdminPassword is blank — a fresh install would seed an admin with no password")
	}
}

func TestSmtpSeedFromEnvNeedsBothHalves(t *testing.T) {
	cases := []struct {
		name, email, pass string
		wantOK            bool
	}{
		{"both set", "ops@example.test", "an-app-password", true},
		{"no address", "", "an-app-password", false},
		{"no password", "ops@example.test", "", false},
		{"neither", "", "", false},
		{"blank-looking values", "   ", "\t", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SEED_SMTP_EMAIL", tc.email)
			t.Setenv("SEED_SMTP_APP_PASSWORD", tc.pass)

			email, pass, ok := smtpSeedFromEnv()
			if ok != tc.wantOK {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOK)
			}
			if !ok && (email != "" || pass != "") {
				t.Errorf("a refused seed still returned %q / a non-empty password", email)
			}
			if ok && (email != tc.email || pass != tc.pass) {
				t.Error("the configured values were not returned unchanged")
			}
		})
	}
}

// ── The source itself ────────────────────────────────────────────────────────
//
// This package seeds the login everyone uses and the mailbox the system sends from. Both secrets
// used to be string literals in db.go, which means they were in every clone of the repository and
// identical on every deployment; .gitleaks.toml allowlists only *_test.go and .env.example, so
// nothing flagged them for as long as they were there.
//
// The rules below are about the SHAPE of the code rather than about any particular value, so this
// test keeps working without ever naming a secret: a password or an app password reaching
// services.HashPassword or services.EncryptSecret must come from a variable — from the
// environment, from crypto/rand, from a user — and never from the file.

func parsePackage(t *testing.T) (*token.FileSet, []*ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	names, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	var files []*ast.File
	for _, name := range names {
		if strings.HasSuffix(name, "_test.go") {
			continue // tests may hold fixtures; the shipped code may not
		}
		f, err := parser.ParseFile(fset, name, nil, parser.ParseComments)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files = append(files, f)
	}
	if len(files) == 0 {
		t.Fatal("no non-test source found — this test would pass by seeing nothing")
	}
	return fset, files
}

func selectorName(e ast.Expr) string {
	sel, ok := e.(*ast.SelectorExpr)
	if !ok {
		return ""
	}
	pkg, ok := sel.X.(*ast.Ident)
	if !ok {
		return ""
	}
	return pkg.Name + "." + sel.Sel.Name
}

func isStringLiteral(e ast.Expr) bool {
	lit, ok := e.(*ast.BasicLit)
	return ok && lit.Kind == token.STRING
}

func TestNoSecretIsHashedOrEncryptedFromALiteral(t *testing.T) {
	fset, files := parsePackage(t)

	guarded := map[string]bool{
		"services.HashPassword":  true, // a seeded login password
		"services.EncryptSecret": true, // a device password, an SMTP app password
	}

	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok || !guarded[selectorName(call.Fun)] || len(call.Args) == 0 {
				return true
			}
			if isStringLiteral(call.Args[0]) {
				t.Errorf("%s: %s is called with a string literal — that secret is published in the source, "+
					"read it from the environment instead", fset.Position(call.Pos()), selectorName(call.Fun))
			}
			return true
		})
	}
}

func TestSeededMailAccountIsNotWrittenIntoTheSource(t *testing.T) {
	fset, files := parsePackage(t)

	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			lit, ok := n.(*ast.CompositeLit)
			if !ok || selectorName(lit.Type) != "entity.SendEmail" {
				return true
			}
			for _, elt := range lit.Elts {
				kv, ok := elt.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				key, _ := kv.Key.(*ast.Ident)
				if key == nil {
					continue
				}
				if (key.Name == "Email" || key.Name == "PassAppEnc") && isStringLiteral(kv.Value) {
					t.Errorf("%s: entity.SendEmail.%s is a literal — the mailbox this system sends from "+
						"belongs in the environment, not in the repository", fset.Position(kv.Pos()), key.Name)
				}
			}
			return true
		})
	}
}

// The seeds must actually be wired to the documented variables, so .env.example is not describing
// something that does not exist.
func TestSeedEnvKeysAreRead(t *testing.T) {
	source := ""
	for _, name := range []string{"db.go"} {
		b, err := os.ReadFile(name)
		if err != nil {
			t.Fatalf("read %s: %v", name, err)
		}
		source += string(b)
	}

	for _, key := range []string{
		"SEED_ADMIN_PASSWORD",
		"SEED_SMTP_EMAIL",
		"SEED_SMTP_APP_PASSWORD",
		"SEED_DEVICE_PASSWORD",
	} {
		if !strings.Contains(source, key) {
			t.Errorf("%s is documented in .env.example but nothing in db.go reads it", key)
		}
	}
}
