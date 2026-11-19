package policyobject

import (
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// Security Profiles ▸ Web Rating Overrides — CRUD over webfilter/ftgd-local-rating.
//
// The one thing this page gets wrong if nothing watches it: `rating` is a category **ID**, not a
// category name. The dialog's two dropdowns resolve to a number, and a name sent in its place is
// refused by the device with -56 ("unknown category") long after the user has left the form. The
// validation below catches it at the door — but deliberately does NOT check the number against a
// list written down here, because the valid IDs are the device's own taxonomy plus its custom
// categories, and both change without this code.

func TestValidateWebRatingKeepsTheCategoryANumber(t *testing.T) {
	cases := []struct {
		name     string
		in       webRatingInput
		wantSays string // "" = must be accepted
	}{
		{name: "a real override", in: webRatingInput{URL: "example.com", Rating: "52"}},
		{name: "no URL", in: webRatingInput{Rating: "52"}, wantSays: "a URL is required"},
		{name: "a URL of spaces", in: webRatingInput{URL: "   ", Rating: "52"}, wantSays: "a URL is required"},
		{
			name:     "a URL longer than the table stores",
			in:       webRatingInput{URL: strings.Repeat("a", 512), Rating: "52"},
			wantSays: "511 characters",
		},
		{name: "no category", in: webRatingInput{URL: "example.com"}, wantSays: "choose the category"},
		{
			// THE one: the category NAME instead of its id.
			name:     "a category name instead of its id",
			in:       webRatingInput{URL: "example.com", Rating: "Business"},
			wantSays: "must be a category ID",
		},
		{
			name:     "a category id of zero names nothing",
			in:       webRatingInput{URL: "example.com", Rating: "0"},
			wantSays: "must be a category ID",
		},
		{
			name:     "a negative category id",
			in:       webRatingInput{URL: "example.com", Rating: "-1"},
			wantSays: "must be a category ID",
		},
		{
			// 511 exactly is the limit, not past it.
			name: "a URL at the limit is accepted",
			in:   webRatingInput{URL: strings.Repeat("a", 511), Rating: "52"},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, err := validateWebRating(tc.in)
			if tc.wantSays == "" {
				if err != nil {
					t.Fatalf("refused a valid override: %v", err)
				}
				// A new override is enabled, matching the CMDB default and the dialog.
				if !got.Status {
					t.Error("an override with no status reached the device disabled")
				}
				return
			}
			if err == nil {
				t.Fatalf("accepted it — wanted a refusal saying %q", tc.wantSays)
			}
			if !strings.Contains(err.Error(), tc.wantSays) {
				t.Fatalf("refused with %q, which does not say %q", err, tc.wantSays)
			}
		})
	}
}

func TestValidateWebRatingTrimsAndKeepsAnExplicitOff(t *testing.T) {
	off := false
	got, err := validateWebRating(webRatingInput{
		URL: "  example.com  ", Rating: " 52 ", Comment: "  blocked by policy  ", Status: &off,
	})
	if err != nil {
		t.Fatalf("refused a valid override: %v", err)
	}
	if got.URL != "example.com" || got.Rating != "52" || got.Comment != "blocked by policy" {
		t.Fatalf("the form was not trimmed on its way to the device: %+v", got)
	}
	if got.Status {
		t.Error("an explicit status:false was sent to the device as enabled")
	}
}

// ── the gate ────────────────────────────────────────────────────────────────

// Every write is admin-only and is refused before a session is opened — these handlers check the
// role first, which is why no database is needed to prove it.
func TestWebRatingWritesRefuseAPlainUserWithoutTouchingTheDevice(t *testing.T) {
	body := `{"url":"example.com","rating":"52"}`

	cases := []struct {
		name    string
		method  string
		tail    string
		body    string
		params  []param2
		handler gin.HandlerFunc
	}{
		{"create", http.MethodPost, "web-rating-overrides", body, nil, DeviceCreateWebRatingOverride},
		{"update", http.MethodPut, "web-rating-overrides/example.com", body,
			[]param2{{"url", "example.com"}}, DeviceUpdateWebRatingOverride},
		{"delete", http.MethodDelete, "web-rating-overrides/example.com", "",
			[]param2{{"url", "example.com"}}, DeviceDeleteWebRatingOverride},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{}
			withDeviceClient(t, stub, nil)
			c, rec := roleRequest(tc.method, tc.tail, "user", tc.body, params2(tc.params)...)
			tc.handler(c)

			coverWantStatus(t, rec, http.StatusForbidden)
			coverUntouched(t, stub)
		})
	}
}

// A body that does not validate is refused before the session too: these handlers bind and
// validate first on purpose, so a 400 never costs a login against the firewall.
func TestWebRatingWritesRefuseAnInvalidBodyBeforeOpeningASession(t *testing.T) {
	stub := &coverStub{}
	withDeviceClient(t, stub, nil)

	c, rec := roleRequest(http.MethodPost, "web-rating-overrides", "admin", `{"url":"example.com","rating":"Business"}`)
	DeviceCreateWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = roleRequest(http.MethodPut, "web-rating-overrides/example.com", "admin", `{"rating":"52"}`,
		param("url", "example.com"))
	DeviceUpdateWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = roleRequest(http.MethodPost, "web-rating-overrides", "admin", `{"url":`)
	DeviceCreateWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	// The lookup is a read behind a POST, so it is not admin-gated — but an empty URL is still
	// the caller's mistake, answered before a session.
	c, rec = roleRequest(http.MethodPost, "web-rating-lookup", "user", `{"url":"  "}`)
	DeviceLookupWebRating(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = roleRequest(http.MethodPost, "web-rating-lookup", "user", `{`)
	DeviceLookupWebRating(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	coverUntouched(t, stub)
}

// ── the handlers ────────────────────────────────────────────────────────────

func TestWebRatingCRUDAddressesTheRightOverride(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		ratings:   []services.WebRatingOverride{{URL: "example.com", Rating: "52", Status: true}},
		ratingHit: services.WebRatingLookup{URL: "example.com"},
	}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "web-rating-overrides", device.ID, testAdminUserID, "admin")
	DeviceListWebRatingOverrides(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodGet, "web-rating-overrides/example.com", device.ID, testAdminUserID, "admin", "",
		param("url", "example.com"))
	DeviceGetWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusOK)

	// The dropdowns' datasource. It cannot fail — the client answers with what it has, licensed
	// or not — so the handler has no error branch and the page always gets a tree to draw.
	c, rec = deviceRequest(t, http.MethodGet, "web-rating-metadata", device.ID, testAdminUserID, "admin")
	DeviceGetWebRatingMetadata(c)
	coverWantStatus(t, rec, http.StatusOK)

	c, rec = deviceJSONRequest(t, http.MethodPost, "web-rating-overrides", device.ID, testAdminUserID, "admin",
		`{"url":"shop.example.com","rating":"18","comment":"retail"}`)
	DeviceCreateWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusCreated)
	if stub.gotRating.Rating != "18" {
		t.Fatalf("the category id did not reach the device: %+v", stub.gotRating)
	}

	// :url is the key the form was LOADED with; a different URL in the body is a rename, and the
	// device has to be told which object to apply it to.
	c, rec = deviceJSONRequest(t, http.MethodPut, "web-rating-overrides/shop.example.com", device.ID, testAdminUserID, "admin",
		`{"url":"store.example.com","rating":"18"}`, param("url", "shop.example.com"))
	DeviceUpdateWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("UpdateWebRatingOverride shop.example.com") {
		t.Fatalf("the rename addressed the wrong object: %v", stub.calls)
	}
	if stub.gotRating.URL != "store.example.com" {
		t.Fatalf("the new URL did not reach the device: %+v", stub.gotRating)
	}

	c, rec = deviceJSONRequest(t, http.MethodDelete, "web-rating-overrides/store.example.com", device.ID, testAdminUserID, "admin", "",
		param("url", "store.example.com"))
	DeviceDeleteWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusOK)
	if !stub.saw("DeleteWebRatingOverride store.example.com") {
		t.Fatalf("the delete did not name the override: %v", stub.calls)
	}

	c, rec = deviceJSONRequest(t, http.MethodPost, "web-rating-lookup", device.ID, testPlainUserID, "user",
		`{"url":"example.com"}`)
	grantDevice(t, device.ID)
	DeviceLookupWebRating(c)
	coverWantStatus(t, rec, http.StatusOK)
}

// What the firewall said. -56 (the category the device does not know) is exactly the case this
// page's validation cannot catch, so it has to arrive as a refusal rather than as "down".
func TestWebRatingWritesPassTheFirewallsRefusalThrough(t *testing.T) {
	device := handlerTestDevice(t)

	for _, tc := range coverRefusals {
		t.Run(tc.name, func(t *testing.T) {
			stub := &coverStub{writeErr: tc.err}
			withDeviceClient(t, stub, nil)

			c, rec := deviceJSONRequest(t, http.MethodPost, "web-rating-overrides", device.ID, testAdminUserID, "admin",
				`{"url":"example.com","rating":"52"}`)
			DeviceCreateWebRatingOverride(c)
			coverCheckRefusal(t, rec, tc.want, tc.wantCode)
		})
	}
}

// Unreadable is not empty, and one override that is not there is a 404 rather than a 502.
func TestWebRatingReadsSeparateUnreachableFromAbsent(t *testing.T) {
	device := handlerTestDevice(t)

	down := &coverStub{readErr: errTransport{}}
	withDeviceClient(t, down, nil)
	c, rec := deviceRequest(t, http.MethodGet, "web-rating-overrides", device.ID, testAdminUserID, "admin")
	DeviceListWebRatingOverrides(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	c, rec = deviceJSONRequest(t, http.MethodPost, "web-rating-lookup", device.ID, testAdminUserID, "admin",
		`{"url":"example.com"}`)
	DeviceLookupWebRating(c)
	coverWantStatus(t, rec, http.StatusBadGateway)

	empty := &coverStub{}
	withDeviceClient(t, empty, nil)
	c, rec = deviceJSONRequest(t, http.MethodGet, "web-rating-overrides/ghost.example.com", device.ID, testAdminUserID, "admin", "",
		param("url", "ghost.example.com"))
	DeviceGetWebRatingOverride(c)
	coverWantStatus(t, rec, http.StatusNotFound)
}
