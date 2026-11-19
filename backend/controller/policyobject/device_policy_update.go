package policyobject

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"network_automation/services"
)

// PATCH /policy/device/:deviceId/firewall-policies/:policyId
func DeviceUpdatePolicy(c *gin.Context) {
	if !requireAdminPO(c) {
		return
	}
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	policyID, err := strconv.Atoi(c.Param("policyId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid policy id"})
		return
	}

	// Read the body once, as bytes: `inp` gives the typed values, `present` gives which JSON keys
	// the caller actually sent. The two together are what makes this a real partial update — see
	// buildPolicyUpdateAttrs. Binding only into `inp` (the old code) cannot tell "the caller left
	// `enabled` out" from "the caller sent enabled:false that happens to match Go's bool zero
	// value", and defaulting the former to `true` is what let a PATCH silently re-enable a disabled
	// policy, or (via `nat`) silently turn NAT off, whenever a caller sent anything less than the
	// complete policy. Today's firewall-policy form always does send the complete policy, which is
	// the only reason this has not already surfaced in the UI.
	body, err := c.GetRawData()
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var inp policyInput
	if err := json.Unmarshal(body, &inp); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var present map[string]json.RawMessage
	if err := json.Unmarshal(body, &present); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	attrs := buildPolicyUpdateAttrs(inp, present)
	if len(attrs) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "no fields to update"})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	// A true partial PUT, not a read-modify-write: FortiOS already merges a PUT body into the
	// existing object (see UpdateCMDBAttrs's own doc comment, and TogglePolicyStatus below, which
	// has relied on exactly this for its one-field "status" PUT all along) — so the fields this
	// handler never sends are simply left as they were on the device, with no GET round-trip needed
	// to know what they currently are.
	if err := fc.UpdateCMDBAttrs("firewall/policy", strconv.Itoa(policyID), attrs); err != nil {
		respondDeviceError(c, err, "firewall policy")
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "policy updated on device"})
}

// buildPolicyUpdateAttrs turns a PATCH body into exactly the CMDB attributes it asked to change.
// `present` is the same body's raw top-level keys; a field `inp` carries only because Go zero-values
// it (its JSON key was never sent) must never reach `attrs` and overwrite whatever the live policy
// already has there. The default-substitution below (empty address list → "all", and so on) mirrors
// DeviceCreatePolicy's and only applies to a field the caller did send — an omitted field is not
// reached by it at all, it is simply absent from the returned map.
func buildPolicyUpdateAttrs(inp policyInput, present map[string]json.RawMessage) map[string]any {
	has := func(keys ...string) bool {
		for _, k := range keys {
			if _, ok := present[k]; ok {
				return true
			}
		}
		return false
	}

	attrs := map[string]any{}
	if has("name") {
		attrs["name"] = inp.Name
	}
	if has("src_intf", "src_intf_list") {
		attrs["srcintf"] = services.NamesToFGNames(intfListOrSingle(inp.SrcIntfList, inp.SrcIntf))
	}
	if has("dst_intf", "dst_intf_list") {
		attrs["dstintf"] = services.NamesToFGNames(intfListOrSingle(inp.DstIntfList, inp.DstIntf))
	}
	if has("src_addr") {
		srcAddr := inp.SrcAddr
		if len(srcAddr) == 0 {
			srcAddr = []string{"all"}
		}
		attrs["srcaddr"] = services.NamesToFGNames(srcAddr)
	}
	if has("dst_addr") {
		dstAddr := inp.DstAddr
		if len(dstAddr) == 0 {
			dstAddr = []string{"all"}
		}
		attrs["dstaddr"] = services.NamesToFGNames(dstAddr)
	}
	if has("service") {
		svc := inp.Service
		if len(svc) == 0 {
			svc = []string{"ALL"}
		}
		attrs["service"] = services.NamesToFGNames(svc)
	}
	if has("schedule") {
		schedule := inp.Schedule
		if schedule == "" {
			schedule = "always"
		}
		attrs["schedule"] = schedule
	}
	if has("action") {
		attrs["action"] = inp.Action
	}
	if has("nat") {
		attrs["nat"] = services.FGBoolToString(inp.NAT)
	}
	if has("log_traffic") {
		logTraffic := inp.LogTraffic
		if logTraffic == "" {
			logTraffic = "disable"
		}
		attrs["logtraffic"] = logTraffic
	}
	// Enabled is already a *bool (nil means "not sent"), unlike the plain bools above that need
	// `present` to tell omitted from false — this is the one field the old code already got right.
	if inp.Enabled != nil {
		attrs["status"] = services.FGBoolToString(*inp.Enabled)
	}
	if has("comments") {
		attrs["comments"] = inp.Comments
	}
	if has("ippool") {
		attrs["ippool"] = services.FGBoolToString(inp.IPPool)
	}
	if has("poolname") {
		attrs["poolname"] = services.NamesToFGNames(inp.PoolName)
	}
	if has("fixedport") {
		attrs["fixedport"] = services.FGBoolToString(inp.FixedPort)
	}
	if has("protocol_options") {
		attrs["profile-protocol-options"] = inp.ProtocolOptions
	}
	if has("av_profile") {
		attrs["av-profile"] = inp.AVProfile
	}
	if has("webfilter_profile") {
		attrs["webfilter-profile"] = inp.WebFilterProfile
	}
	if has("dnsfilter_profile") {
		attrs["dnsfilter-profile"] = inp.DNSFilterProfile
	}
	if has("app_control") {
		attrs["application-list"] = inp.AppControl
	}
	if has("ips_sensor") {
		attrs["ips-sensor"] = inp.IPSSensor
	}
	if has("file_filter_profile") {
		attrs["file-filter-profile"] = inp.FileFilterProfile
	}
	if has("ssl_ssh_profile") {
		attrs["ssl-ssh-profile"] = inp.SSLSSHProfile
	}
	if has("decrypted_traffic_mirror") {
		attrs["decrypted-traffic-mirror"] = inp.DecryptedTrafficMirror
	}
	// utm-status mirrors DeviceCreatePolicy's rule (any profile set → utm on), and only when every
	// profile field was resent — today's only caller, the firewall-policy form, always resends all
	// six. A caller that touches just one profile field leaves utm-status exactly as the device
	// already has it: this function cannot see the other five profiles' live values, and guessing
	// from a slice of the policy is how a real profile already in place gets undone.
	if has("av_profile") && has("webfilter_profile") && has("dnsfilter_profile") &&
		has("app_control") && has("ips_sensor") && has("file_filter_profile") {
		anyProfile := inp.AVProfile != "" || inp.WebFilterProfile != "" || inp.DNSFilterProfile != "" ||
			inp.AppControl != "" || inp.IPSSensor != "" || inp.FileFilterProfile != ""
		attrs["utm-status"] = services.FGBoolToString(anyProfile)
	}
	return attrs
}
