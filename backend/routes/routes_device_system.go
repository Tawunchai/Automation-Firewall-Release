package routes

import (
	"github.com/gin-gonic/gin"
	po "network_automation/controller/policyobject"
)

// The firewall's own system surface: its dashboard, interfaces, routing, DHCP, logging, SNMP, HA,
// administrators, VPN and SD-WAN.
//
// The split from routes_device_objects.go is the one FortiGate's own GUI makes — what the device
// IS, as against what it ENFORCES — so a route is looked for where the page that calls it lives.
func registerDeviceSystem(protected *gin.RouterGroup) {
	// ── The device's virtual domains ──────────────────────────────────────
	//
	// Read-only. Every other device route accepts ?vdom=<name> and is scoped by it in ONE
	// place (buildClient), so this list is what the navbar's picker is built from. There is no
	// create: splitting a firewall into VDOMs restarts its services and moves every existing
	// object, which is not a thing to offer beside an Addresses page.
	protected.GET("/policy/device/:deviceId/vdoms", po.DeviceListVDOMs)

	// ── System > Dashboard > Status (live device telemetry) ───────────────
	// Full snapshot; /usage is the light polling endpoint behind the charts.
	protected.GET("/policy/device/:deviceId/dashboard", po.DeviceGetDashboard)
	protected.GET("/policy/device/:deviceId/dashboard/usage", po.DeviceGetResourceUsage)

	// Device interfaces list (policy-eligible pickers)
	protected.GET("/policy/device/:deviceId/interfaces", po.DeviceListInterfaces)

	// ── Network > Interfaces (read-only listing) ──────────────────────────
	// Read-only by design — interfaces are changed on the device itself, so there is no
	// create/update/delete route here and no write path to a firewall's interfaces.
	protected.GET("/policy/device/:deviceId/system-interfaces", po.DeviceListSystemInterfaces)

	// ── Network > Static Routes ───────────────────────────────────────────
	protected.GET("/policy/device/:deviceId/static-routes", po.DeviceListStaticRoutes)
	protected.GET("/policy/device/:deviceId/route-interfaces", po.DeviceListRouteInterfaces)
	protected.GET("/policy/device/:deviceId/internet-services", po.DeviceListInternetServices)
	protected.GET("/policy/device/:deviceId/static-routes/:seq", po.DeviceGetStaticRoute)
	protected.POST("/policy/device/:deviceId/static-routes", po.DeviceCreateStaticRoute)
	protected.PATCH("/policy/device/:deviceId/static-routes/:seq", po.DeviceUpdateStaticRoute)
	protected.DELETE("/policy/device/:deviceId/static-routes/:seq", po.DeviceDeleteStaticRoute)

	// ── Network > DHCP Servers ────────────────────────────────────────────
	protected.GET("/policy/device/:deviceId/dhcp-servers", po.DeviceListDHCPServers)
	protected.GET("/policy/device/:deviceId/dhcp-servers/:id", po.DeviceGetDHCPServer)
	protected.POST("/policy/device/:deviceId/dhcp-servers", po.DeviceCreateDHCPServer)
	protected.PATCH("/policy/device/:deviceId/dhcp-servers/:id", po.DeviceUpdateDHCPServer)
	protected.DELETE("/policy/device/:deviceId/dhcp-servers/:id", po.DeviceDeleteDHCPServer)

	// ── Log & Report > Log Settings ───────────────────────────────────────
	// Five single-object tables behind one page; the PATCH applies only the sections sent.
	protected.GET("/policy/device/:deviceId/log-settings", po.DeviceGetLogSettings)
	protected.PATCH("/policy/device/:deviceId/log-settings", po.DeviceUpdateLogSettings)

	// ── System > SNMP ─────────────────────────────────────────────────────
	// Three CMDB tables behind one page: the agent itself (a single object), the v1/v2c
	// communities, and the v3 users. Writes are admin-only — a community string is a shared
	// password and a v3 user carries two real ones.
	protected.GET("/policy/device/:deviceId/snmp/sysinfo", po.DeviceGetSNMPSysInfo)
	protected.PATCH("/policy/device/:deviceId/snmp/sysinfo", po.DeviceUpdateSNMPSysInfo)
	protected.GET("/policy/device/:deviceId/snmp/communities", po.DeviceListSNMPCommunities)
	protected.GET("/policy/device/:deviceId/snmp/communities/:id", po.DeviceGetSNMPCommunity)
	protected.POST("/policy/device/:deviceId/snmp/communities", po.DeviceCreateSNMPCommunity)
	protected.PATCH("/policy/device/:deviceId/snmp/communities/:id", po.DeviceUpdateSNMPCommunity)
	protected.DELETE("/policy/device/:deviceId/snmp/communities/:id", po.DeviceDeleteSNMPCommunity)
	protected.GET("/policy/device/:deviceId/snmp/users", po.DeviceListSNMPUsers)
	protected.GET("/policy/device/:deviceId/snmp/users/:name", po.DeviceGetSNMPUser)
	protected.POST("/policy/device/:deviceId/snmp/users", po.DeviceCreateSNMPUser)
	protected.PATCH("/policy/device/:deviceId/snmp/users/:name", po.DeviceUpdateSNMPUser)
	protected.DELETE("/policy/device/:deviceId/snmp/users/:name", po.DeviceDeleteSNMPUser)

	// ── System > HA Status ────────────────────────────────────────────────
	// Read-only on purpose: forming or breaking a cluster changes what the unit IS, FortiOS
	// does it with no confirmation, and it cannot be verified on a single lab device.
	protected.GET("/policy/device/:deviceId/ha-status", po.DeviceGetHAStatus)

	// ── System > Administrators ───────────────────────────────────────────
	// The FIREWALL's accounts, not this console's. Narrowing an account's trusted hosts needs
	// confirm_lockout; removing the last super_admin is refused outright.
	protected.GET("/policy/device/:deviceId/admin-users", po.DeviceListAdminUsers)
	protected.POST("/policy/device/:deviceId/admin-users", po.DeviceCreateAdminUser)
	protected.PATCH("/policy/device/:deviceId/admin-users/:name", po.DeviceUpdateAdminUser)
	protected.DELETE("/policy/device/:deviceId/admin-users/:name", po.DeviceDeleteAdminUser)

	// ── VPN > IPsec Tunnels ───────────────────────────────────────────────
	// Certificate pickers + Local Gateway prefill for the VPN Creation Wizard
	protected.GET("/policy/device/:deviceId/vpn-metadata", po.DeviceGetVPNMetadata)
	// The device's own routing answer — fills the wizard's Outgoing Interface from a Remote IP
	protected.GET("/policy/device/:deviceId/router-lookup", po.DeviceRouterLookup)
	protected.GET("/policy/device/:deviceId/bgp-summary", po.DeviceGetBGPSummary)
	protected.GET("/policy/device/:deviceId/ipsec-tunnels", po.DeviceListIPsecTunnels)
	protected.GET("/policy/device/:deviceId/ipsec-tunnels/:name", po.DeviceGetIPsecTunnel)
	protected.GET("/policy/device/:deviceId/ipsec-tunnels/:name/full", po.DeviceGetIPsecTunnelFull)
	protected.GET("/policy/device/:deviceId/ipsec-tunnels/:name/hub-spoke", po.DeviceGetHubSpokeTunnel)
	protected.GET("/policy/device/:deviceId/ipsec-tunnels/:name/deletion-preview", po.DeviceGetTunnelDeletionPreview)
	protected.POST("/policy/device/:deviceId/ipsec-tunnels", po.DeviceCreateIPsecTunnel)
	protected.PATCH("/policy/device/:deviceId/ipsec-tunnels/:name", po.DeviceUpdateIPsecTunnel)
	protected.DELETE("/policy/device/:deviceId/ipsec-tunnels/:name", po.DeviceDeleteIPsecTunnel)

	// Fabric/SDN connectors — datasource for a Dynamic (Fabric Connector) address
	protected.GET("/policy/device/:deviceId/sdn-connectors", po.DeviceListSDNConnectors)

	// Network ▸ Topology's fast half — link state + measured throughput, polled to animate a
	// diagram the slow CMDB reads already drew. See DeviceGetTopologyLive.
	protected.GET("/policy/device/:deviceId/topology-live", po.DeviceGetTopologyLive)
	// Same data, pushed instead of polled — see device_livestream.go.
	protected.GET("/policy/device/:deviceId/topology-live/stream", po.DeviceStreamTopologyLive)

	// Bundled schedule/security-profile options for the firewall policy form
	protected.GET("/policy/device/:deviceId/policy-profiles", po.DeviceGetPolicyProfiles)

	// Device-side capability signals for the AntiVirus form (FortiSandbox / FortiGuard AV license)
	protected.GET("/policy/device/:deviceId/antivirus-capabilities", po.DeviceGetAVCapabilities)

	// FortiGuard category taxonomy + picker lists for the Web Filter form
	protected.GET("/policy/device/:deviceId/webfilter-metadata", po.DeviceGetWebFilterMetadata)

	// FortiGuard category taxonomy + licence signals + external resources for the DNS Filter form
	protected.GET("/policy/device/:deviceId/dnsfilter-metadata", po.DeviceGetDNSFilterMetadata)

	// Application category taxonomy + filter attributes + signature DB for the Application Control form
	protected.GET("/policy/device/:deviceId/appcontrol-metadata", po.DeviceGetAppControlMetadata)

	// File-type catalogue + protocol options for the File Filter form
	protected.GET("/policy/device/:deviceId/filefilter-metadata", po.DeviceGetFileFilterMetadata)

	// Signature-derived filter options + signature picker for the IPS Sensor form
	protected.GET("/policy/device/:deviceId/ips-metadata", po.DeviceGetIPSMetadata)

	// Certificates, addresses, FortiGuard categories + default ports for the SSL/SSH form
	protected.GET("/policy/device/:deviceId/sslssh-metadata", po.DeviceGetSSLSSHMetadata)

	// ── Network: SD-WAN (system/sdwan — zone / members / service / health-check) ──
	// Zones tab is full CRUD; Rules and Performance SLAs are reads until their forms exist.
	protected.GET("/policy/device/:deviceId/sdwan", po.DeviceGetSDWAN)
	protected.GET("/policy/device/:deviceId/sdwan/rules", po.DeviceListSDWANRules)
	protected.GET("/policy/device/:deviceId/sdwan/rules/:id", po.DeviceGetSDWANRule)
	protected.POST("/policy/device/:deviceId/sdwan/rules", po.DeviceCreateSDWANRule)
	protected.PUT("/policy/device/:deviceId/sdwan/rules/:id", po.DeviceUpdateSDWANRule)
	protected.DELETE("/policy/device/:deviceId/sdwan/rules/:id", po.DeviceDeleteSDWANRule)
	protected.GET("/policy/device/:deviceId/sdwan/performance-slas", po.DeviceListSDWANHealthChecks)
	protected.GET("/policy/device/:deviceId/sdwan/performance-slas/:name", po.DeviceGetSDWANHealthCheck)
	protected.POST("/policy/device/:deviceId/sdwan/performance-slas", po.DeviceCreateSDWANHealthCheck)
	protected.PUT("/policy/device/:deviceId/sdwan/performance-slas/:name", po.DeviceUpdateSDWANHealthCheck)
	protected.DELETE("/policy/device/:deviceId/sdwan/performance-slas/:name", po.DeviceDeleteSDWANHealthCheck)
	protected.POST("/policy/device/:deviceId/sdwan/zones", po.DeviceCreateSDWANZone)
	protected.PUT("/policy/device/:deviceId/sdwan/zones/:name", po.DeviceUpdateSDWANZone)
	protected.DELETE("/policy/device/:deviceId/sdwan/zones/:name", po.DeviceDeleteSDWANZone)
	protected.POST("/policy/device/:deviceId/sdwan/members", po.DeviceCreateSDWANMember)
	protected.PUT("/policy/device/:deviceId/sdwan/members/:seq", po.DeviceUpdateSDWANMember)
	protected.DELETE("/policy/device/:deviceId/sdwan/members/:seq", po.DeviceDeleteSDWANMember)
}
