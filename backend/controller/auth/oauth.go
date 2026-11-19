package auth

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"
	"golang.org/x/oauth2"
	"golang.org/x/oauth2/github"
	"golang.org/x/oauth2/google"
	"gorm.io/gorm"
	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

var lineEndpoint = oauth2.Endpoint{
	AuthURL:  "https://access.line.me/oauth2/v2.1/authorize",
	TokenURL: "https://api.line.me/oauth2/v2.1/token",
}

// ── Config helpers ─────────────────────────────────────────────────────────────

func getBackendURL() string {
	if u := os.Getenv("BACKEND_URL"); u != "" {
		return u
	}
	return "http://localhost:9000"
}

func getFrontendURL() string {
	if u := os.Getenv("FRONTEND_URL"); u != "" {
		return u
	}
	return "http://localhost:5173"
}

func googleOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GOOGLE_CLIENT_ID"),
		ClientSecret: os.Getenv("GOOGLE_CLIENT_SECRET"),
		RedirectURL:  getBackendURL() + "/auth/google/callback",
		Scopes:       []string{"openid", "email", "profile"},
		Endpoint:     google.Endpoint,
	}
}

func githubOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("GITHUB_CLIENT_ID"),
		ClientSecret: os.Getenv("GITHUB_CLIENT_SECRET"),
		RedirectURL:  getBackendURL() + "/auth/github/callback",
		Scopes:       []string{"user:email"},
		Endpoint:     github.Endpoint,
	}
}

func lineOAuthConfig() *oauth2.Config {
	return &oauth2.Config{
		ClientID:     os.Getenv("LINE_CLIENT_ID"),
		ClientSecret: os.Getenv("LINE_CLIENT_SECRET"),
		RedirectURL:  getBackendURL() + "/auth/line/callback",
		Scopes:       []string{"profile", "openid", "email"},
		Endpoint:     lineEndpoint,
	}
}

// ── State cookie (CSRF protection) ────────────────────────────────────────────

// generateOAuthState mints the one-time value that ties a callback to the browser that started it.
//
// The error is returned rather than dropped. Ignoring it (as this did) meant that a failing
// crypto/rand made every state the SAME string — 16 zero bytes — which an attacker can set as their
// own cookie, and the CSRF check would then pass for a callback they initiated.
func generateOAuthState() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	return base64.URLEncoding.EncodeToString(b), nil
}

func setOAuthStateCookie(c *gin.Context, state string) {
	secure := isHTTPS(c)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "oauth_state",
		Value:    state,
		Path:     "/",
		MaxAge:   300,
		HttpOnly: true,
		Secure:   secure,
		SameSite: cookieSameSite(secure),
	})
}

// clearOAuthStateCookie spends the state.
//
// It is what makes the value SINGLE USE. Before this the cookie was read and left in place, so one
// (state, cookie) pair stayed replayable for its whole 300-second life.
func clearOAuthStateCookie(c *gin.Context) {
	secure := isHTTPS(c)
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     "oauth_state",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   secure,
		SameSite: cookieSameSite(secure),
	})
}

func validateOAuthState(c *gin.Context) bool {
	cookieState, err := c.Cookie("oauth_state")
	// Spent either way: a callback that arrives with the wrong state does not get to try again
	// against the same cookie.
	clearOAuthStateCookie(c)
	if err != nil || cookieState == "" {
		return false
	}
	query := c.Query("state")
	if query == "" {
		return false
	}
	// Constant time, so the comparison cannot be used to learn the value a byte at a time.
	return subtle.ConstantTimeCompare([]byte(cookieState), []byte(query)) == 1
}

// ── Redirect endpoints ─────────────────────────────────────────────────────────

// startOAuth mints a state, sets its cookie and sends the browser to the provider. A failure to
// generate the state aborts the flow instead of continuing with a predictable one.
func startOAuth(c *gin.Context, authCodeURL func(state string) string) {
	state, err := generateOAuthState()
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=server")
		return
	}
	setOAuthStateCookie(c, state)
	c.Redirect(http.StatusTemporaryRedirect, authCodeURL(state))
}

func OAuthGoogleRedirect(c *gin.Context) {
	startOAuth(c, func(state string) string {
		return googleOAuthConfig().AuthCodeURL(state, oauth2.AccessTypeOnline)
	})
}

func OAuthGithubRedirect(c *gin.Context) {
	startOAuth(c, func(state string) string { return githubOAuthConfig().AuthCodeURL(state) })
}

func OAuthLineRedirect(c *gin.Context) {
	startOAuth(c, func(state string) string { return lineOAuthConfig().AuthCodeURL(state) })
}

// ── Shared OAuth finish logic ──────────────────────────────────────────────────

type oauthUserInfo struct {
	ProviderID string
	Email      string
	FirstName  string
	LastName   string
	Profile    string

	// EmailVerified is the PROVIDER's word that this person controls this address.
	//
	// It exists because the address decides which account is opened, and an address nobody checked
	// is just a string the caller chose. Google states it as `email_verified`, GitHub only hands
	// back addresses it has marked primary AND verified, and for LINE it comes from the token
	// endpoint that validates the ID token's signature — never from reading the token's payload.
	// No provider may leave it false and still name an account.
	EmailVerified bool
}

// oauthSignupAllowed reports whether completing a provider flow may CREATE an account.
//
// Off unless OAUTH_ALLOW_SIGNUP is set, because this product has no self-registration — routes.go
// says so in as many words, and the three provider redirects are public GETs. With it off, OAuth is
// a way to sign IN to an account that already exists and is already bound to that identity, which
// is what everything else in this console assumes: an administrator creates accounts.
func oauthSignupAllowed() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("OAUTH_ALLOW_SIGNUP"))) {
	case "1", "true", "yes", "on":
		return true
	}
	return false
}

// maintenanceBlocks answers whether maintenance mode shuts this person out.
//
// Read through services.MaintenanceStatus, the same cached reader middleware.Authorizes and
// auth.Login use. It used to query system_configs directly here, so the password door and the OAuth
// door could disagree about whether the system was down.
func maintenanceBlocks(db *gorm.DB, roleName string) bool {
	if roleName == "admin" {
		return false
	}
	state, err := services.MaintenanceStatus(db)
	return err == nil && state.Enabled
}

func oauthFinish(c *gin.Context, info oauthUserInfo, provider string) {
	frontURL := getFrontendURL()

	if info.Email == "" {
		c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=no_email")
		return
	}

	// An address the provider did not verify cannot choose an account. Without this the identity
	// could simply assert any address — including an administrator's — and the lookups below would
	// honour it.
	if !info.EmailVerified {
		c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=email_unverified")
		return
	}

	db := config.DB()

	var user entity.AppUser
	found := false

	// 1. The provider identity itself: (provider_id, auth_provider) together, which is the only
	//    key that cannot be asserted by whoever controls an inbox.
	//
	//    Unscoped, so a REMOVED account is recognised and refused rather than missed. Under the
	//    default scope a deleted user who could still complete a provider flow fell through to the
	//    branches below and was handed a brand-new live account on the same address.
	err := db.Unscoped().Preload("AppRole").
		Where("provider_id = ? AND auth_provider = ? AND provider_id <> ''", info.ProviderID, provider).
		First(&user).Error
	if err == nil {
		if user.DeletedAt.Valid {
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=account_removed")
			return
		}
		found = true
	}

	if !found {
		// 2. First sign-in for an account an administrator already created: bind this identity to
		//    it, matched on the verified address.
		//
		//    ── The hole this closes ──────────────────────────────────────────────────────────
		//    This branch used to match on `LOWER(email)` alone and then WRITE auth_provider and
		//    provider_id onto whatever it found. Any provider identity presenting an
		//    administrator's address was therefore signed in AS that administrator, and the
		//    administrator's row was permanently rebound to the attacker's identity — invisibly,
		//    since the password hash was left intact. It also relabelled the account away from
		//    "local", which silently exempted it from the password-expiry rule in auth.go.
		//
		//    So a PASSWORD account is never linked automatically. Its owner proves who they are
		//    with the password; an identity arriving from outside does not get to claim it because
		//    it can quote the address. Linking one is an administrator's deliberate act.
		var candidate entity.AppUser
		if db.Unscoped().Preload("AppRole").
			Where("LOWER(email) = LOWER(?)", info.Email).First(&candidate).Error == nil {
			switch {
			case candidate.DeletedAt.Valid:
				c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=account_removed")
				return
			case isPasswordAccount(candidate):
				c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=account_not_linked")
				return
			case candidate.AuthProvider != provider && candidate.ProviderID != "":
				// Already bound to a DIFFERENT provider identity. Re-pointing it here would be the
				// same takeover with one more step.
				c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=account_not_linked")
				return
			}

			if maintenanceBlocks(db, roleOf(candidate)) {
				c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=maintenance")
				return
			}
			if err := db.Model(&candidate).Updates(map[string]interface{}{
				"auth_provider": provider,
				"provider_id":   info.ProviderID,
			}).Error; err != nil {
				c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=server")
				return
			}
			user = candidate
			found = true
		}
	}

	if !found {
		// 3. Nobody here by that identity or that address.
		if !oauthSignupAllowed() {
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=no_account")
			return
		}

		// The gate runs BEFORE the account exists. It used to run after, so maintenance mode
		// refused the session while leaving behind an account that worked the moment maintenance
		// was switched off.
		if maintenanceBlocks(db, "") {
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=maintenance")
			return
		}

		var userRole entity.AppRole
		if db.Where("role = ?", "user").First(&userRole).Error != nil {
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=server")
			return
		}

		placeholder, err := oauthRandomPassword()
		if err != nil {
			// A discarded error here used to mean every OAuth account could share one known
			// password, or carry an empty one.
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=server")
			return
		}

		user = entity.AppUser{
			Email:        info.Email,
			Password:     placeholder,
			FirstName:    info.FirstName,
			LastName:     info.LastName,
			Profile:      info.Profile,
			AuthProvider: provider,
			ProviderID:   info.ProviderID,
			AppRoleID:    userRole.ID,
		}
		if dbErr := db.Create(&user).Error; dbErr != nil {
			c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=server")
			return
		}
		db.Preload("AppRole").First(&user, user.ID)
	}

	roleName := roleOf(user)

	if maintenanceBlocks(db, roleName) {
		c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=maintenance")
		return
	}

	token, err := platform.GenerateJWT(user.ID, user.Email, roleName)
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, frontURL+"?oauth_error=server")
		return
	}

	if !issueSessionCookie(c, user.ID, token) {
		return
	}
	go services.LogActivity(db, user.ID, "login")

	c.Redirect(http.StatusTemporaryRedirect, frontURL+"/admin")
}

// roleOf names the account's role, or "" when the association was not loaded.
func roleOf(u entity.AppUser) string {
	if u.AppRole == nil {
		return ""
	}
	return u.AppRole.Role
}

// isPasswordAccount reports whether this account signs in with a password.
//
// "local" is what auth.Login stamps, and an EMPTY provider means the same thing — rows created
// before the column existed, and the seeded accounts. Both are accounts whose owner proves who
// they are with a password, and neither may be claimed by an identity arriving from a provider.
func isPasswordAccount(u entity.AppUser) bool {
	p := strings.ToLower(strings.TrimSpace(u.AuthProvider))
	return p == "" || p == "local"
}

// oauthRandomPassword generates a bcrypt hash of 32 random bytes.
//
// OAuth accounts never sign in with a password, so the plaintext is discarded — but the COLUMN
// still has to hold something no one can guess, because a password account is exactly what this
// row would become if somebody later flipped its auth_provider back.
//
// Both errors are returned rather than dropped. Ignoring them (as this did) meant a failing
// crypto/rand gave every OAuth account the hash of the same 32 zero bytes, and a failing bcrypt
// gave them all an EMPTY password column.
func oauthRandomPassword() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("read random bytes: %w", err)
	}
	hashed, err := platform.HashPassword(base64.StdEncoding.EncodeToString(b))
	if err != nil {
		return "", fmt.Errorf("hash the placeholder password: %w", err)
	}
	return hashed, nil
}

// splitDisplayName splits "First Last" → ("First", "Last").
// Falls back to ("Name", "-") when there is no space.
func splitDisplayName(fullName string) (string, string) {
	trimmed := strings.TrimSpace(fullName)
	if trimmed == "" {
		return "User", "-"
	}
	idx := strings.Index(trimmed, " ")
	if idx == -1 {
		return trimmed, "-"
	}
	return trimmed[:idx], strings.TrimSpace(trimmed[idx+1:])
}

// ── Google callback ────────────────────────────────────────────────────────────

type googleUserInfo struct {
	Sub   string `json:"sub"`
	Email string `json:"email"`
	// EmailVerified is Google's own statement that this person controls this address. The struct
	// had no field for it, so it was dropped at the JSON boundary and an unverified Google account
	// could name any address it liked — including an administrator's.
	EmailVerified bool   `json:"email_verified"`
	GivenName     string `json:"given_name"`
	FamilyName    string `json:"family_name"`
	Picture       string `json:"picture"`
}

func OAuthGoogleCallback(c *gin.Context) {
	if !validateOAuthState(c) {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=invalid_state")
		return
	}

	tok, err := googleOAuthConfig().Exchange(c.Request.Context(), c.Query("code"))
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=exchange_failed")
		return
	}

	client := googleOAuthConfig().Client(c.Request.Context(), tok)
	resp, err := client.Get("https://www.googleapis.com/oauth2/v3/userinfo")
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=userinfo_failed")
		return
	}
	defer resp.Body.Close()

	var info googleUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=parse_failed")
		return
	}

	oauthFinish(c, oauthUserInfo{
		ProviderID:    info.Sub,
		Email:         info.Email,
		EmailVerified: info.EmailVerified,
		FirstName:     info.GivenName,
		LastName:      info.FamilyName,
		Profile:       info.Picture,
	}, "google")
}

// ── GitHub callback ────────────────────────────────────────────────────────────

type githubUserInfo struct {
	ID        int    `json:"id"`
	Login     string `json:"login"`
	Name      string `json:"name"`
	Email     string `json:"email"`
	AvatarURL string `json:"avatar_url"`
}

type githubEmail struct {
	Email    string `json:"email"`
	Primary  bool   `json:"primary"`
	Verified bool   `json:"verified"`
}

func OAuthGithubCallback(c *gin.Context) {
	if !validateOAuthState(c) {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=invalid_state")
		return
	}

	tok, err := githubOAuthConfig().Exchange(c.Request.Context(), c.Query("code"))
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=exchange_failed")
		return
	}

	client := githubOAuthConfig().Client(c.Request.Context(), tok)

	resp, err := client.Get("https://api.github.com/user")
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=userinfo_failed")
		return
	}
	defer resp.Body.Close()

	var info githubUserInfo
	if err := json.NewDecoder(resp.Body).Decode(&info); err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=parse_failed")
		return
	}

	// The address on /user is whatever the account made public, verified or not, so it cannot
	// decide which account to open. /user/emails is the only one that states `verified`, and
	// fetchGithubPrimaryEmail returns an address only when GitHub marks it primary AND verified —
	// so that call, not the profile field, is what makes the address trustworthy here.
	verifiedEmail := fetchGithubPrimaryEmail(client)

	firstName, lastName := splitDisplayName(info.Name)
	if firstName == "User" {
		firstName = info.Login
	}

	oauthFinish(c, oauthUserInfo{
		ProviderID:    fmt.Sprintf("%d", info.ID),
		Email:         verifiedEmail,
		EmailVerified: verifiedEmail != "",
		FirstName:     firstName,
		LastName:      lastName,
		Profile:       info.AvatarURL,
	}, "github")
}

func fetchGithubPrimaryEmail(client *http.Client) string {
	resp, err := client.Get("https://api.github.com/user/emails")
	if err != nil {
		return ""
	}
	defer resp.Body.Close()

	// The status was never read, so a 401, 403 or 500 that happened to carry a well-formed array
	// was believed. Anything but 200 means GitHub did not answer the question.
	if resp.StatusCode != http.StatusOK {
		return ""
	}

	body, _ := io.ReadAll(resp.Body)
	var emails []githubEmail
	if err := json.Unmarshal(body, &emails); err != nil {
		return ""
	}
	// Primary AND verified, both: GitHub lets an account hold unverified addresses, and an
	// unverified one is a string its owner typed.
	for _, e := range emails {
		if e.Primary && e.Verified {
			return e.Email
		}
	}
	return ""
}

// ── LINE callback ──────────────────────────────────────────────────────────────

type lineProfile struct {
	UserID      string `json:"userId"`
	DisplayName string `json:"displayName"`
	PictureURL  string `json:"pictureUrl"`
}

func OAuthLineCallback(c *gin.Context) {
	if !validateOAuthState(c) {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=invalid_state")
		return
	}

	tok, err := lineOAuthConfig().Exchange(c.Request.Context(), c.Query("code"))
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=exchange_failed")
		return
	}

	client := lineOAuthConfig().Client(c.Request.Context(), tok)
	resp, err := client.Get("https://api.line.me/v2/profile")
	if err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=userinfo_failed")
		return
	}
	defer resp.Body.Close()

	var profile lineProfile
	if err := json.NewDecoder(resp.Body).Decode(&profile); err != nil {
		c.Redirect(http.StatusTemporaryRedirect, getFrontendURL()+"?oauth_error=parse_failed")
		return
	}

	// The email comes from LINE's own verification of the ID token, never from reading the token.
	//
	// extractLineEmail used to decode the payload and trust whatever it said: the third segment
	// only had to EXIST, so an id_token with an empty or garbage signature — and any email inside
	// it — was accepted, and nothing checked iss, aud or exp either.
	//
	// The synthetic `line_<userId>@line.placeholder` fallback is gone with it. An address this
	// server invented from a provider-controlled id is not a verified address, and letting one
	// name an account meant the identity chose its own key into the accounts table.
	email, verified := verifyLineIDToken(c.Request.Context(), tok)

	firstName, lastName := splitDisplayName(profile.DisplayName)

	oauthFinish(c, oauthUserInfo{
		ProviderID:    profile.UserID,
		Email:         email,
		EmailVerified: verified,
		FirstName:     firstName,
		LastName:      lastName,
		Profile:       profile.PictureURL,
	}, "line")
}

// lineVerifyURL is LINE's own ID-token verification endpoint. A var so a test can point it at an
// httptest server; nothing in production reassigns it.
var lineVerifyURL = "https://api.line.me/oauth2/v2.1/verify"

// lineIDTokenClaims is the subset of LINE's verified response this console reads.
type lineIDTokenClaims struct {
	Sub   string `json:"sub"`
	Aud   string `json:"aud"`
	Email string `json:"email"`
}

// verifyLineIDToken asks LINE whether an ID token is genuine, and returns the address only if it is.
//
// POST /oauth2/v2.1/verify is LINE's documented endpoint for exactly this: it checks the signature,
// the issuer, the audience and the expiry on their side and answers 400 when any of it fails. That
// is the whole point of going over the network rather than decoding the token here — this server
// does not hold LINE's signing keys, so it cannot tell a real token from a typed one on its own,
// and the previous code did not try.
//
// Returns ("", false) for anything short of a verified token carrying an email.
func verifyLineIDToken(ctx context.Context, tok *oauth2.Token) (string, bool) {
	idToken, ok := tok.Extra("id_token").(string)
	if !ok || strings.TrimSpace(idToken) == "" {
		return "", false
	}
	clientID := os.Getenv("LINE_CLIENT_ID")
	if clientID == "" {
		return "", false
	}

	form := url.Values{"id_token": {idToken}, "client_id": {clientID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, lineVerifyURL,
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", false
	}

	var claims lineIDTokenClaims
	if err := json.NewDecoder(resp.Body).Decode(&claims); err != nil {
		return "", false
	}
	// LINE checks `aud` itself, but it costs one comparison to refuse a token minted for another
	// channel in case the endpoint is ever pointed somewhere else.
	if claims.Aud != clientID {
		return "", false
	}
	email := strings.TrimSpace(claims.Email)
	if email == "" {
		return "", false
	}
	return email, true
}
