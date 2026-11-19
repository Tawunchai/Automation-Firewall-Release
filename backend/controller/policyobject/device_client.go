// Code generated from the method set of *services.FortiClient. DO NOT EDIT BY HAND.
//
// Regenerate when FortiClient gains or loses an exported method; device_client_test.go fails
// if this interface and that type ever disagree, so the drift cannot go unnoticed.

package policyobject

import (
	"context"
	"encoding/json"
	"time"

	"network_automation/entity"
	"network_automation/services"
)

// deviceClient is everything the handlers in this package can ask a firewall to do.
//
// ── Why this exists ──────────────────────────────────────────────────────────
//
// buildClient used to hand back *services.FortiClient, the real thing with a real socket in it.
// That one concrete return type is what kept this package — the ~137 device-proxy routes that ARE
// the product — at 12.9% test coverage with ten handler files sitting at exactly 0.0%: a handler
// test had no way to answer for the firewall, so there was no way to write one at all.
//
// With the seam here, a test substitutes its own answers (see newStubClient in
// device_client_stub_test.go) and the handler under test runs its real decisions — the access
// check, the VDOM, the error mapping in respondDeviceError — against them. No device, no network.
//
// ── Why the WHOLE method set, and not the handful a caller needs ─────────────
//
// Go convention says define the narrow interface at the consumer. Here the consumer is 70 files
// calling 253 of these 277 methods, so "narrow" would mean either one interface per file (70 of
// them, each drifting on its own) or one hand-kept list that is 253 lines of the same thing with a
// gap in it. Generating the full set instead means a new FortiClient method is usable from a
// handler the moment it exists, and the test below is what keeps this file honest.
//
// A stub does not implement 277 methods: it embeds deviceClient, so it inherits them all and
// overrides only the ones its test needs. An unexpected call lands on the nil embedded interface
// and panics, which is the right outcome — it names the method the handler reached for that the
// test never said anything about.
type deviceClient interface {
	AddressExists(name string) bool
	AddressGroupExists(name string) bool
	BulkDeletePolicies(ids []int) []services.BulkResult
	BulkPolicyStatus(ids []int, enable bool) []services.BulkResult
	ClonePolicy(policyID int, newName string) (*services.FGPolicy, error)
	ConfigFingerprint() (fingerprint string, failed []string)
	ConfigureHubSpokeBGP(w services.FGHubSpokeWrite, prevSubnets ...string) error
	ControlTunnel(action services.TunnelAction, p1name, p2name string) error
	CreateAVProfile(form services.AVProfileForm) error
	CreateAddress(a services.FGAddress) error
	CreateAddressGroup(g services.FGAddressGroup) error
	CreateAddressGroupWithMembers(name string, members []string, comment string) error
	CreateAdminUser(w services.FGAdminWrite) error
	CreateAppControlProfile(form services.AppControlProfileForm) error
	CreateDHCPServer(s services.FGDHCPServer) (int, error)
	CreateDNSFilterProfile(form services.DNSFilterProfileForm) error
	CreateExchangeConnector(form services.FGExchangeConnectorForm) error
	CreateFileFilterProfile(form services.FileFilterProfileForm) error
	CreateHubSpokeTunnel(w services.FGHubSpokeWrite) error
	CreateIPPool(p services.FGIPPool) error
	CreateIPSSensor(form services.IPSSensorForm) error
	CreateIPsecTunnel(w services.FGIPsecTunnelWrite) error
	CreateLDAPServer(form services.FGLDAPServerForm) error
	CreateLocalUser(form services.FGLocalUserForm) error
	CreatePolicy(p services.FGPolicy) (*services.FGPolicy, error)
	CreateRADIUSServer(form services.FGRADIUSServerForm) error
	CreateSDWANHealthCheck(h services.SDWANHealthCheck) error
	CreateSDWANMember(m services.SDWANMember) error
	CreateSDWANRule(r services.SDWANRuleFull) error
	CreateSDWANZone(z services.SDWANZone) error
	CreateSNMPCommunity(c services.FGSNMPCommunity) (int, error)
	CreateSNMPUser(w services.FGSNMPUserWrite) error
	CreateSSLSSHProfile(form services.SSLSSHProfileForm) error
	CreateSchedule(s services.FGScheduleFull) error
	CreateService(s services.FGService) error
	CreateServiceGroup(g services.FGServiceGroup) error
	CreateShapingPolicy(p services.FGShapingPolicy) error
	CreateStaticRoute(w services.FGStaticRouteWrite) (int, error)
	CreateTrafficShaper(s services.FGTrafficShaper) error
	CreateUserGroup(form services.FGUserGroupForm) error
	CreateVirtualIP(v services.FGVirtualIP) error
	CreateWebFilterProfile(form services.WebFilterProfileForm) error
	CreateWebRatingOverride(o services.WebRatingOverride) error
	CreateZone(z services.FGZone) error
	DeleteAddress(name string) error
	DeleteAddressGroup(name string) error
	DeleteAdminUser(name string) error
	DeleteDHCPServer(id int) error
	DeleteExchangeConnector(name string) error
	DeleteHubSpokeBGP(name string, localSubnets []string, overlayCIDR string) []string
	DeleteIPPool(name string) error
	DeleteIPsecTunnel(name string) error
	DeleteLDAPServer(name string) error
	DeleteLocalUser(name string) error
	DeletePolicy(policyID int) error
	DeleteRADIUSServer(name string) error
	DeleteSDWANHealthCheck(name string) error
	DeleteSDWANMember(seqNum int) error
	DeleteSDWANRule(id int) error
	DeleteSDWANZone(name string) error
	DeleteSNMPCommunity(id int) error
	DeleteSNMPUser(name string) error
	DeleteSchedule(fgType, name string) error
	DeleteSecurityProfile(category, name string) error
	DeleteService(name string) error
	DeleteServiceGroup(name string) error
	DeleteShapingPolicy(id int) error
	DeleteStaticRoute(seq int) error
	DeleteTrafficShaper(name string) error
	DeleteUserGroup(name string) error
	DeleteVirtualIP(name string) error
	DeleteWebRatingOverride(rawURL string) error
	DeleteZone(name string) error
	DeviceLocalTime() time.Time
	DisableL2TPServer() error
	Do(method, path string) ([]byte, error)
	EnableL2TPServer(sip, eip, usrgrp string) error
	EnableReauth(username, password string)
	ExecuteFixStep(st services.FGFixStep, newPolicyID int, policies []services.FGPolicy) (services.FixOutcome, error)
	ExecuteRevert(action, cmdbPath, mkey string, before json.RawMessage) error
	FindUsage(kind, name string) (*services.UsageReport, error)
	GetAVProfile(name string) (services.AVProfileForm, error)
	GetAVProfileCapabilities() services.AVCapabilities
	GetAVProfiles() ([]services.FGName, error)
	GetAccProfiles() ([]services.FGAccProfile, error)
	GetAddressGroup(name string) (*services.FGAddressGroup, error)
	GetAddressGroups() ([]services.FGName, error)
	GetAddressGroupsFull() ([]services.FGAddressGroup, error)
	GetAddresses() ([]services.FGAddress, error)
	GetAdminUsers() ([]services.FGAdminUser, error)
	GetAppControlLists() ([]services.FGName, error)
	GetAppControlMetadata() services.AppControlMetadata
	GetAppControlProfile(name string) (services.AppControlProfileForm, error)
	GetAvailableInterfaces() ([]services.FGInterface, error)
	GetBGPSummary() services.BGPSummary
	GetCMDBObject(collection, key string) (json.RawMessage, error)
	GetCMDBSchema(path string) (services.FGSchema, error)
	GetCurrentAdmins() ([]services.FGAdminSession, error)
	GetDHCPServer(id int) (*services.FGDHCPServer, error)
	GetDHCPServers() ([]services.FGDHCPServer, error)
	GetDNSDomainFilterTableIDs() []int
	GetDNSFilterMetadata() services.DNSFilterMetadata
	GetDNSFilterProfile(name string) (services.DNSFilterProfileForm, error)
	GetDNSFilterProfiles() ([]services.FGName, error)
	GetDecryptedTrafficMirrors() ([]services.FGName, error)
	GetExchangeConnectors() ([]services.FGExchangeConnector, error)
	GetFabricStatus(serial string) (services.FGFabricStatus, error)
	GetFileFilterMetadata() services.FileFilterMetadata
	GetFileFilterProfile(name string) (services.FileFilterProfileForm, error)
	GetFileFilterProfiles() ([]services.FGName, error)
	GetGUIFeatureFlags() (map[string]bool, error)
	GetHAStatus() (*services.FGHAStatus, error)
	GetHostname() (string, error)
	GetIPPool(name string) (*services.FGIPPool, error)
	GetIPPools() ([]services.FGName, error)
	GetIPPoolsFull() ([]services.FGIPPool, error)
	GetIPSMetadata() services.IPSMetadata
	GetIPSSensor(name string) (services.IPSSensorForm, error)
	GetIPSSensors() ([]services.FGName, error)
	GetIPsecTunnel(name string) (*services.FGIPsecTunnel, error)
	GetIPsecTunnelFull(name string) (*services.FGIPsecTunnelEdit, error)
	GetIPsecTunnels() ([]services.FGIPsecTunnel, error)
	GetInterfaces() ([]services.FGInterface, error)
	GetInternetServices() ([]services.FGInternetService, error)
	GetL2TPServer() (services.FGL2TPServer, error)
	GetLDAPServer(name string) (*services.FGLDAPServerForm, error)
	GetLDAPServerOptions() services.FGLDAPServerOptions
	GetLDAPServers() ([]services.FGLDAPServer, error)
	GetLicenseOverview() (services.FGLicenseOverview, error)
	GetLocalUser(name string) (*services.FGLocalUserForm, error)
	GetLocalUserOptions() services.FGLocalUserOptions
	GetLocalUsers() ([]services.FGUserDefinition, error)
	GetLogGates(source string) services.FGLogGates
	GetLogPolicyRefs() map[int]services.LogPolicyRef
	GetLogSettings() (*services.FGLogSettings, error)
	GetLogSources() ([]services.FGLogSource, error)
	GetNetworkSettings() services.FGNetworkSettings
	GetPerformance() (services.FGPerformance, error)
	GetPolicies() ([]services.FGPolicy, error)
	GetPolicy(policyID int) (*services.FGPolicy, error)
	GetPolicyStats() map[int]services.FGPolicyStats
	GetPolicyUsage(staleDays int) (services.FGPolicyUsageReport, error)
	GetProtocolOptions() ([]services.FGName, error)
	GetRADIUSServer(name string) (*services.FGRADIUSServerForm, error)
	GetRADIUSServers() ([]services.FGRADIUSServer, error)
	GetResourceUsage(interval string) (services.FGResourceUsage, error)
	GetRouteInterfaces() ([]services.FGInterface, error)
	GetSDNConnectors() ([]services.FGSDNConnector, error)
	GetSDWAN() (services.SDWANOverview, error)
	GetSDWANHealthCheck(name string) (services.SDWANHealthCheck, error)
	GetSDWANHealthChecks() ([]services.SDWANHealthCheck, error)
	GetSDWANRule(id int) (services.SDWANRuleFull, error)
	GetSDWANRuleList() (services.SDWANRuleList, error)
	GetSNMPCommunities() ([]services.FGSNMPCommunity, error)
	GetSNMPCommunity(id int) (*services.FGSNMPCommunity, error)
	GetSNMPSysInfo() (*services.FGSNMPSysInfo, error)
	GetSNMPUser(name string) (*services.FGSNMPUser, error)
	GetSNMPUsers() ([]services.FGSNMPUser, error)
	GetSSLSSHMetadata() services.SSLSSHMetadata
	GetSSLSSHProfile(name string) (services.SSLSSHProfileForm, error)
	GetSSLSSHProfiles() ([]services.FGName, error)
	GetSchedule(fgType, name string) (*services.FGScheduleFull, error)
	GetSchedules() ([]services.FGSchedule, error)
	GetSchedulesAll() ([]services.FGScheduleFull, error)
	GetSecurityProfiles(category string) ([]services.FGSecurityProfile, error)
	GetServiceGroup(name string) (*services.FGServiceGroup, error)
	GetServiceGroups() ([]services.FGName, error)
	GetServiceGroupsFull() ([]services.FGServiceGroup, error)
	GetServices() ([]services.FGService, error)
	GetSessionCounters() (services.FGSessionCounters, error)
	GetSessionSummary() (services.FGSessionSummary, error)
	GetShapingPolicies() ([]services.FGShapingPolicy, error)
	GetStaticRoute(seq int) (*services.FGStaticRoute, error)
	GetStaticRoutes() ([]services.FGStaticRoute, error)
	GetSystemInformation() (services.FGSystemInformation, error)
	GetSystemInterfaces() ([]services.FGSystemInterface, error)
	GetSystemStatus() (services.FGSystemStatus, error)
	GetTopologyLive() services.TopologyLive
	GetTrafficLog(q services.TrafficLogQuery, policies map[int]services.LogPolicyRef) (services.FGTrafficLogPage, error)
	GetTrafficShaper(name string) (*services.FGTrafficShaper, error)
	GetTrafficShapers() ([]services.FGTrafficShaper, error)
	GetUserGroup(name string) (*services.FGUserGroupForm, error)
	GetUserGroupOptions() services.FGUserGroupOptions
	GetUserGroups() ([]services.FGUserGroup, error)
	GetVDOMs() ([]services.FGVDOM, error)
	GetVPNTunnelHealth() (services.FGVPNHealthReport, error)
	GetVPNWizardMetadata() services.FGVPNWizardMetadata
	GetVirtualIP(name string) (*services.FGVirtualIP, error)
	GetVirtualIPs() ([]services.FGVirtualIP, error)
	GetWebFilterMetadata(selfProfile string) services.WebFilterMetadata
	GetWebFilterProfile(name string) (services.WebFilterProfileForm, error)
	GetWebFilterProfiles() ([]services.FGName, error)
	GetWebRatingMetadata() services.WebRatingMetadata
	GetWebRatingOverride(rawURL string) (services.WebRatingOverride, error)
	GetWebRatingOverrides() ([]services.WebRatingOverride, error)
	GetWebfilterTableIDs(kind string) []int
	GetZone(name string) (*services.FGZone, error)
	GetZones() ([]services.FGZone, error)
	HubSpokeConflicts(w services.FGHubSpokeWrite) []string
	InterfaceLinks() ([]services.FGInterfaceLink, error)
	IsHubSpokeTunnel(name string) bool
	IsL2TPTunnel(name string) bool
	L2TPServerOwner(excludeTunnel string) string
	ListConfigChangeEvents() (services.ConfigEventPage, error)
	Login(username, password string) error
	Logout()
	LookupWebRating(rawURL string) (services.WebRatingLookup, error)
	MovePolicy(policyID int, position string, refID int) error
	PlanTraceFix(q services.FGTraceQuery, fixID string) (services.FGFixPlan, []services.FGPolicy, error)
	PolicyOrder() ([]int, error)
	PreviewPolicyChangeImpact(change services.ImpactPreviewChange) (services.ImpactPreviewResult, error)
	PreviewTraceFix(q services.FGTraceQuery, fixID string) (services.FGFixPreview, error)
	PreviewTunnelDeletion(name string) services.TunnelDeletionPreview
	ReadHubSpoke(name string) (*services.FGHubSpokeReadback, bool)
	RenameAddress(oldName, newName string) error
	RepointPolicyAddress(from, to string) error
	RestoreCMDBTable(cmdbPath string, before json.RawMessage) error
	RestoreConfigFile(text string) (services.ConfigRestoreResult, error)
	RevertPolicyMove(r entity.ChangeRecord) error
	RouterLookup(destination string) (services.FGRouteLookup, error)
	RunAudit() (services.AuditReport, error)
	SDWANHealthCheckServers() (map[string][]string, error)
	SSLProxyInspectionEnabled() bool
	SetAddressGroupMembers(name string, members []string, comment string) error
	SetTunnelInterfaceIP(w services.FGHubSpokeWrite) error
	SnapshotCMDBObject(cmdbPath, mkey string) (json.RawMessage, error)
	SnapshotCMDBTable(cmdbPath string) (json.RawMessage, error)
	TestRADIUSServer(name, ordinal, user, password string) (*services.FGRADIUSTestResult, error)
	TogglePolicyStatus(policyID int, enable bool) error
	TracePolicyPath(q services.FGTraceQuery) (services.FGTraceResult, error)
	TunnelOverlayCIDR(name string) string
	UpdateAVProfile(name string, form services.AVProfileForm) error
	UpdateAddress(name string, a services.FGAddress) error
	UpdateAddressGroup(name string, g services.FGAddressGroup) error
	UpdateAdminUser(name string, w services.FGAdminWrite) error
	UpdateAppControlProfile(name string, form services.AppControlProfileForm) error
	UpdateCMDBAttrs(cmdbPath, mkey string, attrs map[string]any) error
	UpdateDHCPServer(id int, s services.FGDHCPServer) error
	UpdateDNSFilterProfile(name string, form services.DNSFilterProfileForm) error
	UpdateFileFilterProfile(name string, form services.FileFilterProfileForm) error
	UpdateHubSpokeTunnel(w services.FGHubSpokeWrite) error
	UpdateIPPool(name string, p services.FGIPPool) error
	UpdateIPSSensor(name string, form services.IPSSensorForm) error
	UpdateIPsecTunnel(w services.FGIPsecTunnelWrite) error
	UpdateLDAPServer(name string, form services.FGLDAPServerForm) error
	UpdateLocalUser(name string, form services.FGLocalUserForm) error
	UpdateLogDisk(d services.FGLogDisk) error
	UpdateLogEvents(e services.FGLogEvents) error
	UpdateLogFortiAnalyzer(a services.FGLogFortiAnalyzer) error
	UpdateLogMemory(m services.FGLogMemory) error
	UpdateLogSyslog(s services.FGLogSyslog) error
	UpdatePolicy(policyID int, p services.FGPolicy) error
	UpdateRADIUSServer(name string, form services.FGRADIUSServerForm) error
	UpdateSDWANHealthCheck(name string, h services.SDWANHealthCheck) error
	UpdateSDWANMember(seqNum int, m services.SDWANMember) error
	UpdateSDWANRule(id int, r services.SDWANRuleFull) error
	UpdateSDWANZone(name string, z services.SDWANZone) error
	UpdateSNMPCommunity(id int, c services.FGSNMPCommunity) error
	UpdateSNMPSysInfo(s services.FGSNMPSysInfo) error
	UpdateSNMPUser(name string, w services.FGSNMPUserWrite) error
	UpdateSSLSSHProfile(name string, form services.SSLSSHProfileForm) error
	UpdateSchedule(fgType, name string, s services.FGScheduleFull) error
	UpdateService(name string, s services.FGService) error
	UpdateServiceGroup(name string, g services.FGServiceGroup) error
	UpdateShapingPolicy(id int, p services.FGShapingPolicy) error
	UpdateStaticRoute(seq int, w services.FGStaticRouteWrite) error
	UpdateTrafficShaper(name string, s services.FGTrafficShaper) error
	UpdateUserGroup(name string, form services.FGUserGroupForm) error
	UpdateVirtualIP(name string, v services.FGVirtualIP) error
	UpdateWebFilterProfile(name string, form services.WebFilterProfileForm) error
	UpdateWebRatingOverride(originalURL string, o services.WebRatingOverride) error
	UpdateZone(name string, z services.FGZone) error
	VDOM() string
	WithContext(ctx context.Context) *services.FortiClient
	WithVDOM(vdom string) *services.FortiClient
}

// Compile-time proof that the real client still satisfies the seam.
var _ deviceClient = (*services.FortiClient)(nil)
