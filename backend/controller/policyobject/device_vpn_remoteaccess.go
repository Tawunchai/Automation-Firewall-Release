package policyobject

import (
	"fmt"
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Remote-access tunnels: FortiClient dial-up and native L2TP.
//
// Split out of device_vpn.go. L2TP is a singleton on the device, which is why its creation path is
// separate from the dial-up one rather than a flag on it.

// createRemoteAccessTunnel builds a dialup FortiClient VPN — the "Remote Access" template. The
// object set and its order (client-range address → split-tunnel group → dialup phase1/phase2 →
// remote-to-local policy) matches FortiGate's own VPN Creation Wizard, whose "Review Settings →
// Object Summary" is where the object names come from (services.RemoteAccessObjectNamesFor).
//
// The split-tunnel group must exist BEFORE phase1, because phase1 references it via
// ipv4-split-include — otherwise the device answers -3. So the prerequisites are created up front
// (hard errors), and only the follow-up policy is best-effort.
func createRemoteAccessTunnel(c *gin.Context, di *deviceInfo, inp tunnelInput) {
	ra := services.RemoteAccessObjectNamesFor(strings.TrimSpace(inp.Name))

	w := services.FGIPsecTunnelWrite{
		Name:        strings.TrimSpace(inp.Name),
		Interface:   strings.TrimSpace(inp.Interface), // "Incoming Interface"
		IKEVersion:  strings.TrimSpace(inp.IKEVersion),
		Proposal:    inp.Proposal,
		DHGroup:     inp.DHGroup,
		Comments:    inp.Comments,
		AuthMethod:  strings.TrimSpace(inp.AuthMethod),
		PSK:         inp.PSK,
		Certificate: strings.TrimSpace(inp.Certificate),
		PeerCA:      strings.TrimSpace(inp.PeerCA),
		RemoteType:  "dynamic", // a dialup listener

		RemoteAccess:     true,
		RAClient:         strings.TrimSpace(inp.RAClient),
		UserGroup:        strings.TrimSpace(inp.UserGroup),
		ClientRangeStart: strings.TrimSpace(inp.ClientRangeStart),
		ClientRangeEnd:   strings.TrimSpace(inp.ClientRangeEnd),
		ClientNetmask:    strings.TrimSpace(inp.ClientNetmask),
		DNSMode:          strings.TrimSpace(inp.DNSMode),
		DNSServer:        strings.TrimSpace(inp.DNSServer),
		SplitTunnel:      inp.SplitTunnel,
		SavePassword:     inp.SavePassword,
		AutoConnect:      inp.AutoConnect,
		AlwaysUp:         inp.AlwaysUp,
		RequireGroupName: inp.RequireGroupName,
		GroupName:        strings.TrimSpace(inp.GroupName),
	}
	localAddrs := cleanSubnets(inp.LocalAddresses) // address NAMES, not subnets — cleanSubnets just trims
	if w.SplitTunnel {
		w.SplitGroup = ra.SplitGroup
	}

	// ⚠️ Only Android/Windows are L2TP. iOS sits under the GUI's "Native" toggle but is a normal
	// mode-config dialup tunnel (verified live), so it keeps its split tunnel and DNS.
	native := services.IsL2TPRemoteAccessClient(w.RAClient)
	if native {
		// L2TP: the L2TP server hands out the addresses, so there is no IKE mode-config and
		// therefore no split tunnel, DNS push or client options at all.
		w.SplitTunnel = false
		w.SplitGroup = ""
	}

	if err := services.ValidateIPsecTunnel(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if w.SplitTunnel && len(localAddrs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select at least one local address for the split tunnel"})
		return
	}
	if native && len(localAddrs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "select at least one local address the clients may reach"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// vpn/l2tp is a per-VDOM SINGLETON. A second Native VPN repoints it and quietly breaks the
	// first one, so refuse before writing anything. The wizard shows the same warning, but that is
	// UI-only — the AI Assistant and direct API calls land here too.
	if native && !inp.ReplaceL2TPServer {
		if owner := fc.L2TPServerOwner(w.Name); owner != "" {
			c.JSON(http.StatusConflict, gin.H{
				"error": fmt.Sprintf("the L2TP server is already in use by %q — FortiGate allows only one per VDOM, "+
					"so creating this VPN would stop that one working. Delete it first, or resend with replace_l2tp_server=true.", owner),
				"l2tp_owner": owner,
			})
			return
		}
	}

	// 1. Client IP pool as an iprange address — the policy's source. A re-run reuses it (-5 = OK).
	if err := fc.CreateAddress(services.FGAddress{
		Name: ra.ClientRange, Type: "iprange",
		StartIP: w.ClientRangeStart, EndIP: w.ClientRangeEnd,
		Comment: "IPsec " + w.Name,
	}); err != nil && !isDuplicateErr(err) {
		respondDeviceErrorMsg(c, err, "client range address", "FortiGate error (client range address): "+err.Error())
		return
	}

	if native {
		createNativeL2TPTunnel(c, fc, inp, w, ra, localAddrs)
		return
	}

	// 2. Split-tunnel group over the chosen local addresses — must exist before phase1 references it.
	if w.SplitTunnel {
		if err := fc.CreateAddressGroupWithMembers(ra.SplitGroup, localAddrs, "IPsec "+w.Name); err != nil && !isDuplicateErr(err) {
			respondDeviceErrorMsg(c, err, "split tunnel group", "FortiGate error (split tunnel group): "+err.Error())
			return
		}
	}

	// 3. The dialup tunnel (phase1 mode-config + a 0.0.0.0/0 phase2). This is the hard-error path.
	if err := fc.CreateIPsecTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	// ── Best-effort follow-ups: the tunnel already exists, so report these as warnings. ──
	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }

	// 4. Remote-to-local policy: the client pool reaches the local networks. NEVER NAT — the pool
	//    IPs are routable and the FortiGate installs a route for them out the tunnel interface, so
	//    the LAN sees the real client address and can reply through the FortiGate.
	dst := []string{"all"}
	if w.SplitTunnel {
		dst = []string{ra.SplitGroup}
	}
	if _, err := fc.CreatePolicy(services.FGPolicy{
		Name:       ra.PolicyRemoteToLocal,
		SrcIntf:    services.NamesToFGNames([]string{w.Name}),
		DstIntf:    services.NamesToFGNames([]string{defaultLocalInterface(inp.LocalInterface, w.Interface)}),
		SrcAddr:    services.NamesToFGNames([]string{ra.ClientRange}),
		DstAddr:    services.NamesToFGNames(dst),
		Service:    services.NamesToFGNames([]string{"ALL"}),
		Schedule:   "always",
		Action:     "accept",
		Status:     "enable",
		NAT:        services.FGBoolToString(false),
		LogTraffic: "utm",
		Comments:   "IPsec " + w.Name,
	}); err != nil && !isDuplicateErr(err) {
		warn("remote-to-local policy not created: %v", err)
	}

	// "Allow Endpoint Registration" is a GUI toggle with NO CMDB field on FortiOS 7.2 (FortiClient
	// registration moved to EMS/ZTNA). There is nothing to write; say so rather than pretend.
	if inp.EndpointRegistration {
		warn("endpoint registration is handled by FortiClient EMS on FortiOS 7.2 — no device change was made for it")
	}

	// A mode-config client builds no L2TP policy, and no split group unless split tunnelling is on.
	built := ra
	built.PolicyL2TP = ""
	if !w.SplitTunnel {
		built.SplitGroup = ""
	}

	resp := gin.H{"message": "Remote Access VPN created on device", "name": w.Name, "objects": built}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusCreated, resp)
}

// createNativeL2TPTunnel builds the Native (iOS / Android / Windows) template — an L2TP-over-IPsec
// VPN. Its object set is NOT the mode-config one; it was read back verbatim from a tunnel the
// FortiGate's own Native wizard created (FGT80E/7.2.10):
//
//	vpn l2tp (SINGLETON) status=enable, sip=<range start>, eip=<range end>, usrgrp=<group>
//	phase1 <N>           dialup, NO mode-cfg, NO xauth, NO authusrgrp — the L2TP server does all three
//	phase2 <N>           encapsulation=transport-mode, l2tp=enable
//	address <N>_range    the client pool
//	policy vpn_<N>_l2tp  srcintf=<N> → dstintf=<incoming>, all→all, service=L2TP, NAT off
//	policy vpn_<N>_remote srcintf=l2t.root → dstintf=<local>, <N>_range→<local addrs>, NAT ON
//	route                dst=network(range start, subnet mask) out l2t.root
//
// The caller has already created <N>_range.
func createNativeL2TPTunnel(
	c *gin.Context, fc deviceClient, inp tunnelInput,
	w services.FGIPsecTunnelWrite, ra services.RemoteAccessObjectNames, localAddrs []string,
) {
	// 2. The L2TP server. ⚠️ SINGLETON — one per VDOM, so this REPLACES whatever a previous Native
	//    VPN put there. It must exist before phase2 turns l2tp on.
	if err := fc.EnableL2TPServer(w.ClientRangeStart, w.ClientRangeEnd, w.UserGroup); err != nil {
		respondDeviceErrorMsg(c, err, "L2TP server", "FortiGate error (L2TP server): "+err.Error())
		return
	}

	// 3. The tunnel: phase1 (no mode-config) + phase2 (transport-mode + l2tp).
	if err := fc.CreateIPsecTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	var warnings []string
	warn := func(format string, a ...interface{}) { warnings = append(warnings, fmt.Sprintf(format, a...)) }

	// 4. The L2TP policy — lets the L2TP session itself run inside the IPsec tunnel. It is the only
	//    reason the tunnel carries anything: without it the SA comes up and L2TP never connects.
	if _, err := fc.CreatePolicy(services.FGPolicy{
		Name:       ra.PolicyL2TP,
		SrcIntf:    services.NamesToFGNames([]string{w.Name}),      // the IPsec tunnel
		DstIntf:    services.NamesToFGNames([]string{w.Interface}), // where the tunnel terminates
		SrcAddr:    services.NamesToFGNames([]string{"all"}),
		DstAddr:    services.NamesToFGNames([]string{"all"}),
		Service:    services.NamesToFGNames([]string{"L2TP"}), // UDP 1701
		Schedule:   "always",
		Action:     "accept",
		Status:     "enable",
		NAT:        services.FGBoolToString(false),
		LogTraffic: "utm",
		Comments:   "IPsec " + w.Name,
	}); err != nil && !isDuplicateErr(err) {
		warn("L2TP policy not created: %v", err)
	}

	// 5. Remote-to-local: the clients emerge on l2t.root once L2TP terminates them — NOT on the
	//    IPsec tunnel interface. NAT is ON here, which is what the device's own wizard does.
	if _, err := fc.CreatePolicy(services.FGPolicy{
		Name:       ra.PolicyRemoteToLocal,
		SrcIntf:    services.NamesToFGNames([]string{services.L2TPInterface()}),
		DstIntf:    services.NamesToFGNames([]string{defaultLocalInterface(inp.LocalInterface, w.Interface)}),
		SrcAddr:    services.NamesToFGNames([]string{ra.ClientRange}),
		DstAddr:    services.NamesToFGNames(localAddrs),
		Service:    services.NamesToFGNames([]string{"ALL"}),
		Schedule:   "always",
		Action:     "accept",
		Status:     "enable",
		NAT:        services.FGBoolToString(true),
		LogTraffic: "utm",
		Comments:   "IPsec " + w.Name,
	}); err != nil && !isDuplicateErr(err) {
		warn("remote-to-local policy not created: %v", err)
	}

	// 6. The L2TP route: tells the device the client network lives out l2t.root. Its destination is
	//    the range START masked by the Subnet Mask — see services.L2TPRouteDst.
	dst := services.L2TPRouteDst(w.ClientRangeStart, defaultStr2(w.ClientNetmask, "255.255.255.255"))
	if _, err := fc.CreateStaticRoute(services.FGStaticRouteWrite{
		VDOM: "root", DstType: "subnet", Dst: dst,
		Device: services.L2TPInterface(), Comment: "IPsec " + w.Name,
	}); err != nil {
		warn("L2TP route to %s not created: %v", dst, err)
	}

	// L2TP has no split tunnel — the wizard forces it off for these clients.
	built := ra
	built.SplitGroup = ""

	resp := gin.H{"message": "Remote Access VPN created on device", "name": w.Name, "objects": built}
	if len(warnings) > 0 {
		resp["warnings"] = warnings
	}
	c.JSON(http.StatusCreated, resp)
}

// isRAPolicyName reports whether a policy is one this wizard generated for `tunnel`. It exists for
// the Native template's remote-to-local policy, which runs l2t.root → LAN: the tunnel interface is
// nowhere in it, so the interface match alone would leave it behind (and it pins <tunnel>_range,
// which then fails to delete with -23).
func isRAPolicyName(policyName, tunnel string) bool {
	ra := services.RemoteAccessObjectNamesFor(tunnel)
	return policyName == ra.PolicyRemoteToLocal || policyName == ra.PolicyL2TP
}
