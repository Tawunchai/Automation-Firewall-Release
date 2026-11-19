package platform

import (
	"encoding/base64"
	"errors"
	"fmt"
	"mime"
	"net/smtp"
	"strings"

	"gorm.io/gorm"
	"network_automation/entity"
)

// The console's one outbound mail path.
//
// It used to be a single hard-coded smtp.SendMail inside SendOTPEmail, which was fine while OTP was
// the only thing that mailed anybody. Two features now need it — a report delivered as a PDF
// attachment, and an alert delivered as text — and neither could reuse a function whose body,
// subject and recipient were all decided by an OTP template.
//
// The account itself is unchanged: whatever row sits in send_emails (Service ▸ Email), authenticated
// against Gmail with an app password. That is one place to configure, and the OTP path still reads
// exactly the same row it always did.

// smtpHost / smtpAddr are Gmail's submission endpoint. The stored credential is a Gmail app
// password, so pointing this elsewhere would need the account model to change too — hence constants
// rather than half a configuration knob.
const (
	smtpHost = "smtp.gmail.com"
	smtpAddr = "smtp.gmail.com:587"
)

// ErrNoSMTPConfig is returned when nobody has configured the sending account yet.
//
// Distinguished from a send failure on purpose: "no mail account is set up" is a thing an admin can
// fix in thirty seconds on the Service page, and telling them that is more useful than a generic
// "could not send".
var ErrNoSMTPConfig = errors.New("no email account is configured — set one up under Service ▸ Email")

// MailAttachment is one file to hang off a message.
type MailAttachment struct {
	Filename    string
	ContentType string // "application/pdf"; defaults to application/octet-stream
	Data        []byte
}

// MailMessage is one outbound email.
type MailMessage struct {
	To          []string
	Subject     string
	HTMLBody    string
	Attachments []MailAttachment
}

// SMTPSender returns the configured From address, or ErrNoSMTPConfig.
//
// Exported so a caller can tell an admin "mail is not set up" BEFORE doing the expensive part —
// building a 40-page PDF and then discovering there is nowhere to send it is a poor trade.
func SMTPSender(db *gorm.DB) (string, error) {
	cfg, err := smtpConfig(db)
	if err != nil {
		return "", err
	}
	return cfg.Email, nil
}

func smtpConfig(db *gorm.DB) (entity.SendEmail, error) {
	var cfg entity.SendEmail
	if db == nil {
		return cfg, ErrNoSMTPConfig
	}
	if err := db.First(&cfg).Error; err != nil {
		return cfg, ErrNoSMTPConfig
	}
	if strings.TrimSpace(cfg.Email) == "" || strings.TrimSpace(cfg.PassAppEnc) == "" {
		return cfg, ErrNoSMTPConfig
	}
	// PassAppEnc is stored encrypted (services.EncryptSecret) going forward. DecryptSecret failing
	// is read as "this row predates encryption and is still plaintext" rather than an error, so a
	// row the startup backfill (config.migrateSendEmailPassAppEncryption) hasn't reached yet keeps
	// sending mail instead of breaking OTP/reports/alerts.
	if plain, err := DecryptSecret(cfg.PassAppEnc); err == nil {
		cfg.PassAppEnc = plain
	}
	return cfg, nil
}

// SendMail delivers one message through the configured account.
func SendMail(db *gorm.DB, msg MailMessage) error {
	cfg, err := smtpConfig(db)
	if err != nil {
		return err
	}

	to := cleanRecipients(msg.To)
	if len(to) == 0 {
		return errors.New("no recipient address given")
	}

	body, err := buildMailMIME(cfg.Email, to, msg)
	if err != nil {
		return err
	}

	return smtp.SendMail(
		smtpAddr,
		smtp.PlainAuth("", cfg.Email, cfg.PassAppEnc, smtpHost),
		cfg.Email,
		to,
		body,
	)
}

// cleanRecipients trims, drops blanks and de-duplicates.
//
// A duplicate address is not harmless: smtp.SendMail issues one RCPT TO per entry, so the same
// person receives the report twice and Gmail counts it twice against the daily cap.
func cleanRecipients(in []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(in))
	for _, raw := range in {
		addr := strings.TrimSpace(raw)
		if addr == "" {
			continue
		}
		key := strings.ToLower(addr)
		if seen[key] {
			continue
		}
		seen[key] = true
		out = append(out, addr)
	}
	return out
}

// buildMailMIME renders the whole message, headers and all.
//
// Separated from the send so the wire format can be tested without an SMTP server — which matters
// more than usual here, because the failure mode of a malformed MIME boundary is not an error but a
// delivered email showing base64 gibberish where the attachment should be.
func buildMailMIME(from string, to []string, msg MailMessage) ([]byte, error) {
	var b strings.Builder

	subject := strings.TrimSpace(msg.Subject)
	if subject == "" {
		subject = "(no subject)"
	}

	fmt.Fprintf(&b, "From: %s\r\n", from)
	fmt.Fprintf(&b, "To: %s\r\n", strings.Join(to, ", "))
	// Q-encoded, because a report title carries the device name and an alert carries the rule name,
	// and either may be non-ASCII. A raw 8-bit Subject line is silently mangled by some relays.
	fmt.Fprintf(&b, "Subject: %s\r\n", mime.QEncoding.Encode("UTF-8", subject))
	b.WriteString("MIME-Version: 1.0\r\n")

	if len(msg.Attachments) == 0 {
		b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
		b.WriteString(msg.HTMLBody)
		return []byte(b.String()), nil
	}

	// A fixed boundary would collide with a PDF that happens to contain the same bytes; this one is
	// derived from the payload so it cannot.
	boundary, err := mailBoundary()
	if err != nil {
		return nil, err
	}

	fmt.Fprintf(&b, "Content-Type: multipart/mixed; boundary=\"%s\"\r\n\r\n", boundary)
	fmt.Fprintf(&b, "--%s\r\n", boundary)
	b.WriteString("Content-Type: text/html; charset=UTF-8\r\n\r\n")
	b.WriteString(msg.HTMLBody)
	b.WriteString("\r\n")

	for _, att := range msg.Attachments {
		ctype := att.ContentType
		if ctype == "" {
			ctype = "application/octet-stream"
		}
		name := att.Filename
		if strings.TrimSpace(name) == "" {
			name = "attachment"
		}

		fmt.Fprintf(&b, "\r\n--%s\r\n", boundary)
		fmt.Fprintf(&b, "Content-Type: %s; name=\"%s\"\r\n", ctype, name)
		b.WriteString("Content-Transfer-Encoding: base64\r\n")
		fmt.Fprintf(&b, "Content-Disposition: attachment; filename=\"%s\"\r\n\r\n", name)
		b.WriteString(wrapBase64(att.Data))
		b.WriteString("\r\n")
	}

	fmt.Fprintf(&b, "\r\n--%s--\r\n", boundary)
	return []byte(b.String()), nil
}

// wrapBase64 encodes and folds at 76 characters, as RFC 2045 requires. Some relays reject or
// truncate a single multi-megabyte line, which turns a working PDF into a corrupt one.
func wrapBase64(data []byte) string {
	const lineLen = 76
	enc := base64.StdEncoding.EncodeToString(data)
	var b strings.Builder
	b.Grow(len(enc) + 2*(len(enc)/lineLen+1))
	for i := 0; i < len(enc); i += lineLen {
		end := i + lineLen
		if end > len(enc) {
			end = len(enc)
		}
		b.WriteString(enc[i:end])
		b.WriteString("\r\n")
	}
	return strings.TrimSuffix(b.String(), "\r\n")
}

func mailBoundary() (string, error) {
	suffix, err := RandomHex(16)
	if err != nil {
		return "", fmt.Errorf("could not build a MIME boundary: %w", err)
	}
	return "=_na_" + suffix, nil
}

// ── HTML shell ───────────────────────────────────────────────────────────────

// MailHTML wraps body content in the plain, table-free shell used by every non-OTP email this app
// sends. Deliberately minimal: an alert has to be readable in a notification preview on a phone,
// and mail clients strip most of what makes a page look designed anyway.
func MailHTML(title, intro string, lines []string, footer string) string {
	var b strings.Builder
	b.WriteString(`<!DOCTYPE html><html><head><meta charset="UTF-8"></head>`)
	b.WriteString(`<body style="margin:0;padding:24px;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif">`)
	b.WriteString(`<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;padding:26px 28px;box-shadow:0 2px 14px rgba(15,23,42,.08)">`)
	fmt.Fprintf(&b, `<h1 style="margin:0 0 6px;font-size:17px;color:#0f172a">%s</h1>`, escapeHTML(title))
	if intro != "" {
		fmt.Fprintf(&b, `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#475569">%s</p>`, escapeHTML(intro))
	}
	if len(lines) > 0 {
		b.WriteString(`<div style="border-top:1px solid #e2e8f0;padding-top:14px">`)
		for _, line := range lines {
			fmt.Fprintf(&b, `<p style="margin:0 0 7px;font-size:13px;line-height:1.6;color:#0f172a">%s</p>`, escapeHTML(line))
		}
		b.WriteString(`</div>`)
	}
	if footer != "" {
		fmt.Fprintf(&b, `<p style="margin:18px 0 0;font-size:11px;color:#94a3b8">%s</p>`, escapeHTML(footer))
	}
	b.WriteString(`</div></body></html>`)
	return b.String()
}

// escapeHTML keeps a device name or a FortiOS error message from breaking the markup around it.
var htmlEscaper = strings.NewReplacer(
	"&", "&amp;",
	"<", "&lt;",
	">", "&gt;",
	`"`, "&quot;",
)

func escapeHTML(s string) string { return htmlEscaper.Replace(s) }
