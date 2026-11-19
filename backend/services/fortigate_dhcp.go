package services

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var dhcpServerTable = cmdbPath{path: "system.dhcp/server", noun: "DHCP server"}

// Network ▸ DHCP Servers (system.dhcp/server) — who hands out addresses on each LAN.
//
// Schema read live off FortiGate 7.2.10 (FGT80E): 50 fields, mkey `id` (an integer the device
// assigns), and six nested tables. Only the ones an operator actually sets are mapped —
// ip-range, exclude-range and reserved-address. The rest (wifi-ac*, ddns-*, vci-*, options,
// tftp-server) are left untouched on an edit rather than mapped and sent back as defaults, which
// is the difference between editing a DHCP server and silently rewriting it.
//
// ── The traps ────────────────────────────────────────────────────────────────
//
// **0.0.0.0 is how this table spells "unset".** default-gateway, netmask, next-server, dns-server1
// through 4, ntp-server1 through 3 and wins-server1/2 all default to 0.0.0.0, and the device
// returns that rather than an empty string. Rendering it literally would put "0.0.0.0" in a
// Default Gateway column on every server that does not set one, which reads as a real, and wrong,
// answer. Reads drop it; writes send "0.0.0.0" back to CLEAR a field, because omitting the key
// leaves the old value in place.
//
// **The DNS servers are four scalar fields, not a list.** dns-server1..4, in order, with gaps
// allowed. The UI wants a list, so this collapses them on read and spreads them back on write —
// including writing 0.0.0.0 into the slots the list no longer fills, or removing a DNS server from
// the middle would leave it on the device.
//
// **dns-service decides whether those fields mean anything at all.** `local` means the FortiGate
// itself, `default` means the system DNS, and only `specify` uses dns-server1..4. A server left on
// `default` with addresses filled in is not using them, so the read reports the mode and the UI
// says which one is in force.

// ── One address range ────────────────────────────────────────────────────────

// FGDHCPRange is one row of ip-range or exclude-range. Both tables have the same shape.
type FGDHCPRange struct {
	ID      int    `json:"id"`
	StartIP string `json:"start_ip"`
	EndIP   string `json:"end_ip"`
}

// FGDHCPReservation ties one MAC to one address — reserved-address.
//
// `action` is the part that is not obvious: `reserved` (the default) hands this MAC that address,
// `assign` hands it an address from the pool, and `block` refuses it a lease at all. So this table
// is both the reservation list and the MAC deny list.
type FGDHCPReservation struct {
	ID          int    `json:"id"`
	MAC         string `json:"mac"`
	IP          string `json:"ip"`
	Action      string `json:"action"` // reserved | assign | block
	Description string `json:"description"`
}

// ── The server ───────────────────────────────────────────────────────────────

type FGDHCPServer struct {
	ID        int    `json:"id"`
	Status    bool   `json:"status"`
	Interface string `json:"interface"`

	IPRanges      []FGDHCPRange `json:"ip_ranges"`
	ExcludeRanges []FGDHCPRange `json:"exclude_ranges"`

	Netmask        string `json:"netmask"`
	DefaultGateway string `json:"default_gateway"`

	DNSService string   `json:"dns_service"` // local | default | specify
	DNSServers []string `json:"dns_servers"` // only meaningful with dns_service = specify

	NTPService string   `json:"ntp_service"` // local | default | specify
	NTPServers []string `json:"ntp_servers"`

	LeaseTime int    `json:"lease_time"` // seconds
	Domain    string `json:"domain"`

	Reservations []FGDHCPReservation `json:"reservations"`

	// ServerType `ipsec` serves addresses to dial-up VPN clients rather than a physical segment,
	// and IPMode `usrgrp` takes them from a user group instead of ip-range. Both are read-only
	// here: the console does not offer them, but it must not hide that a server is in one.
	ServerType string `json:"server_type"`
	IPMode     string `json:"ip_mode"`
}

// unsetIP normalises the device's "no value" into an empty string. See the trap above.
func unsetIP(s string) string {
	if s == "0.0.0.0" {
		return ""
	}
	return s
}

// clearableIP is the inverse: an empty field must be SENT as 0.0.0.0 to clear it, because a key
// left out of a PUT keeps whatever the device already had.
func clearableIP(s string) string {
	if strings.TrimSpace(s) == "" {
		return "0.0.0.0"
	}
	return strings.TrimSpace(s)
}

type fgDHCPRangeRaw struct {
	ID      int    `json:"id"`
	StartIP string `json:"start-ip"`
	EndIP   string `json:"end-ip"`
}

type fgDHCPReservationRaw struct {
	ID          int    `json:"id"`
	MAC         string `json:"mac"`
	IP          string `json:"ip"`
	Action      string `json:"action"`
	Description string `json:"description"`
}

type fgDHCPServerRaw struct {
	ID             int                    `json:"id"`
	Status         string                 `json:"status"`
	Interface      string                 `json:"interface"`
	IPRange        []fgDHCPRangeRaw       `json:"ip-range"`
	ExcludeRange   []fgDHCPRangeRaw       `json:"exclude-range"`
	Netmask        string                 `json:"netmask"`
	DefaultGateway string                 `json:"default-gateway"`
	DNSService     string                 `json:"dns-service"`
	DNSServer1     string                 `json:"dns-server1"`
	DNSServer2     string                 `json:"dns-server2"`
	DNSServer3     string                 `json:"dns-server3"`
	DNSServer4     string                 `json:"dns-server4"`
	NTPService     string                 `json:"ntp-service"`
	NTPServer1     string                 `json:"ntp-server1"`
	NTPServer2     string                 `json:"ntp-server2"`
	NTPServer3     string                 `json:"ntp-server3"`
	LeaseTime      int                    `json:"lease-time"`
	Domain         string                 `json:"domain"`
	Reserved       []fgDHCPReservationRaw `json:"reserved-address"`
	ServerType     string                 `json:"server-type"`
	IPMode         string                 `json:"ip-mode"`
}

// compactIPs collapses the numbered scalar fields into the list the UI wants, dropping the unset
// ones. Order is preserved; a gap in the middle simply closes up.
func compactIPs(vals ...string) []string {
	out := make([]string, 0, len(vals))
	for _, v := range vals {
		if ip := unsetIP(strings.TrimSpace(v)); ip != "" {
			out = append(out, ip)
		}
	}
	return out
}

func toRanges(raw []fgDHCPRangeRaw) []FGDHCPRange {
	out := make([]FGDHCPRange, 0, len(raw))
	for _, r := range raw {
		out = append(out, FGDHCPRange(r))
	}
	return out
}

func (r fgDHCPServerRaw) toGUI() FGDHCPServer {
	reservations := make([]FGDHCPReservation, 0, len(r.Reserved))
	for _, x := range r.Reserved {
		reservations = append(reservations, FGDHCPReservation(x))
	}
	return FGDHCPServer{
		ID:             r.ID,
		Status:         isOn(r.Status),
		Interface:      r.Interface,
		IPRanges:       toRanges(r.IPRange),
		ExcludeRanges:  toRanges(r.ExcludeRange),
		Netmask:        unsetIP(r.Netmask),
		DefaultGateway: unsetIP(r.DefaultGateway),
		DNSService:     r.DNSService,
		DNSServers:     compactIPs(r.DNSServer1, r.DNSServer2, r.DNSServer3, r.DNSServer4),
		NTPService:     r.NTPService,
		NTPServers:     compactIPs(r.NTPServer1, r.NTPServer2, r.NTPServer3),
		LeaseTime:      r.LeaseTime,
		Domain:         r.Domain,
		Reservations:   reservations,
		ServerType:     r.ServerType,
		IPMode:         r.IPMode,
	}
}

// spreadIPs is the inverse of compactIPs: it fills `slots` numbered fields from the list and
// CLEARS the remainder. Leaving the unused ones out would keep a removed server on the device.
func spreadIPs(body map[string]any, prefix string, slots int, ips []string) {
	for i := 0; i < slots; i++ {
		v := "0.0.0.0"
		if i < len(ips) && strings.TrimSpace(ips[i]) != "" {
			v = strings.TrimSpace(ips[i])
		}
		body[fmt.Sprintf("%s%d", prefix, i+1)] = v
	}
}

func rangePayload(rs []FGDHCPRange) []map[string]any {
	out := make([]map[string]any, 0, len(rs))
	for _, r := range rs {
		if r.StartIP == "" || r.EndIP == "" {
			continue
		}
		e := map[string]any{"start-ip": r.StartIP, "end-ip": r.EndIP}
		// The device assigns the id. Sending back the one it gave us keeps an edit from
		// renumbering rows the operator did not touch.
		if r.ID > 0 {
			e["id"] = r.ID
		}
		out = append(out, e)
	}
	return out
}

func dhcpServerPayload(s FGDHCPServer) map[string]any {
	dnsService := s.DNSService
	if dnsService == "" {
		dnsService = "default"
	}
	ntpService := s.NTPService
	if ntpService == "" {
		ntpService = "default"
	}
	lease := s.LeaseTime
	if lease <= 0 {
		lease = 604800 // the device's own default: seven days
	}

	body := map[string]any{
		"status":          onOff(s.Status),
		"interface":       s.Interface,
		"ip-range":        rangePayload(s.IPRanges),
		"exclude-range":   rangePayload(s.ExcludeRanges),
		"netmask":         clearableIP(s.Netmask),
		"default-gateway": clearableIP(s.DefaultGateway),
		"dns-service":     dnsService,
		"ntp-service":     ntpService,
		"lease-time":      lease,
		"domain":          s.Domain,
	}

	// Addresses are only written in `specify` mode. Writing them under local/default would store
	// settings the server is not using — an edit that appears to have taken effect and has not.
	// Switching TO those modes clears the slots for the same reason.
	if dnsService == "specify" {
		spreadIPs(body, "dns-server", 4, s.DNSServers)
	} else {
		spreadIPs(body, "dns-server", 4, nil)
	}
	if ntpService == "specify" {
		spreadIPs(body, "ntp-server", 3, s.NTPServers)
	} else {
		spreadIPs(body, "ntp-server", 3, nil)
	}

	reserved := make([]map[string]any, 0, len(s.Reservations))
	for _, r := range s.Reservations {
		if strings.TrimSpace(r.MAC) == "" {
			continue
		}
		action := r.Action
		if action == "" {
			action = "reserved"
		}
		e := map[string]any{
			"mac":         strings.ToLower(strings.TrimSpace(r.MAC)),
			"action":      action,
			"description": r.Description,
			"type":        "mac",
		}
		// A blocked MAC has no address to reserve, and 0.0.0.0 is what the table stores for it.
		if action == "block" {
			e["ip"] = "0.0.0.0"
		} else {
			e["ip"] = clearableIP(r.IP)
		}
		if r.ID > 0 {
			e["id"] = r.ID
		}
		reserved = append(reserved, e)
	}
	body["reserved-address"] = reserved

	return body
}

// GetDHCPServers lists every DHCP server on the device.
func (f *FortiClient) GetDHCPServers() ([]FGDHCPServer, error) {
	raw, err := cmdbRaws[fgDHCPServerRaw](f, dhcpServerTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGDHCPServer, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

// GetDHCPServer fetches one by id, for the edit form.
func (f *FortiClient) GetDHCPServer(id int) (*FGDHCPServer, error) {
	resp, err := f.do("GET", fmt.Sprintf("/api/v2/cmdb/system.dhcp/server/%d", id), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgDHCPServerRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse DHCP server: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("DHCP server %d not found", id)
	}
	s := raw[0].toGUI()
	return &s, nil
}

// CreateDHCPServer returns the id the device assigned.
func (f *FortiClient) CreateDHCPServer(s FGDHCPServer) (int, error) {
	resp, err := f.do("POST", "/api/v2/cmdb/system.dhcp/server", dhcpServerPayload(s))
	if err != nil {
		return 0, err
	}
	if resp.MKey != nil {
		switch v := resp.MKey.(type) {
		case float64:
			return int(v), nil
		case int:
			return v, nil
		}
	}
	return 0, nil
}

func (f *FortiClient) UpdateDHCPServer(id int, s FGDHCPServer) error {
	_, err := f.do("PUT", fmt.Sprintf("/api/v2/cmdb/system.dhcp/server/%d", id), dhcpServerPayload(s))
	return err
}

// DeleteDHCPServer removes one server BY ID. Never a collection URL — see fortios-gotchas.md.
func (f *FortiClient) DeleteDHCPServer(id int) error {
	return dhcpServerTable.Delete(f, strconv.Itoa(id))
}
