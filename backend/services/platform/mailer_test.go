package platform

import (
	"encoding/base64"
	"mime"
	"mime/multipart"
	"strings"
	"testing"
)

// The mailer.
//
// The failure mode this guards is not an error — it is a delivered email showing base64 gibberish
// where a report should be, which is discovered by the person it was sent to. So the message is
// parsed back with the standard library's own MIME reader rather than checked with string matching:
// if mime/multipart can read it, so can a mail client.

func TestBuildMailMIME_PlainMessageIsHTML(t *testing.T) {
	raw, err := buildMailMIME("from@example.com", []string{"a@example.com"}, MailMessage{
		Subject: "Hello", HTMLBody: "<p>hi</p>",
	})
	if err != nil {
		t.Fatalf("buildMailMIME: %v", err)
	}
	s := string(raw)

	for _, want := range []string{
		"From: from@example.com\r\n",
		"To: a@example.com\r\n",
		"MIME-Version: 1.0\r\n",
		"Content-Type: text/html; charset=UTF-8\r\n",
		"<p>hi</p>",
	} {
		if !strings.Contains(s, want) {
			t.Errorf("message is missing %q:\n%s", want, s)
		}
	}
	if strings.Contains(s, "multipart") {
		t.Errorf("a message with no attachment was built as multipart")
	}
}

// A report title carries the device name, which may be non-ASCII. A raw 8-bit Subject line is
// mangled by some relays, so it has to be encoded.
func TestBuildMailMIME_EncodesANonASCIISubject(t *testing.T) {
	const subject = "รายงานความปลอดภัย — FGT-LAB"

	raw, err := buildMailMIME("f@x.io", []string{"a@x.io"}, MailMessage{Subject: subject})
	if err != nil {
		t.Fatalf("buildMailMIME: %v", err)
	}

	line := headerValue(string(raw), "Subject")
	if strings.Contains(line, "รายงาน") {
		t.Errorf("the subject went out as raw 8-bit text: %q", line)
	}
	decoded, err := new(mime.WordDecoder).DecodeHeader(line)
	if err != nil {
		t.Fatalf("the encoded subject does not decode: %v", err)
	}
	if decoded != subject {
		t.Errorf("subject round-tripped as %q, want %q", decoded, subject)
	}
}

func TestBuildMailMIME_AttachmentSurvivesAMIMEReader(t *testing.T) {
	payload := []byte("%PDF-1.4\nnot really a pdf but long enough to need folding " +
		strings.Repeat("x", 500))

	raw, err := buildMailMIME("f@x.io", []string{"a@x.io"}, MailMessage{
		Subject: "Report", HTMLBody: "<p>attached</p>",
		Attachments: []MailAttachment{{
			Filename: "report.pdf", ContentType: "application/pdf", Data: payload,
		}},
	})
	if err != nil {
		t.Fatalf("buildMailMIME: %v", err)
	}
	s := string(raw)

	ctype := headerValue(s, "Content-Type")
	mediaType, params, err := mime.ParseMediaType(ctype)
	if err != nil {
		t.Fatalf("Content-Type %q does not parse: %v", ctype, err)
	}
	if mediaType != "multipart/mixed" {
		t.Fatalf("media type = %q, want multipart/mixed", mediaType)
	}

	body := s[strings.Index(s, "\r\n\r\n")+4:]
	mr := multipart.NewReader(strings.NewReader(body), params["boundary"])

	var sawHTML, sawPDF bool
	for {
		part, err := mr.NextPart()
		if err != nil {
			break
		}
		switch {
		case strings.HasPrefix(part.Header.Get("Content-Type"), "text/html"):
			sawHTML = true
		case strings.HasPrefix(part.Header.Get("Content-Type"), "application/pdf"):
			sawPDF = true
			if got := part.FileName(); got != "report.pdf" {
				t.Errorf("attachment filename = %q, want report.pdf", got)
			}
			if part.Header.Get("Content-Transfer-Encoding") != "base64" {
				t.Errorf("attachment is not base64 encoded")
			}
			// Read it back through the decoder — this is what a mail client does.
			buf := make([]byte, 0, len(payload))
			chunk := make([]byte, 4096)
			dec := base64.NewDecoder(base64.StdEncoding, part)
			for {
				n, err := dec.Read(chunk)
				buf = append(buf, chunk[:n]...)
				if err != nil {
					break
				}
			}
			if string(buf) != string(payload) {
				t.Errorf("the attachment did not survive the round trip (%d bytes back, %d sent)",
					len(buf), len(payload))
			}
		}
	}
	if !sawHTML || !sawPDF {
		t.Errorf("parts found: html=%v pdf=%v — both are required", sawHTML, sawPDF)
	}
}

// RFC 2045 caps an encoded line at 76 characters; a single multi-megabyte line is truncated or
// rejected by some relays, which turns a working PDF into a corrupt one.
func TestWrapBase64_FoldsAt76(t *testing.T) {
	out := wrapBase64(make([]byte, 1000))

	for i, line := range strings.Split(out, "\r\n") {
		if len(line) > 76 {
			t.Fatalf("line %d is %d characters", i, len(line))
		}
	}
	if strings.HasSuffix(out, "\r\n") {
		t.Errorf("the encoded block ends with a bare CRLF, which would add an empty MIME line")
	}
}

func TestCleanRecipients_DropsBlanksAndDuplicates(t *testing.T) {
	got := cleanRecipients([]string{" a@x.io ", "", "A@X.IO", "b@x.io", "a@x.io"})

	if len(got) != 2 {
		t.Fatalf("got %v, want two addresses", got)
	}
	if got[0] != "a@x.io" || got[1] != "b@x.io" {
		t.Errorf("got %v", got)
	}
}

// A missing SMTP account is a thing an admin can fix in thirty seconds; it must be reported as
// itself, not as "could not send".
func TestSendMail_WithoutConfigSaysSo(t *testing.T) {
	if err := SendMail(nil, MailMessage{To: []string{"a@x.io"}}); err != ErrNoSMTPConfig {
		t.Errorf("got %v, want ErrNoSMTPConfig", err)
	}
	if _, err := SMTPSender(nil); err != ErrNoSMTPConfig {
		t.Errorf("SMTPSender: got %v, want ErrNoSMTPConfig", err)
	}
}

// A device name or a FortiOS error message must not be able to break the markup around it.
func TestMailHTML_EscapesContent(t *testing.T) {
	out := MailHTML(`FGT "core" <lab>`, "", []string{"detail & more"}, "")

	if strings.Contains(out, "<lab>") {
		t.Errorf("an angle bracket from the device name reached the markup:\n%s", out)
	}
	if !strings.Contains(out, "&lt;lab&gt;") || !strings.Contains(out, "detail &amp; more") {
		t.Errorf("content was not escaped:\n%s", out)
	}
}

// headerValue pulls one header out of a rendered message.
func headerValue(msg, name string) string {
	for _, line := range strings.Split(msg, "\r\n") {
		if line == "" {
			return "" // end of headers
		}
		if strings.HasPrefix(line, name+": ") {
			return strings.TrimPrefix(line, name+": ")
		}
	}
	return ""
}
