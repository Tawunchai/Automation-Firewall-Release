package auth

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"golang.org/x/crypto/bcrypt"
	"golang.org/x/oauth2"
)

// The parts of oauth.go that decide something without needing a database or a provider.
//
// oauth.go was 0% covered across all 19 of its functions, and it is the one unauthenticated
// surface left in this package that can MINT an account: /auth/{google,github,line} are public
// GETs in routes.go, three lines below a comment that says this system has no self-registration.
// Several of the tests below therefore pin behaviour that is wrong on purpose — each one is marked
// `PHASE 2 HOLE`, with what an attacker gets out of it. They assert TODAY's behaviour so that the
// fix is a visible, deliberate change to a failing test rather than a silent edit.
//
// oauth_finish_db_test.go covers oauthFinish, which is where those holes are actually spent.

// ── splitDisplayName ─────────────────────────────────────────────────────────

// Every provider hands over one display string and this is the only thing that turns it into the
// two NOT-NULL columns AppUser demands (FirstName/LastName are `valid:"required"`). If it ever
// returned an empty second value the account create would fail validation, which on the OAuth path
// shows up only as `?oauth_error=server` with nothing in the log.
func TestSplitDisplayName(t *testing.T) {
	cases := []struct {
		name      string
		in        string
		wantFirst string
		wantLast  string
	}{
		{"empty", "", "User", "-"},
		{"only spaces", "   ", "User", "-"},
		{"one word", "Somchai", "Somchai", "-"},
		{"two words", "Somchai Jaidee", "Somchai", "Jaidee"},
		{"three words keep the tail together", "Mary Jane Watson", "Mary", "Jane Watson"},
		{"leading and trailing spaces are trimmed", "  John Doe  ", "John", "Doe"},
		{"repeated inner spaces collapse into the surname", "John   Doe", "John", "Doe"},
		// This product's users are Thai, so a Thai display name is the normal case, not the
		// exotic one. Splitting is byte-index based but the index comes from a literal " ", which
		// is a single byte that cannot appear inside a UTF-8 multi-byte rune — so the slice never
		// cuts a Thai character in half. (The repo has been bitten by byte-slicing Thai before.)
		{"thai given + family name", "สมชาย ใจดี", "สมชาย", "ใจดี"},
		{"thai single word", "ตะวันฉาย", "ตะวันฉาย", "-"},
		{"thai with a middle name", "สมชาย รัก ใจดี", "สมชาย", "รัก ใจดี"},
		// Documented, not desired: only a literal ASCII space splits. A tab-separated or
		// NBSP-separated display name becomes one very long first name and a "-" surname. It is
		// cosmetic (no security consequence) and no provider is known to send one.
		{"tab is not a separator", "John\tDoe", "John\tDoe", "-"},
		{"non-breaking space is not a separator", "John Doe", "John Doe", "-"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			first, last := splitDisplayName(tc.in)
			if first != tc.wantFirst || last != tc.wantLast {
				t.Errorf("splitDisplayName(%q) = (%q, %q), want (%q, %q)",
					tc.in, first, last, tc.wantFirst, tc.wantLast)
			}
			// Whatever the input, neither half may come back empty: both land in NOT NULL,
			// `valid:"required"` columns.
			if first == "" || last == "" {
				t.Errorf("splitDisplayName(%q) returned an empty half (%q, %q) — AppUser "+
					"validation would refuse the account with no usable error", tc.in, first, last)
			}
		})
	}
}

// ── extractLineEmail ─────────────────────────────────────────────────────────

// unsignedIDToken builds a three-part JWT whose payload is `payloadJSON` and whose signature
// segment is whatever is passed — including nothing at all.
func unsignedIDToken(payloadJSON, signature string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none","typ":"JWT"}`))
	payload := base64.RawURLEncoding.EncodeToString([]byte(payloadJSON))
	return header + "." + payload + "." + signature
}

func tokenWithIDToken(idToken interface{}) *oauth2.Token {
	tok := &oauth2.Token{AccessToken: "access-token"}
	if idToken == nil {
		return tok
	}
	return tok.WithExtra(map[string]interface{}{"id_token": idToken})
}

// lineVerifier stands in for LINE's /oauth2/v2.1/verify endpoint and restores the real URL after.
func lineVerifier(t *testing.T, status int, body string) *int {
	t.Helper()
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		_ = r.ParseForm()
		if r.Form.Get("id_token") == "" || r.Form.Get("client_id") == "" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	prev := lineVerifyURL
	lineVerifyURL = srv.URL
	t.Cleanup(func() { lineVerifyURL = prev })
	return &calls
}

// The signature check now lives where the keys are.
//
// This replaces TestExtractLineEmail and TestExtractLineEmailAcceptsAnUnsignedIDToken, which
// asserted the hole: the old extractLineEmail split the ID token on "." and read the payload,
// requiring only that a third segment EXIST. A token with an empty or garbage signature claiming
// any address was believed. This server holds none of LINE's signing keys, so it could never have
// told a real token from a typed one on its own — the fix is to ask LINE, whose endpoint checks the
// signature, issuer, audience and expiry and answers 400 when any of them fails.
func TestVerifyLineIDTokenAcceptsOnlyAVerifiedToken(t *testing.T) {
	t.Setenv("LINE_CLIENT_ID", "channel-1")

	t.Run("a verified token for this channel yields its email", func(t *testing.T) {
		lineVerifier(t, http.StatusOK, `{"sub":"U123","aud":"channel-1","email":"someone@example.com"}`)
		email, ok := verifyLineIDToken(context.Background(), tokenWithIDToken("whatever-line-says-is-real"))
		if !ok || email != "someone@example.com" {
			t.Fatalf("verifyLineIDToken = (%q, %v), want someone@example.com + true", email, ok)
		}
	})

	t.Run("a forged token is refused, because LINE refuses it", func(t *testing.T) {
		// What a forged, unsigned or expired token actually produces: LINE answers 400.
		lineVerifier(t, http.StatusBadRequest, `{"error":"invalid_request"}`)
		forged := unsignedIDToken(`{"iss":"attacker","aud":"nobody","email":"admin@got.co.th"}`, "not-a-signature")
		if email, ok := verifyLineIDToken(context.Background(), tokenWithIDToken(forged)); ok || email != "" {
			t.Fatalf("a token LINE rejected was accepted: (%q, %v)", email, ok)
		}
	})

	t.Run("a token minted for another channel is refused", func(t *testing.T) {
		lineVerifier(t, http.StatusOK, `{"sub":"U123","aud":"someone-elses-channel","email":"someone@example.com"}`)
		if email, ok := verifyLineIDToken(context.Background(), tokenWithIDToken("t")); ok || email != "" {
			t.Fatalf("aud mismatch accepted: (%q, %v)", email, ok)
		}
	})

	t.Run("a verified token with no email is refused", func(t *testing.T) {
		lineVerifier(t, http.StatusOK, `{"sub":"U123","aud":"channel-1"}`)
		if email, ok := verifyLineIDToken(context.Background(), tokenWithIDToken("t")); ok || email != "" {
			t.Fatalf("an email-less token was accepted: (%q, %v)", email, ok)
		}
	})

	t.Run("a malformed answer is refused", func(t *testing.T) {
		lineVerifier(t, http.StatusOK, `not json`)
		if _, ok := verifyLineIDToken(context.Background(), tokenWithIDToken("t")); ok {
			t.Fatal("a non-JSON answer was accepted")
		}
	})

	t.Run("no id_token means LINE is never even asked", func(t *testing.T) {
		calls := lineVerifier(t, http.StatusOK, `{"aud":"channel-1","email":"a@b.c"}`)
		for _, tok := range []*oauth2.Token{tokenWithIDToken(nil), tokenWithIDToken(""), tokenWithIDToken(123)} {
			if _, ok := verifyLineIDToken(context.Background(), tok); ok {
				t.Fatal("a token carrying no usable id_token was accepted")
			}
		}
		if *calls != 0 {
			t.Errorf("the verify endpoint was called %d time(s) for a token with no id_token", *calls)
		}
	})
}

// Without a channel id there is nothing to verify the token AGAINST, so the answer is no.
func TestVerifyLineIDTokenRefusesWhenTheChannelIsNotConfigured(t *testing.T) {
	t.Setenv("LINE_CLIENT_ID", "")
	calls := lineVerifier(t, http.StatusOK, `{"aud":"","email":"a@b.c"}`)

	if _, ok := verifyLineIDToken(context.Background(), tokenWithIDToken("t")); ok {
		t.Fatal("a token was verified with no LINE_CLIENT_ID set")
	}
	if *calls != 0 {
		t.Errorf("the verify endpoint was called %d time(s) with no channel configured", *calls)
	}
}

// Google's `email_verified` is read, and an unverified address cannot name an account.
//
// This replaces TestGoogleProfileDiscardsEmailVerified, which asserted that NEITHER struct had a
// field for the flag — so the claim was dropped at the JSON boundary and an unverified Google
// account could present any address, including an administrator's. Both halves now carry it, and
// oauthFinish refuses when it is false (see the DB suite).
func TestGoogleProfileCarriesEmailVerified(t *testing.T) {
	var info googleUserInfo
	if err := json.Unmarshal([]byte(`{"sub":"1","email":"a@b.c","email_verified":true}`), &info); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !info.EmailVerified {
		t.Error("email_verified was not decoded from Google's userinfo response")
	}

	var unverified googleUserInfo
	if err := json.Unmarshal([]byte(`{"sub":"1","email":"a@b.c","email_verified":false}`), &unverified); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if unverified.EmailVerified {
		t.Error("a false email_verified decoded as true")
	}

	// A response that omits the claim entirely must read as NOT verified, never as verified by
	// default — that is the whole point of the field.
	var missing googleUserInfo
	if err := json.Unmarshal([]byte(`{"sub":"1","email":"a@b.c"}`), &missing); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if missing.EmailVerified {
		t.Error("a response with no email_verified claim read as verified")
	}

	// And the struct the rest of the flow passes around has somewhere to put it.
	if _, ok := reflect.TypeOf(oauthUserInfo{}).FieldByName("EmailVerified"); !ok {
		t.Error("oauthUserInfo has no EmailVerified field, so the flag cannot reach oauthFinish")
	}
}

// ── fetchGithubPrimaryEmail ──────────────────────────────────────────────────

// rewriteTransport points the hard-coded api.github.com URL at a local test server, keeping the
// path. fetchGithubPrimaryEmail takes an *http.Client precisely so this is possible, so no
// production code has to be changed to test it.
type rewriteTransport struct{ to *url.URL }

func (rt rewriteTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	clone := req.Clone(req.Context())
	clone.URL.Scheme = rt.to.Scheme
	clone.URL.Host = rt.to.Host
	clone.Host = rt.to.Host
	return http.DefaultTransport.RoundTrip(clone)
}

// failingTransport stands in for a network that is simply not there.
type failingTransport struct{}

func (failingTransport) RoundTrip(*http.Request) (*http.Response, error) {
	return nil, http.ErrNotSupported
}

func githubEmailsClient(t *testing.T, status int, body string) *http.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/user/emails" {
			t.Errorf("fetchGithubPrimaryEmail asked for %q, want /user/emails", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)

	u, err := url.Parse(srv.URL)
	if err != nil {
		t.Fatalf("parse test server URL: %v", err)
	}
	return &http.Client{Transport: rewriteTransport{to: u}}
}

// GitHub lets an account hide its address, so this endpoint is the usual source of the email that
// oauthFinish then matches an account by. Only a primary AND verified address may be used: an
// unverified GitHub address is one anybody can claim, so returning it would hand the email-match
// path in oauthFinish an unowned address.
func TestFetchGithubPrimaryEmail(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   string
	}{
		{
			name:   "primary and verified wins",
			status: http.StatusOK,
			body: `[{"email":"secondary@example.com","primary":false,"verified":true},
			        {"email":"primary@example.com","primary":true,"verified":true}]`,
			want: "primary@example.com",
		},
		{
			// The one that matters: a primary address the owner never confirmed is refused, so
			// nobody can claim someone else's address by typing it into GitHub.
			name:   "primary but unverified is refused",
			status: http.StatusOK,
			body:   `[{"email":"unconfirmed@example.com","primary":true,"verified":false}]`,
			want:   "",
		},
		{
			name:   "verified but not primary is refused",
			status: http.StatusOK,
			body:   `[{"email":"extra@example.com","primary":false,"verified":true}]`,
			want:   "",
		},
		{
			name:   "first primary+verified entry wins when there are several",
			status: http.StatusOK,
			body: `[{"email":"first@example.com","primary":true,"verified":true},
			        {"email":"second@example.com","primary":true,"verified":true}]`,
			want: "first@example.com",
		},
		{"empty list", http.StatusOK, `[]`, ""},
		{"null body", http.StatusOK, `null`, ""},
		// A 401/403/404 body is not JSON-array-shaped, so the decode fails and the answer is "".
		// What matters is that a failed lookup never produces an address.
		{"unauthorized", http.StatusUnauthorized, `{"message":"Bad credentials"}`, ""},
		{"not found", http.StatusNotFound, `{"message":"Not Found"}`, ""},
		{"malformed JSON", http.StatusOK, `[{"email":`, ""},
		{"an object where an array was expected", http.StatusOK, `{"email":"x@example.com"}`, ""},
		// The status IS looked at now. A 500 that happens to carry a well-formed,
		// primary+verified array used to be believed; anything but 200 means GitHub did not
		// answer the question, so no address comes back.
		{
			name:   "a non-200 is not an answer, whatever the body says",
			status: http.StatusInternalServerError,
			body:   `[{"email":"from-a-500@example.com","primary":true,"verified":true}]`,
			want:   "",
		},
		{
			name:   "a 401 is not an answer either",
			status: http.StatusUnauthorized,
			body:   `[{"email":"from-a-401@example.com","primary":true,"verified":true}]`,
			want:   "",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := fetchGithubPrimaryEmail(githubEmailsClient(t, tc.status, tc.body))
			if got != tc.want {
				t.Errorf("fetchGithubPrimaryEmail = %q, want %q", got, tc.want)
			}
		})
	}
}

func TestFetchGithubPrimaryEmailOnATransportError(t *testing.T) {
	got := fetchGithubPrimaryEmail(&http.Client{Transport: failingTransport{}})
	if got != "" {
		t.Errorf("fetchGithubPrimaryEmail = %q on a dead network, want \"\"", got)
	}
}

// ── oauthRandomPassword ──────────────────────────────────────────────────────

// An auto-created OAuth account still gets a row in app_users with a password column, and /login
// does not refuse a non-local auth_provider. So this hash is a live credential: if it were a fixed
// or guessable value, every OAuth-created account would share one password that anybody could use
// at the ordinary login form.
func TestOAuthRandomPasswordIsAnUnguessableBcryptHash(t *testing.T) {
	first, err := oauthRandomPassword()
	if err != nil {
		t.Fatalf("oauthRandomPassword: %v", err)
	}
	second, err := oauthRandomPassword()
	if err != nil {
		t.Fatalf("oauthRandomPassword: %v", err)
	}

	// Both errors are returned now rather than dropped, so an empty hash can no longer reach the
	// password column: the caller refuses the whole sign-in instead.
	if first == "" {
		t.Fatal("oauthRandomPassword returned an empty string with no error")
	}
	if !strings.HasPrefix(first, "$2") {
		t.Errorf("not a bcrypt hash: %q", first)
	}
	if len(first) != 60 {
		t.Errorf("hash length = %d, want 60 (a bcrypt hash)", len(first))
	}
	if first == second {
		t.Fatal("two calls produced the same hash — the password is not random")
	}

	// The plaintext is discarded, so the only thing that can be asserted about it is that it is
	// not the value a discarded crypto/rand error would leave behind: 32 zero bytes. If rand.Read
	// ever fails (its error is dropped at oauth.go:222), every account created from then on shares
	// this exact password — so prove today's hash does not verify against it.
	zeroPlain := base64.StdEncoding.EncodeToString(make([]byte, 32))
	if bcrypt.CompareHashAndPassword([]byte(first), []byte(zeroPlain)) == nil {
		t.Error("the generated password is the all-zero fallback that a dropped crypto/rand error " +
			"would produce — every OAuth account would share one known password")
	}
	// And it is not simply the empty password either.
	if bcrypt.CompareHashAndPassword([]byte(first), []byte("")) == nil {
		t.Error("the empty string verifies against the generated hash")
	}
}

// ── URL helpers ──────────────────────────────────────────────────────────────

// These two decide where the browser is sent back to. getFrontendURL in particular is the target of
// every redirect oauthFinish makes, so a wrong default strands the user on a dead page after a
// successful sign-in.
func TestBackendAndFrontendURLDefaults(t *testing.T) {
	t.Setenv("BACKEND_URL", "")
	t.Setenv("FRONTEND_URL", "")
	if got := getBackendURL(); got != "http://localhost:9000" {
		t.Errorf("getBackendURL default = %q", got)
	}
	if got := getFrontendURL(); got != "http://localhost:5173" {
		t.Errorf("getFrontendURL default = %q", got)
	}

	t.Setenv("BACKEND_URL", "https://console.lan/api")
	t.Setenv("FRONTEND_URL", "https://console.lan")
	if got := getBackendURL(); got != "https://console.lan/api" {
		t.Errorf("getBackendURL = %q, want the BACKEND_URL value", got)
	}
	if got := getFrontendURL(); got != "https://console.lan" {
		t.Errorf("getFrontendURL = %q, want the FRONTEND_URL value", got)
	}
}

// ── Provider configs ─────────────────────────────────────────────────────────

// The redirect URL has to match what is registered with the provider byte for byte, and the scope
// list is what the console is allowed to ask for. Both are the kind of thing a refactor changes by
// accident and nobody notices until a live sign-in breaks — or until a widened scope quietly starts
// requesting data this console has no business holding.
func TestProviderConfigsBuildTheExpectedRedirectAndScopes(t *testing.T) {
	t.Setenv("BACKEND_URL", "https://console.lan/api")
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GITHUB_CLIENT_ID", "github-id")
	t.Setenv("LINE_CLIENT_ID", "line-id")

	cases := []struct {
		name         string
		cfg          *oauth2.Config
		wantRedirect string
		wantScopes   []string
		wantClientID string
	}{
		{"google", googleOAuthConfig(), "https://console.lan/api/auth/google/callback",
			[]string{"openid", "email", "profile"}, "google-id"},
		{"github", githubOAuthConfig(), "https://console.lan/api/auth/github/callback",
			[]string{"user:email"}, "github-id"},
		{"line", lineOAuthConfig(), "https://console.lan/api/auth/line/callback",
			[]string{"profile", "openid", "email"}, "line-id"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if tc.cfg.RedirectURL != tc.wantRedirect {
				t.Errorf("RedirectURL = %q, want %q", tc.cfg.RedirectURL, tc.wantRedirect)
			}
			if !reflect.DeepEqual(tc.cfg.Scopes, tc.wantScopes) {
				t.Errorf("Scopes = %v, want %v", tc.cfg.Scopes, tc.wantScopes)
			}
			if tc.cfg.ClientID != tc.wantClientID {
				t.Errorf("ClientID = %q, want %q", tc.cfg.ClientID, tc.wantClientID)
			}
			if tc.cfg.Endpoint.AuthURL == "" || tc.cfg.Endpoint.TokenURL == "" {
				t.Error("the endpoint is incomplete — AuthCodeURL would produce a relative URL")
			}
			if !strings.HasPrefix(tc.cfg.Endpoint.AuthURL, "https://") ||
				!strings.HasPrefix(tc.cfg.Endpoint.TokenURL, "https://") {
				t.Errorf("endpoint is not HTTPS: auth=%q token=%q",
					tc.cfg.Endpoint.AuthURL, tc.cfg.Endpoint.TokenURL)
			}
		})
	}

	// LINE has no package in golang.org/x/oauth2, so its endpoint is hand-written here. Pin the
	// two URLs: a typo in either is a sign-in that fails only in production.
	if lineEndpoint.AuthURL != "https://access.line.me/oauth2/v2.1/authorize" {
		t.Errorf("lineEndpoint.AuthURL = %q", lineEndpoint.AuthURL)
	}
	if lineEndpoint.TokenURL != "https://api.line.me/oauth2/v2.1/token" {
		t.Errorf("lineEndpoint.TokenURL = %q", lineEndpoint.TokenURL)
	}
}

// ── OAuth state (the CSRF defence on the callback) ───────────────────────────

func TestGenerateOAuthStateIsRandomAndNotTheZeroValue(t *testing.T) {
	// 16 random bytes, standard base64url with padding.
	const wantLen = 24

	seen := map[string]bool{}
	for i := 0; i < 64; i++ {
		s, err := generateOAuthState()
		if err != nil {
			t.Fatalf("generateOAuthState: %v", err)
		}
		if len(s) != wantLen {
			t.Fatalf("state %q has length %d, want %d", s, len(s), wantLen)
		}
		if seen[s] {
			t.Fatalf("generateOAuthState repeated %q within 64 calls — the state is predictable "+
				"and the callback's CSRF check is decorative", s)
		}
		seen[s] = true
		if _, err := base64.URLEncoding.DecodeString(s); err != nil {
			t.Fatalf("state %q is not valid base64url: %v", s, err)
		}
	}

	// PHASE 2 ITEM — oauth.go:77: `_, _ = rand.Read(b)` drops crypto/rand's error. On a failure the
	// buffer stays zeroed and every state becomes this one fixed string, which an attacker can
	// simply set as their own oauth_state cookie. crypto/rand cannot be made to fail from a test
	// without changing production code, so this asserts the symptom instead: today's states are
	// never the all-zero value.
	zeroState := base64.URLEncoding.EncodeToString(make([]byte, 16))
	if seen[zeroState] {
		t.Errorf("generateOAuthState produced the all-zero state %q", zeroState)
	}
}

// getCtx aims a handler at a GET the way the router would, with a query string.
func getCtx(t *testing.T, target string) (*gin.Context, *httptest.ResponseRecorder) {
	t.Helper()
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)
	c.Request = httptest.NewRequest(http.MethodGet, target, nil)
	return c, rec
}

func TestSetOAuthStateCookieAttributes(t *testing.T) {
	c, rec := getCtx(t, "/auth/google")
	setOAuthStateCookie(c, "the-state")

	ck := cookieFrom(rec, "oauth_state")
	if ck == nil {
		t.Fatal("no oauth_state cookie was set")
	}
	if ck.Value != "the-state" {
		t.Errorf("value = %q, want the-state", ck.Value)
	}
	if !ck.HttpOnly {
		t.Error("oauth_state is not HttpOnly — script on any page of this origin could read the " +
			"state and forge a matching callback")
	}
	if ck.Path != "/" {
		t.Errorf("path = %q, want / so the callback endpoint receives it", ck.Path)
	}
	if ck.MaxAge != 300 {
		t.Errorf("MaxAge = %d, want 300 — the window in which a callback is accepted", ck.MaxAge)
	}
	if ck.Secure {
		t.Error("Secure set on a plain-HTTP request — the browser would drop the cookie and every " +
			"LAN sign-in would fail with invalid_state")
	}
	// SameSite must not be None (see TestSessionCookieIsNeverSameSiteNone), and must not be Strict
	// either: the callback arrives as a top-level navigation FROM the provider, which Strict would
	// withhold.
	if ck.SameSite == http.SameSiteNoneMode || ck.SameSite == http.SameSiteStrictMode {
		t.Errorf("SameSite = %v; None lets another site drive the flow, Strict withholds the "+
			"cookie on the provider's redirect back", ck.SameSite)
	}

	// Behind a proxy that terminated TLS the cookie must be Secure, or it is sent in the clear.
	sec, secRec := getCtx(t, "/auth/google")
	sec.Request.Header.Set("X-Forwarded-Proto", "https")
	setOAuthStateCookie(sec, "the-state")
	if got := cookieFrom(secRec, "oauth_state"); got == nil || !got.Secure {
		t.Error("oauth_state is not Secure behind an HTTPS proxy")
	}
}

// The callback is a public GET that creates accounts and issues sessions. The state cookie is the
// only thing tying it to a flow this browser actually started, so every way of arriving without a
// matching pair has to be refused.
func TestValidateOAuthState(t *testing.T) {
	cases := []struct {
		name   string
		cookie *string // nil = no cookie at all
		query  string  // raw ?state= value, "" = parameter absent
		want   bool
	}{
		{"no cookie and no state", nil, "", false},
		{"no cookie but a state in the query", nil, "?state=abc", false},
		{"empty cookie, empty query", strPtr(""), "", false},
		{"empty cookie, a state in the query", strPtr(""), "?state=abc", false},
		{"a cookie but no state in the query", strPtr("abc"), "", false},
		{"mismatched", strPtr("abc"), "?state=def", false},
		{"matching but different case", strPtr("Abc"), "?state=abc", false},
		{"cookie is a prefix of the query value", strPtr("abc"), "?state=abcd", false},
		{"query value is a prefix of the cookie", strPtr("abcd"), "?state=abc", false},
		{"matching", strPtr("abc"), "?state=abc", true},
		{"matching, URL-encoded padding", strPtr("ab=="), "?state=ab%3D%3D", true},
		{"a real generated state matches itself", nil, "", true}, // filled in below
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cookieVal, query := tc.cookie, tc.query
			if tc.name == "a real generated state matches itself" {
				s, err := generateOAuthState()
				if err != nil {
					t.Fatalf("generateOAuthState: %v", err)
				}
				cookieVal = &s
				query = "?state=" + url.QueryEscape(s)
			}

			c, _ := getCtx(t, "/auth/google/callback"+query)
			if cookieVal != nil {
				c.Request.AddCookie(&http.Cookie{Name: "oauth_state", Value: *cookieVal})
			}
			if got := validateOAuthState(c); got != tc.want {
				t.Errorf("validateOAuthState = %v, want %v", got, tc.want)
			}
		})
	}
}

// PHASE 2 ITEM — oauth.go:94. The state is not single-use: validateOAuthState reads the cookie and
// never clears it, so the same (state, code) pair is accepted for as long as the 300-second cookie
// lives. A provider `code` is itself single-use, which limits what this buys an attacker, so it is
// recorded rather than argued — but "accepted once" is the property a CSRF token is supposed to
// have, and this test is what will notice when it changes.
func TestValidateOAuthStateIsSingleUse(t *testing.T) {
	state, err := generateOAuthState()
	if err != nil {
		t.Fatalf("generateOAuthState: %v", err)
	}
	c, rec := getCtx(t, "/auth/google/callback?state="+url.QueryEscape(state))
	c.Request.AddCookie(&http.Cookie{Name: "oauth_state", Value: state})

	if !validateOAuthState(c) {
		t.Fatal("a matching pair was refused")
	}

	// The cookie is SPENT: cleared on the way out, so the pair cannot be presented again for the
	// rest of its 300 seconds. Before this it was read and left in place.
	ck := cookieFrom(rec, "oauth_state")
	if ck == nil {
		t.Fatal("validateOAuthState did not clear the state cookie, so the pair stays replayable")
	}
	if ck.Value != "" || ck.MaxAge >= 0 {
		t.Errorf("the state cookie was not expired: value=%q MaxAge=%d", ck.Value, ck.MaxAge)
	}
}

// A callback that arrives with the WRONG state spends the cookie too — otherwise an attacker could
// keep guessing against one live pair.
func TestValidateOAuthStateSpendsTheCookieOnAMismatchToo(t *testing.T) {
	c, rec := getCtx(t, "/auth/google/callback?state=not-the-one")
	c.Request.AddCookie(&http.Cookie{Name: "oauth_state", Value: "the-real-state"})

	if validateOAuthState(c) {
		t.Fatal("a mismatched state was accepted")
	}
	if ck := cookieFrom(rec, "oauth_state"); ck == nil || ck.MaxAge >= 0 {
		t.Error("a failed validation left the state cookie usable for another attempt")
	}
}

// ── Redirect handlers ────────────────────────────────────────────────────────

// The three public entry points. Each has to hand the browser to the provider AND leave behind the
// cookie its own callback will check — a redirect without the cookie makes every sign-in fail with
// invalid_state, and a cookie whose value is not the state in the URL does the same.
func TestProviderRedirectsSetAStateCookieMatchingTheURL(t *testing.T) {
	t.Setenv("BACKEND_URL", "https://console.lan/api")
	t.Setenv("GOOGLE_CLIENT_ID", "google-id")
	t.Setenv("GITHUB_CLIENT_ID", "github-id")
	t.Setenv("LINE_CLIENT_ID", "line-id")

	cases := []struct {
		name     string
		handler  gin.HandlerFunc
		wantHost string
	}{
		{"google", OAuthGoogleRedirect, "accounts.google.com"},
		{"github", OAuthGithubRedirect, "github.com"},
		{"line", OAuthLineRedirect, "access.line.me"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c, rec := getCtx(t, "/auth/"+tc.name)
			tc.handler(c)

			if rec.Code != http.StatusTemporaryRedirect {
				t.Fatalf("status = %d, want 307: %s", rec.Code, rec.Body.String())
			}
			loc := rec.Header().Get("Location")
			if loc == "" {
				t.Fatal("no Location header")
			}
			u, err := url.Parse(loc)
			if err != nil {
				t.Fatalf("Location is not a URL: %v", err)
			}
			if u.Host != tc.wantHost {
				t.Errorf("redirected to %q, want host %q", u.Host, tc.wantHost)
			}
			if u.Scheme != "https" {
				t.Errorf("redirect scheme = %q, want https", u.Scheme)
			}

			ck := cookieFrom(rec, "oauth_state")
			if ck == nil || ck.Value == "" {
				t.Fatal("the redirect set no oauth_state cookie — the callback would refuse every " +
					"sign-in with invalid_state")
			}
			if got := u.Query().Get("state"); got != ck.Value {
				t.Errorf("state in the URL = %q but the cookie carries %q — they must be the same "+
					"value for validateOAuthState to pass", got, ck.Value)
			}
			if u.Query().Get("redirect_uri") != "https://console.lan/api/auth/"+tc.name+"/callback" {
				t.Errorf("redirect_uri = %q", u.Query().Get("redirect_uri"))
			}
			// Two visits must not share a state, or one user's cookie would validate another's
			// callback.
			c2, rec2 := getCtx(t, "/auth/"+tc.name)
			tc.handler(c2)
			if other := cookieFrom(rec2, "oauth_state"); other != nil && other.Value == ck.Value {
				t.Error("two redirects issued the same state")
			}
		})
	}
}

// ── Callback handlers: the state check comes first ───────────────────────────

// The three callbacks are public GETs that end in oauthFinish — an account create and a session.
// The state check is the first thing each does, and it is the only thing that establishes the
// callback belongs to a flow this browser started. A callback that reached the token exchange
// without it would let any site drive a sign-in on a victim's browser.
//
// This is as far as a callback can be driven without a live provider: the token endpoints are
// fixed URLs inside golang.org/x/oauth2's google/github endpoints, so nothing past Exchange is
// reachable without changing production code — which is not something a test may do. The branch
// tested here is the one that matters most anyway.
func TestCallbacksRefuseAMissingOrMismatchedState(t *testing.T) {
	const frontend = "https://console.test.invalid"

	handlers := map[string]gin.HandlerFunc{
		"google": OAuthGoogleCallback,
		"github": OAuthGithubCallback,
		"line":   OAuthLineCallback,
	}
	arrivals := []struct {
		name   string
		query  string
		cookie *string
	}{
		{"no cookie, no state", "", nil},
		{"no cookie but a state (a CSRF attempt)", "?code=abc&state=attacker-chosen", nil},
		{"a cookie but no state", "?code=abc", strPtr("the-real-state")},
		{"mismatched state", "?code=abc&state=attacker-chosen", strPtr("the-real-state")},
		{"empty cookie and empty state", "?code=abc&state=", strPtr("")},
	}

	for provider, handler := range handlers {
		for _, a := range arrivals {
			t.Run(provider+"/"+a.name, func(t *testing.T) {
				t.Setenv("FRONTEND_URL", frontend)

				c, rec := getCtx(t, "/auth/"+provider+"/callback"+a.query)
				if a.cookie != nil {
					c.Request.AddCookie(&http.Cookie{Name: "oauth_state", Value: *a.cookie})
				}
				handler(c)

				if rec.Code != http.StatusTemporaryRedirect {
					t.Fatalf("status = %d, want 307: %s", rec.Code, rec.Body.String())
				}
				if got := rec.Header().Get("Location"); got != frontend+"?oauth_error=invalid_state" {
					t.Fatalf("Location = %q, want %q", got, frontend+"?oauth_error=invalid_state")
				}
				// Refused before anything was issued.
				if ck := cookieFrom(rec, "auth_token"); ck != nil && ck.Value != "" {
					t.Error("a callback refused for a bad state still set an auth_token cookie")
				}
			})
		}
	}
}

func strPtr(s string) *string { return &s }
