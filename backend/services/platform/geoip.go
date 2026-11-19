package platform

import (
	"net"
	"os"
	"sync"

	geoip2 "github.com/oschwald/geoip2-golang"
)

// GeoInfo is the optional geolocation + network ownership of a PUBLIC Trace Route hop, read from a
// local MaxMind GeoLite2 database.
//
// Entirely offline: the .mmdb files sit on disk and are memory-mapped; no third-party API is ever
// called, so a hop address never leaves this box — the same privacy posture as the rest of the
// Diagnostics section. When the databases are not configured or not installed, every lookup returns
// nil and the hop detail falls back to rDNS + address-kind + internal-role (option A). Nothing here
// is required for the feature to work; it only enriches it.
type GeoInfo struct {
	Country     string  `json:"country,omitempty"`
	CountryCode string  `json:"country_code,omitempty"`
	City        string  `json:"city,omitempty"`
	Lat         float64 `json:"lat,omitempty"`
	Lon         float64 `json:"lon,omitempty"`
	ASN         uint    `json:"asn,omitempty"`
	Org         string  `json:"org,omitempty"`
}

var (
	geoOnce   sync.Once
	geoCityDB *geoip2.Reader
	geoASNDB  *geoip2.Reader
)

// initGeoIP opens the databases once, from GEOIP_CITY_DB / GEOIP_ASN_DB. A missing or unreadable
// file leaves that reader nil, which is not an error — the feature simply has less to show.
func initGeoIP() {
	geoOnce.Do(func() {
		if p := os.Getenv("GEOIP_CITY_DB"); p != "" {
			if r, err := geoip2.Open(p); err == nil {
				geoCityDB = r
			}
		}
		if p := os.Getenv("GEOIP_ASN_DB"); p != "" {
			if r, err := geoip2.Open(p); err == nil {
				geoASNDB = r
			}
		}
	})
}

// GeoIPEnabled reports whether at least one GeoLite2 database loaded — so the API can tell a caller
// "this build has geolocation" without doing a lookup.
func GeoIPEnabled() bool {
	initGeoIP()
	return geoCityDB != nil || geoASNDB != nil
}

// LookupGeo returns the geolocation + ASN of an address, or nil when no database is loaded or the
// address is absent from it. The MaxMind reader is safe for concurrent use. Ask only for public
// addresses: a private, CGNAT or loopback hop has no meaningful geolocation.
func LookupGeo(ip net.IP) *GeoInfo {
	initGeoIP()
	if geoCityDB == nil && geoASNDB == nil {
		return nil
	}
	g := &GeoInfo{}
	if geoCityDB != nil {
		if rec, err := geoCityDB.City(ip); err == nil {
			g.CountryCode = rec.Country.IsoCode
			g.Country = rec.Country.Names["en"]
			g.City = rec.City.Names["en"]
			g.Lat = rec.Location.Latitude
			g.Lon = rec.Location.Longitude
		}
	}
	if geoASNDB != nil {
		if rec, err := geoASNDB.ASN(ip); err == nil {
			g.ASN = rec.AutonomousSystemNumber
			g.Org = rec.AutonomousSystemOrganization
		}
	}
	if g.Country == "" && g.City == "" && g.ASN == 0 && g.Org == "" {
		return nil
	}
	return g
}
