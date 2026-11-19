package services

import (
	"bytes"
	"io"
	"net"
	"strings"
	"testing"
	"time"
)

// The telnet decoder and the protocol plumbing behind the Config Deploy terminal.
//
// The decoder is the part that fails invisibly. Telnet option negotiation is IN BAND: the device
// opens the connection by sending IAC sequences mixed into the same byte stream as the CLI banner.
// Get it wrong in one direction and stray 0xFF bytes paint garbage across the terminal; get it
// wrong in the other and the device sits waiting for an answer it never receives, which on screen
// is indistinguishable from a hung connection. Neither produces an error anywhere.

// pipeConn is an in-memory net.Conn: what the "device" sends is what the decoder reads, and what
// the decoder writes back is captured for inspection. No device required.
//
// `stages` models the request/response shape of a login. A telnet device does not dump its whole
// conversation at once — it prints "login:", waits for a line, prints "Password:", waits again. So
// each stage is released only after the client writes something, which is what makes a login test
// mean anything: a client that never sends a username simply never sees the password prompt.
type pipeConn struct {
	fromDevice *bytes.Reader
	stages     [][]byte
	toDevice   bytes.Buffer
	closed     bool
}

func newPipe(deviceSays []byte) *pipeConn {
	return &pipeConn{fromDevice: bytes.NewReader(deviceSays)}
}

// newStagedPipe serves stages[0] first, then one further stage per client write.
func newStagedPipe(stages ...[]byte) *pipeConn {
	if len(stages) == 0 {
		return &pipeConn{fromDevice: bytes.NewReader(nil)}
	}
	return &pipeConn{fromDevice: bytes.NewReader(stages[0]), stages: stages[1:]}
}

func (p *pipeConn) Read(b []byte) (int, error) { return p.fromDevice.Read(b) }
func (p *pipeConn) Write(b []byte) (int, error) {
	n, err := p.toDevice.Write(b)
	// The client answered, so the device may say its next thing.
	if len(p.stages) > 0 {
		p.fromDevice = bytes.NewReader(p.stages[0])
		p.stages = p.stages[1:]
	}
	return n, err
}
func (p *pipeConn) Close() error                     { p.closed = true; return nil }
func (p *pipeConn) LocalAddr() net.Addr              { return dummyAddr{} }
func (p *pipeConn) RemoteAddr() net.Addr             { return dummyAddr{} }
func (p *pipeConn) SetDeadline(time.Time) error      { return nil }
func (p *pipeConn) SetReadDeadline(time.Time) error  { return nil }
func (p *pipeConn) SetWriteDeadline(time.Time) error { return nil }

type dummyAddr struct{}

func (dummyAddr) Network() string { return "pipe" }
func (dummyAddr) String() string  { return "pipe" }

// readAll drains the decoder until EOF, which is what the session's pump does.
func readAll(t *testing.T, tc *telnetConn) string {
	t.Helper()
	var out bytes.Buffer
	buf := make([]byte, 64)
	for i := 0; i < 1000; i++ {
		n, err := tc.Read(buf)
		out.Write(buf[:n])
		if err != nil {
			break
		}
	}
	return out.String()
}

// ── Decoding ─────────────────────────────────────────────────────────────────

func TestTelnetPassesPlainTextThrough(t *testing.T) {
	tc := newTelnetConn(newPipe([]byte("NGFW-Testing # ")))
	if got := readAll(t, tc); got != "NGFW-Testing # " {
		t.Errorf("got %q, want the prompt unchanged", got)
	}
}

func TestTelnetStripsNegotiationFromTheOutput(t *testing.T) {
	// A real FortiOS telnet opening: negotiate, then the banner. None of the IAC bytes may reach
	// the screen.
	device := []byte{
		telnetIAC, telnetDO, 24, // DO TERMINAL-TYPE
		telnetIAC, telnetWILL, 3, // WILL SUPPRESS-GO-AHEAD
	}
	device = append(device, []byte("FortiGate-80E login: ")...)

	tc := newTelnetConn(newPipe(device))
	got := readAll(t, tc)

	if got != "FortiGate-80E login: " {
		t.Errorf("got %q, want only the banner", got)
	}
	if strings.ContainsRune(got, 0xFF) {
		t.Error("an IAC byte leaked into the terminal output")
	}
}

func TestTelnetAnswersEveryNegotiation(t *testing.T) {
	// Silence is what hangs the session: the device waits for a reply before sending the login
	// prompt. The policy is to refuse everything, but it must actually SAY so.
	p := newPipe([]byte{
		telnetIAC, telnetWILL, 1, // device offers ECHO      → we must answer DONT
		telnetIAC, telnetDO, 31, // device asks us to do NAWS → we must answer WONT
	})
	tc := newTelnetConn(p)
	_ = readAll(t, tc)

	want := []byte{
		telnetIAC, telnetDONT, 1,
		telnetIAC, telnetWONT, 31,
	}
	if got := p.toDevice.Bytes(); !bytes.Equal(got, want) {
		t.Errorf("replies = % x, want % x", got, want)
	}
}

func TestTelnetUnescapesADoubledIAC(t *testing.T) {
	// 0xFF 0xFF in the stream is a literal 0xFF byte, not a command. Treating it as one would eat
	// the next byte of real output.
	tc := newTelnetConn(newPipe([]byte{'a', telnetIAC, telnetIAC, 'b'}))
	got := readAll(t, tc)
	if got != string([]byte{'a', 0xFF, 'b'}) {
		t.Errorf("got % x, want 61 ff 62", []byte(got))
	}
}

func TestTelnetSkipsSubnegotiation(t *testing.T) {
	// A subnegotiation payload can contain any byte, including ones that look like commands. It
	// runs until IAC SE and none of it is output.
	device := []byte{telnetIAC, telnetSB, 24, 0, 'V', 'T', '2', '2', '0', telnetIAC, telnetSE}
	device = append(device, []byte("ready")...)

	tc := newTelnetConn(newPipe(device))
	if got := readAll(t, tc); got != "ready" {
		t.Errorf("got %q, want %q — subnegotiation payload leaked", got, "ready")
	}
}

func TestTelnetHandlesNegotiationSplitAcrossReads(t *testing.T) {
	// The decoder buffers its own reader, so a sequence that arrives in pieces (a slow link, a
	// small MTU) must still be reassembled rather than half-printed.
	full := append([]byte{telnetIAC, telnetDO, 24}, []byte("prompt # ")...)
	tc := newTelnetConn(newPipe(full))

	var out bytes.Buffer
	one := make([]byte, 1) // one byte at a time — the worst case
	for {
		n, err := tc.Read(one)
		out.Write(one[:n])
		if err != nil {
			break
		}
	}
	if out.String() != "prompt # " {
		t.Errorf("got %q, want %q", out.String(), "prompt # ")
	}
}

func TestTelnetDoesNotReportEOFForPureNegotiation(t *testing.T) {
	// A read that decodes to zero data bytes must not look like end-of-stream, or the session
	// would close the moment a device opened with negotiation alone.
	tc := newTelnetConn(newPipe([]byte{telnetIAC, telnetDO, 24, 'x'}))
	buf := make([]byte, 16)
	n, err := tc.Read(buf)
	if err != nil {
		t.Fatalf("Read returned %v for a stream that still had data", err)
	}
	if n != 1 || buf[0] != 'x' {
		t.Errorf("got % x (n=%d), want 78", buf[:n], n)
	}
}

// ── Encoding ─────────────────────────────────────────────────────────────────

func TestTelnetEscapesALiteralIACOnTheWayOut(t *testing.T) {
	// A 0xFF the user types must reach the device as 0xFF 0xFF, or the device reads it as the start
	// of a command and swallows what follows.
	p := newPipe(nil)
	tc := newTelnetConn(p)
	if _, err := tc.Write([]byte{'a', 0xFF, 'b'}); err != nil {
		t.Fatal(err)
	}
	want := []byte{'a', 0xFF, 0xFF, 'b'}
	if got := p.toDevice.Bytes(); !bytes.Equal(got, want) {
		t.Errorf("wrote % x, want % x", got, want)
	}
}

func TestTelnetWriteReportsTheCallersLength(t *testing.T) {
	// io.Writer's contract is bytes-of-p consumed. Returning the escaped length would make callers
	// think a short write happened.
	p := newPipe(nil)
	tc := newTelnetConn(p)
	in := []byte{0xFF, 0xFF}
	n, err := tc.Write(in)
	if err != nil {
		t.Fatal(err)
	}
	if n != len(in) {
		t.Errorf("n = %d, want %d (the caller's length, not the escaped one)", n, len(in))
	}
}

func TestTelnetWritesOrdinaryInputUntouched(t *testing.T) {
	// Control characters are the whole point of a terminal: Tab completes, "?" asks for help,
	// Ctrl+C aborts. None may be rewritten on the way out.
	p := newPipe(nil)
	tc := newTelnetConn(p)
	in := []byte("show system interface\t?\x03\r\n")
	if _, err := tc.Write(in); err != nil {
		t.Fatal(err)
	}
	if got := p.toDevice.Bytes(); !bytes.Equal(got, in) {
		t.Errorf("wrote %q, want it unchanged", got)
	}
}

// ── Login ────────────────────────────────────────────────────────────────────

func TestTelnetLoginAnswersBothPrompts(t *testing.T) {
	// Telnet has no authentication in the protocol — the device asks in plain text and a client
	// types the answer. Getting the order or the trigger wrong leaves a session that never reaches
	// a prompt, with no error to explain why.
	device := []byte("\r\nFortiGate-80E login: ")
	device = append(device, []byte("Password: ")...)
	device = append(device, []byte("\r\nNGFW-Testing # ")...)

	p := newPipe(device)
	tc := newTelnetConn(p)
	if err := telnetLogin(p, tc, "admin", "secret"); err != nil {
		t.Fatalf("login failed: %v", err)
	}
	sent := p.toDevice.String()
	if !strings.Contains(sent, "admin\r\n") {
		t.Errorf("username was not sent (sent %q)", sent)
	}
	if !strings.Contains(sent, "secret\r\n") {
		t.Errorf("password was not sent (sent %q)", sent)
	}
	if strings.Index(sent, "admin") > strings.Index(sent, "secret") {
		t.Error("password was sent before the username")
	}
}

func TestTelnetLoginReportsBadCredentials(t *testing.T) {
	// FortiOS answers a wrong password with "Login incorrect" and prompts again. Without this the
	// user gets a terminal that simply never works.
	p := newStagedPipe(
		[]byte("login: "),
		[]byte("Password: "),
		[]byte("\r\nLogin incorrect\r\nlogin: "), // the device's answer to a wrong password
	)
	tc := newTelnetConn(p)

	err := telnetLogin(p, tc, "admin", "wrong")
	if err == nil {
		t.Fatal("a rejected login was reported as success")
	}
	if !strings.Contains(err.Error(), "authentication failed") {
		t.Errorf("error = %q, want it to name the cause", err)
	}
}

func TestHasLoginPromptMatchesTheCommonSpellings(t *testing.T) {
	for _, s := range []string{"login: ", "username: ", "user name: ", "login as: "} {
		if !hasLoginPrompt(s) {
			t.Errorf("%q not recognised as a login prompt", s)
		}
	}
	for _, s := range []string{"password: ", "ngfw # ", ""} {
		if hasLoginPrompt(s) {
			t.Errorf("%q wrongly treated as a login prompt", s)
		}
	}
}

// ── Protocol selection ───────────────────────────────────────────────────────

func TestParseProtoDefaultsToSSH(t *testing.T) {
	// SSH is in a FortiGate's factory `allowaccess` and telnet is not, so an absent parameter must
	// land on the protocol that actually connects. It also has to agree with the UI's default —
	// two defaults for one choice is its own bug.
	for _, in := range []string{"", "ssh", "SSH", " Ssh "} {
		got, err := ParseProto(in)
		if err != nil || got != ProtoSSH {
			t.Errorf("ParseProto(%q) = %v, %v; want ssh", in, got, err)
		}
	}
}

func TestParseProtoAcceptsTelnet(t *testing.T) {
	for _, in := range []string{"telnet", "TELNET", " Telnet "} {
		got, err := ParseProto(in)
		if err != nil || got != ProtoTelnet {
			t.Errorf("ParseProto(%q) = %v, %v; want telnet", in, got, err)
		}
	}
}

func TestParseProtoRejectsAnythingElse(t *testing.T) {
	// Falling back to a default here would connect over a protocol the caller did not ask for,
	// which on a device with only one of them enabled fails in a confusing way.
	if _, err := ParseProto("rlogin"); err == nil {
		t.Error("an unknown protocol was accepted")
	}
}

func TestDefaultPortMatchesTheProtocol(t *testing.T) {
	if ProtoSSH.DefaultPort() != 22 {
		t.Errorf("ssh default port = %d, want 22", ProtoSSH.DefaultPort())
	}
	if ProtoTelnet.DefaultPort() != 23 {
		t.Errorf("telnet default port = %d, want 23", ProtoTelnet.DefaultPort())
	}
}

// ── Session lifecycle ────────────────────────────────────────────────────────

func TestSessionWriteFailsAfterClose(t *testing.T) {
	// A write to a closed session must error rather than panic on a nil writer — the WebSocket
	// handler turns that error into a message the user can see.
	s := &Session{Out: make(chan []byte, 1), w: io.Discard, lastUse: time.Now()}
	s.Close()
	if err := s.Write([]byte("x")); err == nil {
		t.Error("writing to a closed session succeeded")
	}
}

func TestSessionCloseIsIdempotent(t *testing.T) {
	// Both the idle reaper and the socket handler's cleanup call Close; the second must not panic
	// on an already-closed connection.
	closes := 0
	s := &Session{Out: make(chan []byte, 1), w: io.Discard, closer: func() error { closes++; return nil }}
	s.Close()
	s.Close()
	if closes != 1 {
		t.Errorf("underlying connection closed %d times, want 1", closes)
	}
}

func TestSessionPumpForwardsAndClosesOut(t *testing.T) {
	// Output has to arrive in chunks as it is read, not accumulated — that is the difference
	// between a long `show full-configuration` painting as it comes and appearing to hang. And Out
	// must close when the device goes away, which is how the handler learns to tell the browser.
	s := &Session{Out: make(chan []byte, 8), w: io.Discard, lastUse: time.Now()}
	go s.pump(strings.NewReader("hello world"))

	var got []byte
	for chunk := range s.Out {
		got = append(got, chunk...)
	}
	if string(got) != "hello world" {
		t.Errorf("received %q, want %q", got, "hello world")
	}
	if !s.isClosed() {
		t.Error("the session did not close itself when the reader ended")
	}
}

func TestTelnetLoginHandlesAPipelinedDevice(t *testing.T) {
	// A device on a fast link can put "login:" and "Password:" in the same segment. An earlier
	// version cleared its buffer after answering the username, threw the password prompt away with
	// it, and then waited for a prompt that had already been and gone — a login that hung with no
	// error anywhere. This is that case.
	p := newStagedPipe(
		[]byte("\r\nFortiGate-80E login: Password: "), // both prompts, one read
		[]byte("\r\nNGFW-Testing # "),
	)
	tc := newTelnetConn(p)
	if err := telnetLogin(p, tc, "admin", "secret"); err != nil {
		t.Fatalf("pipelined login failed: %v", err)
	}
	if sent := p.toDevice.String(); !strings.Contains(sent, "admin\r\n") || !strings.Contains(sent, "secret\r\n") {
		t.Errorf("sent %q, want both the username and the password", sent)
	}
}
