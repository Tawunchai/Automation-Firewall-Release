package policyobject

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"network_automation/config"
	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Troubleshoot — the device-proxy side of "why can't A reach B?".
//
// Read-only by construction: every call underneath is a CMDB GET or a monitor GET, so this route is
// safe to hand to a non-admin. It is the one Policy & Objects endpoint that answers a question
// instead of listing a table.

// protocolNumber maps what the form sends ("tcp", "6", "icmp") to an IP protocol number.
var protocolNumber = map[string]int{
	"tcp": 6, "udp": 17, "icmp": 1, "icmpv6": 58, "icmp6": 58, "sctp": 132,
}

// GET /policy/device/:deviceId/policy-trace?src=…&dst=…&protocol=tcp&port=443[&src_intf=lan]
func DeviceTracePolicyPath(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}

	protocol := strings.ToLower(strings.TrimSpace(c.DefaultQuery("protocol", "tcp")))
	proto, known := protocolNumber[protocol]
	if !known {
		// Also accept a raw protocol number, which is the only way to trace GRE/ESP/OSPF.
		n, err := strconv.Atoi(protocol)
		if err != nil || n < 1 || n > 255 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "protocol must be tcp, udp, icmp, sctp or an IP protocol number 1-255"})
			return
		}
		proto = n
	}

	port := 0
	if raw := strings.TrimSpace(c.Query("port")); raw != "" {
		p, err := strconv.Atoi(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "port must be a number"})
			return
		}
		port = p
	}

	// A host name is resolved before anything reaches the device; see trace_resolve.go.
	dst, host, resolved, err := resolveTraceDestination(c.Request.Context(), c.Query("dst"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	result, err := fc.TracePolicyPath(services.FGTraceQuery{
		SrcIP:    strings.TrimSpace(c.Query("src")),
		DstIP:    dst,
		Protocol: proto,
		DstPort:  port,
		SrcIntf:  strings.TrimSpace(c.Query("src_intf")),
	})
	result.ResolvedFrom, result.ResolvedIPs = host, resolved
	if err != nil {
		// A bad tuple is the caller's mistake (400); anything else is the device refusing (502).
		status := http.StatusBadGateway
		if isTraceInputError(err) {
			status = http.StatusBadRequest
		}
		c.JSON(status, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

// GET /policy/device/:deviceId/audit
//
// Runs the whole review pass and returns every finding, worst first. Read-only: it reads the
// policy table, the object tables and the live hit counters, and writes nothing — the CLI that
// would fix each finding is returned as text for the user to run themselves.
func DeviceAudit(c *gin.Context) {
	// Admin only, and it became so when the scan grew a management-plane half.
	//
	// The rule-base checks read policies and objects, which every signed-in user with access to the
	// device may already list. The system checks read the administrator accounts, their profiles
	// and their trusted-host restrictions — a map of exactly who can reach the firewall and from
	// where. The sidebar has always hidden this page from non-admins; until now the ROUTE did not
	// agree with it, which is the same auth-but-not-authz shape this project has been bitten by
	// before (see controller/user/authz.go).
	if !requireAdminPO(c) {
		return
	}
	di, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	// One read: the scan itself.
	//
	// This used to fetch the device's own Security Rating alongside it, to attach as a second
	// opinion — the vendor's checks beside ours, check by check. That went with the Device Rating
	// tab and the corroboration panel when this page was narrowed to ISO/IEC 27001, because both
	// relayed Fortinet's own PCI and FSBP control ids and there is no longer a page for them to
	// land on.
	report, err := fc.RunAudit()
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	now := time.Now().UTC()

	// Two layers are folded in after the scan, in this order, and both are deliberately outside
	// RunAudit so the engine stays a pure function of the firewall's configuration.
	//
	//  1. What THIS CONSOLE has recorded about the device — when it was last reviewed, whether a
	//     configuration baseline exists, whether anything changed it off the record. That is the
	//     evidence for the review-cadence and change-control controls, and it lives in Postgres
	//     rather than on the firewall (services/audit_governance.go).
	//  2. Sign-offs. An accepted finding is marked, not removed (services/audit_exceptions.go).
	//
	// Governance first, so a finding it raises can itself be accepted.
	services.ApplyAuditRecords(config.DB(), di.Device.ID, &report, now)

	// One trend point, stored only if this scan actually differs from the last. Failure here is
	// deliberately silent: the history is a nicety, the scan the user asked for is not.
	uid, _ := c.Get("user_id")
	userID, _ := uid.(uint)
	services.RecordAuditRun(config.DB(), di.Device.ID, userID, c.GetString("user_email"),
		report.DeviceSerial, report.DeviceFirmware, report)

	c.JSON(http.StatusOK, report)
}

// isTraceInputError separates "you typed a bad IP" from "the firewall would not answer", so the
// form can show a field error instead of a device-unreachable banner.
func isTraceInputError(err error) bool {
	msg := err.Error()
	for _, s := range []string{"not a valid", "must be"} {
		if strings.Contains(msg, s) {
			return true
		}
	}
	return false
}
