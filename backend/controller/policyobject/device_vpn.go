package policyobject

import (
	"fmt"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// tunnelInput is the VPN Creation Wizard's create payload — one Site-to-Site tunnel as the
// wizard's four steps describe it. See services.FGIPsecTunnelWrite for the GUI→CMDB mapping.
type tunnelInput struct {
	Name          string   `json:"name"`
	Interface     string   `json:"interface"`   // outgoing/binding interface
	IKEVersion    string   `json:"ike_version"` // "1" | "2" (the GUI's Site-to-Site template hides this)
	RemoteGW      string   `json:"remote_gw"`
	PSK           string   `json:"psk"`
	Proposal      string   `json:"proposal"`
	DHGroup       string   `json:"dhgroup"`
	LocalSubnets  []string `json:"local_subnets"`
	RemoteSubnets []string `json:"remote_subnets"`
	Comments      string   `json:"comments"`

	// ── Step 1: VPN Setup ──
	RemoteType   string `json:"remote_type"`  // static | dynamic | ddns
	RemoteDDNS   string `json:"remote_ddns"`  // FQDN (Remote device = Dynamic DNS)
	NATTraversal string `json:"nattraversal"` // enable | disable | forced (NAT configuration)

	// ── Step 2: Authentication ──
	AuthMethod  string `json:"auth_method"` // psk | signature
	Certificate string `json:"certificate"` // Certificate Name (signature)
	PeerCA      string `json:"peer_ca"`     // Peer Certificate CA (signature)

	// ── Step 3: Policy & Routing ──
	LocalInterface string `json:"local_interface"` // the LAN side the policies are written for
	InternetAccess string `json:"internet_access"` // none | share-local | use-remote
	SharedWAN      string `json:"shared_wan"`      // the WAN shared with the remote (share-local)
	LocalGateway   string `json:"local_gateway"`   // this site's real default gateway (use-remote)

	// wizard extras (best-effort after the tunnel)
	CreateStaticRoute    bool `json:"create_static_route"`
	CreateFirewallPolicy bool `json:"create_firewall_policy"`

	// ── Remote Access (dialup FortiClient) — see services.FGIPsecTunnelWrite ──
	// When RemoteAccess is true the whole shape changes: a dialup mode-config listener instead of a
	// site-to-site tunnel. The Step 2/3 fields above are reused (Outgoing→Incoming Interface,
	// Local interface, auth), plus these.
	RemoteAccess bool `json:"remote_access"`
	// ReplaceL2TPServer opts in to taking over the vpn/l2tp singleton from another Native VPN.
	// Without it a Native (Android/Windows) create is refused with 409 when the server is in use,
	// because taking it over stops the existing VPN working with no error of its own.
	ReplaceL2TPServer bool     `json:"replace_l2tp_server"`
	RAClient          string   `json:"ra_client"`          // forticlient | cisco
	UserGroup         string   `json:"user_group"`         // authusrgrp
	ClientRangeStart  string   `json:"client_range_start"` // ipv4-start-ip
	ClientRangeEnd    string   `json:"client_range_end"`   // ipv4-end-ip
	ClientNetmask     string   `json:"client_netmask"`     // ipv4-netmask
	DNSMode           string   `json:"dns_mode"`           // auto | manual
	DNSServer         string   `json:"dns_server"`         // ipv4-dns-server1 (manual)
	SplitTunnel       bool     `json:"split_tunnel"`       // enable ipv4-split-include
	LocalAddresses    []string `json:"local_addresses"`    // existing addresses → the split group's members

	// FortiClient-only (its Client Options step)
	SavePassword         bool `json:"save_password"`
	AutoConnect          bool `json:"auto_connect"`
	AlwaysUp             bool `json:"always_up"`
	EndpointRegistration bool `json:"endpoint_registration"` // GUI-only on 7.2 (no CMDB field) — see below

	// Cisco-only: "Require 'Group Name' on VPN client" → mode=aggressive + peertype=one + peerid
	RequireGroupName bool   `json:"require_group_name"`
	GroupName        string `json:"group_name"`

	// ── Custom template (the GUI's manual "New VPN Tunnel" form) ──
	// When Custom is non-nil the request builds ONLY phase1 + phase2 from these fields — no address
	// objects, policies or routes. The shared fields above (Name, Interface, IKEVersion, RemoteType,
	// RemoteGW, RemoteDDNS, NATTraversal, AuthMethod, PSK, Certificate, PeerCA, Proposal) are reused.
	Custom *customInput `json:"custom"`

	// ── Hub-and-Spoke template (ADVPN + BGP) ──
	// When HubSpoke is non-nil the request builds an overlay tunnel (dialup hub or static spoke) with
	// a tunnel-interface IP and a BGP process, instead of a Site-to-Site object set. The shared Name,
	// Interface, AuthMethod, PSK, Certificate, PeerCA, Proposal fields are reused.
	HubSpoke *hubSpokeInput `json:"hub_spoke"`
}

// GET /policy/device/:deviceId/ipsec-tunnels
func DeviceListIPsecTunnels(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	tunnels, err := fc.GetIPsecTunnels()
	if err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}
	c.JSON(http.StatusOK, tunnels)
}

// GET /policy/device/:deviceId/ipsec-tunnels/:name
func DeviceGetIPsecTunnel(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	t, err := fc.GetIPsecTunnel(name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, t)
}

// GET /policy/device/:deviceId/ipsec-tunnels/:name/full
//
// The tunnel read back into the Custom form's shape — what the Edit page loads to pre-fill the
// manual editor. Works for any tunnel (Site-to-Site, Remote Access or Custom), since editing on
// FortiGate always opens the full phase1/phase2 form.
func DeviceGetIPsecTunnelFull(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	t, err := fc.GetIPsecTunnelFull(name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, t)
}

// PATCH /policy/device/:deviceId/ipsec-tunnels/:name
//
// Edits a tunnel's phase1 + phase2 via the Custom (manual) form. A PARTIAL update: fields the form
// doesn't cover (a dialup tunnel's mode-config, a wizard tunnel's wizard-type) are preserved, and a
// blank PSK keeps the stored secret. The object set (addresses/policies/routes) is left as-is.
func DeviceUpdateIPsecTunnel(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	var inp tunnelInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// The mkey comes from the URL — the body's name never renames the tunnel.
	inp.Name = name

	// Hub-and-Spoke edit — re-apply phase1/phase2 + tunnel IP + BGP + address group (idempotent).
	if inp.HubSpoke != nil {
		updateHubSpokeTunnel(c, di, inp)
		return
	}

	if inp.Custom == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "edit requires the custom or hub_spoke field set"})
		return
	}

	w := customWriteFromInput(inp)
	w.Editing = true // a blank PSK keeps the stored secret
	if err := services.ValidateIPsecTunnel(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateIPsecTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "IPsec tunnel updated on device", "name": w.Name})
}

// GET /policy/device/:deviceId/router-lookup?destination=<ip>
//
// The device's own routing answer for an address. The wizard calls this the moment a Remote IP
// address is typed and fills "Outgoing Interface" from it — exactly what the FortiGate GUI does.
// It MUST be the device answering; see services.RouterLookup for what a local guess gets wrong.
func DeviceRouterLookup(c *gin.Context) {
	dst := strings.TrimSpace(c.Query("destination"))
	if dst == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "destination is required"})
		return
	}
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	lk, err := fc.RouterLookup(dst)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, lk)
}

// GET /policy/device/:deviceId/vpn-metadata — the certificate pickers and the Local Gateway
// prefill the VPN Creation Wizard needs beyond the interface list.
func DeviceGetVPNMetadata(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	c.JSON(http.StatusOK, fc.GetVPNWizardMetadata())
}

// POST /policy/device/:deviceId/ipsec-tunnels
func DeviceCreateIPsecTunnel(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp tunnelInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Remote Access (dialup FortiClient) is a different object set and a different phase1 shape, so
	// it has its own path. The Site-to-Site code below is left exactly as it was.
	if inp.RemoteAccess {
		createRemoteAccessTunnel(c, di, inp)
		return
	}

	// Custom (the GUI's manual form) creates ONLY phase1 + phase2 — no addresses/policies/routes.
	if inp.Custom != nil {
		createCustomTunnel(c, di, inp)
		return
	}

	// Hub-and-Spoke (ADVPN + BGP) — an overlay tunnel with a tunnel-interface IP and a BGP process.
	if inp.HubSpoke != nil {
		createHubSpokeTunnel(c, di, inp)
		return
	}

	w := services.FGIPsecTunnelWrite{
		Name:          strings.TrimSpace(inp.Name),
		Interface:     strings.TrimSpace(inp.Interface),
		IKEVersion:    inp.IKEVersion,
		RemoteGW:      strings.TrimSpace(inp.RemoteGW),
		PSK:           inp.PSK,
		Proposal:      inp.Proposal,
		DHGroup:       inp.DHGroup,
		LocalSubnets:  cleanSubnets(inp.LocalSubnets),
		RemoteSubnets: cleanSubnets(inp.RemoteSubnets),
		Comments:      inp.Comments,
		RemoteType:    strings.TrimSpace(inp.RemoteType),
		RemoteDDNS:    strings.TrimSpace(inp.RemoteDDNS),
		NATTraversal:  strings.TrimSpace(inp.NATTraversal),
		AuthMethod:    strings.TrimSpace(inp.AuthMethod),
		Certificate:   strings.TrimSpace(inp.Certificate),
		PeerCA:        strings.TrimSpace(inp.PeerCA),
	}

	// "Use Remote" means this site reaches the Internet through the tunnel, so the remote
	// selector is the default route by definition — pin it rather than trusting the client.
	if strings.EqualFold(inp.InternetAccess, "use-remote") {
		w.RemoteSubnets = []string{"0.0.0.0/0"}
	}

	if err := services.ValidateIPsecTunnel(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.EqualFold(inp.InternetAccess, "use-remote") && strings.TrimSpace(inp.LocalGateway) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "local gateway is required when the Internet is reached through the remote site"})
		return
	}
	if strings.EqualFold(inp.InternetAccess, "share-local") && strings.TrimSpace(inp.SharedWAN) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "shared WAN is required when sharing this site's Internet access"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateIPsecTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	// ── The rest of the object set ────────────────────────────────────────────
	// The tunnel already exists at this point, so a failure here is reported as a WARNING, never
	// as an error: telling the user "failed" while a tunnel sits on the device is worse than
	// telling them exactly which follow-up object didn't land.
	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }

	n := services.VPNObjectNamesFor(w.Name)
	internet := strings.ToLower(strings.TrimSpace(inp.InternetAccess))

	// Address objects for the selectors — the real FortiGate wizard creates these too, and the
	// policies below reference them by the same names. Without them the policies would have to say
	// "all"→"all", which on a VPN is a hole, not a shortcut.
	if err := ensureSubnetAddressSet(fc, n.LocalAddress, w.LocalSubnets); err != nil {
		warn("local address objects: %v", err)
	}
	if err := ensureSubnetAddressSet(fc, n.RemoteAddress, w.RemoteSubnets); err != nil {
		warn("remote address objects: %v", err)
	}

	if inp.CreateStaticRoute {
		for _, rs := range w.RemoteSubnets {
			// A route out a point-to-point tunnel has NO gateway — see buildStaticRoutePayload.
			if _, err := fc.CreateStaticRoute(services.FGStaticRouteWrite{
				VDOM: "root", DstType: "subnet", Dst: services.CIDRToFGSubnet(rs),
				Device: w.Name, Comment: "IPsec " + w.Name,
			}); err != nil {
				warn("static route to %s not created: %v", rs, err)
			}
			// The blackhole route FortiGate's own wizard always adds, at the worst distance so it
			// only ever wins when the tunnel route is gone. Without it, traffic for the remote
			// subnet falls through to the DEFAULT route the moment the tunnel drops — i.e. private
			// traffic leaves unencrypted out the WAN instead of being discarded.
			bhDistance := 254
			if _, err := fc.CreateStaticRoute(services.FGStaticRouteWrite{
				VDOM: "root", DstType: "subnet", Dst: services.CIDRToFGSubnet(rs),
				Blackhole: true, Distance: &bhDistance,
				Comment: "IPsec " + w.Name + " blackhole",
			}); err != nil {
				warn("blackhole route for %s not created: %v", rs, err)
			}
		}

		// "Use Remote": the default route now points INTO the tunnel, so the tunnel's own IKE/ESP
		// packets to the remote gateway would recurse into it. An address + host route for that
		// gateway over the physical link is what keeps the tunnel reachable — which is the whole
		// reason the GUI asks for "Local Gateway" in this mode and nowhere else. (These are the
		// "Remote Gateway Address"/"Remote Gateway Route" rows of its Object Summary.)
		if internet == "use-remote" && w.RemoteGW != "" {
			if err := fc.CreateAddress(services.FGAddress{
				Name: n.RemoteGatewayAddr, Type: "ipmask",
				Subnet: services.CIDRToFGSubnet(w.RemoteGW + "/32"), Comment: "IPsec " + w.Name,
			}); err != nil && !isDuplicateErr(err) {
				warn("remote gateway address not created: %v", err)
			}
			if _, err := fc.CreateStaticRoute(services.FGStaticRouteWrite{
				VDOM: "root", DstType: "subnet", Dst: services.CIDRToFGSubnet(w.RemoteGW + "/32"),
				Gateway: strings.TrimSpace(inp.LocalGateway), Device: w.Interface,
				Comment: "IPsec " + w.Name + " gateway",
			}); err != nil {
				warn("remote gateway route not created: %v", err)
			}
		}
	}

	if inp.CreateFirewallPolicy {
		if err := createTunnelPolicies(fc, w, tunnelPolicySpec{
			Names:          n,
			LocalInterface: defaultLocalInterface(inp.LocalInterface, w.Interface),
			InternetAccess: internet,
			SharedWAN:      strings.TrimSpace(inp.SharedWAN),
		}); err != nil {
			warn("firewall policies not created: %v", err)
		}
	}

	// Report only what this run's options actually built. The Site-to-Site template creates the
	// remote-gateway address in "Use Remote" mode alone, and the two policies only when the user
	// left "Create firewall policies" on — naming them unconditionally handed Fallback/undo objects
	// that were never there.
	built := n
	if !(internet == "use-remote" && w.RemoteGW != "") {
		built.RemoteGatewayAddr = ""
	}
	if !inp.CreateFirewallPolicy {
		built.PolicyLocalToRemote, built.PolicyRemoteToLocal = "", ""
	}
	if len(w.LocalSubnets) == 0 {
		built.LocalAddress = ""
	}
	if len(w.RemoteSubnets) == 0 {
		built.RemoteAddress = ""
	}

	resp := gin.H{"message": "IPsec tunnel created on device", "name": w.Name, "objects": built}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusCreated, resp)
}

// defaultStr2 returns v trimmed, or fallback when it is blank.
func defaultStr2(v, fallback string) string {
	if t := strings.TrimSpace(v); t != "" {
		return t
	}
	return fallback
}

// DELETE /policy/device/:deviceId/ipsec-tunnels/:name
//
// Removes the tunnel AND the object set the wizard created with it. Deleting only phase1/phase2
// would leave the policies, routes and address groups behind — and re-creating the same tunnel
// then fails on the leftovers (-5 duplicate name, or -34 duplicate remote gateway), which is
// exactly the state a user hits after one failed attempt.
//
// ORDER IS THE POINT: FortiGate refuses to delete an object another one still references (-23).
// Policies reference the addresses and the tunnel interface; routes reference the interface; the
// user.peer is referenced by phase1. So: policies → routes → phase2/phase1(+peer) → addresses.
func DeviceDeleteIPsecTunnel(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// Everything below the tunnel itself is best-effort: an object someone already removed by
	// hand must not stop the tunnel from going.
	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }
	n := services.VPNObjectNamesFor(name)

	// Was this a Native (L2TP/IPsec) VPN? Ask BEFORE phase2 is deleted — that is what carries the
	// l2tp flag, and the answer decides whether the l2tp singleton gets switched back off.
	wasL2TP := fc.IsL2TPTunnel(name)

	// Was this a Hub-and-Spoke (ADVPN) VPN? Ask BEFORE phase1 goes — the auto-discovery flag lives on
	// phase1. If so, collect the local subnets it advertised (from its <name>_local address set) now,
	// so the BGP network rows can be matched and removed after the tunnel is gone.
	wasHubSpoke := fc.IsHubSpokeTunnel(name)
	var hubSpokeLocalSubnets []string
	var hubSpokeOverlay string
	if wasHubSpoke {
		hubSpokeLocalSubnets = hubSpokeLocalSubnetsOf(fc, name)
		// The overlay subnet identifies this tunnel's individual BGP neighbors — read it now, before
		// the system/interface is auto-removed with phase1.
		hubSpokeOverlay = fc.TunnelOverlayCIDR(name)
	}

	// 1. Policies — anything this tunnel's interface is an endpoint of, whatever it is called.
	//    (Matching on the interface rather than on our own names also catches the Internet-access
	//    policy and anything the user added to the tunnel afterwards, which would otherwise pin
	//    the interface and block the delete with -23.)
	//
	//    A Native VPN's remote-to-local policy is the exception: it runs l2t.root → LAN and never
	//    touches the tunnel interface at all, so it is matched by NAME as well or it survives and
	//    pins <name>_range with -23.
	if policies, err := fc.GetPolicies(); err == nil {
		for _, p := range policies {
			if !policyTouchesInterface(p, name) && !isRAPolicyName(p.Name, name) {
				continue
			}
			if err := fc.DeletePolicy(p.PolicyID); err != nil {
				warn("policy %q (id %d) not removed: %v", p.Name, p.PolicyID, err)
			}
		}
	} else {
		warn("could not list policies: %v", err)
	}

	// 2. Routes out the tunnel interface, plus the blackhole/gateway routes we tagged with its
	//    name. A blackhole route has NO device, so the interface match alone would miss it.
	if routes, err := fc.GetStaticRoutes(); err == nil {
		for _, r := range routes {
			if r.Device != name && !strings.Contains(r.Comment, "IPsec "+name) {
				continue
			}
			if err := fc.DeleteStaticRoute(r.SeqNum); err != nil {
				warn("static route %d not removed: %v", r.SeqNum, err)
			}
		}
	} else {
		warn("could not list static routes: %v", err)
	}

	// 2b. A Hub-and-Spoke VPN's BGP must go BEFORE the tunnel: a Range hub's neighbor-group is bound
	//     to the tunnel interface, so the phase1 delete below fails with -23 while it still exists.
	//     Remove only the rows THIS tunnel added (matched by its overlay subnet + local subnets), and
	//     clear the AS if that emptied BGP. Best-effort — BGP problems are warnings, never a failed
	//     delete.
	if wasHubSpoke {
		warnings = append(warnings, fc.DeleteHubSpokeBGP(name, hubSpokeLocalSubnets, hubSpokeOverlay)...)
	}

	// 3. The tunnel itself (phase2 selectors → phase1 → its user.peer).
	if err := fc.DeleteIPsecTunnel(name); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	// 4. The addresses/groups, now that nothing points at them. A group must go before its
	//    members. Objects the user reused elsewhere refuse to delete (-23) and are left alone —
	//    reported, not forced.
	// ensureSubnetAddressSet writes ONE of two shapes under the same name — a plain address (one
	// subnet) or an addrgrp over <name>_1…<name>_n (several) — so removal has to try both. The
	// device answers a DELETE for an object it doesn't have with HTTP 404 and an EMPTY error body
	// (no -3, no message), which is precisely how we learn "that name isn't a group here".
	for _, grp := range []string{n.LocalAddress, n.RemoteAddress} {
		grpErr := fc.DeleteAddressGroup(grp)
		// Members first — they only exist in the multi-subnet shape, and only once the group that
		// held them is gone (-23 otherwise). A name that was never used simply 404s.
		for i := 1; i <= 32; i++ {
			if err := fc.DeleteAddress(fmt.Sprintf("%s_%d", grp, i)); err != nil {
				break // first gap = no more members
			}
		}
		// Single-subnet shape: the name is a plain address, so the group delete 404'd above.
		if grpErr != nil {
			if err := fc.DeleteAddress(grp); err != nil && !isGoneErr(err) {
				// A real failure — most often -23, i.e. something else still references it.
				warn("address %q not removed: %v", grp, err)
			}
		}
	}
	// Only exists for "Use Remote", so its absence is the normal case, not a problem.
	if err := fc.DeleteAddress(n.RemoteGatewayAddr); err != nil && !isGoneErr(err) {
		warn("address %q not removed: %v", n.RemoteGatewayAddr, err)
	}

	// Remote Access object set — the split-tunnel group (its members are the user's own addresses,
	// which are left alone) and the client-range address. Both are absent for a Site-to-Site tunnel
	// and 404 harmlessly. The remote-to-local policy was already caught by the interface match above.
	ra := services.RemoteAccessObjectNamesFor(name)
	if err := fc.DeleteAddressGroup(ra.SplitGroup); err != nil && !isGoneErr(err) {
		warn("split tunnel group %q not removed: %v", ra.SplitGroup, err)
	}
	if err := fc.DeleteAddress(ra.ClientRange); err != nil && !isGoneErr(err) {
		warn("client range address %q not removed: %v", ra.ClientRange, err)
	}

	// 5. A Native VPN also switched the vpn/l2tp SINGLETON on. Nothing else uses it — there is only
	//    one per VDOM — so removing that tunnel must switch it back off, or the L2TP server keeps
	//    listening (and holding the user group) for a VPN that no longer exists.
	if wasL2TP {
		if err := fc.DisableL2TPServer(); err != nil {
			warn("L2TP server not disabled: %v", err)
		}
	}

	resp := gin.H{"message": "IPsec tunnel deleted from device"}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusOK, resp)
}

// policyTouchesInterface reports whether the tunnel interface is either end of a policy.
func policyTouchesInterface(p services.FGPolicy, iface string) bool {
	for _, list := range [][]services.FGName{p.SrcIntf, p.DstIntf} {
		for _, n := range list {
			if n.Name == iface {
				return true
			}
		}
	}
	return false
}

// isGoneErr reports "there is nothing to delete" — the end state we wanted, so not an error.
//
// nil counts here (unlike services.IsObjectGoneError, where it does not): this one answers "is the
// object gone?", and a delete that succeeded is the clearest possible yes.
func isGoneErr(err error) bool {
	return err == nil || services.IsObjectGoneError(err)
}

// defaultLocalInterface falls back to the outgoing interface when the wizard's Local interface
// was left blank, so the policies still have both ends.
func defaultLocalInterface(local, fallback string) string {
	if l := strings.TrimSpace(local); l != "" {
		return l
	}
	return fallback
}

// isDuplicateErr reports the device's "that name already exists" (-5), which every create path
// in this project treats as success — it leaves the end state we wanted.
func isDuplicateErr(err error) bool { return services.IsDuplicateObjectError(err) }

// tunnelPolicySpec is everything createTunnelPolicies needs beyond the tunnel itself.
type tunnelPolicySpec struct {
	Names          services.VPNObjectNames
	LocalInterface string
	InternetAccess string // none | share-local | use-remote
	SharedWAN      string
}

// createTunnelPolicies writes the firewall policies the FortiGate VPN wizard writes: the
// local↔remote pair carrying the tunnel's own traffic, plus whatever the Internet Access choice
// adds. They reference the address (group) names ensureSubnetAddressSet just guaranteed.
func createTunnelPolicies(fc deviceClient, w services.FGIPsecTunnelWrite, s tunnelPolicySpec) error {
	local := []string{s.Names.LocalAddress}
	remote := []string{s.Names.RemoteAddress}

	mk := func(name, srcIntf, dstIntf string, src, dst []string, nat bool) services.FGPolicy {
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
			NAT:        services.FGBoolToString(nat),
			LogTraffic: "utm",
			Comments:   "IPsec " + w.Name,
		}
	}

	// The tunnel's own traffic. NEVER NAT here: NAT on a VPN policy rewrites the source out of
	// the remote's selector, and the far end drops it.
	if _, err := fc.CreatePolicy(mk(s.Names.PolicyLocalToRemote, s.LocalInterface, w.Name, local, remote, false)); err != nil {
		return err
	}
	if _, err := fc.CreatePolicy(mk(s.Names.PolicyRemoteToLocal, w.Name, s.LocalInterface, remote, local, false)); err != nil {
		return err
	}

	switch s.InternetAccess {
	case "share-local":
		// The remote site reaches the Internet through OUR WAN: its traffic arrives on the tunnel
		// and leaves the shared WAN. This one DOES need NAT — the remote's private source has no
		// route back from the Internet.
		if _, err := fc.CreatePolicy(mk("vpn_"+w.Name+"_share", w.Name, s.SharedWAN,
			remote, []string{"all"}, true)); err != nil {
			return err
		}
	case "use-remote":
		// We reach the Internet through the REMOTE site: our LAN goes out the tunnel to anywhere.
		// No NAT — the remote end is what NATs to the Internet.
		if _, err := fc.CreatePolicy(mk("vpn_"+w.Name+"_internet", s.LocalInterface, w.Name,
			local, []string{"all"}, false)); err != nil {
			return err
		}
	}
	return nil
}

func cleanSubnets(in []string) []string {
	out := make([]string, 0, len(in))
	for _, s := range in {
		if t := strings.TrimSpace(s); t != "" {
			out = append(out, t)
		}
	}
	return out
}

// GET /policy/device/:deviceId/bgp-summary — the device's BGP process (local AS + neighbor states)
// for the IPsec Tunnels page's Hub-and-Spoke health panel.
func DeviceGetBGPSummary(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, fc.GetBGPSummary())
}

// GET /policy/device/:deviceId/ipsec-tunnels/:name/hub-spoke — reconstruct a Hub-and-Spoke tunnel
// from the device so the wizard can open it in Edit mode. 404 if the tunnel isn't Hub-and-Spoke.
func DeviceGetHubSpokeTunnel(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	rb, ok := fc.ReadHubSpoke(name)
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "not a Hub-and-Spoke tunnel"})
		return
	}
	c.JSON(http.StatusOK, rb)
}

// GET /policy/device/:deviceId/ipsec-tunnels/:name/deletion-preview — the exact object set a delete
// would remove, so the confirm dialog can list it instead of describing it generically.
func DeviceGetTunnelDeletionPreview(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := c.Param("name")
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, fc.PreviewTunnelDeletion(name))
}
