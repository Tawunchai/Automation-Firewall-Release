package routes

import (
	"github.com/gin-gonic/gin"
	po "network_automation/controller/policyobject"
)

// Policy & Objects on a live firewall: policies, addresses, services, groups, IP pools, zones,
// schedules, security profiles — and the fleet form of those writes.
//
// Every route here goes through controller/policyobject, which starts at deviceSession: the
// per-user device grant, the read-only refusal and the credential lookup are all there, once, for
// all of them.
func registerDeviceObjects(protected *gin.RouterGroup) {
	// ── Policy & Objects: Device proxy (real FortiGate) ───────────────────
	//
	// There is only ONE Policy & Objects layer, and this is it: every route below talks to the
	// device over REST. A second, DB-backed stack (/policy/addresses, /policy/services,
	// /policy/firewall-policies, backed by the AddressObject / ServiceObject / FirewallPolicy
	// tables) used to sit above these. Nothing called it — every page in the app uses the
	// Device* endpoints — so it was a copy of the domain model that could silently disagree
	// with the firewall, and it has been removed.
	// Firewall policies from device
	protected.GET("/policy/device/:deviceId/firewall-policies", po.DeviceListPolicies)
	protected.POST("/policy/device/:deviceId/firewall-policies", po.DeviceCreatePolicy)
	// "What would this change actually have done" — replayed against real recent traffic,
	// nothing written. Registered BEFORE the ":policyId" routes below for the same reason the
	// bulk routes are: gin would otherwise bind the literal "impact-preview" as :policyId.
	protected.POST("/policy/device/:deviceId/firewall-policies/impact-preview", po.DeviceImpactPreview)
	// Acting on a SELECTION rather than on one rule. Registered BEFORE the ":policyId" routes
	// below for the same reason /users/device-access/summary comes before /users/:id — gin
	// would otherwise bind the literal "bulk" as the :policyId parameter.
	//
	// Both answer 207 when any single policy failed, and neither rolls back: see
	// services/fortigate_policybulk.go for why a partial result is the honest outcome of a
	// sequence of independent writes to a live firewall.
	protected.PATCH("/policy/device/:deviceId/firewall-policies/bulk/status", po.DeviceBulkPolicyStatus)
	protected.POST("/policy/device/:deviceId/firewall-policies/bulk/delete", po.DeviceBulkDeletePolicies)
	protected.PATCH("/policy/device/:deviceId/firewall-policies/:policyId", po.DeviceUpdatePolicy)
	// Clone lands DISABLED, directly below the original — a copy that arrived enabled would
	// start deciding traffic before anyone edited the field it was cloned to change.
	protected.POST("/policy/device/:deviceId/firewall-policies/:policyId/clone", po.DeviceClonePolicy)
	protected.PATCH("/policy/device/:deviceId/firewall-policies/:policyId/toggle", po.DeviceTogglePolicy)
	protected.PUT("/policy/device/:deviceId/firewall-policies/:policyId/move", po.DeviceMovePolicy)
	protected.DELETE("/policy/device/:deviceId/firewall-policies/:policyId", po.DeviceDeletePolicy)

	// Addresses from device
	protected.GET("/policy/device/:deviceId/addresses", po.DeviceListAddresses)
	protected.POST("/policy/device/:deviceId/addresses", po.DeviceCreateAddress)
	protected.PATCH("/policy/device/:deviceId/addresses/:name", po.DeviceUpdateAddress)
	protected.DELETE("/policy/device/:deviceId/addresses/:name", po.DeviceDeleteAddress)

	// Virtual IPs (firewall/vip) from device
	protected.GET("/policy/device/:deviceId/virtual-ips", po.DeviceListVirtualIPs)
	protected.POST("/policy/device/:deviceId/virtual-ips", po.DeviceCreateVirtualIP)
	protected.GET("/policy/device/:deviceId/virtual-ips/:name", po.DeviceGetVirtualIP)
	protected.PATCH("/policy/device/:deviceId/virtual-ips/:name", po.DeviceUpdateVirtualIP)
	protected.DELETE("/policy/device/:deviceId/virtual-ips/:name", po.DeviceDeleteVirtualIP)

	// Services from device
	protected.GET("/policy/device/:deviceId/services", po.DeviceListServices)
	protected.POST("/policy/device/:deviceId/services", po.DeviceCreateService)
	protected.PATCH("/policy/device/:deviceId/services/:name", po.DeviceUpdateService)
	protected.DELETE("/policy/device/:deviceId/services/:name", po.DeviceDeleteService)

	// ── Grouping objects: address groups + service groups ─────────────────
	//
	// The console could already REFERENCE both (a policy form lists them) and could not make
	// one, which is the difference between showing groups and having them: without a group,
	// a rule set grows one policy per address forever. See services/fortigate_group.go for
	// the member-shape and enable/disable-string traps these absorb.
	protected.GET("/policy/device/:deviceId/address-groups", po.DeviceListAddressGroups)
	protected.POST("/policy/device/:deviceId/address-groups", po.DeviceCreateAddressGroup)
	protected.GET("/policy/device/:deviceId/address-groups/:name", po.DeviceGetAddressGroup)
	protected.PATCH("/policy/device/:deviceId/address-groups/:name", po.DeviceUpdateAddressGroup)
	protected.DELETE("/policy/device/:deviceId/address-groups/:name", po.DeviceDeleteAddressGroup)

	protected.GET("/policy/device/:deviceId/service-groups", po.DeviceListServiceGroups)
	protected.POST("/policy/device/:deviceId/service-groups", po.DeviceCreateServiceGroup)
	protected.GET("/policy/device/:deviceId/service-groups/:name", po.DeviceGetServiceGroup)
	protected.PATCH("/policy/device/:deviceId/service-groups/:name", po.DeviceUpdateServiceGroup)
	protected.DELETE("/policy/device/:deviceId/service-groups/:name", po.DeviceDeleteServiceGroup)

	// ── IP Pools (firewall/ippool) ────────────────────────────────────────
	// The source addresses a policy's NAT translates to. Same hole as the groups above: the
	// policy form could pick one, nothing here could create one.
	protected.GET("/policy/device/:deviceId/ip-pools", po.DeviceListIPPools)
	protected.POST("/policy/device/:deviceId/ip-pools", po.DeviceCreateIPPool)
	protected.GET("/policy/device/:deviceId/ip-pools/:name", po.DeviceGetIPPool)
	protected.PATCH("/policy/device/:deviceId/ip-pools/:name", po.DeviceUpdateIPPool)
	protected.DELETE("/policy/device/:deviceId/ip-pools/:name", po.DeviceDeleteIPPool)

	// ── Zones (system/zone) ───────────────────────────────────────────────
	// The one writable part of Network ▸ Interfaces. A zone is a grouping the operator
	// invents, not a property of the hardware, so writing one changes no port's config —
	// which is why it is here and interface CRUD still is not.
	protected.GET("/policy/device/:deviceId/zones", po.DeviceListZones)
	protected.POST("/policy/device/:deviceId/zones", po.DeviceCreateZone)
	protected.GET("/policy/device/:deviceId/zones/:name", po.DeviceGetZone)
	protected.PATCH("/policy/device/:deviceId/zones/:name", po.DeviceUpdateZone)
	protected.DELETE("/policy/device/:deviceId/zones/:name", po.DeviceDeleteZone)

	// ── Policy & Objects ▸ Traffic Shaping ────────────────────────────────
	//
	// Two objects that only work together: a shaper is a limit, a shaping policy is which
	// traffic gets it. Either is valid alone, and a shaper with no policy shapes nothing —
	// which is why the shaper list carries the count of policies using it.
	protected.GET("/policy/device/:deviceId/traffic-shapers", po.DeviceListTrafficShapers)
	protected.POST("/policy/device/:deviceId/traffic-shapers", po.DeviceCreateTrafficShaper)
	protected.GET("/policy/device/:deviceId/traffic-shapers/:name", po.DeviceGetTrafficShaper)
	protected.PATCH("/policy/device/:deviceId/traffic-shapers/:name", po.DeviceUpdateTrafficShaper)
	protected.DELETE("/policy/device/:deviceId/traffic-shapers/:name", po.DeviceDeleteTrafficShaper)

	protected.GET("/policy/device/:deviceId/shaping-policies", po.DeviceListShapingPolicies)
	protected.POST("/policy/device/:deviceId/shaping-policies", po.DeviceCreateShapingPolicy)
	protected.PATCH("/policy/device/:deviceId/shaping-policies/:id", po.DeviceUpdateShapingPolicy)
	protected.DELETE("/policy/device/:deviceId/shaping-policies/:id", po.DeviceDeleteShapingPolicy)

	// ── "What uses this object?" ──────────────────────────────────────────
	// Read-only, open to anyone who can see the device. Behind every Used-by panel and every
	// delete confirmation in Policy & Objects: FortiOS answers a delete with `-15` and names
	// nothing, so the console scans the referring tables itself and reports how complete the
	// scan was (services/fortigate_usage.go).
	protected.GET("/policy/device/:deviceId/usage/:kind/:name", po.DeviceObjectUsage)

	// Device system info (hostname)
	protected.GET("/policy/device/:deviceId/info", po.DeviceGetInfo)

	// ── Security Profiles: Web Rating Overrides (webfilter/ftgd-local-rating) ──
	protected.GET("/policy/device/:deviceId/web-rating-metadata", po.DeviceGetWebRatingMetadata)
	protected.POST("/policy/device/:deviceId/web-rating-lookup", po.DeviceLookupWebRating)
	protected.GET("/policy/device/:deviceId/web-rating-overrides", po.DeviceListWebRatingOverrides)
	protected.POST("/policy/device/:deviceId/web-rating-overrides", po.DeviceCreateWebRatingOverride)
	protected.GET("/policy/device/:deviceId/web-rating-overrides/:url", po.DeviceGetWebRatingOverride)
	protected.PUT("/policy/device/:deviceId/web-rating-overrides/:url", po.DeviceUpdateWebRatingOverride)
	protected.DELETE("/policy/device/:deviceId/web-rating-overrides/:url", po.DeviceDeleteWebRatingOverride)

	// ── Policy & Objects: Schedules (recurring / onetime / group) ─────────
	protected.GET("/policy/device/:deviceId/schedules", po.DeviceListSchedules)
	protected.POST("/policy/device/:deviceId/schedules", po.DeviceCreateSchedule)
	protected.GET("/policy/device/:deviceId/schedules/:type/:name", po.DeviceGetSchedule)
	protected.PUT("/policy/device/:deviceId/schedules/:type/:name", po.DeviceUpdateSchedule)
	protected.DELETE("/policy/device/:deviceId/schedules/:type/:name", po.DeviceDeleteSchedule)

	// User & Authentication — User Definition + User Groups (full CRUD)
	protected.GET("/policy/device/:deviceId/users", po.DeviceListUsers)
	protected.POST("/policy/device/:deviceId/users", po.DeviceCreateUser)
	protected.GET("/policy/device/:deviceId/users/:name", po.DeviceGetUser)
	protected.PUT("/policy/device/:deviceId/users/:name", po.DeviceUpdateUser)
	protected.DELETE("/policy/device/:deviceId/users/:name", po.DeviceDeleteUser)
	protected.GET("/policy/device/:deviceId/user-options", po.DeviceGetLocalUserOptions)
	protected.GET("/policy/device/:deviceId/user-group-options", po.DeviceGetUserGroupOptions)
	protected.GET("/policy/device/:deviceId/user-groups", po.DeviceListUserGroups)
	protected.POST("/policy/device/:deviceId/user-groups", po.DeviceCreateUserGroup)
	protected.GET("/policy/device/:deviceId/user-groups/:name", po.DeviceGetUserGroup)
	protected.PUT("/policy/device/:deviceId/user-groups/:name", po.DeviceUpdateUserGroup)
	protected.DELETE("/policy/device/:deviceId/user-groups/:name", po.DeviceDeleteUserGroup)

	// User & Authentication — LDAP Servers (user/ldap) + the Exchange external connector
	// the LDAP form's "Exchange server" picker creates inline.
	protected.GET("/policy/device/:deviceId/ldap-servers", po.DeviceListLDAPServers)
	protected.POST("/policy/device/:deviceId/ldap-servers", po.DeviceCreateLDAPServer)
	protected.GET("/policy/device/:deviceId/ldap-server-options", po.DeviceGetLDAPServerOptions)
	protected.GET("/policy/device/:deviceId/ldap-servers/:name", po.DeviceGetLDAPServer)
	protected.PUT("/policy/device/:deviceId/ldap-servers/:name", po.DeviceUpdateLDAPServer)
	protected.DELETE("/policy/device/:deviceId/ldap-servers/:name", po.DeviceDeleteLDAPServer)
	protected.GET("/policy/device/:deviceId/exchange-connectors", po.DeviceListExchangeConnectors)
	protected.POST("/policy/device/:deviceId/exchange-connectors", po.DeviceCreateExchangeConnector)
	protected.DELETE("/policy/device/:deviceId/exchange-connectors/:name", po.DeviceDeleteExchangeConnector)

	// User & Authentication — RADIUS Servers (user/radius). The /test route is the GUI's
	// "Test Connectivity" / "Test User Credentials" buttons (monitor API, not CMDB).
	protected.GET("/policy/device/:deviceId/radius-servers", po.DeviceListRADIUSServers)
	protected.POST("/policy/device/:deviceId/radius-servers", po.DeviceCreateRADIUSServer)
	protected.GET("/policy/device/:deviceId/radius-servers/:name", po.DeviceGetRADIUSServer)
	protected.PUT("/policy/device/:deviceId/radius-servers/:name", po.DeviceUpdateRADIUSServer)
	protected.DELETE("/policy/device/:deviceId/radius-servers/:name", po.DeviceDeleteRADIUSServer)
	protected.POST("/policy/device/:deviceId/radius-servers/:name/test", po.DeviceTestRADIUSServer)

	// ── Fleet Apply: push one object to several devices at once ───────────
	// Reading (preview) is open to any signed-in user, matching the rest of this proxy; the
	// actual create/update is enforced per device by the SAME requireAdminPO the normal
	// single-device routes use, because FleetApply replays through them rather than writing to
	// the device directly — see controller/policyobject/fleet_apply.go.
	protected.POST("/fleet/preview", po.FleetPreview)
	protected.POST("/fleet/apply", po.FleetApply)

	// Security Profiles (AntiVirus, Web Filter, DNS Filter, Application Control, File Filter, SSL/SSH Inspection)
	protected.GET("/policy/device/:deviceId/security-profiles/:category", po.DeviceListSecurityProfiles)
	protected.GET("/policy/device/:deviceId/security-profiles/:category/:name", po.DeviceGetSecurityProfile)
	protected.POST("/policy/device/:deviceId/security-profiles/:category", po.DeviceCreateSecurityProfile)
	protected.PATCH("/policy/device/:deviceId/security-profiles/:category/:name", po.DeviceUpdateSecurityProfile)
	protected.DELETE("/policy/device/:deviceId/security-profiles/:category/:name", po.DeviceDeleteSecurityProfile)
}
