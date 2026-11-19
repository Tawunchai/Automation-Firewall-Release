package services

import (
	"bufio"
	"errors"
	"fmt"
	"io"
	"net"
	"network_automation/services/platform"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// An interactive shell on a network device — the thing behind Config Deploy's terminal.
//
// WHY THIS EXISTS
// The terminal used to run every command through the batch pipeline: POST a config-deploy row →
// LPUSH to Redis → the Python worker BRPOPs it, opens a NEW SSH connection, runs the one command,
// disconnects → POSTs the result back → the browser, which had been polling every 800 ms, finally
// sees it. Measured against the lab FortiGate that is **4.58 seconds for `get system status`**, and
// the cost is almost entirely structural: a TCP+SSH handshake and an authentication per keystroke-
// line, plus half a poll interval of pure waiting.
//
// It also could not behave like a terminal even in principle. Every command ran in a fresh login,
// so nothing that depends on session state worked: `config firewall policy` followed by `edit 1`
// arrived as two unrelated logins, the second one at the root prompt. Tab-completion and `?` help
// need the device to answer mid-line, which a run-once-and-disconnect model cannot express at all.
//
// So an interactive session is what this is: ONE connection, opened once, held open, with the
// device's output streamed as it arrives. The batch pipeline still exists and is still right for
// what it was built for — pushing a config script to many devices at once, recorded and audited.
// This is the other thing, and it needed to be a different mechanism rather than a faster one.
//
// SSH AND TELNET
// Both, because the devices this runs against are reached both ways and telnet is the common case
// on this lab. They differ only in how the byte stream is obtained; everything above that — the
// read pump, the buffering, the lifecycle — is shared.

// Proto is the transport an interactive session runs over.
type Proto string

const (
	ProtoSSH    Proto = "ssh"
	ProtoTelnet Proto = "telnet"
)

// ParseProto validates a caller-supplied protocol, defaulting to SSH.
//
// SSH is the default because it is the one that works on an unmodified FortiGate — it is in the
// factory `allowaccess`, telnet is not — so an omitted parameter lands on the protocol that
// usually connects rather than one that usually times out. It also matches the UI's default, which
// matters: two different defaults for the same choice is a bug waiting to be filed.
//
// An UNRECOGNISED value is still an error rather than a fallback. Silently connecting over the
// other protocol than the caller named fails confusingly on a device that has only one of them
// enabled, which is most of them.
func ParseProto(s string) (Proto, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "", "ssh":
		return ProtoSSH, nil
	case "telnet":
		return ProtoTelnet, nil
	default:
		return "", fmt.Errorf("unknown protocol %q (want ssh or telnet)", s)
	}
}

// DefaultPort is the port for a protocol when the device record does not pin one.
func (p Proto) DefaultPort() int {
	if p == ProtoSSH {
		return 22
	}
	return 23
}

const (
	// terminalIdleTimeout closes a session nobody is typing into. FortiOS has its own
	// `admintimeout` (5 minutes on the lab device) and will drop us anyway; closing first means the
	// browser gets a clean "session closed" rather than a stalled read.
	terminalIdleTimeout = 4 * time.Minute

	// terminalDialTimeout bounds the connect. A management port that is simply not in the
	// interface's `allowaccess` is DROPPED rather than refused, so there is no fast failure to
	// wait for — the whole timeout elapses. Eight seconds is long enough for a slow WAN link and
	// short enough that "this protocol is not enabled" is learned quickly, which is the common
	// case when someone picks the wrong one of telnet/SSH.
	terminalDialTimeout = 8 * time.Second

	// readChunk is the read buffer. Device output arrives in bursts (a `show full-configuration` is
	// ~33k lines); reading in 4 KB chunks and forwarding each one keeps output flowing to the
	// screen instead of arriving as one block at the end.
	readChunk = 4096
)

// Session is one open shell.
//
// Output is delivered on Out as it arrives — the caller (the WebSocket handler) forwards each chunk
// straight to the browser. Nothing here waits for a prompt: prompt detection is what made the old
// pipeline drop output whose prompt pattern did not match, and a terminal does not need it. The
// bytes the device sends are the bytes the user should see, in the order it sent them.
type Session struct {
	Proto  Proto
	Device string // hostname:port, for logs and the UI's status line

	// Out carries device output. Closed when the session ends, which is how the caller learns the
	// far end went away.
	Out chan []byte

	mu     sync.Mutex
	closed bool

	w      io.Writer
	closer func() error

	// lastUse drives the idle timeout.
	lastUse time.Time
}

// Write sends input to the device.
//
// Sent verbatim, including control characters: a terminal has to be able to deliver Tab (0x09) for
// completion, "?" for context help, and Ctrl+C (0x03) to abort a running command. Rewriting or
// line-buffering input here is what would break those.
func (s *Session) Write(p []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return errors.New("session is closed")
	}
	s.lastUse = time.Now()
	_, err := s.w.Write(p)
	return err
}

// Close ends the session. Safe to call more than once — both the idle reaper and the WebSocket
// handler's cleanup will.
func (s *Session) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	closer := s.closer
	s.mu.Unlock()

	if closer != nil {
		_ = closer()
	}
}

func (s *Session) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *Session) idleFor() time.Duration {
	s.mu.Lock()
	defer s.mu.Unlock()
	return time.Since(s.lastUse)
}

// pump copies device output onto Out until the connection ends, then closes Out.
//
// Each read is forwarded immediately rather than accumulated. That is the whole difference between
// `show full-configuration` painting as it arrives and appearing to hang for several seconds — and
// on a slow link it is the difference between "working" and "frozen".
func (s *Session) pump(r io.Reader) {
	defer close(s.Out)
	buf := make([]byte, readChunk)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			select {
			case s.Out <- chunk:
			case <-time.After(5 * time.Second):
				// The consumer is gone or wedged. Dropping the session beats blocking this
				// goroutine on a channel nobody reads.
				s.Close()
				return
			}
		}
		if err != nil {
			s.Close()
			return
		}
	}
}

// watchIdle closes a session that has gone quiet, so a forgotten browser tab does not hold an admin
// session open on the firewall — which matters here, because FortiOS counts concurrent admin
// logins and this console also keeps a pooled REST session per device.
func (s *Session) watchIdle() {
	t := time.NewTicker(30 * time.Second)
	defer t.Stop()
	for range t.C {
		if s.isClosed() {
			return
		}
		if s.idleFor() > terminalIdleTimeout {
			s.Close()
			return
		}
	}
}

// ── SSH ──────────────────────────────────────────────────────────────────────

// openSSHSession starts an interactive SSH shell with a PTY.
//
// The PTY is what makes it a terminal rather than an exec channel: without one FortiOS gives no
// prompt, no echo, and no tab-completion, and `?` prints nothing.
func openSSHSession(host string, port int, username, password string) (*Session, error) {
	cfg := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.Password(password),
			// FortiOS asks for the password as a keyboard-interactive challenge on some builds;
			// offering both means one config works against either.
			ssh.KeyboardInteractive(func(_, _ string, questions []string, _ []bool) ([]string, error) {
				answers := make([]string, len(questions))
				for i := range questions {
					answers[i] = password
				}
				return answers, nil
			}),
		},
		// Pinned on first use. This is the connection that matters most: it carries an interactive
		// administrator session, so anything that could impersonate the firewall here would be
		// handed the password and then watch everything typed at the prompt.
		//
		// Self-signed keys were the reason this used to be unchecked; they are in fact the reason to
		// pin. Nobody can verify the FIRST key — every one after it can be checked against it.
		// See services/sshhostkey.go.
		HostKeyCallback: platform.VerifyOrPinHostKey(host),
		// Asked for explicitly so this half and the Python worker pin the SAME key of a
		// device that has several — see PreferredHostKeyAlgorithms.
		HostKeyAlgorithms: platform.PreferredHostKeyAlgorithms,
		Timeout:           terminalDialTimeout,
		// FortiOS 7.2 still offers these; Go's defaults exclude them.
		Config: ssh.Config{
			KeyExchanges: []string{
				"curve25519-sha256", "curve25519-sha256@libssh.org",
				"ecdh-sha2-nistp256", "ecdh-sha2-nistp384", "ecdh-sha2-nistp521",
				"diffie-hellman-group14-sha256", "diffie-hellman-group14-sha1",
			},
			Ciphers: []string{
				"aes128-gcm@openssh.com", "aes256-gcm@openssh.com",
				"aes128-ctr", "aes192-ctr", "aes256-ctr",
			},
		},
	}

	addr := net.JoinHostPort(host, strconv.Itoa(port))
	client, err := ssh.Dial("tcp", addr, cfg)
	if err != nil {
		return nil, fmt.Errorf("ssh dial %s: %w", addr, err)
	}

	sess, err := client.NewSession()
	if err != nil {
		_ = client.Close()
		return nil, fmt.Errorf("ssh session: %w", err)
	}

	// ECHO on: the device echoes what is typed, exactly as a real terminal client sees it, so the
	// browser does not have to guess what its own input looked like.
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
	if err := sess.RequestPty("xterm", 40, 120, modes); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("request pty: %w", err)
	}

	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("stdin: %w", err)
	}
	stdout, err := sess.StdoutPipe()
	if err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("stdout: %w", err)
	}
	// Merge stderr into the same stream: on a CLI, an error message belongs in the transcript at
	// the point it happened, not in a separate channel the UI would have to interleave.
	stderr, _ := sess.StderrPipe()

	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		_ = client.Close()
		return nil, fmt.Errorf("start shell: %w", err)
	}

	s := &Session{
		Proto:   ProtoSSH,
		Device:  addr,
		Out:     make(chan []byte, 64),
		w:       stdin,
		lastUse: time.Now(),
		closer: func() error {
			_ = sess.Close()
			return client.Close()
		},
	}
	go s.pump(io.MultiReader(stdout, stderr))
	go s.watchIdle()
	return s, nil
}

// ── Telnet ───────────────────────────────────────────────────────────────────

// Telnet protocol bytes (RFC 854 / 855).
const (
	telnetIAC  = 255 // Interpret As Command — introduces an option negotiation
	telnetDONT = 254
	telnetDO   = 253
	telnetWONT = 252
	telnetWILL = 251
	telnetSB   = 250 // subnegotiation begin
	telnetSE   = 240 // subnegotiation end
)

// telnetConn strips option negotiation out of the byte stream and answers it.
//
// This is why telnet cannot be a plain net.Conn: the device opens by negotiating options, and those
// IAC sequences are IN BAND. Passing them through paints stray glyphs across the terminal; ignoring
// them entirely leaves the device waiting for an answer it never gets, which looks exactly like a
// hung connection.
//
// The policy is the simplest one that works: refuse everything. Answer every WILL with DONT and
// every DO with WONT. FortiOS then runs a plain line-oriented session, which is what the CLI is.
type telnetConn struct {
	c   net.Conn
	br  *bufio.Reader
	mu  sync.Mutex // serialises our negotiation replies against the caller's writes
	buf []byte     // carries decoded data between Read calls
}

func newTelnetConn(c net.Conn) *telnetConn {
	return &telnetConn{c: c, br: bufio.NewReaderSize(c, readChunk)}
}

func (t *telnetConn) reply(b ...byte) {
	t.mu.Lock()
	defer t.mu.Unlock()
	_, _ = t.c.Write(b)
}

// Read returns device output with all IAC sequences consumed and answered.
func (t *telnetConn) Read(p []byte) (int, error) {
	out := t.buf[:0]
	if cap(out) < len(p) {
		out = make([]byte, 0, len(p))
	}

	for len(out) < len(p) {
		b, err := t.br.ReadByte()
		if err != nil {
			if len(out) > 0 {
				n := copy(p, out)
				t.buf = out[:0]
				return n, nil
			}
			return 0, err
		}

		if b != telnetIAC {
			out = append(out, b)
			// Return what we have rather than filling the buffer: waiting for more would hold a
			// prompt back until the next byte arrives, which is the whole of "the terminal feels
			// laggy".
			if t.br.Buffered() == 0 {
				break
			}
			continue
		}

		// IAC — decide what follows.
		cmd, err := t.br.ReadByte()
		if err != nil {
			break
		}
		switch cmd {
		case telnetIAC:
			// Escaped 0xFF: a literal byte, not a command.
			out = append(out, telnetIAC)
		case telnetWILL, telnetWONT, telnetDO, telnetDONT:
			opt, err := t.br.ReadByte()
			if err != nil {
				break
			}
			// Refuse everything, in the direction the peer asked about.
			if cmd == telnetWILL || cmd == telnetWONT {
				t.reply(telnetIAC, telnetDONT, opt)
			} else {
				t.reply(telnetIAC, telnetWONT, opt)
			}
		case telnetSB:
			// Skip the subnegotiation payload up to IAC SE. We agreed to no options, so there is
			// nothing here we need.
			for {
				x, err := t.br.ReadByte()
				if err != nil {
					break
				}
				if x == telnetIAC {
					y, err := t.br.ReadByte()
					if err != nil || y == telnetSE {
						break
					}
				}
			}
		default:
			// A two-byte command with no option (NOP, GA, …). Nothing to answer.
		}
	}

	n := copy(p, out)
	if n < len(out) {
		t.buf = append(t.buf[:0], out[n:]...)
	} else {
		t.buf = t.buf[:0]
	}
	if n == 0 {
		// Nothing decoded this round (pure negotiation). Read again rather than reporting EOF.
		return t.Read(p)
	}
	return n, nil
}

func (t *telnetConn) Write(p []byte) (int, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	// A literal 0xFF in user input must be doubled, or the device reads it as IAC. Rare in CLI
	// text, but cheap to be correct about.
	if idx := indexByte(p, telnetIAC); idx >= 0 {
		esc := make([]byte, 0, len(p)+4)
		for _, b := range p {
			esc = append(esc, b)
			if b == telnetIAC {
				esc = append(esc, telnetIAC)
			}
		}
		if _, err := t.c.Write(esc); err != nil {
			return 0, err
		}
		return len(p), nil
	}
	return t.c.Write(p)
}

func indexByte(p []byte, b byte) int {
	for i := range p {
		if p[i] == b {
			return i
		}
	}
	return -1
}

// openTelnetSession connects over telnet and logs in.
//
// Unlike SSH there is no authentication in the protocol: the device prompts for a username and a
// password as ordinary text, and a client answers by writing them into the stream. So the login is
// done here, by watching for the prompts, before the session is handed over.
func openTelnetSession(host string, port int, username, password string) (*Session, error) {
	addr := net.JoinHostPort(host, strconv.Itoa(port))
	conn, err := net.DialTimeout("tcp", addr, terminalDialTimeout)
	if err != nil {
		return nil, fmt.Errorf("telnet dial %s: %w", addr, err)
	}

	tc := newTelnetConn(conn)

	// Answer the login prompts. A failure here is reported as a connect failure rather than left
	// for the user to discover from a screen that never reaches a prompt.
	if err := telnetLogin(conn, tc, username, password); err != nil {
		_ = conn.Close()
		return nil, err
	}

	s := &Session{
		Proto:   ProtoTelnet,
		Device:  addr,
		Out:     make(chan []byte, 64),
		w:       tc,
		lastUse: time.Now(),
		closer:  conn.Close,
	}
	go s.pump(tc)
	go s.watchIdle()
	return s, nil
}

// telnetLogin waits for the username and password prompts and answers them.
//
// Matching is on a lower-cased suffix of what has arrived so far, because the device sends the
// prompt without a trailing newline — waiting for a line would wait forever.
func telnetLogin(conn net.Conn, tc *telnetConn, username, password string) error {
	_ = conn.SetReadDeadline(time.Now().Add(terminalDialTimeout))
	defer conn.SetReadDeadline(time.Time{}) //nolint:errcheck

	var seen strings.Builder
	buf := make([]byte, readChunk)
	sentUser, sentPass := false, false

	for {
		n, err := tc.Read(buf)
		if n > 0 {
			seen.Write(buf[:n])
			low := strings.ToLower(seen.String())

			// `seen` accumulates rather than being cleared after each answer. A device that
			// pipelines — sending "login:" and "Password:" in the same TCP segment, which happens
			// over a fast link — would otherwise have its password prompt discarded along with the
			// buffer, and the login would then wait forever for a prompt that had already arrived.
			// Each step is gated by its own sent* flag instead, so re-reading old text is harmless.
			if !sentUser && hasLoginPrompt(low) {
				if _, err := tc.Write([]byte(username + "\r\n")); err != nil {
					return fmt.Errorf("telnet: sending username: %w", err)
				}
				sentUser = true
			}
			if sentUser && !sentPass && strings.Contains(low, "password") {
				if _, err := tc.Write([]byte(password + "\r\n")); err != nil {
					return fmt.Errorf("telnet: sending password: %w", err)
				}
				sentPass = true
				// Cleared only here, so the checks below read the device's answer to the password
				// rather than the prompts that came before it.
				seen.Reset()
				continue
			}
			if sentPass {
				// FortiOS answers a bad password with "Login incorrect" and re-prompts. Detecting
				// it here turns a terminal that silently never works into a clear error.
				if strings.Contains(low, "login incorrect") || strings.Contains(low, "authentication failed") {
					return errors.New("telnet: authentication failed (check the device credentials)")
				}
				// A prompt character means we are in.
				if strings.ContainsAny(low, "#$>") {
					return nil
				}
			}
		}
		if err != nil {
			if sentPass {
				// Logged in, and the read deadline expired waiting for a prompt we may already
				// have consumed. Let the session proceed rather than failing a working login.
				return nil
			}
			return fmt.Errorf("telnet: no login prompt from device: %w", err)
		}
	}
}

// hasLoginPrompt matches the several spellings devices use.
func hasLoginPrompt(lowered string) bool {
	for _, p := range []string{"login:", "username:", "user name:", "login as:"} {
		if strings.Contains(lowered, p) {
			return true
		}
	}
	return false
}

// OpenSession dials whichever protocol was asked for.
func OpenSession(p Proto, host string, port int, username, password string) (*Session, error) {
	if p == ProtoSSH {
		return openSSHSession(host, port, username, password)
	}
	return openTelnetSession(host, port, username, password)
}
