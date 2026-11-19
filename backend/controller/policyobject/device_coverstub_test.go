package policyobject

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// Shared scaffolding for the *_cover_test.go handler tests.
//
// device_client_stub_test.go already proves the seam and carries a stub for the policy, address
// and service handlers. This file is the same idea widened to the rest of the device-proxy
// surface: one stub that answers for a firewall across ~25 domains, so a per-domain test file is
// the ASSERTIONS and nothing else.
//
// Three things it deliberately does NOT do:
//
//   - It does not implement deviceClient. It EMBEDS it, like stubClient next door, so a handler
//     that reaches for a method no test said anything about panics with that method's name rather
//     than reading a zero value and letting the assertion pass for the wrong reason.
//   - It does not invent a second seam. withDeviceClient (device_client_stub_test.go) is still how
//     a stub is installed, and handlerTestDevice / deviceRequest / deviceJSONRequest / grantDevice
//     (device_handler_db_test.go) are still how a request is aimed at a device.
//   - It does not answer differently per method. One readErr and one writeErr, because a test
//     exercises one handler: a knob per method would be fifty knobs nobody sets.

type coverStub struct {
	deviceClient

	// calls records every call a handler made, in order, as "<Method> <arg>…". A status code
	// cannot see WHICH method a handler chose, and several handlers here choose between siblings
	// (the interface list prefers the monitor endpoint and falls back to the CMDB one; log
	// settings writes one section per sub-table). Recording the name is what turns "it answered
	// 200" into "it wrote THAT object".
	calls []string

	// readErr is what every stubbed READ answers with, writeErr what every stubbed WRITE answers
	// with — so a refusal case is one line in a table.
	readErr  error
	writeErr error

	// ── what the device holds (reads) ───────────────────────────────────────
	addrGroups []services.FGAddressGroup
	svcGroups  []services.FGServiceGroup
	zones      []services.FGZone
	pools      []services.FGIPPool
	vips       []services.FGVirtualIP
	schedules  []services.FGScheduleFull
	routes     []services.FGStaticRoute
	shapers    []services.FGTrafficShaper
	shapePols  []services.FGShapingPolicy
	ratings    []services.WebRatingOverride
	ratingMeta services.WebRatingMetadata
	ratingHit  services.WebRatingLookup
	intServs   []services.FGInternetService
	routeIntfs []services.FGInterface
	sysIntfs   []services.FGSystemInterface
	vdoms      []services.FGVDOM
	usage      *services.UsageReport
	netSet     services.FGNetworkSettings
	policyUse  services.FGPolicyUsageReport
	logSet     *services.FGLogSettings
	haStatus   *services.FGHAStatus
	snmpSys    *services.FGSNMPSysInfo
	snmpComms  []services.FGSNMPCommunity
	snmpUsers  []services.FGSNMPUser

	// Interface pickers: ifaces answers the CMDB list, availIfaces the monitor endpoint the
	// policy form prefers. availErr is what makes the fallback between them testable.
	ifaces    []services.FGInterface
	availIfs  []services.FGInterface
	availErr  error
	sdnConns  []services.FGSDNConnector
	hostname  string
	hostErr   error
	status    services.FGSystemStatus
	statusErr error
	guiFlags  map[string]bool

	// Dashboard: every section bar the identity read degrades on its own, so each gets its own
	// error knob — that independence IS the behaviour under test.
	sysInfo     services.FGSystemInformation
	sysInfoErr  error
	perf        services.FGPerformance
	perfErr     error
	resUsage    services.FGResourceUsage
	resUsageErr error
	sessions    services.FGSessionSummary
	sessionsErr error
	licenses    services.FGLicenseOverview
	licensesErr error
	admins      []services.FGAdminSession
	adminsErr   error
	fabric      services.FGFabricStatus
	fabricErr   error

	// Auth servers (device_authserver.go).
	ldapServers []services.FGLDAPServer
	ldapForm    *services.FGLDAPServerForm
	ldapOpts    services.FGLDAPServerOptions
	radServers  []services.FGRADIUSServer
	radForm     *services.FGRADIUSServerForm
	radTest     *services.FGRADIUSTestResult
	exchConns   []services.FGExchangeConnector

	// Policy clone / bulk (device_policybulk.go).
	cloned    *services.FGPolicy
	cloneErr  error
	bulkOut   []services.BulkResult
	addresses []services.FGAddress

	// The address-object set a tunnel's subnets become (device_vpn_subnets.go). `exists` names
	// every address that is already on the device; `groupExists` the same for address groups.
	exists      map[string]bool
	groupExists map[string]bool

	// ── what the handler sent (writes) ──────────────────────────────────────
	//
	// Captured by type rather than as a map, so an assertion names a real field and the compiler
	// catches a trap that was renamed in the service layer.
	gotAddrGroup  services.FGAddressGroup
	gotSvcGroup   services.FGServiceGroup
	gotZone       services.FGZone
	gotPool       services.FGIPPool
	gotVIP        services.FGVirtualIP
	gotSchedule   services.FGScheduleFull
	gotRoute      services.FGStaticRouteWrite
	gotShaper     services.FGTrafficShaper
	gotShapePol   services.FGShapingPolicy
	gotRating     services.WebRatingOverride
	gotSNMPSys    services.FGSNMPSysInfo
	gotSNMPComm   services.FGSNMPCommunity
	gotSNMPUser   services.FGSNMPUserWrite
	gotLDAP       services.FGLDAPServerForm
	gotRADIUS     services.FGRADIUSServerForm
	gotExch       services.FGExchangeConnectorForm
	gotLogEvents  services.FGLogEvents
	gotLogDisk    services.FGLogDisk
	gotLogSyslog  services.FGLogSyslog
	gotLogFAZ     services.FGLogFortiAnalyzer
	gotLogMemory  services.FGLogMemory
	gotAddress    services.FGAddress
	gotMembers    []string
	gotGroupName  string
	gotRouteSeq   int
	newCommunityI int
}

// note records a write and answers with whatever the test told the device to say.
func (s *coverStub) note(parts ...string) error {
	kept := make([]string, 0, len(parts))
	for _, p := range parts {
		if p != "" {
			kept = append(kept, p)
		}
	}
	s.calls = append(s.calls, strings.Join(kept, " "))
	return s.writeErr
}

func (s *coverStub) read(name string) error {
	s.calls = append(s.calls, name)
	return s.readErr
}

func (s *coverStub) saw(want string) bool {
	for _, got := range s.calls {
		if got == want {
			return true
		}
	}
	return false
}

// ── Address groups / service groups ──────────────────────────────────────────

func (s *coverStub) GetAddressGroupsFull() ([]services.FGAddressGroup, error) {
	return s.addrGroups, s.read("GetAddressGroupsFull")
}

func (s *coverStub) GetAddressGroup(name string) (*services.FGAddressGroup, error) {
	if err := s.read("GetAddressGroup " + name); err != nil {
		return nil, err
	}
	for i := range s.addrGroups {
		if s.addrGroups[i].Name == name {
			return &s.addrGroups[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateAddressGroup(g services.FGAddressGroup) error {
	s.gotAddrGroup = g
	return s.note("CreateAddressGroup", g.Name)
}

func (s *coverStub) UpdateAddressGroup(name string, g services.FGAddressGroup) error {
	s.gotAddrGroup = g
	return s.note("UpdateAddressGroup", name)
}

func (s *coverStub) DeleteAddressGroup(name string) error {
	return s.note("DeleteAddressGroup", name)
}

func (s *coverStub) GetServiceGroupsFull() ([]services.FGServiceGroup, error) {
	return s.svcGroups, s.read("GetServiceGroupsFull")
}

func (s *coverStub) GetServiceGroup(name string) (*services.FGServiceGroup, error) {
	if err := s.read("GetServiceGroup " + name); err != nil {
		return nil, err
	}
	for i := range s.svcGroups {
		if s.svcGroups[i].Name == name {
			return &s.svcGroups[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateServiceGroup(g services.FGServiceGroup) error {
	s.gotSvcGroup = g
	return s.note("CreateServiceGroup", g.Name)
}

func (s *coverStub) UpdateServiceGroup(name string, g services.FGServiceGroup) error {
	s.gotSvcGroup = g
	return s.note("UpdateServiceGroup", name)
}

func (s *coverStub) DeleteServiceGroup(name string) error {
	return s.note("DeleteServiceGroup", name)
}

// ── Zones ────────────────────────────────────────────────────────────────────

func (s *coverStub) GetZones() ([]services.FGZone, error) { return s.zones, s.read("GetZones") }

func (s *coverStub) GetZone(name string) (*services.FGZone, error) {
	if err := s.read("GetZone " + name); err != nil {
		return nil, err
	}
	for i := range s.zones {
		if s.zones[i].Name == name {
			return &s.zones[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateZone(z services.FGZone) error {
	s.gotZone = z
	return s.note("CreateZone", z.Name)
}

func (s *coverStub) UpdateZone(name string, z services.FGZone) error {
	s.gotZone = z
	return s.note("UpdateZone", name)
}

func (s *coverStub) DeleteZone(name string) error { return s.note("DeleteZone", name) }

// ── IP pools ─────────────────────────────────────────────────────────────────

func (s *coverStub) GetIPPoolsFull() ([]services.FGIPPool, error) {
	return s.pools, s.read("GetIPPoolsFull")
}

func (s *coverStub) GetIPPool(name string) (*services.FGIPPool, error) {
	if err := s.read("GetIPPool " + name); err != nil {
		return nil, err
	}
	for i := range s.pools {
		if s.pools[i].Name == name {
			return &s.pools[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateIPPool(p services.FGIPPool) error {
	s.gotPool = p
	return s.note("CreateIPPool", p.Name)
}

func (s *coverStub) UpdateIPPool(name string, p services.FGIPPool) error {
	s.gotPool = p
	return s.note("UpdateIPPool", name)
}

func (s *coverStub) DeleteIPPool(name string) error { return s.note("DeleteIPPool", name) }

// ── Virtual IPs ──────────────────────────────────────────────────────────────

func (s *coverStub) GetVirtualIPs() ([]services.FGVirtualIP, error) {
	return s.vips, s.read("GetVirtualIPs")
}

func (s *coverStub) GetVirtualIP(name string) (*services.FGVirtualIP, error) {
	if err := s.read("GetVirtualIP " + name); err != nil {
		return nil, err
	}
	for i := range s.vips {
		if s.vips[i].Name == name {
			return &s.vips[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateVirtualIP(v services.FGVirtualIP) error {
	s.gotVIP = v
	return s.note("CreateVirtualIP", v.Name)
}

func (s *coverStub) UpdateVirtualIP(name string, v services.FGVirtualIP) error {
	s.gotVIP = v
	return s.note("UpdateVirtualIP", name)
}

func (s *coverStub) DeleteVirtualIP(name string) error { return s.note("DeleteVirtualIP", name) }

// ── Schedules ────────────────────────────────────────────────────────────────

func (s *coverStub) GetSchedulesAll() ([]services.FGScheduleFull, error) {
	return s.schedules, s.read("GetSchedulesAll")
}

func (s *coverStub) GetSchedule(fgType, name string) (*services.FGScheduleFull, error) {
	if err := s.read("GetSchedule " + fgType + " " + name); err != nil {
		return nil, err
	}
	for i := range s.schedules {
		if s.schedules[i].Name == name {
			return &s.schedules[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateSchedule(sc services.FGScheduleFull) error {
	s.gotSchedule = sc
	return s.note("CreateSchedule", sc.Type, sc.Name)
}

func (s *coverStub) UpdateSchedule(fgType, name string, sc services.FGScheduleFull) error {
	s.gotSchedule = sc
	return s.note("UpdateSchedule", fgType, name)
}

func (s *coverStub) DeleteSchedule(fgType, name string) error {
	return s.note("DeleteSchedule", fgType, name)
}

// ── Static routes ────────────────────────────────────────────────────────────

func (s *coverStub) GetStaticRoutes() ([]services.FGStaticRoute, error) {
	return s.routes, s.read("GetStaticRoutes")
}

func (s *coverStub) GetStaticRoute(seq int) (*services.FGStaticRoute, error) {
	if err := s.read("GetStaticRoute " + strconv.Itoa(seq)); err != nil {
		return nil, err
	}
	for i := range s.routes {
		if s.routes[i].SeqNum == seq {
			return &s.routes[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateStaticRoute(w services.FGStaticRouteWrite) (int, error) {
	s.gotRoute = w
	if err := s.note("CreateStaticRoute", w.Dst); err != nil {
		return 0, err
	}
	return 42, nil
}

func (s *coverStub) UpdateStaticRoute(seq int, w services.FGStaticRouteWrite) error {
	s.gotRoute, s.gotRouteSeq = w, seq
	return s.note("UpdateStaticRoute", strconv.Itoa(seq))
}

func (s *coverStub) DeleteStaticRoute(seq int) error {
	s.gotRouteSeq = seq
	return s.note("DeleteStaticRoute", strconv.Itoa(seq))
}

func (s *coverStub) GetInternetServices() ([]services.FGInternetService, error) {
	return s.intServs, s.read("GetInternetServices")
}

func (s *coverStub) GetRouteInterfaces() ([]services.FGInterface, error) {
	return s.routeIntfs, s.read("GetRouteInterfaces")
}

// ── Traffic shaping ──────────────────────────────────────────────────────────

func (s *coverStub) GetTrafficShapers() ([]services.FGTrafficShaper, error) {
	return s.shapers, s.read("GetTrafficShapers")
}

func (s *coverStub) GetTrafficShaper(name string) (*services.FGTrafficShaper, error) {
	if err := s.read("GetTrafficShaper " + name); err != nil {
		return nil, err
	}
	for i := range s.shapers {
		if s.shapers[i].Name == name {
			return &s.shapers[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateTrafficShaper(sh services.FGTrafficShaper) error {
	s.gotShaper = sh
	return s.note("CreateTrafficShaper", sh.Name)
}

func (s *coverStub) UpdateTrafficShaper(name string, sh services.FGTrafficShaper) error {
	s.gotShaper = sh
	return s.note("UpdateTrafficShaper", name)
}

func (s *coverStub) DeleteTrafficShaper(name string) error {
	return s.note("DeleteTrafficShaper", name)
}

func (s *coverStub) GetShapingPolicies() ([]services.FGShapingPolicy, error) {
	return s.shapePols, s.read("GetShapingPolicies")
}

func (s *coverStub) CreateShapingPolicy(p services.FGShapingPolicy) error {
	s.gotShapePol = p
	return s.note("CreateShapingPolicy", p.Name)
}

func (s *coverStub) UpdateShapingPolicy(id int, p services.FGShapingPolicy) error {
	s.gotShapePol = p
	return s.note("UpdateShapingPolicy", strconv.Itoa(id))
}

func (s *coverStub) DeleteShapingPolicy(id int) error {
	return s.note("DeleteShapingPolicy", strconv.Itoa(id))
}

// ── Web rating overrides ─────────────────────────────────────────────────────

func (s *coverStub) GetWebRatingOverrides() ([]services.WebRatingOverride, error) {
	return s.ratings, s.read("GetWebRatingOverrides")
}

func (s *coverStub) GetWebRatingOverride(rawURL string) (services.WebRatingOverride, error) {
	if err := s.read("GetWebRatingOverride " + rawURL); err != nil {
		return services.WebRatingOverride{}, err
	}
	for _, o := range s.ratings {
		if o.URL == rawURL {
			return o, nil
		}
	}
	return services.WebRatingOverride{}, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) GetWebRatingMetadata() services.WebRatingMetadata {
	s.calls = append(s.calls, "GetWebRatingMetadata")
	return s.ratingMeta
}

func (s *coverStub) CreateWebRatingOverride(o services.WebRatingOverride) error {
	s.gotRating = o
	return s.note("CreateWebRatingOverride", o.URL)
}

func (s *coverStub) UpdateWebRatingOverride(originalURL string, o services.WebRatingOverride) error {
	s.gotRating = o
	return s.note("UpdateWebRatingOverride", originalURL)
}

func (s *coverStub) DeleteWebRatingOverride(rawURL string) error {
	return s.note("DeleteWebRatingOverride", rawURL)
}

func (s *coverStub) LookupWebRating(rawURL string) (services.WebRatingLookup, error) {
	return s.ratingHit, s.read("LookupWebRating " + rawURL)
}

// ── Firewall policy clone / bulk / usage ─────────────────────────────────────

func (s *coverStub) ClonePolicy(policyID int, newName string) (*services.FGPolicy, error) {
	s.calls = append(s.calls, "ClonePolicy "+strconv.Itoa(policyID)+" "+newName)
	return s.cloned, s.cloneErr
}

func (s *coverStub) BulkPolicyStatus(ids []int, enable bool) []services.BulkResult {
	s.calls = append(s.calls, "BulkPolicyStatus "+joinInts(ids)+" "+strconv.FormatBool(enable))
	return s.bulkOut
}

func (s *coverStub) BulkDeletePolicies(ids []int) []services.BulkResult {
	s.calls = append(s.calls, "BulkDeletePolicies "+joinInts(ids))
	return s.bulkOut
}

func (s *coverStub) GetPolicyUsage(staleDays int) (services.FGPolicyUsageReport, error) {
	s.policyUse.StaleDays = staleDays
	return s.policyUse, s.read("GetPolicyUsage " + strconv.Itoa(staleDays))
}

// ── SNMP ─────────────────────────────────────────────────────────────────────

func (s *coverStub) GetSNMPSysInfo() (*services.FGSNMPSysInfo, error) {
	return s.snmpSys, s.read("GetSNMPSysInfo")
}

func (s *coverStub) UpdateSNMPSysInfo(si services.FGSNMPSysInfo) error {
	s.gotSNMPSys = si
	return s.note("UpdateSNMPSysInfo")
}

func (s *coverStub) GetSNMPCommunities() ([]services.FGSNMPCommunity, error) {
	return s.snmpComms, s.read("GetSNMPCommunities")
}

func (s *coverStub) GetSNMPCommunity(id int) (*services.FGSNMPCommunity, error) {
	if err := s.read("GetSNMPCommunity " + strconv.Itoa(id)); err != nil {
		return nil, err
	}
	for i := range s.snmpComms {
		if s.snmpComms[i].ID == id {
			return &s.snmpComms[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateSNMPCommunity(com services.FGSNMPCommunity) (int, error) {
	s.gotSNMPComm = com
	if err := s.note("CreateSNMPCommunity", com.Name); err != nil {
		return 0, err
	}
	return s.newCommunityI, nil
}

func (s *coverStub) UpdateSNMPCommunity(id int, com services.FGSNMPCommunity) error {
	s.gotSNMPComm = com
	return s.note("UpdateSNMPCommunity", strconv.Itoa(id))
}

func (s *coverStub) DeleteSNMPCommunity(id int) error {
	return s.note("DeleteSNMPCommunity", strconv.Itoa(id))
}

func (s *coverStub) GetSNMPUsers() ([]services.FGSNMPUser, error) {
	return s.snmpUsers, s.read("GetSNMPUsers")
}

func (s *coverStub) GetSNMPUser(name string) (*services.FGSNMPUser, error) {
	if err := s.read("GetSNMPUser " + name); err != nil {
		return nil, err
	}
	for i := range s.snmpUsers {
		if s.snmpUsers[i].Name == name {
			return &s.snmpUsers[i], nil
		}
	}
	return nil, &services.DeviceError{Code: services.FGErrNoSuchNode, HTTPStatus: 404, Text: "entry not found"}
}

func (s *coverStub) CreateSNMPUser(w services.FGSNMPUserWrite) error {
	s.gotSNMPUser = w
	return s.note("CreateSNMPUser", w.Name)
}

func (s *coverStub) UpdateSNMPUser(name string, w services.FGSNMPUserWrite) error {
	s.gotSNMPUser = w
	return s.note("UpdateSNMPUser", name)
}

func (s *coverStub) DeleteSNMPUser(name string) error { return s.note("DeleteSNMPUser", name) }

// ── Log settings + HA ────────────────────────────────────────────────────────

func (s *coverStub) GetLogSettings() (*services.FGLogSettings, error) {
	return s.logSet, s.read("GetLogSettings")
}

func (s *coverStub) UpdateLogEvents(e services.FGLogEvents) error {
	s.gotLogEvents = e
	return s.note("UpdateLogEvents")
}

func (s *coverStub) UpdateLogMemory(m services.FGLogMemory) error {
	s.gotLogMemory = m
	return s.note("UpdateLogMemory")
}

func (s *coverStub) UpdateLogDisk(d services.FGLogDisk) error {
	s.gotLogDisk = d
	return s.note("UpdateLogDisk")
}

func (s *coverStub) UpdateLogSyslog(sl services.FGLogSyslog) error {
	s.gotLogSyslog = sl
	return s.note("UpdateLogSyslog")
}

func (s *coverStub) UpdateLogFortiAnalyzer(a services.FGLogFortiAnalyzer) error {
	s.gotLogFAZ = a
	return s.note("UpdateLogFortiAnalyzer")
}

func (s *coverStub) GetHAStatus() (*services.FGHAStatus, error) {
	return s.haStatus, s.read("GetHAStatus")
}

// ── Pickers and metadata (device_meta.go) ────────────────────────────────────

func (s *coverStub) GetAvailableInterfaces() ([]services.FGInterface, error) {
	s.calls = append(s.calls, "GetAvailableInterfaces")
	return s.availIfs, s.availErr
}

func (s *coverStub) GetInterfaces() ([]services.FGInterface, error) {
	return s.ifaces, s.read("GetInterfaces")
}

func (s *coverStub) GetSystemInterfaces() ([]services.FGSystemInterface, error) {
	return s.sysIntfs, s.read("GetSystemInterfaces")
}

func (s *coverStub) GetSDNConnectors() ([]services.FGSDNConnector, error) {
	return s.sdnConns, s.read("GetSDNConnectors")
}

func (s *coverStub) GetVDOMs() ([]services.FGVDOM, error) { return s.vdoms, s.read("GetVDOMs") }

func (s *coverStub) GetHostname() (string, error) {
	s.calls = append(s.calls, "GetHostname")
	return s.hostname, s.hostErr
}

func (s *coverStub) GetSystemStatus() (services.FGSystemStatus, error) {
	s.calls = append(s.calls, "GetSystemStatus")
	return s.status, s.statusErr
}

func (s *coverStub) GetSchedules() ([]services.FGSchedule, error) {
	s.calls = append(s.calls, "GetSchedules")
	return []services.FGSchedule{{Name: "always", Type: "recurring"}}, nil
}

func (s *coverStub) GetAVProfiles() ([]services.FGName, error) {
	return []services.FGName{{Name: "default"}}, nil
}
func (s *coverStub) GetWebFilterProfiles() ([]services.FGName, error) {
	return []services.FGName{{Name: "monitor-all"}}, nil
}
func (s *coverStub) GetDNSFilterProfiles() ([]services.FGName, error) { return nil, nil }
func (s *coverStub) GetAppControlLists() ([]services.FGName, error)   { return nil, nil }
func (s *coverStub) GetIPSSensors() ([]services.FGName, error) {
	return []services.FGName{{Name: "all_default"}}, nil
}
func (s *coverStub) GetFileFilterProfiles() ([]services.FGName, error)      { return nil, nil }
func (s *coverStub) GetSSLSSHProfiles() ([]services.FGName, error)          { return nil, nil }
func (s *coverStub) GetIPPools() ([]services.FGName, error)                 { return nil, nil }
func (s *coverStub) GetProtocolOptions() ([]services.FGName, error)         { return nil, nil }
func (s *coverStub) GetAddressGroups() ([]services.FGName, error)           { return nil, nil }
func (s *coverStub) GetServiceGroups() ([]services.FGName, error)           { return nil, nil }
func (s *coverStub) GetDecryptedTrafficMirrors() ([]services.FGName, error) { return nil, nil }

func (s *coverStub) GetGUIFeatureFlags() (map[string]bool, error) {
	return s.guiFlags, s.readErr
}

// ── Dashboard ────────────────────────────────────────────────────────────────

func (s *coverStub) GetSystemInformation() (services.FGSystemInformation, error) {
	return s.sysInfo, s.sysInfoErr
}
func (s *coverStub) GetPerformance() (services.FGPerformance, error) { return s.perf, s.perfErr }
func (s *coverStub) GetResourceUsage(interval string) (services.FGResourceUsage, error) {
	s.calls = append(s.calls, "GetResourceUsage "+interval)
	return s.resUsage, s.resUsageErr
}
func (s *coverStub) GetSessionSummary() (services.FGSessionSummary, error) {
	return s.sessions, s.sessionsErr
}
func (s *coverStub) GetLicenseOverview() (services.FGLicenseOverview, error) {
	return s.licenses, s.licensesErr
}
func (s *coverStub) GetCurrentAdmins() ([]services.FGAdminSession, error) {
	return s.admins, s.adminsErr
}
func (s *coverStub) GetFabricStatus(serial string) (services.FGFabricStatus, error) {
	s.calls = append(s.calls, "GetFabricStatus "+serial)
	return s.fabric, s.fabricErr
}

// ── Usage + diagnostics ──────────────────────────────────────────────────────

func (s *coverStub) FindUsage(kind, name string) (*services.UsageReport, error) {
	return s.usage, s.read("FindUsage " + kind + " " + name)
}

func (s *coverStub) GetNetworkSettings() services.FGNetworkSettings {
	s.calls = append(s.calls, "GetNetworkSettings")
	return s.netSet
}

// ── Auth servers ─────────────────────────────────────────────────────────────

func (s *coverStub) GetLDAPServers() ([]services.FGLDAPServer, error) {
	return s.ldapServers, s.read("GetLDAPServers")
}

func (s *coverStub) GetLDAPServer(name string) (*services.FGLDAPServerForm, error) {
	return s.ldapForm, s.read("GetLDAPServer " + name)
}

func (s *coverStub) GetLDAPServerOptions() services.FGLDAPServerOptions {
	s.calls = append(s.calls, "GetLDAPServerOptions")
	return s.ldapOpts
}

func (s *coverStub) CreateLDAPServer(form services.FGLDAPServerForm) error {
	s.gotLDAP = form
	return s.note("CreateLDAPServer", form.Name)
}

func (s *coverStub) UpdateLDAPServer(name string, form services.FGLDAPServerForm) error {
	s.gotLDAP = form
	return s.note("UpdateLDAPServer", name)
}

func (s *coverStub) DeleteLDAPServer(name string) error { return s.note("DeleteLDAPServer", name) }

func (s *coverStub) GetRADIUSServers() ([]services.FGRADIUSServer, error) {
	return s.radServers, s.read("GetRADIUSServers")
}

func (s *coverStub) GetRADIUSServer(name string) (*services.FGRADIUSServerForm, error) {
	return s.radForm, s.read("GetRADIUSServer " + name)
}

func (s *coverStub) CreateRADIUSServer(form services.FGRADIUSServerForm) error {
	s.gotRADIUS = form
	return s.note("CreateRADIUSServer", form.Name)
}

func (s *coverStub) UpdateRADIUSServer(name string, form services.FGRADIUSServerForm) error {
	s.gotRADIUS = form
	return s.note("UpdateRADIUSServer", name)
}

func (s *coverStub) DeleteRADIUSServer(name string) error {
	return s.note("DeleteRADIUSServer", name)
}

func (s *coverStub) TestRADIUSServer(name, ordinal, user, password string) (*services.FGRADIUSTestResult, error) {
	s.calls = append(s.calls, "TestRADIUSServer "+name+" "+ordinal+" "+user)
	return s.radTest, s.readErr
}

func (s *coverStub) GetExchangeConnectors() ([]services.FGExchangeConnector, error) {
	return s.exchConns, s.read("GetExchangeConnectors")
}

func (s *coverStub) CreateExchangeConnector(form services.FGExchangeConnectorForm) error {
	s.gotExch = form
	return s.note("CreateExchangeConnector", form.Name)
}

func (s *coverStub) DeleteExchangeConnector(name string) error {
	return s.note("DeleteExchangeConnector", name)
}

// ── Address objects a tunnel's subnets become ────────────────────────────────

func (s *coverStub) AddressExists(name string) bool      { return s.exists[name] }
func (s *coverStub) AddressGroupExists(name string) bool { return s.groupExists[name] }

func (s *coverStub) GetAddresses() ([]services.FGAddress, error) {
	return s.addresses, s.read("GetAddresses")
}

func (s *coverStub) CreateAddress(a services.FGAddress) error {
	s.gotAddress = a
	return s.note("CreateAddress", a.Name, a.Subnet)
}

func (s *coverStub) UpdateAddress(name string, a services.FGAddress) error {
	s.gotAddress = a
	return s.note("UpdateAddress", name, a.Subnet)
}

func (s *coverStub) DeleteAddress(name string) error { return s.note("DeleteAddress", name) }

func (s *coverStub) RenameAddress(oldName, newName string) error {
	return s.note("RenameAddress", oldName, newName)
}

func (s *coverStub) RepointPolicyAddress(from, to string) error {
	return s.note("RepointPolicyAddress", from, to)
}

func (s *coverStub) SetAddressGroupMembers(name string, members []string, comment string) error {
	s.gotGroupName, s.gotMembers = name, members
	return s.note("SetAddressGroupMembers", name, strings.Join(members, ","))
}

func (s *coverStub) CreateAddressGroupWithMembers(name string, members []string, comment string) error {
	s.gotGroupName, s.gotMembers = name, members
	return s.note("CreateAddressGroupWithMembers", name, strings.Join(members, ","))
}

// ── small helpers the per-domain files share ──────────────────────────────────

func joinInts(ids []int) string {
	parts := make([]string, len(ids))
	for i, id := range ids {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, ",")
}

// coverDevErr is what the firewall answering "no" looks like: a typed error carrying the numeric
// code the client compares. Never a message containing "-5" — that substring also matches -518 and
// an object called "spoke-5", which is the trap services/fortigate_error.go exists to close.
func coverDevErr(code int) error {
	return &services.DeviceError{Code: code, HTTPStatus: 500, Text: "device refused"}
}

// roleRequest aims a handler at device 1 as a caller holding `role`, with NO database behind it.
//
// That is deliberate and it is what makes the permission half of these tests cheap: every write
// handler in this package calls requireAdminPO (or requireAdminStrict) BEFORE getDeviceInfo, so a
// refused role never reaches a query, let alone a firewall. A test that needed Postgres to prove
// a 403 would be proving something else.
func roleRequest(method, tail, role, body string, params ...gin.Param) (*gin.Context, *httptest.ResponseRecorder) {
	rec := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(rec)

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	c.Request = httptest.NewRequest(method, "/policy/device/1/"+tail, reader)
	if body != "" {
		c.Request.Header.Set("Content-Type", "application/json")
	}
	c.Params = append(gin.Params{{Key: "deviceId", Value: "1"}}, params...)
	c.Set("user_id", testPlainUserID)
	c.Set("user_role", role)
	return c, rec
}

// coverWantStatus fails with the body attached — a status mismatch is almost always explained by
// the sentence the handler wrote.
func coverWantStatus(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	if rec.Code != want {
		t.Fatalf("status = %d, want %d: %s", rec.Code, want, rec.Body.String())
	}
}

// coverWantFortiOSCode asserts the body carries `fortios_code` as a JSON NUMBER equal to want.
//
// The number is the contract: fortiosError.ts compares it numerically and has no text fallback, so
// a branch that dropped the field, or sent it as a string, would leave Apply unable to recognise
// "that name is already taken" and Fallback unable to recognise "already gone".
func coverWantFortiOSCode(t *testing.T, rec *httptest.ResponseRecorder, want int) {
	t.Helper()
	var body map[string]interface{}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("body is not JSON: %v (%s)", err, rec.Body.String())
	}
	got, present := body["fortios_code"]
	if !present {
		t.Fatalf("no fortios_code in the body — the client cannot recognise this refusal:\n%s", rec.Body.String())
	}
	n, isNumber := got.(float64)
	if !isNumber {
		t.Fatalf("fortios_code is %T (%v), not a JSON number — the client compares it numerically", got, got)
	}
	if int(n) != want {
		t.Fatalf("fortios_code = %v, want %d", got, want)
	}
}

func coverWantNoFortiOSCode(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	if strings.Contains(rec.Body.String(), "fortios_code") {
		t.Fatalf("a transport failure carried a device code — the client would read it as a refusal "+
			"the firewall never made:\n%s", rec.Body.String())
	}
}

// coverUntouched proves the device was never reached. On a refusal that is half the assertion: a
// 403 that still created the object would look identical from the status code alone.
func coverUntouched(t *testing.T, s *coverStub) {
	t.Helper()
	if len(s.calls) != 0 {
		t.Fatalf("the handler reached the device anyway: %v", s.calls)
	}
}

// coverRefusals is the error contract, as a table every domain's refusal test runs.
//
//	-5   a name already taken          409, code present
//	-23  something still points at it  409, code present
//	-3   on a request addressing one object, "not there"
//	nothing answered at all           502, and NO code
var coverRefusals = []struct {
	name     string
	err      error
	want     int
	wantCode int // 0 = the body must carry no fortios_code at all
}{
	{"a name already taken is the caller's input", coverDevErr(services.FGErrDuplicate), http.StatusConflict, services.FGErrDuplicate},
	{"still referenced is a conflict to go and resolve", coverDevErr(services.FGErrStillReferenced), http.StatusConflict, services.FGErrStillReferenced},
	{"an unrelated device code is still the request's problem", coverDevErr(-651), http.StatusBadRequest, -651},
	{"nothing answered at all", errTransport{}, http.StatusBadGateway, 0},
}

// coverCheckRefusal asserts one row of coverRefusals against a recorder.
func coverCheckRefusal(t *testing.T, rec *httptest.ResponseRecorder, want, wantCode int) {
	t.Helper()
	coverWantStatus(t, rec, want)
	if wantCode == 0 {
		coverWantNoFortiOSCode(t, rec)
		return
	}
	coverWantFortiOSCode(t, rec, wantCode)
}

// param names one route parameter the handler will read out of the path. The path and the params
// have to agree: the handler reads c.Param, while getDeviceInfo's read-only check reads the real
// URL (see the note on deviceJSONRequest).
func param(key, value string) gin.Param { return gin.Param{Key: key, Value: value} }
