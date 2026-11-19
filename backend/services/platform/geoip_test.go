package platform

import (
	"net"
	"os"
	"testing"
)

// With no GeoLite2 database configured, geo lookups must degrade silently to "no data" rather than
// erroring — that is what lets the Trace Route hop detail fall back to rDNS + kind + internal-role.
func TestLookupGeoDisabledWithoutDB(t *testing.T) {
	os.Unsetenv("GEOIP_CITY_DB")
	os.Unsetenv("GEOIP_ASN_DB")

	if GeoIPEnabled() {
		t.Skip("a GeoLite2 database is configured in this environment; skipping the disabled-path test")
	}
	if g := LookupGeo(net.ParseIP("8.8.8.8")); g != nil {
		t.Errorf("LookupGeo with no database = %+v, want nil", g)
	}
}
