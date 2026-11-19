package policyobject

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// What a policy form is allowed to offer: the device's interfaces, its SDN connectors, the
// security profiles it actually has, and what the unit says it is.
//
// These are reads with no object of their own — they exist so a form can be built out of what the
// firewall really has rather than out of what this console assumes. Split out of device_proxy.go,
// which is now the firewall policy handlers alone.

// GET /policy/device/:deviceId/interfaces — list all network interfaces
func DeviceListInterfaces(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	// Prefer the same monitor endpoint FortiGate's own policy page uses (already
	// filtered to policy-eligible interfaces); fall back to the raw CMDB list only if
	// that endpoint isn't available on this FortiOS build.
	ifaces, err := fc.GetAvailableInterfaces()
	if err != nil {
		ifaces, err = fc.GetInterfaces()
		if err != nil {
			respondDeviceError(c, err, "interface")
			return
		}
	}

	type IfaceOut struct {
		Name  string `json:"name"`
		Alias string `json:"alias"`
		IP    string `json:"ip"`
		Type  string `json:"type"`
	}
	result := make([]IfaceOut, 0, len(ifaces))
	for _, iface := range ifaces {
		if iface.Name != "" {
			result = append(result, IfaceOut{
				Name:  iface.Name,
				Alias: iface.Alias,
				IP:    iface.IP,
				Type:  iface.Type,
			})
		}
	}
	c.JSON(http.StatusOK, result)
}

// GET /policy/device/:deviceId/sdn-connectors — Fabric/SDN connectors, the datasource
// behind a Dynamic (Fabric Connector) address's "SDN Connector" dropdown.
func DeviceListSDNConnectors(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	conns, err := fc.GetSDNConnectors()
	if err != nil {
		respondDeviceError(c, err, "SDN connector")
		return
	}

	type SDNOut struct {
		Name   string `json:"name"`
		Type   string `json:"type"`
		Status string `json:"status"`
	}
	result := make([]SDNOut, 0, len(conns))
	for _, s := range conns {
		result = append(result, SDNOut{Name: s.Name, Type: s.Type, Status: s.Status})
	}
	c.JSON(http.StatusOK, result)
}

// GET /policy/device/:deviceId/policy-profiles — bundled options for the firewall
// policy create/edit form: schedules + every security-profile/NAT-pool/protocol-options
// name list, fetched live from the device.
//
// One request from the browser, fourteen concurrent reads on the device (see below) — the comment
// here used to say "in one round trip", which was true of the browser and not of the firewall.
func DeviceGetPolicyProfiles(c *gin.Context) {
	_, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	names := func(list []services.FGName) []string { return services.FGNamesToStrings(list) }

	// Fourteen independent GETs. They used to run one after another, which made this the slowest
	// call on the Firewall Policy form: the page fires four requests in parallel and waits for all
	// of them, so ~14 × 0.05s of pure waiting here set the time the form took to appear.
	//
	// None of them reads another's result, so they all go at once and the response is assembled
	// below exactly as before — same fields, same order, same "a failed section becomes an empty
	// picker" behaviour (every call already discards its error).
	var (
		schedules                                        []services.FGSchedule
		avProfiles, webfilterProfiles, dnsfilterProfiles []services.FGName
		appLists, ipsSensors, fileFilterProfiles         []services.FGName
		sslSSHProfiles, ipPools, protocolOptions         []services.FGName
		addressGroups, serviceGroups                     []services.FGName
		decryptedTrafficMirrors                          []services.FGName
		guiFlags                                         map[string]bool
	)
	services.Parallel(
		func() { schedules, _ = fc.GetSchedules() },
		func() { avProfiles, _ = fc.GetAVProfiles() },
		func() { webfilterProfiles, _ = fc.GetWebFilterProfiles() },
		func() { dnsfilterProfiles, _ = fc.GetDNSFilterProfiles() },
		func() { appLists, _ = fc.GetAppControlLists() },
		func() { ipsSensors, _ = fc.GetIPSSensors() },
		func() { fileFilterProfiles, _ = fc.GetFileFilterProfiles() },
		func() { sslSSHProfiles, _ = fc.GetSSLSSHProfiles() },
		func() { ipPools, _ = fc.GetIPPools() },
		func() { protocolOptions, _ = fc.GetProtocolOptions() },
		func() { addressGroups, _ = fc.GetAddressGroups() },
		func() { serviceGroups, _ = fc.GetServiceGroups() },
		func() { decryptedTrafficMirrors, _ = fc.GetDecryptedTrafficMirrors() },
		func() { guiFlags, _ = fc.GetGUIFeatureFlags() },
	)

	type ScheduleOut struct {
		Name string `json:"name"`
		Type string `json:"type"`
	}
	scheduleOut := make([]ScheduleOut, 0, len(schedules))
	for _, s := range schedules {
		scheduleOut = append(scheduleOut, ScheduleOut{Name: s.Name, Type: s.Type})
	}

	// gui-* flags let a whole security-profile category be hidden from the GUI (System >
	// Feature Visibility) without deleting its underlying profile objects — e.g. this is
	// why a device can have real IPS sensors configured yet show no IPS toggle on the
	// policy page. Default to true (show) when a flag is absent so behavior degrades to
	// "show everything" rather than hiding sections on FortiOS builds without this field.
	flag := func(key string) bool {
		v, ok := guiFlags[key]
		if !ok {
			return true
		}
		return v
	}
	visibility := gin.H{
		"antivirus":           flag("gui-antivirus"),
		"webfilter":           flag("gui-webfilter"),
		"dnsfilter":           flag("gui-dnsfilter"),
		"application_control": flag("gui-application-control"),
		"ips":                 flag("gui-ips"),
		"file_filter":         flag("gui-file-filter"),
	}

	c.JSON(http.StatusOK, gin.H{
		"schedules":                   scheduleOut,
		"av_profiles":                 names(avProfiles),
		"webfilter_profiles":          names(webfilterProfiles),
		"dnsfilter_profiles":          names(dnsfilterProfiles),
		"app_lists":                   names(appLists),
		"ips_sensors":                 names(ipsSensors),
		"file_filter_profiles":        names(fileFilterProfiles),
		"ssl_ssh_profiles":            names(sslSSHProfiles),
		"ip_pools":                    names(ipPools),
		"protocol_options":            names(protocolOptions),
		"address_groups":              names(addressGroups),
		"service_groups":              names(serviceGroups),
		"decrypted_traffic_mirrors":   names(decryptedTrafficMirrors),
		"security_profile_visibility": visibility,
	})
}

// GET /policy/device/:deviceId/info — hostname + version from FortiGate
func DeviceGetInfo(c *gin.Context) {
	di, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	// Two independent reads — system/global for the hostname, the monitor status for the rest.
	// Neither uses the other's answer, so they go at once rather than one after the other; the
	// fallbacks below run after both have finished and are unchanged.
	var (
		hostname string
		hostErr  error
		st       services.FGSystemStatus
		stErr    error
	)
	services.Parallel(
		func() { hostname, hostErr = fc.GetHostname() },
		func() { st, stErr = fc.GetSystemStatus() },
	)

	if hostErr != nil {
		// fallback to device name
		hostname = di.Device.Name
	}
	// Model/serial/version power the Interfaces-page faceplate title ("FortiGate 80E").
	// Best-effort: an error here just leaves those blank rather than failing the request.
	model, serial, version := "", "", ""
	if stErr == nil {
		model, serial, version = st.Model, st.Serial, st.Version
		if hostname == "" && st.Hostname != "" {
			hostname = st.Hostname
		}
	}
	c.JSON(http.StatusOK, gin.H{
		"hostname":  hostname,
		"device_ip": di.Device.MgmtIP,
		"platform":  di.Device.Platform,
		"model":     model,
		"serial":    serial,
		"version":   version,
	})
}
