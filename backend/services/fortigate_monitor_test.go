package services

import (
	"encoding/json"
	"testing"
)

// The payloads below are trimmed copies of what the lab FortiGate 80E (FortiOS 7.2.10) actually
// answers, so these tests pin the mapping to the device rather than to the docs.

// ── monitor/system/resource/usage ────────────────────────────────────────────

// Captured from GET /api/v2/monitor/system/resource/usage?scope=global&interval=1-min.
// Two points per series, deliberately newest-first exactly as the device sends them, and one
// aggregate CPU entry followed by two cores.
const usagePayload = `{
  "cpu": [
    {"current": 3, "historical": {"1-min": {"values": [[1785396150000, 3], [1785396147000, 1]],
      "max": 3, "min": 1, "average": 2, "start": 1785396147000, "end": 1785396150000}}},
    {"current": 5, "historical": {"1-min": {"values": [[1785396150000, 5], [1785396147000, 0]],
      "max": 5, "min": 0, "average": 2}}},
    {"current": 1, "historical": {"1-min": {"values": [[1785396150000, 1], [1785396147000, 0]],
      "max": 1, "min": 0, "average": 0}}}
  ],
  "mem":            [{"current": 41, "historical": {"1-min": {"values": [[1785396150000, 41], [1785396147000, 40]], "max": 41, "min": 40, "average": 40}}}],
  "disk":           [{"current": 0,  "historical": {"1-min": {"values": [[1785396150000, 0]]}}}],
  "session":        [{"current": 13, "historical": {"1-min": {"values": [[1785396150000, 13], [1785396147000, 11]], "max": 13, "min": 11, "average": 12}}}],
  "setuprate":      [{"current": 2,  "historical": {"1-min": {"values": [[1785396150000, 2]]}}}],
  "npu_session":    [{"current": 0,  "historical": {"1-min": {"values": [[1785396150000, 0]]}}}],
  "nturbo_session": [{"current": 0,  "historical": {"1-min": {"values": [[1785396150000, 0]]}}}],
  "session6":       [{"current": 0,  "historical": {"1-min": {"values": [[1785396150000, 0]]}}}]
}`

func parseUsage(t *testing.T, interval string) FGResourceUsage {
	t.Helper()
	u, err := ParseResourceUsage(json.RawMessage(usagePayload), interval)
	if err != nil {
		t.Fatalf("ParseResourceUsage: %v", err)
	}
	return u
}

// The device returns the aggregate CPU as element 0 and one element per core after it. Getting
// this backwards would draw a single core as "the" CPU line.
func TestParseResourceUsage_CPUAggregateIsFirstEntry(t *testing.T) {
	u := parseUsage(t, "1-min")

	if u.CPU.Current != 3 {
		t.Errorf("aggregate CPU current = %v, want 3 (element 0 of the cpu array)", u.CPU.Current)
	}
	if len(u.CPUCores) != 2 {
		t.Fatalf("core count = %d, want 2 (all cpu entries after the aggregate)", len(u.CPUCores))
	}
	if u.CPUCores[0].Current != 5 || u.CPUCores[1].Current != 1 {
		t.Errorf("core currents = %v/%v, want 5/1", u.CPUCores[0].Current, u.CPUCores[1].Current)
	}
}

// FortiOS sends history newest-first; a chart drawn in that order runs backwards in time.
func TestParseResourceUsage_PointsAreOldestFirst(t *testing.T) {
	u := parseUsage(t, "1-min")

	if len(u.CPU.Points) != 2 {
		t.Fatalf("point count = %d, want 2", len(u.CPU.Points))
	}
	if u.CPU.Points[0].T >= u.CPU.Points[1].T {
		t.Errorf("points not re-ordered oldest-first: %d then %d", u.CPU.Points[0].T, u.CPU.Points[1].T)
	}
	if u.CPU.Points[0].V != 1 || u.CPU.Points[1].V != 3 {
		t.Errorf("values follow the wrong timestamps: %v", u.CPU.Points)
	}
}

func TestParseResourceUsage_ScalarMetrics(t *testing.T) {
	u := parseUsage(t, "1-min")

	cases := []struct {
		name string
		got  FGUsageSeries
		want float64
	}{
		{"memory", u.Memory, 41},
		{"sessions", u.Sessions, 13},
		{"setup rate", u.SetupRate, 2},
		{"npu sessions", u.NPUSessions, 0},
		{"nturbo sessions", u.NTurboSessions, 0},
	}
	for _, c := range cases {
		if c.got.Current != c.want {
			t.Errorf("%s current = %v, want %v", c.name, c.got.Current, c.want)
		}
	}
	if u.Sessions.Max != 13 || u.Sessions.Min != 11 || u.Sessions.Average != 12 {
		t.Errorf("session min/max/avg = %v/%v/%v, want 11/13/12", u.Sessions.Min, u.Sessions.Max, u.Sessions.Average)
	}
	if u.Interval != "1-min" {
		t.Errorf("interval = %q, want 1-min", u.Interval)
	}
}

// Asking for a window the payload has no history for must still yield the current value —
// the number stays honest even when the chart has nothing to draw.
func TestParseResourceUsage_MissingIntervalKeepsCurrent(t *testing.T) {
	u := parseUsage(t, "24-hour")

	if u.CPU.Current != 3 {
		t.Errorf("current lost when interval is absent: %v", u.CPU.Current)
	}
	if len(u.CPU.Points) != 0 {
		t.Errorf("points invented for an absent interval: %v", u.CPU.Points)
	}
}

func TestIsValidUsageInterval(t *testing.T) {
	for _, ok := range FGUsageIntervals {
		if !IsValidUsageInterval(ok) {
			t.Errorf("%q should be a valid interval", ok)
		}
	}
	for _, bad := range []string{"", "1min", "5-min", "1-MIN", "'; drop"} {
		if IsValidUsageInterval(bad) {
			t.Errorf("%q must be rejected before it reaches the device", bad)
		}
	}
}

// ── monitor/license/status ───────────────────────────────────────────────────

// Captured from GET /api/v2/monitor/license/status on the lab device: registered with FortiCare
// but every FortiGuard subscription lapsed, FortiCloud logged in on the free tier.
const licensePayload = `{
  "fortiguard": {"type": "cloud_service_status", "supported": true, "connected": true,
    "connection_issue": false, "last_connection_success": 1785394151,
    "next_scheduled_update": 1785397740, "server_address": "173.243.140.6:443",
    "fortigate_wan_ip": "171.97.97.81"},
  "forticare": {"type": "cloud_service_status", "status": "registered",
    "registration_status": "registered", "account": "its@got.co.th",
    "support": {}, "company": "Get On Technology"},
  "forticloud": {"type": "cloud_service_status", "status": "cloud_logged_in",
    "account": "its@got.co.th", "domain": "GLOBAL", "multitenancy": false},
  "security_rating": {"type": "downloaded_fds_object", "status": "no_license",
    "version": "0.00000", "entitlement": "FGSA", "last_update": 978336000},
  "antivirus": {"type": "downloaded_fds_object", "status": "expired", "version": "1.00000",
    "expires": 1681257600, "entitlement": "AVDB", "last_update": 1715226137},
  "ips": {"type": "downloaded_fds_object", "status": "expired", "version": "6.00741",
    "expires": 1681257600, "entitlement": "NIDS"},
  "web_filtering": {"type": "live_fortiguard_service", "status": "expired",
    "expires": 1681257600, "entitlement": "FURL", "category_list_version": 10, "running": true},
  "internet_service_db": {"type": "downloaded_fds_object", "status": "licensed", "version": "0.00000"},
  "forticloud_logging": {"type": "live_cloud_service", "status": "free_license",
    "used_bytes": 0, "max_bytes": 524288000000000, "log_retention_days": 7},
  "vdom": {"type": "platform", "can_upgrade": false, "used": 1, "max": 10}
}`

func parseLicenses(t *testing.T, payload string) FGLicenseOverview {
	t.Helper()
	o, err := parseLicenseStatus(json.RawMessage(payload))
	if err != nil {
		t.Fatalf("parseLicenseStatus: %v", err)
	}
	return o
}

func rowByKey(t *testing.T, rows []FGLicenseRow, key string) FGLicenseRow {
	t.Helper()
	for _, r := range rows {
		if r.Key == key {
			return r
		}
	}
	t.Fatalf("no licence row %q in %+v", key, rows)
	return FGLicenseRow{}
}

// The Licenses widget's own rows, in the device's order.
func TestParseLicenseStatus_PrimaryRows(t *testing.T) {
	o := parseLicenses(t, licensePayload)

	want := []struct{ key, status string }{
		{"forticare_support", LicenseRegistered},
		{"firmware_updates", LicenseExpired},
		{"antivirus", LicenseExpired},
		{"web_filtering", LicenseExpired},
		{"security_rating", LicenseNone},
	}
	if len(o.Primary) != len(want) {
		t.Fatalf("primary row count = %d, want %d (%+v)", len(o.Primary), len(want), o.Primary)
	}
	for i, w := range want {
		if o.Primary[i].Key != w.key {
			t.Errorf("primary[%d] = %q, want %q", i, o.Primary[i].Key, w.key)
			continue
		}
		if o.Primary[i].Status != w.status {
			t.Errorf("%s status = %q, want %q", w.key, o.Primary[i].Status, w.status)
		}
	}
}

// A registered device with an empty support block has no contract left to pull firmware with —
// which is what the device's own widget flags. An unregistered one has no licence at all, and
// calling that "expired" would invent a subscription that never existed.
func TestParseLicenseStatus_FirmwareUpdatesFollowsSupportContract(t *testing.T) {
	o := parseLicenses(t, licensePayload)
	if got := rowByKey(t, o.Primary, "firmware_updates").Status; got != LicenseExpired {
		t.Errorf("registered + empty support: status = %q, want %q", got, LicenseExpired)
	}

	licensed := `{"forticare": {"status": "registered", "support":
		{"enhanced": {"status": "licensed", "expires": 1900000000}}}}`
	row := rowByKey(t, parseLicenses(t, licensed).Primary, "firmware_updates")
	if row.Status != LicenseLicensed {
		t.Errorf("valid support contract: status = %q, want %q", row.Status, LicenseLicensed)
	}
	if row.Expires != 1900000000 {
		t.Errorf("expiry not carried over: %d", row.Expires)
	}

	unregistered := `{"forticare": {"status": "not_registered", "support": {}}}`
	if got := rowByKey(t, parseLicenses(t, unregistered).Primary, "firmware_updates").Status; got != LicenseNone {
		t.Errorf("unregistered device: status = %q, want %q", got, LicenseNone)
	}
}

func TestParseLicenseStatus_SecondaryRows(t *testing.T) {
	o := parseLicenses(t, licensePayload)

	if got := rowByKey(t, o.Secondary, "ips").Status; got != LicenseExpired {
		t.Errorf("ips status = %q, want %q", got, LicenseExpired)
	}
	if got := rowByKey(t, o.Secondary, "internet_service_db").Status; got != LicenseLicensed {
		t.Errorf("internet_service_db status = %q, want %q", got, LicenseLicensed)
	}
	// Entitlements the device did not report must not appear as rows at all.
	for _, r := range o.Secondary {
		if r.Key == "antispam" || r.Key == "iot_detection" {
			t.Errorf("row %q invented for an entitlement the device never sent", r.Key)
		}
	}
}

func TestParseLicenseStatus_CloudAndFortiGuard(t *testing.T) {
	o := parseLicenses(t, licensePayload)

	if !o.FortiCloud.Activated || o.FortiCloud.Domain != "GLOBAL" {
		t.Errorf("forticloud = %+v, want activated in GLOBAL", o.FortiCloud)
	}
	if o.FortiCloud.LoggingStatus != LicenseFree || o.FortiCloud.LogRetentionDays != 7 {
		t.Errorf("forticloud logging = %q/%d days, want %q/7",
			o.FortiCloud.LoggingStatus, o.FortiCloud.LogRetentionDays, LicenseFree)
	}
	if o.FortiCloud.UsedBytes != 0 || o.FortiCloud.MaxBytes != 524288000000000 {
		t.Errorf("forticloud storage = %d/%d", o.FortiCloud.UsedBytes, o.FortiCloud.MaxBytes)
	}
	// The WAN IP shown on the System Information widget comes from FortiGuard's view of the device.
	if o.FortiGuard.WANIP != "171.97.97.81" || !o.FortiGuard.Connected {
		t.Errorf("fortiguard = %+v, want connected with the WAN IP", o.FortiGuard)
	}
	if o.FortiCare.Company != "Get On Technology" || o.FortiCare.Status != LicenseRegistered {
		t.Errorf("forticare = %+v", o.FortiCare)
	}
	if o.VDOMUsed != 1 || o.VDOMMax != 10 {
		t.Errorf("vdom = %d/%d, want 1/10", o.VDOMUsed, o.VDOMMax)
	}
}

// A device that answers with nothing at all must still produce the two rows the widget always
// shows, rather than an empty panel.
func TestParseLicenseStatus_EmptyPayload(t *testing.T) {
	o := parseLicenses(t, `{}`)

	if len(o.Primary) != 2 {
		t.Fatalf("primary rows = %+v, want the FortiCare + firmware rows", o.Primary)
	}
	if o.FortiCare.Status != LicenseUnknown {
		t.Errorf("forticare status = %q, want %q", o.FortiCare.Status, LicenseUnknown)
	}
	if o.FortiCloud.Activated {
		t.Error("FortiGate Cloud reported as activated on an empty payload")
	}
}

func TestNormaliseLicenseStatus(t *testing.T) {
	cases := map[string]string{
		"licensed": LicenseLicensed, "valid": LicenseLicensed,
		"expired": LicenseExpired, "no_license": LicenseNone, "not_licensed": LicenseNone,
		"free_license": LicenseFree, "registered": LicenseRegistered,
		"cloud_logged_in": LicenseRegistered, "": LicenseUnknown,
	}
	for in, want := range cases {
		if got := normaliseLicenseStatus(in); got != want {
			t.Errorf("normaliseLicenseStatus(%q) = %q, want %q", in, got, want)
		}
	}
}

// ── Timezone ─────────────────────────────────────────────────────────────────

// The device clock is a UTC epoch, so the whole System Time display hangs on this offset being
// parsed from the DST-adjusted "current_utc_offset" the device reports.
func TestParseGMTOffset(t *testing.T) {
	cases := []struct {
		in   string
		want int
		ok   bool
	}{
		{"GMT-7:00", -7 * 3600, true},
		{"GMT+7:00", 7 * 3600, true},
		{"GMT-8:00", -8 * 3600, true},
		{"GMT+5:30", 5*3600 + 30*60, true},
		{"GMT-3:30", -(3*3600 + 30*60), true},
		{"GMT", 0, true},
		{"GMT+0:00", 0, true},
		{"", 0, false},
		{"UTC+7", 0, false},
		{"GMT7:00", 0, false},
	}
	for _, c := range cases {
		got, ok := parseGMTOffset(c.in)
		if ok != c.ok || got != c.want {
			t.Errorf("parseGMTOffset(%q) = %d,%v — want %d,%v", c.in, got, ok, c.want, c.ok)
		}
	}
}

func TestFirmwareMaturity(t *testing.T) {
	cases := map[string]string{"M": "Mature", "m": "Mature", "F": "Feature", "": "", "X": "X"}
	for in, want := range cases {
		if got := firmwareMaturity(in); got != want {
			t.Errorf("firmwareMaturity(%q) = %q, want %q", in, got, want)
		}
	}
}
