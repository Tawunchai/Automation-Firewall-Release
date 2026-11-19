package policyobject

import (
	"fmt"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Hub-and-spoke tunnels (ADVPN + BGP).
//
// Split out of device_vpn.go, which reached 1,480 lines holding four unrelated tunnel templates.
// Everything here is the hub-and-spoke half: its input shape, the create and update paths, and the
// policies that have to exist alongside the tunnel.

// hubSpokeInput is the Hub-and-Spoke template's request. See services.FGHubSpokeWrite for the
// GUI→CMDB mapping of each field.
type hubSpokeInput struct {
	Role string `json:"role"` // hub | spoke

	// Tunnel Interface (the overlay)
	TunnelIP string `json:"tunnel_ip"` // this device's tunnel-interface IP (10.10.1.1)
	RemoteIP string `json:"remote_ip"` // the peer end + mask (10.10.1.2/24)

	// Policy & Routing (BGP)
	LocalAS        string   `json:"local_as"`        // 65400
	LocalInterface string   `json:"local_interface"` // LAN side of the hub↔spoke policy
	LocalSubnets   []string `json:"local_subnets"`   // BGP networks + local address group

	// Hub only
	SpokeType        string   `json:"spoke_type"`         // individual | range
	SpokeTunnelIPs   []string `json:"spoke_tunnel_ips"`   // individual — one BGP neighbor each
	SpokeRangePrefix string   `json:"spoke_range_prefix"` // range — the overlay subnet

	// Spoke only
	RemoteGW string `json:"remote_gw"` // the hub's public IP
}

// hubSpokeWriteFromInput maps the request onto the service write struct. Shared by create and update
// so the two paths can never drift.
func hubSpokeWriteFromInput(inp tunnelInput) services.FGHubSpokeWrite {
	hs := inp.HubSpoke
	return services.FGHubSpokeWrite{
		Name:             strings.TrimSpace(inp.Name),
		Role:             strings.ToLower(strings.TrimSpace(hs.Role)),
		Interface:        strings.TrimSpace(inp.Interface),
		AuthMethod:       strings.TrimSpace(inp.AuthMethod),
		PSK:              inp.PSK,
		Certificate:      strings.TrimSpace(inp.Certificate),
		PeerCA:           strings.TrimSpace(inp.PeerCA),
		Proposal:         strings.TrimSpace(inp.Proposal),
		TunnelIP:         strings.TrimSpace(hs.TunnelIP),
		RemoteIP:         strings.TrimSpace(hs.RemoteIP),
		LocalAS:          strings.TrimSpace(hs.LocalAS),
		LocalInterface:   strings.TrimSpace(hs.LocalInterface),
		LocalSubnets:     cleanSubnets(hs.LocalSubnets),
		SpokeType:        strings.ToLower(strings.TrimSpace(hs.SpokeType)),
		SpokeTunnelIPs:   cleanSubnets(hs.SpokeTunnelIPs),
		SpokeRangePrefix: strings.TrimSpace(hs.SpokeRangePrefix),
		RemoteGW:         strings.TrimSpace(hs.RemoteGW),
		Comments:         inp.Comments,
	}
}

// updateHubSpokeTunnel re-applies the tunnel's editable settings: phase1/phase2 (auth/proposal/
// interface — a blank PSK keeps the stored secret), the overlay IPs, and the BGP + address group,
// which are re-ensured idempotently (a new local subnet is added, an existing one reused). The
// firewall policies are left as-is — a rename or an interface change is a delete-and-recreate.
func updateHubSpokeTunnel(c *gin.Context, di *deviceInfo, inp tunnelInput) {
	w := hubSpokeWriteFromInput(inp)
	w.Editing = true

	if err := services.ValidateHubSpoke(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateHubSpokeTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	names := services.HubSpokeObjectNamesFor(w.Name)
	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }

	if err := fc.SetTunnelInterfaceIP(w); err != nil {
		warn("tunnel interface IP not set: %v", err)
	}

	// What the tunnel advertised BEFORE this edit — read now, because ensureSubnetAddressSet below
	// rewrites the very address set this is derived from. ConfigureHubSpokeBGP needs it to withdraw
	// the prefixes the user removed; without it a dropped subnet stays in BGP forever.
	prevSubnets := hubSpokeLocalSubnetsOf(fc, w.Name)

	if err := ensureSubnetAddressSet(fc, names.LocalAddress, w.LocalSubnets); err != nil {
		warn("local address objects: %v", err)
	}
	if err := fc.ConfigureHubSpokeBGP(w, prevSubnets...); err != nil {
		warn("BGP configuration: %v", err)
	}

	resp := gin.H{"message": "Hub-and-Spoke VPN updated on device", "name": w.Name, "objects": names}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusOK, resp)
}

// createHubSpokeTunnel builds the Hub-and-Spoke template (ADVPN + BGP). Object order mirrors the
// FortiGate wizard: phase1/phase2 → tunnel-interface IP → local address group → BGP → firewall
// policies. The tunnel and its BGP are hard prerequisites (a failure there is a real error); the
// address group and policies are best-effort after the tunnel exists (reported as warnings) — the
// same convention the Site-to-Site path uses, so a follow-up object that fails never presents as a
// failed create while a live tunnel sits on the device.
func createHubSpokeTunnel(c *gin.Context, di *deviceInfo, inp tunnelInput) {
	w := hubSpokeWriteFromInput(inp)

	if err := services.ValidateHubSpoke(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// Pre-check for conflicts the device would only surface as a bare error code mid-build (a
	// duplicate name, a tunnel IP already in use, a clashing local AS) — stop before writing anything.
	if conflicts := fc.HubSpokeConflicts(w); len(conflicts) > 0 {
		c.JSON(http.StatusConflict, gin.H{"error": "cannot create tunnel: " + strings.Join(conflicts, "; "), "conflicts": conflicts})
		return
	}

	// 1. The tunnel itself (phase1 + phase2) — hard error.
	if err := fc.CreateHubSpokeTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	names := services.HubSpokeObjectNamesFor(w.Name)
	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }

	// 2. Overlay IPs on the auto-created tunnel interface — hard-ish: without it BGP can't peer, so
	//    surface it as an error rather than a quiet warning.
	if err := fc.SetTunnelInterfaceIP(w); err != nil {
		warn("tunnel interface IP not set: %v", err)
	}

	// 3. Local address group the spoke2hub policy points at.
	if err := ensureSubnetAddressSet(fc, names.LocalAddress, w.LocalSubnets); err != nil {
		warn("local address objects: %v", err)
	}

	// 4. BGP — the routing protocol the overlay depends on.
	if err := fc.ConfigureHubSpokeBGP(w); err != nil {
		warn("BGP configuration: %v", err)
	}

	// 5. Firewall policies (spoke↔hub + spoke↔spoke through the hub).
	if err := createHubSpokePolicies(fc, w, names); err != nil {
		warn("firewall policies not created: %v", err)
	}

	resp := gin.H{"message": "Hub-and-Spoke VPN created on device", "name": w.Name, "objects": names}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusCreated, resp)
}

// createHubSpokePolicies writes the two policies the FortiGate Hub-and-Spoke wizard writes:
//
//	spoke2hub  : the overlay → the LAN (spoke traffic reaching this device's local subnets)
//	spoke2spoke: the overlay → the overlay (spoke-to-spoke traffic hair-pinned through the hub)
//
// A spoke gets the same pair (its "hub" side is the LAN behind it). Neither is NAT'd — NAT on a VPN
// policy rewrites the source out of the peer's expected range and the far end drops it.
func createHubSpokePolicies(fc deviceClient, w services.FGHubSpokeWrite, names services.HubSpokeObjectNames) error {
	localIface := defaultLocalInterface(w.LocalInterface, w.Interface)
	localAddr := []string{names.LocalAddress}
	any := []string{"all"}

	mk := func(name, srcIntf, dstIntf string, src, dst []string) services.FGPolicy {
		return services.FGPolicy{
			Name:       name,
			SrcIntf:    services.NamesToFGNames([]string{srcIntf}),
			DstIntf:    services.NamesToFGNames([]string{dstIntf}),
			SrcAddr:    services.NamesToFGNames(src),
			DstAddr:    services.NamesToFGNames(dst),
			Service:    services.NamesToFGNames([]string{"ALL"}),
			Schedule:   "always",
			Action:     "accept",
			Status:     "enable",
			NAT:        services.FGBoolToString(false),
			LogTraffic: "utm",
			Comments:   "IPsec " + w.Name,
		}
	}

	// spoke → hub (remote to local): overlay in, LAN out. dstaddr scoped to the local group.
	if _, err := fc.CreatePolicy(mk(names.PolicySpoke2Hub, w.Name, localIface, any, localAddr)); err != nil && !isDuplicateErr(err) {
		return err
	}
	// spoke → spoke (local to remote): overlay in, overlay out — the hub hair-pins the traffic so two
	// spokes reach each other. On a spoke this rule still lets ADVPN shortcuts pass.
	if _, err := fc.CreatePolicy(mk(names.PolicySpoke2Spoke, w.Name, w.Name, any, any)); err != nil && !isDuplicateErr(err) {
		return err
	}
	return nil
}

// hubSpokeLocalSubnetsOf reads back the CIDRs the tunnel advertised, from its <tunnel>_local address
// set (a single firewall address, or a group of <tunnel>_local_N members). It runs at delete time so
// the BGP network rows carrying those same prefixes can be matched and removed.
func hubSpokeLocalSubnetsOf(fc deviceClient, tunnel string) []string {
	names := services.HubSpokeObjectNamesFor(tunnel)
	addrs, err := fc.GetAddresses()
	if err != nil {
		return nil
	}
	prefix := names.LocalAddress + "_"
	var out []string
	for _, a := range addrs {
		if (a.Name == names.LocalAddress || strings.HasPrefix(a.Name, prefix)) && strings.TrimSpace(a.Subnet) != "" {
			out = append(out, services.FGSubnetToCIDR(a.Subnet))
		}
	}
	return out
}
