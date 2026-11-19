package configdeploy

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Two lists have to agree, and nothing but this test makes them.
//
// `POST /config-deploys/query` accepts a named set of read-only `diagnose` sub-commands
// (allowedDiagnosePatterns, in configdeploy.go — and see the long comment there for why the bare
// `diagnose` prefix is NOT in that list). Section 17 of the Fortinet prompt
// (services/prompts/fortinet_cli_reference.txt) is where the assistant learns which commands it
// may ask for.
//
// They are maintained in different packages, by different people, months apart. When they drift the
// failure is quiet and lands on the user: the model emits a `diagnose` line it was taught, the
// endpoint refuses it with a 400, and the answer the user asked for simply does not arrive — with
// no indication that the request was well-formed and the two halves of this product merely
// disagreed. services/ai.go cites this test by name as the thing keeping them in step, so here it
// is.
//
// The direction matters. The allow-list is permitted to be WIDER than the prompt: a command the
// product issues itself (Troubleshooting's policy walk, the dashboard's disk check) does not have
// to be taught to the model. The reverse is the bug — anything the prompt teaches must be
// something the endpoint will actually run.
//
// The prompt is read off disk rather than through a Go identifier because `fortinetCLIReference`
// is unexported in `services`, and `services` cannot import this package (this one imports it).
// Exporting a 60 KB prompt to be read by one test is a worse trade than reading the file it lives
// in — and since that file became a plain .txt it is simply the prompt, with no Go string-literal
// syntax to parse around.
func TestPromptTeachesOnlyAllowedDiagnoseCommands(t *testing.T) {
	taught := diagnoseCommandsTaughtByPrompt(t)
	if len(taught) == 0 {
		t.Fatal("found no `diagnose` commands in §17 of the prompt — the section markers this test " +
			"scans for have moved, so it is no longer checking anything. Fix the markers below.")
	}

	for _, cmd := range taught {
		// findDisallowedQueryCommand, not allowedDiagnosePatterns directly: it is the function the
		// endpoint actually calls, so this proves the command would be accepted for real rather
		// than that one regex in isolation matches it.
		if bad := findDisallowedQueryCommand([]string{cmd}); bad != "" {
			t.Errorf("§17 of services/prompts/fortinet_cli_reference.txt teaches the assistant %q, but "+
				"/config-deploys/query refuses it.\n"+
				"The model will emit this command and the user will get a 400 with no explanation.\n"+
				"Fix ONE of the two: add a pattern to allowedDiagnosePatterns in configdeploy.go "+
				"(with a comment saying why the sub-command is read-only), or remove the line from "+
				"the prompt.", cmd)
		}
	}
}

// diagnoseCommandsTaughtByPrompt returns every `diagnose …` line inside section 17 of the Fortinet
// prompt — the section headed "### 17. TROUBLESHOOTING COMMANDS", up to the next "### " heading or
// the end of the file.
//
// Scoped to that one section deliberately. The file mentions `diagnose` elsewhere in prose (the
// warning at the top of §17 itself begins with a quoted "diagnose"), and a test that scanned the
// whole file would fail on an explanation rather than on an instruction. Only lines that START with
// `diagnose` followed by whitespace are instructions.
//
// That alone was not enough: the first version of this test failed on the warning paragraph's own
// third line, which happened to wrap onto the word "diagnose". So an instruction is also required
// not to be a SENTENCE — commands carry no `;` and do not end in `.`. The dots inside
// `diagnose sys checkused firewall.address.name` are why the rule is "ends with", not "contains".
// The prompt's wrap was adjusted at the same time so no prose line starts with the word, which
// makes the two defences independent rather than one load-bearing trick.
func diagnoseCommandsTaughtByPrompt(t *testing.T) []string {
	t.Helper()

	path := filepath.Join("..", "..", "services", "prompts", "fortinet_cli_reference.txt")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("cannot read the prompt at %s: %v", path, err)
	}

	const sectionHeading = "### 17. TROUBLESHOOTING COMMANDS"
	lines := strings.Split(string(body), "\n")

	inSection := false
	var taught []string
	for _, raw := range lines {
		line := strings.TrimRight(raw, "\r")
		switch {
		case strings.HasPrefix(line, sectionHeading):
			inSection = true
			continue
		case !inSection:
			continue
		// The next numbered section ends §17. The file ends it too, which the loop handles by
		// running out of lines — §17 is the last section, and when it was a Go raw string literal
		// its final command line carried the closing backtick, which this had to strip.
		case strings.HasPrefix(line, "### "):
			return taught
		}

		if cmd, ok := diagnoseInstruction(line); ok {
			taught = append(taught, cmd)
		}
	}
	return taught
}

// diagnoseInstruction reports whether one line of the prompt is a `diagnose` command the assistant
// is being taught, as opposed to prose that merely wrapped onto the word.
func diagnoseInstruction(line string) (string, bool) {
	cmd := strings.TrimSpace(line)
	if !strings.HasPrefix(cmd, "diagnose ") {
		return "", false
	}
	// A sentence, not a command. `strings.Contains(cmd, ".")` would be wrong here —
	// `diagnose sys checkused firewall.address.name` is a real command with two dots in it.
	if strings.HasSuffix(cmd, ".") || strings.Contains(cmd, ";") {
		return "", false
	}
	return cmd, true
}
