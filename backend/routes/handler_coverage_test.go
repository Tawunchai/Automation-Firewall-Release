package routes

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// Every device-proxy handler that exists must be reachable.
//
// ── The bug this is named after ──────────────────────────────────────────────
//
// controller/policyobject/device_ipgeo.go defined DeviceLookupIPGeo, the batch geo lookup behind
// the Trace Route hop strip. frontend/src/api/diagnostics.ts called it. routes.go never registered
// it. Of the ~200 exported Device* handlers in controller/, it was the only one with no route — so
// every hop lookup in the console answered 404, and nothing anywhere said so: the handler compiled,
// the frontend compiled, the tests passed, and gin returned its default 404 for a path nobody had
// claimed.
//
// That is the whole class: a handler is written, reviewed and merged in one file while the line
// that makes it reachable lives in another, and forgetting the second half produces no error at
// build time, no failing test, and no log entry. It is only visible by using the feature.
//
// ── Why it is checked by reading the source ──────────────────────────────────
//
// Walking gin's route tree would be the obvious alternative, but it can only list what WAS
// registered; it cannot know what should have been. The missing half of this bug is a function that
// exists and is never mentioned, and the only place both halves appear is the source.
//
// The convention it leans on is the one this repo already follows everywhere: a device-proxy
// handler is an exported function named Device… taking exactly one *gin.Context. Anything that
// stops matching that shape stops being checked, which is what the floor at the bottom is for.
func TestEveryDeviceHandlerIsRegistered(t *testing.T) {
	registered := handlerNamesMentionedInRoutes(t)

	var handlers []string
	root := filepath.Join("..", "controller")
	err := filepath.Walk(root, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if info.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") {
			return nil
		}
		src, readErr := os.ReadFile(path)
		if readErr != nil {
			return readErr
		}
		file, parseErr := parser.ParseFile(token.NewFileSet(), path, src, 0)
		if parseErr != nil {
			return parseErr
		}
		for _, decl := range file.Decls {
			fn, ok := decl.(*ast.FuncDecl)
			if !ok || fn.Recv != nil || fn.Body == nil {
				continue
			}
			if !strings.HasPrefix(fn.Name.Name, "Device") || !fn.Name.IsExported() {
				continue
			}
			if !isSingleGinContextHandler(fn) {
				continue
			}
			handlers = append(handlers, fn.Name.Name+"\t"+filepath.ToSlash(path))
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk %s: %v", root, err)
	}
	sort.Strings(handlers)

	for _, entry := range handlers {
		name, path, _ := strings.Cut(entry, "\t")
		if registered[name] {
			continue
		}
		if why, allowed := unregisteredByDesign[name]; allowed {
			t.Logf("%s (%s) is deliberately unregistered: %s", name, path, why)
			continue
		}
		t.Errorf("%s (%s) is a device handler that routes.go never registers — "+
			"it compiles, it is callable from Go, and every HTTP request for it returns 404. "+
			"Register it, or add it to unregisteredByDesign with the reason.", name, path)
	}

	// A guard that silently stops matching anything reports success forever. If the naming
	// convention changes, this number collapses and the test says so rather than going quiet.
	if len(handlers) < 150 {
		t.Fatalf("only %d exported Device* handlers found under %s — the naming convention "+
			"probably changed and this test is no longer checking what it claims to",
			len(handlers), root)
	}
	t.Logf("checked %d device handlers against routes.go", len(handlers))
}

// unregisteredByDesign names handlers that exist on purpose without a route.
//
// It is deliberately empty. A handler nobody can call is dead code at best and a half-finished
// feature at worst, so the answer is almost always to register it or delete it — an entry here has
// to carry a reason somebody is prepared to defend, not a note that it was easier than deciding.
var unregisteredByDesign = map[string]string{}

// isSingleGinContextHandler reports whether fn has the shape of a gin handler: exactly one
// parameter, of type *gin.Context.
//
// The parameter list is checked rather than the name alone so that helpers which merely begin with
// "Device" — DeviceFromID, DeviceSummary and the like — are not mistaken for endpoints and demanded
// of routes.go.
func isSingleGinContextHandler(fn *ast.FuncDecl) bool {
	params := fn.Type.Params
	if params == nil || len(params.List) != 1 {
		return false
	}
	if len(params.List[0].Names) > 1 {
		return false
	}
	star, ok := params.List[0].Type.(*ast.StarExpr)
	if !ok {
		return false
	}
	sel, ok := star.X.(*ast.SelectorExpr)
	if !ok {
		return false
	}
	pkg, ok := sel.X.(*ast.Ident)
	return ok && pkg.Name == "gin" && sel.Sel.Name == "Context"
}

// handlerNamesMentionedInRoutes collects every identifier routes.go reads off a package — the
// `po.DeviceListPolicies` half of a registration line.
//
// Names rather than paths: this test is about reachability, not about the shape of the URL, and
// checking the name is what catches a handler that was never wired at all. Which method and which
// path a route uses is covered by routes/authz_test.go, which drives the real router.
func handlerNamesMentionedInRoutes(t *testing.T) map[string]bool {
	t.Helper()

	// EVERY routes file, not routes.go alone: the registrations live in routes_app.go,
	// routes_device_objects.go and their siblings now, and a test that still read one file would
	// have reported every route in the other five as unregistered — or, far worse, kept passing
	// while a registrar was dropped from Setup.
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatalf("glob: %v", err)
	}
	mentioned := map[string]bool{}
	seen := 0
	for _, path := range files {
		if strings.HasSuffix(path, "_test.go") {
			continue
		}
		src, err := os.ReadFile(path)
		if err != nil {
			t.Fatalf("read %s: %v", path, err)
		}
		file, err := parser.ParseFile(token.NewFileSet(), path, src, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		seen++
		ast.Inspect(file, func(n ast.Node) bool {
			if sel, ok := n.(*ast.SelectorExpr); ok {
				mentioned[sel.Sel.Name] = true
			}
			return true
		})
	}
	if seen == 0 {
		t.Fatal("no route files found — this check would pass vacuously")
	}
	return mentioned
}
