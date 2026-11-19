package services

import (
	"encoding/json"
	"fmt"
	"net/url"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var ippoolTable = cmdbPath{path: "firewall/ippool", noun: "IP pool"}

// Policy & Objects — IP Pools (firewall/ippool), the source addresses a policy's NAT translates to.
//
// Same hole as the groups next door: GetIPPools() already returned a name list, so the firewall
// policy form could SELECT a pool, but nothing in this console could make one. A dropdown whose
// only entries were made somewhere else is a dead end — the operator has to leave for the device's
// own GUI in the middle of writing a rule, which is the thing this console exists to avoid.
//
// Schema confirmed live on FortiGate 7.2.10 (FGT80E). The fields that matter depend entirely on
// `type`, and FortiOS quietly keeps whatever the others were set to:
//
//	overload               startip-endip. One external address shared, ports rewritten. The default.
//	one-to-one             startip-endip. No port translation; one internal host per external address.
//	fixed-port-range       startip-endip PLUS source-startip/source-endip. Ports preserved, so the
//	                       two ranges have to be sized against each other.
//	port-block-allocation  startip-endip PLUS block-size and num-blocks-per-user. Each user gets a
//	                       block of ports, which is what makes a CGNAT log traceable.
//
// Traps:
//
//  1. The comment field here is `comments` (plural). firewall/address and firewall/addrgrp both
//     use `comment`. Sending the wrong one is accepted and silently dropped.
//
//  2. arp-reply, permit-any-host, nat64, add-nat64-route and subnet-broadcast-in-ippool are
//     enable/disable STRINGS. arp-reply defaults to ENABLE, so a payload that omits it on create
//     is fine but one that sends `false` turns off the ARP the pool needs to be reachable.
//
//  3. Fields belonging to another type are not cleared by switching type. The payload always sends
//     the full set for the selected type and zeroes the rest, so what the form shows is what the
//     device holds.

// FGIPPool is our GUI-shaped view of firewall/ippool.
type FGIPPool struct {
	Name    string `json:"name"`
	Type    string `json:"type"` // overload | one-to-one | fixed-port-range | port-block-allocation
	StartIP string `json:"start_ip"`
	EndIP   string `json:"end_ip"`

	// fixed-port-range only — the internal range the external one maps from.
	SourceStartIP string `json:"source_start_ip,omitempty"`
	SourceEndIP   string `json:"source_end_ip,omitempty"`

	// port-block-allocation only.
	BlockSize        int `json:"block_size,omitempty"`
	NumBlocksPerUser int `json:"num_blocks_per_user,omitempty"`

	ARPReply            bool   `json:"arp_reply"`
	ARPInterface        string `json:"arp_interface,omitempty"`
	AssociatedInterface string `json:"associated_interface,omitempty"`
	PermitAnyHost       bool   `json:"permit_any_host"`
	Comments            string `json:"comments"`
}

type fgIPPoolRaw struct {
	Name                string `json:"name"`
	Type                string `json:"type"`
	StartIP             string `json:"startip"`
	EndIP               string `json:"endip"`
	SourceStartIP       string `json:"source-startip"`
	SourceEndIP         string `json:"source-endip"`
	BlockSize           int    `json:"block-size"`
	NumBlocksPerUser    int    `json:"num-blocks-per-user"`
	ARPReply            string `json:"arp-reply"`
	ARPInterface        string `json:"arp-intf"`
	AssociatedInterface string `json:"associated-interface"`
	PermitAnyHost       string `json:"permit-any-host"`
	Comments            string `json:"comments"`
}

func (r fgIPPoolRaw) toGUI() FGIPPool {
	p := FGIPPool{
		Name:                r.Name,
		Type:                r.Type,
		StartIP:             r.StartIP,
		EndIP:               r.EndIP,
		ARPReply:            isOn(r.ARPReply),
		ARPInterface:        r.ARPInterface,
		AssociatedInterface: r.AssociatedInterface,
		PermitAnyHost:       isOn(r.PermitAnyHost),
		Comments:            r.Comments,
	}
	// Only surface the per-type fields for the type that owns them — see trap 3. A leftover
	// source range on an `overload` pool is noise the form would otherwise render as real.
	switch r.Type {
	case "fixed-port-range":
		p.SourceStartIP = r.SourceStartIP
		p.SourceEndIP = r.SourceEndIP
	case "port-block-allocation":
		p.BlockSize = r.BlockSize
		p.NumBlocksPerUser = r.NumBlocksPerUser
	}
	return p
}

func ipPoolPayload(p FGIPPool) map[string]any {
	typ := p.Type
	if typ == "" {
		typ = "overload"
	}
	body := map[string]any{
		"name":                 p.Name,
		"type":                 typ,
		"startip":              p.StartIP,
		"endip":                p.EndIP,
		"arp-reply":            onOff(p.ARPReply),
		"permit-any-host":      onOff(p.PermitAnyHost),
		"associated-interface": p.AssociatedInterface,
		"comments":             p.Comments,
	}
	// arp-intf is only meaningful with arp-reply on, and FortiOS refuses an interface name it
	// cannot resolve, so it is sent only when both are present.
	if p.ARPReply && p.ARPInterface != "" {
		body["arp-intf"] = p.ARPInterface
	}

	// Per-type fields, and explicit zeroes for the ones the chosen type does not use.
	if typ == "fixed-port-range" {
		body["source-startip"] = p.SourceStartIP
		body["source-endip"] = p.SourceEndIP
	} else {
		body["source-startip"] = "0.0.0.0"
		body["source-endip"] = "0.0.0.0"
	}
	if typ == "port-block-allocation" {
		if p.BlockSize > 0 {
			body["block-size"] = p.BlockSize
		}
		if p.NumBlocksPerUser > 0 {
			body["num-blocks-per-user"] = p.NumBlocksPerUser
		}
	}
	return body
}

func (f *FortiClient) GetIPPoolsFull() ([]FGIPPool, error) {
	raw, err := cmdbRaws[fgIPPoolRaw](f, ippoolTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGIPPool, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

func (f *FortiClient) GetIPPool(name string) (*FGIPPool, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/ippool/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgIPPoolRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse IP pool: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("IP pool %q not found", name)
	}
	p := raw[0].toGUI()
	return &p, nil
}

func (f *FortiClient) CreateIPPool(p FGIPPool) error {
	return ippoolTable.Create(f, ipPoolPayload(p))
}

func (f *FortiClient) UpdateIPPool(name string, p FGIPPool) error {
	return ippoolTable.Update(f, name, ipPoolPayload(p))
}

func (f *FortiClient) DeleteIPPool(name string) error {
	return ippoolTable.Delete(f, name)
}
