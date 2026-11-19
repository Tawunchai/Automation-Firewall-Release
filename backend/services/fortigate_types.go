package services

import (
	"strings"
)

// The shapes this console and a FortiGate agree on.
//
// A policy, an address, a service and a schedule reference, as the device sends and accepts them —
// plus the two write-side shapes a service needs, because FortiOS will not take back what it just
// gave you (see toServiceWrite).
//
// Client-generic on purpose: these are the types every fortigate_<domain>.go file builds on, so
// they live beside the client rather than in any one domain. Split out of fortigate.go, which held
// the client, the types and the conversions together.

type FGName struct {
	Name string `json:"name"`
}

// FGPolicy mirrors the FortiGate firewall/policy object.
type FGPolicy struct {
	PolicyID   int      `json:"policyid,omitempty"`
	Name       string   `json:"name"`
	SrcIntf    []FGName `json:"srcintf"`
	DstIntf    []FGName `json:"dstintf"`
	SrcAddr    []FGName `json:"srcaddr"`
	DstAddr    []FGName `json:"dstaddr"`
	Service    []FGName `json:"service"`
	Schedule   string   `json:"schedule"`
	Action     string   `json:"action"`     // accept | deny
	NAT        string   `json:"nat"`        // enable | disable
	LogTraffic string   `json:"logtraffic"` // all | utm | disable
	Status     string   `json:"status"`     // enable | disable
	Comments   string   `json:"comments,omitempty"`

	// NAT / IP pool
	IPPool    string   `json:"ippool,omitempty"` // enable | disable
	PoolName  []FGName `json:"poolname,omitempty"`
	FixedPort string   `json:"fixedport,omitempty"` // enable | disable

	// Protocol options
	ProfileProtocolOptions string `json:"profile-protocol-options,omitempty"`

	// Security profiles
	UTMStatus         string `json:"utm-status,omitempty"` // enable | disable
	AVProfile         string `json:"av-profile,omitempty"`
	WebFilterProfile  string `json:"webfilter-profile,omitempty"`
	DNSFilterProfile  string `json:"dnsfilter-profile,omitempty"`
	AppList           string `json:"application-list,omitempty"`
	IPSSensor         string `json:"ips-sensor,omitempty"`
	FileFilterProfile string `json:"file-filter-profile,omitempty"`
	SSLSSHProfile     string `json:"ssl-ssh-profile,omitempty"`

	// DecryptedTrafficMirror mirrors decrypted (deep-inspected) traffic to a
	// firewall.decrypted-traffic-mirror object — only meaningful alongside a real
	// deep-inspection SSL/SSH profile (confirmed via the live CMDB schema: field
	// "decrypted-traffic-mirror", datasource "firewall.decrypted-traffic-mirror.name").
	DecryptedTrafficMirror string `json:"decrypted-traffic-mirror,omitempty"`
}

// FGSchedule mirrors a FortiGate firewall.schedule/{onetime,recurring,group} entry.
type FGSchedule struct {
	Name string `json:"name"`
	Type string `json:"type"` // onetime | recurring | group
}

// FGMACAddr is a single MAC address entry used in FortiGate address objects of type "mac".
type FGMACAddr struct {
	MAC string `json:"macaddr"`
}

// FGAddress mirrors FortiGate firewall/address.
type FGAddress struct {
	Name      string      `json:"name"`
	Type      string      `json:"type"`             // ipmask | iprange | fqdn | geography | wildcard | dynamic | interface-subnet | mac
	Subnet    string      `json:"subnet,omitempty"` // "10.10.10.0 255.255.255.0"
	StartIP   string      `json:"start-ip,omitempty"`
	EndIP     string      `json:"end-ip,omitempty"`
	FQDN      string      `json:"fqdn,omitempty"` // also holds wildcard FQDN ("*.example.com") — FortiOS keeps those as type "fqdn"
	Interface string      `json:"associated-interface,omitempty"`
	Comment   string      `json:"comment,omitempty"`
	Color     int         `json:"color,omitempty"`   // FortiGate color index 0-32
	Country   string      `json:"country,omitempty"` // ISO 3166-1 alpha-2 code (geography type)
	MACAddrs  []FGMACAddr `json:"macaddr,omitempty"` // MAC address list (mac type)

	// Static route configuration toggle — "enable"/"disable" (ipmask & fqdn types in the GUI).
	AllowRouting string `json:"allow-routing,omitempty"`

	// Dynamic (Fabric Connector) address fields.
	SubType     string `json:"sub-type,omitempty"`      // sdn | clearpass-spt | fsso | ems-tag | ... ; GUI "Fabric Connector Address" = sdn
	SDN         string `json:"sdn,omitempty"`           // datasource system.sdn-connector.name (required when sub-type=sdn)
	SDNAddrType string `json:"sdn-addr-type,omitempty"` // private | public | all
}

// FGService mirrors FortiGate firewall.service/custom (used for READ / parsing GET responses).
// Category is []FGName because FortiGate returns it as an array in GET responses.
type FGService struct {
	Name          string   `json:"name"`
	Protocol      string   `json:"protocol"`                // TCP/UDP/SCTP | IP | ICMP | ICMP6
	TCPPortRange  string   `json:"tcp-portrange,omitempty"` // "80 443 8080-8090"
	UDPPortRange  string   `json:"udp-portrange,omitempty"`
	SCTPPortRange string   `json:"sctp-portrange,omitempty"`
	ProtocolNum   int      `json:"protocol-number,omitempty"` // for IP type
	ICMPType      *int     `json:"icmptype,omitempty"`
	ICMPCode      *int     `json:"icmpcode,omitempty"`
	Category      []FGName `json:"category,omitempty"` // array in GET response
	Comment       string   `json:"comment,omitempty"`
	Color         int      `json:"color,omitempty"`
	FQDN          string   `json:"fqdn,omitempty"`
	IPRange       string   `json:"iprange,omitempty"`
	RefCount      int      `json:"q_ref,omitempty"` // FortiGate reference count
}

// fgServiceWrite is the payload for POST/PUT to FortiGate.
// FortiGate REST API expects category as a plain STRING for write operations,
// not as an array of objects — sending array causes HTTP 400.
type fgServiceWrite struct {
	Name          string `json:"name"`
	Protocol      string `json:"protocol"`
	TCPPortRange  string `json:"tcp-portrange,omitempty"`
	UDPPortRange  string `json:"udp-portrange,omitempty"`
	SCTPPortRange string `json:"sctp-portrange,omitempty"`
	ProtocolNum   int    `json:"protocol-number,omitempty"`
	ICMPType      *int   `json:"icmptype,omitempty"`
	ICMPCode      *int   `json:"icmpcode,omitempty"`
	Category      string `json:"category,omitempty"` // ← STRING for write (not array)
	Comment       string `json:"comment,omitempty"`
	Color         int    `json:"color,omitempty"`
	FQDN          string `json:"fqdn,omitempty"`    // address restriction (FQDN)
	IPRange       string `json:"iprange,omitempty"` // address restriction (IP range)
}

// toServiceWrite converts FGService (read model) → fgServiceWrite (write payload).
// CREATE only — see toServiceUpdate for the PUT body.
func toServiceWrite(s FGService) fgServiceWrite {
	cat := ""
	if len(s.Category) > 0 {
		cat = s.Category[0].Name
	}
	return fgServiceWrite{
		Name: s.Name, Protocol: s.Protocol,
		TCPPortRange: s.TCPPortRange, UDPPortRange: s.UDPPortRange, SCTPPortRange: s.SCTPPortRange,
		ProtocolNum: s.ProtocolNum, ICMPType: s.ICMPType, ICMPCode: s.ICMPCode,
		Category: cat, Comment: s.Comment, Color: s.Color,
		FQDN: s.FQDN, IPRange: s.IPRange,
	}
}

// nullIfEmpty returns s, or nil so the key marshals as JSON null.
//
// On a PUT, JSON null is the ONLY value FortiOS accepts as "erase this field". Verified live on
// FortiOS 7.2.10 against firewall.service/custom:
//
//	{"udp-portrange":""}    → 200, revision_changed:false, old value kept
//	{"udp-portrange":" "}   → 200, revision_changed:false, old value kept
//	{"udp-portrange":null}  → 200, revision_changed:true,  value becomes ""
//
// That is why an `omitempty` string field can never clear anything: the key is dropped from the
// body entirely and the device keeps whatever it had.
func nullIfEmpty(s string) interface{} {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// toServiceUpdate builds the PUT body for UpdateService.
//
// It is a map rather than a struct because the key SET is protocol-dependent, not just the values.
// Sending the port-range keys on a non-TCP service is actively harmful: on a protocol=IP service,
// {"tcp-portrange":null,"udp-portrange":null,"sctp-portrange":null} also resets protocol-number
// to 0 (verified live — protocol-number 50 → 0 with those three keys present, unchanged without
// them). So each protocol emits only the keys that belong to it.
//
// Every key that IS emitted is always present, so clearing a field in the GUI actually clears it
// on the device. "color" is sent unconditionally for the same reason: colour 0 means "no colour",
// and an omitempty int would drop it and leave the old colour behind.
func toServiceUpdate(s FGService) map[string]interface{} {
	cat := ""
	if len(s.Category) > 0 {
		cat = s.Category[0].Name
	}
	p := map[string]interface{}{
		"name":     s.Name,
		"protocol": s.Protocol,
		"comment":  nullIfEmpty(s.Comment),
		"category": nullIfEmpty(cat),
		"color":    s.Color,
	}

	switch s.Protocol {
	case "ICMP", "ICMP6":
		p["icmptype"] = intOrNull(s.ICMPType)
		p["icmpcode"] = intOrNull(s.ICMPCode)
	case "IP":
		p["protocol-number"] = s.ProtocolNum
	default: // TCP/UDP/SCTP
		p["tcp-portrange"] = nullIfEmpty(s.TCPPortRange)
		p["udp-portrange"] = nullIfEmpty(s.UDPPortRange)
		p["sctp-portrange"] = nullIfEmpty(s.SCTPPortRange)
		// Address restriction — the GUI's "IP Range" / "FQDN" box, clearable back to "any".
		p["fqdn"] = nullIfEmpty(s.FQDN)
		p["iprange"] = nullIfEmpty(s.IPRange)
	}
	return p
}

// intOrNull mirrors nullIfEmpty for the optional ICMP numbers.
func intOrNull(v *int) interface{} {
	if v == nil {
		return nil
	}
	return *v
}
