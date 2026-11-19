package services

import (
	"strings"
	"testing"
)

// The streamed tool call arrives as arbitrary slices of JSON text, so the buffer is almost never
// valid on its own. These cases are the mid-stream states that actually occur — each one must
// yield the fields written SO FAR, and must never panic or return garbage.
func TestParsePartialToolInput(t *testing.T) {
	cases := []struct {
		name        string
		buf         string
		wantMode    string
		wantCmds    []string
		wantExplain string
	}{
		{name: "empty", buf: ""},
		{name: "opening brace only", buf: `{`},
		{
			name:     "key with no value yet",
			buf:      `{"mode":"config","commands":`,
			wantMode: "config",
		},
		{
			name:     "dangling key name",
			buf:      `{"mode":"config","commands":["a"],"explanation"`,
			wantMode: "config",
			wantCmds: []string{"a"},
		},
		{
			name:     "half-written command string",
			buf:      `{"mode":"config","commands":["config firewall addr`,
			wantMode: "config",
			wantCmds: []string{"config firewall addr"},
		},
		{
			name:     "trailing comma inside array",
			buf:      `{"mode":"config","commands":["end",`,
			wantMode: "config",
			wantCmds: []string{"end"},
		},
		{
			name:     "dangling escape backslash",
			buf:      `{"mode":"config","commands":["set comment \`,
			wantMode: "config",
			wantCmds: []string{"set comment "},
		},
		{
			// Thai is 3 bytes per rune — a fragment boundary lands mid-rune and would otherwise
			// make the whole document invalid UTF-8.
			name:        "explanation cut mid-Thai-rune",
			buf:         `{"mode":"config","commands":[],"explanation":"สร้าง policy` + "\xe0\xb8",
			wantMode:    "config",
			wantCmds:    []string{},
			wantExplain: "สร้าง policy",
		},
		{
			name:        "complete document",
			buf:         `{"mode":"config","commands":["a","b"],"explanation":"เสร็จแล้ว","warning":""}`,
			wantMode:    "config",
			wantCmds:    []string{"a", "b"},
			wantExplain: "เสร็จแล้ว",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			mode, cmds, explain := parsePartialToolInput(tc.buf)
			if mode != tc.wantMode {
				t.Errorf("mode = %q, want %q", mode, tc.wantMode)
			}
			if explain != tc.wantExplain {
				t.Errorf("explanation = %q, want %q", explain, tc.wantExplain)
			}
			if strings.Join(cmds, "\n") != strings.Join(tc.wantCmds, "\n") {
				t.Errorf("commands = %q, want %q", cmds, tc.wantCmds)
			}
		})
	}
}

// The UI appends every delta, so the text the model produced must only ever GROW as fragments
// arrive. A parse that briefly went backwards would make the chat flicker or duplicate text.
func TestParsePartialToolInputGrowsMonotonically(t *testing.T) {
	full := `{"mode":"config","commands":["config firewall address","    edit \"LAN-192.168.50.0\"",` +
		`"        set subnet 192.168.50.0 255.255.255.0","    next","end"],` +
		`"explanation":"สร้าง address object และ policy สำหรับ LAN ออก Internet — ผลกระทบ: 192.168.50.0/24"}`

	var prevExp, prevCLI int
	// Feed one byte at a time — the worst case a fragment boundary can produce.
	for i := 1; i <= len(full); i++ {
		_, cmds, explain := parsePartialToolInput(full[:i])
		cli := strings.Join(cmds, "\n")
		if len(explain) < prevExp {
			t.Fatalf("explanation shrank at byte %d: %d → %d", i, prevExp, len(explain))
		}
		if len(cli) < prevCLI {
			t.Fatalf("cli shrank at byte %d: %d → %d", i, prevCLI, len(cli))
		}
		prevExp, prevCLI = len(explain), len(cli)
	}

	mode, cmds, explain := parsePartialToolInput(full)
	if mode != "config" || len(cmds) != 5 {
		t.Fatalf("final parse wrong: mode=%q cmds=%d", mode, len(cmds))
	}
	if !strings.Contains(explain, "ผลกระทบ") {
		t.Fatalf("final explanation lost its Thai text: %q", explain)
	}
}
