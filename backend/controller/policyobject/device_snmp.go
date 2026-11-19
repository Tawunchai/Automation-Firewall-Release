package policyobject

import (
	"net/http"
	"strconv"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// System ▸ SNMP. See services/fortigate_snmp.go for the three CMDB tables and their traps.
//
// Every write here is admin-only. A community string is a shared password in all but name, and a
// v3 user carries two real ones — so this section follows System ▸ Administrators rather than the
// Policy & Objects pages, where a non-admin can at least read the rules in force.

// ── Input shapes ──────────────────────────────────────────────────────────────

type snmpSysInfoInput struct {
	Status      *bool  `json:"status"`
	Description string `json:"description"`
	ContactInfo string `json:"contact_info"`
	Location    string `json:"location"`

	TrapHighCPUThreshold   int `json:"trap_high_cpu_threshold"`
	TrapLowMemoryThreshold int `json:"trap_low_memory_threshold"`
	TrapLogFullThreshold   int `json:"trap_log_full_threshold"`
}

type snmpHostInput struct {
	ID       int    `json:"id"`
	IP       string `json:"ip"`
	HostType string `json:"host_type"`
}

type snmpCommunityInput struct {
	Name   string          `json:"name"`
	Status *bool           `json:"status"`
	Hosts  []snmpHostInput `json:"hosts"`

	QueryV1Status  *bool `json:"query_v1_status"`
	QueryV1Port    int   `json:"query_v1_port"`
	QueryV2cStatus *bool `json:"query_v2c_status"`
	QueryV2cPort   int   `json:"query_v2c_port"`

	TrapV1Status  *bool `json:"trap_v1_status"`
	TrapV1LPort   int   `json:"trap_v1_lport"`
	TrapV1RPort   int   `json:"trap_v1_rport"`
	TrapV2cStatus *bool `json:"trap_v2c_status"`
	TrapV2cLPort  int   `json:"trap_v2c_lport"`
	TrapV2cRPort  int   `json:"trap_v2c_rport"`

	Events []string `json:"events"`
}

// snmpUserInput mirrors FGSNMPUserWrite's password contract on the wire.
//
// AuthPwd/PrivPwd are `*string` all the way out to JSON so the three cases stay distinct: the key
// absent means "keep the stored password", a value means "set this one", and an empty string is
// rejected below rather than quietly clearing a working credential.
type snmpUserInput struct {
	Name   string `json:"name"`
	Status *bool  `json:"status"`

	SecurityLevel string  `json:"security_level"`
	AuthProto     string  `json:"auth_proto"`
	AuthPwd       *string `json:"auth_pwd"`
	PrivProto     string  `json:"priv_proto"`
	PrivPwd       *string `json:"priv_pwd"`

	NotifyHosts []string `json:"notify_hosts"`

	Queries   *bool `json:"queries"`
	QueryPort int   `json:"query_port"`

	TrapStatus *bool `json:"trap_status"`
	TrapLPort  int   `json:"trap_lport"`
	TrapRPort  int   `json:"trap_rport"`

	Events []string `json:"events"`
}

func snmpBool(p *bool, dflt bool) bool {
	if p == nil {
		return dflt
	}
	return *p
}

// ── Validation ────────────────────────────────────────────────────────────────

var snmpSecurityLevels = map[string]bool{
	"no-auth-no-priv": true, "auth-no-priv": true, "auth-priv": true,
}
var snmpAuthProtos = map[string]bool{
	"md5": true, "sha": true, "sha224": true, "sha256": true, "sha384": true, "sha512": true,
}
var snmpPrivProtos = map[string]bool{
	"aes": true, "des": true, "aes256": true, "aes256cisco": true,
}
var snmpHostTypes = map[string]bool{"any": true, "query": true, "trap": true}

func validSNMPPort(v int) bool { return v == 0 || (v > 0 && v <= 65535) }

func validateSNMPCommunity(inp snmpCommunityInput) string {
	if strings.TrimSpace(inp.Name) == "" {
		return "a community name is required"
	}
	live := 0
	for _, h := range inp.Hosts {
		if strings.TrimSpace(h.IP) == "" {
			continue // a blank row in the form is not a host
		}
		if h.HostType != "" && !snmpHostTypes[h.HostType] {
			return "host type must be any, query or trap"
		}
		live++
	}
	// FortiOS accepts a community with no hosts and then answers every manager that knows the
	// string, from anywhere. That is a wide-open SNMP agent created by leaving a form blank, so
	// this refuses rather than letting the device's permissiveness through.
	if live == 0 {
		return "at least one host is required — a community with no hosts answers any address"
	}
	for _, p := range []int{inp.QueryV1Port, inp.QueryV2cPort, inp.TrapV1LPort, inp.TrapV1RPort, inp.TrapV2cLPort, inp.TrapV2cRPort} {
		if !validSNMPPort(p) {
			return "ports must be between 1 and 65535"
		}
	}
	return validateSNMPEvents(inp.Events)
}

func validateSNMPUser(inp snmpUserInput, creating bool) string {
	if strings.TrimSpace(inp.Name) == "" {
		return "a user name is required"
	}
	level := inp.SecurityLevel
	if level == "" {
		level = "no-auth-no-priv"
	}
	if !snmpSecurityLevels[level] {
		return "security level must be no-auth-no-priv, auth-no-priv or auth-priv"
	}

	needsAuth := level == "auth-no-priv" || level == "auth-priv"
	needsPriv := level == "auth-priv"

	if needsAuth {
		if inp.AuthProto != "" && !snmpAuthProtos[inp.AuthProto] {
			return "unsupported authentication protocol"
		}
		// On a CREATE there is nothing stored to fall back on, so the password has to be here.
		// On an EDIT a missing key means "keep what the device has", which is the whole point of
		// the pointer — but an explicitly empty one would blank a working credential.
		if creating && (inp.AuthPwd == nil || strings.TrimSpace(*inp.AuthPwd) == "") {
			return "an authentication password is required at this security level"
		}
		if inp.AuthPwd != nil && strings.TrimSpace(*inp.AuthPwd) == "" {
			return "leave the authentication password blank to keep the stored one — it cannot be set to empty"
		}
	}
	if needsPriv {
		if inp.PrivProto != "" && !snmpPrivProtos[inp.PrivProto] {
			return "unsupported privacy protocol"
		}
		if creating && (inp.PrivPwd == nil || strings.TrimSpace(*inp.PrivPwd) == "") {
			return "a privacy password is required at this security level"
		}
		if inp.PrivPwd != nil && strings.TrimSpace(*inp.PrivPwd) == "" {
			return "leave the privacy password blank to keep the stored one — it cannot be set to empty"
		}
	}
	if !validSNMPPort(inp.QueryPort) || !validSNMPPort(inp.TrapLPort) || !validSNMPPort(inp.TrapRPort) {
		return "ports must be between 1 and 65535"
	}
	// A v3 user with traps on and nowhere to send them is a setting that does nothing, and the
	// device will not say so.
	if snmpBool(inp.TrapStatus, true) && len(nonEmpty(inp.NotifyHosts)) == 0 {
		return "traps are enabled but no notify host is set — add a host or turn traps off"
	}
	return validateSNMPEvents(inp.Events)
}

// validateSNMPEvents refuses an event this build does not know.
//
// The client layer would drop it silently, which is right for a READ off a newer firmware but
// wrong for a write: a form that posts an unknown name is a bug in this console, and failing
// loudly here is how it gets found instead of being quietly discarded.
func validateSNMPEvents(events []string) string {
	known := make(map[string]bool, len(services.SNMPEventOptions))
	for _, e := range services.SNMPEventOptions {
		known[e] = true
	}
	for _, e := range events {
		if !known[e] {
			return "unknown SNMP event: " + e
		}
	}
	return ""
}

// ── Input → service ───────────────────────────────────────────────────────────

func snmpInputToCommunity(inp snmpCommunityInput) services.FGSNMPCommunity {
	hosts := make([]services.FGSNMPHost, 0, len(inp.Hosts))
	for _, h := range inp.Hosts {
		ip := strings.TrimSpace(h.IP)
		if ip == "" {
			continue
		}
		ht := h.HostType
		if ht == "" {
			ht = "any"
		}
		hosts = append(hosts, services.FGSNMPHost{ID: h.ID, IP: ip, HostType: ht})
	}
	return services.FGSNMPCommunity{
		Name:           strings.TrimSpace(inp.Name),
		Status:         snmpBool(inp.Status, true),
		Hosts:          hosts,
		QueryV1Status:  snmpBool(inp.QueryV1Status, true),
		QueryV1Port:    inp.QueryV1Port,
		QueryV2cStatus: snmpBool(inp.QueryV2cStatus, true),
		QueryV2cPort:   inp.QueryV2cPort,
		TrapV1Status:   snmpBool(inp.TrapV1Status, true),
		TrapV1LPort:    inp.TrapV1LPort,
		TrapV1RPort:    inp.TrapV1RPort,
		TrapV2cStatus:  snmpBool(inp.TrapV2cStatus, true),
		TrapV2cLPort:   inp.TrapV2cLPort,
		TrapV2cRPort:   inp.TrapV2cRPort,
		Events:         inp.Events,
	}
}

func snmpInputToUser(inp snmpUserInput) services.FGSNMPUserWrite {
	level := inp.SecurityLevel
	if level == "" {
		level = "no-auth-no-priv"
	}
	w := services.FGSNMPUserWrite{
		FGSNMPUser: services.FGSNMPUser{
			Name:          strings.TrimSpace(inp.Name),
			Status:        snmpBool(inp.Status, true),
			SecurityLevel: level,
			AuthProto:     inp.AuthProto,
			PrivProto:     inp.PrivProto,
			NotifyHosts:   nonEmpty(inp.NotifyHosts),
			Queries:       snmpBool(inp.Queries, true),
			QueryPort:     inp.QueryPort,
			TrapStatus:    snmpBool(inp.TrapStatus, true),
			TrapLPort:     inp.TrapLPort,
			TrapRPort:     inp.TrapRPort,
			Events:        inp.Events,
		},
		AuthPwd: inp.AuthPwd,
		PrivPwd: inp.PrivPwd,
	}
	return w
}

// ── SNMP agent ────────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/snmp/sysinfo
func DeviceGetSNMPSysInfo(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	s, err := fc.GetSNMPSysInfo()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, s)
}

// PATCH /policy/device/:deviceId/snmp/sysinfo
func DeviceUpdateSNMPSysInfo(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp snmpSysInfoInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	for _, v := range []int{inp.TrapHighCPUThreshold, inp.TrapLowMemoryThreshold, inp.TrapLogFullThreshold} {
		if v < 0 || v > 100 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "trap thresholds are percentages, between 1 and 100"})
			return
		}
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	err := fc.UpdateSNMPSysInfo(services.FGSNMPSysInfo{
		Status:                 snmpBool(inp.Status, false),
		Description:            inp.Description,
		ContactInfo:            inp.ContactInfo,
		Location:               inp.Location,
		TrapHighCPUThreshold:   inp.TrapHighCPUThreshold,
		TrapLowMemoryThreshold: inp.TrapLowMemoryThreshold,
		TrapLogFullThreshold:   inp.TrapLogFullThreshold,
	})
	if err != nil {
		respondDeviceError(c, err, "SNMP agent")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SNMP agent updated on device"})
}

// ── Communities ───────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/snmp/communities
func DeviceListSNMPCommunities(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	items, err := fc.GetSNMPCommunities()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// GET /policy/device/:deviceId/snmp/communities/:id
func DeviceGetSNMPCommunity(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SNMP community id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	item, err := fc.GetSNMPCommunity(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// POST /policy/device/:deviceId/snmp/communities
func DeviceCreateSNMPCommunity(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp snmpCommunityInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateSNMPCommunity(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	id, err := fc.CreateSNMPCommunity(snmpInputToCommunity(inp))
	if err != nil {
		respondDeviceError(c, err, "SNMP community")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "SNMP community created on device", "id": id})
}

// PATCH /policy/device/:deviceId/snmp/communities/:id
func DeviceUpdateSNMPCommunity(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SNMP community id"})
		return
	}
	var inp snmpCommunityInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateSNMPCommunity(inp); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateSNMPCommunity(id, snmpInputToCommunity(inp)); err != nil {
		respondDeviceError(c, err, "SNMP community")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SNMP community updated on device"})
}

// DELETE /policy/device/:deviceId/snmp/communities/:id
func DeviceDeleteSNMPCommunity(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	id, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid SNMP community id"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteSNMPCommunity(id); err != nil {
		respondDeviceError(c, err, "SNMP community")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SNMP community deleted from device"})
}

// ── v3 users ──────────────────────────────────────────────────────────────────

// GET /policy/device/:deviceId/snmp/users
func DeviceListSNMPUsers(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	items, err := fc.GetSNMPUsers()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, items)
}

// GET /policy/device/:deviceId/snmp/users/:name
func DeviceGetSNMPUser(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an SNMP user name is required"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	item, err := fc.GetSNMPUser(name)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, item)
}

// POST /policy/device/:deviceId/snmp/users
func DeviceCreateSNMPUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	var inp snmpUserInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if msg := validateSNMPUser(inp, true); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateSNMPUser(snmpInputToUser(inp)); err != nil {
		respondDeviceError(c, err, "SNMP user")
		return
	}
	c.JSON(http.StatusCreated, gin.H{"message": "SNMP user created on device"})
}

// PATCH /policy/device/:deviceId/snmp/users/:name
func DeviceUpdateSNMPUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an SNMP user name is required"})
		return
	}
	var inp snmpUserInput
	if err := c.ShouldBindJSON(&inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(inp.Name) == "" {
		inp.Name = name
	}
	if msg := validateSNMPUser(inp, false); msg != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": msg})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.UpdateSNMPUser(name, snmpInputToUser(inp)); err != nil {
		respondDeviceError(c, err, "SNMP user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SNMP user updated on device"})
}

// DELETE /policy/device/:deviceId/snmp/users/:name
func DeviceDeleteSNMPUser(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	name := strings.TrimSpace(c.Param("name"))
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "an SNMP user name is required"})
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.DeleteSNMPUser(name); err != nil {
		respondDeviceError(c, err, "SNMP user")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "SNMP user deleted from device"})
}
