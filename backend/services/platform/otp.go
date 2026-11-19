package platform

import (
	"crypto/rand"
	"fmt"
	"math/big"
	"time"

	"gorm.io/gorm"
	"network_automation/entity"
)

const OTPExpiration = 5 * time.Minute
const OTPMaxAttempts = 5

// generateOTPCode returns a cryptographically secure zero-padded 6-digit OTP.
func generateOTPCode() string {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		panic("crypto/rand failed: " + err.Error())
	}
	return fmt.Sprintf("%06d", n.Int64())
}

// SaveOTP deletes any existing OTP for the email, then creates a fresh one.
func SaveOTP(db *gorm.DB, email string) (string, error) {
	code := generateOTPCode()
	expires := time.Now().Add(OTPExpiration).Unix()

	// Unscoped, because entity.OTP embeds gorm.Model and a plain Delete is therefore an UPDATE of
	// deleted_at: the row — Code included — stayed in the table forever. Every password reset, every
	// sign-up and every email second factor left one behind, so the otps table accumulated a
	// permanent history of live-looking six-digit codes against addresses. Nothing reads a
	// soft-deleted row, so there is no reason to keep one.
	//
	// "Clear the old OTP" is also what the doc comment promises, and it has to be true: a reader
	// checking whether a used code is still retrievable must get the same answer the code gives.
	if err := db.Unscoped().Where("email = ?", email).Delete(&entity.OTP{}).Error; err != nil {
		return "", fmt.Errorf("failed to clear old OTP: %w", err)
	}

	if err := db.Create(&entity.OTP{
		Email:     email,
		Code:      code,
		ExpiresAt: expires,
		Verified:  false,
	}).Error; err != nil {
		return "", fmt.Errorf("failed to save OTP: %w", err)
	}

	return code, nil
}

type OTPEmailParams struct {
	ToEmail      string
	TemplateType string // "otp_reset", "otp_signup", "otp_2fa"
	OTPCode      string
	Username     string // used for {{username}} substitution
}

// builtinEmailStyle is the shared CSS for all built-in OTP email templates.
const builtinEmailStyle = `body{margin:0;padding:0;background:#f0f2f5;font-family:Arial,sans-serif}.wrap{max-width:520px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}.header{padding:32px 40px;text-align:center}.header h1{margin:0;color:#fff;font-size:22px;font-weight:700}.header p{margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px}.body{padding:36px 40px}.body p{color:#374151;font-size:14px;line-height:1.7;margin:0 0 16px}.otp-box{border-radius:12px;text-align:center;padding:24px 16px;margin:24px 0;border:2px dashed}.otp-box span{font-size:36px;font-weight:800;letter-spacing:12px;font-family:monospace}.otp-note{font-size:12px;color:#6b7280;margin:10px 0 0}.footer{background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb}.footer p{margin:0;font-size:12px;color:#9ca3af}`

type builtinEmailConfig struct {
	subject  string
	gradient string
	boxBg    string
	boxColor string
	title    string
	subtitle string
}

var builtinTemplates = map[string]builtinEmailConfig{
	"otp_reset": {
		subject:  "Password Reset — Your OTP Code",
		gradient: "linear-gradient(135deg,#7c3aed,#4f46e5)",
		boxBg:    "#f5f3ff", boxColor: "#7c3aed",
		title: "Password Reset", subtitle: "Secure OTP Verification",
	},
	"otp_signup": {
		subject:  "Verify Your Email — Registration OTP",
		gradient: "linear-gradient(135deg,#0ea5e9,#6366f1)",
		boxBg:    "#f0f9ff", boxColor: "#0ea5e9",
		title: "Verify Your Email", subtitle: "Complete your registration",
	},
	"otp_2fa": {
		subject:  "Login Verification — Your OTP Code",
		gradient: "linear-gradient(135deg,#059669,#0d9488)",
		boxBg:    "#f0fdf4", boxColor: "#059669",
		title: "Login Verification", subtitle: "Two-factor authentication",
	},
}

// buildOTPEmailHTML builds the full HTML body for the given email type.
func buildOTPEmailHTML(emailType, otpCode, username, toEmail string) (subject, body string) {
	cfg, ok := builtinTemplates[emailType]
	if !ok {
		cfg = builtinTemplates["otp_reset"]
		emailType = "otp_reset"
	}

	var bodyContent, closing string
	switch emailType {
	case "otp_signup":
		bodyContent = fmt.Sprintf(
			`<p>Welcome! You're registering with <strong>%s</strong>.</p>`+
				`<p>Enter the OTP below to verify your email address and complete sign-up.</p>`,
			toEmail,
		)
		closing = `<p>If you did not attempt to register, please ignore this email.</p>`
	case "otp_2fa":
		bodyContent = fmt.Sprintf(
			`<p>Hi <strong>%s</strong>,</p>`+
				`<p>A login attempt was made for <strong>%s</strong>. Use the code below to confirm it was you.</p>`,
			username, toEmail,
		)
		closing = `<p>If you did not attempt to log in, please secure your account immediately by changing your password.</p>`
	default: // otp_reset
		bodyContent = fmt.Sprintf(
			`<p>Hi <strong>%s</strong>,</p>`+
				`<p>We received a request to reset the password for <strong>%s</strong>. Use the OTP below to proceed.</p>`,
			username, toEmail,
		)
		closing = `<p>If you did not request a password reset, you can safely ignore this email.</p>`
	}

	html := fmt.Sprintf(
		`<!DOCTYPE html><html><head><meta charset="UTF-8"><style>%s`+
			`.header{background:%s}.otp-box{background:%s;border-color:%s}.otp-box span{color:%s}`+
			`</style></head><body><div class="wrap">`+
			`<div class="header"><h1>%s</h1><p>%s</p></div>`+
			`<div class="body">%s`+
			`<div class="otp-box"><span>%s</span><p class="otp-note">Expires in 5 minutes &nbsp;·&nbsp; Do not share this code</p></div>`+
			`%s</div>`+
			`<div class="footer"><p>This is an automated message — please do not reply</p></div>`+
			`</div></body></html>`,
		builtinEmailStyle,
		cfg.gradient, cfg.boxBg, cfg.boxColor, cfg.boxColor,
		cfg.title, cfg.subtitle,
		bodyContent,
		otpCode,
		closing,
	)

	return cfg.subject, html
}

// SendOTPEmail sends an HTML email using the built-in template for the specified type.
//
// It goes through the shared mailer (mailer.go) rather than calling smtp.SendMail itself. That is
// the only change from the original: the same send_emails row, the same Gmail account, the same
// templates — but one place that knows how to build a message, now that reports and alerts mail
// too.
func SendOTPEmail(db *gorm.DB, p OTPEmailParams) error {
	username := p.Username
	if username == "" {
		username = p.ToEmail
	}

	subject, body := buildOTPEmailHTML(p.TemplateType, p.OTPCode, username, p.ToEmail)

	return SendMail(db, MailMessage{
		To:       []string{p.ToEmail},
		Subject:  subject,
		HTMLBody: body,
	})
}
