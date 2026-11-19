package entity

import "time"

// MetricSample is one number read off one firewall at one moment.
//
// ── Why this table exists ────────────────────────────────────────────────────
//
// Every measurement in this console is "ask the device now". SD-WAN returns one latency reading,
// for this second; policy statistics return a hit counter as it stands; tunnel health returns up or
// down. None of it is kept, so nothing can be drawn over time and Report Studio can only ever
// describe the present. The Dashboard has charts purely because FortiOS itself keeps 24 hours of
// CPU and memory — and 24 hours is all it keeps.
//
// So: one table, sampled on the scheduler's own tick, and every chart in the console becomes
// possible without another round trip to the firewall.
//
// ── The shape, and why it is narrow ──────────────────────────────────────────
//
// One row per (device, kind, subject) per sample, carrying a single float. A wide table with a
// column per measurement would need a migration for every new one; this needs a constant. The cost
// is that a reader must know what Value means for a Kind, which is what the Kind constants in
// services/metrics.go document.
//
// Subject is what the number is ABOUT, and its meaning depends on Kind: an SD-WAN member's
// interface, a tunnel's name, a policy id, or "" for something that describes the whole device.
type MetricSample struct {
	ID uint `gorm:"primarykey" json:"id"`

	NetworkDeviceID uint `gorm:"index:idx_metric_lookup,priority:1;not null" json:"network_device_id"`

	// Kind is what was measured — see services.Metric* for the list and each one's unit.
	Kind string `gorm:"index:idx_metric_lookup,priority:2;size:40;not null" json:"kind"`

	// Subject is which thing it was measured on: an interface, a tunnel, a policy id, or "".
	Subject string `gorm:"index:idx_metric_lookup,priority:3;size:120;not null" json:"subject"`

	// At is when the sample was taken, UTC. Fourth in the composite index because every query is
	// "this device, this kind, this subject, over this window" — and a range scan wants the time
	// last so the three equalities can narrow first.
	At time.Time `gorm:"index:idx_metric_lookup,priority:4;not null" json:"at"`

	Value float64 `gorm:"not null" json:"value"`

	// No gorm.Model / Base here on purpose. There is no soft delete — retention deletes these rows
	// for good — and a CreatedAt beside At would be the same timestamp stored twice, on the table
	// most likely to have millions of rows.
}

func (MetricSample) TableName() string { return "metric_samples" }
