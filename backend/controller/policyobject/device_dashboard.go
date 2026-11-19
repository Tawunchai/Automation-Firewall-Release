package policyobject

import (
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"network_automation/services"
)

// System > Dashboard > Status, read live from the device.
//
// Two endpoints, because the widgets refresh at very different rates:
//
//	GET /policy/device/:deviceId/dashboard             the whole snapshot (identity, licences,
//	                                                   fabric, admins, first chart sample)
//	GET /policy/device/:deviceId/dashboard/usage       just the CPU/Memory/Session series, which
//	                                                   the page polls every few seconds
//
// The snapshot fans out to ~8 device calls at once. They share the pooled session (safe for
// concurrent use — see services/fortigate_sessionpool.go) so the whole thing costs about as long as its
// slowest call rather than their sum. Only the identity read is required; every other section
// degrades to null plus an entry in `errors`, so one unlicensed or unsupported feature can never
// blank the page.

const defaultUsageInterval = "1-min"

// dashboardResponse is the payload the dashboard page consumes.
type dashboardResponse struct {
	Device struct {
		ID       uint   `json:"id"`
		Name     string `json:"name"`
		MgmtIP   string `json:"mgmt_ip"`
		Platform string `json:"platform"`
		Vendor   string `json:"vendor"`
		Site     string `json:"site"`
		Status   string `json:"status"`
	} `json:"device"`

	System      services.FGSystemInformation `json:"system"`
	Performance *services.FGPerformance      `json:"performance"`
	Usage       *services.FGResourceUsage    `json:"usage"`
	Sessions    *services.FGSessionSummary   `json:"sessions"`
	Licenses    *services.FGLicenseOverview  `json:"licenses"`
	Fabric      *services.FGFabricStatus     `json:"fabric"`
	Admins      []services.FGAdminSession    `json:"admins"`

	// Errors names the sections that could not be read, keyed by section name.
	Errors map[string]string `json:"errors,omitempty"`

	// FetchedAt is the server's epoch (seconds) when the snapshot was taken — the page uses it
	// to keep the device clock and uptime ticking between refreshes.
	FetchedAt int64 `json:"fetched_at"`
}

// usageInterval reads and validates the ?interval= query parameter.
func usageInterval(c *gin.Context) (string, bool) {
	interval := c.DefaultQuery("interval", defaultUsageInterval)
	if !services.IsValidUsageInterval(interval) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid interval: " + interval})
		return "", false
	}
	return interval, true
}

// GET /policy/device/:deviceId/dashboard?interval=1-min
func DeviceGetDashboard(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	interval, ok := usageInterval(c)
	if !ok {
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	var (
		out    dashboardResponse
		mu     sync.Mutex // guards out.Errors, written from every goroutine
		wg     sync.WaitGroup
		sysErr error
	)
	out.Errors = map[string]string{}
	fail := func(section string, err error) {
		mu.Lock()
		out.Errors[section] = err.Error()
		mu.Unlock()
	}

	out.Device.ID = di.Device.ID
	out.Device.Name = di.Device.Name
	out.Device.MgmtIP = di.Device.MgmtIP
	out.Device.Platform = di.Device.Platform
	out.Device.Vendor = di.Device.Vendor
	out.Device.Site = di.Device.Site
	out.Device.Status = di.Device.Status

	wg.Add(7)

	go func() {
		defer wg.Done()
		info, err := fc.GetSystemInformation()
		if err != nil {
			sysErr = err
			return
		}
		out.System = info
	}()

	go func() {
		defer wg.Done()
		perf, err := fc.GetPerformance()
		if err != nil {
			fail("performance", err)
			return
		}
		out.Performance = &perf
	}()

	go func() {
		defer wg.Done()
		usage, err := fc.GetResourceUsage(interval)
		if err != nil {
			fail("usage", err)
			return
		}
		out.Usage = &usage
	}()

	go func() {
		defer wg.Done()
		sum, err := fc.GetSessionSummary()
		if err != nil {
			fail("sessions", err)
			return
		}
		out.Sessions = &sum
	}()

	go func() {
		defer wg.Done()
		lic, err := fc.GetLicenseOverview()
		if err != nil {
			fail("licenses", err)
			return
		}
		out.Licenses = &lic
	}()

	go func() {
		defer wg.Done()
		admins, err := fc.GetCurrentAdmins()
		if err != nil {
			fail("admins", err)
			return
		}
		out.Admins = admins
	}()

	// Uptime is an SSH probe (FortiOS 7.2 exposes it nowhere in the REST monitor API) and is
	// answered from a cached boot time almost every time — see services/fortigate_ssh.go.
	var uptime int64
	var uptimeOK bool
	go func() {
		defer wg.Done()
		uptime, uptimeOK = services.DeviceUptimeSeconds(
			di.Device.ID, di.Device.MgmtIP, di.Device.Port, di.Username(), di.Password())
	}()

	wg.Wait()

	if sysErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": sysErr.Error()})
		return
	}

	// The fabric view wants the device's own serial to mark which member is "this" FortiGate,
	// so it runs after the identity read rather than alongside it.
	if fabric, err := fc.GetFabricStatus(out.System.Serial); err != nil {
		out.Errors["fabric"] = err.Error()
	} else {
		out.Fabric = &fabric
	}

	if uptimeOK {
		out.System.UptimeSeconds = uptime
	}
	if out.Licenses != nil {
		if out.System.WANIP == "" {
			out.System.WANIP = out.Licenses.FortiGuard.WANIP
		}
		if out.System.VDOMMax == 0 {
			out.System.VDOMUsed, out.System.VDOMMax = out.Licenses.VDOMUsed, out.Licenses.VDOMMax
		}
	}
	if len(out.Errors) == 0 {
		out.Errors = nil
	}
	out.FetchedAt = time.Now().Unix()

	c.JSON(http.StatusOK, out)
}

// usageResponse is the lightweight polling payload behind the charts.
type usageResponse struct {
	Usage       services.FGResourceUsage   `json:"usage"`
	Performance *services.FGPerformance    `json:"performance"`
	Sessions    *services.FGSessionSummary `json:"sessions"`
	FetchedAt   int64                      `json:"fetched_at"`
}

// GET /policy/device/:deviceId/dashboard/usage?interval=1-min
func DeviceGetResourceUsage(c *gin.Context) {
	di, ok := getDeviceInfo(c)
	if !ok {
		return
	}
	interval, ok := usageInterval(c)
	if !ok {
		return
	}
	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	var (
		out      usageResponse
		wg       sync.WaitGroup
		usageErr error
	)
	wg.Add(3)

	go func() {
		defer wg.Done()
		usage, err := fc.GetResourceUsage(interval)
		if err != nil {
			usageErr = err
			return
		}
		out.Usage = usage
	}()
	go func() {
		defer wg.Done()
		if perf, err := fc.GetPerformance(); err == nil {
			out.Performance = &perf
		}
	}()
	go func() {
		defer wg.Done()
		if sum, err := fc.GetSessionSummary(); err == nil {
			out.Sessions = &sum
		}
	}()

	wg.Wait()

	if usageErr != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": usageErr.Error()})
		return
	}
	out.FetchedAt = time.Now().Unix()
	c.JSON(http.StatusOK, out)
}
