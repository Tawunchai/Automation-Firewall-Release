package policyobject

// Request bodies for the Policy & Objects device-proxy handlers.
//
// These are the shapes the frontend forms POST/PATCH. They live in their own file because they are
// shared across device_proxy.go's policy, address and service handlers — they used to be declared
// alongside a DB-backed CRUD stack that nothing called, and several fields are already annotated
// "device-proxy path only", which is now simply everything.
//
// Field naming follows the JSON the frontend sends, not the FortiOS CMDB key; the translation to
// CMDB keys happens in services/fortigate.go.

type policyInput struct {
	Name       string   `json:"name"`
	SrcIntf    string   `json:"src_intf"`
	DstIntf    string   `json:"dst_intf"`
	SrcAddr    []string `json:"src_addr"`
	DstAddr    []string `json:"dst_addr"`
	Schedule   string   `json:"schedule"`
	Service    []string `json:"service"`
	Action     string   `json:"action"`
	NAT        bool     `json:"nat"`
	LogTraffic string   `json:"log_traffic"`
	Enabled    *bool    `json:"enabled"`
	Comments   string   `json:"comments"`

	// Multi-interface support (falls back to SrcIntf/DstIntf when empty)
	SrcIntfList []string `json:"src_intf_list"`
	DstIntfList []string `json:"dst_intf_list"`

	// NAT / IP pool
	IPPool    bool     `json:"ippool"`
	PoolName  []string `json:"poolname"`
	FixedPort bool     `json:"fixedport"`

	ProtocolOptions string `json:"protocol_options"`

	// Security profiles — empty string means disabled
	AVProfile              string `json:"av_profile"`
	WebFilterProfile       string `json:"webfilter_profile"`
	DNSFilterProfile       string `json:"dnsfilter_profile"`
	AppControl             string `json:"app_control"`
	IPSSensor              string `json:"ips_sensor"`
	FileFilterProfile      string `json:"file_filter_profile"`
	SSLSSHProfile          string `json:"ssl_ssh_profile"`
	DecryptedTrafficMirror string `json:"decrypted_traffic_mirror"`
}

type addressInput struct {
	Name      string   `json:"name"`
	Type      string   `json:"type"`
	Subnet    string   `json:"subnet"`
	StartIP   string   `json:"start_ip"`
	EndIP     string   `json:"end_ip"`
	Interface string   `json:"interface"`
	Comment   string   `json:"comment"`
	Color     int      `json:"color"`     // FortiGate color index 0-32
	Country   string   `json:"country"`   // ISO 3166-1 alpha-2 (geography type)
	MacAddrs  []string `json:"mac_addrs"` // MAC address list (mac type)

	AllowRouting bool `json:"allow_routing"` // "Static route configuration" toggle (ipmask & fqdn)

	// Dynamic (Fabric Connector) address fields.
	SubType     string `json:"sub_type"`      // sdn | clearpass-spt | fsso | ems-tag | ...
	SDN         string `json:"sdn"`           // SDN connector name (required when sub_type=sdn)
	SDNAddrType string `json:"sdn_addr_type"` // private | public | all
}

type serviceInput struct {
	Name      string `json:"name"`
	Protocol  string `json:"protocol"`
	TCPPorts  string `json:"tcp_ports"`
	UDPPorts  string `json:"udp_ports"`
	SCTPPorts string `json:"sctp_ports"`
	IPProto   *int   `json:"ip_proto"`
	ICMPType  *int   `json:"icmp_type"`
	ICMPCode  *int   `json:"icmp_code"`
	Category  string `json:"category"`
	Comment   string `json:"comment"`
	Color     int    `json:"color"`   // FortiGate color index 0-32
	FQDN      string `json:"fqdn"`    // FQDN restriction for TCP/UDP/SCTP (e.g. "*.example.com")
	IPRange   string `json:"iprange"` // IP range restriction for TCP/UDP/SCTP (e.g. "192.168.1.0")
}
