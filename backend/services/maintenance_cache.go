package services

import (
	"errors"
	"strconv"
	"sync"
	"time"

	"gorm.io/gorm"

	"network_automation/entity"
)

// A tiny read-through cache for the two system_config rows the auth middleware consults.
//
// Why: middleware.Authorizes runs on EVERY authenticated request and, for any non-admin caller,
// used to issue two extra queries — `maintenance_mode` and `maintenance_active_at` — on top of
// the session lookup. Three round trips per request for a flag that changes when an admin clicks
// a button, perhaps twice a month. Opening the Firewall Policy create page fires five requests in
// parallel, so that page alone paid ten queries for an answer that is the same every time.
//
// Correctness comes from two directions, not one:
//   - Toggle calls InvalidateMaintenanceCache, so a flip takes effect on the very next request.
//   - The TTL is the backstop for anything that changes the row WITHOUT going through Toggle —
//     a second backend instance, or someone editing the table by hand. It is deliberately much
//     shorter than the 60-second grace period, so a stale read can never outlive the window in
//     which maintenance mode is not yet blocking anyone.
//
// The cache lives in services, not in the maintenance controller, because both the controller and
// the middleware need it and services cannot import config (that cycle is why package jobs
// exists). The caller passes the handle in.

const (
	MaintenanceKey         = "maintenance_mode"
	MaintenanceActiveAtKey = "maintenance_active_at"

	// maintenanceCacheTTL bounds how long a change made outside Toggle can go unnoticed.
	maintenanceCacheTTL = 5 * time.Second
)

// MaintenanceState is everything a caller needs to decide whether to block a request.
type MaintenanceState struct {
	// Enabled is the maintenance_mode flag.
	Enabled bool
	// ActiveAt is the unix second at which blocking starts. Requests before it fall inside the
	// grace period. Zero means "no grace period recorded" — block immediately.
	ActiveAt int64
}

// Blocking reports whether a non-admin request should be refused right now.
func (s MaintenanceState) Blocking(now time.Time) bool {
	return s.Enabled && now.Unix() >= s.ActiveAt
}

// GraceSecondsRemaining is how long is left before blocking starts (0 once it has).
func (s MaintenanceState) GraceSecondsRemaining(now time.Time) int {
	if !s.Enabled {
		return 0
	}
	if rem := int(s.ActiveAt - now.Unix()); rem > 0 {
		return rem
	}
	return 0
}

var maintenanceCache struct {
	mu       sync.Mutex
	state    MaintenanceState
	loadedAt time.Time
	valid    bool
}

// loadMaintenanceState is the database read, indirected so tests can drive the cache's TTL,
// invalidation and error handling without a live Postgres. Production never replaces it.
// (Same pattern as sshRunCommand and dialTimeout elsewhere in this package.)
var loadMaintenanceState = readMaintenanceState

// MaintenanceStatus returns the current state, reading the database at most once per
// maintenanceCacheTTL.
//
// A database error is reported to the caller rather than cached: the middleware's existing rule
// is to fail OPEN on a config read it cannot complete (a broken config table must not lock every
// user out), and caching a failure would extend one blip into a five-second outage of that rule.
// A missing row is not an error — it means maintenance mode has never been switched on.
func MaintenanceStatus(db *gorm.DB) (MaintenanceState, error) {
	maintenanceCache.mu.Lock()
	defer maintenanceCache.mu.Unlock()

	// The lock is held across the refresh on purpose: it collapses a burst of parallel requests
	// arriving on a cold cache into ONE query instead of one each.
	if maintenanceCache.valid && time.Since(maintenanceCache.loadedAt) < maintenanceCacheTTL {
		return maintenanceCache.state, nil
	}

	state, err := loadMaintenanceState(db)
	if err != nil {
		return MaintenanceState{}, err
	}

	maintenanceCache.state = state
	maintenanceCache.loadedAt = time.Now()
	maintenanceCache.valid = true
	return state, nil
}

// readMaintenanceState fetches both rows in a single query. Two round trips for two rows of the
// same table was the other half of the cost.
func readMaintenanceState(db *gorm.DB) (MaintenanceState, error) {
	var rows []entity.SystemConfig
	err := db.Where("key IN ?", []string{MaintenanceKey, MaintenanceActiveAtKey}).Find(&rows).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return MaintenanceState{}, err
	}
	return stateFromRows(rows), nil
}

// stateFromRows maps the config rows onto the state. Kept separate from the query so the parsing
// rules — including what an absent or malformed row means — can be tested directly.
//
// A row that will not parse leaves ActiveAt at zero, which reads as "no grace period": maintenance
// mode blocks immediately. That is the safe direction. The opposite default would let a corrupt
// timestamp keep the gate open.
func stateFromRows(rows []entity.SystemConfig) MaintenanceState {
	var state MaintenanceState
	for _, row := range rows {
		switch row.Key {
		case MaintenanceKey:
			state.Enabled = row.Value == "true"
		case MaintenanceActiveAtKey:
			if n, convErr := strconv.ParseInt(row.Value, 10, 64); convErr == nil {
				state.ActiveAt = n
			}
		}
	}
	return state
}

// InvalidateMaintenanceCache drops the cached state so the next read hits the database.
// Toggle must call this, or a flip would take up to maintenanceCacheTTL to be noticed.
func InvalidateMaintenanceCache() {
	maintenanceCache.mu.Lock()
	maintenanceCache.valid = false
	maintenanceCache.mu.Unlock()
}
