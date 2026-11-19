package services

import (
	"fmt"
	"net/url"
)

// Fleet Apply — push one object definition to several devices at once, previewing per device
// whether something by that name already exists before anything is sent.
//
// ── Scope, and why it stops here ─────────────────────────────────────────────
//
// Five resource types, deliberately: simple, single-table, NAME-keyed CMDB objects with no
// ordering and no approval gate (RequiresApproval returns false for all five — see
// changerequest_gate.go). Firewall policies, virtual IPs and security profiles are NOT here even
// though they are otherwise simple, because pushing one of those to N devices at once raises a
// question Fleet Apply does not answer — where does a new policy go in a rule base that already
// differs per device, and who approves N separate gated writes in one click — and bolting that onto
// this feature would ship both halves badly. Static routes are also excluded despite being simple:
// they are keyed by a device-assigned sequence number, not a name, so "does an equivalent route
// already exist" cannot be answered by matching keys the way it can for these five.
//
// ── How a push actually reaches the device ───────────────────────────────────
//
// Preview reads live, via the same services.FortiClient.SnapshotCMDBObject every ledger snapshot
// uses. Apply REPLAYS the create/update through this app's own router (replayDeviceRequest, the
// same mechanism an approved Change Request uses) rather than writing to the device directly —
// which means a fleet-applied object gets the identical validation, the identical Change Ledger
// row, and the identical per-device access check that a single click through the normal page would
// have gotten. The one thing it skips is RequireApproval's queue, and only because none of these
// five resource types are in it to begin with.
type fleetSpec struct {
	// RouteSegment is the /policy/device/:id/<segment> path piece this type's create/update routes
	// use — see routes.go.
	RouteSegment string
	// CMDBPath mirrors the same table's entry in deviceProxySegment (changeledger.go). Duplicated
	// rather than looked up from it: that map is keyed by route segment for the ledger's own
	// purposes, and cross-referencing it would couple two features that happen to agree on five
	// tables today but have no reason to stay structurally identical forever.
	CMDBPath string
}

var fleetSpecs = map[string]fleetSpec{
	"address":       {"addresses", "/api/v2/cmdb/firewall/address"},
	"address-group": {"address-groups", "/api/v2/cmdb/firewall/addrgrp"},
	"service":       {"services", "/api/v2/cmdb/firewall.service/custom"},
	"service-group": {"service-groups", "/api/v2/cmdb/firewall.service/group"},
	"ip-pool":       {"ip-pools", "/api/v2/cmdb/firewall/ippool"},
}

// FleetSpec returns the route segment and CMDB path for a fleet-eligible resource type, or false
// when this type may not be pushed to several devices at once.
func FleetSpec(resourceType string) (routeSegment, cmdbPath string, ok bool) {
	s, ok := fleetSpecs[resourceType]
	if !ok {
		return "", "", false
	}
	return s.RouteSegment, s.CMDBPath, true
}

// FleetCreatePath builds the collection URL a create POSTs to.
func FleetCreatePath(deviceID uint, routeSegment string) string {
	return fmt.Sprintf("/policy/device/%d/%s", deviceID, routeSegment)
}

// FleetUpdatePath builds the by-key URL an update PATCHes.
func FleetUpdatePath(deviceID uint, routeSegment, name string) string {
	return fmt.Sprintf("/policy/device/%d/%s/%s", deviceID, routeSegment, url.PathEscape(name))
}
