package services

import (
	"network_automation/services/platform"
	"strings"

	"gorm.io/gorm"
	"network_automation/entity"
)

// MaxPasswordHistory is the hard ceiling on how many old hashes are kept per user, whatever
// password_history_count says. Every entry costs one bcrypt comparison on each password change,
// and at cost 12 that is tens of milliseconds apiece.
const MaxPasswordHistory = 24

// passwordHistorySeparator joins the stored hashes. A bcrypt hash is a fixed 60-character string
// from a fixed alphabet and can never contain a newline, so splitting on one cannot corrupt an
// entry.
//
// Why one column instead of one row per password: entity.PasswordHistory carries a uniqueIndex on
// app_user_id, so the table physically holds a single row per user. Keeping the list inside that
// row means more than one previous password can be remembered without changing the table shape or
// migrating anything — a value written by the old single-hash code reads back as a list of one.
const passwordHistorySeparator = "\n"

// IsPasswordReused reports whether newPassword matches ANY of the user's recent passwords, up to
// PasswordPolicy.HistoryCount of them.
//
// It used to compare against exactly one, which let anyone cycle between two passwords forever.
func IsPasswordReused(db *gorm.DB, userID uint, newPassword string) bool {
	keep := GetPasswordPolicy(db).HistoryCount
	hashes := loadPasswordHistory(db, userID)
	if keep < len(hashes) {
		hashes = hashes[:keep]
	}
	return matchesAnyHash(newPassword, hashes)
}

// SavePasswordHistory records hashedPassword as the user's most recent password and drops anything
// past the configured depth.
func SavePasswordHistory(db *gorm.DB, userID uint, hashedPassword string) {
	keep := GetPasswordPolicy(db).HistoryCount
	stored := joinPasswordHistory(prependPasswordHistory(loadPasswordHistory(db, userID), hashedPassword, keep))

	// Try update first; if no row exists, create a new one.
	result := db.Model(&entity.PasswordHistory{}).
		Where("app_user_id = ?", userID).
		Updates(map[string]interface{}{"password": stored})
	if result.RowsAffected == 0 {
		db.Create(&entity.PasswordHistory{AppUserID: userID, Password: stored})
	}
}

func loadPasswordHistory(db *gorm.DB, userID uint) []string {
	var history entity.PasswordHistory
	if err := db.Where("app_user_id = ?", userID).First(&history).Error; err != nil {
		return nil // no history on record — allow the password
	}
	return splitPasswordHistory(history.Password)
}

// splitPasswordHistory reads the stored column, newest first. A column written before this change
// holds a single bare hash and yields a one-entry list.
func splitPasswordHistory(stored string) []string {
	parts := strings.Split(stored, passwordHistorySeparator)
	out := make([]string, 0, len(parts))
	for _, h := range parts {
		if h = strings.TrimSpace(h); h != "" {
			out = append(out, h)
		}
	}
	return out
}

func joinPasswordHistory(hashes []string) string {
	return strings.Join(hashes, passwordHistorySeparator)
}

// prependPasswordHistory puts newHash at the front and truncates the list to keep entries, clamped
// into [1, MaxPasswordHistory] so a nonsense configured value cannot switch history off or make
// every password change arbitrarily slow.
func prependPasswordHistory(existing []string, newHash string, keep int) []string {
	if keep < 1 {
		keep = 1
	}
	if keep > MaxPasswordHistory {
		keep = MaxPasswordHistory
	}
	out := make([]string, 0, keep)
	out = append(out, newHash)
	for _, h := range existing {
		if len(out) == keep {
			break
		}
		out = append(out, h)
	}
	return out
}

func matchesAnyHash(plain string, hashes []string) bool {
	for _, h := range hashes {
		if platform.CheckPasswordHash(plain, h) {
			return true
		}
	}
	return false
}
