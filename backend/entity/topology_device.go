package entity

import "time"

// TopologyDevice = an auxiliary device a user pins onto the Topology map so the FIREWALL pings it on
// a schedule and the 3D scene shows whether it is up.
//
// This is NOT a NetworkDevice. A NetworkDevice is something this console LOGS IN TO and manages
// (credentials, backups, REST). A TopologyDevice is something the console only ever looks AT from
// one of its firewalls — a switch, an access point, a server, an endpoint — identified by an IP the
// firewall can reach. It has no credentials and this platform never connects to it directly: the
// reachability check is `execute ping <ip>` run on the firewall named by DeviceID, so the answer is
// "can the firewall see it", which is the question a network map is actually asking.
//
// ── Per user ──────────────────────────────────────────────────────────────────
// OwnerUserID scopes the row to the person who added it. Two operators looking at the same firewall
// keep their own sets of pinned devices; the map each of them sees is theirs. (An admin may list
// every row — see controller/topologydevice — but ownership is still what a create/edit/delete is
// checked against.)
type TopologyDevice struct {
	Base

	// OwnerUserID is the AppUser who added this device. Every list/create/edit/delete is scoped to
	// it, so one user's pins never appear on another's map.
	OwnerUserID uint `gorm:"index;not null" json:"owner_user_id"`

	// DeviceID is the FIREWALL (entity.NetworkDevice) that does the pinging. Default 1 is the lab
	// device; a deployment with several firewalls lets the user pick which one has line of sight to
	// the target.
	DeviceID uint `gorm:"index;not null;default:1" json:"device_id"`

	Name        string `gorm:"not null;index" json:"name" valid:"required~Name is required"`
	Description string `json:"description" valid:"-"`

	// IPAddress is what the firewall pings. Validated as a real IP in the controller (net.ParseIP)
	// rather than by a tag, because the value is about to be pasted onto a CLI on a live firewall and
	// an allow-list of real addresses is the only safe guard — see services.ValidateDiagTarget.
	IPAddress string `gorm:"not null" json:"ip_address" valid:"required~IP address is required"`

	// Kind drives the glyph/shape the 3D scene draws. One of TopologyDeviceKinds.
	Kind string `gorm:"not null;default:'other'" json:"kind" valid:"-"`

	// PingIntervalSeconds is how often the firewall re-pings this device. Clamped to
	// [MinPingInterval, MaxPingInterval] on write. The scheduler ticks every 60s, so an interval
	// below the tick is honoured at tick granularity, not faster — a firewall locks an admin account
	// after three failed logins, so pinging is deliberately gentle.
	PingIntervalSeconds int `gorm:"not null;default:60" json:"ping_interval_seconds" valid:"-"`

	// Enabled turns the scheduled ping on or off without deleting the pin. A disabled device still
	// shows on the map, drawn "unknown", but is never pinged.
	Enabled bool `gorm:"not null;default:true" json:"enabled"`

	// ── Last reading (written by the ping runner) ───────────────────────────────
	LastStatus      string     `gorm:"not null;default:'unknown'" json:"last_status"` // up | down | unknown
	LastLatencyMs   *float64   `json:"last_latency_ms,omitempty"`
	LastLossPercent *int       `json:"last_loss_percent,omitempty"`
	LastCheckedAt   *time.Time `gorm:"index" json:"last_checked_at,omitempty"`
	// LastError carries why a check could not run at all (the firewall was unreachable, no automation
	// account) as opposed to the target being down. Shown in the manage list, never on the map.
	LastError string `json:"last_error,omitempty"`
}

// TopologyDeviceKinds is the closed set the form offers and the scene can draw. "other" is the
// fallback for anything not listed, so an unknown value is drawn rather than dropped.
var TopologyDeviceKinds = []string{
	"switch", "router", "endpoint", "access-point", "server", "firewall", "other",
}

const (
	// MinPingInterval / MaxPingInterval bound the schedule. The floor matches gentleness toward the
	// firewall's lockout threshold; the ceiling keeps a "pinged" device from sitting unknown for a
	// day because somebody typed a large number.
	MinPingInterval = 30
	MaxPingInterval = 86400

	TopologyStatusUp      = "up"
	TopologyStatusDown    = "down"
	TopologyStatusUnknown = "unknown"
)

// ValidTopologyKind reports whether k is one of the known kinds.
func ValidTopologyKind(k string) bool {
	for _, v := range TopologyDeviceKinds {
		if v == k {
			return true
		}
	}
	return false
}
