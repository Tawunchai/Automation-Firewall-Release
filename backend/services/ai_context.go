// Package services - AI Assistant: converts plain-language requests into FortiOS CLI commands
// using the Anthropic Claude API (FortiGate / FortiOS only).
package services

import (
	"fmt"
	"log"
	"network_automation/services/platform"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"network_automation/entity"
)

// Live device context: what the assistant is told about THIS firewall before it answers.
//
// buildLiveDeviceContext fires sixteen concurrent reads at the device and folds the answers into
// the prompt, which is what lets the model reuse an address that already exists instead of inventing
// a duplicate. Lifted out of ai.go whole - no logic changed, only where it lives.

func deviceAPIClient(device *entity.NetworkDevice, login DeviceLogin, port int) (*FortiClient, error) {
	if strings.TrimSpace(login.Username) == "" {
		return nil, fmt.Errorf("no account is set up for this device")
	}
	return AcquireFortiClient(device.ID, device.MgmtIP, port, login)
}

// buildDeviceSnapshot does the device reads. Returns nil when the device could not be reached at
// all — that is the one case the caller must not cache, because a credential being fixed or a link
// coming back should take effect on the next prompt, not in a minute.
func buildDeviceSnapshot(device *entity.NetworkDevice, login DeviceLogin) *liveContextSnapshot {
	fc, err := deviceAPIClient(device, login, device.APIPort)
	if err != nil {
		// Best-effort by contract: the caller still generates config, just without live context.
		// Logged because a silent "" here is indistinguishable from a device with nothing on it.
		log.Printf("[ai] live device context unavailable for device %d (%s): %v", device.ID, device.MgmtIP, err)
		return nil
	}

	// Every section below is an independent read against the device, and the FortiGate serves
	// them concurrently on one authenticated session (http.Client + cookie jar are goroutine-safe).
	// Fetching them sequentially made this the slowest part of a request that is otherwise
	// dominated by the model; running them in parallel and assembling the text in a FIXED order
	// afterwards keeps the prompt byte-identical while collapsing the wall-clock to the slowest
	// single section. Order matters: the system prompt is prompt-cached, so the assembled string
	// must not depend on which goroutine finished first.
	var (
		wg                                       sync.WaitGroup
		sIfaces, sAddrs, sSvcs, sProfiles, sPols string
		sScheds, sRoutes, sVIPs                  string
		appMeta                                  AppControlMetadata
		sAppLists                                string
		appCoverage                              map[string]appListCoverage
		sWebMeta, sWebLists, sWebTables          string
		sDNSLists                                string
		sFileFilter, sUsers                      string
		sAuthServers                             string
		ifaces                                   []FGSystemInterface
		routes                                   []FGStaticRoute
		sSDWAN                                   string
	)
	run := func(fn func()) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			fn()
		}()
	}

	run(func() { sAddrs = addressesContext(fc) })
	run(func() { sSvcs = servicesContext(fc) })
	run(func() { sProfiles = securityProfileNamesContext(fc) })
	run(func() { sPols = policyNamesContext(fc) })
	run(func() { sVIPs = virtualIPsContext(fc) })
	run(func() { sScheds = schedulesContext(fc) })
	// Interfaces and routes are fetched here but RENDERED after the wait: the INTERFACES table has to
	// tag whichever interface holds the default route, and that is the routing table's fact, not the
	// interface's. Fetching them in parallel and joining afterwards keeps both reads concurrent —
	// making one goroutine do both, in order, would have put two device round trips back in series.
	run(func() { ifaces, _ = fc.GetSystemInterfaces() })
	run(func() { routes, _ = fc.GetStaticRoutes() })
	run(func() {
		// The signature DB is the input to BOTH of these, so they share one goroutine.
		// GetAppControlMetadata is cached per device (see fortigate.go), so this is usually free.
		// appControlContext is NOT called here: it depends on the PROMPT, so it is rendered per
		// request out of the cached signature database (see renderLiveContext).
		appMeta = fc.GetAppControlMetadata()
		sAppLists, appCoverage = existingAppListsContext(fc, appMeta)
	})
	run(func() { sWebMeta = webFilterContext(fc.GetWebFilterMetadata("")) })
	var wfTableIDs map[string][]int
	run(func() { sWebTables, wfTableIDs = webfilterTableIDContext(fc) })
	run(func() { sFileFilter = fileFilterContext(fc) })
	run(func() { sUsers = usersAndGroupsContext(fc) })
	run(func() { sAuthServers = authServersContext(fc) })
	run(func() { sSDWAN = sdwanContext(fc) })

	var wfCoverage map[string]map[string]bool
	run(func() { sWebLists, wfCoverage = existingWebFilterContext(fc) })

	var dnsCoverage map[string]map[string]bool
	run(func() { sDNSLists, dnsCoverage = existingDNSFilterContext(fc) })

	wg.Wait()

	sIfaces = interfacesContext(ifaces, defaultRouteIfaces(routes))
	sRoutes = staticRoutesContext(routes)

	// ── Assemble in a fixed, deterministic order ──────────────────────────────
	// The device object inventory is truncated first; the Application Control signature ids and
	// the coverage sections are appended AFTER that truncation so a long object list can never
	// starve the ids the model must quote verbatim (an invented id silently matches nothing).
	//
	// The cut is UTF-8-safe: object names, comments and interface aliases on a real device are
	// routinely Thai, and a plain out[:inventoryBudget] lands inside a multi-byte character often
	// enough to matter. The fragment it leaves is not valid UTF-8, so json.Marshal replaces it with
	// U+FFFD and the model receives a corrupted final line — in a section whose whole purpose is
	// names it must quote back verbatim.
	out := sIfaces + sAddrs + sSvcs + sProfiles + sPols
	if len(out) > inventoryBudget {
		out = out[:platform.RuneSafeCut(out, inventoryBudget)] + "\n… (truncated)"
	}
	// Schedules and routes are appended AFTER the truncation (like the coverage sections): both are
	// short, and a device with hundreds of addresses must not silently starve the model of the two
	// lists it needs to avoid duplicating a schedule or a route.
	// The File Filter type catalogue and the user/group/FortiToken lists are appended after the
	// truncation for the same reason as the coverage sections: they are datasources the model has
	// to quote verbatim, and a device with hundreds of addresses must not starve them out.
	// SD-WAN joins the post-truncation group for the usual reason plus one of its own: the model has
	// to see which servers the existing performance SLAs already probe, because two of them may not
	// share one (error -7 discards the whole write).
	//
	// The three pieces are kept apart rather than joined here because the Application Control
	// section sits BETWEEN mid and tail and is the one part that depends on the prompt — see the
	// snapshot-cache note above. renderLiveContext does the join, in this order.
	return &liveContextSnapshot{
		head: out,
		mid:  sScheds + sRoutes + sVIPs,
		tail: sAppLists + sWebMeta + sWebLists + sWebTables + sDNSLists + sFileFilter + sUsers + sAuthServers + sSDWAN,
		facts: &deviceFacts{appMeta: appMeta, appCoverage: appCoverage, wfCoverage: wfCoverage,
			dnsCoverage: dnsCoverage, wfTableIDs: wfTableIDs},
		at: time.Now(),
	}
}

// addressesContext lists the address objects the AI must reuse before creating new ones.
func addressesContext(fc *FortiClient) string {
	var b strings.Builder
	if addrs, e := fc.GetAddresses(); e == nil && len(addrs) > 0 {
		b.WriteString("\nADDRESS OBJECTS (name = value [iface] — reuse a match; [iface] = usable ONLY on that interface):\n")
		n := 0
		for _, a := range addrs {
			val := a.Type
			switch a.Type {
			case "ipmask":
				val = FGSubnetToCIDR(a.Subnet)
			case "iprange":
				val = a.StartIP + "-" + a.EndIP
			case "fqdn":
				val = a.FQDN
			case "geography":
				val = "geo:" + a.Country
			}
			// associated-interface locks an address to one interface (FortiGate rejects it in a
			// policy on any other interface — the exact cause of an "entry not found in datasource"
			// error), so surface it so the AI only reuses interface-compatible addresses.
			bind := ""
			if a.Interface != "" {
				bind = " [" + a.Interface + "]"
			}
			b.WriteString(fmt.Sprintf("  - %s = %s%s\n", a.Name, val, bind))
			if n++; n >= 60 {
				b.WriteString("  … (more not shown)\n")
				break
			}
		}
	}
	return b.String()
}

// servicesContext lists the service objects (so the AI maps a port to an existing service
// instead of emitting a duplicate "config firewall service custom" block).
func servicesContext(fc *FortiClient) string {
	svcs, e := fc.GetServices()
	if e != nil || len(svcs) == 0 {
		return ""
	}
	names := make([]string, 0, 80)
	for _, s := range svcs {
		names = append(names, s.Name)
		if len(names) >= 80 {
			break
		}
	}
	return "\nSERVICE OBJECTS (name): " + strings.Join(names, ", ") + "\n"
}

// securityProfileNamesContext lists the AntiVirus / DNS Filter / File Filter profile NAMES, so
// the AI reuses a suitable existing profile instead of proposing a duplicate name (FortiGate
// rejects a duplicate with error -5), and only creates a new one when nothing fits.
// (Web Filter and Application Control get their own, richer coverage sections — names alone lie.)
func securityProfileNamesContext(fc *FortiClient) string {
	var b strings.Builder
	if av, e := fc.GetAVProfiles(); e == nil && len(av) > 0 {
		fmt.Fprintf(&b, "\nANTIVIRUS PROFILES: %s\n", strings.Join(FGNamesToStrings(av), ", "))
	}
	secProfileList := func(label, category string) {
		if items, e := fc.GetSecurityProfiles(category); e == nil && len(items) > 0 {
			names := make([]string, 0, len(items))
			for _, p := range items {
				if p.Name != "" {
					names = append(names, p.Name)
				}
			}
			if len(names) > 0 {
				fmt.Fprintf(&b, "\n%s: %s\n", label, strings.Join(names, ", "))
			}
		}
	}
	secProfileList("DNS FILTER PROFILES", "dnsfilter")
	secProfileList("FILE FILTER PROFILES", "file-filter")
	return b.String()
}

// fileFilterContext lists the file-type catalogue a File Filter rule must draw from. The names
// are a datasource: an invented one is rejected with "-3 entry not found in datasource", so the
// model has to quote these verbatim.
func fileFilterContext(fc *FortiClient) string {
	meta := fc.GetFileFilterMetadata()
	if len(meta.FileTypes) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nFILE FILTER TYPES (use these EXACT names in \"set file-type\", nothing else):\n  ")
	b.WriteString(strings.Join(meta.FileTypes, " "))
	fmt.Fprintf(&b, "\nFILE FILTER PROTOCOLS (flow mode): %s", strings.Join(meta.Protocols, " "))
	fmt.Fprintf(&b, "\nFILE TYPES VALID WITH \"set password-protected yes\": %s (any other type ⇒ error -3)\n",
		strings.Join(meta.PasswordProtectedFileTypes, " "))
	return b.String()
}

// usersAndGroupsContext lists the local users, the groups (with what each one accepts as a
// member) and the FortiToken serials. All three are datasources: a member or token the device
// doesn't have fails the whole block, so the model must reuse these names or create the object
// first.
func usersAndGroupsContext(fc *FortiClient) string {
	var b strings.Builder

	users, usersErr := fc.GetLocalUsers()
	if usersErr == nil && len(users) > 0 {
		b.WriteString("\nEXISTING USERS (user local — reuse as group members; do NOT recreate):\n")
		for _, u := range users {
			line := "  " + u.Name + " [" + u.Type + "]"
			if len(u.Groups) > 0 {
				line += " in " + strings.Join(u.Groups, ",")
			}
			if !u.Enabled {
				line += " (disabled)"
			}
			fmt.Fprintf(&b, "%s\n", line)
		}
	} else if usersErr != nil {
		// A read that FAILED is not an empty device. Saying "none" here is the prompt telling the
		// model to create users that already exist, and FortiGate then refuses the Apply with -5.
		b.WriteString("\nEXISTING USERS: could not be read from this device — assume nothing. " +
			"Do NOT propose creating users, and say the list was unavailable.\n")
	} else {
		b.WriteString("\nEXISTING USERS: none — a group's members must be created first.\n")
	}

	if groups, err := fc.GetUserGroups(); err == nil && len(groups) > 0 {
		b.WriteString("EXISTING USER GROUPS (names collide across ALL types — a duplicate is error -5):\n")
		for _, g := range groups {
			line := "  " + g.Name + " [" + g.TypeCode + "]"
			if len(g.Members) > 0 {
				line += " members: " + strings.Join(g.Members, ",")
			} else if !UserGroupTakesMembers(g.TypeCode) {
				line += " (this type takes NO members)"
			}
			fmt.Fprintf(&b, "%s\n", line)
		}
	}

	opts := fc.GetLocalUserOptions()
	if len(opts.FortiTokens) > 0 {
		fmt.Fprintf(&b, "FORTITOKENS (use a serial VERBATIM for \"set fortitoken\"): %s\n",
			strings.Join(opts.FortiTokens, " "))
	} else {
		b.WriteString("FORTITOKENS: none registered — do NOT propose \"set two-factor fortitoken\".\n")
	}
	// FortiToken Cloud needs a subscription; this lab device has none, so proposing it just
	// fails with -7706. Say so rather than letting the model guess.
	b.WriteString("FORTITOKEN CLOUD: not subscribed on this device — \"set two-factor fortitoken-cloud\" " +
		"fails with error -7706. Use a FortiToken serial instead.\n")
	return b.String()
}

// authServersContext lists the remote authentication servers already on the device, so the model
// REUSES one instead of proposing a second server for the same host (a duplicate NAME is -5, and
// two objects pointing at the same AD/NPS box is a configuration smell either way).
//
// The CA certificates and Exchange connectors are named too: both are FortiOS DATASOURCES, so an
// LDAP block quoting a name the device does not have fails with a bare "-3 entry not found in
// datasource" — the model has to pick from these lists or leave the field out entirely.
func authServersContext(fc *FortiClient) string {
	var b strings.Builder

	ldap, ldapErr := fc.GetLDAPServers()
	if ldapErr == nil && len(ldap) > 0 {
		b.WriteString("\nEXISTING LDAP SERVERS (user ldap — reuse; a duplicate name is error -5):\n")
		for _, sv := range ldap {
			line := "  " + sv.Name + " → " + sv.Server + ":" + strconv.Itoa(sv.Port) +
				" bind=" + sv.BindType + " dn=" + sv.DN
			if sv.Secure != LDAPSecureDisable {
				line += " (" + sv.Secure + ")"
			}
			fmt.Fprintf(&b, "%s\n", line)
		}
	} else if ldapErr != nil {
		b.WriteString("\nEXISTING LDAP SERVERS: could not be read from this device — assume " +
			"nothing, and do NOT propose a new one.\n")
	} else {
		b.WriteString("\nEXISTING LDAP SERVERS: none.\n")
	}

	radius, radiusErr := fc.GetRADIUSServers()
	if radiusErr == nil && len(radius) > 0 {
		b.WriteString("EXISTING RADIUS SERVERS (user radius — reuse; a duplicate name is error -5):\n")
		for _, sv := range radius {
			line := "  " + sv.Name + " → " + sv.Server
			if sv.SecondaryServer != "" {
				line += " / " + sv.SecondaryServer
			}
			line += " auth=" + sv.AuthType
			if sv.AllUserGroup {
				line += " (in every user group)"
			}
			fmt.Fprintf(&b, "%s\n", line)
		}
	} else if radiusErr != nil {
		b.WriteString("EXISTING RADIUS SERVERS: could not be read from this device — assume " +
			"nothing, and do NOT propose a new one.\n")
	} else {
		b.WriteString("EXISTING RADIUS SERVERS: none.\n")
	}

	opts := fc.GetLDAPServerOptions()
	if len(opts.CACerts) > 0 {
		// ~150 names on this device; the model only needs to know the field is a datasource and
		// to see enough of it to recognise a real one.
		shown := opts.CACerts
		if len(shown) > 25 {
			shown = shown[:25]
		}
		fmt.Fprintf(&b, "CA CERTIFICATES for \"set ca-cert\" (datasource — an unknown name is error -3; "+
			"%d on the device, first 25): %s\n", len(opts.CACerts), strings.Join(shown, " "))
	}
	if len(opts.ExchangeServers) > 0 {
		names := make([]string, 0, len(opts.ExchangeServers))
		for _, e := range opts.ExchangeServers {
			names = append(names, e.Name)
		}
		fmt.Fprintf(&b, "EXCHANGE CONNECTORS for \"set user-info-exchange-server\": %s\n",
			strings.Join(names, " "))
	} else {
		b.WriteString("EXCHANGE CONNECTORS: none — do NOT set user-info-exchange-server " +
			"(an unknown name is error -3); leave obtain-user-info disabled.\n")
	}
	return b.String()
}

// schedulesContext lists the schedules already on the device, with their days and hours, so the AI
// reuses an equivalent one instead of emitting a second schedule that means the same thing. Without
// this section the model cannot see them at all and duplicates them every time (verified: a device
// holding "WorkHours = Mon-Fri 08:30-17:30" still got a fresh "Mon-Fri-0830-1730" proposed).
// The hours are printed because the NAME is not evidence — reuse must be judged on the actual window.
func schedulesContext(fc *FortiClient) string {
	scheds, e := fc.GetSchedulesAll()
	if e != nil || len(scheds) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nSCHEDULES (reuse one whose DAYS+HOURS already match the request — do not create a twin):\n")
	for _, s := range scheds {
		switch s.Type {
		case "recurring":
			hours := s.Start + "-" + s.End
			if s.Start == "00:00" && s.End == "00:00" {
				hours = "all day"
			}
			b.WriteString(fmt.Sprintf("  - %s | recurring | %s | %s\n", s.Name, strings.Join(s.Day, " "), hours))
		case "onetime":
			b.WriteString(fmt.Sprintf("  - %s | onetime | %s → %s\n", s.Name, s.Start, s.End))
		case "group":
			b.WriteString(fmt.Sprintf("  - %s | group | members: %s\n", s.Name, strings.Join(s.Member, ", ")))
		}
	}
	b.WriteString("  (\"always\" = 24/7 built-in. A schedule name is shared across ALL three types on FortiGate —\n" +
		"   a new one may not take a name in this list.)\n")
	return b.String()
}

// sdwanContext is what the model needs before it proposes anything under `config system sdwan`.
//
// Four things go here, and each one prevents a specific device refusal:
//
//   - whether SD-WAN is ON. Off means the objects are still worth creating, but the explanation has
//     to say they will not steer anything yet — and the model must not claim otherwise.
//   - the zones and members that exist. An interface can be an SD-WAN member exactly once, and a
//     member's zone must already exist or be created in the same block (-3 otherwise).
//   - the performance SLAs AND THE SERVERS THEY PROBE. Two health checks may not name the same
//     server: the second is refused with "Server X is duplicated in the A and B" (-7) and the whole
//     write is discarded. The names alone are not enough to avoid that — the servers are the point.
//   - the rule names, so a proposal does not collide with one.
//
// Best-effort like every other section: a device that cannot be read contributes nothing rather
// than failing the request.
func sdwanContext(fc *FortiClient) string {
	overview, err := fc.GetSDWAN()
	if err != nil {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nSD-WAN — ")
	if overview.Enabled {
		b.WriteString("ENABLED")
	} else {
		// Said in the imperative because the model otherwise writes "SD-WAN is now active".
		b.WriteString("DISABLED on this device. Still emit the objects if asked, but say in the " +
			"explanation that the user must enable SD-WAN from Network > SD-WAN afterwards — the app " +
			"deliberately never writes `set status enable`")
	}
	if overview.LoadBalanceMode != "" {
		fmt.Fprintf(&b, " | load-balance-mode: %s", overview.LoadBalanceMode)
	}
	b.WriteString("\n")

	if len(overview.Zones) == 0 {
		b.WriteString("  EXISTING SD-WAN ZONES: none — a member needs one, so create a zone in the same block\n")
	} else {
		names := make([]string, 0, len(overview.Zones))
		for _, z := range overview.Zones {
			names = append(names, z.Name)
		}
		fmt.Fprintf(&b, "  EXISTING SD-WAN ZONES (reuse one instead of creating a twin): %s\n",
			strings.Join(names, " "))
	}

	if len(overview.Members) == 0 {
		b.WriteString("  EXISTING SD-WAN MEMBERS: none\n")
	} else {
		b.WriteString("  EXISTING SD-WAN MEMBERS (an interface can be a member only ONCE — seq | interface | zone):\n")
		for _, m := range overview.Members {
			b.WriteString(fmt.Sprintf("    - %d | %s | %s\n", m.SeqNum, m.Interface, m.Zone))
		}
	}

	if checks, e := fc.GetSDWANHealthChecks(); e == nil {
		if len(checks) == 0 {
			b.WriteString("  EXISTING PERFORMANCE SLAs: none\n")
		} else {
			b.WriteString("  EXISTING PERFORMANCE SLAs — DO NOT REUSE ANY SERVER LISTED HERE " +
				"(two SLAs probing the same server is error -7 and the whole write is discarded):\n")
			for _, c := range checks {
				server := strings.Join(c.Servers, " ")
				if c.SystemDNS {
					server = "system DNS"
				}
				if server == "" {
					server = "-"
				}
				b.WriteString(fmt.Sprintf("    - %s | %s | %s\n", c.Name, c.Protocol, server))
			}
		}
	}

	// WHICH INTERFACES CAN EVEN JOIN. Measured on the lab FortiGate: adding an interface that a
	// firewall policy still names as its srcintf/dstintf is refused with
	// «entry not found in datasource ... Return code -3» — a message that says nothing about the
	// policy, the interface, or what to do. wan1/lan/dmz/port1 were all refused there; wan2 and ha,
	// which no policy names, were accepted. So the model is told up front, because proposing an
	// ineligible interface produces a proposal that cannot be applied at all.
	if pols, e := fc.GetPolicies(); e == nil {
		used := map[string]bool{}
		for _, p := range pols {
			for _, list := range [][]FGName{p.SrcIntf, p.DstIntf} {
				for _, n := range list {
					if n.Name != "" && !strings.EqualFold(n.Name, "any") {
						used[n.Name] = true
					}
				}
			}
		}
		if len(used) > 0 {
			names := make([]string, 0, len(used))
			for n := range used {
				names = append(names, n)
			}
			sort.Strings(names)
			fmt.Fprintf(&b, "  INTERFACES THAT CANNOT BECOME SD-WAN MEMBERS (a firewall policy still "+
				"names them — FortiGate refuses with error -3 until that reference is removed): %s\n",
				strings.Join(names, " "))
			b.WriteString("  → Choose SD-WAN members from interfaces NOT in that list. If the user " +
				"explicitly asks for one that is, still propose it, but say in the explanation which " +
				"policies have to be repointed at the SD-WAN zone first.\n")
		}
	}

	if list, e := fc.GetSDWANRuleList(); e == nil && len(list.Rules) > 0 {
		names := make([]string, 0, len(list.Rules))
		for _, r := range list.Rules {
			names = append(names, r.Name)
		}
		fmt.Fprintf(&b, "  EXISTING SD-WAN RULES (a duplicate name is error -5): %s\n",
			strings.Join(names, " "))
	}
	return b.String()
}

// policyNamesContext lists every existing policy name — the AI must never reuse one.
func policyNamesContext(fc *FortiClient) string {
	pols, e := fc.GetPolicies()
	if e != nil {
		return ""
	}
	names := make([]string, 0, len(pols))
	for _, p := range pols {
		if p.Name != "" {
			names = append(names, p.Name)
		}
	}
	return fmt.Sprintf("\nEXISTING POLICY NAMES (never reuse): %s\n(total %d policies; a new policy appends at the bottom)\n",
		strings.Join(names, ", "), len(pols))
}

// virtualIPsContext lists the VIPs already on the device with what each maps, so the AI reuses a
// matching one (two VIPs can't share an extip on one interface — that is -34) instead of a twin,
// and never collides on a name.
func virtualIPsContext(fc *FortiClient) string {
	vips, e := fc.GetVirtualIPs()
	if e != nil || len(vips) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString("\nEXISTING VIRTUAL IPs (reuse a matching one; never reuse a name; one extip per interface — a duplicate is -34):\n")
	for i, v := range vips {
		if i >= 20 {
			break
		}
		switch v.Type {
		case "fqdn":
			b.WriteString(fmt.Sprintf("  - %s [%s]: fqdn %s → %s\n", v.Name, v.Interface, v.ExtAddr, v.MappedAddr))
		default:
			port := ""
			if v.PortForward {
				port = fmt.Sprintf(" %s %s→%s", v.Protocol, v.ExtPort, v.MappedPort)
			}
			b.WriteString(fmt.Sprintf("  - %s [%s]: %s → %s%s\n", v.Name, v.Interface, v.ExtIP, v.MappedIP, port))
		}
	}
	return b.String()
}
