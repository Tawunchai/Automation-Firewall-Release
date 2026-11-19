package services

import (
	"encoding/json"
	"fmt"
	"net"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var routerBgpNeighborGroupTable = cmdbPath{path: "router/bgp/neighbor-group", noun: "BGP neighbor group"}
var routerBgpNeighborTable = cmdbPath{path: "router/bgp/neighbor", noun: "BGP neighbor"}
var routerBgpNeighborRangeTable = cmdbPath{path: "router/bgp/neighbor-range", noun: "BGP neighbor range"}
var routerBgpNetworkTable = cmdbPath{path: "router/bgp/network", noun: "BGP network"}

// The BGP half of a hub-and-spoke tunnel.
//
// ADVPN needs BGP to carry the routes the tunnel provides, so every hub-and-spoke create and delete
// touches router/bgp as well as the tunnel itself — and the ORDER matters: BGP comes down before
// the tunnel does, or the delete leaves neighbours pointing at an interface that is gone.
//
// Split out of fortigate_hubspoke.go, which had grown to 1,294 lines holding both halves.

// bgpNeighborPayload — one iBGP peer keyed by IP.
func bgpNeighborPayload(ip, remoteAS string) map[string]interface{} {
	return map[string]interface{}{
		"vdom":      "root",
		"ip":        strings.TrimSpace(ip),
		"remote-as": strings.TrimSpace(remoteAS),
	}
}

// bgpNeighborGroupPayload — the Range-mode dynamic-peer template, bound to the tunnel interface.
func bgpNeighborGroupPayload(name, iface, remoteAS string) map[string]interface{} {
	return map[string]interface{}{
		"vdom":      "root",
		"name":      strings.TrimSpace(name),
		"interface": strings.TrimSpace(iface),
		"remote-as": strings.TrimSpace(remoteAS),
	}
}

// bgpNeighborRangePayload — the overlay subnet from which the hub accepts dynamic BGP peers.
func bgpNeighborRangePayload(id int, prefix, group string) map[string]interface{} {
	return map[string]interface{}{
		"vdom":           "root",
		"id":             id,
		"prefix":         CIDRToFGSubnet(strings.TrimSpace(prefix)),
		"neighbor-group": strings.TrimSpace(group),
	}
}

// bgpNetworkPayload — a prefix this device originates into BGP.
func bgpNetworkPayload(id int, prefix string) map[string]interface{} {
	return map[string]interface{}{
		"vdom":   "root",
		"id":     id,
		"prefix": CIDRToFGSubnet(strings.TrimSpace(prefix)),
	}
}

func isBGPAS(v string) bool {
	s := strings.TrimSpace(v)
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	// 1 .. 4294967295
	if len(s) > 10 {
		return false
	}
	var n uint64
	fmt.Sscanf(s, "%d", &n)
	return n >= 1 && n <= 4294967295
}

// ConfigureHubSpokeBGP makes the device's BGP match the form: the local AS + router-id, one network
// per local subnet, and the neighbor set for the role.
//
// This RECONCILES rather than only adding. The distinction matters on edit: a plain
// "POST, ignore -5 duplicate" loop silently does nothing for a peer that already exists, so
// changing the Local AS used to leave every neighbor pointing at the OLD remote-as and the iBGP
// session could never establish (the process said 65402 while its neighbors still said 65401).
// Likewise a removed spoke IP or a removed local subnet stayed advertised forever.
//
// Everything it removes is scoped to THIS tunnel — neighbors inside the tunnel's own overlay
// subnet, networks in the tunnel's own previous subnet list — using the same rules as
// DeleteHubSpokeBGP, so a second tunnel sharing the BGP process is never touched.
//
// prevSubnets is what the tunnel advertised before this edit (empty on create). Anything in it that
// the form no longer lists is withdrawn.
func (f *FortiClient) ConfigureHubSpokeBGP(w FGHubSpokeWrite, prevSubnets ...string) error {
	names := HubSpokeObjectNamesFor(w.Name)

	// 1. The BGP singleton — local AS + router-id (the tunnel IP is a stable, unique id).
	bgp := map[string]interface{}{"as": strings.TrimSpace(w.LocalAS)}
	if ip := strings.TrimSpace(w.TunnelIP); ip != "" {
		bgp["router-id"] = ip
	}
	if _, err := f.do("PUT", "/api/v2/cmdb/router/bgp", bgp); err != nil {
		return fmt.Errorf("bgp local AS: %w", err)
	}

	if err := f.reconcileBGPNetworks(w, prevSubnets); err != nil {
		return err
	}
	return f.reconcileBGPNeighbors(w, names)
}

// reconcileBGPNetworks adds the form's local subnets and withdraws the ones this tunnel used to
// advertise but no longer does.
func (f *FortiClient) reconcileBGPNetworks(w FGHubSpokeWrite, prevSubnets []string) error {
	existing := f.bgpNetworkPrefixes()

	want := map[string]bool{}
	for _, sub := range cleanList(w.LocalSubnets) {
		key := CIDRToFGSubnet(sub)
		want[key] = true
		if _, ok := existing[key]; ok {
			continue // already advertised
		}
		id := f.nextBGPChildID("network")
		if err := routerBgpNetworkTable.Create(f, bgpNetworkPayload(id, sub)); err != nil && !isDuplicate(err) {
			return fmt.Errorf("bgp network %s: %w", sub, err)
		}
		existing[key] = id
	}

	// Withdraw only prefixes THIS tunnel put there and the form has since dropped.
	for _, sub := range cleanList(prevSubnets) {
		key := CIDRToFGSubnet(sub)
		if want[key] {
			continue
		}
		id, ok := existing[key]
		if !ok {
			continue
		}
		if err := routerBgpNetworkTable.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
			return fmt.Errorf("bgp network %s not withdrawn: %w", sub, err)
		}
	}
	return nil
}

// reconcileBGPNeighbors makes the peer set match the role, updating remote-as on peers that already
// exist and removing overlay peers the form dropped.
func (f *FortiClient) reconcileBGPNeighbors(w FGHubSpokeWrite, names HubSpokeObjectNames) error {
	rangeMode := w.isHub() && strings.EqualFold(strings.TrimSpace(w.SpokeType), "range")

	// Switching modes leaves the other shape behind; clear it before building the current one.
	if rangeMode {
		if err := f.deleteOverlayNeighbors(w, nil); err != nil {
			return err
		}
		return f.reconcileBGPNeighborRange(w, names)
	}
	if err := f.deleteNeighborGroup(names); err != nil {
		return err
	}

	// Individual hub, or a spoke (one neighbor = the hub tunnel IP).
	var peers []string
	if w.isHub() {
		peers = cleanList(w.SpokeTunnelIPs)
	} else {
		peers = []string{w.RemoteIPHost()}
	}

	keep := map[string]bool{}
	for _, ip := range peers {
		if ip == "" {
			continue
		}
		keep[ip] = true
		// PUT first: on an edit the peer already exists, and only a PUT can move its remote-as.
		if err := routerBgpNeighborTable.Update(f, ip, bgpNeighborPayload(ip, w.LocalAS)); err == nil {
			continue
		}
		if err := routerBgpNeighborTable.Create(f, bgpNeighborPayload(ip, w.LocalAS)); err != nil && !isDuplicate(err) {
			return fmt.Errorf("bgp neighbor %s: %w", ip, err)
		}
	}
	return f.deleteOverlayNeighbors(w, keep)
}

// reconcileBGPNeighborRange keeps the Range-mode neighbor-group + neighbor-range in step.
func (f *FortiClient) reconcileBGPNeighborRange(w FGHubSpokeWrite, names HubSpokeObjectNames) error {
	payload := bgpNeighborGroupPayload(names.NeighborGroup, w.Name, w.LocalAS)
	if err := routerBgpNeighborGroupTable.Update(f, names.NeighborGroup, payload); err != nil {
		if err := routerBgpNeighborGroupTable.Create(f, payload); err != nil && !isDuplicate(err) {
			return fmt.Errorf("bgp neighbor-group: %w", err)
		}
	}

	wantPrefix := CIDRToFGSubnet(strings.TrimSpace(w.SpokeRangePrefix))
	found := false
	for _, m := range f.bgpChildRows("neighbor-range") {
		var grp, prefix string
		var id int
		json.Unmarshal(m["neighbor-group"], &grp) //nolint:errcheck
		json.Unmarshal(m["prefix"], &prefix)      //nolint:errcheck
		json.Unmarshal(m["id"], &id)              //nolint:errcheck
		if grp != names.NeighborGroup {
			continue // another tunnel's range
		}
		if strings.TrimSpace(prefix) == wantPrefix {
			found = true
			continue
		}
		if err := routerBgpNeighborRangeTable.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
			return fmt.Errorf("bgp neighbor-range %d not removed: %w", id, err)
		}
	}
	if found {
		return nil
	}
	id := f.nextBGPChildID("neighbor-range")
	if err := routerBgpNeighborRangeTable.Create(f, bgpNeighborRangePayload(id, w.SpokeRangePrefix, names.NeighborGroup)); err != nil && !isDuplicate(err) {
		return fmt.Errorf("bgp neighbor-range: %w", err)
	}
	return nil
}

// deleteOverlayNeighbors removes BGP neighbors sitting inside this tunnel's overlay subnet that are
// not in keep. Peers outside the overlay belong to something else and are never touched.
func (f *FortiClient) deleteOverlayNeighbors(w FGHubSpokeWrite, keep map[string]bool) error {
	overlay := parseOverlayCIDR(w.RemoteIP)
	if overlay == nil {
		return nil // no overlay to scope by — safer to leave every peer alone
	}
	for _, m := range f.bgpChildRows("neighbor") {
		var ip string
		json.Unmarshal(m["ip"], &ip) //nolint:errcheck
		ip = strings.TrimSpace(ip)
		if keep[ip] {
			continue
		}
		parsed := net.ParseIP(ip)
		if parsed == nil || !overlay.Contains(parsed) {
			continue
		}
		if err := routerBgpNeighborTable.Delete(f, ip); err != nil && !isGoneErr(err) {
			return fmt.Errorf("bgp neighbor %s not removed: %w", ip, err)
		}
	}
	return nil
}

// deleteNeighborGroup drops this tunnel's Range-mode leftovers when it is switched to Individual.
func (f *FortiClient) deleteNeighborGroup(names HubSpokeObjectNames) error {
	for _, m := range f.bgpChildRows("neighbor-range") {
		var grp string
		var id int
		json.Unmarshal(m["neighbor-group"], &grp) //nolint:errcheck
		json.Unmarshal(m["id"], &id)              //nolint:errcheck
		if grp != names.NeighborGroup {
			continue
		}
		if err := routerBgpNeighborRangeTable.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
			return fmt.Errorf("bgp neighbor-range %d not removed: %w", id, err)
		}
	}
	if err := routerBgpNeighborGroupTable.Delete(f, names.NeighborGroup); err != nil && !isGoneErr(err) {
		return fmt.Errorf("bgp neighbor-group %q not removed: %w", names.NeighborGroup, err)
	}
	return nil
}

// bgpNetworkPrefixes maps every "ip mask" prefix already in router/bgp/network → its id, so a re-run
// re-uses rather than duplicating.
func (f *FortiClient) bgpNetworkPrefixes() map[string]int {
	out := map[string]int{}
	resp, err := f.do("GET", "/api/v2/cmdb/router/bgp/network", nil)
	if err != nil {
		return out
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil {
		return out
	}
	for _, m := range rows {
		var prefix string
		var id int
		json.Unmarshal(m["prefix"], &prefix) //nolint:errcheck
		json.Unmarshal(m["id"], &id)         //nolint:errcheck
		if prefix != "" {
			out[strings.TrimSpace(prefix)] = id
		}
	}
	return out
}

// nextBGPChildID returns max(id)+1 for an integer-keyed BGP child table (network / neighbor-range),
// so a POST never collides with an existing row. FortiOS does not auto-assign these ids.
func (f *FortiClient) nextBGPChildID(table string) int {
	resp, err := f.do("GET", "/api/v2/cmdb/router/bgp/"+table, nil)
	if err != nil {
		return 1
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil {
		return 1
	}
	max := 0
	for _, m := range rows {
		var id int
		if json.Unmarshal(m["id"], &id) == nil && id > max {
			max = id
		}
	}
	return max + 1
}

// DeleteHubSpokeBGP removes only the BGP objects this tunnel added, then clears the local AS if
// nothing is left. It is self-contained — it derives what to remove from the device, not from a
// stored draft:
//   - neighbor-group named <tunnel> (Range mode) + any neighbor-range pointing at it
//   - individual BGP neighbors whose IP falls inside the tunnel's overlay subnet
//   - BGP networks whose prefix matches one of the tunnel's local-address-group subnets
//
// Everything is best-effort (a missing object 404s harmlessly) so a partially-removed tunnel still
// finishes cleaning up. Returns the non-fatal problems as warnings.
func (f *FortiClient) DeleteHubSpokeBGP(name string, localSubnets []string, overlayCIDR string) []string {
	var warnings []string
	names := HubSpokeObjectNamesFor(name)
	overlay := parseOverlayCIDR(overlayCIDR)
	hasOverlay := overlay != nil

	// 1. neighbor-range whose neighbor-group is ours → delete first (it references the group).
	if rows := f.bgpChildRows("neighbor-range"); rows != nil {
		for _, m := range rows {
			var grp string
			var id int
			json.Unmarshal(m["neighbor-group"], &grp) //nolint:errcheck
			json.Unmarshal(m["id"], &id)              //nolint:errcheck
			if grp == names.NeighborGroup {
				if err := routerBgpNeighborRangeTable.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
					warnings = append(warnings, fmt.Sprintf("bgp neighbor-range %d not removed: %v", id, err))
				}
			}
		}
	}
	// 2. the neighbor-group itself.
	if err := routerBgpNeighborGroupTable.Delete(f, names.NeighborGroup); err != nil && !isGoneErr(err) {
		warnings = append(warnings, fmt.Sprintf("bgp neighbor-group %q not removed: %v", names.NeighborGroup, err))
	}
	// 3. individual neighbors inside the overlay subnet.
	if hasOverlay {
		if rows := f.bgpChildRows("neighbor"); rows != nil {
			for _, m := range rows {
				var ip string
				json.Unmarshal(m["ip"], &ip) //nolint:errcheck
				parsed := net.ParseIP(strings.TrimSpace(ip))
				if parsed != nil && overlay.Contains(parsed) {
					if err := routerBgpNeighborTable.Delete(f, ip); err != nil && !isGoneErr(err) {
						warnings = append(warnings, fmt.Sprintf("bgp neighbor %s not removed: %v", ip, err))
					}
				}
			}
		}
	}
	// 4. networks matching this tunnel's local subnets.
	wantNets := map[string]bool{}
	for _, s := range cleanList(localSubnets) {
		wantNets[CIDRToFGSubnet(s)] = true
	}
	if len(wantNets) > 0 {
		if rows := f.bgpChildRows("network"); rows != nil {
			for _, m := range rows {
				var prefix string
				var id int
				json.Unmarshal(m["prefix"], &prefix) //nolint:errcheck
				json.Unmarshal(m["id"], &id)         //nolint:errcheck
				if wantNets[strings.TrimSpace(prefix)] {
					if err := routerBgpNetworkTable.Delete(f, strconv.Itoa(id)); err != nil && !isGoneErr(err) {
						warnings = append(warnings, fmt.Sprintf("bgp network %d not removed: %v", id, err))
					}
				}
			}
		}
	}

	// 5. Nothing left → clear the AS and router-id so a stale empty BGP process isn't left running.
	if f.bgpIsEmpty() {
		if _, err := f.do("PUT", "/api/v2/cmdb/router/bgp", map[string]interface{}{"as": "0", "router-id": "0.0.0.0"}); err != nil {
			warnings = append(warnings, fmt.Sprintf("bgp local AS not cleared: %v", err))
		}
	}
	return warnings
}

// bgpChildRows GETs an integer/name-keyed BGP child table as raw rows.
func (f *FortiClient) bgpChildRows(table string) []map[string]json.RawMessage {
	resp, err := f.do("GET", "/api/v2/cmdb/router/bgp/"+table, nil)
	if err != nil {
		return nil
	}
	var rows []map[string]json.RawMessage
	if json.Unmarshal(resp.Results, &rows) != nil {
		return nil
	}
	return rows
}
