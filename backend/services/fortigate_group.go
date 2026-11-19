package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
)

// The CMDB tables this file addresses. The mkey rule lives in the type — see
// cmdbTable in fortigate_cmdb.go.
var addrgrpTable = cmdbPath{path: "firewall/addrgrp", noun: "address group"}
var serviceGroupTable = cmdbPath{path: "firewall.service/group", noun: "service group"}

// Policy & Objects — the two GROUPING object types: firewall/addrgrp and firewall.service/group.
//
// Why these needed their own layer rather than another entry in fortigate_object.go's picker list:
// the console could already READ both (GetAddressGroups / GetServiceGroups return bare name lists
// so a policy form can reference one), but it could not create, edit or delete either. That is the
// difference between showing a group and having groups, and without the second one a policy table
// grows one rule per address forever — which is exactly the shape the Audit page then reports as
// clutter.
//
// Schema confirmed live against FortiGate 7.2.10 (FGT80E), `?action=schema&vdom=root`:
//
//	firewall/addrgrp        mkey name · member[] · exclude/exclude-member[] · allow-routing
//	                        · fabric-object · type default|folder · category · color · comment
//	firewall.service/group  mkey name · member[] · proxy · fabric-object · color · comment
//
// Three traps this file exists to absorb:
//
//  1. `member` is an ARRAY OF OBJECTS on the wire ([{"name":"x","q_origin_key":"x"}]) and a flat
//     list of names in every UI that touches it. Converting in one place means no page ever has to
//     know, and no page can get it half right.
//
//  2. exclude / allow-routing / fabric-object / proxy are "enable"/"disable" STRINGS, not JSON
//     booleans. Sending `true` is accepted with a 200 and stored as disable — the silent kind of
//     wrong. onOff/isOn are the only conversion.
//
//  3. A group with no members is not a group FortiOS will keep. The device rejects an empty
//     `member` on create; callers get that refusal as a DeviceError rather than a 200 and an
//     object that is not there.
//
//  4. ⚠️ allow-routing on a GROUP is discarded unless every member already has it. Found by
//     writing it and reading it back on the lab FGT80E: PUT {"allow-routing":"enable"} on a group
//     of two plain ipmask addresses answers 200, and the group reads back "disable". There is no
//     error code and nothing in the schema says so — the help text only describes what the field
//     means. A UI that trusted the 200 would show a toggle that silently flips itself off, which
//     is why writeAddressGroup reads the field back and says what happened.

// FGAddressGroup is our GUI-shaped view of firewall/addrgrp — member lists flattened to names.
type FGAddressGroup struct {
	Name           string   `json:"name"`
	Type           string   `json:"type"`    // default | folder
	Members        []string `json:"members"` // addresses and other groups, by name
	Exclude        bool     `json:"exclude"`
	ExcludeMembers []string `json:"exclude_members"`
	AllowRouting   bool     `json:"allow_routing"`
	FabricObject   bool     `json:"fabric_object"`
	Comment        string   `json:"comment"`
	Color          int      `json:"color"`
}

// FGServiceGroup is our GUI-shaped view of firewall.service/group.
type FGServiceGroup struct {
	Name         string   `json:"name"`
	Members      []string `json:"members"` // services and other service groups, by name
	Proxy        bool     `json:"proxy"`
	FabricObject bool     `json:"fabric_object"`
	Comment      string   `json:"comment"`
	Color        int      `json:"color"`
}

// fgMemberList is the wire shape of every `member`-style field: a list of {name} objects.
// q_origin_key comes back on reads and is ignored — it is the device's own key for the row.
type fgMemberList []struct {
	Name string `json:"name"`
}

func (m fgMemberList) names() []string {
	out := make([]string, 0, len(m))
	for _, e := range m {
		if e.Name != "" {
			out = append(out, e.Name)
		}
	}
	return out
}

// toMembers turns a flat name list back into the wire shape. It always returns a non-nil slice so
// that an emptied group serialises as `[]` — omitting the key would leave the old members in
// place, which reads as "the edit did not save".
func toMembers(names []string) []FGName {
	out := make([]FGName, 0, len(names))
	for _, n := range names {
		if n != "" {
			out = append(out, FGName{Name: n})
		}
	}
	return out
}

// onOff renders a Go bool as the string FortiOS stores. See trap 2 above.
func onOff(b bool) string {
	if b {
		return "enable"
	}
	return "disable"
}

// isOn reads one back. Anything that is not exactly "enable" is off, including "" from a field
// this firmware does not have.
func isOn(s string) bool { return s == "enable" }

// ── Address groups (firewall/addrgrp) ────────────────────────────────────────

// fgAddressGroupRaw is the CMDB shape, used only for decoding a GET.
type fgAddressGroupRaw struct {
	Name          string       `json:"name"`
	Type          string       `json:"type"`
	Member        fgMemberList `json:"member"`
	Exclude       string       `json:"exclude"`
	ExcludeMember fgMemberList `json:"exclude-member"`
	AllowRouting  string       `json:"allow-routing"`
	FabricObject  string       `json:"fabric-object"`
	Comment       string       `json:"comment"`
	Color         int          `json:"color"`
}

func (r fgAddressGroupRaw) toGUI() FGAddressGroup {
	return FGAddressGroup{
		Name:           r.Name,
		Type:           r.Type,
		Members:        r.Member.names(),
		Exclude:        isOn(r.Exclude),
		ExcludeMembers: r.ExcludeMember.names(),
		AllowRouting:   isOn(r.AllowRouting),
		FabricObject:   isOn(r.FabricObject),
		Comment:        r.Comment,
		Color:          r.Color,
	}
}

// addressGroupPayload builds the CMDB body.
//
// exclude-member is sent only when exclude is on: FortiOS keeps the list around after exclude is
// turned off, and echoing it back would resurrect an exclusion the operator had just cleared.
func addressGroupPayload(g FGAddressGroup) map[string]any {
	typ := g.Type
	if typ == "" {
		typ = "default"
	}
	body := map[string]any{
		"name":          g.Name,
		"type":          typ,
		"member":        toMembers(g.Members),
		"exclude":       onOff(g.Exclude),
		"allow-routing": onOff(g.AllowRouting),
		"fabric-object": onOff(g.FabricObject),
		"comment":       g.Comment,
		"color":         g.Color,
	}
	if g.Exclude {
		body["exclude-member"] = toMembers(g.ExcludeMembers)
	} else {
		body["exclude-member"] = []FGName{}
	}
	return body
}

func (f *FortiClient) GetAddressGroupsFull() ([]FGAddressGroup, error) {
	raw, err := cmdbRaws[fgAddressGroupRaw](f, addrgrpTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGAddressGroup, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

func (f *FortiClient) GetAddressGroup(name string) (*FGAddressGroup, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall/addrgrp/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgAddressGroupRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse address group: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("address group %q not found", name)
	}
	g := raw[0].toGUI()
	return &g, nil
}

// ErrAllowRoutingDiscarded reports trap 4: the write succeeded, the group is on the device, and
// the one field the operator asked for was dropped.
//
// It is an error value rather than a silent adjustment because the operator has a decision to
// make — enable allow-routing on the member addresses first, or stop expecting a static route to
// be able to name this group. Swallowing it would leave them looking at a toggle that will not
// stay on, with nothing on screen explaining why.
var ErrAllowRoutingDiscarded = errors.New(
	"the group was saved, but the device discarded \"static route configuration\": FortiOS only " +
		"keeps allow-routing on a group whose members all have it enabled themselves. Turn it on " +
		"for the member addresses first")

// writeAddressGroup performs the POST or PUT and then checks the one field the device is known to
// accept and ignore. Everything else in the payload is either rejected loudly or stored.
func (f *FortiClient) writeAddressGroup(method, path string, g FGAddressGroup) error {
	if _, err := f.do(method, path, addressGroupPayload(g)); err != nil {
		return err
	}
	if !g.AllowRouting {
		return nil
	}
	// Read it back. A failed read is NOT reported as a discarded field — we would be inventing a
	// problem out of not knowing, which is the mistake this codebase keeps having to unmake.
	stored, err := f.GetAddressGroup(g.Name)
	if err != nil || stored.AllowRouting {
		return nil //nolint:nilerr
	}
	return ErrAllowRoutingDiscarded
}

func (f *FortiClient) CreateAddressGroup(g FGAddressGroup) error {
	return f.writeAddressGroup("POST", "/api/v2/cmdb/firewall/addrgrp", g)
}

func (f *FortiClient) UpdateAddressGroup(name string, g FGAddressGroup) error {
	// The write goes to the OLD name; the read-back needs the new one, which is what the payload
	// carries. g.Name is therefore what writeAddressGroup verifies, and a rename is handled.
	return f.writeAddressGroup("PUT", "/api/v2/cmdb/firewall/addrgrp/"+url.PathEscape(name), g)
}

func (f *FortiClient) DeleteAddressGroup(name string) error {
	// By mkey, never at the collection URL — a DELETE on /firewall/addrgrp empties the table.
	return addrgrpTable.Delete(f, name)
}

// ── Service groups (firewall.service/group) ──────────────────────────────────

type fgServiceGroupRaw struct {
	Name         string       `json:"name"`
	Member       fgMemberList `json:"member"`
	Proxy        string       `json:"proxy"`
	FabricObject string       `json:"fabric-object"`
	Comment      string       `json:"comment"`
	Color        int          `json:"color"`
}

func (r fgServiceGroupRaw) toGUI() FGServiceGroup {
	return FGServiceGroup{
		Name:         r.Name,
		Members:      r.Member.names(),
		Proxy:        isOn(r.Proxy),
		FabricObject: isOn(r.FabricObject),
		Comment:      r.Comment,
		Color:        r.Color,
	}
}

func serviceGroupPayload(g FGServiceGroup) map[string]any {
	return map[string]any{
		"name":          g.Name,
		"member":        toMembers(g.Members),
		"proxy":         onOff(g.Proxy),
		"fabric-object": onOff(g.FabricObject),
		"comment":       g.Comment,
		"color":         g.Color,
	}
}

func (f *FortiClient) GetServiceGroupsFull() ([]FGServiceGroup, error) {
	raw, err := cmdbRaws[fgServiceGroupRaw](f, serviceGroupTable)
	if err != nil {
		return nil, err
	}
	out := make([]FGServiceGroup, 0, len(raw))
	for _, r := range raw {
		out = append(out, r.toGUI())
	}
	return out, nil
}

func (f *FortiClient) GetServiceGroup(name string) (*FGServiceGroup, error) {
	resp, err := f.do("GET", "/api/v2/cmdb/firewall.service/group/"+url.PathEscape(name), nil)
	if err != nil {
		return nil, err
	}
	var raw []fgServiceGroupRaw
	if err := json.Unmarshal(resp.Results, &raw); err != nil {
		return nil, fmt.Errorf("failed to parse service group: %w", err)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("service group %q not found", name)
	}
	g := raw[0].toGUI()
	return &g, nil
}

func (f *FortiClient) CreateServiceGroup(g FGServiceGroup) error {
	return serviceGroupTable.Create(f, serviceGroupPayload(g))
}

func (f *FortiClient) UpdateServiceGroup(name string, g FGServiceGroup) error {
	return serviceGroupTable.Update(f, name, serviceGroupPayload(g))
}

func (f *FortiClient) DeleteServiceGroup(name string) error {
	return serviceGroupTable.Delete(f, name)
}
