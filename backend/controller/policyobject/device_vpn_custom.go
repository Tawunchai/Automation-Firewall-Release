package policyobject

import (
	"net/http"
	"strings"

	"network_automation/services"

	"github.com/gin-gonic/gin"
)

// Custom tunnels: phase 1 and phase 2 written by hand, with no template filling anything in.
//
// Split out of device_vpn.go.

// customInput is the Custom form's manual phase1/phase2 payload. See services.FGIPsecCustom for the
// CMDB key each field maps to.
type customInput struct {
	// Network
	IPVersion        string `json:"ip_version"`    // "4" | "6"
	LocalGateway     string `json:"local_gateway"` // local-gw (empty = Primary IP / device default)
	ModeConfig       bool   `json:"mode_config"`
	Keepalive        string `json:"keepalive"`
	DPD              string `json:"dpd"` // disable | on-idle | on-demand
	DPDRetryCount    string `json:"dpd_retry_count"`
	DPDRetryInterval string `json:"dpd_retry_interval"`
	FECEgress        bool   `json:"fec_egress"`
	FECIngress       bool   `json:"fec_ingress"`

	// Network → Advanced (nil pointers = leave the device default)
	AddRoute              *bool `json:"add_route"`
	AutoDiscoverySender   bool  `json:"auto_discovery_sender"`
	AutoDiscoveryReceiver bool  `json:"auto_discovery_receiver"`
	ExchangeInterfaceIP   bool  `json:"exchange_interface_ip"`
	NetDevice             *bool `json:"net_device"` // "Device creation"
	AggregateMember       bool  `json:"aggregate_member"`

	// Authentication
	IKEMode  string `json:"ike_mode"`  // aggressive | main (IKEv1)
	PeerType string `json:"peer_type"` // any | one
	PeerID   string `json:"peer_id"`   // when PeerType == "one"
	LocalID  string `json:"local_id"`
	Keylife  string `json:"keylife"`

	// Phase 2
	P2LocalSubnet    string `json:"p2_local_subnet"`
	P2RemoteSubnet   string `json:"p2_remote_subnet"`
	P2Proposal       string `json:"p2_proposal"`
	P2Replay         bool   `json:"p2_replay"`
	P2PFS            bool   `json:"p2_pfs"`
	P2DHGroup        string `json:"p2_dhgroup"`
	P2LocalPort      string `json:"p2_local_port"`
	P2RemotePort     string `json:"p2_remote_port"`
	P2Protocol       string `json:"p2_protocol"`
	P2AutoNegotiate  bool   `json:"p2_auto_negotiate"`
	P2Keepalive      bool   `json:"p2_keepalive"`
	P2KeylifeSeconds string `json:"p2_keylife_seconds"`
}

// createCustomTunnel builds the Custom template — the GUI's manual "New VPN Tunnel" form. Unlike
// Site-to-Site and Remote Access, it creates NOTHING beyond the tunnel itself: just phase1 + phase2
// (and, for signature auth with a Peer Certificate CA, the user.peer that carries it). That is
// exactly what the FortiGate GUI's Custom form does — no address objects, no policies, no routes.
// customWriteFromInput maps the Custom form's request onto the service write struct. Shared by
// create and update so the two paths can never drift.
func customWriteFromInput(inp tunnelInput) services.FGIPsecTunnelWrite {
	ci := inp.Custom
	var addRoute, netDevice *bool
	if ci.AddRoute != nil {
		v := *ci.AddRoute
		addRoute = &v
	}
	if ci.NetDevice != nil {
		v := *ci.NetDevice
		netDevice = &v
	}
	return services.FGIPsecTunnelWrite{
		Name:         strings.TrimSpace(inp.Name),
		Interface:    strings.TrimSpace(inp.Interface),
		IKEVersion:   defaultStr2(inp.IKEVersion, "2"),
		RemoteGW:     strings.TrimSpace(inp.RemoteGW),
		RemoteDDNS:   strings.TrimSpace(inp.RemoteDDNS),
		RemoteType:   defaultStr2(inp.RemoteType, "static"),
		NATTraversal: strings.TrimSpace(inp.NATTraversal),
		PSK:          inp.PSK,
		AuthMethod:   strings.TrimSpace(inp.AuthMethod),
		Certificate:  strings.TrimSpace(inp.Certificate),
		PeerCA:       strings.TrimSpace(inp.PeerCA),
		Proposal:     strings.TrimSpace(inp.Proposal),
		DHGroup:      strings.TrimSpace(inp.DHGroup),
		Comments:     inp.Comments,
		Custom: &services.FGIPsecCustom{
			IPVersion:             strings.TrimSpace(ci.IPVersion),
			LocalGateway:          strings.TrimSpace(ci.LocalGateway),
			ModeConfig:            ci.ModeConfig,
			Keepalive:             strings.TrimSpace(ci.Keepalive),
			DPD:                   strings.TrimSpace(ci.DPD),
			DPDRetryCount:         strings.TrimSpace(ci.DPDRetryCount),
			DPDRetryInterval:      strings.TrimSpace(ci.DPDRetryInterval),
			FECEgress:             ci.FECEgress,
			FECIngress:            ci.FECIngress,
			AddRoute:              addRoute,
			AutoDiscoverySender:   ci.AutoDiscoverySender,
			AutoDiscoveryReceiver: ci.AutoDiscoveryReceiver,
			ExchangeInterfaceIP:   ci.ExchangeInterfaceIP,
			NetDevice:             netDevice,
			AggregateMember:       ci.AggregateMember,
			IKEMode:               strings.TrimSpace(ci.IKEMode),
			PeerType:              strings.TrimSpace(ci.PeerType),
			PeerID:                strings.TrimSpace(ci.PeerID),
			LocalID:               strings.TrimSpace(ci.LocalID),
			Keylife:               strings.TrimSpace(ci.Keylife),
			P2LocalSubnet:         strings.TrimSpace(ci.P2LocalSubnet),
			P2RemoteSubnet:        strings.TrimSpace(ci.P2RemoteSubnet),
			P2Proposal:            strings.TrimSpace(ci.P2Proposal),
			P2Replay:              ci.P2Replay,
			P2PFS:                 ci.P2PFS,
			P2DHGroup:             strings.TrimSpace(ci.P2DHGroup),
			P2LocalPort:           strings.TrimSpace(ci.P2LocalPort),
			P2RemotePort:          strings.TrimSpace(ci.P2RemotePort),
			P2Protocol:            strings.TrimSpace(ci.P2Protocol),
			P2AutoNegotiate:       ci.P2AutoNegotiate,
			P2Keepalive:           ci.P2Keepalive,
			P2KeylifeSeconds:      strings.TrimSpace(ci.P2KeylifeSeconds),
		},
	}
}

func createCustomTunnel(c *gin.Context, di *deviceInfo, inp tunnelInput) {
	w := customWriteFromInput(inp)

	if err := services.ValidateIPsecTunnel(w); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	fc, ok := buildClient(c, di)
	if !ok {
		return
	}

	if err := fc.CreateIPsecTunnel(w); err != nil {
		respondDeviceError(c, err, "IPsec tunnel")
		return
	}

	c.JSON(http.StatusCreated, gin.H{
		"message": "Custom IPsec tunnel created on device",
		"name":    w.Name,
		"objects": gin.H{"phase1": w.Name, "phase2": w.Name},
	})
}
