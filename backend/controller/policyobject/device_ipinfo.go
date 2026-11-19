package policyobject

import (
	"context"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"network_automation/config"
	"network_automation/entity"
	"network_automation/services"
	"network_automation/services/platform"
)

// GET /policy/device/:deviceId/ip-info?ip=<addr>
//
// Trace Route hop detail, computed LOCALLY — no third-party geolocation API, nothing about the hop
// is sent off this box. For one hop address it returns:
//
//   - rdns        reverse DNS (PTR), best-effort
//   - kind/label  what kind of address it is (public / private / CGNAT / loopback / …)
//   - internal    any role it plays on networks this console already knows — an interface of the
//     selected device, a subnet that device routes, or the management IP of a device in
//     the fleet. This is the half a public geolocation service can never tell you,
//     because these are YOUR networks.
//
// Read-only. The rDNS is a PTR lookup from this server; the internal cross-reference is two CMDB
// reads (system interfaces + static routes) that each degrade to "nothing matched" if the device
// will not answer, so the panel still shows rDNS + kind.
func DeviceLookupIPInfo(c *gin.Context) {
	di, fc, ok := deviceSession(c)
	if !ok {
		return
	}

	raw := strings.TrimSpace(c.Query("ip"))
	ip := net.ParseIP(raw)
	if ip == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "a valid ip query parameter is required"})
		return
	}

	class := services.ClassifyIP(ip)
	out := gin.H{"ip": raw, "kind": class.Kind, "kind_label": class.Label}

	// Geolocation + ASN for a PUBLIC hop, from the local GeoLite2 database (offline, no third-party
	// call). Private/CGNAT/loopback hops have no meaningful geolocation, so they are not looked up.
	// Absent databases simply leave this out — the rest of the detail is unaffected.
	if class.Kind == "public" {
		if g := platform.LookupGeo(ip); g != nil {
			out["geo"] = g
		}
	}

	// Reverse DNS — bounded, best-effort. A hop with no PTR record is normal, not an error.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if names, err := net.DefaultResolver.LookupAddr(ctx, raw); err == nil && len(names) > 0 {
		out["rdns"] = strings.TrimSuffix(names[0], ".")
	}

	internal := []string{}

	// A device in the fleet, matched by its management IP.
	var devs []entity.NetworkDevice
	if err := config.DB().Find(&devs).Error; err == nil {
		for _, d := range devs {
			if strings.TrimSpace(d.MgmtIP) != raw {
				continue
			}
			if d.ID == di.Device.ID {
				internal = append(internal, "Management IP of this device ("+d.Name+")")
			} else {
				internal = append(internal, "Management IP of "+d.Name+" — another device in the fleet")
			}
		}
	}

	// An interface of the selected device — its own IP, or the subnet it sits on.
	if ifaces, err := fc.GetSystemInterfaces(); err == nil {
		for _, itf := range ifaces {
			if itf.IP == "" {
				continue
			}
			ifIP, ifNet, perr := net.ParseCIDR(itf.IP)
			if perr != nil {
				continue
			}
			name := itf.Name
			if itf.Alias != "" {
				name = itf.Name + " (" + itf.Alias + ")"
			}
			switch {
			case ifIP.Equal(ip):
				if itf.Role == "" || itf.Role == "undefined" {
					internal = append(internal, "Interface "+name+" on "+di.Device.Name)
				} else {
					internal = append(internal, "Interface "+name+" ["+itf.Role+"] on "+di.Device.Name)
				}
			case ifNet.Contains(ip):
				internal = append(internal, "On the "+name+" subnet ("+itf.IP+")")
			}
		}
	}

	// A subnet the selected device static-routes.
	if routes, err := fc.GetStaticRoutes(); err == nil {
		for _, r := range routes {
			if (r.DstType != "" && r.DstType != "subnet") || r.Dst == "" {
				continue
			}
			_, rNet, perr := net.ParseCIDR(r.Dst)
			if perr != nil {
				continue
			}
			if !rNet.Contains(ip) {
				continue
			}
			via := r.Gateway
			if r.Device != "" {
				via += " (" + r.Device + ")"
			}
			internal = append(internal, "Matches static route #"+strconv.Itoa(r.SeqNum)+" → via "+via)
		}
	}

	out["internal"] = internal
	c.JSON(http.StatusOK, out)
}
