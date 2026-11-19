package policyobject

import (
	"encoding/json"
	"net/http"
	"testing"

	"network_automation/services"
)

// System ▸ Dashboard ▸ Status, read live from the device.
//
// The rule this whole handler is shaped around: **only the identity read is required.** Every
// other section — performance, usage, sessions, licences, fabric, admins — degrades to null plus
// a named entry in `errors`, because this lab FortiGate has expired licences and features that
// are simply not there, and one unsupported read must never blank the page
// (see the lab-device note in services/fortigate_monitor.go).
//
// That is invisible from a status code: a dashboard that answered 200 with six empty sections
// looks exactly like a dashboard that answered 200 with six working ones. These tests read the
// body.

// licenceWith builds the one licence shape these tests care about. FGLicenseOverview's FortiGuard
// and VDOM fields are anonymous structs, so they cannot be named in a literal from here.
func licenceWith(wanIP string, used, max int) services.FGLicenseOverview {
	var lic services.FGLicenseOverview
	lic.FortiGuard.WANIP = wanIP
	lic.VDOMUsed, lic.VDOMMax = used, max
	return lic
}

// dashboardBody decodes what the handler wrote, so an assertion names a real section.
func dashboardBody(t *testing.T, raw []byte) dashboardResponse {
	t.Helper()
	var out dashboardResponse
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("the dashboard body is not JSON: %v\n%s", err, raw)
	}
	return out
}

func TestDashboardServesEverySectionWhenTheDeviceAnswers(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		sysInfo:  services.FGSystemInformation{Serial: "FGT80E-TEST", Hostname: "lab-80e"},
		perf:     services.FGPerformance{CPUIdle: 88, CPUCores: 2},
		resUsage: services.FGResourceUsage{},
		sessions: services.FGSessionSummary{SessionCount: 42},
		licenses: licenceWith("", 1, 10),
		admins:   []services.FGAdminSession{{ID: 1, Admin: "admin", Method: "https"}},
	}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "dashboard", device.ID, testAdminUserID, "admin")
	DeviceGetDashboard(c)
	coverWantStatus(t, rec, http.StatusOK)

	out := dashboardBody(t, rec.Body.Bytes())
	if out.Errors != nil {
		t.Fatalf("a device that answered everything still reported errors: %v", out.Errors)
	}
	if out.System.Serial != "FGT80E-TEST" {
		t.Errorf("the identity read did not reach the page: %+v", out.System)
	}
	for name, got := range map[string]bool{
		"performance": out.Performance == nil,
		"usage":       out.Usage == nil,
		"sessions":    out.Sessions == nil,
		"licenses":    out.Licenses == nil,
	} {
		if got {
			t.Errorf("%s came back null although the device answered it", name)
		}
	}
	// The device row itself is the page's header, and it comes from the database rather than the
	// firewall — so it is filled in even on a device that answers nothing.
	if out.Device.ID != device.ID || out.Device.MgmtIP != device.MgmtIP {
		t.Errorf("the device header is not this device: %+v", out.Device)
	}
	if out.FetchedAt == 0 {
		t.Error("fetched_at was not set — the page cannot tick the clock between refreshes")
	}
}

// The licence read fills two gaps the identity read leaves on this hardware: the WAN IP and the
// VDOM counts. If that stopped happening the page would show an empty WAN IP on a device that
// does know it.
func TestDashboardFillsTheIdentityGapsFromTheLicenceRead(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		sysInfo:  services.FGSystemInformation{Serial: "FGT80E-TEST"},
		licenses: licenceWith("203.0.113.9", 2, 10),
	}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "dashboard", device.ID, testAdminUserID, "admin")
	DeviceGetDashboard(c)
	coverWantStatus(t, rec, http.StatusOK)

	out := dashboardBody(t, rec.Body.Bytes())
	if out.System.WANIP != "203.0.113.9" {
		t.Errorf("WAN IP = %q, want it taken from the licence read", out.System.WANIP)
	}
	if out.System.VDOMMax != 10 || out.System.VDOMUsed != 2 {
		t.Errorf("VDOM counts = %d/%d, want them taken from the licence read",
			out.System.VDOMUsed, out.System.VDOMMax)
	}
}

// THE behaviour: six failing sections, and the page still renders.
func TestDashboardDegradesSectionBySectionRatherThanGoingBlank(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{
		sysInfo:     services.FGSystemInformation{Serial: "FGT80E-TEST"},
		perfErr:     errTransport{},
		resUsageErr: errTransport{},
		sessionsErr: errTransport{},
		licensesErr: errTransport{},
		adminsErr:   errTransport{},
		fabricErr:   errTransport{},
	}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "dashboard", device.ID, testAdminUserID, "admin")
	DeviceGetDashboard(c)
	coverWantStatus(t, rec, http.StatusOK)

	out := dashboardBody(t, rec.Body.Bytes())
	if out.System.Serial != "FGT80E-TEST" {
		t.Fatal("the identity section was lost although it was the one that worked")
	}
	for _, section := range []string{"performance", "usage", "sessions", "licenses", "admins", "fabric"} {
		if _, named := out.Errors[section]; !named {
			t.Errorf("%q failed but is not named in errors — the page shows an empty widget with "+
				"no explanation: %v", section, out.Errors)
		}
	}
	if out.Performance != nil || out.Usage != nil || out.Sessions != nil || out.Licenses != nil || out.Fabric != nil {
		t.Error("a section that failed came back as a value rather than null")
	}
}

// The identity read is the one that is NOT optional: without it there is no device to describe,
// and a 200 with an empty header would be a lie.
func TestDashboardRefusesWhenTheIdentityReadFails(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{sysInfoErr: errTransport{}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "dashboard", device.ID, testAdminUserID, "admin")
	DeviceGetDashboard(c)
	coverWantStatus(t, rec, http.StatusBadGateway)
}

// ── the polling endpoint ────────────────────────────────────────────────────

// The charts poll this every few seconds, so it reads three things rather than eight. Usage is
// the required one — it IS the chart.
func TestResourceUsagePollServesTheChartAndDegradesTheRest(t *testing.T) {
	device := handlerTestDevice(t)

	t.Run("all three answered", func(t *testing.T) {
		stub := &coverStub{sessions: services.FGSessionSummary{SessionCount: 7}}
		withDeviceClient(t, stub, nil)
		c, rec := deviceRequest(t, http.MethodGet, "dashboard/usage", device.ID, testAdminUserID, "admin")
		DeviceGetResourceUsage(c)
		coverWantStatus(t, rec, http.StatusOK)
	})

	t.Run("the chart's own read failing is a 502", func(t *testing.T) {
		stub := &coverStub{resUsageErr: errTransport{}}
		withDeviceClient(t, stub, nil)
		c, rec := deviceRequest(t, http.MethodGet, "dashboard/usage", device.ID, testAdminUserID, "admin")
		DeviceGetResourceUsage(c)
		coverWantStatus(t, rec, http.StatusBadGateway)
	})

	t.Run("the two optional reads failing is still a chart", func(t *testing.T) {
		stub := &coverStub{perfErr: errTransport{}, sessionsErr: errTransport{}}
		withDeviceClient(t, stub, nil)
		c, rec := deviceRequest(t, http.MethodGet, "dashboard/usage", device.ID, testAdminUserID, "admin")
		DeviceGetResourceUsage(c)
		coverWantStatus(t, rec, http.StatusOK)
	})
}

// An interval the device has no series for is the caller's mistake, and is refused before a
// session is opened rather than passed through for FortiOS to reject.
func TestDashboardRefusesAnIntervalTheDeviceDoesNotKeep(t *testing.T) {
	device := handlerTestDevice(t)
	stub := &coverStub{sysInfo: services.FGSystemInformation{Serial: "x"}}
	withDeviceClient(t, stub, nil)

	c, rec := deviceRequest(t, http.MethodGet, "dashboard?interval=1-fortnight", device.ID, testAdminUserID, "admin")
	DeviceGetDashboard(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	c, rec = deviceRequest(t, http.MethodGet, "dashboard/usage?interval=1-fortnight", device.ID, testAdminUserID, "admin")
	DeviceGetResourceUsage(c)
	coverWantStatus(t, rec, http.StatusBadRequest)

	coverUntouched(t, stub)

	// …and the default is a real interval, so a page that asks for nothing still gets a series.
	c, _ = deviceRequest(t, http.MethodGet, "dashboard/usage", device.ID, testAdminUserID, "admin")
	got, ok := usageInterval(c)
	if !ok || got != defaultUsageInterval {
		t.Fatalf("the default interval is %q (ok=%v), want %q", got, ok, defaultUsageInterval)
	}
}
