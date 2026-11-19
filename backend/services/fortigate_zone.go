package services

import ()

// Network — Zones (system/zone): a name for several interfaces so a policy can be written once
// for "inside" instead of once per port.
//
// This console had no zone anywhere except as a string the Troubleshoot walk happened to read, so
// every policy here has to name a physical interface. On an 80E with 20 ports that is survivable;
// it is also the reason the policy table in the Audit page is grouped by interface pair and not by
// anything an operator chose.
//
// Schema confirmed live on FortiGate 7.2.10 (FGT80E):
//
//	system/zone   mkey name · interface[] · intrazone allow|deny · description · tagging
//
// TWO traps, both of which would have been invisible without reading the schema:
//
//  1. The member key is `interface-name`, NOT `name`. Every other member table in this codebase
//     (addrgrp.member, service group member, policy srcaddr) is a list of {"name": …}; this one is
//     a list of {"interface-name": …} because its mkey is declared that way. A payload built with
//     the usual {"name"} shape is accepted with a 200 and stores an EMPTY zone.
//
//  2. The device enforces what the schema's help text says: "Interfaces must not be assigned to
//     another zone or have firewall policies defined." So a zone cannot be created over the ports
//     an existing rule already names — which on a firewall that is already in service is most of
//     them. That refusal comes back as a DeviceError and is surfaced verbatim rather than being
//     translated into something friendlier; the operator needs to know WHICH constraint bit.
//
// intrazone is the other thing worth getting right: `deny` (the default) means traffic between two
// interfaces in the same zone still needs a policy. Defaulting it to allow would silently open
// paths on every zone anyone creates here, so this code never supplies a default of its own — it
// sends what the form says and the form shows FortiOS's own default.

// FGZone is our GUI-shaped view of system/zone.
type FGZone struct {
	Name        string   `json:"name"`
	Interfaces  []string `json:"interfaces"`
	Intrazone   string   `json:"intrazone"` // allow | deny
	Description string   `json:"description"`
}

// fgZoneMemberList is system/zone's member shape. See trap 1 — the key is interface-name.
type fgZoneMemberList []struct {
	InterfaceName string `json:"interface-name"`
}

func (m fgZoneMemberList) names() []string {
	out := make([]string, 0, len(m))
	for _, e := range m {
		if e.InterfaceName != "" {
			out = append(out, e.InterfaceName)
		}
	}
	return out
}

// fgZoneMember is the write side of the same shape.
type fgZoneMember struct {
	InterfaceName string `json:"interface-name"`
}

func toZoneMembers(names []string) []fgZoneMember {
	out := make([]fgZoneMember, 0, len(names))
	for _, n := range names {
		if n != "" {
			out = append(out, fgZoneMember{InterfaceName: n})
		}
	}
	return out
}

type fgZoneRaw struct {
	Name        string           `json:"name"`
	Interface   fgZoneMemberList `json:"interface"`
	Intrazone   string           `json:"intrazone"`
	Description string           `json:"description"`
}

func (r fgZoneRaw) toGUI() FGZone {
	return FGZone{
		Name:        r.Name,
		Interfaces:  r.Interface.names(),
		Intrazone:   r.Intrazone,
		Description: r.Description,
	}
}

func zonePayload(z FGZone) map[string]any {
	intra := z.Intrazone
	if intra != "allow" {
		// Anything that is not an explicit allow is deny — the safe half, and FortiOS's default.
		intra = "deny"
	}
	return map[string]any{
		"name":        z.Name,
		"interface":   toZoneMembers(z.Interfaces),
		"intrazone":   intra,
		"description": z.Description,
	}
}

// zones is system/zone as this package addresses it. One place that knows the URL, so a delete
// cannot be written without its mkey — see cmdbTable in fortigate_cmdb.go.
var zones = cmdbTable[fgZoneRaw, FGZone]{
	cmdbPath: cmdbPath{path: "system/zone", noun: "zone"},
	gui:      fgZoneRaw.toGUI,
}

func (f *FortiClient) GetZones() ([]FGZone, error) { return zones.List(f) }

func (f *FortiClient) GetZone(name string) (*FGZone, error) { return zones.Get(f, name) }

func (f *FortiClient) CreateZone(z FGZone) error { return zones.Create(f, zonePayload(z)) }

func (f *FortiClient) UpdateZone(name string, z FGZone) error {
	return zones.Update(f, name, zonePayload(z))
}

func (f *FortiClient) DeleteZone(name string) error { return zones.Delete(f, name) }
