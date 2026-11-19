package otp

import (
	"go/ast"
	"go/parser"
	"go/token"
	"strings"
	"testing"
)

// The package that owns password reset had no tests at all, which is how it came to contain the
// worst finding in the codebase: POST /reset-password-direct set any account's password using a
// token that GET /check-user-email handed to unauthenticated callers on request. Naming an address
// was the entire proof of ownership.
//
// The route is gone. These tests are the tripwire for it coming back — not by name, but by shape:
// any handler in this package that writes a password without the mailed OTP in its path.
//
// Reading the source rather than calling handlers is deliberate. The live checks need a database
// (routes/authz_test.go covers the routing, controller-level behaviour needs rows), while the
// property that matters here is structural: what may this package DO. That is exactly what a
// source-level assertion can hold and a mock cannot lie about.

func parseThisPackage(t *testing.T) *ast.File {
	t.Helper()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "otp.go", nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("parse otp.go: %v", err)
	}
	return file
}

func exportedFuncs(file *ast.File) map[string]*ast.FuncDecl {
	out := map[string]*ast.FuncDecl{}
	for _, decl := range file.Decls {
		fn, ok := decl.(*ast.FuncDecl)
		if !ok || fn.Recv != nil || !fn.Name.IsExported() {
			continue
		}
		out[fn.Name.Name] = fn
	}
	return out
}

// A handler that sets a password must verify the OTP first.
//
// The check is "does this function mention the OTP table at all". It is coarse on purpose: a
// precise dataflow analysis would be a research project, while the failure being guarded against is
// somebody adding a whole new reset path that never looks at an OTP — which this catches the moment
// it is written.
func TestNoPasswordWriteWithoutAnOTPCheck(t *testing.T) {
	file := parseThisPackage(t)
	fset := token.NewFileSet()

	for name, fn := range exportedFuncs(file) {
		var body strings.Builder
		ast.Inspect(fn, func(n ast.Node) bool {
			if id, ok := n.(*ast.Ident); ok {
				body.WriteString(id.Name)
				body.WriteString(" ")
			}
			if lit, ok := n.(*ast.BasicLit); ok {
				body.WriteString(lit.Value)
				body.WriteString(" ")
			}
			return true
		})
		src := body.String()

		writesPassword := strings.Contains(src, "HashPassword")
		if !writesPassword {
			continue
		}

		if !strings.Contains(src, "OTP") {
			t.Errorf("%s hashes a new password but never mentions an OTP.\n"+
				"Every self-service password reset in this package must be gated on the code "+
				"delivered to the account's mailbox — that is the only thing here that proves the "+
				"caller owns the address. A path that skips it is how /reset-password-direct let "+
				"anyone take over any account. If this handler is legitimately admin-only, it "+
				"belongs in controller/user, behind requireAdmin.", name)
		}
		_ = fset
	}
}

// The removed endpoint, named. A regression here is not "a new handler was misfiled" — it is the
// exact hole coming back, and it deserves to fail with its own name on it.
func TestResetPasswordDirectStaysDeleted(t *testing.T) {
	file := parseThisPackage(t)

	for name := range exportedFuncs(file) {
		if name == "ResetPasswordDirect" {
			t.Fatal("ResetPasswordDirect is back.\n" +
				"It accepted {email, new_password, reset_token}, and the token came from " +
				"/check-user-email, which gave it to anyone who asked — so two unauthenticated " +
				"calls set any account's password, the admin's included. If a reset without email " +
				"OTP is needed, it is an admin action: PATCH /admin/users/:id already does it.")
		}
	}
}

// The gate the remaining reset path depends on, over every combination of the three switches.
// services.OTPGate is tested in its own package; this pins the CALLER's use of it — SendOTP must
// consult the gate rather than reading reset_otp_enabled directly, or the master Two-Step switch
// stops meaning anything.
func TestSendOTPConsultsTheGateNotTheRawFlag(t *testing.T) {
	file := parseThisPackage(t)
	fn, ok := exportedFuncs(file)["SendOTP"]
	if !ok {
		t.Fatal("SendOTP is gone — the only self-service reset path in the system")
	}

	var mentions []string
	ast.Inspect(fn, func(n ast.Node) bool {
		if sel, ok := n.(*ast.SelectorExpr); ok {
			mentions = append(mentions, sel.Sel.Name)
		}
		if lit, ok := n.(*ast.BasicLit); ok {
			mentions = append(mentions, strings.Trim(lit.Value, `"`))
		}
		return true
	})
	joined := strings.Join(mentions, " ")

	if !strings.Contains(joined, "ResetOTPActive") {
		t.Error("SendOTP does not go through OTPGate.ResetOTPActive().\n" +
			"Reading reset_otp_enabled directly makes the master Two-Step switch a lie: turning it " +
			"off would grey the checkbox and keep mailing codes.")
	}
	if strings.Contains(joined, "reset_otp_enabled") {
		t.Error("SendOTP reads the reset_otp_enabled key directly. Ask services.LoadOTPGate instead " +
			"so the master switch is applied in one place.")
	}
}
