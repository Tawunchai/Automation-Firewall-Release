package user

import (
	"strings"
	"testing"
)

// ValidateAvatar is the only thing standing between the profile column and ~10 MB of arbitrary
// base64 (entity.AppUser.Profile is a TEXT column tagged `valid:"-"`, and the sole other limit is
// the application-wide 10 MB body cap). It is also the only place the media type is pinned, and
// the field is rendered straight into an <img src> — so "data:text/html;base64,…" being refused is
// the difference between a picture and stored content of the author's choosing.
//
// It runs on both write paths (CreateUser and both update handlers) and was at 0%.

func TestValidateAvatarAcceptsWhatTheAppActuallyStores(t *testing.T) {
	cases := map[string]string{
		// Clearing the avatar is how somebody removes theirs — it must not be an error.
		"empty":                   "",
		"blank":                   "   ",
		"a PNG data URI":          "data:image/png;base64,iVBORw0KGgo=",
		"a JPEG data URI":         "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
		"the jpg spelling":        "data:image/jpg;base64,/9j/4AAQSkZJRg==",
		"a WebP data URI":         "data:image/webp;base64,UklGRg==",
		"a GIF data URI":          "data:image/gif;base64,R0lGODlh",
		"an https URL":            "https://cdn.example.invalid/avatars/42.png",
		"an http URL":             "http://cdn.example.invalid/avatars/42.png",
		"a data URI at the limit": "data:image/png;base64," + strings.Repeat("A", maxAvatarBytes-len("data:image/png;base64,")),
	}
	for name, profile := range cases {
		t.Run(name, func(t *testing.T) {
			if err := ValidateAvatar(profile); err != nil {
				t.Errorf("ValidateAvatar refused %s: %v", name, err)
			}
		})
	}
}

func TestValidateAvatarRefusesWhatItMustNotServe(t *testing.T) {
	cases := map[string]struct {
		profile  string
		mentions string
	}{
		"an HTML data URI": {
			"data:text/html;base64," + strings.Repeat("A", 64), "PNG",
		},
		"an SVG data URI — a script container, not a picture": {
			"data:image/svg+xml;base64," + strings.Repeat("A", 64), "PNG",
		},
		"a bare blob of base64 with no type at all": {
			strings.Repeat("A", 2048), "PNG",
		},
		"plain text parked in the column": {
			"notes to self: remember the thing", "PNG",
		},
		"one byte past the cap": {
			"data:image/png;base64," + strings.Repeat("A", maxAvatarBytes), "too large",
		},
		"a URL past the cap": {
			"https://cdn.example.invalid/" + strings.Repeat("a", maxAvatarBytes), "too large",
		},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			err := ValidateAvatar(tc.profile)
			if err == nil {
				t.Fatalf("ValidateAvatar accepted %s", name)
			}
			// The message reaches the user verbatim in a 400, so it has to say which rule was hit.
			if !strings.Contains(err.Error(), tc.mentions) {
				t.Errorf("error = %q, which does not mention %q", err.Error(), tc.mentions)
			}
		})
	}
}

// The size rule is checked before the type rule, so an oversized payload is refused even when it
// claims to be a PNG — otherwise the cap could be walked past with a valid-looking prefix.
func TestValidateAvatarChecksSizeBeforeType(t *testing.T) {
	err := ValidateAvatar("data:image/png;base64," + strings.Repeat("A", maxAvatarBytes))
	if err == nil || !strings.Contains(err.Error(), "too large") {
		t.Fatalf("an oversized PNG data URI gave %v, want the size refusal", err)
	}
}
