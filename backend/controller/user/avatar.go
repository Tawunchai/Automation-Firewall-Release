package user

import (
	"errors"
	"strings"
)

// Avatar validation.
//
// Profile pictures are stored as a base64 data URI in the user row (entity.AppUser.Profile, a TEXT
// column tagged `valid:"-"` — validation explicitly skipped). Nothing bounded them: the only limit
// was the application-wide 10 MB body cap in main.go, so a single user could park ~10 MB of base64
// in their row.
//
// That is not a storage problem, it is a bandwidth one. The column is returned by /auth/me on every
// page load AND by /users for every row on the admin page, so fifty users with large avatars turn
// one list into a payload measured in hundreds of megabytes — for a page showing 32-pixel circles.
//
// Two rules, and they are cheap:
//
//	· at most maxAvatarBytes of encoded data, which is generous for an avatar and ruinous for
//	  nothing;
//	· it must actually be an image data URI, so the field cannot be used as free storage for
//	  arbitrary text.

// maxAvatarBytes caps the whole data URI, base64 expansion included.
//
// 256 KB of base64 is roughly 190 KB of image — far more than a rendered avatar needs, and small
// enough that a full user list stays a normal HTTP response.
const maxAvatarBytes = 256 * 1024

// allowedAvatarPrefixes are the data-URI headers accepted. Restricting the media type matters as
// much as the size: `data:text/html;base64,…` in a field the frontend puts in an <img src> is a
// stored payload waiting for somewhere that renders it differently.
var allowedAvatarPrefixes = []string{
	"data:image/png;base64,",
	"data:image/jpeg;base64,",
	"data:image/jpg;base64,",
	"data:image/webp;base64,",
	"data:image/gif;base64,",
}

// ValidateAvatar checks a profile picture. An empty value is fine — the avatar is optional and
// clearing it is how somebody removes theirs.
func ValidateAvatar(profile string) error {
	profile = strings.TrimSpace(profile)
	if profile == "" {
		return nil
	}

	if len(profile) > maxAvatarBytes {
		return errors.New("the profile picture is too large — please use an image under 190 KB")
	}

	// A bare URL is still accepted: seeded accounts carry one, and an avatar hosted elsewhere is a
	// reasonable thing for a deployment to configure. It is the data URI that needs its type pinned.
	if strings.HasPrefix(profile, "http://") || strings.HasPrefix(profile, "https://") {
		return nil
	}

	for _, prefix := range allowedAvatarPrefixes {
		if strings.HasPrefix(profile, prefix) {
			return nil
		}
	}
	return errors.New("the profile picture must be a PNG, JPEG, WebP or GIF image")
}
